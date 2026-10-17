// B304: a failed check can be run again: the person's "Check again" (the action `recheck`) and the owner's report from
// review (the flow's move review → review). Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const BACKLOG = ['# Backlog', '', '## Lamps', '- [ ] B1 Light the lamps (for Lamplighter; about 1 h)', '- [ ] B2 Trim the wicks (for Lamplighter; about 1 h)', ''].join('\n')
const ROLES = { Keeper: 'main', Lamplighter: 'worker', Sweeper: 'worker' }

async function fresh(flow = null) {
  const dir = await mkdtemp(join(tmpdir(), 'work-recheck-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  if (flow !== null) await writeFile(join(dir, 'flow.json'), JSON.stringify(flow))
  const ctx = { dir, now: NOW + 60_000, prefix: '', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Lamplighter', 'Sweeper']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, lamplighter: as('Lamplighter'), sweeper: as('Sweeper'), keeper: as('Keeper'), person: body => workApi(body, { ...ctx, as: 'person' }), server: body => workApi(body, { ...ctx, as: 'server' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const history = async (dir, id) => (await item(dir, id)).sections.get('History')

/** B1 reported, and the board's check of it failed. */
async function failedCheck(flow) {
  const store = await fresh(flow)
  await store.lamplighter({ action: 'take', id: 'B1', branch: 'b1-lamps' })
  const reported = await store.lamplighter({ action: 'report', id: 'B1', result: 'The lamps glow.', merged: 'c0ffee1' })
  assert.deepEqual(reported.result.check, { id: 'B1', branch: 'b1-lamps', result: 'The lamps glow.', merged: 'c0ffee1' })
  await store.server({ action: 'check', id: 'B1', passed: false, lines: ['main of lantern is not the same as origin/main'] })
  return store
}

test('the person\'s "Check again" runs the check anew with what the report said', async () => {
  const { dir, person, lamplighter } = await failedCheck()
  try {
    assert.equal((await lamplighter({ action: 'recheck', id: 'B1' })).status, 403)
    const again = await person({ action: 'recheck', id: 'B1' })
    assert.equal(again.ok, true, again.why)
    assert.deepEqual(again.result.check, { id: 'B1', branch: 'b1-lamps', result: 'The lamps glow.', merged: 'c0ffee1' })
    assert.equal(valueOf(await item(dir, 'B1'), 'State'), 'review')
    assert.deepEqual((await history(dir, 'B1')).slice(-2), ['- 2026-10-17 11:06 person: check asked again', '- 2026-10-17 11:06 server: check pending'])
    // Only a step in review is checked again.
    assert.deepEqual(await person({ action: 'recheck', id: 'B2' }), { ok: false, status: 409, why: 'B2 is queued: only a step in review is checked again.' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the owner\'s report from review runs the check again (the flow\'s move review → review)', async () => {
  const { dir, lamplighter, sweeper } = await failedCheck()
  try {
    assert.equal((await sweeper({ action: 'report', id: 'B1', result: 'x' })).status, 409)
    const again = await lamplighter({ action: 'report', id: 'B1', result: 'The lamps glow, all of them.' })
    assert.equal(again.ok, true, again.why)
    // No merged commit named this time: the one reported before still counts.
    assert.deepEqual(again.result.check, { id: 'B1', branch: 'b1-lamps', result: 'The lamps glow, all of them.', merged: 'c0ffee1' })
    assert.equal(valueOf(await item(dir, 'B1'), 'State'), 'review')
    assert.deepEqual((await history(dir, 'B1')).slice(-2), ['- 2026-10-17 11:06 Lamplighter: reported again', '- 2026-10-17 11:06 server: check pending'])
    assert.equal((await item(dir, 'B1')).sections.get('Context').at(-1), '  Reported again by Lamplighter on 2026-10-17 at 11:06: The lamps glow, all of them.')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a flow without the move review → review refuses a report from review, in the flow\'s words', async () => {
  const flow = { step: { ...DEFAULT_FLOW.step, moves: DEFAULT_FLOW.step.moves.filter(move => !(move.from === 'review' && move.to === 'review')) } }
  const { dir, lamplighter } = await failedCheck(flow)
  try {
    assert.deepEqual(await lamplighter({ action: 'report', id: 'B1', result: 'x' }), { ok: false, status: 409, why: 'B1: no move from review to review (flow.json)' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
