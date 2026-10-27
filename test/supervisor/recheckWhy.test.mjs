// B565, the fix of X19: B510's check failed with fix B558 and an ask point Q339; B558 passed, but the partner read B510
// as waiting only for the person's answer and answered the board's "check step B510" with no new check, so B510 sat in
// review. The check says why it comes (its fix is done; its open ask points kept), and the repair `unchecked` also covers a
// step whose fix is done. T9.1.1 (the person, 2026-10-27: workers do the checks): the why, the board's warnings and the demand
// for a mutant now stand in the Context of the step's Quality Assurance task, and the repair makes the task at once instead of
// waking the partner. Made-up items; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { findStuck } from '../../src/supervisor/rules/repair.mjs'
import { workApi } from '../../src/work/api.mjs'
import { checkWhy } from '../../src/work/resultCheck.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 20, 44).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
/** B510 as X19 found it: its board check passed, its result check failed with fix B558 and one point for the person. */
const b510 = item({ Id: 'B510', Kind: 'step', Title: 'Turn the delayed skills on', State: 'review', Owner: 'Painter', Activity: 'Fights', Since: stamp(ago(76)) }, {
  'What we build': ['- every delayed skill lands', '- the fights feel right'],
  History: [`- ${stamp(ago(80))} server: check passed: merged`, `- ${stamp(ago(76))} Checker: result check failed: 0 of 2 points pass; fix B558 for Painter; 1 for you to judge`],
  Checked: ['Evidence: none', '- fail: every delayed skill lands', '- ask: the fights feel right'],
})
const fix = state => item({ Id: 'B558', Kind: 'step', Title: 'Fix: every delayed skill lands', State: state, Owner: 'Painter', Activity: 'Fights', Since: stamp(ago(44)), 'Fix of': 'B510' })
const q339 = item({ Id: 'Q339', Kind: 'ask', Title: 'Do the fights feel right?', State: 'open', Of: 'B510', Since: stamp(ago(76)) })

const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const PARTNER = { name: 'Partner', state: 'free', isRunning: true }
const unchecked = (store, more = {}) => findStuck({ items: store, lanes: [LEAD], partner: PARTNER, now: NOW, outbox: [], ...more }).filter(one => one.check === 'unchecked')

/** The Quality Assurance task the board makes for B510 in a store holding `all`: its item. */
async function taskFor(all) {
  const dir = await mkdtemp(join(tmpdir(), 'recheck-why-'))
  try {
    const held = items(...all)
    await writeStore(dir, { items: held, activities: [{ name: 'Fights', isFocus: false, steps: [...held.values()].filter(one => one.head.get('Kind') === 'step').map(one => one.head.get('Id')), notes: [], loose: [] }] }, undefined, { now: NOW - 100 * MIN })
    const made = await workApi({ action: 'qa-task', id: 'B510' }, { dir, now: NOW, prefix: '', roleOf: () => null, as: 'server' })
    assert.equal(made.ok, true, made.why)
    return (await readStore(dir)).items.get(made.result.id)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
const contextOf = task => task.sections.get('Context').map(one => one.trim())

test('X19: a step whose fix is done gets a task that says why, its open ask point kept; a first check says no why', async () => {
  const store = items(b510, fix('done'), q339)
  assert.equal(checkWhy(b510, store), 'its fix B558 is done: file its check again; keep Q339 as an ask point')
  const context = contextOf(await taskFor([b510, fix('done'), q339]))
  assert.ok(context.includes('Why: its fix B558 is done: file its check again; keep Q339 as an ask point'), context.join('\n'))
  assert.ok(context.includes('Built by: Painter'))
  const first = item({ ...Object.fromEntries(b510.head) }, { ...Object.fromEntries(b510.sections), History: [`- ${stamp(ago(80))} server: check passed: merged`] })
  assert.ok(!contextOf(await taskFor([first])).some(one => one.startsWith('Why:')))
})

test('X19: the repair makes the task of a step whose fix is done at once; not while its fix is open', () => {
  const made = unchecked(items(b510, fix('done'), q339))
  assert.deepEqual(made.map(one => [one.fix.do, one.fix.id]), [['qa', 'B510']])
  assert.equal(made[0].text, 'B510 waits for its check with no QA task: the board makes one')
  // An open fix: the step waits for its fix, no task, no why.
  for (const state of ['queued', 'in progress', 'review']) {
    assert.equal(checkWhy(b510, items(b510, fix(state), q339)), null, state)
    assert.deepEqual(unchecked(items(b510, fix(state), q339)), [], state)
  }
  // Done only lately: the same, at once.
  assert.equal(unchecked(items(b510, fix('done'), q339), { now: ago(20) }).length, 1)
})

// The review of 2026-10-25: the first check word carries the board's warnings and the demand for a mutant; the wake that
// asks again said neither. Now one task carries them whenever it is made.
test('the task carries the board warnings and the demand for a mutant, whether it is the first or the check again', async () => {
  const noMutant = 'the change touches tests (test/a.test.mjs) but the result names no mutant: the result check asks for one (next time add "Tests bite: <what was undone in a copy> → <the assertion that failed>")'
  const withWarnings = warnings => item({ ...Object.fromEntries(b510.head) }, {
    ...Object.fromEntries(b510.sections),
    History: [`- ${stamp(ago(80))} server: check passed with warnings: work in lantern | warnings: ${warnings}`, `- ${stamp(ago(76))} Checker: result check failed: 0 of 2 points pass; fix B558 for Painter; 1 for you to judge`],
  })
  const context = contextOf(await taskFor([withWarnings(noMutant), fix('done'), q339]))
  assert.ok(context.includes(`Board warnings: ${noMutant}`))
  assert.ok(context.some(one => /^Demand: the report names no mutant for a change that touches tests: the helper makes one in a scratch copy/.test(one)))
  // Warnings of another kind: no demand.
  const other = contextOf(await taskFor([withWarnings('the result names no Context'), fix('done'), q339]))
  assert.ok(other.includes('Board warnings: the result names no Context'))
  assert.ok(!other.some(one => one.startsWith('Demand:')))
})

test('an answered ask point says so; with two asks open both are kept', () => {
  const waits = item({ ...Object.fromEntries(b510.head) }, {
    ...Object.fromEntries(b510.sections),
    History: [`- ${stamp(ago(80))} server: check passed: merged`, `- ${stamp(ago(76))} Checker: result check waits for you: 1 of 2 points pass; 1 for you to judge`],
  })
  assert.equal(checkWhy(waits, items(waits, item({ ...Object.fromEntries(q339.head), State: 'answered' }))), 'its ask point is answered: file its check again')
  const q340 = item({ ...Object.fromEntries(q339.head), Id: 'Q340' })
  assert.equal(checkWhy(b510, items(b510, fix('done'), q340, q339)), 'its fix B558 is done: file its check again; keep Q339 and Q340 as ask points')
})
