// B916, the fix of X123: B851 waited for its fix B890, which Main blocked on B871; B871's fix B889 waited for the person's answer
// (Q587, held for a goal's demo). The ready list held B890 with "blocked by B871 (review)", which the rule review-held counted
// from its first sighting, so it raised every 3 minutes (closed as no fault, back two minutes later). A hold that blocks on steps
// which all wait for the person is the person's wait, as their open ask is (B660). Made-up items; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { healthSummary } from '../../src/supervisor/health.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { waitsForPerson } from '../../src/work/resultCheck.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 2, 14, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const passed = minutes => `- ${stamp(ago(minutes))} server: check passed: merged`
const failed = (minutes, fix) => `- ${stamp(ago(minutes))} Checker: result check failed: 4 of 6 points pass; fix ${fix} for Painter`
const waits = minutes => `- ${stamp(ago(minutes))} Checker: result check waits for you: one point is yours`
/** A step in review whose board check passed; `more` History lines after it. */
const reviewed = (id, minutes, more = [], head = {}) => item(
  { Id: id, Kind: 'step', Title: `Step ${id}`, State: 'review', Owner: 'Painter', Since: stamp(ago(minutes)), ...head },
  { 'What we build': ['- a round pool'], History: [passed(minutes), ...more] },
)
const ask = (id, of, state = 'open') => item({ Id: id, Kind: 'ask', Title: 'A check point', State: state, Of: of, Owner: 'Painter', Since: stamp(ago(300)) })

/** X123: B851 → fix B890 (refined, blocked by B871) → B871 (review) → fix B889 (review, its check waits for the answer to Q587). */
const chain = (extra = []) => items(
  reviewed('B851', 900, [failed(800, 'B890')]),
  item({ Id: 'B890', Kind: 'step', Title: 'Fix: B851', State: 'refined', Refined: 'ready', 'Fix of': 'B851', 'Blocked by': 'B871', Owner: 'Painter', Since: stamp(ago(700)) }),
  reviewed('B871', 600, [failed(500, 'B889')]),
  reviewed('B889', 400, [waits(300)], { 'Fix of': 'B871' }),
  ask('Q587', 'B889'),
  ...extra,
)
const HOLD = 'blocked by B871 (review)'
const HELD = [{ id: 'B890', why: HOLD }]
const KEY = `review-held B890 ${HOLD}`

const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const PAINTER = { name: 'Painter', isMain: false, isLeftover: false, state: 'working', isRunning: true }
const view = (store, held = HELD, more = {}) => buildView({
  state: { chats: [LEAD, PAINTER], today: [], limits: {}, pause: null, chatPrefix: '', readyList: { ready: [], held }, recapWaits: more.recaps ?? [] },
  items: store, outbox: [], settings: {}, seen: more.seen ?? null, now: more.now ?? NOW,
})
const watch = (board, seen = new Map(), observed = []) => WATCH_RULES.find(one => one.id === 'review-held').check(board, { seen, observed })
const lineOf = (text, id) => text.split('\n').find(line => new RegExp(`^- (?:! )?${id} `).test(line)) ?? ''

test('X123: a block by a step whose chain ends at the person\'s answer is no case, however long, and nothing is watched meanwhile', () => {
  const store = chain()
  for (const minutes of [5, 80, 600]) {
    const observed = []
    assert.deepEqual(watch(view(store), new Map([[KEY, ago(minutes)]]), observed), [])
    assert.deepEqual(observed, [], 'the spared hold is not watched, so it counts from when the person\'s wait ends')
  }
  // The health summary names the chain and marks nothing odd.
  const line = lineOf(healthSummary(view(store, HELD, { seen: new Map([[KEY.slice(0, 80 + 'review-held B890 '.length), ago(600)]]) })), 'B851')
  assert.match(line, /^- B851 review /)
  assert.doesNotMatch(line, /^- ! /)
  assert.equal(waitsForPerson(store.get('B871'), store, HELD, NOW), true)
})

test('X123: the wait ends, the hold counts from then: the alarm comes only after the review minutes', () => {
  // Q587 answered, B889's check waits for a check again (the person's 30 minutes to the checker are over).
  const answered = chain([ask('Q587', 'B889', 'answered')])
  assert.equal(waitsForPerson(answered.get('B871'), answered, HELD, NOW), false)
  assert.deepEqual(watch(view(answered), new Map([[KEY, ago(10)]])), [], 'seen 10 minutes: not yet')
  const late = watch(view(answered), new Map([[KEY, ago(70)]]))
  // Signals change 6 (Addendum 2): the incident's key is the rule and the chain's first step; the why stays in the watch's key.
  assert.deepEqual(late.map(one => [one.rule, one.key, one.subject]), [['review-held', 'review-held B851', 'B851']])
  // Never seen before: the sighting starts now, so no case.
  const first = []
  assert.deepEqual(watch(view(answered), new Map(), first), [])
  assert.deepEqual(first, [KEY])
  // The health summary marks it odd once the hold has lasted past the review minutes and the person's wait is over.
  assert.match(lineOf(healthSummary(view(answered, HELD, { seen: new Map([[KEY, ago(70)]]) })), 'B851'), /^- ! B851 review /)
})

test('mutants: a blocker that waits for a check, one of two blockers waiting, a block with no person at the end', () => {
  // B871's chain ends at a check (no ask of B889, its check line says it waits for a check again): spared by nothing.
  const check = chain([ask('Q587', 'B889', 'withdrawn')])
  assert.deepEqual(watch(view(check), new Map([[KEY, ago(70)]])).map(one => one.subject), ['B851'])
  // A blocker queued for its first check, with no chain behind it.
  const plain = items(
    reviewed('B851', 900, [failed(800, 'B890')]),
    item({ Id: 'B890', Kind: 'step', Title: 'Fix: B851', State: 'refined', Refined: 'ready', 'Fix of': 'B851', 'Blocked by': 'B871', Owner: 'Painter', Since: stamp(ago(700)) }),
    reviewed('B871', 600),
  )
  assert.equal(waitsForPerson(plain.get('B871'), plain, HELD, NOW), false)
  assert.equal(watch(view(plain), new Map([[KEY, ago(70)]])).length, 1)
  // Two blockers: one waits for the person, one for a check: the hold stays the board's.
  const two = new Map([...chain(), ...items(item({ Id: 'B890', Kind: 'step', Title: 'Fix: B851', State: 'refined', Refined: 'ready', 'Fix of': 'B851', 'Blocked by': 'B871 B872', Owner: 'Painter', Since: stamp(ago(700)) }), reviewed('B872', 300))])
  const both = 'blocked by B871 (review), B872 (review)'
  const bothKey = `review-held B890 ${both}`
  assert.equal(watch(view(two, [{ id: 'B890', why: both }]), new Map([[bothKey, ago(70)]])).length, 1)
  // Both waiting for the person: spared.
  const pair = new Map([...chain(), ...items(item({ Id: 'B890', Kind: 'step', Title: 'Fix: B851', State: 'refined', Refined: 'ready', 'Fix of': 'B851', 'Blocked by': 'B871 B873', Owner: 'Painter', Since: stamp(ago(700)) }), reviewed('B873', 300, [waits(200)]), ask('Q600', 'B873'))])
  assert.deepEqual(watch(view(pair, [{ id: 'B890', why: both.replace('B872', 'B873') }]), new Map([[`review-held B890 ${both.replace('B872', 'B873')}`, ago(70)]])), [])
  // A chain with a link at work is the worker's, not the person's.
  const atWork = chain([item({ Id: 'B880', Kind: 'step', Title: 'Fix: B889', State: 'in progress', 'Fix of': 'B889', Owner: 'Painter', Since: stamp(ago(30)) })])
  assert.equal(waitsForPerson(atWork.get('B871'), atWork, HELD, NOW), false)
  // A middle link with a worker, the end waiting for the person: the chain is being worked on.
  const middle = new Map([...chain(), ...items(
    item({ Id: 'B889', Kind: 'step', Title: 'Fix: B871', State: 'in progress', 'Fix of': 'B871', Owner: 'Painter', Since: stamp(ago(300)) }),
    reviewed('B880', 100, [waits(50)], { 'Fix of': 'B889' }), ask('Q601', 'B880'))])
  assert.equal(waitsForPerson(middle.get('B871'), middle, HELD, NOW), false)
  // A block by a step that is not in review (a worker has it): the hold stays the board's.
  assert.equal(waitsForPerson(item({ Id: 'B9', Kind: 'step', State: 'in progress' }), new Map(), HELD, NOW), false)
  assert.equal(waitsForPerson(undefined, new Map(), HELD, NOW), false)
})
