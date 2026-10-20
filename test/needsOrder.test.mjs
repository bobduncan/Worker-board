// B466: in Needs your attention, what needs the person comes first; "Decided for you by your partner" folds to one
// line with its count, opens on a click and remembers it. The person, 2026-10-21: "If i have refinement options they
// now appear below these, decided for you, but i want them to be above. also i want this decided by you
// [collapsible], it feels noisy when i'm only interested in actions i need to take". Made-up samples only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const style = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const cut = (from, to) => script.slice(script.indexOf(from), script.indexOf(to))
const made = {}
vm.runInNewContext(`const TAKE_BACK_TITLE = 'x'\n${cut('// partner-answers:start', '// partner-answers:end')}
Object.assign(this, { decidedView, decidedToggleText })`, made)

const decisions = [1, 2, 3, 4, 5].map(n => ({ ask: `Q${n}`, line: `Q${n} (Digger, B1): Icons? → A`, at: 0 }))

test('B466: the partner\'s decisions fold to one line with their count, a chevron saying open or closed', () => {
  const view = made.decidedView(decisions)
  assert.equal(view.count, 5)
  assert.equal(made.decidedToggleText(view, false), 'Decided for you by your partner · 5 ›')
  assert.equal(made.decidedToggleText(view, true), 'Decided for you by your partner · 5 ▾')
  const draw = cut('function drawDecidedForYou(state)', '/** Partner answers: the card\'s part of the partner')
  // Folded unless opened: the list and its Undo only while open.
  assert.match(draw, /const isOpen = state\.ui\?\.decidedOpen === true/)
  assert.match(draw, /toggle\.dataset\.decided = 'toggle'/)
  assert.match(draw, /toggle\.setAttribute\('aria-expanded', String\(isOpen\)\)/)
  assert.match(draw, /if \(!isOpen\) return part/)
  assert.match(draw, /undo\.dataset\.takeBack = row\.undo\.id/)
  assert.match(style, /\.decided-toggle \{/)
})

test('B466: a click opens or closes it, and the page remembers it', () => {
  const clicks = cut('// clicks:start', 'function clickAct(')
  assert.match(clicks, /'decided': \(\) => \{/)
  assert.match(clicks, /decidedUi\.isOpen = !decidedUi\.isOpen/)
  assert.match(clicks, /localStorage\.setItem\('decided-open', decidedUi\.isOpen \? 'yes' : 'no'\)/)
  assert.match(clicks, /localStorage\.getItem\('decided-open'\) === 'yes'/)
  assert.match(script, /const needsUi = \(\) => \(\{[^\n]*decidedOpen: decidedUi\.isOpen/)
})

test('B466: what needs you comes first; the partner\'s lines after it; the badge counts only what needs you', () => {
  const draw = cut('function drawNeeds(state)', '/** Who runs and who was asked')
  assert.match(draw, /\.\.\.oldCards, drawRefineNeeds\(state\), \.\.\.cards, drawWithPartner\(state\), drawDecidedForYou\(state\), \.\.\.recaps\]\)/)
  const badge = draw.slice(draw.indexOf('const unanswered ='), draw.indexOf("$('needs-count')"))
  assert.ok(badge.length > 0)
  assert.ok(!/partnerDecided|withPartner/.test(badge), 'the partner\'s lines are not counted')
})
