// T9.1.1, the review's fixes 4 and 5 (brief 2026-10-27): a QA task bars the builders of the step it checks AND of every step of its
// fix chain (made into its Not by, and joined again with the store's builders at the hand-out), a rename follows the chats in its
// Not by, and the person's pin never reaches a builder. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { idleWorkers, match, readyList } from '../../src/work/handOut.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { openNaming, renamedItem } from '../../src/work/names.mjs'
import { barredFrom, buildersWithFixes, fixChainOf } from '../../src/work/qaTask.mjs'
import { readItemFile, writeItem } from '../../src/work/store.mjs'
import { queueFor } from '../queueFor.mjs'
import { NOW, fileCheck, fresh, item, items, qaOf, remove, reported, takeQa } from '../qaKit.mjs'

const MIN = 60_000

/**
 * The step built by Lamplighter, checked once by Checker with a failed and an ask point; its fix built by Spare, whose own QA
 * task Checker files. The step then waits for its check again: its second QA task. `{ id, fix, qa }`.
 */
async function secondRound(store) {
  const { id } = await reported(store)
  await qaOf(store, id)
  const filed = await fileCheck(store, id, { evidence: 'none (test)', points: ['fail: a lamp at every bench', 'ask: warm yellow light, never white'] })
  assert.equal(filed.ok, true, filed.why)
  const fix = filed.result.fix
  await queueFor(store.dir, fix, 'Spare', { now: NOW + 60_000 })
  assert.equal((await store.spare({ action: 'take', id: fix, branch: 'b-fix-lamps' })).ok, true)
  assert.equal((await store.spare({ action: 'report', id: fix, result: 'Every bench has a lamp.', merged: 'beef123' })).ok, true)
  const git = await store.server({ action: 'check', id: fix, passed: true, lines: ['branch gone'] })
  assert.equal(git.ok, true, git.why)
  await takeQa(store, git.result.qa)
  const fixed = await store.checker({ action: 'checked', id: fix, evidence: 'none (test)', points: ['pass: a lamp at every bench', 'pass: Makes pass: a lamp at every bench'] })
  assert.equal(fixed.ok, true, fixed.why)
  assert.match(fixed.result.qa, /^B\d+$/, 'the fixed step waits for its check again')
  return { id, fix, qa: fixed.result.qa }
}

/** The file of an item rewritten with `change(head)`. */
async function rewrite(dir, id, change) {
  const file = await readItemFile(dir, id)
  const head = new Map(file.item.head)
  change(head)
  assert.equal((await writeItem(dir, { ...file.item, head }, undefined, { expected: file.text })).ok, true)
}

test('4b: a QA task for a step checked again bars the builders of the step and of every step of its fix chain', async () => {
  const store = await fresh()
  try {
    const { id, fix, qa } = await secondRound(store)
    const task = await item(store.dir, qa)
    assert.equal(valueOf(task, 'Not by'), 'Lamplighter, Spare')
    assert.deepEqual(fixChainOf(id, await items(store.dir)).map(one => valueOf(one, 'Id')), [fix])
    // The chain is followed down: a fix of the fix is built on too, dropped or not.
    const all = await items(store.dir)
    all.set('B90', { head: new Map([['Id', 'B90'], ['Kind', 'step'], ['State', 'dropped'], ['Owner', 'Painter'], ['Fix of', fix]]), sections: new Map() })
    assert.deepEqual(buildersWithFixes(all.get(id), all), ['Lamplighter', 'Spare', 'Painter'])
    assert.deepEqual(barredFrom(task, all), ['Lamplighter', 'Spare', 'Painter'])
  } finally {
    await remove(store.dir)
  }
})

test('4b: the hand-out bars the stored Not by joined with the builders now: the list, the match, the give and the holder\'s check', async () => {
  const store = await fresh()
  try {
    const { id, qa } = await secondRound(store)
    // A task made before the fix was built on: its stored Not by names the step's first builder only.
    await rewrite(store.dir, qa, head => head.set('Not by', 'Lamplighter'))
    const all = await items(store.dir)
    const ready = readyList(all, { now: NOW + 3 * MIN, focus: null, beyondFocus: true })
    assert.deepEqual(ready.ready.find(one => one.id === qa).notBy, ['Lamplighter', 'Spare'])
    // match: a list entry that names only the stored builder still keeps the task from the fix's builder.
    const lane = name => ({ name, state: 'free', isMain: false, isLeftover: false, isRunning: true, model: 'claude-sonnet-5-5', report: { state: 'idle', since: NOW, background: false, at: NOW } })
    const idle = idleWorkers([lane('Spare'), lane('Checker')], { items: all })
    const entry = { id: qa, rank: -1, keptFor: null, keptUntil: null, pinned: null, prefers: null, notBy: ['Lamplighter'] }
    assert.deepEqual(match({ ready: [entry], idle: idle.filter(one => one.name === 'Spare'), items: all }), [], 'only the fix builder is idle: the task waits')
    assert.deepEqual(match({ ready: [entry], idle, items: all }).map(one => one.chat), ['Checker'])
    // give: refused for the fix's builder and the step's, allowed for another worker.
    const spare = await store.server({ action: 'advance', id: qa, to: 'queued', for: 'Spare' })
    assert.deepEqual([spare.ok, spare.status], [false, 409])
    assert.match(spare.why, /Spare built B\d+ \(or a fix of it\), so it does not check it/)
    assert.equal((await store.server({ action: 'advance', id: qa, to: 'queued', for: 'Lamplighter' })).ok, false)
    // The holder gate: a chat that took a fix of the step after the task was given to it cannot file its check.
    await rewrite(store.dir, qa, head => head.set('Owner', 'Spare').set('State', 'in progress'))
    const filed = await store.spare({ action: 'checked', id, evidence: 'none (test)', points: ['pass: a lamp at every bench', 'pass: warm yellow light, never white'] })
    assert.deepEqual([filed.ok, filed.status], [false, 403])
    assert.match(filed.why, /but Spare built B\d+ or a fix of it: a builder never files its check/)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
    // Given to Checker, it is given.
    await rewrite(store.dir, qa, head => head.set('State', 'refined').delete('Owner'))
    const checker = await store.server({ action: 'advance', id: qa, to: 'queued', for: 'Checker' })
    assert.equal(checker.ok, true, checker.why)
  } finally {
    await remove(store.dir)
  }
})

test('4a: a rename also renames the chat inside a QA task\'s Not by, a list; a done task keeps the old name', async () => {
  const qa = (state, notBy) => ({ head: new Map([['Id', 'B30'], ['Kind', 'step'], ['State', state], ['Checks', 'B2'], ['Not by', notBy]]), sections: new Map() })
  const open = renamedItem(qa('refined', 'Lamplighter, Checker, Spare'), 'Checker', 'Painter')
  assert.equal(valueOf(open, 'Not by'), 'Lamplighter, Painter, Spare')
  assert.equal(valueOf(renamedItem(qa('queued', 'Team - Lamplighter'), 'Lamplighter', 'Painter', 'Team - '), 'Not by'), 'Painter')
  assert.equal(renamedItem(qa('refined', 'Lamplighter, Spare'), 'Checker', 'Painter'), null)
  assert.equal(renamedItem(qa('done', 'Lamplighter, Checker'), 'Checker', 'Painter'), null)
  assert.deepEqual(openNaming(new Map([['B30', qa('refined', 'Lamplighter, Checker')], ['B31', qa('dropped', 'Checker')]]), 'Checker'), ['B30'])
  // Through the work API: the task follows the builder's new name, with its History line.
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const task = await qaOf(store, id)
    assert.equal(valueOf(await item(store.dir, task), 'Not by'), 'Lamplighter')
    const renamed = await store.keeper({ action: 'rename', from: 'Lamplighter', to: 'Painter' })
    assert.equal(renamed.ok, true, renamed.why)
    assert.ok(renamed.result.moved.includes(task), renamed.result.text)
    const moved = await item(store.dir, task)
    assert.equal(valueOf(moved, 'Not by'), 'Painter')
    assert.equal(moved.sections.get('History').at(-1).endsWith('Keeper: Lamplighter renamed to Painter'), true)
  } finally {
    await remove(store.dir)
  }
})

test('5: a QA task is never pinned to a chat that built the step it checks or a fix of it, with the line naming why', async () => {
  const store = await fresh()
  try {
    const { id, qa } = await secondRound(store)
    for (const builder of ['Lamplighter', 'Spare']) {
      const refused = await store.person({ action: 'pin', id: qa, for: builder })
      assert.deepEqual([refused.ok, refused.status], [false, 409], builder)
      assert.match(refused.why, new RegExp(`^${qa} is a Quality Assurance task: ${builder} built ${id} \\(or a fix of it\\), so it is not pinned to ${builder}\\.$`))
    }
    assert.equal(valueOf(await item(store.dir, qa), 'Pinned'), null)
    const pinned = await store.person({ action: 'pin', id: qa, for: 'Checker' })
    assert.equal(pinned.ok, true, pinned.why)
    assert.equal(valueOf(await item(store.dir, qa), 'Pinned'), 'Checker')
  } finally {
    await remove(store.dir)
  }
})
