// B164: a checkbox on the Backlog tab shows every step as one list, the newest (the highest id) on top, without the
// activities. The user: "I want a checkbox added to say to remove this and show it 1 long list desc. so last item
// on the backlog first." The page's own code is run here, cut out of board.js between its two marks.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { overview, parseBacklog } from '../src/backlog.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const cut = script.slice(script.indexOf('// coordinate:start'), script.indexOf('// coordinate:end'))
const context = {}
vm.runInNewContext(`${cut}\nthis.coordinateList = coordinateList`, context)
const listOf = (activities, options) => JSON.parse(JSON.stringify(context.coordinateList(activities, options)))
const idsOf = list => list.groups.map(group => [group.name, group.steps.map(step => step.id ?? step.title)])

const BACKLOG = [
  '## Old work',
  '- [x] B01 A finished step (for Units)',
  '- [ ] B02 A step for nobody',
  '- [ ] A step from before the ids',
  '',
  '## Architecture #focus',
  '- [ ] B10 The camera (for Features) (branch feature/camera)',
  '- [ ] B111 The upgrade offer (for Features; after B10)',
  '- [ ] B12 Verify: Say whether the camera is right (Game - Features) @you',
  '',
  '## Next to hand out (Game - Main)',
  '- [ ] B20 A new prop (for Units)',
  '- [x] B99 Done long ago (for Units)',
  '',
].join('\n')
const activities = JSON.parse(JSON.stringify(overview(parseBacklog(BACKLOG, { prefix: 'Game - ', names: ['Main', 'Units', 'Features'] }))))

test('ticked: one list without the activities, the highest id on top, a step without an id at the end', () => {
  const one = listOf(activities, { asOne: true })
  assert.deepEqual(idsOf(one), [[null, ['B111', 'B20', 'B12', 'B10', 'B02', 'A step from before the ids']]])
  assert.equal(one.groups[0].isOne, true)
  // Each step keeps its key, so it opens its window as in the list by activity.
  assert.deepEqual(one.groups[0].steps.map(step => step.key).slice(0, 2), ['B111', 'B20'])
})

test('the filters, the search and "Show finished" work the same in one list', () => {
  assert.deepEqual(idsOf(listOf(activities, { asOne: true, showDone: true })), [[null, ['B111', 'B99', 'B20', 'B12', 'B10', 'B02', 'B01', 'A step from before the ids']]])
  assert.deepEqual(idsOf(listOf(activities, { asOne: true, filter: 'queued' })), [[null, ['B111', 'B20']]])
  assert.deepEqual(idsOf(listOf(activities, { asOne: true, find: 'camera' })), [[null, ['B12', 'B10']]])
  // The counts of the filters are the same in both views.
  assert.deepEqual(listOf(activities, { asOne: true }).counts, listOf(activities, {}).counts)
  assert.deepEqual(listOf(activities, { asOne: true, find: 'nothing like it' }).groups, [])
})

test('unticked: the list by activity, as it was', () => {
  assert.deepEqual(idsOf(listOf(activities, {})).map(([name]) => name), ['Architecture', 'Old work', 'Next to hand out (Game - Main)'])
})

test('the checkbox stands beside "Show finished"', () => {
  const top = html.slice(html.indexOf('class="coordinate-top"'), html.indexOf('</header>', html.indexOf('class="coordinate-top"')))
  assert.ok(top.indexOf('id="coordinate-done"') < top.indexOf('id="coordinate-one"'))
  assert.match(top, /id="coordinate-one" checked> One list, newest first/)
})

// B179: the user, 2026-10-14: "Make the backlog 'recently finished' collapsible. Also one list checkbox turned on by
// default."
test('one list is on unless this browser turned it off, also without storage', () => {
  assert.match(script, /\$\('coordinate-one'\)\.checked = localStorage\.getItem\('backlog-one'\) !== 'no'/)
  assert.match(script, /localStorage\.setItem\('backlog-one', \$\('coordinate-one'\)\.checked \? 'yes' : 'no'\)/)
})

test('"Recently finished" folds away with a click on its head, kept in this browser', () => {
  const draw = script.slice(script.indexOf('function drawFinished('), script.indexOf("$('finished').addEventListener"))
  // The head is a button that says whether the list is open, and names what it folds.
  assert.match(draw, /fold\.setAttribute\('aria-expanded', String\(!finishedFolded\)\)/)
  assert.match(draw, /fold\.setAttribute\('aria-controls', 'finished-body'\)/)
  assert.match(draw, /list\.id = 'finished-body'\n  list\.hidden = finishedFolded/)
  // The arrow is not read out, and a redraw keeps the keyboard on the head.
  assert.match(draw, /arrow\.setAttribute\('aria-hidden', 'true'\)/)
  assert.match(draw, /fill\(box, \[head, list\]\)\n  if \(wasOnHead\) fold\.focus\(\)/)
  // Unfolded unless this browser folded it; a click turns it and keeps the choice.
  assert.match(script, /finishedFolded = localStorage\.getItem\('finished-folded'\) === 'yes'/)
  const click = script.slice(script.indexOf("$('finished').addEventListener"), script.indexOf("$('finished').addEventListener") + 700)
  assert.match(click, /closest\('\[data-fold-finished\]'\)/)
  assert.match(click, /finishedFolded = !finishedFolded/)
  assert.match(click, /localStorage\.setItem\('finished-folded', finishedFolded \? 'yes' : 'no'\)/)
})
