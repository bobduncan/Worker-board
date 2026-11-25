// S0 of the PC plan (.claude/plans/pc-lag-test-speed-plan.md, chat 1, 2026-11-25): how much time the heavy-run queue costs.
// It reads the queue's run log (one-at-a-time's `<lock>.runs.jsonl`), the board's landings (data/landings.jsonl and the gate
// logs) and the worker task times (data/task-times.json), and reports per day: the time spent waiting against running, how
// busy the slot was, the wait and run per kind of run, the gates landed and refused, and the share of a step's wall time
// spent on tests (waiting or running). Chat 1's scratchpad scripts (runs.mjs, share.mjs, steps.mjs) made into one tool.
//
//   node tools/perf/run-share.mjs [--days N] [--day YYYY-MM-DD] [--until <time>] [--json]
//   (--until: only what had happened by then, to compare with an earlier reading)

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { lockPath } from '../one-at-a-time.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BOARD = join(HERE, '..', '..')

/** A run that held its slot longer than this is a hang (a PC sleep, a stuck command): kept out of the clean step set. */
export const HANG_S = 120 * 60

/** The local calendar day of a time, YYYY-MM-DD. */
export const localDay = t => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const median = a => {
  if (a.length === 0) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
export const p90 = a => {
  if (a.length === 0) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]
}

/** The total length of a set of [from, to] intervals, overlaps counted once. */
export function unionMs(intervals) {
  const iv = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0
  let from = -Infinity
  let to = -Infinity
  for (const [a, b] of iv) {
    if (a > to) {
      if (to > from) total += to - from
      from = a
      to = b
    } else to = Math.max(to, b)
  }
  if (to > from) total += to - from
  return total
}

/** The kind of a queued run, from its folder and label. */
export function groupOf(run) {
  const cwd = String(run.cwd ?? '').toLowerCase()
  const label = String(run.label ?? '')
  if (cwd.includes('land-gate')) return 'board landing gate'
  if (/^perf-s0/.test(label)) return 'perf probe'
  if (cwd.includes('worker-board') || label === 'test') return 'board other'
  if (/slow-tier/.test(label)) return 'game slow-tier'
  if (/screens/.test(label)) return 'game screens'
  if (/^check/.test(label)) return `game ${label}`
  return `other: ${label.replace(/^(b|f)\d+.*/i, 'ad hoc')}`
}

/** The runs of a run log's text, each with its times (t: queued, begin, end), kind and local day; a broken line is left out. */
export function parseRuns(text) {
  const runs = []
  for (const line of String(text).split('\n')) {
    if (line.trim() === '') continue
    let run
    try {
      run = JSON.parse(line)
    } catch {
      continue
    }
    const t = Date.parse(run.at)
    if (!Number.isFinite(t)) continue
    const waitedS = Number(run.waitedS) || 0
    const ranS = Number(run.ranS) || 0
    const begin = t + waitedS * 1000
    runs.push({ ...run, waitedS, ranS, t, begin, end: begin + ranS * 1000, g: groupOf(run), d: localDay(t) })
  }
  return runs
}

/** Per day: runs, wait and run totals (s), median/p90/max wait, median run, slot busy (s), runs that failed or never ran. */
export function perDay(runs) {
  const days = new Map()
  for (const run of runs) days.set(run.d, [...(days.get(run.d) ?? []), run])
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, rs]) => {
    const waits = rs.map(r => r.waitedS)
    const ran = rs.map(r => r.ranS).filter(s => s > 0)
    return {
      day: d,
      runs: rs.length,
      waitS: waits.reduce((a, b) => a + b, 0),
      runS: rs.reduce((a, r) => a + r.ranS, 0),
      // A hang (over HANG_S) is mostly a PC sleep or a stuck command, not work: the total without them as well.
      runNoHangS: rs.filter(r => r.ranS <= HANG_S).reduce((a, r) => a + r.ranS, 0),
      waitMedianS: median(waits),
      waitP90S: p90(waits),
      waitMaxS: Math.max(0, ...waits),
      runMedianS: median(ran),
      busyS: unionMs(rs.map(r => [r.begin, r.end])) / 1000,
      failed: rs.filter(r => r.ranS > 0 && r.exit !== 0).length,
      neverRan: rs.filter(r => r.ranS === 0).length,
      hangs: rs.filter(r => r.ranS > HANG_S).length,
    }
  })
}

/** Per day and kind: runs, wait total/median/p90, run total/median, failed. */
export function perKind(runs) {
  const groups = new Map()
  for (const run of runs) {
    const key = `${run.d}\t${run.g}`
    groups.set(key, [...(groups.get(key) ?? []), run])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rs]) => {
    const [day, kind] = key.split('\t')
    const waits = rs.map(r => r.waitedS)
    const ran = rs.map(r => r.ranS).filter(s => s > 0)
    return {
      day, kind, runs: rs.length,
      waitS: waits.reduce((a, b) => a + b, 0), waitMedianS: median(waits), waitP90S: p90(waits),
      runS: ran.reduce((a, b) => a + b, 0), runMedianS: median(ran),
      failed: rs.filter(r => r.ranS > 0 && r.exit !== 0).length,
    }
  })
}

/**
 * The landing gates from the landings log: `{ branch, by, start, end, waitS, result, day }` for each landing that ran a gate
 * (its gate log is named after when it began, local time); `readLog(name)` gives a gate log's text, for its wait.
 */
export function gatesOf(landings, readLog = () => '') {
  const gates = []
  for (const entry of landings) {
    if (!entry?.gateLog) continue
    const name = String(entry.gateLog).split(/[\\/]/).pop()
    const m = name.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/)
    if (!m) continue
    const start = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
    const waited = String(readLog(name) ?? '').match(/runs now \(waited (\d+) s\)/)
    gates.push({ branch: String(entry.branch ?? ''), by: entry.by ?? '', start, end: Date.parse(entry.at), waitS: waited ? Number(waited[1]) : 0, result: entry.result ?? '', day: localDay(start) })
  }
  return gates
}

/** Per day: gates run, landed and refused. */
export function gateResults(gates) {
  const days = new Map()
  for (const gate of gates) {
    const one = days.get(gate.day) ?? { day: gate.day, gates: 0, landed: 0, refused: 0 }
    one.gates += 1
    if (gate.result === 'landed') one.landed += 1
    else if (gate.result === 'refused') one.refused += 1
    days.set(gate.day, one)
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
}

/**
 * Each worker task since `from` with the time its runs and gates spent waiting and running, as a share of its wall time
 * (taken to reported). A task with a hung run, or paused (wall over 1.5x its work plus 10 min), is marked; the clean set
 * leaves those out.
 */
export function stepShare(tasks, runs, gates, from = 0) {
  const rows = []
  for (const task of tasks) {
    if (!(task.startedAt >= from) || !Number.isFinite(task.reportedAt)) continue
    const ids = (task.steps ?? [task.step]).filter(Boolean).map(s => String(s).toLowerCase())
    const lo = task.startedAt - 60e3
    const hi = task.reportedAt + 60e3
    const named = id => new RegExp(`[-_/\\\\]${id}($|[^0-9])`, 'i')
    const mine = runs.filter(r => ids.some(id => named(id).test(r.cwd ?? '') || String(r.label ?? '').toLowerCase().startsWith(id)) && r.t >= lo && r.t <= hi)
    const own = gates.filter(g => ids.some(id => g.branch.toLowerCase().startsWith(`${id}-`)) && g.start >= lo && g.start <= hi)
    const waitIv = [...mine.map(r => [r.t, Math.min(r.begin, hi)]), ...own.map(g => [g.start, Math.min(g.start + g.waitS * 1000, hi)])]
    const runIv = [...mine.map(r => [r.begin, Math.min(r.end, hi)]), ...own.map(g => [g.start + g.waitS * 1000, Math.min(g.end, hi)])]
    const wallMs = task.reportedAt - task.startedAt
    const waitMs = unionMs(waitIv)
    const allMs = unionMs([...waitIv, ...runIv])
    rows.push({
      step: task.step ?? ids[0]?.toUpperCase() ?? '', area: task.area ?? '', day: localDay(task.startedAt),
      wallMin: wallMs / 6e4, workMin: (task.workMs ?? 0) / 6e4, waitMin: waitMs / 6e4, runMin: Math.max(0, allMs - waitMs) / 6e4,
      runs: mine.length, gates: own.length,
      hang: mine.some(r => r.ranS > HANG_S),
      paused: wallMs > 1.5 * (task.workMs ?? 0) + 10 * 6e4,
    })
  }
  return rows
}

/** The share of wall time spent on tests over a set of step rows: `{ tasks, wallMin, waitPct, runPct, testPct, medianPct }`. */
export function shareOf(rows) {
  const wall = rows.reduce((a, r) => a + r.wallMin, 0)
  const wait = rows.reduce((a, r) => a + r.waitMin, 0)
  const run = rows.reduce((a, r) => a + r.runMin, 0)
  const pct = x => (wall > 0 ? (100 * x) / wall : 0)
  return {
    tasks: rows.length, wallMin: wall, waitPct: pct(wait), runPct: pct(run), testPct: pct(wait + run),
    medianPct: median(rows.map(r => (100 * (r.waitMin + r.runMin)) / Math.max(r.wallMin, 1))),
  }
}

/** The finished tasks of task-times.json (`tasks`), or those its scans hold. */
export function tasksOf(taskTimes) {
  if (Array.isArray(taskTimes?.tasks)) return taskTimes.tasks
  return []
}

const readJsonLines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(l => l.trim() !== '').flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } }) : [])

/**
 * The board's data folder: the main checkout's (a worktree has none of its own: the live board writes there), found through
 * git's common folder; this folder's own when git cannot say.
 */
export function dataFolder(board = BOARD) {
  try {
    const common = execFileSync('git', ['-C', board, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', windowsHide: true }).trim()
    const main = dirname(isAbsolute(common) ? common : resolve(board, common))
    if (existsSync(join(main, 'data'))) return join(main, 'data')
  } catch {
    // no git here: this folder's data
  }
  return join(board, 'data')
}

/** Everything the report reads, from the files on this PC. */
export function readAll({ board = BOARD, env = process.env, data = dataFolder(board), until = Infinity } = {}) {
  const runsFile = `${lockPath(env)}.runs.jsonl`
  const runs = parseRuns(existsSync(runsFile) ? readFileSync(runsFile, 'utf8') : '').filter(r => r.t <= until)
  const landings = readJsonLines(join(data, 'landings.jsonl')).filter(l => !(Date.parse(l.at) > until))
  const gates = gatesOf(landings, name => { try { return readFileSync(join(data, 'landings', name), 'utf8') } catch { return '' } })
  let tasks = []
  try { tasks = tasksOf(JSON.parse(readFileSync(join(data, 'task-times.json'), 'utf8'))).filter(t => !(t.reportedAt > until)) } catch { tasks = [] }
  return { runs, gates, tasks, runsFile, data }
}

/** The report for the days chosen: `{ days, kinds, gates, steps, share }`. */
export function report({ runs, gates, tasks }, { days = 3, day = null, now = Date.now() } = {}) {
  const wanted = day !== null ? new Set([day]) : new Set(Array.from({ length: days }, (_, i) => localDay(now - i * 86400e3)))
  const inDays = x => wanted.has(x.d ?? x.day)
  const keptRuns = runs.filter(inDays)
  const keptGates = gates.filter(inDays)
  const steps = stepShare(tasks, runs, gates).filter(inDays)
  const clean = steps.filter(r => !r.hang && !r.paused)
  const share = [...wanted].sort().map(d => ({ day: d, ...shareOf(clean.filter(r => r.day === d)) }))
  share.push({ day: 'all', ...shareOf(clean) })
  return { days: perDay(keptRuns), kinds: perKind(keptRuns), gates: gateResults(keptGates), steps, share }
}

const h = s => (s / 3600).toFixed(1)
const min = s => (s / 60).toFixed(1)

/** The report as text lines. */
export function textOf(result) {
  const lines = ['Per day: queued runs, time waiting against running, the slot busy, waits (median / p90 / max) and runs that failed.']
  for (const d of result.days) lines.push(`  ${d.day}: ${d.runs} runs | waiting ${h(d.waitS)} h, running ${h(d.runS)} h (${h(d.runNoHangS)} h without hangs), slot busy ${h(d.busyS)} h | wait median ${min(d.waitMedianS)} min, p90 ${min(d.waitP90S)}, max ${min(d.waitMaxS)} | run median ${min(d.runMedianS)} min | failed ${d.failed}, never ran ${d.neverRan}, hangs ${d.hangs}`)
  lines.push('', 'Per kind (runs, wait total / median / p90 in min, run total / median in min, failed):')
  for (const k of result.kinds) lines.push(`  ${k.day} ${k.kind.padEnd(24)} ${String(k.runs).padStart(3)} | wait ${min(k.waitS).padStart(6)} ${min(k.waitMedianS).padStart(5)} ${min(k.waitP90S).padStart(5)} | run ${min(k.runS).padStart(6)} ${min(k.runMedianS).padStart(5)} | failed ${k.failed}`)
  lines.push('', 'Board landing gates:')
  for (const g of result.gates) lines.push(`  ${g.day}: ${g.gates} gates, ${g.landed} landed, ${g.refused} refused`)
  lines.push('', 'Share of a step\'s wall time spent on tests (clean set: no hung run, not paused):')
  for (const s of result.share) lines.push(`  ${s.day}: ${s.tasks} tasks, ${min(s.wallMin * 60)} min wall | waiting ${s.waitPct.toFixed(0)}%, running ${s.runPct.toFixed(0)}%, both ${s.testPct.toFixed(0)}% | median task ${s.medianPct.toFixed(0)}%`)
  return lines
}

function argOf(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const until = argOf(argv, '--until')
  const all = readAll(until === undefined ? {} : { until: Date.parse(until) })
  const result = report(all, { days: Number(argOf(argv, '--days') ?? 3), day: argOf(argv, '--day') ?? null })
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else console.log([`Runs from ${all.runsFile}`, ...textOf(result)].join('\n'))
}
