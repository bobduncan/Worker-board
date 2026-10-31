// Four fixes to the brainstorm, found on the first real "Change this goal" (the person, 2026-10-31: "once i clicked to create
// new tasks it was closed immediatedly. i do not see if it created the new tasks or not. who is picking that up?", and on an
// old talk: "this isnt clear to me"):
//   1. a Result card for a thread whose proposal was created: what was written, the new tasks and where each stands, what was
//      dropped, what happens next, the earlier talk this change closed;
//   2. a change closes the goal's other running talk when it is created;
//   3. a line the board cannot read is never shown to the person: the partner is told to write it anew, the "…" menu counts it,
//      and the old hand-written answer ("C, through Main: ...") is read as an answer;
//   4. the Created line names the tasks the board made ("tasks B20, B21").
// The thread files on a fake file system, the words to the partner, and the page clicked in happy-dom. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { brainstormsState, editThread, fixesToTell, lineFixes, markCreated, parseThread, titleFixes } from '../src/brainstorm.mjs'
import { parseGoals } from '../src/goals.mjs'
import { goalStepFor } from '../src/say.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { GOALS, NOW, asSent, build } from './partnerState.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const [script, css] = await Promise.all([readFile(join(PUBLIC, 'board.js'), 'utf8'), readFile(join(PUBLIC, 'board.css'), 'utf8')])
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// brainstorm:start'), script.indexOf('// brainstorm:end'))}
Object.assign(this, { brainstormFixCount, brainstormResultView, brainstormTaskStand })`, made)
const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const view = Object.fromEntries(Object.entries(made).map(([name, fn]) => [name, (...args) => plain(fn(...args))]))

const FOLDER = '.claude/brainstorms'
const PATH = `${FOLDER}/2026-10-19-change-paths-through-the-garden.md`
const TALK = `${FOLDER}/2026-10-12-how-we-lay-paths.md`

const HEAD = '# Brainstorm: Change: Paths through the garden\nGoal: G6 Paths through the garden\nKind: change\nStarted: 2026-10-19 09:00 · State: running\nOpening: Steps are missing; I want to rethink what a good path is.\n\n'
const Q1 = '## Q1 (09:01)\nWhat is a path for?\nContext: The goal has one part so far.\nWhy: it decides the bullets.\n- A: getting somewhere (advised)\n- B: a stroll\nAnswer (09:02): A\n\n'
const UNDERSTOOD = '## Understood (09:05)\nA path is good when a visitor reaches every bench\nwithout a map.\nAnswer (09:06): yes\n\n'
const PROPOSAL = [
  '## Proposal (09:10)',
  'Decided:',
  '- every bench reachable',
  'Objective: A garden a visitor crosses without a map.',
  'Done when:',
  '- 1. Every bench is on a path',
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
  'Note: the visitor first.',
  '',
].join('\n')
/** The goal's own talk from before the change: it was "How we lay paths", still running. */
const TALK_HEAD = '# Brainstorm: How we lay paths\nGoal: G6 Paths through the garden\nStarted: 2026-10-12 20:00 · State: running\nOpening: What makes a good path?\n\n'
const TALK_Q1 = '## Q1 (20:01)\nWhat is a path for?\nContext: The goal has one part so far.\n- A: getting somewhere (advised)\n- B: a stroll\nAnswer (20:05): A\n\n'
const WITH_GOAL = [
  '# Goals', 'Last id: G7', 'Focus: G6', '', 'Rules: a goal is one line "- [ ] G<n> <title>";', 'two spaces of indentation per level is "part of".', '',
  '- [~] G6 Paths through the garden', '  Done when: a visitor walks every path without getting lost', '  - [ ] G7 The pond', '',
].join('\n')

// ---------------------------------------------------------------------------------------------------------------------
// A fake file system, as the other thread tests use

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
const textOf = (fs, path) => utf8(fs.files[fileOf(path)])
const mapOf = fs => parseGoals(utf8(fs.files[MAP]))

/** A made-up garden: the goal's own talk running, then a change of the goal with its yes and its proposal waiting to be created. */
async function gardenWithChange(extra = {}) {
  const fs = fakeFs({ [MAP]: latin(WITH_GOAL) })
  const talk = await editThread({ command: 'start', title: 'How we lay paths', goal: 'G6', opening: 'What makes a good path?' }, options(fs))
  const change = await editThread({ command: 'start', kind: 'change', title: 'Change: Paths through the garden', goal: 'G6', opening: 'Steps are missing.' }, options(fs))
  fs.files[fileOf(change.result.path)] += latin(`${Q1}${UNDERSTOOD}${PROPOSAL}`)
  return { fs, talk: talk.result.path, change: change.result.path, ...extra }
}

// ---------------------------------------------------------------------------------------------------------------------
// Fix 4: the Created line names the tasks

test('Create makes the ticked tasks through the board\'s own step and the Created line names their ids', async () => {
  const { fs, change } = await gardenWithChange()
  const asked = []
  let next = 20
  const step = async ({ thread, index, goal }) => {
    asked.push({ ...goalStepFor(thread, index, goal), title: thread.proposal.steps[index].title })
    return index === 1 ? { ok: false, why: 'The work store has no activity to put the step under.' } : { ok: true, result: { id: `B${next++}` } }
  }
  const done = await editThread({ command: 'create', path: change, steps: [0, 1], drops: [0], seen: textOf(fs, change).length }, options(fs, { step, drop: async id => ({ ok: true, result: { id } }) }))
  assert.equal(done.ok, true)
  // The step is the one the Design tab's form makes of it: under the goal, with the bullets it is for.
  assert.deepEqual(asked.map(one => [one.title, one.goal, one.for ?? null, one.cost, one.about]), [
    ['Sign the gate from every bench', 'G6', [2], 'about 1 h', `${change}#0`],
    ['Join the dead ends', 'G6', [2, 3], 'about 30 min', `${change}#1`],
  ])
  assert.match(asked[0].description, new RegExp(`^from the brainstorm "Change: Paths through the garden" \\(${change}\\)`))
  // The line names the task the board made, once; the one it could not make has no id and comes back to the page.
  assert.match(textOf(fs, change), /\nCreated \(09:30\): no goals; tasks B20; dropped: B14; left out: Sweep the gravel\n$/)
  assert.deepEqual(parseThread(textOf(fs, change)).proposal.created, { at: '09:30', goals: [], steps: ['B20'], asked: 1, leftOut: ['Sweep the gravel'], dropped: ['B14'] })
  assert.deepEqual(done.result.steps.map(one => [one.title, one.id ?? null, one.index ?? null]), [['Sign the gate from every bench', 'B20', 0], ['Join the dead ends', null, null]])
  // Never "asked of the main chat" for tasks the board made itself.
  assert.doesNotMatch(textOf(fs, change), /asked of the main chat/)
})

test('the Created line: every task named in order, "no tasks" for none, and the old wordings are still read', () => {
  const PLAIN = `${HEAD}${Q1}${UNDERSTOOD}${PROPOSAL}`
  const named = markCreated(PLAIN, { at: '09:30', goals: [], steps: ['B869', 'B870', 'B871'], leftOut: [], dropped: [] })
  assert.match(named.text, /\nCreated \(09:30\): no goals; tasks B869, B870, B871; left out: nothing\n$/)
  assert.deepEqual(parseThread(named.text).proposal.created.steps, ['B869', 'B870', 'B871'])
  assert.match(markCreated(PLAIN, { at: '09:30' }).text, /\nCreated \(09:30\): no goals; no tasks; left out: nothing\n$/)
  const read = line => parseThread(`${PLAIN}${line}\n`).proposal.created
  // A board that made no task itself keeps its old wording ("asked of the main chat"), and reads it back.
  assert.match(markCreated(PLAIN, { at: '09:30', asked: 3 }).text, /; 3 steps asked of the main chat; left out: nothing\n$/)
  assert.deepEqual(read('Created (12:31): no goals; 3 steps asked of the main chat; left out: nothing'), { at: '12:31', goals: [], steps: [], asked: 3, leftOut: [] })
  // Old threads: ids alone, and "dropped" at the end of the line.
  assert.deepEqual(read('Created (20:01): G10; B61; left out: Score the benches'), { at: '20:01', goals: ['G10'], steps: ['B61'], asked: 1, leftOut: ['Score the benches'] })
  assert.deepEqual(read('Created (09:20): no goals; 1 step asked of the main chat; left out: Sweep the gravel; dropped: B14'), { at: '09:20', goals: [], steps: [], asked: 1, leftOut: ['Sweep the gravel'], dropped: ['B14'] })
  // New: "dropped" before "left out", and a left-out title that holds "; " keeps whole.
  assert.deepEqual(read('Created (09:30): no goals; tasks B20; dropped: B14, B15; left out: Sweep; the gravel · Join the ends'), { at: '09:30', goals: [], steps: ['B20'], asked: 1, leftOut: ['Sweep; the gravel', 'Join the ends'], dropped: ['B14', 'B15'] })
})

// ---------------------------------------------------------------------------------------------------------------------
// Fix 2: a change closes the goal's other running talk

test('creating a change closes the goal\'s other running talk: done, the board\'s Closed line, and its goal line reads (done)', async () => {
  const { fs, talk, change } = await gardenWithChange()
  // A talk of another goal, one that wraps up on this goal, one already over, and a free one stay as they are or close as they should.
  const other = await editThread({ command: 'start', title: 'The pond', goal: 'G7', opening: 'What lives there?' }, options(fs))
  fs.files[`${DIR}/2026-10-12-wrapping.md`] = latin(TALK_HEAD.replace('How we lay paths', 'Wrapping up').replace('State: running', 'State: wrapping up'))
  fs.files[`${DIR}/2026-10-12-over.md`] = latin(TALK_HEAD.replace('How we lay paths', 'Over').replace('State: running', 'State: done'))
  fs.files[`${DIR}/2026-10-12-free.md`] = latin(TALK_HEAD.replace('Goal: G6 Paths through the garden', 'Goal: new'))
  assert.deepEqual(mapOf(fs).byId.get('G6').brainstorm, { path: talk, state: 'running' })
  const done = await editThread({ command: 'create', path: change, steps: [], drops: [], seen: textOf(fs, change).length }, options(fs))
  assert.equal(done.ok, true)
  const closed = text => [parseThread(text).state, parseThread(text).closed]
  assert.deepEqual(closed(textOf(fs, talk)), ['done', { at: '09:30', by: 'by the board, replaced by the change of G6' }])
  assert.match(textOf(fs, talk), /\n\nClosed \(09:30\): by the board, replaced by the change of G6\n+$/)
  assert.deepEqual(closed(utf8(fs.files[`${DIR}/2026-10-12-wrapping.md`])), ['done', { at: '09:30', by: 'by the board, replaced by the change of G6' }])
  assert.deepEqual(done.result.replaced.sort(), [talk, `${FOLDER}/2026-10-12-wrapping.md`].sort())
  // The goal's line reads (done); another goal's talk, a talk that was over and a free one are not touched.
  assert.deepEqual(mapOf(fs).byId.get('G6').brainstorm, { path: talk, state: 'done' })
  assert.equal(parseThread(textOf(fs, other.result.path)).state, 'running')
  assert.equal(parseThread(utf8(fs.files[`${DIR}/2026-10-12-free.md`])).state, 'running')
  assert.equal(parseThread(utf8(fs.files[`${DIR}/2026-10-12-over.md`])).closed, null)
  // The change itself is done, with its own Created line, and no Closed line of the board's.
  assert.equal(parseThread(textOf(fs, change)).closed, null)
  assert.equal(parseThread(textOf(fs, change)).state, 'done')
})

test('a plain proposal closes no other talk; a change with no other talk closes none', async () => {
  const fs = fakeFs({ [MAP]: latin(WITH_GOAL) })
  const first = await editThread({ command: 'start', title: 'How we lay paths', goal: 'G6', opening: 'What makes a good path?' }, options(fs))
  fs.files[fileOf(first.result.path)] += latin(`${TALK_Q1}## Proposal (20:30)\nDecided:\n- paths\nGoals:\n- [ ] Lay the gravel — under G6 — Done when: it is laid\nSteps:\nNote: x.\n`)
  const second = await editThread({ command: 'start', title: 'The pond', goal: 'G7', opening: 'What lives there?' }, options(fs))
  const made = await editThread({ command: 'create', path: first.result.path, goals: [0], steps: [], seen: textOf(fs, first.result.path).length }, options(fs))
  assert.equal(made.ok, true)
  assert.equal(made.result.replaced, undefined)
  assert.equal(parseThread(textOf(fs, second.result.path)).state, 'running')
  assert.equal(parseThread(textOf(fs, second.result.path)).closed, null)
})

// ---------------------------------------------------------------------------------------------------------------------
// Fix 3: the lines the board cannot read

const ODD = 'Answer (22:50): C, through Main: "keep the old look, but darker"'
const QUESTIONS = [
  '## Q1 (22:30)', 'What is a path for?', 'Context: The goal has one part so far.', '- A: getting somewhere (advised)', '- B: a stroll', '- C: both', '',
].join('\n')
const TALK_WITH = lines => `${TALK_HEAD}${QUESTIONS}${lines}\n`

test('the old hand-written answer "C, through Main: ..." is an answer C with those words, no odd line', () => {
  const thread = parseThread(TALK_WITH(ODD))
  assert.deepEqual(thread.questions[0].answer, { at: '22:50', key: 'C', words: 'keep the old look, but darker' })
  assert.deepEqual([thread.problems, thread.oddLines], [[], []])
  // Without the quotes, with another chat's name, "Other", and with no words at all.
  assert.deepEqual(parseThread(TALK_WITH('Answer (22:50): B, through the lead chat: a stroll')).questions[0].answer, { at: '22:50', key: 'B', words: 'a stroll' })
  assert.deepEqual(parseThread(TALK_WITH('Answer (22:50): Other, through Main: "a bench by the gate"')).questions[0].answer, { at: '22:50', key: 'Other', words: 'a bench by the gate' })
  assert.deepEqual(parseThread(TALK_WITH('Answer (22:50): A, through Main:')).questions[0].answer, { at: '22:50', key: 'A', words: '' })
  // The board's own form is read as before; words that are no answer are still an odd line.
  assert.deepEqual(parseThread(TALK_WITH('Answer (22:50): C — both')).questions[0].answer, { at: '22:50', key: 'C', words: 'both' })
  assert.equal(parseThread(TALK_WITH('Answer (22:50): somewhere in the middle')).oddLines.length, 1)
  // The page reads it as the person's answer.
  const state = brainstormsState([{ path: TALK, text: TALK_WITH(ODD), at: 1 }], FOLDER).threads[0]
  assert.deepEqual([state.latest.answer, state.problems], [{ at: '22:50', key: 'C', words: 'keep the old look, but darker' }, []])
})

test('an odd line is kept whole with its number, beside the short problem', () => {
  const thread = parseThread(TALK_WITH('Maybe: a line of its own that the form does not know'))
  assert.equal(thread.problems.length, 1)
  assert.deepEqual(thread.oddLines, [{ line: 12, text: 'Maybe: a line of its own that the form does not know' }])
  assert.match(thread.problems[0], /^line 12: Maybe: a line/)
})

const threadsOf = (...texts) => brainstormsState(texts.map((text, index) => ({ path: `${FOLDER}/t${index}.md`, text, at: index })), FOLDER).threads
const MAYBE = 'Maybe: a line of its own that the form does not know'

test('an odd line goes to the partner as a fix word, once per problem, and never from a done, created, closed or discarded talk', () => {
  const advisor = { name: 'Studio · Partner' }
  const running = threadsOf(TALK_WITH(MAYBE))
  assert.deepEqual(lineFixes(running).map(one => [one.path, one.line, one.odd]), [[`${FOLDER}/t0.md`, 12, MAYBE]])
  const [word, ...more] = fixesToTell(running, [], advisor)
  assert.deepEqual(more, [])
  assert.equal(word.command, 'brainstorm-fix')
  assert.equal(word.to, 'Studio · Partner')
  assert.deepEqual(word.text.split('\n').slice(0, 4), ['brainstorm fix', `Thread: ${FOLDER}/t0.md`, `A line of the thread is not in the form: ${MAYBE}`, 'Where: line 12'])
  assert.match(word.text, /roles\/partner\.md, "A brainstorm"/)
  // Told once, also after the word was delivered, and also when the line moved down the file (a line is its words, not its number).
  const sent = [{ ...word, state: 'waiting' }]
  assert.deepEqual(fixesToTell(running, sent, advisor), [])
  sent[0].state = 'taken'
  assert.deepEqual(fixesToTell(running, sent, advisor), [])
  assert.deepEqual(fixesToTell(threadsOf(TALK_WITH(MAYBE).replace('## Q1', '\n## Q1')), sent, advisor), [])
  // Another odd line is another problem; the same line twice is one.
  assert.equal(fixesToTell(threadsOf(TALK_WITH(`${MAYBE}\nPerhaps: another\n${MAYBE}`)), sent, advisor).length, 1)
  assert.equal(fixesToTell(threadsOf(TALK_WITH(`${MAYBE}\n${MAYBE}`)), [], advisor).length, 1)
  // The Product owner is pointed at its own job text.
  assert.match(fixesToTell(running, [], { name: 'Studio · Owner', role: 'owner' })[0].text, /roles\/product-owner\.md, "How a talk goes"/)
  // No partner, no word.
  assert.deepEqual(fixesToTell(running, [], null), [])
  // A talk that is over asks for nothing: done, discarded, closed by the person, or a proposal that was created.
  const over = text => fixesToTell(threadsOf(text), [], advisor)
  assert.deepEqual(over(TALK_WITH(MAYBE).replace('State: running', 'State: done')), [])
  assert.deepEqual(over(TALK_WITH(MAYBE).replace('State: running', 'State: discarded')), [])
  assert.deepEqual(over(`${TALK_WITH(MAYBE)}\nClosed (12:34): by the person\n`), [])
  assert.deepEqual(over(`${TALK_WITH(MAYBE)}## Proposal (23:00)\nDecided:\n- paths\nSteps:\nCreated (23:05): no goals; no tasks; left out: nothing\n`), [])
  // A talk that wraps up still can be told.
  assert.equal(over(TALK_WITH(MAYBE).replace('State: running', 'State: wrapping up')).length, 1)
})

test('a title the board refuses is still told as before, beside the odd lines', () => {
  const long = 'Where should all of the lanterns of the whole camp go first when we start?'
  const text = `${TALK_HEAD}## Q1 (22:30)\n${long}\nContext: Short.\n- A: gate (advised)\n${MAYBE}\n`
  const threads = threadsOf(text)
  assert.equal(titleFixes(threads).length, 1)
  const told = fixesToTell(threads, [], { name: 'Studio · Partner' }).map(one => one.text.split('\n')[2])
  assert.equal(told.length, 2)
  assert.match(told[0], /^Q1's title is refused: too long\./)
  assert.equal(told[1], `A line of the thread is not in the form: ${MAYBE}`)
})

test('the page counts the lines for the partner to fix and nothing else: only live talks, never the lines themselves', () => {
  const count = text => view.brainstormFixCount(threadsOf(text)[0])
  assert.equal(count(TALK_WITH(MAYBE)), 1)
  assert.equal(count(TALK_WITH(`${MAYBE}\nPerhaps: another`)), 2)
  assert.equal(count(TALK_WITH(`${MAYBE}\n${MAYBE}`)), 1)
  assert.equal(count(TALK_WITH('')), 0)
  assert.equal(count(TALK_WITH(MAYBE).replace('State: running', 'State: done')), 0)
  assert.equal(count(`${TALK_WITH(MAYBE)}\nClosed (12:34): by the person\n`), 0)
  // The open question's refused title counts as one.
  const long = 'Where should all of the lanterns of the whole camp go first when we start?'
  assert.equal(count(`${TALK_HEAD}## Q1 (22:30)\n${long}\nContext: Short.\n- A: gate (advised)\n`), 1)
  assert.equal(count(`${TALK_HEAD}## Q1 (22:30)\n${long}\nContext: Short.\n- A: gate (advised)\nAnswer (22:31): A\n`), 0)
})

// ---------------------------------------------------------------------------------------------------------------------
// The page

const STORE = '## Garden\n- [ ] B12 Plant the hedge\n- [ ] B14 Mow the maze\n- [ ] B20 Sign the gate from every bench\n- [ ] B21 Join the dead ends\n- [ ] B22 Sweep the gravel\n- [x] B23 Rake the paths\n'

/** The made-up garden's state: the store's tasks in the given states (`[id, state, owner]`), the threads, the page allowed to write. */
function stateOf(threadTexts, tasks = [['B20', 'new', null], ['B21', 'taken', 'Garden · Digger']], more = {}) {
  const work = storeFromText(STORE, { now: NOW })
  for (const [id, state, owner] of tasks) {
    work.items.get(id).head.set('State', state)
    if (owner) work.items.get(id).head.set('Owner', owner)
  }
  const state = asSent({ ...build([], undefined, GOALS, { threadTexts: threadTexts.map(([path, text], index) => ({ path, text, at: index + 1 })), work }), goalsEdit: { canWrite: true } })
  return { ...state, advisor: { ...state.advisor, isRunning: true }, ...more }
}
async function open(threadTexts, { tasks, answers, more, chosen = null } = {}) {
  const page = await openPage({ state: stateOf(threadTexts, tasks, more), answers })
  await page.click('[data-tab="advice"]')
  await page.click('[data-advisor-pane="brainstorm"]')
  if (chosen !== null) await page.click(`[data-brainstorm-open="${chosen}"]`)
  return page
}

const CHANGE_DONE = `${HEAD.replace('State: running', 'State: done')}${Q1}${UNDERSTOOD}${PROPOSAL}Created (09:30): no goals; tasks B20, B21; dropped: B14; left out: Sweep the gravel\n`
const TALK_REPLACED = `${TALK_HEAD.replace('State: running', 'State: done')}${TALK_Q1}Closed (09:30): by the board, replaced by the change of G6\n`

test('Fix 1: the Result card shows Done, the goal written, the new tasks and where each stands, the drops, what comes next and the talk it closed', async () => {
  const page = await open([[PATH, CHANGE_DONE], [TALK, TALK_REPLACED]], { chosen: PATH })
  try {
    assert.equal(page.text('.brainstorm-result-title'), 'Done')
    assert.equal(page.text('.brainstorm-result-line').trim(), 'G6 now has its objective and 3 Done-when bullets. See it on the Focus page')
    assert.equal(page.find('.brainstorm-result-focus').dataset.place, '#advice/focus')
    // The tasks, each a link to its window, with where it stands now.
    assert.deepEqual(page.all('.brainstorm-result-task').map(row => [row.querySelector('.brainstorm-result-id').textContent, row.querySelector('.brainstorm-result-name').textContent, row.querySelector('.brainstorm-task-stand').textContent]), [
      ['B20', 'Sign the gate from every bench', 'being refined by the Advisor'],
      ['B21', 'Join the dead ends', 'Digger is on it'],
    ])
    assert.deepEqual(page.all('.brainstorm-result-task [data-ask-link]').map(link => link.dataset.askLink), ['B20', 'B21'])
    assert.deepEqual(page.all('.brainstorm-result-drop').map(row => row.textContent.replace(/\s+/g, ' ').trim()), ['B14Mow the mazethe old maze is no longer needed'])
    assert.equal(page.text('.brainstorm-result-next'), 'The Advisor refines each new task; then the board gives it to a free worker.')
    assert.equal(page.text('.brainstorm-result-replaced'), 'G6\'s earlier talk is closed: this change replaced it.')
    // Calm: nothing in the card or its words is amber or red, and the thread still sits in the Closed group.
    assert.doesNotMatch(page.find('.brainstorm-result').innerHTML, /is-warn|is-error|is-problem|brainstorm-problems/)
    assert.deepEqual(page.all('.brainstorm-group').map(one => one.textContent), ['Closed'])
    assert.equal(page.find(`[data-brainstorm-open="${PATH}"] .brainstorm-status`).textContent.startsWith('created'), true)
    // The card stands instead of the proposal's ticks: nothing to tick, no Create.
    assert.deepEqual([page.all('[data-tick]').length, page.all('[data-brainstorm-act="create"]').length], [0, 0])
    // The Focus page link goes there.
    await page.click('.brainstorm-result-focus')
    assert.equal(page.find('#view-advice').dataset.pane, 'focus')
  } finally { await page.close() }
})

test('Fix 1: a task link opens the task; the card follows the task as it moves on', async () => {
  const page = await open([[PATH, CHANGE_DONE]], { chosen: PATH })
  try {
    await page.click('.brainstorm-result-task [data-ask-link="B20"]')
    assert.equal(page.find('#details').open, true, 'the task\'s window opens')
  } finally { await page.close() }
  const stands = async tasks => {
    const moved = await open([[PATH, CHANGE_DONE]], { tasks, chosen: PATH })
    try { return moved.all('.brainstorm-task-stand').map(one => one.textContent) } finally { await moved.close() }
  }
  assert.deepEqual(await stands([['B20', 'refined', null], ['B21', 'queued', 'Garden · Digger']]), ['on the list for a worker', 'given to Digger'])
  assert.deepEqual(await stands([['B20', 'in progress', 'Garden · Mason'], ['B21', 'done', null]]), ['Mason is on it', 'done'])
})

test('Fix 1: the Result card of a plain proposal names the goals made and the tasks; no change line, no replaced line', async () => {
  const plainThread = `${HEAD.replace('Kind: change\n', '').replace('State: running', 'State: done')}${Q1}## Proposal (09:10)\nDecided:\n- paths\nGoals:\n- [ ] Lay the gravel — under G6 — Done when: it is laid\nSteps:\n- [ ] Sign the gate from every bench — Digger — about 1 h\nNote: x.\nCreated (09:30): G7; tasks B20; left out: nothing\n`
  const page = await open([[PATH, plainThread]], { tasks: [['B20', 'new', null]], chosen: PATH })
  try {
    assert.equal(page.text('.brainstorm-result-title'), 'Done')
    assert.deepEqual(page.all('.brainstorm-result-goal').map(one => one.textContent), ['G7'])
    assert.deepEqual(page.all('.brainstorm-result-task').map(row => row.querySelector('.brainstorm-result-id').textContent), ['B20'])
    assert.deepEqual([page.all('.brainstorm-result-line').length, page.all('.brainstorm-result-replaced').length, page.all('.brainstorm-result-drop').length], [0, 0, 0])
  } finally { await page.close() }
})

test('Fix 1: a created thread with the old wording names its tasks by the ticked titles where each is one task, else says how many', () => {
  const thread = text => plain(brainstormsState([{ path: PATH, text, at: 1 }], FOLDER).threads[0])
  const old = thread(CHANGE_DONE.replace('tasks B20, B21', '2 steps asked of the main chat'))
  const backlog = [{ steps: [{ id: 'B30', title: 'Sign the gate from every bench', item: { state: 'new' } }, { id: 'B31', title: 'Join the dead ends', item: { state: 'taken', owner: 'Digger' } }, { id: 'B32', title: 'Sweep the gravel', item: { state: 'new' } }] }]
  const card = view.brainstormResultView(old, { backlog })
  assert.deepEqual(card.tasks.map(one => [one.id, one.words]), [['B30', 'being refined by the Advisor'], ['B31', 'Digger is on it']])
  assert.equal(card.unnamed, 0)
  // Two tasks with the same title: the thread cannot say which, so the card names none.
  const twice = view.brainstormResultView(old, { backlog: [{ steps: [...backlog[0].steps, { id: 'B33', title: 'Join the dead ends', item: { state: 'new' } }] }] })
  assert.deepEqual([twice.tasks, twice.unnamed], [[], 2])
  // No such task on the backlog at all.
  assert.deepEqual([view.brainstormResultView(old, { backlog: [] }).tasks, view.brainstormResultView(old, { backlog: [] }).unnamed], [[], 2])
  // A thread that was not created has no card.
  assert.equal(view.brainstormResultView(thread(`${HEAD}${Q1}${UNDERSTOOD}${PROPOSAL}`), { backlog }), null)
})

test('Fix 1: where a task stands, in words, from its row; a task the backlog does not hold says so quietly', () => {
  const stand = (state, owner = '') => view.brainstormTaskStand({ id: 'B20', item: { state, owner } }, 'Garden ·')
  assert.deepEqual(['new', 'refined', 'queued', 'taken', 'in progress', 'review', 'done', 'dropped'].map(state => stand(state, 'Garden · Digger').words), [
    'being refined by the Advisor', 'on the list for a worker', 'given to Digger', 'Digger is on it', 'Digger is on it', 'in review', 'done', 'dropped',
  ])
  assert.equal(stand('taken').words, 'a worker is on it')
  assert.equal(stand('queued').words, 'on the list for a worker')
  assert.equal(view.brainstormTaskStand(undefined).words, 'not on the task list now')
  // A board with no store reads the backlog's own status.
  assert.equal(view.brainstormTaskStand({ id: 'B20', status: 'progress' }).words, 'a worker is on it')
  assert.equal(view.brainstormTaskStand({ id: 'B20', status: 'done' }).words, 'done')
  // Quiet tones only.
  assert.deepEqual([...new Set(['new', 'refined', 'taken', 'done', 'dropped', 'review'].map(state => stand(state).tone))].sort(), ['done', 'queued', 'quiet', 'refining', 'working'])
  const rule = selector => css.split('\n').filter(line => line.startsWith(selector)).join('\n')
  for (const selector of ['.brainstorm-box.brainstorm-result', '.brainstorm-result', '.brainstorm-task-stand', '.brainstorm-menu-note']) {
    assert.notEqual(rule(selector), '', selector)
    assert.doesNotMatch(rule(selector), /var\(--(?:waiting|warn|ask)\)|#ff7a59|#f6b93b/, `${selector} stays in the quiet colours`)
  }
  assert.doesNotMatch(css, /\.brainstorm-problems/)
})

test('Fix 1: Do what\'s ticked asks nothing of the main chat for a task the board made; one it could not make is asked for again', async () => {
  const thread = `${HEAD}${Q1}${UNDERSTOOD}${PROPOSAL}`
  const run = async steps => {
    const page = await open([[PATH, thread]], { answers: request => reply(request.url === '/api/brainstorm' ? { goals: [], steps, dropped: [], notDropped: [], replaced: [] } : {}) })
    try {
      await page.click('[data-brainstorm-act="agree"]')
      await page.click('[data-brainstorm-act="create"]')
      return [page.sent('/api/brainstorm')[0].body.steps, page.sent('/api/say').map(one => [one.body.command, one.body.step]), page.text('#brainstorm-card .brainstorm-note')]
    } finally { await page.close() }
  }
  const both = await run([{ title: 'Sign the gate from every bench', id: 'B20', index: 0 }, { title: 'Join the dead ends', id: 'B21', index: 1 }, { title: 'Sweep the gravel', id: 'B22', index: 2 }])
  assert.deepEqual(both.slice(0, 2), [[0, 1, 2], []])
  assert.match(both[2], /^Done: .*; 3 of 3 new tasks made/)
  // Task 2 came back without an id: that one only is asked for again.
  const lost = await run([{ title: 'Sign the gate from every bench', id: 'B20', index: 0 }, { title: 'Join the dead ends' }, { title: 'Sweep the gravel', id: 'B22', index: 2 }])
  assert.deepEqual(lost[1], [['goal-step', 1]])
})

test('Fix 3: the thread\'s odd lines are never on the card; the "…" menu counts them quietly, only while the talk runs', async () => {
  const running = TALK_WITH(`${MAYBE}\nPerhaps: another`)
  const page = await open([[TALK, running]])
  try {
    const card = page.find('#brainstorm-card').textContent
    assert.doesNotMatch(card, /cannot read|Maybe|Perhaps|ask your partner to write/)
    assert.equal(page.all('.brainstorm-problems').length, 0)
    assert.equal(page.all('.brainstorm-menu-note').length, 0, 'closed menu: nothing')
    await page.click('[data-brainstorm-act="menu"]')
    assert.equal(page.text('.brainstorm-menu-note'), '2 lines for your partner to fix')
    assert.doesNotMatch(page.find('.brainstorm-menu-list').textContent, /Maybe|Perhaps/)
  } finally { await page.close() }
  const one = await open([[TALK, TALK_WITH(MAYBE)]], { more: { talkPartner: { name: 'Studio · Owner', role: 'owner', isRunning: true, state: 'free', next: [] } } })
  try {
    await one.click('[data-brainstorm-act="menu"]')
    assert.equal(one.text('.brainstorm-menu-note'), '1 line for your Product owner to fix')
  } finally { await one.close() }
  const over = await open([[TALK, TALK_WITH(MAYBE).replace('State: running', 'State: done')]])
  try {
    await over.click('[data-brainstorm-act="menu"]')
    assert.equal(over.all('.brainstorm-menu-note').length, 0, 'a talk that is over asks for nothing')
    assert.doesNotMatch(over.find('#brainstorm-card').textContent, /cannot read|Maybe/)
  } finally { await over.close() }
  const fine = await open([[TALK, TALK_WITH(ODD)]])
  try {
    await fine.click('[data-brainstorm-act="menu"]')
    assert.equal(fine.all('.brainstorm-menu-note').length, 0, 'the old hand-written answer is no odd line')
  } finally { await fine.close() }
})
