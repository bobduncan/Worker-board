// The asset-limit wait (chat 1's brief of 2026-11-11, the live B1125 case): Worker 1's five Codex requests A230-A234 failed at 12:31
// with "You've hit your usage limit ... or try again at 1:23 PM." Each failure made the worker re-ask after the reset, its lane read
// Stopped meanwhile, the holder timers would have given the step back around 12:52, and the next worker hit the same limit; the
// person asked "why did worker 1 stopped?". Now (1) a failure on the provider's usage limit with a known reset time is no failure:
// the queue keeps the request waiting and runs it by itself at the reset, nobody re-asks; (2) the lane reads "Working · Codex is at
// its usage limit until 13:23; then it draws 5 pictures for it", the holder timers stay off and Resume all skips it; (3) without a
// known reset it stays a failure as before. Trimmed from the live records; a stand-in provider, nothing reaches Codex.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import test from 'node:test'

import { assetQueue } from '../src/assetQueue.mjs'
import { newAsset, readAsset } from '../src/assets.mjs'
import { parseConfig } from '../src/config.mjs'
import { stepStatusOf } from '../src/stepStatus.mjs'
import { assetWorkOf, lateAssetsOf } from '../src/work/assetWait.mjs'
import { isLimitWhy, limitResetOf, waitsForLimit } from '../src/work/providerLimit.mjs'
import { holderTimers } from '../src/work/holderTimers.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { pauseFacts } from '../src/work/pause.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { tempDir } from './tempDir.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const at = (hour, minute) => new Date(2026, 10, 11, hour, minute).getTime()
const FAILED_AT = at(12, 31)
const RESET = at(13, 23)
const NOW = at(12, 40)
const PREFIX = 'Garden · '
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Lead', 'Worker 1', 'Worker 2', 'Advisor']
/** Codex's words, as the live request.json kept them (the apostrophe garbled by the console's code page). */
const LIMIT_WHY = 'Codex made no picture (it ended with code 1). It said: ERROR: You�ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 1:23 PM.'
const OTHER_WHY = 'Codex made no picture (it ended with code 1). It said: ERROR: something else went wrong.'
const LINE = 'Codex is at its usage limit until 13:23; then it draws 5 pictures for it'

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const B1125 = (more = {}) => file({ Id: 'B1125', Kind: 'step', Title: "Give each of the Knight's six abilities its own move", State: 'in progress', Owner: 'Worker 1', Activity: 'Garden', Goal: 'G68', Since: stamp(at(12, 21)), Checkpoint: `2700777b · Asked A230 shield bash, A231 guard, A232 rally, A233 charge, A234 shield throw · ${stamp(at(12, 31))}`, ...more })
const request = (id, state, { who = 'Worker 1', of = 'B1125', asked = at(12, 29), started = null, ended = null, why = '', limit = null } = {}) =>
  ({ id, who, of, kind: 'visual', provider: 'codex', mode: 'auto', text: 'The Knight', pictures: [], follows: null, state, why, files: [], ask: null, pick: null, limit, times: { asked, started, ended } })
/** The five as the queue keeps them now: waiting for the reset, the failure's words kept in `limit`. */
const LIMITED = () => ['A230', 'A231', 'A232', 'A233', 'A234'].map(id => request(id, 'waiting', { limit: { until: RESET, why: LIMIT_WHY, at: FAILED_AT } }))
/** The five as they were: failed at 12:31 (the mutant of point 1, and a limit without a known reset). */
const FAILED = (why = LIMIT_WHY) => ['A230', 'A231', 'A232', 'A233', 'A234'].map((id, i) => request(id, 'failed', { started: FAILED_AT + i * 5_000 - 3_000, ended: FAILED_AT + i * 5_000, why }))

function build(items, { assets = [], state = 'idle', now = NOW } = {}) {
  const work = storeFromText('## Garden\n', { now: at(8, 0) })
  for (const item of items) {
    work.items.set(item.head.get('Id'), item)
    if (item.head.get('Kind') === 'step') work.activities[0].steps.push(item.head.get('Id'))
  }
  const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at(12, 0), lastAssistantUuid: 'u-1' })
  const tail = { text: '', isCut: false, modifiedAt: at(12, 0) }
  const report = (name, since, mine = 'idle') => [name, { state: mine, since, background: false, run: 1, seq: 1, at: now - 5_000, session: `cli-${name}`, mod: '0.31.0', busyAt: null }]
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])), planLineTexts: {},
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: at(8, 0), assets, assetSeconds: 240,
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now, config, seen: { shown: {}, other: {} }, board: { startedAt: at(8, 0), offSince: null }, reports: new Map([report('Lead', at(9, 0)), report('Worker 1', FAILED_AT, state), report('Worker 2', at(12, 25)), report('Advisor', at(9, 0))]) })
}
const laneOf = (state, name = 'Worker 1') => state.chats.find(one => one.name === name)
const storeOf = items => new Map(items.map(one => [one.head.get('Id'), one]))
const lates = state => state.forYou.filter(one => one.kind === 'wait late')

/** A provider that answers each request with the next of `answers`: a failure's words, or null for a picture. */
function standIn(answers) {
  const made = []
  const provider = {
    name: 'codex', mode: 'auto', kinds: ['visual'], card: { title: 'Codex' },
    check: () => ({ ok: true, state: 'works', why: 'ok' }),
    provide: async request => {
      made.push(request.id)
      const answer = answers.shift() ?? null
      if (answer !== null) return { failed: answer }
      await writeFile(join(request.folder, '1.png'), 'png')
      return { files: ['1.png'] }
    },
  }
  return { provider, made }
}
async function queueOf(t, provider, clock) {
  const dir = join(await tempDir(t), 'assets')
  const told = []
  const queue = assetQueue({ dir, providers: { codex: provider }, now: clock, tell: async record => told.push(`${record.id} ${record.state}`) })
  return { dir, queue, told }
}

test('the words: "try again at 1:23 PM" is today\'s 13:23; "in 2 hours"; no time, no limit or a day away is nothing', () => {
  assert.equal(limitResetOf(LIMIT_WHY, NOW), RESET)
  assert.equal(limitResetOf('rate limit reached, retry at 13:23', NOW), RESET)
  assert.equal(limitResetOf('You have hit your usage limit; try again at 12:05 AM', NOW), at(12 + 12, 5))
  assert.equal(limitResetOf('usage limit: try again in 2 hours 5 minutes', NOW), NOW + 125 * MIN)
  assert.equal(limitResetOf('You have hit your usage limit. Upgrade to Pro.', NOW), null)
  assert.equal(limitResetOf(OTHER_WHY, NOW), null)
  assert.equal(limitResetOf('Codex took longer than 240 seconds and was stopped.', NOW), null)
  assert.equal(limitResetOf('usage limit: try again in 3 days', NOW), null)
  assert.ok(isLimitWhy(LIMIT_WHY) && !isLimitWhy(OTHER_WHY))
  assert.ok(waitsForLimit(LIMITED()[0], NOW) && !waitsForLimit(LIMITED()[0], RESET + 1) && !waitsForLimit(FAILED()[0], NOW))
})

test('point 1: the queue keeps a limit failure waiting, tells nobody, leaves Codex alone until the reset, then draws by itself', async t => {
  let clock = FAILED_AT
  const { provider, made } = standIn([LIMIT_WHY, null, null])
  const { dir, queue, told } = await queueOf(t, provider, () => clock)
  await newAsset(dir, { who: 'Worker 1', of: 'B1125', kind: 'visual', provider: 'codex', mode: 'auto', text: 'shield bash' }, at(12, 29))
  await newAsset(dir, { who: 'Worker 1', of: 'B1125', kind: 'visual', provider: 'codex', mode: 'auto', text: 'guard' }, at(12, 29) + 1)
  await queue.pass()
  await queue.idle()
  // A1 hit the limit: back to waiting with the reset, its start cleared, nobody told; A2 never ran.
  const kept = await readAsset(dir, 'A1')
  assert.deepEqual([kept.state, kept.why, kept.limit.until, kept.limit.at, kept.times.started, kept.times.ended], ['waiting', '', RESET, FAILED_AT, null, null])
  assert.match(kept.limit.why, /usage limit/)
  assert.deepEqual([made, told], [['A1'], []])
  // Before the reset the provider is left alone, pass after pass.
  clock = at(13, 0)
  await queue.pass()
  await queue.idle()
  assert.deepEqual(made, ['A1'])
  // Past the reset the oldest runs again by itself and is ready; its limit is gone; then the next.
  clock = RESET + MIN
  await queue.pass()
  await queue.idle()
  await queue.pass()
  await queue.idle()
  const ready = await readAsset(dir, 'A1')
  assert.deepEqual([ready.state, ready.limit, ready.files, made, told], ['ready', null, ['1.png'], ['A1', 'A1', 'A2'], ['A1 ready', 'A2 ready']])
})

test('point 3, the mutant of point 1: a limit without a known reset, and any other failure, fails as before and the chat is told', async t => {
  const { provider } = standIn(['You have hit your usage limit. Upgrade to Pro.', OTHER_WHY])
  const { dir, queue, told } = await queueOf(t, provider, () => FAILED_AT)
  await newAsset(dir, { who: 'Worker 1', of: 'B1125', kind: 'visual', provider: 'codex', mode: 'auto', text: 'a' }, at(12, 29))
  await newAsset(dir, { who: 'Worker 1', of: 'B1125', kind: 'visual', provider: 'codex', mode: 'auto', text: 'b' }, at(12, 29) + 1)
  for (let i = 0; i < 2; i++) { await queue.pass(); await queue.idle() }
  assert.deepEqual((await Promise.all(['A1', 'A2'].map(id => readAsset(dir, id)))).map(one => [one.state, one.limit ?? null]), [['failed', null], ['failed', null]])
  assert.deepEqual(told, ['A1 failed', 'A2 failed'])
})

test('point 2: the live case reads "Working · Codex is at its usage limit until 13:23; then it draws 5 pictures for it"; timers off; Resume all skips it', () => {
  const state = build([B1125()], { assets: LIMITED() })
  const lane = laneOf(state)
  assert.deepEqual([lane.status, lane.why, lane.state, lane.heldBy, lane.suspended], ['Working', LINE, 'working', 'asset', null])
  assert.equal(lane.assetWork.limitUntil, RESET)
  assert.equal(lane.assetWork.ticks, 'shield bash … · guard … · rally … · charge … · shield throw …')
  assert.deepEqual([state.stepStatus.B1125.kind, state.stepStatus.B1125.why], ['asset', LINE])
  assert.equal(stepStatusOf(B1125(), { assets: LIMITED(), now: NOW }).why, LINE)
  // With two of five drawn before the limit hit the words count them.
  const partly = [...LIMITED().slice(0, 3), request('A233', 'ready', { started: at(12, 27), ended: at(12, 28) }), request('A234', 'ready', { started: at(12, 28), ended: at(12, 29) })]
  assert.equal(assetWorkOf(B1125(), partly, { chat: 'Worker 1', now: NOW }).words, 'Codex is at its usage limit until 13:23; then it draws 3 pictures for it (2 of 5 done)')
  // The holder timers stay off until the reset and beyond, while the requests are open; Resume all leaves Worker 1.
  for (const now of [NOW, RESET + 3 * MIN, RESET + 30 * MIN]) assert.equal(holderTimers({ worker: { ...lane, state: 'interrupted' }, holding: B1125(), items: storeOf([B1125()]), prefix: PREFIX, assets: LIMITED(), runningMs: from => now - from }), null, String(now))
  const pause = { state: 'resuming', since: NOW - MIN, pausedSince: at(12, 35) }
  assert.deepEqual(pauseFacts({ pause, items: storeOf([B1125()]), lanes: state.chats, prefix: PREFIX, assets: LIMITED() }).waiting, [])
  // The Late counts from the reset plus the job's limit: none at 13:00 nor at 13:25; one at 13:30.
  assert.deepEqual(lates(build([B1125()], { assets: LIMITED(), now: at(13, 0) })), [])
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 1', step: B1125(), assets: LIMITED(), now: at(13, 25), jobMs: 240_000 }), [])
  assert.deepEqual(lateAssetsOf({ chat: 'Worker 1', step: B1125(), assets: LIMITED(), now: at(13, 30), jobMs: 240_000 }).map(one => one.asset), ['A230', 'A231', 'A232', 'A233', 'A234'])
})

test('the mutant of point 2: the five as failures (what the person saw) read Stopped with the failure, nudged and given back', () => {
  const state = build([B1125()], { assets: FAILED() })
  const lane = laneOf(state)
  assert.equal(lane.status, 'Stopped')
  assert.match(lane.why, /^A234 failed: Codex made no picture/)
  assert.equal(lane.assetWork, null)
  const nudged = holderTimers({ worker: lane, holding: B1125(), items: storeOf([B1125()]), prefix: PREFIX, assets: FAILED(), runningMs: from => FAILED_AT + 6 * MIN - from })
  assert.ok(nudged !== null && nudged.resume !== null, 'the "go on" line is due')
  // Point 3 on the lane: a limit without a reset is a failure like any other.
  assert.match(laneOf(build([B1125()], { assets: FAILED('You have hit your usage limit. Upgrade to Pro.') })).why, /^A234 failed/)
  // Once the reset has passed and the queue runs them, the lane is the plain asset wait again.
  const drawing = [...LIMITED().slice(0, 4), request('A234', 'running', { started: RESET + MIN })]
  const after = assetWorkOf(B1125(), drawing.map(one => (one.state === 'running' ? one : { ...one, limit: null })), { chat: 'Worker 1', now: RESET + 2 * MIN })
  assert.equal(after.words, 'Codex draws 5 pictures for it · 0 of 5 done · since 12:29')
})
