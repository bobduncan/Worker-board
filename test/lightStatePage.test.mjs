// Light state on the page (2026-10-31): the state sends a finished step as a light row. Its window reads the full row from
// GET /api/step (a quiet "Loading…" meanwhile, one plain line when that fails) and draws it as before; the page keeps
// what it read for its session and reads it anew when the step changed. The lists (the Backlog's Finished block,
// Completed by day, the goal parts) draw from the light rows. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseGoals } from '../src/goals.mjs'
import { fullStepOf, lightState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { openPage, reply, TOKEN } from './pageHarness.mjs'
import { MIN, NOW, app, asSent, sinceOf, tail } from './partnerState.mjs'
import { buildState } from './withStore.mjs'

const config = { ...parseConfig('{}', {}), project: 'D:\\work\\orchard' }
const item = lines => parseItem(`${lines.join('\n')}\n`)
const pear = (summary = 'Plant four pear trees along the south wall.') => item([
  'Id: B11', 'Kind: step', 'Title: Plant the pear trees', 'State: done', 'Owner: Studio · Worker 1', 'Activity: Orchard', 'Goal: G4', `Since: ${sinceOf(NOW - 90 * MIN)}`, 'Branch: b11-pears', '',
  '## Context', '  The orchard has no pears yet.', '', '## Summary', summary, '',
  '## What we build', '- four pear trees on the south wall', '',
  '## History', `- ${sinceOf(NOW - 90 * MIN)} server: review → done`, '',
])
const PRUNE = item(['Id: B12', 'Kind: step', 'Title: Prune the apple trees', 'State: refined', 'Activity: Orchard', 'Goal: G4', `Since: ${sinceOf(NOW - 80 * MIN)}`, 'Refined: ready', '', '## Summary', 'Cut them back.', '', '## What we build', '- every apple tree pruned', ''])
const POND = item(['Id: B13', 'Kind: step', 'Title: Dig the old pond', 'State: dropped', 'Activity: Orchard', 'Goal: G5', `Since: ${sinceOf(NOW - 70 * MIN)}`, '', '## What we build', '- a pond', ''])
const FENCE = item([
  'Id: B14', 'Kind: step', 'Title: Mend the fence', 'State: done', 'Owner: Studio · Worker 2', 'Activity: Orchard', 'Goal: G5', `Since: ${sinceOf(NOW - 60 * MIN)}`, '',
  '## Summary', 'Context: The fence leans. Problem: Deer get in. Solution: New posts.', '', '## What we build', '- three new posts', '',
])
const ASK = item([
  'Id: Q20', 'Kind: ask', 'Title: Which wood for the posts?', 'State: open', 'Owner: Studio · Worker 2', `Since: ${sinceOf(NOW - 10 * MIN)}`, `Filed: ${NOW - 10 * MIN}`,
  'Asks: decide', 'Blocking: no', 'Of: B14', 'Options: A oak | B larch', 'Advice: A', '',
])

/** The full state of a made-up board with the Orchard's steps, and the light one its server sends. */
function states({ steps = [pear(), PRUNE, POND, FENCE], more = [] } = {}) {
  const work = storeFromText('## Orchard\n- [x] B11 Plant the pear trees\n- [ ] B12 Prune the apple trees\n- [x] B13 Dig the old pond\n- [x] B14 Mend the fence\n', { now: NOW - 120 * MIN })
  for (const one of [...steps, ...more]) work.items.set(one.head.get('Id'), one)
  const raw = {
    listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Worker 1'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Worker 1': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail([typed(NOW - 20 * MIN, 'hi'), answer(NOW - 12 * MIN, 'ok')]) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
  }
  const full = { ...buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config }), goalsEdit: { canWrite: true } }
  return { full: asSent(full), light: asSent(lightState(full)) }
}
const rowsOf = state => state.backlog.flatMap(activity => activity.steps)
const stepAsks = page => page.requests.filter(one => one.url.startsWith('/api/step'))
/** An answer the test gives when it wants: `answers` holds it back until `give()`. */
function held() {
  let give
  const promise = new Promise(done => { give = done })
  return { promise, give }
}

test('a finished step\'s window reads its full row: its title with "Loading…" first, then the window as before', async () => {
  const { full, light } = states()
  assert.equal(rowsOf(light).find(one => one.id === 'B11').light, true, 'the state sends B11 light')
  const wait = held()
  const page = await openPage({ state: light, hash: 'details=B11', answers: request => (request.url.startsWith('/api/step') ? wait.promise.then(() => reply(fullStepOf(full, 'B11'))) : reply({})) })
  try {
    assert.equal(page.find('#details').open, true)
    assert.match(page.text('#details h2'), /B11\s*Plant the pear trees/)
    assert.equal(page.text('#details .step-loading'), 'Loading…')
    assert.ok(page.find('#details .step-loading').classList.contains('muted'), 'quiet')
    assert.deepEqual(stepAsks(page).map(one => [one.url, one.headers['X-Board-Token']]), [['/api/step?id=B11', TOKEN]])
    wait.give()
    await page.reread()
    assert.equal(page.all('#details .step-loading').length, 0)
    assert.deepEqual(page.all('#details .task-story-row').map(one => one.dataset.story), ['context', 'problem', 'solution'])
    assert.match(page.all('#details .task-story-row')[0].textContent, /The orchard has no pears yet/)
    assert.match(page.text('#details .details-chips'), /Done/)
    assert.equal(stepAsks(page).length, 1, 'read once, though the board was read again')
  } finally {
    await page.close()
  }
})

test('a full row that cannot be read shows one plain line; opening the window again reads it again', async () => {
  const { full, light } = states()
  let refuse = true
  const page = await openPage({ state: light, answers: request => (request.url.startsWith('/api/step') ? (refuse ? reply('No step B11 on the board.', 404) : reply(fullStepOf(full, 'B11'))) : reply({})) })
  try {
    await page.click('[data-tab="coordinate"]')
    await page.change('#coordinate-done', true)
    await page.click('[data-open-step="B11"]')
    assert.deepEqual(page.all('#details .problem').map(one => one.textContent), ['This task could not be read: No step B11 on the board.'])
    assert.equal(page.all('#details .task-story-row').length, 0)
    await page.reread()
    assert.equal(stepAsks(page).length, 1, 'not asked again at every read of the board')
    await page.click('#details [data-close]')
    refuse = false
    await page.click('[data-open-step="B11"]')
    assert.equal(stepAsks(page).length, 2)
    assert.equal(page.all('#details .problem').filter(one => /could not be read/.test(one.textContent)).length, 0)
    assert.equal(page.all('#details .task-story-row').length, 3)
  } finally {
    await page.close()
  }
})

test('the page keeps a full row for its session, and reads it anew when the step changed', async () => {
  const first = states()
  const changed = states({ steps: [pear('Plant five pear trees along the south wall.'), PRUNE, POND, FENCE] })
  let shown = first
  const page = await openPage({ state: () => shown.light, answers: request => (request.url.startsWith('/api/step') ? reply(fullStepOf(shown.full, 'B11')) : reply({})) })
  try {
    await page.click('[data-tab="coordinate"]')
    await page.change('#coordinate-done', true)
    await page.click('[data-open-step="B11"]')
    assert.equal(stepAsks(page).length, 1)
    await page.click('#details [data-close]')
    await page.click('[data-open-step="B11"]')
    assert.equal(stepAsks(page).length, 1, 'opened again: the kept row, no second read')
    assert.equal(page.all('#details .task-story-row').length, 3)
    // The step changes while its window shows it: its light row's rev moves, and the window reads it anew.
    assert.notEqual(rowsOf(changed.light).find(one => one.id === 'B11').rev, rowsOf(first.light).find(one => one.id === 'B11').rev)
    shown = changed
    await page.reread()
    await page.reread()
    assert.equal(stepAsks(page).length, 2)
    assert.match(page.all('#details .task-story-row')[1].textContent, /Plant five pear trees/)
  } finally {
    await page.close()
  }
})

test('the Backlog\'s Finished block and Completed by day draw from light rows; a day\'s row opens the full window', async () => {
  const { full, light } = states()
  const day = { day: '2026-10-19', today: '2026-10-19', first: '2026-10-19', steps: [{ id: 'B11', title: 'Plant the pear trees', at: NOW - 90 * MIN, by: 'Worker 1', goal: 'G4', goalTitle: null }], days: [{ day: '2026-10-19', count: 1 }], recap: null, isWriting: false, copy: '' }
  const page = await openPage({ state: light, answers: request => (request.url.startsWith('/api/step') ? reply(fullStepOf(full, request.url.split('=')[1])) : request.url.startsWith('/api/recap') ? reply(day) : reply({})) })
  try {
    await page.click('[data-tab="coordinate"]')
    await page.change('#coordinate-done', true)
    const finished = page.all('.backlog-block.is-done .block-line')
    const line = id => finished.find(one => one.querySelector('.step-id')?.textContent === id)
    assert.ok(line('B11') && line('B13') && line('B14'), 'the done and dropped steps')
    assert.equal(line('B11').querySelector('.block-goal').textContent, 'G4')
    assert.equal(line('B11').querySelector('.block-who').textContent, 'Studio · Worker 1')
    assert.match(line('B11').querySelector('.block-title').textContent, /Plant the pear trees/)
    assert.equal(stepAsks(page).length, 0, 'the list needs no full row')
    await page.click('#coordinate-mode [data-mode="days"]')
    await page.click('[data-day-step="B11"]')
    assert.deepEqual(stepAsks(page).map(one => one.url), ['/api/step?id=B11'])
    assert.equal(page.all('#details .task-story-row').length, 3)
  } finally {
    await page.close()
  }
})

test('a finished step an open ask names stays whole: the ask\'s card keeps its Context, Problem and Solution', async () => {
  const { light } = states({ more: [ASK] })
  assert.equal(rowsOf(light).find(one => one.id === 'B14').light, undefined)
  const page = await openPage({ state: light })
  try {
    const card = page.all('#needs .need').find(one => one.dataset.id === 'work:Q20')
    assert.ok(card, 'the ask has a card')
    assert.deepEqual([...card.querySelectorAll('.task-story-row')].map(one => one.dataset.story), ['context', 'problem', 'solution'])
    assert.match(card.querySelector('.task-story-row').textContent, /The fence leans/)
    assert.equal(stepAsks(page).length, 0)
  } finally {
    await page.close()
  }
})

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const region = {}
vm.runInNewContext(`${script.slice(script.indexOf('// goalsteps:start'), script.indexOf('// goalsteps:end'))}\nthis.goalStepsView = goalStepsView`, region)

test('a goal part lists its finished steps from light rows: Done with its line; a dropped one is left out', () => {
  const { light, full } = states()
  const goals = parseGoals('- [~] G4 Pears\n- [ ] G5 Fences\n')
  const view = (state, goal) => JSON.parse(JSON.stringify(region.goalStepsView(goals, goal, state.backlog, { filter: 'all', showDone: true })))
  const pears = view(light, 'G4')
  assert.deepEqual(pears.rows.map(one => [one.id, one.badge, one.line]), [
    ['B11', 'Done', 'Plant four pear trees along the south wall.'],
    ['B12', 'Ready', 'Cut them back.'],
  ])
  assert.deepEqual(view(light, 'G5').rows.map(one => one.id), ['B14'], 'B13 was dropped')
  // The same as from the full rows.
  assert.deepEqual(pears, view(full, 'G4'))
  assert.deepEqual(view(light, 'G5'), view(full, 'G5'))
})
