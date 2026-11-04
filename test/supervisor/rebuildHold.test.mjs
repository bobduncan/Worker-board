// B985 (X139: B982, a fix of G29's chain, alarmed open-fix while the person's pick on the rebuild, Q627, waited by design):
// a fix whose goal has an open ask titled "Rebuild G<n>" is held as the evaluate word is since B791: the refine gate types
// no refine word for it, the rule open-fix and the health summary stay quiet, and after the ask closes the hour counts from
// the close. Only the evaluated part is held (B669). Made-up names.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseGoals } from '../../src/goals.mjs'
import { rebuildHoldOf, rebuildHoldsOf } from '../../src/goalGuard.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { refineQueue, refineWhenDue } from '../../src/refineGate.mjs'
import { ANOTHER_WAY } from '../../src/work/resultCheck.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 4, 11, 1).getTime()
const ago = minutes => NOW - minutes * MIN

const goals = (evaluationPart = 'Wooden benches') => parseGoals([
  '# Goals', 'Last id: G3', 'Focus: G2', '',
  '- [~] G2 Benches that feel like home',
  '  Done when: five visitors sit',
  '  Part: Wooden benches · 2 h · steps B636',
  '  Part: Lamps · 1 h · steps B900',
  '  How agreed: 2026-11-04 08:00',
  '  Evaluation asked: 2026-11-04 09:00',
  ...(evaluationPart === null ? [] : [`  Evaluation part: ${evaluationPart}`]),
  '- [ ] G3 Lanterns', '',
].join('\n')).nodes

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const store = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const reviewed = (id, head = {}) => item(
  { Id: id, Kind: 'step', Title: `Step ${id}`, State: 'review', Owner: 'Painter', Since: stamp(ago(300)), ...head },
  { 'What we build': ['- round islands'], History: [`- ${stamp(ago(300))} server: check passed: merged`, `- ${stamp(ago(290))} Checker: result check failed: 2 of 4 points pass; fix B659 for Painter`] },
)
/** The chain B636 (G2) → B654 → the open fix B659, made `minutes` ago; the fix names no goal of its own. */
const chain = (minutes, more = {}) => store(
  reviewed('B636', { Goal: 'G2' }), reviewed('B654', { 'Fix of': 'B636' }),
  item(
    { Id: 'B659', Kind: 'step', Title: 'Fix: the outline still steps', State: 'new', Since: stamp(ago(minutes)), 'Fix of': 'B654', Refined: 'open', ...more },
    { 'What we build': [`- ${ANOTHER_WAY} (tried: B618)`], History: [`- ${stamp(ago(minutes))} Checker: made by the result check of B654`] },
  ),
)
const rebuild = (state = 'open', closedMinutes = null, title = 'Rebuild G2: pick a way', of = 'G2') => item(
  { Id: 'Q9', Kind: 'ask', Title: title, State: state, Of: of },
  { History: closedMinutes === null ? [`- ${stamp(ago(400))} Partner: asked`] : [`- ${stamp(ago(400))} Partner: asked`, `- ${stamp(ago(closedMinutes))} person: ${state}`] },
)
const withAsk = (steps, ...asks) => store(...steps.values(), ...asks)

test('rebuildHoldOf: a fix of the evaluated part is held while the Rebuild ask is open', () => {
  const hold = rebuildHoldOf(chain(70).get('B659'), goals(), withAsk(chain(70), rebuild()))
  assert.deepEqual(hold, { ask: 'Q9', closedAt: null })
  // The map the gate reads: only open fixes with a hold.
  assert.deepEqual(rebuildHoldsOf(goals(), withAsk(chain(70), rebuild())), { B659: { ask: 'Q9', closedAt: null }, B654: { ask: 'Q9', closedAt: null } })
})

test('rebuildHoldOf: another part goes on; no part named holds the whole goal', () => {
  assert.equal(rebuildHoldOf(chain(70).get('B659'), goals('Lamps'), withAsk(chain(70), rebuild())), null)
  assert.equal(rebuildHoldOf(chain(70).get('B659'), goals(null), withAsk(chain(70), rebuild()))?.ask, 'Q9')
})

test('rebuildHoldOf: an answered or withdrawn ask holds no more and gives its close; another title or goal is no hold', () => {
  for (const state of ['answered', 'withdrawn']) {
    const hold = rebuildHoldOf(chain(70).get('B659'), goals(), withAsk(chain(70), rebuild(state, 30)))
    assert.equal(hold.ask, null, state)
    assert.equal(hold.closedAt, new Date(stamp(ago(30)).replace(' ', 'T')).getTime(), state)
  }
  assert.equal(rebuildHoldOf(chain(70).get('B659'), goals(), withAsk(chain(70), rebuild('open', null, 'Which oak?'))), null)
  assert.equal(rebuildHoldOf(chain(70).get('B659'), goals(), withAsk(chain(70), rebuild('open', null, 'Rebuild G3: lamps?', 'G3'))), null)
  // A fix of a goal the map does not know, or no fix at all.
  assert.equal(rebuildHoldOf(chain(70).get('B659'), [], withAsk(chain(70), rebuild())), null)
  assert.equal(rebuildHoldOf(undefined, goals(), withAsk(chain(70), rebuild())), null)
})

test('the refine gate types no refine word for a held fix and stays free for the next step; after the ask it asks again', () => {
  const refined = { ready: false, questions: [], accepted: null, asks: [] }
  const fix = { id: 'B659', text: 'Fix: the outline still steps', status: 'open', refined, item: { fixOf: 'B654', what: [`${ANOTHER_WAY} (tried: B618)`], history: [] } }
  const next = { id: 'B700', text: 'A new step', status: 'open', refined, item: { what: [], history: [] } }
  const state = more => ({ advisor: { name: 'Partner' }, backlog: [{ name: 'Maps', steps: [fix, next] }], ...more })
  const kept = { since: 699, queuedBefore: [], waiting: [] }
  const held = state({ rebuildHolds: { B659: { ask: 'Q9', closedAt: null } } })
  assert.deepEqual(refineQueue(held, [], kept, NOW).map(one => one.step.id), ['B700'])
  assert.equal(refineWhenDue(held, [], kept, NOW).refine?.about, 'B700')
  assert.deepEqual(refineQueue(state({ rebuildHolds: {} }), [], kept, NOW).map(one => one.step.id), ['B659', 'B700'])
  // The ask closed: the hold has no `ask`, the fix is asked as before.
  assert.deepEqual(refineQueue(state({ rebuildHolds: { B659: { ask: null, closedAt: ago(5) } } }), [], kept, NOW).map(one => one.step.id), ['B659', 'B700'])
  // A held fix alone: no word at all.
  assert.equal(refineWhenDue({ ...held, backlog: [{ name: 'Maps', steps: [fix] }] }, [], kept, NOW).refine, null)
})

const LANES = [{ name: 'Lead', isMain: true, isLeftover: false, state: 'free', isRunning: true, queue: [] }, { name: 'Painter', isMain: false, isLeftover: false, state: 'free', isRunning: true, queue: [] }]
const view = (items, nodes) => buildView({
  state: { chats: LANES, advisor: { name: 'Partner' }, backlog: [], today: [], limits: {}, pause: null, chatPrefix: '', readyList: { ready: [], held: [] }, goals: { nodes } },
  items, outbox: [], settings: {}, seen: null, now: NOW,
})
const check = board => WATCH_RULES.find(one => one.id === 'open-fix').check(board, { seen: new Map(), observed: [] })
const marked = (board, id) => healthSummary(board, NOW).split('\n').some(one => one.startsWith(`- ! ${id} `))

test('open-fix: quiet while the Rebuild ask is open; after it closed the hour counts from the close, not from the fix', () => {
  // The fix is 180 min old and has no refine round: a case without a Rebuild ask.
  assert.equal(check(view(chain(180), goals())).length, 1)
  // X139: the ask open: no case, no "!" in health.
  const open = view(withAsk(chain(180), rebuild()), goals())
  assert.deepEqual(check(open), [])
  assert.equal(marked(open, 'B636'), false)
  // Another part of the goal is evaluated: the hold does not reach this chain.
  assert.equal(check(view(withAsk(chain(180), rebuild()), goals('Lamps'))).length, 1)
  // Answered 30 min ago: quiet until 60 min after the answer; at 70 min a case, health marks it too.
  for (const [closed, odd] of [[30, false], [70, true]]) {
    const board = view(withAsk(chain(180), rebuild('answered', closed)), goals())
    assert.equal(check(board).length, odd ? 1 : 0, `answered ${closed} min ago`)
    assert.equal(marked(board, 'B636'), odd, `health, answered ${closed} min ago`)
  }
  // Withdrawn counts the same as answered.
  assert.equal(check(view(withAsk(chain(180), rebuild('withdrawn', 30)), goals())).length, 0)
})
