// B722 (the person, 2026-10-26 23:00: "i added it to the queu, why is it not picked up by worker 5?"): B415 was queued
// and ready while Worker 5's chat had not run for a day. Its lane read "free" (nothing in its card), but the hand-out
// gives only to a running chat, so nobody acted. A worker known not to run now shows as closed ("off"), and the
// supervisor wakes the closed worker that was closed longest when a ready task waits with no running worker free.
// Made-up chats and steps only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { step, answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { CLOSED_WAKE_MS, REPAIR_RULES, findStuck } from '../src/supervisor/rules/repair.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 26, 23, 0).getTime()
const ago = minutes => NOW - minutes * MIN

// --- the lane: a worker known not to run is closed, never free

const PROJECT = 'C:\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: ago(24 * 60), lastAssistantUuid: 'u-1',
})
const ended = at => ({ text: [typed(at - 10 * MIN, 'Go on.'), step(at - 5 * MIN, 'Build'), answer(at, 'Done.')].join('\n'), isCut: false, modifiedAt: at })

function build({ seen }) {
  const names = ['Main', 'Worker 5']
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: names.map(app),
    tails: Object.fromEntries(names.map(name => [`cli-${name}`, ended(ago(24 * 60))])),
    planLineTexts: {}, work: storeFromText('## Board\n', { now: ago(120) }), adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt: ago(30 * 60),
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config, seen, board: { startedAt: ago(5 * 60), offSince: null } })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)

test('B722: a worker whose chat does not run is known not to run (the page words it Closed); one that asks the board runs', () => {
  const closed = lane(build({ seen: { shown: { Main: NOW - 5_000 }, other: {} } }), 'Worker 5')
  assert.deepEqual([closed.state, closed.isRunning], ['free', false])
  const open = lane(build({ seen: { shown: { Main: NOW - 5_000, 'Worker 5': NOW - 5_000 }, other: {} } }), 'Worker 5')
  assert.deepEqual([open.state, open.isRunning], ['free', true])
})

// --- the wake

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const task = (id, state, more = {}) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(300)), ...more })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const worker = (name, more = {}) => ({ name, isLeftover: false, state: 'off', isRunning: false, offSince: ago(600), ...more })
const seenAt = minutes => new Map([['closed worker B415', ago(minutes)]])
const world = (more = {}) => ({
  items: items(task('B415', 'refined')), ready: [{ id: 'B415', rank: 2, keptFor: null }],
  lanes: [LEAD, worker('Worker 5')], prefix: '', now: NOW, outbox: [], limits: {}, pause: null, refused: [], ...more,
})

test('B722: a ready task and no running free worker wake the closed worker, once', () => {
  assert.equal(findStuck(world()).filter(found => found.check === 'closed-worker').length, 0, 'seen only now: the grace time first')
  const [one] = findStuck({ ...world(), seen: seenAt(5), observed: [] }).filter(found => found.check === 'closed-worker')
  assert.deepEqual([one.fix.do, one.fix.chat, one.fix.id], ['wake', 'Worker 5', 'B415'])
  assert.match(one.fix.text, /B415 is ready for you; run work next/)
  // Woken a moment ago: it waits for that, no second wake.
  const sent = [{ id: 'w1', command: 'work', about: 'B415', to: 'Worker 5', at: ago(3), state: 'delivered', syncKey: one.key }]
  const [again] = findStuck({ ...world({ outbox: sent }), seen: seenAt(5), observed: [] }).filter(found => found.check === 'closed-worker')
  assert.equal(again.fix.do, 'woken')
})

test('B722: the closed worker closed longest is woken; a running free worker, a paused board and a held worker are not', () => {
  const two = { lanes: [LEAD, worker('Worker 2', { offSince: ago(100) }), worker('Worker 5', { offSince: ago(900) })] }
  assert.equal(findStuck({ ...world(two), seen: seenAt(5), observed: [] }).find(found => found.check === 'closed-worker').fix.chat, 'Worker 5')
  const run = (more, seen = seenAt(5)) => findStuck({ ...world(more), seen, observed: [] }).filter(found => found.check === 'closed-worker')
  assert.equal(run({ lanes: [LEAD, worker('Worker 5'), { name: 'Worker 1', isLeftover: false, state: 'free', isRunning: true }] }).length, 0, 'a running free worker takes it')
  assert.equal(run({ pause: { state: 'pausing', since: ago(5) } }).length, 0, 'the person paused')
  assert.equal(run({ lanes: [LEAD, worker('Worker 5', { state: 'suspended', isRunning: true })] }).length, 0, 'suspended for the limit')
  assert.equal(run({ lanes: [LEAD, worker('Worker 5', { state: 'free' })] }).length, 1, 'free by its card, known not to run: Worker 5 of 2026-10-26')
  assert.equal(run({ lanes: [LEAD, worker('Worker 5', { state: 'free', isRunning: null })] }).length, 0, 'not known: nothing is guessed')
  const holds = items(task('B415', 'refined'), task('B300', 'in progress', { Owner: 'Worker 5' }))
  assert.equal(run({ items: holds }).length, 0, 'a closed worker that holds a step is another rule\'s')
  assert.equal(run({ ready: [] }).length, 0, 'nothing ready')
})

test('B722: a wake that brings no chat back is filed for the main chat, once', () => {
  const key = findStuck({ ...world(), seen: seenAt(5), observed: [] }).find(found => found.check === 'closed-worker').key
  const sent = [{ id: 'w1', command: 'work', about: 'B415', to: 'Worker 5', at: ago(12), state: 'delivered', syncKey: key }]
  const [late] = findStuck({ ...world({ outbox: sent }), seen: seenAt(15), observed: [] }).filter(found => found.check === 'closed-worker')
  assert.equal(late.fix.do, 'main')
  assert.match(late.fix.text, /B415 waits; Worker 5 is closed and does not wake/)
  assert.equal(CLOSED_WAKE_MS, 2 * MIN)
})
