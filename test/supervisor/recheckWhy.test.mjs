// B565, the fix of X19: B510's check failed with fix B558 and an ask point Q339; B558 passed, but the partner read B510
// as waiting only for the person's answer and answered the board's "check step B510" with no new check, so B510 sat in
// review. Now the check word says why it comes (its fix is done; its open ask points kept), and the repair `unchecked`
// also wakes the partner for a step whose fix is done. Made-up items; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { findStuck } from '../../src/supervisor/rules/repair.mjs'
import { checkStepWords } from '../../src/say.mjs'
import { checkWhy } from '../../src/work/resultCheck.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 20, 44).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
/** B510 as X19 found it: its board check passed, its result check failed with fix B558 and one point for the person. */
const b510 = item({ Id: 'B510', Kind: 'step', Title: 'Turn the delayed skills on', State: 'review', Owner: 'Painter', Since: stamp(ago(76)) }, {
  'What we build': ['- every delayed skill lands', '- the fights feel right'],
  History: [`- ${stamp(ago(80))} server: check passed: merged`, `- ${stamp(ago(76))} Checker: result check failed: 0 of 2 points pass; fix B558 for Painter; 1 for you to judge`],
  Checked: ['Evidence: none', '- fail: every delayed skill lands', '- ask: the fights feel right'],
})
const fix = state => item({ Id: 'B558', Kind: 'step', Title: 'Fix: every delayed skill lands', State: state, Owner: 'Painter', Since: stamp(ago(44)), 'Fix of': 'B510' })
const q339 = item({ Id: 'Q339', Kind: 'ask', Title: 'Do the fights feel right?', State: 'open', Of: 'B510', Since: stamp(ago(76)) })

const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const PARTNER = { name: 'Partner', state: 'free', isRunning: true }
const unchecked = (store, more = {}) => findStuck({ items: store, lanes: [LEAD], partner: PARTNER, now: NOW, outbox: [], ...more }).filter(one => one.check === 'unchecked')

test('X19: a step whose fix is done gets a check word that says why, its open ask point kept', () => {
  const store = items(b510, fix('done'), q339)
  const why = checkWhy(b510, store)
  assert.equal(why, 'its fix B558 is done: file its check again; keep Q339 as an ask point')
  const words = checkStepWords('Partner', { id: 'B510', title: 'Turn the delayed skills on', owner: 'Painter', why }, 'roles/partner.md')
  assert.equal(words.text.split('\n')[3], 'Why: its fix B558 is done: file its check again; keep Q339 as an ask point')
  // A first check says no why.
  assert.doesNotMatch(checkStepWords('Partner', { id: 'B510', title: 'x', owner: 'Painter' }, 'roles/partner.md').text, /Why:/)
})

test('X19: the repair wakes the partner for a step whose fix is done 30 minutes, with the why; not while its fix is open', () => {
  const woke = unchecked(items(b510, fix('done'), q339))
  assert.deepEqual(woke.map(one => [one.fix.do, one.fix.chat, one.fix.id]), [['wake', 'Partner', 'B510']])
  assert.equal(woke[0].fix.text, 'check step B510 (its fix B558 is done: file its check again; keep Q339 as an ask point); see roles/partner.md, "The check"')
  assert.equal(woke[0].text, 'B510 in review 44 min with its fix B558 done and no check filed again')
  // An open fix: the step waits for its fix, no check word, no why.
  for (const state of ['queued', 'in progress', 'review']) {
    assert.equal(checkWhy(b510, items(b510, fix(state), q339)), null, state)
    assert.deepEqual(unchecked(items(b510, fix(state), q339)), [], state)
  }
  // Done only lately (under 30 minutes): not yet.
  assert.deepEqual(unchecked(items(b510, fix('done'), q339), { now: ago(20) }), [])
})

test('an answered ask point says so; with two asks open both are kept', () => {
  const waits = item({ ...Object.fromEntries(b510.head) }, {
    ...Object.fromEntries(b510.sections),
    History: [`- ${stamp(ago(80))} server: check passed: merged`, `- ${stamp(ago(76))} Checker: result check waits for you: 1 of 2 points pass; 1 for you to judge`],
  })
  assert.equal(checkWhy(waits, items(waits, item({ ...Object.fromEntries(q339.head), State: 'answered' }))), 'its ask point is answered: file its check again')
  const q340 = item({ ...Object.fromEntries(q339.head), Id: 'Q340' })
  assert.equal(checkWhy(b510, items(b510, fix('done'), q340, q339)), 'its fix B558 is done: file its check again; keep Q339 and Q340 as ask points')
})
