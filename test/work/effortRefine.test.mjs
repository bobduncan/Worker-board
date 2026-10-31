// B468: the partner gives a step its effort at the refine; the store keeps it under the step and in the refine block, the
// step's window reads it, and a step refined without one counts as medium. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { refinedOf } from '../../src/backlog.mjs'
import { workApi } from '../../src/work/api.mjs'
import { effortOf } from '../../src/work/effort.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { itemOfStep } from '../../src/work/read.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 21, 9, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B7 A hedge along the river path', '- [ ] B8 A gate at the river', ''].join('\n')
const ROLES = { Main: 'main', Advisor: 'advisor' }
const QUESTION = 'Should the hedge be yew? 40 plants in two rows. Advised: yes, it keeps the sheep out'

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'effort-refine-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set() }
  const item = async id => (await readStore(dir)).items.get(id)
  return { dir, item, advisor: body => workApi({ chat: 'Advisor', ...body }, ctx), person: body => workApi(body, { ...ctx, as: 'person' }) }
}

test('the effort given at the refine stands under the step and in its block, and stays for the ready block', async () => {
  const { dir, item, advisor } = await fresh()
  try {
    const done = await advisor({ action: 'refine', id: 'B7', summary: 'A yew hedge.', size: '1 h', effort: 'low: a text fix in one file' })
    assert.equal(done.ok, true, done.why)
    let step = await item('B7')
    assert.deepEqual(step.sections.get('Effort'), ['low · a text fix in one file'])
    assert.ok(step.sections.get('Refined').some(one => one.trim() === 'Effort: low · a text fix in one file'))
    assert.deepEqual(effortOf(step), { level: 'low', why: 'a text fix in one file', isSet: true })
    // A second round without one keeps it, in the block too.
    assert.equal((await advisor({ action: 'refine', id: 'B7', summary: 'A yew hedge, closer.', size: '1 h' })).ok, true)
    step = await item('B7')
    assert.ok(step.sections.get('Refined').some(one => one.trim() === 'Effort: low · a text fix in one file'))
    // The ready block keeps it once, after the size, before What we build.
    assert.equal((await advisor({ action: 'refined', size: '30 min', id: 'B7', what: ['A yew hedge in two rows'] })).ok, true)
    step = await item('B7')
    const block = step.sections.get('Refined').map(one => one.trim())
    assert.deepEqual(block.filter(one => one.startsWith('Effort:')), ['Effort: low · a text fix in one file'])
    assert.ok(block.indexOf('Effort: low · a text fix in one file') < block.indexOf('What we build:'))
    assert.equal(refinedOf(step.sections.get('Refined')).effort, 'low · a text fix in one file')
    // Given anew at the ready block, it takes the earlier one's place.
    assert.equal((await advisor({ action: 'refined', size: '30 min', id: 'B7', what: ['A yew hedge in two rows'], effort: 'high · it touches many parts' })).ok, true)
    step = await item('B7')
    assert.deepEqual(step.sections.get('Effort'), ['high · it touches many parts'])
    assert.deepEqual(step.sections.get('Refined').map(one => one.trim()).filter(one => one.startsWith('Effort:')), ['Effort: high · it touches many parts'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an effort the board cannot read is refused before anything is written', async () => {
  const { dir, item, advisor } = await fresh()
  try {
    const before = await item('B7')
    const wrong = await advisor({ action: 'refine', id: 'B7', summary: 'A yew hedge.', effort: 'quick: it is small' })
    assert.equal(wrong.status, 400)
    assert.match(wrong.why, /starts with its level, low, medium, high, xhigh, max/)
    assert.match((await advisor({ action: 'refine', id: 'B7', summary: 'A yew hedge.', effort: 'medium' })).why, /reason after its level/)
    assert.deepEqual(await item('B7'), before)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a work tool without the field gives it as a line of the questions or of what', async () => {
  const { dir, item, advisor, person } = await fresh()
  try {
    const done = await advisor({ action: 'refine', id: 'B7', summary: 'A yew hedge.', questions: ['Effort: medium · a board fix', QUESTION] })
    assert.equal(done.ok, true, done.why)
    // The line is the effort, no question: one ask only.
    assert.equal(done.result.asks.length, 1)
    assert.deepEqual((await item('B7')).sections.get('Effort'), ['medium · a board fix'])
    assert.equal((await person({ action: 'answer', id: done.result.asks[0], text: 'yes' })).ok, true)
    assert.equal((await advisor({ action: 'refined', size: '30 min', id: 'B7', what: ['A yew hedge', 'Effort: xhigh: an unclear design'] })).ok, true)
    const step = await item('B7')
    assert.deepEqual(step.sections.get('Effort'), ['xhigh · an unclear design'])
    assert.deepEqual(step.sections.get('What we build'), ['- A yew hedge'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a step refined without one counts as medium in its window; a step made from the how carries its own', async () => {
  const { dir, advisor } = await fresh()
  try {
    assert.equal((await advisor({ action: 'refine', id: 'B8', summary: 'A gate.' })).ok, true)
    const store = { ok: true, ...(await readStore(dir)) }
    assert.deepEqual(itemOfStep(store, 'B8').effort, { level: 'medium', why: null, isSet: false })
    assert.deepEqual([itemOfStep(store, 'B8').owner, itemOfStep(store, 'B8').state], [null, 'new'])
    const made = await advisor({ action: 'new', title: 'Plant the yew hedge', activity: 'Garden', goal: 'G3', summary: 'The hedge, planted.', size: '1 h', what: ['Two rows of yew'], effort: 'high · new art for the hedge' })
    assert.equal(made.ok, true, made.why)
    const step = (await readStore(dir)).items.get(made.result.id)
    assert.deepEqual(step.sections.get('Effort'), ['high · new art for the hedge'])
    assert.ok(step.sections.get('Refined').some(one => one.trim() === 'Effort: high · new art for the hedge'))
    assert.equal((await advisor({ action: 'new', title: 'Paint the gate', activity: 'Garden', effort: 'loud: x' })).status, 400)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
