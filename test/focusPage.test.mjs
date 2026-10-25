// Focus 1 (spec 2026-10-18, section 4): the Focus part of the tab, drawn read-only from goals.md for each stage: pick,
// the vibe, the how, the run, done. The state's `focus` and the page's view models run here without the page; made-up
// names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseConfig } from '../src/config.mjs'
import { focusState } from '../src/state.mjs'
import { parseGoals } from '../src/goals.mjs'
import { brainstormsState } from '../src/brainstorm.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const css = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
${script.slice(script.indexOf('// coordinate:start'), script.indexOf('// coordinate:end'))}
Object.assign(this, { advisorPartsShown, coordinateList, focusAsk, focusCan, focusTalk, focusView, goalStepIds })`, made)
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const page = Object.fromEntries(Object.entries(made).map(([name, made]) => [name, (...args) => plain(made(...args))]))

const NOW = new Date(2026, 9, 18, 12, 0).getTime()
const BACKLOG = [
  '## Art',
  '- [x] B10 Draw the bench (for Units)',
  '- [x] B11 Shade the bench (for Units)',
  '- [x] B12 Place the benches (for Units)',
  '- [ ] B13 Light the path (for Features) (branch feature/light)',
  '- [x] B14 Paint the lamps (for Features)',
  '- [ ] B15 Look at the garden',
  '- [ ] B16 Sweep the path',
  '',
].join('\n')
const head = 'Last id: G4\nFocus: G2\n\n'
const G2 = [
  '- [~] G1 A garden people visit',
  '  - [~] G2 Benches that feel like home',
  '    Steps: B16',
  '    Brainstorm: talks/2026-10-18-benches.md (running)',
  '    Vibe: you sit down without thinking',
  '    Vibe: warm wood, never metal',
  '    Vibe picture: pictures/bench.png',
]
const AGREED = ['    Vibe agreed: 2026-10-18 10:00']
const HOW = [
  '    Part: Draw the bench · about 1 h · steps B10, B11',
  '    Part: Light the path · 2 h · steps B13, B14',
  '    Part: Place them · 30 min · steps B12',
  '    Part: One look at the whole garden · 1 h · steps B15',
  '    Partner decides: the wood\'s colour',
  '    You decide: how many benches',
]
const RUN = ['    How agreed: 2026-10-18 11:00']
const REST = ['    - [ ] G3 A bench by the pond', '      Steps: B12', '- [ ] G4 Lanterns', '- [x] G5 The gate', '']
const map = (...parts) => `${head}${[...G2, ...parts.flat(), ...REST].join('\n')}`
const THREAD = '# Brainstorm: Benches\nGoal: G2 Benches that feel like home\nStarted: 2026-10-18 09:00 · State: running\nOpening: I want benches people love\n\n## Q1 (09:01)\nWhen it is done, what should sitting feel like?\n\nAnswer (09:02): Other — like home, warm wood\n\n## Q2 (09:03)\nIs the lamp part of it?\n- A: yes (advised)\n- B: no\nAnswer (09:04): B — only the benches\n\n## Q3 (09:05)\nAnything else?\n'
const threads = brainstormsState([{ path: 'talks/2026-10-18-benches.md', text: THREAD, at: 1 }], 'talks').threads
const store = storeFromText(BACKLOG, { now: NOW })
const stateOf = text => focusState(parseGoals(text), [...store.items.values()], threads, 'Game - ')

test('the state\'s focus: the goal, its stage, its lines, its thread; null without one or with one that is gone', () => {
  const vibe = stateOf(map())
  assert.deepEqual([vibe.id, vibe.title, vibe.stage, vibe.vibe, vibe.vibePicture, vibe.vibeAgreed, vibe.thread], ['G2', 'Benches that feel like home', 'vibe', ['you sit down without thinking', 'warm wood, never metal'], 'pictures/bench.png', null, 'talks/2026-10-18-benches.md'])
  assert.equal(stateOf(map(AGREED)).stage, 'how')
  assert.equal(stateOf(map(AGREED, HOW, RUN)).stage, 'run')
  assert.equal(stateOf(map().replace('- [~] G2', '- [x] G2')).stage, 'done')
  // Review Focus 1: no Focus line, or one naming a goal that is gone: no focus, never an error.
  assert.equal(stateOf(map().replace('Focus: G2\n', '')), null)
  assert.equal(stateOf(map().replace('Focus: G2', 'Focus: G9')), null)
  assert.equal(focusState(null, [], [], ''), null)
})

test('each part\'s progress follows its steps in the store: done, in progress with its owner, next; the whole as parts done', () => {
  const run = stateOf(map(AGREED, HOW, RUN))
  assert.deepEqual(run.parts, [
    { title: 'Draw the bench', size: 'about 1 h', state: 'done', owner: null, done: 2, total: 2, standards: [], checked: [] },
    { title: 'Light the path', size: '2 h', state: 'now', owner: 'Features', done: 1, total: 2, standards: [], checked: [] },
    { title: 'Place them', size: '30 min', state: 'done', owner: null, done: 1, total: 1, standards: [], checked: [] },
    // Redesign Part 2: its step is made but not refined yet: it waits for its refine, then goes on the list.
    { title: 'One look at the whole garden', size: '1 h', state: 'refining', owner: null, done: 0, total: 1, standards: [], checked: [] },
  ])
  assert.deepEqual(run.progress, { done: 2, total: 4, minutesLeft: 180 })
  assert.deepEqual([run.partnerDecides, run.youDecide], [['the wood\'s colour'], ['how many benches']])
  // A part without steps is next; sizes nobody can read leave the time out.
  const bare = stateOf(map(AGREED, ['    Part: Something · soon'], RUN))
  assert.deepEqual(bare.parts, [{ title: 'Something', size: 'soon', state: 'next', owner: null, done: 0, total: 0, standards: [], checked: [] }])
  assert.deepEqual(bare.progress, { done: 0, total: 1, minutesLeft: null })
})

test('Focus 2, the review\'s findings: a part whose step is in review is in progress, with its owner', () => {
  const reviewed = storeFromText(BACKLOG, { now: NOW })
  const step = reviewed.items.get('B15')
  step.head.set('State', 'review')
  step.head.set('Owner', 'Game - Checks')
  const run = focusState(parseGoals(map(AGREED, HOW, RUN)), [...reviewed.items.values()], threads, 'Game - ')
  assert.deepEqual(run.parts[3], { title: 'One look at the whole garden', size: '1 h', state: 'now', owner: 'Checks', done: 0, total: 1, standards: [], checked: [] })
})

test('the buildState answer carries the focus and the setting advisorParts', () => {
  const config = { ...parseConfig('{}', {}), project: 'C:\\garden' }
  const state = buildState({ listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: [], tails: {}, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, goalsText: map(AGREED), threadTexts: [{ path: 'talks/2026-10-18-benches.md', text: THREAD, at: 1 }] }, { outbox: [], now: NOW, config: { ...config, brainstorms: 'talks' } })
  assert.equal(state.focus.id, 'G2')
  assert.equal(state.focus.stage, 'how')
  assert.equal(state.focus.thread, 'talks/2026-10-18-benches.md')
  assert.deepEqual(state.advisorParts, ['focus', 'goals', 'brainstorm'])
})

const goalsOf = text => {
  const goals = parseGoals(text)
  return { roots: goals.roots, nodes: goals.nodes }
}

test('the head and the stage strip for each stage, as the mockups draw them', () => {
  const vibe = page.focusView(stateOf(map()), goalsOf(map()))
  assert.equal(vibe.stage, 'vibe')
  assert.deepEqual(vibe.head, { label: 'Your focus', id: 'G2', title: 'Benches that feel like home', vibeLine: null })
  assert.deepEqual(vibe.strip, [{ n: 1, label: 'The goal', state: 'now' }, { n: 2, label: 'The how', state: 'next' }, { n: 3, label: 'The run', state: 'next' }])
  assert.equal(vibe.progress, null)
  assert.deepEqual(vibe.vibe, { title: 'The vibe so far', sub: 'draft, written by your partner', lines: ['you sit down without thinking', 'warm wood, never metal'], picture: 'pictures/bench.png', empty: null })
  // Read-only (no partner, or a board that only shows): drawn, off, with why.
  assert.deepEqual(vibe.buttons.map(one => [one.label, one.isEnabled]), [['This is the goal definition', false], ['Not yet', false]])
  assert.ok(vibe.buttons.every(one => one.title === 'This board only shows.'))
  const how = page.focusView(stateOf(map(AGREED, HOW)), goalsOf(map()))
  assert.equal(how.stage, 'how')
  assert.equal(how.head.vibeLine, 'you sit down without thinking · warm wood, never metal')
  assert.deepEqual(how.strip.map(one => one.state), ['done', 'now', 'next'])
  assert.deepEqual(how.how.parts, [{ title: 'Draw the bench', size: 'about 1 h' }, { title: 'Light the path', size: '2 h' }, { title: 'Place them', size: '30 min' }, { title: 'One look at the whole garden', size: '1 h' }])
  assert.deepEqual([how.how.partnerDecides, how.how.youDecide], [['the wood\'s colour'], ['how many benches']])
  assert.deepEqual(how.buttons.map(one => [one.label, one.isEnabled]), [['Go', false], ['Not yet', false]])
  // Review Focus 2: agreed by hand without its words.
  const bare = page.focusView(stateOf(map(AGREED).replace(/ {4}Vibe: .*\n/g, '')), goalsOf(map()))
  assert.equal(bare.stage, 'how')
  assert.equal(bare.head.vibeLine, '(no words kept)')
  assert.equal(bare.how.empty, 'Your partner proposes the parts here once you talk about the how.')
  const run = page.focusView(stateOf(map(AGREED, HOW, RUN)), goalsOf(map()))
  assert.deepEqual(run.strip.map(one => one.state), ['done', 'done', 'now'])
  assert.deepEqual(run.progress, { text: '2 of 4 done · about 3 h left', percent: 50 })
})

test('the run shows the parts with progress and who is on each, never a step id; the note card waits for the partner\'s note', () => {
  const run = page.focusView(stateOf(map(AGREED, HOW, RUN)), goalsOf(map()))
  assert.deepEqual(run.run.parts, [
    { title: 'Draw the bench', chip: 'Done', tone: 'done', percent: 100, owner: null, standards: [], checked: [] },
    { title: 'Light the path', chip: 'In progress', tone: 'now', percent: 50, owner: 'Features is on it', standards: [], checked: [] },
    { title: 'Place them', chip: 'Done', tone: 'done', percent: 100, owner: null, standards: [], checked: [] },
    { title: 'One look at the whole garden', chip: 'Waiting for its refine, then it goes on the list', tone: 'refining', percent: 0, owner: null, standards: [], checked: [] },
  ])
  assert.equal(run.run.stepsOf, 'G2')
  assert.doesNotMatch(JSON.stringify(run.run), /\bB\d+\b/)
  assert.doesNotMatch(JSON.stringify(run.head), /\bB\d+\b/)
  // Focus 3: the note card, empty until the partner writes its daily note.
  assert.equal(run.note.empty, 'No note yet: your partner writes one each morning, with what it decided for you and what needs you.')
})

test('pick: no focus lists the open goals of the map to choose from; done asks for the next one', () => {
  const pick = page.focusView(null, goalsOf(map()))
  assert.equal(pick.stage, 'pick')
  assert.equal(pick.head, null)
  assert.deepEqual(pick.pick.rows, [
    { id: 'G1', title: 'A garden people visit', depth: 0, isNow: true, hasDoneWhen: false, isAsked: false },
    { id: 'G2', title: 'Benches that feel like home', depth: 1, isNow: true, hasDoneWhen: false, isAsked: false },
    { id: 'G3', title: 'A bench by the pond', depth: 2, isNow: false, hasDoneWhen: false, isAsked: false },
    { id: 'G4', title: 'Lanterns', depth: 0, isNow: false, hasDoneWhen: false, isAsked: false },
  ])
  assert.equal(pick.pick.question, 'What do you want to work on?')
  assert.equal(pick.pick.isEnabled, false)
  assert.equal(page.focusView(null, goalsOf(map()), { canWrite: true, whyNot: null }).pick.isEnabled, true)
  const done = page.focusView(stateOf(map().replace('- [~] G2', '- [x] G2')), goalsOf(map().replace('- [~] G2', '- [x] G2')))
  assert.equal(done.stage, 'done')
  assert.deepEqual(done.strip.map(one => one.state), ['done', 'done', 'done'])
  assert.equal(done.pick.question, 'G2 is done. What do you want to work on next?')
  assert.deepEqual(done.pick.rows.map(row => row.id), ['G1', 'G3', 'G4'])
})

test('the talk on the left is the focus goal\'s brainstorm thread: your opening and answers, the partner\'s questions', () => {
  assert.deepEqual(page.focusTalk(threads[0]), [
    { who: 'you', text: 'I want benches people love' },
    { who: 'partner', text: 'When it is done, what should sitting feel like?' },
    { who: 'you', text: 'like home, warm wood' },
    { who: 'partner', text: 'Is the lamp part of it?' },
    { who: 'you', text: 'B, no: only the benches' },
    { who: 'partner', text: 'Anything else?' },
  ])
  assert.deepEqual(page.focusTalk(null), [])
})

test('"See the steps behind this" opens the Backlog on the goal\'s steps: its own, its parts\' and its goals\' inside', () => {
  const goals = goalsOf(map(AGREED, HOW, RUN))
  assert.deepEqual(page.goalStepIds(goals, 'G2'), ['B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16'])
  assert.deepEqual(page.goalStepIds(goals, 'G4'), [])
  const activities = [{ name: 'Art', isFocus: false, steps: [
    { id: 'B10', title: 'Draw', status: 'done', worker: 'Units' },
    { id: 'B13', title: 'Light', status: 'progress', worker: 'Features' },
    { id: 'B20', title: 'Elsewhere', status: 'open', worker: null },
  ] }]
  const list = page.coordinateList(activities, { goal: ['B10', 'B13'] })
  // B325: its finished steps only with "Show finished", as without a goal.
  assert.deepEqual(list.groups.flatMap(group => group.steps.map(step => step.id)), ['B13'])
  assert.deepEqual(page.coordinateList(activities, { goal: ['B10', 'B13'], showDone: true }).groups.flatMap(group => group.steps.map(step => step.id)), ['B10', 'B13'])
  assert.equal(list.counts.all, 1)
  assert.deepEqual(page.coordinateList(activities, {}).groups.flatMap(group => group.steps.map(step => step.id)), ['B13', 'B20'])
  assert.match(script, /data-focus-steps/)
  assert.match(script, /coordinateGoal = /)
})

test('B325: with a goal in the filter, "Show finished" hides and shows the finished steps as without one', () => {
  // the user, 2026-10-18 15:30: "the show finished checkbox doesnt work if you have a goal in the filter"
  const activities = [
    { name: 'Art', isFocus: false, steps: [
      { id: 'B10', title: 'Draw', status: 'done', worker: 'Units' },
      { id: 'B11', title: 'Paint', status: 'open', worker: null },
      { id: 'B30', title: 'Elsewhere', status: 'done', worker: 'Units' },
    ] },
    { name: 'Sound', isFocus: false, steps: [
      { id: 'B12', title: 'Hum', status: 'done', worker: 'Units' },
      { id: 'B14', title: 'Sing', status: 'queued', worker: 'Units' },
    ] },
  ]
  const goal = ['B10', 'B11', 'B12', 'B14']
  const ids = list => list.groups.flatMap(group => group.steps.map(step => step.id))
  const hidden = page.coordinateList(activities, { goal })
  const shown = page.coordinateList(activities, { goal, showDone: true })
  // without the goal, the same box does the same to the same steps
  const plainHidden = ids(page.coordinateList(activities, {})).filter(id => goal.includes(id))
  const plainShown = ids(page.coordinateList(activities, { showDone: true })).filter(id => goal.includes(id))
  assert.deepEqual(ids(hidden), ['B11', 'B14'])
  assert.deepEqual(ids(shown), ['B10', 'B11', 'B12', 'B14'])
  assert.deepEqual(ids(hidden), plainHidden)
  assert.deepEqual(ids(shown), plainShown)
  // nothing outside the goal comes in, finished or not
  assert.ok(!ids(shown).includes('B30'))
})

test('the part has its place in the page: a section, its styles, and the tab named Focus', () => {
  assert.ok(html.includes('id="advisor-focus"'))
  assert.match(html, /data-tab="advice"><span class="tab-long">Focus<\/span><span class="tab-short">Focus<\/span><\/button>/)
  assert.match(css, /#view-advice\[data-pane="focus"\] > \.advisor-focus/)
  assert.match(script, /once\('focus', /)
})

const CAN = { canWrite: true, whyNot: null }

test('Focus 2: the moves work on a board that writes, with a partner; each button says what it does or why not', () => {
  assert.deepEqual(page.focusCan({ advisor: null, goalsEdit: { canWrite: true } }), { canWrite: false, whyNot: 'No partner chat is on the board: the setting advisor names none.' })
  assert.deepEqual(page.focusCan({ advisor: { name: 'Partner' }, goalsEdit: { canWrite: false, whyNot: 'This board only shows. Change the map there.' } }), { canWrite: false, whyNot: 'This board only shows. Change the map there.' })
  assert.deepEqual(page.focusCan({ advisor: { name: 'Partner' }, goalsEdit: { canWrite: true, whyNot: null } }), CAN)
  const vibe = page.focusView(stateOf(map()), goalsOf(map()), CAN)
  assert.deepEqual(vibe.buttons, [
    { label: 'This is the goal definition', act: 'vibe-agree', isEnabled: true, title: 'Agreed: your partner proposes the how next' },
    { label: 'Not yet', act: 'vibe-not-yet', isEnabled: true, title: 'Say what is missing: your partner goes on talking' },
  ])
  // No vibe written yet: nothing to agree to.
  const bare = page.focusView(stateOf(map().replace(/ {4}Vibe.*\n/g, '')), goalsOf(map()), CAN)
  assert.deepEqual(bare.buttons.map(one => [one.act, one.isEnabled, one.title]), [['vibe-agree', false, 'Your partner writes the vibe here first, while you talk'], ['vibe-not-yet', true, 'Say what is missing: your partner goes on talking']])
  const how = page.focusView(stateOf(map(AGREED, HOW)), goalsOf(map()), CAN)
  assert.deepEqual(how.buttons.map(one => [one.label, one.act, one.isEnabled]), [['Go', 'how-go', true], ['Not yet', 'how-not-yet', true]])
  assert.deepEqual(page.focusView(stateOf(map(AGREED)), goalsOf(map()), CAN).buttons.map(one => one.isEnabled), [false, true])
  assert.deepEqual(page.focusView(stateOf(map(AGREED, HOW, RUN)), goalsOf(map()), CAN).buttons, [])
  const pick = page.focusView(null, goalsOf(map()), CAN)
  assert.deepEqual([pick.pick.isEnabled, pick.pick.title], [true, 'Make it your focus: you and your partner agree its vibe first'])
})

test('Focus 2: the talk answers the partner\'s open question here, as the Brainstorm part does; else it says who has the turn', () => {
  assert.deepEqual(page.focusAsk(threads[0], { name: 'Partner', isRunning: true }), { question: { n: 3, why: null, picture: null, options: [] }, waiting: null, restart: false })
  const answered = brainstormsState([{ path: 'talks/b.md', text: THREAD + 'Answer (09:06): Other — no\n', at: 1 }], 'talks').threads[0]
  assert.deepEqual(page.focusAsk(answered, { name: 'Partner', isRunning: true }), { question: null, waiting: 'Your partner is thinking…', restart: false })
  assert.equal(page.focusAsk(answered, { name: 'Partner', isRunning: false }).waiting, 'Your partner\'s chat is not running: the main chat is asked to start it.')
  assert.equal(page.focusAsk(answered, { name: 'Partner', isRunning: false }, { name: 'Main', isRunning: true }).waiting, 'Your partner\'s chat is not running: the main chat is asked to start it.')
  // Nobody can start it while the main chat does not run either: the person opens one of the two (2026-10-21).
  assert.equal(page.focusAsk(answered, { name: 'Partner', isRunning: false }, { name: 'Main', isRunning: false }).waiting,
    'Your partner\'s chat is not running, and neither is Main, which could start it: open one of the two chats.')
  assert.equal(page.focusAsk(answered, null).waiting, 'No partner chat is on the board.')
  const withOptions = brainstormsState([{ path: 'talks/c.md', text: THREAD.replace('## Q3 (09:05)\nAnything else?\n', '## Q3 (09:05)\nHow heavy?\nWhy: it sets the sound.\n- A: a thud (advised)\n- B: a crack\nPicture: pictures/hits.png\n'), at: 1 }], 'talks').threads[0]
  assert.deepEqual(page.focusAsk(withOptions, { name: 'Partner' }).question, { n: 3, why: 'it sets the sound.', picture: 'pictures/hits.png', options: [{ key: 'A', text: 'a thud', isAdvised: true }, { key: 'B', text: 'a crack', isAdvised: false }] })
  const over = brainstormsState([{ path: 'talks/d.md', text: THREAD.replace('State: running', 'State: done'), at: 1 }], 'talks').threads[0]
  // The review's findings: a talk that is over (wrapped up, discarded or created on the Brainstorm part), or none, is
  // started anew from here.
  assert.deepEqual(page.focusAsk(over, { name: 'Partner' }), { question: null, waiting: 'This talk is over: start a new one about this goal.', restart: true })
  assert.deepEqual(page.focusAsk(null, { name: 'Partner' }), { question: null, waiting: 'No talk about this goal runs: start one.', restart: true })
  const wrapping = brainstormsState([{ path: 'talks/e.md', text: THREAD.replace('State: running', 'State: wrapping up'), at: 1 }], 'talks').threads[0]
  assert.equal(page.focusAsk(wrapping, { name: 'Partner' }).restart, true)
})

test('Focus 2: the page sends its moves to /api/goals and the talk\'s answers as the Brainstorm part does', () => {
  assert.match(script, /fetch\('\/api\/goals', \{ method: 'POST'/)
  assert.match(script, /command: 'focus', id: goal/)
  assert.match(script, /command: 'focus', text: words\('new'\)/)
  assert.match(script, /command: 'brainstorm-answer', thread: path, n/)
  assert.match(script, /fetch\('\/api\/brainstorm', \{ method: 'POST'[^\n]+command: 'answer', path, n/)
  assert.doesNotMatch(script.slice(script.indexOf('function focusView'), script.indexOf('// focus:end')), /comes in the next part'\)/)
  assert.match(css, /\.focus-option\b/)
  assert.match(css, /\.focus-note\b/)
})

test('Focus 2, the review\'s findings: "Change focus" in every stage opens the pick list; the talk is started anew from the page', () => {
  for (const stage of [map(), map(AGREED, HOW), map(AGREED, HOW, RUN)]) {
    const view = page.focusView(stateOf(stage), goalsOf(stage), CAN)
    assert.deepEqual(view.change, { label: 'Change focus', isEnabled: true, title: 'Pick another goal as your focus' })
    assert.equal(view.pick, undefined)
  }
  const picking = page.focusView(stateOf(map()), goalsOf(map()), CAN, { picking: true })
  assert.equal(picking.stage, 'vibe')
  assert.equal(picking.pick.question, 'What do you want to work on instead?')
  assert.deepEqual(picking.pick.rows.map(row => row.id), ['G1', 'G3', 'G4'])
  assert.deepEqual(picking.back, { label: 'Back to G2', act: 'keep-focus' })
  assert.equal(page.focusView(stateOf(map()), goalsOf(map()), null).change.isEnabled, false)
  assert.equal(page.focusView(null, goalsOf(map()), CAN).change, null)
  assert.match(script, /act === 'restart-talk' && focus !== null\) await sendFocus\(\{ command: 'focus', id: focus\.id \}/)
  assert.match(script, /'Start the talk'/)
  assert.match(script, /focusUi\.picking = true/)
})
