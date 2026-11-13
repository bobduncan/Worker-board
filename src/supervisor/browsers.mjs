// Leaked headless browsers (2026-11-13, the person's PC lagging): a headless Edge a tool started (a worker's scratch CDP
// helper on a fixed port, the board's evidence pictures, the game's shots) outlives a killed run and keeps rendering on
// the CPU: one from 07:42 the day before took 13 of 24 cores, three more had leaked that evening. The rule `browsers`
// (rules/repair.mjs) finds, from one listing of the PC's processes, every headless or remote-driven msedge.exe MAIN
// process (no `--type=`; the person's own Edge has neither flag and is never touched) whose profile stands in the temp
// folder, whose starter process is gone, and that has run over LEAKED_AFTER_MS or whose tree used over BUSY_CORES cores for
// BUSY_MS in a row (chat 1's guard 2: a worker may detach a CDP helper on purpose and keep using it; the leak closes fast,
// a quiet helper only after half an hour). Right before the close the board checks that no live process is connected to
// the browser's DevTools port (a tool still driving it: left alone) and that no landing runs. The board closes its tree
// once (each process killed only while its creation time is the listing's: a number Windows gave out again is another
// process), removes the TOOL's own folder when the profile is one (a known board-tool folder right below the temp folder;
// anything else, a scratchpad's profile among them, is left), and shows one Cleaned row naming the profile's prefix and
// the tree's CPU, so a tool that keeps leaking is visible (the watch rule browser-leaks files an incident at three a day).
// Only the PC's first board runs it (server.mjs `closesBrowsers`). No AI, no tokens, no chat told. PURE but for the
// Windows calls at the end (`killVerified`, `inUseNow`, `removeFolder`), given by the server; tests give their own.
//
// Why the threads: a killed Edge main process lingers as a 1-thread zombie for a while (the game's browserTree.mjs
// `closeBrowser` counts the same), so only a process with more than one thread is alive. Why the starter: a process
// number Windows gave out again is no starter (a parent created after its child), as cpu.mjs `chosenProcesses` reads a
// tree; Edge relaunched through its compat layer has a dead stub for a parent, so the board's own tools pass
// --edge-skip-compat-layer-relaunch, and any other browser is also checked for a live DevTools connection.

import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

const MIN = 60_000
/** A headless browser whose starter is gone counts as leaked once it has run this long. */
export const LEAKED_AFTER_MS = 30 * MIN
/** Sooner: one whose tree used over this many cores ... */
export const BUSY_CORES = 2
/** ... for this long in a row (the loop samples every SYNC_EVERY_MS, 3 min: the third sample, two steps, spans it). */
export const BUSY_MS = 5 * MIN
/** The samples kept per browser. */
const SAMPLES_KEPT = 12
/** The Windows FILETIME epoch (1601-01-01) before the Unix one, in ms. */
const FILETIME_EPOCH_MS = 11_644_473_600_000
/** A `created` as the listing carries it (FILETIME, 100 ns since 1601) as Unix ms, or null. */
export const fileTimeMs = created => (Number.isFinite(created) ? created / 10_000 - FILETIME_EPOCH_MS : null)

/**
 * The folders the board's own tools make right below the temp folder for a browser, and the one the board may remove (guard
 * 1, chat 1's review: workers keep Edge profiles in their scratchpad, %TEMP%\claude\<project>\<session>\scratchpad\..., and a
 * removal above the profile would take every chat's scratchpad): the profile itself for a CDP helper's `edge-cdp-<name>-<tail>`
 * or the game's `lava-shot-<pid>-<tail>`; the tool's folder `board-evidence-<tail>` whose `profile` the evidence tool uses.
 */
const TOOL_PROFILE = /^(?:edge-cdp-[\w]+-|lava-shot-\d+-)[A-Za-z0-9]{6}$/
const TOOL_PARENT = /^board-evidence-[A-Za-z0-9]{6}$/

/** A headless or remote-driven Edge main process (no `--type=`: not one of its children); the person's own Edge has neither flag. */
export function isHeadlessMain(one) {
  if (String(one?.name ?? '').toLowerCase() !== 'msedge.exe' || typeof one.commandLine !== 'string') return false
  return /--headless|--remote-debugging-port/i.test(one.commandLine) && !/--type=/.test(one.commandLine)
}

/** The profile folder a command line names (`--user-data-dir=`, quoted or not; the LAST one, as Chromium reads it), or null. */
export function profileOf(commandLine) {
  let found = null
  for (const match of String(commandLine ?? '').matchAll(/"--user-data-dir=([^"]*)"|--user-data-dir=(?:"([^"]*)"|(\S*))/g)) {
    const value = match[1] ?? match[2] ?? match[3]
    if (value !== undefined && value !== '') found = value
  }
  return found
}

/** The DevTools port a command line names (`--remote-debugging-port=N`), or null for none or 0 (the browser picks one: the profile's DevToolsActivePort file says). */
export function devtoolsPortOf(commandLine) {
  const port = Number(/--remote-debugging-port=(\d+)/.exec(commandLine ?? '')?.[1])
  return Number.isInteger(port) && port > 0 ? port : null
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

const plainPath = (value, platform) => (platform === 'win32' ? resolve(value).toLowerCase() : resolve(value))

/** Whether `path` is inside the folder `temp` (the same spelling rules as the listing's: Windows is case-blind). */
export function isInTemp(path, temp = tmpdir(), platform = process.platform) {
  if (typeof path !== 'string' || path === '') return false
  const [inner, outer] = [plainPath(path, platform), plainPath(temp, platform)]
  return inner !== outer && inner.startsWith(outer.endsWith(sep) ? outer : `${outer}${sep}`)
}

/**
 * The folder the board may remove for this profile, or null (guard 1): the profile itself when it is a board tool's, right
 * below the temp folder (`edge-cdp-<name>-<tail>`, `lava-shot-<pid>-<tail>`); the evidence tool's `board-evidence-<tail>`
 * folder right below the temp folder when the profile is its `profile`; nothing else, wherever it stands.
 */
export function toolFolderOf(profile, temp = tmpdir(), platform = process.platform) {
  if (typeof profile !== 'string' || profile === '') return null
  const full = resolve(profile)
  const isRightBelow = folder => plainPath(dirname(folder), platform) === plainPath(temp, platform)
  if (isRightBelow(full) && TOOL_PROFILE.test(basename(full))) return full
  const parent = dirname(full)
  if (basename(full).toLowerCase() === 'profile' && isRightBelow(parent) && TOOL_PARENT.test(basename(parent))) return parent
  return null
}

/** The processes below `pid` in `list` (`{ pid, created }` each), parents before children; a child counts only when it started after its parent (a reused number leads nowhere). */
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
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

/** A browser's key across listings: its number and its start (a number given out again is another process). */
export const browserKey = one => `${one.pid}:${one.created ?? ''}`

/** The memory the loop keeps between runs: the CPU samples per browser, and the close tried on each (`{ at, ok }`). */
export const browserMemory = () => ({ samples: new Map(), closed: new Map() })

/**
 * Whether the samples (`{ at, cpuMs }`, oldest first) show over `cores` cores for `spanMs` in a row: a run of the newest
 * samples spanning `spanMs` or more whose every step is over (a step whose CPU fell, a child gone, breaks the run).
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
export const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
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
 * parent not listed, or listed but created after it), and it has run over `afterMs` or its TREE used over `busyCores`
 * cores for `busyMs` in a row (the rendering sits in the gpu and renderer children). Each `{ pid, created, key, profile,
 * port, folder, prefix, startedAt, children, cores, why, closedAt, closeOk }`: its tree below it (`{ pid, created }`
 * each), the folder the board may remove (null: left), the tree's CPU since it started (cores), why it counts, and the
 * close the board tried before (never a second: the loop lists it then).
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
    if (!isInTemp(profile, temp, platform)) continue
    const key = browserKey(one)
    live.add(key)
    const tree = treeBelow(list, one.pid)
    const cpuMs = [one, ...tree].reduce((sum, proc) => (Number.isFinite(proc.cpuMs) ? sum + proc.cpuMs : sum), 0)
    const samples = [...(memory.samples.get(key) ?? []), { at: now, cpuMs }].slice(-SAMPLES_KEPT)
    memory.samples.set(key, samples)
    const busy = isBusy(samples, { cores: busyCores, spanMs: busyMs })
    if (now - startedAt < afterMs && !busy) continue
    const folder = toolFolderOf(profile, temp, platform)
    const tried = memory.closed.get(key) ?? null
    found.push({
      pid: one.pid, created: one.created ?? null, key, profile, port: devtoolsPortOf(one.commandLine), folder, prefix: prefixOf(folder ?? profile), startedAt,
      children: tree.map(child => ({ pid: child.pid, created: child.created ?? null })), cores: now > startedAt ? cpuMs / (now - startedAt) : null,
      why: busy ? `over ${busyCores} cores for ${spanOf(busyMs)}` : `ran over ${spanOf(afterMs)}`, closedAt: tried?.at ?? null, closeOk: tried?.ok ?? null,
    })
  }
  for (const key of [...memory.samples.keys()]) if (!live.has(key)) memory.samples.delete(key)
  for (const key of [...memory.closed.keys()]) if (!live.has(key)) memory.closed.delete(key)
  return found
}

/** The row's words for a leaked browser: its prefix first, so a tool that keeps leaking is visible; the tree's CPU; why it counts. */
export const leakedWords = (one, now) => `${one.prefix}: a headless Edge (process ${one.pid}, started ${clockOf(one.startedAt)}, ${spanOf(now - one.startedAt)}, ${coresOf(one.cores)}) with its starter gone, ${one.why}`

/** Runs a PowerShell script, hidden; answers its output. */
function powershell(script, timeoutMs = 20_000) {
  return new Promise((done, fail) => {
    let out = ''
    let err = ''
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { err += chunk })
    child.on('error', error => { clearTimeout(timer); fail(error) })
    child.on('exit', code => { clearTimeout(timer); code === 0 ? done(out) : fail(new Error(err.trim().split('\n').at(-1) || `PowerShell ended with ${code}`)) })
  })
}

/**
 * Kills the processes (`{ pid, created }` each), each only while its creation time is still the listing's (chat 1's review: a
 * number Windows gave out again since the listing is another process, and no `/T`); one gone meanwhile is fine. `{ ok, why,
 * killed }`.
 */
export async function killVerified(processes, { platform = process.platform, run = powershell } = {}) {
  const wanted = processes.filter(one => Number.isInteger(one?.pid) && Number.isFinite(one?.created))
  if (wanted.length === 0) return { ok: true, why: null, killed: 0 }
  if (platform !== 'win32') return { ok: false, why: 'only on Windows', killed: 0 }
  const rows = wanted.map(one => `@{ pid = ${one.pid}; created = [long]${Math.round(one.created)} }`).join(', ')
  const script = `$killed = 0; foreach ($one in @(${rows})) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($one.pid)" -ErrorAction SilentlyContinue; if ($p -and $p.CreationDate -and [long]$p.CreationDate.ToFileTimeUtc() -eq $one.created) { Stop-Process -Id $one.pid -Force -ErrorAction Stop; $killed += 1 } }; Write-Output $killed`
  try {
    const out = await run(script)
    return { ok: true, why: null, killed: Number(out.trim()) || 0 }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error), killed: 0 }
  }
}

/** The DevTools port of a browser: the command line's, else the profile's DevToolsActivePort file's first line; null for none. */
export async function devtoolsPortNow(one, { read = file => readFile(file, 'utf8') } = {}) {
  if (Number.isInteger(one?.port) && one.port > 0) return one.port
  if (typeof one?.profile !== 'string') return null
  try {
    const port = Number((await read(join(one.profile, 'DevToolsActivePort'))).split('\n')[0].trim())
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

/** Whether a live process holds an established connection to the browser's DevTools port (a tool still driving it): true, false, or null when it could not be told. */
export async function inUseNow(one, { platform = process.platform, run = powershell, read = undefined } = {}) {
  const port = await devtoolsPortNow(one, read === undefined ? {} : { read })
  if (port === null) return false
  if (platform !== 'win32') return null
  try {
    const out = await run(`(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq ${port} -or $_.RemotePort -eq ${port} } | Measure-Object).Count`)
    return (Number(out.trim()) || 0) > 0
  } catch {
    return null
  }
}

/** The folder removed, with a few tries (Edge lets go of its files a moment after it ends): `{ ok, why }`. */
export async function removeFolder(folder) {
  try {
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    return { ok: true, why: null }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Closes a leaked browser (`watchBrowsers`' entry), the Windows calls given: `landing()` true skips it (a landing runs: nothing
 * is counted), `inUse(one)` true skips it (a live process is connected to its DevTools port), `kill(processes)` kills the main
 * and its tree each while its creation time holds, `remove(folder)` removes the tool's own folder when there is one. `{ ok,
 * skipped, why, profile }`: `profile` says what became of the folder ("removed", "left (<why>)", "left: not the tool's own
 * folder"); not ok when the kill failed; `skipped` true when nothing was tried (the loop counts no close then).
 */
export async function closeLeaked(one, { kill = killVerified, remove = removeFolder, inUse = inUseNow, landing = () => false } = {}) {
  if (await landing()) return { ok: false, skipped: true, why: 'a landing runs', profile: null }
  const used = await inUse(one)
  if (used === true) return { ok: false, skipped: true, why: 'in use: a live process is connected to its DevTools port', profile: null }
  if (used === null) return { ok: false, skipped: true, why: 'its DevTools connections could not be read', profile: null }
  const killed = await kill([{ pid: one.pid, created: one.created }, ...(one.children ?? [])])
  if (killed.ok !== true) return { ok: false, skipped: false, why: killed.why ?? 'the kill failed', profile: null }
  if (typeof one.folder !== 'string' || one.folder === '') return { ok: true, skipped: false, why: null, profile: 'left: not the tool\'s own folder' }
  const removed = await remove(one.folder)
  return { ok: true, skipped: false, why: null, profile: removed.ok ? 'removed' : `left (${removed.why})` }
}
