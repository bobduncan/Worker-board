// The wait line, wave 2 (T22, 2026-11-04, art-inbox/focus-mocks/wait-rule/plan-wave2.md; the person, 2026-11-02: "either the board
// responds immediately, e.g. via code. or we expect an ai chat todo something in which case i always need clear visual indications,
// maybe a loader. and the status if its being picked up or not. I want to know whats going on."): the same one line for the eight
// other places that wait on a chat. For each: its word sent, "Sent HH:MM · ..."; taken while its chat works, "<Chat> is on it";
// its own result, "Done HH:MM · ..."; the Focus talk has no result of its own (the fallback "answered"). Made-up garden chats.
import assert from 'node:assert/strict'
import test from 'node:test'

import { wordJudge } from '../src/supervisor/index.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { isPersonWord, placeOfWord, waitsOf } from '../src/waitLine.mjs'
import { parseItem } from '../src/work/item.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 4, 13, 0).getTime()
const at = minutesAgo => NOW - minutesAgo * MIN
const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm(ms)}` }
const keep = buildView({ state: { chats: [], chatPrefix: '' }, outbox: [], settings: {}, now: NOW }).keep

const lane = (name, more = {}) => ({ name, isRunning: true, status: 'Free', state: 'free', task: null, report: null, wake: null, ...more })
const working = (name, more = {}) => lane(name, { status: 'Working', state: 'working', ...more })
const item = text => parseItem(text)
const step = (id, state, madeAt, more = '') => item(`Id: ${id}\nKind: step\nTitle: a step\nState: ${state}\nSince: ${stamp(madeAt)}\n${more}\n## History\n- ${stamp(madeAt)} made\n`)
/** The server's `waits` for a state, an outbox and the store's items (the judge as the server makes it). */
function waitsFor({ state, outbox, items = new Map(), reports = null }) {
  const judge = wordJudge({ state, items, outbox, settings: {}, now: NOW })
  return waitsOf({ state, outbox, now: NOW, keep, judge, reports, items })
}
const said = (state, since, more = {}) => ({ state, since, background: false, run: 1, seq: 1, busyAt: null, ...more })
const sentWord = (more = {}) => ({ ask: null, text: 'words', at: at(3), state: 'waiting', ...more })
const typed = (more = {}) => sentWord({ state: 'delivered', takenAt: at(2), deliveredAt: at(2) + 1000, ...more })

test('which actions have a place: the person\'s words only, never the board\'s own (the gate\'s refine, the supervisor\'s repeat, Autopilot\'s, a stop done in code)', () => {
  const to = 'Advisor'
  const person = command => ({ id: 'w', to, command, about: 'x', at: at(1), state: 'waiting' })
  assert.deepEqual(['refine', 'how-go', 'goal-ask', 'talk', 'brainstorm', 'brainstorm-answer', 'recheck', 'stop', 'remove'].map(command => isPersonWord(person(command))), Array(9).fill(true))
  assert.equal(isPersonWord({ ...person('refine'), board: true }), false, 'the gate\'s own refine word')
  assert.equal(isPersonWord({ ...person('refine'), isAuto: true }), false, 'Autopilot\'s refine word')
  assert.equal(isPersonWord({ ...person('refine'), syncKey: 'refine-again B1 2' }), false, 'the supervisor\'s repeat')
  assert.equal(isPersonWord({ ...person('stop'), byCode: true }), false, 'a stop the board does in code stays instant: no line')
  assert.equal(isPersonWord({ ...person('remove'), byCode: true }), false)
  assert.equal(isPersonWord(person('brainstorm-fix')), false, 'the board\'s own word to the partner')
  assert.equal(isPersonWord(person('judge')), false, 'the judge word has the incidents\' lines')
  const threads = [{ path: 'b/change.md', kind: 'change', goal: { id: 'G6' } }, { path: 'b/free.md', kind: null, goal: null }]
  assert.equal(placeOfWord(person('brainstorm'), { threads: [{ ...threads[0] }] }), 'talk', 'no thread known: the talk')
  assert.equal(placeOfWord({ ...person('brainstorm'), about: 'b/change.md' }, { threads }), 'change')
  assert.equal(placeOfWord({ ...person('brainstorm-understood'), about: 'b/change.md' }, { threads }), 'change')
  assert.equal(placeOfWord({ ...person('brainstorm'), about: 'b/free.md' }, { threads }), 'talk')
})

test('place 1, a refine: Sent, then on it, then Done "refined" once the step\'s block is written, also after the sweep dropped the word as no longer needed', () => {
  const advisor = lane('Advisor')
  const items = new Map([['B12', step('B12', 'new', at(60))]])
  const stepNow = refined => ({ id: 'B12', status: 'queued', refined })
  const base = { chats: [], supervisorChat: null, backlog: [{ steps: [stepNow(null)] }] }
  const word = { id: 'r1', to: 'Advisor', command: 'refine', about: 'B12', round: 1, before: null, ...sentWord() }
  const sent = waitsFor({ state: { ...base, advisor }, outbox: [word], items }).r1
  assert.deepEqual([sent.state, sent.lead, sent.rest, sent.place, sent.command, sent.about], ['sent', `Sent ${hhmm(at(3))}`, 'waits for Advisor to pick it up · next in its queue', 'refine', 'refine', 'B12'])
  // Taken by its chat, its turn on it: the loader.
  const onIt = waitsFor({ state: { ...base, advisor: working('Advisor') }, outbox: [{ ...word, ...typed() }], items, reports: new Map([['Advisor', said('busy', at(2), { word: 'r1', turn: at(2) })]]) }).r1
  assert.deepEqual([onIt.state, onIt.lead, onIt.rest], ['picked-up', 'Advisor is on it', `since ${hhmm(at(2))}`])
  // Its own result: the block shows the round it asked for. The step is refined now, so the sweep closed the word: still Done.
  const written = { round: 1, at: stamp(at(1)), by: 'Advisor', questions: [], asks: [], feedback: [], ready: false }
  const refinedItems = new Map([['B12', step('B12', 'refined', at(1))]])
  const done = waitsFor({ state: { ...base, advisor, backlog: [{ steps: [stepNow(written)] }] }, outbox: [{ ...word, ...typed(), state: 'dropped', why: 'the step is refined now, not new' }], items: refinedItems }).r1
  assert.deepEqual([done.state, done.lead, done.rest, done.seen?.doneWords], ['done', `Done ${hhmm(at(1))}`, 'refined', 'refined'])
  // A turn that ended with no block written says so quietly; a word kept as Done stays Done.
  const ended = waitsFor({ state: { ...base, advisor }, outbox: [{ ...word, ...typed() }], items, reports: new Map([['Advisor', said('idle', at(1), { word: 'r1', turn: at(2) })]]) }).r1
  assert.deepEqual([ended.state, ended.lead], ['sent', `Advisor's turn ended at ${hhmm(at(1))} without it`])
  const kept = waitsFor({ state: { ...base, advisor }, outbox: [{ ...word, ...typed(), state: 'dropped', doneAt: at(1), doneWords: 'refined' }], items: refinedItems }).r1
  assert.deepEqual([kept.state, kept.lead, kept.rest], ['done', `Done ${hhmm(at(1))}`, 'refined'])
  // The board's own refine word of the gate, and a plain dropped word with no result: no line.
  assert.deepEqual(Object.keys(waitsFor({ state: { ...base, advisor }, outbox: [{ ...word, board: true }], items })), [])
  assert.deepEqual(Object.keys(waitsFor({ state: { ...base, advisor }, outbox: [{ ...word, state: 'dropped' }], items })), [])
})

test('place 2, Go: Done once every work block of the goal has a task filed after the word, "<n> steps", linking the first', () => {
  const advisor = lane('Advisor')
  const node = steps => ({ id: 'G6', title: 'Garden', parts: [{ title: 'Beds', steps: steps[0] }, { title: 'Hedge', steps: steps[1] }], partsDropped: [] })
  const stateOf = steps => ({ chats: [], advisor, goals: { nodes: [node(steps)] } })
  const word = { id: 'g1', to: 'Advisor', command: 'how-go', about: 'G6', ...sentWord() }
  const items = new Map([['B1', step('B1', 'new', at(2), 'Goal: G6\n')], ['B2', step('B2', 'new', at(1), 'Goal: G6\n')], ['B0', step('B0', 'done', at(300), 'Goal: G6\n')]])
  const sent = waitsFor({ state: stateOf([[], []]), outbox: [word], items }).g1
  assert.deepEqual([sent.state, sent.rest, sent.place, sent.goal], ['sent', 'waits for Advisor to pick it up · next in its queue', 'go', 'G6'])
  assert.equal(waitsFor({ state: stateOf([['B1'], []]), outbox: [word], items }).g1.state, 'sent', 'one block still has no task')
  assert.equal(waitsFor({ state: stateOf([['B0'], []]), outbox: [word], items }).g1.state, 'sent', 'a block that had a task is carried; the one with none still waits for its task')
  assert.equal(waitsFor({ state: stateOf([['B0'], ['B0']]), outbox: [word], items }).g1.state, 'sent', 'every block carried and no task made after the word: nothing was done yet')
  assert.equal(waitsFor({ state: stateOf([['B404'], ['B2']]), outbox: [word], items }).g1.state, 'sent', 'a task the store does not hold yet is not filed, and breaks no line')
  const done = waitsFor({ state: stateOf([['B1'], ['B2']]), outbox: [word], items }).g1
  assert.deepEqual([done.state, done.lead, done.rest, done.link], ['done', `Done ${hhmm(at(1))}`, '2 steps', { step: 'B1', text: 'See B1 →' }])
  const onIt = waitsFor({ state: { ...stateOf([[], []]), advisor: working('Advisor') }, outbox: [{ ...word, ...typed() }], items, reports: new Map([['Advisor', said('busy', at(2), { word: 'g1', turn: at(2) })]]) }).g1
  assert.equal(onIt.lead, 'Advisor is on it')
})

test('place 2 in a next round (the review of 2026-11-04): Go is Done when each block that is open in the new round has a task made after the word; a block carried as done or kept does not count', () => {
  const advisor = lane('Advisor')
  const made = (id, madeAt, state = 'new') => step(id, state, madeAt, 'Goal: G6\n')
  const node = { id: 'G6', title: 'Garden', parts: [{ title: 'Beds', steps: ['B1'] }, { title: 'Hedge', steps: ['B9'] }, { title: 'Pond', steps: [] }], partsDropped: [] }
  const word = { id: 'g1', to: 'Advisor', command: 'how-go', about: 'G6', ...typed({ at: at(10), takenAt: at(9), deliveredAt: at(9) }) }
  const idle = new Map([['Advisor', said('idle', at(1), { word: 'g1', turn: at(9) })]])
  const items = new Map([['B1', made('B1', at(600), 'done')], ['B9', made('B9', at(1))]])
  // The review's probe: Beds kept its round-1 task, Hedge got a new one. Pond has none yet, so it is not Done.
  assert.equal(waitsFor({ state: { chats: [], advisor, goals: { nodes: [node] } }, outbox: [word], items, reports: idle }).g1.state, 'sent', 'Pond still waits for its task')
  const two = { ...node, parts: node.parts.slice(0, 2) }
  const done = waitsFor({ state: { chats: [], advisor, goals: { nodes: [two] } }, outbox: [word], items, reports: idle }).g1
  assert.deepEqual([done.state, done.lead, done.rest], ['done', `Done ${hhmm(at(1))}`, '1 step'])
  // The state says which blocks are open in the round (focus.openNow, by their place in the goal's parts): Pond is carried, it is none.
  const focus = { id: 'G6', openNow: [{ index: 1, title: 'Hedge', kind: 'new' }] }
  assert.equal(waitsFor({ state: { chats: [], advisor, goals: { nodes: [node] }, focus }, outbox: [word], items, reports: idle }).g1.state, 'done')
  // Every block carried and no task made after the word: nothing done yet.
  assert.equal(waitsFor({ state: { chats: [], advisor, goals: { nodes: [{ ...two, parts: [two.parts[0], { title: 'Hedge', steps: ['B1'] }] }] } }, outbox: [word], items: new Map([['B1', items.get('B1')]]), reports: idle }).g1.state, 'sent')
})

test('place 3, Change this goal: only a new goal-definition draft, written after the word (full date-times), is Done; a next question or what it understood is progress, "<Partner> answered: ..."; a talk that is no change has no result of its own', () => {
  const advisor = lane('Advisor')
  // The thread's lines carry HH:MM only; it began an hour ago, on the same day.
  const thread = (more = {}) => ({ path: 'brainstorms/change.md', kind: 'change', goal: { id: 'G6', title: 'Garden' }, started: stamp(at(60)), latest: null, earlier: [], understood: null, proposal: null, ...more })
  const stateOf = threads => ({ chats: [], advisor, brainstorms: { threads } })
  const word = { id: 'c1', to: 'Advisor', command: 'brainstorm', about: 'brainstorms/change.md', ...sentWord() }
  const sent = waitsFor({ state: stateOf([thread()]), outbox: [word] }).c1
  assert.deepEqual([sent.state, sent.rest, sent.place, sent.goal], ['sent', 'waits for Advisor to pick it up · next in its queue', 'change', 'G6'])
  const draft = waitsFor({ state: stateOf([thread({ proposal: { at: hhmm(at(1)), objective: 'Plant the hedge', created: null } })]), outbox: [word] }).c1
  assert.deepEqual([draft.state, draft.lead, draft.rest], ['done', `Done ${hhmm(at(1))}`, 'new definition'])
  assert.equal(waitsFor({ state: stateOf([thread({ proposal: { at: hhmm(at(10)), objective: 'Old draft', created: null } })]), outbox: [word] }).c1.state, 'sent', 'a draft from before the word is no result of it')
  assert.equal(waitsFor({ state: stateOf([thread({ proposal: { at: hhmm(at(3)), objective: 'Same minute', created: null } })]), outbox: [word] }).c1.state, 'sent', 'nor one of the word\'s own minute')
  assert.equal(waitsFor({ state: stateOf([thread({ proposal: { at: hhmm(at(1)), objective: '', created: null } })]), outbox: [word] }).c1.state, 'sent', 'a proposal with no objective is no new definition')
  // A time still to come (a draft stamped later than now): never Done.
  assert.equal(waitsFor({ state: stateOf([thread({ proposal: { at: '23:59', objective: 'Later', created: null } })]), outbox: [word] }).c1.state, 'sent')
  // Progress, not a result: the next question or what it understood, written after the word and not answered yet.
  const question = waitsFor({ state: stateOf([thread({ latest: { n: 1, at: hhmm(at(1)), answer: null } })]), outbox: [word] }).c1
  assert.deepEqual([question.state, question.lead, question.rest, question.isFallback], ['done', `Advisor answered ${hhmm(at(1))}`, 'a question for you', true])
  const understood = waitsFor({ state: stateOf([thread({ understood: { at: hhmm(at(1)), text: 'x', answer: null, after: 0 } })]), outbox: [word] }).c1
  assert.deepEqual([understood.state, understood.lead, understood.rest], ['done', `Advisor answered ${hhmm(at(1))}`, 'what it understood, for your yes'])
  // The review's probe: the person answers a question the partner asked yesterday at 18:00, the same minute or later: never Done, no progress.
  const yesterday = thread({ started: stamp(at(60 * 18)), latest: { n: 2, at: '18:00', answer: { key: 'A' } }, earlier: [] })
  assert.equal(waitsFor({ state: stateOf([yesterday]), outbox: [{ ...word, command: 'brainstorm-answer' }] }).c1.state, 'sent', 'the question answered is not a new one')
  const sameMinute = thread({ latest: { n: 2, at: hhmm(at(3)), answer: { key: 'A' } } })
  assert.equal(waitsFor({ state: stateOf([sameMinute]), outbox: [{ ...word, command: 'brainstorm-answer' }] }).c1.state, 'sent')
  const yes = thread({ latest: null, understood: { at: hhmm(at(3)), text: 'x', answer: { yes: true }, after: 0 } })
  assert.equal(waitsFor({ state: stateOf([yes]), outbox: [{ ...word, command: 'brainstorm-understood' }] }).c1.state, 'sent', 'the yes to what it understood is not its next stage')
  // Past midnight: the thread began at 23:50, the partner's draft is stamped 00:10 (the next day), the word was sent at 00:05.
  const late = new Date(2026, 10, 4, 0, 20).getTime()
  const midnight = thread({ started: '2026-11-03 23:50', latest: { n: 1, at: '23:55', answer: { key: 'A' } }, proposal: { at: '00:10', objective: 'After midnight', created: null } })
  const ofMidnight = waitsOf({ state: stateOf([midnight]), outbox: [{ ...word, at: new Date(2026, 10, 4, 0, 5).getTime() }], now: late, keep, judge: wordJudge({ state: stateOf([midnight]), items: new Map(), outbox: [], settings: {}, now: late }), items: new Map() }).c1
  assert.deepEqual([ofMidnight.state, ofMidnight.rest], ['done', 'new definition'])
  // A brainstorm that changes no goal: the Focus talk, no result of its own.
  const free = thread({ kind: null, latest: { n: 1, at: hhmm(at(1)), answer: null } })
  const talk = waitsFor({ state: stateOf([free]), outbox: [word], reports: new Map([['Advisor', said('idle', at(1), { word: 'c1', turn: at(2) })]]) })
  assert.equal(talk.c1.place, 'talk')
  assert.equal(talk.c1.state, 'sent', 'its question is no "Done" of a talk with no result of its own')
  const answered = waitsFor({ state: stateOf([free]), outbox: [{ ...word, ...typed() }], reports: new Map([['Advisor', said('idle', at(1), { word: 'c1', turn: at(2) })]]) }).c1
  assert.deepEqual([answered.state, answered.lead, answered.isFallback], ['done', `Advisor answered ${hhmm(at(1))}`, true])
})

test('place 4, a goal ask: Done when the partner\'s answer stands under that goal, "answered under G<n>"', () => {
  const advisor = lane('Advisor')
  const goal = answer => ({ id: 'G6', title: 'Garden', asks: [{ id: 'A1', at: stamp(at(5)), text: 'why?', answer }], parts: [] })
  const word = { id: 'a1', to: 'Advisor', command: 'goal-ask', goal: 'G6', about: 'A1', ...sentWord() }
  const sent = waitsFor({ state: { chats: [], advisor, goals: { nodes: [goal(null)] } }, outbox: [word] }).a1
  assert.deepEqual([sent.state, sent.rest, sent.place, sent.goal, sent.about], ['sent', 'waits for Advisor to pick it up · next in its queue', 'goal-ask', 'G6', 'A1'])
  const done = waitsFor({ state: { chats: [], advisor, goals: { nodes: [goal({ at: stamp(at(1)), by: 'Advisor', text: 'because', more: null })] } }, outbox: [word] }).a1
  assert.deepEqual([done.state, done.lead, done.rest], ['done', `Done ${hhmm(at(1))}`, 'answered under G6'])
  const onIt = waitsFor({ state: { chats: [], advisor: working('Advisor'), goals: { nodes: [goal(null)] } }, outbox: [{ ...word, ...typed() }], reports: new Map([['Advisor', said('busy', at(2), { word: 'a1', turn: at(2) })]]) }).a1
  assert.equal(onIt.lead, 'Advisor is on it')
})

test('place 5, Overturn: the answer to an overturned recap is Done once the fix step made from the words stands, linked', () => {
  const advisor = lane('Advisor')
  const recap = about => item(`Id: N1\nKind: note\nTitle: recap\nState: read\nRecap: overturned\nSince: ${stamp(at(3))}\n\n## About\n${about}\n`)
  const word = { ...sentWord(), id: 'o1', to: 'Advisor', ask: 'work:N1', step: 'N1' }
  const fix = made => step('B30', 'new', made, 'Fix of: B12\n')
  const state = { chats: [], advisor }
  const sent = waitsFor({ state, outbox: [word], items: new Map([['N1', recap('B12')]]) }).o1
  assert.deepEqual([sent.state, sent.place, sent.command], ['sent', 'overturn', 'answer'])
  assert.equal(waitsFor({ state, outbox: [word], items: new Map([['N1', recap('B12')], ['B30', fix(at(60))]]) }).o1.state, 'sent', 'a fix from before the Overturn')
  const done = waitsFor({ state, outbox: [word], items: new Map([['N1', recap('B12')], ['B30', fix(at(1))]]) }).o1
  assert.deepEqual([done.state, done.lead, done.rest, done.link], ['done', `Done ${hhmm(at(1))}`, 'B30', { step: 'B30', text: 'See B30 →' }])
  // A goal's recap (the review of 2026-11-04): only a step made from the person's overturn words, naming the recap or holding their words,
  // never any step of the goal.
  const goalRecap = item(`Id: N1\nKind: note\nTitle: recap\nState: read\nRecap: overturned\nSince: ${stamp(at(3))}\n\n## About\nG6\n\n## Answer\nthe path is too dark near the pond\n`)
  const other = step('B31', 'new', at(1), 'Goal: G6\n')
  assert.equal(waitsFor({ state, outbox: [word], items: new Map([['N1', goalRecap], ['B31', other]]) }).o1.state, 'sent', 'a step of the goal made for something else is no result of the overturn')
  const fromWords = item(`Id: B32\nKind: step\nTitle: Light the path near the pond\nState: new\nGoal: G6\nSince: ${stamp(at(1))}\n\n## Summary\nThe path is too dark near the pond.\n\n## History\n- ${stamp(at(1))} made\n`)
  assert.equal(waitsFor({ state, outbox: [word], items: new Map([['N1', goalRecap], ['B31', other], ['B32', fromWords]]) }).o1.rest, 'B32', 'a step holding their words')
  const names = item(`Id: B33\nKind: step\nTitle: Another try\nState: new\nGoal: G6\nSince: ${stamp(at(1))}\n\n## Context\nFrom the overturn of N1.\n\n## History\n- ${stamp(at(1))} made\n`)
  assert.equal(waitsFor({ state, outbox: [word], items: new Map([['N1', goalRecap], ['B33', names]]) }).o1.rest, 'B33', 'a step naming the recap')
  // An answer to something that is no recap stays an answer, the fallback.
  assert.equal(waitsFor({ state, outbox: [{ ...word, ask: 'work:Q5' }], items: new Map() }).o1.place, 'answer')
})

test('place 6, Stop or Remove a worker: Done when its lane is stopped, or gone; a stop the board does in code has no line', () => {
  const lead = lane('Lead')
  const worker = more => lane('Worker 2', { task: { text: 'dig', step: 1, steps: 2 }, state: 'working', status: 'Working', ...more })
  const stop = { id: 's1', to: 'Lead', command: 'stop', about: 'Worker 2', text: 'stop task', ...sentWord() }
  const remove = { id: 'm1', to: 'Lead', command: 'remove', about: 'Worker 2', text: 'remove worker', ...sentWord({ at: at(4) }) }
  const sent = waitsFor({ state: { chats: [lead, worker()], advisor: null }, outbox: [stop, remove] })
  assert.deepEqual([sent.s1.state, sent.s1.rest, sent.s1.place, sent.s1.about], ['sent', 'waits for Lead to pick it up · 2nd in its queue', 'worker', 'Worker 2'])
  assert.equal(sent.m1.rest, 'waits for Lead to pick it up · next in its queue')
  const stopped = waitsFor({ state: { chats: [lead, worker({ task: null, state: 'free', status: 'Free' })], advisor: null }, outbox: [stop] }).s1
  assert.deepEqual([stopped.state, stopped.rest], ['done', 'stopped'])
  const gone = waitsFor({ state: { chats: [lead], advisor: null }, outbox: [remove] }).m1
  assert.deepEqual([gone.state, gone.rest], ['done', 'removed'])
  const removedAt = at(1)
  assert.equal(waitsFor({ state: { chats: [lead, worker({ removedAt })], advisor: null }, outbox: [remove] }).m1.lead, `Done ${hhmm(removedAt)}`, 'its lane says it was removed')
  assert.deepEqual(Object.keys(waitsFor({ state: { chats: [lead, worker()], advisor: null }, outbox: [{ ...stop, byCode: true }] })), [])
})

test('place 6 (the review of 2026-11-04): a stop is Done when the lane no longer holds the task it was told to stop; a code stop handed to the main chat after STOP_HANDS_MS has its line', () => {
  const lead = lane('Lead')
  const worker = more => lane('Worker 2', { task: { stepId: 'B12', text: 'dig' }, state: 'working', status: 'Working', ...more })
  const stop = { id: 's1', to: 'Lead', command: 'stop', about: 'Worker 2', text: 'stop task', taskStep: 'B12', taskText: 'dig', laneState: 'working', ...typed({ at: at(20), takenAt: at(19), deliveredAt: at(19) }) }
  const stateOf = w => ({ chats: [lead, w], advisor: null })
  const idle = new Map([['Lead', said('idle', at(10), { word: 's1', turn: at(19) })]])
  const lineOf = (w, word = stop) => waitsFor({ state: stateOf(w), outbox: [word], reports: idle }).s1
  assert.equal(lineOf(worker()).state, 'late', 'the worker still holds the task: the main chat\'s turn ended 10 minutes ago without it (P3: Late after 5 min)')
  // The review's probe: the task is gone but the worker is not "free" (off, suspended, interrupted): it holds nothing.
  for (const state of ['off', 'suspended', 'interrupted', 'free']) assert.deepEqual([state, lineOf(worker({ task: null, state })).state], [state, 'done'])
  // The task changed (a short free moment was missed, the worker took another): done.
  assert.equal(lineOf(worker({ task: { stepId: 'B13', text: 'water' } })).rest, 'stopped')
  assert.equal(lineOf(worker({ task: { stepId: null, text: 'water' } }), { ...stop, taskStep: undefined }).rest, 'stopped', 'a task with no id is told by its words')
  // It was working when told and now does not work (no longer running the task): done; one that waits for the person still holds it.
  assert.equal(lineOf(worker({ state: 'suspended' })).state, 'done')
  assert.equal(lineOf(worker({ state: 'waiting' })).state, 'late', 'P3: the turn ended 10 min ago without it')
  assert.equal(lineOf(worker({ state: 'suspended' }), { ...stop, laneState: 'waiting' }).state, 'late', 'it was not working when told: only the task decides (its turn ended without it)')
  // A word from before the board named the task: the task gone is the result.
  assert.equal(lineOf(worker({ task: null, state: 'suspended' }), { ...stop, taskStep: undefined, taskText: undefined, laneState: undefined }).state, 'done')
  // A stop or remove the board carries out by code has no line for STOP_HANDS_MS (15 min); the main chat that takes it after all gets one.
  const code = { ...stop, byCode: true, state: 'waiting', takenAt: undefined, deliveredAt: undefined }
  assert.deepEqual(Object.keys(waitsFor({ state: stateOf(worker()), outbox: [{ ...code, at: at(14) }] })), [], 'instant: the worker\'s mod tells it')
  assert.deepEqual(Object.keys(waitsFor({ state: stateOf(worker()), outbox: [{ ...code, at: at(16) }] })), ['s1'], 'handed to the main chat after 15 minutes')
  assert.deepEqual(Object.keys(waitsFor({ state: stateOf(worker()), outbox: [{ ...code, at: at(16), state: 'dropped' }] })), [], 'one the board settled itself has none')
  const removeByCode = { id: 'm1', to: 'Lead', command: 'remove', about: 'Worker 2', text: 'remove worker', byCode: true, ...sentWord({ at: at(20) }) }
  assert.equal(waitsFor({ state: stateOf(worker()), outbox: [removeByCode] }).m1.place, 'worker')
  // Each word keeps its own line, by its id (a stop and a remove of one worker).
  const both = waitsFor({ state: stateOf(worker()), outbox: [stop, { id: 'm2', to: 'Lead', command: 'remove', about: 'Worker 2', text: 'remove worker', ...sentWord({ at: at(2) }) }], reports: idle })
  assert.deepEqual(Object.keys(both).sort(), ['m2', 's1'])
})

test('a result with no time of its own (a stop, a remove) is dated by the first moment the board saw it, kept, never by the clock of each draw', () => {
  const lead = lane('Lead')
  const stop = { id: 's1', to: 'Lead', command: 'stop', about: 'Worker 2', text: 'stop task', ...sentWord() }
  const state = { chats: [lead, lane('Worker 2', { task: null })], advisor: null }
  const firstSeen = new Map()
  const judge = wordJudge({ state, items: new Map(), outbox: [stop], settings: {}, now: NOW })
  const read = now => waitsOf({ state, outbox: [stop], now, keep, judge, items: new Map(), firstSeen }).s1
  const first = read(NOW)
  assert.equal(first.lead, `Done ${hhmm(NOW)}`)
  const later = read(NOW + 7 * MIN)
  assert.deepEqual([later.lead, later.at], [first.lead, first.at], 'seen again 7 minutes later: still the first moment')
  // A word that left the outbox is forgotten.
  waitsOf({ state, outbox: [], now: NOW + 8 * MIN, keep, judge, items: new Map(), firstSeen })
  assert.equal(firstSeen.size, 0)
})

test('place 7, the Focus talk: the talk bar, "Re-check the goals now" and the Not yet words have the fallback only: "<Chat> answered", never Done with a result', () => {
  const advisor = lane('Advisor')
  const state = { chats: [], advisor, goals: { nodes: [] } }
  const words = [{ id: 't1', command: 'talk', about: 'G6' }, { id: 't2', command: 'recheck', about: null }, { id: 't3', command: 'vibe-not-yet', about: 'G6' }]
    .map((one, index) => ({ to: 'Advisor', ...sentWord({ at: at(6 - index) }), ...one }))
  const sent = waitsFor({ state, outbox: words })
  assert.deepEqual(words.map(one => [sent[one.id].place, sent[one.id].state]), [['talk', 'sent'], ['talk', 'sent'], ['talk', 'sent']])
  assert.deepEqual([sent.t1.goal, sent.t2.goal, sent.t3.goal], ['G6', null, 'G6'])
  const answered = waitsFor({ state, outbox: [{ ...words[0], ...typed() }], reports: new Map([['Advisor', said('idle', at(1), { word: 't1', turn: at(2) })]]) }).t1
  assert.deepEqual([answered.state, answered.lead, answered.isFallback], ['done', `Advisor answered ${hhmm(at(1))}`, true])
})

test('place 8, an incident that waits for the Supervisor\'s judgment: a line of its own each, Done when the incident ended (judged, fixed, gone by itself) or got a fix step', () => {
  const supervisor = lane('Supervisor')
  const incident = (id, state, since, more = '') => item(`Id: ${id}\nKind: incident\nTitle: something broke ${id}\nState: ${state}\nSource: watch\nCount: 1\nSince: ${stamp(since)}\n${more}\n## History\n- ${stamp(since)} board: opened\n`)
  const judgeWord = { id: 'j1', to: 'Supervisor', command: 'judge', kind: 'judge', about: 'X1 X2 X3 X4 X5', incidents: ['X1', 'X2', 'X3', 'X4', 'X5'], text: 'judge', ...sentWord({ at: at(10) }) }
  const items = new Map([
    ['X1', incident('X1', 'closed', at(2))], ['X2', incident('X2', 'gone', at(1))], ['X3', incident('X3', 'fix', at(3), 'Fix: B40\n')],
    ['X4', incident('X4', 'came back', at(1))], ['X5', incident('X5', 'with the supervisor', at(9))],
  ])
  const state = { chats: [], advisor: null, supervisorChat: supervisor }
  const lines = waitsFor({ state, outbox: [judgeWord], items })
  assert.deepEqual(Object.keys(lines).sort(), ['j1#X1', 'j1#X2', 'j1#X3', 'j1#X5'], 'X4 came back after the word: it waits for the next one')
  assert.deepEqual([lines['j1#X1'].state, lines['j1#X1'].lead, lines['j1#X1'].rest], ['done', `Done ${hhmm(at(2))}`, 'false alarm: no fault left'])
  assert.deepEqual([lines['j1#X2'].lead, lines['j1#X2'].rest], [`Done ${hhmm(at(1))}`, 'went by itself'])
  assert.deepEqual([lines['j1#X3'].rest, lines['j1#X3'].link], ['fix step B40', { step: 'B40', text: 'See B40 →' }])
  assert.deepEqual([lines['j1#X5'].state, lines['j1#X5'].place, lines['j1#X5'].about, lines['j1#X5'].command, lines['j1#X5'].word], ['sent', 'judge', 'X5', 'judge', 'j1'])
  assert.equal(lines['j1#X5'].lead, `Sent ${hhmm(at(10))}`, 'the clock is the word\'s: an incident that is counted again moves nothing')
  assert.equal(lines['j1#X1'].seen, null, 'an incident\'s end is the store\'s: no result kept on the word that covers many')
  // Fixed by its fix step (code's rule, or the Supervisor's verdict): Done, linked.
  const fixed = waitsFor({ state, outbox: [judgeWord], items: new Map([['X1', incident('X1', 'fixed', at(1), 'Fix: B40\n')]]) })['j1#X1']
  assert.deepEqual([fixed.rest, fixed.link?.step], ['fixed by B40', 'B40'])
  // On it: the word's own state and the mod's `report.word`, never the Supervisor's pill (its lane is Free here).
  const onIt = waitsFor({ state, outbox: [{ ...judgeWord, ...typed({ at: at(10) }) }], items: new Map([['X5', items.get('X5')]]), reports: new Map([['Supervisor', said('busy', at(2), { word: 'j1', turn: at(2) })]]) })['j1#X5']
  assert.deepEqual([onIt.state, onIt.lead, onIt.rest], ['picked-up', 'Supervisor is on it', `since ${hhmm(at(2))}`])
  // Its turn ended (the word's `endedAt`) and the incident still waits: it says so, quietly.
  const ended = waitsFor({ state, outbox: [{ ...judgeWord, ...typed({ at: at(10) }), endedAt: at(1) }], items: new Map([['X5', items.get('X5')]]) })['j1#X5']
  assert.deepEqual([ended.state, ended.lead], ['sent', `Supervisor's turn ended at ${hhmm(at(1))} without it`])
  // A later turn of its chat on another word never ends the judgment ("answered by" is for the words that have no turn of their own).
  const later = waitsFor({ state, outbox: [{ ...judgeWord, ...typed({ at: at(10), takenAt: at(8), deliveredAt: at(8) }) }], items: new Map([['X5', items.get('X5')]]), reports: new Map([['Supervisor', said('busy', at(1), { word: 'other', turn: at(2) })]]) })['j1#X5']
  assert.deepEqual([later.state, later.lead], ['sent', `Sent ${hhmm(at(10))}`])
  // The newest word that lists an incident is its line; one moot word the sweep dropped keeps its Done.
  const newer = { ...judgeWord, id: 'j2', incidents: ['X5'], about: 'X5', ...sentWord({ at: at(4) }) }
  assert.deepEqual(Object.keys(waitsFor({ state, outbox: [judgeWord, newer], items: new Map([['X5', items.get('X5')]]) })), ['j2#X5'])
  const dropped = waitsFor({ state, outbox: [{ ...judgeWord, state: 'dropped', why: 'none of them waits any more' }], items })
  assert.equal(dropped['j1#X1'].state, 'done')
  assert.equal(dropped['j1#X5']?.place, 'judge', 'the incident still waits: its line stands, whatever became of the word that names it (the review of 2026-11-04)')
  // The review's probe: a NEWER judge word that does not name the incident never ends its line; the line reads from the newest word that names it.
  const older = { ...judgeWord, id: 'j1', incidents: ['X1'], about: undefined, ...typed({ at: at(60), takenAt: at(59), deliveredAt: at(59) }), endedAt: at(50) }
  const elsewhere = { ...judgeWord, id: 'j2', incidents: ['X2'], about: undefined, ...typed({ at: at(5), takenAt: at(4), deliveredAt: at(4) }) }
  const waiting = new Map([['X1', incident('X1', 'with the supervisor', at(59))], ['X2', incident('X2', 'with the supervisor', at(4))]])
  const both = waitsFor({ state, outbox: [older, elsewhere], items: waiting })
  assert.deepEqual(Object.keys(both).sort(), ['j1#X1', 'j2#X2'])
  // The review of 2026-11-09 (1): a judge line stays quiet when its turn ended without the judgment, as before P3.
  assert.deepEqual([both['j1#X1'].state, both['j1#X1'].lead], ['sent', `Supervisor's turn ended at ${hhmm(at(50))} without it`])
  // Once judged (or ended by code) it is Done, whichever word names it.
  const judged = waitsFor({ state, outbox: [older, elsewhere], items: new Map([['X1', incident('X1', 'closed', at(1))], ['X2', waiting.get('X2')]]) })
  assert.deepEqual([judged['j1#X1'].state, judged['j1#X1'].rest], ['done', 'false alarm: no fault left'])
})

test('every place: the word taken by its chat while its turn on it runs reads "<Chat> is on it · since <the turn>"', () => {
  const advisor = working('Advisor')
  const lead = working('Lead')
  const recap = item(`Id: N1\nKind: note\nTitle: recap\nState: read\nRecap: overturned\nSince: ${stamp(at(3))}\n\n## About\nB12\n`)
  const cases = [
    { name: 'refine', chat: 'Advisor', word: { command: 'refine', about: 'B12', round: 1 }, state: { chats: [], advisor, backlog: [{ steps: [{ id: 'B12', refined: null }] }] }, items: new Map([['B12', step('B12', 'new', at(60))]]) },
    { name: 'go', chat: 'Advisor', word: { command: 'how-go', about: 'G6' }, state: { chats: [], advisor, goals: { nodes: [{ id: 'G6', parts: [{ title: 'Beds', steps: [] }], partsDropped: [] }] } } },
    { name: 'change', chat: 'Advisor', word: { command: 'brainstorm', about: 'b/change.md' }, state: { chats: [], advisor, brainstorms: { threads: [{ path: 'b/change.md', kind: 'change', goal: { id: 'G6' }, latest: null, understood: null, proposal: null }] } } },
    { name: 'goal-ask', chat: 'Advisor', word: { command: 'goal-ask', goal: 'G6', about: 'A1' }, state: { chats: [], advisor, goals: { nodes: [{ id: 'G6', asks: [{ id: 'A1', answer: null }], parts: [] }] } } },
    { name: 'overturn', chat: 'Advisor', word: { ask: 'work:N1', step: 'N1' }, state: { chats: [], advisor }, items: new Map([['N1', recap]]) },
    { name: 'worker', chat: 'Lead', word: { command: 'stop', about: 'Worker 2' }, state: { chats: [lead, working('Worker 2', { task: { text: 'dig' } })], advisor: null } },
    { name: 'talk', chat: 'Advisor', word: { command: 'talk', about: 'G6' }, state: { chats: [], advisor } },
  ]
  for (const one of cases) {
    const word = typed({ id: 'w1', to: one.chat, takenAt: at(2), deliveredAt: at(2) + 1000, ...one.word })
    const line = waitsFor({ state: one.state, outbox: [word], items: one.items ?? new Map(), reports: new Map([[one.chat, said('busy', at(2) + 500, { word: 'w1', turn: at(2) + 500 })]]) }).w1
    assert.deepEqual([one.name, line?.place, line?.state, line?.lead, line?.rest], [one.name, one.name === 'overturn' ? 'overturn' : one.name, 'picked-up', `${one.chat} is on it`, `since ${hhmm(at(2) + 500)}`])
  }
})
