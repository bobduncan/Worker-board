// B354, the page: a goal without a Done when is not picked as the focus, and gets its tick only once it has one; its row
// and the "Is the vibe there?" card offer the button that asks the partner to write it. A part of the run shows its
// standard. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseGoals } from '../src/goals.mjs'
import { focusState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
Object.assign(this, { focusView })`, made)
const focusView = (...args) => JSON.parse(JSON.stringify(made.focusView(...args)))
const CAN = { canWrite: true, whyNot: null }

const PICK = [
  'Last id: G3',
  '',
  '- [ ] G1 A forest to walk',
  '  Done when: a player crosses the forest in five minutes',
  '- [ ] G2 Lanterns',
  '- [ ] G3 A pond',
  '  Done when:  ',
  '',
].join('\n')

test('a goal without a Done when is offered with the button that asks the partner for it, not with Pick', () => {
  const view = focusView(null, parseGoals(PICK), CAN, { asked: ['G3'] })
  assert.deepEqual(view.pick.rows.map(row => [row.id, row.hasDoneWhen, row.isAsked]), [['G1', true, false], ['G2', false, false], ['G3', false, true]])
  assert.deepEqual(view.pick.ask, { label: 'Ask your partner to write it', act: 'done-when', isEnabled: true, title: 'A goal becomes your focus once its Done when says how you check it: your partner writes one' })
  assert.equal(view.pick.noDoneWhen, 'No Done when yet')
  assert.equal(view.pick.asked, 'Your partner writes its Done when')
  // On a board that only shows, the button is off with why, as Pick is.
  const shows = focusView(null, parseGoals(PICK), { canWrite: false, whyNot: 'This board only shows.' })
  assert.deepEqual([shows.pick.ask.isEnabled, shows.pick.ask.title], [false, 'This board only shows.'])
})

const RUN = [
  'Last id: G6',
  'Focus: G6',
  '',
  '- [~] G6 A forest to walk',
  '    Vibe: quiet and green',
  '    Vibe agreed: 2026-10-18 10:00',
  '    Part: The levels · about 2 h · steps B1',
  '    Part: The wolf · 3 h · steps B2',
  '    How agreed: 2026-10-18 11:00',
  '',
].join('\n')
const step = (id, standard) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: done\nSince: 2026-10-18 09:00\n${standard === null ? '' : `\n## Standard\n${standard}\n`}`)
const ITEMS = [step('B1', 'level · art/levels/forest.png · target 8'), step('B2', null)]

test('the run shows each part\'s standard under it, its reference picture to open', () => {
  const view = focusView(focusState(parseGoals(RUN.replace('    Vibe: quiet', '    Done when: a player crosses it in five minutes\n    Vibe: quiet')), ITEMS, [], ''), parseGoals(RUN), CAN)
  assert.deepEqual(view.run.parts.map(part => part.standards), [[{ kind: 'level', picture: 'art/levels/forest.png', target: 'target 8', line: 'level · art/levels/forest.png · target 8' }], []])
})

test('"Is the vibe there?" without a Done when: Yes is off, and the button asks the partner to write it', () => {
  const without = focusView(focusState(parseGoals(RUN), ITEMS, [], ''), parseGoals(RUN), CAN)
  assert.equal(without.vibeThere.buttons[0].isEnabled, false)
  assert.equal(without.vibeThere.buttons[0].title, 'Its Done when is missing: the goal gets its tick against it')
  assert.deepEqual(without.vibeThere.doneWhen, { label: 'Ask your partner to write its Done when', act: 'done-when', isEnabled: true, title: 'Your partner writes how you check the goal is done' })
  const withIt = focusView(focusState(parseGoals(RUN.replace('    Vibe: quiet', '    Done when: a player crosses it in five minutes\n    Demo: art/g3/demo.png · what it made\n    Vibe: quiet')), ITEMS, [], ''), parseGoals(RUN), CAN)
  assert.equal(withIt.vibeThere.buttons[0].isEnabled, true)
  assert.equal(withIt.vibeThere.doneWhen, null)
  assert.equal(withIt.vibeThere.doneWhenLine, 'Done when: a player crosses it in five minutes')
})

test('the page sends the button\'s word, says a new goal waits for its Done when, and the Goals part offers the button too', () => {
  assert.match(script, /command: 'done-when', id: goal \?\? focus\?\.id/)
  assert.match(script, /result\?\.isFocus === false/)
  assert.match(script, /goalButton\('goals-tool is-ask', 'Ask your partner for a Done when', \{ goalTool: 'done-when' \}\)/)
  assert.match(script, /if \(tool === 'done-when'\) \{\n    return sendGoals\(\{ command: 'done-when', id: focus \}\)\.then\(done => \{\n      if \(done === null\) return\n      showPaste\(done\.paste \?\? null\)/)
  // The review: each goal once in the page's list of goals asked for.
  assert.match(script, /focusUi\.asked = \[\.\.\.new Set\(\[\.\.\.focusUi\.asked, id\]\)\]/)
})

test('the review: a goal asked for already can be asked again, in the pick list and on the vibe card', () => {
  const view = focusView(null, parseGoals(PICK), CAN, { asked: ['G3'] })
  assert.deepEqual(view.pick.askAgain, { label: 'Ask again', act: 'done-when', isEnabled: true, title: 'Ask your partner once more to write its Done when' })
  const asked = focusView(focusState(parseGoals(RUN), ITEMS, [], ''), parseGoals(RUN), CAN, { asked: ['G6'] })
  assert.equal(asked.vibeThere.doneWhen.label, 'Ask your partner again')
})
