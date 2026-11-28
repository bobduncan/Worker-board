// The lag recorder (chat 1's brief, 2026-11-27; the person: "maybe with the numbers we can also measure cpu/gpu spikes or lags caused
// by improvements"). Once a minute, while the board runs, it measures for one second what the person would feel (S0's 60 Hz probe, in a
// child process of its own, never the board's event loop) and writes one line to data/perf/lag.jsonl: the probe's numbers, the whole
// PC's CPU and GPU, and the project process that was busiest. The CPU numbers come from the listings the CPU limiter makes anyway (the
// cpuMs of each process between two listings): no listing and no PowerShell of its own. In Low (the person games) the probe does not
// run; a line is still written when a project process uses over a core, so a lag in a game names its cause (F87, 2026-11-27 17:15).

import { execFile, spawn } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isChatProcess, isHeavyRun, keyOf } from './cpu.mjs'

/** How often a line is written. */
export const EVERY_MS = 60_000
/** How long the probe ticks each minute. */
export const PROBE_S = 1
/** S0's probe: 60 ticks a second, 3 ms of work each, like a video player or a game loop. */
export const HZ = 60
export const WORK_MS = 3
/**
 * A spike: a tick began over 40 ms late (Windows' coarse timer alone makes an idle PC's ticks up to about 16 ms late: S0's case a, p99
 * 15.1 ms), or a gap of over 8 ms inside a tick's 3 ms of work (the thread lost its core: idle 0.3 ms; the screen checks on every core
 * 35 ms, S0's case b).
 */
export const SPIKE_LATE_MS = 40
export const SPIKE_STALL_MS = 8
/** A minute counts as one in which work ran when the heavy-run slot was held or project processes used this many cores. */
export const WORK_CORES = 0.5
/** In Low a line is written only when a project process used over this many cores. */
export const LOW_LINE_CORES = 1
/** Lines older than this are dropped once a day. */
export const KEEP_DAYS = 30
/** Two listings further apart than this give no CPU numbers (a sleep, a stalled limiter). */
export const LISTING_GAP_MS = 3 * 60_000

/** The value at quantile `q` (0-1) of the numbers, nearest rank. */
export function quantile(values, q) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]
}

/** One probe's numbers: `{ ticks, p99, lateMax, stallMax }` in ms, rounded to 0.01. */
export function probeStats(lates, stalls) {
  const r = x => Math.round(x * 100) / 100
  return { ticks: lates.length, p99: r(quantile(lates, 0.99)), lateMax: r(Math.max(0, ...lates)), stallMax: r(Math.max(0, ...stalls)) }
}

/** Whether a line is a lag spike (a line without a probe never is). */
export function isSpike(line) {
  return Number.isFinite(line?.lateMax) && Number.isFinite(line?.stallMax) && (line.lateMax > SPIKE_LATE_MS || line.stallMax > SPIKE_STALL_MS)
}

const lower = one => String(one?.name ?? '').toLowerCase()

/**
 * What a project process is, for the line's culprit: `chat` (a chat's own claude.exe), `orphan` (F87: adopted outside every tree), `test run` (a heavy run's tree, a
 * vitest, a node --test or a playwright), `browser`, `board` (the board's own tree), `chat helper` (under a chat), else `other`.
 * `found` as chosenProcesses answers (with `key` and `parentKey`).
 */
export function kindsOf({ found = [], adopted = [], boardPids = [] } = {}) {
  const byKey = new Map(found.map(one => [one.key, one]))
  const board = new Set(boardPids)
  const kinds = new Map()
  const ancestors = one => {
    const chain = []
    for (let at = one; at !== undefined; at = at.parentKey === null ? undefined : byKey.get(at.parentKey)) chain.push(at)
    return chain
  }
  const isTest = one => isHeavyRun(one) || /\bvitest\b|node(?:\.exe)?"?\s+--test\b|\bplaywright\b/i.test(String(one.commandLine ?? ''))
  const isBrowser = one => ['msedge.exe', 'chrome.exe', 'headless_shell.exe'].includes(lower(one))
  for (const one of found) {
    const chain = ancestors(one)
    const kind = isChatProcess(one) ? 'chat' : chain.some(isTest) ? 'test run' : isBrowser(one) ? 'browser' : chain.some(at => board.has(at.pid)) ? 'board' : chain.slice(1).some(isChatProcess) ? 'chat helper' : 'other'
    kinds.set(one.pid, kind)
  }
  for (const one of adopted) kinds.set(one.pid, 'orphan')
  return kinds
}

/**
 * The CPU between two listings (`{ list, at }` each, the limiter's): `{ total, cores: Map(pid → cores used) }`; `total` is the whole
 * PC in percent. A process is the same one only by its pid and start; Windows' idle process (pid 0) is no load. Null when the listings
 * are too far apart, or out of order.
 */
export function loadBetween(before, after, cores) {
  if (!before || !after || !(after.at > before.at) || after.at - before.at > LISTING_GAP_MS || !(cores > 0)) return null
  const dt = after.at - before.at
  const earlier = new Map(before.list.map(one => [keyOf(one), one.cpuMs]))
  const used = new Map()
  let sum = 0
  for (const one of after.list) {
    if (one.pid === 0 || !Number.isFinite(one.cpuMs)) continue
    const was = earlier.get(keyOf(one))
    // A process born between the listings counts from its start.
    const ms = Math.max(0, one.cpuMs - (Number.isFinite(was) ? was : 0))
    used.set(one.pid, ms / dt)
    sum += ms
  }
  return { total: Math.min(100, Math.round((1000 * sum) / (dt * cores)) / 10), cores: used }
}

const round2 = x => Math.round(x * 100) / 100

/**
 * The minute's line. `probe` (or null in Low), `load` (loadBetween, or null), `listing` (the limiter's newest: `found`, `adopted`),
 * `gpu` (percent, or null), `held` (the heavy-run slot is taken). `top`: the busiest project process; `pc`: the busiest process of
 * the whole PC, when it is not the project's.
 */
export function lagLine({ at, level, probe = null, load = null, listing = null, gpu = null, held = false, boardPids = [] }) {
  // A chat's own claude.exe counts too (kind `chat`): it runs at Normal on every core.
  const project = listing === null ? [] : [...listing.found, ...listing.adopted]
  const kinds = listing === null ? new Map() : kindsOf({ ...listing, boardPids })
  const coresOf = one => load?.cores.get(one.pid) ?? 0
  const busiest = items => items.reduce((best, one) => (best === null || coresOf(one) > coresOf(best) ? one : best), null)
  const top = load === null ? null : busiest(project)
  const projectCores = load === null ? 0 : project.reduce((sum, one) => sum + coresOf(one), 0)
  const projectPids = new Set(project.map(one => one.pid))
  const pcTop = load === null || listing === null ? null : busiest(listing.list.filter(one => one.pid !== 0 && !projectPids.has(one.pid)))
  return {
    at: new Date(at).toISOString(),
    level,
    ...(probe === null ? { p99: null, lateMax: null, stallMax: null } : { p99: probe.p99, lateMax: probe.lateMax, stallMax: probe.stallMax }),
    cpu: load?.total ?? null,
    gpu: Number.isFinite(gpu) ? gpu : null,
    work: held || projectCores > WORK_CORES,
    projectCores: round2(projectCores),
    top: top === null || coresOf(top) === 0 ? null : { name: top.name, pid: top.pid, cores: round2(coresOf(top)), kind: kinds.get(top.pid) ?? 'other' },
    pc: pcTop === null || coresOf(pcTop) === 0 ? null : { name: pcTop.name, pid: pcTop.pid, cores: round2(coresOf(pcTop)) },
  }
}

/** Whether a minute's line is written: always with a probe; in Low only when the project used over LOW_LINE_CORES. */
export const isWorthWriting = line => line.p99 !== null || line.projectCores > LOW_LINE_CORES

/** The lines of a file's text, from `from` to before `to` (ms); a line that is not one is left out. */
export function linesOf(text, { from = -Infinity, to = Infinity } = {}) {
  const lines = []
  for (const row of String(text ?? '').split(/\r?\n/)) {
    if (row.trim() === '') continue
    let one
    try { one = JSON.parse(row) } catch { continue }
    const at = Date.parse(one?.at)
    if (Number.isFinite(at) && at >= from && at < to) lines.push(one)
  }
  return lines
}

/** The file's text without its lines older than `days`: `{ text, dropped }`. A row that is no line is dropped too. */
export function keepRecent(text, now, days = KEEP_DAYS) {
  const from = now - days * 24 * 60 * 60 * 1000
  const rows = String(text ?? '').split(/\r?\n/).filter(row => row.trim() !== '')
  const kept = rows.filter(row => { try { const at = Date.parse(JSON.parse(row)?.at); return Number.isFinite(at) && at >= from } catch { return false } })
  return { text: kept.length === 0 ? '' : `${kept.join('\n')}\n`, dropped: rows.length - kept.length }
}

/**
 * Spikes per hour while work ran, over `lines`: `{ workMinutes, spikes, perHour }`. Only minutes with a probe and work count; perHour
 * is null with no such minute.
 */
export function spikesPerHour(lines) {
  const counted = lines.filter(line => line.work === true && Number.isFinite(line.lateMax))
  const spikes = counted.filter(isSpike).length
  return { workMinutes: counted.length, spikes, perHour: counted.length === 0 ? null : Math.round((10 * spikes * 60) / counted.length) / 10 }
}

/** The culprits of the spikes, by kind and by program, most first: `[{ kind, name, spikes }]`. */
export function culpritsOf(lines) {
  const counts = new Map()
  for (const line of lines.filter(isSpike)) {
    const name = line.top?.name ?? line.pc?.name ?? 'unknown'
    const kind = line.top?.kind ?? (line.pc ? 'not the project' : 'unknown')
    const key = `${kind}\u0000${name}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].map(([key, spikes]) => { const [kind, name] = key.split('\u0000'); return { kind, name, spikes } }).sort((a, b) => b.spikes - a.spikes || a.name.localeCompare(b.name))
}

/** The probe's child process (src/lagProbe.mjs): `{ run(): Promise<stats or null>, stop() }`. A child that died is started again. */
export function probeChild({ script = fileURLToPath(new URL('./lagProbe.mjs', import.meta.url)), timeoutMs = 10_000 } = {}) {
  let child = null
  let buffer = ''
  let waiting = null
  const start = () => {
    const mine = spawn(process.execPath, [script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    child = mine
    buffer = ''
    mine.stdout.setEncoding('utf8')
    mine.stdout.on('data', data => {
      buffer += data
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const row = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        let stats = null
        try { stats = JSON.parse(row) } catch {}
        waiting?.(stats)
      }
    })
    mine.stdin.on('error', () => {})
    mine.on('error', () => {})
    // Only this child's end: a child stopped before a new one started must not end the new one's wait.
    mine.on('exit', () => { if (child === mine) { child = null; waiting?.(null) } })
  }
  return {
    run: () => new Promise(resolve => {
      if (child === null) start()
      const timer = setTimeout(() => { waiting = null; resolve(null) }, timeoutMs)
      waiting = stats => { clearTimeout(timer); waiting = null; resolve(stats) }
      child.stdin.write(`${PROBE_S}\n`, () => {})
    }),
    stop: () => { const old = child; child = null; old?.kill() },
  }
}

/** The GPU's load in percent, from nvidia-smi; null when there is none (and it is not asked again) or it does not answer. */
export function nvidiaGpu({ run = execFile } = {}) {
  let missing = false
  return () => new Promise(resolve => {
    if (missing) return resolve(null)
    run('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 3000 }, (error, stdout) => {
      if (error) { if (error.code === 'ENOENT') missing = true; return resolve(null) }
      const values = String(stdout).split(/\r?\n/).map(Number).filter(Number.isFinite)
      resolve(values.length === 0 ? null : Math.max(...values))
    })
  })
}

/**
 * The recorder. `hear(listing)` takes each of the limiter's listings (`{ list, found, adopted, level, at }`); `minute()` writes the
 * minute's line (the board calls it every EVERY_MS); `tidy()` drops old lines (at start and once a day). `probe`, `gpu` and `held`
 * are the seams: probeChild().run, nvidiaGpu(), whether the heavy-run slot is taken.
 */
export function lagRecorder({ file, cores, probe, gpu = async () => null, held = () => false, level = () => 'full', boardPids = [], now = Date.now, log = () => {} }) {
  let before = null
  let after = null
  let tidiedAt = -Infinity
  let busy = false
  const hear = listing => {
    if (!listing || !Array.isArray(listing.list)) return
    before = after
    after = listing
  }
  const tidy = async () => {
    tidiedAt = now()
    let text
    try { text = await readFile(file, 'utf8') } catch (error) { if (error?.code === 'ENOENT') return 0; throw error }
    const kept = keepRecent(text, now())
    if (kept.dropped > 0) await writeFile(file, kept.text)
    return kept.dropped
  }
  const minute = async () => {
    if (busy) return null
    busy = true
    try {
      const current = level()
      const stats = current === 'low' ? null : await probe().catch(() => null)
      const fresh = after !== null && now() - after.at <= LISTING_GAP_MS
      const line = lagLine({
        at: now(), level: current, probe: stats, load: fresh ? loadBetween(before, after, cores) : null, listing: fresh ? after : null,
        gpu: await gpu().catch(() => null), held: held(), boardPids,
      })
      if (!isWorthWriting(line)) return null
      await mkdir(dirname(file), { recursive: true })
      await appendFile(file, `${JSON.stringify(line)}\n`)
      if (now() - tidiedAt > 24 * 60 * 60 * 1000) await tidy().catch(error => log(`Lag recorder: old lines could not be dropped (${error.message}).`))
      return line
    } finally {
      busy = false
    }
  }
  return { hear, minute, tidy }
}
