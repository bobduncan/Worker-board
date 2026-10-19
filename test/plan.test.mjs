// Plan (2026-10-19): the product plan's page read for the Plan part of the Focus page: the eight answers with their
// state, source and revisit moment, the log's counts, and the partner's open ask matched to an open answer.
import assert from 'node:assert/strict'
import test from 'node:test'

import { focusMove } from '../src/focus.mjs'
import { parsePlan, planState } from '../src/plan.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { itemsOf } from '../src/work/read.mjs'

const PAGE = `# A game: the product plan

Some words above the answers.

## P1 · What it is, for whom

- State: decided (from [game-vision.md](game-vision.md), 2026-10-10) · the player: assumed, revisit after M1 is played
- Answer: a tactics roguelite on lava,
  short battles.
- The player: you first.

## P2 · Why it is good

- State: assumed (partner, 2026-10-19) · revisit after the first playable
- Answer: thinking is rewarded.
- Overturned (2026-10-20): the playable showed brute force wins.

## P5 · How it reaches people

- State: open
- Known: browser on a desktop.

## P9 · Something odd

- State: Passed
- Answer: a state the page does not know reads as open, never as decided.

## The log

- hit P1: the pitch decided the menu's words
- hit P2: the feel decided the hit pause
- gap: the plan does not say whether a run may be paused
- overturned P2: brute force wins
- not a log line
`

test('parsePlan: the answers with their state, source, revisit and text, and the log counted', () => {
  const { answers, log } = parsePlan(PAGE)
  assert.deepEqual(answers.map(one => [one.id, one.title, one.state]), [
    ['P1', 'What it is, for whom', 'decided'], ['P2', 'Why it is good', 'assumed'], ['P5', 'How it reaches people', 'open'], ['P9', 'Something odd', 'open'],
  ])
  assert.deepEqual([answers[0].from, answers[0].at, answers[0].revisit], ['game-vision.md', '2026-10-10', 'M1 is played'])
  assert.equal(answers[0].answer, 'a tactics roguelite on lava, short battles.')
  assert.equal(answers[0].detail, '(from [game-vision.md](game-vision.md), 2026-10-10) · the player: assumed, revisit after M1 is played')
  assert.deepEqual([answers[1].by, answers[1].at, answers[1].revisit], ['partner', '2026-10-19', 'the first playable'])
  assert.deepEqual(answers[1].overturned, ['2026-10-20: the playable showed brute force wins.'])
  assert.equal(answers[2].known, 'browser on a desktop.')
  assert.deepEqual([log.hits, log.gaps, log.overturned, log.lines.length], [2, 1, 1, 4])
  assert.deepEqual(log.lines[2], { kind: 'gap', id: null, text: 'the plan does not say whether a run may be paused' })
})

test('parsePlan: no page, or a page without answers, gives none', () => {
  assert.deepEqual(parsePlan(null).answers, [])
  assert.deepEqual(parsePlan('# Nothing here\n\nwords\n').answers, [])
})

test('planState: the counts, the path, and the partner\'s open ask on the open answer with its options', () => {
  const work = storeFromText(['## Plan', '- [ ] B1 Decide the plan (for Main)', ''].join('\n'), { now: Date.now() })
  const ask = `Kind: ask
Id: Q7
Of: G1
State: open
Title: P5: how does the game reach people?
Text: Known: the browser on a desktop.
Options: A a link for friends | B public on itch.io | C Steam, later
Advice: A, revisit after M2
Asked by: Game - Advisor
Askkind: decide
`
  const other = `Kind: ask
Id: Q8
Of: B1
State: open
Title: Look at the menu
Options: Yes | No
Asked by: Game - Worker 1
Askkind: look
`
  const items = itemsOf(work)
  const { answers, counts, path, log } = planState(PAGE, [...items, fakeItem(ask), fakeItem(other)], 'docs/product-plan.md')
  assert.equal(path, 'docs/product-plan.md')
  assert.deepEqual(counts, { decided: 1, assumed: 1, open: 2 })
  assert.deepEqual(log, { hits: 2, gaps: 1, overturned: 1 })
  assert.equal(answers[0].ask, null)
  assert.deepEqual(answers[2].ask.options, [
    { label: 'A a link for friends', isAdvised: true }, { label: 'B public on itch.io', isAdvised: false }, { label: 'C Steam, later', isAdvised: false },
  ])
  assert.deepEqual([answers[2].ask.id, answers[2].ask.advice], ['Q7', 'A, revisit after M2'])
})

test('the Plan part\'s Confirm and Change: a word to the partner, nothing written; a bad id or empty words refused', async () => {
  const ctx = { canWrite: true, partner: { name: 'Game - Advisor' }, job: 'C:/board/roles/partner.md' }
  const confirmed = await focusMove({ command: 'plan-confirm', id: 'P5' }, ctx)
  assert.equal(confirmed.ok, true)
  assert.deepEqual([confirmed.words.to, confirmed.words.command, confirmed.words.about], ['Game - Advisor', 'plan-confirm', 'P5'])
  assert.equal(confirmed.words.text, 'plan: P5 confirmed\nYour job: C:/board/roles/partner.md, "The plan interview"')
  const changed = await focusMove({ command: 'plan-change', id: 'P1', text: 'The player:\n  anyone who likes Into the Breach' }, ctx)
  assert.equal(changed.words.text, 'plan: P1 change\nWords: The player: anyone who likes Into the Breach\nYour job: C:/board/roles/partner.md, "The plan interview"')
  assert.equal((await focusMove({ command: 'plan-change', id: 'P1', text: '  ' }, ctx)).status, 400)
  assert.equal((await focusMove({ command: 'plan-confirm', id: 'G5' }, ctx)).status, 400)
  assert.equal((await focusMove({ command: 'plan-confirm', id: 'P5' }, { ...ctx, canWrite: false })).status, 403)
  assert.equal((await focusMove({ command: 'plan-confirm', id: 'P5' }, { ...ctx, partner: null })).status, 409)
})

test('planState: null without a page', () => {
  assert.equal(planState(null, [], 'docs/product-plan.md'), null)
  assert.equal(planState('   ', [], 'docs/product-plan.md'), null)
})

/** An item as the store keeps it: its head fields in a Map (work/item.mjs). */
function fakeItem(text) {
  const head = new Map()
  for (const line of text.split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) head.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  return { id: head.get('Id'), head, sections: new Map() }
}
