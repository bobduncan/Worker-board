// T9.1.1 (the person, 2026-10-27: "workers do the checks, as long as its a worker who didnt build the task and the task
// title is clear. e.g. B123 Quality Assurance ..."): a result check is a task of the store, "Quality Assurance: B<id>
// <title>", made by the board as it makes a fix step. The pure helpers, then the maker through the work API. Made-up
// samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseItem, valueOf } from '../../src/work/item.mjs'
import { QA_PREFIX, buildersOf, isQaTask, notByOf, openQaTaskOf, qaModelEffort, qaTitle } from '../../src/work/qaTask.mjs'
import { needsResultCheck } from '../../src/work/resultCheck.mjs'
import { readStore } from '../../src/work/store.mjs'
import { fresh, item, items, qaOf, remove, reported } from '../qaKit.mjs'

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Since: '2026-10-27 09:00', ...more }, sections)
const mapOf = list => new Map(list.map(one => [one.head.get('Id'), one]))

test('a task whose head names Checks is a Quality Assurance task; the title is exact and cut to the store\'s limit', () => {
  assert.equal(isQaTask(step('B2', 'refined', { Checks: 'B1' })), true)
  assert.equal(isQaTask(step('B2', 'refined')), false)
  assert.equal(QA_PREFIX, 'Quality Assurance: ')
  assert.equal(qaTitle('B701', 'Show the damage'), 'Quality Assurance: B701 Show the damage')
  assert.equal(qaTitle('B701', `Show ${'the damage '.repeat(40)}`).length, 200)
  assert.deepEqual(notByOf(step('B2', 'refined', { Checks: 'B1', 'Not by': 'Worker 1, Worker 3' })), ['Worker 1', 'Worker 3'])
  assert.deepEqual(notByOf(step('B2', 'refined')), [])
})

test('the open QA task of a step: one with Checks naming it that is not done or dropped; the oldest of two', () => {
  const all = mapOf([
    step('B700', 'review'), step('B701', 'done', { Checks: 'B700' }), step('B702', 'dropped', { Checks: 'B700' }),
    step('B710', 'refined', { Checks: 'B700' }), step('B705', 'in progress', { Checks: 'B700' }), step('B720', 'refined', { Checks: 'B800' }),
  ])
  assert.equal(valueOf(openQaTaskOf(all, 'B700'), 'Id'), 'B705')
  assert.equal(openQaTaskOf(all, 'B701'), null)
  assert.equal(valueOf(openQaTaskOf(all, 'B800'), 'Id'), 'B720')
  // Done and dropped ones alone: none is open.
  assert.equal(openQaTaskOf(mapOf([step('B701', 'done', { Checks: 'B700' }), step('B702', 'dropped', { Checks: 'B700' })]), 'B700'), null)
})

test('the builders of a step: its Owner, then every chat its History says took it; a chat it was only given to built nothing', () => {
  const built = step('B700', 'review', { Owner: 'Worker 3' }, {
    History: [
      '- 2026-10-27 09:00 server: refined → queued (given by the board to Worker 1)',
      '- 2026-10-27 09:02 server: queued → refined (taken back from Worker 1: not taken within 2 min)',
      '- 2026-10-27 09:05 server: refined → queued (given by the board to Worker 2)',
      '- 2026-10-27 09:06 Worker 2: queued → taken',
      '- 2026-10-27 09:06 Worker 2: taken → in progress',
      '- 2026-10-27 09:30 server: in progress → waiting on you (rests for Q5)',
      '- 2026-10-27 09:50 server: queued → taken (for Worker 3)',
      '- 2026-10-27 09:51 Worker 3: taken → in progress',
      '- 2026-10-27 09:52 Worker 3: claimed (in progress)',
      '- 2026-10-27 10:40 Worker 3: in progress → review',
    ],
  })
  assert.deepEqual(buildersOf(built), ['Worker 3', 'Worker 2'])
  // Nobody took it yet: no builder (an unowned step).
  assert.deepEqual(buildersOf(step('B701', 'refined', {}, { History: ['- 2026-10-27 09:00 server: made'] })), [])
  assert.deepEqual(buildersOf(step('B702', 'review', { Owner: 'Worker 1' })), ['Worker 1'])
})

test('model and effort: Opus, high for art judged against a reference or an Opus step; else Sonnet, medium', () => {
  const routine = { model: 'sonnet: a check of routine work', effort: 'medium: a check of routine work' }
  assert.deepEqual(qaModelEffort(step('B700', 'review')), routine)
  assert.deepEqual(qaModelEffort(step('B700', 'review', {}, { Standard: ['none (nothing to see)'] })), routine)
  const art = { model: 'opus: judges art against its reference', effort: 'high: judges art against its reference' }
  assert.deepEqual(qaModelEffort(step('B700', 'review', {}, { Standard: ['Terrain · art-inbox/terrain/ref.png · target 75'] })), art)
  // A refine block's Standard line counts as the section does.
  assert.deepEqual(qaModelEffort(step('B700', 'review', {}, { Refined: ['Refined (2026-10-27 09:00; ready):', 'Standard: Unit · refs/unit.png · target 80'] })), art)
  const opus = { model: 'opus: checks an Opus step', effort: 'high: checks an Opus step' }
  assert.deepEqual(qaModelEffort(step('B700', 'review', {}, { Model: ['opus · the board\'s core'] })), opus)
  // Both: the reference comes first.
  assert.deepEqual(qaModelEffort(step('B700', 'review', {}, { Model: ['opus · x'], Standard: ['Unit · refs/unit.png · target 80'] })), art)
})

test('a QA task needs no result check of its own, whatever its lines say', () => {
  const qa = step('B730', 'refined', { Checks: 'B700' }, { 'What we build': ['- Check B700 against its agreed points and its standard'], Standard: ['Unit · refs/unit.png · target 80'] })
  assert.equal(needsResultCheck(qa), false)
  assert.equal(needsResultCheck(step('B700', 'review', {}, { 'What we build': ['- a point'] })), true)
})

test('qa-task: a step that waits for its check gets one QA task with the exact title, fields and lines', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const made = await store.server({ action: 'qa-task', id })
    assert.equal(made.ok, true, made.why)
    const qa = await item(store.dir, made.result.id)
    assert.equal(valueOf(qa, 'Title'), `Quality Assurance: ${id} Light the garden lamps`)
    assert.deepEqual(['Kind', 'State', 'Refined', 'Checks', 'Not by', 'Activity', 'Goal', 'Owner'].map(key => valueOf(qa, key)), ['step', 'refined', 'ready', id, 'Lamplighter', 'Lamps', 'G3', null])
    assert.deepEqual(qa.sections.get('Model'), ['sonnet · a check of routine work'])
    assert.deepEqual(qa.sections.get('Effort'), ['medium · a check of routine work'])
    assert.deepEqual(qa.sections.get('What we build'), [`- Check ${id} against its agreed points and its standard (roles/worker.md, "A Quality Assurance task")`])
    assert.ok(qa.sections.get('Context').some(one => one.trim() === 'Built by: Lamplighter'))
    assert.ok(qa.sections.get('History').some(one => one.endsWith(`server: made for the result check of ${id}`)))
    // It stands under the checked step's activity.
    assert.ok((await readStore(store.dir)).activities.find(one => one.name === 'Lamps').steps.includes(made.result.id))
    // Its refine block is ready, as a fix step's is.
    assert.equal(qa.sections.get('Refined')[0].trim(), `Refined (2026-10-27 09:01; ready; made by the board for the result check of ${id}):`)
    assert.equal(needsResultCheck(qa), false)
  } finally {
    await remove(store.dir)
  }
})

test('qa-task: the second call makes none and answers the same id; a step checked on its own reads no other task', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const first = await qaOf(store, id)
    const again = await store.server({ action: 'qa-task', id })
    assert.equal(again.ok, true)
    assert.equal(again.result.id, first)
    assert.equal(again.result.made, false)
    const mine = [...(await items(store.dir)).values()].filter(one => valueOf(one, 'Checks') === id)
    assert.equal(mine.length, 1)
  } finally {
    await remove(store.dir)
  }
})

test('qa-task: the context carries why the check is asked again and the board\'s warnings, as the check word did', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store, { warnings: ['the change touches tests (a.test.mjs) but the result names no mutant'] })
    const qa = await item(store.dir, await qaOf(store, id))
    const context = qa.sections.get('Context').map(one => one.trim())
    assert.ok(context.some(one => one.startsWith('Board warnings: the change touches tests')))
    assert.ok(context.some(one => one.startsWith('Demand: the report names no mutant')))
  } finally {
    await remove(store.dir)
  }
})

test('qa-task: refused for a step not in review, a step that waits for no check, and any role but the board', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const plain = await store.server({ action: 'qa-task', id: 'B1' })
    assert.equal(plain.ok, false)
    assert.match(plain.why, /B1/)
    const person = await store.person({ action: 'qa-task', id })
    assert.deepEqual([person.ok, person.status], [false, 403])
    const worker = await store.checker({ action: 'qa-task', id })
    assert.deepEqual([worker.ok, worker.status], [false, 403])
    const partner = await store.partner({ action: 'qa-task', id })
    assert.deepEqual([partner.ok, partner.status], [false, 403])
    // A step whose board check has not passed waits for no result check.
    const failed = await reported(store, { gitPassed: false })
    const notYet = await store.server({ action: 'qa-task', id: failed.id })
    assert.equal(notYet.ok, false)
    assert.equal([...(await items(store.dir)).values()].filter(one => valueOf(one, 'Checks') === failed.id).length, 0)
  } finally {
    await remove(store.dir)
  }
})
