// B570: the board has a free worker on an older Workers mod restarted before its next step: the main chat gets the word
// once, the step's line waits for it, and goes once the worker's process has ended (its next start runs the installed
// mod). Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, typed } from '../../fixtures/lines.mjs'
import { parseConfig } from '../../src/config.mjs'
import { buildState } from '../withStore.mjs'
import { memoryStore } from '../../src/store.mjs'
import { deliverWork } from '../../src/work/deliver.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 22, 5).getTime()
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', ''].join('\n')

const app = (name, at) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at, lastAssistantUuid: 'u-1', effort: 'low',
})
const tail = at => ({ text: [typed(at - 10 * MIN, 'Plant it'), answer(at, 'Done for now.')].join('\n'), isCut: false, modifiedAt: at })

async function garden() {
  const dir = await mkdtemp(join(tmpdir(), 'mod-rollout-'))
  const store = migrateBacklog(BACKLOG, { now: NOW - 60 * MIN })
  store.items.get('B1').sections.set('Effort', ['low · a text fix in one file'])
  await writeStore(dir, store, undefined, { now: NOW - 60 * MIN })
  const server = (body, at) => workApi(body, { dir, now: at, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, freeChats: new Set(['Digger']), as: 'server' })
  /** The board's state at `now`: Digger's process asked the board at `diggerSeen`, its mod said `digger`. */
  const build = async ({ now = NOW, outbox = [], digger = '0.16.1', diggerSeen = now } = {}) => {
    const work = { ok: true, dir, ...(await readStore(dir)) }
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead', NOW - 5 * MIN), app('Digger', NOW - 5 * MIN)],
      tails: { 'cli-Digger': tail(NOW - 5 * MIN) }, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
    }
    const seen = { shown: { Lead: now, Digger: diggerSeen }, other: {} }
    const mods = { installed: '0.17.0', chats: { Lead: '0.17.0', ...(digger === null ? {} : { Digger: digger }) } }
    return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen, mods, now, config })
  }
  let n = 0
  const deliver = (state, outbox, now = NOW) => deliverWork({ state, dir, outbox, apply: body => server(body, now), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
  return { dir, build, deliver }
}

test('a free worker on an older mod: the main chat restarts it first, and its step goes once its process ended', async () => {
  const { dir, build, deliver } = await garden()
  try {
    const outbox = memoryStore()
    let state = await build()
    assert.equal(state.chats.find(lane => lane.name === 'Digger').state, 'free')
    assert.deepEqual(state.reconciled.deliveries, [], 'the step waits for the restart')
    assert.match(state.reconciled.holds.B1, /^B1 waits until Digger is restarted on Workers mod 0\.17\.0/)
    assert.deepEqual(state.reconciled.restarts.map(one => [one.to, one.chat, one.session, one.runs]), [['Lead', 'Digger', 'local_Digger', '0.16.1']])
    assert.equal(state.chats.find(lane => lane.name === 'Digger').modRun.text, 'Workers mod 0.16.1: Lead is asked to restart it')
    const done = await deliver(state, outbox)
    assert.deepEqual(done.sent.map(one => [one.to, one.command, one.about]), [['Lead', 'mod-restart', 'Digger']])
    assert.equal(done.sent[0].text, ['restart for mod', 'Chat: Digger', 'Session: local_Digger', 'From: 0.16.1', 'To: 0.17.0', 'Why: Digger is idle and runs Workers mod 0.16.1; 0.17.0 is installed'].join('\n'))
    // The next refresh, before the main chat restarted it: no second word, the step still waits.
    state = await build({ now: NOW + MIN, outbox: outbox.outbox() })
    assert.deepEqual([state.reconciled.deliveries, state.reconciled.restarts], [[], []])
    assert.deepEqual((await deliver(state, outbox, NOW + MIN)).sent, [])
    // Also when two refreshes plan it before the state shows it: the word went once.
    assert.deepEqual((await deliver(await build({ now: NOW + MIN }), outbox, NOW + MIN)).sent.filter(one => one.command === 'mod-restart'), [])
    // Restarted: its process ended (it no longer asks the board), so its next start runs the installed mod: the line goes.
    state = await build({ now: NOW + 3 * MIN, outbox: outbox.outbox(), digger: null, diggerSeen: NOW })
    assert.deepEqual(state.reconciled.deliveries.map(one => [one.id, one.chat]), [['B1', 'Digger']])
    assert.deepEqual(state.reconciled.restarts, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a worker already on the installed mod gets its step at once, and nobody is asked', async () => {
  const { dir, build } = await garden()
  try {
    const state = await build({ digger: '0.17.0' })
    assert.deepEqual(state.reconciled.deliveries.map(one => one.id), ['B1'])
    assert.deepEqual(state.reconciled.restarts, [])
    assert.equal(state.chats.find(lane => lane.name === 'Digger').modRun, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
