// Plan (2026-10-19): the product plan's page read for the Vision tab: its pitch, the answers with their state, source,
// revisit moment, points and pictures, the log's counts, and the partner's open ask matched to an open answer, its
// options as cards.
import assert from 'node:assert/strict'
import test from 'node:test'

import { focusMove } from '../src/focus.mjs'
import { PLAN_LATE_MS, optionCard, parsePlan, planState, withPlanWork } from '../src/plan.mjs'
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
  assert.deepEqual([answers[2].ask.askId, answers[2].ask.question, answers[2].ask.advice, answers[2].ask.text, answers[2].ask.pictures],
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
  const asked = await focusMove({ command: 'plan-ask', id: 'P6' }, ctx)
  assert.equal(asked.words.text, ['plan: P6 ask', 'Your job: C:/board/roles/partner.md, "The plan interview"'].join('\n'))
  assert.equal((await focusMove({ command: 'plan-change', id: 'P1', text: '  ' }, ctx)).status, 400)
  assert.equal((await focusMove({ command: 'plan-confirm', id: 'G5' }, ctx)).status, 400)
  assert.equal((await focusMove({ command: 'plan-confirm', id: 'P5' }, { ...ctx, canWrite: false })).status, 403)
  assert.equal((await focusMove({ command: 'plan-confirm', id: 'P5' }, { ...ctx, partner: null })).status, 409)
})

test('the Vision tab\'s other moves: deeper, marks, a feature added, goals confirmed, changed and agreed; a change of a feature or goal', async () => {
  const ctx = { canWrite: true, partner: { name: 'Game - Advisor' }, job: 'J' }
  const words = async body => (await focusMove(body, ctx)).words.text.split('\n')
  assert.deepEqual(await words({ command: 'plan-deeper', id: 'P1' }), ['plan: P1 deeper', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-marks', text: 'F3 later; F5 must' }), ['plan: features marked', 'Marks: F3 later; F5 must', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-feature-add', text: 'A pet that follows you' }), ['plan: feature add', 'Words: A pet that follows you', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-goals-confirm', text: 'S1, S4' }), ['plan: goals confirmed', 'Goals: S1, S4', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-goals-change', text: 'Merge S2 and S3' }), ['plan: goals change', 'Words: Merge S2 and S3', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-goals-agree' }), ['plan: goals agreed', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-change', id: 'F3', text: 'only at night' }), ['plan: F3 change', 'Words: only at night', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-change', id: 'S2', text: 'later' }), ['plan: S2 change', 'Words: later', 'Your job: J, "The plan interview"'])
  assert.equal((await focusMove({ command: 'plan-goals-agree' }, ctx)).words.about, 'plan')
  // Refused: a list not in its form, empty words, Go deeper on a feature.
  assert.equal((await focusMove({ command: 'plan-marks', text: 'F3 maybe' }, ctx)).status, 400)
  assert.equal((await focusMove({ command: 'plan-goals-confirm', text: 'S1 and S2' }, ctx)).status, 400)
  assert.equal((await focusMove({ command: 'plan-feature-add', text: ' ' }, ctx)).status, 400)
  assert.equal((await focusMove({ command: 'plan-deeper', id: 'F1' }, ctx)).status, 400)
})

test('parsePlan: the features with their marks, complex and built; the goal preset per milestone', () => {
  const { features, milestones } = parsePlan(`# P

## P1 · What

- State: decided (you, 2026-10-19)

## Features

### F1 · Benches

- Mark: must (from vision.md, 2026-10-10)
- Complex: no
- Built: yes
- Point: **Wood,** never metal

### F2 · A pond

- Mark: ? (partner, 2026-10-19)
- Complex: yes · water changes every path
- Built: partly

### F3 · Lamps

- Mark: not sure
- Built: maybe

### F4 · Swings

- Mark: perhaps

## Goals preset

#### S9 · Before any milestone: not a goal

### M1 · A first corner

#### S1 · Two benches

- State: confirmed (you, 2026-10-19)
- Done when: two benches stand
  by the path
- Serves: P1, P2, G4
- Sub: Draw the bench
- Goal: G3

### M3+ · Growth

#### S2 · A pond

- Done when: it holds water
- Goal: later

### F5 · Not a feature: under the goals
`)
  assert.deepEqual(features.map(one => [one.id, one.name, one.mark, one.by, one.from, one.at, one.isComplex, one.why, one.built, one.points]), [
    ['F1', 'Benches', 'must', null, 'vision.md', '2026-10-10', false, '', 'yes', ['**Wood,** never metal']],
    ['F2', 'A pond', 'unsure', 'partner', null, '2026-10-19', true, 'water changes every path', 'partly', []],
    ['F3', 'Lamps', 'unsure', null, null, null, false, '', 'no', []],
    ['F4', 'Swings', 'unsure', null, null, null, false, '', 'no', []],
  ])
  assert.deepEqual(milestones.map(one => [one.id, one.title, one.goals.map(goal => [goal.id, goal.title, goal.state, goal.by, goal.doneWhen, goal.serves, goal.subs, goal.goal])]), [
    ['M1', 'A first corner', [['S1', 'Two benches', 'confirmed', 'you', 'two benches stand by the path', ['P1', 'P2'], ['Draw the bench'], 'G3']]],
    ['M3+', 'Growth', [['S2', 'A pond', 'proposed', null, 'it holds water', [], [], null]]],
  ])
})

test('planState: the questions on the plan in the page\'s order, the marks, the architecture check, the preset\'s counts', () => {
  const page = `# P

## P1 · What

- State: decided (you, 2026-10-19)

## Features

### F1 · A pond

- Mark: later
- Complex: yes

### F2 · Benches

- Mark: must

## Goals preset

### M1 · First

#### S1 · Benches

- State: confirmed (you, 2026-10-19)

#### S2 · Lamps
`
  const asks = ['S2: when do the lamps come?', 'F1: when should the pond come?', 'P1.2: how big?', 'P1: what is it?', 'P1.1: for whom?', 'G3: not about the plan'].map((title, at) => parseItem(`Id: Q${at + 1}\nKind: ask\nTitle: ${title}\nState: open\nOwner: P - Partner\nAsks: decide\n`))
  const state = planState(page, asks, 'p.md')
  assert.deepEqual(state.questions.map(one => [one.id, one.about, one.isDeeper, one.askId]), [
    ['P1', 'P1', false, 'Q4'], ['P1.1', 'P1', true, 'Q5'], ['P1.2', 'P1', true, 'Q3'], ['F1', 'F1', false, 'Q2'], ['S2', 'S2', false, 'Q1'],
  ])
  assert.deepEqual([state.answers[0].ask.askId, state.answers[0].deeper], ['Q4', 2])
  assert.deepEqual(state.marks, { must: 1, later: 1, no: 0, unsure: 0 })
  assert.deepEqual(state.architecture, { everyMilestone: true, complex: ['F1'], open: ['F1'] })
  assert.deepEqual(state.preset, { total: 2, confirmed: 1 })
  assert.equal(planState('# P\n\n## P1 · What\n', [], 'p.md').architecture, null)
})

test('planState: null without a page', () => {
  assert.equal(planState(null, [], 'docs/product-plan.md'), null)
  assert.equal(planState('   ', [], 'docs/product-plan.md'), null)
})


test('withPlanWork: what the partner is preparing from the board\'s words, until its answer is there', () => {
  const page = '# P\n\n## P1 · What\n\n- State: decided (you, 2026-10-19)\n\n## P5 · Who\n\n- State: open\n'
  const at = 1_000_000
  const deeper = parseItem(`Id: Q8\nKind: ask\nTitle: P1.1: how big?\nState: open\nOwner: P - Partner\nAsks: decide\nFiled: ${at + 60_000}\n`)
  const old = parseItem(`Id: Q7\nKind: ask\nTitle: P1.1: how big?\nState: open\nOwner: P - Partner\nAsks: decide\nFiled: ${at - 60_000}\n`)
  const sent = [
    { command: 'plan-deeper', about: 'P1', at: at - 600_000, state: 'delivered' },
    { command: 'plan-deeper', about: 'P1', at, state: 'delivered' },
    { command: 'plan-ask', about: 'P5', at, state: 'waiting' },
    { command: 'plan-marks', about: 'plan', at, state: 'delivered' },
    { command: 'plan-goals-agree', about: 'plan', at, state: 'failed' },
    { command: 'focus', about: 'G1', at, state: 'delivered' },
  ]
  const work = (asks, pageAt, now = at + 120_000) => withPlanWork(planState(page, asks, 'p.md'), sent, pageAt, now).working.map(one => [one.command, one.about, one.state])
  // No answer yet: the newest word per part, its state; a word not about the plan is not shown.
  assert.deepEqual(work([old], null), [['plan-goals-agree', 'plan', 'failed'], ['plan-marks', 'plan', 'working'], ['plan-ask', 'P5', 'waiting'], ['plan-deeper', 'P1', 'working']])
  // A deeper question filed after the word ends Go deeper's work.
  assert.deepEqual(work([deeper], null).map(([command]) => command), ['plan-goals-agree', 'plan-marks', 'plan-ask'])
  // The page written after the words ends them all.
  assert.deepEqual(work([], at + 1), [])
  // Half an hour without an answer: late.
  assert.equal(work([], null, at + 31 * 60_000).find(([command]) => command === 'plan-marks')[2], 'late')
  assert.equal(withPlanWork(null, sent, null, at), null)
  assert.equal(PLAN_LATE_MS, 30 * 60_000)
})

test('parsePlan: the standards per kind, and a card\'s advice and settled lines', () => {
  const { answers, standards } = parsePlan(`# P

## P1 · What

- State: decided (you, 2026-10-19)
- Advice: solid; ask again
  after M1.
- Settled: yes (you, 2026-10-20)
- Icon: store · Steam, later
- Icon: badge:TS
- Icon:

## P2 · Look

- State: decided (you, 2026-10-19)
- Settled: no

## Standards

### K1 · Maps

- State: confirmed (you, 2026-10-20)
- Count: 5 per world · from S3
- Kind: map
- Done: docs/process/done/level.md
- Reference: art-inbox/vision/look-target.png · the look we aim for
- Today: art-inbox/vision/look-today.png · Ember Hollow
- Picture: art-inbox/levels/ember-hollow-plan.png · the map's plan
- Bar: reads at a glance where you walk
- Bar: cliffs and lava as the reference, scored 75+ · art-inbox/vision/standards/maps-cliffs.png
- Bar: every tile in view above the
  unit panel at 1280x720 · art-inbox/vision/standards/maps-view.png
- Bar: visible at a glance
  - ground types tell apart · art-inbox/vision/standards/maps-walkable.png
  - dangers read before a
    click
- Foundation: a way from the reference to the game's tiles · about 8 h
- Per item: about 2 h
- Score: 0 of 7 meet the bar · your word: clunky
- Gap: every map → "Maps meet the bar"

### K2 · Feel

- State: proposed
- Bar: a shortcut for every action
- Score: not measured
`)
  assert.deepEqual([answers[0].advice, answers[0].settled, answers[1].advice, answers[1].settled], ['solid; ask again after M1.', { by: 'you', at: '2026-10-20' }, '', null])
  assert.deepEqual([answers[0].icons, answers[1].icons], [[{ name: 'store', caption: 'Steam, later' }, { name: 'badge:TS', caption: '' }], []])
  assert.deepEqual(standards.map(one => [one.id, one.title, one.state, one.by, one.count, one.kind, one.done, one.bar.length, one.foundation, one.perItem, one.score, one.met, one.total, one.gap]), [
    ['K1', 'Maps', 'confirmed', 'you', '5 per world · from S3', 'map', 'docs/process/done/level.md', 6, "a way from the reference to the game's tiles · about 8 h", 'about 2 h', '0 of 7 meet the bar · your word: clunky', 0, 7, 'every map → "Maps meet the bar"'],
    ['K2', 'Feel', 'proposed', null, '', '', '', 1, '', '', 'not measured', null, null, ''],
  ])
  assert.deepEqual([standards[0].reference, standards[0].today, standards[1].reference], [{ path: 'art-inbox/vision/look-target.png', caption: 'the look we aim for' }, { path: 'art-inbox/vision/look-today.png', caption: 'Ember Hollow' }, null])
  assert.deepEqual([standards[0].pictures, standards[1].pictures], [[{ path: 'art-inbox/levels/ember-hollow-plan.png', caption: "the map's plan" }], []])
  // A bar point's own picture, the aspect highlighted: the point keeps its words, the picture stands beside it.
  // A bar line the partner wrapped keeps its words whole and its picture (the third point, 2026-10-20).
  assert.deepEqual([standards[0].bar[1], standards[0].bar[2], standards[0].barPictures], ['cliffs and lava as the reference, scored 75+', 'every tile in view above the unit panel at 1280x720',
    [{ at: 1, path: 'art-inbox/vision/standards/maps-cliffs.png' }, { at: 2, path: 'art-inbox/vision/standards/maps-view.png' }, { at: 4, path: 'art-inbox/vision/standards/maps-walkable.png' }]])
  // Sub-points: indented "- " lines under a bar point, level 1, each with its own picture, wrapped lines joined.
  assert.deepEqual([standards[0].bar.slice(3), standards[0].barLevels], [['visible at a glance', 'ground types tell apart', 'dangers read before a click'], [0, 0, 0, 0, 1, 1]])
  assert.deepEqual(parsePlan('# P\n').standards, [])
})

test('planState: a question on a standard comes after the goals\', and the bars are counted', () => {
  const page = '# P\n\n## P1 · What\n\n- State: decided (you, 2026-10-19)\n\n## Goals preset\n\n### M1 · First\n\n#### S1 · Benches\n\n## Standards\n\n### K1 · Maps\n\n- State: confirmed (you, 2026-10-20)\n- Gap: all\n\n### K2 · Feel\n\n- State: proposed\n'
  const asks = ['K2: how fast must a hit answer?', 'S1: when?'].map((title, at) => parseItem(`Id: Q${at + 1}\nKind: ask\nTitle: ${title}\nState: open\nOwner: P - Partner\nAsks: decide\n`))
  const state = planState(page, asks, 'p.md')
  assert.deepEqual(state.questions.map(one => [one.id, one.about, one.askId, one.question]), [['S1', 'S1', 'Q2', 'When?'], ['K2', 'K2', 'Q1', 'How fast must a hit answer?']])
  assert.deepEqual(state.bars, { total: 2, confirmed: 1, gaps: 1 })
})

test('the standards\' moves: settled, propose, confirm, change, measure, gaps into goals; a change of a standard', async () => {
  const ctx = { canWrite: true, partner: { name: 'Game - Advisor' }, job: 'J' }
  const words = async body => (await focusMove(body, ctx)).words.text.split('\n')
  assert.deepEqual(await words({ command: 'plan-settled', id: 'P3' }), ['plan: P3 settled', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-standards' }), ['plan: standards', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-standards-confirm', text: 'K1, K3' }), ['plan: standards confirmed', 'Standards: K1, K3', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-standards-change', text: 'Maps: 60 is enough' }), ['plan: standards change', 'Words: Maps: 60 is enough', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-standards-agree' }), ['plan: standards agreed', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-measure', id: 'K1' }), ['plan: K1 measure', 'Your job: J, "The plan interview"'])
  assert.deepEqual(await words({ command: 'plan-change', id: 'K2', text: 'drop the camera rule' }), ['plan: K2 change', 'Words: drop the camera rule', 'Your job: J, "The plan interview"'])
  assert.equal((await focusMove({ command: 'plan-standards-confirm', text: 'K1 and K2' }, ctx)).status, 400)
  assert.equal((await focusMove({ command: 'plan-measure', id: 'P1' }, ctx)).status, 400)
  assert.equal((await focusMove({ command: 'plan-settled', id: 'K1' }, ctx)).status, 400)
  assert.equal((await focusMove({ command: 'plan-standards-change', text: '' }, ctx)).status, 400)
})
