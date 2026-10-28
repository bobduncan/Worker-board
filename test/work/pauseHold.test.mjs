// The review of Pause 2 (2026-10-18), fix first. 1: an app restart only loses a turn in flight, files on disk survive:
// "Safe to restart" is no chat running a turn (nor in the app's question form) and no line handed to a chat; a held
// step with no checkpoint is said, and resumes from its branch and History. 2: while the person pauses (2026-10-19:
// while pausing only, no longer until running) the board hands out nothing that starts a turn: no delivery, no pull, no note-wake, no outbox line taken (but the
// board's own "resume" to the main chat); what the person types waits, and does not grow late. 3: once the main
// chat's process runs while resuming and it has done nothing, the board types "resume" into it, once. Made-up samples.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, typed } from '../../fixtures/lines.mjs'
import { parseConfig } from '../../src/config.mjs'
import { isLate, memoryStore } from '../../src/store.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork, mayWake } from '../../src/work/deliver.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { heldMs, pauseAnswer, pauseFacts, resumeRetypeTo } from '../../src/work/pause.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { buildState } from '../withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 18, 22, 0).getTime()
const LANES = [
  { name: 'Main', isMain: true, state: 'free', between: null, turnAt: NOW - 30 * MIN, appSession: 'local_Main' },
  { name: 'Board', isMain: false, state: 'free', between: null, turnAt: NOW - 20 * MIN, appSession: 'local_Board' },
  { name: 'Support', isMain: false, state: 'free', between: null, turnAt: NOW - 25 * MIN, appSession: 'local_Support' },
]
const held = (id, owner, more = '') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: in progress\nOwner: ${owner}\nSince: 2026-10-18 20:00\n${more}\n## History\n- 2026-10-18 20:00 Main: queued for ${owner}\n- 2026-10-18 20:05 ${owner}: open → taken\n- 2026-10-18 20:06 ${owner}: taken → in progress\n- 2026-10-18 21:10 ${owner}: step 2/4, the strip\n`)
const PAUSING = { state: 'pausing', since: NOW - 5 * MIN, by: 'person' }

test('1: Safe needs no turn in flight and no line handed out; a step with no checkpoint is said and blocks nothing', () => {
  const items = new Map([['B313', held('B313', 'Board', 'Branch: b313-strip\n')]])
  const { chats: _chats, ...facts } = pauseFacts({ pause: PAUSING, items, lanes: LANES })
  assert.deepEqual(facts, { state: 'pausing', since: PAUSING.since, working: [], asking: [], typing: [], unsaved: [{ chat: 'Board', id: 'B313' }], offBoard: [], isSafe: true })
  // A chat of the list that is gone holds one too: named, not waited for.
  items.set('B9', held('B9', 'Ghost'))
  assert.equal(pauseFacts({ pause: PAUSING, items, lanes: LANES }).isSafe, true)
  // A chat in the app's question form is no working chat: it waits for the person, and its turn is in flight.
  const asking = LANES.map(lane => (lane.name === 'Support' ? { ...lane, state: 'waiting', isAsking: true } : lane))
  assert.deepEqual(pauseFacts({ pause: PAUSING, items, lanes: asking }).asking, ['Support'])
  assert.deepEqual(pauseFacts({ pause: PAUSING, items, lanes: asking }).working, [])
  assert.equal(pauseFacts({ pause: PAUSING, items, lanes: asking }).isSafe, false)
  // A line handed to a chat (taken, not typed yet) starts a turn: not safe until it is typed.
  const typing = pauseFacts({ pause: PAUSING, items, lanes: LANES, pending: [{ to: 'Board' }, { to: 'Board' }] })
  assert.deepEqual([typing.typing, typing.isSafe], [['Board'], false])
})

test('1: the pause state gives a held step its branch and last History lines, to resume from without a checkpoint', () => {
  const items = new Map([['B313', held('B313', 'Board', 'Branch: b313-strip\n')], ['B314', held('B314', 'Support')]])
  const forBoard = pauseAnswer({ pause: { state: 'resuming', since: NOW, pausedSince: NOW - 9 * MIN, by: 'person' }, items, lanes: LANES, chat: 'Board', role: 'worker' })
  assert.deepEqual(forBoard.forChat.holds, [{
    id: 'B313', checkpoint: null, branch: 'b313-strip',
    history: ['2026-10-18 20:05 Board: open → taken', '2026-10-18 20:06 Board: taken → in progress', '2026-10-18 21:10 Board: step 2/4, the strip'],
  }])
  const forMain = pauseAnswer({ pause: { state: 'resuming', since: NOW, pausedSince: NOW - 9 * MIN, by: 'person' }, items, lanes: LANES, chat: 'Main', role: 'main' })
  assert.deepEqual(forMain.resumeList.map(one => [one.step, one.session, one.branch]), [['B313', 'local_Board', 'b313-strip'], ['B314', 'local_Support', null]])
})

test('3: the board types "resume" into a main chat that runs while resuming and has done nothing since, once', () => {
  const pause = { state: 'resuming', since: NOW, waiting: [{ chat: 'Board', ids: ['B313'] }], isResumed: false, typedAt: null, main: { name: 'Main', title: 'Team - Main', session: 'local_Main', isRunning: true, hasActed: false } }
  assert.equal(resumeRetypeTo({ pause }), 'Main')
  assert.equal(resumeRetypeTo({ pause: { ...pause, typedAt: NOW + MIN } }), null)
  assert.equal(resumeRetypeTo({ pause: { ...pause, main: { ...pause.main, hasActed: true } } }), null)
  assert.equal(resumeRetypeTo({ pause: { ...pause, main: { ...pause.main, isRunning: null } } }), null)
  assert.equal(resumeRetypeTo({ pause: { ...pause, waiting: [], isResumed: true } }), null)
  assert.equal(resumeRetypeTo({ pause: { ...PAUSING, main: pause.main } }), null)
  assert.equal(resumeRetypeTo({ pause: null }), null)
})

test('2: a line waiting in the outbox does not grow late while the board holds it', () => {
  // A line is kept answerMs (B548): ten minutes here, so the hold shows in minutes.
  const keep = { messageMs: 10 * MIN, answerMs: 10 * MIN }
  const line = { id: 'l1', at: NOW - 20 * MIN, to: 'Main', ask: null, text: 'Hand out B290', state: 'waiting' }
  assert.equal(isLate(line, NOW, keep), true)
  // Paused five minutes after it was sent: it had waited five minutes when the hold began.
  assert.equal(isLate(line, NOW, { ...keep, pause: { state: 'pausing', since: NOW - 15 * MIN } }), false)
  assert.equal(heldMs(line, NOW, { state: 'pausing', since: NOW - 15 * MIN }), 15 * MIN)
  // Running again since a minute: held from the pause to then, so six minutes of waiting.
  const ran = { state: 'running', since: NOW - MIN, pausedSince: NOW - 15 * MIN }
  assert.equal(heldMs(line, NOW, ran), 14 * MIN)
  assert.equal(isLate(line, NOW, { ...keep, pause: ran }), false)
  assert.equal(isLate(line, NOW + 5 * MIN, { ...keep, pause: ran }), true)
  // A line already late before the pause stays late.
  assert.equal(isLate({ ...line, at: NOW - 40 * MIN }, NOW, { ...keep, pause: { state: 'pausing', since: NOW - 15 * MIN } }), true)
})

test('2: while the person pauses the outbox hands out only the board\'s "resume" to the main chat', async () => {
  const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
  const outbox = memoryStore()
  await outbox.say({ id: 'a1', at: NOW - MIN, to: 'Main', ask: 'Q3', text: 'yes', state: 'waiting' })
  await outbox.say({ id: 'r1', at: NOW - MIN, to: 'Main', ask: null, command: 'resume', text: 'resume', state: 'waiting' })
  const taken = await outbox.take('Main', NOW, keep, message => message.command === 'resume')
  assert.deepEqual(taken.map(one => one.id), ['r1'])
  assert.equal(outbox.outbox().find(one => one.id === 'a1').state, 'waiting')
  assert.deepEqual((await outbox.take('Main', NOW, keep)).map(one => one.id), ['a1'])
})

const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', ''].join('\n')
const app = (name, at) => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at, lastAssistantUuid: 'u-1' })
const tail = at => ({ text: [typed(at - 10 * MIN, 'Plant it'), answer(at, 'Done for now.')].join('\n'), isCut: false, modifiedAt: at })

async function garden() {
  const dir = await mkdtemp(join(tmpdir(), 'pause-hold-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  const ctx = at => ({ dir, now: at, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, freeChats: new Set(['Digger']) })
  const digger = (body, at = NOW) => workApi({ chat: 'Digger', ...body }, ctx(at))
  const server = (body, at = NOW) => workApi(body, { ...ctx(at), as: 'server' })
  const person = (body, at = NOW) => workApi(body, { ...ctx(at), as: 'person' })
  const build = async ({ outbox = [] } = {}) => {
    const work = { ok: true, dir, ...(await readStore(dir)) }
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead', NOW - 5 * MIN), app('Digger', NOW - 5 * MIN)],
      tails: { 'cli-Digger': tail(NOW - 5 * MIN), 'cli-Lead': tail(NOW - 5 * MIN) }, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
    }
    const seen = { shown: { Lead: NOW, Digger: NOW }, other: {} }
    return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen, now: NOW, config })
  }
  let n = 0
  const deliver = (state, outbox) => deliverWork({ state, dir, outbox, apply: body => server(body), now: NOW, maxChars: 2000, newId: () => `m${(n += 1)}` })
  return { dir, digger, person, build, deliver }
}

test('2: while the person pauses no step is delivered, no pull is answered, and no chat may be woken; after the resume it all goes on', async () => {
  const { dir, digger, person, build, deliver } = await garden()
  try {
    await person({ action: 'pause-all' }, NOW - 10 * MIN)
    const paused = await build()
    assert.equal(mayWake(paused, 'Digger'), false)
    const outbox = memoryStore()
    const done = await deliver(paused, outbox)
    assert.deepEqual([done.sent, outbox.outbox()], [[], []])
    // The worker's pull at its turn's end, alone or with turn-ended: nothing.
    assert.equal((await digger({ action: 'pull' })).result.wake, null)
    assert.equal((await digger({ action: 'turn-ended', since: NOW - MIN, pull: true })).result.pull.wake, null)
    // 2026-10-19: resuming holds nothing (it is there to get chats started); running keeps when the pause began and
    // when the resume began.
    await person({ action: 'resume-all' }, NOW - 5 * MIN)
    assert.deepEqual((await digger({ action: 'pull' })).result.wake, { to: 'Digger', id: 'B1' })
    await person({ action: 'end-resume' }, NOW - 2 * MIN)
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'pause.json'), 'utf8')), { state: 'running', since: NOW - 2 * MIN, by: 'person', pausedSince: NOW - 10 * MIN, resumedSince: NOW - 5 * MIN })
    assert.deepEqual((await digger({ action: 'pull' })).result.wake, { to: 'Digger', id: 'B1' })
    const again = await deliver(await build(), outbox)
    assert.equal(again.sent.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('2: what waits in the outbox while the person pauses is shown as held until resume; a line handed out counts as typing', async () => {
  const { dir, person, build } = await garden()
  try {
    await person({ action: 'pause-all' }, NOW - 10 * MIN)
    const outbox = [
      { id: 'l1', at: NOW - 2 * MIN, to: 'Lead', ask: null, text: 'Hand out B290', state: 'waiting' },
      { id: 't1', at: NOW - 3 * MIN, to: 'Digger', ask: null, text: 'Go on', state: 'taken', takenAt: NOW - MIN },
    ]
    const state = await build({ outbox })
    assert.equal(state.mainTalk.pending.find(one => one.id === 'l1').isHeld, true)
    assert.deepEqual([state.pause.typing, state.pause.isSafe], [['Digger'], false])
    assert.equal(state.pause.main.hasActed, false)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'board.js'), 'utf8')
const two = n => String(n).padStart(2, '0')
const page = { clock: ms => { const at = new Date(ms); return `${two(at.getHours())}:${two(at.getMinutes())}` } }
vm.runInNewContext(`${script.slice(script.indexOf('// pause:start'), script.indexOf('// pause:end'))}\nObject.assign(this, { pauseLines, pauseRing })`, page)
const linesOf = pause => JSON.parse(JSON.stringify(page.pauseLines(pause)))
const ringOf = pause => JSON.parse(JSON.stringify(page.pauseRing(pause)))

test('the page: Safe from turns in flight alone; a step with no checkpoint is information; the question form and a line being typed', () => {
  const since = new Date(2026, 9, 18, 21, 1).getTime()
  const base = { state: 'pausing', since, working: [], asking: [], typing: [], unsaved: [], offBoard: [], isSafe: true, chats: [{ name: 'Board', state: 'still' }], main: null, typedAt: null }
  // B364: a pause shows as its ring; the words of a pause are no lines any more.
  assert.deepEqual(linesOf(base), [])
  assert.deepEqual([ringOf(base).head, ringOf(base).notes], ['All still: safe to restart', ['Paused since 21:01.']])
  assert.deepEqual(ringOf({ ...base, unsaved: [{ chat: 'Board', id: 'B313' }], offBoard: [{ chat: 'Ghost', id: 'B9', title: 'Team - Ghost' }] }).notes, [
    'Paused since 21:01.',
    'B313 (Board) has no checkpoint; it resumes from its branch and History.',
    'B9 (Team - Ghost, not on the board) has no checkpoint; it resumes from its branch and History.',
  ])
  const busy = ringOf({ ...base, working: ['Board'], asking: ['Support'], typing: ['Digger'], isSafe: false, chats: [{ name: 'Board', state: 'working' }, { name: 'Support', state: 'asking' }, { name: 'Digger', state: 'typing' }] })
  assert.deepEqual([busy.head, busy.still, busy.of], ['Pausing…', 0, 3])
  assert.deepEqual(busy.groups.map(group => group.text), ['Board', 'Support (waiting for you)', 'Digger'])
  assert.deepEqual(busy.notes, ['Paused since 21:01.', 'A line is being typed into Digger.'])
})

test('the page: a line held by the pause says "held until resume"', () => {
  assert.match(script, /isHeld \? 'held until resume'/)
})

test('the server: a take while paused hands out only "resume"; it types "resume" into a main chat that came up, once; the hold does not make lines late', async () => {
  const server = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.mjs'), 'utf8')
  // B547: else, for a worker that owes a clear, all but its next step's line. B755: and never a hand's word in its first minute.
  assert.match(server, /isHolding\(\(await readState\(\)\)\.pause\) \? message => message\.command === 'resume'\s+: atTake\.hold \? message => !isStepLine\(message\) && !isForHandsYet\(message, now, workers\) : message => !isForHandsYet\(message, now, workers\)/)
  assert.match(server, /const retype = isShowOnly \? null : resumeRetypeTo\(state\)/)
  assert.match(server, /retyped\.add\(/)
  assert.match(server, /keep\.pause = raw\.work\?\.pause \?\? null/)
})
