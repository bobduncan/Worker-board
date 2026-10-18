// B343: the person rejected B327's simple view (Q70, 2026-10-18 17:39: "i expected it to be wider ... I want the workers
// and maybe what the current focus is with the tasks. and the needs your attention is good. but i dont want the from
// the backlog, open instructions /all closed section in the simple view"). The simple view now uses the page's full
// width (picture art-inbox/board-highover/simple-wide.png): the focus goal's bar on top, then three columns, the focus
// goal's steps, the workers, and Needs your attention without the backlog, the instructions and what is closed. The
// page's model runs here without the page; made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseGoals } from '../src/goals.mjs'
import { focusState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const css = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\n${cut('calmoverview')}\n${cut('focus')}\n${cut('simpleoverview')}\nObject.assign(this, { simpleView, simpleSteps, simpleWorkers, clock })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const GOALS = [
  'Last id: G2', 'Focus: G2', '',
  '- [~] G2 Fights you can read',
  '    Vibe: you see the damage before you click',
  '    Vibe agreed: 2026-10-18 10:00',
  '    Part: Show the damage · about 1 h · steps B1, B2',
  '    Part: Heavier hits · 2 h · steps B2, B3, B4',
  '    Part: Not made yet · 1 h',
  '    Steps: B5, B6',
  '    How agreed: 2026-10-18 11:00', '',
].join('\n')
const step = (id, state, owner = null) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id} (a note)\nState: ${state}\n${owner === null ? '' : `Owner: ${owner}\n`}Since: 2026-10-18 11:10\n`)

test('the focus lists its steps: those of its parts in order, then its own; done, now or next, and who is on it', () => {
  const focus = focusState(parseGoals(GOALS), [
    step('B1', 'done', 'Game - Worker 1'), step('B2', 'in progress', 'Game - Worker 2'), step('B3', 'queued', 'Game - Worker 3'),
    step('B5', 'new'), step('B6', 'dropped'),
  ], [], 'Game - ')
  // B2, in two parts, once; the goal's own step B5 after the parts'; a step the store does not hold (B4) and a dropped
  // one (B6) are not listed; a done step keeps its worker, as the drawing shows it
  assert.deepEqual(focus.steps, [
    { id: 'B1', title: 'Step B1', state: 'done', owner: 'Worker 1' },
    { id: 'B2', title: 'Step B2', state: 'now', owner: 'Worker 2' },
    { id: 'B3', title: 'Step B3', state: 'next', owner: 'Worker 3' },
    { id: 'B5', title: 'Step B5', state: 'next', owner: null },
  ])
})

const AT = new Date(2026, 9, 18, 18, 0).getTime()
const MIN = 60000
const lane = (name, state, more = {}) => ({ name, state, isMain: false, isLeftover: false, task: null, eta: null, ...more })
const working = (name, stepId, title, step, steps, leftMin) => lane(name, 'working', {
  task: { stepId, title, step, steps, startedAt: AT - 30 * MIN },
  eta: { at: AT + leftMin * MIN, leftMs: leftMin * MIN, isOverdue: false, isOwn: true },
})
const CHATS = [
  { ...lane('Main', 'free'), isMain: true },
  working('Worker 1', 'B329', 'Cliffs you cannot climb', 2, 5, 105),
  working('Worker 2', 'B2', 'Step B2', 1, 4, 110),
  lane('Worker 3', 'free'),
  lane('Worker 4', 'suspended', { suspended: { by: 'limit', until: AT + 40 * MIN, isBack: false } }),
]

test('the focus column: each step with Done, Working or Next, its worker, and the time left of the one at work', () => {
  const focus = { id: 'G2', title: 'Fights you can read', stage: 'run', steps: [
    { id: 'B1', title: 'Step B1', state: 'done', owner: null },
    { id: 'B2', title: 'Step B2', state: 'now', owner: 'Worker 2' },
    { id: 'B3', title: 'Step B3', state: 'next', owner: 'Worker 3' },
  ] }
  assert.deepEqual(plain(page.simpleSteps(focus, CHATS, AT)), {
    goal: 'G2',
    rows: [
      { id: 'B1', title: 'Step B1', chip: 'Done', tone: 'done', who: null },
      { id: 'B2', title: 'Step B2', chip: 'Working', tone: 'now', who: 'Worker 2 · 1 h 50' },
      { id: 'B3', title: 'Step B3', chip: 'Next', tone: 'next', who: 'Worker 3' },
    ],
    empty: null,
  })
  // its worker on another step, or one past its time: the time is that of the step it is on, or how far over
  const elsewhere = [{ ...CHATS[2], task: { ...CHATS[2].task, stepId: 'B9' } }]
  assert.equal(page.simpleSteps(focus, elsewhere, AT).rows[1].who, 'Worker 2')
  const over = [{ ...CHATS[2], eta: { at: AT - 25 * MIN, leftMs: -25 * MIN, isOverdue: true, isOwn: true } }]
  assert.equal(page.simpleSteps(focus, over, AT).rows[1].who, 'Worker 2 · 25 min over')
  // before the run, or without steps on the board, the column says so; without a focus there is no column
  assert.equal(page.simpleSteps({ ...focus, stage: 'how', steps: [] }, CHATS, AT).empty, 'No steps yet: your partner makes them once you agree the how.')
  assert.equal(page.simpleSteps({ ...focus, steps: [] }, CHATS, AT).empty, 'No steps of it on the board.')
  assert.equal(page.simpleSteps({ ...focus, steps: undefined }, CHATS, AT).empty, 'No steps of it on the board.')
  assert.equal(page.simpleSteps(null, CHATS, AT), null)
})

test('the workers column: each chat with its step, a bar of its steps and its time left; a free one says free', () => {
  const view = plain(page.simpleWorkers(CHATS, { working: 2, free: 2, suspended: 1 }, AT))
  assert.equal(view.busy, '2 of 5 busy')
  assert.deepEqual(view.rows, [
    { name: 'Main', code: null, task: null, percent: null, left: 'free', tone: 'free' },
    { name: 'Worker 1', code: 'B329', task: 'Cliffs you cannot climb', percent: 40, left: '1 h 45', tone: 'working' },
    { name: 'Worker 2', code: 'B2', task: 'Step B2', percent: 25, left: '1 h 50', tone: 'working' },
    { name: 'Worker 3', code: null, task: null, percent: null, left: 'free', tone: 'free' },
    // any other state in a few words: paused for the limit, waiting for the person, not running, cut off
    { name: 'Worker 4', code: null, task: null, percent: null, left: `paused until ${page.clock(AT + 40 * MIN)}`, tone: 'suspended' },
  ])
  assert.equal(page.simpleWorkers([lane('Worker 5', 'waiting'), lane('Worker 6', 'off')], {}, AT).rows.map(row => row.left).join(', '), 'waits for you, not running')
  // a leftover chat is not one of the workers
  assert.equal(page.simpleWorkers([...CHATS, { ...lane('Old', 'free'), isLeftover: true }], {}, AT).rows.length, 5)
})

test('the bar names the focus goal by its title too, and counts the steps the column lists', () => {
  const focus = { id: 'G2', title: 'Fights you can read', stage: 'run', progress: { done: 1, total: 3, minutesLeft: 120 } }
  assert.equal(page.simpleView({ focus }, AT).bar.text, 'Focus G2 · Fights you can read · 1 of 3 steps done · about 2 h left')
  // the parts count only while the board lists no steps: two parts done of three, two steps done of five
  const steps = ['done', 'done', 'now', 'next', 'next'].map((state, i) => ({ id: `B${i + 1}`, title: '', state, owner: null }))
  const view = page.simpleView({ focus: { ...focus, progress: { done: 2, total: 3, minutesLeft: 60 }, steps } }, AT)
  assert.equal(view.bar.text, 'Focus G2 · Fights you can read · 2 of 5 steps done · about 1 h left')
  assert.equal(view.bar.percent, 40)
})

test('the page: the two columns beside Needs your attention, full width; the backlog, instructions and closed cards left out', () => {
  assert.match(html, /<section class="panel simple-col" id="simple-focus"/)
  assert.match(html, /<section class="panel simple-col" id="simple-workers"/)
  // the full width: no cap on the view's width in Simple any more
  assert.doesNotMatch(css, /#view-overview\[data-mode="simple"\]:not\(\[hidden\]\) \{[^}]*min\(860px/)
  assert.match(css, /#view-overview\[data-mode="simple"\]:not\(\[hidden\]\) \{[^}]*display: grid/)
  // what leaves Needs in Simple is hidden there, and only there
  const hidden = css.match(/((?:#view-overview\[data-mode="simple"\][^,{]+,\s*)+#view-overview\[data-mode="simple"\][^,{]+)\{ display: none !important; \}/g) ?? []
  for (const left of ['#needs .legacy', '#needs .instructions', '#needs .need.is-closed', '#needs .need.is-answered', '.inbox-top']) {
    assert.ok(hidden.some(rule => rule.includes(`#view-overview[data-mode="simple"] ${left}`)), left)
  }
  assert.match(css, /#view-overview\[data-mode="details"\] \.simple-col \{ display: none; \}/)
  // the restart box shows in Simple, across the page under the head; the inbox is the third column on a phone too
  assert.ok(!hidden.some(rule => rule.includes('#restart')), 'the restart box is not hidden in Simple')
  assert.match(css, /#view-overview\[data-mode="simple"\] #restart \{ order: -1; grid-column: 1 \/ -1; \}/)
  assert.match(css, /#view-overview\[data-mode="simple"\] \.inbox \{ order: 0;/)
  assert.match(css, /@media \(max-width: 600px\) \{\s*#view-overview\[data-mode="simple"\] \.head h1 \{ font-size: 24px; \}/)
  // a narrow window stacks the columns
  assert.match(css, /@media \(max-width: [0-9]+px\) \{\s*#view-overview\[data-mode="simple"\]:not\(\[hidden\]\) \{[^}]*grid-template-columns: 1fr/)
  assert.match(script, /function drawSimpleColumns\(state\)/)
})
