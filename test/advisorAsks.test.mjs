// B275: when the Advisor needs something from the person, it stands under Needs your attention like a worker's
// question, and the answer goes straight into the Advisor's chat, never through the main chat. The person,
// 2026-10-17: "I want if the advisor needs something from me, it also shows in this attention tab it can talk to 'me'
// directly instead or always via the main chat". A refine, a recommendation and a round of the board's clock keep
// their own places. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, assistant, fromChat, step, text, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { messageText } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { checkSay } from '../src/say.mjs'
import { buildState } from '../src/state.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 17, 10, 0)
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const app = (name, summary = null) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
  ...(summary === null ? {} : { postTurnSummary: { status_category: 'blocked', status_detail: '', needs_action: summary, summarizes_uuid: 'u-1' } }),
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })

const FOR_YOU = [
  'The hedge plan is written down.',
  '',
  '> **For you**',
  '> 1. **Answer:** Plant the hedge before the pond? I advise yes: the pond needs its shade.',
  '>    [See the picture: the hedge beside the pond](http://127.0.0.1:4310/#picture=art-inbox/garden/hedge.png)',
  '',
  '---',
  '',
  '```diff',
  '  Prompt: the order of the garden',
  '  Who:    Garden · Advisor',
  '- Done:   partly, waiting for your answer',
  '```',
].join('\n')

/** The board's state with a main chat, one worker and the Advisor; `summary` is the app's line of what it needs. */
function build({ advisor, summary = null, outbox = [], now = NOW }) {
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}',
    appChatTexts: [app('Lead'), app('Digger'), app('Advisor', summary)],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail(advisor) },
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox, runs: [], board: null, seen: null, now, config })
}
const advisorNeed = state => state.forYou.find(one => one.from === 'Advisor') ?? null

test('the Advisor that waits for the person stands under Needs your attention, with its question, advice and links', () => {
  const state = build({ advisor: [typed(NOW - 20 * MIN, 'What first, hedge or pond?'), answer(NOW - 12 * MIN, FOR_YOU)], summary: 'Answer: hedge before the pond?' })
  const need = advisorNeed(state)
  assert.notEqual(need, null)
  assert.equal(need.id, `chat:Advisor:${NOW - 12 * MIN}`)
  assert.equal(need.kind, 'input')
  assert.equal(need.title, 'Advisor needs your answer')
  assert.equal(need.text, 'Answer: hedge before the pond?')
  assert.equal(need.canAnswer, true)
  assert.equal(need.isAdvisor, true)
  assert.equal(need.isMain, false)
  const [item] = need.waits.handover.items
  assert.equal(item.ask, 'Plant the hedge before the pond? I advise yes: the pond needs its shade.')
  assert.deepEqual(item.links.map(link => link.path), ['art-inbox/garden/hedge.png'])
  // The Advisor stays off the lanes: it has its own tab.
  assert.ok(!state.chats.some(lane => lane.name === 'Advisor'))
})

test('a "For you" block in its last answer is enough, also when the app does not say it waits; its question is the card\'s line', () => {
  const need = advisorNeed(build({ advisor: [typed(NOW - 20 * MIN, 'What first?'), answer(NOW - 12 * MIN, FOR_YOU)] }))
  assert.notEqual(need, null)
  assert.equal(need.at, NOW - 12 * MIN)
  assert.equal(need.text, 'Plant the hedge before the pond? I advise yes: the pond needs its shade.')
  assert.equal(need.canAnswer, true)
})

test('nothing for the person: an Advisor that is free without a "For you" block, or that works', () => {
  assert.equal(advisorNeed(build({ advisor: [typed(NOW - 20 * MIN, 'What first?'), answer(NOW - 12 * MIN, 'The hedge. Nothing for you to decide.')] })), null)
  assert.equal(advisorNeed(build({ advisor: [typed(NOW - 3 * MIN, 'And then?'), step(NOW - 2 * MIN, 'Read the plan')] })), null)
})

test('a question asked with the app\'s own form stands there too, answered only in its chat', () => {
  const form = assistant(NOW - 9 * MIN, 'tool_use', [text('One choice.'), tool('AskUserQuestion', {
    questions: [{ question: 'Hedge or pond first?', header: 'Order', options: [{ label: 'Hedge', description: '' }, { label: 'Pond', description: '' }], multiSelect: false }],
  })])
  const need = advisorNeed(build({ advisor: [typed(NOW - 20 * MIN, 'What first?'), form] }))
  assert.equal(need.title, 'Asked you a question in its chat')
  assert.equal(need.canAnswer, false)
  assert.deepEqual(need.waits.questions, [{ question: 'Hedge or pond first?', options: ['Hedge', 'Pond'] }])
})

test('a refine, an answer to a recommendation and a round of the board\'s clock keep their own places', () => {
  const after = opening => build({ advisor: [opening, step(NOW - 15 * MIN, 'Read'), toolResult(NOW - 14 * MIN), answer(NOW - 12 * MIN, FOR_YOU)], summary: 'Answer the questions' })
  assert.equal(advisorNeed(after(typed(NOW - 20 * MIN, 'refine step\nStep: B12 Plant the hedge\nRound: 1\n(typed on the worker board, 09:40)'))), null)
  assert.equal(advisorNeed(after(typed(NOW - 20 * MIN, 'advisor recommendation: no\nRecommended: Dig the pond\nReason: later\n(typed on the worker board, 09:40)'))), null)
  assert.equal(advisorNeed(after(typed(NOW - 20 * MIN, 'Round from the board\'s clock: morning\nYour job: C:\\board\\roles\\advisor.md'))), null)
  // What the person or another chat started is the Advisor's own question.
  assert.notEqual(advisorNeed(after(typed(NOW - 20 * MIN, 'Is the plan right?'))), null)
  assert.notEqual(advisorNeed(after(fromChat(NOW - 20 * MIN, 'Garden · Lead', 'From Lead: the check before work on B12.'))), null)
})

test('the answer goes straight into the Advisor\'s chat, as an answer of the person, never to the main chat', () => {
  const state = build({ advisor: [typed(NOW - 20 * MIN, 'What first?'), answer(NOW - 12 * MIN, FOR_YOU)] })
  const need = advisorNeed(state)
  const said = checkSay({ to: 'Advisor', ask: need.id, text: '1. yes' }, state, 4000)
  assert.equal(said.ok, true)
  assert.equal(said.message.to, 'Advisor')
  assert.equal(said.message.ask, need.id)
  assert.equal(messageText({ ...said.message, at: NOW }, () => '10:00'), '(answered on the worker board, 10:00) 1. yes')
  // Not as the main chat's: that one has no such question.
  assert.equal(checkSay({ to: 'Lead', ask: need.id, text: '1. yes' }, state, 4000).ok, false)
})

test('once answered, its card says so while the answer is on its way and a little after, also when it went on', () => {
  const lines = [typed(NOW - 20 * MIN, 'What first?'), answer(NOW - 12 * MIN, FOR_YOU)]
  const id = `chat:Advisor:${NOW - 12 * MIN}`
  const sent = state => ({ id: 'a1', at: NOW - 2 * MIN, to: 'Advisor', ask: id, step: null, title: 'Advisor needs your answer', version: null, verdict: null, text: '1. yes', state })
  assert.equal(advisorNeed(build({ advisor: lines, outbox: [sent('waiting')] })).answer.text, '1. yes')
  // It took the answer and works on it: the card stays, with nothing left to answer.
  const working = build({ advisor: [...lines, typed(NOW - MIN, '(answered on the worker board, 09:58) 1. yes'), step(NOW - MIN, 'Write the plan')], outbox: [sent('delivered')] })
  const kept = advisorNeed(working)
  assert.equal(kept.title, 'Waited for you')
  assert.equal(kept.canAnswer, false)
  // Long after, it is gone.
  assert.equal(advisorNeed(build({ advisor: [...lines, typed(NOW - MIN, '1. yes'), step(NOW - MIN, 'Write')], outbox: [{ ...sent('delivered'), deliveredAt: NOW - 60 * MIN }] })), null)
})

// The page: the Advisor's window is drawn as the main chat's, and leads to the talk with it on its tab.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('waiting')}\nObject.assign(this, { waitingOf })`, page)

test('the window knows the Advisor, shows its answer and questions as the main chat\'s, and opens the talk with it', () => {
  const need = { id: 'chat:Advisor:1', isAdvisor: true, canAnswer: true, answer: null, text: '', task: null, waits: { at: NOW, words: FOR_YOU, questions: [], plan: null, handover: null, given: null } }
  assert.equal(page.waitingOf(need, NOW).isAdvisor, true)
  assert.equal(page.waitingOf({ ...need, isAdvisor: undefined }, NOW).isAdvisor, false)
  assert.match(script, /if \(waiting\.isMain \|\| waiting\.isAdvisor\) return mainParts\(waiting, needId\)/)
  const parts = script.slice(script.indexOf('function mainParts'), script.indexOf('function itemsPart'))
  assert.ok(parts.includes("open.dataset.showAdvisor = 'chat'"), 'the Advisor\'s window opens its chat on the Advisor tab')
  assert.match(script, /const advisor = event\.target\.closest\('\[data-show-advisor\]'\)\n\s+if \(advisor !== null\) \{\n\s+closeDetails\(\)\n\s+show\('advice'\)\n\s+showAdvisorPane\(advisor\.dataset\.showAdvisor\)/)
})

// Its job text: it asks the person itself, once, and tells the main chat only what it asked.

const plain = async name => (await readFile(join(ROOT, 'roles', name), 'utf8')).replace(/\s+/g, ' ')
const advisorJob = await plain('advisor.md')
const mainJob = await plain('main.md')

test('the Advisor asks the person in its own chat and tells the main chat in one line what it asked', () => {
  assert.match(advisorJob, /Whoever asks the user asks once/)
  assert.match(advisorJob, /ask it in your own chat, in a "For you" block/)
  assert.match(advisorJob, /tell the main chat in one line only what you asked/)
  assert.match(advisorJob, /A refine, a suggestion, a recommendation and an ask on the goal map keep their own places/)
  assert.match(mainJob, /What a worker or the Advisor asked the user in its own chat/)
})

// The review's cases: a question that still waits after a turn the board started, a long turn, the app's form, and
// the person's own words that only look like the board's.

const ROUND = 'Round from the board\'s clock: morning\nYour job: C:\board\roles\advisor.md'

test('a question asked before a round or a refine still waits after it, with its own words, until the person speaks again', () => {
  const asked = [typed(NOW - 50 * MIN, 'What first?'), answer(NOW - 40 * MIN, FOR_YOU)]
  const roundAfter = [typed(NOW - 10 * MIN, ROUND), step(NOW - 9 * MIN, 'Read the backlog'), toolResult(NOW - 8 * MIN), answer(NOW - 5 * MIN, 'Two suggestions are on the backlog.')]
  const need = advisorNeed(build({ advisor: [...asked, ...roundAfter], summary: 'Look at the two suggestions' }))
  assert.equal(need.id, `chat:Advisor:${NOW - 40 * MIN}`)
  assert.equal(need.text, 'Plant the hedge before the pond? I advise yes: the pond needs its shade.', 'not the app\'s line about the round')
  assert.equal(need.waits.handover.items.length, 1)
  const refineAfter = [typed(NOW - 10 * MIN, 'refine step\nStep: B12 Plant the hedge\nRound: 1\n(typed on the worker board, 09:50)'), answer(NOW - 5 * MIN, 'The refine block is written.')]
  assert.equal(advisorNeed(build({ advisor: [...asked, ...roundAfter, ...refineAfter] })).id, need.id)
  // The person spoke after it: that turn's answer counts, and it asks nothing.
  assert.equal(advisorNeed(build({ advisor: [...asked, typed(NOW - 20 * MIN, 'Later.'), answer(NOW - 19 * MIN, 'Fine.'), ...roundAfter] })), null)
  // A round that runs hides it until the round has ended.
  assert.equal(advisorNeed(build({ advisor: [...asked, typed(NOW - 2 * MIN, ROUND), step(NOW - MIN, 'Read')] })), null)
})

test('a round longer than the tail is still known as the board\'s by the longer look back', () => {
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}',
    appChatTexts: [app('Lead'), app('Advisor')],
    tails: { 'cli-Advisor': { text: [step(NOW - 30 * MIN, 'Review the code'), toolResult(NOW - 29 * MIN), answer(NOW - 12 * MIN, FOR_YOU)].join('\n'), isCut: false, modifiedAt: NOW, earlier: typed(NOW - 90 * MIN, ROUND) } },
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  assert.equal(advisorNeed(buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })), null)
})

test('a question in the app\'s own form during a refine still stands, answered in its chat', () => {
  const form = assistant(NOW - 9 * MIN, 'tool_use', [tool('AskUserQuestion', { questions: [{ question: 'Which hedge?', options: [{ label: 'Beech' }, { label: 'Yew' }] }] })])
  const need = advisorNeed(build({ advisor: [typed(NOW - 20 * MIN, 'refine step\nStep: B12 Plant the hedge\nRound: 1'), form] }))
  assert.equal(need.canAnswer, false)
  assert.deepEqual(need.waits.questions.map(one => one.question), ['Which hedge?'])
})

test('only the board\'s own first lines pass a turn over; the person\'s words that start alike do not', () => {
  for (const words of ['Refine step B3 again? Or leave it.', 'Advisor recommendation: what is it?', 'Round from the board\'s clock: did it run today?']) {
    assert.notEqual(advisorNeed(build({ advisor: [typed(NOW - 20 * MIN, words), answer(NOW - 12 * MIN, FOR_YOU)] })), null, words)
  }
})

test('an Advisor held between two turns by a task from the main chat, with a "For you" block, waits for the person', () => {
  const state = build({ advisor: [fromChat(NOW - 20 * MIN, 'Garden · Lead', 'Task from Garden · Lead: check B12 before work.'), answer(NOW - 12 * MIN, FOR_YOU)] })
  assert.equal(state.advisor.state, 'working', 'the board holds it between two turns')
  assert.equal(advisorNeed(state).canAnswer, true)
})

test('the window of the main chat and of the Advisor shows a question of the app\'s own form; the check before work asks once', () => {
  const parts = script.slice(script.indexOf('function mainParts'), script.indexOf('function itemsPart'))
  assert.ok(parts.includes('const form = formParts(waiting)'))
  assert.ok(parts.includes("section('What it asks in its chat'"))
  assert.match(script, /wants\.push\(\.\.\.formParts\(waiting\)\)/)
  assert.match(advisorJob, /Answer the check to the main chat only, with no "For you" block/)
})
