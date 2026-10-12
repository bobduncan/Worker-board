// B65: the window of a backlog step shows the step itself (id, title, kind, activity, where the answer goes, what to
// check) and nothing about a queue. The page's own code is run here, cut out of board.js between its two marks.
// Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = script.slice(script.indexOf('// window:start'), script.indexOf('// window:end'))
const context = {}
vm.runInNewContext(`${cut}\nthis.windowOf = windowOf`, context)
const names = { ask: asks => ({ verify: 'Verify', decide: 'Decide', provide: 'Provide', do: 'Do' })[asks] ?? 'Not sorted', kind: kind => `kind:${kind}` }
/** The page's model, copied into this context so it can be compared. */
const windowOf = subject => JSON.parse(JSON.stringify(context.windowOf(subject, names)))

const notes = [
  { title: null, lines: ['The camera now shows the whole battlefield.'], points: [] },
  { title: 'Requirements', lines: [], points: ['The whole map is on screen', 'No tile lies under the panel'] },
  { title: 'Context', lines: ['Asked on Monday.'], points: [] },
  { title: 'Why', lines: ['Pushes left the view.'], points: [] },
]
const verify = {
  id: 'backlog:B61', step: 'B61', title: 'Say whether the new camera is right', words: 'Verify: Say whether the new camera is right (pictures in art-inbox/camera) @you',
  kind: 'verify', asks: 'verify', activity: 'Architecture', from: 'Features', at: null, isClosed: false, notes, checks: [],
}

test('a Verify step: its id, its title, and chips for its kind, its activity and the worker the answer goes to', () => {
  const view = windowOf({ need: verify, isStep: true, isClosed: false })
  assert.deepEqual([view.code, view.title, view.at], ['B61', 'Say whether the new camera is right', null])
  assert.deepEqual(view.chips, [{ text: 'Verify', tone: 'kind' }, { text: 'Architecture', tone: 'plain' }, { text: 'Answer goes to: Features', tone: 'to' }])
})

test('the checklist is what the step lists under "Requirements"; the other notes stay notes', () => {
  const view = windowOf({ need: verify, isStep: true })
  assert.deepEqual(view.checklist, ['The whole map is on screen', 'No tile lies under the panel'])
  assert.deepEqual(view.notes.map(part => part.title), [null, 'Context', 'Why'])
  // A step without such a list has no checklist: the window shows none.
  assert.deepEqual(windowOf({ need: { ...verify, notes: [notes[0]] }, isStep: true }).checklist, [])
  // A request a chat filed brings its own points to check.
  const ask = { id: 'ask-1', title: 'Pick a look', kind: 'input', from: 'Units', at: 5, notes: [], checks: ['Readable when small'] }
  assert.deepEqual(windowOf({ need: ask, isStep: false }).checklist, ['Readable when small'])
})

test('Decide, Provide and Do steps have the same frame with their own kind', () => {
  for (const [asks, name] of [['decide', 'Decide'], ['provide', 'Provide'], ['do', 'Do'], [null, 'Not sorted']]) {
    const view = windowOf({ need: { ...verify, asks, kind: asks === 'do' ? 'do' : 'input' }, isStep: true })
    assert.equal(view.chips[0].text, name)
    assert.equal(view.chips.length, 3)
  }
})

test('a closed step says so and names no worker to answer to', () => {
  const view = windowOf({ need: { ...verify, isClosed: true }, isStep: true, isClosed: true })
  assert.deepEqual(view.chips.map(chip => chip.text), ['Closed', 'Verify', 'Architecture'])
})

test('a request a chat filed: who it is from and when, in place of an activity', () => {
  const ask = { id: 'ask-1', title: 'Pick a look', kind: 'input', from: 'Units', at: 1234, notes: [], checks: [] }
  const view = windowOf({ need: ask, isStep: false })
  assert.deepEqual([view.code, view.chips, view.at], [null, [{ text: 'kind:input', tone: 'kind' }, { text: 'From: Units', tone: 'to' }], 1234])
})

test('a queued step: the step and the worker it is for, and nothing about the queue', () => {
  const step = { id: 'B65', title: 'The step window', minutes: 60, after: 'B64', branch: null, notes }
  const view = windowOf({ step, lane: 'Features' })
  assert.deepEqual([view.code, view.title, view.chips], ['B65', 'The step window', [{ text: 'Step', tone: 'kind' }, { text: 'For: Features', tone: 'to' }]])
  // No place in a queue, no other steps, no time and no "after": none of it is in what the window is given.
  const text = JSON.stringify(view)
  for (const word of ['queue', 'Queue', ' of ', '~', 'min', 'after', 'B64', '60']) assert.ok(!text.includes(word), `the window holds "${word}"`)
})

test('the window\'s code draws nothing about a queue either', () => {
  const draw = script.slice(script.indexOf('function drawDetails(state)'), script.indexOf('function listOf(lines)'))
  for (const gone of ['Status in queue', 'Position in queue', 'In queue', 'Estimated', 'queue-list', 'lane.queue.length', 'about(step.minutes)']) {
    assert.ok(!draw.includes(gone), `drawDetails still has "${gone}"`)
  }
})

test('the styles: about 65% for the description and pictures, the answer along the bottom, the window as high as its content', () => {
  assert.match(style, /\.details-body \{ grid-template-columns: minmax\(0, 65fr\) minmax\(0, 35fr\); \}/)
  assert.match(style, /\.details \{ width: min\(1180px, calc\(100vw - 40px\)\); max-height: calc\(100vh - 40px\); \}/)
  assert.match(style, /\.details-foot \.details-answer > textarea \{ order: 1;/)
  assert.match(style, /\.details-foot \.details-answer > \.buttons \{ order: 2;/)
  // Reject left of Approve, red and green.
  assert.match(style, /\.is-reject \{ order: 1; background: #e5484d;/)
  assert.match(style, /\.is-approve \{ order: 2; background: #2fbf71;/)
  // No fixed height anywhere on the window.
  assert.ok(!/\.details \{[^}]*[^-]height:/.test(style.replace(/max-height/g, 'max-h')))
})
