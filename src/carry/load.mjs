// T5 B1: `load`, in the brief's order: guards, fetch (clone the first time, fast-forward after), what this PC changed, the backup,
// the writes (the carry set's targets only), the practice pause, the times, the pictures, the user settings, the record, the summary.
// Roots and outside calls come in as in save.mjs.

import * as nodeFs from 'node:fs'
import { join, dirname } from 'node:path'

import { writeAtomic } from '../write.mjs'
import { FOCUS_LINE } from '../goals.mjs'
import { blobOf, blobOfFile, ensureDataClone, fastForward, hasIdentity, lines } from './git.mjs'
import { loadGuards } from './guards.mjs'
import { parseTimes, restoreTimes } from './times.mjs'
import { readRecord, writeRecord } from './record.mjs'
import { branchFor, clockOf } from './save.mjs'

const slashes = path => String(path).replace(/\\/g, '/')
const SET_ROOTS = ['home/', 'board/', 'memory/']
export const stampOf = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-')

/**
 * One load. `roots`: boardDir, project, config (this PC's current, or null on a first load), gameRepo, workDir, dataDir,
 * isExplicitData, remote, picturesFolder, memoryDir, userSettingsFile. `options`: practice, dryRun, park, undo (a stamp), userSettings,
 * picturesOnly, journal, log, now. `deps`: git, set (B2), pictures (B3), fs (readFile, writeFile, mkdir, rm, stat, readdir, utimes,
 * copyFile), boardAnswers(), keepers(), lockAgeMs(), recordFile, lacks() -> [text].
 */
export async function load(roots, options = {}, deps) {
  const { practice = false, dryRun = false, park = false, now = Date.now(), log = () => {}, journal = () => {} } = options
  const { git, set, pictures, fs } = deps
  const branch = branchFor(practice)
  const record = await readRecord(deps.recordFile, fs)
  const backupRoot = join(roots.boardDir, 'data', 'carry-backup')
  const warnings = []

  // ---- guards that need no data (--undo and --pictures-only pass them too)
  const facts = { boardAnswers: await deps.boardAnswers(), keepers: await deps.keepers(), lockAgeMs: await deps.lockAgeMs(), changed: [], fromPractice: false, practiceData: false, noLoadYet: options.picturesOnly === true && record.last === null }
  const early = loadGuards(facts, { park })
  if (early.refusals.length > 0) return refused(early, log)
  if (options.undo) return undo({ roots, stamp: options.undo, fs, log, journal, backupRoot })

  // ---- fetch
  const clone = await ensureDataClone({ git, dir: roots.dataDir, remote: roots.remote, branch, fs })
  const moved = clone.made === 'kept' ? await fastForward({ git, dir: roots.dataDir, branch }) : { before: null, after: clone.head }
  const savedText = await fs.readFile(join(roots.dataDir, 'saved.json'), 'utf8').catch(() => null)
  const saved = savedText === null ? null : JSON.parse(savedText)
  if (saved === null) { log(`Nothing to load: ${branch} holds no save yet`); return { ok: false, refusals: [{ code: 'empty', text: `${branch} holds no save yet`, who: 'the other PC' }], warnings } }
  facts.practiceData = saved.kind === 'practice' && !practice
  const targetsOf = { project: roots.project, boardDir: roots.boardDir, memoryDir: roots.memoryDir }

  // ---- --pictures-only: the pictures step again, after a full load (the record keeps the Drive folder given)
  if (options.picturesOnly) {
    const got = await fromDrive({ roots, pictures, fs, dryRun, log, journal })
    if (!dryRun && roots.picturesFolder !== null && roots.picturesFolder !== record.picturesHome) { await writeRecord(deps.recordFile, { ...record, picturesHome: roots.picturesFolder }, fs); journal(deps.recordFile) }
    log(`${dryRun ? 'Dry run' : 'Pictures'} ${clockOf(now)}: ${got.copied} pictures copied (${got.kept} kept, ${got.missing.length} missing)`)
    return { ok: true, refusals: [], warnings, pictures: got }
  }

  // ---- the set and what this PC changed since its last sync
  const paths = lines(await git(roots.dataDir, ['ls-files', '--', ...SET_ROOTS.map(root => root.replace(/\/$/, ''))])).map(slashes)
  const plan = []
  for (const to of paths) {
    const target = set.targetOf(to, targetsOf)
    if (target === null || target === undefined) continue
    const bytes = await fs.readFile(join(roots.dataDir, ...to.split('/')))
    const blob = blobOf(bytes)
    const here = await blobOfFile(target, fs)
    plan.push({ to, target, bytes, blob, here, same: here === blob })
  }
  const lastBlobs = record.last?.blobs ?? {}
  facts.changed = plan.filter(one => one.here !== null && !one.same && lastBlobs[one.to] !== undefined && lastBlobs[one.to] !== one.here).map(one => ({ path: one.to, target: one.target }))
  facts.fromPractice = record.last?.command === 'load' && record.last.kind === 'practice' && !practice
  const guarded = loadGuards(facts, { park })
  warnings.push(...guarded.warnings)
  if (guarded.refusals.length > 0) return refused(guarded, log, warnings)

  // ---- backup, outside the game repo
  const stamp = stampOf(now)
  const backupDir = join(backupRoot, stamp)
  const replaced = plan.filter(one => !one.same && one.here !== null)
  const manifest = []
  if (!dryRun && replaced.length > 0) {
    for (const one of replaced) {
      const kept = join(backupDir, ...one.to.split('/'))
      await fs.mkdir(dirname(kept), { recursive: true })
      await fs.writeFile(kept, await fs.readFile(one.target))
      manifest.push({ to: one.to, target: one.target })
    }
    const config = roots.config === null ? null : await fs.readFile(join(roots.boardDir, 'config.json'), 'utf8').catch(() => null)
    if (config !== null) { await fs.writeFile(join(backupDir, 'config.json'), config); manifest.push({ to: 'config.json', target: join(roots.boardDir, 'config.json') }) }
    await fs.writeFile(join(backupDir, 'backup.json'), JSON.stringify({ at: now, files: manifest }, null, 2) + '\n')
    journal(backupDir)
  }

  // ---- write the set's targets
  const written = []
  const blobs = {}
  for (const one of plan) {
    blobs[one.to] = one.blob
    if (one.same) continue
    if (!dryRun) {
      await fs.mkdir(dirname(one.target), { recursive: true })
      await fs.writeFile(one.target, one.bytes)
      journal(one.target)
    }
    written.push(one.to)
  }
  // ---- settings
  const carriedText = await fs.readFile(join(roots.dataDir, 'settings', 'config.json'), 'utf8').catch(() => null)
  if (carriedText !== null) {
    // A first load has no config.json here (roots.config null): nothing of this PC's to keep.
    const next = set.settingsFromCarry(JSON.parse(carriedText), { project: roots.project, boardDir: roots.boardDir, current: roots.config ?? {} })
    if (!dryRun) { await writeAtomic(join(roots.boardDir, 'config.json'), `${JSON.stringify(next, null, 2)}\n`); journal(join(roots.boardDir, 'config.json')) }
  }
  // ---- a practice load starts paused
  if (practice && !dryRun) {
    await fs.mkdir(roots.workDir, { recursive: true })
    await writeAtomic(join(roots.workDir, 'pause.json'), `${JSON.stringify({ state: 'pausing', since: now, by: 'carry load --practice' })}\n`)
    journal(join(roots.workDir, 'pause.json'))
  }
  // ---- times
  const times = parseTimes(await fs.readFile(join(roots.dataDir, 'times.json'), 'utf8').catch(() => ''))
  const timed = dryRun ? { restored: [], kept: [], missing: [] } : await restoreTimes(times, {
    targetOf: path => (path.startsWith('game/') ? join(roots.gameRepo || roots.project, ...path.slice('game/'.length).split('/')) : set.targetOf(path, targetsOf)),
    blobOfFile: file => blobOfFile(file, fs), fs, journal,
  })
  // ---- pictures
  const got = await fromDrive({ roots, pictures, fs, dryRun, log, journal })
  // ---- the user settings
  let added = []
  if (options.userSettings) {
    const carriedUser = await fs.readFile(join(roots.dataDir, 'settings', 'user.json'), 'utf8').then(text => JSON.parse(text)).catch(() => null)
    if (carriedUser !== null) {
      const theirsText = await fs.readFile(roots.userSettingsFile, 'utf8').catch(() => '{}')
      const theirs = JSON.parse(theirsText)
      const merged = set.mergeUserSettings(theirs, carriedUser)
      added = merged.added ?? []
      if (!dryRun && added.length > 0) {
        await fs.mkdir(backupDir, { recursive: true })
        await fs.writeFile(join(backupDir, 'user-settings.json'), theirsText)
        await writeAtomic(roots.userSettingsFile, `${JSON.stringify(merged.merged, null, 2)}\n`)
        journal(roots.userSettingsFile)
      }
    }
  }
  // ---- the record
  if (!dryRun) {
    await writeRecord(deps.recordFile, {
      picturesHome: roots.picturesFolder ?? record.picturesHome, keepSet: record.keepSet,
      synced: { ...record.synced, [branch]: moved.after },
      last: { kind: practice ? 'practice' : 'final', command: 'load', at: now, branch, commit: moved.after, blobs },
    }, fs)
    journal(deps.recordFile)
  }
  // ---- the summary
  const heldWords = await fs.readFile(join(roots.dataDir, 'held-words.json'), 'utf8').then(text => JSON.parse(text)).catch(() => [])
  const focus = focusOf(plan)
  log(`${dryRun ? 'Dry run' : 'Loaded'} ${clockOf(now)}: ${plan.length} items (${written.length} written, ${replaced.length} backed up${replaced.length > 0 && !dryRun ? ` under data/carry-backup/${stamp}` : ''}), focus ${focus ?? 'unknown'}, ${got.copied} pictures (${got.kept} kept, ${got.missing.length} missing), times: ${timed.restored.length} restored, ${timed.kept.length} kept`)
  for (const one of warnings) log(`Warning: ${one}`)
  for (const one of saved.boardSteps ?? []) log(`Board step ${one.id} (${one.state}): ${one.why}; still held for the board PC`)
  for (const one of heldWords) log(`Held word for ${one.chat}${one.step ? ` (${one.step})` : ''}, retype it: ${String(one.words).split('\n')[0].slice(0, 160)}`)
  for (const one of added) log(`User settings: added ${one}`)
  for (const one of await deps.lacks()) log(`This PC lacks: ${one}`)
  if (!await hasIdentity(git, roots.boardDir)) log('This PC lacks: a git identity (user.name and user.email)')
  return { ok: true, refusals: [], warnings, written, replaced: replaced.map(one => one.to), stamp: replaced.length > 0 && !dryRun ? stamp : null, timed, pictures: got, heldWords, boardSteps: saved.boardSteps ?? [], added, commit: moved.after, saved }
}

async function fromDrive({ roots, pictures, fs, dryRun, log, journal }) {
  if (roots.picturesFolder === null) { log('No Drive folder (--pictures): the pictures were not copied'); return { copied: 0, kept: 0, missing: [] } }
  const record = await fs.readFile(join(roots.dataDir, 'pictures.json'), 'utf8').then(text => JSON.parse(text)).catch(() => [])
  const got = await pictures.fromDrive({ record, project: roots.project, folder: roots.picturesFolder, name: roots.project.split(/[\\/]/).filter(Boolean).at(-1), dryRun, fs: nodeFs })
  for (const one of got.copiedPaths ?? []) journal(one)
  return { copied: got.copied ?? 0, kept: got.kept ?? 0, missing: got.missing ?? [] }
}

/** `--undo <stamp>`: the backup's files back where they were. */
async function undo({ roots, stamp, fs, log, journal, backupRoot }) {
  const dir = join(backupRoot, stamp)
  const manifest = await fs.readFile(join(dir, 'backup.json'), 'utf8').then(text => JSON.parse(text)).catch(() => null)
  if (manifest === null) { log(`No backup ${stamp} under ${backupRoot}`); return { ok: false, refusals: [{ code: 'no-backup', text: `no backup ${stamp}`, who: 'you' }], warnings: [] } }
  let restored = 0
  for (const one of manifest.files ?? []) {
    const kept = join(dir, ...one.to.split('/'))
    const bytes = await fs.readFile(kept).catch(() => null)
    if (bytes === null) continue
    await fs.mkdir(dirname(one.target), { recursive: true })
    await writeAtomic(one.target, bytes)
    journal(one.target)
    restored += 1
  }
  log(`Undone ${stamp}: ${restored} file(s) put back`)
  return { ok: true, refusals: [], warnings: [], restored }
}

const refused = (guarded, log, warnings = []) => {
  for (const one of guarded.refusals) log(`Refused: ${one.text}`)
  for (const one of [...warnings, ...guarded.warnings]) log(`Warning: ${one}`)
  return { ok: false, refusals: guarded.refusals, warnings: [...warnings, ...guarded.warnings] }
}

/** The focus goal: the goal map's `Focus:` line (home/.claude/goals.md, as src/goals.mjs reads it), else goals/focus.json's "focus"; null for neither. */
function focusOf(plan) {
  const goals = plan.find(one => one.to === 'home/.claude/goals.md')
  if (goals !== undefined) {
    for (const row of goals.bytes.toString('utf8').split(/\r?\n/)) {
      const found = FOCUS_LINE.exec(row)
      if (found) return found[1] ?? null
    }
  }
  const file = plan.find(one => one.to === 'home/.claude/goals/focus.json')
  const found = file === undefined ? null : /"focus"\s*:\s*"(G\d+)"/.exec(file.bytes.toString('utf8'))
  return found ? found[1] : null
}
