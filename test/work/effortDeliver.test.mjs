// B468: a worker runs at its step's effort. The board reads what the app's file of each chat says it runs at, asks the
// main chat to set the worker's chat to the step's level (the app applies a new effort from the chat's next turn on).
// T8.5 step 6: no line waits here for it: a worker's line comes only in its hand-over's envelope, which waits for the set
// (test/work/handoverBoard.test.mjs). Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, typed } from '../../fixtures/lines.mjs'
import { parseConfig } from '../../src/config.mjs'
import { buildState } from '../withStore.mjs'
import { memoryStore, outboxNow } from '../../src/store.mjs'
import { deliverWork } from '../../src/work/deliver.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 21, 11, 5).getTime()
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', ''].join('\n')

const app = (name, at, effort, model = null, session = `local_${name}`) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: session, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at, lastAssistantUuid: 'u-1', effort,
  ...(model === null ? {} : { model }),
})
const tail = at => ({ text: [typed(at - 10 * MIN, 'Plant it'), answer(at, 'Done for now.')].join('\n'), isCut: false, modifiedAt: at })

async function garden(settings = config, model = null) {
  const dir = await mkdtemp(join(tmpdir(), 'effort-deliver-'))
  const store = migrateBacklog(BACKLOG, { now: NOW - 60 * MIN })
  store.items.get('B1').sections.set('Effort', ['low · a text fix in one file'])
  if (model !== null) store.items.get('B1').sections.set('Model', [model])
  await writeStore(dir, store, undefined, { now: NOW - 60 * MIN })
  const ctx = at => ({ dir, now: at, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, freeChats: new Set(['Digger']) })
  const server = (body, at = NOW) => workApi(body, { ...ctx(at), as: 'server' })
  /** The board's state at `now`, the digger's chat at `effort` (and on `model`) as the app's file says. */
  const build = async ({ now = NOW, effort = 'xhigh', model = null, outbox = [], session = undefined } = {}) => {
    const work = { ok: true, dir, ...(await readStore(dir)) }
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead', NOW - 5 * MIN, 'medium'), app('Digger', NOW - 5 * MIN, effort, model, session)],
      tails: { 'cli-Digger': tail(NOW - 5 * MIN) }, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
    }
    const seen = { shown: { Lead: now, Digger: now }, other: {} }
    return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen, now, config: settings })
  }
  let n = 0
  const deliver = (state, outbox, now = NOW) => deliverWork({ state, dir, outbox, apply: body => server(body, now), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
  return { dir, build, deliver, ctx }
}

test('the main chat is asked to set the worker to the level of its step, once; no line goes to the worker from this pass', async () => {
  const { dir, build, deliver } = await garden()
  try {
    const outbox = memoryStore()
    let state = await build()
    assert.equal(state.chats.find(lane => lane.name === 'Digger').effort, 'xhigh')
    assert.deepEqual(state.reconciled.deliveries, [])
    // Model per step: the usual level is the settings' (medium), not the extra high the chat ran at.
    assert.deepEqual(state.reconciled.efforts.map(one => [one.to, one.chat, one.level, one.usual, one.step]), [['Lead', 'Digger', 'low', 'medium', 'B1']])
    assert.deepEqual(state.chats.find(lane => lane.name === 'Digger').effortRun, { level: 'low', model: null, usual: 'medium', usualModel: null, step: 'B1', why: 'a text fix in one file', modelWhy: null, isSet: false, asked: null, waitsFor: null })
    const done = await deliver(state, outbox)
    assert.deepEqual(done.sent.map(one => [one.to, one.command]), [['Lead', 'worker-effort']])
    assert.equal(done.sent[0].text, ['set effort', 'Chat: Digger', 'Effort: low', 'Session: local_Digger', 'Step: B1', "Why: B1 is Digger's next step; its refine says low (a text fix in one file)"].join('\n'))
    // The next refresh, before the main chat set it: no second word.
    state = await build({ now: NOW + MIN, outbox: outbox.outbox() })
    assert.deepEqual([state.reconciled.deliveries, state.reconciled.efforts], [[], []])
    assert.equal(state.chats.find(lane => lane.name === 'Digger').effortRun.asked.at, NOW)
    assert.deepEqual((await deliver(state, outbox, NOW + MIN)).sent, [])
    // Set by the main chat: nothing more to ask, and still no line from this pass.
    state = await build({ now: NOW + 2 * MIN, effort: 'low', outbox: outbox.outbox() })
    assert.deepEqual([state.reconciled.deliveries, state.reconciled.efforts], [[], []])
    assert.equal(state.chats.find(lane => lane.name === 'Digger').effortRun.isSet, true)
    const sent = await deliver(state, outbox, NOW + 2 * MIN)
    assert.deepEqual(sent.sent, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('B820 (X110): a fresh chat under the same name is asked again at once, not held back by the word for the old session', async () => {
  const { dir, build, deliver } = await garden()
  try {
    const outbox = memoryStore()
    await deliver(await build(), outbox)
    // Two minutes later the chat was replaced: another session, on the app's default. The old word does not count.
    const state = await build({ now: NOW + 2 * MIN, outbox: outbox.outbox(), session: 'local_Digger2' })
    assert.deepEqual(state.reconciled.efforts.map(one => [one.chat, one.session, one.level]), [['Digger', 'local_Digger2', 'low']])
    const done = await deliver(state, outbox, NOW + 2 * MIN)
    assert.deepEqual(done.sent.map(one => [one.command, one.session]), [['worker-effort', 'local_Digger2']])
    // Planned again before the state shows the new word: still one word per session.
    assert.deepEqual((await deliver(state, outbox, NOW + 2 * MIN)).sent, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a worker already at the level of its step: the main chat no word', async () => {
  const { dir, build } = await garden()
  try {
    const state = await build({ effort: 'low' })
    assert.deepEqual(state.reconciled.efforts, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('model per step: with the model ids of the settings, the main chat is asked for model and effort in one word, once', async () => {
  const settings = { ...parseConfig(JSON.stringify({ models: { sonnet: 'claude-sonnet-test', opus: 'claude-opus-test' } }), {}), project: PROJECT }
  const { dir, build, deliver } = await garden(settings)
  try {
    const outbox = memoryStore()
    // B1 names no model: it runs on Sonnet; the digger's chat runs on Opus at extra high.
    let state = await build({ model: 'claude-opus-test' })
    assert.deepEqual(state.reconciled.deliveries, [])
    assert.deepEqual(state.reconciled.efforts.map(one => [one.chat, one.model, one.level, one.step]), [['Digger', 'claude-sonnet-test', 'low', 'B1']])
    const done = await deliver(state, outbox)
    assert.deepEqual(done.sent.map(one => [one.to, one.command]), [['Lead', 'worker-effort']])
    assert.equal(done.sent[0].text, ['set model and effort', 'Chat: Digger', 'Session: local_Digger', 'Step: B1', 'Model: claude-sonnet-test', 'Effort: low', "Why: B1 is Digger's next step; model sonnet (its refine gives none), effort low (a text fix in one file)"].join('\n'))
    // The effort set, the model not yet: no second word goes.
    state = await build({ now: NOW + MIN, effort: 'low', model: 'claude-opus-test', outbox: outbox.outbox() })
    assert.deepEqual([state.reconciled.deliveries, state.reconciled.efforts], [[], []])
    assert.deepEqual((await deliver(state, outbox, NOW + MIN)).sent, [])
    // Both set: the lane says so.
    state = await build({ now: NOW + 2 * MIN, effort: 'low', model: 'claude-sonnet-test', outbox: outbox.outbox() })
    assert.deepEqual(state.chats.find(lane => lane.name === 'Digger').effortRun, { level: 'low', model: 'sonnet', usual: 'medium', usualModel: 'sonnet', step: 'B1', why: 'a text fix in one file', modelWhy: null, isSet: true, asked: { at: NOW, state: 'waiting' }, waitsFor: null })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the review: the lane of an opus step says since when it waits for Opus; nothing is held here and the take is the worker own', async () => {
  const settings = { ...parseConfig(JSON.stringify({ models: { sonnet: 'claude-sonnet-test', opus: 'claude-opus-test' } }), {}), project: PROJECT }
  const { dir, build, deliver, ctx } = await garden(settings, 'opus · the work store')
  try {
    const outbox = memoryStore()
    let state = await build({ model: 'claude-sonnet-test', effort: 'xhigh' })
    assert.deepEqual(state.reconciled.efforts.map(one => [one.chat, one.model, one.level, one.step]), [['Digger', 'claude-opus-test', 'low', 'B1']])
    await deliver(state, outbox)
    // The effort set, the model not: four minutes on, the lane says B1 waits for Opus.
    const later = NOW + 4 * MIN
    state = await build({ now: later, effort: 'low', model: 'claude-sonnet-test', outbox: outbox.outbox() })
    assert.deepEqual([state.reconciled.deliveries, state.reconciled.held], [[], undefined])
    const at = `${String(new Date(NOW).getHours()).padStart(2, '0')}:${String(new Date(NOW).getMinutes()).padStart(2, '0')}`
    const text = `B1 waits for Opus since ${at}: the main chat was asked, and the app does not say Opus yet; it goes once Digger runs on Opus.`
    assert.deepEqual(state.chats.find(lane => lane.name === 'Digger').flags, [{ kind: 'model', id: 'B1', text, button: null }])
    assert.equal(state.reconciled.holds, undefined)
    // Its own take is not refused by the board (T8.5 step 6: its hand-over envelope waits for the set, not its take).
    assert.equal((await workApi({ chat: 'Digger', action: 'take', minutes: 30, id: 'B1', branch: 'b1-hedge' }, ctx(later))).ok, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the review: model ids the settings name otherwise than both are a warning on top, and the board sets the effort alone', async () => {
  const settings = { ...parseConfig(JSON.stringify({ models: { opus: 'claude-opus-test' } }), {}), project: PROJECT }
  const { dir, build } = await garden(settings, 'opus · the work store')
  try {
    const state = await build({ model: 'claude-sonnet-test', effort: 'xhigh' })
    assert.ok(state.workFlags.some(line => /^Settings: the settings' "models" must name both "sonnet" and "opus"/.test(line)), state.workFlags.join('\n'))
    assert.deepEqual(state.reconciled.efforts.map(one => [one.model, one.level]), [[null, 'low']])
    assert.equal(state.chats.find(lane => lane.name === 'Digger').effortRun.waitsFor, null)
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
