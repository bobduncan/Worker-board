// B468: a step's window shows its effort: the five levels with its own lit, its reason (or that it counts as medium),
// who runs at it now, and what the board kept for that level. The page's own code, cut out of board.js between its
// marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = (start, end) => script.slice(script.indexOf(start), script.indexOf(end))
const page = {}
vm.runInNewContext(`${cut('// item:start', '// item:end')}
this.itemPartsOf = itemPartsOf; this.effortRunLine = effortRunLine; this.effortKeptLine = effortKeptLine`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const AT = new Date(2026, 9, 21, 9, 12).getTime()
const item = (state, effort = { level: 'low', why: 'a text fix', isSet: true }) => ({
  id: 'B7', title: 'Fix the gate words', summary: [], picture: null, goal: null, what: [], requirements: [], touches: [], history: [], checked: null, fixOf: null, effort, owner: 'Units', state,
})
const lane = effortRun => ({ name: 'Units', effortRun })

test('who runs at the step\'s effort: set, asked and not set yet, or to come', () => {
  assert.equal(page.effortRunLine(item('in progress'), [lane({ level: 'low', usual: 'xhigh', step: 'B7', isSet: true, asked: { at: AT, state: 'delivered' } })]),
    'Units runs at low until the step ends, then at its usual level (xhigh).')
  assert.equal(page.effortRunLine(item('queued'), [lane({ level: 'low', usual: 'xhigh', step: 'B7', isSet: false, asked: { at: AT, state: 'taken' } })]),
    'The main chat was asked at 09:12 to set Units to low; not set yet.')
  assert.equal(page.effortRunLine(item('queued'), [lane({ level: 'low', usual: 'xhigh', step: 'B7', isSet: true, asked: null })]), 'Units is set to low for it already.')
  assert.equal(page.effortRunLine(item('queued'), []), 'Units is set to low before the step goes to it.')
  assert.equal(page.effortRunLine(item('waiting on you'), [lane({ level: 'medium', step: 'B9', isSet: true, asked: null })]), 'Units is to run at low while it holds the step.')
  assert.equal(page.effortRunLine(item('review'), []), null)
  assert.equal(page.effortRunLine({ ...item('queued'), owner: null }, []), null)
})

test('what the board kept for a level', () => {
  assert.equal(page.effortKeptLine('low', [{ level: 'low', count: 3, typicalMin: 75, tokens: 2_400_000, output: 9000 }]), 'Kept for low: 3 steps so far, typically 1 h 15 min and 2.4 M tokens.')
  assert.equal(page.effortKeptLine('high', [{ level: 'high', count: 1, typicalMin: 40, tokens: null, output: null }]), 'Kept for high: 1 step so far, typically 40 min.')
  assert.equal(page.effortKeptLine('max', []), 'Kept per level: the time and tokens its steps take, so the levels can be tuned. None at max yet.')
})

test('the effort part stands after the goal, with its run and kept lines; an item without one has none', () => {
  const parts = plain(page.itemPartsOf(item('in progress'), true, { lanes: [lane({ level: 'low', usual: 'high', step: 'B7', isSet: true, asked: null })], efforts: [] }))
  assert.deepEqual(parts.map(part => part.key), ['effort', 'flow'])
  assert.deepEqual(parts[0], {
    key: 'effort', title: 'Effort', lines: [], isFolded: false, effort: { level: 'low', why: 'a text fix', isSet: true },
    run: 'Units runs at low until the step ends, then at its usual level (high).', kept: 'Kept per level: the time and tokens its steps take, so the levels can be tuned. None at low yet.',
  })
  const { effort, ...without } = item('queued')
  assert.deepEqual(plain(page.itemPartsOf(without, false)).map(part => part.key), [])
})
