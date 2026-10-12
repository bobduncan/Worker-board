import assert from 'node:assert/strict'
import test from 'node:test'

import { changes, lastByChat, parseHistory, taskFacts, today } from '../src/history.mjs'

const MIN = 60_000
const row = (minute, chat, state, task = null, extra = {}) => ({
  at: minute * MIN, chat, state, task, step: null, steps: null, leftMs: null, startedAt: null, source: task === null ? null : 'plan', ...extra,
})
const gap = minute => ({ at: minute * MIN, gap: true })
const seen = (name, state, task = null) => ({ name, state, task })
const plan = (text, extra = {}) => ({ text, step: null, steps: null, leftMs: null, startedAt: null, source: 'plan', ...extra })

test('parseHistory reads the lines, the gaps too, and skips what does not parse', () => {
  const text = [JSON.stringify(row(1, 'Units', 'working')), '{ broken', JSON.stringify(gap(2)), '{"chat":"no time"}', ''].join('\r\n')
  assert.deepEqual(parseHistory(text), [row(1, 'Units', 'working'), gap(2)])
})

test('lastByChat: the last line of each chat, and nothing from before a gap', () => {
  const last = lastByChat([row(1, 'Units', 'working'), row(2, 'Main', 'free'), row(3, 'Units', 'free')])
  assert.equal(last.get('Units').state, 'free')
  assert.equal(last.get('Main').at, 2 * MIN)
  assert.equal(lastByChat([row(1, 'Units', 'working'), gap(2)]).size, 0)
})

test('changes: a chat seen for the first time is recorded', () => {
  assert.deepEqual(changes(new Map(), [seen('Units', 'working', plan('Archer', { step: 1, steps: 4, leftMs: 9 }))], 5 * MIN), [
    { at: 5 * MIN, chat: 'Units', state: 'working', task: 'Archer', step: 1, steps: 4, leftMs: 9, startedAt: null, source: 'plan', by: null },
  ])
})

test('changes: nothing is recorded while nothing changed', () => {
  const last = lastByChat([row(1, 'Units', 'working', 'Archer', { step: 1, leftMs: 500 })])
  assert.deepEqual(changes(last, [seen('Units', 'working', plan('Archer', { step: 1, leftMs: 400 }))], 5 * MIN), [])
})

test('changes: a new state, a new task, a new step and a first estimate are each recorded', () => {
  const last = lastByChat([row(1, 'Units', 'working', 'Archer', { step: 1 })])
  const record = task => changes(last, [seen('Units', task === null ? 'free' : 'working', task)], 5 * MIN).length
  assert.equal(record(null), 1)
  assert.equal(changes(last, [seen('Units', 'waiting', plan('Archer', { step: 1 }))], 5 * MIN).length, 1)
  assert.equal(record(plan('Knight', { step: 1 })), 1)
  assert.equal(record(plan('Archer', { step: 2 })), 1)
  assert.equal(record(plan('Archer', { step: 1, leftMs: 600 })), 1)
})

test('today: one lane per chat, cut to the window and closed at its end', () => {
  const lines = [
    row(-30, 'Units', 'free'),
    row(10, 'Units', 'working', 'Archer'),
    row(40, 'Units', 'waiting', 'Archer'),
    row(20, 'Main', 'working'),
  ].sort((a, b) => a.at - b.at)
  assert.deepEqual(today(lines, { from: 0, to: 60 * MIN, names: ['Main', 'Units', 'Levels'] }), [
    { chat: 'Main', spans: [{ from: 20 * MIN, to: 60 * MIN, state: 'working', task: null }] },
    { chat: 'Units', spans: [
      { from: 0, to: 10 * MIN, state: 'free', task: null },
      { from: 10 * MIN, to: 40 * MIN, state: 'working', task: 'Archer' },
      { from: 40 * MIN, to: 60 * MIN, state: 'waiting', task: 'Archer' },
    ] },
    { chat: 'Levels', spans: [] },
  ])
})

test('today: a gap ends every lane until the chat is seen again, and equal neighbours become one span', () => {
  const lines = [row(5, 'Units', 'working', 'Archer'), row(8, 'Units', 'working', 'Archer', { step: 2 }), gap(20), row(45, 'Units', 'free')]
  assert.deepEqual(today(lines, { from: 0, to: 60 * MIN, names: ['Units'] })[0].spans, [
    { from: 5 * MIN, to: 20 * MIN, state: 'working', task: 'Archer' },
    { from: 45 * MIN, to: 60 * MIN, state: 'free', task: null },
  ])
})

test('taskFacts: when the task was first seen, its first estimate, and the time spent waiting', () => {
  const lines = [
    row(0, 'Units', 'working', 'Knight'),
    row(10, 'Units', 'working', 'Archer'),
    row(12, 'Units', 'working', 'Archer', { step: 1, leftMs: 90 * MIN }),
    row(30, 'Units', 'waiting', 'Archer', { step: 1, leftMs: 70 * MIN }),
    row(45, 'Units', 'working', 'Archer', { step: 2, leftMs: 60 * MIN }),
    row(50, 'Main', 'waiting', 'Archer'),
  ]
  assert.deepEqual(taskFacts(lines, 'Units', 'Archer', 60 * MIN), {
    firstSeenAt: 10 * MIN,
    startedAt: null,
    firstEstimate: { at: 12 * MIN, leftMs: 90 * MIN },
    waitedMs: 15 * MIN,
  })
})

test('taskFacts: an earlier task of the same name is another task, and a recorded hand-over is kept', () => {
  const lines = [
    row(0, 'Units', 'working', 'Archer'),
    row(10, 'Units', 'free'),
    row(20, 'Units', 'working', 'Archer', { startedAt: 18 * MIN, source: 'handover' }),
    row(25, 'Units', 'waiting', 'Archer', { startedAt: 18 * MIN, source: 'handover' }),
  ]
  const facts = taskFacts(lines, 'Units', 'Archer', 30 * MIN)
  assert.equal(facts.firstSeenAt, 20 * MIN)
  assert.equal(facts.startedAt, 18 * MIN)
  assert.equal(facts.firstEstimate, null)
  assert.equal(facts.waitedMs, 5 * MIN)
})

test('taskFacts: the time the board was off is not counted as waiting, and a task never recorded has no facts', () => {
  const lines = [row(0, 'Units', 'waiting', 'Archer'), gap(4), row(50, 'Units', 'waiting', 'Archer')]
  assert.equal(taskFacts(lines, 'Units', 'Archer', 60 * MIN).firstSeenAt, 0)
  assert.equal(taskFacts(lines, 'Units', 'Archer', 60 * MIN).waitedMs, 14 * MIN)
  assert.equal(taskFacts(lines, 'Units', 'Knight', 60 * MIN), null)
  assert.equal(taskFacts([], 'Units', 'Archer', 60 * MIN), null)
})
