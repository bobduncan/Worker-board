// B548 (the result check of B532): the outbox sweep runs at every refresh and before a chat's take, and a replay of the
// real outbox is a test. fixtures/outbox-replay.json is the board's outbox as it stood before B532's first sweep (24
// October 18:37): the 33 words that waited, the newer word of the same kind for each, and the states of their steps then;
// the words' shapes only, every text the board's own first line or a stand-in.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { memoryStore } from '../../src/store.mjs'
import { deliverWork } from '../../src/work/deliver.mjs'
import { sweepOutbox, takeFor } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }
const ROOT = new URL('../../', import.meta.url)
const replay = JSON.parse(await readFile(new URL('fixtures/outbox-replay.json', ROOT), 'utf8'))

const outboxOf = words => {
  const store = memoryStore()
  for (const one of words) store.outbox().push({ ...one })
  return store
}
const stateOf = (store, id) => store.outbox().find(one => one.id === id)?.state

test('the replay with the steps\' states of then: 31 of 33 close, the Q300 answer and the weekly round stay, and the answer reaches its chat', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'outbox-replay-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await storeWith(dir, replay.items)
  const store = outboxOf(replay.words)
  assert.equal(replay.words.filter(one => one.state === 'waiting').length, 33)
  const closed = await sweepOutbox({ dir, outbox: store, state: { chats: [{ name: 'Advisor', isRunning: false }] }, now: replay.at, keep })
  assert.equal(closed.length, 31)
  const left = replay.words.filter(one => one.state === 'waiting' && !closed.some(shut => shut.id === one.id))
  assert.deepEqual(left.map(one => [one.to, one.command ?? null, one.step ?? one.round ?? null]), [['Worker 5', null, 'Q300'], ['Advisor', 'round', 'weekly']])
  // As the board's own first sweep closed them that evening.
  const why = {}
  for (const one of closed) why[one.why.replace(/ \(.*\)$/, '')] = (why[one.why.replace(/ \(.*\)$/, '')] ?? 0) + 1
  assert.deepEqual(why, { 'superseded by a newer word of the same kind': 23, 'the step is done now, not in review': 4, 'the step is done now, not new': 3, 'waited longer than 48 hours': 1 })
  // Q300's answer, three days old, is handed to Worker 5 at its next take, with its age.
  const taken = await takeFor({ dir, outbox: store, state: { chats: [] }, now: replay.at, keep, chat: 'Worker 5' })
  assert.deepEqual(taken.map(one => [one.step, Math.round(one.lateMs / HOUR)]), [['Q300', 77]])
})

test('takeFor sweeps that chat\'s words before the take: a superseded word is closed with its why, never handed out', async () => {
  const at = Date.UTC(2026, 9, 24, 16)
  const older = { id: 'r1', at: at - 40 * MIN, to: 'Partner', ask: null, command: 'refine', about: 'B7', text: 'refine step', state: 'waiting' }
  const newer = { id: 'r2', at: at - 5 * MIN, to: 'Partner', ask: null, command: 'refine', about: 'B7', text: 'refine step', state: 'waiting' }
  const other = { id: 'r3', at: at - 40 * MIN, to: 'Digger', ask: null, command: 'refine', about: 'B8', text: 'refine step', state: 'waiting' }
  const other2 = { ...other, id: 'r4', at: at - 5 * MIN }
  const store = outboxOf([older, newer, other, other2])
  const taken = await takeFor({ dir: null, outbox: store, state: {}, now: at, keep, chat: 'Partner' })
  assert.deepEqual(taken.map(one => one.id), ['r2'])
  assert.equal(stateOf(store, 'r1'), 'dropped')
  assert.match(store.outbox().find(one => one.id === 'r1').why, /^superseded by a newer word of the same kind/)
  // Only the chat that takes is swept.
  assert.deepEqual(['r3', 'r4'].map(id => stateOf(store, id)), ['waiting', 'waiting'])
})

test('a refresh sweeps the outbox: deliverWork closes a superseded word with its why', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'outbox-refresh-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const at = Date.UTC(2026, 9, 24, 16)
  const store = outboxOf([
    { id: 'w1', at: at - 3 * HOUR, to: 'Partner', ask: null, command: 'round', round: 'weekly', text: 'Round from the board\'s clock: weekly', state: 'waiting' },
    { id: 'w2', at: at - HOUR, to: 'Partner', ask: null, command: 'round', round: 'weekly', text: 'Round from the board\'s clock: weekly', state: 'delivered' },
  ])
  const done = await deliverWork({ state: { reconciled: {}, chats: [] }, dir, outbox: store, apply: async () => null, now: at, maxChars: 2000, newId: () => 'n', keep })
  assert.deepEqual(done.closed.map(one => one.id), ['w1'])
  assert.equal(stateOf(store, 'w1'), 'dropped')
})

test('the server\'s take goes through takeFor and its refresh hands deliverWork the outbox\'s keep, so neither skips the sweep', async () => {
  const server = await readFile(new URL('server.mjs', ROOT), 'utf8')
  const take = server.slice(server.indexOf('    take: counted('), server.indexOf('    typed: counted('))
  assert.match(take, /await takeFor\(\{ dir: workDir, outbox: store, [^}]*chat: checked\.chat/)
  assert.doesNotMatch(take, /store\.take\(/)
  const refresh = server.slice(server.indexOf('const done = await deliverWork({'), server.indexOf('const done = await deliverWork({') + 300)
  assert.match(refresh, /\bkeep,?\s*\}\)/)
})

/** A work store folder with the given steps (their id and state only), as readStore reads one. */
async function storeWith(dir, states) {
  for (const [id, state] of Object.entries(states)) await writeFile(join(dir, `${id}.md`), `Id: ${id}
Kind: step
Title: Step ${id}
State: ${state}
`)
}
