// T13, part 2: the work tool's `step` call saves the plan with the step (its `Plan:` line: the parts, the part it is on, the
// absolute times the estimate runs out), so a chat that takes the step over shows it. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { HEAD_KEYS, parseItem, valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { stampSecond } from '../../src/work/pause.mjs'
import { nextPlan, planOf, planText } from '../../src/work/stepPlan.mjs'
import { readStore, writeItem, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 28, 20, 10, 0).getTime()
const BACKLOG = [
  '# Backlog',
  '',
  '## Board work #focus',
  '- [ ] B1 Draw the strip (for Board; about 1 h)',
  '- [ ] B2 Keep the cards apart (for Board; about 30 min)',
  '',
].join('\n')
const ROLES = { Main: 'main', Board: 'worker' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'step-plan-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  const ctx = { dir, now: NOW, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board']) }
  const at = (now, body) => workApi({ chat: 'Board', ...body }, { ...ctx, now })
  return { dir, at, board: body => at(NOW, body) }
}
const planLine = async (dir, id) => valueOf((await readStore(dir)).items.get(id), 'Plan')
const clean = async (dir, work) => {
  try {
    await work()
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

test('a step call with names and minutes writes the plan on the step; a second call replaces it', async () => {
  const { dir, at, board } = await fresh()
  await clean(dir, async () => {
    assert.equal((await board({ action: 'take', minutes: 30, id: 'B1' })).ok, true)
    assert.equal(await planLine(dir, 'B1'), `until ${stampSecond(NOW + 30 * MIN)} | at ${stampSecond(NOW)}`)
    const first = await board({ action: 'step', id: 'B1', names: ['Read', 'Draw', 'Test'], step: 1, minutes: 40, stepMinutes: 10 })
    assert.equal(first.ok, true)
    const stamp = minutes => stampSecond(NOW + minutes * MIN)
    assert.equal(await planLine(dir, 'B1'), `step 1/3 | parts Read; Draw; Test | until ${stamp(40)} | step until ${stamp(10)} | at ${stamp(0)}`)
    // The line is part of the head as the store keeps it: the file reads back without a problem.
    assert.deepEqual((await readStore(dir)).problems, [])

    // Ten minutes later: the next part, with the times it now expects; the parts stay.
    const later = NOW + 10 * MIN
    assert.equal((await at(later, { action: 'step', id: 'B1', step: 2, minutes: 30, stepMinutes: 12 })).ok, true)
    const second = stampSecond
    assert.equal(await planLine(dir, 'B1'), `step 2/3 | parts Read; Draw; Test | until ${second(later + 30 * MIN)} | step until ${second(later + 12 * MIN)} | at ${second(later)}`)

    // A call that moves on without a time keeps the task's time and drops the part's, as the card does.
    assert.equal((await at(later + MIN, { action: 'step', id: 'B1', step: 3 })).ok, true)
    assert.equal(await planLine(dir, 'B1'), `step 3/3 | parts Read; Draw; Test | until ${second(later + 30 * MIN)} | at ${second(later + MIN)}`)
    // A checkpoint alone is no plan: the line stays as it was.
    assert.equal((await board({ action: 'step', id: 'B1', commit: 'a1b2c3d', next: 'test it' })).ok, true)
    assert.equal(await planLine(dir, 'B1'), `step 3/3 | parts Read; Draw; Test | until ${second(later + 30 * MIN)} | at ${second(later + MIN)}`)
  })
})

test('the plan on the step reads back as the call gave it, parts with a separator in a name kept apart', async () => {
  const plan = nextPlan(null, { names: ['Read; the | code', 'Draw'], step: 2, minutes: 25, stepMinutes: 5 }, NOW)
  assert.deepEqual(plan.names, ['Read, the , code', 'Draw'])
  const item = { head: new Map([['Id', 'B1'], ['Kind', 'step'], ['State', 'in progress'], ['Since', '2026-10-28 20:00'], ['Plan', planText(plan)]]), sections: new Map() }
  assert.deepEqual(planOf(item), { names: ['Read, the , code', 'Draw'], on: 2, steps: 2, until: NOW + 25 * MIN, stepUntil: NOW + 5 * MIN, writtenAt: NOW })
  // A step without a line, or a line with nothing in it, has no plan.
  assert.equal(planOf({ head: new Map([['Id', 'B1']]), sections: new Map() }), null)
  assert.equal(planOf({ head: new Map([['Id', 'B1'], ['Plan', 'at 2026-10-28 20:10:00']]), sections: new Map() }), null)
  // Only minutes, or only a count of the parts: still a plan.
  assert.deepEqual(nextPlan(null, { minutes: 20 }, NOW), { names: [], on: null, steps: null, until: NOW + 20 * MIN, stepUntil: null, writtenAt: NOW })
  assert.deepEqual(nextPlan(null, { steps: 4, step: 2 }, NOW), { names: [], on: 2, steps: 4, until: null, stepUntil: null, writtenAt: NOW })
  // Nothing given and nothing before it: nothing to keep; a time out of reach is none.
  assert.equal(nextPlan(null, {}, NOW), null)
  assert.equal(nextPlan(null, { minutes: null }, NOW), null)
})

test('a step taken from the queue starts on a plan of its own: one saved from an earlier run is gone', async () => {
  const { dir, board } = await fresh()
  await clean(dir, async () => {
    const file = await readFile(join(dir, 'B2.md'), 'utf8')
    const item = parseItem(file)
    item.head.set('Plan', planText(nextPlan(null, { names: ['Old'], step: 1, minutes: 5 }, NOW - 90 * MIN)))
    const head = new Map([...item.head].sort(([a], [b]) => HEAD_KEYS.step.indexOf(a) - HEAD_KEYS.step.indexOf(b)))
    const written = await writeItem(dir, { ...item, head }, undefined, { expected: file })
    assert.equal(written.ok, true, written.why)
    assert.notEqual(await planLine(dir, 'B2'), null)
    assert.equal((await board({ action: 'take', minutes: 30, id: 'B2' })).ok, true)
    assert.equal(await planLine(dir, 'B2'), `until ${stampSecond(NOW + 30 * MIN)} | at ${stampSecond(NOW)}`)
  })
})
