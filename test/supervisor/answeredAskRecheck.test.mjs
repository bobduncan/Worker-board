// B1118 (B1096 / Q718): Worker 5's result check of B1096 (21:53) left 1 ask point naming Q718, which the person had answered at
// 21:50 ("Approved. Looks right"). The board read only answers given after the check line, so B1096 waited 30 minutes for a new
// check task. Replayed from the store's records (ids and times as they were; titles shortened): an ask point whose named ask is
// already answered sends the step to its check again at once, and a check again that leaves such a point again makes no third task.

import assert from 'node:assert/strict'
import test from 'node:test'

import { findStuck } from '../../src/supervisor/rules/repair.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { ANSWERED_WHY, JUDGE_ANSWERED, NAME_THE_ASK, checkWhy, reviewWaitOf } from '../../src/work/resultCheck.mjs'

const at = (hh, mm) => new Date(2026, 10, 10, hh, mm).getTime()
const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const PARTNER = { name: 'Partner', state: 'free', isRunning: true }
const stuck = (store, now) => findStuck({ items: store, lanes: [], partner: PARTNER, now, outbox: [] }).filter(one => one.check === 'unchecked')

/** B1096 in review: board check passed 21:48; its check at `checkAt` left 1 of 11 points for the person, naming `named`. */
const step = (checkAt, named = 'Q718') => item(
  { Id: 'B1096', Kind: 'step', Title: 'Old maps always recognisable', State: 'review', Owner: 'Worker 1', Goal: 'G60', Since: '2026-11-10 21:47' },
  {
    'What we build': ['- the plate on every old map', '- you see it once, at the end'],
    History: [
      '- 2026-11-10 21:47 Worker 1: in progress → review',
      '- 2026-11-10 21:48 server: check passed: work in lava-tactics; branch gone; worktree gone; result named',
      '- 2026-11-10 21:50 person: Q718 answered',
      `- 2026-11-10 ${checkAt} Worker 5: result check waits for you: 10 of 11 points pass, score 85 of 75; 1 for you to judge`,
    ],
    Checked: ['Evidence: art-inbox/B1117/evidence.png', '- pass: the plate on every old map', `- ask: You see it once, at the end (${named})`],
  },
)
/** Q718 of B1096, filed 21:47, answered by the person 21:50. */
const q718 = (since = '2026-11-10 21:50', state = 'answered') => item({ Id: 'Q718', Kind: 'ask', Title: 'Does the old-map plate read at a glance?', State: state, Of: 'B1096', Since: since, Filed: String(at(21, 47)) })
const qa = (id, made, why = null) => item(
  { Id: id, Kind: 'step', Title: 'Quality Assurance: B1096 Old maps always recognisable', State: 'done', Checks: 'B1096', 'Not by': 'Worker 1', Since: made },
  { Context: ['  Built by: Worker 1', ...(why === null ? [] : [`  Why: ${why}`])] },
)
const B1117 = qa('B1117', '2026-11-10 21:49')

test('the real case: Q718 answered at 21:50, the check at 21:53 names it: the step waits for its check again at once', () => {
  const store = items(step('21:53'), q718(), B1117)
  const wait = reviewWaitOf(store.get('B1096'), store, null, at(21, 54))
  assert.equal(wait.kind, 'check')
  assert.equal(checkWhy(store.get('B1096'), store), `${ANSWERED_WHY}; ${JUDGE_ANSWERED}`)
  assert.deepEqual(stuck(store, at(21, 54)).map(one => one.fix), [{ do: 'qa', id: 'B1096' }])
})

test('an answer in the check line\'s own minute counts too: the named ask is answered', () => {
  const store = items(step('21:50'), q718(), B1117)
  assert.equal(reviewWaitOf(store.get('B1096'), store, null, at(21, 51)).kind, 'check')
})

test('a withdrawn or open named ask stays as before: withdrawn counts only after the line, open waits for its answer', () => {
  const withdrawn = items(step('21:53'), q718('2026-11-10 21:50', 'withdrawn'), B1117)
  assert.equal(reviewWaitOf(withdrawn.get('B1096'), withdrawn, null, at(21, 54)).kind, 'answer')
  const open = items(step('21:53'), q718('2026-11-10 21:47', 'open'), B1117)
  assert.deepEqual([reviewWaitOf(open.get('B1096'), open, null, at(23, 0)).kind, reviewWaitOf(open.get('B1096'), open, null, at(23, 0)).ask], ['answer', 'Q718'])
})

test('the guard: a task made for an answered ask point whose check again leaves it for the person again: no third task, one word', () => {
  const B1120 = qa('B1120', '2026-11-10 21:54', ANSWERED_WHY)
  const store = items(step('22:05'), q718(), B1117, B1120)
  const now = at(22, 6)
  const wait = reviewWaitOf(store.get('B1096'), store, null, now)
  assert.equal(wait.kind, 'unasked')
  assert.equal(wait.answered, true)
  assert.deepEqual(wait.asks, ['Q718'])
  assert.equal(wait.text, 'its checker left an answered ask for the person')
  const found = stuck(store, now)
  assert.deepEqual(found.map(one => [one.key, one.fix.do, one.fix.chat, one.fix.id]), [[`unasked B1096 ${stamp(at(22, 5))}`, 'wake', 'Partner', 'B1096']])
  assert.match(found[0].fix.text, /^B1096's result check left 1 ask point for the person naming Q718, which is answered already, twice/)
  // An answer given after this check line is new to it: the check again is due, guard or not.
  const later = items(step('22:05'), q718('2026-11-10 22:10'), B1117, B1120)
  assert.equal(reviewWaitOf(later.get('B1096'), later, null, at(22, 11)).kind, 'check')
})

test('the QA brief and the task\'s Why say how an answered ask point is judged', () => {
  assert.match(NAME_THE_ASK, /an ask point whose named ask is answered is judged from that answer, pass or fail, never left for the person/)
})
