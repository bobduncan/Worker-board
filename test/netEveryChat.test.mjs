// Fix 0.31.0, part 3 (Task 6's net, the Advisor's own case): `unconfirmedWords` found its lanes in `state.chats` only, so the Advisor, its
// helper, the Supervisor and the Product owner (side chats, never a lane) were never judged: 526 words stood `taken`, three
// showed as "waits for its turn" in Needs since 09:52, 12:38 and 12:40. The net now judges every chat whose report the board
// holds (the lane's, else the side chat's, else the report kept for that name: `state.reported`), and closes a word taken
// over 24 hours ago by a chat the board no longer knows `expired`, with its why. Never a hand's take, never a hand-over
// envelope, never a person's answer. Made-up chats.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { memoryStore } from '../src/store.mjs'
import { GONE_AFTER_MS, UNCONFIRMED_MS, UNCONFIRMED_WHY, goneWhy, reportOf, sweepOutbox, unconfirmedWords } from '../src/work/outboxSweep.mjs'
import { storeFromText } from '../src/work/read.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const TAKE = new Date(2026, 10, 4, 9, 31, 40).getTime()
const TURN = TAKE + 8_000
const IDLE = TURN + 5 * MIN
const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }

const lane = (name, more = {}) => ({ name, isMain: name === 'Main', isLeftover: false, report: null, ...more })
/** The board's state as the net reads it: lanes, side chats and the reports the board holds, by chat name. */
const board = ({ chats = [lane('Main'), lane('Worker 1')], reported = {}, prefix = '', ...sides } = {}) => ({ restart: { main: 'Main' }, chatPrefix: prefix, chats, reported, ...sides })
const reportOfAdvisor = (more = {}) => ({ state: 'idle', since: IDLE, turn: TURN, session: 's-adv', ...more })
const SIDES = [['advisor', 'Advisor'], ['advisorHelper', 'Advisor 2'], ['supervisorChat', 'Supervisor'], ['productOwner', 'Product owner']]

/** A word to `to`, said and taken by its own chat (or a hand, `by`) at `at`. */
async function taken(store, id, { to = 'Advisor', at = TAKE, by = null, command = null, ask = null } = {}) {
  await store.say({ id, to, text: `${id} words`, at: at - MIN, state: 'waiting', ...(command === null ? {} : { command }), ...(ask === null ? {} : { ask }) })
  if (by === null) await store.take(to, at, { ...keep, answerMs: 96 * HOUR }, message => message.id === id)
  else await store.takeHands(by, at, keep, message => message.id === id)
}
const wordOf = (store, id) => store.outbox().find(one => one.id === id)

test('a side chat is judged by its report as a lane is: the Advisor, its helper, the Supervisor and the Product owner, closed at 15 min of idle, left at 14', () => {
  for (const [key, name] of SIDES) {
    const state = board({ [key]: { name, session: 's-adv' }, reported: { [name]: reportOfAdvisor() } })
    const word = { id: 'w1', to: name, state: 'taken', takenAt: TAKE, at: TAKE - MIN }
    assert.deepEqual(unconfirmedWords({ outbox: [word], state, now: IDLE + UNCONFIRMED_MS - 1 }), [], `${name} at 14 min`)
    assert.deepEqual(unconfirmedWords({ outbox: [word], state, now: IDLE + UNCONFIRMED_MS }), [{ id: 'w1', state: 'delivered', why: UNCONFIRMED_WHY, deliveredAt: TURN }], `${name} at 15 min`)
  }
})

test('mutant "the net limited to state.chats again": the Advisor, a side chat with no lane, is closed; its report of another session, or none, is not judged', () => {
  const word = { id: 'w1', to: 'Advisor', state: 'taken', takenAt: TAKE, at: TAKE - MIN }
  const at = IDLE + UNCONFIRMED_MS
  const side = { name: 'Advisor', session: 's-adv' }
  assert.equal(unconfirmedWords({ outbox: [word], state: board({ advisor: side, reported: { Advisor: reportOfAdvisor() } }), now: at }).length, 1)
  // The report is of another session than the one the board shows under the name: it says nothing of this chat.
  assert.deepEqual(unconfirmedWords({ outbox: [word], state: board({ advisor: side, reported: { Advisor: reportOfAdvisor({ session: 's-old' }) } }), now: at }), [])
  // No report held, a report that names no turn, one still busy, one of a turn before the take: not judged (the board does not guess).
  for (const held of [{}, { Advisor: reportOfAdvisor({ turn: undefined }) }, { Advisor: reportOfAdvisor({ state: 'busy' }) }, { Advisor: reportOfAdvisor({ turn: TAKE - MIN }) }]) {
    assert.deepEqual(unconfirmedWords({ outbox: [word], state: board({ advisor: side, reported: held }), now: at + HOUR }), [], JSON.stringify(held))
  }
  // A lane keeps its own report (the session-checked one): `reported` does not overrule it.
  const mine = lane('Worker 1', { report: { state: 'idle', since: IDLE, turn: TURN } })
  const forLane = { id: 'w2', to: 'Worker 1', state: 'taken', takenAt: TAKE, at: TAKE - MIN }
  assert.equal(unconfirmedWords({ outbox: [forLane], state: board({ chats: [lane('Main'), mine], reported: { 'Worker 1': reportOfAdvisor({ state: 'busy' }) } }), now: at }).length, 1)
  assert.deepEqual(unconfirmedWords({ outbox: [forLane], state: board({ chats: [lane('Main'), lane('Worker 1')], reported: { 'Worker 1': reportOfAdvisor() } }), now: at }), [], 'a lane with no report of this session is not judged by an older one')
})

test('a chat with only a kept report (no lane, no side chat) is judged by it, whatever the list\'s prefix says of its name', () => {
  const word = { id: 'w1', to: 'Game - Retired', state: 'taken', takenAt: TAKE, at: TAKE - MIN }
  const state = board({ prefix: 'Game - ', reported: { Retired: reportOfAdvisor() } })
  assert.deepEqual(unconfirmedWords({ outbox: [word], state, now: IDLE + UNCONFIRMED_MS }).map(one => one.id), ['w1'])
  assert.equal(reportOf(state, 'Retired').turn, TURN)
  assert.equal(reportOf(state, 'Nobody'), null)
  assert.equal(reportOf(null, 'Retired'), null)
  assert.equal(reportOf({ chats: [] }, 'Retired'), null)
})

test('a word taken over 24 h ago by a chat the board no longer knows is closed expired with its why; at 23 h it is left (mutant "the expiry without the 24 h")', async () => {
  assert.equal(GONE_AFTER_MS, 24 * HOUR)
  const store = memoryStore()
  const NOW = new Date(2026, 10, 5, 12, 0).getTime()
  await taken(store, 'old', { to: 'Ghost', at: NOW - 25 * HOUR })
  await taken(store, 'young', { to: 'Ghost', at: NOW - 23 * HOUR })
  const state = board()
  const dry = await sweepOutbox({ dir: null, outbox: store, state, now: NOW, keep, fs: null, dry: true })
  assert.deepEqual(dry, [{ id: 'old', state: 'expired', why: 'expired: its chat Ghost is no longer on the board' }])
  assert.equal(goneWhy('Ghost'), dry[0].why)
  assert.equal(wordOf(store, 'old').state, 'taken', 'a dry replay writes nothing')
  assert.deepEqual((await sweepOutbox({ dir: null, outbox: store, state, now: NOW, keep, fs: null })).map(one => one.id), ['old'])
  const closed = wordOf(store, 'old')
  assert.deepEqual([closed.state, closed.why, closed.closedAt], ['expired', 'expired: its chat Ghost is no longer on the board', NOW])
  assert.equal(wordOf(store, 'young').state, 'taken')
  // Once: a later sweep finds nothing; a day later the younger one goes too.
  assert.deepEqual(await sweepOutbox({ dir: null, outbox: store, state, now: NOW + MIN, keep, fs: null }), [])
  assert.deepEqual((await sweepOutbox({ dir: null, outbox: store, state, now: NOW + 2 * HOUR, keep, fs: null })).map(one => one.id), ['young'])
})

test('the expiry never touches: a chat the board knows (lane, side chat, kept report; prefix ignored), a hand\'s take, an envelope, a person\'s answer, a word that waits, a board that knows no chats', async () => {
  const store = memoryStore()
  const NOW = new Date(2026, 10, 5, 12, 0).getTime()
  const ago = NOW - 30 * HOUR
  await taken(store, 'lane', { to: 'Worker 1', at: ago })
  await taken(store, 'prefixed', { to: 'Game - Worker 1', at: ago })
  await taken(store, 'side', { to: 'Advisor', at: ago })
  await taken(store, 'kept', { to: 'Retired', at: ago })
  await taken(store, 'hand', { to: 'Ghost', at: ago, by: 'Main' })
  await taken(store, 'env', { to: 'Ghost', at: ago, command: 'handover' })
  await taken(store, 'answer', { to: 'Ghost', at: ago, ask: 'work:Q1' })
  await store.say({ id: 'waits', to: 'Ghost', text: 'still waiting', at: ago, state: 'waiting', command: 'start', about: 'Ghost' })
  const state = board({ prefix: 'Game - ', advisor: { name: 'Advisor', session: 's-adv' }, reported: { Retired: reportOfAdvisor({ turn: TAKE - MIN }) } })
  const closing = await sweepOutbox({ dir: null, outbox: store, state, now: NOW, keep, fs: null, dry: true })
  assert.deepEqual(closing.filter(one => one.state === 'expired' && one.why.startsWith('expired: its chat')).map(one => one.id), [])
  // The same words to a board that knows no chat at all (its list could not be read): nothing is known gone.
  for (const unknown of [board({ chats: [] }), { restart: { main: null } }, null, board({ reported: null })]) {
    const none = await sweepOutbox({ dir: null, outbox: store, state: unknown, now: NOW, keep, fs: null, dry: true })
    assert.deepEqual(none.filter(one => one.why?.startsWith('expired: its chat')), [], JSON.stringify(unknown)?.slice(0, 60))
  }
  // Only the ghost's plain word goes, with the lane list known.
  await taken(store, 'plain', { to: 'Ghost', at: ago })
  const real = await sweepOutbox({ dir: null, outbox: store, state, now: NOW, keep, fs: null, dry: true })
  assert.deepEqual(real.filter(one => one.why?.startsWith('expired: its chat')).map(one => one.id), ['plain'])
})

test('buildState carries the reports the board holds as `reported` (by chat name; null when the board keeps none), so the Advisor is judged on the real state', () => {
  const NOW = new Date(2026, 10, 4, 12, 0).getTime()
  const app = name => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name.replace(' ', '')}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1' })
  const reports = new Map([
    ['Advisor', { state: 'idle', since: NOW - 40 * MIN, background: false, run: 1, seq: 4, word: null, turn: NOW - 41 * MIN, at: NOW - 2_000, session: 'cli-Advisor', mod: '0.31.0', busyAt: NOW - 41 * MIN }],
    ['Gone', { state: 'ended', since: NOW - 90 * MIN, background: false, run: 1, seq: 2, at: NOW - 90 * MIN, session: 'cli-gone', mod: '0.30.0', busyAt: null }],
  ])
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW - 60 * MIN })
  const raw = { listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: [app('Main'), app('Worker 1'), app('Advisor')], tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work }
  const config = { ...parseConfig('{}', {}), project: 'C:\\game' }
  const build = more => buildState(raw, { lines: [], outbox: [], runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen: null, now: NOW, config, ...more })
  const state = build({ reports })
  assert.deepEqual(state.reported.Advisor, { state: 'idle', since: NOW - 40 * MIN, turn: NOW - 41 * MIN, session: 'cli-Advisor' })
  assert.deepEqual(Object.keys(state.reported).sort(), ['Advisor', 'Gone'])
  assert.equal(state.reported.Gone.turn, undefined)
  assert.equal(state.chats.some(chat => chat.name === 'Advisor'), false, 'the Advisor is no lane: that is why the net never saw it')
  assert.equal(state.advisor.name, 'Advisor')
  assert.equal(build({ reports: null }).reported, null)
  // The net, on this state: a word the Advisor took before its turn, idle for 40 min, is closed.
  const word = { id: 'w1', to: 'Advisor', state: 'taken', takenAt: NOW - 42 * MIN, at: NOW - 43 * MIN }
  assert.deepEqual(unconfirmedWords({ outbox: [word], state, now: NOW }).map(one => [one.id, one.state, one.deliveredAt]), [['w1', 'delivered', NOW - 41 * MIN]])
})
