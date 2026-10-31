// "Your words" in a step's window (the person, 2026-10-30: "ensure my answer/rejection/note has context of what i answered
// it to"): every point with what it answered, newest last, first on a taken step's Summary and after the Summary on a new
// or refined one; "Add a note" sends the person's words to the step (the work API's `words`). The page is read and clicked
// through the DOM harness (B415), its state made by the real state builder. Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseItem } from '../src/work/item.mjs'
import { itemOfStep } from '../src/work/read.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'

const WORDS = [
  '## Your words',
  '1. 2026-10-19 09:20 · answer to Q4 (Digger asked: "Round or square hedge?"; options: A round / B square; advised: A; shown: art-inbox/b12/a.png)',
  '   You: Rejected. Too square, make it round.',
  '2. 2026-10-19 09:40 · note (on the board)',
  '   You: Keep the gate where it is.',
]
const step = (state, words = WORDS) => parseItem([
  'Id: B12', 'Kind: step', 'Title: Plant the hedge', `State: ${state}`, ...(state === 'refined' ? [] : ['Owner: Digger']), `Since: ${sinceOf(NOW - 30 * MIN)}`, '',
  '## Summary', 'A hedge round the garden.', '', ...(words.length === 0 ? [] : [...words, '']),
  '## History', `- ${sinceOf(NOW - 30 * MIN)} Digger: taken → in progress`, '',
].join('\n'))
const stateWith = item => asSent({ ...build([item]), goalsEdit: { canWrite: true } })

test('the store gives a step its points, each with what it answered; a step without any gives none', () => {
  const work = { ok: true, items: new Map([['B12', step('in progress')]]), activities: [{ name: 'Garden', steps: ['B12'] }] }
  const [first, second] = itemOfStep(work, 'B12').yourWords
  assert.deepEqual([first.n, first.how, first.ask, first.by, first.question, first.options, first.advice, first.shown, first.answer],
    [1, 'answer to Q4', 'Q4', 'Digger', 'Round or square hedge?', ['A round', 'B square'], 'A', ['art-inbox/b12/a.png'], 'Rejected. Too square, make it round.'])
  assert.deepEqual([second.how, second.question, second.answer], ['note (on the board)', null, 'Keep the gate where it is.'])
  assert.deepEqual(itemOfStep({ ...work, items: new Map([['B12', step('in progress', [])]]) }, 'B12').yourWords, [])
})

test('a taken step\'s window opens on "Your words": every point with what it answered, newest last; "Add note" sends the note to the step', async () => {
  const page = await openPage({ state: stateWith(step('in progress')), hash: 'details=B12', answers: () => reply({ id: 'B12', text: 'B12: noted', changed: true }) })
  try {
    const parts = page.all('#details .task-part h3').map(one => one.textContent)
    assert.equal(parts[0], 'Your words')
    const points = page.all('#details .your-word')
    // In plain words (B701: no ids or paths on the Summary): what was shown is the picture itself, opening large on a click.
    assert.deepEqual(points.map(one => one.querySelector('.your-word-head').textContent), ['1. 2026-10-19 09:20 · your answer', '2. 2026-10-19 09:40 · your note (on the board)'])
    assert.equal(points[0].querySelector('.your-word-context').textContent, 'Digger asked: "Round or square hedge?" · options: A round / B square · advised: A')
    assert.deepEqual([...points[0].querySelectorAll('.your-word-pics .picture')].map(one => one.dataset.zoom), ['art-inbox/b12/a.png'])
    assert.equal(points[1].querySelector('.your-word-context'), null)
    assert.deepEqual(points.map(one => one.querySelector('.your-word-text').textContent), ['You: Rejected. Too square, make it round.', 'You: Keep the gate where it is.'])
    // Nothing written: nothing sent, and it says so.
    await page.click('#details [data-words-send="B12"]')
    assert.deepEqual(page.sent('/api/work', 'words'), [])
    assert.equal(page.text('#details .your-words-add .problem'), 'Write your note first.')
    await page.type('#details [data-words-text="B12"]', 'Lower than the fence, please.')
    await page.click('#details [data-words-send="B12"]')
    assert.deepEqual(page.sent('/api/work', 'words').map(one => one.body), [{ action: 'words', id: 'B12', text: 'Lower than the fence, please.', where: 'on the board' }])
  } finally {
    await page.close()
  }
})

test('a refused note keeps its words and says why; a step with no words yet still has "Add a note"', async () => {
  const page = await openPage({ state: stateWith(step('in progress', [])), hash: 'details=B12', answers: () => reply('B12: no such item in the store.', 404) })
  try {
    assert.equal(page.all('#details .your-word').length, 0)
    assert.ok(!page.all('#details .task-part h3').some(one => one.textContent === 'Your words'))
    await page.type('#details [data-words-text="B12"]', 'Keep it low.')
    await page.click('#details [data-words-send="B12"]')
    assert.equal(page.sent('/api/work', 'words').length, 1)
    assert.match(page.text('#details .your-words-add .problem'), /^Not sent: B12: no such item in the store\./)
    assert.equal(page.find('#details [data-words-text="B12"]').value, 'Keep it low.')
  } finally {
    await page.close()
  }
})

test('a refined step\'s window (the calm layout) shows "Your words" right under Context, Problem and Solution, with "Add a note"', async () => {
  const page = await openPage({ state: stateWith(step('refined')), hash: 'details=B12' })
  try {
    // Calm task window: the three lines first, then the person's words; no Summary part any more.
    const order = [...page.find('#details .task-calm').children].map(one => one.className.split(' ')[0])
    assert.deepEqual(order.slice(0, 2), ['task-story', 'task-part'])
    assert.equal(page.text('#details .task-calm > .task-part h3'), 'Your words')
    assert.equal(page.all('#details .your-word').length, 2)
    assert.equal(page.all('#details [data-words-send="B12"]').length, 1)
  } finally {
    await page.close()
  }
})
