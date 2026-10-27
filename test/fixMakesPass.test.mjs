// B526: a fix step names, under each failed point, the agreed point of the step it fixes that it must make pass
// ("Makes pass: ..."), and its own check ticks those lines too: three fails of 2026-10-24 were builds true to the words
// of their fail and short of the step's intent. Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../src/work/api.mjs'
import { queueFor } from './queueFor.mjs'
import { checkedBy } from './qaKit.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { agreedPoints, parentPointsOf } from '../src/work/resultCheck.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const step = (id, what, more = {}, sections = {}) => ({
  head: new Map([['Id', id], ['Kind', 'step'], ['Title', `Step ${id}`], ['State', 'review'], ...Object.entries(more)]),
  sections: new Map([['What we build', what.map(one => `- ${one}`)], ...Object.entries(sections)]),
})
const failedOf = points => points.map((one, index) => ({ verdict: one.split(':')[0], text: one.replace(/^\w+:\s*/, ''), index })).filter(one => one.verdict === 'fail')
const pointsOf = points => points.map(one => ({ verdict: one.split(':')[0], text: one.replace(/^\w+:\s*/, '') }))

async function board() {
  const dir = await mkdtemp(join(tmpdir(), 'makes-pass-'))
  const at = new Date(2026, 9, 24, 12, 0).getTime()
  await writeStore(dir, migrateBacklog(['# Backlog', '', '## Tiles', '- [ ] B1 Redraw the tiles', ''].join('\n'), { now: at }), undefined, { now: at })
  const ctx = { dir, now: at + 60_000, prefix: '', roleOf: chat => ({ Partner: 'advisor', Keeper: 'main', Painter: 'worker', Checker: 'worker' })[chat] ?? null, freeChats: new Set(['Painter']), chats: ['Partner', 'Keeper', 'Painter', 'Checker'] }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  const read = async id => (await readStore(dir)).items.get(id)
  // Build, report and pass the board's own check of a step, so it waits in review for its result check.
  const toReview = async (id, branch) => {
    // Redesign Part 2: the board gives it to the worker (a fix step too: it is on the list, a follow-up of its builder).
    assert.equal((await queueFor(dir, id, 'Painter', { now: at + 60_000 })).ok, true)
    assert.equal((await as('Painter')({ action: 'take', id, branch })).ok, true)
    const reported = await as('Painter')({ action: 'report', id, result: 'Done.', merged: 'c0ffee1' })
    assert.equal(reported.ok, true, reported.why)
    assert.equal((await workApi({ action: 'check', id, passed: true, lines: ['branch gone'] }, { ...ctx, as: 'server' })).ok, true)
  }
  // T9.1.1: the result check is filed by the worker that holds the step's QA task, a worker that did not build it.
  const checkedAs = (id, body) => checkedBy({ as, server: call => workApi(call, { ...ctx, as: 'server' }), dir, now: at + 60_000 }, id, body)
  return { as, read, toReview, checkedAs }
}

test('a fix made from a two-fail check carries a Makes pass line under each fail, in order, and its check must tick them', async () => {
  const { as, read, toReview, checkedAs } = await board()
  assert.equal((await as('Partner')({ action: 'refine', id: 'B1', summary: 'Redraw the tiles.' })).ok, true)
  assert.equal((await as('Partner')({ action: 'refined', id: 'B1', what: ['four tiles read as lava at play size', 'the edges glow where lava meets rock', 'a test for every tile', 'Not in it: new tiles'] })).ok, true)
  await toReview('B1', 'b1-tiles')
  const checked = await checkedAs('B1', { evidence: 'none (x)', points: ['fail: the tiles use the old palette', 'pass: edges glow', 'fail: tileTest.mjs covers two of four', 'pass: not in it held'] })
  assert.equal(checked.ok, true, checked.why)
  const fix = await read(checked.result.fix)
  assert.deepEqual(fix.sections.get('What we build'), [
    '- the tiles use the old palette',
    '- Makes pass: four tiles read as lava at play size',
    '- tileTest.mjs covers two of four',
    '- Makes pass: a test for every tile',
  ])
  assert.match(fix.sections.get('Summary')[0], /so its agreed points pass: four tiles read as lava at play size; a test for every tile\. Found: the tiles use the old palette/)
  const block = fix.sections.get('Refined').join('\n')
  assert.match(block, /- Makes pass: four tiles read as lava at play size\n\s+- tileTest\.mjs covers two of four\n\s+- Makes pass: a test for every tile/)
  // Its check: the fail texts alone are refused, with what to tick; all four lines pass and close both steps.
  const fixId = checked.result.fix
  await toReview(fixId, 'b2-fix')
  const short = await checkedAs(fixId, { evidence: 'none (x)', points: ['pass: the new palette', 'pass: four tile tests'] })
  assert.equal(short.ok, false)
  assert.match(short.why, /is a fix of B1: tick each of its 4 agreed points, every fail text and every "Makes pass" line of its What we build, not 2/)
  const whole = await checkedAs(fixId, { evidence: 'none (x)', points: ['pass: the new palette', 'pass: the tiles read as lava', 'pass: four tile tests', 'pass: a test for every tile'] })
  assert.equal(whole.ok, true, whole.why)
  assert.equal((await read(fixId)).head.get('State'), 'done')
  assert.equal((await read('B1')).head.get('State'), 'done')
})

test('a parent checked on its Standard alone gives its Standard line; one with neither gives its Summary', () => {
  const art = step('B3', [], {}, { Standard: ['ground look · ref.webp · target 75'], Summary: ['Draw the stairs.'] })
  assert.deepEqual(parentPointsOf(art, pointsOf(['fail: scored 68 of 75']), failedOf(['fail: scored 68 of 75'])), ['Standard: ground look · ref.webp · target 75'])
  const plain = step('B4', [], {}, { Standard: ['none (a rule)'], Summary: ['Sort the crates.'] })
  assert.deepEqual(parentPointsOf(plain, pointsOf(['fail: unsorted']), failedOf(['fail: unsorted'])), ['Sort the crates.'])
})

test('a checker that adds its own points: each fail is tied to the agreed point it shares the most words with', () => {
  const origin = step('B5', ['every enemy shows its intent above its head', 'the intent icon matches the planned action', 'Not in it: new enemies'])
  const points = ['pass: intent shown above each enemy head', 'harm: an extra crash when the planned action is a flee', 'fail: the icon shows attack while the planned action is flee: icon and action differ', 'pass: not in it held']
  // Four points for three agreed ones: not by order.
  assert.deepEqual(parentPointsOf(origin, pointsOf(points), failedOf(points)), ['the intent icon matches the planned action'])
  const late = ['pass: intent shown', 'pass: icon ok', 'pass: extra: fast', 'fail: not in it broken: a new enemy kind was added']
  assert.deepEqual(parentPointsOf(origin, pointsOf(late), failedOf(late)), ['Not in it: new enemies'])
})

test('a fix of a fix names the first step\'s point: through its Makes pass line, or up the chain for a fix made before B526', () => {
  const first = step('B6', ['the next steps run on opus and high', 'the guard fires at the third attempt'], {}, { Checked: ['Evidence: none', '- fail: only words say opus, nothing sets it', '- pass: fires at three'] })
  const oldFix = step('B7', ['only words say opus, nothing sets it'], { 'Fix of': 'B6' }, { Checked: ['Evidence: none', '- fail: only a missing model is defaulted'] })
  const items = new Map([['B6', first], ['B7', oldFix]])
  // B8 fixes the old fix B7: its point is B6's, not B7's fail words.
  const failed = failedOf(['fail: only a missing model is defaulted'])
  assert.deepEqual(parentPointsOf(oldFix, pointsOf(['fail: only a missing model is defaulted']), failed, items), ['the next steps run on opus and high'])
  // Without the store it stays the old fix's own line.
  assert.deepEqual(parentPointsOf(oldFix, pointsOf(['fail: only a missing model is defaulted']), failed), ['only words say opus, nothing sets it'])
  // A fix made since B526: its fail text or its Makes pass line failed, the Makes pass line is the point.
  const newFix = step('B9', ['only words say opus, nothing sets it', 'Makes pass: the next steps run on opus and high'], { 'Fix of': 'B6' })
  assert.deepEqual(agreedPoints(newFix), ['only words say opus, nothing sets it', 'Makes pass: the next steps run on opus and high'])
  for (const list of [['fail: still words', 'pass: opus set'], ['pass: words gone', 'fail: the next steps stay on sonnet']]) {
    assert.deepEqual(parentPointsOf(newFix, pointsOf(list), failedOf(list), items), ['the next steps run on opus and high'])
  }
})
