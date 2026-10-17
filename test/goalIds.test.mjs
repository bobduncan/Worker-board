// B284: every box and row of the goal map shows its goal's id before its title ("G17 The Advisor's work…"): in the
// diagram, the outline, the breadcrumb and the frame. A milestone keeps its "M1 ·" after the id. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const style = await readFile(join(HERE, '..', 'public', 'board.css'), 'utf8')
const design = await readFile(join(HERE, '..', 'DESIGN.md'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('goals')}\nObject.assign(this, { goalLabel, goalIdSplit, goalTitleLines })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

test('a goal is named by its id and its title; a milestone keeps its own mark after the id', () => {
  assert.equal(page.goalLabel({ id: 'G17', title: 'The Advisor\'s work in sight' }), 'G17 The Advisor\'s work in sight')
  assert.equal(page.goalLabel({ id: 'G2', title: 'M1 · The paths are fun' }), 'G2 M1 · The paths are fun')
  // The top of the map has no id; a title that already starts with its id does not say it twice.
  assert.equal(page.goalLabel({ id: null, title: 'Goals' }), 'Goals')
  assert.equal(page.goalLabel({ id: 'G4', title: 'G4 Let the fountains sing' }), 'G4 Let the fountains sing')
})

test('a line that starts with the id gives it apart, so the page draws it in its own colour', () => {
  assert.deepEqual(plain(page.goalIdSplit('G17 The Advisor\'s', 'G17')), { lead: '', id: 'G17', rest: ' The Advisor\'s' })
  assert.deepEqual(plain(page.goalIdSplit('↗ G9 The safety', 'G9')), { lead: '↗ ', id: 'G9', rest: ' The safety' })
  assert.deepEqual(plain(page.goalIdSplit('work in sight', 'G17')), { lead: '', id: '', rest: 'work in sight' })
  assert.deepEqual(plain(page.goalIdSplit('Goals', null)), { lead: '', id: '', rest: 'Goals' })
})

test('a box\'s two lines never leave the id alone on the first', () => {
  assert.deepEqual(plain(page.goalTitleLines('G17 Internationalization of everything', 21)), ['G17 Internationaliza…'])
  assert.deepEqual(plain(page.goalTitleLines('↗ G9 Internationalization', 21)), ['↗ G9 Internationaliz…'])
  assert.deepEqual(plain(page.goalTitleLines('G3 Five harder fights, and a real boss', 21)), ['G3 Five harder', 'fights, and a real b…'])
})

test('the pickers for a link or a move name a goal with its id, and find it by its id', () => {
  const ids = /const title = goalLabel\(other\)\.toLowerCase\(\)/.test(script)
    && /button\.append\(el\('b', '', goalLabel\(choice\)\)/.test(script)
    && /wanted\.every\(word => goalLabel\(other\)\.toLowerCase\(\)\.includes\(word\)\)/.test(script)
    && /button\.append\(el\('b', '', goalLabel\(other\)\)/.test(script)
  assert.ok(ids, 'the pickers')
  assert.ok(/cut\(`↗ \$\{goalLabel\(ghost\)\}`, 13\)/.test(script), 'a ghost box')
  assert.ok(/el\('div', 'goal-tree-follower', lifted === null \? press\.id : goalLabel\(lifted\)\)/.test(script), 'the box being dragged')
  assert.ok(/\.goal-box\.is-ref \.goal-box-id \{ fill: inherit; \}/.test(style), 'a reference box keeps its id as muted as its title')
})

test('the diagram\'s boxes, the outline\'s rows, the breadcrumb and the frame draw the id; the design says so', () => {
  const checks = [
    [/goalTitleLines\(`\$\{box\.kind === 'ref' \? '↗ ' : ''\}\$\{goalLabel\(node\)\}`, 21\)/, 'the box wraps its label'],
    [/svgEl\('tspan', \{\}, 'goal-box-id'\)/, 'the box draws the id in a tspan of its own'],
    [/el\('button', 'goal-title'\)[\s\S]{0,80}goalLabelNodes\(row, row\.isRef \? '↗ ' : ''\)/, 'the outline row'],
    [/isHere \? el\('span', 'goals-here'\) : el\('button', 'goals-link'\)\n\s+part\.append\(\.\.\.goalLabelNodes\(step\)\)/, 'the breadcrumb'],
    [/goalLabelNodes\(focus\)/, 'the frame'],
    [/goalIdSplit\(cut\(goalLabel\(focus\), Math\.floor\(frame\.w \/ 9\)\), focus\.id\)/, 'the diagram\'s frame around the goal zoomed into'],
    [/'aria-label': `\$\{goalLabel\(node\)\}: /, 'the box is read out with its id'],
  ]
  for (const [pattern, what] of checks) assert.ok(pattern.test(script), what)
  assert.ok(/\.goal-id \{[^}]*color/.test(style), 'the id has its own colour in the outline and the breadcrumb')
  assert.ok(/\.goal-box-id \{[^}]*fill/.test(style), 'and in the diagram')
  assert.ok(/G17 The Advisor's work/.test(design), 'DESIGN.md')
})
