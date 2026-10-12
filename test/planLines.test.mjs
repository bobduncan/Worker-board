import assert from 'node:assert/strict'
import test from 'node:test'

import { parsePlanLine } from '../src/planLines.mjs'

test('parsePlanLine reads a line with a task', () => {
  const parsed = parsePlanLine(JSON.stringify({
    name: 'Units',
    role: 'worker',
    state: 'working',
    task: { text: 'Shadow Beast 4x unit', step: 1, steps: 6, left: 2357972, isReported: false },
    at: 1791791904653,
  }))
  assert.deepEqual(parsed, {
    name: 'Units',
    role: 'worker',
    state: 'working',
    at: 1791791904653,
    task: { text: 'Shadow Beast 4x unit', step: 1, steps: 6, names: null, leftMs: 2357972, since: null, isReported: false, asked: false },
  })
})

test('parsePlanLine reads a line without a task', () => {
  const parsed = parsePlanLine('{"name":"Main","role":"main","state":"waiting","task":null,"at":5}')
  assert.equal(parsed.task, null)
  assert.equal(parsed.state, 'waiting')
})

test('parsePlanLine answers null for a file that is not JSON', () => {
  assert.equal(parsePlanLine('<<<<'), null)
  assert.equal(parsePlanLine(''), null)
})

test('parsePlanLine drops a task without a text and numbers that are not numbers', () => {
  assert.equal(parsePlanLine('{"name":"Units","task":{"step":1}}').task, null)
  const parsed = parsePlanLine('{"name":"Units","task":{"text":"Archer","step":"two","left":"soon"}}')
  assert.deepEqual(parsed.task, { text: 'Archer', step: null, steps: null, names: null, leftMs: null, since: null, isReported: false, asked: false })
  assert.equal(parsePlanLine('{"name":"Units","task":{"text":"Archer","since":1791790000000}}').task.since, 1791790000000)
})
