// B383: the right side of the Goals page: the selected goal's steps (All, Open, Done; each numbered with its one line,
// its state and its chat; done steps folded) and its Missing lines, each with Add step (a new step under the goal) and
// Dismiss (the line goes), and "Add all". Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { activityFor, missingToSteps, stepTitleOf } from '../src/goalSteps.mjs'
import { parseGoals } from '../src/goals.mjs'
import { removeGoalMissing } from '../src/goalsWrite.mjs'

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const page = {}
vm.runInNewContext(`${script.slice(script.indexOf('// goalsteps:start'), script.indexOf('// goalsteps:end'))}\nthis.goalStepsView = goalStepsView`, page)
const view = (...args) => JSON.parse(JSON.stringify(page.goalStepsView(...args)))

const MAP = parseGoals([
  '- [~] G1 Make fights feel great',
  '  Done when: every fight is clear and fun to replay',
  '  Steps: B1, B2, B4',
  '  Missing: hit-stop timing — needed for weighty hits',
  '  Missing: check the cues without sound',
  '  Part: The cues · about 2 h · steps B3',
  '- [ ] G2 Lanterns',
  '',
].join('\n'))
const step = (id, title, state, extra = {}) => ({ key: id, id, title, worker: null, status: state === 'done' ? 'done' : 'open', flow: { state }, item: { summary: [`What ${title} does.`], goal: null }, ...extra })
const BACKLOG = [{ name: 'Fights', steps: [
  step('B1', 'Tune the attack timing', 'done', { worker: 'Worker 1' }),
  step('B2', 'Add wind-up cues', 'in progress', { worker: 'Worker 2' }),
  step('B3', 'Test the dodge', 'refined'),
  step('B4', 'Review the hit effects', 'waiting on you', { worker: 'Worker 3' }),
  step('B5', 'Balance the first fight', 'queued', { worker: 'Main', item: { summary: [], what: ['enemy stats and pacing'], goal: 'G1' } }),
  step('B6', 'An old idea', 'dropped', { item: { summary: [], goal: 'G1' } }),
  step('B7', 'Lanterns in the dark', 'new', { item: { summary: [], goal: 'G2' } }),
] }]

test('the panel follows the selected goal: its steps by the goal\'s lines and its own Goal, numbered, done folded', () => {
  const all = view(MAP, 'G1', BACKLOG, { canWrite: true })
  assert.deepEqual(all.goal, { id: 'G1', title: 'Make fights feel great' })
  assert.deepEqual(all.tabs, [{ key: 'steps', label: 'Associated steps', count: 5, isOn: true }, { key: 'missing', label: 'Missing steps', count: 2, isOn: false }])
  assert.deepEqual(all.rows.map(row => [row.n, row.id, row.title, row.line, row.badge, row.tone, row.chat]), [
    [1, 'B2', 'Add wind-up cues', 'What Add wind-up cues does.', 'Working', 'working', 'Worker 2'],
    [2, 'B4', 'Review the hit effects', 'What Review the hit effects does.', 'Needs you', 'you', 'Worker 3'],
    [3, 'B3', 'Test the dodge', 'What Test the dodge does.', 'Ready', 'ready', ''],
    [4, 'B5', 'Balance the first fight', 'enemy stats and pacing', 'Queued', 'queued', 'Main'],
  ])
  assert.equal(all.foldedDone, 'Show 1 completed step')
  assert.deepEqual(all.filters.map(one => [one.key, one.isOn]), [['all', true], ['open', false], ['done', false]])
  const unfolded = view(MAP, 'G1', BACKLOG, { canWrite: true, showDone: true })
  assert.deepEqual(unfolded.rows.map(row => row.id), ['B1', 'B2', 'B4', 'B3', 'B5'])
  assert.equal(unfolded.foldedDone, null)
  assert.deepEqual(view(MAP, 'G1', BACKLOG, { filter: 'done' }).rows.map(row => [row.n, row.id, row.badge]), [[1, 'B1', 'Done']])
  assert.deepEqual(view(MAP, 'G1', BACKLOG, { filter: 'open' }).rows.map(row => row.id), ['B2', 'B4', 'B3', 'B5'])
  // No goal selected: a line that says how to get one.
  assert.deepEqual(view(MAP, null, BACKLOG, {}), { goal: null, empty: 'Pick a goal on the map: its steps and what it still misses show here.' })
})

test('the Missing steps: each line with its words split at a dash, Add step and Dismiss, and Add all; off on a board that only shows', () => {
  const missing = view(MAP, 'G1', BACKLOG, { canWrite: true, tab: 'missing' })
  assert.equal(missing.tab, 'missing')
  assert.deepEqual(missing.missing, [
    { index: 0, text: 'hit-stop timing — needed for weighty hits', title: 'hit-stop timing', sub: 'needed for weighty hits' },
    { index: 1, text: 'check the cues without sound', title: 'check the cues without sound', sub: null },
  ])
  assert.deepEqual(missing.addAll, { label: 'Add all 2 to this goal', isEnabled: true, title: 'Each becomes a new step under G1; your partner refines it' })
  assert.deepEqual([missing.canWrite, view(MAP, 'G1', BACKLOG, { canWrite: false, whyNot: 'This board only shows.' }).addAll.title], [true, 'This board only shows.'])
  assert.equal(view(MAP, 'G2', BACKLOG, { canWrite: true }).addAll, null)
})

test('a Missing line as a step title: its first words, a capital first, nothing the backlog line would read as more', () => {
  assert.equal(stepTitleOf('hit-stop timing — needed for weighty hits'), 'Hit-stop timing')
  assert.equal(stepTitleOf('Verify: the cues read (both sounds)'), 'The cues read')
  assert.equal(stepTitleOf(`a ${'very '.repeat(40)}long line`).length <= 120, true)
})

test('the activity of a new step under a goal: the one most of the goal\'s steps are in, else the first', () => {
  const items = new Map([
    ['B1', { head: new Map([['Kind', 'step'], ['Goal', 'G1'], ['Activity', 'Fights']]) }],
    ['B2', { head: new Map([['Kind', 'step'], ['Goal', 'G1'], ['Activity', 'Fights']]) }],
    ['B3', { head: new Map([['Kind', 'step'], ['Goal', 'G1'], ['Activity', 'Looks']]) }],
  ])
  assert.equal(activityFor('G1', items, [{ name: 'Looks' }, { name: 'Fights' }]), 'Fights')
  assert.equal(activityFor('G9', items, [{ name: 'Looks' }, { name: 'Fights' }]), 'Looks')
})

test('Dismiss takes the Missing line out of the goal; Add step makes the step, links it and takes the line out', async () => {
  const text = ['- [~] G1 Make fights feel great', '  Missing: hit-stop timing — needed for weighty hits', '  Missing: check the cues without sound', '  Steps: B1', ''].join('\n')
  const dismissed = removeGoalMissing(text, 'G1', 'check the cues without sound')
  assert.deepEqual(parseGoals(dismissed.text).byId.get('G1').missing, ['hit-stop timing — needed for weighty hits'])
  assert.equal(removeGoalMissing(text, 'G1', 'not there').why, 'missing')
  let map = text
  const made = []
  const ports = {
    readMap: async () => map,
    makeStep: async body => { made.push(body); return { ok: true, result: { id: `B${10 + made.length}` } } },
    changeMap: async change => { const done = change(map); if (done.ok) map = done.text; return done },
    activity: () => 'Fights',
  }
  const one = await missingToSteps({ id: 'G1', index: 1 }, ports)
  assert.deepEqual(one, { ok: true, result: { id: 'G1', made: ['B11'] } })
  assert.deepEqual(made[0], { action: 'new', title: 'Check the cues without sound', activity: 'Fights', goal: 'G1', text: 'From the goal map: G1 Make fights feel great still misses this: check the cues without sound' })
  let goal = parseGoals(map).byId.get('G1')
  assert.deepEqual([goal.missing, goal.steps], [['hit-stop timing — needed for weighty hits'], ['B1', 'B11']])
  const all = await missingToSteps({ id: 'G1', all: true }, ports)
  assert.deepEqual(all.result.made, ['B12'])
  goal = parseGoals(map).byId.get('G1')
  assert.deepEqual([goal.missing, goal.steps], [[], ['B1', 'B11', 'B12']])
  assert.equal((await missingToSteps({ id: 'G1', index: 0 }, ports)).status, 409)
  assert.equal((await missingToSteps({ id: 'G9', index: 0 }, ports)).status, 404)
})

test('the board routes Add step to the work store as the person and the goal map, and Dismiss through the map\'s own change', async () => {
  const server = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8')
  assert.match(server, /if \(body\?\.command === 'missing-add'\) \{/)
  assert.match(server, /makeStep: step => workAction\(step, 'person'\)/)
  const writer = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'goalsWrite.mjs'), 'utf8')
  assert.match(writer, /case 'missing-dismiss': return text => removeGoalMissing\(text, id, body\.line\)/)
  assert.match(script, /once\('goalsteps', goalStepsData\(state\), \(\) => drawGoalSteps\(state\)\)/)
})
