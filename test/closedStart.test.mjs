// B728 (the result check of B722): B415 was queued and ready while Worker 5's chat had not run for a day. The cause was
// the hand-out's own start (the board asks the main chat to start Worker 5), silenced by a once-ever key in
// delivered.json ('board-start Worker 5 4'), not a missing rule: one path wakes a closed worker, and it goes once per
// start window. The page and the head count say "Not running" for such a lane, as for any chat that does not run.
// Every test goes through the server's own pass: lanes read by buildState, the plan, deliverWork. Made-up chats only.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { memoryStore } from '../src/store.mjs'
import { REPAIR_RULES, findStuck } from '../src/supervisor/rules/repair.mjs'
import { workApi } from '../src/work/api.mjs'
import { deliverWork } from '../src/work/deliver.mjs'
import { START_WAIT_MS } from '../src/work/handOut.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 26, 23, 0).getTime()
const ago = minutes => NOW - minutes * MIN
const PROJECT = 'C:\game'
const config = { ...parseConfig('{}', {}), project: PROJECT, maxWorkers: 3 }
const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: ago(24 * 60), lastAssistantUuid: 'u-1',
})
const ended = at => ({ text: [typed(at - 10 * MIN, 'Go on.'), step(at - 5 * MIN, 'Build'), answer(at, 'Done.')].join('\n'), isCut: false, modifiedAt: at })

/** B415 queued at 22:56 (ready); Worker 5's chat has not run since the day before; the main chat runs. */
function world({ pause = null, extra = [] } = {}) {
  const work = storeFromText('## Work\n', { now: ago(120) })
  if (pause !== null) work.pause = pause
  work.items.set('B415', parseItem(`Id: B415\nKind: step\nTitle: Step B415\nState: refined\nRefined: ready\nGoal: G15\nQueued by: person, 2026-10-26 22:56:38\nSince: ${stamp(ago(4))}\n`))
  work.activities[0].steps.push('B415')
  const names = ['Main', 'Worker 5', ...extra]
  return { work, names, raw: (shown, outbox = []) => ({
    listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: names.map(app),
    tails: Object.fromEntries(names.map(name => [`cli-${name}`, ended(ago(24 * 60))])), planLineTexts: {}, work,
    adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: ago(30 * 60), shown, outbox,
  }) }
}
const SHOWN = { Main: NOW - 5_000 }
function state({ pause = null, outbox = [], shown = SHOWN, extra = [], at = NOW } = {}) {
  const { raw } = world({ extra, pause })
  const base = raw(shown)
  return buildState({ ...base, outbox: undefined }, { lines: [], outbox, runs: [], now: at, config, pause, seen: { shown, other: {} }, board: { startedAt: ago(5 * 60), offSince: null } })
}
const lane = (built, name) => built.chats.find(chat => chat.name === name)

async function pass(t, { key = null, at = NOW, outbox = memoryStore(), pause = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'closed-start-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, world().work, undefined, { now: ago(120) })
  // The old key, written the day before for the same worker and the same count of workers not off.
  if (key !== null) await writeFile(join(dir, 'delivered.json'), JSON.stringify({ keys: [key], sent: {} }))
  const built = state({ pause, at, outbox: outbox.outbox() })
  const server = body => workApi(body, { dir, now: at, prefix: 'Game - ', roleOf: chat => ({ Main: 'main', 'Worker 5': 'worker' })[chat] ?? null, as: 'server' })
  const run = (current, now = at) => deliverWork({ state: current, dir, outbox, apply: server, now, maxChars: 2000, newId: (() => { let n = 0; return () => `m${++n}` })() })
  return { built, outbox, run, dir }
}
const startWords = outbox => outbox.outbox().filter(one => one.command === 'start')

test('B728: the lane of a chat that does not run says "Not running" everywhere: its time, its pill and the head count', async () => {
  const built = state()
  assert.deepEqual([lane(built, 'Worker 5').state, lane(built, 'Worker 5').isRunning], ['free', false])
  assert.equal(built.counts.off, 1)
  assert.equal(built.counts.free, 1, 'the main chat only: the lane that does not run is not counted free')
  const page = {}
  const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
  const cut = (from, to) => script.slice(script.indexOf(from), script.indexOf(to))
  vm.runInNewContext(`const STATES = { free: 'Free', off: 'Not running' };\n${cut('function laneStateText', '// partner-answers:end')}\nthis.laneStateText = laneStateText`, page)
  assert.equal(page.laneStateText(lane(built, 'Worker 5')), 'Not running')
  assert.equal(page.laneStateText({ state: 'free', isRunning: true }), 'Free')
  assert.ok(!script.includes("plain('Closed'"), 'one word: no "Closed"')
})

test('B728: B415 queued 22:56, Worker 5 not running: one start word to the main chat, once, though the old once-ever key was there', async t => {
  const { built, outbox, run } = await pass(t, { key: 'board-start Worker 5 1' })
  assert.deepEqual(built.reconciled.start, { start: 'Worker 5' })
  await run(built)
  const words = startWords(outbox)
  assert.deepEqual(words.map(one => [one.to, one.about]), [['Main', 'Worker 5']])
  // The same window again: the same key, nothing more goes.
  await run(built, NOW + MIN)
  assert.equal(startWords(outbox).length, 1)
})

test('B728: a failed start is asked again in the next window, not never', async t => {
  const { built, outbox, run } = await pass(t)
  await run(built)
  const [first] = startWords(outbox)
  await outbox.update(first.id, { state: 'failed' })
  const later = NOW + START_WAIT_MS + MIN
  const again = state({ at: later, outbox: outbox.outbox() })
  await run(again, later)
  assert.equal(startWords(outbox).length, 2)
})

test('B728: the person pauses: no start word', async t => {
  const { built, outbox, run } = await pass(t, { pause: { state: 'pausing', since: ago(5) } })
  assert.equal(built.reconciled.start, null)
  await run(built)
  assert.equal(startWords(outbox).length, 0)
})

// --- the one late line for the main chat

function stuckOf(outbox, at = NOW) {
  const built = state({ at, outbox })
  const items = world().work.items
  return findStuck({ items, lanes: built.chats, prefix: 'Game - ', now: at, outbox, ready: [{ id: 'B415', rank: 2, keptFor: null }], limits: {}, pause: null, refused: [] })
    .filter(found => found.check === 'closed-worker')
}
const asked = minutes => ({ id: 'w1', command: 'start', to: 'Main', about: 'Worker 5', at: ago(minutes), state: 'delivered' })

test('B728: the start word went 12 minutes ago and Worker 5 is still closed: "waits; is closed and does not wake" for the main chat, once', () => {
  const [late] = stuckOf([asked(12)])
  assert.equal(late.fix.do, 'main')
  assert.match(late.fix.text, /B415 waits; Worker 5 is closed and does not wake/)
  assert.equal(stuckOf([asked(5)]).length, 0, 'asked a moment ago: it has time')
  assert.equal(stuckOf([]).length, 0, 'not asked yet: the hand-out asks first, this rule starts nothing')
  assert.ok(REPAIR_RULES.every(rule => rule.id !== 'closed-worker' || rule.kind === 'repair'))
})

test('B728: a worker paused for the limit and one that runs are not "closed"; the one closed longest is named, lanes with no off time by name', () => {
  const at = NOW
  const built = state({ at, outbox: [asked(12)] })
  const items = world().work.items
  const run = lanes => findStuck({ items, lanes, prefix: 'Game - ', now: at, outbox: [{ ...asked(12), about: 'Worker 5' }, { ...asked(12), id: 'w2', about: 'Worker 2' }], ready: [{ id: 'B415', rank: 2, keptFor: null }], limits: {}, pause: null, refused: [] })
    .filter(found => found.check === 'closed-worker')
  const main = built.chats.find(chat => chat.isMain)
  const closed = (name, more = {}) => ({ name, isLeftover: false, state: 'off', isRunning: false, ...more })
  assert.equal(run([main, closed('Worker 5', { state: 'suspended', isRunning: true })]).length, 0, 'suspended for the limit: limit-back\'s')
  assert.equal(run([main, closed('Worker 5', { state: 'free', isRunning: true })]).length, 0, 'free and running: it takes the task')
  assert.equal(run([main, closed('Worker 2', { offSince: ago(100) }), closed('Worker 5', { offSince: ago(900) })])[0].subject, 'Worker 5')
  assert.equal(run([main, closed('Worker 5'), closed('Worker 2', { offSince: ago(100) })])[0].subject, 'Worker 2', 'one with an off time before one without')
  assert.equal(run([main, closed('Worker 5'), closed('Worker 2')])[0].subject, 'Worker 2', 'no off time at all: by name')
})
