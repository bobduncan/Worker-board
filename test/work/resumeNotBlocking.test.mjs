// Seen live 2026-10-19: after Resume all at 12:24 pause.json stayed `resuming` for two hours. While pausing OR resuming
// the board handed out nothing that starts a turn, and it set running only once every chat holding a step had started a
// turn since the resume. The person answered Worker 1's blocking ask at 12:41; the answer was held ("held until
// resume"), Worker 1 never started a turn, so the resume never ended: a deadlock, until the person's End resume.
// Now: only pausing holds lines back; while resuming everything is handed out as when running. Running comes once every
// holder started a turn since the resume, or 20 minutes after it, whichever is first; a chat counts once, whatever steps
// it holds; after those 20 minutes the banner names for an hour, as information, who did not start. Lines held while
// pausing go out at the resume, not late for the time they were held. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, typed } from '../../fixtures/lines.mjs'
import { parseConfig } from '../../src/config.mjs'
import { answerWords } from '../../src/say.mjs'
import { isLate, memoryStore } from '../../src/store.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork, mayWake } from '../../src/work/deliver.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { RESUME_WAIT_MS, heldMs, isHolding, parsePause, pauseFacts, resumeEnds } from '../../src/work/pause.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { buildState } from '../withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 19, 12, 41).getTime()
const RESUMED = new Date(2026, 9, 19, 12, 24).getTime()
const PAUSED = new Date(2026, 9, 19, 11, 50).getTime()
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }

const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', '- [ ] B2 Water the beds (for Raker; about 1 h)', ''].join('\n')
const app = (name, at) => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at, lastAssistantUuid: 'u-1' })
/** A turn that ended at `at`, begun ten minutes before. */
const tail = at => ({ text: [typed(at - 10 * MIN, 'Plant it'), answer(at, 'Done for now.')].join('\n'), isCut: false, modifiedAt: at })

/** A garden with a main chat (Lead) and two workers; Digger holds B1 and asked the person something that blocks it. */
async function garden() {
  const dir = await mkdtemp(join(tmpdir(), 'resume-not-blocking-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: PAUSED - 60 * MIN }), undefined, { now: PAUSED - 60 * MIN })
  const ctx = at => ({ dir, now: at, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Digger: 'worker', Raker: 'worker' })[chat] ?? null, freeChats: new Set(['Digger', 'Raker']) })
  const digger = (body, at = NOW) => workApi({ chat: 'Digger', ...body }, ctx(at))
  const raker = (body, at = NOW) => workApi({ chat: 'Raker', ...body }, ctx(at))
  const server = (body, at = NOW) => workApi(body, { ...ctx(at), as: 'server' })
  const person = (body, at = NOW) => workApi(body, { ...ctx(at), as: 'person' })
  const build = async ({ outbox = [], turns = {} } = {}) => {
    const work = { ok: true, dir, ...(await readStore(dir)) }
    const ended = { Lead: PAUSED - 5 * MIN, Digger: PAUSED - 5 * MIN, Raker: PAUSED - 5 * MIN, ...turns }
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: ['Lead', 'Digger', 'Raker'].map(name => app(name, ended[name])),
      tails: Object.fromEntries(Object.entries(ended).map(([name, at]) => [`cli-${name}`, tail(at)])), planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
    }
    const seen = { shown: { Lead: NOW, Digger: NOW, Raker: NOW }, other: {} }
    return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen, now: NOW, config })
  }
  let n = 0
  const deliver = (state, outbox) => deliverWork({ state, dir, outbox, apply: body => server(body), now: NOW, maxChars: 2000, newId: () => `m${(n += 1)}`, keep: KEEP })
  return { dir, digger, raker, server, person, build, deliver }
}

/** The server's take (server.mjs `take`, `keep.pause` pause.json's record): while the pause holds, only the board's own "resume" goes. */
const takeAsServer = (outbox, chat, state, record, now = NOW) => outbox.take(chat, now, { ...KEEP, pause: record }, isHolding(state.pause) ? message => message.command === 'resume' : undefined)

test('the deadlock of 2026-10-19: while resuming, the person\'s answer to a holder\'s blocking ask is handed out, not held until resume', async () => {
  const { dir, digger, person, build } = await garden()
  try {
    await digger({ action: 'take', id: 'B1' }, PAUSED - 30 * MIN)
    const asked = await digger({ action: 'ask', of: 'B1', kind: 'decide', blocking: true, text: 'Hedge of beech or of yew?', options: ['A beech', 'B yew'] }, PAUSED - 20 * MIN)
    assert.equal(asked.ok, true)
    const q = asked.result.id
    assert.equal(valueOf((await readStore(dir)).items.get('B1'), 'State'), 'waiting on you')
    await person({ action: 'pause-all' }, PAUSED)
    await person({ action: 'resume-all' }, RESUMED)
    // 12:41: the person answers; the board puts the answer for Digger into the outbox (server.mjs sendWakes).
    const answered = await person({ action: 'answer', id: q, text: 'A' }, NOW)
    assert.equal(answered.ok, true)
    const outbox = memoryStore()
    await outbox.say({ id: 'a1', at: NOW, ...answerWords(answered.result.wake), state: 'waiting' })
    const state = await build({ outbox: outbox.outbox() })
    assert.equal(state.pause.state, 'resuming')
    // Digger has not started a turn since the resume: the resume waits for it ...
    assert.deepEqual(state.pause.waiting, [{ chat: 'Digger', ids: ['B1'] }])
    // ... and the answer that would start that turn is not held: shown as on its way, and handed out at Digger's take.
    assert.equal(isHolding(state.pause), false)
    assert.deepEqual((await takeAsServer(outbox, 'Digger', state, (await readStore(dir)).pause)).map(one => one.id), ['a1'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('1: only pausing holds; while resuming deliveries, pulls, note-wakes and every outbox line go as when running', async () => {
  assert.equal(isHolding({ state: 'pausing', since: PAUSED }), true)
  assert.equal(isHolding({ state: 'resuming', since: RESUMED }), false)
  assert.equal(isHolding({ state: 'running', since: RESUMED }), false)
  const { dir, digger, person, build, deliver } = await garden()
  try {
    await person({ action: 'pause-all' }, PAUSED)
    const lines = [
      { id: 'l1', at: PAUSED + MIN, to: 'Lead', ask: null, text: 'Hand out B290', state: 'waiting' },
      { id: 'r1', at: RESUMED, to: 'Lead', ask: null, command: 'resume', text: 'resume', state: 'waiting' },
    ]
    const paused = await build({ outbox: lines })
    assert.equal(paused.mainTalk.pending.find(one => one.id === 'l1').isHeld, true)
    await person({ action: 'resume-all' }, RESUMED)
    const resuming = await build({ outbox: lines })
    assert.equal(resuming.pause.state, 'resuming')
    assert.equal(resuming.mainTalk.pending.find(one => one.id === 'l1').isHeld, undefined)
    assert.equal(mayWake(resuming, 'Digger'), true)
    assert.deepEqual((await digger({ action: 'pull' })).result.wake, { to: 'Digger', id: 'B1' })
    assert.deepEqual((await digger({ action: 'turn-ended', since: NOW - MIN, pull: true })).result.pull.wake, { to: 'Digger', id: 'B1' })
    const outbox = memoryStore()
    const done = await deliver(resuming, outbox)
    assert.deepEqual(done.sent.map(one => [one.to, one.about]), [['Digger', 'B1'], ['Raker', 'B2']])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('3: lines held while pausing are handed out at the resume, not late for the time the pause held them', async () => {
  // A plain line (ten minutes to live) sent two minutes before the pause, an answer during it; the pause lasts 34 minutes.
  const line = { id: 'l1', at: PAUSED - 2 * MIN, to: 'Digger', ask: null, text: 'Go on', state: 'waiting' }
  const reply = { id: 'a1', at: PAUSED + 5 * MIN, to: 'Digger', ask: 'work:Q3', step: 'Q3', text: 'A', state: 'waiting' }
  const pausing = { state: 'pausing', since: PAUSED }
  const resuming = { state: 'resuming', since: RESUMED, pausedSince: PAUSED }
  // While resuming the hold has ended: held from the pause to the resume, no longer.
  assert.equal(heldMs(line, RESUMED + 5 * MIN, resuming), RESUMED - PAUSED)
  assert.equal(heldMs(reply, RESUMED + 5 * MIN, resuming), RESUMED - PAUSED - 5 * MIN)
  // A plain line is kept answerMs (B548): ten minutes here, so the hold shows in minutes.
  const short = { ...KEEP, answerMs: 10 * MIN }
  assert.equal(isLate(line, RESUMED + 5 * MIN, { ...short, pause: resuming }), false)
  assert.equal(isLate(line, RESUMED + 9 * MIN, { ...short, pause: resuming }), true)
  // Running after the resume: the hold ended at the resume (`resumedSince`), not when running was set.
  const running = { state: 'running', since: RESUMED + 20 * MIN, pausedSince: PAUSED, resumedSince: RESUMED }
  assert.equal(heldMs(line, RESUMED + 25 * MIN, running), RESUMED - PAUSED)
  // A record from before (no resumedSince) keeps its old reading: held until running.
  assert.equal(heldMs(line, RESUMED + 25 * MIN, { state: 'running', since: RESUMED + 20 * MIN, pausedSince: PAUSED }), RESUMED + 20 * MIN - PAUSED)
  // Pausing holds them; the resume hands both out.
  const outbox = memoryStore()
  await outbox.say({ ...line })
  await outbox.say({ ...reply })
  assert.deepEqual(await outbox.take('Digger', PAUSED + 20 * MIN, { ...KEEP, pause: pausing }, message => message.command === 'resume'), [])
  const taken = await outbox.take('Digger', RESUMED + MIN, { ...KEEP, pause: resuming }, isHolding(resuming) ? () => false : undefined)
  assert.deepEqual(taken.map(one => one.id), ['l1', 'a1'])
})

test('2: a chat that holds steps counts once, with each step it holds, a stale hold too; it is back once it started any turn', () => {
  const step = (id, owner, state = 'in progress') => ({ head: new Map([['Id', id], ['Kind', 'step'], ['State', state], ['Owner', owner]]), sections: new Map() })
  const items = new Map([['B1', step('B1', 'Board')], ['B7', step('B7', 'Board', 'taken')], ['B2', step('B2', 'Support', 'waiting on you')]])
  const lanes = [
    { name: 'Main', isMain: true, state: 'free', between: null, turnAt: RESUMED - 40 * MIN },
    { name: 'Board', isMain: false, state: 'free', between: null, turnAt: RESUMED - 40 * MIN },
    { name: 'Support', isMain: false, state: 'free', between: null, turnAt: RESUMED - 40 * MIN },
  ]
  const pause = { state: 'resuming', since: RESUMED, by: 'person', pausedSince: PAUSED }
  const facts = pauseFacts({ pause, items, lanes, now: RESUMED + 5 * MIN })
  assert.deepEqual(facts, { state: 'resuming', since: RESUMED, waiting: [{ chat: 'Board', ids: ['B1', 'B7'] }, { chat: 'Support', ids: ['B2'] }], isResumed: false, until: RESUMED + RESUME_WAIT_MS })
  const back = lanes.map(lane => (lane.name === 'Board' ? { ...lane, turnAt: RESUMED + 2 * MIN } : lane))
  assert.deepEqual(pauseFacts({ pause, items, lanes: back, now: RESUMED + 5 * MIN }).waiting, [{ chat: 'Support', ids: ['B2'] }])
})

test('2: running comes once every holder started a turn since the resume, or 20 minutes after it, whichever is first', () => {
  assert.equal(RESUME_WAIT_MS, 20 * MIN)
  const waiting = { state: 'resuming', since: RESUMED, waiting: [{ chat: 'Digger', ids: ['B1'] }], isResumed: false }
  assert.equal(resumeEnds(waiting, RESUMED + 19 * MIN), false)
  assert.equal(resumeEnds(waiting, RESUMED + 20 * MIN), true)
  assert.equal(resumeEnds({ ...waiting, waiting: [], isResumed: true }, RESUMED + MIN), true)
  assert.equal(resumeEnds({ state: 'pausing', since: PAUSED }, PAUSED + 3 * 60 * MIN), false)
  assert.equal(resumeEnds({ state: 'running', since: RESUMED }, RESUMED + 30 * MIN), false)
  assert.equal(resumeEnds(null, NOW), false)
  assert.equal(resumeEnds({ ...waiting, since: null }, NOW), false)
})

test('2: the board\'s running after 20 minutes keeps who did not start, and when the resume began; End resume keeps when it began', async () => {
  const { dir, digger, raker, server, person } = await garden()
  const lanes = [
    { name: 'Lead', isMain: true, state: 'free', between: null, turnAt: RESUMED + MIN },
    { name: 'Digger', isMain: false, state: 'free', between: null, turnAt: PAUSED - 5 * MIN },
    { name: 'Raker', isMain: false, state: 'free', between: null, turnAt: RESUMED + 3 * MIN },
  ]
  try {
    await digger({ action: 'take', id: 'B1' }, PAUSED - 30 * MIN)
    await raker({ action: 'take', id: 'B2' }, PAUSED - 30 * MIN)
    await person({ action: 'pause-all' }, PAUSED)
    await person({ action: 'resume-all' }, RESUMED)
    const ran = await workApi({ action: 'resumed' }, { dir, now: RESUMED + 20 * MIN, as: 'server', prefix: 'Garden · ', lanes })
    assert.equal(ran.ok, true)
    const record = JSON.parse(await readFile(join(dir, 'pause.json'), 'utf8'))
    assert.deepEqual(record, { state: 'running', since: RESUMED + 20 * MIN, by: 'server', pausedSince: PAUSED, resumedSince: RESUMED, notStarted: [{ chat: 'Digger', ids: ['B1'] }] })
    assert.deepEqual(parsePause(JSON.stringify(record)), record)
    // A broken list is left out, the rest of the record stands.
    assert.deepEqual(parsePause(JSON.stringify({ ...record, notStarted: [{ chat: 7 }, 'x'] })), { ...record, notStarted: [] })
    // The person's End resume: running, with when the resume began; no list (the person saw who did not start).
    await person({ action: 'pause-all' }, NOW)
    await person({ action: 'resume-all' }, NOW + MIN)
    await person({ action: 'end-resume' }, NOW + 2 * MIN)
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'pause.json'), 'utf8')), { state: 'running', since: NOW + 2 * MIN, by: 'person', pausedSince: NOW, resumedSince: NOW + MIN })
    void server
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('2: after the 20 minutes the facts name for an hour, as information, the holders that did not start; one that starts later drops out', () => {
  const step = (id, owner) => ({ head: new Map([['Id', id], ['Kind', 'step'], ['State', 'in progress'], ['Owner', owner]]), sections: new Map() })
  const items = new Map([['B364', step('B364', 'Worker 6')], ['B188', step('B188', 'Worker 1')]])
  const lanes = [
    { name: 'Worker 6', isMain: false, state: 'free', between: null, turnAt: PAUSED - 5 * MIN },
    { name: 'Worker 1', isMain: false, state: 'free', between: null, turnAt: PAUSED - 5 * MIN },
  ]
  const pause = { state: 'running', since: RESUMED + 20 * MIN, by: 'server', pausedSince: PAUSED, resumedSince: RESUMED, notStarted: [{ chat: 'Worker 6', ids: ['B364'] }, { chat: 'Worker 1', ids: ['B188'] }] }
  assert.deepEqual(pauseFacts({ pause, items, lanes, now: RESUMED + 30 * MIN }), { state: 'running', since: RESUMED + 20 * MIN, notStarted: [{ chat: 'Worker 6', ids: ['B364'] }, { chat: 'Worker 1', ids: ['B188'] }] })
  const one = lanes.map(lane => (lane.name === 'Worker 1' ? { ...lane, turnAt: RESUMED + 25 * MIN } : lane))
  assert.deepEqual(pauseFacts({ pause, items, lanes: one, now: RESUMED + 30 * MIN }).notStarted, [{ chat: 'Worker 6', ids: ['B364'] }])
  // An hour after running, it is said no more; nor without a list.
  assert.deepEqual(pauseFacts({ pause, items, lanes, now: RESUMED + 80 * MIN }), { state: 'running', since: RESUMED + 20 * MIN })
  assert.deepEqual(pauseFacts({ pause: { state: 'running', since: RESUMED, by: 'server' }, items, lanes, now: RESUMED + MIN }), { state: 'running', since: RESUMED })
})

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'board.js'), 'utf8')
const two = n => String(n).padStart(2, '0')
const page = { clock: ms => { const at = new Date(ms); return `${two(at.getHours())}:${two(at.getMinutes())}` } }
vm.runInNewContext(`${script.slice(script.indexOf('// pause:start'), script.indexOf('// pause:end'))}\nObject.assign(this, { pauseLines })`, page)
const linesOf = pause => JSON.parse(JSON.stringify(page.pauseLines(pause)))

test('the page: the resume names each chat once with its steps and when the board goes on by itself; then, for an hour, who did not start', () => {
  const resuming = { state: 'resuming', since: RESUMED, waiting: [{ chat: 'Worker 1', ids: ['B188', 'B190'] }], isResumed: false, until: RESUMED + RESUME_WAIT_MS, main: null, typedAt: null }
  assert.deepEqual(linesOf(resuming), [{ tone: '', text: 'Resuming since 12:24: not started yet: Worker 1 (B188, B190). The board goes on without waiting at 12:44.' }])
  assert.deepEqual(linesOf({ ...resuming, waiting: [], isResumed: true }), [{ tone: '', text: 'Resuming since 12:24: every chat that holds a step has started again.' }])
  const running = { state: 'running', since: RESUMED + 20 * MIN, notStarted: [{ chat: 'Worker 6', ids: ['B364'] }, { chat: 'Worker 1', ids: ['B188', 'B190'] }] }
  assert.deepEqual(linesOf(running), [
    { tone: 'muted', text: 'Worker 6 did not start after the resume: B364.' },
    { tone: 'muted', text: 'Worker 1 did not start after the resume: B188, B190.' },
  ])
  assert.deepEqual(linesOf({ state: 'running', since: RESUMED }), [])
})

test('the server: running once resumeEnds says so (every holder back, or 20 minutes after the resume)', async () => {
  const server = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.mjs'), 'utf8')
  assert.match(server, /if \(resumeEnds\(state\.pause, clock\(\)\)\) \{/)
})
