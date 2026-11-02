// Signals change 7 (B914, 2026-11-02): the worker's row as the person chose it ("the simplest row", after "too much text"):
// one line with exactly three things, the status pill, the task (id and title from the store) and the time left of its size
// ("1 h 56 of its 2 h"), and a thin bar without words of the same fact; since, the last checkpoint and the chat's own plan
// words only on hover and in its window. The page is clicked through the DOM harness (test/README-page-tests.md). The real
// case: B855 at 11:16 on 2 Nov (taken 11:10, size about 2 h, interrupted 11:14-11:16), its card saying "QA of B813".
import assert from 'node:assert/strict'
import test from 'node:test'

import { B855_CARD, B855_LINES, MIN, at, b855d, cardOf, stateAt, stepItem } from './heldFixtures.mjs'
import { openPage } from './pageHarness.mjs'

const sent = state => JSON.parse(JSON.stringify(state))
const NOW = at(11, 16)
const laneOf = (page, name) => page.all('#lanes [data-lane]').find(one => one.dataset.lane === name)
const simpleRowOf = (page, name) => page.all('#simple-workers .simple-worker').find(one => one.querySelector('.simple-name')?.textContent === name)
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const LEAD_CARD = JSON.stringify({ name: 'Lead', role: 'main', state: 'working', at: at(11, 0), task: { text: 'Hand out the hedge work', step: 1, steps: 2, names: ['Read', 'Hand out'], left: 30 * MIN } })

async function opened(state, now = NOW) {
  return openPage({ state: sent(state), now })
}

test('B855 at 11:16: the row is the pill, B855 and its title, "1 h 56 of its 2 h", a thin bar: nothing else, nothing of the card', async () => {
  const page = await opened(stateAt(NOW, { items: [b855d()], card: B855_CARD, lines: B855_LINES }))
  try {
    const lane = laneOf(page, 'Digger')
    const what = lane.querySelector('.what')
    assert.equal(words(what), 'B855 A walkable tile always shows its whole move/target square')
    // One line: no second line, no "its plan", no since, no checkpoint, no step count.
    assert.equal(what.querySelectorAll('p').length, 1)
    assert.equal(lane.querySelector('.step-line'), null)
    assert.equal(lane.querySelector('.progress-count'), null)
    assert.equal(words(lane.querySelector('.progress-cell')), '')
    for (const not of ['QA of B813', 'Since', '11:10', 'checkpoint', 'Its plan', '40 min']) assert.ok(!words(lane.querySelector('.lane-row')).includes(not), `the row does not say "${not}"`)
    // The time: left of its size, from the store and the board's clock, never the card's 40 min.
    assert.equal(words(lane.querySelector('.eta')), '1 h 56 of its 2 h')
    // The bar: 4 of 120 minutes used, the same fact as the time.
    assert.equal(lane.querySelector('.progress-cell .fill').style.width, '3.3%')
    assert.ok(!lane.querySelector('.progress-cell .fill').classList.contains('is-overdue'))
    // The hover: since, the last checkpoint and its plan words with their age.
    const hover = lane.querySelector('.held-task').title
    assert.match(hover, /Since 11:10 · last checkpoint 11:14 \(2 min ago\):/)
    assert.match(hover, /committed on b855-whole-move-squares; gate running/)
    assert.match(hover, /Its plan: 4 of 4 · Report · 2 min ago/)
  } finally { await page.close() }
})

test('the simple view says the same: B855, "1 h 56" "of its 2 h", the bar at 3%, the three on hover', async () => {
  const page = await opened(stateAt(NOW, { items: [b855d()], card: B855_CARD, lines: B855_LINES }))
  try {
    const row = simpleRowOf(page, 'Digger')
    assert.match(words(row.querySelector('.simple-what')), /^B855 A walkable tile/)
    assert.equal(words(row.querySelector('.simple-left')), '1 h 56 of its 2 h')
    assert.equal(row.querySelector('.simple-track > span').style.width, '3%')
    assert.ok(!words(row).includes('QA of B813'))
    assert.match(row.querySelector('.simple-what').title, /Since 11:10 · last checkpoint 11:14/)
  } finally { await page.close() }
})

test('its window holds since, the checkpoint and its plan as its own words; none of the card\'s words', async () => {
  const page = await opened(stateAt(NOW, { items: [b855d()], card: B855_CARD, lines: B855_LINES }))
  try {
    await page.click('[data-lane="Digger"] .lane-row .what')
    const shown = words(page.document.body)
    assert.ok(shown.includes('Since 11:10 · last checkpoint 11:14 (2 min ago):'), 'since and the checkpoint')
    assert.ok(shown.includes('Its own words: 4 of 4 · Report · 2 min ago'), 'its plan, as its own words')
    assert.ok(shown.includes('1 h 56 of its 2 h'))
    assert.ok(!shown.includes('QA of B813'))
  } finally { await page.close() }
})

test('a worker holding no step shows the pill alone: no task, no bar, no time, no "No time"', async () => {
  const page = await opened(stateAt(NOW, { card: cardOf('B12 Plant the hedge', { step: 1, steps: 2, left: 20 * MIN }) }))
  try {
    const lane = laneOf(page, 'Digger')
    assert.equal(lane.querySelector('.pill').dataset.status, 'Working')
    // No task line (the reconciler's flag on the card's B12 stays: it is the card's reader, G1).
    assert.equal(lane.querySelector('.what .task'), null)
    assert.ok(!words(lane.querySelector('.what')).includes('Plant the hedge'))
    assert.equal(lane.querySelector('.progress-cell .bar'), null)
    assert.equal(words(lane.querySelector('.eta')), '')
    assert.ok(!words(page.document.body).includes('No time'))
  } finally { await page.close() }
})

test('"No time" only for a held step without a size', async () => {
  const bare = stepItem('B20', { owner: 'Digger', history: [[at(11, 0), 'Digger', 'taken → in progress']] })
  const page = await opened(stateAt(NOW, { items: [bare] }))
  try {
    const lane = laneOf(page, 'Digger')
    assert.equal(words(lane.querySelector('.eta')), 'No time')
    assert.equal(lane.querySelector('.progress-cell .bar'), null)
  } finally { await page.close() }
})

test('over its size: "12 min over its 30 min" in the plain tone; overdue (2x and 10 min) turns time and bar together', async () => {
  const small = stepItem('B21', { owner: 'Digger', size: 'about 30 min', history: [[at(11, 10), 'Digger', 'taken → in progress']] })
  const lines = [{ at: at(11, 10), chat: 'Digger', state: 'working', task: null, source: 'step' }]
  const over = await opened(stateAt(at(11, 52), { items: [small], lines }), at(11, 52))
  try {
    const lane = laneOf(over, 'Digger')
    assert.equal(words(lane.querySelector('.eta')), '12 min over its 30 min')
    assert.equal(lane.querySelector('.eta .is-blocked'), null)
    assert.equal(lane.querySelector('.progress-cell .fill').style.width, '100%')
    assert.ok(!lane.querySelector('.progress-cell .fill').classList.contains('is-overdue'))
  } finally { await over.close() }
  const overdue = await opened(stateAt(at(12, 21), { items: [small], lines }), at(12, 21))
  try {
    const lane = laneOf(overdue, 'Digger')
    assert.equal(words(lane.querySelector('.eta')), '41 min over its 30 min')
    assert.notEqual(lane.querySelector('.eta .is-blocked'), null)
    assert.ok(lane.querySelector('.progress-cell .fill').classList.contains('is-overdue'))
  } finally { await overdue.close() }
})

test('the main chat\'s row is as it was: its card\'s task', async () => {
  const page = await opened(stateAt(NOW, { items: [b855d()], card: B855_CARD, lines: B855_LINES, leadCard: LEAD_CARD }))
  try {
    assert.match(words(laneOf(page, 'Lead').querySelector('.what')), /Hand out the hedge work/)
  } finally { await page.close() }
})
