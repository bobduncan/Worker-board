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
this.itemPartsOf = itemPartsOf; this.effortRunLine = effortRunLine; this.effortKeptLine = effortKeptLine; this.runWords = runWords`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const AT = new Date(2026, 9, 21, 9, 12).getTime()
const SONNET = { family: 'sonnet', why: null, isSet: false }
const item = (state, effort = { level: 'low', why: 'a text fix', isSet: true }, model = SONNET) => ({
  id: 'B7', title: 'Fix the gate words', summary: [], picture: null, goal: null, what: [], requirements: [], touches: [], history: [], checked: null, fixOf: null, effort, model, owner: 'Units', state,
})
const lane = effortRun => ({ name: 'Units', effortRun })

test('who runs at the step\'s model and effort: set, asked and not set yet, or to come', () => {
  const run = more => lane({ level: 'low', model: 'sonnet', usual: 'medium', usualModel: 'sonnet', step: 'B7', ...more })
  assert.equal(page.effortRunLine(item('in progress'), [run({ isSet: true, asked: { at: AT, state: 'delivered' } })]),
    'Units runs at Sonnet · low until the step ends, then at its usual setting (Sonnet · medium).')
  assert.equal(page.effortRunLine(item('queued'), [run({ isSet: false, asked: { at: AT, state: 'taken' } })]),
    'The main chat was asked at 09:12 to set Units to Sonnet · low; not set yet.')
  assert.equal(page.effortRunLine(item('queued'), [run({ isSet: true, asked: null })]), 'Units is set to Sonnet · low for it already.')
  assert.equal(page.effortRunLine(item('queued'), []), 'Units is set to Sonnet · low before the step goes to it.')
  assert.equal(page.effortRunLine(item('waiting on you'), [lane({ level: 'medium', step: 'B9', isSet: true, asked: null })]), 'Units is to run at Sonnet · low while it holds the step.')
  assert.equal(page.effortRunLine(item('review'), []), null)
  // An opus step says so.
  assert.equal(page.effortRunLine(item('queued', undefined, { family: 'opus', why: 'a guard', isSet: true }), []), 'Units is set to Opus · low before the step goes to it.')
  // The Owner written in another case is the same chat.
  assert.equal(page.effortRunLine({ ...item('in progress'), owner: 'units' }, [run({ isSet: true, asked: null })]),
    'units runs at Sonnet · low until the step ends, then at its usual setting (Sonnet · medium).')
  assert.equal(page.effortRunLine({ ...item('queued'), owner: null }, []), null)
  // A state from before model per step names the level alone.
  const { model, ...older } = item('in progress')
  assert.equal(page.effortRunLine(older, [lane({ level: 'low', usual: 'xhigh', step: 'B7', isSet: true, asked: null })]), 'Units runs at low until the step ends, then at its usual setting (xhigh).')
  assert.equal(page.runWords('opus', 'high'), 'Opus · high')
})

test('what the board kept for a level', () => {
  assert.equal(page.effortKeptLine('low', [{ level: 'low', count: 3, typicalMin: 75, tokens: 2_400_000, output: 9000 }]), 'Kept for low: 3 steps so far, typically 1 h 15 min and 2.4 M tokens.')
  assert.equal(page.effortKeptLine('high', [{ level: 'high', count: 1, typicalMin: 40, tokens: null, output: null }]), 'Kept for high: 1 step so far, typically 40 min.')
  assert.equal(page.effortKeptLine('max', []), 'Kept per level: the time and tokens its steps take, so the levels can be tuned. None at max yet.')
})

test('the model and effort part stands after the goal, with its run and kept lines; an item without one has none', () => {
  const parts = plain(page.itemPartsOf(item('in progress'), true, { lanes: [lane({ level: 'low', model: 'sonnet', usual: 'medium', usualModel: 'sonnet', step: 'B7', isSet: true, asked: null })], efforts: [] }))
  assert.deepEqual(parts.map(part => part.key), ['effort', 'flow'])
  assert.deepEqual(parts[0], {
    key: 'effort', title: 'Model and effort', lines: [], isFolded: false, effort: { level: 'low', why: 'a text fix', isSet: true }, model: SONNET,
    run: 'Units runs at Sonnet · low until the step ends, then at its usual setting (Sonnet · medium).', kept: 'Kept per level: the time and tokens its steps take, so the levels can be tuned. None at low yet.',
  })
  const { effort, ...without } = item('queued')
  assert.deepEqual(plain(page.itemPartsOf(without, false)).map(part => part.key), [])
  // The review: without the model ids in the settings the state gives no model: the part is the effort alone.
  const effortOnly = plain(page.itemPartsOf(item('queued', undefined, null), false))
  assert.deepEqual([effortOnly[0].title, effortOnly[0].model, effortOnly[0].run], ['Effort', null, 'Units is set to low before the step goes to it.'])
  assert.equal(page.effortRunLine(item('in progress', undefined, null), [lane({ level: 'low', model: null, usual: 'medium', usualModel: null, step: 'B7', isSet: true, asked: null })]),
    'Units runs at low until the step ends, then at its usual setting (medium).')
})
