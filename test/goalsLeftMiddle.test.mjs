// B384: the Goals page's left and middle, as the person's picture has them (art-inbox/goals-b384/before-after.png): a roadmap of the
// big goals, a calmer head (one state badge, one progress bar, three buttons and a "…" menu), the Done when as ticks, status badges on
// the diagram's boxes, a small "Chats on this goal" card, and the details folded. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseBacklog } from '../src/backlog.mjs'
import { goalCounts, parseGoals } from '../src/goals.mjs'
import { GOALS as BASE, BACKLOG } from './fixtures-goals.mjs'
import { openPage } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// goals:start'), script.indexOf('// goals:end'))}
Object.assign(this, { goalRoadmap, goalDoneParts, goalIsTicked, goalBadgeOf, goalDetailsWords })`, made)
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const page = Object.fromEntries(Object.entries(made).map(([name, fn]) => [name, (...args) => plain(fn(...args))]))

const GOALS = BASE.replace('  Done when: a stranger walks the garden without a guide', '  Done when: a stranger walks the garden without a guide; every bench is on a path; and no path ends nowhere.\n  Why: visitors get lost')
const stateGoals = () => {
  const goals = parseGoals(GOALS)
  const counts = goalCounts(goals, parseBacklog(BACKLOG))
  return { roots: goals.roots, problems: goals.problems, nodes: goals.nodes.map(one => ({ ...one, counts: counts.get(one.id) ?? null })) }
}

test('the roadmap lists the top goals and their milestones, with a share and "N of M complete"; the row holding the focus is on', () => {
  const rows = page.goalRoadmap(stateGoals(), null)
  assert.deepEqual(rows.map(row => [row.id, row.depth]), [['G1', 0], ['G2', 1], ['G5', 1], ['G7', 0]])
  const row = id => rows.find(one => one.id === id)
  assert.equal(row('G1').line, '0 of 2 milestones complete')
  assert.equal(row('G7').line, '1 of 2 complete')
  assert.equal(row('G7').share, 50)
  assert.equal(row('G2').line, '3 of 4 complete')
  assert.ok(rows.every(one => one.isOn === false), 'no focus: none on')
  // A goal deep inside lights the deepest roadmap row above it.
  assert.equal(page.goalRoadmap(stateGoals(), 'G4').find(one => one.isOn).id, 'G2')
  assert.equal(page.goalRoadmap(stateGoals(), 'G9').find(one => one.isOn).id, 'G7')
  assert.deepEqual(page.goalRoadmap(null, null), [])
})

test('a Done when sentence is split into its parts, one a line; ticked only when done or its last re-check passed', () => {
  assert.deepEqual(page.goalDoneParts('a stranger walks; every bench is on a path; and no path ends nowhere.'), ['a stranger walks', 'every bench is on a path', 'no path ends nowhere'])
  assert.deepEqual(page.goalDoneParts('one sentence only.'), ['one sentence only'])
  assert.deepEqual(page.goalDoneParts(''), [])
  assert.equal(page.goalIsTicked({ state: 'done' }), true)
  assert.equal(page.goalIsTicked({ state: 'now', rechecks: [{ verdict: 'failed' }, { verdict: 'passed' }] }), true)
  assert.equal(page.goalIsTicked({ state: 'now', rechecks: [{ verdict: 'passed' }, { verdict: 'failed' }] }), false)
  assert.equal(page.goalIsTicked({ state: 'now' }), false)
})

test('a diagram box says Complete, In progress, Plan incomplete (no Done when yet) or Open', () => {
  assert.equal(page.goalBadgeOf({ state: 'done', doneWhen: '' }), 'Complete')
  assert.equal(page.goalBadgeOf({ state: 'now', doneWhen: '' }), 'In progress')
  assert.equal(page.goalBadgeOf({ state: 'open', doneWhen: '' }), 'Plan incomplete')
  assert.equal(page.goalBadgeOf({ state: 'open', doneWhen: 'a thing' }), 'Open')
})

// The steps the panel reads (as test/goalSteps.test.mjs makes them): B05 is in G6, worked on by the chat Digger.
const working = { key: 'B05', id: 'B05', title: 'Paint the benches', worker: 'Digger', status: 'open', flow: { state: 'in progress' }, item: { summary: ['Paint them.'], goal: null } }
const pageState = steps => ({ ...asSent({ ...build([], undefined, GOALS, {}), goalsEdit: { canWrite: true } }), backlog: steps.length === 0 ? [] : [{ steps }] })

test('the page draws the roadmap and the chats; a roadmap click zooms to the goal', async () => {
  const shown = await openPage({ state: pageState([working]), hash: 'advice/goals' })
  try {
    assert.deepEqual(shown.all('#goals-roadmap [data-roadmap-goal]').map(one => one.dataset.roadmapGoal), ['G1', 'G2', 'G5', 'G7'])
    assert.equal(shown.find('#goals-chats').hidden, true, 'at the top there is no goal: no card')
    await shown.click('#goals-roadmap [data-roadmap-goal="G5"]')
    assert.equal(shown.find('#goals-frame').hidden, false)
    assert.equal(shown.all('#goals-roadmap .is-on').length, 1)
    assert.equal(shown.find('#goals-roadmap .is-on').dataset.roadmapGoal, 'G5')
    await shown.click('#goals-roadmap [data-roadmap-goal="G7"]')
    assert.match(shown.text('#goals-chats'), /No chat is working/)
  } finally { await shown.close() }
})

test('the chats card names the chat working on a step of the goal, with a way into its window', async () => {
  const shown = await openPage({ state: pageState([working]), hash: 'advice/goals/G6' })
  try {
    assert.equal(shown.find('#goals-chats').hidden, false)
    assert.match(shown.text('#goals-chats'), /Chats on this goal/)
    assert.match(shown.text('#goals-chats'), /Digger/)
    assert.match(shown.text('#goals-chats'), /B05 Paint the benches/)
    assert.equal(shown.all('#goals-chats [data-goal-chat-window="Digger"], #goals-chats a.goals-chat-open').length, 1)
  } finally { await shown.close() }
})

test('the head: one state badge, one progress bar, the Done when as boxes, three buttons and the rest behind "…"', async () => {
  const shown = await openPage({ state: pageState([]), hash: 'advice/goals/G1' })
  try {
    assert.equal(shown.text('#goals-frame .goals-frame-state'), 'in progress')
    assert.ok(shown.find('#goals-frame .goals-progress [role="progressbar"]'))
    assert.equal(shown.text('#goals-count'), '', 'the count of the head is the bar now')
    assert.deepEqual(shown.all('#goals-frame .goals-ticks li').map(one => one.textContent), ['a stranger walks the garden without a guide', 'every bench is on a path', 'no path ends nowhere'])
    assert.equal(shown.all('#goals-frame .goals-ticks .is-ticked').length, 0)
    // Three buttons in sight; every other tool is inside the menu, which opens on the "…".
    const kinds = selector => shown.all(selector).map(one => one.dataset.goalTool)
    assert.deepEqual(kinds('#goals-frame .goals-tools > [data-goal-tool]').sort(), ['add', 'ask', 'brainstorm'])
    assert.ok(kinds('#goals-frame .goals-tools-menu [data-goal-tool]').includes('Why'))
    assert.ok(kinds('#goals-frame .goals-tools-menu [data-goal-tool]').includes('Enables'))
    assert.equal(shown.find('#goals-frame .goals-tools').classList.contains('is-menu-open'), false)
    await shown.click('#goals-frame [data-goals-head-menu]')
    assert.equal(shown.find('#goals-frame .goals-tools').classList.contains('is-menu-open'), true)
    // A choice in the menu closes it.
    await shown.click('#goals-frame .goals-tools-menu [data-goal-tool="note"]')
    assert.equal(shown.find('#goals-frame .goals-tools').classList.contains('is-menu-open'), false)
  } finally { await shown.close() }
})

test('Why, Note and Enables fold behind one Details line; unfolded, the Done when is not said twice', async () => {
  const shown = await openPage({ state: pageState([]), hash: 'advice/goals/G1' })
  try {
    assert.match(shown.text('#goals-lines'), /^Details: Why/)
    assert.equal(shown.all('#goals-frame .goals-frame-lines').length, 0)
    await shown.click('#goals-lines')
    const lines = shown.all('#goals-frame .goals-frame-lines li').map(one => one.textContent)
    assert.ok(lines.includes('Why: visitors get lost'))
    assert.ok(lines.every(line => !line.startsWith('Done when:')))
  } finally { await shown.close() }
})
