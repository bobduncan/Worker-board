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
    compaction: null,
    task: { text: 'Shadow Beast 4x unit', step: 1, steps: 6, names: null, leftMs: 2357972, stepLeftMs: null, since: null, isReported: false, asked: false },
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
  assert.deepEqual(parsed.task, { text: 'Archer', step: null, steps: null, names: null, leftMs: null, stepLeftMs: null, since: null, isReported: false, asked: false })
  assert.equal(parsePlanLine('{"name":"Units","task":{"text":"Archer","since":1791790000000}}').task.since, 1791790000000)
})

test('B210: a card a chat wrote itself reads as the mod\'s card: minutes for the times, the file\'s time when it gives none', async () => {
  const { ownCard, ownCardKey } = await import('../src/planLines.mjs')
  assert.deepEqual([ownCardKey('Worker 1'), ownCardKey('Levels / Environment'), ownCardKey('  ')], ['worker-1', 'levels-environment', ''])
  const card = parsePlanLine(ownCard(JSON.stringify({ name: 'Worker 1', role: 'worker', state: 'working', task: { text: 'Draw the shop', names: ['Read', 'Draw', 'Report'], step: 2, minutes: 30, stepMinutes: 10 } }), 1_000))
  assert.deepEqual([card.at, card.state, card.task.text, card.task.steps, card.task.step, card.task.leftMs, card.task.stepLeftMs], [1_000, null, 'Draw the shop', 3, 2, 30 * 60_000, 10 * 60_000])
  // The mod's own fields stand as they are; its time wins over the file's.
  const same = parsePlanLine(ownCard(JSON.stringify({ task: { text: 'X', left: 5_000, stepLeft: 1_000, steps: 4 }, at: 7 }), 1_000))
  assert.deepEqual([same.at, same.task.leftMs, same.task.stepLeftMs, same.task.steps], [7, 5_000, 1_000, 4])
  assert.equal(ownCard('not json', 1), null)
  assert.equal(ownCard('[]', 1), null)
})

test('B235: the card says whether the Workers mod compacted the chat after its report, or why not; the newer counts', () => {
  const card = more => parsePlanLine(JSON.stringify({ name: 'Worker 1', task: null, at: 1, ...more })).compaction
  assert.equal(card({}), null)
  assert.deepEqual(card({ compacted: { at: 5000, before: 820000, after: 95000 } }), { kind: 'compacted', at: 5000, before: 820000, after: 95000 })
  assert.deepEqual(card({ compactNote: { at: 6000, why: '  below the size  ' } }), { kind: 'skipped', at: 6000, why: 'below the size' })
  assert.equal(card({ compacted: { at: 5000, before: 1, after: 1 }, compactNote: { at: 6000, why: 'turn still running' } }).kind, 'skipped')
  assert.equal(card({ compacted: { at: 7000, before: 1, after: 1 }, compactNote: { at: 6000, why: 'x' } }).kind, 'compacted')
  assert.equal(card({ compacted: { at: '2026-10-14T16:40:00Z', before: 10, after: 5 } }).at, Date.parse('2026-10-14T16:40:00Z'))
  assert.equal(card({ compactNote: { at: 6000, why: '' } }), null)
})
