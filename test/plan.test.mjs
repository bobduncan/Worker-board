// Plan (2026-10-19): the product plan's page read for the Vision tab: its pitch, the answers with their state, source,
// revisit moment, points and pictures, the log's counts, and the partner's open ask matched to an open answer, its
// options as cards.
import assert from 'node:assert/strict'
import test from 'node:test'

import { focusMove } from '../src/focus.mjs'
import { optionCard, parsePlan, planState } from '../src/plan.mjs'
import { parseItem } from '../src/work/item.mjs'
import { itemsOf, storeFromText } from '../src/work/read.mjs'

const PAGE = `# A game: the product plan

Some words above the answers.

Pitch: Push them into the lava.

## P1 · What it is, for whom

- State: decided (from [game-vision.md](game-vision.md), 2026-10-10) · the player: assumed, revisit after M1 is played
- Answer: a tactics roguelite on lava,
  short battles.
- The player: you first.
- Point: **Tactics roguelite:** short fights
- Point: **For:** you first
- Picture: art-inbox/vision/look.png · the look · we aim for
- Picture: art-inbox/vision/today.png

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

test('parsePlan: the pitch, the points and the pictures', () => {
  const { pitch, answers } = parsePlan(PAGE)
  assert.equal(pitch, 'Push them into the lava.')
  assert.deepEqual(answers[0].points, ['**Tactics roguelite:** short fights', '**For:** you first'])
  assert.deepEqual(answers[0].pictures, [{ path: 'art-inbox/vision/look.png', caption: 'the look · we aim for' }, { path: 'art-inbox/vision/today.png', caption: '' }])
  assert.deepEqual([answers[1].points, answers[1].pictures], [[], []])
  assert.equal(parsePlan(['# Title', '', 'Pitch: one', '', '## Other', '', 'Pitch: not this', ''].join('\n')).pitch, 'one')
})

test('optionCard: the letter, the head before the colon, and the points after it', () => {
  assert.deepEqual(optionCard('A A link for friends: free and unlisted; ask again after M2'), { key: 'A', head: 'A link for friends', points: ['free and unlisted', 'ask again after M2'] })
  assert.deepEqual(optionCard('B public on itch.io'), { key: 'B', head: 'public on itch.io', points: [] })
  assert.deepEqual(optionCard('Yes'), { key: '', head: 'Yes', points: [] })
  assert.deepEqual(optionCard('Steam: later'), { key: '', head: 'Steam', points: ['later'] })
})

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
  const ask = `Id: Q7
Kind: ask
Title: P5: how does the game reach people?
State: open
Owner: Game - Advisor
Asks: decide
Of: G1
Options: A a link for friends | B public on itch.io | C Steam, later
Advice: A, revisit after M2

## Text
Known: the browser
on a desktop.
`
  const other = `Id: Q8
Kind: ask
Title: Look at the menu
State: open
Owner: Game - Worker 1
Asks: look
Of: B1
Options: Yes | No
`
  const items = itemsOf(work)
  const { answers, counts, path, log } = planState(PAGE, [...items, parseItem(ask), parseItem(other)], 'docs/product-plan.md')
  assert.equal(path, 'docs/product-plan.md')
  assert.deepEqual(counts, { decided: 1, assumed: 1, open: 2 })
  assert.deepEqual(log, { hits: 2, gaps: 1, overturned: 1 })
  assert.equal(answers[0].ask, null)
  assert.deepEqual(answers[2].ask.options.map(({ key, head, isAdvised, picture }) => [key, head, isAdvised, picture]), [
    ['A', 'a link for friends', true, null], ['B', 'public on itch.io', false, null], ['C', 'Steam, later', false, null],
  ])
  assert.deepEqual([answers[2].ask.id, answers[2].ask.question, answers[2].ask.advice, answers[2].ask.text, answers[2].ask.pictures],
    ['Q7', 'How does the game reach people?', 'A, revisit after M2', 'Known: the browser on a desktop.', []])
  // As many pictures as options: one per option, in their order; another number: all above the options.
  const pictured = ask.replace('Advice:', 'Pictures: a.png, b.png, c.png\nAdvice:')
  assert.deepEqual(planState(PAGE, [parseItem(pictured)], 'p.md').answers[2].ask.options.map(option => option.picture), ['a.png', 'b.png', 'c.png'])
  const two = ask.replace('Advice:', 'Pictures: a.png, b.png\nAdvice:')
  assert.deepEqual([planState(PAGE, [parseItem(two)], 'p.md').answers[2].ask.pictures, planState(PAGE, [parseItem(two)], 'p.md').answers[2].ask.options[0].picture], [['a.png', 'b.png'], null])
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

