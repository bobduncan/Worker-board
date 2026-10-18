// B308: a worker that holds a step but has ended its turn with nothing running, and filed no ask, may wait for the
// person without saying so where the board looks. Needs your attention names it once, with the way to its answer: a
// hint read from the store and the turn, never from its words. The person, 2026-10-18: Board waited for their look on
// two steps, said so only in prose, and nothing on the board showed it. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, assistant, step, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 18, 12, 0).getTime()
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const sinceOf = at => {
  const date = new Date(at)
  const two = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
const held = (id, owner, state = 'in progress') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: ${owner}\nSince: ${sinceOf(NOW - 60 * MIN)}\n`)
const ask = (owner, state = 'open') => parseItem(`Id: Q1\nKind: ask\nTitle: Look at it\nState: ${state}\nOwner: ${owner}\nSince: ${sinceOf(NOW - 30 * MIN)}\nAsks: look\nBlocking: no\nOf: B269\n`)
const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})

const closing = done => `B269 is ready for your look on the copy.\n\n---\n\n\`\`\`diff\n  Prompt: the lanes\n  Who:    Game - Board\n${done}\n\`\`\``
const YES = closing('+ Done:   yes')
/** A turn that did what it was asked and ended `ago` minutes before now. */
const ended = (ago, words = YES) => [typed(NOW - (ago + 10) * MIN, 'Show me B269.'), step(NOW - (ago + 9) * MIN, 'Build'), toolResult(NOW - (ago + 8) * MIN), answer(NOW - ago * MIN, words)]
const IDLE = ended(10)

function build(tails, items = [held('B269', 'Board'), held('B280', 'Game - Board', 'taken')]) {
  const work = storeFromText('## Board\n', { now: NOW - 120 * MIN })
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const names = ['Main', 'Board', 'Support', 'Advisor']
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: names.map(app),
    tails: Object.fromEntries(names.map(name => [`cli-${name}`, { text: (tails[name] ?? [answer(NOW - 90 * MIN, 'ok')]).join('\n'), isCut: false, modifiedAt: NOW - 2 * MIN }])),
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config })
}
const hints = state => state.forYou.filter(need => need.kind === 'idle')

test('a worker that holds steps, ended its turn and asked nothing is one line under Needs your attention, with the way to its answer', () => {
  const state = build({ Board: IDLE })
  const [hint, ...more] = hints(state)
  assert.deepEqual(more, [])
  assert.deepEqual([hint.from, hint.title, hint.canAnswer, hint.talk, hint.answer, hint.isMain], ['Board', 'Board holds B269 and B280 but is not working and asked you nothing: it may wait for you', false, 'window', null, false])
  // Its window shows its last answer.
  assert.equal(hint.waits.words, YES)
  // The old "Done: yes" flag is gone from its lane.
  assert.deepEqual(state.chats.find(chat => chat.name === 'Board').flags, [])
})

test('one line per chat: Support, holding its own step, has its own', () => {
  const state = build({ Board: IDLE, Support: ended(20, 'Done for now.') }, [held('B269', 'Board'), held('B280', 'Board'), held('B31', 'Support')])
  assert.deepEqual(hints(state).map(need => need.title).sort(), [
    'Board holds B269 and B280 but is not working and asked you nothing: it may wait for you',
    'Support holds B31 but is not working and asked you nothing: it may wait for you',
  ])
})

test('no line for a chat that works, or whose ended turn left a command running', () => {
  assert.deepEqual(hints(build({ Board: [...IDLE, typed(NOW - 3 * MIN, 'And the flags.'), step(NOW - MIN, 'Build')] })), [])
  const background = [typed(NOW - 20 * MIN, 'Start the copy.'), assistant(NOW - 19 * MIN, 'tool_use', [tool('Bash', { description: 'Start the copy' })]),
    JSON.stringify({ type: 'user', timestamp: new Date(NOW - 19 * MIN).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'Command running in background with ID: b1.' }] } }),
    answer(NOW - 10 * MIN, closing('- Done:   partly, the copy still starts'))]
  assert.deepEqual(hints(build({ Board: background })), [])
})

test('no line for a chat suspended for the limit, or with an open ask of its own; an answered ask does not count', () => {
  const paused = [...ended(12, 'Working.').slice(0, 3), assistant(NOW - 11 * MIN, 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Note from Game - Board: paused for the limit until 15:00' })]), toolResult(NOW - 11 * MIN + 1000), answer(NOW - 10 * MIN, 'I stop here.')]
  const suspended = build({ Board: paused })
  assert.equal(suspended.chats.find(chat => chat.name === 'Board').state, 'suspended')
  assert.deepEqual(hints(suspended), [])
  assert.deepEqual(hints(build({ Board: IDLE }, [held('B269', 'Board'), ask('Board')])), [])
  assert.equal(hints(build({ Board: IDLE }, [held('B269', 'Board'), ask('Board', 'answered')])).length, 1)
})

test('no line for the main chat or the Advisor, nor within the idle time, nor beside a "For you" block filed as no ask', () => {
  assert.deepEqual(hints(build({ Main: IDLE, Advisor: IDLE }, [held('B269', 'Main'), held('B280', 'Advisor')])), [])
  assert.deepEqual(hints(build({ Board: ended(3) })), [])
  assert.equal(hints(build({ Board: ended(6) })).length, 1)
  // Its answer asks in a "For you" block: the warning that it filed no ask says it already, once.
  const asks = build({ Board: ended(10, `B269 is ready.\n\n> **For you**\n> 1. **Answer:** Do the lanes read well? I advise yes.\n\n${closing('- Done:   partly, waits for your look')}`) })
  assert.deepEqual([hints(asks), asks.forYou.filter(need => need.from === 'Board').map(need => need.kind)], [[], ['unfiled']])
})
