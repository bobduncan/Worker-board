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
import { ASLEEP_LINE } from '../src/hands.mjs'
import { resumesDue } from '../src/say.mjs'
import { memoryStore } from '../src/store.mjs'
import { workApi } from '../src/work/api.mjs'
import { deliverWork } from '../src/work/deliver.mjs'
import { HANDOVER_COMMAND } from '../src/work/handover.mjs'
import { handoverPass } from '../src/work/handoverBoard.mjs'
import { valueOf } from '../src/work/item.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { claim, emptyWakes, nextPath, wakeJobId, wakeNeeds } from '../src/wake.mjs'
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
  vm.runInNewContext(`const MIN = 60000\n${cut('times')}
${cut('chatstatus')}\n${cut(name)}\nObject.assign(this, { ${names.join(', ')} })`, page)
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

/**
 * Signals change 4: the wake record as the server hands it to the state (src/wake.mjs), from `{ since, at }` by chat: one
 * message sent at `at` in the spell `since` (state.mjs `wokenAtOf` reads its `sentAt`).
 */
const wakesOf = sent => (sent === null ? null : {
  record: { wakes: new Map([...sent].map(([chat, one]) => [chat, [{ spell: one.since, attempts: [{ path: 'message', at: one.at, by: 'Lead', jobId: `wake:${one.since}:${chat}`, sentAt: one.at, runBefore: null, verdict: null, verdictAt: null, why: null }], turnEndedAt: null, told: { failed: false, nobody: false } }]])) },
  senderClaims: true, canLaunch: false,
})
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
    board: { startedAt, offSince: null }, reports: new Map(reports), wakes: wakesOf(asleepWakes),
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
  assert.deepEqual([state.counts.free, state.counts.asleep, state.counts.off, state.counts.unknown], [1, 1, 1, 0], 'Lead free, Weeder asleep (one word each); only Quiet, which never reported, is off')
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
  // An app start that came later does not move it: the since stays the chat's own (the board-dev chat, 2026-11-01).
  assert.deepEqual(shown(build({ reports: [...REPORTS, report('Weeder', 'ended')] }), 'Weeder'), ['free', false, true, BEFORE])
})

// The board-dev chat, 2026-11-01: after the restart of 12:53 (PC asleep 11:39–12:53, app and board started anew) every chat
// read "Asleep · since 12:53", while Worker 2 had ended at 16:05 the day before: a kept report (data/reports.json) counted
// from the board's start. The since is the chat's own.
test('a board start with kept reports older than the start keeps each chat\'s own since', () => {
  const yesterday = at(16, 5) - 24 * 60 * MIN
  const earlier = at(15, 30) - 24 * 60 * MIN
  const kept = [...REPORTS, report('Weeder', 'ended', yesterday), report('Digger', 'ended', earlier)]
  const state = build({ reports: kept, appStartedAt: at(18, 7), startedAt: at(18, 8), now: at(18, 10) })
  assert.deepEqual(shown(state, 'Weeder'), ['free', false, true, yesterday])
  assert.deepEqual(shown(state, 'Digger'), ['interrupted', false, true, earlier])
})

/** Signals change 4: the wake message a running chat's hands get for a need (server.mjs hands route), claimed once per spell. */
const wakeJobs = (record, state, caller, now) => wakeNeeds(state, []).filter(need => need.chat !== caller && need.paths.includes('message')
  && nextPath(record, { chat: need.chat, spell: need.spell, senderClaims: true, paths: need.paths }) === 'message'
  && claim(record, { chat: need.chat, spell: need.spell, path: 'message', by: caller, jobId: wakeJobId(need.spell, need.chat), now, paths: need.paths }))
  .map(need => ({ id: wakeJobId(need.spell, need.chat), to: need.appSession, chat: need.chat, text: need.text }))

test('a chat whose session ended holding a step gets exactly one resume word, by a running chat\'s hands', () => {
  const state = build({ reports: [...REPORTS, report('Digger', 'ended', NOW - 3 * MIN)], appStartedAt: at(17, 0) })
  const record = emptyWakes()
  assert.deepEqual(wakeJobs(record, state, 'Lead', NOW), [{ id: `wake:${NOW - 3 * MIN}:Digger`, to: 'local_Digger', chat: 'Digger', text: 'resume your step B12 from your checkpoint' }])
  assert.deepEqual(wakeJobs(record, state, 'Lead', NOW + 20_000), [])
  assert.deepEqual(resumesDue(state, []), [])
})

// ---- The hand-out: an asleep free worker gets the task in its hand-over (T8.5 step 6: the envelope waits for it in the
// outbox; the board opens an asleep chat a word waits for).

const roleOf = chat => ({ Lead: 'main', Digger: 'worker', Weeder: 'worker', Asker: 'worker', Quiet: 'worker' })[chat] ?? null

/** One pass after another of the server's own reconcile, delivery and hand-over, on a store in a folder; the workers on the sequence's mod. */
async function passes(t, given) {
  const reports = given.map(([name, one]) => [name, roleOf(name) === 'worker' ? { ...one, mod: '0.27.2' } : one])
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
    await handoverPass({ state, dir, outbox, apply, config, installed: '0.27.2', now, newId: () => `m${++n}` })
    return state
  }
  const owner = async id => [valueOf((await readStore(dir)).items.get(id), 'State'), valueOf((await readStore(dir)).items.get(id), 'Owner')]
  return { pass, outbox, dir, owner }
}

for (const [why, reports] of [
  ['the app started after its idle report', REPORTS],
  // The coordinator's addition, seen live 2026-10-28: Workers 2 and 3 run as routine chats; their process ended with their
  // idle turn, nothing restarted, and the board read them Not running. Silent past offAfterMinutes, no app start since.
  ['a routine chat: idle, then silent past offAfterMinutes with no app start since', [...REPORTS, report('Weeder', 'idle', NOW - 8 * MIN)]],
  // The coordinator, seen live: Worker 3's last report was `ended`, its session closed after its idle turn.
  ['a routine chat whose session ended after its idle turn', [...REPORTS, report('Weeder', 'ended', NOW - 2 * MIN)]],
]) {
  test(`${why}: Free and asleep, it gets a ready task in one hand-over`, async t => {
    const { pass, outbox, owner } = await passes(t, reports)
    const first = await pass(NOW)
    assert.deepEqual(shown(first, 'Weeder').slice(0, 3), ['free', false, true])
    // It counts as a worker there is: no start or spawn is asked beside its give.
    assert.equal(first.reconciled.start, null)
    assert.deepEqual(await owner('B20'), ['queued', 'Weeder'])
    const envelopes = () => outbox.outbox().filter(one => one.command === HANDOVER_COMMAND).map(one => [one.to, one.step, one.kind, one.state])
    // Signals change 3: Digger holds B12 and stopped long ago: its one "go on" line (a resume envelope, step null) waits too.
    const both = [['Digger', null, 'resume', 'waiting'], ['Weeder', 'B20', 'task', 'waiting']]
    assert.deepEqual(envelopes(), both)
    // Later passes send no second one, and no line beside it.
    await pass(NOW + 20_000)
    await pass(NOW + 60_000)
    assert.deepEqual(envelopes(), both)
    assert.deepEqual(outbox.outbox().filter(one => one.command === 'work'), [])
  })
}

// ---- The resume word: one per app start, by a running chat's hands, never while the person pauses.

test('a busy chat with a step gets exactly one resume word per app start: Resume all\'s line, as a hand\'s job', () => {
  const state = build()
  const record = emptyWakes()
  const first = wakeJobs(record, state, 'Lead', NOW)
  assert.deepEqual(first, [{ id: `wake:${APP}:Digger`, to: 'local_Digger', chat: 'Digger', text: 'resume your step B12 from your checkpoint' }])
  // The wake record keeps what was given: the next claims, every 20 s, give none for this app start.
  for (const later of [NOW + 20_000, NOW + 40_000, NOW + 10 * MIN]) assert.deepEqual(wakeJobs(record, state, 'Lead', later), [])
  // Nor the board's older resume word after a crash: the asleep chat has its one.
  assert.deepEqual(resumesDue(state, []), [])
  // The next app start is another spell: one word again.
  const again = build({ appStartedAt: at(18, 20) })
  assert.deepEqual(wakeJobs(record, again, 'Lead', NOW).map(one => one.id), [`wake:${at(18, 20)}:Digger`])
})

test('while the person pauses no resume word goes, and the page shows the asleep chat Suspended as any paused one', async () => {
  const state = build({ work: storeWith({ pause: { state: 'pausing', since: at(18, 10) } }) })
  assert.deepEqual(wakeNeeds(state, []), [])
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
  const jobs = wakeJobs(emptyWakes(), state, 'Weeder', NOW)
  assert.deepEqual(jobs.map(one => [one.chat, one.to, one.text]), [['Lead', 'local_Lead', ASLEEP_LINE], ['Watcher', 'local_Watcher', ASLEEP_LINE]])
  assert.ok(jobs.every(one => Object.keys(one).sort().join() === 'chat,id,text,to'))
})

// ---- Not running once a wake did not take.

test('woken and silent for longer than offAfterMinutes after the wake: Not running; within it, still asleep', () => {
  // Signals change 4: the wake record's messages: Weeder's at 18:24 (its task's), and Digger's resume line at 18:28.
  const outbox = []
  const asleepWakes = new Map([['Weeder', { since: APP, at: at(18, 24) }], ['Digger', { since: APP, at: at(18, 28) }]])
  const state = build({ outbox, asleepWakes })
  assert.deepEqual(shown(state, 'Weeder').slice(0, 3), ['off', false, false])
  assert.equal(lane(state, 'Weeder').offWhy, 'woken at 18:24, it did not start')
  assert.deepEqual(shown(state, 'Digger').slice(0, 3), ['interrupted', false, true])
  const later = build({ outbox, asleepWakes, now: at(18, 34) })
  assert.deepEqual(shown(later, 'Digger').slice(0, 3), ['off', false, false])
  // Not running again, the board's older ways take over: its step's resume word through a chat that runs.
  assert.deepEqual(resumesDue(later, []).map(one => [one.to, one.about]), [['Digger', 'B12']])
  // A wake before it fell asleep (an earlier spell) does not count; a start word in the outbox is no wake (only the record's sends are).
  assert.deepEqual(shown(build({ asleepWakes: new Map([['Weeder', { since: at(18, 0), at: at(18, 5) }]]) }), 'Weeder').slice(0, 3), ['free', false, true])
  assert.deepEqual(shown(build({ outbox: [{ id: 's1', command: 'start', to: 'Lead', about: 'Weeder', at: at(18, 23), takenAt: at(18, 23, 30), deliveredAt: at(18, 24), state: 'delivered' }] }), 'Weeder').slice(0, 3), ['free', false, true])
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
  assert.deepEqual(laneFromReport(entry('idle'), facts({ ...app, wokenAt: NOW - 6 * MIN })), { state: 'off', isRunning: false, why: 'woken', wokenAt: NOW - 6 * MIN, sleptSince: APP })
  assert.equal(laneFromReport(entry('idle'), facts({ ...app, wokenAt: NOW - 4 * MIN })).state, 'free')
  // An ended session is asleep since it ended, also when the app started later; off without an app session.
  assert.deepEqual(laneFromReport(entry('ended'), facts(app)), { state: 'free', isRunning: false, asleep: true, asleepSince: BEFORE })
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
  assert.deepEqual([free.main, free.tone, free.small], ['Asleep', 'muted', [`asleep since ${hhmm(APP)}, wakes when it gets a task`]])
  const cutOff = plain(page.timeOf(lane(state, 'Digger'), NOW))
  assert.deepEqual([cutOff.label, cutOff.main, cutOff.tone], ['Stopped', 'resumes by itself', 'muted'])
  // A chat known not to run that is not asleep keeps "Not running" (a lane without the board's word reads its state).
  assert.equal(plain(page.timeOf({ ...lane(state, 'Weeder'), status: undefined, asleep: false }, NOW)).main, 'Not running')
  const idle = await pagePart('simpleidle', 'simpleIdle')
  assert.deepEqual([idle.simpleIdle(lane(state, 'Weeder'), NOW), idle.simpleIdle(lane(state, 'Digger'), NOW).replace(/ · \d+ (?:s|min) ago/, '')], [`Asleep · since ${hhmm(APP)}`, 'Stopped · resumes by itself'])
  const words = pagePart('partner-answers', 'laneStateText')
  assert.deepEqual([words.laneStateText(lane(state, 'Weeder'), NOW), words.laneStateText({ ...lane(state, 'Weeder'), status: undefined, asleep: false }, NOW)], [`Asleep · since ${hhmm(APP)}`, 'Not running'])
})

// ---- Signals change 4, B908 (E): the lane's wake words and the page's one notice, from the wake record.

test('change 4: an asleep chat being woken says so on its lane, quiet; one that could not be woken says why in the attention tone, and the notice names it', () => {
  // Digger asleep since the app's start, its step cut: a message sent 18:28 by Lead, no verdict yet.
  const sent = build({ asleepWakes: new Map([['Digger', { since: APP, at: at(18, 28) }]]) })
  const digger = lane(sent, 'Digger')
  assert.deepEqual([digger.wake.state, digger.wake.need, digger.flags[0]], ['sent', true, { kind: 'wake', id: null, text: 'waking · message sent 18:28 by Lead', button: null }])
  assert.equal(sent.wakeNotice, null)
  // The message failed and no launch can follow (no CLI session id here): could not wake, once, in one notice.
  const failed = wakesOf(new Map([['Digger', { since: APP, at: at(18, 28) }]]))
  const attempt = failed.record.wakes.get('Digger')[0].attempts[0]
  Object.assign(attempt, { verdict: 'failed', verdictAt: at(18, 30), why: 'no report within 2 minutes of the message' })
  const raw = buildState({
    listText: '{"prefix":"Garden · ","main":"Lead","supervisor":"Watcher"}', appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])),
    planLineTexts: {}, work: storeWith(), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: APP,
  }, { lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: {}, other: {} }, board: { startedAt: STARTED, offSince: null }, reports: new Map(REPORTS), wakes: failed })
  const shownFailed = lane(raw, 'Digger')
  assert.deepEqual([shownFailed.wake.state, shownFailed.wake.final, shownFailed.flags[0].kind, shownFailed.flags[0].text], ['failed', true, 'wake failed', 'could not wake: no report within 2 minutes of the message'])
  assert.equal(raw.wakeNotice.text, 'could not wake Digger: no report after the message (sent 18:28 by Lead); open its chat')
  assert.equal(raw.wakes.Digger.state, 'failed')
  // No record (the demo, a board that only shows): nothing of it.
  assert.deepEqual([build().wakeNotice, build().wakes], [null, {}])
})

test('start-up check, MUST 1: a chat that does not run but reports again after its failed wake (a session that started after it) has no "could not wake" notice, no failed flag and no final failure', () => {
  const failed = () => {
    const record = wakesOf(new Map([['Digger', { since: APP, at: at(18, 28) }]]))
    Object.assign(record.record.wakes.get('Digger')[0].attempts[0], { verdict: 'failed', verdictAt: at(18, 30), why: 'no report within 2 minutes of the message' })
    return record
  }
  const stateWith = run => buildState({
    listText: '{"prefix":"Garden · ","main":"Lead","supervisor":"Watcher"}', appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])),
    planLineTexts: {}, work: storeWith(), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: APP,
  }, { lines: [], outbox: [], runs: [], now: at(18, 50), config, seen: { shown: {}, other: {} }, board: { startedAt: STARTED, offSince: null }, reports: new Map(REPORTS.map(([name, one]) => (name === 'Digger' ? [name, { ...one, run }] : [name, one]))), wakes: failed() })
  // Before the control: its session started at 18:10, before the failed wake (18:30): the notice stands.
  const before = stateWith(at(18, 10))
  assert.equal(lane(before, 'Digger').isRunning, false)
  // P5 (review 2026-11-11): Digger holds a step, so the line stays the attention line (quiet only for a chat nothing waits for).
  assert.deepEqual(before.wakeNotice, { tone: 'attention', text: 'could not wake Digger: no report after the message (sent 18:28 by Lead); open its chat' })
  // Its session started at 18:40, after the failure: nothing stale to show.
  const after = stateWith(at(18, 40))
  assert.equal(lane(after, 'Digger').isRunning, false, 'still no process: only the stale line goes')
  assert.equal(after.wakeNotice, null)
  assert.equal(lane(after, 'Digger').wake.final, false)
  assert.equal((lane(after, 'Digger').flags ?? []).some(flag => flag.kind === 'wake failed'), false)
})

test('start-up check, review 2: a chat whose report names an app chat that runs on a session the board does not follow (not joined) shows no "could not wake" after its failed wake', () => {
  const failed = () => {
    const record = wakesOf(new Map([['Digger', { since: APP, at: at(18, 28) }]]))
    Object.assign(record.record.wakes.get('Digger')[0].attempts[0], { verdict: 'failed', verdictAt: at(18, 30), why: 'no report within 2 minutes of the message' })
    return record
  }
  // The app's file `local_Digger2` is what Digger's report names; it was last active at `activeAt` on the session cli-new, which no lane follows.
  const stateWith = activeAt => buildState({
    listText: '{"prefix":"Garden · ","main":"Lead","supervisor":"Watcher"}',
    appChatTexts: [...NAMES.map(app), JSON.stringify({ title: 'Digger again', sessionId: 'local_Digger2', cliSessionId: 'cli-new', cwd: PROJECT, isArchived: false, createdAt: 1, lastActivityAt: activeAt, lastAssistantUuid: 'u-2' })],
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])),
    planLineTexts: {}, work: storeWith(), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: APP,
  }, { lines: [], outbox: [], runs: [], now: at(18, 50), config, seen: { shown: {}, other: {} }, board: { startedAt: STARTED, offSince: null }, reports: new Map(REPORTS.map(([name, one]) => (name === 'Digger' ? [name, { ...one, app: 'local_Digger2' }] : [name, one]))), wakes: failed() })
  // Active at 18:20 (after its report, before the failed wake of 18:30): the notice stands, the wake went to a chat that was quiet.
  const before = stateWith(at(18, 20))
  assert.deepEqual(lane(before, 'Digger').unjoined, { at: at(18, 20), session: 'cli-new' })
  assert.equal(before.wakeNotice?.text, 'could not wake Digger: no report after the message (sent 18:28 by Lead); open its chat')
  // Active at 18:40, after the failure: the chat runs on a session the board does not follow; the state says nothing of the wake (the check says to re-join).
  const after = stateWith(at(18, 40))
  assert.equal(lane(after, 'Digger').isRunning, false)
  assert.equal(after.wakeNotice, null)
  assert.equal(lane(after, 'Digger').wake.final, false)
  assert.equal((lane(after, 'Digger').flags ?? []).some(flag => flag.kind === 'wake failed'), false)
  // A report that names the lane's own file (no other session) is joined: no field.
  assert.equal(lane(build(), 'Digger').unjoined, undefined)
})

test('start-up check, review 3: the supervisor\'s chat (a side chat, not a worker lane) carries `unjoined` too: its notice, flag and final failure are hidden', () => {
  const failed = () => {
    const record = wakesOf(new Map([['Watcher', { since: BEFORE, at: at(18, 28) }]]))
    Object.assign(record.record.wakes.get('Watcher')[0].attempts[0], { verdict: 'failed', verdictAt: at(18, 30), why: 'no report within 2 minutes of the message' })
    return record
  }
  // Watcher's report names the app file local_Watcher2, which runs on cli-new (no lane follows it), last active at `activeAt`.
  const stateWith = activeAt => buildState({
    listText: '{"prefix":"Garden · ","main":"Lead","supervisor":"Watcher"}',
    appChatTexts: [...NAMES.map(app), JSON.stringify({ title: 'Supervisor again', sessionId: 'local_Watcher2', cliSessionId: 'cli-new', cwd: PROJECT, isArchived: false, createdAt: 1, lastActivityAt: activeAt, lastAssistantUuid: 'u-2' })],
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])),
    planLineTexts: {}, work: storeWith(), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: APP,
  }, { lines: [], outbox: [], runs: [], now: at(18, 50), config, seen: { shown: {}, other: {} }, board: { startedAt: STARTED, offSince: null }, reports: new Map([...REPORTS.filter(([name]) => name !== 'Watcher'), report('Watcher', 'ended', BEFORE, { app: 'local_Watcher2' })]), wakes: failed() })
  const quiet = stateWith(at(18, 20))
  assert.deepEqual(quiet.supervisorChat.unjoined, { at: at(18, 20), session: 'cli-new' })
  assert.equal(quiet.supervisorChat.isRunning, false)
  assert.match(quiet.wakeNotice?.text ?? '', /could not wake Watcher/, 'active before the failed wake: the notice stands')
  const live = stateWith(at(18, 40))
  assert.deepEqual(live.supervisorChat.unjoined, { at: at(18, 40), session: 'cli-new' })
  assert.equal(live.wakeNotice, null)
  assert.equal(live.supervisorChat.wake.final, false)
  assert.equal((live.supervisorChat.flags ?? []).some(flag => flag.kind === 'wake failed'), false)
})

test('change 4: the ⚙ row of the wake reads by itself, "last launch failed" or "message only" with its why', async () => {
  const { openPage } = await import('./pageHarness.mjs')
  const { asSent, build: page, ask, NOW: PAGE_NOW, MIN: PAGE_MIN } = await import('./partnerState.mjs')
  const { emptyWakes, rowOf } = await import('../src/wake.mjs')
  const base = asSent(page([ask('Q2', 'person', PAGE_NOW - 40 * PAGE_MIN)]))
  const jobs = rows => ({ rows, missing: [], needsTask: false, missingRoutines: [], checked: null, canAllow: true, taskLine: null })
  const shown = async row => {
    const one = await openPage({ state: { ...base, codeJobs: jobs([row]) } })
    try {
      return [one.text('#code-job-list .code-job-title'), one.text('#code-job-list .code-job-state'), one.find('#code-job-list li').title]
    } finally { await one.close() }
  }
  assert.deepEqual((await shown(rowOf(emptyWakes(), {}))).slice(0, 2), ['Wake a chat that has work', 'by itself'])
  const failed = await shown({ key: 'launch', title: 'Wake a chat that has work', byCode: false, why: 'the last launch failed: the app did not start Worker 2 (launched 10:32)' })
  assert.equal(failed[1], 'last launch failed')
  assert.match(failed[2], /the app did not start Worker 2 \(launched 10:32\); the page names the chat to open\.$/)
  assert.equal((await shown(rowOf(emptyWakes(), { blocked: 'only on Windows can the board launch a chat' })))[1], 'message only')
})

test('review (3): after the take-back ended its need, "could not wake" and its incident stand for the whole spell', async () => {
  const { buildView } = await import('../src/supervisor/view.mjs')
  const { WATCH_RULES } = await import('../src/supervisor/rules/watch.mjs')
  // Weeder sleeps free (no need: nothing waits for it any more); its spell's message failed.
  const facts = wakesOf(new Map([['Weeder', { since: APP, at: at(18, 20) }]]))
  Object.assign(facts.record.wakes.get('Weeder')[0].attempts[0], { verdict: 'failed', verdictAt: at(18, 22), why: 'no report within 2 minutes of the message' })
  const raw = buildState({
    listText: '{"prefix":"Garden · ","main":"Lead","supervisor":"Watcher"}', appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])),
    planLineTexts: {}, work: storeWith(), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: APP,
  }, { lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: {}, other: {} }, board: { startedAt: STARTED, offSince: null }, reports: new Map(REPORTS), wakes: facts })
  const weeder = lane(raw, 'Weeder')
  assert.deepEqual([weeder.wake.need, weeder.wake.final, weeder.flags[0]?.kind], [false, true, 'wake failed'])
  // P5: the line stands for the whole spell, now quiet (nothing waits for Weeder); the flag and the incident below stay as they were.
  assert.deepEqual(raw.wakeNotice, { tone: 'quiet', text: 'could not wake Weeder at 18:22; nothing waits for it now' })
  const found = WATCH_RULES.find(one => one.id === 'wake-failed').check(buildView({ state: raw, items: new Map(), outbox: [], settings: {}, now: NOW }), { seen: new Map(), observed: [] })
  assert.deepEqual(found.map(one => one.key), [`wake-failed Weeder ${APP}`])
})
