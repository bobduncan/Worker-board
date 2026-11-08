// B995 (X140, 2026-11-04): a worker's pause note written after the board sent it the week's stop word ("week-stop") is a
// pause for the WEEK: it runs to the week's reset the word carried, and a 5-hour reading no longer lifts it. Without
// that word the note reads as before (5-hour). Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, assistant, step, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { asWeekPause, storePause } from '../src/limits.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const DAY = 24 * 60 * MIN
const at = (hour, minute = 0, day = 18) => new Date(2026, 9, day, hour, minute).getTime()
const NOW = at(12, 0)
const THURSDAY = at(20, 0, 22)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const two = n => String(n).padStart(2, '0')
const sinceOf = when => {
  const date = new Date(when)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
const held = (id, owner) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: in progress\nOwner: ${owner}\nSince: ${sinceOf(NOW - 60 * MIN)}\n`)
const note = (id, from, when, words) =>
  parseItem(`Id: ${id}\nKind: note\nFrom: ${from}\nTo: main\nState: unread\nSince: ${sinceOf(when)}\nText: ${words.split('\n').join(' ')}\n\n## Text\n${words}\n\n## History\n- ${sinceOf(when)} ${from}: noted\n`)
const PAUSE = 'Note from Game - Board: paused for the limit until 20:00\nSafe point: B269 at main.'
const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const call = (when, name, input = {}) => [assistant(when, 'tool_use', [tool(name, input)]), toolResult(when + 1000)]
const lead = [typed(NOW - 30 * MIN, 'Go on with B269.'), step(NOW - 29 * MIN, 'Build'), toolResult(NOW - 28 * MIN)]
/** The pause filed as a work note at 11:49 (the work-note form). */
const filedTurn = [...lead, ...call(NOW - 11 * MIN, 'mcp__workers__work', { action: 'note', to: 'main', of: 'B269', text: PAUSE }), answer(NOW - 10 * MIN, 'I stop here.')]
/** The pause sent to the main chat at 11:49 (the message form). */
const sentTurn = [...lead, ...call(NOW - 11 * MIN, 'SendMessage', { to: 'Game - Main', message: PAUSE }), answer(NOW - 10 * MIN, 'I stop here.')]
const usage = (...samples) => JSON.stringify({ samples: samples.map(([t, fh, sd]) => ({ t, org: 'o', u: { fh, sd } })) })
/** The board's week-stop word to Board, sent at 10:15. */
const word = (more = {}) => ({ id: 'e1', at: NOW - 105 * MIN, to: 'Board', command: 'week-stop', weekResets: THURSDAY, text: 'stop', state: 'delivered', deliveredAt: NOW - 104 * MIN, ...more })

function build({ turn = filedTurn, outbox = [], usageText = usage([NOW - 3 * MIN, 40, 100]), keptReadings = [] }) {
  const work = storeFromText('## Board\n', { now: NOW - 120 * MIN })
  const items = [held('B269', 'Board'), ...(turn === filedTurn ? [note('N37', 'Board', NOW - 11 * MIN, PAUSE)] : [])]
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const names = ['Main', 'Board']
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: names.map(app),
    tails: Object.fromEntries(names.map(name => [`cli-${name}`, { text: (name === 'Board' ? turn : [answer(NOW - 90 * MIN, 'ok')]).join('\n'), isCut: false, modifiedAt: NOW - 2 * MIN }])),
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, usageText,
  }
  return buildState(raw, { lines: [], outbox, runs: [], keptReadings, now: NOW, config })
}
const board = state => state.chats.find(chat => chat.name === 'Board')

for (const [form, turn] of [['work note', filedTurn], ['message', sentTurn]]) {
  test(`X140 (${form} form): a pause after the week-stop word is the week's pause, to the word's reset, and a 5-hour reading of 40% does not lift it`, () => {
    const lane = board(build({ turn, outbox: [word()] }))
    assert.equal(lane.state, 'suspended')
    assert.equal(lane.suspended.limit, 'week')
    assert.equal(lane.suspended.by, 'note')
    assert.equal(lane.suspended.until, THURSDAY)
    assert.equal(lane.suspended.isBack, false)
  })

  test(`B995 (${form} form): without the word it reads as before: 5-hour, until 20:00 today, lifted by the 40% reading`, () => {
    const lane = board(build({ turn, outbox: [] }))
    assert.notEqual(lane.state, 'suspended')
    // Contrast: a 5-hour reading still above 50% keeps the old 5-hour pause, to today 20:00.
    const stands = board(build({ turn, outbox: [], usageText: usage([NOW - 3 * MIN, 60, 100]) }))
    assert.deepEqual([stands.suspended.limit, stands.suspended.until], ['fiveHour', at(20, 0)])
  })

  test(`B995 (${form} form): last week's word (its reset before the note) does not count`, () => {
    const lane = board(build({ turn, outbox: [word({ weekResets: NOW - 3 * DAY })] }))
    assert.notEqual(lane.state, 'suspended')
  })

  test(`B995 (${form} form): a week reading of a window begun after the pause lifts it`, () => {
    const kept = [{ at: NOW - 3 * MIN, fiveHour: null, week: { used: 100, resetsAt: NOW + 7 * DAY - 5 * MIN } }]
    const lane = board(build({ turn, outbox: [word()], keptReadings: kept }))
    assert.notEqual(lane.state, 'suspended')
  })
}

test('B995: only a word that reached the chat counts: one dropped, failed or still waiting is no word for this week', () => {
  // Mutant: 'failed' or 'waiting' counted as sent (chat 1's review, 2026-11-08): that case reads as a week pause.
  for (const state of ['dropped', 'failed', 'waiting']) {
    const lane = board(build({ outbox: [word({ state, deliveredAt: undefined })] }))
    assert.notEqual(lane.state, 'suspended', `a ${state} word`)
  }
  const taken = board(build({ outbox: [word({ state: 'taken', deliveredAt: undefined })] }))
  assert.equal(taken.state, 'suspended', 'a taken word reached it')
})

test('asWeekPause: every case', () => {
  const pause = { at: NOW - 11 * MIN, until: at(20, 0), limit: 'fiveHour', percent: null, weekPercent: 97 }
  const week = (more = {}) => ({ at: NOW - 105 * MIN, weekResets: THURSDAY, ...more })
  // A word before the note, its reset after it: a week pause to the reset, with the week's figure the note named.
  assert.deepEqual(asWeekPause(pause, [week()]), { ...pause, limit: 'week', until: THURSDAY, percent: 97 })
  // A word without a reset: until null, the clock match of the note is not used.
  const open = asWeekPause(pause, [week({ weekResets: null })])
  assert.deepEqual([open.limit, open.until], ['week', null])
  // ... and it counts only within 7 days of the word.
  assert.equal(asWeekPause(pause, [week({ weekResets: null, at: pause.at - 8 * DAY })]), pause)
  // A word after the note, or one whose reset is before the note, or none: as it was.
  assert.equal(asWeekPause(pause, [week({ at: NOW })]), pause)
  assert.equal(asWeekPause(pause, [week({ weekResets: NOW - DAY })]), pause)
  assert.equal(asWeekPause(pause, []), pause)
  // A note that names the week itself stays; no note, or a "not paused" note, stays.
  const named = { ...pause, limit: 'week', until: at(14, 40) }
  assert.equal(asWeekPause(named, [week()]), named)
  assert.equal(asWeekPause(null, [week()]), null)
  const off = { at: pause.at, isPaused: false }
  assert.equal(asWeekPause(off, [week()]), off)
  // Several words: the newest that counts decides.
  assert.equal(asWeekPause(pause, [week({ weekResets: THURSDAY - DAY }), week({ at: NOW - 100 * MIN })]).until, THURSDAY)
  // The percent: null when the note named no week figure.
  assert.equal(asWeekPause({ ...pause, weekPercent: null }, [week()]).percent, null)
})

test('B995: the week figure a note names reaches the week pause as its percent', () => {
  const filed = storePause([{ at: NOW - 11 * MIN, text: 'Note from Game - Board: paused for the limit until 20:00\nThe 5-hour limit is at 20%; weekly 97%.' }], [], ['Game - Main'])
  assert.equal(asWeekPause(filed, [{ at: NOW - 105 * MIN, weekResets: THURSDAY }]).percent, 97)
})
