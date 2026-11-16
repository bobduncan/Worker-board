// T5 B3 (chat 1's brief of 2026-11-16, .claude/plans/2026-11-16-t5-brief-chat4.md): the pictures the board points at travel to another PC
// through a cloud folder the person syncs (Google Drive today), not through git. `npm.cmd run save` copies the keep set (the pictures in use,
// a file the save is given) and every picture made since into `<folder>/<name>/<path>`; `npm.cmd run load` copies them back. Nothing here
// deletes, nothing overwrites a newer local file, every copy goes through streams into a temp name and is renamed into place with its
// source's time. "The same file" is an equal size and times within SAME_MS: Drive keeps whole milliseconds, NTFS keeps more.
//
// No names live here: the folder, the name (config.name) and the roots come from the caller (src/carry/save.mjs, load.mjs).

import * as nodeFs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join, relative, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'

/** Two times this close are one time: Drive rounds to whole milliseconds and may shift by a sync. */
export const SAME_MS = 2000
/** A file over this is no picture to carry: left out and named. */
export const MAX_BYTES = 50 * 1024 * 1024
/** Text records travel in git (B2), never as pictures. */
const TEXT = /\.(json|txt|md)$/i
/** The picture files a path in a text may name. */
const PICTURE_PATH = /[\w.-]+(?:\/[\w.@-]+)*\.(?:png|jpe?g|gif|webp|svg|bmp|mp4|webm|wav|mp3|ogg)\b/gi

const slash = path => path.split(sep).join('/').replace(/\\/g, '/')
const timeOf = value => (Number.isFinite(value) ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN)
/** Whether two stats are the same file: an equal size and times within SAME_MS. */
export const isSame = (a, b) => a !== null && b !== null && a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) <= SAME_MS

async function statOf(fs, path) {
  try {
    const stat = await fs.promises.stat(path)
    return stat.isFile() ? stat : null
  } catch {
    return null
  }
}

/** Every file under `dir` (absolute), relative to `project`, with forward slashes. */
async function filesUnder(fs, project, dir) {
  const out = []
  let entries = []
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await filesUnder(fs, project, path))
    else if (entry.isFile()) out.push(slash(relative(project, path)))
  }
  return out
}

/**
 * The pictures to carry, `[{ path, size, mtimeMs }]` with paths relative to `project`: the keep set (`keepSetFile`: `{ made, items: [{ path }] }`)
 * plus every file under the `roots` (paths relative to the project: the picture roots and the asset folder) changed after `since` (ms or
 * ISO; the keep set's `made` when none) and every picture path a changed text names (`changedTexts`, the texts) under a root. Text records
 * are left out (git carries them); a file over MAX_BYTES is left out and named in the list's `skipped`; a listed file that is gone is in
 * its `missing`. Each path once.
 */
export async function pictureList({ keepSetFile, project, roots = [], since = null, changedTexts = [], fs = nodeFs }) {
  const keep = JSON.parse(await fs.promises.readFile(keepSetFile, 'utf8'))
  const from = timeOf(since ?? keep.made)
  const under = roots.map(root => slash(root).replace(/\/+$/, '') + '/')
  const inRoots = path => under.some(root => path.startsWith(root))
  const wanted = new Set((keep.items ?? []).map(item => slash(String(item.path))))
  for (const root of roots) {
    for (const path of await filesUnder(fs, project, join(project, root))) {
      const stat = await statOf(fs, join(project, path))
      if (stat !== null && Number.isFinite(from) && stat.mtimeMs > from) wanted.add(path)
    }
  }
  for (const text of changedTexts ?? []) {
    for (const hit of String(text).matchAll(PICTURE_PATH)) {
      const path = slash(hit[0])
      if (inRoots(path) && (await statOf(fs, join(project, path))) !== null) wanted.add(path)
    }
  }
  const list = []
  const skipped = []
  const missing = []
  for (const path of [...wanted].sort()) {
    if (TEXT.test(path)) continue
    const stat = await statOf(fs, join(project, path))
    if (stat === null) missing.push(path)
    else if (stat.size > MAX_BYTES) skipped.push({ path, why: `over ${MAX_BYTES / 1024 / 1024} MB` })
    else list.push({ path, size: stat.size, mtimeMs: stat.mtimeMs })
  }
  return Object.assign(list, { skipped, missing })
}

/** Copies `from` to `to` through streams into a temp name beside it, renames it into place and gives it `mtimeMs`. */
async function copyOne(fs, from, to, mtimeMs) {
  await fs.promises.mkdir(dirname(to), { recursive: true })
  const temp = `${to}.carry-${randomBytes(4).toString('hex')}.tmp`
  try {
    await pipeline(fs.createReadStream(from), fs.createWriteStream(temp))
    const when = new Date(mtimeMs)
    await fs.promises.utimes(temp, when, when)
    await fs.promises.rename(temp, to)
  } catch (error) {
    await fs.promises.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

/** The free bytes of the nearest folder of `path` that exists. */
async function freeOf(fs, path) {
  for (let dir = path; ; dir = dirname(dir)) {
    try {
      const stat = await fs.promises.statfs(dir)
      return stat.bavail * stat.bsize
    } catch {
      if (dirname(dir) === dir) return null
    }
  }
}

/**
 * Save: each listed file to `<folder>/<name>/<path>`. The same file there: left as it is; else copied (not with `dryRun`, which counts).
 * Never deletes in the folder. `{ copied, same, missing, bytes, free, record }`: `bytes` what is (or would be) copied, `free` the folder's
 * free bytes (the caller refuses when bytes > free), `record` `[{ path, size, mtimeMs }]` of every listed file now in the folder (the
 * caller writes it as pictures.json).
 */
export async function toDrive({ list, project, folder, name, dryRun = false, fs = nodeFs }) {
  const home = join(folder, name)
  const out = { copied: 0, same: 0, missing: [], bytes: 0, free: await freeOf(fs, home), record: [] }
  for (const item of list ?? []) {
    const from = join(project, item.path)
    const source = await statOf(fs, from)
    if (source === null) {
      out.missing.push(item.path)
      continue
    }
    const to = join(home, item.path)
    const entry = { path: item.path, size: source.size, mtimeMs: source.mtimeMs }
    if (isSame(source, await statOf(fs, to))) {
      out.same += 1
      out.record.push(entry)
      continue
    }
    out.bytes += source.size
    if (dryRun) continue
    await copyOne(fs, from, to, source.mtimeMs)
    out.copied += 1
    out.record.push(entry)
  }
  return out
}

/**
 * Load: for each entry of the record (pictures.json), the local `<project>/<path>`: missing, or older than the record by more than SAME_MS
 * with another size, is copied from `<folder>/<name>/<path>` and given the record's time; a local file that is the same, newer, or of the
 * same size is kept (never overwritten); one the folder does not hold yet (still syncing down) is in `missing`. `{ copied, kept, missing }`.
 */
export async function fromDrive({ record, project, folder, name, dryRun = false, fs = nodeFs }) {
  const home = join(folder, name)
  const out = { copied: 0, kept: 0, missing: [] }
  for (const entry of record ?? []) {
    const from = join(home, entry.path)
    const to = join(project, entry.path)
    const local = await statOf(fs, to)
    const isOlder = local !== null && entry.mtimeMs - local.mtimeMs > SAME_MS && local.size !== entry.size
    if (local !== null && !isOlder) {
      out.kept += 1
      continue
    }
    if ((await statOf(fs, from)) === null) {
      out.missing.push(entry.path)
      continue
    }
    if (dryRun) continue
    await copyOne(fs, from, to, entry.mtimeMs)
    out.copied += 1
  }
  return out
}

/** The cloud folders this PC has, `[{ kind, path }]`: Google Drive (`<letter>:\My Drive`), OneDrive, Dropbox. */
export function cloudFolders({ env = process.env, fs = nodeFs } = {}) {
  const out = []
  const exists = path => {
    try {
      return fs.statSync(path).isDirectory()
    } catch {
      return false
    }
  }
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const path = `${letter}:\\My Drive`
    if (exists(path)) out.push({ kind: 'Google Drive', path })
  }
  for (const key of ['OneDrive', 'OneDriveConsumer']) {
    const path = env?.[key]
    if (typeof path === 'string' && path !== '' && exists(path) && !out.some(one => one.path === path)) out.push({ kind: 'OneDrive', path })
  }
  if (typeof env?.USERPROFILE === 'string' && exists(join(env.USERPROFILE, 'Dropbox'))) out.push({ kind: 'Dropbox', path: join(env.USERPROFILE, 'Dropbox') })
  return out
}
