// B285: every step is refined before it goes into a queue. The board sends a step to the Advisor by itself, one at a
// time, as the Refine button does: a step the person asked to queue, a step the main chat queued before it was
// refined, a new step once, and a step whose answers wait to be folded in. A queue ask for a step that is not refined
// waits on the board and goes to the main chat by itself once the step is refined; a step the main chat queued
// unrefined is said to it once it is refined, so it hands it out then. The person, on G17: "every item on the backlog
// automatically Before it gets put in the queue. if main wants to put it in the queue automatically/directly, refine
// it first". Refined, as the person approved it on 2026-10-17: the block's head says "; ready" (the answers folded
// into one compact description). Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { firstLook, isRefined, refineStateOf, refineWhenDue } from '../src/refineGate.mjs'
import { checkSay } from '../src/say.mjs'
import { outboxNow } from '../src/store.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.UTC(2026, 9, 17, 10, 30)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const LIST = '{"prefix":"Studio · ","main":"Lead"}'
const CHATS = ['Lead', 'Worker 1', 'Advisor']

/** A block in the older form, written at 01:00 (before every ask below on any clock). */
const older = (questions, more = '') => [
  `  Refined (round 1, by Oracle, 2026-10-17 01:00${more}):`,
  '  Goal: The herd sings.',
  '  Questions:',
  ...questions.map(line => `  - ${line}`),
]
/** A block in the approved form, ready. */
const ready = [
  '  Refined (2026-10-17 01:10; ready):',
  '  Summary: The herd sings at dawn.',
  '  Picture: pictures/song/v1.png (the score)',
  '  Part of: G9 M2 · Version 1',
  '  Size: about 2 hours',
  '  What we build:',
  '  - One song, at dawn only.',
  '  - Not in it: a second verse.',
]

const BACKLOG = [
  '## Work',
  '- [ ] B10 Teach the zebracorn to sing',
  '  A line under it.',
  '- [ ] B11 Paint the narwhal bridge',
  ...older(['Which colour? Answer: blue', 'Both sides? Answer: yes']),
  '- [ ] B12 Count the moon beetles',
  ...older(['None: ready to pick up.']),
  '- [ ] B13 Feed the cloud whale',
  ...older(['How much?', 'At noon? Answer: yes']),
  '- [ ] B14 Sweep the comet tail',
  ...older(['How much?'], '; accepted 2026-10-17 01:30'),
  '- [ ] B15 Tune the star harp (for Worker 1; now; about 1 h)',
  '- [ ] B16 Mend the rainbow (for Worker 1) (branch feature/rainbow)',
  '- [x] B17 Finish the old thing',
  '- [ ] B18 Verify: Check the song (Studio · Worker 1) @you',
  '- [ ] B19 Polish the bell',
  ...ready,
  '- [ ] B20 Build the tower',
  '',
].join('\n')

const app = name => JSON.stringify({
  title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: NOW - 2 * HOUR, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const rested = { text: [typed(NOW - 30 * MIN, 'Zebracorn'), answer(NOW - 29 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW }

/** The board with the main chat, a worker and the Advisor at rest, this backlog, and what was sent. */
function build({ outbox = [], backlogText = BACKLOG, chats = CHATS } = {}) {
  const raw = {
    listText: LIST,
    appChatTexts: chats.map(app),
    tails: Object.fromEntries(chats.map(name => [`cli-${name}`, rested])),
    planLineTexts: {}, backlogText, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const seen = { shown: Object.fromEntries(chats.map(name => [name, NOW - 5000])), other: {} }
  return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 10 * MIN, offSince: null }, seen, now: NOW, config })
}

/** What the board keeps between looks (refineGate.mjs `firstLook`). */
const gate = (since, queuedBefore = [], waiting = []) => ({ since, queuedBefore, waiting })
const stepOf = (state, id) => state.backlog.flatMap(activity => activity.steps).find(step => step.id === id)
const BASE = { ask: null, step: null, title: null, version: null, verdict: null }
const refineSent = (at, about, more = {}) => ({ id: `r${at}${about}`, at, ...BASE, to: 'Advisor', command: 'refine', about, round: 1, text: `refine step\nStep: ${about}\nRound: 1`, state: 'delivered', deliveredAt: at + 5000, ...more })
const queueHeld = (at, about, more = {}) => ({ id: `q${at}${about}`, at, ...BASE, to: 'Lead', command: 'queue', about, held: true, text: `queue step from the backlog\nStep: ${about}`, state: 'held', ...more })
/** The backlog with these steps ticked, so only the others are open. */
const ticked = (...ids) => ids.reduce((text, id) => text.replace(`- [ ] ${id} `, `- [x] ${id} `), BACKLOG)
/** The backlog with a step's lines under it replaced by these. */
const withBlock = (id, lines) => {
  const all = BACKLOG.split('\n')
  const at = all.findIndex(line => line.startsWith(`- [ ] ${id} `))
  let end = at + 1
  while (end < all.length && all[end].startsWith('  ')) end += 1
  return [...all.slice(0, at + 1), ...lines, ...all.slice(end)].join('\n')
}

// What refined means

test('a step is refined only when its block says "; ready": an older block, answered or accepted, is not', () => {
  const state = build()
  const refined = id => isRefined(stepOf(state, id).refined)
  assert.deepEqual(['B10', 'B11', 'B12', 'B13', 'B14', 'B19'].map(refined), [false, false, false, false, false, true])
  assert.equal(stepOf(state, 'B19').refined.ready, true)
})

test('where a step stands in its refine: not refined, the Advisor on it, your answers waiting, answered, ready', () => {
  const state = build({ outbox: [refineSent(NOW - 2 * MIN, 'B20', { state: 'waiting', deliveredAt: undefined })] })
  const where = id => refineStateOf(stepOf(state, id))
  assert.deepEqual(['B10', 'B20', 'B13', 'B11', 'B12', 'B14', 'B19'].map(where), ['none', 'asking', 'answers', 'answered', 'answered', 'answered', 'ready'])
  // The state carries it per step.
  assert.equal(stepOf(state, 'B13').refineState, 'answers')
})

test('the ready form keeps its lines inside the block, "What we build" too, and the step\'s own lines after it', () => {
  const text = withBlock('B20', [...ready, '  Context: asked by the herd.'])
  const step = stepOf(build({ backlogText: text }), 'B20')
  assert.deepEqual(step.refined.questions, [])
  assert.equal(step.refineState, 'ready')
  assert.deepEqual(step.notes.map(part => part.title), ['Context'])
})

test('while refining, the newer form keeps its open questions in the block', () => {
  const text = withBlock('B20', [
    '  Refined (2026-10-17 01:05):',
    '  Summary: A tower to watch the herd from.',
    '  Picture: pictures/tower/v1.png (the layout)',
    '  Part of: G9 M2 · Version 1',
    '  Size: about 3 hours',
    '  Questions:',
    '  - Stone or wood? I advise stone.',
    '  Context: asked by the herd.',
  ])
  const step = stepOf(build({ backlogText: text }), 'B20')
  assert.deepEqual(step.refined.questions, [{ text: 'Stone or wood? I advise stone.', answer: null, advice: null, why: '' }])
  assert.equal(step.refineState, 'answers')
  assert.deepEqual(step.notes.map(part => part.title), ['Context'])
})

test('an ask is answered by a block written since it, also in the newer form that names no round', () => {
  const asked = refineSent(NOW - 20 * MIN, 'B20', { round: 2 })
  const before = withBlock('B20', ['  Refined (2026-10-17 01:05):', '  Questions:', '  - Stone? Answer: yes'])
  assert.equal(stepOf(build({ backlogText: before, outbox: [asked] }), 'B20').refineAsk.isOpen, true)
  const local = new Date(NOW - 5 * MIN)
  const pad = n => String(n).padStart(2, '0')
  const when = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`
  const after = withBlock('B20', [`  Refined (${when}; ready):`, '  Summary: A tower.'])
  assert.equal(stepOf(build({ backlogText: after, outbox: [asked] }), 'B20').refineAsk.isOpen, false)
})

// A queue ask waits for the refine

test('the person\'s queue ask for a refined step goes to the main chat at once, as before', () => {
  const checked = checkSay({ to: 'Lead', command: 'queue', step: 'B19' }, build(), 2000)
  assert.equal(checked.ok, true)
  assert.equal(checked.message.held, undefined)
})

test('the person\'s queue ask for a step that is not refined is held on the board, and counts as asked', () => {
  for (const id of ['B10', 'B11']) {
    const checked = checkSay({ to: 'Lead', command: 'queue', step: id }, build(), 2000)
    assert.deepEqual([checked.ok, checked.message.held], [true, true], id)
  }
  const held = build({ outbox: [queueHeld(NOW - MIN, 'B10')] })
  assert.deepEqual(stepOf(held, 'B10').queueAsk, { at: NOW - MIN, state: 'held', isOpen: true })
  assert.equal(checkSay({ to: 'Lead', command: 'queue', step: 'B10' }, held, 2000).status, 409)
})

test('a held queue ask goes to the main chat once its step is ready, and is dropped when the step left the backlog', () => {
  const held = queueHeld(NOW - 20 * MIN, 'B10')
  assert.deepEqual(refineWhenDue(build({ backlogText: withBlock('B10', ready), outbox: [held] }), [held], gate(20), NOW).release, [held.id])
  // Not ready yet: it waits.
  assert.deepEqual(refineWhenDue(build({ outbox: [held] }), [held], gate(20), NOW).release, [])
  // Ticked, or gone from the backlog: nothing left to queue.
  assert.deepEqual(refineWhenDue(build({ backlogText: ticked('B10'), outbox: [held] }), [held], gate(20), NOW).drop, [held.id])
})

test('a held ask stays known on the board, however long the refine takes', () => {
  const held = queueHeld(NOW - 30 * HOUR, 'B10')
  assert.deepEqual(outboxNow([held], NOW, { messageMs: 10 * MIN, answerMs: 48 * HOUR }).map(one => one.id), [held.id])
  assert.equal(stepOf(build({ outbox: [held] }), 'B10').queueAsk.isOpen, true)
})

// The board refines by itself, one at a time

test('a step the person asked to queue is refined first, before a queued one and a new one', () => {
  const held = queueHeld(NOW - MIN, 'B10')
  const due = refineWhenDue(build({ outbox: [held] }), [held], gate(15), NOW)
  assert.deepEqual([due.refine?.about, due.refine?.why, due.refine?.to], ['B10', 'queue', 'Advisor'])
  assert.equal(due.refine?.text, 'refine step\nStep: B10 Teach the zebracorn to sing\nRound: 1')
})

test('a step the main chat queued before it was refined is refined next', () => {
  const due = refineWhenDue(build(), [], gate(30), NOW)
  assert.deepEqual([due.refine?.about, due.refine?.why], ['B15', 'queued'])
})

test('a new step gets one refine: once asked, never again by itself; an old step only when it is about to be queued', () => {
  const quiet = ticked('B11', 'B12', 'B14', 'B15')
  // B20 is new (above B19, the highest step the board saw when refining began); B10 is old.
  assert.equal(refineWhenDue(build({ backlogText: quiet }), [], gate(19), NOW).refine?.about, 'B20')
  const asked = refineSent(NOW - 2 * HOUR, 'B20')
  assert.equal(refineWhenDue(build({ backlogText: quiet, outbox: [asked] }), [asked], gate(19), NOW).refine, null)
  // One that did not arrive is asked again.
  const failed = refineSent(NOW - 2 * HOUR, 'B20', { state: 'failed' })
  assert.equal(refineWhenDue(build({ backlogText: quiet, outbox: [failed] }), [failed], gate(19), NOW).refine?.about, 'B20')
})

test('one at a time: nothing new goes to the Advisor while a refine is open, the person\'s too', () => {
  const open = refineSent(NOW - 2 * MIN, 'B13', { state: 'taken', deliveredAt: undefined, round: 2 })
  assert.equal(refineWhenDue(build({ outbox: [open] }), [open], gate(15), NOW).refine, null)
})

test('never the person\'s steps, finished ones or steps in progress', () => {
  // Each time only that step is left open, and every step counts as new.
  for (const id of ['B16', 'B17', 'B18']) {
    const text = BACKLOG.replace(/- \[ \] (B1[0-9]|B20)\b/g, (whole, sid) => (sid === id ? whole : `- [x] ${sid}`))
    assert.equal(refineWhenDue(build({ backlogText: text }), [], gate(0), NOW).refine, null, id)
  }
})

test('answers not folded in yet go to the Advisor once more, once per block; questions open wait for the person', () => {
  const only = ticked('B12', 'B13', 'B14', 'B15', 'B20')
  // B11 is new here (since 10): its answered block is folded in.
  const due = refineWhenDue(build({ backlogText: only }), [], gate(10), NOW)
  assert.deepEqual([due.refine?.about, due.refine?.why, due.refine?.round, due.refine?.board], ['B11', 'new', 2, true])
  assert.equal(due.refine?.text, "refine step\nStep: B11 Paint the narwhal bridge\nRound: 2\nThe answers and feedback are written in the step's refine block.")
  // Asked about this very block: not again, also once the ask is no longer open; an older ask made after it counts too.
  const asked = { ...refineSent(NOW - 3 * HOUR, 'B11', { round: 2 }), board: true, before: due.refine.before }
  assert.equal(refineWhenDue(build({ backlogText: only, outbox: [asked] }), [asked], gate(10), NOW).refine, null)
  const earlier = refineSent(NOW - 3 * HOUR, 'B11', { round: 2 })
  assert.equal(refineWhenDue(build({ backlogText: only, outbox: [earlier] }), [earlier], gate(10), NOW).refine, null)
  // Open questions wait for the person.
  assert.equal(refineWhenDue(build({ backlogText: ticked('B11', 'B12', 'B14', 'B15', 'B20') }), [], gate(10), NOW).refine, null)
  // An old step's answered block waits until the step is about to be queued.
  assert.equal(refineWhenDue(build({ backlogText: only }), [], gate(30), NOW).refine, null)
})

test('the board stops after three asks that arrived, and after three that did not; after one that did not, it waits', () => {
  const quiet = ticked('B11', 'B12', 'B14', 'B15')
  const tries = (n, more) => Array.from({ length: n }, (_, k) => ({ ...refineSent(NOW - (5 - k) * HOUR, 'B20', more), id: `t${k}`, board: true, before: `x${k}` }))
  assert.equal(refineWhenDue(build({ backlogText: quiet }), tries(2), gate(19), NOW).refine?.about, 'B20')
  assert.equal(refineWhenDue(build({ backlogText: quiet }), tries(3), gate(19), NOW).refine, null)
  assert.equal(refineWhenDue(build({ backlogText: quiet }), tries(3, { state: 'expired' }), gate(19), NOW).refine, null)
  const lost = { ...refineSent(NOW - 5 * MIN, 'B20', { state: 'expired' }), board: true }
  assert.equal(refineWhenDue(build({ backlogText: quiet }), [lost], gate(19), NOW).refine, null)
  assert.equal(refineWhenDue(build({ backlogText: quiet }), [{ ...lost, at: NOW - 20 * MIN }], gate(19), NOW).refine?.about, 'B20')
})

test('without an Advisor nothing is held: a queue ask goes as before, and one held earlier goes now', () => {
  const alone = build({ chats: ['Lead', 'Worker 1'] })
  assert.equal(checkSay({ to: 'Lead', command: 'queue', step: 'B10' }, alone, 2000).message.held, undefined)
  const held = queueHeld(NOW - MIN, 'B10')
  const due = refineWhenDue(build({ chats: ['Lead', 'Worker 1'], outbox: [held] }), [held], gate(20), NOW)
  assert.deepEqual([due.release, due.refine], [[held.id], null])
})

test('a step the main chat queued while not refined is said to it once it is refined, also when another ask refined it', () => {
  // The first look sees B15 queued and not refined, and keeps it.
  const first = refineWhenDue(build(), [], gate(30), NOW)
  assert.deepEqual(first.kept.waiting, ['B15'])
  assert.equal(first.notice, null)
  const readyQueued = withBlock('B15', ready)
  const due = refineWhenDue(build({ backlogText: readyQueued }), [], first.kept, NOW)
  assert.deepEqual([due.notice?.to, due.notice?.command], ['Lead', 'refined'])
  assert.equal(due.notice?.text, 'step refined\nStep: B15 Tune the star harp\nFor: Worker 1')
  assert.deepEqual(due.kept.waiting, [])
  assert.equal(refineWhenDue(build({ backlogText: readyQueued }), [], due.kept, NOW).notice, null)
  // A step that was ready when it was queued was handed out as usual: nothing to say.
  assert.equal(refineWhenDue(build({ backlogText: readyQueued }), [], gate(30), NOW).notice, null)
  // The word waits for the main chat as long as an answer does.
  const told = { ...due.notice, id: 'n1', at: NOW - 3 * HOUR, state: 'waiting' }
  assert.deepEqual(outboxNow([told], NOW, { messageMs: 10 * MIN, answerMs: 48 * HOUR }).map(one => one.state), ['waiting'])
})

test('the person\'s Refine remembers the block it is about, and a block that changed since answers it', () => {
  const checked = checkSay({ to: 'Advisor', command: 'refine', step: 'B13' }, build(), 2000)
  assert.equal(typeof checked.message.before, 'string')
  const asked = { ...refineSent(NOW - 2 * MIN, 'B13', { round: 2 }), before: checked.message.before }
  assert.equal(stepOf(build({ outbox: [asked] }), 'B13').refineAsk.isOpen, true)
  const changed = withBlock('B13', older(['How much? Answer: a lot', 'At noon? Answer: yes']))
  assert.equal(stepOf(build({ backlogText: changed, outbox: [asked] }), 'B13').refineAsk.isOpen, false)
})

test('where refining began: the highest step, and the steps queued then unrefined, which go as before; not before the backlog is read', () => {
  assert.deepEqual(firstLook(null, build()), { since: 20, queuedBefore: ['B15'], waiting: [] })
  assert.deepEqual(firstLook({ since: 12, queuedBefore: ['B9'] }, build()), { since: 12, queuedBefore: ['B9'], waiting: [] })
  // A file without the steps queued before is made anew; an empty backlog (not read yet) makes nothing.
  assert.deepEqual(firstLook({ since: 12 }, build()), { since: 20, queuedBefore: ['B15'], waiting: [] })
  assert.equal(firstLook(null, build({ backlogText: '' })), null)
  // B15 was queued before: the board does not refine it for its queue, nor keep it to tell the main chat about it.
  const due = refineWhenDue(build({ backlogText: ticked('B11', 'B12', 'B14') }), [], gate(30, ['B15']), NOW)
  assert.deepEqual([due.refine, due.kept.waiting], [null, []])
})

test('the page: a held ask says the Advisor refines it first; the button says so for a step not refined yet', async () => {
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  const part = script.slice(script.indexOf('function queuePart('), script.indexOf('function askQueue('))
  assert.match(part, /if \(ask\?\.isOpen === true && ask\.state === 'held'\) \{/)
  assert.match(part, /the Advisor refines it first, then it goes to \$\{mainTitle\} by itself/)
  assert.match(part, /const isRefined = step\.refineState === 'ready'/)
  assert.match(part, /Not refined yet: the Advisor refines it first, then \$\{mainTitle\} picks the worker\./)
})
