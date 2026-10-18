// Focus 4, seen live: the partner asked the main chat to queue the focus goal's steps with `work note --to main`, but a
// note in the store woke nobody. Now an unread note To: main wakes the main chat once through the outbox ("work: note
// N1 from <chat> for you; run work next"), as the delivery of a step does: once per note, remembered across a start
// anew, not while the main chat is suspended; its `work next` shows the note and marks it read, which stops the wakes.
// Made-up samples only.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
import { valueOf } from '../../src/work/item.mjs'
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
  const deliver = (state, outbox) => deliverWork({ state, dir, outbox, apply: body => server(body), now: NOW, maxChars: 2000, newId: () => `m${(n += 1)}` })
  return { dir, sage: as('Sage'), lead: as('Lead'), digger: as('Digger'), build, deliver }
}

test('an unread note to the main chat wakes it once with one line; not again, also not after the board starts anew', async () => {
  const { dir, sage, build, deliver } = await garden()
  try {
    assert.equal((await sage({ action: 'note', to: 'main', text: 'Queue for G6 Benches, the how the user agreed: B1 (the hedge)' })).ok, true)
    const state = await build()
    assert.deepEqual(state.reconciled.notes, [{ id: 'N1', chat: 'Lead', from: 'Sage', since: '2026-10-18 15:55' }])
    const outbox = memoryStore()
    await deliver(state, outbox)
    assert.deepEqual(outbox.outbox().map(one => [one.to, one.command, one.about, one.kind, messageText(one, () => '16:05')]), [['Lead', 'work', 'N1', 'note', 'work: note N1 from Sage for you; run work next']])
    await deliver(await build(), outbox)
    const anew = memoryStore()
    await deliver(await build(), anew)
    assert.equal(outbox.outbox().length, 1)
    assert.equal(anew.outbox().length, 0)
    assert.ok((await readDelivered(dir)).keys.includes('note N1 Lead'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the main chat\'s work next shows its unread notes first and marks them read: no more wakes, its waiting line withdrawn', async () => {
  const { dir, sage, lead, build, deliver } = await garden()
  try {
    await sage({ action: 'note', to: 'main', text: 'Queue for G6 Benches: B1' })
    const outbox = memoryStore()
    await deliver(await build(), outbox)
    const next = await lead({ action: 'next' })
    assert.equal(next.ok, true, next.why)
    assert.match(next.result.text, /^Notes for you, Lead:\n- N1 from Sage: Queue for G6 Benches: B1\n/)
    assert.deepEqual(next.result.notes, ['N1'])
    assert.equal(valueOf((await readStore(dir)).items.get('N1'), 'State'), 'read')
    // Read: nothing more to wake for; a line still waiting is withdrawn.
    const state = await build()
    assert.deepEqual(state.reconciled.notes, [])
    await deliver(state, outbox)
    assert.deepEqual(outbox.outbox().map(one => [one.about, one.state]), [['N1', 'dropped']])
    // A second next has no notes left.
    assert.doesNotMatch((await lead({ action: 'next' })).result.text, /Notes for you/)
    // Another chat's next does not read the main chat's notes.
    await sage({ action: 'note', to: 'main', text: 'one more' })
    assert.doesNotMatch((await workApi({ chat: 'Digger', action: 'next' }, { dir, now: NOW, prefix: 'Garden · ', roleOf: () => 'worker' })).result.text, /Notes for you/)
    assert.equal(valueOf((await readStore(dir)).items.get('N2'), 'State'), 'unread')
  } finally {
    await rm(dir, { recursive: true, force: true })
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
    await rm(dir, { recursive: true, force: true })
  }
})
