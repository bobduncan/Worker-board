// B285: every step is refined before it goes into a queue. The board sends a step to the Advisor by itself, one at a
// time, as the Refine button does: a new step once, a step queued before it was refined, and a step the person asked
// to queue. A queue ask for a step that is not refined waits on the board and goes to the main chat by itself once the
// step is refined; a step the main chat queued unrefined is said to it once it is refined, so it hands it out then.
// The person, on G17: "every item on the backlog automatically Before it gets put in the queue. if main wants to put
// it in the queue automatically/directly, refine it first". Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { isRefined, newSince, refineStateOf, refineWhenDue } from '../src/refineGate.mjs'
import { checkSay } from '../src/say.mjs'
import { buildState } from '../src/state.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.UTC(2026, 9, 17, 10, 30)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const LIST = '{"prefix":"Studio · ","main":"Lead"}'
const CHATS = ['Lead', 'Worker 1', 'Advisor']

const block = (questions, more = '') => [
  `  Refined (round 1, by Oracle, 2026-10-17 09:00${more}):`,
  '  Goal: The herd sings.',
  '  Questions:',
  ...questions.map(line => `  - ${line}`),
]

const BACKLOG = [
  '## Work',
  '- [ ] B10 Teach the zebracorn to sing',
  '  A line under it.',
  '- [ ] B11 Paint the narwhal bridge',
  ...block(['Which colour? Answer: blue', 'Both sides? Answer: yes']),
  '- [ ] B12 Count the moon beetles',
  ...block(['None: ready to pick up.']),
  '- [ ] B13 Feed the cloud whale',
  ...block(['How much?', 'At noon? Answer: yes']),
  '- [ ] B14 Sweep the comet tail',
  ...block(['How much?'], '; accepted 2026-10-17 09:30'),
  '- [ ] B15 Tune the star harp (for Worker 1; now; about 1 h)',
  '- [ ] B16 Mend the rainbow (for Worker 1) (branch feature/rainbow)',
  '- [x] B17 Finish the old thing',
  '- [ ] B18 Verify: Check the song (Studio · Worker 1) @you',
  '- [ ] B19 Polish the bell (later; not handed out)',
  '- [ ] B20 Build the tower',
  '',
].join('\n')

const app = name => JSON.stringify({
  title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: NOW - 2 * HOUR, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const rested = { text: [typed(NOW - 30 * MIN, 'Zebracorn'), answer(NOW - 29 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW }

/** The board with the main chat, a worker and the Advisor at rest, this backlog, and what was sent. */
function build({ outbox = [], backlogText = BACKLOG } = {}) {
  const raw = {
    listText: LIST,
    appChatTexts: CHATS.map(app),
    tails: Object.fromEntries(CHATS.map(name => [`cli-${name}`, rested])),
    planLineTexts: {}, backlogText, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const seen = { shown: Object.fromEntries(CHATS.map(name => [name, NOW - 5000])), other: {} }
  return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 10 * MIN, offSince: null }, seen, now: NOW, config })
}

const stepOf = (state, id) => state.backlog.flatMap(activity => activity.steps).find(step => step.id === id)
const BASE = { ask: null, step: null, title: null, version: null, verdict: null }
const refineSent = (at, about, more = {}) => ({ id: `r${at}${about}`, at, ...BASE, to: 'Advisor', command: 'refine', about, round: 1, text: `refine step\nStep: ${about}\nRound: 1`, state: 'delivered', deliveredAt: at + 5000, ...more })
const queueHeld = (at, about, more = {}) => ({ id: `q${at}${about}`, at, ...BASE, to: 'Lead', command: 'queue', about, held: true, text: `queue step from the backlog\nStep: ${about}`, state: 'held', ...more })

// What refined means

test('a step is refined when its block leaves no question open: all answered, none left, or accepted', () => {
  const state = build()
  const refined = id => isRefined(stepOf(state, id).refined)
  assert.equal(refined('B10'), false, 'no block')
  assert.equal(refined('B11'), true, 'every question answered')
  assert.equal(refined('B12'), true, 'None: ready to pick up')
  assert.equal(refined('B13'), false, 'a question is open')
  assert.equal(refined('B14'), true, 'accepted')
})

test('where a step stands in its refine: not refined, the Advisor on it, your answers waiting, answered, ready', () => {
  const state = build({ outbox: [refineSent(NOW - 2 * MIN, 'B20', { state: 'waiting', deliveredAt: undefined })] })
  const where = id => refineStateOf(stepOf(state, id))
  assert.deepEqual(['B10', 'B20', 'B13', 'B11', 'B12', 'B14'].map(where), ['none', 'asking', 'answers', 'answered', 'ready', 'ready'])
  // The state carries it per step.
  assert.equal(stepOf(state, 'B13').refineState, 'answers')
})

// A queue ask waits for the refine

test('the person\'s queue ask for a refined step goes to the main chat at once, as before', () => {
  const checked = checkSay({ to: 'Lead', command: 'queue', step: 'B11' }, build(), 2000)
  assert.equal(checked.ok, true)
  assert.equal(checked.message.held, undefined)
})

test('the person\'s queue ask for a step that is not refined is held on the board, and counts as asked', () => {
  const checked = checkSay({ to: 'Lead', command: 'queue', step: 'B10' }, build(), 2000)
  assert.deepEqual([checked.ok, checked.message.held], [true, true])
  const held = build({ outbox: [queueHeld(NOW - MIN, 'B10')] })
  assert.deepEqual(stepOf(held, 'B10').queueAsk, { at: NOW - MIN, state: 'held', isOpen: true })
  assert.equal(checkSay({ to: 'Lead', command: 'queue', step: 'B10' }, held, 2000).status, 409)
})

test('a held queue ask is sent to the main chat once its step is refined, and dropped when the step left the backlog', () => {
  const refinedNow = BACKLOG.replace('- [ ] B10 Teach the zebracorn to sing\n  A line under it.\n',
    ['- [ ] B10 Teach the zebracorn to sing', '  A line under it.', ...block(['Which song? Answer: the dawn one']), ''].join('\n'))
  const held = queueHeld(NOW - 20 * MIN, 'B10')
  assert.deepEqual(refineWhenDue(build({ backlogText: refinedNow, outbox: [held] }), [held], { since: 20 }).release, [held.id])
  // Still not refined: it waits.
  assert.deepEqual(refineWhenDue(build({ outbox: [held] }), [held], { since: 20 }).release, [])
  // Ticked, or gone from the backlog: nothing left to queue.
  const ticked = BACKLOG.replace('- [ ] B10 Teach', '- [x] B10 Teach')
  assert.deepEqual(refineWhenDue(build({ backlogText: ticked, outbox: [held] }), [held], { since: 20 }).drop, [held.id])
})

// The board refines by itself, one at a time

test('a step the person asked to queue is refined first, before a queued one and a new one', () => {
  const held = queueHeld(NOW - MIN, 'B10')
  const due = refineWhenDue(build({ outbox: [held] }), [held], { since: 15 })
  assert.equal(due.refine?.about, 'B10')
  assert.equal(due.refine?.why, 'queue')
  assert.equal(due.refine?.text, 'refine step\nStep: B10 Teach the zebracorn to sing\nRound: 1')
  assert.equal(due.refine?.to, 'Advisor')
})

test('a step the main chat queued before it was refined is refined next', () => {
  const due = refineWhenDue(build(), [], { since: 30 })
  assert.deepEqual([due.refine?.about, due.refine?.why], ['B15', 'queued'])
})

test('a new step gets one refine: once asked, never again by itself; an old step only when it is about to be queued', () => {
  const noQueued = BACKLOG.replace(' (for Worker 1; now; about 1 h)', '')
  // B20 is new (above B19, the highest step the board saw when refining began); B10 is old.
  const due = refineWhenDue(build({ backlogText: noQueued }), [], { since: 19 })
  assert.deepEqual([due.refine?.about, due.refine?.why], ['B20', 'new'])
  const asked = refineSent(NOW - 2 * HOUR, 'B20')
  assert.equal(refineWhenDue(build({ backlogText: noQueued, outbox: [asked] }), [asked], { since: 19 }).refine, null)
  // One that did not arrive is asked again.
  const failed = refineSent(NOW - 2 * HOUR, 'B20', { state: 'failed' })
  assert.equal(refineWhenDue(build({ backlogText: noQueued, outbox: [failed] }), [failed], { since: 19 }).refine?.about, 'B20')
})

test('one at a time: nothing new goes to the Advisor while a refine is open, the person\'s too', () => {
  const open = refineSent(NOW - 2 * MIN, 'B13', { state: 'taken', deliveredAt: undefined, round: 2 })
  assert.equal(refineWhenDue(build({ outbox: [open] }), [open], { since: 15 }).refine, null)
})

test('never the person\'s steps, finished ones, steps in progress, or one with a block that waits for answers', () => {
  // Each time only that step is left open, and every step counts as new.
  for (const id of ['B16', 'B17', 'B18', 'B13']) {
    const text = BACKLOG.replace(/- \[ \] (B1[0-9]|B20)\b/g, (whole, sid) => (sid === id ? whole : `- [x] ${sid}`))
    assert.equal(refineWhenDue(build({ backlogText: text }), [], { since: 0 }).refine, null, id)
  }
})

test('a queued step that was refined because it was queued is said to the main chat once, to hand it out', () => {
  const refinedQueued = BACKLOG.replace('- [ ] B15 Tune the star harp (for Worker 1; now; about 1 h)\n',
    ['- [ ] B15 Tune the star harp (for Worker 1; now; about 1 h)', ...block(['None: ready to pick up.']), ''].join('\n'))
  const asked = refineSent(NOW - 20 * MIN, 'B15', { why: 'queued' })
  const due = refineWhenDue(build({ backlogText: refinedQueued, outbox: [asked] }), [asked], { since: 30 })
  assert.equal(due.notice?.to, 'Lead')
  assert.equal(due.notice?.command, 'refined')
  assert.equal(due.notice?.text, 'step refined\nStep: B15 Tune the star harp\nFor: Worker 1')
  const told = { ...due.notice, id: 'n1', at: NOW - MIN, state: 'delivered' }
  assert.equal(refineWhenDue(build({ backlogText: refinedQueued, outbox: [asked, told] }), [asked, told], { since: 30 }).notice, null)
  // A queued step that was refined before it was queued was handed out as usual: nothing to say.
  assert.equal(refineWhenDue(build({ backlogText: refinedQueued }), [], { since: 30 }).notice, null)
})

test('where refining began: the highest step on the backlog when the board first looks', () => {
  assert.equal(newSince(null, build()), 20)
  assert.equal(newSince(12, build()), 12)
})

test('the Advisor\'s newer form (Summary, Picture, Part of, Size) keeps its questions in the block', () => {
  const newer = BACKLOG.replace('- [ ] B20 Build the tower\n', [
    '- [ ] B20 Build the tower',
    '  Refined (round 1, by Oracle, 2026-10-17 10:05):',
    '  Summary: A tower to watch the herd from.',
    '  Picture: pictures/tower/v1.png (the layout)',
    '  Part of: G9 M2 · Version 1',
    '  Size: about 3 hours',
    '  Questions:',
    '  - Stone or wood? I advise stone.',
    '  Context: asked by the herd.',
    '',
  ].join('\n'))
  const step = stepOf(build({ backlogText: newer }), 'B20')
  assert.deepEqual(step.refined.questions, [{ text: 'Stone or wood? I advise stone.', answer: null }])
  assert.equal(step.refineState, 'answers')
  assert.equal(isRefined(step.refined), false)
  // The step's other lines still end the block.
  assert.deepEqual(step.notes.map(part => part.title), ['Context'])
})

test('a held ask stays known on the board, however long the refine takes', async () => {
  const { outboxNow } = await import('../src/store.mjs')
  const held = queueHeld(NOW - 30 * HOUR, 'B10')
  assert.deepEqual(outboxNow([held], NOW, { messageMs: 10 * MIN, answerMs: 48 * HOUR }).map(one => one.id), [held.id])
  assert.equal(stepOf(build({ outbox: [held] }), 'B10').queueAsk.isOpen, true)
})

test('the page: a held ask says the Advisor refines it first; the button says so for a step not refined yet', async () => {
  const { readFile } = await import('node:fs/promises')
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  const part = script.slice(script.indexOf('function queuePart('), script.indexOf('function askQueue('))
  assert.match(part, /if \(ask\?\.isOpen === true && ask\.state === 'held'\) \{/)
  assert.match(part, /the Advisor refines it first, then it goes to \$\{mainTitle\} by itself/)
  assert.match(part, /const isRefined = step\.refineState === 'answered' \|\| step\.refineState === 'ready'/)
  assert.match(part, /Not refined yet: the Advisor refines it first, then \$\{mainTitle\} picks the worker\./)
})

test('the person refining a queued step before it was refined counts as the board\'s: the main chat hears once it is', () => {
  const checked = checkSay({ to: 'Advisor', command: 'refine', step: 'B15' }, build(), 2000)
  assert.deepEqual([checked.ok, checked.message.why], [true, 'queued'])
  assert.equal(checkSay({ to: 'Advisor', command: 'refine', step: 'B10' }, build(), 2000).message.why, undefined)
})
