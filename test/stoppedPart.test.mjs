// B680: a part of a goal whose steps were all dropped is Stopped ("Stopped, nothing reached"), not Done. It counts neither
// done nor open, "Did we reach the goal?" waits while any part is Stopped, and the person can drop the part with a
// reason ("Part dropped: <part> · <date> · <why>" under the goal, with Undo). Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { partDropRefusal } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'
import { editGoals } from '../src/goalsWrite.mjs'
import { focusState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(here, '..', 'public', 'board.js'), 'utf8')
const styles = await readFile(join(here, '..', 'public', 'board.css'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
Object.assign(this, { focusView })`, made)
const focusView = (...args) => JSON.parse(JSON.stringify(made.focusView(...args)))
const CAN = { canWrite: true, whyNot: null }

const GOALS = [
  'Last id: G2',
  'Focus: G2',
  '',
  '- [~] G2 Round shapes',
  '    Done when: the cliffs read round',
  '    Demo: art/g2/demo.png · the cliffs',
  // Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
  '    Goal definition: soft edges',
  '    Goal definition agreed: 2026-10-18 10:00',
  '    Part: Cliffs and edges · about 2 h · steps B1, B2',
  '    Part: Round shapes · 1 h · steps B3',
  '    Part: The loop · 30 min · steps B4',
  '    How agreed: 2026-10-18 11:00',
  '',
].join('\n')
const step = (id, state) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nSince: 2026-10-18 09:00\n`)
const run = (items, text = GOALS) => focusState(parseGoals(text), items, [], 'Game - ')
const dropped = '    Part dropped: Round shapes · 2026-10-26 14:00 · wrong way to paint them\n'
const withDropped = GOALS.replace('    How agreed', `${dropped}    How agreed`)

test('a part whose steps are all dropped is Stopped, never Done, and its bar stays empty', () => {
  const state = run([step('B1', 'dropped'), step('B2', 'dropped'), step('B3', 'done'), step('B4', 'done')])
  assert.deepEqual(state.parts.map(part => part.state), ['stopped', 'done', 'done'])
  const view = focusView(state, parseGoals(GOALS), CAN)
  const stopped = view.run.parts[0]
  assert.deepEqual([stopped.chip, stopped.tone, stopped.percent], ['Stopped, nothing reached', 'stopped', 0])
  assert.equal(view.run.parts[1].chip, 'Done')
})

test('some steps done and the rest dropped stays Done; an open step keeps the part as it was; a new step opens a Stopped part again', () => {
  assert.equal(run([step('B1', 'done'), step('B2', 'dropped')]).parts[0].state, 'done')
  assert.equal(run([step('B1', 'closed'), step('B2', 'dropped')]).parts[0].state, 'done')
  assert.equal(run([step('B1', 'dropped'), step('B2', 'queued')]).parts[0].state, 'next')
  assert.equal(run([step('B1', 'dropped'), step('B2', 'in progress')]).parts[0].state, 'now')
  assert.equal(run([step('B1', 'dropped'), step('B2', 'refined')]).parts[0].state, 'ready')
  // The partner adds a new step to the Stopped part: it is open again.
  assert.equal(run([step('B1', 'dropped'), step('B2', 'dropped')]).parts[0].state, 'stopped')
  assert.equal(run([step('B1', 'dropped'), step('B2', 'dropped'), step('B5', 'queued')], GOALS.replace('steps B1, B2', 'steps B1, B2, B5')).parts[0].state, 'next')
  // A part with no step in the store is not Stopped: it was never tried.
  assert.equal(run([]).parts[0].state, 'next')
})

test('a Stopped part counts neither done nor open: not in the progress, not in the minutes left', () => {
  const state = run([step('B1', 'dropped'), step('B2', 'dropped'), step('B3', 'queued'), step('B4', 'done')])
  assert.deepEqual(state.progress, { done: 1, total: 3, stopped: 1, minutesLeft: 60 })
  // Work blocks (2026-10-31): the progress counts work blocks.
  assert.equal(focusView(state, null).progress.text, '1 of 3 work blocks done · 1 stopped · about 1 h left')
  // No Stopped part: the progress is as it was.
  assert.deepEqual(run([step('B1', 'done'), step('B2', 'done'), step('B3', 'queued')]).progress, { done: 1, total: 3, minutesLeft: 90 })
})

test('"Did we reach the goal?" waits while any part is Stopped, and comes once every part is done or dropped by the person', () => {
  const all = [step('B3', 'done'), step('B4', 'done')]
  const waits = run([step('B1', 'dropped'), step('B2', 'dropped'), ...all])
  assert.equal(focusView(waits, parseGoals(GOALS), CAN).vibeThere, null)
  // The partner makes a new try: the part goes on, the question still waits until it is done.
  const reached = run([step('B1', 'done'), step('B2', 'dropped'), ...all])
  assert.equal(focusView(reached, parseGoals(GOALS), CAN).vibeThere.question, 'Did we reach the goal?')
})

test('a part the person dropped shows "Dropped: <why>", is out of the whole, and lets the question come', () => {
  const items = [step('B1', 'done'), step('B2', 'done'), step('B3', 'dropped'), step('B4', 'done')]
  const state = run(items, withDropped)
  assert.deepEqual(state.parts.map(part => part.state), ['done', 'dropped', 'done'])
  assert.equal(state.parts[1].why, 'wrong way to paint them')
  assert.deepEqual(state.progress, { done: 2, total: 2, minutesLeft: null })
  const view = focusView(state, parseGoals(withDropped), CAN)
  assert.equal(view.run.parts[1].chip, 'Dropped: wrong way to paint them')
  assert.equal(view.run.parts[1].percent, 0)
  assert.equal(view.vibeThere.question, 'Did we reach the goal?')
  // The line is read from the map, and the plain Part lines are untouched.
  assert.deepEqual(parseGoals(withDropped).byId.get('G2').partsDropped, [{ title: 'Round shapes', at: '2026-10-26 14:00', why: 'wrong way to paint them' }])
  assert.equal(parseGoals(withDropped).byId.get('G2').parts.length, 3)
})

test('under a Stopped part a small "Drop this part" asks the person; a part that is not Stopped has none', () => {
  const state = run([step('B1', 'dropped'), step('B2', 'dropped'), step('B3', 'queued'), step('B4', 'done')])
  const view = focusView(state, parseGoals(GOALS), CAN)
  // Work blocks (2026-10-31): on the Focus page a part is a work block.
  assert.deepEqual(view.run.parts[0].drop, { label: 'Drop this work block', act: 'part-drop', isEnabled: true, title: 'You stop this work block: say why in one line. It then counts out of the whole. Your partner can instead try another way.' })
  assert.equal(view.run.parts[1].drop, undefined)
  assert.equal(view.run.parts[2].drop, undefined)
  const shows = focusView(state, parseGoals(GOALS), { canWrite: false, whyNot: 'This board only shows.' })
  assert.deepEqual([shows.run.parts[0].drop.isEnabled, shows.run.parts[0].drop.title], [false, 'This board only shows.'])
})

test('the board refuses to drop a part that is not Stopped, with its reason missing, or that is not in the focus', () => {
  const focus = run([step('B1', 'dropped'), step('B2', 'dropped'), step('B3', 'queued'), step('B4', 'done')])
  assert.equal(partDropRefusal(focus, { id: 'G2', part: 'Cliffs and edges', text: 'wrong way' }), null)
  assert.match(partDropRefusal(focus, { id: 'G2', part: 'Cliffs and edges', text: '   ' }), /why/i)
  assert.match(partDropRefusal(focus, { id: 'G2', part: 'Round shapes', text: 'wrong way' }), /Stopped/)
  assert.match(partDropRefusal(focus, { id: 'G2', part: 'No such part', text: 'wrong way' }), /not a part/)
  assert.match(partDropRefusal(focus, { id: 'G9', part: 'Cliffs and edges', text: 'wrong way' }), /focus/)
  assert.match(partDropRefusal(null, { id: 'G2', part: 'Cliffs and edges', text: 'wrong way' }), /focus/)
})

test('the page writes the drop through the goal map with its Undo: one line, once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'b680-'))
  try {
    const file = join(dir, 'goals.md')
    await writeFile(file, GOALS)
    const at = { canWrite: true, file, historyDir: join(dir, 'history'), now: new Date(2026, 9, 26, 14, 0).getTime() }
    const body = { command: 'part-drop', id: 'G2', part: 'Round shapes', text: 'wrong way to paint them', page: 'b680test' }
    assert.deepEqual((await editGoals(body, at)).ok, true)
    const written = parseGoals(await readFile(file, 'utf8')).byId.get('G2')
    assert.deepEqual(written.partsDropped, [{ title: 'Round shapes', at: '2026-10-26 14:00', why: 'wrong way to paint them' }])
    assert.equal(written.parts.length, 3)
    // A second drop of the same part changes nothing.
    assert.deepEqual((await editGoals(body, at)).result, { unchanged: true })
    assert.equal(parseGoals(await readFile(file, 'utf8')).byId.get('G2').partsDropped.length, 1)
    // A part the goal does not have, or without a reason, is refused.
    assert.equal((await editGoals({ ...body, part: 'No such part' }, at)).ok, false)
    assert.equal((await editGoals({ ...body, part: 'The loop', text: ' ' }, at)).ok, false)
    // Undo takes the line away.
    assert.equal((await editGoals({ command: 'undo', page: 'b680test' }, at)).ok, true)
    assert.equal(parseGoals(await readFile(file, 'utf8')).byId.get('G2').partsDropped.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the page sends the drop with the reason, asks for it first, and the styles keep a Stopped part grey and empty', () => {
  assert.match(script, /command: 'part-drop', id: focus\.id, part: /)
  assert.match(script, /focusUi\.dropping/)
  assert.match(styles, /\.focus-chip\.is-stopped[^{]*\{[^}]*color: var\(--muted\)/)
  assert.doesNotMatch(styles.match(/\.focus-chip\.is-stopped[^{]*\{[^}]*\}/)[0], /#2d6b47|var\(--working\)|#0f2a1d/)
  assert.match(styles, /\.focus-part\.is-stopped \.focus-bar span[^{]*\{[^}]*width: 0/)
})
