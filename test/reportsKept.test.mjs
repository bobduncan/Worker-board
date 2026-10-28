// T13 part 1 (the person, 2026-10-28: after a restart each chat keeps its status; "the goal is to not have 'Unknown' or
// unintentionally 'Not running'"): every board restart turned all lanes Unknown for minutes, then Not running, although the
// chats had not changed, because their last reports lived in memory only. Now data/reports.json keeps them, and the time
// the board was down is no chat's fault. Made-up names; the clock is one afternoon's.

import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { step, typed } from '../fixtures/lines.mjs'
import { noteReport } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { hearingLog } from '../src/hearing.mjs'
import { readReports, reportsSaver, textOfReports } from '../src/reportsKept.mjs'
import { buildState } from './withStore.mjs'
import { storeFromText } from '../src/work/read.mjs'

const MIN = 60_000
const at = (h, m, s = 0) => new Date(2026, 9, 28, h, m, s).getTime()
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Lead', 'Digger', 'Weeder']
/** The board stopped at 14:00 and started again at 14:10: the saved reports are 10 minutes old at its start. */
const STOPPED = at(14, 0)
const STARTED = at(14, 10)

const tmp = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'reports-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

/** What `noteReport` keeps for a chat: through the real function, so the file holds what the board really holds. */
function kept(chats, now) {
  const reports = new Map()
  for (const [name, state, more = {}] of chats) {
    const checked = { ok: true, chat: name }
    assert.equal(noteReport(reports, { session: `cli-${name}`, mod: '0.19.0', report: { state, since: now - 2 * MIN, run: 1_700_000_000_000, seq: 4, ...more } }, checked, now), true)
  }
  return reports
}

test('the file: written, read back equal; a torn or wrong file gives no reports and is set aside; an entry that is no report is left out', async t => {
  const dir = await tmp(t)
  const file = join(dir, 'reports.json')
  const saved = kept([['Lead', 'idle'], ['Digger', 'busy', { background: true }], ['Weeder', 'asking']], STOPPED)
  // A second report of Digger from before its kept one (a lower seq): only `at` and `mod` change, and that is kept too.
  noteReport(saved, { session: 'cli-Digger', mod: '0.20.0', report: { state: 'idle', since: STOPPED - 1, run: 1_700_000_000_000, seq: 2 } }, { ok: true, chat: 'Digger' }, STOPPED + 1_000)
  const saver = reportsSaver({ file, reports: saved, waitMs: 5 })
  saver.changed()
  await saver.flush()
  assert.equal((await readdir(dir)).join(), 'reports.json')
  const back = await readReports(file, STARTED)
  assert.deepEqual([back.setAside, back.unread], [null, null])
  assert.deepEqual(back.reports, saved)
  assert.equal(await readFile(file, 'utf8'), textOfReports(saved))

  // Not there: nothing, nothing set aside.
  assert.deepEqual(await readReports(join(dir, 'none.json'), STARTED), { reports: new Map(), setAside: null, unread: null })
  // Torn by a power cut, and valid JSON that is no file of reports: no reports, the file kept aside, the board starts.
  const text = textOfReports(saved)
  for (const [word, bad] of [['torn', text.slice(0, text.length - 30)], ['array', '[1,2]'], ['no reports', '{"chats":{}}'], ['reports a list', '{"reports":[]}'], ['reports a word', '{"reports":"idle"}']]) {
    await writeFile(file, bad)
    const read = await readReports(file, STARTED)
    assert.deepEqual(read.reports, new Map(), word)
    assert.match(read.setAside, /reports\.json\.broken-20261028-1410\d\d$/, word)
    assert.equal((await readdir(dir)).includes('reports.json'), false, word)
    await rm(read.setAside)
  }

  // Entries: the good one stays; a state of its own, a time that is none or lies after the board's start, a wrong kind of
  // any field, a name that is empty and a value that is no object are left out; what else the file holds is not carried.
  const good = { state: 'idle', since: STOPPED, background: false, run: 'r-1', seq: 3, at: STOPPED, session: 'cli-Lead', mod: '0.19.0', busyAt: null }
  const entries = {
    Lead: { ...good, extra: 'x' }, Digger: { ...good, state: 'sleeping' }, Weeder: { ...good, at: 'now' }, Late: { ...good, at: STARTED + MIN },
    NoSession: { ...good, session: 7 }, NoBackground: { ...good, background: 'yes' }, BadSeq: { ...good, seq: -1 }, BadRun: { ...good, run: 'x'.repeat(65) },
    BadBusy: { ...good, busyAt: 'then' }, BadMod: { ...good, mod: 19 }, Plain: 'idle', Nothing: null, '': good,
  }
  await writeFile(file, JSON.stringify({ reports: entries }))
  const some = await readReports(file, STARTED)
  assert.deepEqual([...some.reports.keys()], ['Lead'])
  assert.deepEqual(some.reports.get('Lead'), good)
  assert.deepEqual([some.setAside, some.unread], [null, null])
})

test('the writer: one write for the changes of a second, never two at once, a flush at once, a failed write tried again by the next change', async () => {
  const timers = []
  const written = []
  let release = () => {}
  let hold = null
  const reports = new Map([['Lead', { state: 'idle' }]])
  const saver = reportsSaver({
    file: 'reports.json', reports, waitMs: 1000,
    write: async (file, text) => { written.push(text); if (hold !== null) await hold },
    setTimer: (run, ms) => { const timer = { run, ms }; timers.push(timer); return timer },
    clearTimer: timer => { timer.cleared = true },
    onError: error => written.push(`error ${error.message}`),
  })
  // Three changes in a second: one timer, one write, holding the text as it is when the timer runs.
  saver.changed()
  reports.set('Digger', { state: 'busy' })
  saver.changed()
  saver.changed()
  assert.deepEqual(timers.map(timer => timer.ms), [1000])
  timers[0].run()
  await saver.flush()
  assert.equal(written.length, 1)
  assert.deepEqual(Object.keys(JSON.parse(written[0]).reports), ['Lead', 'Digger'])
  // A change after it: a new timer; nothing changed, nothing to flush.
  await saver.flush()
  assert.equal(written.length, 1)
  saver.changed()
  assert.equal(timers.length, 2)
  // A flush writes what waits at once and clears the timer; the write that is under way is waited for, and a second one
  // comes after it, not beside it.
  hold = new Promise(done => { release = done })
  const first = saver.flush()
  assert.equal(timers[1].cleared, true)
  saver.changed()
  const second = saver.flush()
  await new Promise(done => setImmediate(done))
  assert.equal(written.length, 2, 'the second write starts only when the first is done')
  release()
  await Promise.all([first, second])
  assert.equal(written.length, 3)
  // A write that fails is heard, does not stop the next one.
  let fail = true
  const failing = reportsSaver({
    file: 'x.json', reports, write: async () => { if (fail) throw new Error('disk full'); written.push('ok') }, onError: error => written.push(`error ${error.message}`),
    setTimer: () => ({}), clearTimer: () => {},
  })
  failing.changed()
  await failing.flush()
  fail = false
  failing.changed()
  await failing.flush()
  assert.deepEqual(written.slice(-2), ['error disk full', 'ok'])
})

const app = (name, now) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: now - 2 * MIN, lastAssistantUuid: 'u-1',
})

/**
 * The board's state at `now`, started at `startedAt`, with the reports it holds and the hearing log it keeps (`log`): every
 * chat's conversation written at `written` (a chat that works; one that rests writes nothing).
 */
function build({ now, reports, log, written = now - 20_000, appStartedAt = at(9, 0), startedAt = STARTED }) {
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}',
    appChatTexts: NAMES.map(name => app(name, now)),
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, { text: [typed(now - 30 * MIN, 'Go on.'), step(written, 'Build')].join('\n'), isCut: false, modifiedAt: written }])),
    planLineTexts: {}, work: storeFromText('## Garden\n', { now: now - 60 * MIN }), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt,
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now, config, seen: { shown: {}, other: {} },
    board: { startedAt, offSince: null }, reports, hearing: log.view(now),
  })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)
const quiet = () => hearingLog({ startedAt: STARTED, quietMs: 30_000 })

/** The reports the board saved before it stopped at 14:00: the lead idle, Digger busy. */
const saved = () => kept([['Lead', 'idle'], ['Digger', 'busy'], ['Weeder', 'idle']], STOPPED)

test('after a restart a lane reads as its saved report said, at the start and while no chat is heard, not Unknown and not Not running', () => {
  // The board's start, 10 minutes after the reports: before this change each lane read Unknown at once (off, past its 5 min).
  const start = build({ now: STARTED, reports: saved(), log: quiet() })
  assert.deepEqual(NAMES.map(name => lane(start, name).state), ['free', 'working', 'free'])
  assert.deepEqual(NAMES.map(name => lane(start, name).isRunning), [true, true, true])
  // Two minutes on, no chat heard yet although the chats write their conversations (the board's hearing is open since its start).
  const later = STARTED + 2 * MIN
  const log = quiet()
  assert.deepEqual(log.view(later).open, { from: STARTED })
  const wait = build({ now: later, reports: saved(), log })
  assert.deepEqual(NAMES.map(name => lane(wait, name).state), ['free', 'working', 'free'])
  assert.deepEqual(NAMES.map(name => lane(wait, name).isRunning), [true, true, true])
  // What the board does not know any better than the chat said: the kept report is the lane's report, its time the board's start.
  assert.deepEqual([lane(wait, 'Digger').report.state, lane(wait, 'Digger').report.at], ['busy', STARTED])
})

test('a chat that reports after the restart is read from its new report; one that stays silent runs out by the usual rules, counted from the start', () => {
  const later = STARTED + 2 * MIN
  const reports = saved()
  // Digger says idle at 14:12 (the board hears it: no deaf stretch); Weeder and Lead are heard too, only Digger changed.
  const log = quiet()
  for (let t = STARTED + 5_000; t <= later; t += 5_000) log.heard(t)
  noteReport(reports, { session: 'cli-Digger', mod: '0.19.0', report: { state: 'idle', since: later - 3_000, run: 1_700_000_000_000, seq: 9 } }, { ok: true, chat: 'Digger' }, later - 3_000)
  noteReport(reports, { session: 'cli-Lead', mod: '0.19.0', report: { state: 'busy', since: later - 3_000, run: 1_700_000_000_000, seq: 9 } }, { ok: true, chat: 'Lead' }, later - 3_000)
  const state = build({ now: later, reports, log })
  assert.deepEqual([lane(state, 'Digger').state, lane(state, 'Lead').state], ['free', 'working'])
  assert.equal(lane(state, 'Digger').report.at, later - 3_000)
  // Weeder, heard by nobody since 14:00, was heard by the others' reports: its saved report is as old as the board, 2 min:
  // unknown past 30 s of the board's time, not yet Not running (5 min).
  assert.equal(lane(state, 'Weeder').state, 'unknown')
  const late = STARTED + 6 * MIN
  const log2 = quiet()
  for (let t = STARTED + 5_000; t <= late; t += 5_000) log2.heard(t)
  // T13 part 3: silent past offAfterMinutes after an idle report it is asleep since then (counted from the start), no longer off.
  const asleep = build({ now: late, reports, log: log2 })
  assert.deepEqual([lane(asleep, 'Weeder').state, lane(asleep, 'Weeder').isRunning, lane(asleep, 'Weeder').asleep, lane(asleep, 'Weeder').asleepSince], ['free', false, true, STARTED])
})

test('B736\'s keep still ends: past 10 minutes of hearing no chat the saved reports are read by the usual rules, counted from the start', () => {
  const log = quiet()
  const long = STARTED + 11 * MIN
  const state = build({ now: long, reports: saved(), log })
  // T13 part 3: the idle ones are asleep (free); Digger, busy on no task, is off as before.
  assert.deepEqual(NAMES.map(name => lane(state, name).state), ['free', 'off', 'free'])
  assert.deepEqual(NAMES.map(name => lane(state, name).asleep), [true, false, true])
})

test('a chat the app stopped while the board was down (the app started after its report) keeps its report as it was: asleep (T13 part 3)', () => {
  // The app started at 14:05, between the board's stop and its start: every chat's process ended with it.
  const appStartedAt = at(14, 5)
  const log = quiet()
  const written = at(13, 59)
  const restarted = build({ now: STARTED + 2 * MIN, reports: saved(), log, appStartedAt, written })
  // Not Unknown, not Not running: free, interrupted (its turn ran), free; none runs, each asleep since the app's start.
  assert.deepEqual(NAMES.map(name => lane(restarted, name).state), ['free', 'interrupted', 'free'])
  assert.deepEqual(NAMES.map(name => [lane(restarted, name).isRunning, lane(restarted, name).asleepSince]), NAMES.map(() => [false, appStartedAt]))
  // The report is the one it saved, its own time kept (not counted as heard at the board's start).
  assert.deepEqual([lane(restarted, 'Digger').report.state, lane(restarted, 'Digger').report.at], ['busy', STOPPED])
  // The same reports with the app started before them are kept as heard at the board's start: the guard is the app's start.
  const kept = build({ now: STARTED, reports: saved(), log, appStartedAt: at(13, 0), written })
  assert.deepEqual([lane(kept, 'Digger').state, lane(kept, 'Digger').asleep], ['working', false])
})
