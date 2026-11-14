// The asset wait (chat 1's brief of 2026-11-11 under the person's "Yes, build now"; the person's choice "A, Working" the same day):
// Worker 5 held B1124 and ended its turns to wait for the pictures it asked Codex for through `work asset` (A224-A227). Between its
// turns the lane read Stopped (interrupted), the holder timers would have typed "go on" after 5 min and given the step back after
// 20 while Codex was still drawing; the person asked "why has worker 5 stopped?". Now the holder's open requests for its held step are
// the task's work (src/work/assetWait.mjs): the lane reads Working with "Codex draws 4 pictures for it · 1 of 4 done · since 10:43" and
// one tick per picture, never "Worker 5 is on it"; the holder timers stay off, Resume all skips it, every reader of a working lane
// (working-not-running, idle, checkpoint-late, the stop words, the wake needs, the hand-out) leaves it be; it ends by itself when the
// last request is ready or failed (a failure shows as such), and past Codex's time limit for a job it turns one Late "Codex has not
// delivered death since 10:43", never a give-back. A person's or a pick's request parks the lane instead ("waits for your file").
// Trimmed from the live records, made-up paths only. Not in it: the queue, Codex, the wake.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { toneOf } from '../src/chatStatus.mjs'
import { changes, today } from '../src/history.mjs'
import { fiveHourStopDue, weekStopDue } from '../src/say.mjs'
import { stepStatusOf } from '../src/stepStatus.mjs'
import { healthSummary } from '../src/supervisor/health.mjs'
import { WATCH_RULES, checkpointLate } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { wakeNeeds } from '../src/wake.mjs'
import { assetFailureOf, assetIdsWords, assetProgressAt, assetWaitOf, assetWorkOf, lateAssetsOf, pieceNameOf } from '../src/work/assetWait.mjs'
import { idleWorkers } from '../src/work/handOut.mjs'
import { decide } from '../src/work/handover.mjs'
import { factsOf } from '../src/work/handoverBoard.mjs'
import { holderTimers } from '../src/work/holderTimers.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { pauseAnswer, pauseFacts } from '../src/work/pause.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'
import { openPage } from './pageHarness.mjs'

const MIN = 60_000
const at = (hour, minute) => new Date(2026, 10, 11, hour, minute).getTime()
/** 10:43: Worker 5 asked for the correction round and ended its turn; the board looks at 10:49. */
const ASKED = at(10, 43)
const NOW = at(10, 49)
const PREFIX = 'Garden · '
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Lead', 'Worker 5', 'Worker 2', 'Advisor']
const LINE = 'Codex draws 4 pictures for it · 1 of 4 done · since 10:43'
const TICKS = 'death ✓ · attack … · hit … · walk north …'

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const B1124 = (more = {}) => file({ Id: 'B1124', Kind: 'step', Title: 'Draw all eight Knight animations in the picked version', State: 'in progress', Owner: 'Worker 5', Activity: 'Garden', Goal: 'G66', Since: stamp(at(10, 28)), Checkpoint: `7bc2781b · Correction round 1 asked: A224 death, A225 attack, A226 hit, A227 walk north. On each: copy to art/source · ${stamp(at(10, 43))}`, ...more })
const B1095 = () => file({ Id: 'B1095', Kind: 'step', Title: 'Lava rim shader', State: 'in progress', Owner: 'Worker 2', Activity: 'Garden', Goal: 'G60', Since: stamp(at(10, 20)) })
/** A request as request.json keeps it (src/assets.mjs), trimmed: who, of, provider, mode, state, why and its times. */
const request = (id, state, { who = 'Worker 5', of = 'B1124', provider = 'codex', mode = 'auto', asked = ASKED, started = null, ended = null, why = '', text = 'The Knight' } = {}) =>
  ({ id, who, of, kind: 'visual', provider, mode, text, pictures: [], follows: null, state, why, files: state === 'ready' ? ['1.png'] : [], ask: null, pick: null, times: { asked, started, ended } })
/** The live round at 10:49: A224 (death) ready at 10:47, A225 (attack) running since then, A226 and A227 waiting (Codex draws one at a time). */
const ROUND = () => [request('A224', 'ready', { started: ASKED, ended: at(10, 47) }), request('A225', 'running', { started: at(10, 47) }), request('A226', 'waiting'), request('A227', 'waiting')]
const DELIVERED = (ended = at(10, 58)) => ['A224', 'A225', 'A226', 'A227'].map(id => request(id, 'ready', { started: ASKED, ended }))
const WHY = 'Codex took longer than 240 seconds and was stopped.'
const FAILED = () => [...DELIVERED(at(10, 55)).slice(0, 3), request('A227', 'failed', { started: at(10, 55), ended: at(10, 58), why: WHY })]

function build(items, { assets = [], state = 'idle', lines = [], now = NOW, assetSeconds = 240, reportAt = null } = {}) {
  const work = storeFromText('## Garden\n', { now: at(8, 0) })
  for (const item of items) {
    work.items.set(item.head.get('Id'), item)
    if (item.head.get('Kind') === 'step') work.activities[0].steps.push(item.head.get('Id'))
  }
  const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at(10, 10), lastAssistantUuid: 'u-1' })
  const tail = { text: '', isCut: false, modifiedAt: at(10, 10) }
  const report = (name, since, mine = 'idle') => [name, { state: mine, since, background: false, run: 1, seq: 1, at: reportAt ?? now - 5_000, session: `cli-${name}`, mod: '0.31.0', busyAt: null }]
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])), planLineTexts: {},
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: at(8, 0), assets, assetSeconds,
  }
  return buildState(raw, { lines, outbox: [], runs: [], now, config, seen: { shown: {}, other: {} }, board: { startedAt: at(8, 0), offSince: null }, reports: new Map([report('Lead', at(9, 0)), report('Worker 5', ASKED, state), report('Worker 2', at(10, 25)), report('Advisor', at(9, 0))]) })
}
const laneOf = (state, name = 'Worker 5') => state.chats.find(one => one.name === name)
const storeOf = items => new Map(items.map(one => [one.head.get('Id'), one]))
const lates = state => state.forYou.filter(one => one.kind === 'wait late')
const viewOf = state => buildView({ state, items: new Map(), now: NOW })
/** The timers as the hand-over runs them for a stopped lane (`worker.state` as given: the records, not the lane, keep them off). */
const timers = (state, assets, now = NOW, worker = laneOf(state)) => holderTimers({ worker, holding: B1124(), items: storeOf([B1124()]), prefix: PREFIX, assets, runningMs: from => now - from })

test('the live case: Worker 5 reads Working for Codex, "Codex draws 4 pictures for it · 1 of 4 done · since 10:43", with a tick per picture', () => {
  const state = build([B1124()], { assets: ROUND() })
  const lane = laneOf(state)
  assert.equal(lane.status, 'Working')
  assert.equal(lane.why, LINE)
  assert.equal(toneOf(lane.status), 'quiet')
  assert.equal(lane.state, 'working')
  assert.equal(lane.heldBy, 'asset')
  assert.equal(lane.suspended, null)
  assert.equal(lane.between, 'Its turn has ended; Codex draws its pictures (A224-A227).')
  assert.equal(lane.quietMs, null, 'no "no sign of life" count: the chat runs no turn on purpose')
  assert.deepEqual([lane.assetWork.who, lane.assetWork.total, lane.assetWork.done, lane.assetWork.failed, lane.assetWork.ticks, lane.assetWork.link], ['Codex', 4, 1, 0, TICKS, '#details=B1124'])
  assert.deepEqual(lane.assetWork.pieces.map(one => `${one.id} ${one.name} ${one.state}`), ['A224 death ready', 'A225 attack running', 'A226 hit waiting', 'A227 walk north waiting'])
  // The one status of the step says who does what: never "Worker 5 is on it" while the chat runs no turn.
  const status = state.stepStatus.B1124
  assert.deepEqual([status.kind, status.label, status.tone, status.words, status.link, status.who, status.why], ['asset', 'Codex draws', 'working', `Codex draws: ${TICKS}`, '#details=B1124', 'Codex', LINE])
  // The day bar: the working colour, never interrupted.
  const spans = today(changes(new Map(), state.chats, at(10, 45)), { from: at(10, 0), to: NOW, names: ['Worker 5'] })[0].spans
  assert.deepEqual(spans.map(one => one.state), ['working'])
  // The hand-over's decision: a working holder, no "go on" line, no give-back, however long Codex draws.
  const facts = factsOf({ lane, state: { chatPrefix: PREFIX, readyList: null, limits: state.limits, gaps: state.gaps ?? [], assets: state.assets }, items: storeOf([B1124()]), pause: null, sent: [], config, now: NOW + 60 * MIN, event: { kind: 'pass' } })
  assert.deepEqual(facts.assets.map(one => one.id), ['A224', 'A225', 'A226', 'A227'])
  const decided = decide({ ...facts, ready: [], owed: null })
  assert.deepEqual([decided.state, decided.step, decided.giveBack ?? null, decided.goOn ?? null], ['working', 'B1124', null, null])
  // A chat busy in a turn of its own is Working as before, with its own words.
  assert.equal(laneOf(build([B1124()], { assets: ROUND(), state: 'busy' })).why, null)
})

test('the mutant: the same stopped worker without the records is what the person saw, Stopped, nudged and given back', () => {
  const state = build([B1124()], { assets: [] })
  assert.equal(laneOf(state).status, 'Stopped')
  assert.equal(laneOf(state).state, 'interrupted')
  assert.equal(state.stepStatus.B1124.words, 'Worker 5 is on it')
  const nudged = timers(state, [], ASKED + 6 * MIN)
  assert.ok(nudged !== null && nudged.resume !== null, 'the "go on" line is due')
  // The records keep the timers off whatever the lane reads (unknown after a report blip, off after a failed wake).
  for (const lane of ['interrupted', 'unknown', 'off']) assert.equal(timers(state, ROUND(), NOW + 60 * MIN, { ...laneOf(state), state: lane }), null, lane)
})

test('the provider\'s minutes are the holder\'s progress: no give-back the moment the last picture came (the review\'s finding 1)', () => {
  // Earlier in the step Worker 5 got its two "go on" lines (10:30 and 10:35); it checkpointed at 10:43 and asked; all four came at 10:58.
  const step = B1124()
  const noted = file(Object.fromEntries(step.head), { History: [
    `- ${stamp(at(10, 30))} server: the board asked Worker 5 to go on (stopped since 10:29)`,
    `- ${stamp(at(10, 35))} server: the board asked Worker 5 to go on (stopped since 10:29)`,
  ] })
  const worker = { ...laneOf(build([noted], { assets: DELIVERED() })), state: 'interrupted', report: { state: 'idle', since: ASKED, at: at(10, 59) }, turnAt: at(10, 40) }
  const run = (assets, now) => holderTimers({ worker, holding: noted, items: storeOf([noted]), prefix: PREFIX, assets, runningMs: from => now - from })
  assert.equal(assetProgressAt(noted, DELIVERED(), { chat: 'Worker 5' }), at(10, 58))
  // At 10:59, a minute after the delivery: the give-back's 15 minutes count from the delivery, not from the worker's idle report of 10:43.
  const after = run(DELIVERED(), at(10, 59))
  assert.ok(after !== null, 'the timers run again once nothing is open')
  assert.equal(after.giveBack, null)
  assert.ok(after.giveBack === null && run(DELIVERED(), at(11, 14)).giveBack !== null, 'given back only 15 minutes after the delivery')
  // The mutant: without the records' times the step would go back at 10:59 (16 stopped minutes since 10:43).
  assert.notEqual(run([], at(10, 59)).giveBack, null)
})

test('only the holder\'s own open requests for the step it holds count; the words', () => {
  const step = B1124()
  assert.equal(assetWaitOf(step, [request('A230', 'waiting', { who: 'Worker 2' })], { chat: 'Worker 5', prefix: PREFIX }), null)
  assert.equal(assetWaitOf(step, [request('A224', 'ready', { ended: at(10, 47) }), request('A225', 'failed', { ended: at(10, 47), why: 'x' })], { chat: 'Worker 5' }), null)
  assert.equal(assetWaitOf(step, [request('A231', 'waiting', { of: 'B1095' })], { chat: 'Worker 5' }), null)
  assert.deepEqual(assetWaitOf(step, [request('A224', 'running', { who: `${PREFIX}Worker 5` })], { chat: 'Worker 5', prefix: PREFIX })?.ids, ['A224'])
  // A step without an owner, and no chat named, waits for nobody (the review's finding 8); a step not at work neither.
  assert.equal(assetWaitOf(B1124({ Owner: '-' }), ROUND(), {}), null)
  assert.equal(assetWaitOf(B1124({ State: 'review' }), ROUND(), { chat: 'Worker 5' }), null)
  assert.equal(assetIdsWords(['A227', 'A224', 'A225', 'A226']), 'A224-A227')
  assert.equal(assetIdsWords(['A224', 'A226']), 'A224, A226')
  assert.equal(assetIdsWords(['A1', 'A3', 'A5', 'A7', 'A9']), 'A1, A3, A5, A7 +1')
  // The pictures' names: the holder's words beside the id in its checkpoint, else the request's capitalised words, else the id.
  assert.equal(pieceNameOf(request('A227', 'waiting'), step), 'walk north')
  assert.equal(pieceNameOf(request('A240', 'waiting', { text: "Correction of A221: the Knight's DEATH animation, 8 frames on flat magenta #FF00FF" }), step), 'death')
  assert.equal(pieceNameOf(request('A240', 'waiting', { text: 'the knight again' }), step), 'A240')
  // No name from a range, a state word or connectives: the list form only (the review's finding 4).
  const named = words => B1124({ Checkpoint: `7bc2781b · ${words} · ${stamp(at(10, 43))}` })
  assert.equal(pieceNameOf(request('A227', 'waiting', { text: 'x' }), named('asked A224-A227 and wait for them')), 'A227')
  assert.equal(pieceNameOf(request('A224', 'waiting', { text: 'x' }), named('A224 ready, A225 running')), 'A224')
  assert.equal(pieceNameOf(request('A227', 'waiting', { text: 'x' }), named('waiting on A227 to come back from Codex')), 'A227')
  assert.equal(pieceNameOf(request('A224', 'waiting', { text: 'x' }), named('A224: the death sheet')), 'death')
  assert.equal(pieceNameOf(request('A224', 'waiting', { text: 'x' }), named('A2240 death, A224 hit')), 'hit')
  // A round of one, and a round with a failure, in words.
  assert.equal(assetWorkOf(step, [request('A224', 'running', { started: ASKED })], { chat: 'Worker 5' }).words, 'Codex draws 1 picture for it · 0 of 1 done · since 10:43')
  assert.equal(assetWorkOf(step, [request('A224', 'failed', { ended: at(10, 47), why: WHY }), request('A225', 'running', { started: at(10, 47) })], { chat: 'Worker 5' }).words, 'Codex draws 2 pictures for it · 0 of 2 done, 1 failed · since 10:43')
  // An older round of the step (delivered long before) is not this one's.
  assert.equal(assetWorkOf(step, [request('A200', 'ready', { asked: at(9, 0), ended: at(9, 5) }), ...ROUND()], { chat: 'Worker 5' }).total, 4)
  // A redo asked twelve minutes after round 1 (all delivered by then) is its own round: "1 picture", not "5 pictures · 4 of 5 done".
  const redo = [...DELIVERED(at(10, 50)), request('A228', 'running', { asked: at(10, 55), started: at(10, 55) })]
  assert.deepEqual([assetWorkOf(step, redo, { chat: 'Worker 5' }).total, assetWorkOf(step, redo, { chat: 'Worker 5' }).ids], [1, ['A228']])
  // Asked within five minutes of one another they are one round.
  const soon = [...DELIVERED(at(10, 50)).map(one => ({ ...one, times: { ...one.times, asked: at(10, 47) } })), request('A228', 'running', { asked: at(10, 51), started: at(10, 51) })]
  assert.equal(assetWorkOf(step, soon, { chat: 'Worker 5' }).total, 5)
  // A running request without a start time counts from its ask for the Late (finding 8).
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 5', step, assets: [request('A224', 'running')], now: at(10, 49), jobMs: 240_000 }).map(one => one.asset), ['A224'])
  // F18: a Codex job with pictures attached (here a correction: the earlier picture and three references) may take 600 s: not late at 5 min, late past 11.
  const withPictures = { ...request('A317', 'running', { started: at(10, 43) }), pictures: ['C:\\a.png', 'C:\\b.png', 'C:\\c.png'], follows: 'A300' }
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 5', step, assets: [withPictures], now: at(10, 49), jobMs: 240_000 }), [])
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 5', step, assets: [withPictures], now: at(10, 53), jobMs: 240_000 }), [])
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 5', step, assets: [withPictures], now: at(10, 55), jobMs: 240_000 }).map(one => one.asset), ['A317'])
})

test('Resume all skips it, in the state\'s facts and in the main chat\'s list; without the records (the mutant) it is resumed', () => {
  const items = [B1124(), B1095()]
  const state = build(items, { assets: ROUND() })
  const pause = { state: 'resuming', since: NOW - MIN, pausedSince: at(10, 30) }
  assert.deepEqual(pauseFacts({ pause, items: storeOf(items), lanes: state.chats, prefix: PREFIX, assets: ROUND() }).waiting.map(one => one.chat), ['Worker 2'])
  assert.deepEqual(pauseAnswer({ pause, items: storeOf(items), lanes: state.chats, prefix: PREFIX, chat: 'Lead', role: 'main', assets: ROUND() }).resumeList.map(one => one.step), ['B1095'])
  assert.deepEqual(pauseFacts({ pause, items: storeOf(items), lanes: state.chats, prefix: PREFIX }).waiting.map(one => one.chat).sort(), ['Worker 2', 'Worker 5'])
  assert.deepEqual(pauseFacts({ pause, items: storeOf(items), lanes: state.chats, prefix: PREFIX, assets: DELIVERED() }).waiting.map(one => one.chat).sort(), ['Worker 2', 'Worker 5'])
  // The state carries the records for the server's own resume lists (its `assets`: the open ones and those ended within the hour).
  assert.deepEqual(state.assets.map(one => one.id), ['A224', 'A225', 'A226', 'A227'])
  assert.deepEqual(build(items, { assets: [request('A200', 'ready', { asked: at(8, 0), ended: at(8, 5) })] }).assets, [])
})

test('every reader of a working lane leaves it be: not running, idle, the checkpoint, the stop words, the wake, the hand-out', () => {
  const state = build([B1124()], { assets: ROUND() })
  const lane = laneOf(state)
  // The Supervisor's health: no odd line for Worker 5, and the line says what Codex does.
  const health = healthSummary(buildView({ state, items: storeOf([B1124()]), now: NOW }), NOW).split('\n').find(one => one.includes('Worker 5 (')) ?? ''
  assert.doesNotMatch(health, /^- !/, health)
  assert.match(health, /Codex draws 4 pictures for it/)
  // working-not-running: a lane working for Codex while its chat makes no call (isRunning false, no step known to the view) is no incident.
  const rule = WATCH_RULES.find(one => one.id === 'working-not-running')
  const quiet = { ...lane, isRunning: false }
  const ctx = { seen: new Map([['working-not-running Worker 5', NOW - 20 * MIN]]), observed: [] }
  assert.deepEqual(rule.check(viewOf({ ...state, chats: [laneOf(state, 'Lead'), quiet] }), ctx), [])
  // The mutant: the same quiet lane without the provider's work is the rule's.
  assert.equal(rule.check(viewOf({ ...state, chats: [laneOf(state, 'Lead'), { ...quiet, heldBy: null, assetWork: null }] }), ctx).length, 1)
  // checkpoint-late: the holder writes no checkpoint while Codex draws.
  const view = buildView({ state: { ...state, chats: [laneOf(state, 'Lead'), lane] }, items: storeOf([B1124({ Checkpoint: '-', Since: stamp(at(8, 0)) })]), now: NOW })
  assert.equal(checkpointLate(view.items.get('B1124'), view), null)
  assert.notEqual(checkpointLate(view.items.get('B1124'), buildView({ state: { ...state, chats: [laneOf(state, 'Lead'), { ...lane, heldBy: null }] }, items: view.items, now: NOW })), null)
  // The stop words at a full week: none to a chat that spends nothing while Codex draws.
  const full = { ...state, limits: { ...state.limits, week: { level: 'full', used: 98, stopAt: 98, resetsAt: null } }, pause: null }
  assert.deepEqual(weekStopDue({ ...full, chats: [{ ...lane, storeSteps: [{ id: 'B1124', state: 'in progress' }] }] }, []), [])
  assert.equal(weekStopDue({ ...full, chats: [{ ...lane, heldBy: null, storeSteps: [{ id: 'B1124', state: 'in progress' }] }] }, []).length, 1)
  // The 5-hour stop words neither; week-stop-ignored (a stop word delivered 25 min ago) is no incident for it.
  const fiveFull = { ...state, limits: { ...state.limits, fiveHour: { level: 'full', used: 99, stopAt: 95, resetsAt: NOW + 60 * MIN } }, pause: null }
  assert.deepEqual(fiveHourStopDue({ ...fiveFull, chats: [{ ...lane, storeSteps: [{ id: 'B1124', state: 'in progress' }] }] }, []), [])
  assert.equal(fiveHourStopDue({ ...fiveFull, chats: [{ ...lane, heldBy: null, storeSteps: [{ id: 'B1124', state: 'in progress' }] }] }, []).length, 1)
  const ignored = WATCH_RULES.find(one => one.id === 'week-stop-ignored')
  const word = { id: 'w1', to: 'Worker 5', command: 'week-stop', weekResets: null, state: 'delivered', deliveredAt: NOW - 25 * MIN, at: NOW - 25 * MIN }
  const weekView = lanes => buildView({ state: { ...full, chats: [laneOf(state, 'Lead'), ...lanes] }, items: new Map(), outbox: [word], now: NOW })
  assert.deepEqual(ignored.check(weekView([lane]), { seen: new Map(), observed: [] }), [])
  assert.equal(ignored.check(weekView([{ ...lane, heldBy: null }]), { seen: new Map([['week-stop-ignored Worker 5 w1', NOW - 25 * MIN]]), observed: [] }).length, 1)
  // The hand-over's decision for a lane that reads unknown (a report blip) while Codex draws: nothing given back, no "go on" line.
  const blipFacts = assets => factsOf({ lane: { ...lane, state: 'unknown' }, state: { chatPrefix: PREFIX, readyList: null, limits: state.limits, gaps: [], assets }, items: storeOf([B1124()]), pause: null, sent: [], config, now: NOW + 60 * MIN, event: { kind: 'pass' } })
  const blip = decide({ ...blipFacts(state.assets), ready: [], owed: null })
  assert.deepEqual([blip.giveBack ?? null, blip.goOn ?? null], [null, null])
  assert.notEqual(decide({ ...blipFacts([]), ready: [], owed: null }).goOn ?? null, null)
  // The hand-out: Worker 5 is no idle worker (it holds its step, and its lane works); the wake needs: nothing to wake it for.
  assert.deepEqual(idleWorkers(state.chats, { items: storeOf([B1124()]), prefix: PREFIX }).map(one => one.name), ['Worker 2'])
  assert.ok(!wakeNeeds({ ...state, restart: { main: 'Lead' } }, []).some(one => one.chat === 'Worker 5'), 'no wake need for Worker 5')
  // Its process ended while Codex draws (a routine chat sleeps between turns): still Working for that, the provider's word wakes it.
  const asleep = laneOf(build([B1124()], { assets: ROUND(), state: 'ended', reportAt: at(10, 43) }))
  assert.deepEqual([asleep.status, asleep.why, asleep.state, asleep.asleep], ['Working', LINE, 'working', true])
  assert.ok(!wakeNeeds({ ...build([B1124()], { assets: ROUND(), state: 'ended', reportAt: at(10, 43) }), restart: { main: 'Lead' } }, []).some(one => one.chat === 'Worker 5'), 'no wake need for the sleeper either')
})

test('it ends by itself: delivered, the lane is Stopped as before; failed, the lane shows the failure with the go-on time', () => {
  const delivered = build([B1124()], { assets: DELIVERED(), now: at(10, 59) })
  assert.equal(laneOf(delivered).status, 'Stopped')
  assert.equal(laneOf(delivered).why, 'task open since 10:43')
  assert.equal(delivered.stepStatus.B1124.words, 'Worker 5 is on it')
  // The last request failed at 10:58 (Codex over its time limit): the lane says so instead of a silent Stopped.
  const lane = laneOf(build([B1124()], { assets: FAILED(), now: at(10, 59) }))
  assert.equal(lane.status, 'Stopped')
  assert.equal(lane.why, `A227 failed: ${WHY}`)
  assert.equal(assetFailureOf(B1124(), FAILED(), { chat: 'Worker 5', now: at(10, 59) }).name, 'walk north')
  // Not while another request of the step is still open, not after the holder's next checkpoint or turn, not after half an hour.
  assert.equal(assetFailureOf(B1124(), [...FAILED(), request('A228', 'waiting', { asked: at(10, 59) })], { chat: 'Worker 5', now: at(11, 0) }), null)
  assert.equal(assetFailureOf(B1124(), FAILED(), { chat: 'Worker 5', now: at(11, 0), progressAt: at(10, 59) }), null)
  assert.equal(laneOf(build([B1124()], { assets: FAILED(), now: at(11, 40) })).why, 'task open since 10:43')
  // The mutant: a lane that reads Stopped for nothing else than the failure says the failure, never "task open since".
  assert.notEqual(lane.why, 'task open since 10:43')
})

test('the cap: past Codex\'s time limit for a job one Late "Codex has not delivered attack since 10:47", never a give-back', () => {
  // At 10:53 A225 (attack, running since 10:47) is past 240 s and the minute of grace; A226 and A227 wait behind it and are not late.
  const late = build([B1124()], { assets: ROUND(), now: at(10, 53) })
  const cards = lates(late)
  assert.equal(cards.length, 1)
  assert.equal(cards[0].id, 'asset:A225')
  assert.equal(cards[0].title, 'Codex has not delivered attack since 10:47 on B1124')
  assert.equal(cards[0].step, 'B1124')
  assert.match(cards[0].text, /A225 \(attack\)/)
  assert.match(cards[0].text, /past its time limit for one job/)
  assert.match(cards[0].text, /no "go on" line, nothing given back/)
  // The lane keeps working for Codex, and the timers stay off: the Late is the person's, the step stays with Worker 5.
  assert.equal(laneOf(late).status, 'Working')
  assert.equal(timers(late, ROUND(), at(10, 53), { ...laneOf(late), state: 'interrupted' }), null)
  // Within the limit (10:49) nothing is late; with the Design tab's longer limit (600 s) neither.
  assert.deepEqual(lates(build([B1124()], { assets: ROUND() })), [])
  assert.deepEqual(lates(build([B1124()], { assets: ROUND(), now: at(10, 53), assetSeconds: 600 })), [])
  // A waiting request behind nothing running counts from the newest end of its provider's jobs (the hand-off is no wait: finding 4).
  const handOff = [request('A224', 'ready', { started: ASKED, ended: at(10, 52) }), request('A225', 'waiting')]
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 5', step: B1124(), assets: handOff, now: at(10, 53), jobMs: 240_000 }), [])
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 5', step: B1124(), assets: handOff, now: at(10, 58), jobMs: 240_000 }).map(one => one.asset), ['A225'])
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 5', step: B1124(), assets: [request('A225', 'waiting')], now: at(10, 49), jobMs: 240_000 }).map(one => one.asset), ['A225'])
})

test('the person\'s pause holds the Late; a person\'s or a pick\'s request is the person\'s: parked "waits for your file", never late', () => {
  const work = storeFromText('## Garden\n', { now: at(8, 0) })
  work.items.set('B1124', B1124())
  work.activities[0].steps.push('B1124')
  work.pause = { state: 'pausing', since: at(10, 50), by: 'person' }
  const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at(10, 10), lastAssistantUuid: 'u-1' })
  const raw = { listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: {}, planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: at(8, 0), assets: ROUND(), assetSeconds: 240 }
  const report = name => [name, { state: 'idle', since: ASKED, at: at(10, 53) - 5_000, session: `cli-${name}`, mod: '0.31.0', background: false, run: 1, seq: 1, busyAt: null }]
  const paused = buildState(raw, { lines: [], outbox: [], runs: [], now: at(10, 53), config, seen: { shown: {}, other: {} }, board: { startedAt: at(8, 0), offSince: null }, reports: new Map(NAMES.map(report)) })
  assert.deepEqual(lates(paused), [])
  // A manual request: the person drops the file. The lane is parked for it, quiet, and no Late comes however long it takes.
  const manual = [request('A230', 'waiting', { provider: 'manual', mode: 'person' })]
  const state = build([B1124()], { assets: manual, now: at(12, 0) })
  const lane = laneOf(state)
  assert.deepEqual([lane.status, lane.why, lane.state], ['Paused', 'waits for your file (A230) since 10:43', 'suspended'])
  assert.deepEqual([lane.suspended.by, lane.suspended.kind, lane.suspended.on, lane.suspended.what, lane.suspended.link], ['parked', 'asset', ['you'], 'your file (A230)', '#details=B1124'])
  assert.equal(lane.assetWork, null)
  assert.deepEqual([state.stepStatus.B1124.kind, state.stepStatus.B1124.words], ['asset', 'waits for your file (A230) since 10:43'])
  assert.deepEqual(lates(state), [])
  assert.equal(timers(state, manual, at(12, 0), { ...lane, state: 'interrupted' }), null)
  assert.deepEqual(pauseFacts({ pause: { state: 'resuming', since: at(11, 59), pausedSince: at(11, 30) }, items: storeOf([B1124()]), lanes: state.chats, prefix: PREFIX, assets: manual }).waiting, [])
  // A pick request (the sound library) is the chat's own job: no wait at all, the lane Stopped as before, the timers run (the review's finding 1).
  const pick = [request('A231', 'waiting', { provider: 'sound-library', mode: 'pick' })]
  const picking = build([B1124()], { assets: pick })
  assert.deepEqual([laneOf(picking).status, laneOf(picking).suspended, assetWaitOf(B1124(), pick, { chat: 'Worker 5' })], ['Stopped', null, null])
  assert.ok(timers(picking, pick, ASKED + 6 * MIN)?.resume !== null, 'the "go on" line goes to a chat that has to pick')
  // An auto request open beside a person's: the provider's work shows (mode auto wins).
  const mixed = [...manual, request('A232', 'running', { started: ASKED })]
  assert.deepEqual([assetWaitOf(B1124(), mixed, { chat: 'Worker 5' }).mode, laneOf(build([B1124()], { assets: mixed })).status], ['auto', 'Working'])
})

test('the page: the Working pill, its why linked to the step, the ticks under the task, no warn colour', async () => {
  const first = build([B1124()], { assets: ROUND() })
  const built = build([B1124()], { assets: ROUND(), lines: changes(new Map(), first.chats, at(10, 45)) })
  const state = JSON.parse(JSON.stringify(built))
  const page = await openPage({ state, now: NOW })
  try {
    const row = page.all('#lanes [data-lane]').find(one => one.dataset.lane === 'Worker 5')
    assert.ok(row !== undefined, 'Worker 5 has its row')
    const pill = row.querySelector('.pill')
    assert.equal(pill.dataset.status, 'Working')
    const why = row.querySelector('a.status-why.asset-wait')
    assert.ok(why !== null, 'the why is a link')
    assert.equal(why.getAttribute('href'), '#details=B1124')
    assert.equal(`${pill.textContent} · ${why.textContent}`, `Working · ${LINE}`)
    const task = row.querySelector('.held-task')
    assert.match(task.textContent.replace(/\s+/g, ' ').trim(), /^B1124 Draw all eight Knight animations in the picked version · Codex draws: death ✓ · attack … · hit … · walk north …$/)
    assert.equal(task.querySelector('a.asset-wait').getAttribute('href'), '#details=B1124')
    assert.ok(!row.classList.contains('is-interrupted'), 'not the warn lane')
    assert.equal(page.all('.track .span.is-interrupted').length, 0)
    assert.ok(page.all('.track .span.is-working').length > 0, 'a working span')
  } finally { await page.close() }
})

test('the stepStatus keeps one order with the lane: a recap wait wins over the provider\'s work; without the records, Working', () => {
  const Q715 = file({ Id: 'Q715', Kind: 'ask', Title: 'Do the bridges read?', State: 'open', Owner: 'Worker 5', Since: stamp(at(10, 30)), Filed: String(at(10, 30)), Asks: 'look', Blocking: 'no', Of: 'B1124', Route: 'recap' }, { Text: ['Do the bridges read?'] })
  assert.equal(stepStatusOf(B1124(), { items: new Map([['Q715', Q715]]), assets: ROUND() }).kind, 'recap')
  assert.equal(stepStatusOf(B1124(), { assets: ROUND() }).kind, 'asset')
  assert.equal(stepStatusOf(B1124(), {}).kind, 'working')
  assert.equal(stepStatusOf(B1124(), { assets: DELIVERED() }).kind, 'working')
})
