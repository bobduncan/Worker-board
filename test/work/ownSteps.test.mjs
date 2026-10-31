// Focus 3: the partner (role advisor) and the main chat take, work and report a step queued for them, as a worker
// does: the default flow lets them, as the live project's flow.json does. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 18, 11, 5).getTime()
const BACKLOG = [
  '# Backlog',
  '',
  '## Board work',
  '- [ ] B1 Sort the goal map (for Advisor; about 1 h)',
  '- [ ] B2 Tidy the queue (for Main; about 30 min)',
  '',
].join('\n')
const ROLES = { Main: 'main', Advisor: 'advisor', Board: 'worker' }

test('the flow lets the advisor and the main chat take, work and report their own steps, as a worker', () => {
  const by = (from, to) => DEFAULT_FLOW.step.moves.filter(move => move.from === from && move.to === to && !(Array.isArray(move.by) ? move.by : [move.by]).includes('server'))
    .flatMap(move => (Array.isArray(move.by) ? move.by : [move.by]))
  for (const [from, to] of [['queued', 'taken'], ['taken', 'in progress'], ['in progress', 'waiting on you'], ['in progress', 'review'], ['review', 'review']]) {
    assert.deepEqual(by(from, to), ['worker', 'advisor', 'main'], `${from} → ${to}`)
  }
})

test('the advisor takes its own queued step, reports it, and it goes to review; so does the main chat', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'own-steps-'))
  try {
    await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
    const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set() }
    const as = chat => body => workApi({ chat, ...body }, ctx)
    const state = async id => valueOf((await readStore(dir)).items.get(id), 'State')
    const taken = await as('Advisor')({ action: 'take', minutes: 30, id: 'B1', branch: 'b1-goals' })
    assert.equal(taken.ok, true, taken.why)
    assert.equal(await state('B1'), 'in progress')
    const history = (await readStore(dir)).items.get('B1').sections.get('History')
    assert.deepEqual(history.slice(-2), ['- 2026-10-18 11:06 Advisor: queued → taken', '- 2026-10-18 11:06 Advisor: taken → in progress'])
    const reported = await as('Advisor')({ action: 'report', id: 'B1', result: 'The goal map is sorted.' })
    assert.equal(reported.ok, true, reported.why)
    assert.equal(await state('B1'), 'review')
    assert.equal((await as('Advisor')({ action: 'report', id: 'B1', result: 'Sorted again.' })).ok, true)
    // The main chat too.
    assert.equal((await as('Main')({ action: 'take', minutes: 30, id: 'B2' })).ok, true)
    assert.equal(await state('B2'), 'in progress')
    assert.equal((await as('Main')({ action: 'report', id: 'B2', result: 'The queue is tidy.' })).ok, true)
    assert.equal(await state('B2'), 'review')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
