// B930 (X131, X109): a worker that stopped its own background work is cleared after its step at the first try. Part 1: a stop
// the chat made ends the count (the app writes no notification for it). Part 2: the clear's refusal, the hold's release and
// the lane read one source (chatReport.mjs `backgroundOf`: the mod's fresh idle report, else the transcript). Part 3: a clear
// that failed on the board's own time-out is released by the next report, once per step. The real case's shapes, made up.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, user } from '../../fixtures/lines.mjs'
import { CLEARS_AT, REFUSED_WHY, REPORTED_AT, TIMED_OUT_WHY, cet, launched, stopped, stoppedTwice } from '../../fixtures/stoppedBackground.mjs'
import { clearRefusal } from '../../src/bridge.mjs'
import { backgroundOf } from '../../src/chatReport.mjs'
import { clearOwed } from '../../src/clearOwed.mjs'
import { HANDOVER_COMMAND, HANDOVER_MOD, STATES, decide, isBoardTimeout, laneWords, timedOutTwiceWhy } from '../../src/work/handover.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { backgroundRunning, parseTail } from '../../src/transcript.mjs'
import { parseConfig } from '../../src/config.mjs'
import { storeFromText } from '../../src/work/read.mjs'
import { buildState } from '../withStore.mjs'

const MIN = 60_000
const FRESH_MS = 30_000
const count = lines => backgroundRunning(parseTail(lines.join('\n'), false))

test('Part 1, the real case: two commands the chat stopped itself count none, though the app wrote no notification', () => {
  const lines = stoppedTwice()
  assert.equal(count(lines.slice(0, 2)), 1, 'the first command runs')
  assert.equal(count(lines.slice(0, 4)), 0, 'its stop ends it')
  assert.equal(count(lines.slice(0, 6)), 1, 'the second command runs')
  assert.equal(count(lines), 0, 'the second stop ends it: nothing runs after the report')
})

test('Part 1: a stop ends only the task it names; a failed stop, a stop not seen launched, or words that only quote one end nothing', () => {
  const two = [...launched(cet(15, 30), 'toolu_a', 'bb65oc2x2'), ...launched(cet(15, 31), 'toolu_b', 'bvr2wx5br')]
  assert.equal(count([...two, ...stopped(cet(15, 40), 'toolu_s', 'bvr2wx5br')]), 1)
  assert.equal(count([...two, ...stopped(cet(15, 40), 'toolu_s', 'bzzzzzzzz')]), 2, 'a stop naming another task ends none of these')
  assert.equal(count([...two, ...stopped(cet(15, 40), 'toolu_s', 'bb65oc2x2', { isError: true })]), 2, 'a stop that failed ends nothing')
  // A command's output that only mentions the words (a grep of a log) is no stop.
  const quoted = user(cet(15, 41), [{ tool_use_id: 'toolu_g', type: 'tool_result', content: 'log.txt:12: {"message":"Successfully stopped task: bb65oc2x2 (x)"}' }])
  assert.equal(count([...two, quoted]), 2)
  // A stop of a task launched before the tail began ends none seen here; a stop twice ends one.
  assert.equal(count([...launched(cet(15, 30), 'toolu_a', 'bb65oc2x2'), ...stopped(cet(15, 40), 'toolu_s', 'bb65oc2x2'), ...stopped(cet(15, 41), 'toolu_t', 'bb65oc2x2')]), 0)
  assert.equal(count([...two, ...stopped(cet(15, 40), 'toolu_s', 'bb65oc2x2'), ...stopped(cet(15, 41), 'toolu_t', 'bb65oc2x2')]), 1)
  // A subagent stopped by its agent id ends too; a notification still ends the call it names (B310).
  const agent = user(cet(15, 32), [{ tool_use_id: 'toolu_c', type: 'tool_result', content: [{ type: 'text', text: 'Async agent launched successfully.\nagentId: a46c0b4025b81a140 (internal ID)' }] }])
  assert.equal(count([agent, ...stopped(cet(15, 40), 'toolu_s', 'a46c0b4025b81a140')]), 0)
  const notified = user(cet(15, 45), '<task-notification>\n<task-id>bb65oc2x2</task-id>\n<tool-use-id>toolu_a</tool-use-id>\n<status>completed</status>\n</task-notification>', { origin: { kind: 'task-notification' } })
  assert.equal(count([...two, notified]), 1)
  assert.equal(count([...two, notified, ...stopped(cet(15, 50), 'toolu_s', 'bvr2wx5br'), answer(cet(15, 51), 'Done.')]), 0)
})

test('Part 2, one source: the mod\'s fresh idle report decides; a stale, busy or other session\'s report leaves it to the transcript', () => {
  const now = cet(16, 17, 6)
  const transcript = () => 2
  const report = { state: 'idle', since: cet(16, 17, 0), background: false, at: now - 2000, session: 'w4' }
  assert.equal(backgroundOf(report, { session: 'w4', now, freshMs: FRESH_MS, transcript }), 0)
  assert.equal(backgroundOf({ ...report, background: true }, { session: 'w4', now, freshMs: FRESH_MS, transcript }), 1)
  assert.equal(backgroundOf({ ...report, at: now - FRESH_MS - 1 }, { session: 'w4', now, freshMs: FRESH_MS, transcript }), 2, 'stale')
  assert.equal(backgroundOf({ ...report, state: 'busy' }, { session: 'w4', now, freshMs: FRESH_MS, transcript }), 2, 'busy says nothing of the background')
  assert.equal(backgroundOf({ ...report, session: 'w4-old' }, { session: 'w4', now, freshMs: FRESH_MS, transcript }), 2, 'another session')
  assert.equal(backgroundOf(null, { session: 'w4', now, freshMs: FRESH_MS, transcript }), 2, 'no report')
})

// The hand-over as the board met it: Worker 4 reported B917; its mod reports idle with nothing in the background (it took its
// stopped ids off), its transcript counts what it shows (`entries`). Every 5 s the board decides; a clear it sends is answered
// as the save-log would answer it: refused when the one source counts background work, else cleared.
const NAME = 'Worker 4'
const file = (head, history) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n## History\n${history.join('\n')}\n`)
const items = () => new Map([['B917', file({ Id: 'B917', Kind: 'step', Title: 'Task B917', State: 'review', Owner: NAME, Since: stamp(REPORTED_AT) }, [
  `- ${stamp(REPORTED_AT - 60 * MIN)} ${NAME}: queued → taken`, `- ${stamp(REPORTED_AT)} ${NAME}: in progress → review`, `- ${stamp(REPORTED_AT)} server: check passed`,
])]])
const STATE = { chats: [{ name: 'Main', isMain: true, session: 'm' }, { name: NAME, isMain: false, session: 'w4' }] }
const laneAt = (now, entries, { background = false } = {}) => {
  const report = { state: 'idle', since: cet(16, 17, 0), background, at: now, session: 'w4' }
  const count = backgroundOf(report, { session: 'w4', now, freshMs: FRESH_MS, transcript: () => backgroundRunning(entries) })
  return { name: NAME, state: 'free', isMain: false, isLeftover: false, isRunning: true, mod: HANDOVER_MOD, model: 'claude-opus-5-5', report, background: count }
}

function handOver(entries, { from = cet(16, 17, 1), to = cet(16, 24, 30), background = false } = {}) {
  const envelopes = []
  for (let now = from; now <= to; now += 5000) {
    const lane = laneAt(now, entries, { background })
    const owed = clearOwed({ lane, items: items(), afterStep: 'clear' })
    const decision = decide({ worker: lane, items: items(), ready: [], owed, envelopes, now })
    if (decision.envelope?.clear == null) continue
    const refused = clearRefusal(STATE, NAME, lane.background)
    const outcome = refused === null ? { cleared: true, set: null, typed: null, restarted: null, background: false, why: null }
      : { cleared: false, set: null, typed: null, restarted: null, background: true, why: REFUSED_WHY }
    envelopes.push({ id: `e${envelopes.length}`, at: now, to: NAME, command: HANDOVER_COMMAND, ...decision.envelope, state: refused === null ? 'delivered' : 'failed', settledAt: now + 1000, outcome })
    if (refused === null) break
  }
  return envelopes
}

test('Part 2, the real case 16:17-16:24: one clear after the report, not 34; refusal and release agree at every report', () => {
  // Today's transcript: both stops end the count, so the refusal agrees with the mod.
  const first = handOver(parseTail(stoppedTwice().join('\n'), false))
  assert.deepEqual(first.map(one => one.outcome.cleared), [true])
  // A transcript that still counts one (as on 2 Nov, before Part 1): the fresh idle report decides both, so still one clear.
  const counted = parseTail([...launched(cet(15, 57, 17), 'toolu_watch2', 'bvr2wx5br'), answer(cet(16, 17, 0), 'B917 is reported.')].join('\n'), false)
  assert.deepEqual(handOver(counted).map(one => one.outcome.cleared), [true])
  // The board sent 34 clears that day; the release and the refusal now read one count, so a refusal is never followed by a
  // release on another reading: with the mod saying background work runs, one clear is refused and the worker stays HELD.
  assert.equal(CLEARS_AT.length, 34)
  const held = handOver(counted, { background: true })
  assert.deepEqual(held.map(one => one.outcome.cleared), [false])
})

/** A clear envelope for B917 that failed on the board's own time-out (the last of 2 Nov, 16:23:54, failed 16:24:12). */
const timedOut = (id, at, step = 'B917') => ({
  id, at, to: NAME, command: HANDOVER_COMMAND, kind: 'clear', step: null, clear: { step, reportedAt: REPORTED_AT }, restart: false, set: null, line: null, back: null,
  state: 'failed', settledAt: at + 18_000, failedAt: at + 18_000, outcome: { cleared: false, set: null, typed: null, restarted: null, background: false, why: TIMED_OUT_WHY },
})

test('Part 3: a clear that failed on the board\'s own time-out is released by the next report, once per step; a second keeps it HELD', () => {
  const entries = parseTail(stoppedTwice().join('\n'), false)
  const failedAt = cet(16, 24, 12)
  const first = timedOut('e33', cet(16, 23, 54))
  assert.equal(isBoardTimeout(first), true)
  assert.equal(isBoardTimeout({ ...first, outcome: { ...first.outcome, why: REFUSED_WHY, background: true } }), false, 'a refusal is no time-out')
  assert.equal(isBoardTimeout({ ...first, outcome: { ...first.outcome, why: 'a new prompt came in before the clear' } }), false, 'nor is the chat\'s own reason')
  const at = now => {
    const lane = laneAt(now, entries)
    return decide({ worker: lane, items: items(), ready: [], owed: clearOwed({ lane, items: items(), afterStep: 'clear' }), envelopes: [first], now })
  }
  // Before a report after the failure: HELD (the report that came before it does not count).
  const before = decide({ worker: { ...laneAt(failedAt, entries), report: { ...laneAt(failedAt, entries).report, at: failedAt - 1000 } }, items: items(), ready: [], owed: clearOwed({ lane: laneAt(failedAt, entries), items: items(), afterStep: 'clear' }), envelopes: [first], now: failedAt })
  assert.equal(before.state, STATES.HELD)
  // Its next report: released, the clear sent again.
  const next = at(failedAt + 5000)
  assert.notEqual(next.state, STATES.HELD)
  assert.equal(next.envelope?.clear?.step, 'B917')
  // A second time-out for the same step: HELD, also at later reports (no loop; the back-off is part 4).
  const second = timedOut('e34', failedAt + 5000)
  for (const now of [failedAt + 30_000, failedAt + 60_000, failedAt + 10 * MIN]) {
    const lane = laneAt(now, entries)
    const still = decide({ worker: lane, items: items(), ready: [], owed: clearOwed({ lane, items: items(), afterStep: 'clear' }), envelopes: [first, second], now })
    assert.equal(still.state, STATES.HELD, `still HELD at ${new Date(now).toISOString()}`)
    // Its lane says why it stays held (until part 4's back-off exists).
    assert.equal(laneWords(still), `held: ${timedOutTwiceWhy('B917')}`)
    assert.match(laneWords(still), /failed twice on the board's own time-out/)
  }
  // A time-out of another step's clear does not count against this one.
  const other = timedOut('e20', cet(15, 0), 'B900')
  const lane = laneAt(failedAt + 5000, entries)
  assert.equal(decide({ worker: lane, items: items(), ready: [], owed: clearOwed({ lane, items: items(), afterStep: 'clear' }), envelopes: [other, first], now: failedAt + 5000 }).envelope?.clear?.step, 'B917')
})

// The lane (state.mjs), read by say.mjs's B739 line: the same one source.
const PROJECT = 'C:\game'
const appChat = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: cet(16, 17), lastAssistantUuid: 'u-1' })
function laneOf(lines, reports) {
  const now = cet(16, 17, 10)
  const raw = {
    listText: '{"prefix":"Team - ","main":"Main"}', appChatTexts: ['Main', 'Digger'].map(appChat),
    tails: Object.fromEntries(['Main', 'Digger'].map(name => [`cli-${name}`, { text: lines.join('\n'), isCut: false, modifiedAt: cet(16, 17) }])),
    planLineTexts: {}, work: storeFromText('## Board\n', { now: now - 60 * MIN }), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: now - 180 * MIN,
  }
  const state = buildState(raw, {
    lines: [], outbox: [], runs: [], now, config: { ...parseConfig('{}', {}), project: PROJECT }, seen: { shown: { Main: now - 5_000 }, other: {} },
    board: { startedAt: now - 30 * MIN, offSince: null }, ...(reports === null ? {} : { reports: new Map(reports) }),
  })
  return state.chats.find(chat => chat.name === 'Digger')
}
const reportOf = (state, more = {}) => [['Digger', { state, since: cet(16, 17), background: false, at: cet(16, 17, 8), session: 'cli-Digger', mod: '0.27.1', ...more }]]

test('Part 2, the lane: its background count reads the mod\'s fresh idle report, else the transcript (which now ends a stopped task)', () => {
  const running = [...launched(cet(15, 57, 17), 'toolu_watch2', 'bvr2wx5br'), answer(cet(16, 17, 0), 'B917 is reported.')]
  assert.equal(laneOf(running, null).background, 1, 'no report: the transcript')
  assert.equal(laneOf(stoppedTwice(), null).background, 0, 'the real case by its transcript')
  assert.equal(laneOf(running, reportOf('idle')).background, 0, 'a fresh idle report decides')
  assert.equal(laneOf(running, reportOf('idle', { background: true })).background, 1)
  assert.equal(laneOf(running, reportOf('busy')).background, 1, 'a busy report says nothing of the background')
  assert.equal(laneOf(running, reportOf('idle', { at: cet(16, 16) })).background, 1, 'a stale report: the transcript')
})

test('X133, Worker 5 at 16:40: a time-out hold whose envelope the sweep closed when its task was taken back ends on the next report, once', () => {
  const name = 'Worker 5'
  const entries = parseTail(answer(cet(16, 39), 'B928 is reported.'), false)
  // B928 reported 16:40:00; the envelope gave B923 with the clear; the save-log timed out (16:40:44); B923 was taken back and
  // the sweep closed the envelope "dropped" 16:40:53: the outbox's last word on it is no "failed", its outcome is the cause.
  const failedAt = cet(16, 40, 44)
  const dropped = {
    id: 'c6e9', at: cet(16, 40, 16), to: name, command: HANDOVER_COMMAND, kind: 'task', step: 'B923', clear: { step: 'B928', reportedAt: cet(16, 40) }, restart: false,
    set: { model: null, effort: 'high' }, line: 'work: B923 is yours; run work next', back: null, takenAt: cet(16, 40, 32), failedAt, settledAt: failedAt,
    outcome: { cleared: false, set: null, typed: null, restarted: null, background: false, why: TIMED_OUT_WHY },
    state: 'dropped', why: 'B923 is no longer given to Worker 5', closedAt: cet(16, 40, 53),
  }
  const reviewed = new Map([['B928', file({ Id: 'B928', Kind: 'step', Title: 'Task B928', State: 'review', Owner: name, Since: stamp(cet(16, 40)) }, [
    `- ${stamp(cet(16, 10))} ${name}: queued → taken`, `- ${stamp(cet(16, 40))} ${name}: in progress → review`, `- ${stamp(cet(16, 40))} server: check passed`,
  ])], ['B923', file({ Id: 'B923', Kind: 'step', Title: 'Task B923', State: 'refined', Refined: 'ready', Since: stamp(cet(16, 27)) }, [`- ${stamp(cet(16, 40, 44))} server: queued → refined (taken back from Worker 5)`])]])
  const laneOf5 = reportAt => ({ ...laneAt(reportAt, entries), name, report: { state: 'idle', since: cet(16, 39), background: false, at: reportAt, session: 'w5' } })
  const at = (reportAt, envelopes, now = reportAt) => {
    const lane = laneOf5(reportAt)
    return decide({ worker: lane, items: reviewed, ready: [{ id: 'B923', rank: 2, keptFor: null, keptUntil: null, pinned: null }], owed: clearOwed({ lane, items: reviewed, afterStep: 'clear' }), envelopes, now })
  }
  assert.equal(isBoardTimeout(dropped), true, 'its outcome tells the cause, whatever the sweep did with it')
  // Its report was idle before the hold: still HELD until a report after the failure.
  assert.equal(at(cet(16, 40, 30), [dropped], cet(16, 40, 50)).state, STATES.HELD)
  const freed = at(cet(16, 40, 55), [dropped])
  assert.notEqual(freed.state, STATES.HELD)
  assert.equal(freed.envelope?.clear?.step, 'B928')
  // Once: a second time-out for B928 holds it, its lane saying why.
  const again = { ...dropped, id: 'd2', at: cet(16, 40, 55), failedAt: cet(16, 41, 10), settledAt: cet(16, 41, 10), state: 'failed', why: undefined, closedAt: undefined }
  const held = at(cet(16, 45), [dropped, again])
  assert.equal(held.state, STATES.HELD)
  assert.equal(laneWords(held), `held: ${timedOutTwiceWhy('B928')}`)
})
