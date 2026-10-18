// B309: a step's asks count as its refine questions in the work API too: `refined` is refused while any ask under the
// step is open (not only the refine's own), naming them; a queue asked before the refine waits for them, and for the
// Advisor's round that folds their answers in. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const BACKLOG = [
  '# Backlog',
  '',
  '## Kite work',
  '- [ ] B1 Paint the kite tail (for Kite; about 1 h)',
  '- [ ] B3 Tie the kite string',
  '',
].join('\n')
const ROLES = { Lead: 'main', Kite: 'worker', Oracle: 'advisor' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-asks-questions-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Kite']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, lead: as('Lead'), kite: as('Kite'), oracle: as('Oracle'), person: body => workApi(body, { ...ctx, as: 'person' }), server: body => workApi(body, { ...ctx, as: 'server' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const state = async (dir, id) => valueOf(await item(dir, id), 'State')

test('refined is refused while an ask under the step is open, also one its worker filed, naming it', async () => {
  const { dir, kite, oracle, person } = await fresh()
  try {
    const asked = await kite({ action: 'ask', of: 'B3', kind: 'decide', blocking: true, text: 'Red string or blue?' })
    assert.equal(asked.ok, true, asked.why)
    assert.equal((await oracle({ action: 'refine', id: 'B3', summary: 'One knot per kite.' })).ok, true)
    // The refine had no questions of its own; the worker's ask stays open (only the refine's own are replaced).
    assert.equal(await state(dir, 'Q1'), 'open')
    const refused = await oracle({ action: 'refined', id: 'B3', what: ['the knot'] })
    assert.equal(refused.ok, false)
    assert.equal(refused.why, 'B3: Q1 ("Red string or blue?") is still open: the person answers first.')
    assert.equal((await person({ action: 'answer', id: 'Q1', text: 'Blue.' })).ok, true)
    const refined = await oracle({ action: 'refined', id: 'B3', what: ['the knot', 'a blue string'] })
    assert.equal(refined.ok, true, refined.why)
    assert.equal(await state(dir, 'B3'), 'refined')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a queue asked before the refine waits for the step\'s open asks, then is carried out at the refine', async () => {
  const { dir, lead, kite, oracle, person } = await fresh()
  try {
    assert.equal((await kite({ action: 'ask', of: 'B3', kind: 'decide', text: 'Red string or blue?' })).ok, true)
    const asked = await lead({ action: 'queue', id: 'B3', for: 'Kite' })
    assert.equal(asked.ok, true, asked.why)
    assert.equal(valueOf(await item(dir, 'B3'), 'Queue when refined'), 'for Kite')
    await oracle({ action: 'refine', id: 'B3', summary: 'One knot per kite.' })
    await person({ action: 'answer', id: 'Q1', text: 'Blue.' })
    assert.equal((await oracle({ action: 'refined', id: 'B3', what: ['the knot'] })).ok, true)
    const three = await item(dir, 'B3')
    assert.deepEqual(['State', 'Owner', 'Queue when refined'].map(key => valueOf(three, key)), ['queued', 'Kite', null])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a refined step with an ask filed after its refine: Main\'s queue waits as a wish, the board queues it only after the fold', async () => {
  const { dir, lead, kite, oracle, person, server } = await fresh()
  try {
    await oracle({ action: 'refine', id: 'B3', summary: 'One knot per kite.' })
    assert.equal((await oracle({ action: 'refined', id: 'B3', what: ['the knot'] })).ok, true)
    assert.equal(await state(dir, 'B3'), 'refined')
    assert.equal((await kite({ action: 'ask', of: 'B3', kind: 'decide', text: 'Red string or blue?' })).ok, true)

    const queued = await lead({ action: 'queue', id: 'B3', for: 'Kite' })
    assert.equal(queued.ok, true, queued.why)
    assert.match(queued.result.text, /^B3 waits for Q1: the person answers, the Advisor folds it in, then the board queues it for Kite by itself\.$/)
    let three = await item(dir, 'B3')
    assert.deepEqual(['State', 'Queue when refined'].map(key => valueOf(three, key)), ['refined', 'for Kite'])

    // The board's own queue waits while the ask is open, and while its answer waits for the Advisor's round.
    assert.equal((await server({ action: 'advance', id: 'B3', to: 'queued' })).ok, false)
    await person({ action: 'answer', id: 'Q1', text: 'Blue.' })
    assert.equal((await server({ action: 'advance', id: 'B3', to: 'queued' })).ok, false)
    assert.equal(await state(dir, 'B3'), 'refined')

    assert.equal((await oracle({ action: 'refined', id: 'B3', what: ['the knot', 'a blue string'] })).ok, true)
    three = await item(dir, 'B3')
    assert.deepEqual(['State', 'Owner', 'Queue when refined'].map(key => valueOf(three, key)), ['queued', 'Kite', null])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a refined step whose asks are all answered and folded in is queued at once, as before', async () => {
  const { dir, lead, kite, oracle, person } = await fresh()
  try {
    assert.equal((await kite({ action: 'ask', of: 'B3', kind: 'decide', text: 'Red string or blue?' })).ok, true)
    await person({ action: 'answer', id: 'Q1', text: 'Blue.' })
    await oracle({ action: 'refine', id: 'B3', summary: 'One knot per kite, blue.' })
    assert.equal((await oracle({ action: 'refined', id: 'B3', what: ['the knot'] })).ok, true)
    assert.equal((await lead({ action: 'queue', id: 'B3', for: 'Kite' })).ok, true)
    assert.equal(await state(dir, 'B3'), 'queued')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
