// B1103 (X163: the repair "unchecked" made a Quality Assurance task for B1091 every ~33 minutes, five in all): B1091's checks left
// 7 look points for the person that the evaluation ask Q712 of its goal already asked, so its checkers rightly filed no ask, and the
// board counted only a new ask of the step. Replayed from the store's records (ids and times as they were; titles made up): an ask
// point that names the open ask carrying it makes the step wait for that answer, and a check that waited with no ask filed or named
// gets one more task at most, then the step names the cause and the partner gets one word.

import assert from 'node:assert/strict'
import test from 'node:test'

import { applySync } from '../../src/supervisor/loop.mjs'
import { findStuck } from '../../src/supervisor/rules/repair.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { NAME_THE_ASK, UNASKED_WHY, checkWhy, namedAskIds, reviewWaitOf } from '../../src/work/resultCheck.mjs'

const at = (hh, mm) => new Date(2026, 10, 9, hh, mm).getTime()
const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const PARTNER = { name: 'Partner', state: 'free', isRunning: true }
const stuck = (store, now, more = {}) => findStuck({ items: store, lanes: [], partner: PARTNER, now, outbox: [], ...more }).filter(one => one.check === 'unchecked')

/** B1091 in review: its board check passed at 15:02, its last check at `checkAt` waited for the person on 7 of 8 points. */
const step = (checkAt, asks = ['ask: the bridges read as bridges']) => item(
  { Id: 'B1091', Kind: 'step', Title: 'Fix: the bridges read as land', State: 'review', Owner: 'Worker 5', Goal: 'G60', Since: '2026-11-09 15:02', 'Fix of': 'B1088' },
  {
    'What we build': ['- the bridges read as bridges'],
    History: [
      '- 2026-11-09 15:02 Worker 5: in progress → review',
      '- 2026-11-09 15:02 server: check passed with warnings: work in the game; branch gone; worktree gone; result named',
      '- 2026-11-09 15:05 Worker 1: result check waits for you: 1 of 8 points pass; 7 for you to judge',
      ...(checkAt === '15:05' ? [] : [`- 2026-11-09 ${checkAt} Worker 1: result check waits for you: 1 of 8 points pass; 7 for you to judge`]),
    ],
    Checked: ['Evidence: pictures/B1091/before-after.png', '- pass: cells and walking unchanged', ...asks.map(one => `- ${one}`)],
  },
)
/** Q711 (of B1091, filed 14:53, answered by the partner 15:09) and Q712 (the evaluation ask of goal G60, 15:10, answered 16:01). */
const q711 = item({ Id: 'Q711', Kind: 'ask', Title: 'Where do you want stairs seen from the side?', State: 'answered', Of: 'B1091', Since: '2026-11-09 15:09', Filed: String(at(14, 53)) })
const q712 = (state = 'open') => item({ Id: 'Q712', Kind: 'ask', Title: 'Rebuild G60: where do you want stairs seen from the side?', State: state, Of: 'G60', Since: state === 'open' ? '2026-11-09 15:10' : '2026-11-09 16:01', Filed: String(at(15, 10)) })
const qa = (id, made, why = null, state = 'done') => item(
  { Id: id, Kind: 'step', Title: 'Quality Assurance: B1091 Fix: the bridges read as land', State: state, Checks: 'B1091', 'Not by': 'Worker 5', Since: made },
  { Context: ['  Built by: Worker 5', ...(why === null ? [] : [`  Why: ${why}`])] },
)
const B1092 = qa('B1092', '2026-11-09 15:05')
const B1093 = qa('B1093', '2026-11-09 15:36', 'its ask point is answered: file its check again')

test('the real case: B1093 checked at 15:36, Q712 of its goal open, 31 minutes later: no new QA task when an ask point names Q712', () => {
  const now = at(16, 7)
  // As the checkers filed it, naming nothing: one task more is made (the guard allows one), and its Why says why.
  const plain = items(step('15:36'), q711, q712(), B1092, B1093)
  assert.deepEqual(stuck(plain, now).map(one => one.fix), [{ do: 'qa', id: 'B1091' }])
  assert.equal(checkWhy(plain.get('B1091'), plain), `${UNASKED_WHY}; ${NAME_THE_ASK}`)
  // Named: the step waits for the person's answer in Q712, and no task is made.
  const named = items(step('15:36', ['ask: the bridges read as bridges (Q712)']), q711, q712(), B1092, B1093)
  assert.deepEqual(stuck(named, now), [])
  const wait = reviewWaitOf(named.get('B1091'), named, null, now)
  assert.equal(wait.kind, 'answer')
  assert.equal(wait.ask, 'Q712')
  assert.equal(wait.text, 'waits for your answer to its check in Q712')
  // Chat 3's P6 (Rule 15): an ask held for the person's words stays open with Route asker: the step keeps waiting for it.
  const held = item({ Id: 'Q712', Kind: 'ask', Title: 'Rebuild G60: where?', State: 'open', Of: 'G60', Route: 'asker', Since: '2026-11-09 15:10', Filed: String(at(15, 10)) })
  const heldStore = items(step('15:36', ['ask: the bridges read as bridges (Q712)']), q711, held, B1092, B1093)
  assert.deepEqual([reviewWaitOf(heldStore.get('B1091'), heldStore, null, at(17, 30)).kind, stuck(heldStore, at(17, 30)).length], ['answer', 0])
  // Once Q712 is answered (16:01, after the check line), the step waits for its check again: one task, its Why the answer.
  const answered = items(step('15:36', ['ask: the bridges read as bridges (Q712)']), q711, q712('answered'), B1092, B1093)
  assert.deepEqual(stuck(answered, now).map(one => one.fix), [{ do: 'qa', id: 'B1091' }])
  assert.equal(checkWhy(answered.get('B1091'), answered), 'its ask point is answered: file its check again')
})

test('Q711, open at the 15:05 check and answered at 15:09, makes the check due at once, not 30 minutes later', () => {
  const store = items(step('15:05'), q711, B1092)
  const wait = reviewWaitOf(store.get('B1091'), store, null, at(15, 10))
  assert.equal(wait.kind, 'check')
  assert.equal(checkWhy(store.get('B1091'), store), 'its ask point is answered: file its check again')
})

test('a named ask that is not open, or is no ask of the step or its goal, counts for nothing', () => {
  // Q711 was answered at 15:09, before the 15:36 line; Q999 is of another goal; Q404 is not in the store.
  const other = item({ Id: 'Q999', Kind: 'ask', Title: 'x', State: 'open', Of: 'G7', Since: '2026-11-09 15:00', Filed: String(at(15, 0)) })
  for (const name of ['Q711', 'Q999', 'Q404']) {
    const store = items(step('15:36', [`ask: the bridges read as bridges (${name})`]), q711, other, B1092, B1093)
    assert.equal(reviewWaitOf(store.get('B1091'), store, null, at(15, 50)).kind, 'answer', `${name}: the checker's 30 minutes`)
    assert.equal(reviewWaitOf(store.get('B1091'), store, null, at(16, 7)).kind, 'check', `${name}: a check again`)
  }
})

test('the guard: a task made because its checker filed no ask point, whose check waited so again: no third task, one word to the partner', () => {
  const B1097 = qa('B1097', '2026-11-09 16:10', `${UNASKED_WHY}; ${NAME_THE_ASK}`)
  const store = items(step('16:10'), q711, q712('answered'), B1092, B1093, B1097)
  const now = at(16, 41)
  const wait = reviewWaitOf(store.get('B1091'), store, null, now)
  assert.equal(wait.kind, 'unasked')
  assert.equal(wait.text, 'its checker filed no ask point')
  assert.equal(wait.points, 1)
  const found = stuck(store, now)
  assert.deepEqual(found.map(one => [one.key, one.fix.do, one.fix.chat, one.fix.id]), [[`unasked B1091 ${stamp(at(16, 40))}`, 'wake', 'Partner', 'B1091']])
  assert.match(found[0].fix.text, /^B1091's result check waits for the person on 1 ask point, but its checkers filed no ask and named none, twice/)
  assert.match(found[0].fix.text, /work note of B1091 "its ask points are carried by Q<n>"/)
  // The word goes once per wait: with its key in the outbox the rule is quiet.
  assert.deepEqual(stuck(store, now, { outbox: [{ syncKey: found[0].key, about: 'B1091', at: now, state: 'taken' }] }), [])
  // Within the checker's 30 minutes it still waits for the person, as before.
  assert.equal(reviewWaitOf(store.get('B1091'), store, null, at(16, 30)).kind, 'answer')
})

test('the guard lets go once the ask is filed or named: an ask of the step since the line, or a note about it naming an open ask', () => {
  const B1097 = qa('B1097', '2026-11-09 16:10', `${UNASKED_WHY}; ${NAME_THE_ASK}`)
  const now = at(16, 45)
  const filed = item({ Id: 'Q713', Kind: 'ask', Title: 'Do the bridges read as bridges?', State: 'open', Of: 'B1091', Since: '2026-11-09 16:42', Filed: String(at(16, 42)) })
  const withAsk = items(step('16:10'), q711, q712('answered'), B1092, B1093, B1097, filed)
  assert.equal(reviewWaitOf(withAsk.get('B1091'), withAsk, null, now).kind, 'answer')
  assert.deepEqual(stuck(withAsk, now), [])
  const q720 = item({ Id: 'Q720', Kind: 'ask', Title: 'G60: the bridges?', State: 'open', Of: 'G60', Since: '2026-11-09 16:20', Filed: String(at(16, 20)) })
  const note = item({ Id: 'N1', Kind: 'note', From: 'Partner', To: 'main', State: 'unread', Since: '2026-11-09 16:43', Text: 'its ask points are carried by Q720' }, { Text: ['its ask points are carried by Q720'], About: ['B1091'] })
  const withNote = items(step('16:10'), q711, q712('answered'), B1092, B1093, B1097, q720, note)
  const wait = reviewWaitOf(withNote.get('B1091'), withNote, null, now)
  assert.deepEqual([wait.kind, wait.ask], ['answer', 'Q720'])
  // A note from before the check line names nothing for this check.
  const old = item({ Id: 'N1', Kind: 'note', From: 'Partner', To: 'main', State: 'unread', Since: '2026-11-09 16:00', Text: 'carried by Q720' }, { Text: ['carried by Q720'], About: ['B1091'] })
  assert.equal(reviewWaitOf(items(step('16:10'), q711, B1092, B1093, B1097, q720, old).get('B1091'), items(step('16:10'), q711, B1092, B1093, B1097, q720, old), null, now).kind, 'unasked')
})

test('a task made for an answered ask point or a done fix does not trip the guard; a dropped task does not count', () => {
  // B1093 (an answered ask point) checked with no ask: one more task is made, as in the real case.
  assert.deepEqual(stuck(items(step('15:36'), q711, B1092, B1093), at(16, 7)).map(one => one.fix.do), ['qa'])
  // A dropped unasked task (B1100) is not the one whose check stands.
  const B1100 = qa('B1100', '2026-11-09 16:29', `${UNASKED_WHY}; ${NAME_THE_ASK}`, 'dropped')
  assert.deepEqual(stuck(items(step('15:36'), q711, B1092, B1093, B1100), at(16, 7)).map(one => one.fix.do), ['qa'])
})

test('applySync: the partner word is a wake with the finding key', async () => {
  const B1097 = qa('B1097', '2026-11-09 16:10', `${UNASKED_WHY}; ${NAME_THE_ASK}`)
  const found = stuck(items(step('16:10'), q711, B1092, B1093, B1097), at(16, 41))
  const sent = []
  const done = await applySync(found, { wake: async one => { sent.push(one); return { id: 'm1' } } })
  assert.deepEqual(sent.map(one => [one.chat, one.id, one.key]), [['Partner', 'B1091', found[0].key]])
  assert.deepEqual(done.rows.map(one => one.status), ['Woke'])
})

test('namedAskIds reads the brackets that end an ask point, and only ask ids', () => {
  assert.deepEqual(namedAskIds('the bridges read as bridges (Q712)'), ['Q712'])
  assert.deepEqual(namedAskIds('both looks (Q711, Q712) '), ['Q711', 'Q712'])
  assert.deepEqual(namedAskIds('both looks (Q711 and Q712)'), ['Q711', 'Q712'])
  assert.deepEqual(namedAskIds('the look (Q712) is fine'), [])
  assert.deepEqual(namedAskIds('the look (see B1095)'), [])
  assert.deepEqual(namedAskIds('the look'), [])
})
