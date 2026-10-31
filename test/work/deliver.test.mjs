// B300: the server delivers and flags (spec 2026-10-17, sections 6 hook 3 and 7): a step queued for a free worker
// reaches its outbox as one line, once, also after the board starts anew; a step held by a chat that is not running is
// flagged within the grace time, with a button that asks the main chat to start it; the server's own moves go through
// the API. While the store cannot be read nothing of this happens. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, typed } from '../../fixtures/lines.mjs'
import { messageText } from '../../src/bridge.mjs'
import { parseConfig } from '../../src/config.mjs'
import { checkSay } from '../../src/say.mjs'
import { buildState } from '../withStore.mjs'
import { memoryStore } from '../../src/store.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork, sendOnce } from '../../src/work/deliver.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readDelivered, readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', '- [ ] B2 Mow the lawn (for Digger; after B1)', ''].join('\n')
/** T8.5 step 6: a line from the pass goes to the main chat only; B1 queued for the main chat. */
const MAIN_BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Lead; about 1 h)', ''].join('\n')

const app = (name, at) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at, lastAssistantUuid: 'u-1',
})
const tail = at => ({ text: [typed(at - 10 * MIN, 'Plant it'), answer(at, 'Done for now.')].join('\n'), isCut: false, modifiedAt: at })

async function garden(backlog = BACKLOG) {
  const dir = await mkdtemp(join(tmpdir(), 'work-deliver-'))
  await writeStore(dir, migrateBacklog(backlog, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  const ctx = at => ({ dir, now: at, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, freeChats: new Set(['Digger']) })
  const digger = (body, at = NOW - 40 * MIN) => workApi({ chat: 'Digger', ...body }, ctx(at))
  const server = (body, at = NOW) => workApi(body, { ...ctx(at), as: 'server' })
  /** The board's state at `now`; `running` the chats whose mod asked lately (the board started an hour ago). */
  const build = async ({ now = NOW, running = ['Lead', 'Digger'], outbox = [], unread = false } = {}) => {
    const work = unread ? { ok: false, dir, code: 'EACCES' } : { ok: true, dir, ...(await readStore(dir)) }
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead', NOW - 5 * MIN), app('Digger', NOW - 5 * MIN)],
      tails: { 'cli-Digger': tail(NOW - 5 * MIN), 'cli-Lead': tail(NOW - 5 * MIN) }, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
    }
    const seen = { shown: Object.fromEntries(running.map(name => [name, now])), other: {} }
    return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen, now, config })
  }
  let n = 0
  const deliver = (state, outbox, now = NOW) => deliverWork({ state, dir, outbox, apply: body => server(body, now), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
  return { dir, digger, server, build, deliver }
}

test('a queued step of the main chat reaches its outbox as one line, once; also not again after the board starts anew; a worker gets none from the pass', async () => {
  // A worker's queued step: no line from the pass (T8.5 step 6: its hand-over carries it).
  const worker = await garden()
  try {
    assert.deepEqual((await worker.build()).reconciled.deliveries, [])
  } finally {
    await rm(worker.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  const { dir, build, deliver } = await garden(MAIN_BACKLOG)
  try {
    const state = await build()
    assert.deepEqual(state.reconciled.deliveries, [{ id: 'B1', chat: 'Lead', since: '2026-10-17 10:05', why: 'deliver B1 to Lead' }])
    const outbox = memoryStore()
    const done = await deliver(state, outbox)
    assert.deepEqual(outbox.outbox().map(one => [one.to, one.command, one.about, one.state, messageText(one, () => '11:05')]), [['Lead', 'work', 'B1', 'waiting', 'work: B1 is yours; run work next']])
    assert.equal(done.sent.length, 1)
    // The next refresh, and a board started anew with an empty outbox: nothing again.
    await deliver(await build(), outbox)
    const anew = memoryStore()
    await deliver(await build(), anew)
    assert.equal(outbox.outbox().length, 1)
    assert.equal(anew.outbox().length, 0)
    assert.deepEqual((await readDelivered(dir)).keys, ['B1 Lead 2026-10-17 10:05'])
    assert.match(await readFile(join(dir, 'delivered.json'), 'utf8'), /"B1 Lead 2026-10-17 10:05"/)
    // Delivered is not moved: the chat's own take moves it.
    assert.equal(valueOf((await readStore(dir)).items.get('B1'), 'State'), 'queued')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a step held by a chat that is not running is flagged within the grace time, with the button that starts it', async () => {
  const { dir, digger, build } = await garden()
  try {
    await digger({ action: 'take', minutes: 30, id: 'B1' })
    // Its last activity was five minutes ago: within the grace time nothing yet.
    assert.deepEqual((await build({ running: ['Lead'] })).chats.find(one => one.name === 'Digger').flags, [])
    const state = await build({ now: NOW + 6 * MIN, running: ['Lead'] })
    const lane = state.chats.find(one => one.name === 'Digger')
    assert.deepEqual(lane.flags, [{ kind: 'stuck', id: 'B1', text: 'B1: Digger holds it but is not running', button: 'Start Digger' }])
    // The button asks the main chat with the board's existing words for a start.
    const start = checkSay({ to: 'Lead', command: 'start', chat: 'Digger' }, state, 2000)
    assert.equal(start.ok, true)
    assert.match(start.message.text, /^start "Digger"\n/)
    // While it runs, no flag.
    assert.deepEqual((await build({ now: NOW + 6 * MIN })).chats.find(one => one.name === 'Digger').flags, [])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the server\'s moves go through the API as the server: a passed check closes the step once its look is answered', async () => {
  const { dir, digger, server, build, deliver } = await garden()
  try {
    await digger({ action: 'take', minutes: 30, id: 'B1' })
    await digger({ action: 'ask', of: 'B1', kind: 'look', blocking: false, text: 'Look at the hedge' })
    await digger({ action: 'report', id: 'B1', result: 'The hedge stands' })
    await server({ action: 'check', id: 'B1', passed: true, lines: ['base equals remote'] })
    assert.equal(valueOf((await readStore(dir)).items.get('B1'), 'State'), 'review')
    // Only the board moves for the server.
    assert.equal((await digger({ action: 'advance', id: 'B1', to: 'done' })).status, 403)
    await workApi({ action: 'answer', id: 'Q1', verdict: 'approve' }, { dir, now: NOW, prefix: 'Garden · ', as: 'person' })
    const state = await build()
    assert.deepEqual(state.reconciled.moves, [{ id: 'B1', to: 'done', why: 'review → done (the check passed and no ask of kind look is open)' }])
    const done = await deliver(state, memoryStore())
    assert.deepEqual(done.moved, ['B1'])
    assert.equal(valueOf((await readStore(dir)).items.get('B1'), 'State'), 'done')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a free worker\'s pull answers its line while a step may be taken; nothing while it holds one', async () => {
  const store = await garden()
  try {
    const pulled = await store.digger({ action: 'pull' })
    assert.deepEqual(pulled.result, { text: 'work: B1 is yours; run work next', id: 'B1', since: '2026-10-17 10:05', wake: { to: 'Digger', id: 'B1' }, changed: false })
    // The server sends it once under the same key as its own delivery.
    const outbox = memoryStore()
    const send = () => sendOnce({ dir: store.dir, key: 'B1 Digger 2026-10-17 10:05', words: { to: 'Digger', command: 'work', about: 'B1', text: pulled.result.text }, outbox, state: {}, now: NOW, maxChars: 2000, newId: () => 'p1' })
    assert.notEqual(await send(), null)
    assert.equal(await send(), null)
    await store.digger({ action: 'take', minutes: 30, id: 'B1' })
    assert.deepEqual((await store.digger({ action: 'pull' })).result, { text: '', id: 'B1', since: null, wake: null, changed: false })
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B301: while the store cannot be read the board reconciles nothing and says so on top: no line, no flag, no move', async () => {
  const { dir, build, deliver } = await garden()
  try {
    const state = await build({ now: NOW + 60 * MIN, running: ['Lead'], unread: true })
    assert.equal(state.reconciled, null)
    assert.equal(state.store.ok, false)
    assert.match(state.store.why, /^The work store .* cannot be read \(EACCES\)/)
    assert.deepEqual(state.backlog, [])
    assert.deepEqual(state.workFlags, [])
    assert.ok(state.chats.every(lane => lane.flags.length === 0))
    const outbox = memoryStore()
    assert.deepEqual(await deliver(state, outbox), { moved: [], sent: [], withdrawn: [], closed: [] })
    assert.equal(outbox.outbox().length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
