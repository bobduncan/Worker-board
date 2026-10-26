// The person, 2026-10-26: "is the advisor currently working on them or not. is it in its queue?" and, looking at the
// Backlog: "it says worker 4 is doing something" (B701 in review, Worker 4 free, B701 waiting for its result check). The
// board shows ALL the Advisor's waiting work (result checks, refines, the questions it answers first), each with where it
// stands (in its queue since HH:MM, or the Advisor is on it), each a link; the Advisor's task line names the item it is on
// (X76, B701, Q423) from the board's word it took; and a step in review reads as built by its worker, waiting for its
// check. Facts only: the board's words to the Advisor (result-check, refine, partner-ask, incident) with their outbox states,
// the store's items, the Advisor's current task. Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, step as stepLine, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { advisorWorkOf } from '../src/work/advisorWork.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 26, 16, 30).getTime()
const ago = minutes => NOW - minutes * MIN

// ---- the module ----

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const itemsOf = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
/** A step in review whose board check passed `minutes` ago and that has no result check yet. */
const review = (id, minutes, owner = 'Digger') => item(
  { Id: id, Kind: 'step', Title: `Title of ${id}`, State: 'review', Owner: owner, Since: stamp(ago(minutes)) },
  { 'What we build': ['- a lamp at every bench'], History: [`- ${stamp(ago(minutes))} server: check passed: merged`] },
)
const incident = (id, state) => item({ Id: id, Kind: 'incident', Title: `Incident ${id}`, State: state, Since: stamp(ago(300)) })
const word = (extra = {}) => ({ id: `w-${Math.random()}`, at: ago(16), to: 'Advisor', command: 'result-check', about: 'B701', text: 'check step', state: 'waiting', ...extra })
const work = (items, more = {}) => advisorWorkOf({ items, outbox: [], questions: [], refines: [], titleOf: id => items.get(id)?.head.get('Title') ?? null, ...more })
const plain = value => JSON.parse(JSON.stringify(value))

test('a step in review waiting for its first check stands in the Advisor\'s queue since the board asked; built by its worker', () => {
  const items = itemsOf(review('B701', 20, 'Worker 4'))
  // No word at all: it waits for its check, queued since the board's check passed.
  assert.deepEqual(plain(work(items).waiting), [{ kind: 'check', id: 'B701', title: 'Title of B701', who: 'Worker 4', stand: { kind: 'queued', since: ago(20) } }])
  // The board's word waits: queued since the word.
  assert.deepEqual(plain(work(items, { outbox: [word({ at: ago(16) })] }).waiting[0].stand), { kind: 'queued', since: ago(16) })
  // The sync check's "unchecked" word is the same ask.
  assert.equal(work(items, { outbox: [word({ command: 'work', kind: 'sync', syncKey: 'unchecked B701 1', state: 'delivered', takenAt: ago(5) })] }).waiting[0].stand.kind, 'working')
})

test('the Advisor is checking it: its word was taken (or typed); an old round\'s word, a failed one and another step\'s count for nothing', () => {
  const items = itemsOf(review('B701', 20))
  const stand = outbox => work(items, { outbox }).waiting[0].stand
  assert.deepEqual(plain(stand([word({ state: 'taken', takenAt: ago(14) })])), { kind: 'working', since: ago(14) })
  assert.deepEqual(plain(stand([word({ state: 'delivered', takenAt: ago(14), deliveredAt: ago(13) })])), { kind: 'working', since: ago(14) })
  // A word of the round before the board's check passed (the step went back to review): not this wait's.
  assert.equal(stand([word({ at: ago(90), state: 'delivered', takenAt: ago(89) })]).kind, 'queued')
  assert.equal(stand([word({ state: 'failed' })]).kind, 'queued')
  assert.equal(stand([word({ about: 'B702', state: 'taken', takenAt: ago(14) })]).kind, 'queued')
  assert.equal(stand([word({ command: 'refine', state: 'taken', takenAt: ago(14) })]).kind, 'queued')
})

test('the Advisor is checking it: its own task names the step', () => {
  const items = itemsOf(review('B701', 20))
  assert.deepEqual(plain(work(items, { task: { text: 'Check B701, then B702', startedAt: ago(8) } }).waiting[0].stand), { kind: 'working', since: ago(8) })
  assert.equal(work(items, { task: { text: 'Check B7011' } }).waiting[0].stand.kind, 'queued')
})

test('a step in review that waits for something else is not waiting for the Advisor', () => {
  // Its result check failed and made an open fix: it waits for the fix.
  const failed = item(
    { Id: 'B703', Kind: 'step', Title: 'T', State: 'review', Owner: 'Digger', Since: stamp(ago(60)) },
    { 'What we build': ['- a lamp'], History: [`- ${stamp(ago(60))} server: check passed: merged`, `- ${stamp(ago(40))} Checker: result check failed: 5 of 7 points pass; fix B704 for Digger`] },
  )
  const fix = item({ Id: 'B704', Kind: 'step', Title: 'Fix', State: 'in progress', Owner: 'Digger', 'Fix of': 'B703', Since: stamp(ago(30)) })
  assert.deepEqual(work(itemsOf(failed, fix)).waiting, [])
  // Nothing to check (no points and no standard): the board's own check closes it.
  const bare = item({ Id: 'B705', Kind: 'step', Title: 'T', State: 'review', Owner: 'Digger', Since: stamp(ago(60)) }, { History: [`- ${stamp(ago(60))} server: check passed: merged`] })
  assert.deepEqual(work(itemsOf(bare)).waiting, [])
})

test('the refines it has open: queued while the word waits, on it once it took it', () => {
  const refine = (id, extra) => ({ id, title: `Title of ${id}`, word: word({ command: 'refine', about: id, round: 1, ...extra }) })
  const waiting = work(itemsOf(), { refines: [refine('B703', { at: ago(12), state: 'waiting' }), refine('B704', { at: ago(30), state: 'delivered', takenAt: ago(29) })] }).waiting
  assert.deepEqual(plain(waiting.map(one => [one.kind, one.id, one.stand])), [
    ['refine', 'B704', { kind: 'working', since: ago(29) }],
    ['refine', 'B703', { kind: 'queued', since: ago(12) }],
  ])
  assert.equal(waiting[0].who, null)
})

test('the questions it answers first come with their stand; the list puts what it is on first, then the oldest in the queue', () => {
  const items = itemsOf(review('B701', 20), review('B702', 40))
  const questions = [{ id: 'Q423', from: 'Worker 1', title: 'Merge the chain?', stand: { kind: 'queued', since: ago(10), toYouAt: ago(-20) } }]
  const list = work(items, { questions, outbox: [word({ about: 'B702', state: 'taken', takenAt: ago(3) })] }).waiting
  assert.deepEqual(list.map(one => [one.kind, one.id, one.stand.kind]), [['check', 'B702', 'working'], ['check', 'B701', 'queued'], ['question', 'Q423', 'queued']])
  assert.deepEqual(plain(list[2]), { kind: 'question', id: 'Q423', title: 'Merge the chain?', who: 'Worker 1', stand: { kind: 'queued', since: ago(10), toYouAt: ago(-20) } })
})

test('the item it is on: the newest board word it took whose item is still open', () => {
  const items = itemsOf(review('B701', 20), incident('X76', 'open'), incident('X70', 'fixed'))
  const questions = [{ id: 'Q423', from: 'Worker 1', title: 'Merge the chain?', stand: { kind: 'queued', since: ago(10), toYouAt: null } }]
  const taken = (extra, at) => word({ state: 'delivered', takenAt: ago(at), ...extra })
  const on = outbox => plain(work(items, { questions, outbox }).on)
  assert.equal(on([]), null)
  assert.equal(on([word()]), null, 'a word that waits is not one it took')
  assert.deepEqual(on([taken({ command: 'incident', about: 'X76' }, 9)]), { kind: 'incident', id: 'X76', title: 'Incident X76', since: ago(9) })
  assert.deepEqual(on([taken({}, 12)]), { kind: 'check', id: 'B701', title: 'Title of B701', since: ago(12) })
  assert.deepEqual(on([taken({ kind: 'partner-ask', command: 'work', about: 'Q423' }, 7)]), { kind: 'question', id: 'Q423', title: 'Merge the chain?', since: ago(7) })
  // The newest taken one wins.
  assert.equal(on([taken({ command: 'incident', about: 'X76' }, 9), taken({}, 12), taken({ kind: 'partner-ask', command: 'work', about: 'Q423' }, 7)]).id, 'Q423')
  assert.equal(on([taken({ command: 'incident', about: 'X76' }, 5), taken({}, 12)]).id, 'X76')
  // Its item no longer open: a fixed incident, a step that is done, an ask that is answered.
  assert.equal(on([taken({ command: 'incident', about: 'X70' }, 9)]), null)
  assert.equal(on([taken({ about: 'B999' }, 9)]), null)
  assert.equal(on([taken({ kind: 'partner-ask', command: 'work', about: 'Q9' }, 7)]), null)
  // A word to nobody it answers for (a round of the clock, the person's line) names no item.
  assert.equal(on([taken({ command: 'round', about: undefined }, 4)]), null)
})

test('the item it is on: a refine it took that is still open', () => {
  const refines = [{ id: 'B703', title: 'Title of B703', word: word({ command: 'refine', about: 'B703', state: 'delivered', takenAt: ago(6), round: 1 }) }]
  assert.deepEqual(plain(work(itemsOf(), { refines, outbox: [refines[0].word] }).on), { kind: 'refine', id: 'B703', title: 'Title of B703', since: ago(6) })
  assert.equal(work(itemsOf(), { refines: [], outbox: [refines[0].word] }).on, null, 'its refine is no longer open')
})

// ---- the state ----

const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const app = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: ago(5), lastAssistantUuid: 'u-1' })
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
const planLine = task => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task: { isReported: false, ...task }, at: ago(10) })

function build({ items, advisor = [typed(ago(12), 'Plan the pond'), answer(ago(11), 'ok')], plan = null, outbox = [], steps = '' }) {
  const store = storeFromText(`## Garden\n${steps}`, { now: ago(600) })
  for (const one of items) {
    store.items.set(one.head.get('Id'), one)
    if (one.head.get('Kind') === 'step') store.activities[0].steps.push(one.head.get('Id'))
  }
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(ago(30), 'ok')]), 'cli-Digger': tail([answer(ago(30), 'ok')]), 'cli-Advisor': tail(advisor) },
    planLineTexts: plan === null ? {} : { 'cli-Advisor': planLine(plan) },
    adviceText: null, folders: null, askTexts: [], pictureLists: {}, work: store,
  }
  return buildState(raw, { lines: [], outbox, runs: [], board: null, seen: null, now: NOW, config })
}
const sent = (id, extra) => ({ id, at: ago(16), to: 'Advisor', ask: null, step: null, title: null, version: null, verdict: null, command: 'result-check', about: 'B701', text: 'check step', state: 'waiting', ...extra })

test('the state: the Advisor carries its waiting work and what it is on; a step in review carries where its check stands', () => {
  const b701 = parseItem([
    'Id: B701', 'Kind: step', 'Title: Show the damage', 'State: review', 'Owner: Garden · Digger', `Since: ${stamp(ago(20))}`, '',
    '## What we build', '- a lamp at every bench', '', '## History', `- ${stamp(ago(20))} server: check passed: merged`, '',
  ].join('\n'))
  const queued = build({ items: [b701], outbox: [sent('w1', {})] })
  assert.deepEqual(queued.advisor.waiting.map(one => [one.kind, one.id, one.title, one.who, one.stand.kind, one.stand.since]), [['check', 'B701', 'Show the damage', 'Digger', 'queued', ago(16)]])
  assert.equal(queued.advisor.on, null)
  const step = queued.backlog.flatMap(activity => activity.steps).find(one => one.id === 'B701')
  assert.deepEqual(plain(step.reviewStand), { kind: 'queued', since: ago(16) })
  assert.equal(step.reviewWait, 'waits for its first check')
  // Taken: the Advisor is checking it; with the Advisor working, its task line names B701.
  const taken = build({ items: [b701], outbox: [sent('w1', { state: 'delivered', takenAt: ago(14), deliveredAt: ago(13) })], advisor: [typed(ago(12), 'Check'), stepLine(ago(1), 'Read the report')], plan: { text: 'Checks, then incident X1', step: 1, steps: 4, names: ['Check B701'], left: 20 * MIN, stepLeft: 5 * MIN } })
  assert.equal(taken.advisor.state, 'working')
  assert.deepEqual(plain(taken.advisor.waiting[0].stand), { kind: 'working', since: ago(14) })
  assert.deepEqual(plain(taken.advisor.on), { kind: 'check', id: 'B701', title: 'Show the damage', since: ago(14) })
  // An idle Advisor is on nothing, whatever it took earlier.
  const idle = build({ items: [b701], outbox: [sent('w1', { state: 'delivered', takenAt: ago(14) })] })
  assert.notEqual(idle.advisor.state, 'working')
  assert.equal(idle.advisor.on, null)
})

test('the state: what is represented in the list is not counted again as a message waiting for it', () => {
  const b701 = parseItem(['Id: B701', 'Kind: step', 'Title: Show the damage', 'State: review', 'Owner: Digger', `Since: ${stamp(ago(20))}`, '', '## What we build', '- a lamp', '', '## History', `- ${stamp(ago(20))} server: check passed: merged`, ''].join('\n'))
  const queued = build({ items: [b701], outbox: [
    sent('w1', {}),
    sent('w2', { command: 'work', kind: 'partner-ask', about: 'Q1', text: 'work: Q1 is yours to answer for the person; run work next' }),
    sent('w3', { command: undefined, text: 'a line typed to it' }),
  ] })
  assert.equal(queued.advisor.queued.words, 1, 'only the typed line')
})
