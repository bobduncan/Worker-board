// F48 (Worker 5 found it): a start word counts as on its way until the worker is really heard after it. A kept report that a board start
// moved forward (`at` the start, `heardAt` when it was really heard) is no answer to a word sent before that start, or the board
// asks for the same worker again.

import assert from 'node:assert/strict'
import test from 'node:test'

import { workerStart } from '../../src/work/handOut.mjs'

const NOW = 1_000_000_000
const HEARD = NOW - 20 * 60_000
const WORD = NOW - 8 * 60_000
const BOARD_START = NOW - 4 * 60_000
const lane = report => ({ name: 'Worker 1', state: 'off', isRunning: false, offSince: HEARD, report })
const asked = report => workerStart({
  ready: [{ id: 'B1', keptFor: null, pinned: null }], gives: [], idle: [], maxWorkers: 5, items: new Map(), now: NOW, prefix: '', refused: [],
  sent: [{ id: 'w1', command: 'start', about: 'Worker 1', at: WORD, state: 'delivered' }], lanes: [lane(report)],
})

test('a kept report a board start moved past the word is no answer to it: the start stays on its way', () => {
  assert.equal(asked({ at: BOARD_START, heardAt: HEARD }), null)
})

test('the same report, not moved: the start stays on its way', () => {
  assert.equal(asked({ at: HEARD }), null)
})

test('a real report after the word answers it: the worker may be started again', () => {
  assert.deepEqual(asked({ at: BOARD_START }), { start: 'Worker 1' })
  assert.deepEqual(asked({ at: BOARD_START, heardAt: BOARD_START }), { start: 'Worker 1' })
})
