// B986 (X140, 2026-11-04): one way back for a held step, and every wake by the lane's own chat. Worker 4 paused for the
// week's limit at 10:13 holding B968 (checkpoint c3186b6); at 10:56 the person switched account and the board was off
// 10:54-10:58. The new account's list held an old "Worker 4" of 28 Oct (local_800a5b00) and not the chat that held B968
// (local_cce12d1f, its reports' session 0c8d674a). The board bound the lane to the old chat by its title: no report
// matched, its Workers mod was unknown, so the worker fell off the hand-over's sequence and got the old resume word at
// 10:58 (no give-back ever); Main's message (11:03) and the launch (11:06) went to the old chat. Now: the kept report's
// mod keeps the worker on the sequence (change 3's go on, then the give-back from its checkpoint), the wake goes by the
// chat its reports name, and a chat not in the app's list is "could not wake" at once: no message, no launch, no wait.
// The times, ids and words are the real case's; the chats' prefix is made up.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { appOfShown, noteReport } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { handJobs } from '../src/hands.mjs'
import { chatToOpen } from '../src/opener.mjs'
import { NOT_LISTED_WHY, isNotListedAnswer, ownChatOf } from '../src/ownChat.mjs'
import { savedEntry } from '../src/reportsKept.mjs'
import { resumesDue } from '../src/say.mjs'
import { memoryStore } from '../src/store.mjs'
import { workApi } from '../src/work/api.mjs'
import { HANDOVER_COMMAND } from '../src/work/handover.mjs'
import { handoverPass } from '../src/work/handoverBoard.mjs'
import { GIVE_BACK_MINUTES, RESUME_MINUTES, continuationLine, continuationOf } from '../src/work/holderTimers.mjs'
import { parseItem, valueOf } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { claim, emptyWakes, failedToSend, launchPlan, nextPath, noticeOf, pathsOf, wakeNeeds, wakeOf, wakeWords } from '../src/wake.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const at = (h, m, s = 0) => new Date(2026, 10, 4, h, m, s).getTime()
const PROJECT = 'C:\\quarry'
const PREFIX = 'Quarry - '
const config = { ...parseConfig('{}', {}), project: PROJECT }
const hhmm = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

// The real ids of X140.
const OLD_CHAT = 'local_800a5b00-5e5b-44a5-95e4-2be41cb04570'
const OLD_CLI = '1ec8713a-9d0b-43b3-8566-9dd2c43e4a34'
const OWN_CHAT = 'local_cce12d1f-203b-4dfc-bcdb-e3ea3dfb6902'
const OWN_CLI = '0c8d674a-3365-4d8e-bb92-c0f87b2240ef'
const CLI = name => `00000000-0000-4000-8000-${String(name.length).padStart(12, '0')}`
const CHECKPOINT = 'c3186b6 · Q625 answered A: guide.py draws side-flight steps ~1.5 cells wide, overlap only over floor (never lava/cliff edge), stair\'s own cell stays the climb · 2026-11-04 10:13:17'
const PLAN = 'step 5/6 | parts Read and set up; Target side flight; Step guide; Paint side map; Judge per piece; Tests, docs, merge, report | until 2026-11-04 10:52:22 | at 2026-11-04 10:12:22'

/** An app chat file as the app writes it. */
const app = ({ name, sessionId, cliSessionId, isArchived = false, lastActivityAt = at(10, 50), createdAt = at(9, 0) }) => JSON.stringify({
  title: `${PREFIX}${name}`, sessionId, cliSessionId, cwd: PROJECT, isArchived, createdAt, lastActivityAt, lastAssistantUuid: 'u-1',
})
const running = name => app({ name, sessionId: `local_${name.replace(/\s+/g, '')}`, cliSessionId: CLI(name), lastActivityAt: at(10, 57) })
/** The new account's list at 10:58: Main and Worker 3 run; "Worker 4" is the old chat of 28 Oct. */
const OLD_WORKER4 = app({ name: 'Worker 4', sessionId: OLD_CHAT, cliSessionId: OLD_CLI, createdAt: new Date(2026, 9, 28, 19, 15).getTime(), lastActivityAt: new Date(2026, 9, 31, 0, 1).getTime() })
const OWN_WORKER4 = (more = {}) => app({ name: 'Worker 4', sessionId: OWN_CHAT, cliSessionId: OWN_CLI, createdAt: new Date(2026, 9, 31, 0, 1).getTime(), lastActivityAt: at(10, 13), ...more })
const LIST_1058 = [running('Main'), running('Worker 3'), OLD_WORKER4]

/** A report as the board keeps it; Worker 4's last, of its own chat: its session ended at 10:28 on mod 0.30.0. */
const report = (name, state, heard, more = {}) => [name, { state, since: heard, background: false, run: heard - 1000, seq: 9, at: heard, session: CLI(name), mod: '0.30.0', busyAt: null, ...more }]
const WORKER4 = report('Worker 4', 'ended', at(10, 28, 31), { session: OWN_CLI, run: at(9, 25), busyAt: at(10, 12) })
const reportsAt = now => [report('Main', 'idle', now - 5_000), report('Worker 3', 'idle', now - 5_000), WORKER4]

function storeWith() {
  const work = storeFromText('## Look\n', { now: at(9, 0) })
  const b968 = parseItem([
    'Id: B968', 'Kind: step', 'Title: Fix: left/right stairs still do not look right', 'State: in progress', 'Owner: Worker 4',
    'Since: 2026-11-04 10:03', 'Branch: b968-side-steps', `Checkpoint: ${CHECKPOINT}`, `Plan: ${PLAN}`, 'Refined: ready', '',
    '## History', '- 2026-11-04 09:16 Worker 4: queued → taken', '- 2026-11-04 09:16 Worker 4: taken → in progress', '',
  ].join('\n'))
  work.items.set('B968', b968)
  work.activities[0].steps.push('B968')
  return work
}

const roleOf = chat => ({ Main: 'main', 'Worker 3': 'worker', 'Worker 4': 'worker' })[chat] ?? null
/** The board's history: off 10:54:31-10:58:12 (the account switch). */
const LINES = [{ at: at(10, 54, 31), gap: true }, { at: at(10, 58, 12), chat: 'Main', state: 'free' }]

function build({ now, appChatTexts = LIST_1058, appFiles = null, work, outbox = [], reports = reportsAt(now), wakes = null }) {
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Main' }),
    appChatTexts, ...(appFiles === null ? {} : { appFiles }),
    tails: {}, planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, {
    lines: LINES, outbox, runs: [], now, config, seen: { shown: { Main: now, 'Worker 3': now }, other: {} },
    board: { startedAt: at(10, 58, 12), offSince: at(10, 54, 31) }, reports: new Map(reports), wakes,
  })
}
const laneOf = (state, name) => state.chats.find(chat => chat.name === name)

/** One pass of the server's hand-over on a store in a folder, as the board runs it each refresh. */
async function board(t) {
  const dir = await mkdtemp(join(tmpdir(), 'wayback-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, storeWith(), undefined, { now: at(9, 0) })
  const outbox = memoryStore()
  let n = 0
  const pass = async (now, more = {}) => {
    const state = build({ now, work: { ...await readStore(dir), ok: true }, outbox: outbox.outbox(), ...more })
    const apply = body => workApi(body, { dir, now, prefix: PREFIX, roleOf, as: 'server' })
    await handoverPass({ state, dir, outbox, apply, config, installed: '0.30.0', now, newId: () => `m${++n}` })
    return state
  }
  const item = async () => (await readStore(dir)).items.get('B968')
  return { pass, outbox, item }
}
const goOns = outbox => outbox.outbox().filter(one => one.command === HANDOVER_COMMAND && one.kind === 'resume' && one.to === 'Worker 4')

test('X140 replayed, 10:58: the worker stays on the sequence by its kept report, gets no old resume word, and its chat is not in the app\'s list', () => {
  const state = build({ now: at(10, 58, 12), work: { ...storeWith(), ok: true } })
  const lane = laneOf(state, 'Worker 4')
  // The lane is still the list's chat by its title (what the board shows), but its own chat is the one its report names.
  assert.equal(lane.appSession, OLD_CHAT)
  assert.equal(lane.mod, '0.30.0', 'the kept report\'s mod counts after the board\'s own restart (mutant: the kept mod left out)')
  assert.equal(lane.onSequence, true)
  assert.deepEqual(lane.own, { session: null, appSession: null, isListed: false, by: 'report' })
  // The old path is not taken: no resume-step word (mutant: a lifted pause back on resume-step).
  assert.deepEqual(resumesDue(state, []), [])
})

test('X140 replayed, 10:58-11:13: one "go on" line, "could not wake" at the first try with no wake to the old chat, then B968 given back from c3186b6', async t => {
  const one = await board(t)
  await one.pass(at(10, 58, 12))
  // The holder stopped since 10:28 (its report's end); 26 minutes of the board's running time: the go on line now.
  const lines = goOns(one.outbox)
  assert.equal(lines.length, 1)
  assert.match(lines[0].line, /^go on with B968 from your checkpoint: branch b968-side-steps, commit c3186b6, next: Q625 answered A/)

  // The wake of that line, once the board reads the lane off (no report since its start at 10:58:12, 5 minutes): no path
  // at all, "could not wake" at once (no message, no launch, no two-minute wait). Main's message went at 11:03:14 then.
  const now = at(11, 3, 14)
  const read = build({ now, work: { ...storeWith(), ok: true }, outbox: one.outbox.outbox() })
  const needs = wakeNeeds(read, one.outbox.outbox(), { canLaunch: true })
  const need = needs.find(one => one.chat === 'Worker 4')
  assert.deepEqual([need.why, need.paths, need.appSession, need.session, need.notListed], ['envelope', [], null, null, true], 'never the old chat\'s ids (mutant: a wake by title)')
  const record = emptyWakes()
  assert.deepEqual([wakeOf(record, need, { senderClaims: true }).state, wakeOf(record, need, { senderClaims: true }).final, wakeOf(record, need, { senderClaims: true }).why], ['failed', true, NOT_LISTED_WHY])
  assert.equal(nextPath(record, { chat: 'Worker 4', spell: need.spell, senderClaims: true, paths: need.paths }), null, 'no message is claimed')
  assert.equal(launchPlan(record, { needs, senderClaims: true }), null, 'and no launch')
  assert.equal(noticeOf(record, [{ ...need, need: true }], now, hhmm, { senderClaims: true }).text, 'could not wake Worker 4: its chat is not in the app\'s list; open its chat')
  assert.deepEqual(wakeWords(wakeOf(record, need, { senderClaims: true }), hhmm), { tone: 'attention', text: 'could not wake: its chat is not in the app\'s list' })
  // Main's start word carried by a hand: never to the old chat.
  const lanes = read.chats
  assert.deepEqual(handJobs({ caller: 'Main', taken: [{ id: 'w1', command: 'wake', about: 'Worker 4', text: 'wake' }], lanes, now }), { jobs: [], back: ['w1'] })
  assert.notEqual(chatToOpen({ ...read, chats: read.chats.filter(one => one.name === 'Worker 4') }, [])?.session, OLD_CLI)

  // Fourteen minutes later the step is still held; fifteen after the line was written it goes back, with all it had.
  await one.pass(at(10, 58, 12) + 14 * MIN)
  assert.equal(valueOf(await one.item(), 'State'), 'in progress')
  await one.pass(at(10, 58, 12) + GIVE_BACK_MINUTES * MIN)
  const back = await one.item()
  assert.deepEqual([valueOf(back, 'State'), valueOf(back, 'Owner')], ['refined', null])
  assert.equal(valueOf(back, 'Checkpoint'), CHECKPOINT, 'the checkpoint stays (mutant: a give-back that drops it)')
  assert.equal(valueOf(back, 'Branch'), 'b968-side-steps', 'the branch stays')
  assert.equal(valueOf(back, 'Plan'), PLAN, 'the plan stays')
  assert.equal(continuationOf(back)?.chat, 'Worker 4')
  assert.match(continuationLine(back), /continue B968 from its checkpoint: branch b968-side-steps, commit c3186b6, next: Q625 answered A/)
  assert.equal(goOns(one.outbox).length, 1, 'one go on line, never a second for this spell')
})

test('the go on comes after 5 minutes of the board\'s running time and the give-back 15 after it (mutant: the minutes changed)', async t => {
  assert.deepEqual([RESUME_MINUTES, GIVE_BACK_MINUTES], [5, 15])
  // A holder whose own chat stopped at 11:00, on the account it is listed in (no board gap since).
  const one = await board(t)
  const stopped = report('Worker 4', 'ended', at(11, 0), { session: OWN_CLI })
  const list = [running('Main'), running('Worker 3'), OWN_WORKER4()]
  const at1100 = { appChatTexts: list, reports: [report('Main', 'idle', at(11, 4, 50)), report('Worker 3', 'idle', at(11, 4, 50)), stopped] }
  await one.pass(at(11, 4, 50), at1100)
  assert.equal(goOns(one.outbox).length, 0, 'not before 5 minutes')
  await one.pass(at(11, 5, 10), at1100)
  assert.equal(goOns(one.outbox).length, 1, 'at 5 minutes')
  await one.pass(at(11, 5, 10) + 14 * MIN + 50_000, at1100)
  assert.equal(valueOf(await one.item(), 'State'), 'in progress', 'not before 15 minutes after the line')
  await one.pass(at(11, 5, 10) + 15 * MIN, at1100)
  assert.equal(valueOf(await one.item(), 'State'), 'refined', 'at 15 minutes after the line')
})

test('cases: the pause lifted and the chat back goes on; a closed chat is woken by its own ids; lifted and not back goes on to the give-back', async t => {
  // A closed chat (its own, listed, not running): the wake goes by its own ids, message first, then the launch.
  const listed = [running('Main'), running('Worker 3'), OWN_WORKER4()]
  const waiting = [{ id: 'e1', at: at(11, 34, 48), to: 'Worker 4', command: HANDOVER_COMMAND, kind: 'resume', state: 'waiting', line: 'go on with B968', resume: 'resume B968 1' }]
  const closed = build({ now: at(11, 40), appChatTexts: listed, work: { ...storeWith(), ok: true }, outbox: waiting })
  assert.deepEqual(laneOf(closed, 'Worker 4').own, { session: OWN_CLI, appSession: OWN_CHAT, isListed: true, by: 'report' })
  const need = wakeNeeds(closed, waiting, { canLaunch: true }).find(one => one.chat === 'Worker 4')
  assert.deepEqual([need.appSession, need.session, need.paths], [OWN_CHAT, OWN_CLI, ['message', 'launch']])
  // With both "Worker 4" chats open, the old one is a leftover and the wake still goes to the own chat.
  const both = build({ now: at(11, 40), appChatTexts: [...listed, OLD_WORKER4], work: { ...storeWith(), ok: true }, outbox: waiting })
  assert.deepEqual([wakeNeeds(both, waiting, { canLaunch: true }).find(one => one.chat === 'Worker 4')?.appSession], [OWN_CHAT])

  // Lifted and back: its own chat runs again and takes its go on line: nothing goes back.
  const one = await board(t)
  await one.pass(at(10, 58, 12))
  const back = [report('Main', 'idle', at(11, 2)), report('Worker 3', 'idle', at(11, 2)), report('Worker 4', 'busy', at(11, 2), { session: OWN_CLI, run: at(11, 1), since: at(11, 1) })]
  await one.pass(at(11, 2), { appChatTexts: listed, reports: back })
  await one.pass(at(11, 30), { appChatTexts: listed, reports: back.map(([name, r]) => [name, { ...r, at: at(11, 29, 55) }]) })
  assert.equal(valueOf(await one.item(), 'State'), 'in progress', 'it goes on: busy after the line, no give-back')

  // Lifted and not back: the second case above (X140 replayed) gives it back after its go on line.
})

test('cases: a chat listed again at the next read is no case; an old chat with the same title is never woken', () => {
  const kept = { session: OWN_CLI, app: OWN_CHAT }
  const title = { session: OLD_CLI, appSession: OLD_CHAT }
  const apps = [{ sessionId: OLD_CHAT, cliSessionId: OLD_CLI, isArchived: false }]
  // The app rewrites its file: the file is there, its chat could not be read: not known on this read, so the wake stands.
  assert.deepEqual(ownChatOf({ lane: title, kept, apps, appFiles: new Set([OLD_CHAT, OWN_CHAT]) }), { session: null, appSession: null, isListed: null, by: 'report' })
  // Gone from the list (no file): not listed (mutant: the not-in-list check made by title).
  assert.equal(ownChatOf({ lane: title, kept, apps, appFiles: new Set([OLD_CHAT]) }).isListed, false)
  // Listed again: its own ids, whatever chat the title matches.
  const again = [...apps, { sessionId: OWN_CHAT, cliSessionId: OWN_CLI, isArchived: false }]
  assert.deepEqual(ownChatOf({ lane: title, kept, apps: again }), { session: OWN_CLI, appSession: OWN_CHAT, isListed: true, by: 'report' })
  // After an import or a clear its chat has a new session; the same app id finds it.
  assert.deepEqual(ownChatOf({ lane: title, kept, apps: [...apps, { sessionId: OWN_CHAT, cliSessionId: CLI('new'), isArchived: false }] }), { session: CLI('new'), appSession: OWN_CHAT, isListed: true, by: 'report' })
  // Archived is not in the list.
  assert.equal(ownChatOf({ lane: title, kept, apps: [...apps, { sessionId: OWN_CHAT, cliSessionId: OWN_CLI, isArchived: true }] }).isListed, false)
  // No kept report: the title's chat is all the board knows.
  assert.deepEqual(ownChatOf({ lane: title, kept: null, apps }), { ...title, isListed: true, by: 'title' })
  // A lane whose own chat is not listed has no way at all, whatever ids it carries (mutant: a message and its 2-minute wait).
  assert.deepEqual(pathsOf({ own: { session: OWN_CLI, appSession: OWN_CHAT, isListed: false } }, true), [])
  assert.deepEqual(pathsOf({ own: { session: OWN_CLI, appSession: OWN_CHAT, isListed: null } }, true), ['message', 'launch'])

  // Through the state: a read where the own chat's file is being rewritten keeps the wake's ids unknown, not failed.
  const rewriting = build({ now: at(10, 59), work: { ...storeWith(), ok: true }, reports: [...reportsAt(at(10, 59)).slice(0, 2), [WORKER4[0], { ...WORKER4[1], app: OWN_CHAT }]], appFiles: ['local_Main', 'local_Worker3', OLD_CHAT, OWN_CHAT] })
  assert.equal(laneOf(rewriting, 'Worker 4').own.isListed, null)
})

test('the app\'s own answer "not found" or "archived" to a wake message ends the spell\'s tries: no launch after it', () => {
  assert.equal(isNotListedAnswer('Message not delivered: session local_cce12d1f-203b-4dfc-bcdb-e3ea3dfb6902 is archived; unarchive it first.'), true)
  assert.equal(isNotListedAnswer('Session local_82c0c4cd not found'), true)
  assert.equal(isNotListedAnswer('no report within 2 minutes of the message'), false)
  const record = emptyWakes()
  const spell = at(10, 28, 31)
  const paths = ['message', 'launch']
  assert.ok(claim(record, { chat: 'Worker 4', spell, path: 'message', by: 'Advisor', jobId: 'j1', now: at(11, 34, 48), paths }))
  failedToSend(record, 'Worker 4', 'j1', 'Message not delivered: session local_cce12d1f is archived; unarchive it first.', at(11, 34, 49))
  assert.equal(nextPath(record, { chat: 'Worker 4', spell, senderClaims: true, paths }), null)
  assert.equal(wakeOf(record, { chat: 'Worker 4', spell, paths }, { senderClaims: true }).final, true)
  // Another failure still leaves the launch.
  const other = emptyWakes()
  claim(other, { chat: 'Worker 4', spell, path: 'message', by: 'Advisor', jobId: 'j1', now: at(11, 34, 48), paths })
  failedToSend(other, 'Worker 4', 'j1', 'the hand could not send it', at(11, 34, 49))
  assert.equal(nextPath(other, { chat: 'Worker 4', spell, senderClaims: true, paths }), 'launch')
})

test('the kept report holds the app id of the chat it came from, saved and read back', () => {
  const state = { chats: [{ name: 'Worker 4', session: OWN_CLI, appSession: OWN_CHAT, isLeftover: false }] }
  const checked = { ok: true, chat: 'Worker 4' }
  assert.equal(appOfShown(state, checked), OWN_CHAT)
  const reports = new Map()
  noteReport(reports, { session: OWN_CLI, mod: '0.30.0', report: { state: 'busy', since: at(10, 0), background: false, run: at(9, 25), seq: 1 } }, checked, at(10, 0), appOfShown(state, checked))
  assert.equal(reports.get('Worker 4').app, OWN_CHAT)
  assert.equal(savedEntry(JSON.parse(JSON.stringify(reports.get('Worker 4'))), at(10, 1)).app, OWN_CHAT)
  // A later report of the same session without an id keeps it; one of a new session without one has none.
  noteReport(reports, { session: OWN_CLI, mod: '0.30.0', report: { state: 'idle', since: at(10, 5), background: false, run: at(9, 25), seq: 2 } }, checked, at(10, 5))
  assert.equal(reports.get('Worker 4').app, OWN_CHAT)
  noteReport(reports, { session: CLI('new'), mod: '0.30.0', report: { state: 'idle', since: at(10, 6), background: false, run: at(10, 6), seq: 1 } }, checked, at(10, 6))
  assert.equal(reports.get('Worker 4').app, undefined)
})
