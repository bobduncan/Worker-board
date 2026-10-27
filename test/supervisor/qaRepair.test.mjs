// T9.1.1 (the person, 2026-10-27: "workers do the checks ... B123 Quality Assurance ..."): the repair rule `unchecked` makes the
// Quality Assurance task of a step that waits for its check and has none (at once: the maker is idempotent), and drops the open
// task of a step that left review; no word goes to the Advisor. Made-up items; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { CHECKS, REPAIR_RULES, findStuck } from '../../src/supervisor/rules/repair.mjs'
import { applySync } from '../../src/supervisor/loop.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { fresh, item as itemOf, items as itemsOf, qaOf, remove, reported, openQa } from '../qaKit.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 27, 17, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
/** A step in review whose board check passed `minutes` ago and that has no result check yet. */
const waiting = (id = 'B701', minutes = 5, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: 'Show the damage', State: 'review', Owner: 'Worker 1', Since: stamp(ago(minutes + 3)), ...more }, {
  'What we build': ['- the damage shows'], History: [`- ${stamp(ago(minutes))} server: check passed: merged`], ...sections,
})
const qa = (id, checks, state = 'refined', more = {}) => item({ Id: id, Kind: 'step', Title: `Quality Assurance: ${checks} Show the damage`, State: state, Checks: checks, 'Not by': 'Worker 1', Since: stamp(ago(4)), ...more })
const PARTNER = { name: 'Partner', state: 'free', isRunning: true }
const stuck = (store, more = {}) => findStuck({ items: store, lanes: [], partner: PARTNER, now: NOW, outbox: [], ...more }).filter(one => one.check === 'unchecked')

test('the rule keeps its id and table entry, and says what it does now', () => {
  assert.ok(REPAIR_RULES.some(rule => rule.id === 'unchecked'))
  assert.equal(CHECKS.find(one => one.key === 'unchecked').words, 'a step that waits for its result check with no QA task: the board makes one; a QA task whose step left review: dropped')
})

test('a step that waits for its first check and has no QA task: the board makes one at once, no 30 minutes of waiting', () => {
  const found = stuck(items(waiting('B701', 1)))
  assert.deepEqual(found.map(one => [one.key, one.subject, one.fix]), [[`unchecked B701 ${stamp(ago(1))}`, 'B701', { do: 'qa', id: 'B701' }]])
  assert.match(found[0].text, /^B701 waits for its check with no QA task: the board makes one$/)
})

test('also for a step whose fix is done or whose ask point is answered; not for one that waits for a fix, for the person, or for nothing', () => {
  const failed = (extra = {}) => waiting('B510', 80, {}, { History: [`- ${stamp(ago(80))} server: check passed: merged`, `- ${stamp(ago(76))} Checker: result check failed: 0 of 2 points pass; fix B558 for Painter; 1 for you to judge`], Checked: ['Evidence: none', '- fail: a', '- ask: b'], ...extra })
  const fix = state => item({ Id: 'B558', Kind: 'step', Title: 'Fix: a', State: state, Owner: 'Painter', Since: stamp(ago(44)), 'Fix of': 'B510' })
  const ask = state => item({ Id: 'Q339', Kind: 'ask', Title: 'Right?', State: state, Of: 'B510', Since: stamp(ago(76)) })
  assert.deepEqual(stuck(items(failed(), fix('done'), ask('open'))).map(one => one.fix), [{ do: 'qa', id: 'B510' }])
  const answered = waiting('B510', 80, {}, { History: [`- ${stamp(ago(80))} server: check passed: merged`, `- ${stamp(ago(76))} Checker: result check waits for you: 1 of 2 points pass; 1 for you to judge`], Checked: ['Evidence: none', '- pass: a', '- ask: b'] })
  assert.deepEqual(stuck(items(answered, ask('answered'))).map(one => one.fix), [{ do: 'qa', id: 'B510' }])
  // An open fix, an open ask point: the step waits for those, not for a check.
  for (const state of ['queued', 'in progress', 'review']) assert.deepEqual(stuck(items(failed(), fix(state), ask('open'))), [], state)
  assert.deepEqual(stuck(items(answered, ask('open'))), [])
  // Its board check not passed, or no result check needed: nothing waits for a check.
  assert.deepEqual(stuck(items(waiting('B702', 5, {}, { History: [`- ${stamp(ago(5))} server: check failed: the branch is still there`] }))), [])
  assert.deepEqual(stuck(items(waiting('B703', 5, {}, { 'What we build': [] }))), [])
  assert.deepEqual(stuck(items(item({ Id: 'B704', Kind: 'step', Title: 'x', State: 'in progress', Owner: 'Worker 1', Since: stamp(ago(5)) }))), [])
})

test('a step with an open QA task, queued, taken or in progress, needs none; a done or dropped one does not count', () => {
  for (const state of ['refined', 'queued', 'taken', 'in progress']) assert.deepEqual(stuck(items(waiting('B701', 40), qa('B730', 'B701', state))), [], state)
  for (const state of ['done', 'dropped']) assert.equal(stuck(items(waiting('B701', 40), qa('B730', 'B701', state))).length, 1, state)
})

test('a board with no partner chat has no step that waits for a check: nothing is made', () => {
  assert.deepEqual(stuck(items(waiting('B701', 40)), { partner: null }), [])
})

test('an open QA task whose step is no longer in review is dropped, with why; a task of a step in review stays', () => {
  const done = item({ Id: 'B701', Kind: 'step', Title: 'Show the damage', State: 'done', Owner: 'Worker 1', Since: stamp(ago(30)) })
  const found = stuck(items(done, qa('B730', 'B701', 'queued'), waiting('B702', 3), qa('B731', 'B702', 'in progress'), qa('B732', 'B999', 'refined'), qa('B733', 'B701', 'done')))
  assert.deepEqual(found.map(one => [one.subject, one.fix]), [
    ['B730', { do: 'qa-drop', id: 'B730', why: 'B701 is done' }],
    ['B732', { do: 'qa-drop', id: 'B732', why: 'B999 is not in the store' }],
  ])
  assert.deepEqual(found.map(one => one.key), ['qa-drop B730 B701 done', 'qa-drop B732 B999 gone'])
  const dropped = item({ Id: 'B701', Kind: 'step', Title: 'x', State: 'dropped', Owner: 'Worker 1', Since: stamp(ago(30)) })
  assert.equal(stuck(items(dropped, qa('B730', 'B701', 'in progress')))[0].fix.why, 'B701 is dropped')
})

test('applySync: qa asks the work API for the task, qa-drop drops it as the board; a refusal is for the main chat, told once', async () => {
  const calls = []
  const apply = async body => { calls.push(body); return body.action === 'qa-task' ? { ok: true, result: { id: 'B730', made: true } } : { ok: true, result: { id: body.id } } }
  const findings = stuck(items(waiting('B701', 3), item({ Id: 'B702', Kind: 'step', Title: 'x', State: 'done', Owner: 'Worker 1', Since: stamp(ago(30)) }), qa('B731', 'B702', 'refined')))
  const done = await applySync(findings, { apply })
  assert.deepEqual(calls, [{ action: 'qa-task', id: 'B701' }, { action: 'drop', id: 'B731', why: 'B702 is done' }])
  assert.deepEqual(done.rows.map(row => [row.check, row.status, row.text]), [
    ['unchecked', 'Fixed', 'B701: its QA task B730 made'],
    ['unchecked', 'Fixed', 'B731: its QA task dropped (B702 is done)'],
  ])
  assert.deepEqual([done.note, done.keys], [[], []])
  // A refusal: a row for the main chat, told once (the next run, with the key noted, says nothing more).
  const refuse = async () => ({ ok: false, status: 409, why: 'B701 waits for no result check' })
  const first = await applySync(findings.slice(0, 1), { apply: refuse })
  assert.deepEqual(first.rows.map(row => row.status), ['For Main'])
  assert.equal(first.note.length, 1)
  assert.match(first.note[0], /B701 waits for its check with no QA task.*not fixed \(B701 waits for no result check\)/)
  const again = await applySync(findings.slice(0, 1), { apply: refuse }, new Set(first.keys))
  assert.deepEqual([again.rows.map(row => row.status), again.note], [['For Main'], []])
  // A file that changed while it was written is tried again at the next run, and tells the main chat nothing.
  const raced = await applySync(findings.slice(0, 1), { apply: async () => ({ ok: false, status: 409, why: 'B701.md changed in the meantime; try again.' }) })
  assert.deepEqual([raced.rows.map(row => row.status), raced.note], [['For Main'], []])
})

test('through the real work API: the rule makes the task of a step at go-live, once; the second run finds nothing; an orphan is dropped', async () => {
  const store = await fresh()
  try {
    // A step that waits for its check with no task: as the live board has them at go-live (the old check word is the Advisor's).
    const { id } = await reported(store)
    const made = await openQa(store.dir, id)
    assert.notEqual(made, null)
    assert.equal((await store.person({ action: 'drop', id: made.head.get('Id'), why: 'as if it was never made' })).ok, true)
    const run = async () => {
      const found = findStuck({ items: await itemsOf(store.dir), lanes: [], partner: PARTNER, now: Date.now(), outbox: [] }).filter(one => one.check === 'unchecked')
      return { found, done: await applySync(found, { apply: body => store.server(body) }) }
    }
    const first = await run()
    assert.deepEqual(first.found.map(one => one.fix.do), ['qa'])
    assert.equal(first.done.rows[0].status, 'Fixed')
    const task = await openQa(store.dir, id)
    assert.notEqual(task, null)
    assert.equal(task.head.get('Title'), `Quality Assurance: ${id} Light the garden lamps`)
    assert.deepEqual((await run()).found, [])
    // The person marks the step done: its open task has no step to check, and the rule drops it.
    assert.equal((await store.person({ action: 'tick', id, line: 'Done by you.' })).ok, true)
    const third = await run()
    assert.deepEqual(third.found.map(one => one.fix.do), ['qa-drop'])
    assert.equal(third.done.rows[0].status, 'Fixed')
    assert.equal((await itemOf(store.dir, task.head.get('Id'))).head.get('State'), 'dropped')
    assert.equal(await openQa(store.dir, id), null)
    assert.deepEqual((await run()).found, [])
  } finally {
    await remove(store.dir)
  }
})
