// Vision (2026-10-19): the Vision tab drawn from the product plan: the read view's cards (points, pictures, state,
// source) and the interview's slides (one per open answer the partner asked, one for the answer being changed),
// stepped through with dots. The page's view model runs here without the page; made-up names only.
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
Object.assign(this, { visionView, OWN_WORDS })`, made)
const visionView = (...args) => JSON.parse(JSON.stringify(made.visionView(...args)))

const PAGE = `# Garden: the product plan

Pitch: A garden you can sit in.

## P1 · What it is

- State: decided (from vision.md, 2026-10-10)
- Point: **A garden** with benches

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
`

const ASK = parseItem(`Id: Q4
Kind: ask
Title: P5: who should come to the garden?
State: open
Owner: Garden - Partner
Asks: decide
Options: A Friends: by invitation | B Anyone: an open gate
Pictures: a.png, b.png
Advice: A

## Text
Nothing says it yet.
`)

const plan = planState(PAGE, [ASK], 'docs/product-plan.md')
const UI = { mode: 'read', at: 0, picked: {}, change: null }

test('the read view: the pitch, a card per answer with its points or its line, pictures, state and source', () => {
  const view = visionView(plan, UI)
  assert.deepEqual([view.pitch, view.path, view.mode, view.summary, view.interviewLabel], ['A garden you can sit in.', 'docs/product-plan.md', 'read', '2 of 5 decided by you · 1 assumed for now · 2 open', 'Interview · 2 to answer'])
  assert.deepEqual(view.cards.map(card => [card.id, card.state, card.points, card.source, card.slide, card.isAsked]), [
    ['P1', 'decided', ['**A garden** with benches'], 'from vision.md, 2026-10-10', -1, false],
    ['P2', 'decided', ['warm wood'], 'you, 2026-10-19', -1, false],
    ['P5', 'open', ['friends, at least.'], null, 0, true],
    ['P6', 'open', [], null, 1, false],
    ['P7', 'assumed', ['**First** a bench'], 'partner, 2026-10-18', -1, false],
  ])
  assert.deepEqual(view.cards[1].pictures, [{ path: 'art-inbox/garden/today.png', caption: 'today' }])
  assert.equal(view.cards[4].revisit, 'the first bench')
})

test('the interview: one slide per open answer, its options as picture cards and your own words last, the picked one, and the change slide', () => {
  const view = visionView(plan, { ...UI, mode: 'interview', picked: { P5: 'B Anyone: an open gate' } })
  assert.deepEqual(view.slides.map(one => [one.kind, one.id]), [['ask', 'P5'], ['open', 'P6']])
  const [slide] = view.slides
  assert.deepEqual([slide.kind, slide.id, slide.askId, slide.question, slide.text, slide.advice], ['ask', 'P5', 'Q4', 'Who should come to the garden?', 'Nothing says it yet.', 'A'])
  assert.deepEqual(slide.options.map(option => [option.key, option.head, option.points, option.picture, option.isAdvised, option.isPicked, option.isOwn === true]), [
    ['A', 'Friends', ['by invitation'], 'a.png', true, false, false],
    ['B', 'Anyone', ['an open gate'], 'b.png', false, true, false],
    ['C', 'In your own words', [], null, false, false, true],
  ])
  assert.equal(slide.picked.key, 'B')
  // Your own words picked: the last card, its letter next after the partner's.
  assert.deepEqual(visionView(plan, { ...UI, picked: { P5: made.OWN_WORDS } }).slides[0].picked, { label: made.OWN_WORDS, key: 'C', head: 'In your own words', points: [], isAdvised: false, picture: null, isOwn: true })
  // An open answer the partner has not asked: its slide, its Known line, and whether you asked for options already.
  assert.deepEqual(view.slides[1], { kind: 'open', id: 'P6', title: 'Where', question: 'Where', text: '', isAsked: false })
  assert.equal(visionView(plan, { ...UI, asked: ['P6'] }).slides[1].isAsked, true)
  // Change on a decided answer adds its slide last; an open answer cannot be changed, only answered.
  const changing = visionView(plan, { ...UI, mode: 'interview', change: 'P1', at: 2 })
  assert.deepEqual(changing.slides.map(one => [one.kind, one.id]), [['ask', 'P5'], ['open', 'P6'], ['change', 'P1']])
  assert.deepEqual([changing.at, changing.slides[2].points, changing.slides[2].question, changing.slides[2].pictures], [2, ['**A garden** with benches'], 'Change: What it is', []])
  // A changed answer with pictures shows them on its slide, to judge the look while changing it.
  assert.deepEqual(visionView(plan, { ...UI, change: 'P2' }).slides[2].pictures, [{ path: 'art-inbox/garden/today.png', caption: 'today' }])
  assert.deepEqual(visionView(plan, { ...UI, change: 'P5' }).slides.map(one => one.kind), ['ask', 'open'])
  // The slide at stays inside the slides.
  assert.equal(visionView(plan, { ...UI, at: 9 }).at, 1)
  assert.equal(visionView(plan, { ...UI, at: -3 }).at, 0)
})

test('no plan: no view; no question: no slides', () => {
  assert.equal(made.visionView(null, UI), null)
  const none = visionView(planState('# Empty\n\n## P1 · What\n\n- State: decided (you, 2026-10-19)\n', [], 'p.md'), UI)
  assert.deepEqual([none.slides, none.interviewLabel, none.summary], [[], 'Interview', '1 of 1 decided by you'])
})

test('the Vision tab sits beside Overview, with its view, its address and its styles', () => {
  assert.match(html, /data-tab="overview">[\s\S]*?<\/button>\s*<button class="tab" type="button" data-tab="vision">Vision<\/button>/)
  assert.match(html, /<div class="view is-single" id="view-vision" hidden><\/div>/)
  assert.match(script, /if \(hash === '#vision'\) return 'vision'/)
  assert.match(script, /\$\('view-vision'\)\.hidden = tab !== 'vision'/)
  assert.match(css, /\.vision-slide \{/)
  assert.match(css, /\.vision-option\.is-picked \{/)
  // The Focus page no longer carries the plan.
  assert.doesNotMatch(script, /planCard\(/)
})
