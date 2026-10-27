// T9.1.1: the result check is filed by the worker that holds the step's Quality Assurance task, and filing it ends the task.
// Refused for a builder, another worker, the Advisor and the main chat; the Advisor still re-checks a goal. A failed point still
// makes a fix step; the fix later gets its own QA task. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { valueOf } from '../../src/work/item.mjs'
import { openQaTaskOf } from '../../src/work/qaTask.mjs'
import { queueFor } from '../queueFor.mjs'
import { NOW, fileCheck, fresh, item, items, openQa, qaOf, remove, reported, takeQa } from '../qaKit.mjs'

const POINTS = ['pass: a lamp at every bench', 'pass: warm yellow light, never white']
const CHECK = { evidence: 'pictures/b2/evidence.png', points: POINTS, score: '82 of 75' }
const history = one => one.sections.get('History')

test('the holder files the check: the step gets its Checked section and the QA task is done, with the check in its History', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qa = await qaOf(store, id)
    const filed = await fileCheck(store, id, CHECK)
    assert.equal(filed.ok, true, filed.why)
    assert.equal(filed.result.qaDone, qa)
    const step = await item(store.dir, id)
    assert.equal(valueOf(step, 'State'), 'done')
    assert.deepEqual(step.sections.get('Checked'), ['Evidence: pictures/b2/evidence.png', 'Score: 82 of 75', '- pass: a lamp at every bench', '- pass: warm yellow light, never white'])
    assert.ok(history(step).some(one => one.endsWith('Checker: result check passed: 2 of 2 points pass, score 82 of 75')))
    const task = await item(store.dir, qa)
    assert.equal(valueOf(task, 'State'), 'done')
    const lines = history(task)
    assert.ok(lines.some(one => one.endsWith(`Checker: checked ${id}: 2 of 2 points pass, score 82 of 75`)), lines.join('\n'))
    assert.ok(lines.some(one => one.endsWith('Checker: in progress → review')))
    assert.ok(lines.at(-1).endsWith('server: review → done'))
    // The worker is free as after any step: nothing is its own now.
    const next = await store.checker({ action: 'next' })
    assert.match(next.result.text, /^Nothing is yours, Checker/)
    assert.equal(await openQa(store.dir, id), null)
  } finally {
    await remove(store.dir)
  }
})

test('a builder, another worker, the Advisor and the main chat are refused, each with the line naming the task and its worker', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qa = await qaOf(store, id)
    await takeQa(store, qa)
    const refused = async (who, body = CHECK) => store[who]({ action: 'checked', id, ...body })
    const builder = await refused('lamplighter')
    assert.deepEqual([builder.ok, builder.status], [false, 403])
    assert.equal(builder.why, `${id} is checked by its QA task ${qa} (Checker): only its worker files the check; Lamplighter built ${id}.`)
    const spare = await refused('spare')
    assert.deepEqual([spare.ok, spare.status], [false, 403])
    assert.equal(spare.why, `${id} is checked by its QA task ${qa} (Checker): only its worker files the check.`)
    const partner = await refused('partner')
    assert.deepEqual([partner.ok, partner.status], [false, 403])
    assert.match(partner.why, new RegExp(`^${id} is checked by its QA task ${qa} \\(Checker\\)`))
    const main = await refused('keeper')
    assert.equal(main.ok, false)
    const person = await store.person({ action: 'checked', id, ...CHECK })
    assert.equal(person.ok, false)
    // Nothing was filed, and the holder still can.
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
    assert.equal((await refused('checker')).ok, true)
  } finally {
    await remove(store.dir)
  }
})

test('a QA task given but not taken yet cannot file: take it first; a step with no QA task yet says the board makes one', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qa = await qaOf(store, id)
    assert.equal((await queueFor(store.dir, qa, 'Checker', { now: NOW + 60_000 })).ok, true)
    const early = await store.checker({ action: 'checked', id, ...CHECK })
    assert.deepEqual([early.ok, early.status], [false, 409])
    assert.match(early.why, new RegExp(`^${qa} is queued: take it first`))
    // The person drops the task: nobody holds a check any more, until the board makes one again.
    assert.equal((await store.person({ action: 'drop', id: qa, why: 'test' })).ok, true)
    const none = await store.checker({ action: 'checked', id, ...CHECK })
    assert.deepEqual([none.ok, none.status], [false, 403])
    assert.match(none.why, new RegExp(`^${id} has no QA task yet: the board makes one`))
  } finally {
    await remove(store.dir)
  }
})

test('a QA task is no step to check: its own check is refused, naming the step it checks', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qa = await qaOf(store, id)
    await takeQa(store, qa)
    const own = await store.checker({ action: 'checked', id: qa, ...CHECK })
    assert.deepEqual([own.ok, own.status], [false, 409])
    assert.match(own.why, new RegExp(`${qa} is a Quality Assurance task.*work checked ${id}`))
  } finally {
    await remove(store.dir)
  }
})

test('a failed point still makes the fix step and still ends the QA task; the fix later gets its own QA task', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qa = await qaOf(store, id)
    const filed = await fileCheck(store, id, { evidence: 'pictures/b2/evidence.png', points: ['pass: a lamp at every bench', 'fail: warm yellow light, never white (two lamps are white)'], score: '61 of 75' })
    assert.equal(filed.ok, true, filed.why)
    const fixId = filed.result.fix
    assert.match(fixId, /^B\d+$/)
    assert.equal(filed.result.qaDone, qa)
    assert.equal(valueOf(await item(store.dir, qa), 'State'), 'done')
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
    // The builder fixes it; its board check passes; the fix waits for its own check: a new QA task, for the fix.
    await queueFor(store.dir, fixId, 'Lamplighter', { now: NOW + 60_000 })
    await store.lamplighter({ action: 'take', id: fixId, branch: 'b-fix-lamps' })
    await store.lamplighter({ action: 'report', id: fixId, result: 'All lamps are warm yellow.', merged: 'beef123' })
    const git = await store.server({ action: 'check', id: fixId, passed: true, lines: ['branch gone'] })
    const fixQa = await item(store.dir, git.result.qa)
    assert.equal(valueOf(fixQa, 'Checks'), fixId)
    assert.equal(valueOf(fixQa, 'Not by'), 'Lamplighter')
    // Its holder files it; both close.
    const fixed = await fileCheck(store, fixId, { evidence: 'pictures/fix/evidence.png', points: ['pass: the two lamps are yellow', 'pass: warm yellow light, never white'] }, { worker: 'Spare', chat: 'spare' })
    assert.equal(fixed.ok, true, fixed.why)
    assert.equal(valueOf(await item(store.dir, fixId), 'State'), 'done')
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'done')
  } finally {
    await remove(store.dir)
  }
})

test('a point only the person can judge ends the task and leaves the step in review; once answered it is checked again by a new task', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const first = await qaOf(store, id)
    const filed = await fileCheck(store, id, { evidence: 'x.png', points: ['pass: a lamp at every bench', 'ask: is the yellow warm enough?'] })
    assert.equal(filed.ok, true, filed.why)
    assert.equal(valueOf(await item(store.dir, first), 'State'), 'done')
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
    // While it waits for the person nothing is made; the answer the board cannot read makes the new task, with their words.
    assert.equal(await openQa(store.dir, id), null)
    const asked = await store.checker({ action: 'ask', of: id, kind: 'look', blocking: false, title: 'Is the yellow warm enough?', text: 'Look at the picture.' })
    assert.equal(asked.ok, true, asked.why)
    assert.equal(await openQa(store.dir, id), null)
    assert.equal((await store.server({ action: 'qa-task', id })).ok, false, 'its ask point is open: it waits for the person, no check')
    const answered = await store.person({ action: 'answer', id: asked.result.id, text: 'Warm, but make it a bit more orange' })
    assert.equal(answered.ok, true, answered.why)
    const second = await item(store.dir, answered.result.qa)
    assert.notEqual(valueOf(second, 'Id'), first)
    assert.equal(valueOf(second, 'Checks'), id)
    assert.equal(valueOf(second, 'State'), 'refined')
    const context = second.sections.get('Context').map(one => one.trim())
    assert.ok(context.includes('Why: its ask point is answered: file its check again'), context.join('\n'))
    assert.ok(context.includes('The person said: Warm, but make it a bit more orange'))
    // Never two open at once: the repair's own call finds it.
    const again = await store.server({ action: 'qa-task', id })
    assert.deepEqual([again.result.id, again.result.made], [valueOf(second, 'Id'), false])
    assert.equal([...(await items(store.dir)).values()].filter(one => valueOf(one, 'Checks') === id && valueOf(one, 'State') !== 'done').length, 1)
  } finally {
    await remove(store.dir)
  }
})

test('the board\'s own filing (the role server) is allowed and drops the step\'s open QA task, whose check it made needless', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qa = await qaOf(store, id)
    const filed = await store.server({ action: 'checked', id, ...CHECK })
    assert.equal(filed.ok, true, filed.why)
    assert.equal(filed.result.qaDone, undefined)
    const task = await item(store.dir, qa)
    assert.equal(valueOf(task, 'State'), 'dropped')
    assert.ok(history(task).some(one => one.includes('server: ') && one.includes('→ dropped')))
    assert.ok(task.sections.get('Context').some(one => /Dropped by the board on .*: its check was filed by the board: 2 of 2 points pass/.test(one.trim())))
  } finally {
    await remove(store.dir)
  }
})

test('the Advisor still re-checks a goal; a worker does not', async () => {
  const store = await fresh()
  try {
    const partner = await store.partner({ action: 'checked', id: 'G3', evidence: 'x.png', points: ['pass: a point'] })
    // No goal map on this test board: the call got past the role gate to the goal's own check.
    assert.deepEqual([partner.ok, partner.status], [false, 409])
    assert.match(partner.why, /no goal map/)
    const worker = await store.checker({ action: 'checked', id: 'G3', evidence: 'x.png', points: ['pass: a point'] })
    assert.deepEqual([worker.ok, worker.status], [false, 403])
    assert.match(worker.why, /Only the partner re-checks a goal/)
  } finally {
    await remove(store.dir)
  }
})

test('a QA task\'s holder is a worker on a step in progress: its checkpoint and its next need no branch', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qa = await qaOf(store, id)
    await takeQa(store, qa)
    const held = await item(store.dir, qa)
    assert.equal(valueOf(held, 'State'), 'in progress')
    assert.equal(valueOf(held, 'Branch'), null)
    const checkpoint = await store.checker({ action: 'step', id: qa, commit: 'none', next: `compare the lamps with the points of ${id}` })
    assert.equal(checkpoint.ok, true, checkpoint.why)
    assert.match(valueOf(await item(store.dir, qa), 'Checkpoint'), /^none · compare the lamps/)
    // Its next names the step it checks, its agreed points and the job's place.
    const next = await store.checker({ action: 'next' })
    assert.match(next.result.text, /^Yours, Checker:\n- B\d+ in progress: Quality Assurance: B2 Light the garden lamps/)
    assert.match(next.result.text, /Quality Assurance task: check B2 "Light the garden lamps" \(review\) against its agreed points and its standard\. Read roles\/worker\.md, "A Quality Assurance task"; you file the check with work checked B2; you never work report this task\./)
    assert.match(next.result.text, /Agreed points:\n- a lamp at every bench\n- warm yellow light, never white\n- Not in it: new paths/)
    assert.match(next.result.text, /\nBuilt by: Lamplighter$/)
    // It cannot be reported: its check is the way out.
    const report = await store.checker({ action: 'report', id: qa, result: 'Checked.', merged: '' })
    assert.deepEqual([report.ok, report.status], [false, 409])
    assert.match(report.why, new RegExp(`${qa} is a Quality Assurance task: file work checked ${id}, never a report`))
    assert.equal(valueOf(openQaTaskOf(await items(store.dir), id), 'State'), 'in progress')
  } finally {
    await remove(store.dir)
  }
})
