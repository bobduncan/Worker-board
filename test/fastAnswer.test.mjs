// board-fast-answer (B1030 way A, 2026-11-11; X93, B934 → B978 → B1011 → B1030): a chat's work call used to wait for a whole state
// rebuild inside its answer (workCtx awaited readState(); the main chat's pull a second one), and awaited the goal guard and the wakes
// too; the stall log showed calls of 2 to 4 s every few minutes and 18 s on 11-04. Now the answer is built from the store write the
// call made and the kept state's slow facts; the rebuild and the side effects run after the answer. The server's shape is pinned here
// (the board is one script; test/boardSlowRead.test.mjs runs a copy with 5 s reads), and the day record's figures reach the
// Supervisor's health line through the state.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { KEPT_STATE_MS, keptStateWhy } from '../src/keptState.mjs'
import { buildState } from '../src/state.mjs'
import { healthSummary } from '../src/supervisor/health.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { parseConfig } from '../src/config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const server = readFileSync(join(ROOT, 'server.mjs'), 'utf8')
/** The text of one function of the server, from its head to the next top-level `const` or function at the same indent. */
const bodyOf = head => {
  const at = server.indexOf(head)
  assert.notEqual(at, -1, `server.mjs has ${head}`)
  const rest = server.slice(at)
  const end = rest.search(/\n  (?:const|let|async function|function|\/\*\*) /)
  return end === -1 ? rest : rest.slice(0, end)
}

test('workCtx answers from the kept state: no rebuild of its own, but for an unknown caller or a kept state gone old', () => {
  const ctx = bodyOf('  const workCtx = async ({ kept = false, chat = null, action = null, of = null } = {}) => {')
  assert.match(ctx, /const state = kept \? readState\.last\(\) \?\? await readState\(\) : await keptStateFor\(chat, action, of\)/)
  assert.doesNotMatch(ctx.replace(/await keptStateFor\(chat, action, of\)/, '').replace(/readState\.last\(\) \?\? await readState\(\)/, ''), /await readState\(\)/, 'no other rebuild inside the context')
  // The decision is src/keptState.mjs's (pure, tested below); the server hands it the kept state, the clock, the dirty flag and laneRole.
  const kept = bodyOf('  const keptStateFor = async (chat, action, of = null) => {')
  assert.match(kept, /keptStateWhy\(\{ last, now: clock\(\), chat, action, of, dirty: readState\.readAt\(\) === -Infinity, roleOf: laneRole, maxMs: KEPT_STATE_MS \}\)/)
  assert.match(kept, /return why === 'kept' \? last : readState\(\)/)
  // The work action gives the context the calling chat (a chat's call; the person's and the server's name none) and the action.
  assert.match(server, /workCtx\(\{ kept: body\?\.action === 'health', chat: as === undefined && typeof body\?\.chat === 'string' \? body\.chat : null, action: body\?\.action \?\? null, of: typeof body\?\.of === 'string' \? body\.of : null \}\)/)
  // The kept state's four refusals and the one yes, each on its own.
  const last = { readAt: 1000 }
  const roleOf = (state, chat) => (chat === 'Worker 5' ? 'worker' : null)
  assert.equal(keptStateWhy({ last, now: 2000, chat: 'Worker 5', action: 'ask', dirty: false, roleOf }), 'kept')
  assert.equal(keptStateWhy({ last: null, now: 2000, chat: 'Worker 5', action: 'step', roleOf }), 'none')
  assert.equal(keptStateWhy({ last, now: 1000 + KEPT_STATE_MS + 1, chat: 'Worker 5', action: 'step', roleOf }), 'old')
  assert.equal(keptStateWhy({ last, now: 1000 + KEPT_STATE_MS, chat: 'Worker 5', action: 'step', roleOf }), 'kept')
  assert.equal(keptStateWhy({ last: { readAt: Number.NaN }, now: 2000, chat: 'Worker 5', action: 'step', roleOf }), 'old')
  assert.equal(keptStateWhy({ last, now: 2000, chat: 'Worker 9', action: 'step', roleOf }), 'unknown')
  assert.equal(keptStateWhy({ last, now: 2000, chat: null, action: 'answer', dirty: false, roleOf }), 'kept', 'the person or the server, no chat to know')
  // A write since the last read: a checkpoint, a take, a report, a turn end, a pull, a read still answer from the kept state; an ask, a
  // new step, a note of a goal, a refine, the pause state wait for a fresh one (they read the goal map, the recaps, the ready list, the lanes).
  for (const action of ['step', 'take', 'report', 'turn-ended', 'pull', 'health', 'asset', 'next', 'list', 'block', 'unblock']) assert.equal(keptStateWhy({ last, now: 2000, chat: 'Worker 5', action, dirty: true, roleOf }), 'kept', action)
  for (const action of ['ask', 'new', 'refine', 'refined', 'answer', 'pause-state', 'resumed', 'withdraw', 'words', 'checked', 'drop', 'close', null]) assert.equal(keptStateWhy({ last, now: 2000, chat: 'Worker 5', action, dirty: true, roleOf }), 'dirty', String(action))
  // A note to the main chat reads no fact of the state; a note of a goal reads the goal map.
  assert.equal(keptStateWhy({ last, now: 2000, chat: 'Worker 5', action: 'note', of: 'B1124', dirty: true, roleOf }), 'kept')
  assert.equal(keptStateWhy({ last, now: 2000, chat: 'Worker 5', action: 'note', of: null, dirty: true, roleOf }), 'kept')
  assert.equal(keptStateWhy({ last, now: 2000, chat: 'Worker 5', action: 'note', of: 'G66', dirty: true, roleOf }), 'dirty')
})

test('the side effects run after the answer, in order: the guard, the supervisor\'s heard, the wake, the main chat\'s pull line', () => {
  const action = bodyOf('  const workAction = async (body, as) => {')
  assert.equal((action.match(/afterAnswer\(\(\) => loops\.run\('guard'/g) ?? []).length, 2)
  assert.doesNotMatch(action, /await loops\.run\('guard'/)
  const once = bodyOf('  const bridgeWorkOnce = async (body, checked) => {')
  assert.match(once, /afterAnswer\(\(\) => loops\.run\('supervisor-heard'/)
  assert.match(once, /afterAnswer\(\(\) => loops\.run\('wake-after-answer', \(\) => sendWakes\(done\)\)\)/)
  assert.doesNotMatch(once, /await sendWakes\(done\)/)
  assert.doesNotMatch(once, /await supervisor\.heard/)
  // The pull: the answer carries no text and waits for no rebuild; pullFor runs after it with the state read anew.
  assert.match(once, /afterAnswer\(\(\) => loops\.run\('pull-after-answer', async \(\) => \{\n\s+readState\.reset\(\)\n\s+const answered = await pullFor\(/)
  assert.match(once, /return \{ ok: true, result: body\?\.action === 'pull' \? none : \{ \.\.\.done\.result, pull: none \} \}\n\s*\}\n/)
  const pullPart = once.slice(once.indexOf('const pulled = !done.ok'))
  // B736's fallback (`readState.last() ?? await readState()`) is the kept state; nothing else of the pull's answer rebuilds.
  assert.doesNotMatch(pullPart.replace(/afterAnswer\(\(\) => loops\.run\('pull-after-answer'[\s\S]*?\}\)\)/, '').replace(/readState\.last\(\) \?\? await readState\(\)/g, ''), /await readState\(\)/, 'no rebuild in the pull answer')
  // turn-ended keeps its decision in the answer (chat 1's review: the mod relies on the answer's handover).
  assert.match(once, /const decided = await decideFor\(checked\.chat, mod, \{ kind: 'turn-ended', since \}\)/)
  // afterAnswer: one queue, started on the next turn of the loop, each through loops.run, a failure never ends the queue.
  const after = bodyOf('  const afterAnswer = run => {')
  assert.match(after, /setImmediate\(next\)/)
  assert.match(after, /\.then\(timed, timed\)\.catch\(error => loops\.failed\('after-answer', error\)\)/)
  // A run that hangs lets the queue go after AFTER_ANSWER_MS (the core review: one hung guard would hold every later wake).
  assert.match(after, /setTimeout\(\(\) => settle\(loops\.failed\('after-answer', new Error\(/)
  assert.match(server, /const AFTER_ANSWER_MS = 2 \* 60_000/)
  // The day record is flushed when the board stops for a new version.
  assert.match(server, /await reportsSave\?\.flush\(\)\n\s+\/\/[^\n]*\n\s+await workCalls\.flush\(\)/)
})

test('every work call is counted with the rebuilds that started during it, and the day\'s figures travel to the health line', () => {
  const stall = bodyOf('  const callStall = (action, session) => {')
  assert.match(stall, /const rebuildsBefore = rebuilds/)
  assert.match(stall, /workCalls\.note\(\{ action, chat, ms: clock\(\) - begun, rebuilds: rebuilds - rebuildsBefore, at: begun \}\)/)
  assert.match(server, /const readState = cached\(\(\) => trackJob\('state rebuild', async \(\) => \{\n\s+rebuilds \+= 1/)
  assert.match(server, /workCalls: workCalls\.today\(clock\(\)\),/)
  assert.match(server, /await workCalls\.load\(\)/)
  // The state carries the figures; the view and the health summary say them in one line, odd once a call took over 5 s.
  const config = { ...parseConfig('{}', {}), project: 'C:\\garden' }
  const NOW = new Date(2026, 10, 11, 14, 0).getTime()
  const work = storeFromText('## Garden\n', { now: NOW - 60_000 })
  const raw = { listText: JSON.stringify({ prefix: 'Garden · ', main: 'Lead' }), appChatTexts: [], tails: {}, planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: NOW - 60_000 }
  const figures = { day: '2026-11-11', count: 412, median: 310, p95: 900, max: 1800, over: 0, rebuilds: 0, byAction: {} }
  const state = buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: {}, other: {} }, board: { startedAt: NOW - 60_000, offSince: null }, workCalls: figures })
  assert.deepEqual(state.workCalls, figures)
  const health = healthSummary(buildView({ state, items: new Map(), now: NOW }), NOW)
  assert.match(health, /\n- work calls today: 412 \(median 0\.3 s, slowest 1\.8 s, 0 over 5 s\)(\n|$)/)
  assert.doesNotMatch(health, /- ! work calls today/)
  const slow = buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: {}, other: {} }, board: { startedAt: NOW - 60_000, offSince: null }, workCalls: { ...figures, max: 6200, over: 1, rebuilds: 2 } })
  assert.match(healthSummary(buildView({ state: slow, items: new Map(), now: NOW }), NOW), /- ! work calls today: 412 \(median 0\.3 s, slowest 6\.2 s, 1 over 5 s, 2 rebuilds started during calls\)/)
  // Without the figures (the demo, an older state) the line is not there.
  const none = buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: {}, other: {} }, board: { startedAt: NOW - 60_000, offSince: null } })
  assert.equal(none.workCalls, null)
  assert.doesNotMatch(healthSummary(buildView({ state: none, items: new Map(), now: NOW }), NOW), /work calls today/)
})
