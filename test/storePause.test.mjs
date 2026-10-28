// B310: a worker's pause for the limit sent as a work note to the main chat (`work note --to main`) suspends it as the
// message form does. Seen live, 2026-10-18: Units paused until 14:40 through the work tool, and its lane said it worked
// on with background work running. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, assistant, step, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
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
/** A note as the work tool files it: the words on one line in the head, as written under Text. */
const note = (id, from, when, words, { to = 'main', state = 'unread' } = {}) =>
  parseItem(`Id: ${id}\nKind: note\nFrom: ${from}\nTo: ${to}\nState: ${state}\nSince: ${sinceOf(when)}\nText: ${words.split('\n').join(' ')}\n\n## Text\n${words}\n\n## History\n- ${sinceOf(when)} ${from}: noted\n`)
const PAUSE = 'Note from Game - Board: paused for the limit until 14:40\nThe 5-hour limit is at 92%. Safe point: B269 at main.'
const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const call = (when, name, input = {}) => [assistant(when, 'tool_use', [tool(name, input)]), toolResult(when + 1000)]
const noted = (when, text = PAUSE) => call(when, 'mcp__workers__work', { action: 'note', to: 'main', of: 'B269', text })
/** A turn that ends with the pause filed as a work note at `when` (11:49), closed a minute later. */
const pausedTurn = (when = NOW - 11 * MIN) => [typed(NOW - 30 * MIN, 'Go on with B269.'), step(NOW - 29 * MIN, 'Build'), toolResult(NOW - 28 * MIN), ...noted(when), answer(when + MIN, 'I stop here.')]

function build(tails, items, { now = NOW } = {}) {
  const work = storeFromText('## Board\n', { now: NOW - 120 * MIN })
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const names = ['Main', 'Board', 'Support']
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: names.map(app),
    tails: Object.fromEntries(names.map(name => [`cli-${name}`, { text: (tails[name] ?? [answer(NOW - 90 * MIN, 'ok')]).join('\n'), isCut: false, modifiedAt: NOW - 2 * MIN }])),
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now, config })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)
const STEPS = [held('B269', 'Board')]

test('a pause filed as a work note to the main chat suspends its chat until the time it names', () => {
  const state = build({ Board: pausedTurn() }, [...STEPS, note('N37', 'Board', NOW - 11 * MIN, PAUSE)])
  const board = lane(state, 'Board')
  assert.equal(board.state, 'suspended')
  assert.deepEqual(board.suspended, { by: 'note', limit: 'fiveHour', since: NOW - 11 * MIN, until: at(14, 40), isBack: false })
  assert.deepEqual([board.between, board.isWithoutTime, state.counts.suspended], [null, false, 1])
  // From names the chat with or without the prefix; whether the main chat has read it does not matter.
  const named = build({ Board: pausedTurn() }, [...STEPS, note('N37', 'Game - Board', NOW - 11 * MIN, PAUSE, { state: 'read' })])
  assert.equal(lane(named, 'Board').state, 'suspended')
})

test('only a note to the main chat whose first line is the pause line, from a worker, counts', () => {
  const other = build({ Board: pausedTurn() }, [...STEPS, note('N37', 'Board', NOW - 11 * MIN, PAUSE, { to: 'Support' })])
  assert.notEqual(lane(other, 'Board').state, 'suspended')
  const later = build({ Board: pausedTurn() }, [...STEPS, note('N37', 'Board', NOW - 11 * MIN, 'Safe point: B269 at main.\nI am paused for the limit until 14:40.')])
  assert.notEqual(lane(later, 'Board').state, 'suspended')
  const main = build({ Main: pausedTurn() }, [note('N37', 'Main', NOW - 11 * MIN, PAUSE)])
  assert.equal(lane(main, 'Main').suspended, null)
  // Its turn still runs: it works.
  const running = build({ Board: pausedTurn().slice(0, -1) }, [...STEPS, note('N37', 'Board', NOW - 11 * MIN, PAUSE)])
  assert.equal(lane(running, 'Board').state, 'working')
})

test('the time is the next such clock time after the note; once it has passed the board says the limit is back', () => {
  const early = build({ Board: pausedTurn() }, [...STEPS, note('N37', 'Board', NOW - 11 * MIN, 'Note from Game - Board: paused for the limit until 11:30')])
  assert.equal(lane(early, 'Board').suspended.until, at(11, 30, 19))
  const back = build({ Board: pausedTurn() }, [...STEPS, note('N37', 'Board', NOW - 11 * MIN, PAUSE)], { now: at(14, 50) })
  assert.deepEqual([lane(back, 'Board').state, lane(back, 'Board').suspended.isBack], ['suspended', true])
})

test('the newer of a note and a message to the main chat decides', () => {
  const message = (when, words) => call(when, 'SendMessage', { to: 'Game - Main', message: words })
  // The message paused first, until 14:10; the note after it names 14:40.
  const turn = [typed(NOW - 30 * MIN, 'Go on.'), ...message(NOW - 20 * MIN, 'Note from Game - Board: paused for the limit until 14:10'), ...noted(NOW - 11 * MIN), answer(NOW - 10 * MIN, 'I stop here.')]
  const newerNote = lane(build({ Board: turn }, [...STEPS, note('N37', 'Board', NOW - 11 * MIN, PAUSE)]), 'Board')
  assert.deepEqual([newerNote.suspended.since, newerNote.suspended.until], [NOW - 11 * MIN, at(14, 40)])
  // A note first, then the message: the message's time.
  const swapped = [typed(NOW - 30 * MIN, 'Go on.'), ...noted(NOW - 20 * MIN), ...message(NOW - 11 * MIN, 'Note from Game - Board: paused for the limit until 14:10'), answer(NOW - 10 * MIN, 'I stop here.')]
  const newerMessage = lane(build({ Board: swapped }, [...STEPS, note('N37', 'Board', NOW - 20 * MIN, PAUSE)]), 'Board')
  assert.deepEqual([newerMessage.suspended.since, newerMessage.suspended.until], [NOW - 11 * MIN, at(14, 10)])
  // It told the main chat something else after the pause, by a note or by a message: not suspended.
  const told = lane(build({ Board: pausedTurn() }, [...STEPS, note('N37', 'Board', NOW - 20 * MIN, PAUSE), note('N38', 'Board', NOW - 11 * MIN, 'Report from Game - Board: B269 is back on.')]), 'Board')
  assert.notEqual(told.state, 'suspended')
  const said = [...pausedTurn(NOW - 20 * MIN).slice(0, -1), ...message(NOW - 12 * MIN, 'B269: one question first.'), answer(NOW - 11 * MIN, 'Asked.')]
  assert.notEqual(lane(build({ Board: said }, [...STEPS, note('N37', 'Board', NOW - 20 * MIN, PAUSE)]), 'Board').state, 'suspended')
  // An older pause message does not undo a newer note that says something else.
  const over = [typed(NOW - 30 * MIN, 'Go on.'), ...message(NOW - 20 * MIN, 'Note from Game - Board: paused for the limit until 14:10'), ...noted(NOW - 11 * MIN, 'Report from Game - Board: B269 is back on.'), answer(NOW - 10 * MIN, 'Going on.')]
  assert.notEqual(lane(build({ Board: over }, [...STEPS, note('N38', 'Board', NOW - 11 * MIN, 'Report from Game - Board: B269 is back on.')]), 'Board').state, 'suspended')
})

test('it stays suspended through a word to the board or a look at the limits, and works again after real work', () => {
  // Units, 2026-10-18: after its note the board's "work" prompt came in; it looked at its step and its limits, and stopped.
  const coordinates = [...pausedTurn(), typed(NOW - 8 * MIN, 'work: B32 is yours; run work next'),
    ...call(NOW - 8 * MIN, 'mcp__workers__work', { action: 'next' }), ...call(NOW - 8 * MIN + 2000, 'mcp__ccd_session_mgmt__get_usage'),
    // A call under the mod's old name (folder-branches, until 0.26.0) is a word to the board as well.
    ...call(NOW - 7 * MIN, 'mcp__folder-branches__chat', { action: 'done' }), ...call(NOW - 7 * MIN + 2000, 'mcp__ccd_turn__wrap_up', { recap: 'Paused.' }), answer(NOW - 7 * MIN + 5000, 'Paused until 14:40.')]
  assert.equal(lane(build({ Board: coordinates }, [...STEPS, note('N37', 'Board', NOW - 11 * MIN, PAUSE)]), 'Board').state, 'suspended')
  // A command in the same minute as the note (its time is written to the minute) is part of the turn that paused.
  const sameMinute = [...pausedTurn().slice(0, -1), ...call(NOW - 11 * MIN + 30_000, 'Bash', { description: 'git status' }), answer(NOW - 10 * MIN, 'I stop here.')]
  assert.equal(lane(build({ Board: sameMinute }, [...STEPS, note('N37', 'Board', NOW - 11 * MIN, PAUSE)]), 'Board').state, 'suspended')
  const again = [...pausedTurn(), typed(NOW - 5 * MIN, 'Go on.'), step(NOW - 4 * MIN, 'Build'), toolResult(NOW - 4 * MIN + 1000), answer(NOW - 3 * MIN, 'Built.')]
  assert.notEqual(lane(build({ Board: again }, [...STEPS, note('N37', 'Board', NOW - 11 * MIN, PAUSE)]), 'Board').state, 'suspended')
})

test('a chat suspended by its note is handed nothing and is no "may wait for you" hint', () => {
  const items = [held('B269', 'Board'), note('N37', 'Board', NOW - 11 * MIN, PAUSE)]
  const state = build({ Board: pausedTurn() }, items)
  assert.deepEqual(state.forYou.filter(need => need.kind === 'idle'), [])
  // Without the note it would be the hint: the turn ended long enough ago with B269 held.
  assert.equal(build({ Board: pausedTurn() }, [held('B269', 'Board')]).forYou.filter(need => need.kind === 'idle').length, 1)
  // A step queued for it is not delivered while it is suspended; a free chat gets it.
  const queued = [parseItem(`Id: B32\nKind: step\nTitle: The shop\nState: queued\nOwner: Board\nSince: ${sinceOf(NOW - 60 * MIN)}\n`), note('N37', 'Board', NOW - 11 * MIN, PAUSE)]
  assert.deepEqual(build({ Board: pausedTurn() }, queued).reconciled.deliveries, [])
  assert.deepEqual(build({ Board: pausedTurn() }, queued.slice(0, 1)).reconciled.deliveries.map(one => [one.id, one.chat]), [['B32', 'Board']])
})
