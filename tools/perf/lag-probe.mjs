// S0 of the PC plan (.claude/plans/pc-lag-test-speed-plan.md, chat 1, 2026-11-25): does the PC still answer in time while
// heavy runs go? A stand-in for the person's own program: at Normal priority and on every core, it wakes 60 times a second
// and does 3 ms of work each time, like a video player or a game loop. Two numbers per tick:
// - lateness: how long after its due time the tick began. Windows wakes a sleeping process on a coarse timer (about 15.6 ms
//   unless a program asks for finer), so the idle case is not 0: compare a case with case a (idle), never with zero;
// - stall: the longest gap inside the 3 ms of work, between two readings of the clock. A gap of over a millisecond means the
//   thread lost its core to another one: the stutter itself, with no timer in the way.
// Every 5 s one PowerShell child reads the load of logical processors 0-3 (the person's two P-cores), the whole PC and
// Defender (MsMpEng, in cores) from the performance classes, which have the same names in every Windows language.
//
//   node tools/perf/lag-probe.mjs [--seconds 180] [--label <case>] [--out <file.jsonl>]
// It prints one JSON line (and appends it to --out): the case's numbers.

import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export const HZ = 60
export const WORK_MS = 3
/** A tick that began this much after its due time counts as late (the plan's 8 ms: half a frame at 60 Hz). */
export const LATE_MS = 8
/** A gap inside the work longer than this counts as a stall (the thread was taken off its core). */
export const STALL_MS = 1
export const SAMPLE_S = 5

const now = () => Number(process.hrtime.bigint()) / 1e6

/** The value at quantile `q` (0-1) of the numbers, nearest rank. */
export function quantile(values, q) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]
}

/** The numbers of a run: `{ ticks, p50, p99, max, latePct, stallP99, stallMax, stallPct }`, times in ms rounded to 0.01. */
export function latenessStats(lates, stalls = [], { lateMs = LATE_MS, stallMs = STALL_MS } = {}) {
  const r = x => Math.round(x * 100) / 100
  const pct = (values, over) => (values.length === 0 ? 0 : r((100 * values.filter(v => v > over).length) / values.length))
  return {
    ticks: lates.length,
    p50: r(quantile(lates, 0.5)),
    p99: r(quantile(lates, 0.99)),
    max: r(Math.max(0, ...lates)),
    latePct: pct(lates, lateMs),
    stallP99: r(quantile(stalls, 0.99)),
    stallMax: r(Math.max(0, ...stalls)),
    stallPct: pct(stalls, stallMs),
  }
}

/** The sampler's PowerShell: one JSON line every `seconds` with the load of LP0-3, the whole PC and MsMpEng. */
export function samplerScript(seconds = SAMPLE_S) {
  return [
    '$ErrorActionPreference = "SilentlyContinue"',
    'while ($true) {',
    `  Start-Sleep -Seconds ${seconds}`,
    '  $p = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor',
    '  $d = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name=\'MsMpEng\'"',
    '  $o = [ordered]@{ at = (Get-Date).ToString("o") }',
    '  foreach ($x in $p) { $o["lp" + $x.Name] = [int]$x.PercentProcessorTime }',
    '  $o["msmpeng"] = if ($d) { [int]($d | Measure-Object PercentProcessorTime -Sum).Sum } else { 0 }',
    '  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))',
    '}',
  ].join('\n')
}

/** The sampler's lines as rows: `{ lp: [LP0..LP3 %], total %, msmpengCores }`; a line that is not one is left out. */
export function counterRows(text) {
  const rows = []
  for (const line of String(text).split(/\r?\n/)) {
    let one
    try {
      one = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof one !== 'object' || one === null || !('lp_Total' in one)) continue
    rows.push({ lp: [0, 1, 2, 3].map(n => Number(one[`lp${n}`] ?? 0)), total: Number(one.lp_Total ?? 0), msmpengCores: Number(one.msmpeng ?? 0) / 100 })
  }
  return rows
}

/** The load numbers of a run: LP0-3 mean and max, the whole PC's mean, MsMpEng's mean and max in cores. */
export function loadStats(rows) {
  const mean = values => (values.length === 0 ? 0 : Math.round((10 * values.reduce((a, b) => a + b, 0)) / values.length) / 10)
  const lp03 = rows.map(row => row.lp.reduce((a, b) => a + b, 0) / 4)
  return {
    samples: rows.length,
    lp03Mean: mean(lp03),
    lp03Max: Math.round(Math.max(0, ...rows.flatMap(row => row.lp))),
    totalMean: mean(rows.map(row => row.total)),
    msmpengMean: mean(rows.map(row => row.msmpengCores)),
    msmpengMax: Math.round(10 * Math.max(0, ...rows.map(row => row.msmpengCores))) / 10,
  }
}

/** Starts the load sampler (Windows only): `{ stop() }` resolves to its rows. Elsewhere it gives none. */
export function startSampler({ seconds = SAMPLE_S, platform = process.platform } = {}) {
  if (platform !== 'win32') return { stop: async () => [] }
  let out = ''
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', samplerScript(seconds)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  child.stdout.on('data', data => (out += data))
  child.on('error', () => {})
  return {
    stop: async () => {
      child.kill()
      return counterRows(out)
    },
  }
}

/** The tick loop for `seconds` (or until `stopped()` says so): the lateness and the longest gap in the work of every tick. */
export async function tickLoop(seconds, { hz = HZ, workMs = WORK_MS, stopped = () => false } = {}) {
  const period = 1000 / hz
  const lates = []
  const stalls = []
  const start = now()
  const count = Math.floor((seconds * 1000) / period)
  for (let i = 1; i <= count && !stopped(); i += 1) {
    const due = start + i * period
    const ahead = due - now()
    if (ahead > 0) await new Promise(resolveTick => setTimeout(resolveTick, ahead))
    const began = now()
    lates.push(Math.max(0, began - due))
    let last = began
    let gap = 0
    while (last - began < workMs) {
      const t = now()
      if (t - last > gap) gap = t - last
      last = t
    }
    stalls.push(gap)
  }
  return { lates, stalls }
}

/** One probe run: `{ label, at, seconds, ...latenessStats, ...loadStats }`. */
export async function probe({ seconds = 180, label = 'probe', platform = process.platform, stopped = () => false } = {}) {
  const at = new Date().toISOString()
  const began = now()
  const sampler = startSampler({ platform })
  const { lates, stalls } = await tickLoop(seconds, { stopped })
  const rows = await sampler.stop()
  return { label, at, seconds: Math.round((now() - began) / 1000), ...latenessStats(lates, stalls), ...loadStats(rows) }
}

function argOf(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const result = await probe({ seconds: Number(argOf(argv, '--seconds') ?? 180), label: argOf(argv, '--label') ?? 'probe' })
  const line = JSON.stringify(result)
  const out = argOf(argv, '--out')
  if (out) {
    mkdirSync(dirname(out), { recursive: true })
    appendFileSync(out, `${line}\n`)
  }
  console.log(line)
}
