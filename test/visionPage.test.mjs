// Vision (2026-10-19): the Vision tab drawn from the product plan, in three steps and an interview: the vision's cards
// (points, pictures, state, source, Go deeper), the features (marks, yours not sent yet, complex, built, the
// architecture check), the partner's goal preset (per milestone, Confirm not sent yet), and the interview's slides (an
// open answer not asked yet, the partner's questions in the page's order, deeper ones too, and the part being
// changed), stepped through with dots. The page's view model runs here without the page; made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { planState } from '../src/plan.mjs'
import { parseItem } from '../src/work/item.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const css = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// vision:start'), script.indexOf('// vision:end'))}
Object.assign(this, { visionView, OWN_WORDS, visionStart, visionStartWords, visionStartWait, visionStartProblem })`, made)
const visionView = (...args) => JSON.parse(JSON.stringify(made.visionView(...args)))
const visionStart = (...args) => JSON.parse(JSON.stringify(made.visionStart(...args)))

const PAGE = `# Garden: the product plan

Pitch: A garden you can sit in.

## P1 · What it is

- State: decided (from vision.md, 2026-10-10)
- Point: **A garden** with benches
- Point: **Two** benches
- Point: **Three** paths
- Point: **Four** lamps
- Point: **Five** trees
- Point: **Six** birds
- Advice: solid; ask again after the first bench.
- Settled: (you, 2026-10-20)
- Icon: store · the garden shop
- Icon: badge:TS · TypeScript

## P2 · Look

- State: decided (you, 2026-10-19)
- Picture: art-inbox/garden/today.png · today
- Answer: warm wood

## P5 · Who comes

- State: open
- Known: friends, at least.

## P6 · Where

- State: open

## P7 · The road

- State: assumed (partner, 2026-10-18) · revisit after the first bench
- Point: **First** a bench

## Features

### F1 · Benches

- Mark: must (from vision.md, 2026-10-10)
- Complex: no
- Built: yes
- Picture: art-inbox/garden/bench.png · a bench
- Point: **Wood,** never metal

### F2 · A pond

- Mark: later (package A, 2026-10-19)
- Complex: yes · water changes every path
- Built: no

### F3 · Lamps

- Mark: ?
- Complex: no
- Built: partly

## Goals preset

### M1 · A first corner

#### S1 · Two benches by the path

- State: proposed
- Done when: two benches stand by the path and you sat on both
- Serves: P1, P2
- Picture: art-inbox/garden/bench.png · the bench
- Sub: Draw the bench
- Sub: Place them
- Goal: G3

#### S2 · Light on the path

- State: confirmed (you, 2026-10-19)
- Done when: the path is lit at night

## Standards

### K1 · Benches

- State: confirmed (you, 2026-10-20)
- Count: 10, from S1
- Kind: bench
- Done: docs/done/bench.md
- Reference: art-inbox/garden/bench-ref.png · the bench we aim for
- Today: art-inbox/garden/bench-today.png · the first bench
- Picture: art-inbox/garden/bench-old.png · the old bench
- Bar: oak, never metal
- Bar: a back you can lean on · art-inbox/garden/bench-back.png
  - arm rests at both ends
- Foundation: one bench drawing all benches are cut from · about 4 h
- Per item: about 1 h
- Score: 1 of 2 meet the bar
- Gap: the old bench → a goal

### K2 · Paths

- State: proposed
- Count: 3, from S2
- Bar: gravel, lit at night
`

const ask = (id, title, extra = '') => parseItem(`Id: ${id}
Kind: ask
Title: ${title}
State: open
Owner: Garden - Partner
Asks: decide
Options: A Friends: by invitation | B Anyone: an open gate
Pictures: a.png, b.png
Advice: A
${extra}
## Text
Nothing says it yet.
`)

// The partner's questions, filed in another order than the page's: the board puts them in the page's.
const ITEMS = [ask('Q9', 'F2: when should the pond come?'), ask('Q4', 'P5: who should come to the garden?'), ask('Q7', 'P1.2: how big is the garden?'), ask('Q6', 'P1.1: how many benches?')]
const plan = planState(PAGE, ITEMS, 'docs/product-plan.md')
const UI = { page: 'vision', at: 0, picked: {}, change: null, asked: [], marks: {}, confirms: [] }

test('the vision: the pitch, a card per answer with its points or its line, pictures, state, source, and its deeper questions', () => {
  const view = visionView(plan, UI)
  assert.deepEqual([view.pitch, view.path, view.page, view.summary, view.interviewLabel], ['A garden you can sit in.', 'docs/product-plan.md', 'vision', '2 of 5 decided by you · 1 assumed for now · 2 open · 1 settled', 'Interview · 9 to decide'])
  assert.deepEqual(view.cards.map(card => [card.id, card.state, card.points[0] ?? null, card.source, card.slide, card.deeper, card.canDeeper]), [
    ['P1', 'decided', '**A garden** with benches', 'from vision.md, 2026-10-10', 0, 2, true],
    ['P2', 'decided', 'warm wood', 'you, 2026-10-19', -1, 0, true],
    ['P5', 'open', 'friends, at least.', null, 2, 0, false],
    ['P6', 'open', null, null, 3, 0, false],
    ['P7', 'assumed', '**First** a bench', 'partner, 2026-10-18', -1, 0, true],
  ])
  assert.deepEqual(view.cards[1].pictures, [{ path: 'art-inbox/garden/today.png', caption: 'today' }])
  assert.equal(view.cards[4].revisit, 'the first bench')
  // The new order (the user, 2026-10-21): vision, features, standards, plan, focus.
  assert.deepEqual(view.steps.map(step => [step.id, step.label, step.isDone]), [['vision', '1 · Vision', false], ['features', '2 · Features', false], ['standards', '3 · Standards', false], ['plan', '4 · Plan', false], ['focus', '5 · Focus', false]])
  assert.equal(visionView(plan, UI, { id: 'G3', title: 'Two benches', doneWhen: 'sat on both' }).steps[4].isDone, true)
  // The plan's step was called goals before: a page kept from then opens the plan.
  assert.equal(visionView(plan, { ...UI, page: 'goals' }).page, 'plan')
  assert.match(view.summary, /1 settled$/)
})

test('a card folds after four points, says when it is settled, and carries the partner\'s advice', () => {
  const [card] = visionView(plan, UI).cards
  assert.deepEqual([card.shown.length, card.folded, card.isOpen, card.points.length], [4, 2, false, 6])
  assert.deepEqual([card.settled, card.advice], [{ by: 'you', at: '2026-10-20' }, 'solid; ask again after the first bench.'])
  const opened = visionView(plan, { ...UI, open: ['P1'] }).cards[0]
  assert.deepEqual([opened.shown.length, opened.folded, opened.isOpen], [6, 0, true])
  // A card with four points or fewer has nothing to fold; one not settled has no mark and no advice.
  const second = visionView(plan, UI).cards[1]
  assert.deepEqual([second.shown.length, second.folded, second.settled, second.advice], [1, 0, null, ''])
  // A card without pictures shows its icons: the board's names, or a lettered badge.
  assert.deepEqual([card.icons, second.icons], [[{ name: 'store', caption: 'the garden shop' }, { name: 'badge:TS', caption: 'TypeScript' }], []])
  assert.match(script, /else if \(card\.icons\.length > 0\) box\.append\(visionIcons\(card\.icons\)\)/)
  for (const name of ['gamepad', 'person', 'spark', 'layers', 'map', 'store', 'browser', 'link', 'code', 'flag', 'check', 'gauge', 'sound', 'brush', 'clock', 'coins']) assert.match(script, new RegExp(`\\n  ${name}: \\[\\['`), name)
  assert.match(script, /'Good enough'/)
  assert.match(script, /'Deepen again'/)
})

test('the standards: a card per kind with the bar beside today, the foundation, the score and the gap; Confirm not sent yet; the step done once all confirmed', () => {
  const view = visionView(plan, UI)
  assert.deepEqual(view.standards.cards.map(card => [card.id, card.title, card.state, card.count, card.kind, card.bar, card.met, card.total, card.gap, card.slide]), [
    ['K1', 'Benches', 'confirmed', '10, from S1', 'bench', ['oak, never metal', 'a back you can lean on', 'arm rests at both ends'], 1, 2, 'the old bench → a goal', -1],
    ['K2', 'Paths', 'proposed', '3, from S2', '', ['gravel, lit at night'], null, null, '', -1],
  ])
  assert.deepEqual([view.standards.cards[0].reference, view.standards.cards[0].today, view.standards.cards[0].foundation, view.standards.cards[0].perItem, view.standards.cards[0].score],
    [{ path: 'art-inbox/garden/bench-ref.png', caption: 'the bench we aim for' }, { path: 'art-inbox/garden/bench-today.png', caption: 'the first bench' }, 'one bench drawing all benches are cut from · about 4 h', 'about 1 h', '1 of 2 meet the bar'])
  assert.equal(view.standards.summary, '2 standards · 1 confirmed by you · 1 with a gap')
  // The pictures as a gallery: the bar, today, then the rest; the first shown until a thumbnail is clicked, clamped.
  assert.deepEqual(view.standards.cards[0].gallery.map(one => [one.label, one.path, one.caption]), [
    ['the bar', 'art-inbox/garden/bench-ref.png', 'the bench we aim for'], ['today', 'art-inbox/garden/bench-today.png', 'the first bench'],
    ['', 'art-inbox/garden/bench-back.png', 'a back you can lean on'], ['', 'art-inbox/garden/bench-old.png', 'the old bench'],
  ])
  // The second bar point has its picture: the bullet points at the gallery's third picture.
  assert.deepEqual([view.standards.cards[0].bar, view.standards.cards[0].barPictureAt], [['oak, never metal', 'a back you can lean on', 'arm rests at both ends'], [-1, 2, -1]])
  assert.deepEqual([view.standards.cards[0].shownPicture, view.standards.cards[1].gallery, view.standards.cards[1].shownPicture], [0, [], 0])
  assert.equal(visionView(plan, { ...UI, gallery: { K1: 2 } }).standards.cards[0].shownPicture, 2)
  assert.equal(visionView(plan, { ...UI, gallery: { K1: 9 } }).standards.cards[0].shownPicture, 3)
  assert.deepEqual([view.cards[1].gallery.length, view.cards[1].shownPicture], [1, 0])
  assert.match(script, /visionGallery\(card\.id, card\.gallery, card\.shownPicture/)
  assert.match(css, /\.vision-thumb\[aria-pressed="true"\]/)
  const confirming = visionView(plan, { ...UI, standardConfirms: ['K2'] })
  assert.deepEqual([confirming.standards.cards[1].state, confirming.standards.pending, confirming.steps[2].isDone], ['confirming', ['K2'], false])
  // Change on a standard: its slide holds how many and the bar, with both pictures; not the foundation (a standard is
  // not a step: how the things get built is the gap goal's).
  const change = visionView(plan, { ...UI, change: 'K1' }).slides.at(-1)
  assert.deepEqual([change.kind, change.question, change.points.length, change.pictures.length], ['change', 'Change: Benches', 4, 3])
  assert.match(change.points[3], /^– arm rests/)
  assert.match(change.points[1], /^\*\*Bar:\*\* oak/)
  // The slide carries the standard's card, so it shows the bar and today as the card does.
  // A sub-point (an indented "- " line under a bar point) is level 1: the card lists it under its point.
  assert.deepEqual([change.standard.id, change.standard.bar.length, change.standard.gallery.length, change.standard.barPictureAt, change.standard.barLevels], ['K1', 3, 4, [-1, 2, -1], [0, 0, 1]])
  assert.equal(visionView(plan, { ...UI, change: 'P2' }).slides.at(-1).standard, undefined)
  assert.match(script, /stage\.append\(el\('p', 'muted', 'Now:'\), \.\.\.standardSections\(slide\.standard\), form\)/)
})

test('the interview: the questions in the page\'s order, deeper ones under their answer, an open answer not asked yet, your own words last', () => {
  const view = visionView(plan, { ...UI, page: 'interview', picked: { P5: 'B Anyone: an open gate' } })
  // The guided path (2026-10-21): each step's questions, then the decisions waiting there, in the steps' order.
  assert.deepEqual(view.slides.map(one => [one.kind, one.id]), [['ask', 'P1.1'], ['ask', 'P1.2'], ['ask', 'P5'], ['open', 'P6'], ['decide', 'P7'], ['ask', 'F2'], ['decide', 'F2'], ['decide', 'K2'], ['decide', 'S1']])
  assert.deepEqual([view.slides[0].isDeeper, view.slides[0].title, view.slides[0].question], [true, 'What it is', 'How many benches?'])
  assert.deepEqual([view.slides[5].title, view.slides[5].question], ['A pond', 'When should the pond come?'])
  const slide = view.slides[2]
  assert.deepEqual([slide.kind, slide.id, slide.askId, slide.question, slide.text, slide.advice], ['ask', 'P5', 'Q4', 'Who should come to the garden?', 'Nothing says it yet.', 'A'])
  assert.deepEqual(slide.options.map(option => [option.key, option.head, option.points, option.picture, option.isAdvised, option.isPicked, option.isOwn === true]), [
    ['A', 'Friends', ['by invitation'], 'a.png', true, false, false],
    ['B', 'Anyone', ['an open gate'], 'b.png', false, true, false],
    ['C', 'In your own words', [], null, false, false, true],
  ])
  assert.equal(slide.picked.key, 'B')
  // Your own words picked: the last card, its letter next after the partner's.
  assert.deepEqual(visionView(plan, { ...UI, picked: { P5: made.OWN_WORDS } }).slides[2].picked, { label: made.OWN_WORDS, key: 'C', head: 'In your own words', points: [], isAdvised: false, picture: null, isOwn: true })
  assert.deepEqual(view.slides[3], { kind: 'open', id: 'P6', title: 'Where', question: 'Where', text: '', isAsked: false })
  assert.equal(visionView(plan, { ...UI, asked: ['P6'] }).slides[3].isAsked, true)
  // The slide at stays inside the slides.
  assert.equal(visionView(plan, { ...UI, at: 12 }).at, 8)
  assert.equal(visionView(plan, { ...UI, at: -3 }).at, 0)
})

test('Change: an answer, a feature or a goal of the preset gets its slide last, with its points and pictures', () => {
  const answer = visionView(plan, { ...UI, change: 'P2' }).slides.at(-1)
  assert.deepEqual([answer.kind, answer.id, answer.question, answer.points, answer.pictures], ['change', 'P2', 'Change: Look', ['warm wood'], [{ path: 'art-inbox/garden/today.png', caption: 'today' }]])
  const feature = visionView(plan, { ...UI, change: 'F1' }).slides.at(-1)
  assert.deepEqual([feature.id, feature.question, feature.points], ['F1', 'Change: Benches', ['**Wood,** never metal']])
  const goal = visionView(plan, { ...UI, change: 'S1' }).slides.at(-1)
  assert.deepEqual([goal.id, goal.question, goal.points], ['S1', 'Change: Two benches by the path', ['**Done when:** two benches stand by the path and you sat on both', 'Draw the bench', 'Place them']])
  // An open answer cannot be changed, only answered.
  assert.equal(visionView(plan, { ...UI, change: 'P5' }).slides.length, 9)
})

test('the features: marks with yours not sent yet, complex and built, the counts, and the architecture check', () => {
  const view = visionView(plan, UI)
  assert.deepEqual(view.features.cards.map(card => [card.id, card.name, card.mark, card.isPending, card.isComplex, card.built, card.source, card.slide]), [
    ['F1', 'Benches', 'must', false, false, 'yes', 'from vision.md, 2026-10-10', -1],
    ['F2', 'A pond', 'later', false, true, 'no', 'package A, 2026-10-19', 5],
    ['F3', 'Lamps', 'unsure', false, false, 'partly', null, -1],
  ])
  // Must, Later, No, ? (the user, 2026-10-21: the milestones do not exist yet on this step); what keeps the ✓ is named.
  assert.equal(view.features.summary, '3 features · 1 must · 1 later · 0 no · 1 not sure')
  assert.deepEqual(view.features.markOptions, [['must', 'Must'], ['later', 'Later'], ['no', 'No'], ['unsure', '?']])
  assert.deepEqual(view.features.unsure, [{ id: 'F3', name: 'Lamps' }])
  assert.deepEqual(view.features.cards.map(card => [card.milestone, card.milestoneTitle]), [[null, ''], [null, ''], [null, '']])
  const placed = visionView(planState(PAGE.replace('- Mark: must (from vision.md, 2026-10-10)\n', '- Mark: must (from vision.md, 2026-10-10)\n- Milestone: M1 (partner, 2026-10-21)\n'), ITEMS, 'p.md'), UI)
  assert.deepEqual([placed.features.cards[0].milestone, placed.features.cards[0].milestoneTitle], ['M1', 'A first corner'])
  assert.match(view.features.architecture, /^1 complex feature is later or not sure \(A pond\): the structure is checked again at every milestone/)
  assert.deepEqual(view.features.pending, [])
  // Your marks: shown at once, counted, sent in one word; the check follows them.
  const marked = visionView(plan, { ...UI, marks: { F2: 'must', F3: 'no', F1: 'must' } })
  assert.deepEqual(marked.features.cards.map(card => [card.mark, card.isPending]), [['must', false], ['must', true], ['no', true]])
  assert.deepEqual(marked.features.pending, ['F2 must', 'F3 no'])
  assert.match(marked.features.architecture, /^Every complex feature is decided \(A pond\): build for them now/)
  assert.equal(marked.steps[1].isDone, true)
})

test('the goals: the preset per milestone, Confirm not sent yet, and the state of the step', () => {
  const view = visionView(plan, UI)
  assert.deepEqual(view.goals.milestones.map(one => [one.id, one.title, one.goals.map(goal => [goal.id, goal.state, goal.serves, goal.subs.length, goal.goal])]), [
    ['M1', 'A first corner', [['S1', 'proposed', ['P1', 'P2'], 2, 'G3'], ['S2', 'confirmed', [], 0, null]]],
  ])
  assert.equal(view.goals.summary, '2 goals · 1 confirmed by you')
  const confirming = visionView(plan, { ...UI, confirms: ['S1'] })
  assert.deepEqual([confirming.goals.milestones[0].goals[0].state, confirming.goals.pending], ['confirming', ['S1']])
  assert.equal(confirming.steps[3].isDone, false)
})

test('while the partner prepares: Go deeper waits on its card, Get options shows as asked, the sends wait, the lines name the part', () => {
  const busy = { ...plan, working: [
    { command: 'plan-deeper', about: 'P2', at: 1, state: 'working', what: 'deeper questions' },
    { command: 'plan-ask', about: 'P6', at: 1, state: 'waiting', what: 'the options' },
    { command: 'plan-marks', about: 'plan', at: 1, state: 'working', what: 'your marks' },
    { command: 'plan-goals-agree', about: 'plan', at: 1, state: 'late', what: 'the goals into your goal map' },
  ] }
  const view = visionView(busy, UI)
  assert.deepEqual(view.cards.map(card => [card.id, card.deeperWork]), [['P1', null], ['P2', 'working'], ['P5', null], ['P6', null], ['P7', null]])
  assert.equal(view.slides.find(slide => slide.id === 'P6').isAsked, true)
  assert.deepEqual(view.busy, { marks: true, featureAdd: false, confirms: false, goalsChange: false, agree: false, standards: false, standardConfirms: false, standardsChange: false, standardsAgree: false, check: false, focus: false, tradeoffs: false })
  assert.deepEqual(view.working.map(one => [one.command, one.title, one.state]), [['plan-deeper', 'Look', 'working'], ['plan-ask', 'Where', 'waiting'], ['plan-marks', null, 'working'], ['plan-goals-agree', null, 'late']])
  assert.match(script, /'Preparing questions…'/)
  assert.match(css, /\.vision-spinner \{/)
})

test('no plan: no view; no question: no slides; no features or goals: empty steps', () => {
  assert.equal(made.visionView(null, UI), null)
  const none = visionView(planState('# Empty\n\n## P1 · What\n\n- State: decided (you, 2026-10-19)\n', [], 'p.md'), UI)
  assert.deepEqual([none.slides, none.interviewLabel, none.summary, none.features.cards, none.features.architecture, none.goals.milestones], [[], 'Interview', '1 of 1 decided by you', [], null, []])
  assert.deepEqual(none.steps.map(step => step.isDone), [true, false, false, false, false])
  assert.deepEqual([none.standards.cards, none.standards.summary], [[], ''])
})

test('the Vision tab sits beside Overview, with its view, its address and its styles', () => {
  assert.match(html, /data-tab="overview">[\s\S]*?<\/button>\s*<button class="tab" type="button" data-tab="vision">Vision<\/button>/)
  assert.match(html, /<div class="view is-single" id="view-vision" hidden><\/div>/)
  assert.match(script, /if \(hash === '#vision'\) return 'vision'/)
  assert.match(script, /\$\('view-vision'\)\.hidden = tab !== 'vision'/)
  assert.match(css, /\.vision-slide \{/)
  assert.match(css, /\.vision-option\.is-picked \{/)
  // Your own words: a card as wide as all the options together, its box without a resize handle (the user, 2026-10-19).
  assert.match(css, /\.vision-option\.is-own \{ grid-column: 1 \/ -1;/)
  assert.match(css, /\.vision-own \{[^}]*resize: none;/)
  assert.match(css, /\.vision-steps \{/)
  assert.match(css, /\.vision-goal \{/)
  // The redraw keeps the place scrolled to, and the standards' main picture is wide enough to judge without the zoom.
  assert.match(script, /const scrolled = \$\('view-vision'\)\.querySelector\('\.vision'\)\?\.scrollTop \?\? 0/)
  assert.match(script, /if \(scrolled > 0\) main\.scrollTop = scrolled/)
  assert.match(css, /\.vision-standard \{ display: grid; grid-template-columns: 480px/)
  // A standard's card in two parts, the bar set apart; what the goals need is a muted line, not a bar point; how the
  // things get built (the foundation, the hours) is not on the card (the user, 2026-10-21: "it's a standard, not a step").
  assert.match(script, /'The bar: what each one must meet'/)
  assert.doesNotMatch(script, /'To get there'|Foundation first|withoutHours/)
  assert.match(script, /`Needed: \$\{card\.count\}`/)
  assert.match(css, /\.vision-part\.is-bar \{/)
  // The Focus page no longer carries the plan.
  assert.doesNotMatch(script, /planCard\(/)
})

test('the guided path: a decision per slide with its step, its buttons, sent once; the plan check; the next focus', () => {
  const view = visionView(plan, UI)
  const decisions = view.slides.filter(one => one.kind === 'decide')
  assert.deepEqual(decisions.map(one => [one.id, one.step, one.question, one.actions.map(action => `${action.label}:${action.act}:${action.id}`)]), [
    ['P7', 'vision', 'Is this your answer for The road?', ['Yes, mine:confirm:P7', 'Change:change:P7']],
    // A tradeoff, not a mark (2026-10-21): the complex pond is later; a "?" alone (the lamps) is an answer.
    ['F2', 'features', 'A pond: prepare now, or wait?', ['Get the tradeoff from your partner:get-tradeoffs:F2']],
    ['K2', 'standards', 'Is this the bar for Paths?', ['Confirm:confirm-standard-now:K2', 'Change:change:K2']],
    ['S1', 'plan', 'Is this a goal: Two benches by the path?', ['Confirm:confirm-goal-now:S1', 'Change:change:S1']],
  ])
  // A decision sent stays, marked sent, and no longer counts as one to decide.
  const sent = visionView(plan, { ...UI, sent: ['K2'] })
  assert.deepEqual([sent.slides.find(one => one.id === 'K2').isSent, sent.interviewLabel], [true, 'Interview · 8 to decide'])
  // A decision is no card's "your partner asks".
  assert.equal(view.features.cards.find(card => card.id === 'K2'), undefined)
  assert.equal(view.features.cards.find(card => card.id === 'F3').slide, -1)
  // The plan check and a goal's why; the next focus proposed, as a decision while it is not your focus.
  const checked = visionView(planState(`${PAGE}\n## Next focus\n\n- Proposed (partner, 2026-10-21): G3 · Two benches\n- Why: the first corner needs them\n- When: now\n- Or: G7 · Light\n`.replace('## Goals preset\n', '## Goals preset\n\nChecked: (2026-10-21) S3 proposed: F3 had no goal\n').replace('- Goal: G3\n', '- Goal: G3\n- Why: F1 had no goal\n'), ITEMS, 'docs/product-plan.md'), UI)
  assert.deepEqual(checked.goals.check, { at: '2026-10-21', text: 'S3 proposed: F3 had no goal' })
  assert.equal(checked.goals.milestones[0].goals[0].why, 'F1 had no goal')
  assert.deepEqual(checked.focus.proposal, { goal: 'G3', title: 'Two benches', why: 'the first corner needs them', when: 'now', others: [{ goal: 'G7', title: 'Light' }], by: 'partner', at: '2026-10-21', isCurrent: false })
  assert.deepEqual(checked.slides.at(-1).actions.map(action => action.act), ['focus-accept', 'page'])
  const focused = visionView(checked.path === undefined ? null : planState(`${PAGE}\n## Next focus\n\n- Proposed: G3 · Two benches\n`, ITEMS, 'p.md'), UI, { id: 'G3', title: 'Two benches', doneWhen: 'sat on both', stage: 'run' })
  assert.deepEqual([focused.focus.current, focused.focus.proposal.isCurrent, focused.slides.some(one => one.id === 'focus:G3')], [{ id: 'G3', title: 'Two benches', doneWhen: 'sat on both', stage: 'run' }, true, false])
  assert.match(script, /function focusStepPage\(view, can, off\)/)
  assert.match(script, /'Check the plan'/)
})

test('the tradeoffs: a complex feature later or not sure, the partner\'s advice, your choice; the step and the plan wait for every choice', () => {
  const view = visionView(plan, UI)
  assert.deepEqual(view.features.tradeoffs.map(card => [card.id, card.mark, card.prepare, card.choice]), [['F2', 'later', null, null]])
  assert.deepEqual([view.features.tradeoffsOpen, view.steps[1].isDone], [['F2'], false])
  const weighed = PAGE.replace('- Complex: yes · water changes every path\n', '- Complex: yes · water changes every path\n- Prepare: now · paths as data, water later · now: half a day · later: every map again\n')
  const advised = visionView(planState(weighed, ITEMS, 'p.md'), UI)
  assert.deepEqual(advised.features.tradeoffs[0].prepare, { advice: 'now', what: 'paths as data, water later', now: 'half a day', later: 'every map again' })
  const slide = advised.slides.find(one => one.kind === 'decide' && one.id === 'F2')
  assert.deepEqual([slide.tradeoff.advice, slide.actions.map(action => `${action.label}:${action.act}:${action.id}`)], ['now', ['Prepare now:tradeoff-now:F2:prepare', 'Wait:tradeoff-now:F2:wait', 'It is a must:mark-now:F2:must', 'No:mark-now:F2:no']])
  // Your choice written on the page: the tradeoff is decided, the step gets its ✓, the decision leaves the Interview.
  const chosen = visionView(planState(weighed.replace('- Prepare: now', '- Tradeoff: prepare (you, 2026-10-21)\n- Prepare: now'), ITEMS, 'p.md'), UI)
  assert.deepEqual([chosen.features.tradeoffs[0].choice, chosen.features.tradeoffs[0].at, chosen.features.tradeoffsOpen, chosen.steps[1].isDone], ['prepare', '2026-10-21', [], true])
  assert.equal(chosen.slides.some(one => one.kind === 'decide' && one.id === 'F2'), false)
  assert.match(script, /function tradeoffSection\(view, can, off\)/)
  assert.match(script, /'Decide the tradeoffs on step 2 first\.'/)
})

test('the Interview as the way through (2026-10-21): how many wait and where the first is; own words on a decision; all decided', () => {
  const view = visionView(plan, UI)
  assert.deepEqual([view.waiting, view.firstWaiting], [9, 0])
  // Every slide before the last decision sent: the first waiting one is the last.
  const sent = visionView(plan, { ...UI, sent: ['P7', 'F2', 'K2'] })
  assert.equal(sent.waiting, 6)
  const decidedOnly = visionView(planState(PAGE, [], 'p.md'), { ...UI, sent: ['P7', 'F2', 'K2', 'S1'] })
  assert.deepEqual([decidedOnly.waiting, decidedOnly.slides.filter(one => one.kind === 'open').length], [decidedOnly.slides.filter(one => one.kind === 'open').length, decidedOnly.waiting])
  assert.match(script, /'Send my words', 'decide-words'/)
  assert.match(script, /\{ command: 'plan-change', id: slide\.id, text: words \}/)
  assert.match(script, /function visionAllDecided\(view\)/)
  assert.match(script, /visionButton\('Start', 'start-interview'/)
})

test("the trial's gap 1 (2026-10-24): an empty Vision tab starts with what you build, Game, Website, App or Other, and your words", () => {
  const blank = { ...UI, startKind: null, extra: '' }
  const none = visionStart(blank)
  assert.deepEqual([none.kinds.map(kind => kind.key), none.kind, none.canStart], [['Game', 'Website', 'App', 'Other'], null, false])
  const game = visionStart({ ...blank, startKind: 'Game' })
  assert.deepEqual([game.kinds.filter(kind => kind.isPicked).map(kind => kind.key), game.canStart], [['Game'], true])
  // Other says nothing by itself: it needs your words.
  assert.equal(visionStart({ ...blank, startKind: 'Other' }).canStart, false)
  assert.equal(visionStart({ ...blank, startKind: 'Other', extra: 'a board game night planner' }).canStart, true)
  assert.equal(visionStart({ ...blank, startKind: 'Spaceship' }).kind, null)
  assert.equal(made.visionStartWords('Game', '  a tactics game,  short fights  '), 'Game: a tactics game, short fights')
  assert.equal(made.visionStartWords('Website', ''), 'Website')
})

test("the wait after Start (2026-10-24, the user: \"i want a loader while im waiting for the partner\"): a loader until the partner's page is there", () => {
  const wait = (planStart, ui) => JSON.parse(JSON.stringify(made.visionStartWait(planStart, { ...UI, startSent: false, startAgain: false, ...ui }, 'Trial - Advisor')))
  // Nothing sent: the start card.
  assert.equal(wait(null, {}), null)
  // Just sent, before the board read it again: waiting.
  assert.deepEqual([wait(null, { startSent: true }).state, wait(null, { startSent: true }).isBusy], ['waiting', true])
  const working = wait({ at: 1, state: 'working' }, {})
  assert.equal(working.isBusy, true)
  assert.match(working.head, /Trial - Advisor is starting your plan/)
  const late = wait({ at: 1, state: 'late' }, {})
  assert.deepEqual([late.isBusy, late.canAgain], [false, true])
  assert.match(late.line, /Trial - Advisor's chat/)
  // A start that never arrived, or Start again: the start card, with why.
  assert.equal(wait({ at: 1, state: 'failed' }, { startSent: true }), null)
  assert.equal(wait({ at: 1, state: 'working' }, { startAgain: true }), null)
  assert.match(made.visionStartProblem({ at: 1, state: 'failed' }, 'Trial - Advisor'), /did not reach Trial - Advisor/)
  assert.equal(made.visionStartProblem({ at: 1, state: 'working' }, 'Trial - Advisor'), null)
  assert.match(script, /function visionStartWaitCard\(/)
})
