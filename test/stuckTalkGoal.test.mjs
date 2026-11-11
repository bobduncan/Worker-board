// The stuck-talk fix (chat 1, 2026-11-11): P4b showed a FALSE "No answer since 00:17 ... ask Product owner in its chat" on the live G64 talk, and listed
// the G60 talk in state.stuckTalks, although the person's answer was taken and the goal moved on. A talk's next stage is also the goal's own stage
// passing the question's stage (the real G64 case: the answer "the how fits" came after Go), and a talk whose goal is done or no longer the focus is
// never stuck. Both live cases are real records, read-only copies in fixtures/p4b: the thread files, a slice of goals.md and the outbox lines.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { brainstormsState } from '../src/brainstorm.mjs'
import { parseGoals } from '../src/goals.mjs'
import { foldOutbox } from '../src/store.mjs'
import { wordJudge } from '../src/supervisor/index.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { stuckTalksOf, waitsOf } from '../src/waitLine.mjs'

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'p4b')
const read = name => readFile(join(FIX, name), 'utf8')
const [goalsText, unitsText, mapsText, outboxText] = await Promise.all([read('goals-slice.md'), read('thread-g64-units.md'), read('thread-g60-maps.md'), read('outbox.jsonl')])
const UNITS = '.claude/brainstorms/2026-11-10-how-we-build-good-units.md'
const MAPS = '.claude/brainstorms/2026-10-31-how-we-build-good-maps.md'
const outbox = foldOutbox(outboxText)
const unitsWord = outbox.find(word => word.id === 'c3b0a2c5a3fbc6a8')
const mapsWord = outbox.find(word => word.id === 'a6bcaed875f02871')
const threads = brainstormsState([{ path: UNITS, text: unitsText, at: 1 }, { path: MAPS, text: mapsText, at: 2 }], '.claude/brainstorms').threads
const keep = buildView({ state: { chats: [], chatPrefix: '' }, outbox: [], settings: {}, now: unitsWord.at }).keep
const lane = { name: 'Product owner', isRunning: true, status: 'Free', state: 'free', task: null, report: null, wake: null }

/** The state the board builds for these: the goal map slice, the focus as the map names it, the threads. */
const stateOf = ({ goals = goalsText, focus = 'G64' } = {}) => ({ chats: [], supervisorChat: null, advisor: lane, goals: parseGoals(goals), focus: focus === null ? null : { id: focus }, brainstorms: { threads } })
function lineOf(state, word, now) {
  // The chat's turn on the word ended 12 s after it was typed (the real answeredAt), and it is at rest.
  const report = { state: 'idle', since: word.answeredAt, background: false, run: 1, seq: 1, busyAt: null, word: word.id, turn: word.takenAt, at: now - 2000 }
  const judge = wordJudge({ state, items: new Map(), outbox: [word], settings: {}, now })
  return waitsOf({ state, outbox: [word], now, keep, judge, reports: new Map([['Product owner', report]]), items: new Map() })[word.id]
}

test('the real G64 case: the answer "the how fits" came after Go: the goal\'s stage has passed the question, so the line is Done, never Late, and the talk is not stuck', () => {
  const now = unitsWord.answeredAt + 6 * 60_000
  const line = lineOf(stateOf(), unitsWord, now)
  assert.deepEqual([line.state, line.rest], ['done', 'the goal moved on'])
  assert.deepEqual(stuckTalksOf({ state: stateOf(), outbox, now: unitsWord.at + 50 * 3600_000 }).filter(one => one.path === UNITS), [])
  // The control: with no stage stamps on the goal (the goal before its agreed lines) the same word is the live false Late of the board.
  const before = goalsText.replace(/^ {2}Goal definition agreed: .*\n/m, '').replace(/^ {2}How agreed: .*\n/m, '')
  assert.notEqual(before, goalsText)
  assert.equal(lineOf(stateOf({ goals: before }), unitsWord, now).state, 'late')
  assert.equal(stuckTalksOf({ state: stateOf({ goals: before }), outbox, now: unitsWord.at + 50 * 3600_000 }).filter(one => one.path === UNITS).length, 1)
})

test('the real G60 case: its goal is done and no longer the focus: the talk is not in stuckTalks', () => {
  const now = mapsWord.at + 50 * 3600_000
  assert.deepEqual(stuckTalksOf({ state: stateOf(), outbox, now }).filter(one => one.path === MAPS), [])
  // The goal done is enough, and so is a goal that is not the focus any more while it is still open.
  const open = goalsText.replace('- [x] G60', '- [ ] G60')
  assert.notEqual(open, goalsText)
  assert.deepEqual(stuckTalksOf({ state: stateOf({ goals: open, focus: 'G64' }), outbox, now }).filter(one => one.path === MAPS), [], 'open but not the focus')
  assert.equal(stuckTalksOf({ state: stateOf({ goals: open, focus: 'G60' }), outbox, now }).filter(one => one.path === MAPS).length, 1, 'open and the focus: the talk is stuck as before')
  assert.equal(stuckTalksOf({ state: stateOf({ goals: open, focus: null }), outbox, now }).filter(one => one.path === MAPS).length, 0, 'no focus at all: not the focus')
})
