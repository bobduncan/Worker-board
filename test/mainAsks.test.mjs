// B290: the main chat stands under Needs your attention only when it asks the person something: its last answer ends
// with a "For you" block (or it asked with the app's question form). The app counts the main chat as waiting after every
// answer; a plain report asks nothing. The person, 2026-10-17, of "What you decide on · its answer of 09:35" over a
// plain report: "I dont see a question. or its not clear what you want". Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, assistant, text, tool, typed } from '../fixtures/lines.mjs'
import { asksAtEnd } from '../src/handover.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 17, 10, 0)
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }

// The app's own line after the main chat's every answer: it needs the person.
const app = (name, isBlocked) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
  ...(isBlocked ? { postTurnSummary: { status_category: 'blocked', status_detail: 'reported', needs_action: 'Read the report', summarizes_uuid: 'u-1' } } : {}),
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })

function build(lead, { card = null, digger = 'Which bed first, A or B?' } = {}) {
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}',
    appChatTexts: [app('Lead', true), app('Digger', true)],
    tails: { 'cli-Lead': tail(lead), 'cli-Digger': tail([typed(NOW - 30 * MIN, 'Dig'), answer(NOW - 20 * MIN, digger)]) },
    planLineTexts: card === null ? {} : { 'cli-Lead': JSON.stringify({ name: 'x', role: 'main', state: 'working', task: { text: card, isReported: false }, at: NOW - 30 * MIN }) },
    backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
}
const mainNeed = state => state.forYou.find(one => one.from === 'Lead') ?? null
const lead = state => state.chats.find(one => one.name === 'Lead')

const REPORT = 'The hedge is planted and merged. Digger takes the pond next.\n\n---\n\n```diff\n  Prompt: plant the hedge\n  Who:    Garden · Lead\n+ Done:   yes\n```'
const ASKS = [
  'The hedge is planted.',
  '',
  '> **For you**',
  '> 1. **Answer:** Pond next? I advise yes.',
  '> 2. **Do:** water the hedge tonight.',
  '',
  '---',
  '',
  '```diff',
  '  Prompt: plant the hedge',
  '  Who:    Garden · Lead',
  '- Done:   partly, waiting for your answer',
  '```',
].join('\n')

test('a plain report of the main chat asks nothing: not under Needs your attention, and the main chat does not wait for you', () => {
  const state = build([typed(NOW - 20 * MIN, 'How is the hedge?'), answer(NOW - 10 * MIN, REPORT)])
  assert.equal(mainNeed(state), null)
  assert.equal(lead(state).state, 'free')
  assert.equal(state.mainTalk.state, 'free')
  assert.equal(state.counts.waiting, 1, 'only the worker waits')
  // Its own card, kept after an answer that is partly done, does not make it look busy: it reports to nobody.
  const partly = REPORT.replace('+ Done:   yes', '- Done:   partly, the pond is next')
  const kept = build([typed(NOW - 20 * MIN, 'How is the hedge?'), answer(NOW - 10 * MIN, partly)], { card: 'Plant the hedge' })
  assert.deepEqual([lead(kept).state, kept.mainTalk.state, mainNeed(kept)], ['free', 'free', null])
})

test('a "For you" block quoted earlier in a plain report asks nothing; one written a little off at the end still asks', () => {
  const quoted = ['Digger asked:', '', '> **For you**', '> 1. **Answer:** Bed A or B?', '', 'You answered A; it is planted.', '', '---', '', '```diff', '  Prompt: the beds', '  Who:    Garden · Lead', '+ Done:   yes', '```'].join('\n')
  assert.equal(asksAtEnd(quoted), false)
  assert.equal(mainNeed(build([typed(NOW - 20 * MIN, 'Beds?'), answer(NOW - 10 * MIN, quoted)])), null)
  const slip = 'The hedge is planted.\n\n> **For you:**\n> 1. Answer: pond next?\n\n---\n\n```diff\n  Prompt: x\n- Done:   partly\n```'
  assert.equal(asksAtEnd(slip), true)
  assert.notEqual(mainNeed(build([typed(NOW - 20 * MIN, 'Next?'), answer(NOW - 10 * MIN, slip)])), null)
  // Its own block after a quoted one: the questions are its own.
  const both = ['Digger asked:', '', '> **For you**', '> 1. **Answer:** Bed A or B?', '', 'Planted A.', '', '> **For you**', '> 1. **Answer:** Pond next? I advise yes.'].join('\n')
  assert.deepEqual(mainNeed(build([typed(NOW - 20 * MIN, 'Beds?'), answer(NOW - 10 * MIN, both)])).waits.handover.items.map(item => item.ask), ['Pond next? I advise yes.'])
})

test('a "For you" block at the end of its answer stands there, with that block\'s items as the questions', () => {
  const state = build([typed(NOW - 20 * MIN, 'How is the hedge?'), answer(NOW - 10 * MIN, ASKS)])
  const need = mainNeed(state)
  assert.equal(need.title, 'Lead needs your answer')
  assert.deepEqual(need.waits.handover.items.map(item => [item.n, item.kind, item.ask]), [[1, 'answer', 'Pond next? I advise yes.'], [2, 'do', 'water the hedge tonight.']])
  assert.equal(lead(state).state, 'waiting')
})

test('a question in the app\'s own form is a question too, answered in its chat', () => {
  const form = assistant(NOW - 9 * MIN, 'tool_use', [text('One choice.'), tool('AskUserQuestion', { questions: [{ question: 'Pond or bed?', options: [{ label: 'Pond' }, { label: 'Bed' }] }] })])
  const need = mainNeed(build([typed(NOW - 20 * MIN, 'Next?'), form]))
  assert.equal(need.canAnswer, false)
})

test('a worker that waits is shown as before, with or without a "For you" block', () => {
  const state = build([typed(NOW - 20 * MIN, 'How is the hedge?'), answer(NOW - 10 * MIN, REPORT)])
  assert.equal(state.forYou.find(one => one.from === 'Digger')?.title, 'Needs your decision')
  const finished = build([typed(NOW - 20 * MIN, 'How is the hedge?'), answer(NOW - 10 * MIN, REPORT)], { digger: '**Task:** dig the beds\n**What I did:** dug them.\n\n> **For you**\n> 1. **Answer:** Deep enough?' })
  assert.equal(finished.forYou.find(one => one.from === 'Digger')?.title, 'Finished: dig the beds')
})
