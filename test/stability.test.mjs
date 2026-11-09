// Stability (2026-11-05, task 2): the per-minute record of idle-with-work (data/ready-minutes.jsonl). The fixture is the shape of
// the night of 2026-11-05: Workers 3 and 4 free with a Sonnet ban in their why, B1050 (a Quality Assurance step), B1042, B1046,
// B1048 and B1043 ready, copied as literals from the board's lanes and the work store.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import test from 'node:test'

import { gapsOf, parseHistory } from '../src/history.mjs'
import { MINUTES_KEEP_MS, NO_PROOF_WHY, alarmsOf, dayLineOf, finishOf, idleMinutesOf, interventionsOf, mergedOutbox, minuteKeeper, measuredOf, minuteOf, pausesOf, recordStability, tailLines, viewOf } from '../src/stability.mjs'
import { parseItem } from '../src/work/item.mjs'

const DAY = 24 * 60 * 60_000
const NOW = new Date(2026, 10, 5, 22, 40).getTime()
const BAN = 'free; gets no sonnet steps: its set failed at 21:12, until 23:12 (the model menu did not answer)'

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const sonnet = { Model: ['sonnet · routine work'] }
const step = (id, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'refined', Since: '2026-11-05 21:00', Refined: 'ready', ...more }, { ...sonnet, ...sections })
const items = new Map([
  ['B1050', step('B1050', { Title: 'Quality Assurance: B1021 Fix of X148', Checks: 'B1021', 'Not by': 'Worker 2, Worker 1' }, { Context: ['  Built by: Worker 2, Worker 1'] })],
  ['B1042', step('B1042', { Title: 'Fix of X152: chain-long must find "Tried before:"', Priority: 'fix', Goal: 'G15' })],
  ['B1046', step('B1046', { Title: 'Fix: left/right stairs', Goal: 'G60', 'Fix of': 'B1031' })],
  ['B1048', step('B1048', { Title: 'Fix: Standard map 71 of 75', Goal: 'G60', 'Fix of': 'B1018' })],
  ['B1043', step('B1043', { Title: 'Fix: Judged at play size', Goal: 'G29', 'Fix of': 'B851' })],
])
const entry = (id, more = {}) => ({ id, rank: 1, keptFor: null, keptUntil: null, pinned: null, prefers: null, ...more })
const READY = [entry('B1050', { rank: -1, notBy: ['Worker 2', 'Worker 1'] }), entry('B1042', { rank: 0 }), entry('B1046', { rank: 0 }), entry('B1048', { rank: 0 }), entry('B1043', { rank: 0 })]
const lane = (name, why, more = {}) => ({ name, state: 'free', isMain: false, isLeftover: false, isRunning: true, model: 'claude-sonnet-5-5', handover: { state: 'free', why, step: null, asked: null }, ...more })
const stateOf = ({ lanes = [lane('Worker 3', BAN), lane('Worker 4', BAN)], ready = READY } = {}) => ({ chats: lanes, readyList: { ready, held: [] } })
const IDS = ['B1050', 'B1042', 'B1046', 'B1048', 'B1043']

test('both free workers are banned from Sonnet and every ready step is Sonnet: nothing they could take', () => {
  assert.deepEqual(minuteOf(stateOf(), items, '', NOW), { at: NOW, free: [] })
})

test('without the ban text each free worker could take all five ready steps', () => {
  const state = stateOf({ lanes: [lane('Worker 3', null), lane('Worker 4', 'free')] })
  assert.deepEqual(minuteOf(state, items, '', NOW), { at: NOW, free: [{ chat: 'Worker 3', could: IDS }, { chat: 'Worker 4', could: IDS }] })
})

test('a ban on another family leaves a Sonnet step open; the ban is read from the words "gets no <family> steps"', () => {
  const opusBan = 'free; gets no opus steps: its set failed at 21:12, until 23:12 (x)'
  assert.deepEqual(minuteOf(stateOf({ lanes: [lane('Worker 3', opusBan)] }), items, '', NOW).free[0].could, IDS)
})

test('a step kept for another chat is not offered; a step kept for the lane is', () => {
  const kept = READY.map(one => (one.id === 'B1046' ? { ...one, keptFor: 'Worker 4', pinned: 'Worker 4' } : one))
  const done = minuteOf(stateOf({ lanes: [lane('Worker 3', null), lane('Worker 4', null)], ready: kept }), items, '', NOW)
  assert.deepEqual(done.free[0], { chat: 'Worker 3', could: ['B1050', 'B1042', 'B1048', 'B1043'] })
  assert.deepEqual(done.free[1], { chat: 'Worker 4', could: IDS })
})

test('a step with the lane in its notBy is excluded for that lane only', () => {
  const barred = READY.map(one => (one.id === 'B1050' ? { ...one, notBy: ['Worker 3'] } : one))
  const done = minuteOf(stateOf({ lanes: [lane('Worker 3', null), lane('Worker 4', null)], ready: barred }), items, '', NOW)
  assert.deepEqual(done.free[0].could, ['B1042', 'B1046', 'B1048', 'B1043'])
  assert.deepEqual(done.free[1].could, IDS)
})

test('a lane that is not free in the hand-over (working, held), a main chat and a step missing from the store are left out', () => {
  const lanes = [lane('Worker 1', null, { handover: { state: 'working', why: null } }), lane('Worker 2', null, { handover: { state: 'held', why: 'paused' } }), lane('Main', null, { isMain: true }), lane('Worker 5', null, { handover: null }), lane('Worker 3', null)]
  const done = minuteOf(stateOf({ lanes, ready: [...READY, entry('B9999')] }), items, '', NOW)
  assert.deepEqual(done, { at: NOW, free: [{ chat: 'Worker 3', could: IDS }] })
})

test('an empty minute (nothing ready, or no state) writes { at, free: [] }', () => {
  assert.deepEqual(minuteOf(stateOf({ ready: [] }), items, '', NOW), { at: NOW, free: [] })
  assert.deepEqual(minuteOf({}, items, '', NOW), { at: NOW, free: [] })
})

test('the writer appends one line a minute and prunes to 31 days at the first write of a day only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ready-minutes-'))
  try {
    const target = join(dir, 'ready-minutes.jsonl')
    const old = { at: NOW - MINUTES_KEEP_MS - 60_000, free: [] }
    const edge = { at: NOW - MINUTES_KEEP_MS + 60_000, free: [{ chat: 'Worker 3', could: ['B1'] }] }
    const recent = { at: NOW - DAY, free: [] }
    await writeFile(target, [old, edge, recent].map(one => JSON.stringify(one)).join('\n') + '\n')
    let now = NOW
    const keep = minuteKeeper({ file: target, clock: () => now })
    const state = stateOf({ lanes: [lane('Worker 3', null)] })
    await keep(state, items)
    const lines = async () => (await readFile(target, 'utf8')).trim().split('\n').map(one => JSON.parse(one))
    assert.deepEqual(await lines(), [edge, recent, { at: NOW, free: [{ chat: 'Worker 3', could: IDS }] }])
    // The same day: an old line that turns up is left alone (the file is not read again for each minute).
    await writeFile(target, `${JSON.stringify(old)}\n`, { flag: 'a' })
    now = NOW + 60_000
    await keep(stateOf(), items)
    assert.equal((await lines()).length, 5)
    assert.deepEqual((await lines()).at(-1), { at: NOW + 60_000, free: [] })
    // The next day: pruned again; the line that was 31 days less a minute old a day ago has aged out now.
    now = NOW + DAY + 2 * 60_000
    await keep(stateOf(), items)
    assert.deepEqual((await lines()).map(one => one.at), [recent.at, NOW, NOW + 60_000, now])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// Task 3 (2026-11-05): the day line. The records are trimmed copies of the board's own from the night of 2026-11-05
// (test/fixtures/stability/: history.jsonl, wakes.json, reports.json, landings.jsonl, outbox.jsonl, the incidents X148 and
// X152-X161). The person's actions log did not exist that night (task 1 was not on the board yet): its fixture is written
// below from what the outbox shows (a `resume` to Main at 20:27:36 is the board answering the person's Resume all).

const FIXTURES = new URL('./fixtures/stability/', import.meta.url)
const text = name => readFileSync(new URL(name, FIXTURES), 'utf8')
const jsonl = name => text(name).split('\n').filter(Boolean).map(line => JSON.parse(line))
const t = (hour, minute, second = 0, day = 5) => new Date(2026, 10, day, hour, minute, second).getTime()
const TODAY = '2026-11-05'
const MIN = 60_000

const history = parseHistory(text('history.jsonl'))
const wakes = JSON.parse(text('wakes.json'))
const reports = JSON.parse(text('reports.json'))
const landings = jsonl('landings.jsonl')
const outbox = jsonl('outbox.jsonl')
const incidents = ['X148', 'X152', 'X153', 'X154', 'X155', 'X156', 'X157', 'X158', 'X159', 'X160', 'X161'].map(id => parseItem(text(`${id}.md`)))
const act = (action, at) => ({ at, by: 'person', via: 'work', action, id: null })
// The person paused at 20:15 and pressed Resume all at 20:27:36 (the outbox's `resume` to Main, delivered 20:27:38).
const OWN_PAUSE = [act('pause-all', t(20, 15, 3)), act('resume-all', t(20, 27, 36))]
const night = (more = {}) => interventionsOf({ actions: OWN_PAUSE, landings, reports, history, wakes, outbox, day: TODAY, ...more })
const clock = at => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

test('tonight: five starts in the evening have no proof of who started them: unsure, no intervention; the 20:27 Resume all is not one', () => {
  const { interventions, unsure } = night()
  assert.equal(interventions.some(one => one.kind === 'resume-all'), false, 'the person ended their own pause')
  const evening = unsure.filter(one => one.at >= t(20, 0) && one.what.includes(' started at '))
  assert.deepEqual(evening.map(one => `${clock(one.at)} ${one.kind} ${one.what.split(' started ')[0]}`), [
    '21:37:13 woke-outside Worker 2',
    '21:37:45 woke-outside Worker 1',
    '21:37:49 woke-outside Worker 5',
    '21:46:28 woke-outside Worker 4',
    '22:45:20 woke-outside Worker 3',
  ])
  for (const one of evening) assert.equal(one.why, NO_PROOF_WHY)
  assert.equal(NO_PROOF_WHY, "no record shows who started it (the person, a chat's message or the app)")
  // The records show runs began and nothing of the board reached those chats (no wake attempt, no outbox record in the 5 minutes
  // before at ANY of its times); that does not prove the person did it, so it is not an intervention. 0 interventions that day.
  assert.deepEqual(interventions, [])
})

test('the Advisor began a run at 08:21 with only that chat started: not an app restart, and the records cannot tell a wake from the person opening it', () => {
  const { interventions, unsure } = night()
  assert.equal(interventions.some(one => one.kind === 'app-restart'), false, 'Worker 1 and the other lanes still ran the night before (the runBefore of their 20:33 wake)')
  const morning = unsure.filter(one => one.at < t(20, 0))
  assert.deepEqual(morning.map(one => `${clock(one.at)} ${one.kind}`), ['08:21:51 woke-outside'])
  assert.match(morning[0].what, /^Advisor began a run/)
  assert.match(morning[0].why, /history does not track this chat/)
})

test('a lone start with no proof is unsure whether or not the history tracks the chat; the chat the history does not track says so', () => {
  const run = t(16, 0, 30)
  const base = { reports: { reports: { Advisor: { run, state: 'idle' } } }, wakes: { wakes: { Advisor: [{ spell: 1, attempts: [] }] } }, day: TODAY }
  const other = [{ at: t(15, 0), chat: 'Worker 1', state: 'free' }]
  const none = interventionsOf(base)
  assert.deepEqual([none.interventions, none.unsure.map(one => one.kind)], [[], ['woke-outside']], 'no history at all')
  assert.equal(none.unsure[0].why, NO_PROOF_WHY)
  const unknown = interventionsOf({ ...base, history: other })
  assert.deepEqual(unknown.interventions, [])
  assert.deepEqual(unknown.unsure.map(one => one.kind), ['woke-outside'])
  assert.match(unknown.unsure[0].why, /history does not track this chat/)
  for (const given of [{ history: [{ at: t(15, 0), chat: 'Advisor', state: 'free' }] }, { history: other, lanes: ['Advisor'] }]) {
    const tracked = interventionsOf({ ...base, ...given })
    assert.deepEqual([tracked.interventions, tracked.unsure.map(one => one.why)], [[], [NO_PROOF_WHY]])
  }
})

test('a message or clear of the board is delivered after it was put: ANY of its times in the 5 minutes before the start reaches the chat', () => {
  const run = t(17, 0, 30)
  const reportsOf = { reports: { 'Worker 3': { run, state: 'idle' } } }
  const base = { 'Worker 3': [{ spell: 1, attempts: [] }] }
  const kinds = box => interventionsOf({ reports: reportsOf, wakes: { wakes: base }, outbox: box, day: TODAY }).unsure.map(one => one.kind)
  const late = { id: 'a', at: run - 9 * MIN, to: 'Worker 3', command: 'handover', state: 'delivered' }
  assert.deepEqual(kinds([late]), ['woke-outside'], 'put 9 minutes before, nothing else: not reached')
  assert.deepEqual(kinds([{ ...late, deliveredAt: run - 20_000 }]), [], 'delivered 20 s before')
  assert.deepEqual(kinds([{ ...late, settledAt: run - 20_000 }]), [])
  assert.deepEqual(kinds([{ ...late, outcome: { typedAt: run - 30_000 } }]), [])
  assert.deepEqual(kinds([{ ...late, outcome: { enteredAt: run - 25_000 } }]), [])
  assert.deepEqual(kinds([{ ...late, takenAt: run - 40_000 }]), [])
  assert.deepEqual(kinds([{ ...late, stages: [{ stage: 'log-saved', at: run - 3 * MIN }] }]), [], 'a stage of a clear')
  assert.deepEqual(kinds([{ ...late, deliveredAt: run + 60_000 }]), ['woke-outside'], 'delivered after the start: it did not start it')
  assert.deepEqual(kinds([{ ...late, state: 'dropped', deliveredAt: run - 20_000 }]), ['woke-outside'])
  // A resume to Main that names the chat counts by its delivery as well.
  assert.deepEqual(kinds([{ id: 'r', at: run - 12 * MIN, to: 'Main', command: 'resume', text: 'resume\nNot running: Worker 3.', state: 'delivered', deliveredAt: run - 2 * MIN }]), [])
})

test('tonight the clears of Workers 1 and 5 are delivered after their starts at 21:37: they did not start them', () => {
  const clear = outbox.find(one => one.id.startsWith('9dcc3f'))
  assert.ok(clear.takenAt > t(21, 38) && clear.deliveredAt > t(21, 38, 40), 'the clear of Worker 1: taken 21:38:42, delivered 21:38:50')
  assert.equal(night().unsure.filter(one => one.at >= t(21, 37) && one.at < t(21, 38)).length, 3, 'still three starts with no proof (unsure)')
})

test('what an earlier pass of the day found stays, of every kind and unsure too, after the records move on', () => {
  const found = [
    { at: t(9, 0), kind: 'resume-all', what: 'Resume all, ending a pause that was not yours' },
    { at: t(10, 0), kind: 'restart-by-hand', what: 'The board was started by hand, with no landing around it' },
    { at: t(11, 0), kind: 'woke-outside', what: 'Worker 2 was started at 11:00 with no board wake or message before it (its run began then)' },
    { at: t(12, 0), kind: 'rollback', what: 'x was rolled back (rolled back: y)' },
    { at: t(13, 0), kind: 'open-its-chat', what: 'Q1 asked you to open a chat, and you answered' },
    { at: t(14, 0), kind: 'app-restart', what: 'Every chat started a new run within 2 minutes' },
    { at: t(8, 0, 0, 4), kind: 'woke-outside', what: 'a finding of another day is not kept' },
  ]
  const doubt = [{ at: t(15, 0), kind: 'woke-outside', what: 'Worker 1 went from interrupted to working', why: 'w' }, { at: t(8, 0, 0, 4), kind: 'woke-outside', what: 'other day', why: 'w' }]
  // The reports, the actions, the landings and the stop have all moved on: nothing of them is left.
  const later = interventionsOf({ reports: { reports: {} }, wakes: { wakes: {} }, kept: found, keptUnsure: doubt, day: TODAY })
  assert.deepEqual(later.interventions.map(one => one.kind), ['resume-all', 'restart-by-hand', 'woke-outside', 'rollback', 'open-its-chat', 'app-restart'])
  assert.deepEqual(later.unsure.map(one => one.at), [t(15, 0)])
  // A second pass over the same records and the same kept findings does not double them.
  const again = interventionsOf({ reports: { reports: {} }, wakes: { wakes: {} }, kept: later.interventions, keptUnsure: later.unsure, day: TODAY })
  assert.deepEqual(again, later)
  // An unsure finding that the records later prove is a finding only.
  const proved = interventionsOf({ kept: [{ ...doubt[0] }], keptUnsure: doubt, day: TODAY })
  assert.deepEqual(proved.unsure, [])
  assert.equal(proved.interventions.length, 1)
})

test('a woke-outside found before an app restart was seen whole becomes part of it', () => {
  const kept = [{ at: t(15, 0, 5), kind: 'woke-outside', what: 'Main was started at 15:00 with no board wake or message before it (its run began then)' }]
  const live = { reports: { Main: { run: t(15, 0, 5), state: 'idle' }, 'Worker 1': { run: t(15, 0, 40), state: 'idle' } } }
  const known = { wakes: { Main: [{ spell: 1, attempts: [] }], 'Worker 1': [{ spell: 1, attempts: [] }] } }
  assert.deepEqual(interventionsOf({ reports: live, wakes: known, kept, day: TODAY }).interventions.map(one => one.kind), ['app-restart'])
  assert.deepEqual(interventionsOf({ reports: { reports: {} }, wakes: known, kept, day: TODAY }).interventions.map(one => one.kind), ['woke-outside'])
})

test('the board starting Main and Advisor at 21:20 and every chat at 20:27 (a wake of the whole app) are not findings', () => {
  assert.equal(night().interventions.some(one => /Main/.test(one.what)), false)
  assert.equal(night().interventions.some(one => one.at >= t(20, 27) && one.at <= t(20, 36)), false, 'the 20:27 launch and the resume explain 20:27-20:34')
})

test('a Resume all with no pause of the person before it is an intervention; one after a pause of the person is not; a second one is', () => {
  const lone = interventionsOf({ actions: [act('resume-all', t(9, 0))], day: TODAY })
  assert.deepEqual(lone.interventions.map(one => one.kind), ['resume-all'])
  const own = interventionsOf({ actions: [act('pause-all', t(9, 0)), act('resume-all', t(9, 5))], day: TODAY })
  assert.deepEqual(own.interventions, [])
  const twice = interventionsOf({ actions: [act('pause-all', t(9, 0)), act('resume-all', t(9, 5)), act('resume-all', t(10, 0))], day: TODAY })
  assert.deepEqual(twice.interventions.map(one => one.at), [t(10, 0)])
  const server = interventionsOf({ actions: [{ ...act('resume-all', t(9, 0)), by: 'server' }], day: TODAY })
  assert.deepEqual(server.interventions, [], 'only the person\'s actions count')
})

test('a rollback of a landing is an intervention; a landing that held is not', () => {
  const rolled = [...landings, { at: new Date(t(21, 10)).toISOString(), branch: 'bad-branch', result: 'rolled back: the trial failed' }]
  const { interventions } = interventionsOf({ landings: rolled, day: TODAY })
  assert.deepEqual(interventions.map(one => `${one.kind} ${clock(one.at)}`), ['rollback 21:10:00'])
  assert.match(interventions[0].what, /bad-branch/)
  assert.deepEqual(interventionsOf({ landings, day: TODAY }).interventions, [])
})

test('a board started by hand is an intervention unless a landing is within 5 minutes; a keeper start is not; an unknown start is unsure', () => {
  const stop = (start, to) => ({ from: to - 120_000, to, why: 'unknown', start })
  const hand = interventionsOf({ lastStop: stop('hand', t(14, 0)), landings, day: TODAY })
  assert.deepEqual(hand.interventions.map(one => one.kind), ['restart-by-hand'])
  const landed = interventionsOf({ lastStop: stop('hand', Date.parse(landings[1].at) + 4 * MIN), landings, day: TODAY })
  assert.deepEqual(landed.interventions, [])
  assert.deepEqual(interventionsOf({ lastStop: stop('keeper', t(14, 0)), landings, day: TODAY }), { interventions: [], unsure: [] })
  const unknown = interventionsOf({ lastStop: stop(null, t(14, 0)), landings, day: TODAY })
  assert.deepEqual(unknown.interventions, [])
  assert.equal(unknown.unsure[0].kind, 'restart-by-hand')
  assert.match(unknown.unsure[0].why, /hand or keeper/)
  // The board shows a stop for 15 minutes only: once made, the finding stays through the day line's `kept`.
  const kept = hand.interventions
  assert.deepEqual(interventionsOf({ lastStop: null, kept, day: TODAY }).interventions, kept)
  assert.deepEqual(interventionsOf({ lastStop: stop('hand', t(14, 0)), kept, day: TODAY }).interventions.length, 1)
})

test('every chat the app starts again that starts a run within 2 minutes, with nothing of the board before it, is one app restart', () => {
  const live = { reports: { Main: { run: t(15, 0, 5), state: 'idle' }, 'Worker 1': { run: t(15, 0, 40), state: 'idle' }, 'Worker 2': { run: t(15, 1, 20), state: 'idle' } } }
  const known = { wakes: { Main: [{ spell: 1, attempts: [] }], 'Worker 1': [{ spell: 1, attempts: [] }], 'Worker 2': [{ spell: 1, attempts: [] }] } }
  const done = interventionsOf({ reports: live, wakes: known, day: TODAY })
  assert.deepEqual(done.interventions.map(one => `${one.kind} ${clock(one.at)}`), ['app-restart 15:00:05'], 'one finding, not three woke-outside')
  assert.deepEqual(done.unsure, [], 'the starts inside the restart are folded into it, not left unsure')
  // An unsure start found earlier (kept) that falls inside a restart is folded too; one outside it stays unsure.
  const keptUnsure = [{ at: t(15, 0, 40), kind: 'woke-outside', what: 'x', why: 'y' }, { at: t(11, 0), kind: 'woke-outside', what: 'z', why: 'y' }]
  assert.deepEqual(interventionsOf({ reports: live, wakes: known, keptUnsure, day: TODAY }).unsure.map(one => one.at), [t(11, 0)])
  // A landing within 5 minutes explains it (the board restarted the app itself).
  const landed = interventionsOf({ reports: live, wakes: known, landings: [{ at: new Date(t(15, 3)).toISOString(), result: 'landed' }], day: TODAY })
  assert.deepEqual(landed.interventions, [])
  // Not every chat: each start is unsure on its own.
  const partial = interventionsOf({ reports: live, wakes: known, live: ['Main', 'Worker 1', 'Worker 2', 'Worker 3'], day: TODAY })
  assert.deepEqual(partial.interventions, [], 'a start with no proof is no intervention')
  assert.deepEqual(partial.unsure.map(one => one.kind), ['woke-outside', 'woke-outside', 'woke-outside'])
  // Found once, kept after the reports move on (a chat's report holds only its newest run).
  const kept = done.interventions
  const later = interventionsOf({ reports: { reports: {} }, wakes: known, kept, day: TODAY })
  assert.deepEqual(later.interventions.map(one => one.kind), ['app-restart'])
})

test('a start the board explains is no finding: its own attempt, a message, a resume that names the chat; a different chat of the same number is not named', () => {
  const run = t(16, 0, 30)
  const reportsOf = { reports: { 'Worker 1': { run, state: 'idle' } } }
  const base = { 'Worker 1': [{ spell: 1, attempts: [] }] }
  const kinds = args => interventionsOf({ reports: reportsOf, day: TODAY, ...args }).unsure.map(one => one.kind)
  assert.deepEqual(kinds({ wakes: { wakes: base } }), ['woke-outside'])
  assert.deepEqual(kinds({ wakes: { wakes: { 'Worker 1': [{ spell: 1, attempts: [{ at: run - 30_000, by: 'Main', verdict: 'woke' }] }] } } }), [])
  assert.deepEqual(kinds({ wakes: { wakes: base }, outbox: [{ id: 'a', at: run - 2 * MIN, to: 'Worker 1', state: 'delivered' }] }), [])
  assert.deepEqual(kinds({ wakes: { wakes: base }, outbox: [{ id: 'a', at: run - 2 * MIN, to: 'Worker 1', state: 'dropped' }] }), ['woke-outside'], 'a dropped message reached nobody')
  assert.deepEqual(kinds({ wakes: { wakes: base }, outbox: [{ id: 'a', at: run - 8 * MIN, to: 'Main', command: 'resume', text: 'resume\nNot running: Worker 2, Worker 1.', state: 'delivered' }] }), [])
  assert.deepEqual(kinds({ wakes: { wakes: base }, outbox: [{ id: 'a', at: run - 8 * MIN, to: 'Main', command: 'resume', text: 'resume\nNot running: Worker 10.', state: 'delivered' }] }), ['woke-outside'])
  assert.deepEqual(kinds({ wakes: { wakes: base }, outbox: [{ id: 'a', at: run - 8 * MIN, to: 'Worker 1', state: 'delivered' }] }), ['woke-outside'], 'a message 8 minutes before does not explain')
})

test('an interrupted chat that goes on with nobody reaching it is unsure, never an intervention (the records cannot tell it from its own release)', () => {
  const { interventions, unsure } = night()
  const evening = unsure.filter(one => one.at >= t(20, 0) && /interrupted/.test(one.what))
  assert.deepEqual(evening.map(one => `${clock(one.at)} ${one.kind}`), ['22:38:23 woke-outside'])
  assert.match(evening[0].what, /Worker 1 went from interrupted to working/)
  assert.match(evening[0].why, /do not tell/)
  assert.equal(interventions.some(one => one.at === evening[0].at), false)
})

test('an ask that says "open its chat" and that the person answered that day is an intervention; an unanswered or withdrawn one is not', () => {
  const ask = (state, lines) => parseItem(`Id: Q700\nKind: ask\nTitle: A popup in its chat may wait for you\nState: ${state}\nOwner: Worker 5\nSince: 2026-11-05 10:00\n\n## Text\nA popup may wait. Open its chat and look.\n\n## History\n${lines.join('\n')}\n`)
  const answered = ask('answered', ['- 2026-11-05 10:00 Worker 5: asked (do)', '- 2026-11-05 10:07 person: answered: done'])
  assert.deepEqual(interventionsOf({ asks: [answered], day: TODAY }).interventions.map(one => `${one.kind} ${clock(one.at)}`), ['open-its-chat 10:07:00'])
  assert.deepEqual(interventionsOf({ asks: [ask('withdrawn', ['- 2026-11-05 10:00 Worker 5: asked (do)', '- 2026-11-05 10:05 server: withdrawn: the call went on'])], day: TODAY }).interventions, [])
  assert.deepEqual(interventionsOf({ asks: [answered], day: '2026-11-04' }).interventions, [])
})

test('alarms: false = closed with "No fault" or "obsolete" ONLY; gone, fixed and open are real (X154-X161 are all of 2026-11-05: 8 real, 0 false)', () => {
  const alarms = alarmsOf(incidents, TODAY)
  assert.deepEqual(alarms.ids, ['X154', 'X155', 'X156', 'X157', 'X158', 'X159', 'X160', 'X161'])
  assert.equal(alarms.real, 8, 'X157, X158 and X161 are open; X154, X155, X156, X159 and X160 went gone: a real problem that went away')
  assert.equal(alarms.false, 0)
  const gone = parseItem('Id: X9\nKind: incident\nTitle: t\nState: gone\nSince: 2026-11-05 09:00\nFirst seen: 2026-11-05 08:00\n\n## History\n- 2026-11-05 09:00 Supervisor: gone by itself\n')
  assert.deepEqual({ real: alarmsOf([gone], TODAY).real, false: alarmsOf([gone], TODAY).false }, { real: 1, false: 0 })
  // X148 and X152 were raised on 11-04 and fixed on 11-05: the alarms of 11-04.
  assert.deepEqual(alarmsOf(incidents, '2026-11-04').ids, ['X148', 'X152', 'X153'])
  const closed = (id, line) => parseItem(`Id: ${id}\nKind: incident\nTitle: t\nState: closed\nSince: 2026-11-05 09:00\nFirst seen: 2026-11-05 08:00\n\n## History\n- 2026-11-05 09:00 Supervisor: ${line}\n`)
  const mixed = alarmsOf([closed('X1', 'closed: No fault: waits as planned'), closed('X2', 'closed: obsolete: the step moved'), closed('X3', 'closed: fixed by B1')], TODAY)
  assert.deepEqual({ real: mixed.real, false: mixed.false }, { real: 1, false: 2 })
})

test('idle-with-work counts distinct whole minutes of the day: gaps, double lines, empty lanes and other days do not add', () => {
  const lines = []
  const seen = (at, could = ['B1042']) => lines.push({ at, free: could.length === 0 ? [] : [{ chat: 'Worker 3', could }] })
  // 20:34-21:33, two minutes missing (a gap of the loop), five minutes written twice.
  for (let index = 0; index < 60; index += 1) {
    if (index === 30 || index === 31) continue
    seen(t(20, 34) + index * MIN + 5_000)
    if (index < 5) seen(t(20, 34) + index * MIN + 50_000)
  }
  for (let index = 0; index < 38; index += 1) seen(t(22, 0) + index * MIN + 20_000)
  // Not counted: an empty minute, a free lane with nothing to take, the days before and after.
  seen(t(21, 40), [])
  lines.push({ at: t(21, 41), free: [{ chat: 'Worker 4', could: [] }] })
  seen(t(23, 59, 59, 4))
  seen(t(0, 0, 0, 6))
  assert.equal(idleMinutesOf(lines, TODAY), 96)
  const line = dayLineOf({ day: TODAY, minutes: lines, interventions: [], alarms: { real: 0, false: 0, ids: [] }, now: t(23, 0) })
  assert.deepEqual(line, { day: TODAY, idleWithWorkMinutes: 96, idleEstimated: false, interventions: [], unsure: [], alarms: { real: 0, false: 0, ids: [] }, writtenAt: t(23, 0), closed: false })
})

test('finishOf: days in a row ending yesterday (or a closed today) with no intervention and under 10 minutes idle', () => {
  const line = (index, more = {}) => ({ day: `2026-10-${String(index).padStart(2, '0')}`, idleWithWorkMinutes: 0, interventions: [], closed: true, ...more })
  const fourteen = Array.from({ length: 14 }, (_, index) => line(10 + index))
  assert.deepEqual(finishOf(fourteen), { stableDays: 14, isStable: true })
  const broken = fourteen.map(one => (one.day === '2026-10-21' ? { ...one, interventions: [{ at: 1, kind: 'rollback', what: 'x' }] } : one))
  assert.deepEqual(finishOf(broken), { stableDays: 2, isStable: false }, 'the 22nd and 23rd count; the 21st breaks the row')
  assert.deepEqual(finishOf(fourteen.map(one => (one.day === '2026-10-23' ? { ...one, idleWithWorkMinutes: 10 } : one))), { stableDays: 0, isStable: false }, '10 minutes is not under 10')
  assert.deepEqual(finishOf(fourteen.map(one => (one.day === '2026-10-23' ? { ...one, idleWithWorkMinutes: 9 } : one))).stableDays, 14)
  assert.deepEqual(finishOf(fourteen.map(one => (one.day === '2026-10-22' ? { ...one, idleWithWorkMinutes: 25 } : one))), { stableDays: 1, isStable: false })
  // Today's line counts only once it is closed.
  const open = [...fourteen.slice(0, 13), line(23, { closed: false, interventions: [{ at: 1, kind: 'rollback', what: 'x' }] })]
  assert.deepEqual(finishOf(open), { stableDays: 13, isStable: true })
  // A day with no line breaks the row.
  assert.deepEqual(finishOf([line(10), line(11), line(13), line(14)]), { stableDays: 2, isStable: false })
  assert.deepEqual(finishOf([]), { stableDays: 0, isStable: false })
  // Unsure findings are not interventions.
  assert.deepEqual(finishOf([line(1, { unsure: [{ at: 1 }] }), line(2), line(3)]).stableDays, 3)
  // A day whose idle is not known (null, backfilled) is not stable: it breaks the row, it is no 0.
  assert.deepEqual(finishOf([line(1), line(2, { idleWithWorkMinutes: null }), line(3), line(4)]), { stableDays: 2, isStable: false }, 'the 4th and 3rd count; the null 2nd breaks the row')
  assert.deepEqual(finishOf(fourteen.map(one => ({ ...one, idleWithWorkMinutes: null }))), { stableDays: 0, isStable: false })
})

// -- comebacks (2026-11-09): X2 and X162, trimmed copies of the real files ----------------------------------------------------
const X2 = parseItem(text('X2.md'))
const X162 = parseItem(text('X162.md'))
const X162_CLOSED = parseItem(text('X162-closed-after.md'))
const brief = alarms => ({ real: alarms.real, false: alarms.false, ids: alarms.ids, cameBack: alarms.cameBack })

test('X2 (raised 24 Oct, came back 8 Nov 22:41, state fix) is a real alarm on 8 Nov, once, with its comeback; not on 9 Nov', () => {
  assert.deepEqual(brief(alarmsOf([X2], '2026-11-08')), { real: 1, false: 0, ids: ['X2'], cameBack: ['X2'] })
  assert.deepEqual(brief(alarmsOf([X2], '2026-11-09')), { real: 0, false: 0, ids: [], cameBack: [] })
  assert.deepEqual(brief(alarmsOf([X2], '2026-10-24')), { real: 1, false: 0, ids: ['X2'], cameBack: [] }, 'raised that day, no comeback')
  assert.deepEqual(alarmsOf([X2], '2026-10-30').cameBack, ['X2'], 'an older comeback counts on its own day')
  assert.deepEqual(alarmsOf([X2], '2026-11-04').ids, [], 'gone by itself is no comeback')
  // The same incident twice in the list, or raised and back on one day: one alarm.
  assert.equal(alarmsOf([X2, X2], '2026-11-08').real, 1)
})

test('X162 (raised 9 Nov 08:35, closed No fault 08:38, back 10:40) counts once on 9 Nov: real while open, false once a No fault close follows the comeback', () => {
  assert.deepEqual(brief(alarmsOf([X162], '2026-11-09')), { real: 1, false: 0, ids: ['X162'], cameBack: ['X162'] })
  assert.deepEqual(brief(alarmsOf([X162_CLOSED], '2026-11-09')), { real: 0, false: 1, ids: ['X162'], cameBack: ['X162'] })
  // A state closed whose only No fault close is BEFORE the comeback stays real.
  const stillClosed = parseItem(text('X162.md').replace('State: fix', 'State: closed'))
  assert.deepEqual(brief(alarmsOf([stillClosed], '2026-11-09')), { real: 1, false: 0, ids: ['X162'], cameBack: ['X162'] })
  assert.deepEqual(brief(alarmsOf([X2, X162], '2026-11-09')), { real: 1, false: 0, ids: ['X162'], cameBack: ['X162'] })
})

test('finishOf: a closed day with a real alarm breaks the row and names the day; a day with only false alarms does not', () => {
  const line = (index, more = {}) => ({ day: `2026-10-${String(index).padStart(2, '0')}`, idleWithWorkMinutes: 0, interventions: [], closed: true, ...more })
  const real = { real: 1, false: 0, ids: ['X2'], cameBack: ['X2'] }
  const falseOnly = { real: 0, false: 2, ids: ['X7', 'X8'], cameBack: [] }
  assert.deepEqual(finishOf([line(1), line(2, { alarms: real }), line(3), line(4)]), { stableDays: 2, isStable: false, brokenByAlarm: '2026-10-02' })
  assert.deepEqual(finishOf([line(1), line(2), line(3, { alarms: falseOnly }), line(4)]), { stableDays: 4, isStable: true })
  assert.deepEqual(finishOf([line(1, { alarms: real }), line(2), line(3), line(4)]).stableDays, 3, 'the oldest day breaks the row, the three after it count')
})

test('the closed lines are counted anew ONCE: a version-1 line gets X2 and version 2; a version-2 line is not rewritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stability-recount-'))
  try {
    const file = join(dir, 'stability.jsonl')
    const old = { day: '2026-11-08', idleWithWorkMinutes: 7, idleEstimated: false, interventions: [], unsure: [], alarms: { real: 0, false: 0, ids: [] }, writtenAt: 1, closed: true, measured: false, pausedMinutes: 1337, offMinutes: 1334, notMeasuredWhy: 'paused' }
    const kept = { ...old, day: '2026-11-07', alarms: { real: 5, false: 0, ids: ['X1'] }, alarmsVersion: 2 }
    await writeFile(file, `${[kept, old].map(one => JSON.stringify(one)).join('\n')}\n`)
    const items = new Map([['X2', X2]])
    const now = new Date(2026, 10, 9, 12, 0).getTime()
    await recordStability({}, { dir, items, clock: () => now })
    const [seven, eight] = await linesOf(file)
    assert.deepEqual(seven, kept, 'a line at version 2 is never rewritten')
    assert.deepEqual(eight, { ...old, alarms: { real: 1, false: 0, ids: ['X2'], cameBack: ['X2'] }, alarmsVersion: 2 }, 'only the alarms and the version change')
    // A second pass leaves both as they are.
    await recordStability({}, { dir, items: new Map([['X2', X2], ['X162', X162]]), clock: () => now + 60_000 })
    const again = await linesOf(file)
    assert.deepEqual(again.slice(0, 2), [seven, eight])
    assert.equal(again[2].day, '2026-11-09')
    assert.deepEqual(brief(again[2].alarms), { real: 1, false: 0, ids: ['X162'], cameBack: ['X162'] })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('tailLines reads from the end back to the first line older than the start, skipping a torn line, and gives [] for a missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stability-tail-'))
  try {
    const file = join(dir, 'lines.jsonl')
    const lines = Array.from({ length: 3000 }, (_, index) => JSON.stringify({ at: index * 1000, pad: 'x'.repeat(60) }))
    await writeFile(file, `${lines.join('\n')}\n{"at": 99\n`)
    const some = await tailLines(file, 2_900_000, { chunk: 512 })
    assert.equal(some.at(-1).at, 2_999_000, 'the torn last line is skipped')
    assert.ok(some.length < 3000 && some.length >= 101, `read only the end (${some.length} lines)`)
    assert.equal(some.some(line => line.at === 2_900_000), true)
    assert.deepEqual(some.map(line => line.at), [...some.map(line => line.at)].sort((a, b) => a - b))
    assert.equal((await tailLines(file, -1, { chunk: 512 })).length, 3000, 'back to the start of the file')
    assert.deepEqual(await tailLines(join(dir, 'nothing.jsonl'), 0), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('mergedOutbox joins the lines of one record by id', () => {
  const merged = mergedOutbox([{ id: 'a', at: 5, to: 'Main', state: 'waiting' }, { id: 'a', state: 'delivered', deliveredAt: 9 }, { id: 'b', state: 'delivered' }])
  assert.deepEqual(merged, [{ id: 'a', at: 5, to: 'Main', state: 'delivered', deliveredAt: 9 }])
})

const copyFixtures = async dir => {
  for (const name of ['history.jsonl', 'wakes.json', 'reports.json', 'landings.jsonl', 'outbox.jsonl']) await writeFile(join(dir, name), text(name))
  await writeFile(join(dir, 'actions.jsonl'), OWN_PAUSE.map(one => JSON.stringify(one)).join('\n') + '\n')
}
const itemsOf = () => new Map(incidents.map(item => [item.head.get('Id'), item]))
const linesOf = async file => (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))

test('recordStability writes tonight\'s line; at the first pass of the next day it closes it, once, and never rewrites it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stability-day-'))
  try {
    await copyFixtures(dir)
    const minutes = [t(21, 5), t(21, 6), t(21, 6, 40), t(21, 9)].map(at => ({ at, free: [{ chat: 'Worker 3', could: ['B1042'] }] }))
    await writeFile(join(dir, 'ready-minutes.jsonl'), minutes.map(one => JSON.stringify(one)).join('\n') + '\n')
    const file = join(dir, 'stability.jsonl')
    let now = t(23, 0)
    const view = await recordStability({}, { dir, items: itemsOf(), clock: () => now })
    const [tonight] = await linesOf(file)
    assert.equal(tonight.day, TODAY)
    assert.equal(tonight.closed, false)
    assert.equal(tonight.idleWithWorkMinutes, 3)
    assert.equal(tonight.interventions.length, 0)
    assert.equal(tonight.unsure.length, 7, 'the Advisor of 08:21, the five starts of the evening and Worker 1 of 22:38')
    assert.deepEqual({ real: tonight.alarms.real, false: tonight.alarms.false }, { real: 8, false: 0 })
    assert.equal(tonight.writtenAt, now)
    assert.deepEqual(view.today, tonight)
    assert.deepEqual(view.days, [])
    // The same day again: the line is made anew, one line in the file.
    now = t(23, 59)
    await recordStability({}, { dir, items: itemsOf(), clock: () => now })
    assert.equal((await linesOf(file)).length, 1)
    assert.equal((await linesOf(file))[0].writtenAt, t(23, 59))
    const lastOfDay = (await linesOf(file))[0]
    // 00:01 of the next day: the 5th closes (as it stood at 23:59), the 6th starts.
    now = t(0, 1, 0, 6)
    const next = await recordStability({}, { dir, items: itemsOf(), clock: () => now })
    const [closed, fresh] = await linesOf(file)
    assert.deepEqual(closed, { ...lastOfDay, closed: true, alarms: alarmsOf(incidents, TODAY), alarmsVersion: 2 }, 'closed once; its alarms counted anew once with the comeback rule')
    assert.equal(fresh.day, '2026-11-06')
    assert.equal(fresh.closed, false)
    assert.equal(fresh.interventions.length, 0)
    assert.deepEqual(next.days.map(one => one.day), [TODAY])
    // Later passes (even with records that would change the 5th) never touch the closed line.
    await writeFile(join(dir, 'actions.jsonl'), `${JSON.stringify(act('resume-all', t(23, 30)))}\n`)
    now = t(0, 2, 0, 6)
    await recordStability({}, { dir, items: itemsOf(), clock: () => now })
    now = t(8, 0, 0, 6)
    await recordStability({}, { dir, items: itemsOf(), clock: () => now })
    const after = await linesOf(file)
    assert.deepEqual(after[0], closed)
    assert.equal(after.length, 2)
    assert.equal(after[1].writtenAt, t(8, 0, 0, 6))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a pass whose files cannot be read says so and returns null; the loop goes on', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stability-bad-'))
  const errors = []
  const original = console.error
  console.error = message => errors.push(message)
  try {
    await writeFile(join(dir, 'wakes.json'), '{not json')
    assert.equal(await recordStability({}, { dir, clock: () => t(12, 0) }), null)
    assert.match(errors[0], /stability record could not be written/)
  } finally {
    console.error = original
    await rm(dir, { recursive: true, force: true })
  }
})

test('with a 7-day history file the whole pass holds the event loop under 50 ms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stability-hold-'))
  try {
    await copyFixtures(dir)
    const chats = ['Main', 'Worker 1', 'Worker 2', 'Worker 3', 'Worker 4', 'Worker 5']
    const states = ['working', 'free', 'interrupted', 'off']
    const historyLines = []
    const outboxLines = []
    const minuteLines = []
    // Seven days before tonight and tonight's own, at the size of the live files (about 6000 history lines in 5 days).
    for (let day = -7; day <= 0; day += 1) {
      const start = t(0, 0, 0, 5 + day)
      for (let index = 0; index < 1300; index += 1) historyLines.push(JSON.stringify({ at: start + index * 60_000 * 1.1, chat: chats[index % 6], state: states[(index >> 2) % 4], task: `B${index % 900} a task title of some length`, step: null, steps: null, leftMs: 3600000, estimateAt: 0, startedAt: 0, source: 'step', by: null }))
      for (let index = 0; index < 700; index += 1) outboxLines.push(JSON.stringify({ id: `d${day}-${index}`, at: start + index * 120_000, to: chats[index % 6], command: 'task', state: 'delivered', text: 'x'.repeat(400) }))
      for (let index = 0; index < 1440; index += 1) minuteLines.push(JSON.stringify({ at: start + index * 60_000, free: index % 3 === 0 ? [{ chat: 'Worker 3', could: ['B1'] }] : [] }))
    }
    await writeFile(join(dir, 'history.jsonl'), `${historyLines.join('\n')}\n`)
    await writeFile(join(dir, 'outbox.jsonl'), `${outboxLines.join('\n')}\n`)
    await writeFile(join(dir, 'ready-minutes.jsonl'), `${minuteLines.join('\n')}\n`)
    const histogram = monitorEventLoopDelay({ resolution: 1 })
    histogram.enable()
    const started = performance.now()
    await recordStability({}, { dir, items: itemsOf(), clock: () => t(23, 0) })
    await recordStability({}, { dir, items: itemsOf(), clock: () => t(23, 1) })
    const took = performance.now() - started
    histogram.disable()
    const worst = histogram.max / 1e6
    console.log(`  stability pass: ${took.toFixed(0)} ms for two passes, longest hold of the event loop ${worst.toFixed(1)} ms`)
    assert.ok(worst < 50, `the event loop was held ${worst.toFixed(1)} ms`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the loop keeps what an earlier pass found: a finding made at 21:16 stays in the line after the reports move on', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stability-kept-'))
  try {
    const put = (name, value) => writeFile(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value))
    await put('wakes.json', { wakes: { Main: [{ spell: 1, attempts: [] }], 'Worker 1': [{ spell: 1, attempts: [] }], 'Worker 2': [{ spell: 1, attempts: [] }], 'Worker 3': [{ spell: 1, attempts: [] }] } })
    // 21:15: every chat starts a run within a minute (an app restart); Worker 3 also came back from off at 20:30 with nothing of the board before it.
    await put('reports.json', { reports: { Main: { run: t(21, 15, 5), state: 'idle' }, 'Worker 1': { run: t(21, 15, 30), state: 'idle' }, 'Worker 2': { run: t(21, 15, 50), state: 'idle' }, 'Worker 3': { run: t(21, 15, 55), state: 'idle' } } })
    await put('history.jsonl', `${JSON.stringify({ at: t(20, 0), chat: 'Worker 3', state: 'off' })}
${JSON.stringify({ at: t(20, 30), chat: 'Worker 3', state: 'free' })}
`)
    for (const name of ['landings.jsonl', 'outbox.jsonl', 'actions.jsonl']) await put(name, '')
    const file = join(dir, 'stability.jsonl')
    const lane = name => ({ name })
    const state = { board: { lastStop: { from: t(14, 0), to: t(14, 2), why: 'unknown', start: 'hand' } }, chats: ['Main', 'Worker 1', 'Worker 2', 'Worker 3'].map(lane) }
    await recordStability(state, { dir, items: new Map(), clock: () => t(21, 16) })
    const first = (await linesOf(file))[0]
    assert.deepEqual(first.interventions.map(one => `${one.kind} ${clock(one.at)}`), ['restart-by-hand 14:02:00', 'app-restart 21:15:05'])
    assert.deepEqual(first.unsure.map(one => `${one.kind} ${clock(one.at)}`), ['woke-outside 20:30:00'], 'Worker 3 came back from off with no proof of who did it')
    await put('history.jsonl', '')
    // 21:30: the chats all started again on their own runs (the reports hold only the newest run), the stop is gone from the board.
    await put('reports.json', { reports: { Main: { run: t(21, 29), state: 'idle' }, 'Worker 1': { run: t(21, 29, 20), state: 'idle' }, 'Worker 2': { run: t(21, 29, 40), state: 'idle' }, 'Worker 3': { run: t(21, 29, 50), state: 'idle' } } })
    await put('wakes.json', { wakes: { Main: [{ spell: 1, attempts: [{ at: t(21, 28, 50), by: 'board', verdict: 'woke', runBefore: t(21, 15, 5) }] }], 'Worker 1': [{ spell: 1, attempts: [{ at: t(21, 29, 10), by: 'board', verdict: 'woke', runBefore: t(21, 15, 30) }] }], 'Worker 2': [{ spell: 1, attempts: [{ at: t(21, 29, 30), by: 'board', verdict: 'woke', runBefore: t(21, 15, 50) }] }], 'Worker 3': [{ spell: 1, attempts: [{ at: t(21, 29, 40), by: 'board', verdict: 'woke', runBefore: t(21, 15, 55) }] }] } })
    await recordStability({ ...state, board: { lastStop: null } }, { dir, items: new Map(), clock: () => t(21, 30) })
    const second = (await linesOf(file))[0]
    assert.deepEqual(second.interventions.map(one => `${one.kind} ${one.at}`), first.interventions.map(one => `${one.kind} ${one.at}`), 'every kind stays')
    assert.equal(second.writtenAt, t(21, 30))
    // The unsure ones stay too: the 20:30 start stays unsure after the history is gone.
    assert.deepEqual(second.unsure.map(one => `${one.kind} ${clock(one.at)}`), ['woke-outside 20:30:00'])
    const withDoubt = { ...second, unsure: [{ at: t(21, 20), kind: 'woke-outside', what: 'x', why: 'y' }] }
    await writeFile(file, `${JSON.stringify(withDoubt)}\n`)
    await recordStability({ ...state, board: { lastStop: null } }, { dir, items: new Map(), clock: () => t(21, 31) })
    assert.deepEqual((await linesOf(file))[0].unsure.map(one => one.at), [t(21, 20)])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// 2026-11-08 (the lead): a day paused or off for most of it is NOT MEASURED. The records are trimmed copies of the board's own
// (test/fixtures/stability/actions-1108.jsonl: the person's Pause all of 7 Nov 13:32 and Resume all of 8 Nov 22:16; history-1108.jsonl:
// the board's gap line of 7 Nov 13:52, the board running again at 8 Nov 22:13). On the 8th the board was paused all day and off
// until 22:13: 1337 minutes paused, 1334 off, the two overlapping.
const NM_ACTIONS = jsonl('actions-1108.jsonl')
const NM_HISTORY = parseHistory(text('history-1108.jsonl'))
const nm = (day, now, closed = false, more = {}) => measuredOf({ day, now, closed, actions: NM_ACTIONS, gaps: gapsOf(NM_HISTORY, now), ...more })

test('2026-11-08: paused all day and off until 22:13 is not measured, today (22:30, half of the part so far) and closed (the whole day)', () => {
  assert.deepEqual(pausesOf(NM_ACTIONS), [{ from: 1794054725471, to: 1794172608866 }])
  assert.deepEqual(nm('2026-11-08', t(22, 30, 0, 8)), { measured: false, pausedMinutes: 1337, offMinutes: 1334, why: 'paused' })
  assert.deepEqual(nm('2026-11-08', t(0, 5, 0, 9), true), { measured: false, pausedMinutes: 1337, offMinutes: 1334, why: 'paused' })
  // Off for more minutes than paused: the cause is off.
  assert.equal(nm('2026-11-08', t(22, 30, 0, 8), false, { actions: [] }).why, 'off')
  assert.equal(nm('2026-11-08', t(22, 30, 0, 8), false, { gaps: [] }).why, 'paused')
})

test('a day with a short pause is measured; so is 7 Nov (paused 13:32, board off 13:52, 628 of 1440 minutes: under half)', () => {
  const short = [{ at: t(10, 0, 0, 8), action: 'pause-all' }, { at: t(10, 30, 0, 8), action: 'resume-all' }]
  assert.deepEqual(nm('2026-11-08', t(22, 30, 0, 8), false, { actions: short, gaps: [] }), { measured: true, pausedMinutes: 30, offMinutes: 0, why: null })
  assert.deepEqual(nm('2026-11-07', t(0, 5, 0, 8), true), { measured: true, pausedMinutes: 628, offMinutes: 607, why: null })
  // Exactly half is not over half; one minute over is.
  const half = [{ at: t(0, 0, 0, 8), action: 'pause-all' }, { at: t(12, 0, 0, 8), action: 'resume-all' }]
  assert.equal(nm('2026-11-08', t(0, 5, 0, 9), true, { actions: half, gaps: [] }).measured, true)
  half[1].at += MIN
  assert.equal(nm('2026-11-08', t(0, 5, 0, 9), true, { actions: half, gaps: [] }).measured, false)
  // Early in a day only the part so far counts: 20 minutes paused out of 30 elapsed is not measured yet.
  const early = [{ at: t(0, 0, 0, 8), action: 'pause-all' }, { at: t(0, 20, 0, 8), action: 'resume-all' }]
  assert.equal(nm('2026-11-08', t(0, 30, 0, 8), false, { actions: early, gaps: [] }).measured, false)
  assert.equal(nm('2026-11-08', t(12, 0, 0, 8), false, { actions: early, gaps: [] }).measured, true)
})

test('finishOf: a day not measured breaks the row and is never a stable day, closed or not', () => {
  const line = (index, more = {}) => ({ day: `2026-10-${String(index).padStart(2, '0')}`, idleWithWorkMinutes: 0, interventions: [], closed: true, ...more })
  const five = [1, 2, 3, 4, 5].map(index => line(index))
  assert.deepEqual(finishOf(five), { stableDays: 5, isStable: true })
  assert.deepEqual(finishOf(five.map(one => (one.day === '2026-10-03' ? { ...one, measured: false, notMeasuredWhy: 'paused' } : one))), { stableDays: 2, isStable: false }, 'the 4th and 5th count; the paused 3rd breaks the row')
  assert.deepEqual(finishOf(five.map(one => ({ ...one, measured: true }))), { stableDays: 5, isStable: true })
  assert.deepEqual(finishOf([...five.slice(0, 4), line(5, { measured: false })]), { stableDays: 0, isStable: false })
  assert.deepEqual(viewOf([...five.slice(0, 4), line(5, { measured: false })], t(12, 0, 0, 8)).stableDays, 0, 'the view says the same')
})

test('recordStability: 8 Nov 22:30 is written not measured (paused); the 7th, closed in that pass, is measured by the whole day', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stability-nm-'))
  try {
    await writeFile(join(dir, 'actions.jsonl'), text('actions-1108.jsonl'))
    await writeFile(join(dir, 'history.jsonl'), text('history-1108.jsonl'))
    // The 7th's last pass was at 13:50, before the board went off: it was half a day then, measured false by mistake of a short look.
    const stale = { day: '2026-11-07', idleWithWorkMinutes: 2, idleEstimated: false, interventions: [], unsure: [], alarms: { real: 0, false: 0, ids: [] }, writtenAt: t(13, 50, 0, 7), closed: false, measured: false, pausedMinutes: 18, offMinutes: 0, notMeasuredWhy: 'paused' }
    await writeFile(join(dir, 'stability.jsonl'), `${JSON.stringify(stale)}
`)
    const view = await recordStability({}, { dir, items: new Map(), clock: () => t(22, 30, 0, 8) })
    const [seventh, eighth] = await linesOf(join(dir, 'stability.jsonl'))
    assert.deepEqual([seventh.closed, seventh.measured, seventh.pausedMinutes, seventh.notMeasuredWhy], [true, true, 628, undefined])
    assert.deepEqual([eighth.day, eighth.measured, eighth.notMeasuredWhy, eighth.pausedMinutes, eighth.offMinutes], ['2026-11-08', false, 'paused', 1337, 1334])
    assert.equal(view.today.measured, false)
    assert.deepEqual([view.stableDays, view.isStable], [1, false], 'the measured 7th counts, the 8th is open')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
