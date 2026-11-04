// Fix 0.31.0 (the lead's trace, chat 1, 2026-11-04 22:00): the double give after a lazy clear. The REAL case: Worker 1, the first
// lazy-clear hand-over after Workers mod 0.31.0 went live, B1013 after B982, 21:21:56-21:37:57. The mod posted the `cleared`
// stage through /api/bridge/typed, whose X-Workers-Mod header the server did not merge, so the board stored Worker 1's mod as
// null; the card moved to the new session at the same moment, no report counted, the lane read as off the sequence, the
// refresh's strandedGives took B1013 back ("Worker 1 is not on the hand-over") while its envelope was in flight, and the
// next pass gave it again (envelope a0a187c1, clear null): a stale line in the app's queue for 15 minutes, a wasted turn,
// a clear wrongly reported as refused. The records are the live board's, copied read-only into
// test/fixtures/lazy-clear-2026-11-04.json (the lane facts of the two refreshes are the trace's: no log records them).
// The replay runs the real code from the bridge's mod notes to the refresh (buildState, deliverWork) and the pass (handoverPass).

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import * as bridge from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { foldOutbox, memoryStore } from '../src/store.mjs'
import { workApi } from '../src/work/api.mjs'
import { deliverWork } from '../src/work/deliver.mjs'
import { HANDOVER_COMMAND } from '../src/work/handover.mjs'
import { handoverPass } from '../src/work/handoverBoard.mjs'
import { valueOf } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixtures/lazy-clear-2026-11-04.json', import.meta.url), 'utf8'))
const FIRST = 'b24b992a0c789610'
const SECOND = 'a0a187c12d3c089f'
const OLD_SESSION = '0f5ed0a2-0000-4000-8000-000000000000'
const NEW_SESSION = 'c1a2912a-9c1c-4275-826f-bf3cf37aa85d'
const MOVED = 1793823722599
const REFRESH = fixture.lane.atRefresh.at
const PASS = fixture.lane.atPass.at
const PROJECT = 'C:\\game'
const PREFIX = 'Game - '
const ROLES = { Main: 'main', 'Worker 1': 'worker' }

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const lines = history => history.map(([at, text]) => `- ${stamp(at)} ${text}`)
const title = fixture.b1013.title
const activity = fixture.b1013.activity

/** B1013 as the store held it at 21:22:06: queued for Worker 1, the board's give (the History up to it is the real one). */
const queuedB1013 = () => item({ Id: 'B1013', Kind: 'step', Title: title, State: 'queued', Owner: 'Worker 1', Activity: activity, Goal: fixture.b1013.goal, Since: stamp(fixture.b1013.history.at(-1)[0]), Refined: 'ready' }, { History: lines(fixture.b1013.history) })
/** The same step after the false take-back (the real History line). */
const refinedB1013 = () => item({ Id: 'B1013', Kind: 'step', Title: title, State: 'refined', Activity: activity, Goal: fixture.b1013.goal, Since: stamp(fixture.b1013.observedAfter[0]), Refined: 'ready' }, { History: lines([...fixture.b1013.history, fixture.b1013.observedAfter]) })
/** B982, which Worker 1 reported at 21:21 and the board checked: the clear the first envelope carried. */
const reportedB982 = () => item({ Id: 'B982', Kind: 'step', Title: 'Task B982', State: 'review', Owner: 'Worker 1', Activity: activity, Since: stamp(1793823660000) },
  { History: lines([[1793823600000, 'Worker 1: queued → taken'], [1793823660000, 'Worker 1: in progress → review'], [1793823661000, 'server: check passed']]) })

const app = (name, more = {}) => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name.replace(' ', '')}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: 1, lastActivityAt: REFRESH - 5 * 60_000, lastAssistantUuid: 'u-1', ...more })

/**
 * The board of 21:22: a store with `items`, the chats Main and Worker 1 (its card on the NEW session, created at the clear), and the
 * outbox with the real lines of the first envelope (and the second, when `withSecond`).
 */
async function board(items, { withSecond = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'lazy-clear-replay-'))
  const all = new Map(items.map(one => [one.head.get('Id'), one]))
  await writeStore(dir, { items: all, activities: [{ name: activity, isFocus: false, steps: [...all.keys()], notes: [], loose: [] }] }, undefined, { now: REFRESH - 60 * 60_000 })
  const outbox = memoryStore()
  // The real records: the first envelope without its settle (21:22:09.360), the second once written.
  outbox.outbox().push(...foldOutbox(fixture.outbox
    .filter(line => (line.id === FIRST && line.state !== 'delivered') || (withSecond && line.id === SECOND && line.state === undefined))
    .map(line => JSON.stringify(line)).join('\n')))
  const config = { ...parseConfig(JSON.stringify({ handover: 'sequence', handOutBeyondFocus: true }), {}), project: PROJECT }
  const reports = new Map()
  const build = async (now, { mods = {} } = {}) => buildState({
    listText: `{"prefix":"${PREFIX}","main":"Main","afterStep":"clear"}`,
    appChatTexts: [app('Main'), app('Worker 1', { cliSessionId: NEW_SESSION, createdAt: MOVED })], tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    work: { ok: true, dir, ...(await readStore(dir)) },
  }, { lines: [], outbox: outbox.outbox(), runs: [], board: { startedAt: REFRESH - 60 * 60_000, offSince: null }, seen: { shown: { Main: now, 'Worker 1': now }, other: {} }, reports, mods, now, config })
  let n = 0
  const apply = now => body => workApi(body, { dir, now, prefix: PREFIX, roleOf: chat => ROLES[chat] ?? null, as: 'server' })
  return {
    dir, outbox, reports, build,
    deliver: (state, now) => deliverWork({ state, dir, outbox, apply: async body => apply(now)(body), now, maxChars: 2000, newId: () => `m${(n += 1)}` }),
    pass: (state, now) => handoverPass({ state, dir, outbox, apply: apply(now), config, now, newId: () => `p${(n += 1)}` }),
    read: async id => (await readStore(dir)).items.get(id),
    close: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  }
}
/** A report as bridge.mjs `noteReport` keeps it (the real one carries no more of these). */
const report = (session, state, since, at) => ({ state, since, background: false, run: 1, seq: 1, word: null, at, session, mod: '0.31.0', busyAt: null })
/** The server's modsNow, with the calls of the fixture noted as the server notes them: the header merged for every route, typed too. */
function modsAfterCalls(now) {
  const modOf = new Map()
  for (const call of fixture.bridge) {
    const body = { chat: 'Worker 1', session: NEW_SESSION }
    bridge.modSaid(modOf, bridge.withModHeader(body, call.header), { ok: true, chat: 'Worker 1' }, call.at)
  }
  return Object.fromEntries([...modOf].filter(([, one]) => now - one.at < 2 * 60_000).map(([name, one]) => [name, one.version]))
}
const stateOfB1013 = async one => [valueOf(await one.read('B1013'), 'State'), valueOf(await one.read('B1013'), 'Owner')]
const envelopesOfB1013 = one => one.outbox.outbox().filter(message => message.command === HANDOVER_COMMAND && message.step === 'B1013')

test('the real case, steps 1 and 2: after the typed `cleared` post Worker 1 is still on 0.31.0, and the refresh of 21:22:06 takes B1013 back from nobody', async () => {
  const one = await board([queuedB1013(), reportedB982()])
  try {
    // The old session's last report (idle since 21:21:51); the card is on the new session already, which has not reported.
    one.reports.set('Worker 1', report(OLD_SESSION, 'idle', 1793823711874, 1793823717000))
    const mods = modsAfterCalls(REFRESH)
    assert.equal(mods['Worker 1'], '0.31.0')
    const state = await one.build(REFRESH, { mods })
    const lane = state.chats.find(chat => chat.name === 'Worker 1')
    assert.deepEqual([lane.mod, lane.onSequence, lane.report], ['0.31.0', true, null])
    assert.deepEqual(state.reconciled.stranded, [])
    await one.deliver(state, REFRESH)
    assert.deepEqual(await stateOfB1013(one), ['queued', 'Worker 1'])
  } finally {
    await one.close()
  }
})

test('the real case, step 2 without the typed call\'s version: the board\'s own reading of 21:22:06 (mod unknown, no report of the new session): B1013 stays, its envelope is in flight', async () => {
  const one = await board([queuedB1013(), reportedB982()])
  try {
    one.reports.set('Worker 1', report(OLD_SESSION, 'idle', 1793823711874, 1793823717000))
    // What the board knew before the fix: the typed call said no version (mods: null) and the old session's report no longer counts.
    const state = await one.build(REFRESH, { mods: { 'Worker 1': null } })
    const lane = state.chats.find(chat => chat.name === 'Worker 1')
    assert.deepEqual([lane.mod, lane.onSequence, lane.report], [null, false, null], 'the trace\'s reading of the lane')
    assert.deepEqual(state.reconciled.stranded, [], 'the real take-back was "Worker 1 is not on the hand-over"')
    await one.deliver(state, REFRESH)
    assert.deepEqual(await stateOfB1013(one), ['queued', 'Worker 1'])
    assert.equal(envelopesOfB1013(one).length, 1)
  } finally {
    await one.close()
  }
})

test('the real case, step 3: the pass of 21:22:08 writes no second envelope; B1013 stays given and the outbox holds the one', async () => {
  const one = await board([queuedB1013(), reportedB982()])
  try {
    // The new session's idle report has come (the 5 s ping), the mod is known again.
    one.reports.set('Worker 1', report(NEW_SESSION, 'idle', 1793823727500, 1793823727500))
    const state = await one.build(PASS, { mods: { 'Worker 1': '0.31.0' } })
    const done = await one.pass(state, PASS)
    assert.deepEqual(done.decided, [{ chat: 'Worker 1', state: 'handing' }])
    assert.equal(done.wrote, 0, 'no second envelope')
    assert.equal(envelopesOfB1013(one).length, 1)
    assert.deepEqual(await stateOfB1013(one), ['queued', 'Worker 1'])
  } finally {
    await one.close()
  }
})

test('why the take-back was harmful: with B1013 refined again, the same pass gives it a second time with clear null, the real envelope a0a187c1', async () => {
  const one = await board([refinedB1013(), reportedB982()])
  try {
    one.reports.set('Worker 1', report(NEW_SESSION, 'idle', 1793823727500, 1793823727500))
    const state = await one.build(PASS, { mods: { 'Worker 1': '0.31.0' } })
    const done = await one.pass(state, PASS)
    assert.equal(done.wrote, 1)
    const real = fixture.outbox.find(message => message.id === SECOND && message.state === 'waiting')
    const second = envelopesOfB1013(one).at(-1)
    assert.equal(envelopesOfB1013(one).length, 2)
    assert.deepEqual([second.clear, second.line, second.kind], [real.clear, real.line, real.kind])
    assert.deepEqual(await stateOfB1013(one), ['queued', 'Worker 1'])
  } finally {
    await one.close()
  }
})
