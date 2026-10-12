// B64: what is queued and when each worker expects to be done, also without the worker's help. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, fromChat, step, toolResult, typed, user } from '../fixtures/lines.mjs'
import { inProgress, parseBacklog, queue } from '../src/backlog.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState, heldBy } from '../src/state.mjs'
import { backgroundRunning, parseTail } from '../src/transcript.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 12, 14, 0)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = { prefix: 'Game - ', names: ['Main', 'Units', 'Features', 'Levels / Environment'] }

const BACKLOG = [
  '# Backlog',
  '',
  '## Architecture #focus',
  '- [x] B01 Step one (for Features; about 2 h)',
  '- [ ] B02 The camera (for Features; after B01; about 1 h) (branch feature/camera)',
  '- [ ] B03 The upgrade offer (for Features; after B02; about 1 h 30 min)',
  '  Requirements:',
  '  - three cards',
  '- [ ] B04 Verify: Say whether the camera is right (for Features; about 5 min) @you',
  '- [ ] B05 A step for nobody yet',
  '',
  '## Finish the art',
  '- [ ] B06 The archer (for Units; after the knight (branch fix/knight) merges; about 40 min)',
  '- [ ] B07 The bridge level (for Levels / Environment; now) (branch feature/bridge)',
  '- [ ] B08 Portraits (for Units; about 20 min)',
  '',
  '## Next to hand out (Game - Main)',
  '- [ ] B09 A new prop',
  '- [ ] B10 Sound for the beast (for Game - Units; about 30 min)',
  '',
].join('\n')

test('a step in progress: its branch stands at its end, after the note of who it is for', () => {
  const steps = parseBacklog(BACKLOG, NAMES).activities.flatMap(activity => activity.steps)
  const camera = steps.find(one => one.id === 'B02')
  assert.deepEqual(
    [camera.title, camera.worker, camera.isFor, camera.ownBranch, camera.branch, camera.minutes, camera.after],
    ['The camera', 'Features', true, 'feature/camera', 'feature/camera', 60, 'B01'],
  )
  // A branch named in a condition is not the step's own: the step is still queued.
  const archer = steps.find(one => one.id === 'B06')
  assert.deepEqual([archer.title, archer.worker, archer.ownBranch, archer.branch, archer.minutes], ['The archer', 'Units', null, 'fix/knight', 40])
  assert.equal(archer.after, 'the knight (branch fix/knight) merges')
  // "now" is no time and no condition.
  const bridge = steps.find(one => one.id === 'B07')
  assert.deepEqual([bridge.title, bridge.worker, bridge.minutes, bridge.after, bridge.ownBranch], ['The bridge level', 'Levels / Environment', null, null, 'feature/bridge'])
  // A step with no notes is as it was.
  const plain = steps.find(one => one.id === 'B05')
  assert.deepEqual([plain.title, plain.worker, plain.isFor, plain.ownBranch, plain.branch], ['A step for nobody yet', null, false, null, null])
})

test('the queue holds every open step that names a worker and no branch of its own, anywhere on the backlog', () => {
  const queued = queue(parseBacklog(BACKLOG, NAMES))
  assert.deepEqual(queued.map(one => [one.id, one.worker, one.minutes]), [
    ['B03', 'Features', 90],        // under an activity, not under "Next to hand out"
    ['B06', 'Units', 40],
    ['B08', 'Units', 20],
    ['B09', null, null],            // under "Next to hand out": queued also without a worker
    ['B10', 'Units', 30],
  ])
  // Not queued: a ticked step (B01), a step in progress (B02, B07), a step for the person (B04), a step that names nobody (B05).
  assert.deepEqual(queued.find(one => one.id === 'B03').notes, [{ title: 'Requirements', lines: [], points: ['three cards'] }])
})

test('the steps in progress: the open ones that name their own branch', () => {
  assert.deepEqual(inProgress(parseBacklog(BACKLOG, NAMES)).map(one => [one.id, one.worker, one.branch, one.minutes, one.title]), [
    ['B02', 'Features', 'feature/camera', 60, 'The camera'],
    ['B07', 'Levels / Environment', 'feature/bridge', null, 'The bridge level'],
  ])
})

// ---------------------------------------------------------------- the state the page asks for

const app = (name, extra = {}) => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1', ...extra,
})
const summary = (category, needs = '') =>
  ({ postTurnSummary: { status_category: category, status_detail: '', needs_action: needs, summarizes_uuid: 'u-1' } })
const tail = (lines, quietMinutes = 0) => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW - quietMinutes * MIN })
const planLine = task => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task, at: NOW - 3 * MIN })
const running = [typed(NOW - 20 * MIN, 'Go'), step(NOW - 2 * MIN, 'Run the tests'), toolResult(NOW - MIN)]
const ended = [typed(NOW - 20 * MIN, 'Go'), answer(NOW - 9 * MIN, 'Done')]
/** What the app answers when a subagent is sent to the background, and what it sends when that reports. */
const launched = at => user(at, [{ type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'Async agent launched successfully.\nagentId: made-up' }] }])
const reported = at => user(at, '<task-notification>\n<task-id>made-up</task-id>\n<status>completed</status>\n</task-notification>', { origin: { kind: 'task' } })
const handOver = at => fromChat(at, 'Game - Main', 'Task from Game - Main: build the camera.\nDetails follow.')

function build({ apps, tails = {}, plans = {}, backlog = BACKLOG, folders = null }) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: apps,
    tails: Object.fromEntries(Object.entries(tails).map(([name, value]) => [`cli-${name}`, value])),
    planLineTexts: Object.fromEntries(Object.entries(plans).map(([name, value]) => [`cli-${name}`, value])),
    backlogText: backlog,
    adviceText: null,
    folders,
    askTexts: [],
    pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config })
}
const chatNamed = (state, name) => state.chats.find(chat => chat.name === name)
const everyone = [app('Main'), app('Units'), app('Features'), app('Levels / Environment')]

test('each worker\'s queue is what the backlog holds for it, wherever the steps stand', () => {
  const state = build({ apps: everyone, tails: { Units: tail(ended), Features: tail(ended) } })
  assert.deepEqual(chatNamed(state, 'Features').queue.map(one => one.id), ['B03'])
  assert.deepEqual(chatNamed(state, 'Units').queue.map(one => one.id), ['B06', 'B08', 'B10'])
  assert.deepEqual(chatNamed(state, 'Levels / Environment').queue, [])
  assert.deepEqual(state.unassigned.map(one => one.id), ['B09'])
})

test('a worker without an estimate of its own gets its time from its step, counted from the task\'s start', () => {
  const state = build({ apps: everyone, tails: { Features: tail([handOver(NOW - 25 * MIN), ...running]) }, plans: { Features: planLine(null) } })
  const features = chatNamed(state, 'Features')
  assert.equal(features.state, 'working')
  assert.deepEqual([features.task.text, features.task.source, features.task.stepId, features.task.stepMinutes], ['B02 The camera', 'step', 'B02', 60])
  // B02 says "about 1 h": 25 minutes in, 35 are left. It is not the worker's own estimate.
  assert.deepEqual(features.eta, { at: NOW + 35 * MIN, leftMs: 35 * MIN, isOverdue: false, isOwn: false })
  // The queue is planned after it, with each step's own time.
  assert.deepEqual(features.ahead.map(span => [span.title, (span.to - span.from) / MIN, span.isQueued]), [['B02 The camera', 35, false], ['The upgrade offer', 90, true]])
})

test('a worker\'s own estimate wins over the step\'s time', () => {
  const state = build({
    apps: everyone,
    tails: { Features: tail(running) },
    plans: { Features: planLine({ text: 'Camera', step: 1, steps: 4, left: 10 * MIN, isReported: false }) },
  })
  const features = chatNamed(state, 'Features')
  assert.deepEqual(features.eta, { at: NOW + 7 * MIN, leftMs: 7 * MIN, isOverdue: false, isOwn: true })
  assert.equal(features.task.stepId, 'B02')
})

test('a step\'s time that has run out is overdue, and a step without a time gives none', () => {
  const late = chatNamed(build({ apps: everyone, tails: { Features: tail([handOver(NOW - 90 * MIN), ...running]) } }), 'Features')
  assert.deepEqual(late.eta, { at: NOW - 30 * MIN, leftMs: 0, isOverdue: true, isOwn: false })
  const levels = chatNamed(build({ apps: everyone, tails: { 'Levels / Environment': tail(running) } }), 'Levels / Environment')
  assert.equal(levels.task.stepId, 'B07')
  assert.equal(levels.eta, null)
})

test('a task without a name takes it from the open step that names the worker\'s branch, with its id', () => {
  // A tail that starts in the middle of a turn: nothing in it says what the turn is about.
  const midTurn = [step(NOW - 2 * MIN, 'Run the tests'), toolResult(NOW - MIN)]
  const features = chatNamed(build({ apps: everyone, tails: { Features: tail(midTurn) } }), 'Features')
  assert.deepEqual([features.state, features.task.text, features.task.source, features.task.stepId], ['working', 'B02 The camera', 'step', 'B02'])
  // Without such a step the task has no words: the page says it is not recorded yet.
  const units = chatNamed(build({ apps: everyone, tails: { Units: tail(midTurn) } }), 'Units')
  assert.deepEqual([units.task.text, units.task.source, units.task.stepId], ['', 'unrecorded', null])
})

test('a worker whose turn has ended is not free while its task is not reported', () => {
  const state = build({
    apps: everyone,
    tails: { Units: tail(ended, 40) },
    plans: { Units: planLine({ text: 'Shadow Beast', step: 2, steps: 6, left: 40 * MIN, isReported: false }) },
  })
  const units = chatNamed(state, 'Units')
  assert.deepEqual([units.state, units.between, units.doingNow], ['working', 'Its turn has ended; its task is not reported yet.', null])
  // Between two turns a chat writes nothing: that is no missing sign of life.
  assert.deepEqual([units.quietMs, units.isQuiet], [null, false])
  assert.equal(state.forYou.some(need => need.id === 'quiet:Units'), false)
  assert.deepEqual([state.counts.working, state.counts.free], [1, 0])
  // Reported: free again.
  const done = build({
    apps: everyone,
    tails: { Units: tail(ended) },
    plans: { Units: planLine({ text: 'Shadow Beast', step: 6, steps: 6, left: 0, isReported: true }) },
  })
  assert.deepEqual([chatNamed(done, 'Units').state, chatNamed(done, 'Units').between], ['free', null])
})

test('a worker whose turn has ended is not free while the task handed to it is not reported', () => {
  const units = chatNamed(build({ apps: everyone, tails: { Units: tail([handOver(NOW - 30 * MIN), ...ended]) } }), 'Units')
  assert.deepEqual([units.state, units.between, units.task.text], ['working', 'Its turn has ended; the task handed to it is not reported yet.', ''])
})

test('a worker whose turn has ended is not free while background work it started runs (a review before a merge)', () => {
  const reviewing = [typed(NOW - 20 * MIN, 'Go'), step(NOW - 12 * MIN, 'Review the change', 'Agent'), launched(NOW - 11 * MIN), answer(NOW - 10 * MIN, 'Waiting for the review')]
  const during = chatNamed(build({ apps: [app('Main'), app('Units', summary('review_ready'))], tails: { Units: tail(reviewing) } }), 'Units')
  assert.deepEqual([during.state, during.between], ['working', 'Its turn has ended; background work it started is still running.'])
  // The review has reported and the turn that followed has ended: nothing is open.
  const after = [...reviewing, reported(NOW - 5 * MIN), answer(NOW - 4 * MIN, 'Merged')]
  assert.equal(chatNamed(build({ apps: [app('Main'), app('Units')], tails: { Units: tail(after) } }), 'Units').state, 'free')
})

test('a worker whose turn has ended is not free while the step it works on still names its branch', () => {
  const state = build({ apps: everyone, tails: { Features: tail(ended), Units: tail(ended), Main: tail(ended) } })
  const features = chatNamed(state, 'Features')
  assert.deepEqual([features.state, features.between], ['working', 'Its turn has ended; its branch feature/camera is still open.'])
  assert.deepEqual([features.task.text, features.task.source], ['B02 The camera', 'step'])
  // Nothing open: free. The main chat too.
  assert.deepEqual([chatNamed(state, 'Units').state, chatNamed(state, 'Main').state], ['free', 'free'])
})

test('a worker that waits for you stays waiting, whatever is open', () => {
  const state = build({
    apps: [app('Main'), app('Features', summary('blocked', 'Pick one'))],
    tails: { Features: tail(ended) },
    plans: { Features: planLine({ text: 'Camera', step: 1, steps: 4, left: 10 * MIN, isReported: false }) },
  })
  assert.deepEqual([chatNamed(state, 'Features').state, chatNamed(state, 'Features').between], ['waiting', null])
})

test('heldBy: the first open thing says why, and nothing open is null', () => {
  const nothing = { plan: null, handOver: null, background: 0, step: null }
  assert.equal(heldBy(nothing), null)
  assert.equal(heldBy({ ...nothing, plan: { task: { isReported: true } } }), null)
  assert.equal(heldBy({ ...nothing, plan: { task: { isReported: false } }, background: 2 }).why, 'task')
  assert.equal(heldBy({ ...nothing, handOver: { at: 1, title: 'x' } }).why, 'task')
  assert.equal(heldBy({ ...nothing, background: 1, step: { branch: 'b' } }).why, 'background')
  assert.equal(heldBy({ ...nothing, step: { branch: 'feature/x' } }).text, 'Its turn has ended; its branch feature/x is still open.')
})

test('backgroundRunning counts what was sent to the background and has not reported back', () => {
  const count = lines => backgroundRunning(parseTail(lines.join('\n'), false))
  assert.equal(count([typed(1, 'Go'), answer(2, 'Done')]), 0)
  assert.equal(count([launched(1)]), 1)
  assert.equal(count([launched(1), launched(2), reported(3)]), 1)
  assert.equal(count([launched(1), reported(2), reported(3)]), 0)       // never below none
  assert.equal(count([user(1, [{ type: 'tool_result', tool_use_id: 't', content: 'Command running in background with ID: made-up' }])]), 1)
  // An ordinary result, also one that only mentions the words, starts nothing.
  assert.equal(count([toolResult(1), user(2, [{ type: 'tool_result', tool_use_id: 't', content: 'It said: Async agent launched' }])]), 0)
})
