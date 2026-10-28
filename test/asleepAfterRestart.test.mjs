// T13 part 3 (the person, 2026-10-28: after a restart "suspended keeps suspended, free = free, working is working,
// interrupted is interrupted. the goal is to not have 'Unknown' or unintentionally 'Not running'"): a chat whose process
// ended while its last report stands is asleep. The app started after the report (B315's fact), or a routine chat's process
// ended with its turn and the board heard nothing for longer than offAfterMinutes. It keeps that report's state: an idle one
// is free and gets a task, whose line wakes it (one start word); a cut turn gets one resume word per app start, sent by a
// running chat's hands, never while the person pauses. "Not running" stays for a chat that never reported, and for one a
// wake did not start. Made-up names; the clock is one evening's.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { shownChats } from '../src/bridge.mjs'
import { laneFromReport } from '../src/chatReport.mjs'
import { parseConfig } from '../src/config.mjs'
import { ASLEEP_LINE, asleepOfJob, handJobs } from '../src/hands.mjs'
import { resumesDue } from '../src/say.mjs'
import { memoryStore } from '../src/store.mjs'
import { workApi } from '../src/work/api.mjs'
import { deliverWork } from '../src/work/deliver.mjs'
import { START_WAIT_MS, takeBacks } from '../src/work/handOut.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const at = (h, m, s = 0) => new Date(2026, 9, 28, h, m, s).getTime()
const NOW = at(18, 30)
/** The app started again at 18:07; the board runs since 17:00 and heard the chats before then. */
const APP = at(18, 7)
const STARTED = at(17, 0)
const BEFORE = at(18, 0)
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
/** Lead is the main chat, Advisor the partner, Watcher the supervisor; the rest are workers. */
const NAMES = ['Lead', 'Digger', 'Weeder', 'Asker', 'Quiet', 'Advisor', 'Watcher']
const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
/** The page's own code (board.js), cut between its marks as the other page tests do. */
const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
function pagePart(name, ...names) {
  const page = {}
  vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut(name)}\nObject.assign(this, { ${names.join(', ')} })`, page)
  return page
}

const app = name => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: at(17, 59), lastAssistantUuid: 'u-1',
})
/** A conversation last written at 17:59, before the app's start. */
const tail = { text: [typed(at(17, 50), 'Go on.'), step(at(17, 55), 'Build'), answer(at(17, 59), 'On it.')].join('\n'), isCut: false, modifiedAt: at(17, 59) }
/** A report as the server keeps it (bridge.mjs `noteReport`), heard at `heard`. */
const report = (name, state, heard = BEFORE, more = {}) => [name, { state, since: heard, background: false, run: 1, seq: 1, at: heard, session: `cli-${name}`, mod: '0.19.0', busyAt: null, ...more }]
const stepItem = text => parseItem(text)
const held = (id, owner) => stepItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: in progress\nOwner: ${owner}\nSince: ${stamp(at(17, 30))}\n`)
const ready = id => stepItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: refined\nRefined: ready\nGoal: G1\nQueued by: person, 2026-10-28 17:40:00\nSince: ${stamp(at(17, 40))}\n`)

/**
 * Before the app's restart: Lead (main) and Watcher heard just now (they run), Digger busy on B12, Weeder idle, Asker asking,
 * Advisor idle; Quiet's card says a mod that reports, but it never reported. `reports` replaces any of them.
 */
const REPORTS = [report('Lead', 'idle', NOW - 5_000), report('Watcher', 'idle', NOW - 5_000), report('Digger', 'busy'), report('Weeder', 'idle'), report('Asker', 'asking'), report('Advisor', 'idle')]

function storeWith({ items = [held('B12', 'Digger'), ready('B20')], pause = null } = {}) {
  const work = storeFromText('## Garden\n', { now: at(16, 0) })
  if (pause !== null) work.pause = pause
  for (const item of items) {
    work.items.set(item.head.get('Id'), item)
    work.activities[0].steps.push(item.head.get('Id'))
  }
  return work
}

function build({ reports = REPORTS, work = storeWith(), appStartedAt = APP, now = NOW, startedAt = STARTED, outbox = [], asleepWakes = null } = {}) {
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead","supervisor":"Watcher"}',
    appChatTexts: NAMES.map(app),
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])),
    planLineTexts: { 'cli-Quiet': JSON.stringify({ name: 'Quiet', role: 'worker', state: 'free', mod: '0.19.0' }) },
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt,
  }
  return buildState(raw, {
    lines: [], outbox, runs: [], now, config, seen: { shown: {}, other: {} },
    board: { startedAt, offSince: null }, reports: new Map(reports), asleepWakes,
  })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)
const shown = (state, name) => [lane(state, name).state, lane(state, name).isRunning, lane(state, name).asleep, lane(state, name).asleepSince]

test('the app started after the reports: an idle chat is Free and asleep, a busy one with a step Interrupted and asleep, one asking keeps asking', () => {
  const state = build()
  assert.deepEqual(shown(state, 'Weeder'), ['free', false, true, APP])
  assert.deepEqual(shown(state, 'Digger'), ['interrupted', false, true, APP])
  assert.equal(lane(state, 'Digger').task?.stepId, 'B12', 'it keeps its step')
  assert.deepEqual(shown(state, 'Asker'), ['waiting', false, true, APP])
  // None is Unknown or Not running, and the head counts them as what they are.
  assert.deepEqual([state.counts.free, state.counts.off, state.counts.unknown], [2, 1, 0], 'Lead and Weeder free; only Quiet, which never reported, is off')
  // The restart banner names neither as cut off or not running: they go on by themselves.
  assert.deepEqual([state.restart.interrupted, state.restart.notRunning], [[], ['Quiet']])
  // The partner is Free (asleep) too; the main chat, which reported after the app's start, runs.
  assert.deepEqual([state.advisor.state, state.advisor.isRunning, state.advisor.asleep], ['free', false, true])
  assert.deepEqual(shown(state, 'Lead'), ['free', true, false, null])
  // A board without the app's start reads the same reports as before: unknown past 30 s, then (here, 30 min) asleep by silence.
  assert.deepEqual(shown(build({ appStartedAt: null }), 'Weeder'), ['free', false, true, BEFORE])
})

test('never reported: Unknown, then Not running, as before', () => {
  assert.deepEqual(shown(build({ startedAt: NOW - MIN }), 'Quiet').slice(0, 2), ['unknown', null])
  const late = build()
  assert.deepEqual(shown(late, 'Quiet').slice(0, 3), ['off', false, false])
  assert.match(lane(late, 'Quiet').offWhy, /^no report since the board started/)
})

// The coordinator, seen live 2026-10-28: Worker 3, a routine chat, finished its task idle, its process ended, and the Workers
// mod's last report was `ended`. The app still has the chat (it is on the board), so a message wakes it: asleep, not off.
test('a chat whose session ended while the app has it is asleep since then: Free without a task, Interrupted with its step', () => {
  const ended = build({ reports: [...REPORTS, report('Weeder', 'ended', NOW - 2 * MIN), report('Digger', 'ended', NOW - 3 * MIN)], appStartedAt: at(17, 0) })
  assert.deepEqual(shown(ended, 'Weeder'), ['free', false, true, NOW - 2 * MIN])
  assert.deepEqual(shown(ended, 'Digger'), ['interrupted', false, true, NOW - 3 * MIN])
  // After an app start that came later, asleep since that start, as any asleep chat.
  assert.deepEqual(shown(build({ reports: [...REPORTS, report('Weeder', 'ended')] }), 'Weeder'), ['free', false, true, APP])
})

test('a chat whose session ended holding a step gets exactly one resume word, by a running chat\'s hands', () => {
  const state = build({ reports: [...REPORTS, report('Digger', 'ended', NOW - 3 * MIN)], appStartedAt: at(17, 0) })
  const lanes = shownChats(state)
  const sent = new Map()
  const { jobs } = handJobs({ caller: 'Lead', lanes, now: NOW, asleepSent: sent })
  assert.deepEqual(jobs, [{ id: `asleep:${NOW - 3 * MIN}:Digger`, to: 'local_Digger', chat: 'Digger', text: 'resume your step B12 from your checkpoint' }])
  sent.set('Digger', asleepOfJob(jobs[0].id))
  assert.deepEqual(handJobs({ caller: 'Lead', lanes, now: NOW + 20_000, asleepSent: sent }).jobs, [])
  assert.deepEqual(resumesDue(state, []), [])
})

// ---- The hand-out: an asleep free worker gets the task, and one start word wakes it.

const roleOf = chat => ({ Lead: 'main', Digger: 'worker', Weeder: 'worker', Asker: 'worker', Quiet: 'worker' })[chat] ?? null

/** One pass after another of the server's own reconcile and delivery, on a store in a folder, as closedStart.test.mjs does. */
async function passes(t, reports) {
  const dir = await mkdtemp(join(tmpdir(), 'asleep-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, storeWith(), undefined, { now: at(16, 0) })
  const outbox = memoryStore()
  let n = 0
  const pass = async now => {
    // The store as the board reads it (sources.mjs: a store it could read is `ok`).
    const state = build({ reports, work: { ...await readStore(dir), ok: true }, now, outbox: outbox.outbox() })
    const apply = body => workApi(body, { dir, now, prefix: 'Garden · ', roleOf, as: 'server' })
    await deliverWork({ state, dir, outbox, apply, now, maxChars: 2000, newId: () => `m${++n}` })
    return state
  }
  return { pass, outbox, dir }
}
const starts = outbox => outbox.outbox().filter(one => one.command === 'start')

for (const [why, reports] of [
  ['the app started after its idle report', REPORTS],
  // The coordinator's addition, seen live 2026-10-28: Workers 2 and 3 run as routine chats; their process ended with their
  // idle turn, nothing restarted, and the board read them Not running. Silent past offAfterMinutes, no app start since.
  ['a routine chat: idle, then silent past offAfterMinutes with no app start since', [...REPORTS, report('Weeder', 'idle', NOW - 8 * MIN)]],
  // The coordinator, seen live: Worker 3's last report was `ended`, its session closed after its idle turn.
  ['a routine chat whose session ended after its idle turn', [...REPORTS, report('Weeder', 'ended', NOW - 2 * MIN)]],
]) {
  test(`${why}: Free and asleep, it gets a ready task, and one start word goes to a running chat to wake it`, async t => {
    const { pass, outbox } = await passes(t, reports)
    const first = await pass(NOW)
    assert.deepEqual(shown(first, 'Weeder').slice(0, 3), ['free', false, true])
    assert.deepEqual(first.reconciled.gives.map(one => [one.id, one.chat]), [['B20', 'Weeder']])
    // It counts as a worker there is: no start or spawn is asked beside its give.
    assert.equal(first.reconciled.start, null)
    // The next pass delivers the line, with the start word beside it: to the main chat, which runs; its hands send it.
    await pass(NOW + 10_000)
    assert.deepEqual(outbox.outbox().filter(one => one.command === 'work').map(one => [one.to, one.about]), [['Weeder', 'B20']])
    assert.deepEqual(starts(outbox).map(one => [one.to, one.about]), [['Lead', 'Weeder']])
    // Later passes send no second one.
    await pass(NOW + 20_000)
    await pass(NOW + 60_000)
    assert.equal(starts(outbox).length, 1)
  })
}

test('the given task waits for an asleep worker as long as a start takes, not the 2 minutes of one that runs', () => {
  const lanes = [{ name: 'Weeder', isMain: false, isLeftover: false, state: 'free', isRunning: false, asleep: true, report: { state: 'idle', since: BEFORE, at: BEFORE } }]
  const items = new Map([['B20', stepItem(`Id: B20\nKind: step\nTitle: Step B20\nState: queued\nOwner: Weeder\nSince: ${stamp(NOW)}\n- ${stamp(NOW)} server: refined → queued (given by the board to Weeder)\n`)]])
  const line = { id: 'w', command: 'work', to: 'Weeder', about: 'B20', at: NOW, state: 'waiting' }
  const backs = later => takeBacks({ items, outbox: [line], lanes, now: later, takeWithinMs: 2 * MIN })
  assert.deepEqual(backs(NOW + 3 * MIN), [])
  assert.deepEqual(backs(NOW + START_WAIT_MS).map(one => [one.id, one.stuck]), [['B20', false]])
  assert.deepEqual(takeBacks({ items, outbox: [line], lanes: [{ ...lanes[0], asleep: false, isRunning: true }], now: NOW + 3 * MIN, takeWithinMs: 2 * MIN }).length, 1)
})

// ---- The resume word: one per app start, by a running chat's hands, never while the person pauses.

test('a busy chat with a step gets exactly one resume word per app start: Resume all\'s line, as a hand\'s job', () => {
  const state = build()
  const lanes = shownChats(state)
  const sent = new Map()
  const first = handJobs({ caller: 'Lead', lanes, now: NOW, asleepSent: sent })
  assert.deepEqual(first.jobs, [{ id: `asleep:${APP}:Digger`, to: 'local_Digger', chat: 'Digger', text: 'resume your step B12 from your checkpoint' }])
  assert.deepEqual(asleepOfJob(first.jobs[0].id), { since: APP, chat: 'Digger' })
  // The server keeps what it gave (server.mjs `asleepWoken`): the next claims, every 20 s, give none for this app start.
  sent.set('Digger', { since: APP, at: NOW })
  for (const later of [NOW + 20_000, NOW + 40_000, NOW + 10 * MIN]) assert.deepEqual(handJobs({ caller: 'Lead', lanes, now: later, asleepSent: sent }).jobs, [])
  // Nor the board's older resume word after a crash: the asleep chat has its one.
  assert.deepEqual(resumesDue(state, []), [])
  // The next app start is another spell: one word again.
  const again = build({ appStartedAt: at(18, 20) })
  assert.deepEqual(handJobs({ caller: 'Lead', lanes: shownChats(again), now: NOW, asleepSent: sent }).jobs.map(one => one.id), [`asleep:${at(18, 20)}:Digger`])
})

test('while the person pauses no resume word goes, and the page shows the asleep chat Suspended as any paused one', async () => {
  const state = build({ work: storeWith({ pause: { state: 'pausing', since: at(18, 10) } }) })
  assert.deepEqual(handJobs({ caller: 'Lead', lanes: shownChats(state), now: NOW, isPaused: true }).jobs, [])
  const page = {}
  vm.runInNewContext(`${script.match(/^function pausedLanes\([\s\S]*?^}$/m)[0]}\nthis.pausedLanes = pausedLanes`, page)
  // Also with no checkpoint since the pause: it was asleep, nothing of it ran to be cut.
  const [paused] = page.pausedLanes([lane(state, 'Digger')], { state: 'pausing', since: at(18, 10), unsaved: [{ chat: 'Digger', id: 'B12' }] })
  assert.deepEqual([paused.state, paused.suspended.by], ['suspended', 'pause'])
})

test('the main chat, the partner and the supervisor: idle is Free, a cut turn gets one message to go on; nothing restarts them', () => {
  const reports = [report('Lead', 'busy'), report('Advisor', 'idle'), report('Watcher', 'busy'), report('Weeder', 'idle', NOW - 5_000)]
  const state = build({ reports })
  assert.deepEqual(shown(state, 'Lead'), ['interrupted', false, true, APP])
  assert.deepEqual([state.advisor.state, state.advisor.asleep], ['free', true])
  assert.deepEqual([state.supervisorChat.state, state.supervisorChat.asleep], ['interrupted', true])
  // Weeder runs and its hands send the words: a line each, no restart, no set.
  const { jobs } = handJobs({ caller: 'Weeder', lanes: shownChats(state), now: NOW })
  assert.deepEqual(jobs.map(one => [one.chat, one.to, one.text]), [['Lead', 'local_Lead', ASLEEP_LINE], ['Watcher', 'local_Watcher', ASLEEP_LINE]])
  assert.ok(jobs.every(one => Object.keys(one).sort().join() === 'chat,id,text,to'))
})

// ---- Not running once a wake did not take.

test('woken and silent for longer than offAfterMinutes after the wake: Not running; within it, still asleep', () => {
  // The start word a hand sent Weeder at 18:24 (its task's), and Digger's resume word at 18:28.
  const outbox = [{ id: 's1', command: 'start', to: 'Lead', about: 'Weeder', at: at(18, 23), takenAt: at(18, 23, 30), deliveredAt: at(18, 24), state: 'delivered' }]
  const asleepWakes = new Map([['Digger', { since: APP, at: at(18, 28) }]])
  const state = build({ outbox, asleepWakes })
  assert.deepEqual(shown(state, 'Weeder').slice(0, 3), ['off', false, false])
  assert.equal(lane(state, 'Weeder').offWhy, 'woken at 18:24, it did not start')
  assert.deepEqual(shown(state, 'Digger').slice(0, 3), ['interrupted', false, true])
  const later = build({ outbox, asleepWakes, now: at(18, 34) })
  assert.deepEqual(shown(later, 'Digger').slice(0, 3), ['off', false, false])
  // Not running again, the board's older ways take over: its step's resume word through a chat that runs.
  assert.deepEqual(resumesDue(later, []).map(one => [one.to, one.about]), [['Digger', 'B12']])
  // A wake before it fell asleep (an earlier spell) does not count; a start word nobody took is no wake.
  assert.deepEqual(shown(build({ outbox: [{ ...outbox[0], deliveredAt: at(18, 5), takenAt: at(18, 5) }] }), 'Weeder').slice(0, 3), ['free', false, true])
  assert.deepEqual(shown(build({ outbox: [{ ...outbox[0], state: 'waiting', takenAt: undefined, deliveredAt: undefined }] }), 'Weeder').slice(0, 3), ['free', false, true])
})

test('the rule on its own: asleep keeps the report\'s state; woken past offAfterMs is off', () => {
  const facts = more => ({ now: NOW, unknownAfterMs: 30_000, offAfterMs: 5 * MIN, holdsTask: false, hasBlockingAsk: false, ...more })
  const entry = (state, more = {}) => ({ state, since: BEFORE, background: false, at: BEFORE, ...more })
  const app = { appRuns: false, appStartedAt: APP }
  assert.deepEqual(laneFromReport(entry('idle'), facts(app)), { state: 'free', isRunning: false, asleep: true, asleepSince: APP })
  assert.deepEqual(laneFromReport(entry('busy'), facts(app)), { state: 'interrupted', isRunning: false, asleep: true, asleepSince: APP })
  assert.deepEqual(laneFromReport(entry('idle', { background: true }), facts(app)).state, 'interrupted')
  assert.deepEqual(laneFromReport(entry('idle'), facts({ ...app, holdsTask: true })).state, 'interrupted')
  assert.deepEqual(laneFromReport(entry('idle'), facts({ ...app, hasBlockingAsk: true })).state, 'waiting')
  assert.deepEqual(laneFromReport(entry('idle'), facts({ ...app, waitsForPartner: true })), { state: 'working', why: 'partner', isRunning: false, asleep: true, asleepSince: APP })
  // No app start since: unknown until offAfterMs, then asleep since its report.
  assert.deepEqual(laneFromReport(entry('idle', { at: NOW - 2 * MIN }), facts()), { state: 'unknown', isRunning: null })
  assert.deepEqual(laneFromReport(entry('idle', { at: NOW - 6 * MIN }), facts()).asleepSince, NOW - 6 * MIN)
  assert.deepEqual(laneFromReport(entry('idle'), facts({ ...app, wokenAt: NOW - 6 * MIN })), { state: 'off', isRunning: false, why: 'woken', wokenAt: NOW - 6 * MIN })
  assert.equal(laneFromReport(entry('idle'), facts({ ...app, wokenAt: NOW - 4 * MIN })).state, 'free')
  // An ended session is asleep since it ended (since the app's start when that came later); off without an app session.
  assert.deepEqual(laneFromReport(entry('ended'), facts(app)), { state: 'free', isRunning: false, asleep: true, asleepSince: APP })
  assert.deepEqual(laneFromReport(entry('ended', { since: NOW - MIN, at: NOW - MIN }), facts()), { state: 'free', isRunning: false, asleep: true, asleepSince: NOW - MIN })
  assert.deepEqual(laneFromReport(entry('ended', { since: NOW - MIN, at: NOW - MIN }), facts({ holdsTask: true })).state, 'interrupted')
  assert.deepEqual(laneFromReport(entry('ended'), facts({ ...app, hasAppSession: false })), { state: 'off', isRunning: false, why: 'ended' })
  assert.deepEqual(laneFromReport(entry('ended'), facts({ ...app, wokenAt: NOW - 6 * MIN })).why, 'woken')
})

// ---- The page's words: no alarm for these two.

test('the page: asleep and free reads Free, "asleep since 18:07, wakes when it gets a task"; asleep and cut reads Interrupted, "resumes by itself", no alarm', async () => {
  const state = build()
  const page = await pagePart('lanetime', 'timeOf')
  const plain = value => JSON.parse(JSON.stringify(value))
  const free = plain(page.timeOf(lane(state, 'Weeder'), NOW))
  assert.deepEqual([free.main, free.tone, free.small], ['Available', 'muted', [`asleep since ${hhmm(APP)}, wakes when it gets a task`]])
  const cutOff = plain(page.timeOf(lane(state, 'Digger'), NOW))
  assert.deepEqual([cutOff.label, cutOff.main, cutOff.tone], ['Interrupted', 'resumes by itself', 'muted'])
  // A chat known not to run that is not asleep keeps "Not running".
  assert.equal(plain(page.timeOf({ ...lane(state, 'Weeder'), asleep: false }, NOW)).main, 'Not running')
  const idle = await pagePart('simpleidle', 'simpleIdle')
  assert.deepEqual([idle.simpleIdle(lane(state, 'Weeder')), idle.simpleIdle(lane(state, 'Digger'))], ['free', 'interrupted, resumes by itself'])
  const words = {}
  vm.runInNewContext(`const STATES = { free: 'Free', off: 'Not running', interrupted: 'Interrupted' };\n${script.slice(script.indexOf('function laneStateText'), script.indexOf('// partner-answers:end'))}\nthis.laneStateText = laneStateText`, words)
  assert.deepEqual([words.laneStateText(lane(state, 'Weeder')), words.laneStateText({ ...lane(state, 'Weeder'), asleep: false })], ['Free', 'Not running'])
})
