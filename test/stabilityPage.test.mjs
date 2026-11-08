// Stability numbers (2026-11-05, task 4): the row under the limits (public/board.js, drawStability) and the state field that
// feeds it. The page is run in test/pageHarness.mjs; the numbers are made up.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { FINISH_WORDS } from '../src/stability.mjs'
import { openPage } from './pageHarness.mjs'
import { asSent, build, NOW } from './partnerState.mjs'
import { buildState } from './withStore.mjs'

const dayOf = back => {
  const date = new Date(2026, 9, 19 - back)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const line = (back, { idle = 0, interventions = [], unsure = [], alarms = { real: 0, false: 0, ids: [] }, closed = back > 0 } = {}) =>
  ({ day: dayOf(back), idleWithWorkMinutes: idle, idleEstimated: false, interventions, unsure, alarms, writtenAt: NOW, closed })
// 14 closed days, oldest first (back 14 .. 1): the busy ones early, the last two clean.
const days = Array.from({ length: 14 }, (_, index) => line(14 - index, index < 10 ? { idle: 20 + index, interventions: [{ at: NOW, kind: 'woke-outside', what: 'x' }], alarms: { real: 1, false: 0, ids: ['X1'] } } : {}))
const stability = (today, more = {}) => ({ today, days, stableDays: 2, isStable: false, finish: FINISH_WORDS, ...more })
const clean = line(0, { idle: 4, alarms: { real: 1, false: 1, ids: ['X158', 'X159'] } })
const missed = line(0, {
  idle: 12, interventions: [{ at: NOW, kind: 'app-restart', what: 'Every chat started again' }],
  unsure: [{ at: NOW, kind: 'woke-outside', what: 'Worker 2 went on by itself' }], alarms: { real: 2, false: 0, ids: ['X160', 'X161'] },
})

const open = async given => openPage({ state: { ...asSent(build([])), ...(given === undefined ? {} : { stability: given }) } })
const numbers = page => Object.fromEntries(page.all('.stability-number').map(node => [node.dataset.number, node]))

test('the row draws today\'s three numbers, three sparklines of 14 days and today, and the finish words', async () => {
  const page = await open(stability(clean))
  try {
    assert.equal(page.find('#stability').hidden, false)
    const shown = numbers(page)
    assert.deepEqual(Object.values(shown).map(node => node.textContent), ['4 min idle with work', '0 interventions', '2 alarms (1 false)'])
    const sparks = page.all('.stability-spark')
    assert.deepEqual(sparks.map(node => node.dataset.spark), ['idle', 'interventions', 'alarms'])
    for (const spark of sparks) assert.equal(spark.querySelector('polyline').getAttribute('points').split(' ').length, 15)
    assert.match(page.text('.stability-finish'), new RegExp(`^${FINISH_WORDS} · 2 of 3 days$`))
    assert.ok(!page.find('.stability-finish').classList.contains('is-stable'))
  } finally { await page.close() }
})

test('a stable board says since when, in the stable tone', async () => {
  const page = await open(stability(line(0), { stableDays: 4, isStable: true, days: [...days.slice(0, 10), ...[4, 3, 2, 1].map(back => line(back))] }))
  try {
    assert.match(page.text('.stability-finish'), / · stable since 15 Oct$/)
    assert.ok(page.find('.stability-finish').classList.contains('is-stable'))
  } finally { await page.close() }
})

test('amber only on today\'s two numbers, and only when today already misses the finish line', async () => {
  const quiet = await open(stability(clean))
  const loud = await open(stability(missed))
  const idleOnly = await open(stability(line(0, { idle: 10 })))
  try {
    assert.deepEqual(quiet.all('.is-attn').length, 0)
    assert.deepEqual(Object.entries(numbers(loud)).map(([key, node]) => [key, node.classList.contains('is-attn')]), [['idle', true], ['interventions', true], ['alarms', false]])
    assert.deepEqual(idleOnly.all('.is-attn').map(node => node.dataset.number), ['idle', 'interventions'])
    assert.equal(numbers(loud).interventions.textContent, '1 intervention')
  } finally { await Promise.all([quiet.close(), loud.close(), idleOnly.close()]) }
})

test('a day with idle not known (null) is a gap in the idle sparkline, never a 0, and says "not known" in the hover', async () => {
  const backfilled = days.map(one => ({ ...one, idleWithWorkMinutes: null, idleEstimated: true }))
  const page = await open(stability(clean, { days: backfilled }))
  try {
    const [idle, interventions] = page.all('.stability-spark')
    assert.equal(idle.querySelectorAll('polyline').length, 0, '14 gaps and today: no line at all, today a lone dot')
    assert.equal(idle.querySelectorAll('circle').length, 1)
    assert.match(idle.querySelector('title').textContent, /^Idle with work, per day: (not known ){14}4$/)
    assert.equal(interventions.querySelectorAll('polyline').length, 1, 'the other sparklines are whole')
  } finally { await page.close() }
  // Gaps in the middle break the line in two; a null is not drawn at the bottom as 0.
  const mixed = days.map((one, index) => ({ ...one, idleWithWorkMinutes: index === 6 ? null : 20 }))
  const split = await open(stability(clean, { days: mixed }))
  try {
    const idle = split.find('[data-spark="idle"]')
    assert.deepEqual(Array.from(idle.querySelectorAll('polyline')).map(node => node.getAttribute('points').split(' ').length), [6, 8])
    assert.ok(!/ 0 /.test(idle.querySelector('title').textContent) && /20 not known 20/.test(idle.querySelector('title').textContent))
  } finally { await split.close() }
})

test('a today line with idle not known says so and is not amber for it', async () => {
  const page = await open(stability({ ...line(0), idleWithWorkMinutes: null }))
  try {
    assert.equal(numbers(page).idle.textContent, 'idle with work not known')
    assert.equal(page.all('.is-attn').length, 0)
  } finally { await page.close() }
})

test('the row stays hidden without the field', async () => {
  const page = await open()
  try {
    assert.equal(page.find('#stability').hidden, true)
    assert.equal(page.all('.stability-number').length, 0)
  } finally { await page.close() }
})

test('a hover on each number lists the day\'s items: what was done, the unsure ones, the alarm ids', async () => {
  const page = await open(stability(missed))
  try {
    const shown = numbers(page)
    assert.equal(shown.interventions.title, 'Every chat started again\nunsure: Worker 2 went on by itself')
    assert.equal(shown.alarms.title, 'X160, X161')
    assert.match(shown.idle.title, /^12 min today/)
  } finally { await page.close() }
})

test('the state carries the field with the finish words; a board that keeps none leaves it out', () => {
  const raw = { listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [], tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, backlogText: '' }
  const options = { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\garden' } }
  const given = { today: clean, days, stableDays: 2, isStable: false }
  const withField = buildState(raw, { ...options, stability: given })
  assert.deepEqual(asSent(withField.stability), asSent({ ...given, finish: FINISH_WORDS }))
  assert.equal('stability' in buildState(raw, options), false)
})

test('a day not measured (paused or off for most of it) is a gap in all three sparklines, "not measured" in the hover, and never amber', async () => {
  const paused = days.map((one, index) => (index === 6 ? { ...one, measured: false, notMeasuredWhy: 'paused', pausedMinutes: 1337, offMinutes: 1334 } : one))
  const page = await open(stability(clean, { days: paused }))
  try {
    for (const spark of page.all('.stability-spark')) {
      assert.deepEqual(Array.from(spark.querySelectorAll('polyline')).map(node => node.getAttribute('points').split(' ').length), [6, 8], `${spark.dataset.spark}: the line breaks at the 7th day`)
      assert.match(spark.querySelector('title').textContent, /^[A-Za-z ]+, per day: (\S+ ){6}not measured (\S+ ){7}\S+$/)
    }
  } finally { await page.close() }
})

test('today not measured says "not measured (paused)" or "(off)", with the minutes in the hover, a gap at the end of the sparklines, and no amber', async () => {
  const today = line(0, { idle: 40, interventions: [{ at: NOW, kind: 'app-restart', what: 'x' }], closed: false })
  for (const [why, words] of [['paused', 'not measured (paused)'], ['off', 'not measured (off)']]) {
    const page = await open(stability({ ...today, measured: false, notMeasuredWhy: why, pausedMinutes: 1337, offMinutes: 1334 }))
    try {
      assert.deepEqual(page.all('.stability-number').map(node => node.textContent), [words])
      assert.match(page.find('.stability-number').title, /1337 min paused, 1334 min off/)
      assert.equal(page.all('.is-attn').length, 0, 'even with 40 idle minutes and an intervention it is not amber')
      for (const spark of page.all('.stability-spark')) {
        assert.equal(spark.querySelectorAll('circle').length, 0, 'no dot for today')
        assert.match(spark.querySelector('title').textContent, / not measured$/)
      }
    } finally { await page.close() }
  }
})
