// B468: the time and tokens spent per effort level, so the levels can be tuned later. The board measures each task from
// the worker's take to its report (B185, B301); with it now the step's effort when it was taken, the effort most of its
// answers ran at, and the tokens they took, each message once. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { line, typed } from '../fixtures/lines.mjs'
import { parseTail } from '../src/transcript.mjs'
import { freshScan, listText, taskTimesOf, tokensOf, tokensText, walk } from '../src/taskTimes.mjs'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 21, 9, 0)
const at = minutes => T0 + minutes * MIN
const iso = time => new Date(time).toISOString()
const usage = (output, cacheRead = 1000) => ({ input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: cacheRead, output_tokens: output })

/** An answer of the worker with its message id, tokens and effort; the app writes a message's tokens on each line. */
const answers = (time, id, tokens, effort, content, stop = 'tool_use') => line({
  type: 'assistant', timestamp: iso(time), effort, message: { id, role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, usage: tokens, content },
})
const works = (time, id, input, tokens, effort = 'low') => answers(time, id, tokens, effort, [{ type: 'tool_use', id: `t-${id}`, name: 'mcp__a-mod__work', input }])
const STEPS = { B301: { area: 'board', estimateMin: 60, effort: 'low' }, B302: { area: 'board', estimateMin: 30, effort: 'high' } }

test('a task keeps its step\'s effort, the effort its answers ran at, and their tokens, each message once', () => {
  const lines = [
    typed(at(0), 'work: B301 is yours; run work next'),
    works(at(0), 'm1', { action: 'take', id: 'B301', branch: 'b' }, usage(50)),
    // One message written as two lines: its tokens count once.
    answers(at(2), 'm2', usage(300), 'low', [{ type: 'text', text: 'Reading.' }]),
    answers(at(2), 'm2', usage(300), 'low', [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } }]),
    answers(at(5), 'm3', usage(200), 'xhigh', [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }]),
    works(at(9), 'm4', { action: 'report', id: 'B301', result: 'done' }, usage(80)),
    answers(at(10), 'm5', usage(999), 'low', [{ type: 'text', text: 'Done.' }], 'end_turn'),
  ]
  const [task] = walk(parseTail(lines.join('\n'), false), freshScan('Units'), id => STEPS[id] ?? null)
  assert.equal(task.effort, 'low')
  assert.equal(task.ranOn, 'low')
  // From the take to the report: m1 to m4, m2 once; m5 came after the report.
  assert.deepEqual(task.tokens, { input: 8, cacheWrite: 400, cacheRead: 4000, output: 630 })
  assert.equal(tokensOf(task.tokens), 5038)
})

test('the review: a message whose lines say more tokens later counts its largest figures once', () => {
  const lines = [
    works(at(0), 'm1', { action: 'take', id: 'B302', branch: 'b' }, usage(10), 'high'),
    answers(at(1), 'm2', usage(100), 'high', [{ type: 'text', text: 'Part.' }]),
    answers(at(1), 'm2', usage(300), 'high', [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } }]),
    answers(at(1), 'm2', usage(300), 'high', [{ type: 'text', text: 'Again.' }]),
    works(at(2), 'm3', { action: 'report', id: 'B302', result: 'done' }, usage(20), 'high'),
  ]
  const [task] = walk(parseTail(lines.join('\n'), false), freshScan('Units'), id => STEPS[id] ?? null)
  assert.deepEqual(task.tokens, { input: 6, cacheWrite: 300, cacheRead: 3000, output: 330 })
  assert.deepEqual([task.effort, task.ranOn], ['high', 'high'])
  // What the walk keeps between reads stays plain JSON.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(task)))
})

test('the board keeps per effort level how many tasks, their typical time and tokens', () => {
  const task = (step, effort, workMin, output, ranOn = effort) => ({ step, steps: [step], worker: 'Units', area: 'board', estimateMin: 60, startedAt: at(workMin), reportedAt: at(workMin + 100), workMs: workMin * MIN, effort, ranOn, tokens: { input: 0, cacheWrite: 0, cacheRead: output * 10, output } })
  const tasks = [
    task('B1', 'low', 10, 1000), task('B2', 'low', 20, 3000, 'xhigh'), task('B3', 'high', 60, 20_000),
    // Measured before B468: no effort, no tokens; left out of the levels.
    { step: 'B4', steps: ['B4'], worker: 'Units', area: 'board', estimateMin: 60, startedAt: at(0), reportedAt: at(1), workMs: 30 * MIN },
  ]
  const times = taskTimesOf(tasks)
  assert.deepEqual(times.efforts, [
    { level: 'low', count: 2, typicalMin: 15, tokens: 22_000, output: 2000, ranOther: 1, isEnough: false },
    { level: 'high', count: 1, typicalMin: 60, tokens: 220_000, output: 20_000, ranOther: 0, isEnough: false },
  ])
  const text = listText(tasks, at(200))
  assert.match(text, /## Per effort level/)
  assert.match(text, /\| low \| 2 \| 15 min \(too few tasks to go by\) \| 22 k \| 2 k \| 1 \|/)
  assert.match(text, /\| high \| 1 \| 1 h \(too few tasks to go by\) \| 220 k \| 20 k \| 0 \|/)
  // Before any task with an effort, the list has no such part.
  assert.doesNotMatch(listText(tasks.slice(3), at(200)), /Per effort level/)
  assert.deepEqual([tokensText(850), tokensText(12_400), tokensText(3_456_000), tokensText(null)], ['850', '12 k', '3.5 M', '–'])
})
