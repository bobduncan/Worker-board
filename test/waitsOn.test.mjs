// P1 of the one wait system (chat 1's plan 2026-11-09, the person's "Yes, build now"): a worker that waits on purpose is not stuck.
// The B1081 case, replayed: Worker 4 wrote at 11:18 that it waits for chat 1's go to land, went idle at 11:19:11, and the board
// asked it to go on at 11:24 and 11:30 and gave the step back at 11:46. With the wait recorded (`Waits on`, src/work/waitsOn.mjs)
// its lane is parked on purpose, nothing nudges it and nothing is given back; past 90 minutes of running time the person sees one
// Late. The work API's record, the state, the hand-over's decision, Resume all, the landing guard and the words. Made-up chats
// (Lead the main chat, Worker 4 and Worker 5 workers, Advisor the partner); the step and its times are the live ones.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { healthSummary } from '../src/supervisor/health.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { workApi } from '../src/work/api.mjs'
import { decide } from '../src/work/handover.mjs'
import { factsOf } from '../src/work/handoverBoard.mjs'
import { parseItem, valueOf } from '../src/work/item.mjs'
import { LANDING_ASK_WHY } from '../src/work/landingAsk.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { pauseFacts } from '../src/work/pause.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { readStore } from '../src/work/store.mjs'
import { WAIT_ON_MINUTES, chatWaitWords, lateWaitOf, waitWhoProblem, waitsOnLine, waitsOnOf } from '../src/work/waitsOn.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const at = (h, m, s = 0) => new Date(2026, 10, 9, h, m, s).getTime()
const WAIT_AT = at(11, 18)
const IDLE_AT = at(11, 19, 11)
const BRANCH = 'b1081-open-fix-check'
const WAITS_ON = `chat 1 · its go to land · ${stamp(WAIT_AT).slice(0, 16)}`
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Lead', 'Worker 4', 'Worker 5', 'Advisor']
const ROLES = { Lead: 'main', 'Worker 4': 'worker', 'Worker 5': 'worker', Advisor: 'advisor' }
const roleOf = name => ROLES[name] ?? null

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
/** B1081 as Worker 4 held it at 11:18: in progress, its branch pushed, its checkpoint "wait for its go"; `waits` adds the record. */
const b1081 = ({ waits = null, history = [], owner = 'Worker 4', state = 'in progress' } = {}) => text(
  { Id: 'B1081', Kind: 'step', Title: 'Fix: the board makes a check task for a step whose fix is still open', Priority: 'fix', State: state, Owner: owner, Activity: 'Garden', Goal: 'G15', ...(waits === null ? {} : { 'Waits on': waits }), Since: stamp(at(10, 58)), Branch: BRANCH, Checkpoint: `8522bc6c · gate green, branch pushed; tell chat 1 done, wait for its go, then land · ${stamp(WAIT_AT)}`, 'Taken for': '30 min', Refined: 'ready' },
  { History: [`- ${stamp(at(10, 58))} Worker 4: queued → taken`, `- ${stamp(at(10, 58))} Worker 4: taken → in progress`, `- ${stamp(WAIT_AT)} Worker 4: checkpoint 8522bc6c · gate green, branch pushed; tell chat 1 done, wait for its go, then land`, ...history] })

/// The work API: the record.
async function storeDir(files) {
  const dir = await mkdtemp(join(tmpdir(), 'waits-on-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}
const ctx = (dir, now, more = {}) => ({ dir, now, prefix: '', roleOf, chats: NAMES, pictureProblem: async () => null, ...more })
const chat = (dir, who, body, now, more = {}) => workApi({ ...body, chat: who }, ctx(dir, now, more))
const person = (dir, body, now) => workApi(body, ctx(dir, now, { as: 'person' }))
const field = async (dir, id, key) => valueOf((await readStore(dir)).items.get(id), key)
const history = async (dir, id) => (await readStore(dir)).items.get(id).sections.get('History') ?? []

test('the record: the holder writes a wait on a chat with work block (the live B1081 words); who is checked; the same who keeps the first since; a checkpoint reminds; the holder, the main chat and the person clear it, another worker not', async t => {
  const dir = await storeDir({ B1081: b1081() })
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  // Not the holder: refused; the holder, on no chat: refused with the way to say it.
  assert.equal((await chat(dir, 'Worker 5', { action: 'block', id: 'B1081', on: 'chat 1', why: 'its go to land' }, WAIT_AT)).status, 403)
  for (const who of ['B1079', 'q701', 'X2', 'you', 'the person', 'me']) {
    const made = await chat(dir, 'Worker 4', { action: 'block', id: 'B1081', on: who, why: 'its go' }, WAIT_AT)
    if (/^B\d+$/.test(who)) assert.equal(made.status, 404, who) // a step id takes the Blocked by path, as before
    else assert.match(made.why, /a wait on the person is a blocking ask; a wait on a fix is on=B<n>/, `${who}: ${made.why}`)
  }
  assert.match((await chat(dir, 'Worker 4', { action: 'block', id: 'B1081', on: 'Worker 4' }, WAIT_AT)).why, /cannot wait on itself/)
  assert.match((await chat(dir, 'Worker 4', { action: 'block', id: 'B1081', on: 'Gardener' }, WAIT_AT)).why, /Gardener is no chat of the board/)
  assert.equal(await field(dir, 'B1081', 'Waits on'), null)
  // The record, as Worker 4 should have written it at 11:18.
  const made = await chat(dir, 'Worker 4', { action: 'block', id: 'B1081', on: 'chat 1', why: 'its go to land' }, WAIT_AT)
  assert.equal(made.ok, true, made.why)
  assert.equal(await field(dir, 'B1081', 'Waits on'), WAITS_ON)
  assert.match(made.result.text, /^B1081 waits on chat 1 \(its go to land\) since 11:18\. The board holds it for you: no "go on" line and no give-back for 90 min/)
  assert.match((await history(dir, 'B1081')).at(-1), /Worker 4: waits on chat 1 · its go to land$/)
  // The same who two minutes later: the record stands, with its first since.
  const again = await chat(dir, 'Worker 4', { action: 'block', id: 'B1081', on: 'Chat 1', why: 'its go' }, WAIT_AT + 2 * MIN)
  assert.deepEqual([again.ok, again.result.changed], [true, false])
  assert.equal(await field(dir, 'B1081', 'Waits on'), WAITS_ON)
  // A board chat by name is a who too (the list's names).
  // The forgotten record: a checkpoint while it stands reminds the holder.
  const saved = await chat(dir, 'Worker 4', { action: 'step', id: 'B1081', commit: '03ac0c10', next: 'main merged in and pushed; waiting for chat 1\'s go' }, at(11, 24))
  assert.equal(saved.ok, true, saved.why)
  assert.match(saved.result.text, /You still wait on chat 1 since 11:18 \(its go to land\): work unblock B1081 once it gave its answer\./)
  // Clearing: another worker and the partner may not; the main chat may (with on=<who>).
  assert.equal((await chat(dir, 'Worker 5', { action: 'unblock', id: 'B1081', on: 'chat 1' }, at(11, 25))).status, 403)
  assert.equal((await chat(dir, 'Advisor', { action: 'unblock', id: 'B1081' }, at(11, 25))).status, 403)
  assert.equal(await field(dir, 'B1081', 'Waits on'), WAITS_ON)
  const cleared = await chat(dir, 'Lead', { action: 'unblock', id: 'B1081', on: 'chat 1' }, at(11, 25))
  assert.equal(cleared.ok, true, cleared.why)
  assert.equal(await field(dir, 'B1081', 'Waits on'), null)
  assert.match((await history(dir, 'B1081')).at(-1), /Lead: no longer waits on chat 1 \(its go to land, since 2026-11-09 11:18\)$/)
  // The holder clears with a bare unblock; the person too.
  for (const clear of [body => chat(dir, 'Worker 4', body, at(11, 26)), body => person(dir, body, at(11, 27))]) {
    assert.equal((await chat(dir, 'Worker 4', { action: 'block', id: 'B1081', on: 'Worker 5', why: 'its review' }, at(11, 26))).ok, true)
    assert.equal(await field(dir, 'B1081', 'Waits on'), `Worker 5 · its review · ${stamp(at(11, 26)).slice(0, 16)}`)
    const done = await clear({ action: 'unblock', id: 'B1081' })
    assert.equal(done.ok, true, done.why)
    assert.equal(await field(dir, 'B1081', 'Waits on'), null)
  }
  // Nothing to clear: said so, no change.
  assert.deepEqual((await chat(dir, 'Worker 4', { action: 'unblock', id: 'B1081', on: 'chat 1' }, at(11, 28))).result.changed, false)
})

test('a report, a take and a give-back clear the record; Waits for and Blocked by are untouched by it', async t => {
  const dir = await storeDir({
    B1081: b1081({ waits: WAITS_ON }),
    B2: text({ Id: 'B2', Kind: 'step', Title: 'Water the hedge', State: 'queued', Owner: 'Worker 5', Activity: 'Garden', 'Waits on': `chat 2 · a picture · ${stamp(at(10, 0)).slice(0, 16)}`, Since: stamp(at(10, 30)), Refined: 'ready' }),
    B3: text({ Id: 'B3', Kind: 'step', Title: 'Prune the yew', State: 'in progress', Owner: 'Worker 5', Activity: 'Garden', 'Waits for': 'the person\'s word on the shape', 'Blocked by': 'B2', 'Waits on': `chat 1 · its look · ${stamp(at(10, 0)).slice(0, 16)}`, Since: stamp(at(10, 30)), Refined: 'ready' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  // A report.
  const reported = await chat(dir, 'Worker 4', { action: 'report', id: 'B1081', result: 'Context: the check looped. Change: a step with an open fix waits for it. Details: resultCheck.mjs openFixesOf.', merged: 'bd1e9c9f' }, at(11, 56))
  assert.equal(reported.ok, true, reported.why)
  assert.equal(await field(dir, 'B1081', 'Waits on'), null)
  // A take of a given step that still carried one.
  const taken = await chat(dir, 'Worker 5', { action: 'take', id: 'B2', minutes: 30 }, at(11, 57))
  assert.equal(taken.ok, true, taken.why)
  assert.equal(await field(dir, 'B2', 'Waits on'), null)
  assert.match((await history(dir, 'B2')).join('\n'), /no longer waits on chat 2 at its take/)
  // The board's give-back of a held step; the step's other waits stay as they were.
  const back = await workApi({ action: 'advance', id: 'B3', to: 'refined', giveBack: { chat: 'Worker 5', why: 'Worker 5 did not resume it (asked 11:30)' } }, ctx(dir, at(11, 58), { as: 'server' }))
  assert.equal(back.ok, true, back.why)
  assert.equal(await field(dir, 'B3', 'Waits on'), null)
  assert.deepEqual([await field(dir, 'B3', 'Waits for'), await field(dir, 'B3', 'Blocked by'), await field(dir, 'B3', 'Owner')], ['the person\'s word on the shape', 'B2', null])
})

/// The state: the lane, the hand-over's decision, the Late, Resume all.
const PREFIX = 'Garden · '
const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at(11, 19), lastAssistantUuid: 'u-1' })
const tail = { text: [typed(at(10, 58), 'Take B1081.'), answer(at(11, 19), 'Gate green, branch pushed; waiting for chat 1\'s go.')].join('\n'), isCut: false, modifiedAt: at(11, 19) }
function typed(when, words) { return JSON.stringify({ type: 'user', timestamp: new Date(when).toISOString(), message: { role: 'user', content: words } }) }
function answer(when, words) { return JSON.stringify({ type: 'assistant', timestamp: new Date(when).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: words }] } }) }
/** A report as the server keeps it: idle since 11:19:11, heard `heard`. */
const report = (name, state, since, heard, more = {}) => [name, { state, since, background: false, run: 1, seq: 1, at: heard, session: `cli-${name}`, mod: '0.31.0', busyAt: null, ...more }]
function storeWith(items) {
  const work = storeFromText('## Garden\n', { now: at(9, 0) })
  for (const item of items) {
    work.items.set(item.head.get('Id'), item)
    work.activities[0].steps.push(item.head.get('Id'))
  }
  return work
}
const GO_ONS = [`- ${stamp(at(11, 24))} server: the board asked Worker 4 to go on (stopped since 11:19)`, `- ${stamp(at(11, 30))} server: the board asked Worker 4 to go on (stopped since 11:25)`]
/** The board at `now`: Worker 4 idle since 11:19:11 on B1081 (with or without the record), Worker 5 idle on B5, the app and the board up since 9:00. */
function build({ now, waits = WAITS_ON, history = [], lines = [], items = null }) {
  const work = storeWith(items ?? [parseItem(b1081({ waits, history })), parseItem(text({ Id: 'B5', Kind: 'step', Title: 'Step B5', State: 'in progress', Owner: 'Worker 5', Activity: 'Garden', Since: stamp(at(10, 30)) }))])
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])), planLineTexts: {},
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: at(9, 0),
  }
  const reports = [report('Lead', 'idle', at(11, 0), now - 5_000), report('Worker 4', 'idle', IDLE_AT, now - 5_000), report('Worker 5', 'idle', at(11, 10), now - 5_000), report('Advisor', 'idle', at(11, 0), now - 5_000)]
  const state = buildState(raw, { lines, outbox: [], runs: [], now, config, seen: { shown: {}, other: {} }, board: { startedAt: at(9, 0), offSince: null }, reports: new Map(reports) })
  return { state, work }
}
const laneOf = (state, name) => state.chats.find(one => one.name === name)
/** The hand-over's one decision for Worker 4 at `now`, on the built state (no outbox lines, no pause). */
const decided = ({ state, work }, now, more = {}) => decide({ ...factsOf({ lane: laneOf(state, 'Worker 4'), state: { chatPrefix: PREFIX, readyList: null, limits: state.limits, gaps: state.gaps ?? [] }, items: work.items, pause: null, sent: [], config, now, event: { kind: 'pass' }, ...more }), ready: [], owed: null })

test('the B1081 case with the record: parked on purpose at 11:24, 11:30 and 11:46 (no "go on" line, no give-back), the status and the words say so, heldUntil keeps until null; without the record the board would have nudged and given back', () => {
  for (const now of [at(11, 24, 30), at(11, 30, 30), at(11, 46)]) {
    const built = build({ now, history: now >= at(11, 46) ? GO_ONS : [] })
    const lane = laneOf(built.state, 'Worker 4')
    assert.equal(lane.state, 'suspended', `${new Date(now).toTimeString().slice(0, 8)}: ${lane.state}`)
    assert.deepEqual(lane.suspended, { by: 'parked', kind: 'chat', on: ['chat 1'], what: 'its go to land', since: WAIT_AT, limit: null, until: null, isBack: false })
    assert.equal(lane.status, 'Paused')
    assert.equal(lane.why, 'waits for chat 1 (its go to land) since 11:18')
    const decision = decided(built, now)
    assert.deepEqual([decision.state, decision.envelope, decision.goOn, decision.giveBack, decision.takeBack], ['suspended', null, null, null, null], `${new Date(now).toTimeString().slice(0, 8)}: ${JSON.stringify(decision)}`)
    // The Supervisor's health line: on purpose, not odd.
    const line = healthSummary(buildView({ state: built.state, items: built.work.items, now }), now).split('\n').find(one => one.includes('Worker 4 (')) ?? ''
    assert.match(line, /^- Worker 4 \(worker\): suspended \(on purpose: waits for chat 1 \(its go to land\) since 11:18\)/, line)
    assert.doesNotMatch(line, /^- !/)
    // Nothing of it under Needs your attention (no Late yet, no idle hint).
    assert.deepEqual(built.state.forYou.filter(one => one.from === 'Worker 4').map(one => one.kind), [])
  }
  // The control: the same minutes without the record are the live story: a "go on" line at 11:24:30, the give-back at 11:46.
  const nudged = decided(build({ now: at(11, 24, 30), waits: null }), at(11, 24, 30))
  assert.notEqual(nudged.envelope, null, 'the go-on line goes without the record')
  assert.equal(laneOf(build({ now: at(11, 24, 30), waits: null }).state, 'Worker 4').state, 'interrupted')
  const given = decided(build({ now: at(11, 46), waits: null, history: GO_ONS }), at(11, 46))
  assert.deepEqual(given.giveBack, { step: 'B1081', chat: 'Worker 4', askedAt: at(11, 30) })
  // The words every reader uses.
  assert.equal(chatWaitWords({ by: 'parked', kind: 'chat', on: ['chat 1'], what: 'its go to land', since: WAIT_AT }), 'waits for chat 1 (its go to land) since 11:18')
  assert.equal(waitsOnLine('chat 1', 'its go to land', WAIT_AT), WAITS_ON)
  assert.deepEqual(waitsOnOf(parseItem(b1081({ waits: WAITS_ON }))), { who: 'chat 1', what: 'its go to land', since: WAIT_AT, at: '2026-11-09 11:18', line: WAITS_ON })
  assert.equal(waitsOnOf(parseItem(b1081())), null)
})

test('past 90 minutes of RUNNING time one Late under Needs your attention, linked to the step, and still no give-back; 95 wall minutes with the board off for 30 of them is no Late', () => {
  const late = build({ now: WAIT_AT + 95 * MIN, history: GO_ONS })
  const lane = laneOf(late.state, 'Worker 4')
  assert.equal(lane.state, 'suspended')
  const cards = late.state.forYou.filter(one => one.kind === 'wait late')
  assert.equal(cards.length, 1, JSON.stringify(late.state.forYou.map(one => [one.kind, one.title])))
  assert.deepEqual([cards[0].from, cards[0].title, cards[0].workId, cards[0].at], ['Worker 4', 'Worker 4 waits for chat 1 (its go to land) since 11:18 (95 min)', 'B1081', WAIT_AT])
  assert.match(cards[0].text, /Ask chat 1 for its answer, or tell Worker 4 in its chat to go on without it \(work unblock B1081\)/)
  assert.deepEqual([decided(late, WAIT_AT + 95 * MIN).giveBack, decided(late, WAIT_AT + 95 * MIN).envelope], [null, null])
  // The board was off from 11:30 to 12:00: 65 running minutes, no Late (the wall clock is not the limit).
  const lines = [{ at: at(11, 30), gap: true }, { at: at(12, 0), chat: 'Worker 4', state: 'interrupted', task: null }]
  const off = build({ now: WAIT_AT + 95 * MIN, history: GO_ONS, lines })
  assert.deepEqual(off.state.gaps, [{ from: at(11, 30), to: at(12, 0) }])
  assert.deepEqual(off.state.forYou.filter(one => one.kind === 'wait late'), [])
  // Under the limit by a minute: none; at it: one.
  assert.deepEqual(build({ now: WAIT_AT + (WAIT_ON_MINUTES - 1) * MIN }).state.forYou.filter(one => one.kind === 'wait late'), [])
  assert.equal(build({ now: WAIT_AT + WAIT_ON_MINUTES * MIN }).state.forYou.filter(one => one.kind === 'wait late').length, 1)
  // The helper alone, with the board's running time as given.
  assert.equal(lateWaitOf({ name: 'Worker 4', suspended: { by: 'parked', kind: 'chat', on: ['chat 1'], what: 'its go to land', since: 0 } }, { stepId: 'B1081', runningMs: () => 89 * MIN }), null)
  assert.equal(lateWaitOf({ name: 'Worker 4', suspended: { by: 'parked', on: ['B5'], since: 0 } }, { runningMs: () => 500 * MIN }), null, 'a step wait is no chat wait')
})

test('Resume all leaves a step with a standing wait out of its resume list; the other holder is waited for', () => {
  const built = build({ now: at(11, 46) })
  const facts = pauseFacts({ pause: { state: 'resuming', since: at(11, 46) }, items: built.work.items, lanes: built.state.chats, prefix: PREFIX })
  assert.deepEqual(facts.waiting.map(one => one.chat), ['Worker 5'])
})

test('the double hold guard: no give-back of a step whose branch a landing is running for now; another branch, or none, changes nothing', () => {
  const built = build({ now: at(11, 46), waits: null, history: GO_ONS })
  const decision = decided(built, at(11, 46), { landing: BRANCH })
  assert.deepEqual([decision.state, decision.giveBack, decision.envelope, decision.landing], ['working', null, null, BRANCH])
  assert.notEqual(decided(built, at(11, 46), { landing: 'another-branch' }).giveBack, null)
  assert.notEqual(decided(built, at(11, 46), { landing: null }).giveBack, null)
  // The fact itself: a string, or null.
  assert.equal(factsOf({ lane: laneOf(built.state, 'Worker 4'), state: { chatPrefix: PREFIX }, items: built.work.items, pause: null, sent: [], config, now: at(11, 46), event: { kind: 'pass' }, landing: '' }).landing, null)
})

test('who may be waited on: a board chat by name (with or without the prefix), a side chat; never an id, the person or oneself', () => {
  const names = ['Garden · Lead', 'Garden · Worker 4', 'Garden · Worker 5']
  assert.equal(waitWhoProblem('chat 1', { self: 'Worker 4', names, prefix: 'Garden · ' }), null)
  assert.equal(waitWhoProblem('Worker 5', { self: 'Worker 4', names, prefix: 'Garden · ' }), null)
  assert.equal(waitWhoProblem('Garden · Lead', { self: 'Worker 4', names, prefix: 'Garden · ' }), null)
  assert.match(waitWhoProblem('Garden · Worker 4', { self: 'Worker 4', names, prefix: 'Garden · ' }), /cannot wait on itself/)
  assert.match(waitWhoProblem('chat 7', { self: 'Worker 4', names, prefix: 'Garden · ' }), /no chat of the board/)
  for (const who of ['B12', 'Q7', 'x9', 'I3', 'you', 'You', 'the person', 'me', 'user']) assert.match(waitWhoProblem(who, { self: 'Worker 4', names }), /a wait on the person is a blocking ask; a wait on a fix is on=B<n>/, who)
  assert.match(waitWhoProblem('', { self: 'Worker 4', names }), /name who you wait on/)
  // Without a list of names, any plain name is a chat.
  assert.equal(waitWhoProblem('Painter', { self: 'Worker 4' }), null)
})

test('the words: the landing refusal, roles/worker.md and roles/main.md tell the chat to record the wait; DESIGN.md has the section', async () => {
  assert.match(LANDING_ASK_WHY, /record the wait: work block id=<step> on="chat 1" why="its go to land" \(never only in a checkpoint\)/)
  const [worker, main, design] = await Promise.all(['roles/worker.md', 'roles/main.md', 'DESIGN.md'].map(name => readFile(new URL(`../${name}`, import.meta.url), 'utf8')))
  assert.match(worker, /Record every wait on a chat .*work block id=B<n> on="chat 1" why="its go to land"/s)
  assert.match(worker, /never only in a checkpoint/)
  assert.match(main, /work block id=B<n> on="chat 1"/)
  assert.match(main, /say "unblock first"/)
  assert.match(design, /^## Waits on: a worker that waits on purpose is not stuck/m)
})
