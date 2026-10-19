// Focus 4, seen live: the partner asked the main chat to queue the focus goal's steps with `work note --to main`, but a
// note in the store woke nobody. Now an unread note To: main wakes the main chat once through the outbox ("work: note
// N1 from <chat> for you; run work next"), as the delivery of a step does: once per note, remembered across a start
// anew, not while the main chat is suspended; its `work next` shows the note and marks it read, which stops the wakes.
// The review's findings: one line names all unread notes, none while one waits; notes from before this version's first
// start, the main chat's own and the board's report notes wake nothing; the main chat's read is its own (Main read).
// Made-up samples only.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, typed } from '../../fixtures/lines.mjs'
import { messageText } from '../../src/bridge.mjs'
import { parseConfig } from '../../src/config.mjs'
import { buildState } from '../withStore.mjs'
import { memoryStore } from '../../src/store.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork } from '../../src/work/deliver.mjs'
import { serializeItem, valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readDelivered, readStore, writeStore } from '../../src/work/store.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 18, 16, 5).getTime()
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge', ''].join('\n')
const app = (name, at) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at, lastAssistantUuid: 'u-1',
})
const tail = at => ({ text: [typed(at - 10 * MIN, 'Plant it'), answer(at, 'Done for now.')].join('\n'), isCut: false, modifiedAt: at })
const TIMES = { graceMs: 5 * MIN, askMs: 60 * MIN, idleMs: 30 * MIN }

async function garden() {
  const dir = await mkdtemp(join(tmpdir(), 'note-wake-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  const ctx = at => ({ dir, now: at, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Digger: 'worker', Sage: 'advisor' })[chat] ?? null, freeChats: new Set() })
  const as = chat => (body, at = NOW - 10 * MIN) => workApi({ chat, ...body }, ctx(at))
  const server = (body, at = NOW) => workApi(body, { ...ctx(at), as: 'server' })
  const build = async ({ now = NOW } = {}) => {
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead', NOW - 5 * MIN), app('Digger', NOW - 5 * MIN)],
      tails: { 'cli-Digger': tail(NOW - 5 * MIN), 'cli-Lead': tail(NOW - 5 * MIN) }, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {},
      work: { ok: true, dir, ...(await readStore(dir)) },
    }
    const seen = { shown: { Lead: now, Digger: now }, other: {} }
    return buildState(raw, { lines: [], outbox: [], runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen, now, config })
  }
  let n = 0
  const deliver = (state, outbox, now = NOW) => deliverWork({ state, dir, outbox, apply: body => server(body), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
  // The board's first start with this version, before the notes of a test are filed.
  await deliver({ reconciled: { moves: [], deliveries: [], says: [], notes: [] }, chats: [] }, memoryStore(), NOW - 30 * MIN)
  return { dir, sage: as('Sage'), lead: as('Lead'), digger: as('Digger'), build, deliver }
}

test('the review\'s findings: unread notes to the main chat wake it with one line naming them all; none while one waits', async () => {
  const { dir, sage, digger, build, deliver } = await garden()
  try {
    assert.equal((await sage({ action: 'note', to: 'main', text: 'Queue for G6 Benches, the how the user agreed: B1 (the hedge)' })).ok, true)
    await digger({ action: 'note', to: 'main', text: 'paused for the limit until 18:00' })
    const state = await build()
    assert.deepEqual(state.reconciled.notes, [
      { id: 'N1', chat: 'Lead', from: 'Sage', since: '2026-10-18 15:55' },
      { id: 'N2', chat: 'Lead', from: 'Digger', since: '2026-10-18 15:55' },
    ])
    const outbox = memoryStore()
    await deliver(state, outbox)
    assert.deepEqual(outbox.outbox().map(one => [one.to, one.command, one.kind, one.notes, messageText(one, () => '16:05')]), [['Lead', 'work', 'note', ['N1', 'N2'], 'work: notes N1, N2 for you; run work next']])
    // While that line waits (or its chat has taken it), nothing more; nor on a board started anew.
    await deliver(await build(), outbox)
    await sage({ action: 'note', to: 'main', text: 'one more' })
    await deliver(await build(), outbox)
    assert.equal(outbox.outbox().length, 1)
    await outbox.update(outbox.outbox()[0].id, { state: 'taken' })
    await deliver(await build(), outbox)
    assert.equal(outbox.outbox().length, 1)
    // Typed in: the next refresh names every note the main chat has not read.
    await outbox.update(outbox.outbox()[0].id, { state: 'delivered' })
    await deliver(await build(), outbox)
    assert.deepEqual(outbox.outbox().map(one => messageText(one, () => '16:05')).at(-1), 'work: notes N1, N2, N3 for you; run work next')
    assert.ok((await readDelivered(dir)).keys.includes('notes N1,N2 Lead'))
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the review\'s findings: the notes filed before this version\'s first start count as woken already', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'note-wake-old-'))
  try {
    await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
    const ctx = { dir, now: NOW - 20 * MIN, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Sage: 'advisor' })[chat] ?? null, freeChats: new Set() }
    for (const text of ['old one', 'old two']) await workApi({ chat: 'Sage', action: 'note', to: 'main', text }, ctx)
    const lanes = [{ name: 'Lead', isMain: true, state: 'free', isRunning: true }]
    const plan = async () => reconcile({ store: await readStore(dir), lanes, now: NOW, times: TIMES, prefix: 'Garden · ' })
    const outbox = memoryStore()
    let n = 0
    const deliver = async () => deliverWork({ state: { reconciled: await plan(), chats: lanes }, dir, outbox, apply: async () => null, now: NOW, maxChars: 2000, newId: () => `o${(n += 1)}` })
    await deliver()
    assert.equal(outbox.outbox().length, 0)
    assert.equal((await readDelivered(dir)).notesFrom, '2026-10-18 16:05')
    await workApi({ chat: 'Sage', action: 'note', to: 'main', text: 'new one' }, { ...ctx, now: NOW + 60_000 })
    await deliver()
    assert.deepEqual(outbox.outbox().map(one => messageText(one, () => '16:06')), ['work: note N3 for you; run work next'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the review\'s findings: the main chat\'s work next shows its notes and marks them read for itself; the person still sees them', async () => {
  const { dir, sage, lead, build, deliver } = await garden()
  try {
    await sage({ action: 'note', to: 'main', text: 'Queue for G6 Benches: B1' })
    const outbox = memoryStore()
    await deliver(await build(), outbox)
    const next = await lead({ action: 'next' })
    assert.equal(next.ok, true, next.why)
    assert.match(next.result.text, /^Notes for you, Lead:\n- N1 from Sage: Queue for G6 Benches: B1\n/)
    assert.deepEqual(next.result.notes, ['N1'])
    const n1 = (await readStore(dir)).items.get('N1')
    assert.equal(valueOf(n1, 'State'), 'unread')
    assert.equal(valueOf(n1, 'Main read'), '2026-10-18 15:55')
    // Read by the main chat: nothing more to wake for; its line still waiting is withdrawn.
    const state = await build()
    assert.deepEqual(state.reconciled.notes, [])
    assert.ok(state.information.some(one => one.id === 'N1' && one.isRead === false))
    await deliver(state, outbox)
    assert.deepEqual(outbox.outbox().map(one => [one.notes, one.state]), [[['N1'], 'dropped']])
    assert.doesNotMatch((await lead({ action: 'next' })).result.text, /Notes for you/)
    // Another chat's next does not read the main chat's notes.
    await sage({ action: 'note', to: 'main', text: 'one more' })
    assert.doesNotMatch((await workApi({ chat: 'Digger', action: 'next' }, { dir, now: NOW, prefix: 'Garden · ', roleOf: () => 'worker' })).result.text, /Notes for you/)
    assert.equal(valueOf((await readStore(dir)).items.get('N2'), 'Main read'), null)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the review\'s findings: no wake for the main chat\'s own notes, nor for the board\'s note of a report (marked Via: report)', async () => {
  const { dir, lead, digger, build } = await garden()
  try {
    await lead({ action: 'note', to: 'main', text: 'a note to myself' })
    const step = (await readStore(dir)).items.get('B1')
    step.head.set('State', 'in progress')
    step.head.set('Owner', 'Digger')
    await writeFile(join(dir, 'B1.md'), serializeItem(step))
    const reported = await digger({ action: 'report', id: 'B1', result: 'The hedge stands' })
    assert.equal(reported.ok, true, reported.why)
    const notes = [...(await readStore(dir)).items.values()].filter(item => valueOf(item, 'Kind') === 'note')
    assert.deepEqual(notes.map(item => [valueOf(item, 'From'), valueOf(item, 'Via')]), [['Lead', null], ['Digger', 'report']])
    assert.deepEqual((await build()).reconciled.notes, [])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('not while the main chat is suspended, nor for a note to the person, nor without a main chat on the board', async () => {
  const { dir, sage, digger } = await garden()
  try {
    await sage({ action: 'note', to: 'main', text: 'Queue: B1' })
    await digger({ action: 'note', to: 'you', text: 'for the person' })
    const store = await readStore(dir)
    const lanes = state => [{ name: 'Lead', isMain: true, state, isRunning: true }, { name: 'Digger', state: 'free', isRunning: true }]
    assert.deepEqual(reconcile({ store, lanes: lanes('working'), now: NOW, times: TIMES, prefix: 'Garden · ' }).notes.map(one => one.id), ['N1'])
    assert.deepEqual(reconcile({ store, lanes: lanes('suspended'), now: NOW, times: TIMES, prefix: 'Garden · ' }).notes, [])
    assert.deepEqual(reconcile({ store, lanes: lanes('free').slice(1), now: NOW, times: TIMES, prefix: 'Garden · ' }).notes, [])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
