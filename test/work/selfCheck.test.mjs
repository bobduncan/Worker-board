// P1 (the delivery review's proposal 1, 2026-11-28): the builder checks its own result before it reports. A report of a step that
// needs the result check carries the check's own fields (`points`, `score`, `evidence`), read by the one parser; the step keeps them
// under "## Self-check" and in one History line; a report without them is refused with the exact points to tick; a self-check that
// fails a point or scores under the target is taken and said back. The independent check stays as it is. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { valueOf } from '../../src/work/item.mjs'
import { owedPoints, scoreOf, SELF_CHECK_LIST_CHARS, selfCheckOf, selfCheckPointLines, selfCheckWanted, selfCheckWarning, selfCheckedSinceReport, targetOf } from '../../src/work/resultCheck.mjs'
import { standardOf } from '../../src/work/standard.mjs'
import { queueFor } from '../queueFor.mjs'
import { LAMP, NOW, fileCheck, fresh, item, remove } from '../qaKit.mjs'

const SELF = ['pass: a lamp at every bench', 'pass: warm yellow light, never white']
const history = one => one.sections.get('History') ?? []
const STANDARD = 'map · art/ref/lamps.png · target 75'

/** The lamp step made from the agreed how (two agreed points, a Not in it line), given to the builder and taken. */
async function taken(store, lamp = LAMP) {
  const made = await store.partner(lamp)
  assert.equal(made.ok, true, made.why)
  const id = made.result.id
  assert.equal((await queueFor(store.dir, id, 'Lamplighter', { now: NOW + 60_000 })).ok, true)
  const take = await store.lamplighter({ action: 'take', minutes: 30, id, branch: 'b-lamps' })
  assert.equal(take.ok, true, take.why)
  return id
}
const report = (store, id, more = {}) => store.lamplighter({ action: 'report', id, result: 'Every path has a warm lamp.', merged: 'c0ffee1', ...more })

test('a report without the self-check on a step with agreed points is refused (400) with the exact points to tick, the Not in it line left out', async () => {
  const store = await fresh()
  try {
    const id = await taken(store)
    const refused = await report(store, id)
    assert.deepEqual([refused.ok, refused.status], [false, 400])
    assert.ok(refused.why.startsWith(`Before reporting ${id}, check your own result against its agreed points and standard: tick each in "points" ("pass: <point>", "fail: <point>", or "ask: <point>" for a point only the person can judge), score it ("score": "<n> of <target>") where the kind's definition of done gives a rubric, then report again. A near miss is fixed in this step first.`), refused.why)
    assert.ok(refused.why.includes('The points:\n- a lamp at every bench\n- warm yellow light, never white'), refused.why)
    assert.ok(!refused.why.includes('Not in it'), 'the Not in it line is no point to tick')
    assert.ok(!refused.why.includes('Standard:'), 'no standard, no Standard line')
    // Nothing moved: the step is still in progress, nothing in its History.
    const step = await item(store.dir, id)
    assert.equal(valueOf(step, 'State'), 'in progress')
    assert.ok(!history(step).some(one => / → review\b/.test(one)))
    // Empty points count as none.
    assert.equal((await report(store, id, { points: [] })).status, 400)
    assert.equal((await report(store, id, { points: '  ' })).status, 400)
  } finally {
    await remove(store.dir)
  }
})

test('the words of the refusal on a step with a Standard line name its target; a step with neither points nor standard owes no self-check', () => {
  const withStandard = { head: new Map([['Id', 'B9']]), sections: new Map([['What we build', ['- the map painted whole', '- Not in it: new paths']], ['Standard', [STANDARD]]]) }
  const words = selfCheckWanted('B9', withStandard)
  assert.ok(words.includes(', and score it against the kind\'s definition of done ("score": "<n> of 75")'), words)
  assert.ok(words.endsWith(`The points:\n- the map painted whole\nStandard: ${STANDARD}`), words)
  assert.deepEqual(owedPoints(withStandard), ['the map painted whole'])
  assert.equal(targetOf(STANDARD), 75)
  assert.equal(targetOf('none (no look change)'), null)
  assert.equal(scoreOf('66 of 75'), 66)
  assert.equal(scoreOf(''), null)
  // Only a Standard line: the words carry it, and no points list.
  const standardOnly = { head: new Map([['Id', 'B9']]), sections: new Map([['Standard', [STANDARD]]]) }
  assert.ok(!selfCheckWanted('B9', standardOnly).includes('The points:'))
  assert.ok(selfCheckWanted('B9', standardOnly).endsWith(`Standard: ${STANDARD}`))
})

test('a step without agreed points or standard reports as before: no self-check asked, no section, no History line', async () => {
  const store = await fresh()
  try {
    // B1 (Trim the wicks) comes from the backlog with no agreed how.
    assert.equal((await queueFor(store.dir, 'B1', 'Lamplighter', { now: NOW + 60_000 })).ok, true)
    assert.equal((await store.lamplighter({ action: 'take', minutes: 30, id: 'B1', branch: 'b1-wicks' })).ok, true)
    const sent = await store.lamplighter({ action: 'report', id: 'B1', result: 'The wicks are trimmed.', merged: 'abc1234' })
    assert.equal(sent.ok, true, sent.why)
    const step = await item(store.dir, 'B1')
    assert.equal(valueOf(step, 'State'), 'review')
    assert.equal(step.sections.get('Self-check'), undefined)
    assert.equal(selfCheckOf(step), null)
    assert.equal(selfCheckedSinceReport(step), false)
    assert.ok(!history(step).some(one => one.includes('self-check')))
  } finally {
    await remove(store.dir)
  }
})

test('a report with the self-check keeps it under Self-check and in one History line by the builder; the answer says nothing more; the checker is not shown it', async () => {
  const store = await fresh()
  try {
    const id = await taken(store)
    const sent = await report(store, id, { points: SELF, score: '80 of 75', evidence: 'pictures/b2/after.png' })
    assert.equal(sent.ok, true, sent.why)
    assert.equal(sent.result.selfCheck, undefined)
    assert.ok(!sent.result.text.includes('Your self-check'))
    const step = await item(store.dir, id)
    assert.equal(valueOf(step, 'State'), 'review')
    assert.deepEqual(step.sections.get('Self-check'), ['Evidence: pictures/b2/after.png', 'Score: 80 of 75', '- pass: a lamp at every bench', '- pass: warm yellow light, never white'])
    assert.deepEqual(selfCheckOf(step), { evidence: 'pictures/b2/after.png', score: '80 of 75', points: [{ verdict: 'pass', text: 'a lamp at every bench' }, { verdict: 'pass', text: 'warm yellow light, never white' }], passed: 2, total: 2 })
    assert.equal(selfCheckedSinceReport(step), true)
    const lines = history(step)
    const review = lines.findIndex(one => / → review$/.test(one))
    assert.ok(review >= 0, lines.join('\n'))
    assert.ok(lines[review + 1].endsWith('Lamplighter: self-check: 2 of 2 points pass, score 80 of 75'), lines.join('\n'))
    assert.ok(lines[review + 2].endsWith('server: check pending'), lines.join('\n'))
    // The Checked section is the independent check's alone: none yet.
    assert.equal(step.sections.get('Checked'), undefined)
    // The checker's `work next` on the QA task shows the agreed points and nothing of the self-check.
    await store.server({ action: 'check', id, passed: true, lines: ['work in garden', 'branch gone', 'result named'] })
    const filed = await fileCheck(store, id, { evidence: 'pictures/b2/evidence.png', points: SELF, score: '82 of 75' })
    assert.equal(filed.ok, true, filed.why)
    const checked = await item(store.dir, id)
    assert.equal(valueOf(checked, 'State'), 'done')
    assert.deepEqual(checked.sections.get('Self-check'), ['Evidence: pictures/b2/after.png', 'Score: 80 of 75', '- pass: a lamp at every bench', '- pass: warm yellow light, never white'], 'the self-check stays beside the check')
    assert.ok(history(checked).some(one => one.endsWith('Checker: result check passed: 2 of 2 points pass, score 82 of 75')))
  } finally {
    await remove(store.dir)
  }
})

test('the QA task\'s work next names the agreed points, not the self-check', async () => {
  const store = await fresh()
  try {
    const id = await taken(store)
    assert.equal((await report(store, id, { points: ['pass: a lamp at every bench', 'fail: warm yellow light, never white (the bench lamps are white)'], score: '60 of 75' })).ok, true)
    await store.server({ action: 'check', id, passed: true, lines: ['work in garden', 'branch gone', 'result named'] })
    const made = await store.server({ action: 'qa-task', id })
    assert.equal(made.ok, true, made.why)
    assert.equal((await queueFor(store.dir, made.result.id, 'Checker', { now: NOW + 60_000 })).ok, true)
    assert.equal((await store.checker({ action: 'take', minutes: 30, id: made.result.id })).ok, true)
    const next = await store.checker({ action: 'next' })
    assert.ok(next.result.text.includes('Agreed points:\n- a lamp at every bench\n- warm yellow light, never white'), next.result.text)
    assert.ok(!/self-check|Self-check|bench lamps are white/.test(next.result.text), 'the checker ticks its own points')
  } finally {
    await remove(store.dir)
  }
})

test('a self-check that fails a point is taken, kept with its fail, and said back in the answer with what to do now', async () => {
  const store = await fresh()
  try {
    const id = await taken(store)
    const sent = await report(store, id, { points: ['pass: a lamp at every bench', 'fail: warm yellow light, never white (the bench lamps are white)'] })
    assert.equal(sent.ok, true, sent.why)
    const words = `Your self-check fails 1 point: the result check will fail it and make a fix step. Fix it in ${id} now and report again (a report again replaces the self-check); a point only the person can judge is an "ask:" point.`
    assert.equal(sent.result.selfCheck, words)
    assert.ok(sent.result.text.endsWith(`\n${words}`), sent.result.text)
    const step = await item(store.dir, id)
    assert.equal(valueOf(step, 'State'), 'review')
    assert.ok(history(step).some(one => one.endsWith('Lamplighter: self-check: 1 of 2 points pass')), history(step).join('\n'))
    assert.deepEqual(selfCheckOf(step).points[1], { verdict: 'fail', text: 'warm yellow light, never white (the bench lamps are white)' })
    // Two fails: "them"; an ask point is no fail.
    assert.ok(selfCheckWarning('B2', [{ verdict: 'fail', text: 'a' }, { verdict: 'fail', text: 'b' }, { verdict: 'ask', text: 'c' }], '', step).startsWith('Your self-check fails 2 points: the result check will fail them and make a fix step.'))
    assert.equal(selfCheckWarning('B2', [{ verdict: 'pass', text: 'a' }, { verdict: 'ask', text: 'c' }], '', step), '')
  } finally {
    await remove(store.dir)
  }
})

test('a score under the step\'s target is said back too, with or without a fail; a score at the target is not', () => {
  const step = { head: new Map([['Id', 'B9']]), sections: new Map([['What we build', ['- the map painted whole']], ['Standard', [STANDARD]]]) }
  const pass = [{ verdict: 'pass', text: 'the map painted whole' }]
  assert.equal(selfCheckWarning('B9', pass, '66 of 75', step), 'Your self-check scores 66 under its target 75: the result check will fail that and make a fix step. Fix it in B9 now and report again (a report again replaces the self-check); a point only the person can judge is an "ask:" point.')
  assert.equal(selfCheckWarning('B9', pass, '75 of 75', step), '')
  assert.equal(selfCheckWarning('B9', pass, '', step), '')
  assert.ok(selfCheckWarning('B9', [{ verdict: 'fail', text: 'the map painted whole' }], '66 of 75', step).startsWith('Your self-check fails 1 point and scores 66 under its target 75: the result check will fail that and make a fix step.'))
  // No target: a score alone is never under anything.
  const bare = { head: new Map([['Id', 'B9']]), sections: new Map([['What we build', ['- the map painted whole']]]) }
  assert.equal(selfCheckWarning('B9', pass, '10 of 75', bare), '')
})

test('a report again replaces the self-check (section and a new History line); the first stays in History', async () => {
  const store = await fresh()
  try {
    const id = await taken(store)
    assert.equal((await report(store, id, { points: ['pass: a lamp at every bench', 'fail: warm yellow light, never white'] })).ok, true)
    // The board's own check fails (the branch is still there): the step may be reported again.
    await store.server({ action: 'check', id, passed: false, lines: ['the branch b-lamps is still there'] })
    const again = await store.later(5 * 60_000, 'Lamplighter')({ action: 'report', id, result: 'Every path has a warm lamp, yellow now.', merged: 'c0ffee2', points: SELF, score: '80 of 75' })
    assert.equal(again.ok, true, again.why)
    const step = await item(store.dir, id)
    assert.deepEqual(step.sections.get('Self-check'), ['Score: 80 of 75', '- pass: a lamp at every bench', '- pass: warm yellow light, never white'])
    const lines = history(step).filter(one => one.includes('self-check'))
    assert.equal(lines.length, 2, history(step).join('\n'))
    assert.ok(lines[0].endsWith('self-check: 1 of 2 points pass'))
    assert.ok(lines[1].endsWith('self-check: 2 of 2 points pass, score 80 of 75'))
    assert.equal(selfCheckedSinceReport(step), true)
  } finally {
    await remove(store.dir)
  }
})

test('a fix step owes every fail text and every Makes pass line, as its check does: fewer points are refused with the check\'s words; a bad point line with the parser\'s', async () => {
  const store = await fresh()
  try {
    const id = await taken(store)
    assert.equal((await report(store, id, { points: SELF })).ok, true)
    await store.server({ action: 'check', id, passed: true, lines: ['work in garden', 'branch gone', 'result named'] })
    const filed = await fileCheck(store, id, { evidence: 'pictures/b2/evidence.png', points: ['pass: a lamp at every bench', 'fail: warm yellow light, never white (the bench lamps are white)'], score: '60 of 75' })
    assert.equal(filed.ok, true, filed.why)
    const fixId = filed.result.fix
    assert.ok(/^B\d+$/.test(fixId ?? ''), JSON.stringify(filed.result))
    const fix = await item(store.dir, fixId)
    assert.equal(owedPoints(fix).length, 2, (fix.sections.get('What we build') ?? []).join('\n'))
    assert.equal((await queueFor(store.dir, fixId, 'Lamplighter', { now: NOW + 60_000 })).ok, true)
    assert.equal((await store.lamplighter({ action: 'take', minutes: 30, id: fixId, branch: 'b-lamps-fix' })).ok, true)
    const few = await store.lamplighter({ action: 'report', id: fixId, result: 'The bench lamps are yellow now.', merged: 'c0ffee3', points: ['pass: the bench lamps are yellow'] })
    assert.deepEqual([few.ok, few.status], [false, 400])
    assert.equal(few.why, `${fixId} is a fix of ${id}: tick each of its 2 agreed points, every fail text and every "Makes pass" line of its What we build, not 1.`)
    const bad = await store.lamplighter({ action: 'report', id: fixId, result: 'The bench lamps are yellow now.', merged: 'c0ffee3', points: ['the bench lamps are yellow', 'pass: warm yellow light'] })
    assert.deepEqual([bad.ok, bad.status], [false, 400])
    assert.match(bad.why, /^"the bench lamps are yellow" is no point: write "pass: <point>", "fail: <point>" or "ask: <point>"/)
    const whole = await store.lamplighter({ action: 'report', id: fixId, result: 'The bench lamps are yellow now.', merged: 'c0ffee3', points: ['pass: warm yellow light, never white (the bench lamps are white): yellow now', 'pass: Makes pass: warm yellow light, never white'] })
    assert.equal(whole.ok, true, whole.why)
    assert.ok(history(await item(store.dir, fixId)).some(one => one.endsWith('Lamplighter: self-check: 2 of 2 points pass')))
  } finally {
    await remove(store.dir)
  }
})

test('chat 1\'s condition (b): a step whose Standard line has a target is refused a self-check without a score; with one it goes through', async () => {
  const store = await fresh()
  try {
    const id = await taken(store, { ...LAMP, standard: STANDARD })
    const step = await item(store.dir, id)
    assert.equal(targetOf(standardOf(step)), 75, (step.sections.get('Standard') ?? step.sections.get('Refined') ?? []).join('\n'))
    const none = await report(store, id, { points: SELF })
    assert.deepEqual([none.ok, none.status], [false, 400])
    assert.equal(none.why, `${id}'s standard has the target 75: give your self-check's score too ("score": "<n> of 75", the judges' middle score against the kind's definition of done), then report again.`)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'in progress')
    // The missing-points refusal comes first, and names the target.
    const noPoints = await report(store, id)
    assert.equal(noPoints.status, 400)
    assert.ok(noPoints.why.includes('("score": "<n> of 75")'), noPoints.why)
    const scored = await report(store, id, { points: SELF, score: '78 of 75' })
    assert.equal(scored.ok, true, scored.why)
    assert.ok(history(await item(store.dir, id)).some(one => one.endsWith('Lamplighter: self-check: 2 of 2 points pass, score 78 of 75')))
  } finally {
    await remove(store.dir)
  }
})

test('chat 1\'s condition (c): a long list of points is cut with "… and n more", each point at 160 characters, and the instruction survives', () => {
  const long = Array.from({ length: 30 }, (_, index) => `point ${index + 1}: ${'the lamps along the path shine warm and steady at dusk '.repeat(4).trim()}`)
  const lines = selfCheckPointLines(long)
  assert.ok(lines.length < long.length, String(lines.length))
  assert.match(lines.at(-1), /^… and \d+ more \(work next shows them all\)$/)
  assert.equal(lines.length - 1 + Number(lines.at(-1).match(/\d+/)[0]), long.length, 'every point is either listed or counted')
  assert.ok(lines.slice(0, -1).every(one => one.length <= 2 + 160), 'each point cut to 160')
  assert.ok(lines[0].endsWith('…'))
  const total = lines.slice(0, -1).reduce((sum, one) => sum + one.length - 2, 0)
  assert.ok(total <= SELF_CHECK_LIST_CHARS + 160, String(total))
  // Short lists stay whole; one long point alone is still listed, cut.
  assert.deepEqual(selfCheckPointLines(['a lamp at every bench']), ['- a lamp at every bench'])
  assert.deepEqual(selfCheckPointLines(['x'.repeat(2000)]), [`- ${'x'.repeat(159)}…`])
  const item30 = { head: new Map([['Id', 'B9']]), sections: new Map([['What we build', long.map(one => `- ${one}`)]]) }
  const words = selfCheckWanted('B9', item30)
  assert.ok(words.startsWith('Before reporting B9, check your own result'))
  assert.ok(words.length < 3000, String(words.length))
  assert.ok(words.includes('… and '))
})
