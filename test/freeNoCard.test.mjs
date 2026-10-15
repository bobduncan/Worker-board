// B148, second part: a lane read as free does not show the card its chat left behind as current work. The user,
// 2026-10-14 at 10:14, of Units shown as "Free" beside "Record the warrior verdict · 1/3 ... 22 min over its first
// estimate": "units worker is in an incorrect state". Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 14, 10, 14)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const summary = (category, needs = '') => ({ postTurnSummary: { status_category: category, status_detail: 'x', needs_action: needs, summarizes_uuid: 'u-1' } })
const app = (name, more = {}) => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1', ...more,
})
/** The card Units left behind: a task of three steps, not reported, long over its first estimate. */
const card = JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: { text: 'Record the warrior verdict', step: 1, steps: 3, left: 2 * MIN, stepLeft: 2 * MIN, isReported: false, since: NOW - 60 * MIN }, at: NOW - 30 * MIN })
const closing = done => `The verdict is recorded.\n\n---\n\n\`\`\`diff\n  Prompt: the warrior verdict\n  Who:    Game - Units\n${done}\n\`\`\``
const ended = words => ({ text: [typed(NOW - 40 * MIN, 'Record the verdict, please.'), answer(NOW - 20 * MIN, words)].join('\n'), isCut: false, modifiedAt: NOW - 20 * MIN })

function units({ more = {}, words = 'The verdict is recorded.' } = {}) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Units', more)],
    tails: { 'cli-Units': ended(words) },
    planLineTexts: { 'cli-Units': card },
    backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config }).chats.find(chat => chat.name === 'Units')
}

test('free by the app\'s own summary: no task, no step, no time from the card it left behind, only that it finished it', () => {
  const lane = units({ more: summary('completed') })
  assert.deepEqual([lane.state, lane.task, lane.eta, lane.between], ['free', null, null, null])
  assert.deepEqual(lane.lastTask, { text: 'Record the warrior verdict' })
})

test('free by "Done: yes" (B148) the same', () => {
  const lane = units({ words: closing('+ Done:   yes') })
  assert.deepEqual([lane.state, lane.task, lane.lastTask], ['free', null, { text: 'Record the warrior verdict' }])
})

test('waiting for you keeps the card\'s task: that is the work it waits on', () => {
  const lane = units({ more: summary('blocked', 'Choose the verdict.') })
  assert.deepEqual([lane.state, lane.task.text, lane.lastTask], ['waiting', 'Record the warrior verdict', null])
})

test('a chat the card still holds between two turns keeps its task as current work', () => {
  const lane = units({ words: closing('- Done:   partly, the note waits') })
  assert.deepEqual([lane.state, lane.task.text, lane.lastTask], ['working', 'Record the warrior verdict', null])
})

// The lane on the page

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`${cut('lanefree')}\nObject.assign(this, { freeLine })`, page)

test('a free lane says it is ready, or names the task it left behind as finished, in one dim line', () => {
  assert.equal(page.freeLine({ state: 'free', lastTask: null }), 'Ready for a new task')
  assert.equal(page.freeLine({ state: 'free' }), 'Ready for a new task')
  assert.equal(page.freeLine({ state: 'free', lastTask: { text: 'Record the warrior verdict' } }), 'Last task: Record the warrior verdict, finished')
  for (const state of ['working', 'waiting', 'suspended', 'interrupted', 'unknown']) assert.equal(page.freeLine({ state, lastTask: null }), null, state)
})

test('B262: a free lane says since when it is idle, and whether the app or its transcript says so', () => {
  const clock = at => `${String(new Date(at).getUTCHours()).padStart(2, '0')}:${String(new Date(at).getUTCMinutes()).padStart(2, '0')}`
  const at = Date.UTC(2026, 9, 15, 20, 26)
  assert.equal(page.freeLine({ state: 'free', lastTask: null, idle: { since: at, from: 'app', isSilent: false } }, clock), 'Ready for a new task · idle since 20:26, from the app')
  assert.equal(page.freeLine({ state: 'free', lastTask: null, idle: { since: at, from: 'transcript', isSilent: false } }, clock), 'Ready for a new task · idle since 20:26, from the transcript')
  assert.equal(page.freeLine({ state: 'free', lastTask: { text: 'Record the verdict' }, idle: { since: at, from: 'transcript', isSilent: true } }, clock),
    'Last task: Record the verdict, finished · turn ended without a closing message at 20:26, from the transcript')
  // Without a time, or without a clock, the line stays as it was.
  assert.equal(page.freeLine({ state: 'free', lastTask: null, idle: { since: null, from: 'app', isSilent: false } }, clock), 'Ready for a new task')
  assert.equal(page.freeLine({ state: 'free', lastTask: null, idle: { since: at, from: 'app', isSilent: false } }), 'Ready for a new task')
})
