// B356, the page: a step's window shows its result check (the ticks, the score, the evidence picture) and the step a fix
// step fixes; the Focus page shows under each part its steps' result checks. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseGoals } from '../src/goals.mjs'
import { focusState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { checkedOf } from '../src/work/resultCheck.mjs'

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = (from, to) => script.slice(script.indexOf(from), script.indexOf(to))
const page = {}
vm.runInNewContext(`${cut('// item:start', '// item:end')}\n${cut('// focus:start', '// focus:end')}\nthis.itemPartsOf = itemPartsOf; this.focusView = focusView`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const CHECKED = ['Evidence: pictures/b2/evidence.png', 'Score: 61 of 75', '- pass: a lamp at every bench', '- fail: warm yellow light, never white', '- ask: the glow at dusk']
const step = (id, state, checked = null, extra = '') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nSince: 2026-10-19 09:00\n${extra}${checked === null ? '' : `\n## Checked\n${checked.join('\n')}\n`}`)

test('a step\'s result check as its record keeps it: the evidence, the score and each point with its verdict', () => {
  assert.deepEqual(checkedOf(step('B2', 'review', CHECKED)), {
    evidence: 'pictures/b2/evidence.png', score: '61 of 75', passed: 1, total: 3,
    points: [{ verdict: 'pass', text: 'a lamp at every bench' }, { verdict: 'fail', text: 'warm yellow light, never white' }, { verdict: 'ask', text: 'the glow at dusk' }],
  })
  assert.equal(checkedOf(step('B2', 'review')), null)
})

test('the step\'s window: "Checked by a helper" after What we build, with the ticks; a fix step names the step it fixes', () => {
  const item = { summary: ['Warm lamps.'], picture: null, goal: null, what: ['a lamp at every bench'], requirements: [], touches: [], history: ['made'], checked: checkedOf(step('B2', 'review', CHECKED)), fixOf: 'B1' }
  const parts = plain(page.itemPartsOf(item, false))
  assert.deepEqual(parts.map(part => part.key), ['summary', 'what', 'checked', 'fixof', 'history'])
  assert.deepEqual(parts[2].lines, ['1 of 3 points pass · score 61 of 75', '✓ a lamp at every bench', '✗ warm yellow light, never white', '? the glow at dusk (for you to judge)'])
  assert.deepEqual(parts[3].lines, ['B1'])
  // Without a check, neither part.
  assert.deepEqual(plain(page.itemPartsOf({ ...item, checked: null, fixOf: null }, false)).map(part => part.key), ['summary', 'what', 'history'])
})

const GOALS = [
  'Last id: G6',
  'Focus: G6',
  '',
  '- [~] G6 A garden at dusk',
  '    Done when: every path is lit after dark',
  '    Vibe: warm',
  '    Vibe agreed: 2026-10-19 08:00',
  '    Part: The lamps · about 1 h · steps B2, B3',
  '    How agreed: 2026-10-19 08:30',
  '',
].join('\n')

test('the Focus page: each part shows its steps\' result checks, with the evidence to open', () => {
  const all = ['Evidence: pictures/b3/evidence.png', '- pass: a lamp at every bench']
  const state = focusState(parseGoals(GOALS), [step('B2', 'review', CHECKED), step('B3', 'done', all)], [], '')
  assert.deepEqual(state.parts[0].checked, [{ id: 'B2', passed: 1, total: 3, evidence: 'pictures/b2/evidence.png' }, { id: 'B3', passed: 1, total: 1, evidence: 'pictures/b3/evidence.png' }])
  const view = plain(page.focusView(state, parseGoals(GOALS), { canWrite: true, whyNot: null }))
  assert.deepEqual(view.run.parts[0].checked, [
    { text: 'Checked by a helper: 1 of 3 points pass (B2)', isPass: false, picture: 'pictures/b2/evidence.png' },
    { text: 'Checked by a helper: 1 of 1 points pass (B3)', isPass: true, picture: 'pictures/b3/evidence.png' },
  ])
})

// B504: a failed check follows its fix steps to the last one: quiet once that passed, red only while a fix is open or failed.
const FAILED = ['Evidence: pictures/b2/evidence.png', '- pass: a lamp at every bench', '- fail: warm yellow light, never white']
const PASSED = ['Evidence: pictures/b9/evidence.png', 'Score: 2 of 2', '- pass: a lamp at every bench', '- pass: warm yellow light']
const fixOf = (id, of, state, checked = null) => step(id, state, checked, `Fix of: ${of}\n`)
const chain = (...items) => {
  const state = focusState(parseGoals(GOALS), items, [], '')
  const [line] = plain(page.focusView(state, parseGoals(GOALS), { canWrite: true, whyNot: null })).run.parts[0].checked
  return { data: state.parts[0].checked[0], line }
}

test('a failed check whose last fix passed is quiet: "fixed by", with the fix\'s own evidence', () => {
  const { data, line } = chain(step('B2', 'done', FAILED), fixOf('B5', 'B2', 'done', PASSED))
  assert.deepEqual(data.fix, { by: 'B5', passed: 2, total: 2, evidence: 'pictures/b9/evidence.png', isFixed: true, note: null })
  assert.deepEqual(line, {
    text: 'Checked by a helper: 1 of 2 points pass (B2)', isPass: true, picture: 'pictures/b2/evidence.png',
    fix: { text: 'fixed by B5: 2 of 2', picture: 'pictures/b9/evidence.png' },
  })
})

test('a fix that is still open keeps the check red and says what goes on', () => {
  for (const [state, note] of [['review', 'its fix B5 is being checked'], ['queued', 'its fix B5 is waiting to start'], ['in progress', 'its fix B5 is being worked on']]) {
    const { line } = chain(step('B2', 'review', FAILED), fixOf('B5', 'B2', state))
    assert.equal(line.isPass, false)
    assert.equal(line.fix.text, note)
  }
})

test('a chain of several rounds is followed to its last fix', () => {
  // B2 fixed by B5, whose own check failed and was fixed by B6, then B7
  const failedToo = ['Evidence: pictures/b5/evidence.png', '- fail: the glow at dusk']
  const done = [step('B2', 'done', FAILED), fixOf('B5', 'B2', 'done', failedToo), fixOf('B6', 'B5', 'done', failedToo)]
  assert.equal(chain(...done, fixOf('B7', 'B6', 'done', PASSED)).line.fix.text, 'fixed by B7: 2 of 2')
  assert.equal(chain(...done, fixOf('B7', 'B6', 'review')).line.fix.text, 'its fix B6 failed too, B7 is being checked')
  assert.equal(chain(...done, fixOf('B7', 'B6', 'in progress')).line.fix.text, 'its fix B6 failed too, B7 fixes it')
  assert.equal(chain(...done).line.fix.text, 'its fix B6 failed too')
  assert.equal(chain(...done).line.isPass, false)
})

test('a dropped fix counts for nothing, and a check without a fix reads as before', () => {
  assert.equal(chain(step('B2', 'review', FAILED), fixOf('B5', 'B2', 'dropped')).data.fix, undefined)
  const { data, line } = chain(step('B2', 'review', FAILED))
  assert.equal(data.fix, undefined)
  assert.deepEqual(line, { text: 'Checked by a helper: 1 of 2 points pass (B2)', isPass: false, picture: 'pictures/b2/evidence.png' })
})
