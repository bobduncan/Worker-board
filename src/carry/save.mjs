// T5 B1: `save`, in the brief's order: guards, copy, pictures, times, held words, board steps, commit and push, branches, record,
// print. Every root and every outside call comes in through `roots` and `deps`, so the two-PC test runs it on temp folders with a
// local bare remote and fakes for the board checks; nothing here reads boards.json or another checkout by itself.

import * as nodeFs from 'node:fs'
import { join, basename, dirname, relative, resolve } from 'node:path'
import { hostname } from 'node:os'

import { readStore } from '../work/store.mjs'
import { assetsOf, dataOf, picturesOf } from '../projectPaths.mjs'
import { parsePause, checkpointOf } from '../work/pause.mjs'
import { valueOf } from '../work/item.mjs'
import { aheadOf, blobOf, commitAndPush, ensureDataClone, isAnonymouslyReadable, lines, localBranches, peekDataClone, pushBranch, pushIsFastForward, remoteBranch, trackedChanges, commitsNotOnOrigin } from './git.mjs'
import { boardStepsOf, heldStepsOf, heldWordsOf, reviewStepsOf, saveGuards, secretsIn, TEXT_MOST_BYTES } from './guards.mjs'
import { timesOf } from './times.mjs'
import { readRecord, writeRecord } from './record.mjs'

export const DATA_BRANCH = 'workerboard-data'
export const PRACTICE_BRANCH = 'workerboard-practice'
export const branchFor = practice => (practice ? PRACTICE_BRANCH : DATA_BRANCH)
export const messageFor = practice => (practice ? 'Board data: practice save' : 'Board data: save')
/** The data folder's places that travel under git and are pruned to the set. */
const SET_ROOTS = ['home/', 'data/', 'board/', 'memory/']

/** T5.2 A8: the folder the picture roots stand in (the table's picturesOf once `data` is set; the project today). */
const picturesBaseOf = roots => (roots.config && dataOf(roots.config) !== null ? picturesOf(roots.config) : roots.project)
const samePath = (a, b) => resolve(String(a)).replace(/[\\/]+$/, '').toLowerCase() === resolve(String(b)).replace(/[\\/]+$/, '').toLowerCase()

const slashes = path => String(path).replace(/\\/g, '/')
const two = n => String(n).padStart(2, '0')
export const clockOf = ms => `${two(new Date(ms).getHours())}:${two(new Date(ms).getMinutes())}`

/**
 * One save. `roots`: boardDir (the board folder the command runs in: its repo), project, config, gameRepo, workDir, dataDir,
 * isExplicitData, remote, picturesFolder, keepSetFile, memoryDir, userSettingsFile. `options`: practice, dryRun, noBranches, anyway,
 * journal(path), log(line), now. `deps`: git (the runner), set (B2's module), pictures (B3's module), fs (readFile, writeFile, mkdir,
 * rm, stat, readdir), boardAnswers(), keepers(), lockAgeMs(), secrets() -> [{ kind, value }], driveFree(folder) -> bytes or null,
 * recordFile. Answers the report `{ ok, refusals, warnings, ... }`; writes nothing when refused or dry.
 */
export async function save(roots, options = {}, deps) {
  const { practice = false, dryRun = false, anyway = [], now = Date.now(), log = () => {}, journal = () => {} } = options
  const noBranches = options.noBranches === true || practice
  const { git, set, pictures, fs } = deps
  const branch = branchFor(practice)
  const warnings = []
  // T5.2 A8, the moved layout (the data home IS the data folder, the design's <game>/.workerboard): copying it onto itself is no save.
  // Round C makes the save a commit of that folder; until then it is refused in one line.
  if (typeof roots.dataHome === 'string' && roots.dataHome !== '' && samePath(roots.dataHome, roots.dataDir)) {
    const text = 'the data lives in the data folder already: saving is a commit (Round C), not a copy'
    log(`Refused: ${text}`)
    return { ok: false, refusals: [{ code: 'in-place', text, who: 'Round C' }], warnings, dryRun }
  }
  const record = await readRecord(deps.recordFile, fs)

  // ---- what is here
  // A read of its own (a fresh fs object): readStore shares a listing taken within 1.5 s with no board write between, and the board is off here.
  const store = await readStore(roots.workDir, { readdir: fs.readdir, stat: fs.stat, readFile: fs.readFile })
  const items = store.items
  const pauseText = await fs.readFile(join(roots.workDir, 'pause.json'), 'utf8').catch(() => null)
  const pause = parsePause(pauseText)
  const held = heldStepsOf(items)
  const boardBranches = (await localBranches(git, roots.boardDir)).map(one => one.branch)

  // ---- the data clone (made now, written later). A dry run makes and switches nothing: it looks. Origin is asked by its URL.
  const clone = dryRun ? await peekDataClone({ git, dir: roots.dataDir, branch, fs }) : await ensureDataClone({ git, dir: roots.dataDir, remote: roots.remote, branch, fs })
  const originHead = await remoteBranch(git, roots.boardDir, roots.remote, branch)
  // What this PC last synced on this branch (null: never): origin past it means load first.
  const lastHere = record.synced[branch] ?? null
  const originAhead = originHead !== null && lastHere !== originHead ? { branch, origin: originHead, last: lastHere } : null

  // ---- the files that travel
  const carried = await set.carrySet({ config: roots.config, project: roots.project, boardDir: roots.boardDir, memoryDir: roots.memoryDir, chatHome: roots.chatHome ?? null, dataHome: roots.dataHome ?? null, userSettingsFile: roots.userSettingsFile, fs })
  const files = []
  const oversized = []
  for (const one of carried.files) {
    const bytes = await fs.readFile(one.from)
    if (bytes.length > TEXT_MOST_BYTES) oversized.push({ path: one.to, bytes: bytes.length })
    files.push({ ...one, to: slashes(one.to), bytes, blob: blobOf(bytes), text: isText(bytes) ? bytes.toString('utf8') : null })
  }
  for (const skipped of carried.skipped ?? []) warnings.push(`${skipped.path}: ${skipped.why}`)

  // ---- the guards' facts
  const dirtySteps = []
  const branchesGone = []
  const noWorktree = []
  for (const step of held) {
    if (step.branch === null || step.branch === 'none') continue
    const worktree = await worktreeOf(git, [roots.gameRepo, roots.boardDir], step.branch)
    if (worktree === null) { noWorktree.push({ id: step.id, chat: step.chat, branch: step.branch }); warnings.push(`${step.id}: its branch ${step.branch} is checked out in no worktree here: uncommitted work there cannot be checked`); continue }
    const changed = await trackedChanges(git, worktree).catch(() => [])
    if (changed.length > 0) dirtySteps.push({ id: step.id, chat: step.chat, folder: worktree, files: changed })
  }
  const pushes = noBranches ? [] : await branchPushes({ git, roots, items, boardBranches, warnings })
  const notFastForward = pushes.filter(one => !one.fastForward).map(one => ({ branch: one.branch, repo: basename(one.repo) }))
  const mainsDirty = []
  for (const repo of [roots.gameRepo, roots.boardDir]) {
    const files = await trackedChanges(git, repo).catch(() => [])
    const { count } = await commitsNotOnOrigin(git, repo)
    if (files.length > 0 || count > 0) mainsDirty.push({ repo: basename(repo), files, ahead: count })
  }
  // The rehearsal of 2026-11-17: config.json's OWN JSON travels, never the parsed config (its defaults, routing and weekStopAt among
  // them, landed as values on the other PC). The two folder paths are the parsed ones (%ENV% filled) for B2 to write relative.
  const configText = await fs.readFile(join(roots.boardDir, 'config.json'), 'utf8').catch(() => null)
  const configRaw = configText === null ? null : JSON.parse(configText)
  const ownConfig = configRaw === null ? roots.config : { ...configRaw, ...(typeof configRaw.project === 'string' ? { project: roots.config.project } : {}), ...(typeof configRaw.gameRepo === 'string' ? { gameRepo: roots.config.gameRepo } : {}) }
  const settings = { 'settings/config.json': JSON.stringify(set.carriedSettings(ownConfig, { project: roots.project, boardDir: roots.boardDir }), null, 2) + '\n' }
  const userSettings = await fs.readFile(roots.userSettingsFile, 'utf8').then(text => JSON.parse(text)).catch(() => ({}))
  settings['settings/user.json'] = JSON.stringify(set.carriedUserSettings(userSettings), null, 2) + '\n'
  // T5.2 A8: the project's settings file (P4's board-settings.json, only with `data` set) travels without its PC keys; load puts it where
  // the other PC's `data` says. Without it, config.json's own keys are the project's, as before. The file is named by the roots (config.json's
  // own `data`, review 2), else by the parsed config.
  const projectSettingsFile = roots.projectSettingsFile ?? set.projectSettingsFileOf?.(roots.config) ?? null
  const projectSettingsText = projectSettingsFile === null ? null : await fs.readFile(projectSettingsFile, 'utf8').catch(() => null)
  const projectSettings = projectSettingsText === null ? null : set.carriedProjectSettings?.(projectSettingsText) ?? null
  if (projectSettings !== null) settings['settings/board-settings.json'] = projectSettings
  // Review 3: the settings texts are scanned for secrets with the files.
  const secrets = await deps.secrets()
  const facts = {
    pause, boardAnswers: await deps.boardAnswers(), keepers: await deps.keepers(), lockAgeMs: await deps.lockAgeMs(),
    dirtySteps, notFastForward, mainsDirty, originAhead, lastLoadWasPractice: record.last?.command === 'load' && record.last.kind === 'practice',
    secrets: secretsIn([...files, ...Object.entries(settings).map(([to, text]) => ({ to, text }))], secrets),
    oversized, remotePublic: await isAnonymouslyReadable(git, roots.boardDir, roots.remote), driveShort: null,
    reviewSteps: reviewStepsOf(items),
    noCheckpointSince: held.filter(step => pause?.state === 'pausing' && !(Number.isFinite(checkpointOf(items.get(step.id))?.at) && checkpointOf(items.get(step.id)).at >= pause.since)).map(step => ({ id: step.id, chat: step.chat })),
    branchesGone,
  }
  // ---- pictures: the list first (its bytes decide the Drive check)
  const keepSet = roots.keepSetFile === null ? null : await fs.readFile(roots.keepSetFile, 'utf8').then(text => JSON.parse(text)).catch(() => null)
  const since = Number.isFinite(keepSet?.made) ? keepSet.made : Number.isFinite(Date.parse(keepSet?.made)) ? Date.parse(keepSet.made) : 0
  const changedTexts = files.filter(one => one.text !== null && one.mtimeMs >= since).map(one => one.text)
  // The picture roots and the asset folder (B3 reads both), relative to the folder they stand in (T5.2 A8: picturesOf; the project today).
  const picturesBase = picturesBaseOf(roots)
  const pictureRoots = [...(roots.config.pictureRoots ?? []), slashes(relative(picturesBase, assetsOf(roots.config)))].filter(root => root !== '' && !root.startsWith('..'))
  // B3 takes the node:fs module (streams, statfs); no keep set means no pictures, said.
  const pictureFs = deps.pictureFs ?? nodeFs
  if (roots.picturesFolder !== null && roots.keepSetFile === null) warnings.push('no keep set (--keep-set <file>): no picture listed; the pictures did not travel')
  const list = roots.picturesFolder === null || roots.keepSetFile === null ? [] : await pictures.pictureList({ keepSetFile: roots.keepSetFile, project: picturesBase, roots: pictureRoots, since, changedTexts, fs: pictureFs })
  for (const path of list.missing ?? []) warnings.push(`picture ${path}: listed but gone`)
  for (const one of list.skipped ?? []) warnings.push(`picture ${one.path}: ${one.why}`)
  const need = list.reduce((sum, one) => sum + (one.size ?? 0), 0)
  const free = roots.picturesFolder === null ? null : await deps.driveFree(roots.picturesFolder)
  if (Number.isFinite(free) && free < need) facts.driveShort = { need, free }

  // ---- the lists the switch needs (printed on a refusal too: the dry run at step 4 runs with the chats still open)
  const heldWords = heldWordsOf(await fs.readFile(join(roots.boardDir, 'data', 'outbox.jsonl'), 'utf8').catch(() => ''))
  const boardSteps = boardStepsOf(items, boardBranches)
  const toPush = pushes.filter(one => one.fastForward && one.rule !== 'already there')
  const tell = () => {
    for (const one of warnings) log(`Warning: ${one}`)
    if (dryRun) for (const one of toPush) log(`Would push ${one.branch} (${basename(one.repo)}): ${one.rule}${one.step ? `, step ${one.step}` : ''}`)
    for (const one of heldWords) log(`Held word for ${one.chat}${one.step ? ` (${one.step})` : ''}, retype it there: ${one.words.split('\n')[0].slice(0, 160)}`)
    for (const one of boardSteps) log(`Board step ${one.id} (${one.state}, ${one.branch}): ${one.why}; it cannot land on the other PC`)
    for (const one of noWorktree) log(`Held step ${one.id} (${one.chat}): its branch ${one.branch} is in no worktree here; its uncommitted work, if any, stays on this PC`)
  }

  const guarded = saveGuards(facts, { practice, anyway, dryRun })
  warnings.push(...guarded.warnings)
  if (guarded.refusals.length > 0) {
    for (const one of guarded.refusals) log(`Refused: ${one.text}`)
    tell()
    return { ok: false, refusals: guarded.refusals, warnings, dryRun, heldWords, boardSteps }
  }

  // ---- copy into the data folder, prune what left the set
  const written = []
  const keptBlobs = {}
  for (const one of files) {
    const target = join(roots.dataDir, ...one.to.split('/'))
    const there = await fs.readFile(target).catch(() => null)
    keptBlobs[one.to] = one.blob
    if (there !== null && blobOf(there) === one.blob) continue
    if (!dryRun) {
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.writeFile(target, one.bytes)
      journal(target)
    }
    written.push(one.to)
  }
  // A dry run on a folder not on this branch (none yet, or the other kind's) counts nothing as gone, and says so.
  const dataOnBranch = !dryRun || clone.onBranch === true
  if (!dataOnBranch) warnings.push(`the data folder ${clone.exists ? 'is on the other kind\'s branch' : 'does not exist yet'}: what left the set is not counted in this dry run`)
  const tracked = dataOnBranch ? lines(await git(roots.dataDir, ['ls-files', '--', ...SET_ROOTS.map(root => root.replace(/\/$/, ''))])).map(slashes) : []
  const inSet = new Set(files.map(one => one.to))
  const removed = tracked.filter(path => !inSet.has(path))
  if (!dryRun) for (const path of removed) { await fs.rm(join(roots.dataDir, ...path.split('/')), { force: true }); journal(join(roots.dataDir, ...path.split('/'))) }
  // (The settings texts stand above, before the secret scan.)

  // ---- pictures to the Drive folder
  const copied = roots.picturesFolder === null ? { copied: 0, same: 0, missing: [], bytes: 0, record: [] }
    : await pictures.toDrive({ list, project: picturesBase, folder: roots.picturesFolder, name: basename(roots.project), dryRun, fs: pictureFs })
  if (roots.picturesFolder === null) warnings.push('no Drive folder (--pictures): the pictures did not travel')

  // ---- times, held words, board steps, the save's own record
  // The two plan docs live where the board reads them (sources.mjs: the game repo, or the project without one), as `game/<rel>`.
  const plans = []
  const planHome = roots.gameRepo || roots.project
  for (const key of ['gamePlan', 'productPlan']) {
    const rel = roots.config[key]
    if (typeof rel !== 'string' || rel === '') continue
    const file = join(planHome, ...rel.split('/'))
    const bytes = await fs.readFile(file).catch(() => null)
    const stat = await fs.stat(file).catch(() => null)
    if (bytes !== null && stat !== null) plans.push({ to: `game/${slashes(rel)}`, mtimeMs: stat.mtimeMs, blob: blobOf(bytes) })
  }
  const times = timesOf([...files, ...plans])
  const mains = {}
  for (const [name, repo] of [['game', roots.gameRepo], ['board', roots.boardDir]]) mains[name] = (await git(repo, ['rev-parse', 'HEAD'])).out.trim() || null
  const saved = {
    pc: hostname(), at: now, kind: practice ? 'practice' : 'final', branch, mains, counts: { files: files.length, written: written.length, removed: removed.length, pictures: list.length },
    branchesPushed: toPush.map(one => ({ branch: one.branch, repo: basename(one.repo), step: one.step, commit: one.commit })), boardSteps, heldWords: heldWords.length, noWorktree,
  }
  const own = {
    'saved.json': JSON.stringify(saved, null, 2) + '\n', 'times.json': JSON.stringify({ files: times }, null, 2) + '\n',
    'held-words.json': JSON.stringify(heldWords, null, 2) + '\n', 'pictures.json': JSON.stringify(copied.record ?? [], null, 2) + '\n', ...settings,
  }
  if (!dryRun) {
    for (const [path, text] of Object.entries(own)) {
      const target = join(roots.dataDir, ...path.split('/'))
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.writeFile(target, text)
      journal(target)
    }
  }

  // ---- commit and push the data branch, once
  const paths = [...files.map(one => one.to), ...Object.keys(own)]
  const bytes = files.reduce((sum, one) => sum + one.bytes.length, 0)
  const pushed = dryRun ? { committed: false, pushed: false, commit: clone.head, staged: [...written, ...Object.keys(own)], dryRun: true }
    : await commitAndPush({ git, dir: roots.dataDir, branch, paths, removed, message: messageFor(practice), bytes })

  // ---- the step branches (final only)
  const branchesPushed = []
  for (const one of toPush) {
    if (dryRun) continue
    const commit = await pushBranch(git, one.repo, one.branch)
    branchesPushed.push({ ...one, commit })
    log(`Pushed ${one.branch} (${basename(one.repo)}): ${one.rule}${one.step ? `, step ${one.step}` : ''}`)
  }
  for (const one of pushes.filter(one => one.rule === 'already there')) log(`${one.branch} (${basename(one.repo)}): already on origin at this commit`)

  // ---- the record
  if (!dryRun) {
    await writeRecord(deps.recordFile, {
      picturesHome: roots.picturesFolder ?? record.picturesHome, keepSet: roots.keepSetFile ?? record.keepSet,
      synced: { ...record.synced, ...(pushed.commit ? { [branch]: pushed.commit } : {}) },
      last: { kind: practice ? 'practice' : 'final', command: 'save', at: now, branch, commit: pushed.commit, blobs: keptBlobs },
    }, fs)
    journal(deps.recordFile)
  }
  log(`${dryRun ? 'Dry run' : 'Saved'} ${clockOf(now)}: ${files.length} files (${written.length} new or changed, ${removed.length} gone), ${list.length} pictures (${copied.copied} copied, ${copied.same} the same, ${copied.missing?.length ?? 0} missing), ${heldWords.length} held words, ${boardSteps.length} board steps${pushed.pushed ? `, data at ${String(pushed.commit).slice(0, 7)}` : pushed.committed === false && !dryRun ? ', nothing new to commit' : ''}`)
  tell()
  return { ok: true, refusals: [], warnings, files: files.length, written, removed, pictures: copied, heldWords, boardSteps, branchesPushed, pushes, commit: pushed.commit, dryRun, saved }
}

/**
 * The step branches to push, by the rules: in the game repo every local branch with commits not on origin/main that origin does not
 * hold at that commit; in the board repo the branches of open board steps. `[{ repo, branch, commit, step, rule, fastForward }]`.
 */
export async function branchPushes({ git, roots, items, boardBranches, warnings = [] }) {
  const out = []
  const stepOf = branch => [...items.values()].find(item => valueOf(item, 'Kind') === 'step' && valueOf(item, 'Branch') === branch)
  const open = item => item !== undefined && !['done', 'dropped'].includes(valueOf(item, 'State'))
  for (const one of await localBranches(git, roots.gameRepo)) {
    if (['main', 'master'].includes(one.branch)) continue
    const ahead = await aheadOf(git, roots.gameRepo, one.branch, 'origin/main')
    const item = stepOf(one.branch)
    if (ahead === 0) { if (open(item)) warnings.push(`${valueOf(item, 'Id')}: its branch ${one.branch} has no commit beyond origin/main (merged, or not begun); nothing to push`); continue }
    if (one.upstream === one.commit) { out.push({ repo: roots.gameRepo, branch: one.branch, commit: one.commit, step: item ? valueOf(item, 'Id') : null, rule: 'already there', fastForward: true }); continue }
    const fastForward = await pushIsFastForward(git, roots.gameRepo, one.branch, one.upstream)
    out.push({ repo: roots.gameRepo, branch: one.branch, commit: one.commit, step: item ? valueOf(item, 'Id') : null, rule: `${ahead} commit(s) not on origin/main${one.upstream === null ? ', not on origin' : ', origin behind'}`, fastForward })
  }
  // The board repo's origin (public, board code only); a board checkout without one pushes no board-step branch, with a warning.
  const boardOrigin = (await git(roots.boardDir, ['remote', 'get-url', 'origin'])).code === 0
  for (const item of items.values()) {
    if (valueOf(item, 'Kind') !== 'step' || !open(item)) continue
    const branch = valueOf(item, 'Branch')
    if (branch === null || branch === 'none' || !boardBranches.includes(branch)) continue
    if (!boardOrigin) { warnings.push(`${valueOf(item, 'Id')}: its branch ${branch} is the board repository's, which has no origin here; not pushed`); continue }
    const local = (await localBranches(git, roots.boardDir)).find(one => one.branch === branch)
    if (local === undefined) continue
    if (local.upstream === local.commit) { out.push({ repo: roots.boardDir, branch, commit: local.commit, step: valueOf(item, 'Id'), rule: 'already there', fastForward: true }); continue }
    const fastForward = await pushIsFastForward(git, roots.boardDir, branch, local.upstream)
    out.push({ repo: roots.boardDir, branch, commit: local.commit, step: valueOf(item, 'Id'), rule: 'a board step\'s branch', fastForward })
  }
  return out
}

/** The worktree of `repos` that is on `branch`, or null (`git worktree list --porcelain`). */
async function worktreeOf(git, repos, branch) {
  for (const repo of repos) {
    const listed = await git(repo, ['worktree', 'list', '--porcelain'])
    if (listed.code !== 0) continue
    let folder = null
    for (const row of String(listed.out).split(/\r?\n/)) {
      if (row.startsWith('worktree ')) folder = row.slice('worktree '.length)
      else if (row === `branch refs/heads/${branch}` && folder !== null) return folder
    }
  }
  return null
}

const isText = bytes => !bytes.subarray(0, 8000).includes(0)


