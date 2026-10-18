// B309: a step's asks count as its refine questions. Seen live on 2026-10-18: the board sent the Advisor a fold round
// for a step whose refine block listed no questions of its own, while two asks under the step (filed by its worker)
// were still open. Now every ask under a step (`Of: <step>`) counts as one of its refine questions wherever the board
// decides: open, the step waits for the person (no round goes, it is not refined, the Advisor tab lists it under "Your
// answers waiting"); answered since the block was last written, its answer waits for the Advisor's next round, as an
// answered question in the block does. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, typed } from '../fixtures/lines.mjs'
import { refinedKey } from '../src/backlog.mjs'
import { parseConfig } from '../src/config.mjs'
import { isRefined, refineWhenDue } from '../src/refineGate.mjs'
import { buildState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 17, 10, 30).getTime()
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const LIST = '{"prefix":"Studio · ","main":"Lead"}'
const CHATS = ['Lead', 'Worker 1', 'Advisor']

const BACKLOG = [
  '## Work',
  '- [ ] B12 Count the moon beetles',
  '- [ ] B20 Build the tower',
  '  Refined (round 1, by Advisor, 2026-10-17 09:00):',
  '  Summary: A tower to watch the herd from.',
  '  Size: about 2 hours',
  '- [ ] B21 Paint the bridge',
  '  Refined (round 2, by Advisor, 2026-10-17 09:00; ready):',
  '  Summary: The bridge in the herd\'s colours.',
  '  What we build:',
  '  - One coat of paint.',
  
  '',
].join('\n')

/** An ask item under a step, as the work API writes one. */
const ask = (id, of, state = 'open', since = '2026-10-17 09:00', words = null, via = null) => parseItem([
  `Id: ${id}`, 'Kind: ask', `Title: Question ${id}?`, `State: ${state}`, 'Owner: Worker 1', 'Activity: Work', `Since: ${since}`,
  'Asks: decide', 'Blocking: yes', `Of: ${of}`, ...(via === null ? [] : [`Via: ${via}`]), '', '## Text', `Question ${id}?`,
  ...(words === null ? [] : ['', '## Answer', words]),
  '', '## History', `- 2026-10-17 09:00 Worker 1: asked (decide, blocking)`, '',
].join('\n'))

/** The store of this backlog, with these asks and these History lines added to the steps (`history[id]`). */
function storeWith(asks = [], history = {}) {
  const work = storeFromText(BACKLOG, { now: NOW - 2 * HOUR })
  for (const one of asks) work.items.set(one.head.get('Id'), one)
  for (const [id, lines] of Object.entries(history)) {
    const step = work.items.get(id)
    step.sections.set('History', [...(step.sections.get('History') ?? []), ...lines])
  }
  return work
}

const app = name => JSON.stringify({
  title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: NOW - 2 * HOUR, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const rested = { text: [typed(NOW - 30 * MIN, 'Tower'), answer(NOW - 29 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW }

function build(work, outbox = []) {
  const raw = {
    listText: LIST, appChatTexts: CHATS.map(app), tails: Object.fromEntries(CHATS.map(name => [`cli-${name}`, rested])),
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const seen = { shown: Object.fromEntries(CHATS.map(name => [name, NOW - 5000])), other: {} }
  return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 10 * MIN, offSince: null }, seen, now: NOW, config })
}
const stepOf = (state, id) => state.backlog.flatMap(activity => activity.steps).find(step => step.id === id)
/** B20 and B21 are new to the board (above `since`); B12 is not, so it asks for no first round here. */
const KEPT = { since: 19, queuedBefore: [], waiting: [] }
const BASE = { ask: null, step: null, title: null, version: null, verdict: null }
const refineSent = (at, about, before) => ({ id: `r${at}${about}`, at, ...BASE, to: 'Advisor', command: 'refine', about, round: 2, board: true, before, text: `refine step\nStep: ${about}\nRound: 2`, state: 'delivered', deliveredAt: at + 5000 })
const queueHeld = (at, about) => ({ id: `q${at}${about}`, at, ...BASE, to: 'Lead', command: 'queue', about, held: true, text: `queue step from the backlog\nStep: ${about}`, state: 'held' })

// The Advisor tab's Refine part, out of the page's script (as refineList.test.mjs reads it).
const here = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(here, '..', 'public', 'board.js'), 'utf8')
const page = {}
vm.runInNewContext(`${script.slice(script.indexOf('// refinelist:start'), script.indexOf('// refinelist:end'))}\nObject.assign(this, { refineGroups })`, page)
const groupOf = (state, id) => JSON.parse(JSON.stringify(page.refineGroups(state.backlog))).find(group => group.steps.some(one => one.id === id))?.state ?? null

test('an open ask under a step whose block lists no question: your answers waiting, not refined, no round sent', () => {
  const state = build(storeWith([ask('Q1', 'B20'), ask('Q2', 'B20')], { B20: ['- 2026-10-17 09:00 Advisor: refined, round 1'] }))
  const step = stepOf(state, 'B20')
  assert.deepEqual(step.refined.questions, [])
  assert.equal(step.refineState, 'answers')
  assert.equal(isRefined(step.refined), false)
  assert.equal(refineWhenDue(state, [], KEPT, NOW).refine, null)
  // The Advisor tab lists it under "Your answers waiting".
  assert.equal(groupOf(state, 'B20'), 'answers')
})

test('one of the asks answered, one still open: it still waits for the person', () => {
  const work = storeWith([ask('Q1', 'B20', 'answered', '2026-10-17 10:00', 'Stone.'), ask('Q2', 'B20')], {
    B20: ['- 2026-10-17 09:00 Advisor: refined, round 1', '- 2026-10-17 10:00 person: Q1 answered'],
  })
  const state = build(work)
  assert.equal(stepOf(state, 'B20').refineState, 'answers')
  assert.equal(refineWhenDue(state, [], KEPT, NOW).refine, null)
})

test('the last ask answered: its answers wait for the next round, and the board sends one fold round', () => {
  const open = build(storeWith([ask('Q1', 'B20'), ask('Q2', 'B20')], { B20: ['- 2026-10-17 09:00 Advisor: refined, round 1'] }))
  const keyThen = refinedKey(stepOf(open, 'B20').refined)
  const work = storeWith([ask('Q1', 'B20', 'answered', '2026-10-17 10:00', 'Stone.'), ask('Q2', 'B20', 'answered', '2026-10-17 10:01', 'Tall.')], {
    B20: ['- 2026-10-17 09:00 Advisor: refined, round 1', '- 2026-10-17 10:00 person: Q1 answered', '- 2026-10-17 10:01 person: Q2 answered'],
  })
  // The board asked about the block while the asks were open (B309's live case): the answers make it a block not asked about.
  const outbox = [refineSent(NOW - HOUR, 'B20', keyThen)]
  const state = build(work, outbox)
  const step = stepOf(state, 'B20')
  assert.equal(step.refineState, 'answered')
  assert.equal(isRefined(step.refined), false)
  assert.notEqual(refinedKey(step.refined), keyThen)
  assert.equal(groupOf(state, 'B20'), 'answered')
  const { refine } = refineWhenDue(state, outbox, KEPT, NOW)
  assert.equal(refine?.about, 'B20')
  assert.equal(refine.before, refinedKey(step.refined))
  // The words name the asks whose answers to fold in.
  assert.match(refine.text, /Q1, Q2/)
  // Once asked about the block as it stands, no second round.
  assert.equal(refineWhenDue(state, [...outbox, { ...refine, id: 'r2', at: NOW, state: 'delivered' }], KEPT, NOW + MIN).refine, null)
})

test('the Advisor\'s next write folds them in: an ask answered before the block\'s last write no longer counts', () => {
  const work = storeWith([ask('Q1', 'B21', 'answered', '2026-10-17 08:00', 'Blue.'), ask('Q3', 'B20', 'withdrawn')], {
    B21: ['- 2026-10-17 08:00 person: Q1 answered', '- 2026-10-17 09:00 Advisor: refined is ready'],
    B20: ['- 2026-10-17 09:00 Advisor: refined, round 1'],
  })
  const state = build(work)
  assert.equal(stepOf(state, 'B21').refineState, 'ready')
  assert.equal(isRefined(stepOf(state, 'B21').refined), true)
  // A withdrawn ask is no question.
  assert.equal(stepOf(state, 'B20').refineState, 'answered')
})

test('the same minute as the write: the order of the step\'s History decides', () => {
  const work = storeWith([ask('Q1', 'B21', 'answered', '2026-10-17 09:00', 'Blue.')], {
    B21: ['- 2026-10-17 09:00 person: Q1 answered', '- 2026-10-17 09:00 Advisor: refined is ready'],
  })
  assert.equal(stepOf(build(work), 'B21').refineState, 'ready')
  const after = storeWith([ask('Q1', 'B21', 'answered', '2026-10-17 09:00', 'Blue.')], {
    B21: ['- 2026-10-17 09:00 Advisor: refined is ready', '- 2026-10-17 09:00 person: Q1 answered'],
  })
  assert.equal(stepOf(build(after), 'B21').refineState, 'answered')
})

test('a ready step with an ask filed after it is not refined: a held queue ask waits, and goes once it is folded in', () => {
  const outbox = [queueHeld(NOW - 10 * MIN, 'B21')]
  const open = build(storeWith([ask('Q4', 'B21')], { B21: ['- 2026-10-17 09:00 Advisor: refined is ready', '- 2026-10-17 09:30 Worker 1: asked Q4'] }), outbox)
  assert.equal(stepOf(open, 'B21').refineState, 'answers')
  assert.equal(groupOf(open, 'B21'), 'answers')
  // Only B21 is new here, so B20 (answered, no asks) asks for nothing.
  const kept = { ...KEPT, since: 20 }
  let due = refineWhenDue(open, outbox, kept, NOW)
  assert.deepEqual([due.release, due.refine], [[], null])
  const answered = build(storeWith([ask('Q4', 'B21', 'answered', '2026-10-17 10:00', 'Yes.')], {
    B21: ['- 2026-10-17 09:00 Advisor: refined is ready', '- 2026-10-17 09:30 Worker 1: asked Q4', '- 2026-10-17 10:00 person: Q4 answered'],
  }), outbox)
  due = refineWhenDue(answered, outbox, kept, NOW)
  assert.deepEqual([due.release, due.refine?.about, due.refine?.why], [[], 'B21', 'queue'])
  // A ready block with answers to fold in is not "checked again": its words say what to fold in.
  assert.doesNotMatch(due.refine.text, /check it again/)
  assert.match(due.refine.text, /Q4/)
})

test('a step without a refine block keeps its first round: an open ask holds back only a fold round', () => {
  const state = build(storeWith([ask('Q5', 'B12')]))
  assert.equal(stepOf(state, 'B12').refineState, 'none')
  assert.equal(refineWhenDue(state, [], { since: 11, queuedBefore: [], waiting: [] }, NOW).refine?.about, 'B12')
})

test('the refine\'s own question answered in the step\'s window counts as the block\'s answer, not twice', () => {
  // As the live store had it: answered in the window and folded in within the same minute, no "Q<n> answered" line.
  const work = storeWith([ask('Q7', 'B21', 'answered', '2026-10-17 09:00', 'yes', 'refine')], {
    B21: ['- 2026-10-17 09:00 person: answered the refine questions', '- 2026-10-17 09:00 Advisor: refined is ready'],
  })
  assert.equal(stepOf(build(work), 'B21').refineState, 'ready')
  // Open, it is still a question that waits.
  assert.equal(stepOf(build(storeWith([ask('Q7', 'B20', 'open', '2026-10-17 09:00', null, 'refine')])), 'B20').refineState, 'answers')
})

test('an ask under another step changes nothing', () => {
  const state = build(storeWith([ask('Q6', 'B12')], { B21: ['- 2026-10-17 09:00 Advisor: refined is ready'] }))
  assert.equal(stepOf(state, 'B21').refineState, 'ready')
  assert.equal(stepOf(state, 'B20').refineState, 'answered')
})
