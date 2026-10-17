// B157: a task window says in a few lines what was asked and what the answer is, with the details folded away. The
// page's own code is run here, cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\nObject.assign(this, { shortTask })`, page)

test('the short task is the main chat\'s first line without its frame: what is asked, not who asks or how long', () => {
  assert.equal(page.shortTask('Task from Game - Main: B201, a zebracorn that sings at dawn. About 1 hour 30 minutes.\n\nWhy: the person asked.'), 'A zebracorn that sings at dawn.')
  assert.equal(page.shortTask('Two tasks from Game - Main: B12 and then B13, the quokkaberry maps. About 2 h.'), 'B12 and then B13, the quokkaberry maps.')
  assert.equal(page.shortTask('Next task from Game - Main: B7: the narwhal bridge. About 45 minutes'), 'The narwhal bridge.')
  // A first line without that frame stays as it is: the person's own words, typed in the chat.
  assert.equal(page.shortTask('make the zebracorn sing louder\nand at dusk too'), 'Make the zebracorn sing louder')
})

test('an "In short:" line wins; without a message the step\'s title, then the card\'s topic', () => {
  assert.equal(page.shortTask('Task from Game - Main: B201, a long first line about many things at once. About 3 h.\nIn short: the zebracorn sings.'), 'The zebracorn sings.')
  assert.equal(page.shortTask(null, 'zebracorn songs at dawn', 'songs'), 'Zebracorn songs at dawn')
  assert.equal(page.shortTask('', null, 'songs'), 'Songs')
  assert.equal(page.shortTask(null), '')
})

test('a long task is cut, so the window\'s two lines hold it', () => {
  const long = page.shortTask(`Task from Game - Main: B201, ${'a zebracorn sings '.repeat(30)}. About 1 h.`)
  assert.equal(long.length, 220)
  assert.ok(long.endsWith('…'))
})

// The top part in plain words (the person, 2026-10-14: "non technical and highover")

const more = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\nObject.assign(this, { plainWords, planOf, laneWindowOf, isTechnical })`, more)
const plain = value => JSON.parse(JSON.stringify(value))

test('what it did keeps its plain sentences and leaves the technical ones out', () => {
  const did = 'A link can now open the game on any screen. It reads `?screen=` in src/settings/startScreen.ts and all 1,659 tests pass. Your own saved run is never touched.'
  assert.equal(more.plainWords(did), 'A link can now open the game on any screen. Your own saved run is never touched.')
  for (const technical of ['It lives in public/board.js.', 'Call laneWindowOf() first.', 'The branch feature/x is merged.', 'Set ?arena=bridge to see it.', 'It changes stepLine and the snake_case name.', 'The commit is pushed.']) {
    assert.equal(more.plainWords(technical), '', technical)
  }
  assert.equal(more.plainWords(''), '')
  assert.equal(more.plainWords(null), '')
  // A plain answer stays whole, also over several lines.
  assert.equal(more.plainWords('The shop opens at once.\nNothing else changed.'), 'The shop opens at once. Nothing else changed.')
})

test('its plan: the steps by name with where each stands, the technical ones left out, and the step and time', () => {
  const NOW = 1_000_000 * 60_000
  const lane = { name: 'Units', state: 'working', task: { text: 'Portraits', step: 2, steps: 4, names: ['Look at the pictures', 'Edit board.js', 'Draw the new one', 'Show it to you'], stepLeftMs: 12 * 60_000, stepEstimateAt: NOW, startedAt: NOW - 30 * 60_000 } }
  const plan = plain(more.planOf(lane, NOW))
  assert.deepEqual(plan.steps, [{ name: 'Look at the pictures', state: 'done' }, { name: 'Draw the new one', state: 'next' }, { name: 'Show it to you', state: 'next' }])
  assert.equal(plan.line, 'Step 2 of 4 · 12 min left')
  assert.equal(more.planOf({ ...lane, task: { ...lane.task, names: null } }, NOW), null)
  // The window's view carries the short task and the plan.
  const view = plain(more.laneWindowOf({ ...lane, givenTask: { by: 'main', at: NOW - 60 * 60_000, text: 'Task from Game - Main: B88, the zebracorn portraits. About 1 h.\n\nWhy: ...', step: { id: 'B88', title: 'zebracorn portraits' } } }, NOW, 'Game - Main'))
  assert.deepEqual([view.task, view.plan.line], ['The zebracorn portraits.', 'Step 2 of 4 · 12 min left'])
})

test('both windows: the brief on top, the rest under "Details", folded until opened, kept open when drawn anew', () => {
  assert.match(script, /main: \[\n\s+\/\/ B157: on top[^\n]*\n[^\n]*\n\s+view => briefPart\(\[\['The task', taskNodes\(view\)\], \[view\.feedback\?\.title \?\? '', feedbackNodes\(view\.feedback\)\], \['Its plan', planNodes\(view\.plan\)\]\]\),\n\s+\/\/ B157: below, folded[^\n]*\n\s+view => foldedDetails\(\[/)
  assert.match(script, /  side: \[\],\n\}/)
  assert.match(script, /const details = el\('details', 'task-details'\)\n\s+details\.append\(el\('summary', '', 'Details'\), \.\.\.shown\)/)
  assert.ok(!/task-details'\)[^\n]*\.open = true/.test(script.slice(script.indexOf('function foldedDetails'), script.indexOf('function keepUnfolded'))), 'the details open by themselves')
  assert.match(script, /const did = plainWords\(handover\.did\)/)
  assert.match(script, /\.\.\.closingParts\(handover\.closing\),\n\s+\]\)\)/)
  assert.match(script, /keepUnfolded\(box, \(\) => fill\(box, foot\.children\.length === 0/)
  assert.match(script, /keepUnfolded\(box, \(\) => fill\(box, \[detailsHead\(view/)
  assert.match(style, /\.task-brief \.brief-task \{[^}]*-webkit-line-clamp: 2/)
  assert.match(style, /\.task-brief h3 \{[^}]*font-weight: 700/)
})

test('the head does not say the step\'s id twice', () => {
  const NOW = 1_000_000 * 60_000
  const lane = { name: 'Units', state: 'working', task: { text: 'B88 zebracorn portraits', step: null, steps: null, names: null, stepId: 'B88' } }
  const view = plain(more.laneWindowOf(lane, NOW, 'Game - Main'))
  assert.deepEqual([view.code, view.title], ['B88', 'zebracorn portraits'])
  assert.equal(plain(more.laneWindowOf({ ...lane, task: { ...lane.task, text: 'Portraits of B88' } }, NOW, 'Game - Main')).title, 'Portraits of B88')
})
