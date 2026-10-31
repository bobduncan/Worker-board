// B656, the fix of X8 when it came back: 16 steps in review, most of them links of chains of fixes at work (by design),
// one behind a fix the board did not hand out (its step waited in review behind a refined fix the ready list held) while
// its line said only "waits for its fix". A step in review whose chain of fixes ends in a held fix says so and why; the
// watch rule `review-held` names one such chain once; a chain whose fix is at work is no case, however deep; the health
// summary counts chains, not steps. Made-up items; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildView } from '../../src/supervisor/view.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { CHOICE_WHY } from '../../src/work/handOut.mjs'
import { openFixChain, reviewWaitOf } from '../../src/work/resultCheck.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { workApi } from '../../src/work/api.mjs'
import { reviewWaitOfStep } from '../../src/work/read.mjs'
import { writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 25, 20, 30).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const passed = minutes => `- ${stamp(ago(minutes))} server: check passed: merged`
const failed = (minutes, fix) => `- ${stamp(ago(minutes))} Checker: result check failed: 5 of 7 points pass; fix ${fix} for Painter`
/** A step in review whose board check passed and whose result check failed and made the fix `fix`. */
const reviewed = (id, minutes, fix, head = {}) => item(
  { Id: id, Kind: 'step', Title: `Step ${id}`, State: 'review', Owner: 'Painter', Since: stamp(ago(minutes)), ...head },
  { 'What we build': ['- a lamp at every bench'], History: [passed(minutes), ...(fix === null ? [] : [failed(minutes - 5, fix)])] },
)
const fixStep = (id, of, state, minutes, head = {}) => item({ Id: id, Kind: 'step', Title: `Fix: ${of}`, State: state, Owner: 'Painter', Since: stamp(ago(minutes)), 'Fix of': of, ...head })

/** B603 behind its fix B614: refined 80 min ago, outside the focus goal, so the ready list holds it. */
const HELD_STORE = items(reviewed('B603', 120, 'B614'), fixStep('B614', 'B603', 'refined', 80, { Refined: 'ready' }))
const HELD = [{ id: 'B614', why: CHOICE_WHY, choice: true }]
/** B617 to B655: each check failed and made the next its fix; the last is in progress. A chain at work. */
const AT_WORK = items(
  reviewed('B617', 250, 'B631'),
  reviewed('B631', 200, 'B641', { 'Fix of': 'B617' }),
  reviewed('B641', 150, 'B655', { 'Fix of': 'B631' }),
  fixStep('B655', 'B641', 'in progress', 100),
)

const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const PAINTER = { name: 'Painter', isMain: false, isLeftover: false, state: 'working', isRunning: true }
const view = (store, held, more = {}) => buildView({
  state: { chats: [LEAD, PAINTER], today: [], limits: {}, pause: more.pause ?? null, chatPrefix: '', ...(held === undefined ? {} : { readyList: { ready: [], held } }) },
  items: store, outbox: [], settings: more.settings ?? {}, seen: more.seen ?? null, now: NOW,
})
const watch = (board, seen = new Map()) => WATCH_RULES.find(one => one.id === 'review-held').check(board, { seen, observed: [] })

test('reviewWaitOf: a fix the ready list holds says so and why; without the list, as before', () => {
  const wait = reviewWaitOf(HELD_STORE.get('B603'), HELD_STORE, HELD)
  assert.equal(wait.text, 'waits for its fix B614, held: outside the focus goal')
  assert.deepEqual([wait.kind, wait.fix, wait.end, wait.chain, wait.held], ['fix', 'B614', 'B614', ['B614'], CHOICE_WHY])
  // The list as a Map reads the same; a why of another kind stands whole.
  assert.equal(reviewWaitOf(HELD_STORE.get('B603'), HELD_STORE, new Map([['B614', 'waits for the answer to Q408']])).text, 'waits for its fix B614, held: waits for the answer to Q408')
  // No list, or the list does not hold it: the line of B543.
  assert.equal(reviewWaitOf(HELD_STORE.get('B603'), HELD_STORE).text, 'waits for its fix B614')
  assert.equal(reviewWaitOf(HELD_STORE.get('B603'), HELD_STORE, []).held, null)
  // A fix at work is never held, whatever a stale list says.
  const queued = items(reviewed('B603', 120, 'B614'), fixStep('B614', 'B603', 'queued', 80))
  assert.equal(reviewWaitOf(queued.get('B603'), queued, HELD).text, 'waits for its fix B614')
})

test('openFixChain: the open fixes followed down; a held fix at the end of a deep chain names the chain', () => {
  assert.deepEqual(openFixChain('B617', AT_WORK), ['B631', 'B641', 'B655'])
  assert.deepEqual(openFixChain('B655', AT_WORK), [])
  assert.deepEqual(['B617', 'B631', 'B641'].map(id => reviewWaitOf(AT_WORK.get(id), AT_WORK, HELD).text),
    ['waits for its fix B631', 'waits for its fix B641', 'waits for its fix B655'])
  const deep = items(reviewed('B7', 200, 'B8'), reviewed('B8', 150, 'B9', { 'Fix of': 'B7' }), fixStep('B9', 'B8', 'refined', 90, { Refined: 'ready' }))
  const why = [{ id: 'B9', why: 'blocked by B5 (in progress)' }]
  assert.equal(reviewWaitOf(deep.get('B7'), deep, why).text, 'waits for its fix B8, whose fix B9 is held: blocked by B5 (in progress)')
  assert.equal(reviewWaitOf(deep.get('B8'), deep, why).text, 'waits for its fix B9, held: blocked by B5 (in progress)')
  // A loop of fixes ends the chain.
  const loop = items(reviewed('B1', 90, 'B2'), reviewed('B2', 60, 'B1', { 'Fix of': 'B1' }))
  assert.deepEqual(openFixChain('B1', loop), ['B2'])
})

test('review-held: a chain behind a held fix for over the review minutes is one case; a chain at work is none', () => {
  // The board has seen the hold for 80 min (its why in the key): one case, however long ago the fix moved to refined.
  const key = `review-held B614 ${CHOICE_WHY}`
  const found = watch(view(HELD_STORE, HELD), new Map([[key, ago(80)]]))
  assert.deepEqual(found.map(one => [one.rule, one.key, one.subject]), [['review-held', key, 'B603']])
  assert.equal(found[0].text, `B603 in review behind its fix B614, held 80 min: ${CHOICE_WHY}`)
  assert.match(found[0].evidence, /^the chain B603 → B614; the ready list has held B614 since \d\d:\d\d: outside the focus goal/)
  // Under the review minutes, no ready list in the view, the person's pause: nothing.
  assert.deepEqual(watch(view(HELD_STORE, HELD, { settings: { reviewMinutes: 90 } }), new Map([[key, ago(80)]])), [])
  assert.deepEqual(watch(view(HELD_STORE, undefined), new Map([[key, ago(80)]])), [])
  assert.deepEqual(watch(view(HELD_STORE, HELD, { pause: { state: 'pausing', since: stamp(ago(5)) } }), new Map([[key, ago(80)]])), [])
  // B617 to B655, the fix in progress: none, however deep.
  assert.deepEqual(watch(view(AT_WORK, HELD)), [])
  // A deep chain behind one held fix: one case, named by its first step.
  const deep = items(reviewed('B7', 200, 'B8'), reviewed('B8', 150, 'B9', { 'Fix of': 'B7' }), fixStep('B9', 'B8', 'refined', 90, { Refined: 'ready' }))
  const why = 'blocked by B5 (in progress)'
  const deepFound = watch(view(deep, [{ id: 'B9', why }]), new Map([[`review-held B9 ${why}`, ago(90)]]))
  assert.deepEqual(deepFound.map(one => [one.key, one.subject]), [[`review-held B9 ${why}`, 'B7']])
  assert.match(deepFound[0].evidence, /^the chain B7 → B8 → B9;/)
})

test('review-held (B660, X59): an open ask of the person is no case; the time counts from this hold, not from the Since of the fix', () => {
  // B603 behind B614, held for the answer to Q408 for 234 min: the ask is the person's already, so no case.
  const ASK = [{ id: 'B614', why: 'waits for the answer to Q408' }]
  assert.deepEqual(watch(view(HELD_STORE, ASK), new Map([['review-held B614 waits for the answer to Q408', ago(234)]])), [])
  assert.deepEqual(watch(view(HELD_STORE, [{ id: 'B614', why: 'waits for the answer to Q408, Q409' }]), new Map()), [])
  // The partner's part of a refine question (the answer is in, not folded in) is not the person's: a case.
  const FOLD = 'waits for the partner to fold in the answer to Q408'
  assert.equal(watch(view(HELD_STORE, [{ id: 'B614', why: FOLD }]), new Map([[`review-held B614 ${FOLD}`, ago(70)]])).length, 1)
  // Held outside the focus goal for over the review minutes: a case (the fix refined 80 min ago, seen for 70).
  assert.equal(watch(view(HELD_STORE, HELD), new Map([[`review-held B614 ${CHOICE_WHY}`, ago(70)]])).length, 1)
  // The fix moved to refined 80 min ago (the Since), but the board saw this hold 5 min ago (a blocker cleared before):
  // not held long enough. A rule that counts from the Since reads 80 min and is red here.
  assert.deepEqual(watch(view(HELD_STORE, HELD), new Map([[`review-held B614 ${CHOICE_WHY}`, ago(5)]])), [])
  assert.deepEqual(watch(view(HELD_STORE, HELD)), [])
  // A hold whose why changed counts from the change: seen 234 min under another why, 10 min under this one.
  const BLOCKED = 'blocked by B623 (in progress)'
  const changed = new Map([['review-held B614 waits for the answer to Q408', ago(234)], [`review-held B614 ${BLOCKED}`, ago(10)]])
  assert.deepEqual(watch(view(HELD_STORE, [{ id: 'B614', why: BLOCKED }]), changed), [])
  changed.set(`review-held B614 ${BLOCKED}`, ago(75))
  assert.equal(watch(view(HELD_STORE, [{ id: 'B614', why: BLOCKED }]), changed)[0].text, `B603 in review behind its fix B614, held 75 min: ${BLOCKED}`)
})

test('the health summary counts chains, not steps: one line per chain with its newest link', () => {
  const store = new Map([...HELD_STORE, ...AT_WORK])
  // B664: the hold counts from when the watch first saw it, as the rule review-held counts it (70 min ago here).
  const text = healthSummary(view(store, HELD, { seen: new Map([[`review-held B614 ${CHOICE_WHY.slice(0, 80)}`, ago(70)]]) }), NOW)
  assert.match(text, /- ! in review: 4 steps in 2 chains of fixes, 1 behind a fix the ready list holds/)
  assert.match(text, /- B617 review for 4 h 10 min, Painter \(waits for its fix B631; one chain, 3 in review: B617 → B631 → B641; newest link B655 in progress, Painter\)/)
  assert.match(text, /- ! B603 review for 2 h, Painter \(waits for its fix B614, held: outside the focus goal \(refined, Painter\)\)/)
  // The links of the chain have no line of their own.
  assert.doesNotMatch(text, /- B631 review/)
  assert.doesNotMatch(text, /- B641 review/)
  // B660: a fix held for the person's open ask is named, but not marked odd, however long it waits.
  const asked = items(reviewed('B603', 300, 'B614'), fixStep('B614', 'B603', 'refined', 280, { Refined: 'ready' }))
  const askedText = healthSummary(view(asked, [{ id: 'B614', why: 'waits for the answer to Q408' }]), NOW)
  assert.match(askedText, /- B603 review for 5 h, Painter \(waits for its fix B614, held: waits for the answer to Q408/)
  assert.doesNotMatch(askedText, /- ! B603/)
  // A chain whose newest link is in review itself says what that one waits for. 2026-10-31 (B689): the wait's own words say it
  // now ("which waits for its first check"), so the newest link's part of the line no longer says it a second time.
  const checking = items(reviewed('B622', 120, 'B638'), reviewed('B638', 60, null, { 'Fix of': 'B622' }))
  assert.match(healthSummary(view(checking, []), NOW), /- B622 review for 2 h, Painter \(waits for its fix B638, which waits for its first check; one chain, 2 in review: B622 → B638; newest link B638 review, Painter\)/)
})

test('the Backlog line and the work tool name the held fix', async t => {
  const work = { ok: true, items: HELD_STORE, activities: [{ name: 'Work', steps: ['B603', 'B614'] }] }
  assert.equal(reviewWaitOfStep(work, 'B603', HELD), 'waits for its fix B614, held: outside the focus goal')
  assert.equal(reviewWaitOfStep(work, 'B603'), 'waits for its fix B614')
  const dir = await mkdtemp(join(tmpdir(), 'b656-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeStore(dir, { items: HELD_STORE, activities: [{ name: 'Work', steps: ['B603', 'B614'] }] }, undefined, { now: NOW })
  const mine = await workApi({ action: 'next', chat: 'Painter' }, { dir, now: NOW, roleOf: () => 'person', readyHeld: HELD })
  assert.equal(mine.ok, true, mine.why)
  assert.match(mine.result.text, /- B603 review \(waits for its fix B614, held: outside the focus goal\): Step B603/)
  const listed = await workApi({ action: 'list', chat: 'Lead' }, { dir, now: NOW, roleOf: () => 'main', readyHeld: HELD })
  assert.match(listed.result.text, /^B603 · step · review \(waits for its fix B614, held: outside the focus goal\) · Painter/m)
})
