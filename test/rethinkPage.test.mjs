// Stop and rethink, the page (docs/stop-and-rethink.md, decision 2026-11-07 A): the Focus talk bar's switch, the topic picker, the words
// and pictures, and the goals command it sends. Happy-dom page, a fake fetch; made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { openPage, reply } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const GOALS = ['Focus: G6', '', '- [~] G6 Garden', '    Done when: x', '    Goal definition: calm', '    Goal definition agreed: 2026-10-15 08:00', '    How agreed: 2026-10-15 09:00', ''].join('\n')
const PART = { title: 'Stairs and bridges', kind: 'part', steps: [{ id: 'B1068', title: 'Stairs', state: 'in progress', owner: 'Worker 5' }, { id: 'B1070', title: 'Bridge', state: 'queued', owner: null }] }
const CHAIN = { title: 'the tries of Lamps', kind: 'chain', steps: [{ id: 'B20', title: 'Lamps', state: 'queued', owner: null }, { id: 'B31', title: 'Lamps again', state: 'refined', owner: 'Worker 2' }] }
const stateOf = topics => {
  const state = asSent({ ...build([], undefined, GOALS), goalsEdit: { canWrite: true } })
  if (topics !== null) state.focus = { ...state.focus, rethinkTopics: topics }
  return state
}
const WORDS = 'all wrong, stop it and rethink'
const SEND = '[data-focus-form="rethink-send"] button'

async function open(topics, answers) {
  const page = await openPage({ state: stateOf(topics), answers })
  await page.click('[data-tab="advice"]')
  return page
}
const goalsSent = page => page.sent('/api/goals').map(one => one.body)
const kept = request => (request.url === '/api/talk/picture' ? reply({ path: 'art-inbox/talk/one.png' }) : null)
async function pick(page, value) {
  const select = page.find('[data-rethink-topic]')
  select.value = value
  select.dispatchEvent(new page.window.Event('change', { bubbles: true }))
  await page.type('#focus-rethink-words', WORDS)
}
function paste(page) {
  const file = new page.window.File(['x'], 'p.png', { type: 'image/png' })
  const event = new page.window.Event('paste', { bubbles: true, cancelable: true })
  event.clipboardData = { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] }
  page.find('#focus-rethink-words').dispatchEvent(event)
}

test('the switch is hidden without topics and shown with one', async () => {
  for (const [topics, count] of [[null, 0], [[], 0], [[PART], 1]]) {
    const page = await open(topics)
    try {
      assert.equal(page.all('[data-focus-act="rethink-switch"]').length, count)
      assert.equal(page.all('#focus-bar-words').length, 1, 'the talk bar works as before')
    } finally { await page.close() }
  }
})

test('switched on: the bar shows the picker, the words and "Stop and rethink"; a single topic is chosen already', async () => {
  const page = await open([PART])
  try {
    await page.click('[data-focus-act="rethink-switch"]')
    assert.equal(page.all('#focus-bar-words').length, 0)
    const select = page.find('[data-rethink-topic]')
    assert.deepEqual([...select.options].map(one => one.textContent), ['Pick the topic…', 'Stairs and bridges · B1068 (Worker 5), B1070'])
    assert.equal(select.value, 'part:Stairs and bridges')
    assert.equal(page.find(SEND).textContent, 'Stop and rethink')
    assert.equal(page.find('[data-focus-act="rethink-switch"]').getAttribute('aria-checked'), 'true')
    await page.click('[data-focus-act="rethink-switch"]')
    assert.equal(page.all('#focus-bar-words').length, 1, 'off again: the talk bar')
  } finally { await page.close() }
})

test('two topics: none is chosen until the person picks, and sending without one is refused on the page', async () => {
  const page = await open([PART, CHAIN])
  try {
    await page.click('[data-focus-act="rethink-switch"]')
    assert.equal(page.find('[data-rethink-topic]').value, '')
    await page.type('#focus-rethink-words', WORDS)
    await page.click(SEND)
    assert.equal(page.text('.focus-rethink-note'), 'Pick the topic to stop.')
    assert.deepEqual(goalsSent(page), [])
  } finally { await page.close() }
})

test('empty words are refused on the page, nothing is sent', async () => {
  const page = await open([PART])
  try {
    await page.click('[data-focus-act="rethink-switch"]')
    await page.click(SEND)
    assert.equal(page.text('.focus-rethink-note'), 'Say what is wrong, in your words.')
    assert.deepEqual(goalsSent(page), [])
  } finally { await page.close() }
})

test('a part topic posts part, a chain topic posts of (its newest open step), with the pictures; the done line, then the reset', async () => {
  const answers = request => kept(request) ?? reply({ topic: 'Stairs and bridges', held: ['B1068', 'B1070'], stopped: [{ id: 'B1068', owner: 'Worker 5' }], notStopped: [], evaluation: 'started' })
  const page = await open([PART, CHAIN], answers)
  try {
    await page.click('[data-focus-act="rethink-switch"]')
    await pick(page, 'part:Stairs and bridges')
    paste(page)
    await page.click(SEND)
    assert.deepEqual(goalsSent(page), [{ command: 'rethink', id: 'G6', part: 'Stairs and bridges', text: WORDS, pictures: ['art-inbox/talk/one.png'] }])
    assert.equal(page.text('.focus-rethink-note'), 'Stopped and held: B1068 (Worker 5), B1070. Your Advisor rethinks "Stairs and bridges"; your Product owner confirms it in the talk.')
    assert.equal(page.all(SEND).length, 0, 'the switch is reset')
    assert.equal(page.find('#focus-bar-words').value, '')
    // The chain topic, after the reset: the words and the pictures are gone.
    await page.click('[data-focus-act="rethink-switch"]')
    assert.equal(page.find('#focus-rethink-words').value, '', 'the words are reset')
    assert.equal(page.all('.focus-rethink-pictures img').length, 0, 'the pictures are reset')
    await pick(page, 'chain:the tries of Lamps')
    await page.click(SEND)
    assert.deepEqual(goalsSent(page).at(-1), { command: 'rethink', id: 'G6', of: 'B31', text: WORDS, pictures: [] })
  } finally { await page.close() }
})

test('a running evaluation and steps not stopped are named in the done line', async () => {
  const answers = () => reply({ topic: 'Stairs and bridges', held: ['B1068'], stopped: [], notStopped: [{ id: 'B1068', owner: 'Worker 5', why: 'A stop is open already.' }], evaluation: 'running' })
  const page = await open([PART], answers)
  try {
    await page.click('[data-focus-act="rethink-switch"]')
    await page.type('#focus-rethink-words', WORDS)
    await page.click(SEND)
    assert.match(page.text('.focus-rethink-note'), /An evaluation already ran: your words were added to it\. Not stopped: B1068 \(Worker 5\): A stop is open already\.$/)
  } finally { await page.close() }
})

test('a refused answer shows the board\'s why and keeps the words and the picture', async () => {
  const answers = request => kept(request) ?? reply('No partner chat is on the board.', 409)
  const page = await open([PART], answers)
  try {
    await page.click('[data-focus-act="rethink-switch"]')
    await page.type('#focus-rethink-words', WORDS)
    paste(page)
    assert.equal(page.all('.focus-rethink-pictures img').length, 1)
    await page.click(SEND)
    assert.equal(goalsSent(page).length, 1)
    assert.match(page.text('.focus-rethink-note'), /No partner chat is on the board\./)
    assert.ok(page.find('.focus-rethink-note').classList.contains('is-error'))
    assert.equal(page.find('#focus-rethink-words').value, WORDS)
    assert.equal(page.all('.focus-rethink-pictures img').length, 1)
    assert.equal(page.find('[data-focus-act="rethink-switch"]').getAttribute('aria-checked'), 'true')
  } finally { await page.close() }
})
