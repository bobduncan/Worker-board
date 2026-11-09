// B1081 (2026-11-09): B934 sat in review with its fix B978 open (B978 waited for its own fix B1011, and B1011 for B1030, not
// built). Its builder reported B934 again at 10:42, thinking B978 was done; a report again starts the check over, so the board
// made the check task B1078, and after the main chat dropped it B1080, while `work checked` refused both: B934 has an open fix.
// The board's make and its refusal read an open fix differently. One rule now (resultCheck.mjs `openFixesOf`): a step with an
// open fix waits for that fix, a report again included; the board makes no check task for it and refuses a report again of it
// while its board check passed. Made-up chats; the step ids are the real case's.

import assert from 'node:assert/strict'
import test from 'node:test'

import { findStuck } from '../src/supervisor/rules/repair.mjs'
import { valueOf } from '../src/work/item.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { notDueWhy } from '../src/work/qaTask.mjs'
import { openFixesOf, reviewWaitOf } from '../src/work/resultCheck.mjs'
import { appendHistory, writeItem } from '../src/work/store.mjs'
import { NOW, fileCheck, fresh, item, items, openQa, remove, reported } from './qaKit.mjs'

const MIN = 60_000
const AT = new Date(2026, 10, 9, 10, 50).getTime()
const ago = minutes => AT - minutes * MIN
const line = (minutes, who, what) => `- ${stamp(ago(minutes))} ${who}: ${what}`
const POINTS = '## What we build\n- the lamps glow\n- a test for each lamp\n'
const step = (id, state, history, more = '') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: Worker 3\nActivity: Board\nSince: ${stamp(ago(300))}\n${more}\n## History\n${history.join('\n')}\n\n${POINTS}`)
const byId = (...all) => new Map(all.map(one => [valueOf(one, 'Id'), one]))
/** A step reported at `minutes` ago whose board check passed a minute later. */
const reportedAt = (minutes, who = 'Worker 3') => [line(minutes, who, 'in progress → review'), line(minutes, 'server', 'check pending'), line(minutes - 1, 'server', 'check passed: work in board')]
const failedWith = (minutes, fix) => line(minutes, 'Checker', `result check failed: 1 of 2 points pass; fix ${fix} for Worker 3`)

/** The real chain: B934 → B978 → B1011 (each in review, its check failed) → B1030 (refined, not built). */
function chain({ again = true, fixState = null } = {}) {
  const b934 = step('B934', 'review', [...reportedAt(240), failedWith(200, 'B978'),
    ...(again ? [line(8, 'Worker 3', 'reported again'), line(8, 'server', 'check pending'), line(7, 'server', 'check passed: work in board')] : [])])
  if (fixState === 'none') return byId(b934)
  const b978 = step('B978', fixState ?? 'review', [...reportedAt(150), failedWith(120, 'B1011')], 'Fix of: B934')
  if (fixState !== null) return byId(b934, b978)
  const b1011 = step('B1011', 'review', [...reportedAt(90), failedWith(60, 'B1030')], 'Fix of: B978')
  const b1030 = step('B1030', 'refined', [line(60, 'server', 'made for the fix of B1011')], 'Fix of: B1011')
  return byId(b934, b978, b1011, b1030)
}
const PARTNER = { name: 'Partner', state: 'working', isRunning: true }
const world = all => ({ items: all, lanes: [{ name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }], partner: PARTNER, helper: null, prefix: '', now: AT, outbox: [], limits: {}, pause: null, refused: [] })
const uncheckedOf = all => findStuck(world(all)).filter(one => one.check === 'unchecked')

test('B934 reported again at 10:42 with its fix B978 open: it waits for that fix, not for a first check', () => {
  const all = chain()
  assert.deepEqual(openFixesOf('B934', all), ['B978'])
  const wait = reviewWaitOf(all.get('B934'), all, null, AT)
  assert.equal(wait.kind, 'fix')
  assert.equal(wait.fix, 'B978')
  assert.deepEqual(wait.chain, ['B978', 'B1011', 'B1030'])
  assert.match(wait.text, /^waits for its fix B978\b/)
  // A QA task nobody took for it is not due: the repair drops it (B1080's case), and it asks for no new one.
  assert.match(notDueWhy(all.get('B934'), all, AT), /^waits for its fix B978\b.*, not for a check$/)
})

test('the repair rule unchecked asks for no QA task of B934, and drops one nobody took', () => {
  const all = chain()
  assert.deepEqual(uncheckedOf(all).filter(one => one.fix?.do === 'qa'), [])
  const b1080 = parseItem(`Id: B1080\nKind: step\nTitle: Quality Assurance: B934 Step B934\nState: refined\nActivity: Board\nSince: ${stamp(ago(3))}\nChecks: B934\nRefined: ready\n\n## History\n${line(3, 'server', 'made for the result check of B934')}\n`)
  all.set('B1080', b1080)
  const drops = uncheckedOf(all).filter(one => one.fix?.do === 'qa-drop')
  assert.equal(drops.length, 1)
  assert.equal(drops[0].fix.id, 'B1080')
  assert.match(drops[0].fix.why, /^B934 waits for its fix B978\b/)
})

test('a step with no open fix still gets its first check, and its check again once its fix is done', () => {
  // Reported once, no fix: its first check.
  const first = byId(step('B934', 'review', reportedAt(10)))
  assert.equal(reviewWaitOf(first.get('B934'), first, null, AT).text, 'waits for its first check')
  assert.equal(uncheckedOf(first).filter(one => one.fix?.do === 'qa').length, 1)
  // Its check failed and its fix is done: its check again.
  const fixed = chain({ again: false, fixState: 'done' })
  const again = reviewWaitOf(fixed.get('B934'), fixed, null, AT)
  assert.equal(again.kind, 'check')
  assert.equal(again.text, 'waits for its check again')
  assert.equal(uncheckedOf(fixed).filter(one => one.fix?.do === 'qa').length, 1)
  // Reported again with its fix done (or dropped): a check anew, as before.
  for (const state of ['done', 'dropped']) {
    const all = chain({ fixState: state })
    assert.equal(reviewWaitOf(all.get('B934'), all, null, AT).kind, 'check', state)
  }
})

/** The step reported and its check failed, so it has an open fix; `{ store, id, fix }`. */
async function withOpenFix() {
  const store = await fresh()
  const { id } = await reported(store)
  const failed = await fileCheck(store, id, { evidence: 'none (no picture)', points: ['pass: a lamp at every bench', 'fail: warm yellow light, never white'] })
  assert.equal(failed.ok, true, failed.why)
  const fix = failed.result.fix
  assert.match(fix, /^B\d+$/)
  assert.deepEqual(openFixesOf(id, await items(store.dir)), [fix])
  return { store, id, fix }
}

test('a report again of a step whose board check passed and whose fix is open is refused, naming the fix', async () => {
  const { store, id, fix } = await withOpenFix()
  try {
    const before = (await item(store.dir, id)).sections.get('History').length
    const again = await store.lamplighter({ action: 'report', id, result: 'Every path has a warm lamp now.', merged: 'c0ffee2' })
    assert.equal(again.ok, false)
    assert.equal(again.status, 409)
    assert.match(again.why, new RegExp(`^${id} waits for its fix ${fix}: do not report ${id} again; it closes by itself once ${fix} passes its check`))
    // Nothing written: no "reported again", no check pending.
    assert.equal((await item(store.dir, id)).sections.get('History').length, before)
    // The board makes no QA task for it either.
    const qa = await store.server({ action: 'qa-task', id })
    assert.equal(qa.ok, false)
    assert.match(qa.why, new RegExp(`waits for its fix ${fix}`))
  } finally {
    await remove(store.dir)
  }
})

test('a step whose board check failed may still be reported again, its fix open or not', async () => {
  const { store, id } = await withOpenFix()
  try {
    assert.equal((await store.server({ action: 'check', id, passed: false, lines: ['the branch b-lamps is still there'] })).ok, true)
    const again = await store.lamplighter({ action: 'report', id, result: 'Every path has a warm lamp; the branch is gone.', merged: 'c0ffee2' })
    assert.equal(again.ok, true, again.why)
  } finally {
    await remove(store.dir)
  }
})

test('the check path: a step reported again (as before this rule) with its fix open gets no QA task when its board check passes', async () => {
  const { store, id, fix } = await withOpenFix()
  try {
    // The report again as the board took it at 10:42 (now refused): its History says so, its check pending.
    let step = await item(store.dir, id)
    step = appendHistory(appendHistory(step, 'Lamplighter', 'reported again', NOW + 2 * MIN), 'server', 'check pending', NOW + 2 * MIN)
    assert.equal((await writeItem(store.dir, step)).ok, true)
    const passed = await store.server({ action: 'check', id, passed: true, lines: ['work in garden', 'branch gone'] })
    assert.equal(passed.ok, true, passed.why)
    assert.equal(passed.result.qa, undefined, 'no QA task made')
    assert.equal(passed.result.qaWhy, undefined, 'none tried')
    assert.equal(await openQa(store.dir, id), null)
    const all = await items(store.dir)
    assert.equal(reviewWaitOf(all.get(id), all, null, NOW + 3 * MIN).kind, 'fix')
    assert.equal(reviewWaitOf(all.get(id), all, null, NOW + 3 * MIN).fix, fix)
  } finally {
    await remove(store.dir)
  }
})

test('the check path: a step reported once with no fix gets its QA task when its board check passes', async () => {
  const store = await fresh()
  try {
    const { id, git } = await reported(store)
    assert.equal(git.ok, true, git.why)
    assert.match(git.result.qa, /^B\d+$/)
    assert.notEqual(await openQa(store.dir, id), null)
  } finally {
    await remove(store.dir)
  }
})

test('the task maker itself: the person\'s answer to an ask point makes no QA task while a fix of the step is open', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const checked = await fileCheck(store, id, { evidence: 'none (no picture)', points: ['pass: a lamp at every bench', 'ask: warm yellow light, never white'] })
    assert.equal(checked.ok, true, checked.why)
    const asked = await store.checker({ action: 'ask', of: id, kind: 'look', blocking: false, title: 'Is the light warm yellow?', text: 'Look at the lamps.' })
    assert.equal(asked.ok, true, asked.why)
    // A fix of the step made by hand meanwhile, still open (as B978 was): the step waits for it.
    const fix = parseItem(`Id: B90\nKind: step\nTitle: Fix: warm the light\nState: refined\nActivity: Lamps\nSince: ${stamp(NOW)}\nFix of: ${id}\nRefined: ready\n\n## History\n- ${stamp(NOW)} Keeper: made\n\n${POINTS}`)
    assert.equal((await writeItem(store.dir, fix)).ok, true)
    // Words the board cannot read as yes or no would make a QA task; with the fix open it makes none, and says why.
    const done = await store.person({ action: 'answer', id: asked.result.id, text: 'Warm, but a bit more orange' })
    assert.equal(done.ok, true, done.why)
    assert.equal(done.result.qa, undefined, 'no QA task made')
    assert.match(done.result.qaWhy, new RegExp(`^${id} waits for its fix B90: no Quality Assurance task while it is open`))
    assert.equal(await openQa(store.dir, id), null)
  } finally {
    await remove(store.dir)
  }
})
