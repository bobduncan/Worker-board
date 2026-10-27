// T9.1.1, the review's fixes (brief 2026-10-27): the checker's ask goes to the person, a second QA task is not made between the
// check and its ask, the builders of a fix chain and a renamed builder stay barred, a pin never reaches a builder, and a QA task
// whose check is saved but whose close failed is ended by the board. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { resultCheckOf, reviewWaitOf } from '../../src/work/resultCheck.mjs'
import { NOW, fileCheck, fresh, item, items, openQa, qaOf, remove, reported, takeQa } from '../qaKit.mjs'

const MIN = 60_000
const ASK_POINT = { evidence: 'none (test)', points: ['pass: a lamp at every bench', 'ask: warm yellow light, never white'] }
const LOOK = { action: 'ask', kind: 'look', title: 'Is the lamp light warm enough?', text: 'Compare with the reference.', advice: 'yes, keep it', options: ['A keep', 'B redo'] }
/** What the step waits for, `ms` after the store's start (the checks of these tests are filed at +60 s). */
const waitOf = async (store, id, ms) => {
  const all = await items(store.dir)
  return reviewWaitOf(all.get(id), all, null, NOW + ms)
}

test('1: an ask the checker files under the step it checked goes to the person, not the partner; a builder\'s ask still goes to the partner first', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qa = await qaOf(store, id)
    // The checker holds the task: a look only the person can judge is theirs at once.
    await takeQa(store, qa)
    const during = await store.checker({ ...LOOK, of: id })
    assert.equal(during.ok, true, during.why)
    assert.equal(during.result.route, undefined)
    assert.equal(valueOf(await item(store.dir, during.result.id), 'Route'), null)
    // After the check is filed (the task done, the worker its former holder) its ask is the person's too.
    const filed = await store.checker({ action: 'checked', id, ...ASK_POINT })
    assert.equal(filed.ok, true, filed.why)
    const after = await store.checker({ ...LOOK, of: id, title: 'Should the paths be gravel or stone?', text: 'Two surfaces were tried by the builder.' })
    assert.equal(after.ok, true, after.why)
    assert.equal(after.result.route, undefined)
    assert.equal(valueOf(await item(store.dir, after.result.id), 'Route'), null)
    assert.match(after.result.text, /\*\*For you\*\*/)
    // The control: the step's own worker asking with advice still goes to the partner first.
    const builder = await store.lamplighter({ ...LOOK, of: id, title: 'Are the benches too close together?', text: 'The spacing reads tight.' })
    assert.equal(builder.ok, true, builder.why)
    assert.equal(builder.result.route, 'partner')
  } finally {
    await remove(store.dir)
  }
})

test('2: between the check with an ask point and the checker\'s ask the step waits for the person: no second QA task is made', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    await qaOf(store, id)
    const filed = await fileCheck(store, id, ASK_POINT)
    assert.equal(filed.ok, true, filed.why)
    assert.equal(resultCheckOf(await item(store.dir, id)), 'waits')
    // The repair's moment: the check is in, the checker's ask is not yet.
    for (const minutes of [1, 10, 29]) {
      const wait = await waitOf(store, id, minutes * MIN + 60_000)
      assert.deepEqual([wait.kind, wait.text], ['answer', 'waits for your answer to its check'], `${minutes} min`)
      const repair = await store.later(minutes * MIN + 60_000)({ action: 'qa-task', id })
      assert.equal(repair.ok, false, `${minutes} min`)
      assert.equal(await openQa(store.dir, id), null, `${minutes} min`)
    }
    // The checker's ask: open, the step waits for the person's answer.
    const asked = await store.checker({ ...LOOK, of: id })
    assert.equal(asked.ok, true, asked.why)
    assert.equal((await waitOf(store, id, 40 * MIN)).kind, 'answer')
    assert.equal(await openQa(store.dir, id), null)
  } finally {
    await remove(store.dir)
  }
})

test('2: with no ask 30 minutes after the check it waits for a check again (nothing wedges); after an answered or a withdrawn ask at once', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    await qaOf(store, id)
    await fileCheck(store, id, ASK_POINT)
    // 31 minutes after the check line (09:01) with still no ask of the step: the checker is gone, the check is due again.
    const late = await waitOf(store, id, 32 * MIN + 60_000)
    assert.deepEqual([late.kind, late.text], ['check', 'waits for its check again'])
    const made = await store.later(32 * MIN + 60_000)({ action: 'qa-task', id })
    assert.equal(made.ok, true, made.why)
    assert.equal(made.result.made, true)
  } finally {
    await remove(store.dir)
  }
  const withdrawn = await fresh()
  try {
    const { id } = await reported(withdrawn)
    await qaOf(withdrawn, id)
    await fileCheck(withdrawn, id, ASK_POINT)
    const asked = await withdrawn.checker({ ...LOOK, of: id })
    assert.equal(asked.ok, true, asked.why)
    // Withdrawn a minute later: an ask of the step was filed since the check line, and it is closed: a check again, at once.
    const gone = await withdrawn.later(2 * MIN, 'Checker')({ action: 'withdraw', id: asked.result.id })
    assert.equal(gone.ok, true, gone.why)
    const wait = await waitOf(withdrawn, id, 3 * MIN)
    assert.deepEqual([wait.kind, wait.text], ['check', 'waits for its check again'])
    const made = await withdrawn.later(3 * MIN)({ action: 'qa-task', id })
    assert.equal(made.ok, true, made.why)
  } finally {
    await remove(withdrawn.dir)
  }
})

test('2: an ask of the step from before the check line does not count for the ask the checker owes', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    // An ask the person answered, filed a minute before the check line (an earlier round).
    const early = await store.later(0, 'Lamplighter')({ action: 'ask', of: id, kind: 'decide', title: 'Which lamp style?', text: 'Two styles.', blocking: false })
    assert.equal(early.ok, true, early.why)
    assert.equal((await store.person({ action: 'answer', id: early.result.id, text: 'The round one' })).ok, true)
    await qaOf(store, id)
    await fileCheck(store, id, ASK_POINT)
    const wait = await waitOf(store, id, 10 * MIN)
    assert.equal(wait.kind, 'answer')
  } finally {
    await remove(store.dir)
  }
})

test('10: the QA task the board drops when it files the person\'s answered check names the board as the writer, not the person', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    await qaOf(store, id)
    await fileCheck(store, id, ASK_POINT)
    // The checker was slow: past 30 minutes the check was due again and the board made its task; then the ask came, and the person said yes.
    const second = await store.later(32 * MIN)({ action: 'qa-task', id })
    assert.equal(second.ok, true, second.why)
    const asked = await store.later(33 * MIN, 'Checker')({ ...LOOK, of: id })
    assert.equal(asked.ok, true, asked.why)
    const answered = await workApi({ action: 'answer', id: asked.result.id, text: 'Approved, keep it' }, { ...store.ctx, now: NOW + 34 * MIN, as: 'person' })
    assert.equal(answered.ok, true, answered.why)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'done')
    const task = await item(store.dir, second.result.id)
    assert.equal(valueOf(task, 'State'), 'dropped')
    const history = task.sections.get('History')
    assert.match(history.at(-1), / server: refined → dropped$/)
    assert.equal(history.some(one => / person: /.test(one)), false, history.join('\n'))
    assert.ok(task.sections.get('Context').some(one => /Dropped by the board on /.test(one)))
  } finally {
    await remove(store.dir)
  }
})
