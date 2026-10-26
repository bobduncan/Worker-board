// B301, 2026-10-26: the warning "<chat> wrote questions in its chat but filed no ask" goes by itself when it is stale.
// Seen live: Worker 5's card stood 17 h 01 min under Needs your attention. It stays as long as the chat's last answer
// ends with a "For you" block and no ask was filed, so for a chat that has had no turn since (here: one the board's
// list does not hold, whose mod never files its asks) it stayed for ever. The person: "remove this", "it seems stale".
// The answer it is about is older than the setting `unfiledAskHours` (2 unless set): not shown at all, no card, no
// count. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.UTC(2026, 9, 26, 12, 0)
const PROJECT = 'C:\\garden'

const ASKS = [
  '**Task:** dig the beds',
  '**What I did:** dug them.',
  '',
  '> **For you**',
  '> 1. **Answer:** Deep enough? I advise yes.',
  '',
  '---',
  '',
  '```diff',
  '  Prompt: dig the beds',
  '  Who:    Garden · Digger',
  '- Done:   partly, waiting for your answer',
  '```',
].join('\n')

// The app's line for a chat that ended its turn with a finished answer, as warningsSeeAsks.test.mjs has it.
const app = (name, lastActivityAt) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt, lastAssistantUuid: 'u-1',
  postTurnSummary: { status_category: 'completed', status_detail: 'done', needs_action: '', summarizes_uuid: 'u-1' },
})

/** Digger's last answer ends with a "For you" block and was written `ageMs` before now; no ask was filed. */
function build(ageMs, settings = {}, words = ASKS) {
  const config = { ...parseConfig(JSON.stringify(settings), {}), project: PROJECT }
  const at = NOW - ageMs
  const tail = { text: [typed(at - 10 * MIN, 'Dig the beds'), answer(at, words)].join('\n'), isCut: false, modifiedAt: at }
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}',
    appChatTexts: [app('Lead', NOW - 5 * MIN), app('Digger', at)],
    tails: { 'cli-Lead': { text: [typed(NOW - 20 * MIN, 'Report'), answer(NOW - 10 * MIN, 'All quiet.')].join('\n'), isCut: false, modifiedAt: NOW }, 'cli-Digger': tail },
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
}
const warnings = state => state.forYou.filter(need => need.kind === 'unfiled')
const digger = state => state.chats.find(one => one.name === 'Digger')

test('an answer 1 h old that asks in a "For you" block and filed no ask still warns', () => {
  const state = build(HOUR)
  const [warning] = warnings(state)
  assert.deepEqual([warnings(state).length, warning.from, warning.title, warning.talk], [1, 'Digger', 'Digger wrote questions in its chat but filed no ask', 'window'])
  assert.equal(warning.at, NOW - HOUR)
  assert.equal(digger(state).unfiled.at, NOW - HOUR)
})

test('an answer 3 h old is not shown at all: no card under Needs your attention, nothing counted, and the lane carries none', () => {
  const state = build(3 * HOUR)
  assert.deepEqual(warnings(state), [])
  assert.equal(state.forYou.length, 0)
  assert.equal(digger(state).unfiled, null)
})

test('the edge is 2 h unless set: exactly 2 h still warns, a millisecond older does not', () => {
  assert.equal(warnings(build(2 * HOUR)).length, 1)
  assert.equal(warnings(build(2 * HOUR + 1)).length, 0)
})

test('the setting unfiledAskHours moves the edge, in either direction', () => {
  // Stricter: 1 h old, edge half an hour.
  assert.equal(warnings(build(HOUR, { unfiledAskHours: 0.5 })).length, 0)
  // Looser: 3 h old, edge 4 hours; and 17 h old with a day.
  assert.equal(warnings(build(3 * HOUR, { unfiledAskHours: 4 })).length, 1)
  assert.equal(warnings(build(17 * HOUR, { unfiledAskHours: 24 })).length, 1)
  assert.equal(warnings(build(25 * HOUR, { unfiledAskHours: 24 })).length, 0)
})

test('a setting that is no number above 0 leaves the edge at 2 h', () => {
  for (const bad of [0, -3, 'soon', null]) {
    assert.equal(warnings(build(HOUR, { unfiledAskHours: bad })).length, 1, `1 h old, setting ${JSON.stringify(bad)}`)
    assert.equal(warnings(build(3 * HOUR, { unfiledAskHours: bad })).length, 0, `3 h old, setting ${JSON.stringify(bad)}`)
  }
})

test('a stale answer is not read as a question either: the chat is free and nothing waits', () => {
  const state = build(3 * HOUR)
  assert.equal(digger(state).state, 'free')
  assert.equal(state.counts.waiting, 0)
})
