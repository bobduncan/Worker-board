// Model per step: the partner gives a step its model at the refine, with its effort; the store keeps it under the step
// and in the refine block, the step's window reads it, a step refined without one counts as sonnet, and a fix step made
// by a failed result check runs on the model of the step it fixes. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { refinedOf } from '../../src/backlog.mjs'
import { workApi } from '../../src/work/api.mjs'
import { queueFor } from '../queueFor.mjs'
import { modelOf } from '../../src/work/effort.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { itemOfStep } from '../../src/work/read.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 23, 9, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B7 A hedge along the river path', '- [ ] B8 A gate at the river', ''].join('\n')
const ROLES = { Main: 'main', Advisor: 'advisor', Digger: 'worker' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'model-refine-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Digger']) }
  const item = async id => (await readStore(dir)).items.get(id)
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, item, advisor: as('Advisor'), main: as('Main'), digger: as('Digger'), server: body => workApi(body, { ...ctx, as: 'server' }) }
}

test('the model given at the refine stands under the step and in its block, before the effort, and stays for the ready block', async () => {
  const { dir, item, advisor } = await fresh()
  try {
    const done = await advisor({ action: 'refine', id: 'B7', summary: 'A yew hedge.', size: '1 h', model: 'opus: a guard of the work store', effort: 'medium: one rule' })
    assert.equal(done.ok, true, done.why)
    let step = await item('B7')
    assert.deepEqual(step.sections.get('Model'), ['opus · a guard of the work store'])
    let block = step.sections.get('Refined').map(one => one.trim())
    assert.ok(block.indexOf('Model: opus · a guard of the work store') >= 0 && block.indexOf('Model: opus · a guard of the work store') < block.indexOf('Effort: medium · one rule'), block.join('\n'))
    assert.deepEqual(modelOf(step), { family: 'opus', why: 'a guard of the work store', isSet: true })
    assert.equal(refinedOf(step.sections.get('Refined')).model, 'opus · a guard of the work store')
    // A second round without one keeps it.
    assert.equal((await advisor({ action: 'refine', id: 'B7', summary: 'A yew hedge, closer.', size: '1 h' })).ok, true)
    assert.ok((await item('B7')).sections.get('Refined').some(one => one.trim() === 'Model: opus · a guard of the work store'))
    // The ready block keeps it once, before the effort and What we build.
    assert.equal((await advisor({ action: 'refined', id: 'B7', what: ['A yew hedge in two rows'] })).ok, true)
    step = await item('B7')
    block = step.sections.get('Refined').map(one => one.trim())
    assert.deepEqual(block.filter(one => one.startsWith('Model:')), ['Model: opus · a guard of the work store'])
    assert.ok(block.indexOf('Model: opus · a guard of the work store') < block.indexOf('Effort: medium · one rule'))
    assert.ok(block.indexOf('Effort: medium · one rule') < block.indexOf('What we build:'))
    // Given anew at the ready block, it takes the earlier one's place.
    assert.equal((await advisor({ action: 'refined', id: 'B7', what: ['A yew hedge in two rows'], model: 'sonnet · a plain feature after all' })).ok, true)
    step = await item('B7')
    assert.deepEqual(step.sections.get('Model'), ['sonnet · a plain feature after all'])
    assert.deepEqual(step.sections.get('Refined').map(one => one.trim()).filter(one => one.startsWith('Model:')), ['Model: sonnet · a plain feature after all'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a model the board cannot read is refused before anything is written; a work tool without the field gives it as a line', async () => {
  const { dir, item, advisor } = await fresh()
  try {
    const before = await item('B7')
    const wrong = await advisor({ action: 'refine', id: 'B7', summary: 'A yew hedge.', model: 'haiku: it is small' })
    assert.equal(wrong.status, 400)
    assert.match(wrong.why, /starts with its family, sonnet or opus/)
    assert.match((await advisor({ action: 'refine', id: 'B7', summary: 'A yew hedge.', model: 'opus' })).why, /reason after its family/)
    assert.deepEqual(await item('B7'), before)
    const done = await advisor({ action: 'refine', id: 'B7', summary: 'A yew hedge.', questions: ['Model: opus · an unclear bug, seen twice', 'Effort: medium · a board fix'] })
    assert.equal(done.ok, true, done.why)
    const step = await item('B7')
    assert.deepEqual([step.sections.get('Model'), step.sections.get('Effort')], [['opus · an unclear bug, seen twice'], ['medium · a board fix']])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a step refined without one counts as sonnet in its window; a step made from the how carries its own', async () => {
  const { dir, advisor } = await fresh()
  try {
    assert.equal((await advisor({ action: 'refine', id: 'B8', summary: 'A gate.' })).ok, true)
    const store = { ok: true, ...(await readStore(dir)) }
    assert.deepEqual(itemOfStep(store, 'B8').model, { family: 'sonnet', why: null, isSet: false })
    const made = await advisor({ action: 'new', title: 'Plant the yew hedge', activity: 'Garden', goal: 'G3', summary: 'The hedge, planted.', what: ['Two rows of yew'], model: 'opus · art direction for the hedge', effort: 'high · new art' })
    assert.equal(made.ok, true, made.why)
    const step = (await readStore(dir)).items.get(made.result.id)
    assert.deepEqual(step.sections.get('Model'), ['opus · art direction for the hedge'])
    assert.ok(step.sections.get('Refined').some(one => one.trim() === 'Model: opus · art direction for the hedge'))
    assert.equal((await advisor({ action: 'new', title: 'Paint the gate', activity: 'Garden', model: 'gpt: x' })).status, 400)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a fix step from a failed result check runs on the model of the step it fixes', async () => {
  const store = await fresh()
  try {
    const made = await store.advisor({ action: 'new', title: 'Guard the gate', activity: 'Garden', goal: 'G3', summary: 'A guard.', what: ['a lock on the gate', 'Not in it: a fence'], model: 'opus · a guard of the store', effort: 'high · many parts' })
    assert.equal(made.ok, true, made.why)
    const id = made.result.id
    assert.equal((await queueFor(store.dir, id, 'Digger', { now: NOW + 60_000 })).ok, true)
    assert.equal((await store.digger({ action: 'take', id, branch: 'gate' })).ok, true)
    assert.equal((await store.digger({ action: 'report', id, result: 'A lock on the gate.', merged: 'c0ffee1' })).ok, true)
    assert.equal((await store.server({ action: 'check', id, passed: true, lines: ['work in garden'] })).ok, true)
    const checked = await store.advisor({ action: 'checked', id, evidence: 'none (nothing to see)', points: ['fail: a lock on the gate (it opens without a key)'] })
    assert.equal(checked.ok, true, checked.why)
    const fix = await store.item(checked.result.fix)
    assert.deepEqual(fix.sections.get('Model'), ['opus · a guard of the store'])
    assert.ok(fix.sections.get('Refined').some(one => one.trim() === 'Model: opus · a guard of the store'))
  } finally {
    await rm(store.dir, { recursive: true, force: true })
  }
})
