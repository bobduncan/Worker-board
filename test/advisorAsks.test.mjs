// B275, B301: when the Advisor needs something from the person, it files an ask in the work store (`work ask`), and
// the ask stands under Needs your attention like any other. The person, 2026-10-17: "I want if the advisor needs
// something from me, it also shows in this attention tab it can talk to 'me' directly instead or always via the main
// chat". A "For you" block it wrote in its chat without filing an ask is no question the board answers: it is a warning
// that leads to its chat on the Advisor tab. A question asked with the app's own form stands there, answered in its
// chat. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, assistant, step, text, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

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

/** The time an ask's Since gives, as the store writes it (this machine's clock, to the minute). */
const sinceOf = at => {
  const date = new Date(at)
  const two = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** The board's state with a main chat, one worker and the Advisor; `asked` files the Advisor's ask in the store at that time. */
function build({ advisor, summary = null, asked = null }) {
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW - 60 * MIN })
  if (asked !== null) work.items.set('Q1', parseItem(`Id: Q1\nKind: ask\nTitle: Hedge before the pond?\nState: open\nOwner: Advisor\nSince: ${sinceOf(asked)}\nAsks: decide\nBlocking: no\nOptions: A yes | B no\nAdvice: A\n`))
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}',
    appChatTexts: [app('Lead'), app('Digger'), app('Advisor', summary)],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail(advisor) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
}
const advisorNeeds = state => state.forYou.filter(one => one.from === 'Advisor')

test('the Advisor\'s ask stands under Needs your attention, with its options and advice, answered on the board', () => {
  const state = build({ advisor: [typed(NOW - 20 * MIN, 'What first, hedge or pond?'), answer(NOW - 12 * MIN, FOR_YOU)], asked: NOW - 13 * MIN })
  const needs = advisorNeeds(state)
  assert.deepEqual(needs.map(one => [one.id, one.kind, one.title, one.canAnswer]), [['work:Q1', 'input', 'Hedge before the pond?', true]])
  assert.deepEqual(needs[0].options.map(one => [one.label, one.isRecommended]), [['A yes', true], ['B no', false]])
  // The Advisor stays off the lanes: it has its own tab.
  assert.ok(!state.chats.some(lane => lane.name === 'Advisor'))
})

test('B301: a "For you" block in its last answer without an ask is a warning that leads to its chat, never a question', () => {
  const state = build({ advisor: [typed(NOW - 20 * MIN, 'What first, hedge or pond?'), answer(NOW - 12 * MIN, FOR_YOU)], summary: 'Answer: hedge before the pond?' })
  const [need] = advisorNeeds(state)
  assert.deepEqual([need.id, need.kind, need.title, need.canAnswer, need.isAdvisor, need.isMain, need.talk, need.at], [
    `unfiled:Advisor:${NOW - 12 * MIN}`, 'unfiled', 'Advisor wrote questions in its chat but filed no ask', false, true, false, 'advisor', NOW - 12 * MIN,
  ])
  // Its answer stays readable in the window, as its words.
  assert.match(need.waits.words, /Plant the hedge before the pond\?/)
  assert.equal(state.advisor.state, 'free', 'the app\'s word that it is blocked makes it wait for nobody')
  // An ask filed in that turn and answered since is filed: no warning.
  const answered = build({ advisor: [typed(NOW - 20 * MIN, 'What first?'), answer(NOW - 12 * MIN, FOR_YOU)], asked: NOW - 13 * MIN })
  assert.equal(advisorNeeds(answered).some(one => one.kind === 'unfiled'), false)
  // One filed earlier and still open stands: the block may repeat it, so no warning beside it.
  const earlier = build({ advisor: [typed(NOW - 20 * MIN, 'What first?'), answer(NOW - 12 * MIN, FOR_YOU)], asked: NOW - 90 * MIN })
  assert.deepEqual(advisorNeeds(earlier).map(one => one.kind), ['input'])
})

test('nothing for the person: an Advisor that is free without a "For you" block, or that works', () => {
  assert.deepEqual(advisorNeeds(build({ advisor: [typed(NOW - 20 * MIN, 'What first?'), answer(NOW - 12 * MIN, 'The hedge. Nothing for you to decide.')] })), [])
  assert.deepEqual(advisorNeeds(build({ advisor: [typed(NOW - 3 * MIN, 'And then?'), step(NOW - 2 * MIN, 'Read the plan')] })), [])
  // A turn that runs is not read for a block yet.
  assert.deepEqual(advisorNeeds(build({ advisor: [typed(NOW - 20 * MIN, 'What first?'), answer(NOW - 12 * MIN, FOR_YOU), typed(NOW - 3 * MIN, 'And then?'), step(NOW - 2 * MIN, 'Read')] })), [])
})

test('a question asked with the app\'s own form stands there too, answered only in its chat; also during a refine', () => {
  const form = assistant(NOW - 9 * MIN, 'tool_use', [text('One choice.'), tool('AskUserQuestion', {
    questions: [{ question: 'Hedge or pond first?', header: 'Order', options: [{ label: 'Hedge', description: '' }, { label: 'Pond', description: '' }], multiSelect: false }],
  })])
  const [need] = advisorNeeds(build({ advisor: [typed(NOW - 20 * MIN, 'What first?'), form] }))
  assert.equal(need.title, 'Asked you a question in its chat')
  assert.equal(need.canAnswer, false)
  assert.deepEqual(need.waits.questions, [{ question: 'Hedge or pond first?', options: ['Hedge', 'Pond'] }])
  const refining = advisorNeeds(build({ advisor: [typed(NOW - 20 * MIN, 'refine step\nStep: B12 Plant the hedge\nRound: 1'), step(NOW - 15 * MIN, 'Read'), toolResult(NOW - 14 * MIN), form] }))
  assert.deepEqual(refining.map(one => [one.canAnswer, one.waits.questions[0].question]), [[false, 'Hedge or pond first?']])
})

// The page: the Advisor's window is drawn as the main chat's, and leads to the talk with it on its tab.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('waiting')}\nObject.assign(this, { waitingOf })`, page)

test('the window knows the Advisor, shows its answer as the main chat\'s, and opens the talk with it; so does a warning\'s button', () => {
  const need = { id: 'unfiled:Advisor:1', isAdvisor: true, canAnswer: false, answer: null, text: '', task: null, waits: { at: NOW, words: FOR_YOU, questions: [], plan: null, handover: null, given: null } }
  assert.equal(page.waitingOf(need, NOW).isAdvisor, true)
  assert.equal(page.waitingOf({ ...need, isAdvisor: undefined }, NOW).isAdvisor, false)
  assert.match(script, /if \(waiting\.isMain \|\| waiting\.isAdvisor\) return mainParts\(waiting\)/)
  const parts = script.slice(script.indexOf('function mainParts'), script.indexOf('const capitalized'))
  assert.ok(parts.includes("open.dataset.showAdvisor = 'chat'"), 'the Advisor\'s window opens its chat on the Advisor tab')
  assert.match(script, /const advisor = event\.target\.closest\('\[data-show-advisor\]'\)\n\s+if \(advisor !== null\) \{\n\s+closeDetails\(\)\n\s+show\('advice'\)\n\s+showAdvisorPane\(advisor\.dataset\.showAdvisor\)/)
  // B301: the warning's button: Talk to Main, the Advisor's chat, or a worker's answer in the card's window.
  assert.match(script, /open\.dataset\.openTalk = need\.talk === 'main' \|\| need\.talk === 'advisor' \? need\.talk : need\.id/)
  assert.match(script, /if \(where === 'main'\) showSide\('main'\)\n\s+else if \(where === 'advisor'\) \{\n\s+show\('advice'\)\n\s+showAdvisorPane\('chat'\)\n\s+\} else openDetails\(\{ need: where \}\)/)
})

// Its job text: it files what it needs from the person as an ask, and tells the main chat only what it asked.

const plain = async name => (await readFile(join(ROOT, 'roles', name), 'utf8')).replace(/\s+/g, ' ')
const advisorJob = await plain('advisor.md')
const mainJob = await plain('main.md')

test('the Advisor files what it needs from the person with work ask, and tells the main chat in one line what it asked', () => {
  assert.match(advisorJob, /Whoever asks the user asks once/)
  assert.match(advisorJob, /file it with `work ask`/)
  assert.match(advisorJob, /A "For you" block without an ask is not read by the board/)
  assert.match(advisorJob, /tell the main chat in one line only what you asked/)
  assert.match(mainJob, /What a worker or the Advisor asked the user/)
})

test('the window of the main chat and of the Advisor shows a question of the app\'s own form; the check before work asks once', () => {
  const parts = script.slice(script.indexOf('function mainParts'), script.indexOf('const capitalized'))
  assert.ok(parts.includes('const form = formParts(waiting)'))
  assert.ok(parts.includes("section('What it asks in its chat'"))
  assert.match(script, /wants\.push\(\.\.\.formParts\(waiting\)\)/)
  assert.match(advisorJob, /Answer the check to the main chat only, with no "For you" block/)
})
