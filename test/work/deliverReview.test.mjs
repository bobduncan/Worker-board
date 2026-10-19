// B300, the review's findings: a line is sent at most once per step, owner and queueing, also when the pull and the
// refresh send at the same moment; a line that could not be sent spends nothing; a re-queued step is delivered again;
// a line that expired untaken goes once more; a step queued for a free chat that does not take it is flagged; no line
// goes to a chat that is held by the limit, busy or not in the list; a line whose step went elsewhere is withdrawn.
// Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { memoryStore } from '../../src/store.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork, deliveryKey, pullFor, sendOnce } from '../../src/work/deliver.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readDelivered, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 17, 12, 0).getTime()
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
const words = (to = 'Units', id = 'B286') => ({ to, ask: null, step: null, title: null, version: null, verdict: null, command: 'work', about: id, text: `work: ${id} is yours; run work next` })
let n = 0
const newId = () => `m${(n += 1)}`
const free = { restart: { main: 'Main' }, chats: [{ name: 'Main', isMain: true, isLeftover: false, isRunning: true, state: 'free' }, { name: 'Units', isLeftover: false, isRunning: true, state: 'free' }] }
const send = (dir, outbox, more = {}) => sendOnce({ dir, key: 'B286 Units 2026-10-17 11:00', words: words(), outbox, state: free, now: NOW, maxChars: 2000, newId, keep: KEEP, ...more })
const folder = () => mkdtemp(join(tmpdir(), 'work-review-'))

test('the pull and the refresh at the same moment send one line, and every key of many at once is kept', async () => {
  const dir = await folder()
  try {
    const outbox = memoryStore()
    await Promise.all(Array.from({ length: 40 }, () => send(dir, outbox)))
    assert.equal(outbox.outbox().length, 1)
    await Promise.all(Array.from({ length: 20 }, (_, i) => send(dir, outbox, { key: `B${300 + i} Units x`, words: words('Units', `B${300 + i}`) })))
    assert.equal(outbox.outbox().length, 21)
    assert.equal((await readDelivered(dir)).keys.length, 21)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a line that could not be put into the outbox spends no key: it goes at the next refresh', async () => {
  const dir = await folder()
  try {
    const outbox = memoryStore()
    outbox.failWrites(true)
    assert.equal(await send(dir, outbox).catch(() => null), null)
    assert.deepEqual((await readDelivered(dir)).keys, [])
    outbox.failWrites(false)
    assert.notEqual(await send(dir, outbox), null)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a line that expired untaken goes once more, and only once', async () => {
  const dir = await folder()
  try {
    const outbox = memoryStore()
    await send(dir, outbox)
    assert.equal(await send(dir, outbox, { now: NOW + 47 * 60 * MIN }), null)
    assert.notEqual(await send(dir, outbox, { now: NOW + 49 * 60 * MIN }), null)
    assert.equal(await send(dir, outbox, { now: NOW + 99 * 60 * MIN }), null)
    assert.equal(outbox.outbox().length, 2)
    // One that was taken does not go again.
    const taken = memoryStore()
    await send(dir, taken, { key: 'B9 Units y', words: words('Units', 'B9') })
    await taken.take('Units', NOW, KEEP)
    assert.equal(await send(dir, taken, { key: 'B9 Units y', words: words('Units', 'B9'), now: NOW + 49 * 60 * MIN }), null)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: '2026-10-17 11:00', ...more }, sections)
const lane = (name, state = 'free', more = {}) => ({ name, state, isMain: false, isLeftover: false, isRunning: true, lastActivityAt: NOW - 30 * MIN, task: null, idle: null, ...more })
const run = (items, lanes) => reconcile({ store: { items: new Map(items.map(item => [item.head.get('Id'), item])), problems: [] }, flow: DEFAULT_FLOW, lanes, now: NOW, times: { graceMs: 10 * MIN, askMs: 60 * MIN }, prefix: '' })

test('a delivery is keyed on the step, its owner and when it was queued for that owner: a re-queue delivers again', () => {
  const first = run([step('B286', 'queued', { Owner: 'Units', Since: '2026-10-17 11:00' })], [lane('Units')]).deliveries[0]
  const again = run([step('B286', 'queued', { Owner: 'Units', Since: '2026-10-17 11:40' })], [lane('Units')]).deliveries[0]
  assert.deepEqual(first, { id: 'B286', chat: 'Units', since: '2026-10-17 11:00', why: 'deliver B286 to Units' })
  assert.notEqual(deliveryKey(first.id, first.chat, first.since), deliveryKey(again.id, again.chat, again.since))
})

test('a step queued for a chat that has been free longer than the grace time and did not take it is flagged', () => {
  const queued = step('B286', 'queued', { Owner: 'Units', Since: '2026-10-17 11:00' })
  assert.deepEqual(run([queued], [lane('Units', 'free', { idle: { since: NOW - 5 * MIN } })]).flags, [])
  assert.deepEqual(run([queued], [lane('Units', 'free', { idle: { since: NOW - 11 * MIN } })]).flags, [{ kind: 'not taken', id: 'B286', chat: 'Units', text: 'B286 queued for Units, Units free, not taken', button: null }])
})

test('the line of a failed check goes by the delivery\'s rules: not to a chat that is busy, held by the limit or gone', () => {
  const failed = step('B285', 'review', { Owner: 'Units' }, { History: ['- 2026-10-17 11:41 server: check failed: the branch is still there'] })
  assert.equal(typeof run([failed], [lane('Units')]).flags[0].say, 'string')
  for (const lanes of [[lane('Units', 'working')], [lane('Units', 'suspended')], []]) assert.equal(run([failed], lanes).flags[0].say, undefined)
})

test('a pull is answered only for a chat on the board that is free: not held by the limit, not busy', async () => {
  const dir = await folder()
  try {
    const result = { text: 'work: B286 is yours; run work next', id: 'B286', since: '2026-10-17 11:00', wake: { to: 'Units', id: 'B286' }, changed: false }
    const state = chat => ({ restart: { main: 'Main' }, chats: [{ name: 'Units', isLeftover: false, isRunning: true, ...chat }] })
    for (const chat of [{ state: 'suspended' }, { state: 'working' }, { name: 'Other', state: 'free' }]) {
      const outbox = memoryStore()
      const answered = await pullFor({ dir, result, state: state(chat), outbox, now: NOW, maxChars: 2000, newId, keep: KEEP })
      assert.deepEqual([answered.text, answered.wake, outbox.outbox().length], ['', null, 0])
    }
    const outbox = memoryStore()
    const answered = await pullFor({ dir, result, state: state({ state: 'free' }), outbox, now: NOW, maxChars: 2000, newId, keep: KEEP })
    assert.deepEqual([answered.text, outbox.outbox().length], ['work: B286 is yours; run work next', 1])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the end of a turn carries the pull: one call answers the missed instructions and the line', async () => {
  const dir = await folder()
  try {
    await writeStore(dir, migrateBacklog('# Backlog\n\n## Garden\n- [ ] B1 Plant the hedge (for Digger; about 1 h)\n', { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
    const done = await workApi({ chat: 'Digger', action: 'turn-ended', since: NOW - MIN, pull: true }, { dir, now: NOW, prefix: '', roleOf: chat => (chat === 'Digger' ? 'worker' : null), freeChats: new Set() })
    assert.equal(done.ok, true, done.why)
    assert.deepEqual(done.result.pull, { text: 'work: B1 is yours; run work next', id: 'B1', since: '2026-10-17 11:00', wake: { to: 'Digger', id: 'B1' } })
    const without = await workApi({ chat: 'Digger', action: 'turn-ended', since: NOW - MIN }, { dir, now: NOW, prefix: '', roleOf: () => 'worker', freeChats: new Set() })
    assert.equal(without.result.pull, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a waiting line whose step went to another chat or was dropped is withdrawn, with the start it asked of the main chat', async () => {
  const dir = await folder()
  try {
    await writeStore(dir, migrateBacklog('# Backlog\n\n## Garden\n- [ ] B1 Plant the hedge (for Digger; about 1 h)\n- [ ] B2 Mow (for Digger)\n', { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
    const outbox = memoryStore()
    const down = { restart: { main: 'Main' }, chatPrefix: '', chats: [{ name: 'Main', isMain: true, isLeftover: false, isRunning: true }, { name: 'Units', isLeftover: false, isRunning: false }] }
    await sendOnce({ dir, key: 'B1 Units a', words: words('Units', 'B1'), outbox, state: down, now: NOW, maxChars: 2000, newId, keep: KEEP })
    await sendOnce({ dir, key: 'B2 Digger a', words: words('Digger', 'B2'), outbox, state: down, now: NOW, maxChars: 2000, newId, keep: KEEP })
    assert.deepEqual(outbox.outbox().map(one => [one.to, one.command, one.state]), [['Units', 'work', 'waiting'], ['Main', 'start', 'waiting'], ['Digger', 'work', 'waiting']])
    // B1 is Digger's now, not Units': the line to Units goes, and so does the start of Units.
    await deliverWork({ state: { ...down, reconciled: { moves: [], deliveries: [], says: [] } }, dir, outbox, apply: async () => null, now: NOW, maxChars: 2000, newId, keep: KEEP })
    assert.deepEqual(outbox.outbox().map(one => [one.to, one.command, one.state]), [['Units', 'work', 'dropped'], ['Main', 'start', 'dropped'], ['Digger', 'work', 'waiting']])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the button "Start <chat>" on a lane does not open the lane\'s window', async () => {
  const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'board.js'), 'utf8')
  const handlers = script.split("$('lanes').addEventListener('click', event => {").slice(1).map(part => part.slice(0, part.indexOf('\n})')))
  const opens = handlers.filter(body => body.includes("event.target.closest('.lane.") && body.includes('openDetails('))
  assert.equal(opens.length, 2)
  for (const body of opens) assert.ok(/\.closest\('[^']*\.lane-flag[^']*'\) !== null\) return/.test(body), body)
})
