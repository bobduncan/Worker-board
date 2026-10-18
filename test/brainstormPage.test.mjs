// B259: the Advisor tab's Brainstorm part (spec 2026-10-15, section 5): the list of brainstorms, the card with the
// open question, the proposal with its ticks. The view models run here without the page; made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { brainstormsState } from '../src/brainstorm.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const css = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// brainstorm:start'), script.indexOf('// brainstorm:end'))}
Object.assign(this, { brainstormAnswerText, brainstormCardView, brainstormChosen, brainstormListView, proposalView })`, made)
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const page = Object.fromEntries(Object.entries(made).map(([name, made]) => [name, (...args) => plain(made(...args))]))

const HEAD = '# Brainstorm: Lanterns\nGoal: G6 Benches that match the picture\nStarted: 2026-10-15 21:00 · State: running\nOpening: Where do lanterns go?\n\n'
const Q1 = '## Q1 (21:01)\nWhere first?\nWhy: it decides the order.\n- A: by the gate (advised)\n- B: by the pond\n'
const Q2 = '\n## Q2 (21:04)\nHow bright?\nWhy: it decides the sprite.\n- A: dim (advised)\n- B: bright\nPicture: pictures/brainstorm/bright.png\n'
const PROPOSAL = '\n## Proposal (21:20)\nDecided:\n- the gate first\nGoals:\n- [ ] Lanterns by the gate — under G6 — Done when: a visitor finds the gate at night\nSteps:\n- [ ] Make a lantern sprite — Units — about 1 h\n- [ ] Place the lanterns — Main decides — about 30 min\nNote: most visitors come in by the gate.\n'
const one = (text, path = 'b/2026-10-15-lanterns.md') => brainstormsState([{ path, text, at: 1 }], 'b').threads[0]
const idle = { name: 'Oracle', isRunning: true, state: 'free', doingNow: null }

test('the card shows the open question with its options, the advised one marked, and the earlier answers folded', () => {
  const card = page.brainstormCardView(one(`${HEAD}${Q1}Answer (21:02): A — and the bench\n${Q2}`), idle)
  assert.deepEqual(card.question, { n: 2, text: 'How bright?', why: 'it decides the sprite.', picture: 'pictures/brainstorm/bright.png' })
  assert.deepEqual(card.options, [{ key: 'A', text: 'dim', isAdvised: true }, { key: 'B', text: 'bright', isAdvised: false }])
  assert.equal(card.canAnswer, true)
  assert.equal(card.canBack, true)
  assert.equal(card.waiting, null)
  assert.deepEqual(card.earlier, [{ n: 1, text: 'Where first?', answerText: 'A, by the gate: "and the bench"' }])
  // The first question has nothing to go back to.
  assert.equal(page.brainstormCardView(one(`${HEAD}${Q1}`), idle).canBack, false)
})

test('while the Advisor has the turn the card says what it does: thinking, on something else, or not running (Review Focus 4)', () => {
  const answered = one(`${HEAD}${Q1}Answer (21:02): B\n`)
  assert.equal(page.brainstormCardView(answered, idle).waiting, 'The Advisor is thinking…')
  assert.equal(page.brainstormCardView(answered, idle).canAnswer, false)
  assert.equal(page.brainstormCardView(one(HEAD), idle).waiting, 'The Advisor is thinking…')
  assert.equal(page.brainstormCardView(answered, { ...idle, state: 'working', doingNow: 'Morning round' }).waiting, 'The Advisor is on: Morning round')
  // Its own work on the brainstorm is the thinking.
  assert.equal(page.brainstormCardView(answered, { ...idle, state: 'working', doingNow: 'Brainstorm: Q2' }).waiting, 'The Advisor is thinking…')
  assert.equal(page.brainstormCardView(answered, { ...idle, isRunning: false }).waiting, 'The Advisor\'s chat is not running: start it from the Workers lane (the main chat starts it)')
  assert.equal(page.brainstormCardView(answered, null).waiting, 'No Advisor is on the board: a brainstorm waits for one.')
  // Wrapping up: the Advisor writes the proposal.
  assert.equal(page.brainstormCardView(one(`${HEAD}${Q1}`.replace('State: running', 'State: wrapping up')), idle).canAnswer, false)
  // A proposal or the end: no question, nothing to wait for.
  const proposed = page.brainstormCardView(one(`${HEAD}${Q1}Answer (21:02): B\n${PROPOSAL}`), idle)
  assert.deepEqual([proposed.canAnswer, proposed.waiting, proposed.question], [false, null, null])
})

test('the answers read back in words: the option, the person\'s own words, skipped, back', () => {
  const question = { options: [{ key: 'A', text: 'dim', isAdvised: true }], answer: null }
  assert.equal(page.brainstormAnswerText({ ...question, answer: { at: '1', key: 'A', words: '' } }), 'A, dim')
  assert.equal(page.brainstormAnswerText({ ...question, answer: { at: '1', key: 'Other', words: 'very dim' } }), 'your words: "very dim"')
  assert.equal(page.brainstormAnswerText({ ...question, answer: { at: '1', skipped: true } }), 'skipped')
  assert.equal(page.brainstormAnswerText({ ...question, answer: { at: '1', back: 1 } }), 'back to Q1')
  assert.equal(page.brainstormAnswerText(question), 'not answered')
})

test('the proposal shows every goal and step ticked unless the person took the tick away; a created one says what came of it', () => {
  const thread = one(`${HEAD}${Q1}Answer (21:02): B\n${PROPOSAL}`)
  const view = page.proposalView(thread, ['s1'])
  assert.deepEqual(view.decided, ['the gate first'])
  assert.deepEqual(view.goals, [{ index: 0, key: 'g0', title: 'Lanterns by the gate', where: 'under G6', doneWhen: 'a visitor finds the gate at night', ticked: true }])
  assert.deepEqual(view.steps.map(step => [step.key, step.title, step.worker, step.cost, step.ticked]), [['s0', 'Make a lantern sprite', 'Units', 'about 1 h', true], ['s1', 'Place the lanterns', 'Main decides', 'about 30 min', false]])
  assert.equal(view.note, 'most visitors come in by the gate.')
  assert.equal(view.created, null)
  assert.equal(view.canCreate, true)
  assert.equal(page.proposalView(thread, ['g0', 's0', 's1']).canCreate, false)
  const created = one(`${HEAD}${Q1}Answer (21:02): B\n${PROPOSAL}Created (21:25): G10; 1 step asked of the main chat; left out: Place the lanterns\n`.replace('State: running', 'State: done'))
  const done = page.proposalView(created, [])
  assert.equal(done.created, 'Created at 21:25: G10 · 1 step asked of the main chat · left out: Place the lanterns')
  assert.equal(done.canCreate, false)
  assert.deepEqual(done.steps.map(step => step.ticked), [true, false])
  // Review B259: a proposal the Advisor wrote anew after Create, on a thread that is done, creates nothing more.
  assert.equal(page.proposalView(one(`${HEAD}${Q1}Answer (21:02): B\n${PROPOSAL}`.replace('State: running', 'State: done')), []).canCreate, false)
  // A left-out title with the Created line's separator in it reads back as left out.
  const dotted = one(`${HEAD}${Q1}Answer (21:02): B\n${PROPOSAL.replace('Place the lanterns', 'Place · light the lanterns')}Created (21:25): G10; 1 step asked of the main chat; left out: Place - light the lanterns\n`.replace('State: running', 'State: done'))
  assert.deepEqual(page.proposalView(dotted, []).steps.map(step => step.ticked), [true, false])
})

test('the list holds the running brainstorms, then the ones done, each with what it stands at or what came of it', () => {
  const threads = brainstormsState([
    { path: 'b/2026-10-15-lanterns.md', text: `${HEAD}${Q1}`, at: 3 },
    { path: 'b/2026-10-15-night.md', text: `${HEAD.replace('Lanterns', 'Night')}${Q1}Answer (21:02): B\n`, at: 2 },
    { path: 'b/2026-10-14-gate.md', text: `${HEAD.replace('Lanterns', 'Gate').replace('2026-10-15 21:00', '2026-10-14 10:00')}${Q1}Answer (21:02): B\n${PROPOSAL}Created (21:25): G10; 2 steps asked of the main chat; left out: nothing\n`.replace('State: running', 'State: done'), at: 1 },
    { path: 'b/2026-10-13-old.md', text: HEAD.replace('Lanterns', 'Old').replace('State: running', 'State: discarded'), at: 0 },
  ], 'b').threads
  const list = page.brainstormListView(threads)
  assert.deepEqual(list.running.map(row => [row.path, row.title, row.line, row.waits]), [
    ['b/2026-10-15-lanterns.md', 'Lanterns', '2026-10-15 · question 1 waits for you', true],
    ['b/2026-10-15-night.md', 'Night', '2026-10-15 · 1 question · with the Advisor', false],
  ])
  assert.deepEqual(list.done.map(row => [row.title, row.line]), [['Gate', '2026-10-14 · 1 question → G10, 2 steps'], ['Old', '2026-10-15 · discarded']])
  // The card shows the one chosen, else the first running, else the newest.
  assert.equal(page.brainstormChosen(threads, 'b/2026-10-14-gate.md'), 'b/2026-10-14-gate.md')
  assert.equal(page.brainstormChosen(threads, 'b/gone.md'), 'b/2026-10-15-lanterns.md')
  assert.equal(page.brainstormChosen([], null), null)
})

test('the part stands third in the Advisor tab, with the list, the box for a new one and the card', () => {
  assert.deepEqual([...html.matchAll(/data-advisor-pane="([a-z]+)"/g)].map(match => match[1]), ['focus', 'way', 'goals', 'brainstorm', 'plan', 'suggestions', 'refine', 'chat'])
  assert.match(script, /const ADVISOR_PANES = \['focus', 'way', 'goals', 'brainstorm', 'plan', 'suggestions', 'refine', 'chat'\]/)
  for (const id of ['advisor-brainstorm', 'brainstorm-list', 'brainstorm-new', 'brainstorm-new-title', 'brainstorm-new-about', 'brainstorm-new-opening', 'brainstorm-new-start', 'brainstorm-card']) assert.ok(html.includes(`id="${id}"`), id)
  assert.match(css, /#view-advice\[data-pane="brainstorm"\] > \.advisor-brainstorm/)
  // Create asks the main chat for each step the board created, by its place in the proposal.
  assert.match(script, /sayBrainstorm\(\{ to: main, command: 'goal-step', thread: path, step: index \}, path\)/)
  assert.match(script, /'Brainstorm this'/)
})
