// The review of chat-reports (2026-10-25): what a chat reports of its turn state, shown so that no state read fails, a
// partner's wait stays one, no chat stays unknown for ever, an idle chat after an app restart opens no incident, a
// reported task frees a chat with background work, and the words say what is known. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { workerState } from '../src/say.mjs'
import { healthSummary } from '../src/supervisor/health.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { pauseFacts } from '../src/work/pause.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 20, 56).getTime()
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Main', 'Board', 'Support', 'Helper', 'Watcher']
const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`

const app = name => JSON.stringify({
  title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 2 * MIN, lastAssistantUuid: 'u-1',
})
const working = { lines: [typed(NOW - 20 * MIN, 'Go on.'), step(NOW - 20_000, 'Build')], at: NOW - 20_000 }
const stepItem = (id, owner, state = 'in progress') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: ${owner}\nSince: ${stamp(NOW - 40 * MIN)}\n`)
const askItem = (id, owner, more = '') => parseItem(`Id: ${id}\nKind: ask\nTitle: Which hat?\nState: open\nOwner: ${owner}\nOf: B12\nSince: ${stamp(NOW - 10 * MIN)}\nAsks: decide\nBlocking: yes\nOptions: A red | B blue\nAdvice: A\n${more}`)
const report = (name, state, more = {}) => [name, { state, since: NOW - 2 * MIN, background: false, at: NOW - 5_000, session: `cli-${name}`, mod: '0.19.0', ...more }]

/** Every chat's transcript shows a turn running (but those in `noTail`, which have none); the board started 30 min ago. */
function build({ reports = [], items = [], noTail = [], appStartedAt = NOW - 3 * 60 * MIN, settings = {}, asleepWakes = null } = {}) {
  const work = storeFromText('## Board\n', { now: NOW - 60 * MIN })
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const raw = {
    listText: '{"prefix":"Team - ","main":"Main","helper":"Helper","supervisor":"Watcher"}',
    appChatTexts: NAMES.map(app),
    tails: Object.fromEntries(NAMES.filter(name => !noTail.includes(name)).map(name => [`cli-${name}`, { text: working.lines.join('\n'), isCut: false, modifiedAt: working.at }])),
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt,
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now: NOW, config: { ...config, ...settings }, seen: { shown: { Main: NOW - 5_000 }, other: {} },
    board: { startedAt: NOW - 30 * MIN, offSince: null }, reports: new Map(reports), asleepWakes,
  })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)

test('review 1: a busy chat with no transcript to read (the first turn after a /clear, a chat in a subfolder) is shown, never a failed read', () => {
  const state = build({ reports: [report('Main', 'busy'), report('Board', 'busy'), report('Helper', 'busy')], noTail: ['Main', 'Board', 'Helper'] })
  assert.deepEqual([lane(state, 'Main').state, lane(state, 'Board').state, state.advisorHelper.state], ['working', 'working', 'working'])
  assert.equal(lane(state, 'Board').doingNow, null)
  // Waiting with no transcript says nothing of what it said.
  assert.equal(lane(build({ reports: [report('Board', 'asking')], noTail: ['Board'] }), 'Board').state, 'waiting')
})

test('review 2 (B392): an idle worker whose blocking ask waits for the partner works between two turns and says it waits for the partner', () => {
  const routed = build({ reports: [report('Board', 'idle')], items: [stepItem('B12', 'Board', 'waiting on you'), askItem('Q3', 'Board', 'Route: partner\n')] })
  const board = lane(routed, 'Board')
  assert.deepEqual([board.state, board.waitsForPartner], ['working', ['Q3']])
  assert.match(board.between, /waits for your partner's answer \(Q3\)/)
  // The same ask on the person: it waits for the person.
  assert.equal(lane(build({ reports: [report('Board', 'idle')], items: [stepItem('B12', 'Board', 'waiting on you'), askItem('Q3', 'Board')] }), 'Board').state, 'waiting')
  // review 7: the health summary does not count the partner's wait as odd, also with no step of its own.
  const alone = build({ reports: [report('Board', 'idle')], items: [askItem('Q3', 'Board', 'Route: partner\n')] })
  assert.deepEqual([lane(alone, 'Board').state, lane(alone, 'Board').waitsForPartner], ['working', ['Q3']])
  const view = buildView({ state: { ...alone, today: [], chatPrefix: 'Team - ' }, items: new Map(), now: NOW })
  const line = healthSummary(view, NOW).split('\n').find(one => one.includes('Board (worker)'))
  assert.ok(line !== undefined && !line.startsWith('- !'), line)
})

test('review 3: a session that ended is asleep at once (T13 part 3); a chat silent past offAfterMinutes is not running, "silent since HH:MM"', () => {
  // T13 part 3: the app still has the chat, so a message wakes it: Free and asleep since its session ended, not Not running.
  const ended = lane(build({ reports: [report('Board', 'ended', { since: NOW - MIN, at: NOW - MIN })] }), 'Board')
  assert.deepEqual([ended.state, ended.isRunning, ended.asleep, ended.asleepSince, ended.offWhy], ['free', false, true, NOW - MIN, null])
  const silent = lane(build({ reports: [report('Board', 'busy', { at: NOW - 6 * MIN })] }), 'Board')
  assert.deepEqual([silent.state, silent.isRunning, silent.offWhy], ['off', false, `silent since ${hhmm(NOW - 6 * MIN)}`])
  assert.match(workerState(silent).words, new RegExp(`^not running \\(silent since ${hhmm(NOW - 6 * MIN)}\\)`))
  // Under the setting it stays unknown; the setting decides.
  assert.deepEqual([lane(build({ reports: [report('Board', 'busy', { at: NOW - 4 * MIN })] }), 'Board').state], ['unknown'])
  assert.equal(lane(build({ reports: [report('Board', 'busy', { at: NOW - 6 * MIN })], settings: { offAfterMinutes: 10 } }), 'Board').state, 'unknown')
})

test('review 3: the pause does not count a chat whose reports stopped as one running a turn', () => {
  const state = build({ reports: [report('Board', 'busy', { at: NOW - 2 * MIN })], items: [stepItem('B12', 'Board')] })
  assert.equal(lane(state, 'Board').state, 'unknown')
  const pause = { state: 'pausing', since: NOW - MIN, by: 'person' }
  const facts = pauseFacts({ pause, items: new Map(), lanes: state.chats.filter(chat => !chat.isLeftover), prefix: 'Team - ' })
  assert.equal(facts.working.includes('Board'), false)
  // One the board cannot read for want of a report still counts, as before.
  const unread = pauseFacts({ pause, items: new Map(), lanes: [{ name: 'Board', isMain: false, state: 'unknown' }], prefix: 'Team - ' })
  assert.deepEqual(unread.working, ['Board'])
})

test('review 4: a chat idle at its last report, after an app restart, is no card left working: no working-not-running incident', () => {
  // T13 part 3: after the app's restart an idle chat is free and a busy one interrupted, both asleep (no longer off).
  const idle = lane(build({ reports: [report('Board', 'idle', { at: NOW - 40_000 })], appStartedAt: NOW - 20_000 }), 'Board')
  assert.deepEqual([idle.state, idle.asleep], ['free', true])
  const busy = lane(build({ reports: [report('Board', 'busy', { at: NOW - 40_000 })], appStartedAt: NOW - 20_000 }), 'Board')
  assert.deepEqual([busy.state, busy.asleep], ['interrupted', true])
  const background = lane(build({ reports: [report('Board', 'idle', { at: NOW - 40_000, background: true })], appStartedAt: NOW - 20_000 }), 'Board')
  assert.deepEqual([background.state, background.asleep], ['interrupted', true])
  const rule = WATCH_RULES.find(one => one.id === 'working-not-running')
  const view = lanes => buildView({ state: { chats: lanes, today: [], limits: {}, pause: null, chatPrefix: '' }, items: new Map(), now: NOW })
  const ctx = { seen: new Map([['working-not-running Board', NOW - 20 * MIN]]), observed: [] }
  assert.deepEqual(rule.check(view([{ ...lane(build(), 'Main') }, idle]), ctx), [])
  assert.deepEqual(rule.check(view([{ ...lane(build(), 'Main') }, busy]), ctx), [])
  // A busy one whose wake did not take (woken 9 min ago, silent since) is off as a card left working: the incident opens.
  const woken = lane(build({ reports: [report('Board', 'busy', { at: NOW - 11 * MIN })], appStartedAt: NOW - 10 * MIN, asleepWakes: new Map([['Board', { since: NOW - 10 * MIN, at: NOW - 9 * MIN }]]) }), 'Board')
  assert.deepEqual([woken.state, woken.offSince], ['off', NOW - 11 * MIN])
  assert.equal(rule.check(view([{ ...lane(build(), 'Main') }, woken]), ctx).length, 1)
})

test('review 5b (B148): background work does not hold a worker whose step it reported in its last turn; it does while it holds the step', () => {
  // Its last turn started 60 min ago (when the board heard it busy); it moved B12 to review 40 min ago.
  const reported = build({ reports: [report('Board', 'idle', { background: true, busyAt: NOW - 60 * MIN })], items: [stepItem('B12', 'Board', 'review')] })
  assert.equal(lane(reported, 'Board').state, 'free')
  // A step done three days ago is not its last turn's: a shell it leaves running holds it.
  const old = parseItem(`Id: B9\nKind: step\nTitle: Step B9\nState: done\nOwner: Board\nSince: ${stamp(NOW - 3 * 24 * 60 * MIN)}\n`)
  assert.equal(lane(build({ reports: [report('Board', 'idle', { background: true, busyAt: NOW - 20 * MIN })], items: [old] }), 'Board').state, 'working')
  // Nor when the board never heard its turn start (it restarted since).
  assert.equal(lane(build({ reports: [report('Board', 'idle', { background: true })], items: [stepItem('B12', 'Board', 'review')] }), 'Board').state, 'working')
  const holding = build({ reports: [report('Board', 'idle', { background: true })], items: [stepItem('B12', 'Board')] })
  assert.equal(lane(holding, 'Board').state, 'working')
  // With no step at all its background work holds it (the main chat's agents, a request of the person).
  assert.equal(lane(build({ reports: [report('Board', 'idle', { background: true })] }), 'Board').state, 'working')
})

test('review 7: an idle worker with its task open says so, never "cut off in the middle of its turn"', () => {
  const idle = lane(build({ reports: [report('Board', 'idle')], items: [stepItem('B12', 'Board')] }), 'Board')
  assert.equal(idle.state, 'interrupted')
  assert.match(workerState(idle).words, /^idle with its task open/)
  // A chat the board read as cut off from its transcript keeps the old words.
  assert.match(workerState({ name: 'Board', state: 'interrupted', task: null }).words, /^cut off in the middle of its turn/)
})
