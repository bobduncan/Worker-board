// T9.1.1, the review's fixes to the supervisor (brief 2026-10-27): the repair `unchecked` gives the checker time to file its ask,
// drops a task nobody took whose step waits for something else, ends one whose check was filed, drops with no partner too, and
// stands still while the person pauses; the watch rules do not name a free builder as the worker a QA task waits for, and
// review-stuck is quiet while the task is ready or given. Made-up items; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { applySync } from '../../src/supervisor/loop.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { findStuck } from '../../src/supervisor/rules/repair.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { fresh, fileCheck, item as itemOf, items as itemsOf, qaOf, remove, reported, takeQa } from '../qaKit.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 27, 17, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
/** A step in review whose board check passed `minutes` ago, with an agreed point, and `more` History lines after it. */
const waiting = (id, minutes, more = [], head = {}) => item(
  { Id: id, Kind: 'step', Title: 'Show the damage', State: 'review', Owner: 'Worker 1', Since: stamp(ago(minutes + 3)), ...head },
  { 'What we build': ['- the damage shows'], History: [`- ${stamp(ago(minutes))} server: check passed: merged`, ...more] },
)
const waitsForYou = minutes => `- ${stamp(ago(minutes))} Worker 3: result check waits for you: 1 of 2 points pass; 1 for you to judge`
const passedLine = minutes => `- ${stamp(ago(minutes))} Worker 3: result check passed: 2 of 2 points pass`
const qa = (id, checks, state = 'refined', more = {}) => item({ Id: id, Kind: 'step', Title: `Quality Assurance: ${checks} Show the damage`, State: state, Checks: checks, 'Not by': 'Worker 1', Since: stamp(ago(4)), ...more })
const ask = (id, of, state, filedMinutesAgo) => item({ Id: id, Kind: 'ask', Title: 'Is it warm?', State: state, Of: of, Since: stamp(ago(filedMinutesAgo)), Filed: String(ago(filedMinutesAgo)) })
const PARTNER = { name: 'Partner', state: 'free', isRunning: true }
const stuck = (store, more = {}) => findStuck({ items: store, lanes: [], partner: PARTNER, now: NOW, outbox: [], ...more }).filter(one => one.check === 'unchecked')

test('2: the check waits for the person, then, past 30 minutes with no ask of the step, for a check again; an answered ask counts at once', () => {
  // The check with an ask point was filed 10 minutes ago and the checker's ask has not come: the repair makes nothing.
  assert.deepEqual(stuck(items(waiting('B701', 40, [waitsForYou(10)]))), [])
  // 31 minutes without an ask: the checker never asked; the check is due again, and the repair makes its task.
  assert.deepEqual(stuck(items(waiting('B701', 60, [waitsForYou(31)]))).map(one => one.fix), [{ do: 'qa', id: 'B701' }])
  // The checker's ask was filed 5 minutes after the check and answered: a check again at once.
  assert.deepEqual(stuck(items(waiting('B701', 40, [waitsForYou(10)]), ask('Q1', 'B701', 'answered', 5))).map(one => one.fix), [{ do: 'qa', id: 'B701' }])
  assert.deepEqual(stuck(items(waiting('B701', 40, [waitsForYou(10)]), ask('Q1', 'B701', 'withdrawn', 5))).map(one => one.fix), [{ do: 'qa', id: 'B701' }])
  // Open: the person's turn. An answered ask from before the check line does not count.
  assert.deepEqual(stuck(items(waiting('B701', 40, [waitsForYou(10)]), ask('Q1', 'B701', 'open', 5))), [])
  assert.deepEqual(stuck(items(waiting('B701', 40, [waitsForYou(10)]), ask('Q1', 'B701', 'answered', 20))), [])
})

test('2: an open QA task nobody took whose step waits for the person or a fix is dropped, with why; a task a worker holds is left to its worker', () => {
  const store = (task, ...more) => items(waiting('B701', 60, [waitsForYou(20)]), ask('Q1', 'B701', 'open', 15), task, ...more)
  for (const state of ['refined', 'queued']) {
    const found = stuck(store(qa('B730', 'B701', state)))
    assert.deepEqual(found.map(one => one.fix), [{ do: 'qa-drop', id: 'B730', why: 'B701 waits for your answer to its check, not for a check' }], state)
    assert.equal(found[0].text, 'B730 checks B701, but B701 waits for your answer to its check, not for a check: its QA task is dropped')
  }
  for (const state of ['taken', 'in progress']) assert.deepEqual(stuck(store(qa('B730', 'B701', state))), [], state)
  // An open fix: the step waits for it.
  const fixed = items(waiting('B701', 90, [`- ${stamp(ago(40))} Worker 3: result check failed: 0 of 2 points pass; fix B8 for Worker 1`]), item({ Id: 'B8', Kind: 'step', Title: 'Fix: a', State: 'queued', Owner: 'Worker 1', Since: stamp(ago(30)), 'Fix of': 'B701' }), qa('B730', 'B701'))
  assert.deepEqual(stuck(fixed).map(one => one.fix.why), ['B701 waits for its fix B8, not for a check'])
  // A task whose step does wait for a check stays.
  assert.deepEqual(stuck(items(waiting('B701', 40), qa('B730', 'B701'))), [])
})

test('6: no partner chat: nothing is made, but a QA task whose step left review is dropped all the same', () => {
  const done = item({ Id: 'B701', Kind: 'step', Title: 'x', State: 'done', Owner: 'Worker 1', Since: stamp(ago(30)) })
  assert.deepEqual(stuck(items(waiting('B702', 40)), { partner: null }), [])
  assert.deepEqual(stuck(items(done, qa('B730', 'B701', 'queued')), { partner: null }).map(one => one.fix), [{ do: 'qa-drop', id: 'B730', why: 'B701 is done' }])
  // The partner's presence changes only the making.
  assert.deepEqual(stuck(items(waiting('B702', 40), done, qa('B730', 'B701', 'queued'))).map(one => one.fix.do), ['qa', 'qa-drop'])
})

test('7: a QA task a worker holds whose step has a result check line newer than the take is ended, not dropped, whatever the step is now', () => {
  const taken = (state, minutes) => qa('B730', 'B701', state, { Owner: 'Worker 3', Since: stamp(ago(minutes)) })
  for (const state of ['taken', 'in progress']) {
    // The step is done (the check passed) and the task still open: ended.
    const done = waiting('B701', 60, [passedLine(5)], { State: 'done' })
    const found = stuck(items(done, taken(state, 20)))
    assert.deepEqual(found.map(one => one.fix), [{ do: 'qa-end', id: 'B730' }], state)
    assert.equal(found[0].key, `qa-end B730 B701 ${stamp(ago(5))}`)
    // Still in review (a check that waits for the person, a failed point): ended all the same.
    assert.deepEqual(stuck(items(waiting('B701', 60, [waitsForYou(5)]), ask('Q1', 'B701', 'open', 4), taken(state, 20))).map(one => one.fix), [{ do: 'qa-end', id: 'B730' }], state)
  }
  // The check is older than the take: the worker has not filed yet. Nothing, and a task nobody holds is not ended.
  assert.deepEqual(stuck(items(waiting('B701', 60, [passedLine(30)]), taken('in progress', 10))), [])
  assert.deepEqual(stuck(items(waiting('B701', 60, [passedLine(5)], { State: 'done' }), qa('B730', 'B701', 'queued', { Owner: 'Worker 3', Since: stamp(ago(20)) }))).map(one => one.fix.do), ['qa-drop'])
  // Without a check, a step that is done drops the task as before.
  assert.deepEqual(stuck(items(waiting('B701', 60, [], { State: 'done' }), taken('in progress', 20))).map(one => one.fix.do), ['qa-drop'])
})

test('11: while the person pauses the rule makes, ends and drops nothing, as the other repair rules', () => {
  const done = item({ Id: 'B701', Kind: 'step', Title: 'x', State: 'done', Owner: 'Worker 1', Since: stamp(ago(30)) })
  const store = items(waiting('B702', 40), done, qa('B730', 'B701', 'queued'), waiting('B703', 60, [passedLine(5)], { State: 'done' }), qa('B731', 'B703', 'in progress', { Owner: 'Worker 3', Since: stamp(ago(20)) }))
  assert.deepEqual(stuck(store).map(one => one.fix.do), ['qa', 'qa-drop', 'qa-end'])
  assert.deepEqual(stuck(store, { pause: { state: 'pausing', since: stamp(ago(5)) } }), [])
})

test('applySync: qa-end asks the work API for the end of the task; a refusal is for the main chat', async () => {
  const calls = []
  const findings = stuck(items(waiting('B701', 60, [passedLine(5)], { State: 'done' }), qa('B730', 'B701', 'in progress', { Owner: 'Worker 3', Since: stamp(ago(20)) })))
  const done = await applySync(findings, { apply: async body => { calls.push(body); return { ok: true, result: { id: body.id } } } })
  assert.deepEqual(calls, [{ action: 'qa-end', id: 'B730' }])
  assert.deepEqual(done.rows.map(row => [row.check, row.status, row.text]), [['unchecked', 'Fixed', 'B730: its QA task ended (its check was filed)']])
  const refused = await applySync(findings, { apply: async () => ({ ok: false, status: 409, why: 'B730 is done' }) })
  assert.deepEqual(refused.rows.map(row => row.status), ['For Main'])
})

test('7, through the real work API: the check is saved, the close fails; the board ends the task once, as done, by the board', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qaId = await qaOf(store, id)
    await takeQa(store, qaId)
    // The holder files the check ten minutes later, and the write of the task fails: the check is saved, the task stays open.
    const real = await import('node:fs/promises')
    const failing = { ...real, rename: (from, to) => (String(to).endsWith(`${qaId}.md`) ? Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })) : real.rename(from, to)) }
    const { workApi } = await import('../../src/work/api.mjs')
    const filed = await workApi({ chat: 'Checker', action: 'checked', id, evidence: 'none (test)', points: ['pass: a lamp at every bench', 'pass: warm yellow light, never white'] }, { ...store.ctx, now: store.ctx.now + 10 * MIN, fs: failing })
    assert.equal(filed.ok, true, filed.why)
    assert.ok(filed.result.qaWhy, 'the close failed and says so')
    assert.equal((await itemOf(store.dir, id)).head.get('State'), 'done')
    assert.equal((await itemOf(store.dir, qaId)).head.get('State'), 'in progress')
    // The repair finds it: ended, not dropped.
    const found = findStuck({ items: await itemsOf(store.dir), lanes: [], partner: PARTNER, now: store.ctx.now + 12 * MIN, outbox: [] }).filter(one => one.check === 'unchecked')
    assert.deepEqual(found.map(one => one.fix), [{ do: 'qa-end', id: qaId }])
    // Only the board asks for it; the answer ends the task as done, with the check in its History, written by the board.
    assert.equal((await store.checker({ action: 'qa-end', id: qaId })).ok, false)
    const ended = await store.later(12 * MIN)({ action: 'qa-end', id: qaId })
    assert.equal(ended.ok, true, ended.why)
    const task = await itemOf(store.dir, qaId)
    assert.equal(task.head.get('State'), 'done')
    const history = task.sections.get('History')
    assert.ok(history.some(one => /server: checked B\d+: 2 of 2 points pass$/.test(one)), history.join('\n'))
    assert.ok(history.at(-1).endsWith('server: review → done'))
    // The worker is free again, and the next run finds nothing.
    assert.match((await store.checker({ action: 'next' })).result.text, /^Nothing is yours, Checker/)
    assert.deepEqual(findStuck({ items: await itemsOf(store.dir), lanes: [], partner: PARTNER, now: store.ctx.now + 14 * MIN, outbox: [] }).filter(one => one.check === 'unchecked'), [])
    // Refused for a task nobody holds, a task whose step was not checked since the take, and a step that is no QA task.
    assert.equal((await store.later(12 * MIN)({ action: 'qa-end', id: qaId })).ok, false)
    assert.equal((await store.later(12 * MIN)({ action: 'qa-end', id })).ok, false)
    assert.equal((await store.later(12 * MIN)({ action: 'qa-end', id: 'Q9' })).ok, false)
  } finally {
    await remove(store.dir)
  }
})

// ---- the watch rules ----

const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, ...more })
const LEAD = lane('Lead', { isMain: true, state: 'working' })
// T8.5 step 6: a free worker is one free in its hand-over, on the sequence.
const free = (name, since = ago(40)) => lane(name, { state: 'free', onSequence: true, handover: { state: 'free', why: null, step: null }, report: { state: 'idle', since, background: false, at: ago(0) } })
const view = (more = {}) => buildView({
  state: { chats: more.chats ?? [LEAD], today: [], limits: {}, pause: more.pause ?? null, chatPrefix: '', readyList: more.readyList ?? null, wakeFailed: [], nobodyRuns: null },
  items: more.items ?? new Map(), outbox: more.outbox ?? [], repairs: [], mods: null, settings: more.settings ?? {}, now: more.now ?? NOW,
})
const rule = id => WATCH_RULES.find(one => one.id === id)
const check = (id, board, seen = new Map()) => rule(id).check(board, { seen, observed: [] })

test('3: a free worker named in a ready entry\'s notBy does not count as free for it; another free worker does', () => {
  const entry = (more = {}) => ({ id: 'B730', rank: -1, keptFor: null, keptUntil: null, pinned: null, prefers: null, notBy: ['Worker 1'], ...more })
  const board = (chats, rows = [entry()]) => view({ chats: [LEAD, ...chats], items: items(waiting('B701', 90), qa('B730', 'B701')), readyList: { ready: rows, held: [] } })
  const seen = new Map([['ready-while-free B730', ago(30)]])
  // The only free worker built the step: the task waits by design.
  assert.deepEqual(check('ready-while-free', board([free('Worker 1')]), seen), [])
  // A second worker is free and could have taken it: a case, naming that one only.
  const found = check('ready-while-free', board([free('Worker 1'), free('Worker 2')]), seen)
  assert.deepEqual(found.map(one => one.text), ['B730 ready for 30 min while Worker 2 is free'])
  // Any task without a notBy is as before.
  assert.equal(check('ready-while-free', board([free('Worker 1')], [{ id: 'B730', rank: -1, keptFor: null, keptUntil: null, pinned: null, prefers: null }]), seen).length, 1)
  // With the list's prefix and other letters.
  const prefixed = buildView({
    state: { chats: [LEAD, free('Team - Worker 1')], today: [], limits: {}, pause: null, chatPrefix: 'Team - ', readyList: { ready: [entry({ notBy: ['worker 1'] })], held: [] }, wakeFailed: [], nobodyRuns: null },
    items: items(waiting('B701', 90), qa('B730', 'B701')), outbox: [], repairs: [], mods: null, settings: {}, now: NOW,
  })
  assert.deepEqual(check('ready-while-free', prefixed, seen), [])
})

test('8: review-stuck is quiet while the step\'s QA task is ready or given and not taken; a task taken and not begun, or none, is a case; in progress is never late', () => {
  const task = (state, head = {}) => qa('B730', 'B701', state, { Since: stamp(ago(75)), ...head })
  const history = [`- ${stamp(ago(75))} server: made for the result check of B701`]
  const stuckOf = state => check('review-stuck', view({ items: items(waiting('B701', 300), { ...task(state), sections: new Map([['History', history]]) }) }))
  assert.deepEqual(stuckOf('refined'), [])
  assert.deepEqual(stuckOf('queued'), [])
  assert.deepEqual(stuckOf('in progress'), [])
  assert.deepEqual(stuckOf('taken').map(one => one.key), ['review-stuck B701 check'])
  // No task at all: the case as before.
  assert.equal(check('review-stuck', view({ items: items(waiting('B701', 300)) })).length, 1)
})
