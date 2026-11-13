// Leaked headless browsers (2026-11-13, the person's PC lagging): a headless Edge a tool started (a worker's scratch CDP
// helper on a fixed port, the board's evidence pictures, the game's shots) outlives a killed run and keeps rendering on
// the CPU: one from 07:42 the day before took 13 of 24 cores, three more had leaked that evening. The rule `browsers`
// (rules/repair.mjs) finds, from one listing of the PC's processes, every headless or remote-driven msedge.exe MAIN
// process (no `--type=`; the person's own Edge has neither flag and is never touched) whose profile stands in the temp
// folder, whose starter process is gone, and that has run over LEAKED_AFTER_MS or used over BUSY_CORES cores for BUSY_MS
// in a row (chat 1's guard 2: a worker may detach a CDP helper on purpose and keep using it; the leak closes fast, a
// quiet helper only after half an hour). The board closes its tree once, removes the tool's folder in the temp folder,
// and shows one Cleaned row naming the profile's prefix (edge-cdp-b1126, board-evidence, lava-shot) and the CPU it used,
// so a tool that keeps leaking is visible (the watch rule browser-leaks files an incident at three a day). No AI, no
// tokens, no chat told. PURE but for `closeLeaked`'s kill and remove, given by the server (tests give their own).
//
// Why the threads: a killed Edge main process lingers as a 1-thread zombie for a while (the game's browserTree.mjs
// `closeBrowser` counts the same), so only a process with more than one thread is alive. Why the starter: a process
// number Windows gave out again is no starter (a parent created after its child), as cpu.mjs `chosenProcesses` reads a
// tree. Why the temp folder only (guard 1): a profile anywhere else is somebody's own.

import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'

const MIN = 60_000
/** A headless browser whose starter is gone counts as leaked once it has run this long. */
export const LEAKED_AFTER_MS = 30 * MIN
/** Sooner: one that used over this many cores ... */
export const BUSY_CORES = 2
/** ... for this long in a row (the loop samples every SYNC_EVERY_MS; the samples that span it must all be over). */
export const BUSY_MS = 5 * MIN
/** The samples kept per browser. */
const SAMPLES_KEPT = 12
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

/** A browser's key across listings: its number and its start (a number given out again is another process). */
export const browserKey = one => `${one.pid}:${one.created ?? ''}`

/** The memory the loop keeps between runs: the CPU samples per browser, and when each was closed. */
export const browserMemory = () => ({ samples: new Map(), closed: new Map() })

/**
 * Whether the samples (`{ at, cpuMs }`, oldest first) show over `cores` cores for `spanMs` in a row: a run of the newest
 * samples spanning `spanMs` or more whose every step is over.
 */
export function isBusy(samples, { cores, spanMs }) {
  let span = 0
  for (let i = samples.length - 1; i > 0; i--) {
    const [before, after] = [samples[i - 1], samples[i]]
    const wall = after.at - before.at
    if (wall <= 0 || (after.cpuMs - before.cpuMs) / wall < cores) return false
    span += wall
    if (span >= spanMs) return true
  }
  return false
}

const pad = n => String(n).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const spanOf = ms => {
  const minutes = Math.max(1, Math.round(ms / MIN))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${pad(minutes % 60)}`
}
const coresOf = value => (Number.isFinite(value) ? `${(Math.round(value * 10) / 10).toFixed(1)} cores` : 'CPU unknown')

/**
 * The leaked headless browsers in one listing of the PC's processes (`{ pid, parent, name, commandLine, created, threads,
 * cpuMs }` each, cpu.mjs `parseListing`), with `memory` (`browserMemory()`, kept by the loop between runs and brought up
 * to date here: the samples of every headless main whose starter is gone, the processes gone dropped). One is leaked when
 * it is a headless Edge main process with more than one thread, its profile in the temp folder, its starter gone (its
 * parent not listed, or listed but created after it), and it has run over `afterMs` or used over `busyCores` cores for
 * `busyMs` in a row. Each `{ pid, key, profile, folder, prefix, startedAt, children, cores, why, closedAt }`: its tree
 * below it, the tool's folder in the temp folder (the one removed), the CPU it used since it started (cores), why it
 * counts, and when the board closed it before (never a second close: the loop lists it then).
 */
export function watchBrowsers(list, memory, { now, afterMs = LEAKED_AFTER_MS, busyCores = BUSY_CORES, busyMs = BUSY_MS, temp = tmpdir(), platform = process.platform }) {
  const byPid = new Map(list.map(one => [one.pid, one]))
  const found = []
  const live = new Set()
  for (const one of list) {
    if (!isHeadlessMain(one) || !(one.threads > 1)) continue
    const startedAt = fileTimeMs(one.created)
    if (startedAt === null) continue
    const parent = byPid.get(one.parent)
    if (parent !== undefined && parent.pid !== one.pid && (fileTimeMs(parent.created) ?? -Infinity) <= startedAt) continue
    const profile = profileOf(one.commandLine)
    const folder = tempRootOf(profile, temp, platform)
    if (folder === null) continue
    const key = browserKey(one)
    live.add(key)
    const samples = [...(memory.samples.get(key) ?? []), ...(Number.isFinite(one.cpuMs) ? [{ at: now, cpuMs: one.cpuMs }] : [])].slice(-SAMPLES_KEPT)
    memory.samples.set(key, samples)
    const busy = isBusy(samples, { cores: busyCores, spanMs: busyMs })
    if (now - startedAt < afterMs && !busy) continue
    const cores = Number.isFinite(one.cpuMs) && now > startedAt ? one.cpuMs / (now - startedAt) : null
    found.push({
      pid: one.pid, key, profile, folder, prefix: prefixOf(folder), startedAt, children: treeBelow(list, one.pid), cores,
      why: busy ? `over ${busyCores} cores for ${spanOf(busyMs)}` : `ran over ${spanOf(afterMs)}`, closedAt: memory.closed.get(key) ?? null,
    })
  }
  for (const key of [...memory.samples.keys()]) if (!live.has(key)) memory.samples.delete(key)
  for (const key of [...memory.closed.keys()]) if (!live.has(key)) memory.closed.delete(key)
  return found
}

/** The row's words for a leaked browser: its prefix first, so a tool that keeps leaking is visible; the CPU it used; why it counts. */
export const leakedWords = (one, now) => `${one.prefix}: a headless Edge (process ${one.pid}, started ${clockOf(one.startedAt)}, ${spanOf(now - one.startedAt)}, ${coresOf(one.cores)}) with its starter gone, ${one.why}`

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

/** The folder removed, with a few tries (Edge lets go of its files a moment after it ends): `{ ok, why }`. */
export async function removeProfile(folder) {
  try {
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    return { ok: true, why: null }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Closes a leaked browser (`watchBrowsers`' entry): its tree killed, then its folder in the temp folder removed (`folder`;
 * one outside it is never closed at all, `watchBrowsers` leaves it out). `{ ok, why, profile }`: `profile` says what
 * became of the folder ("removed", "left (<why>)"); not ok when the kill failed.
 */
export async function closeLeaked(one, { kill = taskkill, remove = removeProfile } = {}) {
  if (typeof one?.folder !== 'string' || one.folder === '') return { ok: false, why: 'its profile is not in the temp folder: not the board\'s to close', profile: null }
  const killed = await kill([one.pid, ...(one.children ?? [])])
  if (killed.ok !== true) return { ok: false, why: killed.why ?? 'the kill failed', profile: null }
  const removed = await remove(one.folder)
  return { ok: true, why: null, profile: removed.ok ? 'removed' : `left (${removed.why})` }
}
