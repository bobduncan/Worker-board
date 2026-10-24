// Pause and resume from the store (spec 2026-10-18-pause-resume-design.md, part 1): a step's checkpoint in its record,
// the board's pause.json, and the `pause-state` the Workers mod reads. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { checkpointOf, pauseAnswer, pauseFacts } from '../../src/work/pause.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 18, 21, 0).getTime()
const MIN = 60_000
const BACKLOG = [
  '# Backlog',
  '',
  '## Board work',
  '- [ ] B1 Draw the strip (for Board; about 1 h)',
  '- [ ] B2 Keep the cards apart (for Support; about 30 min)',
  '- [ ] B3 A new idea (later; not handed out)',
  '',
].join('\n')
const ROLES = { Main: 'main', Board: 'worker', Support: 'worker', Advisor: 'advisor' }
const LANES = [
  { name: 'Main', isMain: true, state: 'free', between: null, turnAt: NOW - 30 * MIN, session: 'cli-Main', appSession: 'local_Main', isRunning: false },
  { name: 'Board', isMain: false, state: 'working', between: null, turnAt: NOW - 20 * MIN, session: 'cli-Board', appSession: 'local_Board', isRunning: true },
  { name: 'Support', isMain: false, state: 'free', between: null, turnAt: NOW - 25 * MIN, session: 'cli-Support', appSession: 'local_Support', isRunning: true },
]

async function fresh(lanes = LANES) {
  const dir = await mkdtemp(join(tmpdir(), 'work-pause-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  let now = NOW
  const ctx = () => ({ dir, now, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board', 'Support']), lanes })
  const as = chat => body => workApi({ chat, ...body }, ctx())
  return {
    dir, at: ms => { now = ms },
    main: as('Main'), board: as('Board'), support: as('Support'),
    person: body => workApi(body, { ...ctx(), as: 'person' }), server: body => workApi(body, { ...ctx(), as: 'server' }),
  }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)

test('work step takes commit and next: the step record holds its checkpoint, and History one line per checkpoint', async () => {
  const { dir, board, at } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' })
    at(NOW + 5 * MIN + 7_000)
    const saved = await board({ action: 'step', id: 'B1', commit: 'a1b2c3d', next: 'wire the strip into the page' })
    assert.equal(saved.ok, true)
    assert.equal(saved.result.text, 'B1: checkpoint a1b2c3d · wire the strip into the page.')
    assert.equal(valueOf(await item(dir, 'B1'), 'Checkpoint'), 'a1b2c3d · wire the strip into the page · 2026-10-18 21:05:07')
    assert.equal((await item(dir, 'B1')).sections.get('History').at(-1), '- 2026-10-18 21:05 Board: checkpoint a1b2c3d · wire the strip into the page')
    // A checkpoint without a commit says "none"; the newest stands, History keeps each.
    at(NOW + 9 * MIN)
    await board({ action: 'step', id: 'B1', next: 'write the test first' })
    assert.equal(valueOf(await item(dir, 'B1'), 'Checkpoint'), 'none · write the test first · 2026-10-18 21:09:00')
    assert.deepEqual((await item(dir, 'B1')).sections.get('History').slice(-2), ['- 2026-10-18 21:05 Board: checkpoint a1b2c3d · wire the strip into the page', '- 2026-10-18 21:09 Board: checkpoint none · write the test first'])
    assert.deepEqual(checkpointOf(await item(dir, 'B1')), { commit: 'none', next: 'write the test first', at: NOW + 9 * MIN, line: 'none · write the test first · 2026-10-18 21:09:00' })
    // With a plan step too: both lines.
    await board({ action: 'step', id: 'B1', step: 2, names: ['Read', 'Draw'], commit: 'ffee001', next: 'draw it' })
    assert.deepEqual((await item(dir, 'B1')).sections.get('History').slice(-2), ['- 2026-10-18 21:09 Board: step 2/2, Draw', '- 2026-10-18 21:09 Board: checkpoint ffee001 · draw it'])
    // The store reads it back without a problem.
    assert.deepEqual((await readStore(dir)).problems, [])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a checkpoint needs its next action and a commit that is a hash or none; a taken step takes one too', async () => {
  const { dir, board, support, server } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' })
    assert.deepEqual(await board({ action: 'step', id: 'B1', commit: 'a1b2c3d' }), { ok: false, status: 400, why: '"next" is the next action, in one line.' })
    assert.deepEqual(await board({ action: 'step', id: 'B1', commit: 'not a hash', next: 'x' }), { ok: false, status: 400, why: '"commit" is the commit hash, or none.' })
    // Another chat's step: refused as before.
    assert.equal((await support({ action: 'step', id: 'B1', next: 'mine now' })).status, 409)
    // B2 is queued for Support; the board moves it to taken: a checkpoint stands on a taken step too.
    assert.equal((await server({ action: 'advance', id: 'B2', to: 'taken' })).ok, true)
    assert.equal(valueOf(await item(dir, 'B2'), 'State'), 'taken')
    assert.equal((await support({ action: 'step', id: 'B2', next: 'take it and start' })).ok, true)
    assert.match(valueOf(await item(dir, 'B2'), 'Checkpoint'), /^none · take it and start · /)
    // A plan step on a taken step is still refused: it is taken first.
    assert.equal((await support({ action: 'step', id: 'B2', step: 1 })).status, 409)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('pause-all and resume-all are the person\'s: they write pause.json in the store folder', async () => {
  const { dir, board, person, at } = await fresh()
  try {
    assert.equal((await board({ action: 'pause-all' })).status, 403)
    const paused = await person({ action: 'pause-all' })
    assert.equal(paused.ok, true)
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'pause.json'), 'utf8')), { state: 'pausing', since: NOW, by: 'person' })
    // Pausing again keeps the first time.
    at(NOW + MIN)
    assert.equal((await person({ action: 'pause-all' })).result.changed, false)
    assert.equal(JSON.parse(await readFile(join(dir, 'pause.json'), 'utf8')).since, NOW)
    at(NOW + 20 * MIN)
    await person({ action: 'resume-all' })
    // The resume keeps when the pause began: a checkpoint of the pause still counts as one in the main chat's list.
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'pause.json'), 'utf8')), { state: 'resuming', since: NOW + 20 * MIN, by: 'person', pausedSince: NOW })
    // Only the board sets running, and only from resuming.
    assert.equal((await person({ action: 'resumed' })).status, 403)
    at(NOW + 25 * MIN)
    assert.equal((await workApi({ action: 'resumed' }, { dir, now: NOW + 25 * MIN, as: 'server' })).ok, true)
    // The review of Pause 2: running keeps when the pause began, for the outbox's lines it held.
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'pause.json'), 'utf8')), { state: 'running', since: NOW + 25 * MIN, by: 'server', pausedSince: NOW, resumedSince: NOW + 20 * MIN })
    assert.equal((await workApi({ action: 'resumed' }, { dir, now: NOW + 26 * MIN, as: 'server' })).result.changed, false)
    // pause.json is no item: the store has no problem with it.
    assert.deepEqual((await readStore(dir)).problems, [])
    // Resume all without a pause before it (a cut-off chat): it writes resuming all the same.
    await rm(join(dir, 'pause.json'))
    assert.equal((await person({ action: 'resume-all' })).ok, true)
    assert.equal(JSON.parse(await readFile(join(dir, 'pause.json'), 'utf8')).state, 'resuming')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('pause-state: running without pause.json; while pausing every chat must stop, with the steps it holds and their checkpoints', async () => {
  const { dir, board, support, person, at } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' })
    await board({ action: 'step', id: 'B1', commit: 'a1b2c3d', next: 'wire it' })
    const none = await board({ action: 'pause-state' })
    // The review of Pause 2: each hold carries its branch and last History lines too.
    const [hold] = none.result.forChat.holds
    assert.ok(Array.isArray(hold.history) && hold.history.length > 0 && hold.history.length <= 3)
    assert.deepEqual({ ...none.result, text: undefined, forChat: { ...none.result.forChat, holds: none.result.forChat.holds.map(({ history: _h, ...rest }) => rest) } }, {
      text: undefined, state: 'running', since: null,
      forChat: { holds: [{ id: 'B1', checkpoint: { commit: 'a1b2c3d', next: 'wire it', at: NOW, line: 'a1b2c3d · wire it · 2026-10-18 21:00:00', isSincePause: false }, branch: null }], mustStop: false },
      resumeList: [],
    })
    at(NOW + MIN)
    await person({ action: 'pause-all' })
    const pausing = await board({ action: 'pause-state' })
    assert.equal(pausing.result.state, 'pausing')
    assert.equal(pausing.result.since, NOW + MIN)
    assert.equal(pausing.result.forChat.mustStop, true)
    assert.equal(pausing.result.forChat.holds[0].checkpoint.isSincePause, false)
    // A chat holding nothing must stop too.
    assert.deepEqual((await support({ action: 'pause-state' })).result.forChat, { holds: [], mustStop: true })
    at(NOW + 2 * MIN)
    await board({ action: 'step', id: 'B1', commit: 'b2c3d4e', next: 'wire it, then test' })
    assert.equal((await board({ action: 'pause-state' })).result.forChat.holds[0].checkpoint.isSincePause, true)
    // pause-state changes nothing.
    assert.equal((await board({ action: 'pause-state' })).result.changed, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('pause-state while resuming: the main chat gets the list of who to wake, by session, with step and checkpoint; turn-ended carries the same', async () => {
  // After the app's restart: Board's chat does not run yet.
  const { dir, board, main, person, at } = await fresh(LANES.map(lane => (lane.name === 'Board' ? { ...lane, state: 'off', isRunning: false } : lane)))
  try {
    await board({ action: 'take', id: 'B1' })
    await board({ action: 'step', id: 'B1', commit: 'a1b2c3d', next: 'wire it' })
    at(NOW + 30 * MIN)
    await person({ action: 'resume-all' })
    const asked = await main({ action: 'pause-state' })
    assert.equal(asked.result.state, 'resuming')
    assert.deepEqual(asked.result.resumeList, [{ chat: 'Board', session: 'local_Board', cliSession: 'cli-Board', step: 'B1', checkpoint: { commit: 'a1b2c3d', next: 'wire it', at: NOW, line: 'a1b2c3d · wire it · 2026-10-18 21:00:00', isSincePause: false }, branch: null, hasStarted: false }])
    // A worker gets no list, only its own holds.
    assert.deepEqual((await board({ action: 'pause-state' })).result.resumeList, [])
    // The existing turn-ended call answers the pause state too: part 2 needs no new call.
    const ended = await main({ action: 'turn-ended', since: NOW + 31 * MIN })
    assert.deepEqual(ended.result.pause, { state: asked.result.state, since: asked.result.since, forChat: asked.result.forChat, resumeList: asked.result.resumeList })
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the facts of a pause: who still works, who holds a step without a checkpoint since the pause (said, not waited for), then safe', () => {
  const step = (id, owner, checkpoint = null) => ({ head: new Map([['Id', id], ['Kind', 'step'], ['State', 'in progress'], ['Owner', owner], ...(checkpoint === null ? [] : [['Checkpoint', checkpoint]])]), sections: new Map() })
  const items = new Map([['B1', step('B1', 'Board', 'a1b2c3d · wire it · 2026-10-18 21:02:00')], ['B2', step('B2', 'Team - Support')]])
  const pause = { state: 'pausing', since: NOW + MIN, by: 'person' }
  const facts = pauseFacts({ pause, items, lanes: LANES, prefix: 'Team - ' })
  const chats = [{ name: 'Main', state: 'still' }, { name: 'Board', state: 'working' }, { name: 'Support', state: 'still' }]
  assert.deepEqual(facts, { state: 'pausing', since: NOW + MIN, working: ['Board'], asking: [], typing: [], unsaved: [{ chat: 'Support', id: 'B2' }], offBoard: [], isSafe: false, chats })
  // A chat that is between two turns (held, not running one) is not working.
  const calm = LANES.map(lane => ({ ...lane, state: lane.name === 'Board' ? 'working' : lane.state, between: lane.name === 'Board' ? 'its card names a task' : null }))
  items.set('B2', step('B2', 'Support', 'none · start · 2026-10-18 21:03:00'))
  assert.deepEqual(pauseFacts({ pause, items, lanes: calm, prefix: 'Team - ' }), { state: 'pausing', since: NOW + MIN, working: [], asking: [], typing: [], unsaved: [], offBoard: [], isSafe: true, chats: chats.map(chat => ({ ...chat, state: 'still' })) })
  // A checkpoint from before the pause does not count.
  items.set('B2', step('B2', 'Support', 'none · start · 2026-10-18 20:59:00'))
  assert.deepEqual(pauseFacts({ pause, items, lanes: calm, prefix: 'Team - ' }).unsaved, [{ chat: 'Support', id: 'B2' }])
  // A step whose chat is no lane on the board is not among the unsaved: it is named apart (`offBoard`, review 2).
  items.set('B3', step('B3', 'Gone'))
  assert.deepEqual(pauseFacts({ pause, items, lanes: calm, prefix: 'Team - ' }).unsaved, [{ chat: 'Support', id: 'B2' }])
})

test('B364: the facts of a pause name every chat of the board by its state, for the loader of the panel: working, asking, typing, still or off', () => {
  const pause = { state: 'pausing', since: NOW + MIN, by: 'person' }
  const lanes = [
    ...LANES,
    { name: 'Advisor', isMain: false, state: 'free', between: null, isAsking: true, turnAt: NOW, session: 'cli-A', appSession: 'local_A', isRunning: true },
    { name: 'Worker 5', isMain: false, state: 'off', between: null, turnAt: NOW - 90 * MIN, session: 'cli-5', appSession: 'local_5', isRunning: false },
    { name: 'Helper', isMain: false, state: 'free', between: null, turnAt: NOW - 9 * MIN, session: 'cli-H', appSession: 'local_H', isRunning: true },
  ]
  const facts = pauseFacts({ pause, items: new Map(), lanes, prefix: 'Team - ', pending: [{ to: 'Team - Helper' }] })
  assert.deepEqual(facts.chats, [
    { name: 'Main', state: 'still' }, { name: 'Board', state: 'working' }, { name: 'Support', state: 'still' },
    { name: 'Advisor', state: 'asking' }, { name: 'Worker 5', state: 'off' }, { name: 'Helper', state: 'typing' },
  ])
  // The review: a line handed to a chat that does not run yet, or to one that is no lane, is typing too, as isSafe waits for it.
  const handed = pauseFacts({ pause, items: new Map(), lanes, prefix: 'Team - ', pending: [{ to: 'Team - Worker 5' }, { to: 'Team - Ghost' }] })
  assert.deepEqual(handed.chats.filter(chat => chat.state === 'typing'), [{ name: 'Worker 5', state: 'typing' }, { name: 'Ghost', state: 'typing' }])
  assert.equal(handed.isSafe, false)
})

test('the facts of a resume: who has not started a turn since, and when every holder has (then the board sets running)', () => {
  const step = (id, owner) => ({ head: new Map([['Id', id], ['Kind', 'step'], ['State', 'in progress'], ['Owner', owner]]), sections: new Map() })
  const items = new Map([['B1', step('B1', 'Board')], ['B2', step('B2', 'Support')]])
  const pause = { state: 'resuming', since: NOW, by: 'person' }
  const off = LANES.map(lane => ({ ...lane, state: 'off', isRunning: false }))
  const facts = pauseFacts({ pause, items, lanes: off, prefix: '' })
  assert.deepEqual(facts, { state: 'resuming', since: NOW, waiting: [{ chat: 'Board', ids: ['B1'] }, { chat: 'Support', ids: ['B2'] }], isResumed: false, until: NOW + 20 * MIN })
  // Board's turn started after the resume; Support runs one now.
  const back = off.map(lane => (lane.name === 'Board' ? { ...lane, state: 'free', turnAt: NOW + MIN } : lane.name === 'Support' ? { ...lane, state: 'working', turnAt: NOW - 50 * MIN } : lane))
  assert.deepEqual(pauseFacts({ pause, items, lanes: back, prefix: '' }), { state: 'resuming', since: NOW, waiting: [], isResumed: true, until: NOW + 20 * MIN })
  assert.deepEqual(pauseFacts({ pause: { state: 'running', since: NOW, by: 'server' }, items, lanes: back, prefix: '' }), { state: 'running', since: NOW })
  assert.equal(pauseFacts({ pause: null, items, lanes: back, prefix: '' }), null)
  // The answer for a chat of the list that holds nothing.
  assert.deepEqual(pauseAnswer({ pause: null, items, lanes: back, prefix: '', chat: 'Main', role: 'main' }), { state: 'running', since: null, forChat: { holds: [], mustStop: false }, resumeList: [] })
})

test('a broken pause.json is no pause', async () => {
  const { dir, board } = await fresh()
  try {
    await writeFile(join(dir, 'pause.json'), '{ not json')
    assert.equal((await board({ action: 'pause-state' })).result.state, 'running')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('after Resume all the board types "resume" only into a main chat that runs; else the banner opens it', async () => {
  const { resumeTypeTo } = await import('../../src/work/pause.mjs')
  const state = running => ({ restart: { main: 'Main' }, chats: [{ name: 'Main', isMain: true, isRunning: running }, { name: 'Board', isMain: false, isRunning: true }] })
  assert.equal(resumeTypeTo(state(true)), 'Main')
  assert.equal(resumeTypeTo(state(false)), null)
  assert.equal(resumeTypeTo(state(null)), null)
  assert.equal(resumeTypeTo({ restart: { main: null }, chats: [] }), null)
})

test('after a pause, the resume list of the main chat marks a checkpoint written during the pause as one since the pause', async () => {
  const { dir, board, main, person, at } = await fresh(LANES.map(lane => (lane.name === 'Board' ? { ...lane, state: 'off', isRunning: false } : lane)))
  try {
    await board({ action: 'take', id: 'B1' })
    at(NOW + MIN)
    await person({ action: 'pause-all' })
    at(NOW + 2 * MIN)
    await board({ action: 'step', id: 'B1', commit: 'a1b2c3d', next: 'wire it' })
    at(NOW + 20 * MIN)
    await person({ action: 'resume-all' })
    const list = (await main({ action: 'pause-state' })).result.resumeList
    assert.deepEqual(list.map(one => [one.step, one.checkpoint.isSincePause, one.hasStarted]), [['B1', true, false]])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

// The review of part 1: fix first.
const held = (id, owner, state = 'in progress', checkpoint = null) => ({ head: new Map([['Id', id], ['Kind', 'step'], ['State', state], ['Owner', owner], ...(checkpoint === null ? [] : [['Checkpoint', checkpoint]])]), sections: new Map() })
const calm = LANES.map(lane => ({ ...lane, state: lane.name === 'Board' ? 'free' : lane.state }))

test('review 1: a step waiting on you or in review is held as the work API holds it: it is named (the review of Pause 2: it blocks no Safe); a resume wakes the one waiting on you', () => {
  const items = new Map([['B1', held('B1', 'Board', 'waiting on you')], ['B2', held('B2', 'Support', 'review')]])
  const pausing = pauseFacts({ pause: { state: 'pausing', since: NOW, by: 'person' }, items, lanes: calm })
  assert.deepEqual([pausing.unsaved, pausing.isSafe], [[{ chat: 'Board', id: 'B1' }, { chat: 'Support', id: 'B2' }], true])
  // 2026-10-24: a step in review leaves its chat nothing to pick up again: the resume neither waits for it nor wakes it
  // (Worker 1's four steps in review kept the banner up for twenty minutes and an hour after).
  const resuming = pauseFacts({ pause: { state: 'resuming', since: NOW + MIN, by: 'person' }, items, lanes: calm })
  assert.deepEqual(resuming.waiting, [{ chat: 'Board', ids: ['B1'] }])
  const list = pauseAnswer({ pause: { state: 'resuming', since: NOW + MIN, by: 'person' }, items, lanes: calm, chat: 'Main', role: 'main' }).resumeList
  assert.deepEqual(list.map(one => one.step), ['B1'])
  // Only steps in review: nobody to wait for, so the resume is done at once.
  const reviewOnly = new Map([['B2', held('B2', 'Support', 'review')]])
  const done = pauseFacts({ pause: { state: 'resuming', since: NOW + MIN, by: 'person' }, items: reviewOnly, lanes: calm })
  assert.deepEqual([done.waiting, done.isResumed], [[], true])
})

test('review 1: a checkpoint stands on a step waiting on you or in review too', async () => {
  const { dir, board, server } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' })
    await board({ action: 'report', id: 'B1', result: 'it is in' })
    assert.equal(valueOf(await item(dir, 'B1'), 'State'), 'review')
    assert.equal((await board({ action: 'step', id: 'B1', next: 'wait for the check' })).ok, true)
    void server
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('review 2: a held step whose chat is not on the board is named with its title (the review of Pause 2: it blocks no Safe)', () => {
  const items = new Map([['B2', held('B2', 'Ghost')]])
  const facts = pauseFacts({ pause: { state: 'pausing', since: NOW, by: 'person' }, items, lanes: calm, prefix: 'Team - ' })
  assert.deepEqual([facts.offBoard, facts.isSafe], [[{ chat: 'Ghost', id: 'B2', title: 'Team - Ghost' }], true])
  // With a checkpoint since the pause its work is kept: no longer named.
  items.set('B2', held('B2', 'Ghost', 'in progress', 'none · go on · 2026-10-18 21:01:00'))
  assert.deepEqual(pauseFacts({ pause: { state: 'pausing', since: NOW, by: 'person' }, items, lanes: calm, prefix: 'Team - ' }).offBoard, [])
})

test('review 3: background work, a lane the board cannot read, and a turn open behind a stale "suspended" all count as working', () => {
  const items = new Map()
  const pause = { state: 'pausing', since: NOW, by: 'person' }
  const lanes = [
    { ...calm[0] },
    { ...calm[1], state: 'working', between: 'Its turn has ended; background work it started is still running.', heldBy: 'background' },
    { ...calm[2], state: 'unknown' },
    { name: 'Sound', isMain: false, state: 'suspended', between: null, isTurnOpen: true },
    { name: 'Held', isMain: false, state: 'working', between: 'Its turn has ended; its task is not reported yet.', heldBy: 'task' },
    { name: 'Gone', isMain: false, state: 'off', isTurnOpen: true },
  ]
  assert.deepEqual(pauseFacts({ pause, items, lanes }).working, ['Board', 'Support', 'Sound'])
})

test('review 5: a checkpoint counts from the pause to the millisecond; End resume is the person\'s and sets running', async () => {
  const items = new Map([['B1', held('B1', 'Board', 'in progress', 'none · go on · 2026-10-18 21:00:00')]])
  assert.deepEqual(pauseFacts({ pause: { state: 'pausing', since: NOW + 400, by: 'person' }, items, lanes: calm }).unsaved, [{ chat: 'Board', id: 'B1' }])
  const { dir, board, person } = await fresh()
  try {
    assert.equal((await board({ action: 'end-resume' })).status, 403)
    // Only from resuming.
    assert.equal((await person({ action: 'end-resume' })).result.changed, false)
    await person({ action: 'resume-all' })
    assert.equal((await person({ action: 'end-resume' })).ok, true)
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'pause.json'), 'utf8')), { state: 'running', since: NOW, by: 'person', resumedSince: NOW })
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
