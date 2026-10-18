// B259: a brainstorm on the board, Task 17: the handler (POST /api/brainstorm) on a fake file system, the words the
// board types into the chats, and what the state gives the page. Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { brainstormNeeds, brainstormsState, editThread, parseThread } from '../src/brainstorm.mjs'
import { parseGoals } from '../src/goals.mjs'
import { checkSay, wakeFor } from '../src/say.mjs'
import { GOALS } from './fixtures-goals.mjs'

/** A fake file system over one map of path → text (bytes as latin1), with folders listed by their files. */
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
const DIR = 'C:/p/.claude/brainstorms'
const options = (fs, extra = {}) => ({ canWrite: true, dir: DIR, folder: '.claude/brainstorms', goalsFile: 'C:/p/goals.md', historyDir: 'C:/p/history', now: new Date(2026, 9, 15, 21, 0).getTime(), fs, ...extra })
const fileOf = path => `${DIR}/${path.split('/').pop()}`
const threadOf = (fs, path) => parseThread(utf8(fs.files[fileOf(path)]))
const mapOf = fs => parseGoals(utf8(fs.files['C:/p/goals.md']))

test('start makes the thread from the date and the title, links it under its goal, and refuses a second one on that goal', async () => {
  const fs = fakeFs({ 'C:/p/goals.md': latin(GOALS) })
  const started = await editThread({ command: 'start', title: 'Lanterns', goal: 'G5', opening: 'Where do lanterns go?' }, options(fs))
  assert.deepEqual(started, { ok: true, result: { path: '.claude/brainstorms/2026-10-15-lanterns.md' } })
  assert.equal(utf8(fs.files[`${DIR}/2026-10-15-lanterns.md`]), '# Brainstorm: Lanterns\nGoal: G5 M2 · The garden is open\nStarted: 2026-10-15 21:00 · State: running\nOpening: Where do lanterns go?\n\n')
  assert.deepEqual(mapOf(fs).byId.get('G5').brainstorm, { path: '.claude/brainstorms/2026-10-15-lanterns.md', state: 'running' })
  const again = await editThread({ command: 'start', title: 'More lanterns', goal: 'G5', opening: 'x' }, options(fs))
  assert.deepEqual([again.ok, again.status], [false, 409])
  assert.equal((await editThread({ command: 'start', title: 'x', goal: 'G99', opening: 'x' }, options(fs))).status, 409)
  // Free, and the same title on the same day: a name of its own.
  const free = await editThread({ command: 'start', title: 'Lanterns', goal: null, opening: 'Anything with light' }, options(fs))
  assert.equal(free.result.path, '.claude/brainstorms/2026-10-15-lanterns-2.md')
  assert.equal(utf8(fs.files[`${DIR}/2026-10-15-lanterns-2.md`]).split('\n')[1], 'Goal: new')
  assert.equal((await editThread({ command: 'start', title: ' ', goal: null, opening: 'x' }, options(fs))).status, 400)
  assert.equal((await editThread({ command: 'start', title: 'x', goal: null, opening: ' ' }, options(fs))).status, 400)
  assert.equal((await editThread({ command: 'start', title: 'x', goal: null, opening: 'y' }, options(fs, { canWrite: false }))).status, 403)
  assert.equal((await editThread({ command: 'fly' }, options(fs))).status, 400)
})

test('answers, wrap up and discard are written into the thread; a path outside the folder is refused', async () => {
  const fs = fakeFs({ 'C:/p/goals.md': latin(GOALS) })
  const { result: { path } } = await editThread({ command: 'start', title: 'Lanterns', goal: 'G5', opening: 'Where?' }, options(fs))
  fs.files[fileOf(path)] += latin('## Q1 (21:01)\nWhere first?\nWhy: it decides the order.\n- A: by the gate (advised)\n- B: by the pond\n')
  assert.equal((await editThread({ command: 'answer', path, n: 1, key: 'A', words: 'and the bench' }, options(fs))).ok, true)
  assert.ok(utf8(fs.files[fileOf(path)]).includes('- B: by the pond\nAnswer (21:00): A — and the bench\n'))
  assert.equal((await editThread({ command: 'answer', path, n: 1, key: 'B', words: '' }, options(fs))).status, 409)
  fs.files[fileOf(path)] += latin('## Q2 (21:03)\nHow many?\n- A: one (advised)\n- B: three\n')
  assert.equal((await editThread({ command: 'skip', path, n: 2 }, options(fs))).ok, true)
  assert.deepEqual(threadOf(fs, path).questions[1].answer, { at: '21:00', skipped: true })
  fs.files[fileOf(path)] += latin('## Q3 (21:05)\nHow bright?\n- A: dim (advised)\n')
  assert.equal((await editThread({ command: 'back', path, n: 3, to: 1 }, options(fs))).ok, true)
  assert.deepEqual(threadOf(fs, path).questions[2].answer, { at: '21:00', back: 1 })
  assert.equal((await editThread({ command: 'wrap', path }, options(fs))).ok, true)
  assert.equal(threadOf(fs, path).state, 'wrapping up')
  assert.equal((await editThread({ command: 'answer', path: '.claude/brainstorms/../goals.md', n: 1, key: 'A' }, options(fs))).status, 400)
  assert.equal((await editThread({ command: 'answer', path: '.claude/brainstorms/2026-10-15-none.md', n: 1, key: 'A' }, options(fs))).status, 404)
  assert.equal((await editThread({ command: 'discard', path }, options(fs))).ok, true)
  assert.equal(threadOf(fs, path).state, 'discarded')
  assert.equal(mapOf(fs).byId.get('G5').brainstorm.state, 'discarded')
  // A discarded brainstorm takes nothing more; a new one on the goal may start.
  assert.equal((await editThread({ command: 'wrap', path }, options(fs))).status, 409)
  assert.equal((await editThread({ command: 'start', title: 'Lanterns again', goal: 'G5', opening: 'x' }, options(fs))).ok, true)
})

const WITH_PROPOSAL = [
  '## Proposal (21:20)',
  'Decided:',
  '- lanterns by the gate first',
  'Goals:',
  '- [ ] Lanterns by the gate — under G5 — Done when: a visitor finds the gate at night',
  '- [ ] Lanterns by the pond — under G5 — Done when: the pond glows',
  'Steps:',
  '- [ ] Make a lantern sprite — Units — about 1 h',
  '- [ ] Place the lanterns — Main decides — about 30 min',
  'Note: the gate first: most visitors come in there.',
  '',
].join('\n')

test('Create writes the ticked goals and the note into the map, marks the thread done, and is refused twice (Review Focus 5)', async () => {
  const fs = fakeFs({ 'C:/p/goals.md': latin(GOALS) })
  const { result: { path } } = await editThread({ command: 'start', title: 'Lanterns', goal: 'G5', opening: 'Where?' }, options(fs))
  fs.files[fileOf(path)] += latin(WITH_PROPOSAL)
  const seen = utf8(fs.files[fileOf(path)]).length
  // The thread changed since the page read it: nothing is created.
  assert.equal((await editThread({ command: 'create', path, goals: [0], steps: [0], seen: seen - 1 }, options(fs))).status, 409)
  const created = await editThread({ command: 'create', path, goals: [0], steps: [0, 1], seen }, options(fs))
  assert.deepEqual(created, { ok: true, result: {
    goals: [{ id: 'G10', title: 'Lanterns by the gate' }],
    steps: [{ title: 'Make a lantern sprite', worker: 'Units', cost: 'about 1 h', goal: 'G10' }, { title: 'Place the lanterns', worker: 'Main decides', cost: 'about 30 min', goal: 'G10' }],
  } })
  const map = mapOf(fs)
  assert.equal(map.byId.get('G10').parent, 'G5')
  assert.equal(map.byId.get('G10').doneWhen, 'a visitor finds the gate at night')
  assert.ok(map.byId.get('G5').notes.includes('Note (brainstorm 2026-10-15): the gate first: most visitors come in there.'))
  assert.deepEqual(map.byId.get('G5').brainstorm, { path, state: 'done' })
  assert.equal(map.lastGoal, 10)
  assert.equal(threadOf(fs, path).state, 'done')
  assert.deepEqual(threadOf(fs, path).proposal.created, { at: '21:00', goals: ['G10'], steps: [], asked: 2, leftOut: ['Lanterns by the pond'] })
  const twice = await editThread({ command: 'create', path, goals: [0], steps: [0], seen: utf8(fs.files[fileOf(path)]).length }, options(fs))
  assert.deepEqual([twice.ok, twice.status], [false, 409])
  assert.equal(mapOf(fs).nodes.filter(one => one.title === 'Lanterns by the gate').length, 1)
})

test('a free brainstorm creates its goals where the proposal says, the note under the first; two Creates at once make them once', async () => {
  const fs = fakeFs({ 'C:/p/goals.md': latin(GOALS) })
  const { result: { path } } = await editThread({ command: 'start', title: 'Night', goal: null, opening: 'The garden at night' }, options(fs))
  fs.files[fileOf(path)] += latin('## Proposal (21:20)\nDecided:\n- a night garden\nGoals:\n- [ ] The garden at night — under top — Done when: it is open after dark\nSteps:\nNote: night visits sell the most tickets.\n')
  const seen = utf8(fs.files[fileOf(path)]).length
  const [one, two] = await Promise.all([1, 2].map(() => editThread({ command: 'create', path, goals: [0], steps: [], seen }, options(fs))))
  assert.deepEqual([one.ok, two.ok].sort(), [false, true])
  const map = mapOf(fs)
  assert.deepEqual(map.roots, ['G1', 'G7', 'G10'])
  assert.ok(map.byId.get('G10').notes.includes('Note (brainstorm 2026-10-15): night visits sell the most tickets.'))
  assert.equal(map.byId.get('G10').brainstorm.state, 'done')
  assert.equal((await editThread({ command: 'create', path, goals: [5], steps: [], seen }, options(fs))).status, 409)
})

const PROPOSAL = [
  '# Brainstorm: The reference look on every map',
  'Goal: G6 Benches that match the picture',
  'Started: 2026-10-15 19:38 · State: running',
  'Opening: I want the benches to feel like the picture.',
  '',
  '## Q1 (19:39)',
  'Which benches count?',
  '- A: all of them (advised)',
  '- B: the ones by the gate',
  'Answer (19:41): A',
  '',
  '## Q2 (19:43)',
  'What should "matches the picture" mean?',
  '- A: the judges\' score, 75 or more (advised)',
  'Answer (19:44): A',
  '',
  '## Proposal (19:55)',
  'Decided:',
  '- the gate benches first, judged at 75',
  'Goals:',
  '- [ ] Benches by the gate like the picture — under G6 — Done when: the judges give 75',
  'Steps:',
  '- [ ] Carve the gate benches after the picture — Units — about 2 h',
  '- [ ] Score the benches against the picture — Advisor — about 1 h',
  'Note: why 75: the same bar as the units.',
  '',
].join('\n')
const RUNNING = '# Brainstorm: Lanterns\nGoal: G6 Benches that match the picture\nStarted: 2026-10-15 21:00 · State: running\nOpening: Where do lanterns go?\n\n## Q1 (21:01)\nWhere first?\nWhy: it decides the order.\n- A: by the gate (advised)\n- B: by the pond\n'
const DONE = `${PROPOSAL.replace('State: running', 'State: done')}Created (20:01): G10; 2 steps asked of the main chat; left out: nothing\n`
const thread = (path, text, at = 0) => ({ path, text, at })

test('the state lists the threads with what they stand at, and the person\'s needs: an open question, a proposal to tick', () => {
  const state = brainstormsState([thread('b/2026-10-15-lanterns.md', RUNNING, 3), thread('b/2026-10-15-reference.md', PROPOSAL, 2), thread('b/2026-10-14-done.md', DONE, 1)], 'b')
  assert.equal(state.folder, 'b')
  assert.deepEqual(state.threads.map(one => [one.path, one.state, one.questions, one.latest?.n ?? null, one.proposal === null ? null : one.proposal.created === null ? 'open' : 'created']), [
    ['b/2026-10-15-lanterns.md', 'running', 1, 1, null],
    ['b/2026-10-15-reference.md', 'running', 2, 2, 'open'],
    ['b/2026-10-14-done.md', 'done', 2, 2, 'created'],
  ])
  assert.equal(state.threads[0].length, RUNNING.length)
  assert.equal(state.threads[0].opening, 'Where do lanterns go?')
  assert.deepEqual(brainstormNeeds(state.threads).map(need => [need.kind, need.what, need.path]), [
    ['brainstorm', 'question', 'b/2026-10-15-lanterns.md'],
    ['brainstorm', 'proposal', 'b/2026-10-15-reference.md'],
  ])
})

const P = '.claude/brainstorms/2026-10-15-lanterns.md'
const sayState = threads => ({
  chats: [{ name: 'Main', isMain: true }], advisor: { name: 'Oracle' }, restart: { main: 'Main' }, pictures: 'pictures',
  goals: { roots: ['G6'], problems: [], nodes: [{ id: 'G6', title: 'Benches that match the picture', asks: [] }] },
  brainstorms: brainstormsState(threads, '.claude/brainstorms'),
})

test('the words of a brainstorm go to the Advisor, from the thread as the board reads it, once each', () => {
  const head = '# Brainstorm: Lanterns\nGoal: G6 Benches that match the picture\nStarted: 2026-10-15 21:00 · State: running\nOpening: Where do lanterns go?\n\n'
  const fresh = sayState([thread(P, head)])
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm', thread: P }, fresh, 2000).message.text, `brainstorm\nThread: ${P}\nGoal: G6 Benches that match the picture\nOpening: Where do lanterns go?`)
  assert.equal(checkSay({ to: 'Main', command: 'brainstorm', thread: P }, fresh, 2000).status, 400)
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm', thread: 'x.md' }, fresh, 2000).status, 409)
  // The Advisor has it already (a question stands): no second word for the same thread (Review Focus 4).
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm', thread: P }, sayState([thread(P, RUNNING)]), 2000).status, 409)
  // An answer is typed once the board wrote it, from the file's own line.
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm-answer', thread: P, n: 1 }, sayState([thread(P, RUNNING)]), 2000).status, 409)
  const answered = sayState([thread(P, `${RUNNING}Answer (21:02): A — and the bench\n`)])
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm-answer', thread: P, n: 1 }, answered, 2000).message.text, `brainstorm answer\nThread: ${P}\nQ1: A — and the bench`)
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm-answer', thread: P, n: 2 }, answered, 2000).status, 409)
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm-answer', thread: P, n: 1 }, sayState([thread(P, `${RUNNING}Answer (21:02): skipped\n`)]), 2000).message.text.split('\n')[2], 'Q1: skipped')
  // Wrap up once the board marked it; a change of a proposal not yet created.
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm-wrap', thread: P }, answered, 2000).status, 409)
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm-wrap', thread: P }, sayState([thread(P, RUNNING.replace('State: running', 'State: wrapping up'))]), 2000).message.text, `brainstorm wrap up\nThread: ${P}`)
  const proposed = sayState([thread(P, PROPOSAL)])
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm-change', thread: P, text: 'all\nbenches at once' }, proposed, 2000).message.text, `brainstorm change\nThread: ${P}\nChange: all benches at once`)
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm-change', thread: P, text: ' ' }, proposed, 2000).status, 400)
  assert.equal(checkSay({ to: 'Oracle', command: 'brainstorm-change', thread: P, text: 'x' }, sayState([thread(P, DONE)]), 2000).status, 409)
})

test('a created step goes to the main chat in the Design tab\'s form, with the goal it serves; the Advisor is woken when it does not run', () => {
  const created = sayState([thread(P, DONE)])
  const step = checkSay({ to: 'Main', command: 'goal-step', thread: P, step: 0 }, created, 2000)
  assert.equal(step.message.text, [
    'backlog step from the goal map',
    'Title: Carve the gate benches after the picture',
    'Goal: G10',
    `Description: from the brainstorm "The reference look on every map" (${P}): why 75: the same bar as the units.`,
    'Time: about 2 h',
    'Worker: Units',
  ].join('\n'))
  assert.equal(checkSay({ to: 'Oracle', command: 'goal-step', thread: P, step: 0 }, created, 2000).status, 400)
  assert.equal(checkSay({ to: 'Main', command: 'goal-step', thread: P, step: 5 }, created, 2000).status, 409)
  // Not created yet: no step is asked for.
  assert.equal(checkSay({ to: 'Main', command: 'goal-step', thread: P, step: 0 }, sayState([thread(P, PROPOSAL)]), 2000).status, 409)
  const asleep = { ...created, chats: [{ name: 'Main', isMain: true, isRunning: true }], advisor: { name: 'Oracle', isRunning: false } }
  assert.equal(wakeFor({ to: 'Oracle', command: 'brainstorm-answer' }, asleep, [], 1_000_000, 2000).about, 'Oracle')
})

test('review B259: two starts on one goal at the same moment make one thread; a question left open while it wraps up waits for nobody', async () => {
  const fs = fakeFs({ 'C:/p/goals.md': latin(GOALS) })
  const both = await Promise.all(['Lanterns', 'Lights'].map(title => editThread({ command: 'start', title, goal: 'G5', opening: 'Where?' }, options(fs))))
  assert.deepEqual(both.map(one => one.ok).sort(), [false, true])
  assert.equal(Object.keys(fs.files).filter(path => path.startsWith(`${DIR}/`)).length, 1)
  const wrapping = brainstormsState([thread('b/x.md', RUNNING.replace('State: running', 'State: wrapping up'))], 'b').threads
  assert.deepEqual(brainstormNeeds(wrapping), [])
})

test('review B259: a step left out is never asked of the main chat, also when its title holds the Created line\'s separator', () => {
  const odd = DONE.replace('- [ ] Score the benches against the picture — Advisor — about 1 h', '- [ ] Score · rank the benches — Advisor — about 1 h')
    .replace('2 steps asked of the main chat; left out: nothing', '1 step asked of the main chat; left out: Score - rank the benches')
  const state = sayState([thread(P, odd)])
  assert.equal(checkSay({ to: 'Main', command: 'goal-step', thread: P, step: 1 }, state, 2000).status, 409)
  assert.equal(checkSay({ to: 'Main', command: 'goal-step', thread: P, step: 0 }, state, 2000).ok, true)
})
