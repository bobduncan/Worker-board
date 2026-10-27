// B664 (X8 a third time, 2026-10-25 22:36: 20 steps in review in 10 chains of fixes): each failed check made another
// refined fix of the same way, handed at once to a worker, so the partner's "Two rounds, then another way" never got its
// turn (B618 → B636 → B654 → B659 at 60, 71, 61 of 75; B617 → B631 → B641 → B655 → B661 at 46 to 59), and the health
// summary marked review odd where the rules stayed quiet. Now a chain with two tries gets its next fix open for the
// partner, a rule catches a third patch of the same way, and health judges review as the rules do. Made-up words.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildView } from '../../src/supervisor/view.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { refineWhenDue } from '../../src/refineGate.mjs'
import { workApi } from '../../src/work/api.mjs'
import { ANOTHER_WAY, chainTries } from '../../src/work/resultCheck.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { queueFor } from '../queueFor.mjs'
import { checkedBy } from '../qaKit.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 25, 22, 36).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const passed = minutes => `- ${stamp(ago(minutes))} server: check passed: merged`
const failed = (minutes, fix) => `- ${stamp(ago(minutes))} Checker: result check failed: 2 of 4 points pass, score 61 of 75; fix ${fix} for Painter`
/** A step in review whose board check passed and whose result check failed and made the fix `fix`. */
const reviewed = (id, minutes, fix, head = {}) => item(
  { Id: id, Kind: 'step', Title: `Step ${id}`, State: 'review', Owner: 'Painter', Since: stamp(ago(minutes)), ...head },
  { 'What we build': ['- round islands on whole cells'], History: [passed(minutes), ...(fix === null ? [] : [failed(minutes - 5, fix)])] },
)
const fixAt = (id, of, state, what = ['- the lip is back on the north edges'], head = {}) => item(
  { Id: id, Kind: 'step', Title: `Fix: ${of}`, State: state, Since: stamp(ago(10)), 'Fix of': of, ...head },
  { 'What we build': what },
)
/** Today's two chains as they stood at 22:36: each link in review behind the next, the newest a refined fix. */
const ISLANDS = [reviewed('B618', 220, 'B636'), reviewed('B636', 160, 'B654', { 'Fix of': 'B618' }), reviewed('B654', 100, 'B659', { 'Fix of': 'B636' })]
const LEDGE = [reviewed('B617', 300, 'B631'), reviewed('B631', 240, 'B641', { 'Fix of': 'B617' }), reviewed('B641', 180, 'B655', { 'Fix of': 'B631' }), reviewed('B655', 120, 'B661', { 'Fix of': 'B641' })]

const LANES = [{ name: 'Lead', isMain: true, isLeftover: false, state: 'free', isRunning: true, queue: [] }, { name: 'Painter', isMain: false, isLeftover: false, state: 'working', isRunning: true, queue: [] }]
const view = (store, more = {}) => buildView({
  state: { chats: LANES, advisor: { name: 'Partner' }, today: [], limits: {}, pause: null, chatPrefix: '', readyList: { ready: [], held: more.held ?? [] } },
  items: store, outbox: more.outbox ?? [], settings: {}, seen: more.seen ?? null, now: NOW,
})
const rule = id => WATCH_RULES.find(one => one.id === id)
const check = (id, board, seen = new Map()) => rule(id).check(board, { seen, observed: [] })
const lineOfStep = (text, id) => text.split('\n').find(one => one.startsWith(`- ${id} `) || one.startsWith(`- ! ${id} `)) ?? ''

test('chainTries: the first step and every fix under it, a dropped fix left out', () => {
  const store = items(...ISLANDS, fixAt('B659', 'B654', 'refined'), fixAt('B650', 'B636', 'dropped'))
  assert.deepEqual(chainTries('B659', store), ['B618', 'B636', 'B654', 'B659'])
  assert.deepEqual(chainTries('B618', store), ['B618', 'B636', 'B654', 'B659'])
  assert.deepEqual(chainTries('B700', items(reviewed('B700', 10, null))), ['B700'])
})

async function board(t) {
  const dir = await mkdtemp(join(tmpdir(), 'b664-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const at = new Date(2026, 9, 25, 18, 0).getTime()
  await writeStore(dir, migrateBacklog(['# Backlog', '', '## Maps', '- [ ] B1 Prove round shapes made of square cells', ''].join('\n'), { now: at }), undefined, { now: at })
  const ctx = { dir, now: at + MIN, prefix: '', roleOf: chat => ({ Partner: 'advisor', Keeper: 'main', Painter: 'worker', Checker: 'worker' })[chat] ?? null, freeChats: new Set(['Painter']), chats: ['Partner', 'Keeper', 'Painter', 'Checker'] }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  const read = async id => (await readStore(dir)).items.get(id)
  const toReview = async (id, branch) => {
    assert.equal((await queueFor(dir, id, 'Painter', { now: at + MIN })).ok, true)
    assert.equal((await as('Painter')({ action: 'take', id, branch })).ok, true)
    const reported = await as('Painter')({ action: 'report', id, result: 'Done.', merged: 'c0ffee1' })
    assert.equal(reported.ok, true, reported.why)
    assert.equal((await workApi({ action: 'check', id, passed: true, lines: ['branch gone'] }, { ...ctx, as: 'server' })).ok, true)
  }
  // T9.1.1: the check is filed by the worker that holds the step's QA task, a worker that did not build it.
  const fail = id => checkedBy({ as, server: call => workApi(call, { ...ctx, as: 'server' }), dir, now: at + MIN }, id, { evidence: 'none (x)', points: ['fail: the outline still steps', 'pass: whole cells'] })
  return { as, read, toReview, fail }
}

test('a chain with two tries gets its next fix open for the partner; the first fix stays refined for the worker', async t => {
  const { as, read, toReview, fail } = await board(t)
  assert.equal((await as('Partner')({ action: 'refine', id: 'B1', summary: 'Round shapes.' })).ok, true)
  assert.equal((await as('Partner')({ action: 'refined', id: 'B1', what: ['round islands on whole cells', 'whole cells'] })).ok, true)
  // B618's check fails: one try, so its fix (as B636) is refined, ready for the worker, as before.
  await toReview('B1', 'b1-round')
  const first = await fail('B1')
  assert.equal(first.ok, true, first.why)
  const second = await read(first.result.fix)
  assert.equal(second.head.get('State'), 'refined')
  assert.equal(second.head.get('Refined'), 'ready')
  assert.doesNotMatch(second.sections.get('What we build').join('\n'), /Two rounds/)
  // B636's check fails too: two tries, so its fix (as B654) is open: new, its block not ready, no worker gets it.
  await toReview(first.result.fix, 'b2-round')
  const again = await fail(first.result.fix)
  assert.equal(again.ok, true, again.why)
  const third = await read(again.result.fix)
  assert.equal(third.head.get('State'), 'new')
  assert.equal(third.head.get('Refined'), 'open')
  assert.equal(third.sections.get('What we build')[0], `- ${ANOTHER_WAY} (tried: B1, ${first.result.fix})`)
  assert.match(third.sections.get('Refined')[0], /; open; from the result check of /)
  assert.doesNotMatch(third.sections.get('Refined')[0], /\bready\b/)
  assert.match(third.sections.get('History').join('\n'), /open: 2 tries, the partner refines it another way/)
  // The partner refines it another way; its what starts with Tried before, and it goes to the ready list.
  assert.equal((await as('Partner')({ action: 'refine', id: again.result.fix, summary: 'Cut the islands from a painting.' })).ok, true)
  const done = await as('Partner')({ action: 'refined', id: again.result.fix, what: ['Tried before: cell-by-cell outlines, 60 and 71 of 75, the steps stay', 'islands cut from one painting'] })
  assert.equal(done.ok, true, done.why)
  assert.equal((await read(again.result.fix)).head.get('State'), 'refined')
})

test('the board types the open fix\'s refine to the partner first, saying it is another way', () => {
  const what = [`${ANOTHER_WAY} (tried: B618, B636)`, 'the outline still steps']
  const open = { id: 'B654', text: 'Fix: the outline still steps', status: 'open', refined: { ready: false, questions: [], accepted: null, asks: [] }, item: { fixOf: 'B636', what, history: [] } }
  const other = { id: 'B653', text: 'Draw a new bench', status: 'open', refined: null, item: { fixOf: null, what: [], history: [] } }
  const due = refineWhenDue({ advisor: { name: 'Partner' }, backlog: [{ name: 'Maps', steps: [other, open] }] }, [], { since: 600, queuedBefore: [], waiting: [] }, NOW)
  assert.equal(due.refine.about, 'B654')
  assert.equal(due.refine.why, 'fix')
  assert.match(due.refine.text, /Two rounds, then another way: this fix's chain failed its check twice\. Refine it another way, and start its what with "Tried before:/)
  // A plain new step's word says nothing of it.
  const plain = refineWhenDue({ advisor: { name: 'Partner' }, backlog: [{ name: 'Maps', steps: [other] }] }, [], { since: 600, queuedBefore: [], waiting: [] }, NOW)
  assert.doesNotMatch(plain.refine.text, /Two rounds/)
})

test('chain-long: today\'s chains, three tries or more with a newest fix of the same way, are each an incident', () => {
  const store = items(...ISLANDS, fixAt('B659', 'B654', 'refined', undefined, { Owner: 'Painter' }), ...LEDGE, fixAt('B661', 'B655', 'refined'))
  const found = check('chain-long', view(store))
  assert.deepEqual(found.map(one => one.key), ['chain-long B617 B661', 'chain-long B618 B659'])
  const islands = found.find(one => one.subject === 'B618')
  assert.equal(islands.text, 'B618: 4 tries in one chain of fixes, and its newest fix B659 names no "Tried before:": a patch of the same way again')
  assert.match(islands.evidence, /^the chain B618 → B636 → B654 → B659; B659 refined, Painter;/)
  assert.match(found.find(one => one.subject === 'B617').evidence, /B617 → B631 → B641 → B655 → B661; B661 refined, no owner/)
})

test('chain-long: no case for a fix with Tried before, an open fix for the partner, two tries, or a chain that ended', () => {
  const tried = items(...ISLANDS, fixAt('B659', 'B654', 'queued', ['- Tried before: cell outlines, 60, 71 and 61 of 75', '- islands cut from a painting']))
  assert.deepEqual(check('chain-long', view(tried)), [])
  // In the refine block alone counts too.
  const inBlock = items(...ISLANDS, item({ Id: 'B659', Kind: 'step', Title: 'Fix', State: 'refined', 'Fix of': 'B654', Since: stamp(ago(5)) }, { Refined: ['  Refined (2026-10-25 22:30; ready):', '  What we build:', '  - Tried before: outlines'] }))
  assert.deepEqual(check('chain-long', view(inBlock)), [])
  assert.deepEqual(check('chain-long', view(items(...ISLANDS, fixAt('B659', 'B654', 'new')))), [])
  assert.deepEqual(check('chain-long', view(items(ISLANDS[0], fixAt('B636', 'B618', 'refined')))), [])
  const ended = items(item({ Id: 'B618', Kind: 'step', Title: 'x', State: 'dropped', Since: stamp(ago(5)) }), ISLANDS[1], ISLANDS[2], fixAt('B659', 'B654', 'refined'))
  assert.deepEqual(check('chain-long', view(ended)), [])
})

test('health and the rules agree: the Q408 hold and a fresh check word are odd to neither; past their time to both', () => {
  // B603 behind B614, held for the person's answer to Q408 for hours: no case, no "!".
  const asked = items(reviewed('B603', 300, 'B614'), fixAt('B614', 'B603', 'refined', undefined, { Refined: 'ready', Since: stamp(ago(280)) }))
  const held = [{ id: 'B614', why: 'waits for the answer to Q408' }]
  assert.deepEqual(check('review-held', view(asked, { held }), new Map([['review-held B614 waits for the answer to Q408', ago(280)]])), [])
  const askedText = healthSummary(view(asked, { held, seen: new Map([['review-held B614 waits for the answer to Q408', ago(280)]]) }), NOW)
  assert.doesNotMatch(askedText, /- ! B603/)
  assert.doesNotMatch(askedText, /- ! in review/)
  // B640 in review 90 min, its first check asked then, the check word typed again 10 min ago: no case, no "!".
  const waiting = items(reviewed('B640', 90, null))
  const word = minutes => ({ id: `w${minutes}`, to: 'Partner', command: 'result-check', about: 'B640', at: ago(minutes), state: 'delivered' })
  const fresh = { outbox: [word(90), word(10)], seen: new Map([['review-stuck B640 check', ago(90)]]) }
  assert.deepEqual(check('review-stuck', view(waiting, fresh), fresh.seen), [])
  assert.equal(lineOfStep(healthSummary(view(waiting, fresh), NOW), 'B640').startsWith('- B640 review'), true)
  // Its last word 40 min ago, past checkWordMinutes: a case for the rule, and "!" in health.
  const stale = { outbox: [word(90), word(40)], seen: fresh.seen }
  assert.equal(check('review-stuck', view(waiting, stale), stale.seen).length, 1)
  assert.equal(lineOfStep(healthSummary(view(waiting, stale), NOW), 'B640').startsWith('- ! B640 review'), true)
  // Another hold counts from when the watch first saw it: 20 min, neither; 70 min, both.
  const choice = [{ id: 'B614', why: 'outside the focus goal: x' }]
  const store = items(reviewed('B603', 300, 'B614'), fixAt('B614', 'B603', 'refined', undefined, { Refined: 'ready', Since: stamp(ago(280)) }))
  for (const [minutes, odd] of [[20, false], [70, true]]) {
    const seen = new Map([['review-held B614 outside the focus goal: x', ago(minutes)]])
    assert.equal(check('review-held', view(store, { held: choice }), seen).length, odd ? 1 : 0, `${minutes} min`)
    const text = healthSummary(view(store, { held: choice, seen }), NOW)
    assert.equal(lineOfStep(text, 'B603').startsWith('- ! B603'), odd, `${minutes} min`)
    assert.equal(/- ! in review/.test(text), odd, `${minutes} min`)
  }
})
