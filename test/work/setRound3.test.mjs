// B1160 part 2 (F5), chat 1's final check of F2 round 3 (.claude/plans/2026-11-13-handover-round3-final-check.md): the partner's Focus
// switch while the app refuses the board's set calls (items 1-4), the free row's next check (5) and the probe a hand's alone (6). The
// refusal's words are the live ones; the garden is made up.

import assert from 'node:assert/strict'
import test from 'node:test'

import { isForHandsYet, isHandWord, setOf } from '../../src/hands.mjs'
import { effortBack, partnerEffort, partnerEffortWords } from '../../src/partnerEffort.mjs'
import { isWakeWord } from '../../src/say.mjs'
import { memoryStore } from '../../src/store.mjs'
import { effortWords, probeOf } from '../../src/work/effort.mjs'
import { decide, laneWords } from '../../src/work/handover.mjs'
import { whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 14, 1, 0).getTime()
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
const REFUSAL = 'PreToolUse:mcp__ccd_session_mgmt__set_session_model hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call.'
const usualAnswer = [{ type: 'assistant', isSidechain: false, model: OPUS, effort: 'xhigh', at: NOW - MIN }]

test('items 1, 3: a partner word closed as refused changes nothing: the switch is off, and Go sends no "usual" word', () => {
  const closed = { id: 'p3', command: 'partner-effort', about: 'Partner', mode: 'high', at: NOW - 5 * MIN, state: 'dropped', refused: true, tries: 3, why: 'the app refuses the board\'s set calls; your partner runs on its current setting' }
  const effort = partnerEffort({ sent: [closed], partner: 'Partner', entries: usualAnswer })
  assert.equal(effort.mode, 'usual')
  assert.notEqual(effort.refused, null, 'the plain note stays')
  assert.equal(effortBack('how-go', effort), null)
})

test('item 4: after the first refusal, while a retry may still come, no "no longer lets" line yet', () => {
  const first = { id: 'p1', command: 'partner-effort', about: 'Partner', mode: 'high', at: NOW - 30_000, state: 'failed', failedAt: NOW - 20_000, why: REFUSAL, tries: 1 }
  assert.equal(partnerEffort({ sent: [first], partner: 'Partner', entries: usualAnswer }).refused, null)
  assert.notEqual(partnerEffort({ sent: [{ ...first, tries: 3 }], partner: 'Partner', entries: usualAnswer }).refused, null, 'no try left')
})

test('item 2: while the app refuses the board\'s set calls a partner word is Main\'s model\'s: no hand takes it', () => {
  const word = { id: 'p9', at: NOW, ...partnerEffortWords({ to: 'Lead', partner: 'Partner', session: 'local_partner', mode: 'high', why: 'switched on the Focus page', forModel: true }), state: 'waiting' }
  assert.equal(word.forModel, true)
  assert.equal(isHandWord(word, { canSet: true }), false)
  assert.equal(isForHandsYet(word, NOW), false)
  const plain = partnerEffortWords({ to: 'Lead', partner: 'Partner', session: 'local_partner', mode: 'high', why: 'x' })
  assert.notEqual(setOf(plain), null, 'without the refusal a hand may set it as before')
})

test('item 5: a free worker\'s words carry the next check when the state gives it', () => {
  const worker = { name: 'Worker 3', model: SONNET, effort: 'medium', isRunning: true, report: { state: 'idle', since: NOW - MIN, at: NOW } }
  const free = decide({ worker, setsRefused: true, nextCheckAt: new Date(2026, 10, 15, 0, 40).getTime(), items: new Map(), ready: [], now: NOW, event: { kind: 'turn-ended', since: NOW - MIN } })
  assert.match(laneWords(free), /^on Sonnet · medium \(the app no longer lets the board switch it; next check 15 Nov 00:40\)$/)
})

test('item 6: the probe is a hand\'s alone: no wake, no retry, never Main\'s; one nobody carried is closed plainly; only a hand-settable lane', async () => {
  const refused = { id: 'r', command: 'worker-effort', about: 'Digger', at: NOW - 25 * 60 * MIN, state: 'failed', failedAt: NOW - 25 * 60 * MIN, why: REFUSAL }
  const fable = [{ name: 'Fable', state: 'free', isRunning: true, model: 'claude-fable-5-1', effort: 'high' }]
  assert.equal(probeOf({ sent: [refused], lanes: fable, now: NOW, main: 'Lead' }).word, null, 'never a Fable lane')
  const lanes = [...fable, { name: 'Mower', state: 'free', isRunning: true, model: OPUS, effort: 'high' }]
  const due = probeOf({ sent: [refused], lanes, now: NOW, main: 'Lead' })
  const probe = { id: 'pr', at: NOW, ...effortWords(due.word), state: 'waiting' }
  assert.equal(probe.probe, true)
  assert.equal(isWakeWord(probe, { restart: { main: 'Lead' } }), false)
  // A hand fails it for a passing reason: no copy for Main.
  const outbox = memoryStore()
  await outbox.say({ ...probe })
  await outbox.update('pr', { state: 'failed', failedAt: NOW + 5000, why: 'The app has not reported its model list yet' })
  await outbox.retryFailed(NOW + 2 * MIN, KEEP)
  assert.equal(outbox.outbox().length, 1)
  // The sweep closes it plainly; a waiting one too once the hands' minute passed.
  const failed = outbox.outbox()[0]
  assert.deepEqual(whyClosed(failed, { all: [failed], items: new Map(), now: NOW + 3 * MIN, keep: KEEP, lanes }).state, 'dropped')
  const waiting = whyClosed(probe, { all: [probe], items: new Map(), now: NOW + 2 * MIN, keep: KEEP, lanes })
  assert.match(waiting.why, /could not run; the next comes later/)
  assert.equal(whyClosed(probe, { all: [probe], items: new Map(), now: NOW + 30_000, keep: KEEP, lanes }), null, 'within the hands\' minute it waits')
})
