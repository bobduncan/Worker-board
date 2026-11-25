// S0 of the PC plan (.claude/plans/pc-lag-test-speed-plan.md, chat 1, 2026-11-25): the probes and the run-share report that
// measure whether keeping heavy runs off the person's cores takes the stutter away (tools/perf).

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { counterRows, latenessStats, loadStats, quantile, samplerScript, tickLoop } from '../../tools/perf/lag-probe.mjs'
import { CASES, MASKS, caseOf, folderOf, loadCommand, queuedCaseArgs, tableOf } from '../../tools/perf/matrix.mjs'
import { gateResults, gatesOf, groupOf, parseRuns, perDay, readAll, report, shareOf, stepShare, unionMs } from '../../tools/perf/run-share.mjs'
import { clipArgs, edgeArgs, frameStats, serveProbe } from '../../tools/perf/video-probe/video-probe.mjs'
import { lockPath } from '../../tools/one-at-a-time.mjs'

test('lag probe: p99 lateness and the share of late ticks, over planted lateness; a stall is a gap of over 1 ms in the work', () => {
  const lates = [...Array(95).fill(2), 9, 10, 12, 20, 30]
  const stats = latenessStats(lates, [0.1, 0.2, 1.5, 0.3])
  assert.equal(stats.ticks, 100)
  assert.equal(stats.p50, 2)
  assert.equal(stats.p99, 20)
  assert.equal(stats.max, 30)
  assert.equal(stats.latePct, 5, 'over 8 ms: 9, 10, 12, 20, 30')
  assert.equal(latenessStats([8, 8, 8]).latePct, 0, 'exactly 8 ms is not late')
  assert.equal(stats.stallPct, 25)
  assert.equal(stats.stallMax, 1.5)
  assert.equal(quantile([], 0.99), 0)
})

test('lag probe: the sampler reads LP0-3, the whole PC and Defender by the performance classes, and its lines become rows', () => {
  const script = samplerScript(5)
  assert.match(script, /Win32_PerfFormattedData_PerfOS_Processor/)
  assert.match(script, /Name='MsMpEng'/)
  assert.match(script, /Start-Sleep -Seconds 5/)
  const text = [
    'WARNING: noise',
    JSON.stringify({ at: 'x', lp0: 10, lp1: 20, lp2: 30, lp3: 40, lp4: 99, lp_Total: 55, msmpeng: 250 }),
    JSON.stringify({ at: 'y', lp0: 0, lp1: 0, lp2: 0, lp3: 100, lp_Total: 20, msmpeng: 0 }),
    '{"no":"total"}',
  ].join('\r\n')
  const rows = counterRows(text)
  assert.deepEqual(rows, [{ lp: [10, 20, 30, 40], total: 55, msmpengCores: 2.5 }, { lp: [0, 0, 0, 100], total: 20, msmpengCores: 0 }])
  assert.deepEqual(loadStats(rows), { samples: 2, lp03Mean: 25, lp03Max: 100, totalMean: 37.5, msmpengMean: 1.3, msmpengMax: 2.5 })
})

test('lag probe: a short real loop ticks 60 times a second and stops when asked', async () => {
  const run = await tickLoop(0.5)
  assert.ok(run.lates.length >= 28 && run.lates.length <= 30, `${run.lates.length} ticks`)
  assert.ok(run.stalls.every(gap => gap >= 0))
  let calls = 0
  const stopped = await tickLoop(5, { stopped: () => ++calls > 3 })
  assert.equal(stopped.lates.length, 3)
})

test('video probe: dropped frames and the gaps between shown frames; the server serves the page, the clip by range, and takes the result', async t => {
  assert.deepEqual(frameStats({ dropped: 3, total: 600, gaps: [...Array(98).fill(16.7), 30, 50] }), { dropped: 3, total: 600, droppedPct: 0.5, gapP99: 30, gapMax: 50, hitches: 2 })
  assert.equal(frameStats({}).droppedPct, 0)
  assert.deepEqual(clipArgs('out.mp4').slice(-1), ['out.mp4'])
  assert.ok(clipArgs('x').includes('testsrc2=size=1920x1080:rate=60'))
  const args = edgeArgs('http://127.0.0.1:1/', 'C:/p', 30)
  assert.ok(args.includes('--user-data-dir=C:/p'))
  assert.ok(args.includes('--app=http://127.0.0.1:1/?seconds=30'))
  const clip = join(import.meta.dirname, 'perfProbes.test.mjs')
  const served = await serveProbe({ clip })
  t.after(() => served.close())
  assert.match(served.url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
  const page = await fetch(served.url)
  assert.match(await page.text(), /requestVideoFrameCallback/)
  const part = await fetch(`${served.url}clip.mp4`, { headers: { range: 'bytes=0-9' } })
  assert.equal(part.status, 206)
  assert.equal((await part.arrayBuffer()).byteLength, 10)
  assert.equal((await fetch(`${served.url}elsewhere`)).status, 404)
  await fetch(`${served.url}result`, { method: 'POST', body: JSON.stringify({ dropped: 1, total: 60, gaps: [16] }) })
  assert.deepEqual(await served.result, { dropped: 1, total: 60, gaps: [16] })
})

test('matrix: the cases a-h, a pinned load starts under start /AFFINITY with its mask (Low at Idle), each case queued as an ordinary run', () => {
  assert.deepEqual(CASES.map(one => one.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  assert.deepEqual(MASKS, { work: 'FFFFF0', eCores: 'FF0000', low: 'C00000' })
  assert.equal(loadCommand(caseOf('a')), null)
  assert.equal(loadCommand(caseOf('b')), 'npm run test:screens')
  assert.equal(loadCommand(caseOf('c')), 'start "" /B /WAIT /AFFINITY FFFFF0 cmd /d /s /c "npm run test:screens"')
  assert.equal(loadCommand(caseOf('d')), 'start "" /B /WAIT /AFFINITY FF0000 cmd /d /s /c "npm run test:screens"')
  assert.equal(loadCommand(caseOf('g')), 'start "" /B /WAIT /AFFINITY FFFFF0 cmd /d /s /c "npm test"')
  assert.match(loadCommand(caseOf('h')), /^start "" \/B \/WAIT \/LOW \/AFFINITY C00000 cmd \/d \/s \/c "node tools\/visual\/getChromium\.mjs && npx vitest run -c vitest\.screens\.config\.ts"$/)
  assert.equal(folderOf(caseOf('e'), { game: 'G', card: 'C' }), 'C')
  assert.equal(folderOf(caseOf('f'), { board: 'B' }), 'B')
  const args = queuedCaseArgs('c', { out: 'C:/d/s0.jsonl', game: 'C:/Web/lava tactics', card: undefined })
  assert.match(args[0], /one-at-a-time\.mjs$/)
  assert.equal(args[1], 'perf-s0-c')
  assert.equal(args[2], '--')
  assert.match(args[3], /matrix\.mjs" --case c --out C:\/d\/s0\.jsonl --game "C:\/Web\/lava tactics"$/)
  assert.doesNotMatch(args.join(' '), /HEAVY_RUN_FIRST/, 'never ahead of a landing gate')
  assert.match(groupOf({ label: 'perf-s0-c', cwd: 'C:/x' }), /perf probe/)
})

test('matrix: the table names each case with its probe numbers, the frames dropped and the load\'s own run time', () => {
  const table = tableOf([
    { case: 'a', what: 'idle', p99: 15.8, latePct: 3, stallP99: 0.2, stallPct: 0.5, lp03Mean: 4, lp03Max: 20, totalMean: 6, msmpengMean: 0.1, msmpengMax: 0.4, dropped: 0, frames: 10800 },
    { case: 'f', what: 'a board gate as today', p99: 30, latePct: 40, lp03Mean: 90, lp03Max: 100, totalMean: 95, msmpengMean: 2, msmpengMax: 4.5, loadRunS: 1320, loadExit: 0 },
  ])
  assert.match(table, /^\| case \| what \| p99 late ms/)
  assert.match(table, /\| a \| idle \| 15\.8 \| 3 \| 0\.2 \| 0\.5 \| 4 \/ 20 \| 6 \| 0\.1 \/ 0\.4 \| 0 of 10800 \|  \|  \|/)
  assert.match(table, /\| f \| a board gate as today \| 30 \| 40 \|  \|  \| 90 \/ 100 \| 95 \| 2 \/ 4\.5 \|  \| 1320 \| 0 \|/)
})

const at = (local, extra = {}) => ({ at: new Date(local).toISOString(), ...extra })

test('run share: wait against run per day, the slot busy counted once, kinds, gates landed and refused, the test share of a step', () => {
  const lines = [
    at('2026-11-25T10:00:00', { label: 'check', cwd: 'C:/Web/lava-tactics-b7', waitedS: 600, ranS: 120, exit: 0 }),
    at('2026-11-25T10:05:00', { label: 'check', cwd: 'C:/Web/lava-tactics-b7', waitedS: 300, ranS: 60, exit: 1 }),
    at('2026-11-25T10:00:00', { label: 'test', cwd: 'C:/T/land-gate-1', waitedS: 0, ranS: 900, exit: 0 }),
    at('2026-11-25T12:00:00', { label: 'check', cwd: 'C:/Web/lava-tactics-b8', waitedS: 0, ranS: 8 * 3600, exit: 0 }),
    'not json',
  ]
  const runs = parseRuns(lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'))
  assert.equal(runs.length, 4)
  const [day] = perDay(runs)
  assert.equal(day.day, '2026-11-25')
  assert.equal(day.waitS, 900)
  assert.equal(day.runS, 180 + 900 + 8 * 3600)
  assert.equal(day.runNoHangS, 180 + 900, 'a run over 120 min is a hang')
  assert.equal(day.hangs, 1)
  assert.equal(day.failed, 1)
  // Busy: the gate 10:00-10:15 holds the check 10:10-10:12 inside it, and the second check 10:10-10:11: 15 min, plus the 8 h.
  assert.equal(day.busyS, 900 + 8 * 3600)
  assert.equal(unionMs([[0, 10], [5, 15], [20, 30]]), 25)
  const gates = gatesOf([
    { gateLog: 'C:\\b\\data\\landings\\20261125-100000-b7-shop.log', branch: 'b7-shop', at: new Date('2026-11-25T10:20:00').toISOString(), result: 'landed' },
    { gateLog: 'C:\\b\\data\\landings\\20261125-110000-b9-x.log', branch: 'b9-x', at: new Date('2026-11-25T11:30:00').toISOString(), result: 'refused' },
    { gateLog: null, branch: 'b10', result: 'refused' },
  ], name => (name.startsWith('20261125-100000') ? 'one-at-a-time: test runs now (waited 120 s)' : ''))
  assert.equal(gates.length, 2)
  assert.equal(gates[0].waitS, 120)
  assert.deepEqual(gateResults(gates), [{ day: '2026-11-25', gates: 2, landed: 1, refused: 1 }])
  const tasks = [{ step: 'B7', area: 'game', startedAt: new Date('2026-11-25T09:50:00').getTime(), reportedAt: new Date('2026-11-25T10:30:00').getTime(), workMs: 35 * 6e4 }]
  const [row] = stepShare(tasks, runs, gates)
  assert.equal(row.runs, 2)
  assert.equal(row.gates, 1)
  assert.equal(Math.round(row.waitMin), 10, 'its checks wait 10:00-10:10 and 10:05-10:10')
  assert.equal(Math.round(row.waitMin + row.runMin), 20, 'with its gate (waits 10:00-10:02, runs 10:02-10:20) and checks (run 10:10-10:12): 10:00-10:20')
  assert.equal(shareOf([row]).tasks, 1)
  assert.equal(Math.round(shareOf([row]).testPct), 50, '20 of its 40 min wall time')
})

// The plan's baseline (chat 1, 2026-11-25 19:5x): 8 of 15 gates refused on 11-25; a step's test share 54% over 11-23 to 11-25
// and 71% on 11-25. Read from this PC's own logs, so only where they are there.
const runsFile = `${lockPath()}.runs.jsonl`
const hasBaseline = existsSync(runsFile) && readFileSync(runsFile, 'utf8').includes('"at":"2026-11-23')
test('run share reproduces the plan\'s baseline from this PC\'s logs', { skip: hasBaseline ? false : 'no 11-23..25 run log on this PC' }, () => {
  const all = readAll({ until: Date.parse('2026-11-25T19:57:00+01:00') })
  const one = report(all, { day: '2026-11-25' })
  assert.deepEqual(one.gates.map(g => [g.gates, g.refused]), [[15, 8]])
  assert.equal(Math.round(one.share.find(s => s.day === 'all').testPct), 71)
  const three = report(all, { days: 3, now: Date.parse('2026-11-25T19:57:00+01:00') })
  assert.equal(Math.round(three.share.find(s => s.day === 'all').testPct), 54)
  assert.ok(tmpdir())
})
