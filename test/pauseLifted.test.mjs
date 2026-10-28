// B312: a worker's pause for the limit ends early once the limit it paused for has come back. Seen live on 2026-10-18
// at 13:29: Units paused at 11:39 "until 14:40" with the 5-hour limit at 92%; the limit reset at about 13:00 (the
// app's usage file read 2% at 13:05), and the board still showed Units suspended until 14:40. A reading taken after
// the pause that shows the window reset (its reset time past the pause's start), or its use below the percent the
// note names (below 50% when it names none), frees the chat. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, assistant, step, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { pauseLifted, pauseNote, storePause } from '../src/limits.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { parseTail } from '../src/transcript.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const at = (hour, minute = 0, day = 18) => new Date(2026, 9, day, hour, minute).getTime()
const NOW = at(12, 0)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const two = n => String(n).padStart(2, '0')
const sinceOf = when => {
  const date = new Date(when)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
const held = (id, owner, state = 'in progress') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: ${owner}\nSince: ${sinceOf(NOW - 60 * MIN)}\n`)
const note = (id, from, when, words) =>
  parseItem(`Id: ${id}\nKind: note\nFrom: ${from}\nTo: main\nState: unread\nSince: ${sinceOf(when)}\nText: ${words.split('\n').join(' ')}\n\n## Text\n${words}\n\n## History\n- ${sinceOf(when)} ${from}: noted\n`)
const PAUSE = 'Note from Game - Board: paused for the limit until 14:40\nThe 5-hour limit is at 92% (account-wide); weekly 57%. Safe point: B269 at main.'
const BARE = 'Note from Game - Board: paused for the limit until 14:40\nSafe point: B269 at main.'
const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const call = (when, name, input = {}) => [assistant(when, 'tool_use', [tool(name, input)]), toolResult(when + 1000)]
/** A turn that ends with the pause filed as a work note at 11:49, closed a minute later. */
const pausedTurn = (text = PAUSE) => [typed(NOW - 30 * MIN, 'Go on with B269.'), step(NOW - 29 * MIN, 'Build'), toolResult(NOW - 28 * MIN),
  ...call(NOW - 11 * MIN, 'mcp__workers__work', { action: 'note', to: 'main', of: 'B269', text }), answer(NOW - 10 * MIN, 'I stop here.')]
/** The app's usage file with these samples: `[when, 5-hour %, week %]`. */
const usage = (...samples) => JSON.stringify({ samples: samples.map(([t, fh, sd]) => ({ t, org: 'o', u: { fh, sd } })) })

function build({ items, usageText = null, now = NOW, turn = pausedTurn() }) {
  const work = storeFromText('## Board\n', { now: NOW - 120 * MIN })
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const names = ['Main', 'Board']
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: names.map(app),
    tails: Object.fromEntries(names.map(name => [`cli-${name}`, { text: (name === 'Board' ? turn : [answer(NOW - 90 * MIN, 'ok')]).join('\n'), isCut: false, modifiedAt: NOW - 2 * MIN }])),
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, usageText,
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now, config })
}
const board = state => state.chats.find(chat => chat.name === 'Board')
const PAUSED = [held('B269', 'Board'), note('N37', 'Board', NOW - 11 * MIN, PAUSE)]

test('a reading after the pause below the percent the note names frees the chat, as if it had not paused', () => {
  const lifted = build({ items: PAUSED, usageText: usage([NOW - 30 * MIN, 92, 57], [NOW - 3 * MIN, 4, 2]) })
  assert.equal(board(lifted).suspended, null)
  assert.notEqual(board(lifted).state, 'suspended')
  assert.equal(lifted.counts.suspended, 0)
  // It is what the same chat is without the note: its turn ended with B269 held, so the "may wait for you" hint.
  const free = build({ items: PAUSED.slice(0, 1), usageText: usage([NOW - 30 * MIN, 92, 57], [NOW - 3 * MIN, 4, 2]) })
  const parts = lane => [lane.state, lane.between, lane.resting?.since, lane.isWithoutTime]
  assert.deepEqual(parts(board(lifted)), parts(board(free)))
  assert.deepEqual(lifted.forYou.filter(need => need.kind === 'idle').length, free.forYou.filter(need => need.kind === 'idle').length)
  assert.equal(lifted.forYou.filter(need => need.kind === 'idle').length, 1)
})

test('without a reading after the pause, or with one still at or above the percent named, the pause stands', () => {
  const before = build({ items: PAUSED, usageText: usage([NOW - 30 * MIN, 4, 2]) })
  assert.equal(board(before).state, 'suspended')
  assert.equal(board(build({ items: PAUSED })).state, 'suspended')
  const high = build({ items: PAUSED, usageText: usage([NOW - 3 * MIN, 95, 57]) })
  assert.deepEqual(board(high).suspended, { by: 'note', limit: 'fiveHour', since: NOW - 11 * MIN, until: at(14, 40), isBack: false })
  // A note without a percent: below 50% frees it, 60% does not.
  const bare = [held('B269', 'Board'), note('N37', 'Board', NOW - 11 * MIN, BARE)]
  assert.equal(board(build({ items: bare, turn: pausedTurn(BARE), usageText: usage([NOW - 3 * MIN, 60, 57]) })).state, 'suspended')
  assert.notEqual(board(build({ items: bare, turn: pausedTurn(BARE), usageText: usage([NOW - 3 * MIN, 40, 57]) })).state, 'suspended')
})

test('the window the pause was for: a reading of a window begun after the pause frees it, whatever its use', () => {
  const pause = { limit: 'fiveHour', since: NOW - 11 * MIN, percent: 92 }
  const fiveHour = more => ({ fiveHour: { used: 95, at: NOW - MIN, resetsAt: null, resetAt: null, level: 'full', ...more }, week: null })
  // The window that runs now began after the pause: it reset in between.
  assert.equal(pauseLifted(pause, fiveHour({ resetsAt: NOW - 10 * MIN + 5 * HOUR })), true)
  assert.equal(pauseLifted(pause, fiveHour({ resetsAt: NOW - 30 * MIN + 5 * HOUR })), false)
  // A known reset passed after the pause began, but nothing was read since: no newer reading, the pause stands.
  assert.equal(pauseLifted(pause, fiveHour({ used: 0, at: NOW - 5 * MIN, resetAt: NOW - 5 * MIN })), false)
  // The reading is from before the pause: it says nothing about it.
  assert.equal(pauseLifted(pause, fiveHour({ used: 3, at: NOW - 20 * MIN })), false)
  assert.equal(pauseLifted(pause, { fiveHour: null, week: null }), false)
  // A pause for the week looks at the week.
  const week = { limit: 'week', since: NOW - 11 * MIN, percent: null }
  assert.equal(pauseLifted(week, { fiveHour: { used: 1, at: NOW - MIN, resetsAt: null, resetAt: null }, week: { used: 90, at: NOW - MIN, resetsAt: null, resetAt: null } }), false)
  assert.equal(pauseLifted(week, { fiveHour: null, week: { used: 30, at: NOW - MIN, resetsAt: null, resetAt: null } }), true)
})

test('the note says which window and how full: the percent of that window, else the only one it names', () => {
  const filed = text => storePause([{ at: NOW - 11 * MIN, text }], [], ['Game - Main'])
  assert.deepEqual([filed(PAUSE).limit, filed(PAUSE).percent], ['fiveHour', 92])
  assert.deepEqual([filed(BARE).limit, filed(BARE).percent], ['fiveHour', null])
  const weekly = filed('Note from Game - Board: paused for the weekly limit until 14:40\nThe 5-hour limit is at 20%; weekly 97%.')
  assert.deepEqual([weekly.limit, weekly.percent], ['week', 97])
  assert.equal(filed('Note from Game - Board: paused for the limit until 14:40\nAt 88% now.').percent, 88)
  // The message form says the same.
  const sent = pauseNote(parseTail([assistant(NOW - 11 * MIN, 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: PAUSE })]), answer(NOW - 10 * MIN, 'Stop.')].join('\n'), false), 'Game - Main')
  assert.deepEqual([sent.limit, sent.percent], ['fiveHour', 92])
})
