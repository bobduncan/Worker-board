// B85: the order chosen in "For you" sorts the requests of the chats and the steps from the backlog alike. The
// page's own code is run here, cut out of board.js between its two marks, with a stand-in for the order control.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = script.slice(script.indexOf('// order:start'), script.indexOf('// order:end'))

/** The page's `ordered`, with the order control set to `order`. */
function orderedBy(order) {
  const context = { $: id => (id === 'needs-order' ? { value: order } : null) }
  vm.runInNewContext(`${cut}\nthis.ordered = ordered`, context)
  // The page's list is made in the other context: copy it into an array of this one, so it can be compared.
  return needs => Array.from(context.ordered(needs), need => need.step ?? need.id)
}

// Steps from the backlog as the server gives them: in the order of the file, without a date.
const steps = [
  { step: 'B03', from: 'Units', at: null },
  { step: 'B61', from: 'Features', at: null },
  { step: 'B12', from: 'Main', at: null },
  { step: 'B72', from: 'Features', at: null },
  { step: 'B40', from: 'Units', at: null },
]

test('the page has the order code between its marks', () => {
  assert.ok(cut.includes('function ordered(needs)') && cut.includes('const newness'))
})

test('newest first: the step with the highest id comes first', () => {
  assert.deepEqual(orderedBy('newest')(steps), ['B72', 'B61', 'B40', 'B12', 'B03'])
})

test('oldest first: the step with the lowest id comes first', () => {
  assert.deepEqual(orderedBy('oldest')(steps), ['B03', 'B12', 'B40', 'B61', 'B72'])
})

test('by worker: the worker the answer goes to, and the newest first within a worker', () => {
  assert.deepEqual(orderedBy('worker')(steps), ['B72', 'B61', 'B12', 'B40', 'B03'])
})

test('a step from before the ids, and a card without a worker, are placed and break nothing', () => {
  const odd = [{ step: null, from: null, at: null, id: 'old' }, { step: 'B05', from: 'Units', at: null }]
  assert.deepEqual(orderedBy('newest')(odd), ['B05', 'old'])
  assert.deepEqual(orderedBy('oldest')(odd), ['old', 'B05'])
  assert.deepEqual(orderedBy('worker')(odd), ['old', 'B05'])
})

test('the requests of the chats keep their order by time', () => {
  const asks = [{ id: 'a', from: 'Units', at: 300 }, { id: 'b', from: 'Features', at: 100 }, { id: 'c', from: 'Units', at: 200 }]
  assert.deepEqual(orderedBy('newest')(asks), ['a', 'c', 'b'])
  assert.deepEqual(orderedBy('oldest')(asks), ['b', 'c', 'a'])
  assert.deepEqual(orderedBy('worker')(asks), ['b', 'a', 'c'])
})

test('the list is not changed in place: the state the page holds keeps the server\'s order', () => {
  const before = steps.map(one => one.step)
  orderedBy('newest')(steps)
  assert.deepEqual(steps.map(one => one.step), before)
})
