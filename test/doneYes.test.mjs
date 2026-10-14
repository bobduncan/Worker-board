// B148: a chat whose last answer ends with the closing block's "+ Done:   yes" (CLAUDE.md, part 3) has finished, and
// shows as free, also when it forgot to clear its card. "- Done: no" or "- Done: partly" keep today's reading, and a
// turn that runs is never read as finished. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, fromChat, step, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { parseTail, saysDone } from '../src/transcript.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 14, 10, 7)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

/** An answer to the person, in every chat's form: the words, a rule, and the closing block. */
const closing = (done, words = 'The board is started anew.') => [
  words, '', '---', '', '```diff', '  Prompt: start the board anew', '  Who:    Game - Worker 1', done, '```',
].join('\n')
const YES = '+ Done:   yes'

const entries = lines => parseTail(lines.join('\n'), false)
const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
/** The card the chat recorded and never cleared: a task of two steps, not reported. */
const card = JSON.stringify({ name: 'Worker 1', role: 'worker', state: 'waiting', task: { text: 'Board restart for the user', step: 1, steps: 2, left: 5 * MIN, isReported: false }, at: NOW - 3 * MIN })

function lane(lines, { plan = card } = {}) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Worker 1')],
    tails: { 'cli-Worker 1': { text: lines.join('\n'), isCut: false, modifiedAt: NOW - 2 * MIN } },
    planLineTexts: { 'cli-Worker 1': plan },
    backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config }).chats.find(chat => chat.name === 'Worker 1')
}

const asked = [typed(NOW - 6 * MIN, 'Start the board anew, please.'), step(NOW - 5 * MIN, 'Stop the board'), toolResult(NOW - 4 * MIN)]

// Reading the closing block

test('the last answer says the work is done when its closing block ends with "+ Done:   yes"', () => {
  assert.equal(saysDone(entries([...asked, answer(NOW - 3 * MIN, closing(YES))])), true)
  // However the spaces fall, and with a line ending of Windows.
  assert.equal(saysDone(entries([...asked, answer(NOW - 3 * MIN, closing('+ Done: yes').replace(/\n/g, '\r\n'))])), true)
})

test('"no" and "partly" are not done, and neither are the words without the closing block or before its end', () => {
  for (const done of ['- Done:   no, the board did not answer', '- Done:   partly, the restart waits for the user']) {
    assert.equal(saysDone(entries([...asked, answer(NOW - 3 * MIN, closing(done))])), false, done)
  }
  assert.equal(saysDone(entries([...asked, answer(NOW - 3 * MIN, 'All of it is + Done: yes, I promise.')])), false)
  // A closing block quoted in the middle of an answer that goes on is not its end.
  assert.equal(saysDone(entries([...asked, answer(NOW - 3 * MIN, `${closing(YES)}\n\nAnd one more thing to do.`)])), false)
  assert.equal(saysDone(entries([])), false)
})

test('only the answer that ended the last turn counts: a turn that runs, or an older answer, says nothing', () => {
  const done = answer(NOW - 3 * MIN, closing(YES))
  assert.equal(saysDone(entries([...asked, done, typed(NOW - 2 * MIN, 'One more thing'), step(NOW - MIN, 'Build')])), false)
  assert.equal(saysDone(entries([...asked, done, typed(NOW - 2 * MIN, 'One more thing'), answer(NOW - MIN, closing('- Done:   no, not yet'))])), false)
  // A step of a running turn after it.
  assert.equal(saysDone(entries([...asked, done, step(NOW - MIN, 'Build')])), false)
})

// On the board

test('a worker whose last answer says "Done: yes" is free, whatever the card it forgot to clear still says', () => {
  const worker = lane([...asked, answer(NOW - 3 * MIN, closing(YES))])
  assert.deepEqual([worker.state, worker.task, worker.between, worker.eta], ['free', null, null, null])
})

test('"Done: partly" or "Done: no" keep today\'s reading: the card holds the worker between two turns', () => {
  for (const done of ['- Done:   partly, the restart waits for the user', '- Done:   no, the board did not answer']) {
    const worker = lane([...asked, answer(NOW - 3 * MIN, closing(done))])
    assert.deepEqual([worker.state, worker.task.text, worker.between], ['working', 'Board restart for the user', 'Its turn has ended; its task is not reported yet.'], done)
  }
})

test('a worker that works again after its "Done: yes" works, with its card', () => {
  const worker = lane([...asked, answer(NOW - 3 * MIN, closing(YES)), typed(NOW - 2 * MIN, 'And now the archer.'), step(NOW - MIN, 'Draw the archer')])
  assert.deepEqual([worker.state, worker.task.text], ['working', 'Board restart for the user'])
})

test('"Done: yes" also overrules a command it left running in the background, such as a server it started', () => {
  const left = [...asked, step(NOW - 4 * MIN, 'Start the board', 'Bash'), { ...JSON.parse(toolResult(NOW - 4 * MIN)), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'Command running in background with ID: b1.' }] } }].map(line => (typeof line === 'string' ? line : JSON.stringify(line)))
  assert.deepEqual([lane([...left, answer(NOW - 3 * MIN, closing(YES))], { plan: '' }).state], ['free'])
  const partly = lane([...left, answer(NOW - 3 * MIN, closing('- Done:   partly, the board still starts'))], { plan: '' })
  assert.deepEqual([partly.state, partly.between], ['working', 'Its turn has ended; background work it started is still running.'])
})

test('only what the chat holds itself is overruled: a task the main chat handed over and that is not reported still holds the worker', () => {
  const handed = [fromChat(NOW - 20 * MIN, 'Game - Main', 'Task from Game - Main: backlog step B12, the archer. About 1 h.'), step(NOW - 19 * MIN, 'Draw'), toolResult(NOW - 18 * MIN)]
  const worker = lane([...handed, ...asked, answer(NOW - 3 * MIN, closing(YES))], { plan: '' })
  assert.deepEqual([worker.state, worker.between], ['working', 'Its turn has ended; the task handed to it is not reported yet.'])
})
