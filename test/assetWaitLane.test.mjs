// The asset wait (chat 1's brief of 2026-11-11 under the person's "Yes, build now", the live case of 10:43): Worker 5 held B1124 and
// ended its turns to wait for the pictures it asked Codex for through `work asset` (A224-A227). Between its turns the lane read
// Stopped (interrupted), the holder timers would have typed "go on" after 5 min and given the step back after 20 while Codex was
// still drawing; the person asked "why has worker 5 stopped?". Now an open request of the holder for its held step is a recorded
// wait, P1's parked shape with kind asset (src/work/assetWait.mjs): the lane reads quiet "Paused · waits for Codex: A224-A227 since
// 10:43", linked to the step; the holder timers stay off; Resume all skips it; it ends by itself when the last request is ready or
// failed, a failed one showing its failure; past the provider's time limit for a job it turns one Late "Codex has not delivered A224
// since 10:43", never a give-back. Trimmed from the live records, made-up paths only. Not in it: the queue, Codex, the wake.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { toneOf } from '../src/chatStatus.mjs'
import { changes, today } from '../src/history.mjs'
import { stepStatusOf } from '../src/stepStatus.mjs'
import { assetIdsWords, assetWaitOf, assetWaitWords, assetFailureOf, lateAssetsOf } from '../src/work/assetWait.mjs'
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
const WORDS = 'waits for Codex: A224-A227 since 10:43'

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const B1124 = (more = {}) => file({ Id: 'B1124', Kind: 'step', Title: 'Draw all eight Knight animations in the picked version', State: 'in progress', Owner: 'Worker 5', Activity: 'Garden', Goal: 'G66', Since: stamp(at(10, 28)), Checkpoint: `7bc2781b · Correction round 1 asked: A224 death, A225 attack, A226 hit, A227 walk north · ${stamp(at(10, 43))}`, ...more })
const B1095 = () => file({ Id: 'B1095', Kind: 'step', Title: 'Lava rim shader', State: 'in progress', Owner: 'Worker 2', Activity: 'Garden', Goal: 'G60', Since: stamp(at(10, 20)) })
/** A request as request.json keeps it (src/assets.mjs), trimmed: who, of, provider, state, why and its times. */
const request = (id, state, { who = 'Worker 5', of = 'B1124', provider = 'codex', asked = ASKED, started = null, ended = null, why = '' } = {}) =>
  ({ id, who, of, kind: 'visual', provider, mode: 'auto', text: 'The Knight', pictures: [], follows: null, state, why, files: state === 'ready' ? ['1.png'] : [], ask: null, pick: null, times: { asked, started, ended } })
/** The live round at 10:49: A224 running since 10:43, A225 to A227 waiting behind it (Codex draws one at a time). */
const ROUND = () => [request('A224', 'running', { started: ASKED }), request('A225', 'waiting'), request('A226', 'waiting'), request('A227', 'waiting')]
const DELIVERED = () => ['A224', 'A225', 'A226', 'A227'].map(id => request(id, 'ready', { started: ASKED, ended: at(10, 47) }))

function build(items, { assets = [], state = 'idle', lines = [], now = NOW, assetSeconds = 240 } = {}) {
  const work = storeFromText('## Garden\n', { now: at(8, 0) })
  for (const item of items) {
    work.items.set(item.head.get('Id'), item)
    if (item.head.get('Kind') === 'step') work.activities[0].steps.push(item.head.get('Id'))
  }
  const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at(10, 10), lastAssistantUuid: 'u-1' })
  const tail = { text: '', isCut: false, modifiedAt: at(10, 10) }
  const report = (name, since) => [name, { state, since, background: false, run: 1, seq: 1, at: now - 5_000, session: `cli-${name}`, mod: '0.31.0', busyAt: null }]
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])), planLineTexts: {},
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: at(8, 0), assets, assetSeconds,
  }
  return buildState(raw, { lines, outbox: [], runs: [], now, config, seen: { shown: {}, other: {} }, board: { startedAt: at(8, 0), offSince: null }, reports: new Map([report('Lead', at(9, 0)), report('Worker 5', ASKED), report('Worker 2', at(10, 25)), report('Advisor', at(9, 0))]) })
}
const laneOf = (state, name = 'Worker 5') => state.chats.find(one => one.name === name)
const storeOf = items => new Map(items.map(one => [one.head.get('Id'), one]))
const lates = state => state.forYou.filter(one => one.kind === 'wait late')
const timers = (state, assets, now = NOW) => holderTimers({ worker: laneOf(state), holding: B1124(), items: storeOf([B1124()]), prefix: PREFIX, assets, runningMs: from => now - from })

test('the live case: Worker 5 is parked for Codex, "Paused · waits for Codex: A224-A227 since 10:43", quiet, never Stopped', () => {
  const state = build([B1124()], { assets: ROUND() })
  const lane = laneOf(state)
  assert.equal(lane.status, 'Paused')
  assert.equal(lane.why, WORDS)
  assert.equal(toneOf(lane.status), 'quiet')
  assert.equal(lane.state, 'suspended')
  // P1's parked shape, kind asset: the provider as who, the ids as what, the oldest request's time as since, no limit.
  const { since, ...shape } = lane.suspended
  assert.deepEqual(shape, { by: 'parked', kind: 'asset', on: ['Codex'], what: 'Codex: A224-A227', limit: null, link: '#details=B1124', ids: ['A224', 'A225', 'A226', 'A227'], until: null, isBack: false })
  assert.equal(since, ASKED)
  // The one status of the step says the same, quiet, linked to the step's window.
  const status = state.stepStatus.B1124
  assert.deepEqual([status.kind, status.label, status.tone, status.words, status.link, status.why], ['asset', 'Waits for Codex', 'quiet', 'waits for Codex: A224-A227', '#details=B1124', 'A224, A225, A226, A227'])
  // The day bar: the quiet suspended colour, never interrupted.
  const spans = today(changes(new Map(), state.chats, at(10, 45)), { from: at(10, 0), to: NOW, names: ['Worker 5'] })[0].spans
  assert.deepEqual(spans.map(one => one.state), ['suspended'])
  // No holder timer: no "go on" line and no give-back, however long Codex draws.
  assert.equal(timers(state, ROUND(), NOW + 60 * MIN), null)
  // The hand-over's decision reads the same facts: the parked lane is suspended for it, and a stale "go on" line would be closed.
  const facts = factsOf({ lane, state: { chatPrefix: PREFIX, readyList: null, limits: state.limits, gaps: state.gaps ?? [], assets: state.assets }, items: storeOf([B1124()]), pause: null, sent: [], config, now: NOW, event: { kind: 'pass' } })
  assert.deepEqual(facts.assets.map(one => one.id), ['A224', 'A225', 'A226', 'A227'])
  const decided = decide({ ...facts, ready: [], owed: null })
  assert.equal(decided.state, 'suspended')
  assert.equal(decided.giveBack ?? null, null)
})

test('the mutant: the same stopped worker without the records is what the person saw, Stopped, nudged and given back', () => {
  const state = build([B1124()], { assets: [] })
  assert.equal(laneOf(state).status, 'Stopped')
  assert.equal(laneOf(state).state, 'interrupted')
  assert.equal(state.stepStatus.B1124.kind, 'working')
  // The holder timers run: a "go on" line is due after 5 stopped minutes, and the give-back after its 15 more.
  const nudged = timers(state, [], ASKED + 6 * MIN)
  assert.ok(nudged !== null && nudged.resume !== null, 'the "go on" line is due')
  // The records given to the timers are what keeps them off: the state's lane may read Stopped (a report blip) and the wait still holds.
  assert.equal(holderTimers({ worker: { ...laneOf(state), state: 'unknown' }, holding: B1124(), items: storeOf([B1124()]), prefix: PREFIX, assets: ROUND(), runningMs: from => NOW + 60 * MIN - from }), null)
})

test('only the holder\'s own open requests for the step it holds count', () => {
  const step = B1124()
  // Another chat's request for the step is no wait of Worker 5's; a ready or failed one is over; a request of another step is not this one's.
  assert.equal(assetWaitOf(step, [request('A230', 'waiting', { who: 'Worker 2' })], { chat: 'Worker 5', prefix: PREFIX }), null)
  assert.equal(assetWaitOf(step, [request('A224', 'ready', { ended: at(10, 47) }), request('A225', 'failed', { ended: at(10, 47), why: 'x' })], { chat: 'Worker 5' }), null)
  assert.equal(assetWaitOf(step, [request('A231', 'waiting', { of: 'B1095' })], { chat: 'Worker 5' }), null)
  // The who with the prefix, as the board may name the chat, is the same chat.
  assert.deepEqual(assetWaitOf(step, [request('A224', 'running', { who: `${PREFIX}Worker 5` })], { chat: 'Worker 5', prefix: PREFIX })?.ids, ['A224'])
  // A step not at work waits for nothing, whatever stands open under it.
  assert.equal(assetWaitOf(B1124({ State: 'review' }), ROUND(), { chat: 'Worker 5' }), null)
  // The words: a row of ids, a gap, many.
  assert.equal(assetIdsWords(['A227', 'A224', 'A225', 'A226']), 'A224-A227')
  assert.equal(assetIdsWords(['A224', 'A226']), 'A224, A226')
  assert.equal(assetIdsWords(['A1', 'A3', 'A5', 'A7', 'A9']), 'A1, A3, A5, A7 +1')
  assert.equal(assetWaitWords({ by: 'parked', kind: 'asset', on: ['Codex'], what: 'Codex: A224', since: ASKED }), 'waits for Codex: A224 since 10:43')
  // A chat that is busy now is Working: the wait parks only a stopped chat.
  assert.equal(laneOf(build([B1124()], { assets: ROUND(), state: 'busy' })).status, 'Working')
})

test('Resume all skips it: neither the resume\'s waiting list nor the main chat\'s resume list names Worker 5; Worker 2 is', () => {
  const items = [B1124(), B1095()]
  const state = build(items, { assets: ROUND() })
  const pause = { state: 'resuming', since: NOW - MIN, pausedSince: at(10, 30) }
  assert.deepEqual(pauseFacts({ pause, items: storeOf(items), lanes: state.chats, prefix: PREFIX, assets: ROUND() }).waiting.map(one => one.chat), ['Worker 2'])
  assert.deepEqual(pauseAnswer({ pause, items: storeOf(items), lanes: state.chats, prefix: PREFIX, chat: 'Lead', role: 'main', assets: ROUND() }).resumeList.map(one => one.step), ['B1095'])
  // Without the records (the mutant) it is resumed as every holder; once delivered too.
  assert.deepEqual(pauseFacts({ pause, items: storeOf(items), lanes: state.chats, prefix: PREFIX }).waiting.map(one => one.chat).sort(), ['Worker 2', 'Worker 5'])
  assert.deepEqual(pauseFacts({ pause, items: storeOf(items), lanes: state.chats, prefix: PREFIX, assets: DELIVERED() }).waiting.map(one => one.chat).sort(), ['Worker 2', 'Worker 5'])
})

test('it ends by itself: delivered, the lane is Stopped as before and the timers run; failed, the lane shows the failure', () => {
  const delivered = build([B1124()], { assets: DELIVERED() })
  assert.equal(laneOf(delivered).status, 'Stopped')
  assert.equal(laneOf(delivered).why, 'task open since 10:43')
  assert.ok(timers(delivered, DELIVERED(), ASKED + 6 * MIN)?.resume !== null, 'the "go on" line goes again')
  // The last request failed at 10:47 (Codex over its time limit): the lane says so instead of a silent Stopped.
  const WHY = 'Codex took longer than 240 seconds and was stopped.'
  const failed = [...DELIVERED().slice(0, 3), request('A227', 'failed', { started: ASKED, ended: at(10, 47), why: WHY })]
  const lane = laneOf(build([B1124()], { assets: failed }))
  assert.equal(lane.status, 'Stopped')
  assert.equal(lane.why, `A227 failed: ${WHY}`)
  assert.equal(lane.suspended, null)
  assert.equal(assetFailureOf(B1124(), failed, { chat: 'Worker 5', now: NOW }).text, `A227 failed: ${WHY}`)
  // Not while another request of the step is still open (the wait stands), not after the holder's next checkpoint, not after half an hour.
  assert.equal(assetFailureOf(B1124(), [...failed, request('A228', 'waiting', { asked: at(10, 48) })], { chat: 'Worker 5', now: NOW }), null)
  assert.equal(assetFailureOf(B1124({ Checkpoint: `8cd1234a · Asked A228 instead · ${stamp(at(10, 48))}` }), failed, { chat: 'Worker 5', now: NOW, progressAt: at(10, 48) }), null)
  assert.equal(laneOf(build([B1124()], { assets: failed, now: at(11, 20) })).why, 'task open since 10:43')
})

test('the cap: past Codex\'s time limit for a job the wait turns one Late "Codex has not delivered A224 since 10:43", never a give-back', () => {
  // 240 s and a minute of grace: at 10:49 A224 (running since 10:43) is late; A225-A227 wait behind it and are not.
  const late = build([B1124()], { assets: ROUND() })
  const cards = lates(late)
  assert.equal(cards.length, 1)
  assert.equal(cards[0].id, 'asset:A224')
  assert.equal(cards[0].title, 'Codex has not delivered A224 since 10:43 on B1124')
  assert.equal(cards[0].step, 'B1124')
  assert.match(cards[0].text, /past its time limit for one job/)
  assert.match(cards[0].text, /no "go on" line, nothing given back/)
  // The lane stays parked, and the timers stay off: the Late is the person's, the step stays with Worker 5.
  assert.equal(laneOf(late).status, 'Paused')
  assert.equal(timers(late, ROUND(), NOW), null)
  // Within the limit (10:47, four minutes in) nothing is late; with the Design tab's longer limit (600 s) neither.
  assert.deepEqual(lates(build([B1124()], { assets: ROUND(), now: at(10, 47) })), [])
  assert.deepEqual(lates(build([B1124()], { assets: ROUND(), assetSeconds: 600 })), [])
  // A waiting request behind nothing running (a stuck queue) is late past the limit since it was asked; behind a running one it is not.
  const stuck = [request('A225', 'waiting')]
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 5', step: B1124(), assets: stuck, now: NOW, jobMs: 240_000 }).map(one => one.asset), ['A225'])
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 5', step: B1124(), assets: ROUND(), now: NOW, jobMs: 240_000 }).map(one => one.asset), ['A224'])
  // The person's pause is no waiting: no Late while the board pauses.
  const work = storeOf([B1124()])
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 5', step: work.get('B1124'), assets: ROUND(), now: at(10, 46) }), [])
})

test('the page: the pill reads Paused, its why links the step, the row says it quiet, the day bar draws no warn colour', async () => {
  const first = build([B1124()], { assets: ROUND() })
  const built = build([B1124()], { assets: ROUND(), lines: changes(new Map(), first.chats, at(10, 45)) })
  const state = JSON.parse(JSON.stringify(built))
  const page = await openPage({ state, now: NOW })
  try {
    const row = page.all('#lanes [data-lane]').find(one => one.dataset.lane === 'Worker 5')
    assert.ok(row !== undefined, 'Worker 5 has its row')
    const pill = row.querySelector('.pill')
    assert.equal(pill.dataset.status, 'Paused')
    assert.ok(pill.classList.contains('is-paused'), 'the quiet paused pill')
    const why = row.querySelector('a.status-why.asset-wait')
    assert.ok(why !== null, 'the why is a link')
    assert.equal(why.getAttribute('href'), '#details=B1124')
    assert.equal(`${pill.textContent} · ${why.textContent}`, `Paused · ${WORDS}`)
    const task = row.querySelector('.held-task')
    assert.match(task.textContent.replace(/\s+/g, ' ').trim(), /^B1124 Draw all eight Knight animations in the picked version · waits for Codex: A224-A227$/)
    assert.equal(task.querySelector('a.asset-wait').getAttribute('href'), '#details=B1124')
    assert.ok(!row.classList.contains('is-interrupted'), 'not the warn lane')
    assert.ok(!row.querySelector('.is-interrupted, .pill.is-working'), 'no warn pill, no Working pill')
    assert.ok(page.all('.track .span.is-suspended').length > 0, 'a suspended span')
    assert.equal(page.all('.track .span.is-interrupted').length, 0)
  } finally { await page.close() }
})

test('the stepStatus reads the wait on its own: with the records kind asset; without, Working', () => {
  assert.equal(stepStatusOf(B1124(), { assets: ROUND() }).kind, 'asset')
  assert.equal(stepStatusOf(B1124(), { assets: ROUND(), prefix: PREFIX }).words, 'waits for Codex: A224-A227')
  assert.equal(stepStatusOf(B1124(), {}).kind, 'working')
  assert.equal(stepStatusOf(B1124(), { assets: DELIVERED() }).kind, 'working')
})
