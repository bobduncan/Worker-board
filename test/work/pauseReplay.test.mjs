// B782 (the result check of B764): the real case of 2026-10-28, 12:27 to 12:56, through the server's own pass: the same
// state build, delivery, hand claim and supervisor rule the board runs at each refresh, over the lines that day left:
// the board's give of B746 to Worker 2 (data/outbox.jsonl, 12:28:16), the person's pause (12:28:21) and resume (12:52),
// the lanes' states (data/history.jsonl: Worker 2's turn 12:29-12:30, Worker 1 cut off at 12:30:13), B746's own History
// lines and incident X101. Before B764 the resume named Worker 1 only and B746 went back at 12:54; now the resume names
// Worker 2 with B746, Worker 2 takes it, and not-taking opens nothing. The pass runs in a temporary folder only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../../src/config.mjs'
import { handJobs } from '../../src/hands.mjs'
import { memoryStore } from '../../src/store.mjs'
import { buildState } from '../../src/state.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork, givesRefused } from '../../src/work/deliver.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { pauseAnswer } from '../../src/work/pause.mjs'
import { readStore, writePause, writeStore } from '../../src/work/store.mjs'

const SEC = 1000
const MIN = 60 * SEC
const PROJECT = 'C:\\garden'
const PREFIX = 'Game - '
const WORKERS = ['Worker 1', 'Worker 2', 'Worker 5']
const ROLES = { Main: 'main', 'Worker 1': 'worker', 'Worker 2': 'worker', 'Worker 5': 'worker' }
/** A local clock time of 2026-10-28, as the board's lines of that day carry it. */
const at = (hour, minute, second = 0) => new Date(2026, 9, 28, hour, minute, second).getTime()
const stamp = ms => {
  const d = new Date(ms)
  const two = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

// The real lines (outbox.jsonl, 12:28:16 and 12:52:09; the pause: B764's report and X101).
const REAL_GIVE = 'work: B746 is yours; run work next'
const REAL_PAUSED_AT = at(12, 28, 21)
const REAL_RESUMED_AT = at(12, 52, 0)
const REAL_RESUME_TO_MAIN = 'resume\nCut off in the middle of a turn, as the worker board reads it: Worker 1.\nNot running, as the worker board reads it: Worker 4.'

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name.replace(/\W+/g, '-')}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at(12, 27), lastAssistantUuid: 'u-1' })

/** B746 as it was at 12:27: refined and ready for the board's hand-out, made at 23:01 the evening before. */
const b746 = () => item({
  Id: 'B746', Kind: 'step', Title: 'Quality Assurance: B736 Fix of X73, X87 and X89: a board restart reads every chat as not running and leaves calls unanswered',
  State: 'refined', Activity: 'Worker board for any project (B126)', Goal: 'G15', Since: '2026-10-27 23:01', Refined: 'ready', Checks: 'B736', 'Not by': 'Worker 3',
}, { History: ['- 2026-10-27 23:01 server: made for the result check of B736'] })
/** B732, which Worker 1 held in progress and was cut off in (12:30:13): a resume names it too. */
const b732 = () => item({
  Id: 'B732', Kind: 'step', Title: 'Check B732', State: 'in progress', Owner: 'Worker 1', Activity: 'Worker board for any project (B126)', Goal: 'G15', Since: '2026-10-28 12:20', Refined: 'ready',
  Checkpoint: 'none · go on · 2026-10-28 12:21:00',
}, { History: ['- 2026-10-28 12:19 server: refined → queued (given by the board to Worker 1)', '- 2026-10-28 12:20 Worker 1: queued → taken', '- 2026-10-28 12:20 Worker 1: taken → in progress'] })

/** B736, the step B746 checks: built by Worker 3, in review (Worker 3 may not check its own). */
const b736 = () => item({
  Id: 'B736', Kind: 'step', Title: 'Fix of X73, X87 and X89: a board restart reads every chat as not running and leaves calls unanswered', State: 'review', Owner: 'Worker 3', Activity: 'Worker board for any project (B126)', Goal: 'G15', Since: '2026-10-27 22:58', Refined: 'ready',
}, { 'What we build': ['- A restart reads the chats from their reports'], History: ['- 2026-10-27 22:58 Worker 3: in progress → review', '- 2026-10-27 22:59 server: check passed: work in worker-board; result named'] })

async function replay() {
  const dir = await mkdtemp(join(tmpdir(), 'pause-replay-'))
  const tasks = [b746(), b732(), b736()]
  const items = new Map(tasks.map(one => [one.head.get('Id'), one]))
  await writeStore(dir, { items, activities: [{ name: 'Worker board for any project (B126)', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: at(12, 27) })
  const config = { ...parseConfig(JSON.stringify({ handOutBeyondFocus: true }), {}), project: PROJECT }
  const reports = new Map()
  const report = (name, state, since, now) => reports.set(name, { state, since, background: false, at: now, session: `cli-${name}`, mod: '0.26.0' })
  const outbox = memoryStore()
  const build = async now => buildState({
    listText: `{"prefix":"${PREFIX}","main":"Main"}`, appChatTexts: ['Main', ...WORKERS].map(app), tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    work: { ok: true, dir, ...(await readStore(dir)) },
  }, { lines: [], outbox: outbox.outbox(), runs: [], board: { startedAt: at(12, 0), offSince: null }, seen: { shown: { Main: now }, other: {} }, reports, now, config, handOutHeldAt: null, refusedGives: givesRefused(dir, now) })
  let n = 0
  const server = (now, chat = 'server') => body => workApi(body, { dir, now, prefix: PREFIX, roleOf: name => ROLES[name] ?? null, as: chat })
  const deliver = (state, now) => deliverWork({ state, dir, outbox, apply: async body => server(now)(body), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
  const read = async id => (await readStore(dir)).items.get(id)
  return { dir, report, build, deliver, read, outbox, close: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }), take: (now, chat, id) => workApi({ action: 'take', chat, id, branch: 'b746-check' }, { dir, now, prefix: PREFIX, roleOf: name => ROLES[name] ?? null }) }
}

test('B782: the lines of 2026-10-28, 12:27-12:56, through the server\'s own pass: the resume names Worker 2 with B746, and not-taking opens nothing', async () => {
  const one = await replay()
  try {
    // 12:28:16: Worker 2 idle since its last turn, B746 ready: the board gives it (the real line of the outbox).
    one.report('Worker 2', 'idle', at(12, 27, 30), at(12, 28, 14))
    one.report('Worker 1', 'busy', at(12, 28, 8), at(12, 28, 14))
    one.report('Worker 5', 'busy', at(12, 26, 27), at(12, 28, 14))
    const gave = await one.deliver(await one.build(at(12, 28, 16)), at(12, 28, 16))
    assert.deepEqual(gave.given, ['B746'])
    await one.deliver(await one.build(at(12, 28, 21)), at(12, 28, 21))
    const word = one.outbox.outbox().find(line => line.command === 'work' && line.about === 'B746')
    assert.deepEqual([word.to, word.text], ['Worker 2', REAL_GIVE])
    assert.deepEqual([valueOf(await one.read('B746'), 'State'), valueOf(await one.read('B746'), 'Owner')], ['queued', 'Worker 2'])

    // 12:28:21: the person pauses. Worker 2's turn (12:29-12:30) was told to stop before it took B746; Worker 1 is cut off at 12:30:13.
    await writePause(one.dir, { state: 'pausing', since: REAL_PAUSED_AT, by: 'person' })
    one.report('Worker 2', 'busy', at(12, 29, 10), at(12, 29, 12))
    one.report('Worker 2', 'idle', at(12, 30, 13), at(12, 30, 14))
    one.report('Worker 1', 'idle', at(12, 30, 13), at(12, 30, 14))
    one.report('Worker 5', 'idle', at(12, 28, 20), at(12, 30, 14))
    // The pause holds the hand-out: nothing is given, nothing is taken back, however long it lasts.
    for (const now of [at(12, 31), at(12, 40), at(12, 51)]) {
      one.report('Worker 2', 'idle', at(12, 30, 13), now - 2 * SEC)
      one.report('Worker 1', 'idle', at(12, 30, 13), now - 2 * SEC)
      one.report('Worker 5', 'idle', at(12, 28, 20), now - 2 * SEC)
      const state = await one.build(now)
      assert.deepEqual([state.reconciled.gives, state.reconciled.takeBacks], [[], []], stamp(now))
    }

    // 12:52: the person resumes. The board names Worker 2 with B746 (as it names Worker 1 with the step it was cut off in) and says so to the chat.
    await writePause(one.dir, { state: 'resuming', since: REAL_RESUMED_AT, by: 'person', pausedSince: REAL_PAUSED_AT })
    const now = at(12, 52, 9)
    for (const name of WORKERS) one.report(name, 'idle', at(12, 30, 13), now - 2 * SEC)
    const state = await one.build(now)
    // Given 24 minutes ago and not taken, B746 is not taken back at the resume: the time of the pause does not count.
    assert.deepEqual([state.reconciled.takeBacks, state.chats.find(lane => lane.name === 'Worker 2').flags], [[], []])
    assert.deepEqual(state.pause.waiting.map(({ chat, ids }) => [chat, ids]), [['Worker 1', ['B732']], ['Worker 2', ['B746']]])
    const read = await readStore(one.dir)
    const { resumeList } = pauseAnswer({ pause: read.pause, items: read.items, lanes: state.chats, prefix: PREFIX, chat: 'Main', role: 'main' })
    assert.deepEqual(resumeList.map(({ chat, step }) => [chat, step]), [['Worker 1', 'B732'], ['Worker 2', 'B746']])
    // The hand's claim, as server.mjs makes it: one line to each chat, Worker 2's naming B746.
    const { jobs } = handJobs({ caller: 'Main', lanes: state.chats, resumeList, since: read.pause.since, now })
    assert.deepEqual(jobs.map(job => [job.chat, job.text]), [['Worker 1', 'resume your step B732 from your checkpoint'], ['Worker 2', 'resume your step B746 from your checkpoint']])
    // The line to the main chat is the real one's: Worker 1 cut off. (Worker 4 was not running that day; it is no lane here.)
    assert.match(REAL_RESUME_TO_MAIN, /Worker 1\./)

    // 12:52:20: Worker 2 wakes; the resume ends at 12:52:40 (every chat started), and its first pass after it finds B746 still
    // given and not taken: the take-back clock starts at the resume, not at the give 24 minutes before, so nothing is taken back.
    one.report('Worker 2', 'busy', at(12, 52, 20), at(12, 52, 22))
    one.report('Worker 1', 'busy', at(12, 52, 25), at(12, 52, 27))
    await writePause(one.dir, { state: 'running', since: at(12, 52, 40), by: 'server', pausedSince: REAL_PAUSED_AT, resumedSince: REAL_RESUMED_AT })
    one.report('Worker 2', 'busy', at(12, 52, 20), at(12, 52, 43))
    assert.deepEqual((await one.build(at(12, 52, 45))).reconciled.takeBacks, [])
    // It takes B746 in that turn.
    const took = await one.take(at(12, 52, 50), 'Worker 2', 'B746')
    assert.equal(took.ok, true, JSON.stringify(took))
    assert.deepEqual([valueOf(await one.read('B746'), 'State'), valueOf(await one.read('B746'), 'Owner')], ['in progress', 'Worker 2'])

    // 12:52:50-12:56: the passes that, on the day, took B746 back at 12:54 and opened X101: nothing is taken back, no flag, no incident.
    for (const later of [at(12, 52, 40), at(12, 54, 5), at(12, 54, 30), at(12, 56, 30)]) {
      one.report('Worker 2', 'busy', at(12, 52, 20), later - 2 * SEC)
      one.report('Worker 1', 'busy', at(12, 52, 25), later - 2 * SEC)
      one.report('Worker 5', 'idle', at(12, 30, 13), later - 2 * SEC)
      const pass = await one.build(later)
      assert.deepEqual(pass.reconciled.takeBacks, [], stamp(later))
      assert.deepEqual(pass.chats.find(lane => lane.name === 'Worker 2').flags, [], stamp(later))
      assert.deepEqual(valueOf(await one.read('B746'), 'Owner'), 'Worker 2')
      const view = buildView({ state: { chats: pass.chats, today: [], limits: {}, pause: pass.pause, chatPrefix: PREFIX, readyList: pass.readyList, wakeFailed: [], nobodyRuns: null }, items: (await readStore(one.dir)).items, outbox: one.outbox.outbox(), repairs: [], mods: null, settings: {}, now: later })
      assert.deepEqual(WATCH_RULES.find(rule => rule.id === 'not-taking').check(view, { seen: new Map(), observed: [] }), [], stamp(later))
    }
    assert.equal((await one.read('B746')).sections.get('History').some(line => /taken back/.test(line)), false)
  } finally {
    await one.close()
  }
})
