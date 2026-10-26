// B259: the Advisor tab's Brainstorm part (spec 2026-10-15, section 5): the list of brainstorms, the card with the
// open question, the proposal with its ticks. The view models run here without the page; made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { brainstormsState, fixesToTell, strandedQuestions, strandedToTell, titleFixes } from '../src/brainstorm.mjs'
import { brainstormFixWords, brainstormStrandedWords, isPartnerWord, wakeFor } from '../src/say.mjs'

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
  assert.deepEqual(card.question, { n: 2, title: 'How bright?', context: '', why: 'it decides the sprite.', picture: 'pictures/brainstorm/bright.png' })
  assert.deepEqual(card.options, [{ key: 'A', text: 'dim', isAdvised: true }, { key: 'B', text: 'bright', isAdvised: false }])
  assert.equal(card.canAnswer, true)
  assert.equal(card.canBack, true)
  assert.equal(card.waiting, null)
  assert.deepEqual(card.earlier, [{ n: 1, title: 'Where first?', context: '', answerText: 'A, by the gate: "and the bench"' }])
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

// B475: a question is a short title and a context, as an ask is (B452).
const LONG = 'Where should the lanterns go first? G6 sits under the visuals; its sibling G7 is about the benches. The answer decides which sprite is made first.'
test('B475: the card shows a question as its short title and its context; an older question splits at its first question', () => {
  const written = page.brainstormCardView(one(`${HEAD}## Q1 (21:01)
Where do the lanterns go first?
Context: G6 is about the benches. Its sibling G7 is about the pond.
It decides which sprite is made first.
Why: the order.
- A: gate (advised)
- B: pond
`), idle)
  assert.equal(written.question.title, 'Where do the lanterns go first?')
  assert.equal(written.question.context, 'G6 is about the benches. Its sibling G7 is about the pond. It decides which sprite is made first.')
  const older = page.brainstormCardView(one(`${HEAD}## Q1 (21:01)
${LONG}
Why: the order.
- A: gate (advised)
- B: pond
`), idle)
  assert.equal(older.question.title, 'Where should the lanterns go first?')
  assert.equal(older.question.context, 'G6 sits under the visuals; its sibling G7 is about the benches. The answer decides which sprite is made first.')
})

test('B475: a title over twelve words is a problem of the thread, named with its question', () => {
  const thread = one(`${HEAD}## Q1 (21:01)
Where should all of the lanterns of the whole camp go first when we start?
Context: Short.
- A: gate (advised)
`)
  assert.equal(thread.problems.length, 1)
  assert.match(thread.problems[0], /Q1's title is too long/)
})

test('B475: the card draws the title as its header and the context as normal text under it', () => {
  assert.match(script, /el\('h4', 'brainstorm-question', view\.question\.title\)/)
  assert.match(script, /el\('p', 'brainstorm-context', view\.question\.context\)/)
  assert.match(css, /\.brainstorm-context \{/)
})

test('B475: a question with no title line is a problem of the thread', () => {
  const thread = one(`${HEAD}## Q1 (21:01)
Context: Only context.
- A: gate (advised)
`)
  assert.match(thread.problems.join(' '), /Q1 has no title/)
})

const LONGQ = 'Where should all of the lanterns of the whole camp go first when we start?'

test('B491: the open question with a title over twelve words, or none, goes back to the Advisor; the others ask for nothing', () => {
  const fixes = text => titleFixes([one(text)])
  assert.deepEqual(fixes(`${HEAD}## Q1 (21:01)\n${LONGQ}\nContext: Short.\n- A: gate (advised)\n`).map(f => [f.n, f.path]), [[1, 'b/2026-10-15-lanterns.md']])
  assert.match(fixes(`${HEAD}## Q1 (21:01)\n${LONGQ}\nContext: Short.\n- A: gate (advised)\n`)[0].problem, /too long/)
  assert.match(fixes(`${HEAD}## Q1 (21:01)\nContext: Only context.\n- A: gate (advised)\n`)[0].problem, /no title/)
  // an answered question, a short title, a talk that is over: nothing to rewrite
  assert.deepEqual(fixes(`${HEAD}## Q1 (21:01)\n${LONGQ}\nContext: Short.\n- A: gate (advised)\nAnswer (21:02): A\n`), [])
  assert.deepEqual(fixes(`${HEAD}## Q1 (21:01)\nWhere do lanterns go?\nContext: Short.\n- A: gate (advised)\n`), [])
  assert.deepEqual(fixes(`${HEAD.replace('State: running', 'State: done')}## Q1 (21:01)\n${LONGQ}\nContext: Short.\n- A: gate (advised)\n`), [])
})

test('B491: a question from before the form is checked too: its first sentence is the title', () => {
  const old = `${HEAD}## Q1 (21:01)
${LONGQ}
- A: gate (advised)
`
  const thread = one(old)
  assert.match(thread.latest.problem, /too long/)
  assert.equal(titleFixes([thread]).length, 1)
  // a long first line that holds a short question splits fine and asks for nothing
  assert.deepEqual(titleFixes([one(`${HEAD}## Q1 (21:01)\nThe lanterns of the whole camp, the big ones and the small ones along every wall, could stand at the gate or by the well. Which first? Pick one.\n- A: gate (advised)\n`)]), [])
})

test('B491: the word to the Advisor names the thread, the question and the job, and wakes it like a brainstorm word', () => {
  const [fix] = titleFixes([one(`${HEAD}## Q1 (21:01)\n${LONGQ}\nContext: Short.\n- A: gate (advised)\n`)])
  const words = brainstormFixWords({ to: 'Advisor', ...fix })
  assert.equal(words.command, 'brainstorm-fix')
  assert.match(words.text, /^brainstorm fix\nThread: b\/2026-10-15-lanterns\.md\nQ1's title is refused: too long\. /)
  assert.doesNotMatch(words.text, /refused: 's title/)
  assert.match(words.text, /Now: Where should all of the lanterns/)
  assert.match(words.text, /at most 12 words/)
  const asleep = { advisor: { name: 'Advisor', isRunning: false }, restart: { main: 'Main' }, chats: [{ name: 'Main', isMain: true, isRunning: true }] }
  assert.equal(wakeFor({ to: 'Advisor', command: 'brainstorm-fix' }, asleep, [], 1_000_000, 2000)?.command, 'start')
})

test('B496: the exact words for a title that is too long and for none', () => {
  const [long] = titleFixes([one(`${HEAD}## Q1 (21:01)\n${LONGQ}\nContext: Short.\n- A: gate (advised)\n`)])
  const lines = brainstormFixWords({ to: 'Advisor', ...long }).text.split('\n')
  assert.deepEqual(lines.slice(0, 2), ['brainstorm fix', 'Thread: b/2026-10-15-lanterns.md'])
  assert.match(lines[2], /^Q1's title is refused: too long\. \S/)
  assert.equal(lines[3], `Now: ${LONGQ}`)
  const [none] = titleFixes([one(`${HEAD}## Q1 (21:01)\nContext: Only context.\n- A: gate (advised)\n`)])
  const bare = brainstormFixWords({ to: 'Advisor', ...none }).text.split('\n')
  assert.match(bare[2], /^Q1's title is refused: it has no title: /)
  assert.equal(bare[3], 'Now: (none)')
})

test('B496: the board tells the Advisor of a refused title once for each wording', () => {
  const advisor = { name: 'Advisor' }
  const long = (q = LONGQ) => [one(`${HEAD}## Q1 (21:01)\n${q}\nContext: Short.\n- A: gate (advised)\n`)]
  const outbox = []
  // round 1: told
  const first = fixesToTell(long(), outbox, advisor)
  assert.equal(first.length, 1)
  assert.equal(first[0].to, 'Advisor')
  outbox.push({ ...first[0], state: 'waiting' })
  // round 2: the same wording is not told again, also when the earlier word was delivered
  assert.deepEqual(fixesToTell(long(), outbox, advisor), [])
  outbox[0].state = 'taken'
  assert.deepEqual(fixesToTell(long(), outbox, advisor), [])
  // rewritten, still too long: another wording, told again
  const again = fixesToTell(long('Where should all of the lanterns of the whole camp stand when we start the night?'), outbox, advisor)
  assert.equal(again.length, 1)
  assert.match(again[0].text, /Now: Where should all of the lanterns of the whole camp stand/)
  // no partner, no word; a short title, nothing to tell
  assert.deepEqual(fixesToTell(long(), [], null), [])
  assert.deepEqual(fixesToTell(long('Where do lanterns go?'), [], advisor), [])
})

// B716: G15's thread, made up: its proposal was created on 18 Oct, then the evaluation went on asking in the same talk.
const GONE = `${HEAD}${Q1}Answer (21:02): A\n${PROPOSAL}Created (21:25): G22; 2 steps asked of the main chat; left out: nothing\n`
const Q3 = '\n## Q3 (22:30)\nKeep the approach?\nContext: It failed three times.\n- A: keep (advised)\n- B: rebuild\n'
const ended = state => text => one(text.replace('State: running', `State: ${state}`))

test('B716: a question that stands after a created proposal cannot reach the person; one in a running talk can', () => {
  const stuck = one(`${GONE}${Q3}`)
  assert.deepEqual(strandedQuestions([stuck]).map(q => [q.n, q.path, q.goal]), [[3, 'b/2026-10-15-lanterns.md', 'G6']])
  // a running talk with no proposal, or with its proposal still to tick (the proposal waits for the person), is told nothing
  assert.deepEqual(strandedQuestions([one(`${HEAD}${Q1}`)]), [])
  assert.deepEqual(strandedQuestions([one(`${HEAD}${Q1}Answer (21:02): A\n${PROPOSAL}`)]), [])
  // an answered question, or none at all, asks for nothing
  assert.deepEqual(strandedQuestions([one(`${GONE}${Q3}Answer (22:40): A\n`)]), [])
  assert.deepEqual(strandedQuestions([one(GONE)]), [])
})

test('B716: a done or a discarded talk with an open question cannot reach the person either', () => {
  assert.equal(strandedQuestions([ended('done')(`${HEAD}${Q1}`)]).length, 1)
  assert.equal(strandedQuestions([ended('discarded')(`${HEAD}${Q1}`)]).length, 1)
  assert.equal(strandedQuestions([ended('wrapping up')(`${HEAD}${Q1}`)]).length, 0)
})

test('B716: the board tells the partner of a stranded question once, and the next question again', () => {
  const advisor = { name: 'Advisor' }
  const outbox = []
  const first = strandedToTell([one(`${GONE}${Q3}`)], outbox, advisor)
  assert.equal(first.length, 1)
  assert.equal(first[0].to, 'Advisor')
  assert.equal(first[0].command, 'brainstorm-stranded')
  const lines = first[0].text.split('\n')
  assert.deepEqual(lines.slice(0, 3), ['brainstorm stranded', 'Thread: b/2026-10-15-lanterns.md', 'Q3 in b/2026-10-15-lanterns.md cannot reach the person: ask it with work ask'])
  assert.match(lines[3], /^Your job: ask Q3 now with work ask \(of G6, kind decide/)
  outbox.push({ ...first[0], state: 'waiting' })
  // not again, also when the word was taken, or the title was rewritten
  assert.deepEqual(strandedToTell([one(`${GONE}${Q3}`)], outbox, advisor), [])
  outbox[0].state = 'taken'
  assert.deepEqual(strandedToTell([one(`${GONE}${Q3}`)], outbox, advisor), [])
  assert.deepEqual(strandedToTell([one(`${GONE}${Q3.replace('Keep the approach?', 'Keep it?')}`)], outbox, advisor), [])
  // the question after it is another question
  const Q4 = '\n## Q4 (23:10)\nRebuild now?\nContext: It costs 3 h.\n- A: yes (advised)\n- B: no\n'
  const next = strandedToTell([one(`${GONE}${Q3}Answer (22:40): A\n${Q4}`)], outbox, advisor)
  assert.equal(next.length, 1)
  assert.match(next[0].text, /^brainstorm stranded\nThread: \S+\nQ4 in /)
  // no partner, no word; a talk that reaches the person, nothing to tell
  assert.deepEqual(strandedToTell([one(`${GONE}${Q3}`)], [], null), [])
  assert.deepEqual(strandedToTell([one(`${HEAD}${Q1}`)], [], advisor), [])
})

// B721: G15's Q8 (names its ask Q428) and G33's Q11 (a done goal) woke the partner for nothing.
const NAMED = '\n## Q8 (22:36)\nIs the approach right?\nContext: Yes, it holds.\nWhy: a corrected how. Your choice is asked as Q428, not here.\n- A: keep (advised)\n- B: change\n'
const goals = state => [{ id: 'G6', state }]

test('B721: a question that names its ask is told nothing; one that only mentions a question is', () => {
  assert.deepEqual(strandedQuestions([one(`${GONE}${NAMED}`)]), [])
  assert.deepEqual(strandedToTell([one(`${GONE}${NAMED}`)], [], { name: 'Advisor' }), [])
  assert.equal(strandedQuestions([one(`${GONE}${Q3.replace('It failed three times.', 'Q2 said it failed three times.')}`)]).length, 1)
  assert.equal(strandedQuestions([one(`${GONE}${NAMED.replace('asked as Q428', 'asked later')}`)]).length, 1)
})

test('B721: the talk of a done goal, or of a goal no longer in the map, is told nothing; an open goal is', () => {
  const stuck = one(`${GONE}${Q3}`)
  assert.deepEqual(strandedQuestions([stuck], goals('done')), [])
  assert.deepEqual(strandedQuestions([stuck], []), [])
  assert.equal(strandedQuestions([stuck], goals('now')).length, 1)
  assert.equal(strandedQuestions([stuck], goals('open')).length, 1)
  assert.equal(strandedQuestions([stuck], null).length, 1)
  // a free talk (no goal) has no goal to be done
  assert.equal(strandedQuestions([one(`${GONE}${Q3}`.replace('Goal: G6 Benches that match the picture', 'Goal: new'))], goals('done')).length, 1)
  assert.deepEqual(strandedToTell([stuck], [], { name: 'Advisor' }, goals('done')), [])
  assert.equal(strandedToTell([stuck], [], { name: 'Advisor' }, goals('now')).length, 1)
})

test('B716: the stranded word is a partner word that wakes a stopped partner', () => {
  assert.equal(isPartnerWord('brainstorm-stranded'), true)
  const asleep = { advisor: { name: 'Advisor', isRunning: false }, restart: { main: 'Main' }, chats: [{ name: 'Main', isMain: true, isRunning: true }] }
  const words = brainstormStrandedWords({ to: 'Advisor', path: 'b/x.md', n: 3, goal: null })
  assert.equal(wakeFor({ to: 'Advisor', command: words.command }, asleep, [], 1_000_000, 2000)?.command, 'start')
  assert.doesNotMatch(words.text, /of G/)
})
