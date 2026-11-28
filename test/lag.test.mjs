// The lag recorder (chat 1's brief, 2026-11-27): one line a minute in data/perf/lag.jsonl from the limiter's listings and a probe child;
// old lines dropped after 30 days; spikes per hour while work ran, for the retrospective's eighth row.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { culpritsOf, isSpike, keepRecent, kindsOf, lagLine, lagRecorder, linesOf, loadBetween, nvidiaGpu, probeChild, spikesPerHour, SPIKE_LATE_MS, SPIKE_STALL_MS } from '../src/lag.mjs'
import { summaryOf } from '../tools/lag-summary.mjs'

const A = 'aaaaaaaa-1111-2222-3333-444444444444'
const chat = { pid: 200, parent: 100, name: 'claude.exe', commandLine: `D:\\claude.exe --resume=${A}`, created: 20, cpuMs: 1000 }
const bash = { pid: 201, parent: 200, name: 'bash.exe', commandLine: null, created: 21, cpuMs: 0 }
const vitest = { pid: 202, parent: 201, name: 'node.exe', commandLine: 'node node_modules/vitest/vitest.mjs run', created: 22, cpuMs: 0 }
const find = { pid: 300, parent: 299, name: 'find.exe', commandLine: null, created: 30, cpuMs: 0 }
const board = { pid: 400, parent: 1, name: 'node.exe', commandLine: 'node server.mjs', created: 40, cpuMs: 0 }
const probe = { pid: 401, parent: 400, name: 'node.exe', commandLine: 'node src/lagProbe.mjs', created: 41, cpuMs: 0 }
const defender = { pid: 500, parent: 1, name: 'MsMpEng.exe', commandLine: null, created: 50, cpuMs: 0 }
const idle = { pid: 0, parent: 0, name: 'System Idle Process', commandLine: null, created: null, cpuMs: 0 }
const found = [
  { ...chat, key: 'c', parentKey: null }, { ...bash, key: 'b', parentKey: 'c' }, { ...vitest, key: 'v', parentKey: 'b' },
  { ...board, key: 'o', parentKey: null }, { ...probe, key: 'p', parentKey: 'o' },
]
const MIN = 60_000
const T0 = Date.parse('2026-11-28T10:00:00Z')
const at = (one, cpuMs) => ({ ...one, cpuMs })

test('lag: the CPU between two listings: each process\'s cores and the whole PC; a reused pid counts from its own start', () => {
  const before = { at: T0, list: [idle, chat, bash, vitest, defender] }
  const after = { at: T0 + MIN, list: [at(idle, 999_999), at(chat, 1000 + 6000), at(bash, 0), at(vitest, 120_000), at(defender, 30_000), { ...find, cpuMs: 60_000 }] }
  const load = loadBetween(before, after, 24)
  assert.equal(load.cores.get(vitest.pid), 2)
  assert.equal(load.cores.get(find.pid), 1, 'born between the listings: from its start')
  assert.equal(load.cores.has(0), false, 'the idle process is no load')
  assert.equal(load.total, Math.round(1000 * (6000 + 120_000 + 30_000 + 60_000) / (MIN * 24)) / 10)
  const reused = { at: T0 + 2 * MIN, list: [{ ...vitest, created: 99, cpuMs: 3000 }] }
  assert.equal(loadBetween(after, reused, 24).cores.get(vitest.pid), 0.05, 'another process on the same pid starts from 0')
  assert.equal(loadBetween(before, { ...after, at: T0 + 10 * MIN }, 24), null, 'too far apart: no numbers')
  assert.equal(loadBetween(after, before, 24), null)
})

test('lag: kinds: a test run, the board, a chat helper, an orphan (F87)', () => {
  const kinds = kindsOf({ found, adopted: [find], boardPids: [board.pid] })
  assert.equal(kinds.get(vitest.pid), 'test run')
  assert.equal(kinds.get(bash.pid), 'chat helper')
  assert.equal(kinds.get(probe.pid), 'board')
  assert.equal(kinds.get(find.pid), 'orphan')
  assert.equal(kinds.get(chat.pid), 'chat', 'a chat\'s own claude.exe runs on every core: it can be the culprit too')
})

test('lag: the minute\'s line names the busiest project process and the busiest other one; work when the project used over half a core', () => {
  const load = { total: 40, cores: new Map([[vitest.pid, 2], [find.pid, 3], [defender.pid, 1.5], [chat.pid, 0.5]]) }
  const listing = { list: [chat, bash, vitest, find, board, probe, defender], found, adopted: [find] }
  const line = lagLine({ at: T0, level: 'full', probe: { p99: 15, lateMax: 60, stallMax: 0.3 }, load, listing, gpu: 37, boardPids: [board.pid] })
  assert.deepEqual(line, {
    at: '2026-11-28T10:00:00.000Z', level: 'full', p99: 15, lateMax: 60, stallMax: 0.3, cpu: 40, gpu: 37, work: true, projectCores: 5.5,
    top: { name: 'find.exe', pid: find.pid, cores: 3, kind: 'orphan' }, pc: { name: 'MsMpEng.exe', pid: defender.pid, cores: 1.5 },
  })
  const quiet = lagLine({ at: T0, level: 'full', probe: { p99: 15, lateMax: 16, stallMax: 0.3 }, load: { total: 2, cores: new Map([[vitest.pid, 0.2]]) }, listing })
  assert.equal(quiet.work, false)
  assert.equal(lagLine({ at: T0, level: 'full', held: true }).work, true, 'the heavy-run slot taken is work')
})

test('lag: a spike is a tick over 40 ms late or a gap over 8 ms in its work; a line without a probe never is', () => {
  assert.equal(isSpike({ lateMax: SPIKE_LATE_MS + 0.1, stallMax: 0 }), true)
  assert.equal(isSpike({ lateMax: SPIKE_LATE_MS, stallMax: SPIKE_STALL_MS }), false, 'an idle PC (16 ms late, 0.3 ms gaps) is no spike')
  assert.equal(isSpike({ lateMax: 16, stallMax: SPIKE_STALL_MS + 0.1 }), true)
  assert.equal(isSpike({ lateMax: null, stallMax: null }), false)
})

test('lag: spikes per hour count only minutes with a probe while work ran', () => {
  const line = (minute, lateMax, work) => ({ at: new Date(T0 + minute * MIN).toISOString(), lateMax, stallMax: 0, work })
  const lines = [line(0, 100, true), line(1, 10, true), line(2, 10, true), line(3, 100, false), { at: new Date(T0).toISOString(), lateMax: null, stallMax: null, work: true }]
  assert.deepEqual(spikesPerHour(lines), { workMinutes: 3, spikes: 1, perHour: 20 })
  assert.deepEqual(spikesPerHour([]), { workMinutes: 0, spikes: 0, perHour: null })
})

test('lag: the culprits of the spikes, most first; a spike with no project culprit names the PC\'s busiest', () => {
  const spike = (top, pc = null) => ({ lateMax: 100, stallMax: 0, top, pc })
  assert.deepEqual(culpritsOf([spike({ name: 'find.exe', kind: 'orphan' }), spike({ name: 'find.exe', kind: 'orphan' }), spike(null, { name: 'MsMpEng.exe' }), { lateMax: 1, stallMax: 0, top: { name: 'x', kind: 'other' } }]), [
    { kind: 'orphan', name: 'find.exe', spikes: 2 }, { kind: 'not the project', name: 'MsMpEng.exe', spikes: 1 },
  ])
})

test('lag: rotation drops lines older than 30 days and rows that are no line', () => {
  const now = T0
  const old = JSON.stringify({ at: new Date(now - 31 * 24 * 60 * MIN).toISOString() })
  const recent = JSON.stringify({ at: new Date(now - 29 * 24 * 60 * MIN).toISOString() })
  assert.deepEqual(keepRecent(`${old}\n${recent}\nnot json\n`, now), { text: `${recent}\n`, dropped: 2 })
  assert.deepEqual(keepRecent(`${old}\n`, now), { text: '', dropped: 1 })
  assert.deepEqual(linesOf(`${old}\n${recent}\n`, { from: now - 30 * 24 * 60 * MIN }).length, 1)
})

async function recorderOn(t, options) {
  const dir = await mkdtemp(join(tmpdir(), 'lag-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const file = join(dir, 'perf', 'lag.jsonl')
  return { file, recorder: lagRecorder({ file, cores: 24, boardPids: [board.pid], ...options }) }
}

test('lag: the recorder writes a line a minute in Full; in Low no probe, and a line only when the project used over a core', async t => {
  const clock = { now: T0 }
  let level = 'full'
  let probes = 0
  const { file, recorder } = await recorderOn(t, { now: () => clock.now, level: () => level, probe: async () => { probes += 1; return { p99: 15, lateMax: 50, stallMax: 0.2 } }, gpu: async () => 12 })
  recorder.hear({ at: clock.now - MIN, list: [chat, bash, vitest, board, probe], found, adopted: [] })
  recorder.hear({ at: clock.now, list: [chat, bash, at(vitest, 30_000), board, probe], found, adopted: [] })
  const line = await recorder.minute()
  assert.equal(line.top.name, 'node.exe')
  assert.equal(line.top.kind, 'test run')
  assert.equal(line.gpu, 12)
  level = 'low'
  clock.now += MIN
  recorder.hear({ at: clock.now, list: [chat, bash, at(vitest, 40_000), board, probe], found, adopted: [] })
  assert.equal(await recorder.minute(), null, 'Low, the project quiet (1/6 core): nothing written')
  clock.now += MIN
  recorder.hear({ at: clock.now, list: [chat, bash, at(vitest, 40_000), board, probe, { ...find, cpuMs: 90_000 }], found, adopted: [find] })
  const inGame = await recorder.minute()
  assert.equal(probes, 1, 'the probe never runs in Low')
  assert.deepEqual([inGame.level, inGame.p99, inGame.top.name, inGame.top.kind], ['low', null, 'find.exe', 'orphan'])
  const lines = linesOf(await readFile(file, 'utf8'))
  assert.equal(lines.length, 2)
})

test('lag: with no fresh listing the line has no CPU numbers; a failing probe or GPU gives null, never a missing line', async t => {
  const clock = { now: T0 }
  const { recorder } = await recorderOn(t, { now: () => clock.now, probe: async () => { throw new Error('child gone') }, gpu: async () => { throw new Error('no gpu') } })
  recorder.hear({ at: T0 - 10 * MIN, list: [chat], found: [], adopted: [] })
  const line = await recorder.minute()
  assert.equal(line, null, 'no probe and no load: nothing to write')
  const { recorder: second } = await recorderOn(t, { now: () => clock.now, probe: async () => ({ p99: 15, lateMax: 16, stallMax: 0.2 }), gpu: async () => { throw new Error('no gpu') } })
  second.hear({ at: T0 - 10 * MIN, list: [chat], found: [], adopted: [] })
  const stale = await second.minute()
  assert.deepEqual([stale.cpu, stale.gpu, stale.top, stale.p99], [null, null, null, 15])
})

test('lag: the recorder drops old lines at its first minute and once a day after', async t => {
  const clock = { now: T0 }
  const { file, recorder } = await recorderOn(t, { now: () => clock.now, probe: async () => ({ p99: 15, lateMax: 16, stallMax: 0.2 }) })
  await recorder.minute()
  const old = JSON.stringify({ at: new Date(T0 - 40 * 24 * 60 * MIN).toISOString() })
  await writeFile(file, `${old}\n${await readFile(file, 'utf8')}`)
  clock.now += MIN
  await recorder.minute()
  assert.equal(linesOf(await readFile(file, 'utf8')).length, 3, 'not again within the day')
  clock.now += 24 * 60 * MIN
  await recorder.minute()
  assert.equal(linesOf(await readFile(file, 'utf8')).length, 3, 'the old line went, the new one came')
  assert.ok(!(await readFile(file, 'utf8')).includes(old))
})

test('lag: the retrospective\'s row: this week beside last week, marked better or worse', () => {
  const to = T0
  const line = (daysAgo, lateMax) => JSON.stringify({ at: new Date(to - daysAgo * 24 * 60 * MIN).toISOString(), lateMax, stallMax: 0, work: true, top: { name: 'node.exe', kind: 'test run' } })
  const text = [line(1, 100), line(1, 10), line(1, 10), line(1, 10), line(8, 100), line(8, 100), line(8, 10), line(8, 10)].join('\n')
  const summary = summaryOf(text, to)
  assert.equal(summary.row, '| lag spikes per hour while work ran | 15 (1 in 0.1 h) [+] | 30 (2 in 0.1 h) |')
  assert.deepEqual(summary.culprits, [{ kind: 'test run', name: 'node.exe', spikes: 1 }])
  assert.equal(summaryOf('', to).row, '| lag spikes per hour while work ran | not measured | not measured |')
})

test('lag: the GPU from nvidia-smi; with none it is null and never asked again', async () => {
  let calls = 0
  const answer = (error, stdout) => (_cmd, _args, _opts, done) => { calls += 1; done(error, stdout) }
  assert.equal(await nvidiaGpu({ run: answer(null, '37\n') })(), 37)
  const missing = nvidiaGpu({ run: answer(Object.assign(new Error('not found'), { code: 'ENOENT' })) })
  assert.equal(await missing(), null)
  assert.equal(await missing(), null)
  assert.equal(calls, 2, 'the missing one was asked once')
})

test('lag: the probe child measures a second and answers, and is started again after it died', async t => {
  const child = probeChild()
  t.after(() => child.stop())
  const first = await child.run()
  assert.ok(first.ticks >= 50 && first.ticks <= 60, `${first.ticks} ticks`)
  assert.ok(Number.isFinite(first.p99) && Number.isFinite(first.lateMax) && Number.isFinite(first.stallMax))
  child.stop()
  const again = await child.run()
  assert.ok(again.ticks >= 50)
})
