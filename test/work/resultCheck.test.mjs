// B356: a step with agreed points ("What we build") or a Standard line becomes done only after a worker that did not
// build it checked the result (T9.1.1: it holds the step's Quality Assurance task) and filed it with `checked` (the evidence
// picture, every point pass, fail or ask, the score). A failed point makes a fix step for the same worker; the step stays in review until its fix is done
// and checked. A step without agreed points keeps the board's own check alone. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { queueFor } from '../queueFor.mjs'
import { checkedBy } from '../qaKit.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { needsResultCheck } from '../../src/work/resultCheck.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 19, 9, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Lamps', '- [ ] B1 Trim the wicks (for Lamplighter; about 1 h)', ''].join('\n')
const ROLES = { Keeper: 'main', Lamplighter: 'worker', Checker: 'worker', Partner: 'advisor' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-result-check-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: '', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Lamplighter']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  const server = body => workApi(body, { ...ctx, as: 'server' })
  // T9.1.1: the result check is filed by the worker that holds the step's QA task (a worker that did not build it).
  return { dir, ctx, lamplighter: as('Lamplighter'), checker: as('Checker'), keeper: as('Keeper'), partner: as('Partner'), server, checks: (id, body) => checkedBy({ as, server, dir, now: ctx.now }, id, body) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const LAMP = { action: 'new', title: 'Light the garden lamps', activity: 'Lamps', goal: 'G3', text: 'Warm light on every path.', summary: 'Every path has a warm lamp.', size: '1 h', what: ['a lamp at every bench', 'warm yellow light, never white', 'Not in it: new paths'] }

/** B2, made from the agreed how, queued for the Lamplighter, taken, reported and its git check passed. */
async function reported(store, gitPassed = true) {
  const made = await store.partner(LAMP)
  assert.equal(made.ok, true, made.why)
  const id = made.result.id
  assert.equal((await queueFor(store.dir, id, 'Lamplighter', { now: NOW + 60_000 })).ok, true)
  assert.equal((await store.lamplighter({ action: 'take', minutes: 30, id, branch: 'b2-lamps' })).ok, true)
  assert.equal((await store.lamplighter({ action: 'report', id, result: 'Every path has a warm lamp.', merged: 'c0ffee1' })).ok, true)
  const git = await store.server({ action: 'check', id, passed: gitPassed, lines: gitPassed ? ['work in garden', 'branch gone', 'result named'] : ['the branch b2-lamps is still there'] })
  return { id, git }
}

test('a step with agreed points or a Standard line needs the result check; one without keeps the board\'s check alone', async () => {
  const store = await fresh()
  try {
    const { id, git } = await reported(store)
    assert.equal(needsResultCheck(await item(store.dir, id)), true)
    assert.equal(needsResultCheck(await item(store.dir, 'B1')), false)
    // The board's own check passed: the step waits in review, and the board makes its Quality Assurance task (T9.1.1).
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
    assert.equal(git.result.resultCheck, undefined)
    assert.equal(valueOf(await item(store.dir, git.result.qa), 'Checks'), id)
    // A step without agreed points is done by the board's check, as before.
    await store.lamplighter({ action: 'take', minutes: 30, id: 'B1', branch: 'b1-wicks' })
    await store.lamplighter({ action: 'report', id: 'B1', result: 'The wicks are trimmed.', merged: 'abc1234' })
    const plain = await store.server({ action: 'check', id: 'B1', passed: true, lines: ['branch gone'] })
    assert.equal(plain.result.resultCheck, undefined)
    assert.equal(valueOf(await item(store.dir, 'B1'), 'State'), 'done')
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('every point passes: the checker\'s checked closes the step, with the evidence, the ticks and the score kept on it', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const checked = await store.checks(id, { evidence: 'pictures/b2/evidence.png', points: ['pass: a lamp at every bench', 'pass: warm yellow light, never white'], score: '82 of 75' })
    assert.equal(checked.ok, true, checked.why)
    const step = await item(store.dir, id)
    assert.equal(valueOf(step, 'State'), 'done')
    assert.deepEqual(step.sections.get('Checked'), ['Evidence: pictures/b2/evidence.png', 'Score: 82 of 75', '- pass: a lamp at every bench', '- pass: warm yellow light, never white'])
    assert.ok(step.sections.get('History').some(one => one.endsWith('Checker: result check passed: 2 of 2 points pass, score 82 of 75')))
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a result check that passed before the board\'s own check of a new report waits for it: the step is done once both passed', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    // The Checker holds the QA task when the builder reports again: the board's check is pending, then the check is filed.
    const qa = (await store.server({ action: 'qa-task', id })).result.id
    await queueFor(store.dir, qa, 'Checker', { now: NOW + 60_000 })
    assert.equal((await store.checker({ action: 'take', minutes: 30, id: qa })).ok, true)
    assert.equal((await store.lamplighter({ action: 'report', id, result: 'Every path has a warm lamp, warmer.', merged: 'c0ffee2' })).ok, true)
    const filed = await store.checker({ action: 'checked', size: '30 min', id, evidence: 'none (nothing to see)', points: ['pass: a lamp at every bench'] })
    assert.equal(filed.ok, true, filed.why)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
    const again = await store.server({ action: 'check', id, passed: true, lines: ['branch gone'] })
    assert.equal(again.result.resultCheck, undefined)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'done')
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a failed point makes a fix step, refined from the failed points, on the list as a follow-up of the same worker; the step waits for it', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const checked = await store.checks(id, { evidence: 'pictures/b2/evidence.png', points: ['pass: a lamp at every bench', 'fail: warm yellow light, never white (two lamps are white)'], score: '61 of 75' })
    assert.equal(checked.ok, true, checked.why)
    const fixId = checked.result.fix
    assert.match(fixId, /^B\d+$/)
    const origin = await item(store.dir, id)
    assert.deepEqual([valueOf(origin, 'State'), valueOf(origin, 'Attempts')], ['review', '1'])
    const fix = await item(store.dir, fixId)
    assert.deepEqual(['Title', 'State', 'Owner', 'Activity', 'Goal', 'Fix of', 'Refined'].map(key => valueOf(fix, key)),
      ['Fix: warm yellow light, never white', 'refined', null, 'Lamps', 'G3', id, 'ready'])
    // B526: under the fail, the step's agreed point it must make pass.
    assert.deepEqual(fix.sections.get('What we build'), ['- warm yellow light, never white (two lamps are white)', '- Makes pass: warm yellow light, never white'])
    assert.ok(origin.sections.get('History').some(one => one.includes(`Checker: result check failed: 1 of 2 points pass, score 61 of 75; fix ${fixId} for Lamplighter`)))
    // The fix is done and checked: the step it fixes is done too.
    await queueFor(store.dir, fixId, 'Lamplighter', { now: NOW + 60_000 })
    await store.lamplighter({ action: 'take', minutes: 30, id: fixId, branch: 'b-fix-lamps' })
    await store.lamplighter({ action: 'report', id: fixId, result: 'All lamps are warm yellow.', merged: 'beef123' })
    await store.server({ action: 'check', id: fixId, passed: true, lines: ['branch gone'] })
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
    const fixed = await store.checks(fixId, { evidence: 'pictures/fix/evidence.png', points: ['pass: the two lamps are yellow', 'pass: warm yellow light, never white'] })
    assert.equal(fixed.ok, true, fixed.why)
    assert.equal(valueOf(await item(store.dir, fixId), 'State'), 'done')
    const after = await item(store.dir, id)
    assert.equal(valueOf(after, 'State'), 'done')
    assert.ok(after.sections.get('History').some(one => one.endsWith(`server: result check passed: its fix ${fixId} is done`)))
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a point only the person can judge (ask) makes no fix step: the step waits in review for the partner\'s ask', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const checked = await store.checks(id, { evidence: 'pictures/b2/evidence.png', points: ['pass: a lamp at every bench', 'ask: warm yellow light, never white (is this yellow warm enough?)'] })
    assert.equal(checked.ok, true, checked.why)
    assert.equal(checked.result.fix, undefined)
    const step = await item(store.dir, id)
    assert.equal(valueOf(step, 'State'), 'review')
    assert.ok(step.sections.get('History').some(one => one.endsWith('Checker: result check waits for you: 1 of 2 points pass; 1 for you to judge')))
    assert.equal([...(await readStore(store.dir)).items.values()].filter(one => valueOf(one, 'Fix of') === id).length, 0)
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('only the worker that holds the QA task files a check, of a step in review, with every point as pass, fail or ask', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const point = ['pass: a lamp at every bench']
    // Its QA task is given to the Checker and taken; nobody else may file.
    assert.equal((await store.server({ action: 'qa-task', id })).ok, true)
    assert.equal((await store.lamplighter({ action: 'checked', size: '30 min', id, evidence: 'x.png', points: point })).status, 403)
    assert.equal((await store.partner({ action: 'checked', size: '30 min', id, evidence: 'x.png', points: point })).status, 403)
    const qa = (await store.server({ action: 'qa-task', id })).result.id
    await queueFor(store.dir, qa, 'Checker', { now: NOW + 60_000 })
    assert.equal((await store.checker({ action: 'take', minutes: 30, id: qa })).ok, true)
    assert.equal((await store.checker({ action: 'checked', size: '30 min', id, evidence: 'x.png', points: [] })).status, 400)
    assert.equal((await store.checker({ action: 'checked', size: '30 min', id, evidence: 'x.png', points: ['maybe: a lamp'] })).status, 400)
    assert.equal((await store.checker({ action: 'checked', size: '30 min', id, points: point })).status, 400)
    // A step that is not in review has no QA task for the Checker to hold.
    assert.equal((await store.checker({ action: 'checked', size: '30 min', id: 'B1', evidence: 'x.png', points: point })).status, 403)
    assert.equal((await store.server({ action: 'checked', size: '30 min', id: 'B1', evidence: 'x.png', points: point })).status, 409)
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('T9.1.1: no word "check step" goes to the Advisor: the board makes the Quality Assurance task itself', async () => {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../../server.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(server, /askResultCheck|checkStepWords|result\.resultCheck/)
  const say = await readFile(new URL('../../src/say.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(say, /checkStepWords/)
})

test('a board without a partner chat makes no result check: its own check closes a step with agreed points, as before', async () => {
  const store = await fresh()
  try {
    const made = await store.partner(LAMP)
    const id = made.result.id
    await queueFor(store.dir, id, 'Lamplighter', { now: NOW + 60_000 })
    await store.lamplighter({ action: 'take', minutes: 30, id, branch: 'b2-lamps' })
    await store.lamplighter({ action: 'report', id, result: 'Warm lamps.', merged: 'c0ffee1' })
    const ctx = { dir: store.dir, now: NOW + 60_000, prefix: '', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Lamplighter']), hasPartner: false, as: 'server' }
    const git = await workApi({ action: 'check', id, passed: true, lines: ['branch gone'] }, ctx)
    assert.equal(git.result.resultCheck, undefined)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'done')
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

/** B2 reported, its git check passed, and its result check failed: its fix is made, on the list for the Lamplighter first. */
async function failed(store) {
  const { id } = await reported(store)
  const checked = await store.checks(id, { evidence: 'pictures/b2/evidence.png', points: ['pass: a lamp at every bench', 'fail: warm yellow light, never white'] })
  return { id, fixId: checked.result.fix }
}

test('the review: a fix closed by any way (the person\'s tick, then the board\'s move) lets the step it fixes be done', async () => {
  const store = await fresh()
  try {
    const { id, fixId } = await failed(store)
    // A second check while the fix is open is refused: one fix at a time.
    const twice = await store.server({ action: 'checked', size: '30 min', id, evidence: 'x.png', points: ['fail: warm yellow light'] })
    assert.deepEqual([twice.status, twice.why], [409, `${id} has an open fix, ${fixId}: check that one once it is reported; the board asks for ${id} again after it, when ${id} is not done with it.`])
    const person = body => workApi(body, { dir: store.dir, now: NOW + 120_000, prefix: '', roleOf: () => null, as: 'person' })
    assert.equal((await person({ action: 'tick', id: fixId, line: 'Done by you.' })).ok, true)
    assert.equal(valueOf(await item(store.dir, fixId), 'State'), 'done')
    // The board's own move (the reconciler's): the guard holds now that every fix is through.
    const advanced = await store.server({ action: 'advance', id, to: 'done' })
    assert.equal(advanced.ok, true, advanced.why)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'done')
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the review: a fix that was only dropped does not pass the step, and makes no QA task: a dropped fix is the partner\'s incident, not a check', async () => {
  const store = await fresh()
  try {
    const { id, fixId } = await failed(store)
    assert.equal((await store.keeper({ action: 'drop', id: fixId, why: 'not needed' })).ok, true)
    assert.equal((await store.server({ action: 'advance', id, to: 'done' })).ok, false)
    const none = await store.server({ action: 'qa-task', id })
    assert.deepEqual([none.ok, none.status], [false, 409])
    const again = await store.partner({ action: 'checked', size: '30 min', id, evidence: 'pictures/b2/evidence.png', points: ['pass: a lamp at every bench', 'pass: warm yellow light, never white'] })
    assert.deepEqual([again.ok, again.status], [false, 403])
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the review: a report anew asks for a result check anew; the History is read by its words, whoever wrote it', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const first = (await store.server({ action: 'qa-task', id })).result.id
    await store.checks(id, { evidence: 'x.png', points: ['ask: warm enough?'] })
    const again = await store.lamplighter({ action: 'report', id, result: 'Warmer lamps now.', merged: 'c0ffee2' })
    assert.equal(again.ok, true, again.why)
    const git = await store.server({ action: 'check', id, passed: true, lines: ['branch gone'] })
    // The first task ended with the first check: the new report gets a task of its own.
    assert.match(git.result.qa, /^B\d+$/)
    assert.notEqual(git.result.qa, first)
    const { resultCheckOf } = await import('../../src/work/resultCheck.mjs')
    // The second review: only the words right after who wrote the line count, so free words cannot fake a check.
    const faked = { sections: new Map([['History', ['- 2026-10-19 09:00 Keeper: no longer waits for: result check passed by hand']]]) }
    assert.equal(resultCheckOf(faked), null)
    const written = { sections: new Map([['History', ['- 2026-10-19 09:00 Checker: result check passed: 1 of 1 points pass']]]) }
    assert.equal(resultCheckOf(written), 'passed')
    // "Not in it" lines and a Standard of none ask for no check.
    const { needsResultCheck } = await import('../../src/work/resultCheck.mjs')
    assert.equal(needsResultCheck({ sections: new Map([['What we build', ['- Not in it: new paths']], ['Standard', ['none (a board fix)']]]) }), false)
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the second review: a fix of an earlier round counts for nothing; the fix that a check made must be done', async () => {
  const store = await fresh()
  try {
    const { id, fixId } = await failed(store)
    // Round one's fix is done by the person's tick; the worker reports the step again, and its new check fails.
    const person = body => workApi(body, { dir: store.dir, now: NOW + 120_000, prefix: '', roleOf: () => null, as: 'person' })
    await person({ action: 'tick', id: fixId, line: 'Done by you.' })
    await store.lamplighter({ action: 'report', id, result: 'Warmer now.', merged: 'c0ffee2' })
    await store.server({ action: 'check', id, passed: true, lines: ['branch gone'] })
    const round2 = await store.checks(id, { evidence: 'x.png', points: ['fail: a lamp at every bench'] })
    assert.equal(round2.ok, true, round2.why)
    // Its fix is dropped: round one's done fix does not close the step.
    assert.equal((await store.keeper({ action: 'drop', id: round2.result.fix, why: 'not now' })).ok, true)
    assert.equal((await store.server({ action: 'advance', id, to: 'done' })).ok, false)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the second review: a fix done while a point still waits for the person asks the partner for the step again', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const checked = await store.checks(id, { evidence: 'x.png', points: ['fail: a lamp at every bench', 'ask: warm enough?'] })
    const fixId = checked.result.fix
    await queueFor(store.dir, fixId, 'Lamplighter', { now: NOW + 60_000 })
    await store.lamplighter({ action: 'take', minutes: 30, id: fixId, branch: 'b-fix' })
    await store.lamplighter({ action: 'report', id: fixId, result: 'Lamps at every bench.', merged: 'beef123' })
    await store.server({ action: 'check', id: fixId, passed: true, lines: ['branch gone'] })
    const fixed = await store.checks(fixId, { evidence: 'y.png', points: ['pass: a lamp at every bench', 'pass: makes pass a lamp at every bench'] })
    assert.equal(fixed.ok, true, fixed.why)
    assert.match(fixed.result.qa, /^B\d+$/)
    assert.equal(valueOf(await item(store.dir, fixed.result.qa), 'Checks'), id)
    assert.ok((await item(store.dir, fixed.result.qa)).sections.get('Context').some(line => line.trim() === `Why: its fix ${fixId} is done: file its check again`))
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
    // The partner checks it again, the person's point now judged: the step is done.
    const again = await store.checks(id, { evidence: 'x.png', points: ['pass: a lamp at every bench', 'pass: warm enough'] })
    assert.equal(again.ok, true, again.why)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'done')
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B381: a failed point\'s full text, over a thousand characters, stands in the fix step\'s What we build and Context', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const long = `warm yellow light, never white: ${'the lamp by the gate and the two by the pond still glow white at dusk, and the docs say nothing of the colour; '.repeat(10)}end of the point`
    assert.ok(long.length > 1000)
    const checked = await store.checks(id, { evidence: 'pictures/b2/evidence.png', points: ['pass: a lamp at every bench', `fail: ${long}`] })
    assert.equal(checked.ok, true, checked.why)
    const fix = await item(store.dir, checked.result.fix)
    assert.deepEqual(fix.sections.get('What we build'), [`- ${long}`, '- Makes pass: warm yellow light, never white'])
    assert.ok(fix.sections.get('Context').some(one => one.trim() === `- ${long}`), 'the Context holds the point whole')
    assert.ok(fix.sections.get('Refined').some(one => one.trim() === `- ${long}`), 'the refine block holds it whole')
    // Its title stays short.
    assert.ok(valueOf(fix, 'Title').length <= 110)
    // The step it fixes keeps the point whole in its check too.
    assert.ok((await item(store.dir, id)).sections.get('Checked').includes(`- fail: ${long}`))
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('worktree clean-up: a result check is filed only once its own check-<id> worktrees are gone', async () => {
  let left = ['the worktree /projects/check-b2 is still there: git worktree remove /projects/check-b2, then delete the empty folder Windows may leave']
  const asked = []
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qa = (await store.server({ action: 'qa-task', id })).result.id
    await queueFor(store.dir, qa, 'Checker', { now: NOW + 60_000 })
    assert.equal((await store.checker({ action: 'take', minutes: 30, id: qa })).ok, true)
    const ctx = { ...store.ctx, checkWorktrees: async one => { asked.push(one); return left } }
    const body = { chat: 'Checker', action: 'checked', id, evidence: 'none (nothing to see)', points: ['pass: a lamp at every bench', 'pass: warm yellow light, never white'] }
    const refused = await workApi(body, ctx)
    assert.deepEqual([refused.ok, refused.status], [false, 409])
    assert.equal(refused.why, `${id}'s check left its worktrees: ${left[0]}. Remove them, then file checked again.`)
    // Nothing was filed: the step waits in review, with no check kept on it, and the QA task is still in progress.
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
    assert.equal((await item(store.dir, id)).sections.get('Checked'), undefined)
    assert.equal(valueOf(await item(store.dir, qa), 'State'), 'in progress')
    // A look that fails is a refusal too, never a pass.
    const broken = await workApi(body, { ...ctx, checkWorktrees: async () => { throw new Error('the disk did not answer') } })
    assert.equal(broken.why, `${id}'s check left its worktrees: the board could not look for them (the disk did not answer). Remove them, then file checked again.`)
    left = []
    const filed = await workApi(body, ctx)
    assert.equal(filed.ok, true, filed.why)
    assert.equal(valueOf(await item(store.dir, id), 'State'), 'done')
    assert.equal(valueOf(await item(store.dir, qa), 'State'), 'done')
    assert.deepEqual(asked, [id, id])
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
