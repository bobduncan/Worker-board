// B93: an answered card stays in sight until its answer was typed into its chat, and a little after. The page's own
// code is run here, cut out of board.js between its two marks.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = script.slice(script.indexOf('// closed:start'), script.indexOf('// closed:end'))
const page = {}
vm.runInNewContext(`${cut}\nthis.isClosed = isClosed; this.isAnswered = isAnswered`, page)

const MIN = 60_000
const NOW = 1_000 * MIN
const need = answer => ({ id: 'x', isClosed: false, answer })
const answer = (state, more = {}) => ({ at: NOW - 10 * MIN, verdict: 'approve', text: '', state, ...more })

test('a card whose answer waits for its chat, or was handed to it, stays in sight and counts as answered', () => {
  for (const state of ['waiting', 'taken']) {
    assert.equal(page.isClosed(need(answer(state)), NOW), false)
    assert.equal(page.isAnswered(need(answer(state))), true)
  }
})

test('a card whose answer was typed into its chat stays for two more minutes, then it is closed', () => {
  assert.equal(page.isClosed(need(answer('delivered', { deliveredAt: NOW - MIN })), NOW), false)
  assert.equal(page.isClosed(need(answer('delivered', { deliveredAt: NOW - 3 * MIN })), NOW), true)
  // An answer from before the board noted the time: its own time counts.
  assert.equal(page.isClosed(need(answer('delivered')), NOW), true)
})

test('an answer that did not arrive opens its card again; a ticked step is closed whatever was answered', () => {
  for (const state of ['expired', 'failed']) {
    assert.equal(page.isClosed(need(answer(state)), NOW), false)
    assert.equal(page.isAnswered(need(answer(state))), false)
  }
  assert.equal(page.isClosed({ id: 'x', isClosed: true, answer: null }, NOW), true)
  assert.equal(page.isClosed(need(null), NOW), false)
  assert.equal(page.isAnswered(need(null)), false)
})
