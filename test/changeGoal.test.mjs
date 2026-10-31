// "Change this goal" (the person, 2026-10-31: "i want it to reevaluate of a good map looks like ... needs to brainstorm a
// little bit to try and understand what im trying to accomplish before revising the goal and then reevaluating the steps
// needed to get there"). A change of a goal is a brainstorm of kind change: the person's words first (kept on the goal),
// the partner's questions until it can say back what they want ("## Understood"), their yes, then a proposal with the
// goal's draft (Objective, Done when bullets, Not in it) and the re-plan (Covered, Steps for a bullet, Drop). Create
// writes the draft under the goal and drops the ticked drops. Parsing, writing, the words to the partner, the state and
// the page (clicked in happy-dom, B415). Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answerUnderstood, brainstormNeeds, brainstormsState, editThread, markCreated, parseThread } from '../src/brainstorm.mjs'
import { parseGoals } from '../src/goals.mjs'
import { CHANGE_RULES, addDoneWhenStep, addYourWords, setGoalChange, withChangeRules } from '../src/goalsWrite.mjs'
import { checkSay, goalStepOf } from '../src/say.mjs'
import { doneBulletsOf, focusState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'

const HERE = fileURLToPath(import.meta.url)
const FOLDER = '.claude/brainstorms'
const PATH = `${FOLDER}/2026-10-19-change-paths-through-the-garden.md`

const HEAD = '# Brainstorm: Change: Paths through the garden\nGoal: G6 Paths through the garden\nKind: change\nStarted: 2026-10-19 09:00 · State: running\nOpening: Steps are missing; I want to rethink what a good path is.\n\n'
const Q1 = '## Q1 (09:01)\nWhat is a path for?\nContext: The goal has one part so far.\nWhy: it decides the bullets.\n- A: getting somewhere (advised)\n- B: a stroll\nAnswer (09:02): A\n\n'
const UNDERSTOOD = '## Understood (09:05)\nA path is good when a visitor reaches every bench\nwithout a map.\n'
const YES = 'Answer (09:06): yes\n\n'
const PROPOSAL = [
  '## Proposal (09:10)',
  'Decided:',
  '- every bench reachable',
  'Objective: A garden a visitor crosses without a map.',
  'Done when:',
  '- 1. Every bench is on a path — Picture: pictures/garden/benches.png',
  '- 2. A visitor finds the gate from any bench',
  '- 3. No path ends nowhere — not even by the pond',
  'Not in it: new benches, lights',
  'Covered:',
  '- 1: B12, B13',
  'Steps:',
  '- [ ] Sign the gate from every bench — Digger — about 1 h — for 2',
  '- [ ] Join the dead ends — Main decides — about 30 min — for 2, 3',
  '- [ ] Sweep the gravel — Digger — about 15 min',
  'Drop:',
  '- [ ] B14 — the old maze is no longer needed',
  '- [ ] B15 — the hedge maze went with it',
  'Note: the visitor first.',
  '',
].join('\n')
const GOALS = [
  '# Goals',
  'Last id: G6',
  'Focus: G6',
  '',
  'Rules: a goal is one line "- [ ] G<n> <title>";',
  'two spaces of indentation per level is "part of".',
  '',
  '- [~] G6 Paths through the garden',
  '  Done when: a visitor walks every path without getting lost',
  '  Vibe: calm',
  '  Vibe agreed: 2026-10-18 10:00',
  '  Part: Lay the paths · about 1 h · steps B12',
  '  How agreed: 2026-10-18 11:00',
  '  - [ ] G7 The pond',
  '',
].join('\n')

// ---------------------------------------------------------------------------------------------------------------------
// Parsing

test('a change thread reads its kind, what the partner understood with the yes, and the proposal\'s new sections', () => {
  const thread = parseThread(`${HEAD}${Q1}${UNDERSTOOD}${YES}${PROPOSAL}`)
  assert.equal(thread.kind, 'change')
  assert.deepEqual(thread.understood, { at: '09:05', text: 'A path is good when a visitor reaches every bench without a map.', answer: { at: '09:06', yes: true }, after: 1 })
  const proposal = thread.proposal
  assert.equal(proposal.objective, 'A garden a visitor crosses without a map.')
  assert.deepEqual(proposal.doneWhen, [
    { n: 1, text: 'Every bench is on a path', picture: 'pictures/garden/benches.png' },
    { n: 2, text: 'A visitor finds the gate from any bench', picture: null },
    { n: 3, text: 'No path ends nowhere — not even by the pond', picture: null },
  ])
  assert.equal(proposal.notInIt, 'new benches, lights')
  assert.deepEqual(proposal.covered, [{ n: 1, steps: ['B12', 'B13'] }])
  assert.deepEqual(proposal.steps, [
    { title: 'Sign the gate from every bench', worker: 'Digger', cost: 'about 1 h', for: [2] },
    { title: 'Join the dead ends', worker: 'Main decides', cost: 'about 30 min', for: [2, 3] },
    { title: 'Sweep the gravel', worker: 'Digger', cost: 'about 15 min' },
  ])
  assert.deepEqual(proposal.drops, [{ id: 'B14', why: 'the old maze is no longer needed' }, { id: 'B15', why: 'the hedge maze went with it' }])
  assert.deepEqual(proposal.decided, ['every bench reachable'])
  assert.equal(proposal.note, 'the visitor first.')
  assert.deepEqual(thread.problems, [])
  // A brainstorm as before has no kind and none of it.
  const plain = parseThread(HEAD.replace('Kind: change\n', '') + Q1)
  assert.deepEqual([plain.kind, plain.understood], [null, null])
})

test('"not quite" reads back with the person\'s words; a question after it is the open one; a new Understood counts', () => {
  const notQuite = `${HEAD}${Q1}${UNDERSTOOD}Answer (09:06): not quite — benches and the gate\n\n`
  assert.deepEqual(parseThread(notQuite).understood.answer, { at: '09:06', yes: false, words: 'benches and the gate' })
  const asked = parseThread(`${notQuite}## Q2 (09:07)\nThe gate too?\n- A: yes (advised)\n`)
  assert.equal(asked.understood.after, 1)
  assert.equal(asked.questions.length, 2)
  const said = brainstormsState([{ path: PATH, text: `${notQuite}## Q2 (09:07)\nThe gate too?\n- A: yes (advised)\n`, at: 1 }], FOLDER).threads[0]
  assert.equal(said.understood.isOpen, false)
  const again = parseThread(`${notQuite}## Understood (09:08)\nEvery bench and the gate, without a map.\n`)
  assert.deepEqual([again.understood.at, again.understood.text, again.understood.answer], ['09:08', 'Every bench and the gate, without a map.', null])
})

test('answerUnderstood writes yes or not quite under the open Understood, once; Created keeps the drops, round trip', () => {
  const open = `${HEAD}${Q1}${UNDERSTOOD}`
  const yes = answerUnderstood(open, { at: '09:06', yes: true })
  assert.equal(yes.text, `${open}Answer (09:06): yes\n\n`)
  assert.deepEqual(parseThread(yes.text).understood.answer, { at: '09:06', yes: true })
  assert.equal(answerUnderstood(yes.text, { at: '09:07', yes: true }).why, 'answered')
  const words = answerUnderstood(open, { at: '09:06', words: '  the gate\n too ' })
  assert.deepEqual(parseThread(words.text).understood.answer, { at: '09:06', yes: false, words: 'the gate too' })
  assert.equal(answerUnderstood(open, { at: '09:06', words: ' ' }).why, 'form')
  assert.equal(answerUnderstood(`${HEAD}${Q1}`, { at: '09:06', yes: true }).why, 'none')
  // A question asked after it: the Understood is not the open one.
  assert.equal(answerUnderstood(`${open}## Q2 (09:07)\nThe gate too?\n`, { at: '09:08', yes: true }).why, 'none')
  const created = markCreated(`${open}${YES}${PROPOSAL}`, { at: '09:20', asked: 1, leftOut: ['Sweep the gravel'], dropped: ['B14'] })
  // 2026-10-31: "dropped:" stands before "left out:" (the last part holds the titles, which may hold "; " themselves).
  assert.match(created.text, /\nCreated \(09:20\): no goals; 1 step asked of the main chat; dropped: B14; left out: Sweep the gravel\n$/)
  assert.deepEqual(parseThread(created.text).proposal.created, { at: '09:20', goals: [], steps: [], asked: 1, leftOut: ['Sweep the gravel'], dropped: ['B14'] })
  // No drops: the line as before.
  assert.deepEqual(parseThread(markCreated(`${open}${YES}${PROPOSAL}`, { at: '09:20' }).text).proposal.created, { at: '09:20', goals: [], steps: [], asked: 0, leftOut: [] })
})

test('goals.md: Objective, Done when <n> with its steps, Not in it and Your words are read, written and kept, round trip', () => {
  const lines = [
    '- [ ] G6 Paths',
    '  Done when: the old line',
    '  Objective: A garden crossed without a map.',
    '  Done when 1: Every bench is on a path · steps B12, B13',
    '  Done when 2: A visitor finds the gate · from any bench',
    '  Not in it: lights',
    '  Your words: 2026-10-19 09:00 · Steps are missing · and the gate.',
    '',
  ].join('\n')
  const node = parseGoals(lines).byId.get('G6')
  assert.equal(node.doneWhen, 'the old line')
  assert.equal(node.objective, 'A garden crossed without a map.')
  assert.deepEqual(node.doneBullets, [{ n: 1, text: 'Every bench is on a path', steps: ['B12', 'B13'] }, { n: 2, text: 'A visitor finds the gate · from any bench', steps: [] }])
  assert.equal(node.notInIt, 'lights')
  assert.deepEqual(node.yourWords, [{ at: '2026-10-19 09:00', text: 'Steps are missing · and the gate.' }])
  assert.deepEqual(node.notes, [])
  // Written from what was read: the same text.
  const again = setGoalChange(lines, 'G6', { objective: node.objective, bullets: node.doneBullets, notInIt: node.notInIt })
  assert.equal(again.text, lines)
  // A new draft takes the old one's place; the old one-line Done when and every other line stay.
  const changed = setGoalChange(lines, 'G6', { objective: 'New aim', bullets: [{ n: 1, text: 'One', steps: ['B20'] }], notInIt: '' }).text
  assert.equal(changed, ['- [ ] G6 Paths', '  Done when: the old line', '  Objective: New aim', '  Done when 1: One · steps B20', '  Your words: 2026-10-19 09:00 · Steps are missing · and the gate.', ''].join('\n'))
  assert.equal(setGoalChange(lines, 'G6', { objective: ' ', bullets: [{ n: 1, text: 'x' }] }).why, 'form')
  // A step made for a bullet joins its steps, once; a bullet that is not there changes nothing.
  const joined = addDoneWhenStep(lines, 'G6', 2, 'B30').text
  assert.deepEqual(parseGoals(joined).byId.get('G6').doneBullets[1], { n: 2, text: 'A visitor finds the gate · from any bench', steps: ['B30'] })
  assert.equal(addDoneWhenStep(joined, 'G6', 2, 'B30').text, joined)
  assert.equal(addDoneWhenStep(lines, 'G6', 9, 'B30').text, lines)
  const kept = addYourWords(lines, 'G6', '2026-10-19 10:00', 'the pond\ntoo')
  assert.deepEqual(parseGoals(kept.text).byId.get('G6').yourWords.at(-1), { at: '2026-10-19 10:00', text: 'the pond too' })
})

test('the map\'s rules name the change\'s lines once; a map without rules is left as it is', () => {
  const named = withChangeRules(GOALS)
  assert.equal(named.split('\n')[6], CHANGE_RULES)
  assert.equal(withChangeRules(named), named)
  for (const name of ['"Objective:', '"Done when <n>:', '"Not in it:', '"Your words:']) assert.ok(CHANGE_RULES.includes(name), name)
  const bare = '# Goals\n\n- [ ] G1 One\n'
  assert.equal(withChangeRules(bare), bare)
  // The rules line is no goal's line: the map reads the same goals.
  assert.deepEqual(parseGoals(named).nodes.map(one => one.id), ['G6', 'G7'])
  assert.deepEqual(parseGoals(named).problems, [])
})

// ---------------------------------------------------------------------------------------------------------------------
// Writing: the handler on a fake file system

function fakeFs(files) {
  return {
    files,
    readFile: async path => {
      if (!(path in files)) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return Buffer.from(files[path], 'latin1')
    },
    writeFile: async (path, bytes, options) => {
      if (options?.flag === 'wx' && path in files) throw Object.assign(new Error('there'), { code: 'EEXIST' })
      files[path] = Buffer.from(bytes).toString('latin1')
    },
    rename: async (from, to) => {
      files[to] = files[from]
      delete files[from]
    },
    rm: async path => { delete files[path] },
    mkdir: async () => {},
    access: async path => { if (!(path in files)) throw new Error('gone') },
    readdir: async dir => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1)),
  }
}
const latin = text => Buffer.from(text, 'utf8').toString('latin1')
const utf8 = text => Buffer.from(text, 'latin1').toString('utf8')
const DIR = 'D:/work/garden/.claude/brainstorms'
const MAP = 'D:/work/garden/.claude/goals.md'
const at = new Date(2026, 9, 19, 9, 30).getTime()
const options = (fs, extra = {}) => ({ canWrite: true, dir: DIR, folder: FOLDER, goalsFile: MAP, historyDir: 'D:/work/garden/.claude/goals-history', now: at, fs, ...extra })
const fileOf = path => `${DIR}/${path.split('/').pop()}`
const mapOf = fs => parseGoals(utf8(fs.files[MAP]))

test('start of a change: the thread has Kind: change, the words are kept under the goal, one change at a time beside the talk', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  // The goal's own talk runs: a change runs beside it, and leaves its Brainstorm line alone.
  const talk = await editThread({ command: 'start', title: 'Paths through the garden', goal: 'G6', opening: 'I pick this goal as my focus.' }, options(fs))
  const started = await editThread({ command: 'start', kind: 'change', title: 'Change: Paths through the garden', goal: 'G6', opening: 'Steps are missing; rethink a good path.' }, options(fs))
  assert.equal(started.ok, true)
  assert.equal(utf8(fs.files[fileOf(started.result.path)]), '# Brainstorm: Change: Paths through the garden\nGoal: G6 Paths through the garden\nKind: change\nStarted: 2026-10-19 09:30 · State: running\nOpening: Steps are missing; rethink a good path.\n\n')
  const node = mapOf(fs).byId.get('G6')
  assert.deepEqual(node.yourWords, [{ at: '2026-10-19 09:30', text: 'Steps are missing; rethink a good path.' }])
  assert.deepEqual(node.brainstorm, { path: talk.result.path, state: 'running' })
  assert.ok(utf8(fs.files[MAP]).includes(CHANGE_RULES))
  // Nothing else about the goal changed: no Objective, no bullets.
  assert.deepEqual([node.objective, node.doneBullets, node.doneWhen], [null, [], 'a visitor walks every path without getting lost'])
  const second = await editThread({ command: 'start', kind: 'change', title: 'Change again', goal: 'G6', opening: 'x' }, options(fs))
  assert.deepEqual([second.ok, second.status, second.why], [false, 409, 'A change of this goal runs already: answer it there.'])
  // A change is always of a goal, and of a kind the board knows.
  assert.equal((await editThread({ command: 'start', kind: 'change', title: 'x', goal: null, opening: 'x' }, options(fs))).status, 400)
  assert.equal((await editThread({ command: 'start', kind: 'grow', title: 'x', goal: 'G7', opening: 'x' }, options(fs))).status, 400)
})

test('nothing about the goal changes before the yes; create writes the draft, keeps the old Done when and drops the ticked drops', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  const { result: { path } } = await editThread({ command: 'start', kind: 'change', title: 'Change: Paths through the garden', goal: 'G6', opening: 'Steps are missing.' }, options(fs))
  fs.files[fileOf(path)] += latin(`${Q1}${UNDERSTOOD}`)
  const before = fs.files[MAP]
  // "Not quite": written, and no create before a yes.
  assert.equal((await editThread({ command: 'understood', path, words: 'the gate too' }, options(fs))).ok, true)
  assert.ok(utf8(fs.files[fileOf(path)]).includes('without a map.\nAnswer (09:30): not quite — the gate too\n'))
  fs.files[fileOf(path)] += latin(`## Understood (09:31)\nEvery bench and the gate, without a map.\n`)
  fs.files[fileOf(path)] += latin(PROPOSAL)
  const drops = []
  const drop = async (id, why) => (drops.push([id, why]), id === 'B15' ? { ok: false, why: 'B15 is in progress.' } : { ok: true, result: { id } })
  const early = await editThread({ command: 'create', path, steps: [0], drops: [0], seen: utf8(fs.files[fileOf(path)]).length }, options(fs, { drop }))
  assert.deepEqual([early.ok, early.status, early.why], [false, 409, 'Say yes to what your partner understood first: nothing about the goal changes before that.'])
  assert.equal(fs.files[MAP], before)
  assert.deepEqual(drops, [])
  // The proposal stands under the new Understood: write the yes in front of it, as the board does before the proposal.
  fs.files[fileOf(path)] = fs.files[fileOf(path)].replace(latin('without a map.\n## Proposal'), latin('without a map.\nAnswer (09:32): yes\n\n## Proposal'))
  const seen = utf8(fs.files[fileOf(path)]).length
  const made = await editThread({ command: 'create', path, steps: [0, 1], drops: [0, 1], seen }, options(fs, { drop }))
  assert.equal(made.ok, true)
  assert.deepEqual(made.result, {
    goals: [],
    steps: [{ title: 'Sign the gate from every bench', worker: 'Digger', cost: 'about 1 h', goal: 'G6', for: [2] }, { title: 'Join the dead ends', worker: 'Main decides', cost: 'about 30 min', goal: 'G6', for: [2, 3] }],
    dropped: ['B14'],
    notDropped: [{ id: 'B15', why: 'B15 is in progress.' }],
    // 2026-10-31: a change also says which running talks of the goal it closed (none here: only its own thread stands).
    replaced: [],
  })
  assert.deepEqual(drops, [['B14', 'the old maze is no longer needed'], ['B15', 'the hedge maze went with it']])
  const node = mapOf(fs).byId.get('G6')
  assert.equal(node.doneWhen, 'a visitor walks every path without getting lost')
  assert.equal(node.objective, 'A garden a visitor crosses without a map.')
  assert.deepEqual(node.doneBullets, [
    { n: 1, text: 'Every bench is on a path', steps: ['B12', 'B13'] },
    { n: 2, text: 'A visitor finds the gate from any bench', steps: [] },
    { n: 3, text: 'No path ends nowhere — not even by the pond', steps: [] },
  ])
  assert.equal(node.notInIt, 'new benches, lights')
  assert.ok(node.notes.includes('Note (brainstorm 2026-10-19): the visitor first.'))
  // The goal's own lines stay: its vibe, its how; the child goal too.
  assert.deepEqual([node.vibe, node.parts.map(one => one.title), node.children], [['calm'], ['Lay the paths'], ['G7']])
  const thread = parseThread(utf8(fs.files[fileOf(path)]))
  assert.equal(thread.state, 'done')
  assert.deepEqual(thread.proposal.created, { at: '09:30', goals: [], steps: [], asked: 2, leftOut: ['Sweep the gravel'], dropped: ['B14'] })
  // Twice is refused.
  assert.equal((await editThread({ command: 'create', path, steps: [], drops: [], seen: utf8(fs.files[fileOf(path)]).length }, options(fs, { drop }))).status, 409)
})

test('a drop the proposal does not hold is refused, and nothing is written', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  const { result: { path } } = await editThread({ command: 'start', kind: 'change', title: 'Change: Paths', goal: 'G6', opening: 'x' }, options(fs))
  fs.files[fileOf(path)] += latin(`${Q1}${UNDERSTOOD}${YES}${PROPOSAL}`)
  const before = fs.files[MAP]
  const refused = await editThread({ command: 'create', path, steps: [], drops: [5], seen: utf8(fs.files[fileOf(path)]).length }, options(fs, { drop: async () => ({ ok: true }) }))
  assert.equal(refused.status, 409)
  assert.equal(fs.files[MAP], before)
})

// ---------------------------------------------------------------------------------------------------------------------
// The words to the partner, and the state

const sayState = (text, extra = {}) => ({
  advisor: { name: 'Studio · Partner' }, restart: { main: 'Studio · Lead' }, chats: [],
  brainstorms: brainstormsState([{ path: PATH, text, at: 1 }], FOLDER), ...extra,
})

test('the words: brainstorm with Kind: change, brainstorm understood after the yes, the not quite as an answer', () => {
  const to = 'Studio · Partner'
  assert.equal(checkSay({ to, command: 'brainstorm', thread: PATH }, sayState(HEAD), 2000).message.text,
    `brainstorm\nThread: ${PATH}\nGoal: G6 Paths through the garden\nKind: change\nOpening: Steps are missing; I want to rethink what a good path is.`)
  assert.equal(checkSay({ to, command: 'brainstorm-understood', thread: PATH }, sayState(`${HEAD}${Q1}${UNDERSTOOD}${YES}`), 2000).message.text, `brainstorm understood\nThread: ${PATH}`)
  const notQuite = sayState(`${HEAD}${Q1}${UNDERSTOOD}Answer (09:06): not quite — the gate too\n`)
  assert.equal(checkSay({ to, command: 'brainstorm-not-quite', thread: PATH }, notQuite, 2000).message.text, `brainstorm answer\nThread: ${PATH}\nUnderstood: not quite — the gate too`)
  // Each only where the thread stands so: no yes written, a not quite for a yes, a plain brainstorm.
  assert.equal(checkSay({ to, command: 'brainstorm-understood', thread: PATH }, sayState(`${HEAD}${Q1}${UNDERSTOOD}`), 2000).status, 409)
  assert.equal(checkSay({ to, command: 'brainstorm-understood', thread: PATH }, notQuite, 2000).status, 409)
  assert.equal(checkSay({ to, command: 'brainstorm-not-quite', thread: PATH }, sayState(`${HEAD}${Q1}${UNDERSTOOD}${YES}`), 2000).status, 409)
  assert.equal(checkSay({ to, command: 'brainstorm-understood', thread: PATH }, sayState(`${HEAD.replace('Kind: change\n', '')}${Q1}${UNDERSTOOD}${YES}`), 2000).status, 409)
  // A step of a created change names the bullets it is for.
  const created = sayState(`${HEAD}${Q1}${UNDERSTOOD}${YES}${PROPOSAL}Created (09:20): no goals; 2 steps asked of the main chat; left out: Sweep the gravel\n`)
  assert.deepEqual(goalStepOf({ thread: PATH, step: 1 }, created).for, [2, 3])
  assert.equal(goalStepOf({ thread: PATH, step: 2 }, created).ok, false)
  // What waits for the person: what the partner understood.
  const needs = brainstormNeeds(sayState(`${HEAD}${Q1}${UNDERSTOOD}`).brainstorms.threads)
  assert.deepEqual(needs.map(one => one.what), ['understood'])
})

const stepItem = (id, state) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nSince: ${sinceOf(NOW - 30 * MIN)}\n`)

test('the focus\'s bullets are met when their steps are all done; a goal without an Objective gets nothing new; a change is never the talk', () => {
  const steps = new Map([['B12', stepItem('B12', 'done')], ['B13', stepItem('B13', 'closed')], ['B14', stepItem('B14', 'in progress')], ['B16', stepItem('B16', 'dropped')]])
  const node = { doneBullets: [{ n: 1, text: 'a', steps: ['B12', 'B13'] }, { n: 2, text: 'b', steps: ['B12', 'B14'] }, { n: 3, text: 'c', steps: [] }, { n: 4, text: 'd', steps: ['B12', 'B16'] }, { n: 5, text: 'e', steps: ['B99'] }, { n: 6, text: 'f', steps: ['B16'] }] }
  assert.deepEqual(doneBulletsOf(node, steps).map(one => one.met), [true, false, false, true, false, false])
  const map = text => parseGoals(text)
  const changed = GOALS.replace('  Vibe: calm', '  Objective: Crossed without a map.\n  Done when 1: Every bench on a path · steps B12\n  Done when 2: The gate found · steps B14\n  Not in it: lights\n  Vibe: calm')
  const threads = brainstormsState([{ path: PATH, text: `${HEAD}${Q1}`, at: 2 }, { path: `${FOLDER}/2026-10-18-talk.md`, text: HEAD.replace('Kind: change\n', ''), at: 1 }], FOLDER).threads
  const focus = focusState(map(changed), [...steps.values()], threads, '')
  assert.equal(focus.objective, 'Crossed without a map.')
  assert.deepEqual(focus.doneBullets, [{ n: 1, text: 'Every bench on a path', steps: ['B12'], met: true }, { n: 2, text: 'The gate found', steps: ['B14'], met: false }])
  assert.equal(focus.notInIt, 'lights')
  assert.equal(focus.thread, `${FOLDER}/2026-10-18-talk.md`)
  const plain = focusState(map(GOALS), [...steps.values()], threads, '')
  assert.deepEqual(['objective', 'doneBullets', 'notInIt'].filter(key => key in plain), [])
})

// ---------------------------------------------------------------------------------------------------------------------
// The page, clicked

const RUN_GOALS = GOALS
const OBJECTIVE_GOALS = GOALS.replace('  Vibe: calm', '  Objective: A garden a visitor crosses without a map.\n  Done when 1: Every bench is on a path · steps B13\n  Done when 2: A visitor finds the gate · steps B12\n  Done when 3: No path ends nowhere\n  Not in it: lights\n  Vibe: calm')
const done = id => parseItem(`Id: ${id}\nKind: step\nTitle: Rake the gravel\nState: done\nSince: ${sinceOf(NOW - 60 * MIN)}\n`)
const pageState = (goals, threads = [], items = []) => asSent({ ...build(items, undefined, goals, { threadTexts: threads }), goalsEdit: { canWrite: true } })

test('the Focus page has "Change this goal" beside "Change focus"; its box starts a change and tells the partner', async () => {
  const answers = request => (request.url === '/api/brainstorm' ? reply({ path: PATH }) : reply({}))
  const page = await openPage({ state: pageState(RUN_GOALS), answers })
  try {
    await page.click('[data-tab="advice"]')
    const head = page.all('.focus-title .focus-change').map(one => one.textContent)
    assert.deepEqual(head, ['Change this goal', 'Change focus'])
    await page.click('.focus-title [data-focus-act="change-goal"]')
    assert.equal(page.find('#change-goal').open, true)
    assert.equal(page.text('#change-goal-title'), 'Change G6 · Paths through the garden')
    // Nothing written: nothing sent.
    await page.click('#change-goal-start')
    assert.deepEqual(page.sent('/api/brainstorm'), [])
    assert.equal(page.text('#change-goal-status'), 'Say what should change, in your words.')
    page.find('#change-goal-words').value = 'Steps are missing; rethink a good path.'
    await page.click('#change-goal-start')
    assert.deepEqual(page.sent('/api/brainstorm').map(one => one.body), [{ command: 'start', kind: 'change', goal: 'G6', title: 'Change: Paths through the garden', opening: 'Steps are missing; rethink a good path.' }])
    assert.deepEqual(page.sent('/api/say').map(one => [one.body.command, one.body.thread]), [['brainstorm', PATH]])
    // The goal map is not changed by the page.
    assert.deepEqual(page.sent('/api/goals'), [])
  } finally {
    await page.close()
  }
})

test('the Goals part has "Change this goal" beside "Brainstorm this", only with a partner', async () => {
  const page = await openPage({ state: pageState(RUN_GOALS), hash: 'advice/goals/G6' })
  try {
    const tools = page.all('#goals-frame .goals-tools button').map(one => one.textContent)
    assert.equal(tools[tools.indexOf('Brainstorm this') + 1], 'Change this goal')
    await page.click('#goals-frame [data-goal-tool="change"]')
    assert.equal(page.find('#change-goal').open, true)
  } finally {
    await page.close()
  }
  const alone = { ...pageState(RUN_GOALS), advisor: null }
  const none = await openPage({ state: alone, hash: 'advice/goals/G6' })
  try {
    assert.equal(none.all('#goals-frame [data-goal-tool="change"]').length, 0)
    await none.click('[data-advisor-pane="focus"]')
    assert.equal(none.all('[data-focus-act="change-goal"]').length, 0)
  } finally {
    await none.close()
  }
})

test('the Understood card: "Yes, that\'s it" writes the yes and types brainstorm understood; "Not quite…" sends the words', async () => {
  const answers = request => reply(request.url === '/api/brainstorm' ? {} : {})
  const page = await openPage({ state: pageState(RUN_GOALS, [{ path: PATH, text: `${HEAD}${Q1}${UNDERSTOOD}`, at: 1 }]), answers })
  try {
    await page.click('[data-tab="advice"]')
    await page.click('[data-advisor-pane="brainstorm"]')
    assert.equal(page.text('.brainstorm-understood h4'), 'What I understand you want')
    assert.equal(page.text('.brainstorm-understood-text'), 'A path is good when a visitor reaches every bench without a map.')
    assert.equal(page.all('.brainstorm-waiting').length, 0, 'it waits for you, not for the partner')
    await page.click('[data-brainstorm-act="not-quite"]')
    await page.type('#brainstorm-not-quite-text', 'the gate too')
    await page.click('[data-brainstorm-act="send-not-quite"]')
    assert.deepEqual(page.sent('/api/brainstorm').map(one => one.body), [{ command: 'understood', path: PATH, words: 'the gate too' }])
    assert.deepEqual(page.sent('/api/say').map(one => one.body.command), ['brainstorm-not-quite'])
    await page.click('[data-brainstorm-act="understood-yes"]')
    assert.deepEqual(page.sent('/api/brainstorm').at(-1).body, { command: 'understood', path: PATH, yes: true })
    assert.deepEqual(page.sent('/api/say').map(one => [one.body.command, one.body.thread]), [['brainstorm-not-quite', PATH], ['brainstorm-understood', PATH]])
    // Nothing about the goal changed from the page.
    assert.deepEqual(page.sent('/api/goals'), [])
  } finally {
    await page.close()
  }
})

test('the proposal of a change: the goal\'s draft first, then after Agree the re-plan per bullet; "Do what\'s ticked" sends the ticks', async () => {
  const thread = `${HEAD}${Q1}${UNDERSTOOD}${YES}${PROPOSAL}`
  const answers = request => (request.url === '/api/brainstorm' ? reply({ goals: [], steps: [], dropped: ['B15'], notDropped: [] }) : reply({}))
  const page = await openPage({ state: pageState(RUN_GOALS, [{ path: PATH, text: thread, at: 1 }], [done('B13')]), answers })
  try {
    await page.click('[data-tab="advice"]')
    await page.click('[data-advisor-pane="brainstorm"]')
    assert.equal(page.text('.brainstorm-draft-title'), 'G6 · Paths through the garden')
    assert.equal(page.text('.brainstorm-objective'), 'A garden a visitor crosses without a map.')
    assert.deepEqual(page.all('.brainstorm-done-when li').map(one => one.firstChild.textContent), ['Every bench is on a path', 'A visitor finds the gate from any bench', 'No path ends nowhere — not even by the pond'])
    assert.equal(page.text('.brainstorm-not-in-it'), 'new benches, lights')
    assert.equal(page.all('[data-brainstorm-act="create"]').length, 0, 'no create before Agree')
    await page.click('[data-brainstorm-act="agree"]')
    assert.deepEqual(page.all('.brainstorm-bullet-title').map(one => one.textContent), ['1. Every bench is on a path', '2. A visitor finds the gate from any bench', '3. No path ends nowhere — not even by the pond', 'Other new tasks', 'No longer needed'])
    const covered = page.all('.brainstorm-covered').map(one => one.textContent)
    assert.deepEqual(covered, ['✓Covered: B12 Plant the hedge', '✓Covered: B13'])
    // New tasks come ticked, drops unticked.
    const ticks = page.all('[data-tick]').map(one => [one.dataset.tick, one.checked])
    assert.deepEqual(ticks, [['s0', true], ['s1', true], ['s1', true], ['s2', true]])
    assert.deepEqual(page.all('[data-drop-tick]').map(one => [one.dataset.dropTick, one.checked]), [['d0', false], ['d1', false]])
    await page.change('[data-tick="s2"]', false)
    await page.change('[data-drop-tick="d1"]', true)
    await page.click('[data-brainstorm-act="create"]')
    const sent = page.sent('/api/brainstorm').map(one => one.body)
    assert.equal(sent.length, 1)
    assert.deepEqual({ ...sent[0], seen: undefined }, { command: 'create', path: PATH, goals: [], steps: [0, 1], drops: [1], seen: undefined })
    assert.deepEqual(page.sent('/api/say').map(one => [one.body.command, one.body.step]), [['goal-step', 0], ['goal-step', 1]])
  } finally {
    await page.close()
  }
})

test('the Focus page shows the Objective under the title and the Done when bullets met or not met; a goal without one shows nothing new', async () => {
  const page = await openPage({ state: pageState(OBJECTIVE_GOALS, [], [done('B13')]) })
  try {
    await page.click('[data-tab="advice"]')
    assert.equal(page.text('.focus-objective'), 'A garden a visitor crosses without a map.')
    assert.equal(page.all('.focus-vibe-line').length, 0)
    const card = page.find('.focus-done-when')
    // Above the how.
    assert.ok(card.compareDocumentPosition(page.find('.focus-run')) & 4, 'the bullets stand above the how')
    const rows = page.all('.focus-bullet').map(one => [one.className, one.querySelector('.focus-bullet-text').textContent, one.querySelector('.focus-bullet-mark').getAttribute('aria-label'), one.querySelector('.focus-bullet-steps').textContent])
    assert.deepEqual(rows, [
      ['focus-bullet is-met', '1. Every bench is on a path', 'met', 'B13'],
      ['focus-bullet is-open', '2. A visitor finds the gate', 'not met', 'B12'],
      ['focus-bullet is-open', '3. No path ends nowhere', 'not met', 'no task yet'],
    ])
    // A known step id is a link to its step.
    assert.equal(page.all('.focus-bullet-steps [data-ask-link="B12"]').length, 1)
  } finally {
    await page.close()
  }
  const plain = await openPage({ state: pageState(RUN_GOALS) })
  try {
    await plain.click('[data-tab="advice"]')
    assert.deepEqual([plain.all('.focus-done-when').length, plain.all('.focus-objective').length, plain.all('.focus-vibe-line').length], [0, 0, 1])
  } finally {
    await plain.close()
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// Names and paths

test('this test and the change\'s code hold no name of the first project, its chats, its folders or this PC', async () => {
  const root = join(dirname(HERE), '..')
  const ties = [
    new RegExp(['Game', ' - '].join(''), 'g'),
    new RegExp(['lava', '[ -]?', 'tactics'].join(''), 'gi'),
    new RegExp(['C:', '[\\\\/]+', 'Web', '\\b'].join(''), 'gi'),
    new RegExp(['art', '-inbox'].join(''), 'g'),
    new RegExp(['bob', 'du'].join(''), 'gi'),
  ]
  for (const file of ['test/changeGoal.test.mjs', 'src/brainstorm.mjs', 'src/goals.mjs', 'src/goalsWrite.mjs', 'src/say.mjs', 'public/board.js', 'public/index.html', 'roles/partner.md', 'examples/goals.md']) {
    const text = await readFile(join(root, file), 'utf8')
    for (const tie of ties) assert.equal(text.match(tie), null, `${file}: ${tie}`)
  }
})
