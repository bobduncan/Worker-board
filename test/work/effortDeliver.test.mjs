// B468: a worker runs at its step's effort. The board reads what the app's file of each chat says it runs at, asks the
// main chat to set the worker's chat to the step's level before the step's line goes to it (the app applies a new
// effort from the chat's next turn on), and sends that line once it is set, or after a few minutes anyway. Made-up
// samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, typed } from '../../fixtures/lines.mjs'
import { parseConfig } from '../../src/config.mjs'
import { buildState } from '../withStore.mjs'
import { memoryStore, outboxNow } from '../../src/store.mjs'
import { deliverWork, pullFor } from '../../src/work/deliver.mjs'
import { HOLD_MS } from '../../src/work/effort.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 21, 11, 5).getTime()
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', ''].join('\n')

const app = (name, at, effort) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at, lastAssistantUuid: 'u-1', effort,
})
const tail = at => ({ text: [typed(at - 10 * MIN, 'Plant it'), answer(at, 'Done for now.')].join('\n'), isCut: false, modifiedAt: at })

async function garden() {
  const dir = await mkdtemp(join(tmpdir(), 'effort-deliver-'))
  const store = migrateBacklog(BACKLOG, { now: NOW - 60 * MIN })
  store.items.get('B1').sections.set('Effort', ['low · a text fix in one file'])
  await writeStore(dir, store, undefined, { now: NOW - 60 * MIN })
  const ctx = at => ({ dir, now: at, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, freeChats: new Set(['Digger']) })
  const server = (body, at = NOW) => workApi(body, { ...ctx(at), as: 'server' })
  /** The board's state at `now`, the digger's chat at `effort` as the app's file says. */
  const build = async ({ now = NOW, effort = 'xhigh', outbox = [] } = {}) => {
    const work = { ok: true, dir, ...(await readStore(dir)) }
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead', NOW - 5 * MIN, 'medium'), app('Digger', NOW - 5 * MIN, effort)],
      tails: { 'cli-Digger': tail(NOW - 5 * MIN) }, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
    }
    const seen = { shown: { Lead: now, Digger: now }, other: {} }
    return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen, now, config })
  }
  let n = 0
  const deliver = (state, outbox, now = NOW) => deliverWork({ state, dir, outbox, apply: body => server(body, now), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
  return { dir, build, deliver }
}

test('the main chat is asked to set the worker to its step\'s level first; the step\'s line goes once it is set', async () => {
  const { dir, build, deliver } = await garden()
  try {
    const outbox = memoryStore()
    let state = await build()
    assert.equal(state.chats.find(lane => lane.name === 'Digger').effort, 'xhigh')
    assert.deepEqual(state.reconciled.deliveries, [])
    assert.deepEqual(state.reconciled.efforts.map(one => [one.to, one.chat, one.level, one.usual, one.step]), [['Lead', 'Digger', 'low', 'xhigh', 'B1']])
    assert.deepEqual(state.chats.find(lane => lane.name === 'Digger').effortRun, { level: 'low', usual: 'xhigh', step: 'B1', why: 'a text fix in one file', isSet: false, asked: null })
    const done = await deliver(state, outbox)
    assert.deepEqual(done.sent.map(one => [one.to, one.command]), [['Lead', 'worker-effort']])
    assert.equal(done.sent[0].text, ['set effort', 'Chat: Digger', 'Effort: low', 'Session: local_Digger', 'Step: B1', "Why: B1 is Digger's next step; its refine says low (a text fix in one file)"].join('\n'))
    // The next refresh, before the main chat set it: no second word, the line still waits.
    state = await build({ now: NOW + MIN, outbox: outbox.outbox() })
    assert.deepEqual([state.reconciled.deliveries, state.reconciled.efforts], [[], []])
    assert.equal(state.chats.find(lane => lane.name === 'Digger').effortRun.asked.at, NOW)
    assert.deepEqual((await deliver(state, outbox, NOW + MIN)).sent, [])
    // Set by the main chat: the line goes.
    state = await build({ now: NOW + 2 * MIN, effort: 'low', outbox: outbox.outbox() })
    assert.deepEqual(state.reconciled.deliveries.map(one => one.id), ['B1'])
    assert.equal(state.chats.find(lane => lane.name === 'Digger').effortRun.isSet, true)
    const sent = await deliver(state, outbox, NOW + 2 * MIN)
    assert.deepEqual(sent.sent.map(one => [one.to, one.text]), [['Digger', 'work: B1 is yours; run work next']])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the review: a worker\'s own pull at its turn\'s end waits as the reconciler\'s line does', async () => {
  const { dir, build } = await garden()
  try {
    const outbox = memoryStore()
    const result = { text: 'work: B1 is yours; run work next', id: 'B1', since: '2026-10-21 10:05', wake: { to: 'Digger', id: 'B1' }, changed: false }
    const pull = state => pullFor({ dir, result, state, outbox, now: NOW, maxChars: 2000, newId: () => 'p1' })
    let state = await build()
    assert.deepEqual(state.reconciled.held, ['B1'])
    assert.equal((await pull(state)).text, '')
    assert.deepEqual(outbox.outbox(), [])
    state = await build({ effort: 'low' })
    assert.equal((await pull(state)).text, 'work: B1 is yours; run work next')
    assert.deepEqual(outbox.outbox().map(one => one.to), ['Digger'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('not set within a few minutes, the step\'s line goes anyway', async () => {
  const { dir, build, deliver } = await garden()
  try {
    const outbox = memoryStore()
    await deliver(await build(), outbox)
    const state = await build({ now: NOW + HOLD_MS, outbox: outbox.outbox() })
    assert.deepEqual(state.reconciled.deliveries.map(one => one.id), ['B1'])
    assert.deepEqual(state.reconciled.efforts, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a worker already at its step\'s level gets its line at once, and the main chat no word', async () => {
  const { dir, build } = await garden()
  try {
    const state = await build({ effort: 'low' })
    assert.deepEqual(state.reconciled.deliveries.map(one => one.id), ['B1'])
    assert.deepEqual(state.reconciled.efforts, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the outbox keeps the newest word per worker however old: it carries the worker\'s usual level', () => {
  const keep = { messageMs: 10 * MIN, answerMs: 24 * 60 * MIN }
  const word = (about, effort, at) => ({ id: `${about}-${at}`, at, to: 'Lead', command: 'worker-effort', about, effort, usual: 'xhigh', text: 'set effort', state: 'delivered' })
  const words = [word('Digger', 'low', NOW - 300 * MIN), word('Digger', 'medium', NOW - 200 * MIN), word('Weeder', 'high', NOW - 250 * MIN)]
  assert.deepEqual(outboxNow(words, NOW, keep).map(one => one.id), [`Digger-${NOW - 200 * MIN}`, `Weeder-${NOW - 250 * MIN}`])
})
