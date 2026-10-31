// B878, the fix of X116: B821 sat in review with its fix B854 dropped, blocked on the recap step B674 that shows it to the
// person. B674 went done at 12:54, B574 took it out of B821's Blocked by at once, so B665 found no blocker and the rule
// dropped-fix counted from the drop 96 min before: an incident one minute later. And nothing closed B821: the recap's Approve
// did not reach the step its part shows. Now a "no longer blocked by" line ends a block too; a step whose part waits for the
// person's verdict in a recap waits as planned; a Send back counts from the Send; the recap's rows name their steps.
// Made-up items; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { demoPage, checkList } from '../../src/demo.mjs'
import { roundPage, wordsOfRound } from '../../src/demoFeedback.mjs'
import { recapWaitsOf } from '../../src/recaps.mjs'
import { recapFeedbackWords } from '../../src/say.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { findStuck } from '../../src/supervisor/rules/repair.mjs'
import { reviewWaitOf, unblockedOf } from '../../src/work/resultCheck.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { reviewWaitOfStep } from '../../src/work/read.mjs'

const MIN = 60_000
/** 12:55 on a made-up day: B674 went done a minute ago. */
const NOW = new Date(2026, 9, 31, 12, 55).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const passed = minutes => `- ${stamp(ago(minutes))} server: check passed: merged`
const failed = (minutes, fix) => `- ${stamp(ago(minutes))} Checker: result check failed: 4 of 6 points pass; fix ${fix} for Painter`
const reviewed = (id, minutes, more = [], head = {}) => item(
  { Id: id, Kind: 'step', Title: `Step ${id}`, State: 'review', Owner: 'Painter', Since: stamp(ago(minutes)), ...head },
  { 'What we build': ['- a round pool'], History: [passed(minutes), ...more] },
)
const fixStep = (id, of, state, minutes) => item({ Id: id, Kind: 'step', Title: `Fix: ${of}`, State: state, Owner: 'Painter', Since: stamp(ago(minutes)), 'Fix of': of })
const recapStep = item({ Id: 'B674', Kind: 'step', Title: 'A recap of the goal', State: 'done', Owner: 'Builder', Since: stamp(ago(1)) },
  { History: [`- ${stamp(ago(165))} Builder: queued → in progress`, `- ${stamp(ago(1))} server: review → done`] })

/** B821's case: its fix B854 dropped 98 min ago, blocked on the recap B674 until B674 went done a minute ago; B689 above it. */
const board = (more = []) => items(
  reviewed('B689', 900, [failed(800, 'B821')]),
  reviewed('B821', 170, [failed(127, 'B854'), `- ${stamp(ago(98))} Main: blocked by B674`, `- ${stamp(ago(1))} server: no longer blocked by B674: done`, ...more], { 'Fix of': 'B689' }),
  fixStep('B854', 'B821', 'dropped', 98),
  recapStep,
)
const WAITS = [
  { step: 'B689', goal: 'G60', path: 'pictures/g60/recap/demo.json', key: '5. Round shapes', title: '5. Round shapes', verdict: null, at: null },
  { step: 'B821', goal: 'G60', path: 'pictures/g60/recap/demo.json', key: '5. Round shapes', title: '5. Round shapes', verdict: null, at: null },
]
const sentBack = minutes => WAITS.map(one => ({ ...one, verdict: 'sent-back', at: ago(minutes) }))

const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const PARTNER = { name: 'Partner', state: 'working', isRunning: true }
const PAINTER = { name: 'Painter', isLeftover: false, state: 'free', isRunning: true }
const view = (store, { recaps = [], now = NOW } = {}) => buildView({
  state: { chats: [LEAD, PAINTER], today: [], limits: {}, pause: null, chatPrefix: '', recapWaits: recaps },
  items: store, outbox: [], settings: {}, now,
})
const dropWatch = board => WATCH_RULES.find(one => one.id === 'dropped-fix').check(board, { seen: new Map(), observed: [] })
const repairs = (store, recaps, now = NOW) => findStuck({ items: store, lanes: [LEAD], partner: PARTNER, now, recaps }).filter(one => one.check === 'fix-dropped')
const lineOf = (text, id) => text.split('\n').find(line => new RegExp(`^- (?:! )?${id} `).test(line)) ?? ''

test('X116: a block ended by its step going done a minute ago is no case; 30 minutes with nothing planned is', () => {
  const store = board()
  // B574 took B674 out of Blocked by: the step's own "no longer blocked by" line is when the block ended.
  assert.deepEqual(unblockedOf(store.get('B821')), { id: 'B674', at: ago(1) })
  const wait = reviewWaitOf(store.get('B821'), store)
  assert.deepEqual([wait.kind, wait.since, wait.blockEnded], ['dropped', ago(1), { id: 'B674', at: ago(1) }])
  assert.deepEqual(dropWatch(view(store)), [])
  assert.deepEqual(dropWatch(view(store, { now: NOW + 28 * MIN })), [])
  const late = dropWatch(view(store, { now: NOW + 31 * MIN }))
  assert.deepEqual(late.map(one => [one.rule, one.subject]), [['dropped-fix', 'B821']])
  assert.match(late[0].evidence, /the block by B674 ended at 12:54/)
  // The repair that tells the main chat counts the same way.
  assert.deepEqual(repairs(store, []), [])
  assert.equal(repairs(store, [], NOW + 31 * MIN).length, 1)
  // An unblock before the drop changes nothing: counted from the drop.
  const early = items(reviewed('B821', 170, [`- ${stamp(ago(150))} server: no longer blocked by B674: done`, failed(127, 'B854')], { 'Fix of': 'B689' }), fixStep('B854', 'B821', 'dropped', 98), recapStep)
  assert.equal(reviewWaitOf(early.get('B821'), early).since, ago(98))
  assert.equal(dropWatch(view(early)).length, 1)
})

test('a step whose part waits for the person\'s verdict in a recap waits as planned, everywhere it is read', () => {
  const store = board()
  const wait = reviewWaitOf(store.get('B821'), store, null, NOW, WAITS)
  assert.deepEqual([wait.kind, wait.goal, wait.part, wait.text], ['recap', 'G60', '5. Round shapes', 'waits for your verdict in the recap of G60'])
  // No incident, however long the person takes; no word to the main chat.
  for (const minutes of [0, 31, 600]) assert.deepEqual(dropWatch(view(store, { recaps: WAITS, now: NOW + minutes * MIN })), [])
  assert.deepEqual(repairs(store, WAITS, NOW + 600 * MIN), [])
  // The health summary names the wait and marks nothing odd for it.
  // B821 is a link of B689's chain, so B689's line speaks for it.
  const text = healthSummary(view(store, { recaps: WAITS, now: NOW + 600 * MIN }))
  assert.match(lineOf(text, 'B689'), /^- B689 review .*\(waits for its fix B821, which waits for your verdict in the recap of G60;/)
  const alone = new Map([...store].filter(([id]) => id !== 'B689'))
  const own = lineOf(healthSummary(view(alone, { recaps: WAITS, now: NOW + 600 * MIN })), 'B821')
  assert.match(own, /^- B821 review .*\(waits for your verdict in the recap of G60\)/)
  // Without the recap the same step is odd (its dropped fix counts from the unblock).
  assert.match(lineOf(healthSummary(view(alone, { now: NOW + 600 * MIN })), 'B821'), /^- ! B821 review .*\(its fix B854 was dropped\)/)
  // The step above it says what its chain waits for; the Backlog line the same.
  assert.match(reviewWaitOf(store.get('B689'), store, null, NOW, WAITS).text, /^waits for its fix B821, which waits for your verdict in the recap of G60$/)
  const work = { ok: true, items: store, activities: [{ name: 'Work', steps: ['B689', 'B821'] }] }
  assert.equal(reviewWaitOfStep(work, 'B821', null, NOW, WAITS), 'waits for your verdict in the recap of G60')
  // A part of another step changes nothing for this one.
  assert.equal(reviewWaitOf(store.get('B821'), store, null, NOW, [{ ...WAITS[1], step: 'B999' }]).kind, 'dropped')
})

test('a part sent back counts from the Send back: the partner has 30 minutes to make the next try', () => {
  const store = board()
  const back = sentBack(-10)
  const wait = reviewWaitOf(store.get('B821'), store, null, NOW + 10 * MIN, back)
  assert.deepEqual([wait.kind, wait.since, wait.sentBack], ['dropped', NOW + 10 * MIN, { goal: 'G60', at: NOW + 10 * MIN }])
  assert.match(wait.text, /^its fix B854 was dropped; sent back in the recap of G60: the partner makes its next try$/)
  assert.deepEqual(dropWatch(view(store, { recaps: back, now: NOW + 39 * MIN })), [])
  assert.equal(dropWatch(view(store, { recaps: back, now: NOW + 41 * MIN })).length, 1)
  // Its fix made: the step waits for its fix, as any other.
  const fixed = new Map([...store, ['B880', fixStep('B880', 'B821', 'refined', 0)]])
  assert.equal(reviewWaitOf(fixed.get('B821'), fixed, null, NOW, back).kind, 'fix')
})

test('recap parts name their steps; where each stands with the person; Approve closes, Send back names them', () => {
  const list = {
    goal: 'G60', title: 'The maps', step: 'B674',
    sections: [{ kind: 'reached', rows: [
      { title: '1. Lava', pictures: [{ kind: 'final', caption: 'f', path: 'a.png' }] },
      { title: '5. Round shapes', steps: ['B689', 'B821', 'B821'], pictures: [{ kind: 'final-not', caption: 'f', path: 'b.png' }] },
      { title: '6. Props', steps: ['B671'], pictures: [{ kind: 'final', caption: 'f', path: 'c.png' }] },
    ] }],
  }
  assert.throws(() => checkList({ ...list, sections: [{ kind: 'open', rows: [{ title: 'x', steps: ['821'], pictures: [{ kind: 'final', path: 'a.png' }] }] }] }), /"steps" lists step ids/)
  const page = demoPage(list, 'pictures/g60/recap')
  assert.deepEqual(page.sections[0].rows.map(row => row.steps), [[], ['B689', 'B821'], ['B671']])
  const recap = rounds => ({ path: 'pictures/g60/recap/demo.json', goal: 'G60', parts: page.sections[0].rows.filter(row => row.steps.length > 0).map(row => ({ key: row.key, title: row.title, steps: row.steps })), rounds })
  // Nothing judged yet: every named step waits for the verdict.
  assert.deepEqual(recapWaitsOf([recap([])]).map(one => [one.step, one.verdict]), [['B689', null], ['B821', null], ['B671', null]])
  // Round 1: props approved (left out), round shapes sent back at 13:05.
  const round1 = [{ n: 1, at: '2026-10-31 13:05', parts: [{ key: '6. Props', verdict: 'approved', comment: '' }, { key: '5. Round shapes', verdict: 'sent-back', comment: 'still stepped' }] }]
  assert.deepEqual(recapWaitsOf([recap(round1)]).map(one => [one.step, one.verdict, one.at]), [['B689', 'sent-back', NOW + 10 * MIN], ['B821', 'sent-back', NOW + 10 * MIN]])
  // The partner wrote the demo again with the new try: it waits for the person's verdict again (in the Send's minute: not yet).
  assert.deepEqual(recapWaitsOf([{ ...recap(round1), changedAt: NOW + 40 * MIN }]).map(one => one.verdict), [null, null])
  assert.deepEqual(recapWaitsOf([{ ...recap(round1), changedAt: NOW + 10 * MIN + 30_000 }]).map(one => one.verdict), ['sent-back', 'sent-back'])
  // The words of the Send: the steps an Approve closes, each part sent back with its steps for the partner.
  const said = wordsOfRound(roundPage(page, null), 1, round1[0].parts)
  assert.deepEqual([said.closes, said.back], [['B671'], [{ title: '5. Round shapes', comment: 'still stepped', steps: ['B689', 'B821'] }]])
  assert.match(said.lines.join('\n'), /Sent back: 5\. Round shapes \(B689, B821\): "still stepped"/)
  const word = recapFeedbackWords('Partner', { goal: 'G60', title: 'The maps', step: 'B674', round: 1, approved: said.approved, back: said.back, done: false, left: 1, path: 'pictures/g60/recap/demo.json', job: 'partner.md' })
  assert.match(word.text, /- 5\. Round shapes \(steps B689, B821: block each on its next try\): "still stepped"/)
})
