// B93, B307: an answered card leaves Needs your attention at once; with "Show closed" ticked it stands among the
// closed ones in its answered look. The page's own code is run here, cut out of board.js between its two marks.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = script.slice(script.indexOf('// closed:start'), script.indexOf('// closed:end'))
const page = {}
vm.runInNewContext(`${cut}\nthis.isClosed = isClosed; this.isAnswered = isAnswered; this.shownNeeds = shownNeeds; this.needLook = needLook`, page)

const MIN = 60_000
const NOW = 1_000 * MIN
const need = (answer, id = 'x') => ({ id, isClosed: false, answer })
const answer = (state, more = {}) => ({ at: NOW - 10 * MIN, verdict: 'approve', text: '', state, ...more })
const ids = needs => needs.map(one => one.id)

test('an answered card is closed at once, wherever its answer is', () => {
  for (const state of ['waiting', 'taken', 'copied', 'delivered']) {
    assert.equal(page.isClosed(need(answer(state, { deliveredAt: NOW }))), true, state)
    assert.equal(page.isAnswered(need(answer(state))), true, state)
  }
})

test('with Show closed off an answered card is not drawn; a lost answer brings its card back', () => {
  const needs = [need(null, 'open'), need(answer('waiting'), 'answered'), need(answer('delivered', { deliveredAt: NOW }), 'typed'), need(answer('failed'), 'lost'), { id: 'ticked', isClosed: true, answer: null }]
  assert.deepEqual(ids(page.shownNeeds(needs, false)), ['open', 'lost'])
})

test('with Show closed on an answered card is drawn in its answered look, a ticked one as closed, a lost one open', () => {
  const needs = [need(null, 'open'), need(answer('waiting'), 'answered'), need(answer('expired'), 'lost'), { id: 'ticked', isClosed: true, answer: null }]
  assert.deepEqual(ids(page.shownNeeds(needs, true)), ['open', 'answered', 'lost', 'ticked'])
  assert.deepEqual(needs.map(page.needLook), ['', ' is-answered', '', ' is-closed'])
})

test('an answer that did not arrive opens its card again; a ticked step is closed whatever was answered', () => {
  for (const state of ['expired', 'failed']) {
    assert.equal(page.isClosed(need(answer(state))), false)
    assert.equal(page.isAnswered(need(answer(state))), false)
  }
  assert.equal(page.isClosed({ id: 'x', isClosed: true, answer: null }), true)
  assert.equal(page.isClosed(need(null)), false)
  assert.equal(page.isAnswered(need(null)), false)
})

test('Needs your attention draws through shownNeeds and needLook, and no card waits a while after it was typed', () => {
  // (Calm panel: `needs`, the asks with the backlog's among them.)
  assert.match(script, /const shown = ordered\(shownNeeds\(needs, showsClosed\(\)\)/)
  assert.match(script, /const card = el\('article', `need is-\$\{need\.kind\}\$\{isStep\(need\) \? ' is-step' : ''\}\$\{needLook\(need\)\}`\)/)
  assert.ok(!script.includes('SHOWN_AFTER_TYPED_MS'))
})
