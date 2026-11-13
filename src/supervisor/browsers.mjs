// Leaked headless browsers (2026-11-13, the person's PC lagging): a headless Edge a tool started (a worker's scratch CDP
// helper on a fixed port, the board's evidence pictures, the game's shots) outlives a killed run and keeps rendering on
// the CPU: one from 07:42 the day before took 13 of 24 cores, three more had leaked that evening. The rule `browsers`
// (rules/repair.mjs) finds, from one listing of the PC's processes, every headless or remote-driven msedge.exe MAIN
// process (no `--type=`; the person's own Edge has neither flag and is never touched) whose starter process is gone and
// that has run for over LEAKED_AFTER_MS, closes its tree and removes its temporary profile, and shows one Cleaned row
// naming the profile's prefix (edge-cdp-b1126, board-evidence, lava-shot), so a tool that keeps leaking is visible. No
// AI, no tokens, no chat told. PURE but for `closeLeaked`'s kill and remove, given by the server (tests give their own).
//
// Why the delay: a board-evidence Edge (--disable-gpu, port 0) was seen with its starter already gone seconds after it
// started; ten minutes leaves every honest tool its time. Why the threads: a killed Edge main process lingers as a
// 1-thread zombie for a while (the game's browserTree.mjs `closeBrowser` counts the same), so only a process with more
// than one thread is alive. Why the starter: a process number Windows gave out again is no starter (a parent created
// after its child), as cpu.mjs `chosenProcesses` reads a tree.

import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'

const MIN = 60_000
/** A headless browser whose starter is gone counts as leaked once it has run this long. */
export const LEAKED_AFTER_MS = 10 * MIN
/** The Windows FILETIME epoch (1601-01-01) before the Unix one, in ms. */
const FILETIME_EPOCH_MS = 11_644_473_600_000
/** A `created` as the listing carries it (FILETIME, 100 ns since 1601) as Unix ms, or null. */
export const fileTimeMs = created => (Number.isFinite(created) ? created / 10_000 - FILETIME_EPOCH_MS : null)

/** A headless or remote-driven Edge main process (no `--type=`: not one of its children); the person's own Edge has neither flag. */
export function isHeadlessMain(one) {
  if (String(one?.name ?? '').toLowerCase() !== 'msedge.exe' || typeof one.commandLine !== 'string') return false
  return /--headless|--remote-debugging-port/i.test(one.commandLine) && !/--type=/.test(one.commandLine)
}

/** The profile folder a command line names (`--user-data-dir=`, quoted or not), or null. */
export function profileOf(commandLine) {
  const match = /"--user-data-dir=([^"]*)"|--user-data-dir=(?:"([^"]*)"|(\S*))/.exec(commandLine ?? '')
  const found = match === null ? null : (match[1] ?? match[2] ?? match[3])
  return found === null || found === undefined || found === '' ? null : found
}

/**
 * The prefix a profile's name was made with, the one the tool chose: its name up to the first part that is a number
 * (a process id) or a random tail (mkdtemp's six letters and digits: six or more characters with a digit or a capital in
 * them, "GYJKCI" too; a word like "evidence" is neither). "edge-cdp-b1126-k3Xp9q" is edge-cdp-b1126, "board-evidence-Ab12Cd"
 * board-evidence, "lava-shot-4321-Xy12ab" lava-shot; no profile is "no profile".
 */
export function prefixOf(profile) {
  if (profile === null) return 'no profile'
  const name = String(profile).replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const isTail = part => /^\d+$/.test(part) || (/^[A-Za-z0-9]{6,}$/.test(part) && (/\d/.test(part) || /[A-Z]/.test(part)))
  const kept = []
  for (const part of name.split('-')) {
    if (isTail(part)) break
    kept.push(part)
  }
  return kept.length === 0 ? name || 'no profile' : kept.join('-')
}

/** Whether `path` is inside the folder `temp` (the same spelling rules as the listing's: Windows is case-blind). */
export function isInTemp(path, temp = tmpdir(), platform = process.platform) {
  return tempRootOf(path, temp, platform) !== null
}

/**
 * The tool's own folder in the temp folder that holds `path`: the first folder below `temp` on the way to it (the profile
 * itself for `%TEMP%\edge-cdp-b1126-k3Xp9q`, `%TEMP%\board-evidence-f9NyC5` for the evidence tool's `...\profile` in it);
 * null for a path outside the temp folder. The one folder the board removes.
 */
export function tempRootOf(path, temp = tmpdir(), platform = process.platform) {
  if (typeof path !== 'string' || path === '') return null
  const plain = value => (platform === 'win32' ? resolve(value).toLowerCase() : resolve(value))
  const [inner, outer] = [plain(path), plain(temp)]
  const base = outer.endsWith(sep) ? outer : `${outer}${sep}`
  if (inner === outer || !inner.startsWith(base)) return null
  const first = inner.slice(base.length).split(sep)[0]
  return first === '' ? null : resolve(path).slice(0, base.length + first.length)
}

/** The processes below `pid` in `list`, parents before children; a child counts only when it started after its parent (a reused number leads nowhere). */
function treeBelow(list, pid) {
  const children = new Map()
  for (const one of list) {
    if (!children.has(one.parent)) children.set(one.parent, [])
    children.get(one.parent).push(one)
  }
  const out = []
  const seen = new Set([pid])
  const queue = [list.find(one => one.pid === pid)].filter(one => one !== undefined)
  while (queue.length > 0) {
    const parent = queue.shift()
    for (const child of children.get(parent.pid) ?? []) {
      if (seen.has(child.pid) || (fileTimeMs(child.created) ?? -Infinity) < (fileTimeMs(parent.created) ?? -Infinity)) continue
      seen.add(child.pid)
      out.push(child.pid)
      queue.push(child)
    }
  }
  return out
}

/**
 * The leaked headless browsers in one listing of the PC's processes (`{ pid, parent, name, commandLine, created, threads }`
 * each, cpu.mjs `parseListing`): every headless Edge main process with more than one thread, started over `afterMs` ago,
 * whose starter is gone (its parent not listed, or listed but created after it). Each `{ pid, profile, folder, prefix,
 * startedAt, children }`: its tree below it and the tool's folder in the temp folder that holds its profile (`tempRootOf`;
 * null outside it: the only folder removed).
 */
export function leakedBrowsers(list, { now, afterMs = LEAKED_AFTER_MS, temp = tmpdir(), platform = process.platform }) {
  const byPid = new Map(list.map(one => [one.pid, one]))
  const found = []
  for (const one of list) {
    if (!isHeadlessMain(one) || !(one.threads > 1)) continue
    const startedAt = fileTimeMs(one.created)
    if (startedAt === null || now - startedAt < afterMs) continue
    const parent = byPid.get(one.parent)
    if (parent !== undefined && parent.pid !== one.pid && (fileTimeMs(parent.created) ?? -Infinity) <= startedAt) continue
    const profile = profileOf(one.commandLine)
    // The folder to remove, and the prefix: the tool's folder in the temp folder (the evidence tool keeps its profile IN its folder).
    const folder = tempRootOf(profile, temp, platform)
    found.push({ pid: one.pid, profile, folder, prefix: prefixOf(folder ?? profile), startedAt, children: treeBelow(list, one.pid) })
  }
  return found
}

const pad = n => String(n).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const spanOf = ms => {
  const minutes = Math.max(1, Math.round(ms / MIN))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${pad(minutes % 60)}`
}

/** The row's words for a leaked browser: its prefix first, so a tool that keeps leaking is visible. */
export const leakedWords = (one, now) => `${one.prefix}: a headless Edge (process ${one.pid}, started ${clockOf(one.startedAt)}, ${spanOf(now - one.startedAt)}) with its starter gone`

/** `taskkill /F /T` on the processes: `{ ok, why }`; one already gone (128) is fine. */
export function taskkill(pids, { platform = process.platform } = {}) {
  if (pids.length === 0) return Promise.resolve({ ok: true, why: null })
  if (platform !== 'win32') return Promise.resolve({ ok: false, why: 'only on Windows' })
  return new Promise(done => {
    let said = ''
    const child = spawn('taskkill', ['/F', '/T', ...pids.flatMap(pid => ['/PID', String(pid)])], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => { said += chunk })
    child.stderr.on('data', chunk => { said += chunk })
    child.on('error', error => done({ ok: false, why: error.message }))
    child.on('exit', code => done(code === 0 || code === 128 ? { ok: true, why: null } : { ok: false, why: said.trim().split('\n').at(-1) || `taskkill ended with ${code}` }))
  })
}

/** The profile folder removed, with a few tries (Edge lets go of its files a moment after it ends): `{ ok, why }`. */
export async function removeProfile(profile) {
  try {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    return { ok: true, why: null }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Closes a leaked browser (`leakedBrowsers`' entry): its tree killed, then its folder in the temp folder removed (`folder`;
 * a profile anywhere else is kept: not the board's to remove). `{ ok, why, profile }`: `profile` says what became of it
 * ("removed", "kept (not in the temp folder)", "none", "left (<why>)"); not ok when the kill failed.
 */
export async function closeLeaked(one, { kill = taskkill, remove = removeProfile } = {}) {
  const killed = await kill([one.pid, ...(one.children ?? [])])
  if (killed.ok !== true) return { ok: false, why: killed.why ?? 'the kill failed', profile: null }
  if (one.profile === null || one.profile === undefined) return { ok: true, why: null, profile: 'none' }
  if (typeof one.folder !== 'string' || one.folder === '') return { ok: true, why: null, profile: 'kept (not in the temp folder)' }
  const removed = await remove(one.folder)
  return { ok: true, why: null, profile: removed.ok ? 'removed' : `left (${removed.why})` }
}
