// T9.1.1: where the board asked the Advisor for a result check ("check step"), it makes a Quality Assurance task now: when
// the board's own check of a report passes and the step needs a result check, and when a fix's check leaves the step it
// fixes in review. No word goes to the Advisor; a board with no partner keeps "its own check closes the step". Made-up
// samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { valueOf } from '../../src/work/item.mjs'
import { queueFor } from '../queueFor.mjs'
import { NOW, fresh, item, items, remove, reported } from '../qaKit.mjs'

const qaTasksOf = async (dir, id) => [...(await items(dir)).values()].filter(one => valueOf(one, 'Checks') === id)

test('a report whose board check passes and which needs a result check gets one QA task, and the check names it, not a word to the Advisor', async () => {
  const store = await fresh()
  try {
    const { id, git } = await reported(store)
    const [qa] = await qaTasksOf(store.dir, id)
    assert.equal(valueOf(qa, 'Title'), 'Quality Assurance: B2 Light the garden lamps')
    assert.equal(valueOf(qa, 'State'), 'refined')
    assert.equal(git.result.qa, valueOf(qa, 'Id'))
    assert.equal(git.result.resultCheck, undefined)
    assert.equal((await qaTasksOf(store.dir, id)).length, 1)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
  } finally {
    await remove(store.dir)
  }
})

test('a step that needs no result check, or whose board check failed, gets no QA task', async () => {
  const store = await fresh()
  try {
    await store.lamplighter({ action: 'take', id: 'B1', branch: 'b1-wicks' })
    await store.lamplighter({ action: 'report', id: 'B1', result: 'The wicks are trimmed.', merged: 'abc1234' })
    const plain = await store.server({ action: 'check', id: 'B1', passed: true, lines: ['branch gone'] })
    assert.equal(plain.result.qa, undefined)
    assert.equal(valueOf(await item(store.dir, 'B1'), 'State'), 'done')
    const failed = await reported(store, { gitPassed: false })
    assert.equal(failed.git.result.qa, undefined)
    assert.equal((await qaTasksOf(store.dir, failed.id)).length, 0)
  } finally {
    await remove(store.dir)
  }
})

test('a board with no partner makes no QA task: its own check closes the step as before', async () => {
  const store = await fresh({ hasPartner: false })
  try {
    const { id, git } = await reported(store)
    assert.equal(git.result.qa, undefined)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'done')
    assert.equal((await qaTasksOf(store.dir, id)).length, 0)
  } finally {
    await remove(store.dir)
  }
})

test('the check path and the board\'s repair in one minute make one task: the second finds the first open', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const [first] = await qaTasksOf(store.dir, id)
    const again = await store.server({ action: 'qa-task', id })
    assert.deepEqual([again.result.id, again.result.made], [valueOf(first, 'Id'), false])
    // The board's check run again for the same report (stuck check, base equal) asks the same.
    const rechecked = await store.server({ action: 'check', id, passed: true, lines: ['branch gone'] })
    assert.equal(rechecked.result.qa, valueOf(first, 'Id'))
    assert.equal((await qaTasksOf(store.dir, id)).length, 1)
  } finally {
    await remove(store.dir)
  }
})

test('a fix whose check passes and leaves the step it fixes in review (a point for the person) gets that step a QA task again', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    // The first QA task is dropped by the person, so none is open when the fix is done.
    const [first] = await qaTasksOf(store.dir, id)
    assert.equal((await store.person({ action: 'drop', id: valueOf(first, 'Id'), why: 'taken over by the test' })).ok, true)
    const checked = await store.partner({ action: 'checked', id, evidence: 'pictures/b2/evidence.png', points: ['pass: a lamp at every bench', 'fail: warm yellow light, never white (two lamps are white)', 'ask: is the yellow warm enough?'] })
    assert.equal(checked.ok, true, checked.why)
    const fixId = checked.result.fix
    assert.equal(await queueFor(store.dir, fixId, 'Lamplighter', { now: NOW + 60_000 }).then(() => true), true)
    await store.lamplighter({ action: 'take', id: fixId, branch: 'b-fix-lamps' })
    await store.lamplighter({ action: 'report', id: fixId, result: 'All lamps are warm yellow.', merged: 'beef123' })
    const fixChecked = await store.server({ action: 'check', id: fixId, passed: true, lines: ['branch gone'] })
    // The fix has points of its own, so it waits for its own check first.
    const [fixQa] = await qaTasksOf(store.dir, fixId)
    assert.equal(fixChecked.result.qa, valueOf(fixQa, 'Id'))
    assert.equal(valueOf(fixQa, 'Title'), `Quality Assurance: ${fixId} Fix: warm yellow light, never white`)
    const done = await store.partner({ action: 'checked', id: fixId, evidence: 'pictures/fix/evidence.png', points: ['pass: the two lamps are yellow', 'pass: warm yellow light, never white'] })
    assert.equal(done.ok, true, done.why)
    // The step it fixes has a point for the person, so it is not through: it is checked again, by a new QA task.
    const [, again] = (await qaTasksOf(store.dir, id)).sort((a, b) => valueOf(a, 'Id').localeCompare(valueOf(b, 'Id'), 'en', { numeric: true }))
    assert.notEqual(again, undefined)
    assert.equal(done.result.qa, valueOf(again, 'Id'))
    assert.equal(valueOf(again, 'State'), 'refined')
    assert.ok(again.sections.get('Context').some(one => one.trim() === `Why: its fix ${fixId} is done: file its check again`))
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
  } finally {
    await remove(store.dir)
  }
})
