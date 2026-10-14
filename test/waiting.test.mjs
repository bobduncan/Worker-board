// B100: a click on a worker that waits for the person opens what it waits for: its task as its card names it, what
// it wants in its own words, and the form to answer it there. The page's own code is run here, cut out of board.js
// between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, assistant, step, text, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { checkSay } from '../src/say.mjs'
import { buildState } from '../src/state.mjs'
import { parseTail, waitingFor } from '../src/transcript.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 12, 15, 0)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const app = (name, summary = null) => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
  // The app's own line after a turn: it is blocked, and what it needs.
  ...(summary === null ? {} : { postTurnSummary: { status_category: 'blocked', status_detail: '', needs_action: summary, summarizes_uuid: 'u-1' } }),
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
const planLine = task => JSON.stringify({ name: 'x', role: 'worker', state: 'waiting', task: { isReported: false, ...task }, at: NOW - 30 * MIN })
const entries = lines => parseTail(lines.join('\n'), false)

/** A turn that ended with the worker's own question, after something the person typed. */
const asked = [typed(NOW - 40 * MIN, 'Zebracorn please'), step(NOW - 30 * MIN, 'Draw'), toolResult(NOW - 29 * MIN), answer(NOW - 9 * MIN, 'Two sheets are drawn.\n\nWhich one do you want: A or B?')]
const form = [typed(NOW - 40 * MIN, 'Zebracorn please'), assistant(NOW - 9 * MIN, 'tool_use', [text('I need one choice.'), tool('AskUserQuestion', {
  questions: [{ question: 'Which sheet?', header: 'Sheet', options: [{ label: 'Sheet A', description: 'the tall one' }, { label: 'Sheet B', description: 'the wide one' }], multiSelect: false }],
})])]

function build({ tails = {}, plans = {}, outbox = [], summary = 'Pick sheet A or B', now = NOW }) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Units', summary)],
    tails: Object.fromEntries(Object.entries(tails).map(([name, value]) => [`cli-${name}`, value])),
    planLineTexts: Object.fromEntries(Object.entries(plans).map(([name, value]) => [`cli-${name}`, value])),
    backlogText: '## Art\n- [ ] B08 Portraits (for Units; about 20 min)\n',
    adviceText: null,
    folders: null,
    askTexts: [],
    pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox, runs: [], now, config })
}
const need = state => state.forYou.find(one => one.from === 'Units')

test('what a waiting chat last said: the answer that ended its turn, in its own words', () => {
  assert.deepEqual(waitingFor(entries(asked)), { at: NOW - 9 * MIN, words: 'Two sheets are drawn.\n\nWhich one do you want: A or B?', questions: [], plan: null })
  // A turn that runs has asked nothing; neither have entries without a word of the chat.
  assert.equal(waitingFor(entries(asked.slice(0, 3))), null)
  assert.equal(waitingFor(entries([typed(1, 'Go')])), null)
  // Of a long answer the end is kept: the question stands there.
  const long = waitingFor(entries([answer(1, `${'x'.repeat(9000)} So: A or B?`)]))
  assert.equal(long.words.length, 6001)
  assert.ok(long.words.startsWith('…') && long.words.endsWith('So: A or B?'))
})

test('a question asked with the app\'s form: the questions and the options it offers; a plan to approve', () => {
  assert.deepEqual(waitingFor(entries(form)), { at: NOW - 9 * MIN, words: 'I need one choice.', questions: [{ question: 'Which sheet?', options: ['Sheet A', 'Sheet B'] }], plan: null })
  const plan = waitingFor(entries([assistant(1, 'tool_use', [tool('ExitPlanMode', { plan: '1. Draw\n2. Cut' })])]))
  assert.deepEqual([plan.questions, plan.plan], [[], '1. Draw\n2. Cut'])
  // What is no question is left out, and nothing breaks on a form without any.
  assert.deepEqual(waitingFor(entries([assistant(1, 'tool_use', [tool('AskUserQuestion', { questions: [null, { question: ' ' }, { question: 'Go on?', options: 'yes' }] })])])).questions, [{ question: 'Go on?', options: [] }])
  assert.deepEqual(waitingFor(entries([assistant(1, 'tool_use', [tool('AskUserQuestion', null)])])).questions, [])
})

test('a worker that waits brings its task as its card names it and its own words; nothing typed to it', () => {
  const state = build({ tails: { Units: tail(asked) }, plans: { Units: planLine({ text: 'Portraits, B08', step: 2, steps: 3, names: ['Sheet', 'Pick', 'Cut'] }) } })
  const units = state.chats.find(chat => chat.name === 'Units')
  assert.equal(units.state, 'waiting')
  const one = need(state)
  assert.deepEqual([one.id, one.title, one.text, one.canAnswer], [`chat:Units:${NOW - 9 * MIN}`, 'Needs your decision', 'Pick sheet A or B', true])
  assert.deepEqual(one.task, { text: 'Portraits, B08', step: 2, steps: 3, name: 'Pick', startedAt: units.task.startedAt, stepId: 'B08' })
  // B149: no parts of the agreed form, and no hand-over: the task was typed by the person, which is never shown.
  assert.deepEqual(one.waits, { at: NOW - 9 * MIN, words: 'Two sheets are drawn.\n\nWhich one do you want: A or B?', questions: [], plan: null, handover: null, given: null })
  assert.ok(!JSON.stringify(state).includes('Zebracorn'))
  // A chat that does not wait says nothing of the kind.
  const working = build({ tails: { Units: tail(asked.slice(0, 3)) }, summary: null })
  assert.equal(working.chats.find(chat => chat.name === 'Units').waitsFor, null)
})

test('a question asked with the app\'s form shows in the window, and is answered in its chat only', () => {
  const state = build({ tails: { Units: tail(form) }, summary: null })
  const one = need(state)
  assert.deepEqual([one.canAnswer, one.waits.questions], [false, [{ question: 'Which sheet?', options: ['Sheet A', 'Sheet B'] }]])
  assert.equal(checkSay({ to: 'Units', ask: one.id, text: 'Sheet A' }, state, 4000).ok, false)
})

test('the answer typed in the window is accepted for that worker, as its own request', () => {
  const state = build({ tails: { Units: tail(asked) } })
  const sent = checkSay({ to: 'Units', ask: need(state).id, text: 'Sheet B, please.' }, state, 4000)
  assert.deepEqual([sent.ok, sent.message.to, sent.message.ask, sent.message.text], [true, 'Units', `chat:Units:${NOW - 9 * MIN}`, 'Sheet B, please.'])
  assert.equal(checkSay({ to: 'Main', ask: need(state).id, text: 'x' }, state, 4000).ok, false)
})

test('once answered, the card stays while the answer is on its way and a while after it was typed in', () => {
  const id = `chat:Units:${NOW - 9 * MIN}`
  const sent = more => ({ at: NOW - 2 * MIN, to: 'Units', ask: id, verdict: null, text: 'Sheet B', title: 'Needs your decision', ...more })
  // The chat got the answer and works again: it no longer waits, and its card says where the answer is.
  const works = [...asked, typed(NOW - MIN, 'Sheet B'), step(NOW - MIN / 2, 'Cut'), toolResult(NOW - MIN / 4)]
  for (const state of ['waiting', 'taken']) {
    const kept = need(build({ tails: { Units: tail(works) }, outbox: [sent({ state })], summary: null }))
    assert.deepEqual([kept.id, kept.title, kept.canAnswer, kept.answer.state, kept.at], [id, 'Waited for you', false, state, NOW - 9 * MIN])
  }
  const typedIn = build({ tails: { Units: tail(works) }, outbox: [sent({ state: 'delivered', deliveredAt: NOW - MIN })], summary: null })
  assert.deepEqual([need(typedIn).answer.state, need(typedIn).answer.deliveredAt], ['delivered', NOW - MIN])
  assert.equal(checkSay({ to: 'Units', ask: id, text: 'again' }, typedIn, 4000).ok, false)
  // Ten minutes after it was typed in it is gone; so is an answer that never arrived.
  assert.equal(need(build({ tails: { Units: tail(works) }, outbox: [sent({ state: 'delivered', deliveredAt: NOW - 11 * MIN })], summary: null })), undefined)
  assert.equal(need(build({ tails: { Units: tail(works) }, outbox: [sent({ state: 'expired' })], summary: null })), undefined)
  // While the chat still waits there is one card, the open one, with its answer.
  const still = build({ tails: { Units: tail(asked) }, outbox: [sent({ state: 'waiting' })] })
  assert.deepEqual(still.forYou.filter(one => one.from === 'Units').map(one => [one.title, one.answer.state]), [['Needs your decision', 'waiting']])
})

// The page

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('waiting')}\nObject.assign(this, { clock, span, needOfLane, waitingOf })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

test('a click on a waiting lane opens what its chat waits for, else a request it filed', () => {
  const needs = [
    { id: 'quiet:Units', from: 'Units', kind: 'intervene', answer: null },
    { id: 'ask-1', from: 'Units', kind: 'verify', answer: { state: 'delivered' } },
    { id: 'ask-2', from: 'Units', kind: 'input', answer: null },
    { id: 'chat:Units:5', from: 'Units', kind: 'input', answer: null },
    { id: 'chat:Levels:7', from: 'Levels', kind: 'input', answer: null },
    { id: 'backlog:B10', from: 'Units', kind: 'verify', activity: 'Art', answer: null },
  ]
  assert.equal(page.needOfLane(needs, 'Units'), 'chat:Units:5')
  assert.equal(page.needOfLane(needs.filter(one => one.id !== 'chat:Units:5'), 'Units'), 'ask-2')
  // All answered: the window shows where the answer is. A step of the backlog is not the lane's question.
  assert.equal(page.needOfLane(needs.slice(0, 2), 'Units'), 'ask-1')
  assert.equal(page.needOfLane([needs[0], needs[5]], 'Units'), null)
  assert.equal(page.needOfLane(needs, 'Support'), null)
  // The lane is clickable and its line is a button; the queue, the unfolded details and the control that removes
  // the worker (B143) keep their own clicks.
  assert.match(script, /closest\('\.lane\.is-waiting'\)/)
  assert.match(script, /event\.target\.closest\('\.queue, \.more, \.remove-button, \.remove-warning, \.lane-menu'\) !== null\) return/)
  assert.match(script, /el\('button', 'needs-you', 'Needs your decision'\)/)
  assert.match(style, /\.lane\.is-waiting \.lane-row > \.who,[^{]*\{[^}]*cursor:\s*pointer/)
})

test('the window says the task in a few lines, as the card names it, then what the worker wants', () => {
  const task = { text: 'Portraits, B08', step: 2, steps: 3, name: 'Pick', startedAt: NOW - 70 * MIN, stepId: 'B08' }
  const waits = { at: NOW - 9 * MIN, words: 'Which one: A or B?', questions: [], plan: null }
  const view = plain(page.waitingOf({ id: 'chat:Units:5', text: 'Pick sheet A or B', canAnswer: true, answer: null, task, waits }, NOW))
  assert.deepEqual(view.task, ['Portraits, B08', 'Step 2 of 3: Pick', 'Backlog step B08', `Since ${page.clock(NOW - 70 * MIN)} (1 h 10)`])
  assert.deepEqual([view.hasTask, view.summary, view.words, view.saidAt, view.where], [true, 'Pick sheet A or B', 'Which one: A or B?', NOW - 9 * MIN, 'here'])
  // A worker that recorded nothing says so; a question of the app's form goes to its chat; an answered one is done.
  const bare = plain(page.waitingOf({ id: 'x', text: 'Answer it there.', canAnswer: false, answer: null, task: null, waits: { at: 1, words: '', questions: [{ question: 'Go on?', options: ['Yes', 'No'] }], plan: null } }, NOW))
  assert.deepEqual([bare.task, bare.hasTask, bare.questions, bare.where], [['It recorded no task.'], false, [{ question: 'Go on?', options: ['Yes', 'No'] }], 'chat'])
  // Its own line only says where to answer, which the window says itself.
  assert.equal(bare.summary, '')
  assert.equal(plain(page.waitingOf({ id: 'x', text: '', canAnswer: false, answer: { state: 'taken' }, task: null, waits: null }, NOW)).where, 'answered')
  // Any other request keeps the window it had.
  assert.equal(page.waitingOf({ id: 'ask-1', text: 'x', canAnswer: true, answer: null }, NOW), null)
  assert.equal(page.waitingOf(null, NOW), null)
  // The window draws the two parts and keeps the cards' own answer form and "where the answer is" line.
  assert.match(script, /const waitingShown = waiting === null \? null : waitingParts\(waiting, need\.id\)/)
  assert.match(script, /if \(waitingShown !== null\) left\.append\(\.\.\.waitingShown\.main\)/)
  assert.match(script, /main: \[section\('Its task', task\), section\('What it wants from you', wants\)\]/)
  assert.match(script, /form\.append\(\.\.\.optionChoices\(need\), \.\.\.answerPart\(need, state, false\)\)/)
})
