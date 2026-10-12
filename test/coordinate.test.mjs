// B84: the Coordinate tab shows the whole backlog by activity, with ways to narrow it down. The server's part is
// tested as it is; the page's own code is run here, cut out of board.js between its two marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { overview, parseBacklog, queue } from '../src/backlog.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const page = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const cut = script.slice(script.indexOf('// coordinate:start'), script.indexOf('// coordinate:end'))
const context = {}
vm.runInNewContext(`${cut}\nthis.coordinateList = coordinateList; this.filters = COORDINATE_FILTERS`, context)
/** The page's list, copied into this context so it can be compared. */
const listOf = (activities, options) => JSON.parse(JSON.stringify(context.coordinateList(activities, options)))
const idsOf = list => list.groups.map(group => [group.name, group.steps.map(step => step.id)])

const NAMES = { prefix: 'Game - ', names: ['Main', 'Units', 'Features'] }
const BACKLOG = [
  '# Backlog',
  '',
  '## Old work',
  '- [x] B01 A finished step (for Units; about 1 h)',
  '- [ ] B02 A step for nobody',
  '',
  '## Architecture #focus',
  '- [ ] B10 The camera (for Features; about 1 h) (branch feature/camera)',
  '- [ ] B11 The upgrade offer (for Features; after B10; about 2 h)',
  '  Requirements:',
  '  - three cards',
  '- [ ] B12 Verify: Say whether the camera is right (pictures in art-inbox/camera; Game - Features) @you',
  '- [ ] B13 Decide: The next unit @you',
  '- [x] B14 Done long ago',
  '',
  '## Next to hand out (Game - Main)',
  '- [ ] B20 A new prop',
  '- [ ] B21 A tool for later (not queued: leave it for now; about 30 min)',
  '',
].join('\n')
const parsed = parseBacklog(BACKLOG, NAMES)

test('overview: every activity with every step, the focus first, each step with where it stands', () => {
  const all = overview(parsed)
  assert.deepEqual(all.map(activity => [activity.name, activity.isFocus]), [['Architecture', true], ['Old work', false], ['Next to hand out (Game - Main)', false]])
  const flat = Object.fromEntries(all.flatMap(activity => activity.steps).map(step => [step.id, step]))
  assert.deepEqual(Object.fromEntries(Object.entries(flat).map(([id, step]) => [id, step.status])), {
    B01: 'done', B02: 'open', B10: 'progress', B11: 'queued', B12: 'you', B13: 'you', B14: 'done', B20: 'queued', B21: 'open',
  })
  assert.deepEqual([flat.B10.worker, flat.B10.branch, flat.B10.title, flat.B10.key], ['Features', 'feature/camera', 'The camera', 'B10'])
  assert.deepEqual([flat.B12.asks, flat.B12.worker, flat.B13.asks, flat.B13.worker], ['verify', 'Features', 'decide', null])
  assert.deepEqual(flat.B11.notes, [{ title: 'Requirements', lines: [], points: ['three cards'] }])
  // The steps it calls queued are the ones the workers' queues hold.
  assert.deepEqual(Object.values(flat).filter(step => step.status === 'queued').map(step => step.id).sort(), queue(parsed).map(step => step.id).sort())
})

test('overview: a step from before the ids has its place as its key', () => {
  const old = overview(parseBacklog('## A\n- [ ] A step without an id\n- [ ] B05 One with\n', NAMES))
  assert.deepEqual(old[0].steps.map(step => [step.key, step.id]), [['0:0', null], ['B05', 'B05']])
})

test('the state holds the backlog for the tab: a step for the person names its card, the others do not', () => {
  const app = name => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: 1, lastAssistantUuid: 'u' })
  const raw = { listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: ['Main', 'Units', 'Features'].map(app), tails: {}, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {} }
  const state = buildState(raw, { lines: [], outbox: [], runs: [], now: 1, config: { ...parseConfig('{}', {}), project: 'C:\\game' } })
  const steps = Object.fromEntries(state.backlog.flatMap(activity => activity.steps).map(step => [step.id, step]))
  assert.deepEqual([steps.B12.needId, steps.B13.needId, steps.B10.needId, steps.B01.needId], ['backlog:B12', 'backlog:B13', null, null])
  assert.ok(state.backlogForYou.some(need => need.id === steps.B12.needId))
  assert.deepEqual(steps.B10.pictures, [])
  assert.equal(state.backlog[0].name, 'Architecture')
})

const activities = JSON.parse(JSON.stringify(overview(parsed)))

test('the page has a third tab named Coordinate, with its filters in order', () => {
  assert.match(page, /<button class="tab" type="button" data-tab="coordinate">Coordinate<\/button>/)
  assert.match(page, /id="view-coordinate" hidden/)
  assert.deepEqual(JSON.parse(JSON.stringify(context.filters)), [['all', 'All'], ['progress', 'In progress'], ['queued', 'Queued'], ['you', 'For you'], ['unassigned', 'Without a worker']])
})

test('all: every open step by activity, the focus first; finished steps stay hidden', () => {
  const list = listOf(activities)
  assert.deepEqual(idsOf(list), [['Architecture', ['B10', 'B11', 'B12', 'B13']], ['Old work', ['B02']], ['Next to hand out (Game - Main)', ['B20', 'B21']]])
  assert.equal(list.shown, 7)
  assert.deepEqual(list.counts, { all: 7, progress: 1, queued: 2, you: 2, unassigned: 3 })
})

test('finished steps show when asked for, under All only', () => {
  assert.deepEqual(idsOf(listOf(activities, { showDone: true })), [['Architecture', ['B10', 'B11', 'B12', 'B13', 'B14']], ['Old work', ['B01', 'B02']], ['Next to hand out (Game - Main)', ['B20', 'B21']]])
  assert.deepEqual(idsOf(listOf(activities, { showDone: true, filter: 'queued' })), [['Architecture', ['B11']], ['Next to hand out (Game - Main)', ['B20']]])
  // The counts are of open steps, whatever is shown.
  assert.equal(listOf(activities, { showDone: true }).counts.all, 7)
})

test('narrowing: in progress, queued, for you, without a worker', () => {
  assert.deepEqual(idsOf(listOf(activities, { filter: 'progress' })), [['Architecture', ['B10']]])
  assert.deepEqual(idsOf(listOf(activities, { filter: 'queued' })), [['Architecture', ['B11']], ['Next to hand out (Game - Main)', ['B20']]])
  assert.deepEqual(idsOf(listOf(activities, { filter: 'you' })), [['Architecture', ['B12', 'B13']]])
  // Without a worker: open steps nobody is named for; the person's own steps are not among them.
  assert.deepEqual(idsOf(listOf(activities, { filter: 'unassigned' })), [['Old work', ['B02']], ['Next to hand out (Game - Main)', ['B20', 'B21']]])
})

test('finding a step: by its id from its start, with or without the B, else by the words of its title', () => {
  const found = find => listOf(activities, { find }).groups.flatMap(group => group.steps.map(step => step.id))
  assert.deepEqual(found('B12'), ['B12'])
  assert.deepEqual(found('b1'), ['B10', 'B11', 'B12', 'B13'])
  assert.deepEqual(found('2'), ['B02', 'B20', 'B21'])
  assert.deepEqual(found(' camera '), ['B10', 'B12'])
  assert.deepEqual(found('B99'), [])
  // The search narrows what the filter leaves, and the counts stay those of the whole backlog.
  const both = listOf(activities, { filter: 'you', find: 'camera' })
  assert.deepEqual([idsOf(both), both.counts.you, both.shown], [[['Architecture', ['B12']]], 2, 1])
  // A finished step is found only when finished steps are shown.
  assert.deepEqual([found('B14'), listOf(activities, { find: 'B14', showDone: true }).shown], [[], 1])
})

test('the tab only shows: its code has no control that changes a queue or a task', () => {
  const tab = script.slice(script.indexOf('// The Coordinate tab'), script.indexOf('// Tabs\n'))
  assert.ok(tab.includes('step-actions'), 'the row keeps a place free for the controls of B83')
  for (const word of ['/api/say', '/api/game', 'fetch(', 'data-send', 'data-stop', 'data-move']) assert.ok(!tab.includes(word), `the tab's code has "${word}"`)
})
