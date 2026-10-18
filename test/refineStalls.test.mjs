// B312: the board's own refining stalls no more without a word. Seen live on 2026-10-18 at 13:29: the person answered
// Q31 (an ask under B35) at 13:01, the Advisor's card said "Your answers on B35 wait for it", and nothing went to the
// Advisor: B35 is an old step, which the board refined only once it was about to be queued, and its tries per step
// counted every round, also those before new answers. Now an answer given after a step's last refine round (an ask
// under it, or the refine questions in its block) is folded in by a round of the board's own, the cap counts only the
// rounds since the last answer, and a step the board stopped on says so on the Advisor's card ("Send again") and in
// the Advisor tab's refine list. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { BOARD_TRIES, refineStop, refineWhenDue } from '../src/refineGate.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const style = await readFile(join(HERE, '..', 'public', 'board.css'), 'utf8')

const MIN = 60_000
const HOUR = 60 * MIN
const at = (hour, minute = 0) => new Date(2026, 9, 17, hour, minute).getTime()
const NOW = at(10, 30)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const CHATS = ['Lead', 'Worker 1', 'Advisor']
const two = n => String(n).padStart(2, '0')
const stamp = when => {
  const date = new Date(when)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

// B11: an old step, refined and ready at 01:10. B20: a new step without a block.
const BACKLOG = [
  '## Work',
  '- [ ] B11 Paint the narwhal bridge',
  `  Refined (${stamp(at(1, 10))}; ready):`,
  '  Summary: The bridge in blue.',
  '  Picture: pictures/bridge/v1.png (the bridge)',
  '  Part of: G9',
  '  Size: about 1 hour',
  '  What we build:',
  '  - The bridge, blue on both sides.',
  '- [ ] B20 Build the tower',
  '',
].join('\n')

const app = name => JSON.stringify({
  title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: NOW - 2 * HOUR, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const rested = { text: [typed(NOW - 30 * MIN, 'Zebracorn'), answer(NOW - 29 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW }

/** An ask under a step, answered by the person at `when`, and the line its answer writes under the step. */
const answered = (id, of, when) => ({
  ask: parseItem(`Id: ${id}\nKind: ask\nTitle: Is it fun?\nState: answered\nOwner: Lead\nSince: ${stamp(when)}\nAsks: look\nOf: ${of}\n\n## History\n- ${stamp(when)} person: answered: Not yet.\n\n## Answer\nNot yet.\n`),
  line: `- ${stamp(when)} person: ${id} answered`,
  of,
})

/** The board with its chats at rest, this store (with these answers), and what was sent. */
function build({ outbox = [], answers = [] } = {}) {
  const work = storeFromText(BACKLOG, { now: NOW - 12 * HOUR })
  for (const one of answers) {
    work.items.set(one.ask.head.get('Id'), one.ask)
    work.items.get(one.of).sections.get('History').push(one.line)
  }
  const raw = {
    listText: '{"prefix":"Studio · ","main":"Lead"}',
    appChatTexts: CHATS.map(app),
    tails: Object.fromEntries(CHATS.map(name => [`cli-${name}`, rested])),
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const seen = { shown: Object.fromEntries(CHATS.map(name => [name, NOW - 5000])), other: {} }
  return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 10 * MIN, offSince: null }, seen, now: NOW, config })
}
const gate = since => ({ since, queuedBefore: [], waiting: [] })
const stepOf = (state, id) => state.backlog.flatMap(activity => activity.steps).find(step => step.id === id)
const BASE = { ask: null, step: null, title: null, version: null, verdict: null }
/** The board's own refine rounds for a step, `n` of them, an hour apart, the last at `last`. */
const tries = (about, n, last = NOW - 3 * HOUR) => Array.from({ length: n }, (_, k) => ({
  id: `t${about}${k}`, at: last - (n - 1 - k) * HOUR, ...BASE, to: 'Advisor', command: 'refine', about, round: k + 1,
  text: `refine step\nStep: ${about}\nRound: ${k + 1}`, state: 'delivered', deliveredAt: last - (n - 1 - k) * HOUR + 5000, board: true, before: `x${k}`,
}))

test('an answer under an old step after its last round is folded in by a round of the board\'s own', () => {
  // B35, 2026-10-18: ready at 11:10, Q31 under it answered at 13:01.
  const q5 = answered('Q5', 'B11', at(9, 0))
  const state = build({ answers: [q5] })
  assert.equal(stepOf(state, 'B11').refineState, 'answered')
  const due = refineWhenDue(state, [], gate(20), NOW)
  assert.deepEqual([due.refine?.about, due.refine?.why, due.refine?.board], ['B11', 'answer', true])
  assert.match(due.refine.text, /^refine step\nStep: B11 Paint the narwhal bridge\nRound: 2\n/)
  // Once that round is sent, not again for the same block.
  const sent = { ...due.refine, id: 'f1', at: NOW, state: 'delivered' }
  assert.equal(refineWhenDue(build({ answers: [q5], outbox: [sent] }), [sent], gate(20), NOW + MIN).refine, null)
  // Without a new answer an old ready step is left alone.
  assert.equal(refineWhenDue(build(), [], gate(20), NOW).refine, null)
})

test('the cap counts only the board\'s rounds since the last answer', () => {
  const three = tries('B20', 3)
  assert.equal(BOARD_TRIES, 3)
  assert.equal(refineWhenDue(build({ outbox: three }), three, gate(19), NOW).refine, null)
  // An answer after the third round: the count starts again.
  const after = answered('Q6', 'B20', NOW - 2 * HOUR)
  assert.equal(refineWhenDue(build({ outbox: three, answers: [after] }), three, gate(19), NOW).refine?.about, 'B20')
  // An answer after the first round: two count, one more may go.
  const between = answered('Q6', 'B20', NOW - 4 * HOUR - 30 * MIN)
  assert.equal(refineWhenDue(build({ outbox: three, answers: [between] }), three, gate(19), NOW).refine?.about, 'B20')
  // An answer before them all changes nothing.
  const before = answered('Q6', 'B20', NOW - 6 * HOUR)
  assert.equal(refineWhenDue(build({ outbox: three, answers: [before] }), three, gate(19), NOW).refine, null)
})

test('a step the board stopped on says so: its refine state is "stopped", with the rounds', () => {
  const three = tries('B20', 3)
  const stopped = stepOf(build({ outbox: three }), 'B20')
  assert.equal(stopped.refineState, 'stopped')
  assert.deepEqual(stopped.refineStop, { rounds: 3, at: NOW - 3 * HOUR })
  assert.deepEqual(refineStop(stopped, three), { rounds: 3, at: NOW - 3 * HOUR })
  // Two rounds, or a new answer since: not stopped.
  assert.equal(stepOf(build({ outbox: three.slice(0, 2) }), 'B20').refineState, 'none')
  const fresh = stepOf(build({ outbox: three, answers: [answered('Q6', 'B20', NOW - 2 * HOUR)] }), 'B20')
  assert.deepEqual([fresh.refineState, fresh.refineStop], ['none', null])
  // The person's own rounds (the Refine button, Send again) are not the board's: they never stop it.
  const own = three.map(message => ({ ...message, board: undefined }))
  assert.equal(stepOf(build({ outbox: own }), 'B20').refineState, 'none')
})

const page = {}
vm.runInNewContext(`${script.slice(script.indexOf('// advisorrefine:start'), script.indexOf('// advisorrefine:end'))}\n${script.slice(script.indexOf('// refinelist:start'), script.indexOf('// refinelist:end'))}\nObject.assign(this, { advisorRefine, refineGroups })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

test('the Advisor\'s card says the refine stopped and offers Send again, which types the Refine button\'s words', () => {
  const step = (id, more = {}) => ({ id, key: id, title: `Step ${id}`, status: 'open', refineAsk: null, refineState: 'none', refineStop: null, ...more })
  const backlog = steps => [{ name: 'Meadow', steps }]
  const stopped = step('B35', { refineState: 'stopped', refineStop: { rounds: 3, at: NOW } })
  assert.deepEqual(plain(page.advisorRefine(backlog([stopped]))), { step: 'B35', text: 'Refine of B35 stopped after 3 rounds without new answers', tone: 'stopped', canSend: true })
  // A round in hand comes first; a stop before answers that wait (those the board folds in by itself).
  assert.equal(page.advisorRefine(backlog([stopped, step('B31', { refineAsk: { isOpen: true, round: 2, state: 'delivered' } })])).step, 'B31')
  assert.equal(page.advisorRefine(backlog([step('B30', { refineState: 'answered' }), stopped])).step, 'B35')
  // Its button, on the card, and what a click sends: the Refine button's message.
  const start = script.indexOf('function drawAdvisorLane(')
  const card = script.slice(start, script.indexOf("$('lanes').addEventListener('click'", start))
  assert.match(card, /if \(refine\.canSend === true\)/)
  assert.match(card, /'Send again'/)
  assert.match(card, /dataset\.refineAgain = refine\.step/)
  assert.match(script, /closest\('\[data-refine-again\]'\)/)
  assert.match(script, /send\(\{ to: advisor, command: 'refine', step: again\.dataset\.refineAgain \}, `refine-again:\$\{again\.dataset\.refineAgain\}`\)/)
  // A click on the button does not open the Advisor's chat as a click on the card does.
  assert.match(script, /event\.target\.closest\('\[data-open-advisor\]'\) === null \|\| event\.target\.closest\('\.step-line, \[data-refine-again\]'\) !== null/)
  assert.ok(style.includes('.advisor-refine-state.is-stopped'))
})

test('the Advisor tab\'s refine list shows a stopped step under its own state', () => {
  const step = (id, refineState) => ({ key: id, id, title: `Step ${id}`, status: 'open', refineState })
  const groups = plain(page.refineGroups([{ name: 'Work', steps: [step('B35', 'stopped'), step('B36', 'answered')] }]))
  assert.deepEqual(groups.map(group => group.state), ['none', 'asking', 'answers', 'answered', 'stopped', 'ready'])
  const stopped = groups.find(group => group.state === 'stopped')
  assert.equal(stopped.title, 'Stopped: no new answers since its last rounds')
  assert.deepEqual(stopped.steps.map(one => one.id), ['B35'])
})
