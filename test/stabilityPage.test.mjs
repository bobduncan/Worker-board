// Stability numbers (2026-11-05, task 4; stability-row-clean, 2026-11-11): the row under the limits (public/board.js,
// drawStability) and the state field that feeds it. The person, 2026-11-11: one line of plain labels with numbers, no
// sparklines, no target, no amber; "details" opens the last days, one row each. The page is run in test/pageHarness.mjs;
// the days are the live board's own lines of 8-11 Nov (fixtures/stability-live-2026-11-11.jsonl).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { viewOf } from '../src/stability.mjs'
import { openPage } from './pageHarness.mjs'
import { asSent, build, NOW } from './partnerState.mjs'
import { buildState } from './withStore.mjs'

const live = readFileSync(new URL('../fixtures/stability-live-2026-11-11.jsonl', import.meta.url), 'utf8').trim().split('\n').map(one => JSON.parse(one))
// 11 Nov 2026, 13:00 local: today is the open line of the 11th, the three before it are closed.
const LIVE = viewOf(live, new Date(2026, 10, 11, 13, 0).getTime())

const open = async given => openPage({ state: { ...asSent(build([])), ...(given === undefined ? {} : { stability: given }) } })
const lineText = page => Array.from(page.find('#stability .stability-line').children).map(node => node.textContent.trim()).join(' ')
const rows = page => page.all('#stability .stability-days tr').map(row => Array.from(row.children).map(cell => cell.textContent))

test('the state field is today\'s line and the last closed days, with no finish line', () => {
  assert.deepEqual(Object.keys(LIVE), ['today', 'days'])
  assert.equal(LIVE.today.day, '2026-11-11')
  assert.deepEqual(LIVE.days.map(one => one.day), ['2026-11-08', '2026-11-09', '2026-11-10'])
})

test('the line from the live data: plain labels with numbers and a details link, nothing else', async () => {
  const page = await open(LIVE)
  try {
    assert.equal(page.find('#stability').hidden, false)
    assert.equal(lineText(page), 'Stability today · fixes by hand 1 · real alarms 0 · idle with work 1 min details')
    // No dot, no sparkline, no target, no amber, no "not measured" word, no details before the click.
    assert.equal(page.all('#stability svg, #stability .is-attn, #stability .stability-days').length, 0)
    assert.doesNotMatch(page.find('#stability').textContent, /stable|of 3 days|not measured|interventions?\b/)
    // Every number stands beside its label.
    for (const node of page.all('#stability .stability-number')) assert.match(node.textContent, /^[a-z ]+ \S/)
    assert.equal(page.all('#stability .stability-line > b').length, 0, 'no number without its label')
    assert.equal(page.find('[data-number="fixes"]').title, 'Resume all, ending a pause that was not yours\nunsure: Worker 5 went from interrupted to working with no wake or message in the 5 minutes before')
  } finally { await page.close() }
})

test('details opens the last days from the live data, one row each, today "so far", with the alarm ids and a note for an odd day', async () => {
  const page = await open(LIVE)
  try {
    await page.click('#stability .stability-details')
    assert.deepEqual(rows(page), [
      ['Day', 'Fixes by hand', 'Real alarms', 'Idle with work', 'Note'],
      ['11 Nov, so far', '1', '0', '1 min', 'board off 7 h 24 min'],
      ['10 Nov', '0', '0', '1 min', 'paused most of the day'],
      ['9 Nov', '1', '2 (X162, X163)', '4 min', 'board off most of the day'],
      ['8 Nov', '0', '1 (X2)', '0 min', 'board off most of the day'],
    ])
    assert.equal(page.text('#stability .stability-details'), 'hide details')
    await page.click('#stability .stability-details')
    assert.equal(page.all('#stability .stability-days').length, 0)
  } finally { await page.close() }
})

test('real alarm ids leave the false ones out; idle not known and estimated say so; a rebuilt day says so', async () => {
  const day = (date, more) => ({ day: date, idleWithWorkMinutes: 2, idleEstimated: false, interventions: [], unsure: [], alarms: { real: 0, false: 0, ids: [], cameBack: [] }, closed: true, measured: true, pausedMinutes: 0, offMinutes: 0, ...more })
  const page = await open({
    today: day('2026-11-11', { closed: false, idleWithWorkMinutes: null, alarms: { real: 1, false: 1, ids: ['X5', 'X6'], realIds: ['X6'], cameBack: [] } }),
    days: [day('2026-11-09', { idleEstimated: true, backfilled: true }), day('2026-11-10', { pausedMinutes: 125 })],
  })
  try {
    assert.equal(lineText(page), 'Stability today · fixes by hand 0 · real alarms 1 · idle with work not known details')
    assert.equal(page.find('[data-number="alarms"]').title, 'X6')
    await page.click('#stability .stability-details')
    assert.deepEqual(rows(page).slice(1), [
      ['11 Nov, so far', '0', '1 (X6)', 'not known', ''],
      ['10 Nov', '0', '0', '2 min', 'paused 2 h 5 min'],
      ['9 Nov', '0', '0', '~2 min', 'rebuilt from older records'],
    ])
  } finally { await page.close() }
})

test('the row stays hidden without the field', async () => {
  const page = await open(undefined)
  try { assert.equal(page.find('#stability').hidden, true) } finally { await page.close() }
})

test('the state carries the field as the writer gave it; a board that keeps none leaves it out', () => {
  const raw = { listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [], tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, backlogText: '' }
  const options = { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\garden' } }
  assert.deepEqual(asSent(buildState(raw, { ...options, stability: LIVE }).stability), asSent(LIVE))
  assert.equal('stability' in buildState(raw, options), false)
})
