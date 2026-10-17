// B181: a step of the backlog that nobody has gets "Add to queue" on the Backlog tab. The board only asks: it types
// "queue step from the backlog" with the step into the main chat, which picks the worker or what the step waits for
// and writes the step's "(for ...)" note. Until then the step shows that it was asked, and a second click sends
// nothing. The user, 2026-10-14: "I want a button add to queue for the items on the backlog." Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { messageText } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { checkSay } from '../src/say.mjs'
import { buildState } from '../src/state.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.UTC(2026, 9, 14, 12, 30)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const LIST = '{"prefix":"Studio · ","main":"Lead"}'
const CHATS = ['Lead', 'Worker 1']

const BACKLOG = [
  '## Work',
  '- [ ] B10 Paste "pictures" into the talk',
  '  A line under it.',
  '- [ ] B11 Build the shop (for Worker 1; now; about 1 h)',
  '- [ ] B12 Build the camera (for Worker 1) (branch feature/camera)',
  '- [x] B13 Finish the old thing',
  '- [ ] B14 Verify: Check the shop (Studio · Worker 1) @you',
  '- [ ] A step from before the ids',
  '',
].join('\n')

const app = name => JSON.stringify({
  title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: NOW - 2 * HOUR, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const rested = { text: [typed(NOW - 30 * MIN, 'Zebracorn'), answer(NOW - 29 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW }

/** The board with the main chat and one worker at rest, this backlog, and what was sent. */
function build({ outbox = [], backlogText = BACKLOG } = {}) {
  const raw = {
    listText: LIST,
    appChatTexts: CHATS.map(app),
    tails: Object.fromEntries(CHATS.map(name => [`cli-${name}`, rested])),
    planLineTexts: {}, backlogText, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const seen = { shown: Object.fromEntries(CHATS.map(name => [name, NOW - 5000])), other: {} }
  return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 10 * MIN, offSince: null }, seen, now: NOW, config })
}

const WORDS = { to: 'Lead', ask: null, step: null, title: null, version: null, verdict: null, command: 'queue' }
const sent = (at, about, more = {}) => ({ id: `m${at}`, at, ...WORDS, about, text: `queue step from the backlog\nStep: ${about}`, state: 'delivered', deliveredAt: at + 5000, ...more })
const stepOf = (state, id) => state.backlog.flatMap(activity => activity.steps).find(step => step.id === id)

// The word the board types into the main chat

test('a step nobody has is asked for in the board\'s own words, its title on one plain line', () => {
  // B285: B10 is not refined yet, so the ask is held on the board until it is (test/refineGate.test.mjs).
  assert.deepEqual(checkSay({ to: 'Lead', command: 'queue', step: 'B10' }, build(), 2000), {
    ok: true,
    message: { ...WORDS, about: 'B10', text: 'queue step from the backlog\nStep: B10 Paste pictures into the talk', held: true },
  })
})

test('it arrives in the main chat marked as typed on the worker board', () => {
  const { message } = checkSay({ to: 'Lead', command: 'queue', step: 'B10' }, build(), 2000)
  assert.equal(messageText({ ...message, at: NOW }, () => '12:30'), 'queue step from the backlog\nStep: B10 Paste pictures into the talk\n(typed on the worker board, 12:30)')
})

test('a step that is queued, in progress, finished, the person\'s, without an id or not there is not asked for', () => {
  const state = build()
  for (const step of ['B11', 'B12', 'B13', 'B14', 'B99', undefined, null]) {
    const refused = checkSay({ to: 'Lead', command: 'queue', step }, state, 2000)
    assert.deepEqual([refused.ok, refused.status], [false, 409], String(step))
  }
  // The word goes to the main chat only, and carries nothing else.
  assert.equal(checkSay({ to: 'Worker 1', command: 'queue', step: 'B10' }, state, 2000).status, 400)
  assert.equal(checkSay({ to: 'Lead', command: 'queue', step: 'B10', text: 'and more' }, state, 2000).status, 400)
})

test('one ask at a time per step: a second waits until the first is no longer open', () => {
  const open = build({ outbox: [sent(NOW - 2 * MIN, 'B10', { state: 'waiting', deliveredAt: undefined })] })
  assert.deepEqual(checkSay({ to: 'Lead', command: 'queue', step: 'B10' }, open, 2000), { ok: false, status: 409, why: 'The main chat was already asked to queue this step.' })
  // Another step is asked for as before.
  const later = build({ backlogText: `${BACKLOG}- [ ] B15 Draw the map\n`, outbox: [sent(NOW - 2 * MIN, 'B10', { state: 'waiting', deliveredAt: undefined })] })
  assert.equal(checkSay({ to: 'Lead', command: 'queue', step: 'B15' }, later, 2000).ok, true)
  // An ask that arrived more than an hour ago, or did not arrive, no longer holds the step.
  assert.equal(checkSay({ to: 'Lead', command: 'queue', step: 'B10' }, build({ outbox: [sent(NOW - 2 * HOUR, 'B10')] }), 2000).ok, true)
  assert.equal(checkSay({ to: 'Lead', command: 'queue', step: 'B10' }, build({ outbox: [sent(NOW - MIN, 'B10', { state: 'expired' })] }), 2000).ok, true)
})

// What the state says about an ask

test('an ask is open while it is on its way, and after it arrived for an hour while the step names no worker', () => {
  const ask = (outbox, id = 'B10', backlogText = BACKLOG) => stepOf(build({ outbox, backlogText }), id).queueAsk
  assert.equal(ask([]), null)
  assert.deepEqual(ask([sent(NOW - MIN, 'B10', { state: 'waiting', deliveredAt: undefined })]), { at: NOW - MIN, state: 'waiting', isOpen: true })
  assert.equal(ask([sent(NOW - MIN, 'B10', { state: 'taken', deliveredAt: undefined })]).isOpen, true)
  assert.deepEqual(ask([sent(NOW - 30 * MIN, 'B10')]), { at: NOW - 30 * MIN, state: 'delivered', isOpen: true })
  assert.equal(ask([sent(NOW - 2 * HOUR, 'B10')]).isOpen, false)
  // Another step's ask is not this one's; a step that is queued (the main chat wrote its note) asks nothing more.
  assert.equal(ask([sent(NOW - MIN, 'B11')]), null)
  assert.equal(ask([sent(NOW - MIN, 'B10')], 'B10', BACKLOG.replace('B10 Paste "pictures" into the talk', 'B10 Paste "pictures" into the talk (for Worker 1; now; about 1 h)')), null)
  assert.equal(ask([sent(NOW - MIN, 'B13')], 'B13'), null)
})

// The page

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')

test('the page: the button stands beside a step\'s row, never inside it, and in its window; it sends the step\'s id only', () => {
  const part = script.slice(script.indexOf('function queuePart('), script.indexOf('function askQueue('))
  assert.match(part, /if \(step\.status !== 'open' \|\| typeof step\.id !== 'string' \|\| main === null\) return null/)
  // Asked: when, and no button; else the button, off while it sends.
  assert.match(part, /if \(ask\?\.isOpen === true\) \{/)
  assert.match(part, /button\.disabled = sending\.has\(key\)/)
  assert.match(script, /send\(\{ to: main, command: 'queue', step: button\.dataset\.queueStep \}, `queue:\$\{button\.dataset\.queueStep\}`\)/)
  // The row: a line that holds the row's own button and, beside it, the queue's.
  assert.match(script, /const line = el\('div', 'step-line'\)\n      line\.append\(row\)\n      const queue = queuePart\(step, state, false\)\n      if \(queue !== null\) line\.append\(queue\)/)
  // The window: in its foot, which then shows also for a step without an answer.
  assert.match(script, /const queue = need === null && subject\.step !== undefined \? queuePart\(subject\.step, state, true\) : null/)
  assert.match(script, /fill\(box, foot\.children\.length === 0 \? \[head, body\] : \[head, body, foot\]\)/)  // B221: also Close and Delete
  // The list is drawn anew when an ask is on its way or was refused, not only when the backlog changed.
  assert.match(script, /once\('coordinate', \[state\.backlog \?\? null, queueing\], \(\) => drawCoordinate\(state\)\)/)
  // A click on it is handled before the row's own click, in the list and in the window.
  assert.equal((script.match(/const queue = event\.target\.closest\('\[data-queue-step\]'\)\n {2}if \(queue !== null\) return askQueue\(queue\)/g) ?? []).length, 2)
})
