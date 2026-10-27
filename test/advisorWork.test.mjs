// The person, 2026-10-26: "is the advisor currently working on them or not. is it in its queue?" and, looking at the
// Backlog: "it says worker 4 is doing something" (B701 in review, Worker 4 free, B701 waiting for its result check). The
// board shows ALL the Advisor's waiting work (refines, the questions it answers first), each with where it stands (in its
// queue since HH:MM, or the Advisor is on it), each a link; the Advisor's task line names the item it is on (X76, Q423) from
// the board's word it took; and a step in review reads as built by its worker, waiting for its check. T9.1.1 (the person,
// 2026-10-27: workers do the checks): the result checks are Quality Assurance tasks, no work of the Advisor's; where one
// stands is read from its task (the step's reviewStand). Facts only: the board's words to the Advisor (refine, partner-ask,
// incident) with their outbox states, the store's items, the Advisor's current task. Made-up names only.
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

test('a step in review that waits for its check is no work of the Advisor\'s: no entry, whatever words the outbox still holds', () => {
  const items = itemsOf(review('B701', 20, 'Worker 4'))
  assert.deepEqual(work(items).waiting, [])
  // An old word of the board's ("check step"), waiting or taken, names no entry and is not what it is on.
  assert.deepEqual(plain(work(items, { outbox: [word({ at: ago(16) })] })), { waiting: [], on: null })
  assert.deepEqual(plain(work(items, { outbox: [word({ state: 'taken', takenAt: ago(14) })] })), { waiting: [], on: null })
  assert.deepEqual(plain(work(items, { outbox: [word({ command: 'work', kind: 'sync', syncKey: 'unchecked B701 1', state: 'delivered', takenAt: ago(5) })] })), { waiting: [], on: null })
  // Its result check failed and made an open fix, or it has nothing to check: nothing either.
  const failed = item(
    { Id: 'B703', Kind: 'step', Title: 'T', State: 'review', Owner: 'Digger', Since: stamp(ago(60)) },
    { 'What we build': ['- a lamp'], History: [`- ${stamp(ago(60))} server: check passed: merged`, `- ${stamp(ago(40))} Checker: result check failed: 5 of 7 points pass; fix B704 for Digger`] },
  )
  const fix = item({ Id: 'B704', Kind: 'step', Title: 'Fix', State: 'in progress', Owner: 'Digger', 'Fix of': 'B703', Since: stamp(ago(30)) })
  assert.deepEqual(work(itemsOf(failed, fix)).waiting, [])
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
  const questions = [
    { id: 'Q423', from: 'Worker 1', title: 'Merge the chain?', stand: { kind: 'queued', since: ago(10), toYouAt: ago(-20) } },
    { id: 'Q424', from: 'Worker 2', title: 'Thin or thick?', stand: { kind: 'queued', since: ago(30), toYouAt: ago(-5) } },
    { id: 'Q425', from: 'Worker 3', title: 'Which tile?', stand: { kind: 'working', since: ago(3), toYouAt: ago(-5) } },
  ]
  const refines = [{ id: 'B703', title: 'Title of B703', word: word({ command: 'refine', about: 'B703', round: 1, at: ago(20), state: 'waiting' }) }]
  const list = work(itemsOf(), { questions, refines }).waiting
  assert.deepEqual(list.map(one => [one.kind, one.id, one.stand.kind]), [['question', 'Q425', 'working'], ['question', 'Q424', 'queued'], ['refine', 'B703', 'queued'], ['question', 'Q423', 'queued']])
  assert.deepEqual(plain(list[3]), { kind: 'question', id: 'Q423', title: 'Merge the chain?', who: 'Worker 1', stand: { kind: 'queued', since: ago(10), toYouAt: ago(-20) } })
})

test('the item it is on: the newest board word it took whose item is still open', () => {
  const items = itemsOf(review('B701', 20), incident('X76', 'open'), incident('X70', 'fixed'))
  const questions = [{ id: 'Q423', from: 'Worker 1', title: 'Merge the chain?', stand: { kind: 'queued', since: ago(10), toYouAt: null } }]
  const taken = (extra, at) => word({ state: 'delivered', takenAt: ago(at), ...extra })
  const on = outbox => plain(work(items, { questions, outbox }).on)
  assert.equal(on([]), null)
  assert.equal(on([word()]), null, 'a word that waits is not one it took')
  assert.deepEqual(on([taken({ command: 'incident', about: 'X76' }, 9)]), { kind: 'incident', id: 'X76', title: 'Incident X76', since: ago(9) })
  // A taken "check step" word of the board's old days names nothing it is on any more.
  assert.equal(on([taken({}, 12)]), null)
  assert.deepEqual(on([taken({ kind: 'partner-ask', command: 'work', about: 'Q423' }, 7)]), { kind: 'question', id: 'Q423', title: 'Merge the chain?', since: ago(7) })
  // The newest taken one wins.
  assert.equal(on([taken({ command: 'incident', about: 'X76' }, 9), taken({}, 12), taken({ kind: 'partner-ask', command: 'work', about: 'Q423' }, 7)]).id, 'Q423')
  assert.equal(on([taken({ command: 'incident', about: 'X76' }, 5), taken({ kind: 'partner-ask', command: 'work', about: 'Q423' }, 12)]).id, 'X76')
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

test('the state: a step in review carries where its QA task stands; the Advisor carries none of it and is on none of it', () => {
  const b701 = parseItem([
    'Id: B701', 'Kind: step', 'Title: Show the damage', 'State: review', 'Owner: Garden · Digger', `Since: ${stamp(ago(20))}`, '',
    '## What we build', '- a lamp at every bench', '', '## History', `- ${stamp(ago(20))} server: check passed: merged`, '',
  ].join('\n'))
  const task = (state, since, owner = null) => parseItem([
    'Id: B730', 'Kind: step', 'Title: Quality Assurance: B701 Show the damage', `State: ${state}`, 'Checks: B701', 'Not by: Garden · Digger', ...(owner === null ? [] : [`Owner: ${owner}`]), `Since: ${stamp(since)}`, 'Refined: ready', '',
    '## History', `- ${stamp(ago(16))} server: made for the result check of B701`, '',
  ].join('\n'))
  // Queued: made 16 minutes ago, given to nobody yet.
  const queued = build({ items: [b701, task('refined', ago(16))] })
  const step = queued.backlog.flatMap(activity => activity.steps).find(one => one.id === 'B701')
  assert.deepEqual(plain(step.reviewStand), { kind: 'queued', since: ago(16), qa: 'B730', who: null })
  assert.equal(step.reviewWait, 'waits for its first check')
  assert.deepEqual(queued.advisor.waiting, [])
  assert.equal(queued.advisor.on, null)
  // Given to a worker: still queued since it was made, the worker named.
  const given = build({ items: [b701, task('queued', ago(2), 'Garden · Lead')] })
  assert.deepEqual(plain(given.backlog.flatMap(activity => activity.steps).find(one => one.id === 'B701').reviewStand), { kind: 'queued', since: ago(16), qa: 'B730', who: 'Lead' })
  // In progress: the worker is on it since it took it.
  const working = build({ items: [b701, task('in progress', ago(9), 'Garden · Digger')] })
  assert.deepEqual(plain(working.backlog.flatMap(activity => activity.steps).find(one => one.id === 'B701').reviewStand), { kind: 'working', since: ago(9), qa: 'B730', who: 'Digger' })
  // A done or dropped task stands for nothing; a step with no task has no stand; the Advisor with an old word is on nothing.
  for (const state of ['done', 'dropped']) assert.equal(build({ items: [b701, task(state, ago(3), 'Garden · Lead')] }).backlog.flatMap(activity => activity.steps).find(one => one.id === 'B701').reviewStand, null)
  const none = build({ items: [b701], outbox: [sent('w1', { state: 'delivered', takenAt: ago(14) })] })
  assert.equal(none.backlog.flatMap(activity => activity.steps).find(one => one.id === 'B701').reviewStand, null)
  assert.deepEqual([none.advisor.waiting, none.advisor.on], [[], null])
})

test('the state: what is represented in the list is not counted again as a message waiting for it', () => {
  const b701 = parseItem(['Id: B701', 'Kind: step', 'Title: Show the damage', 'State: review', 'Owner: Digger', `Since: ${stamp(ago(20))}`, '', '## What we build', '- a lamp', '', '## History', `- ${stamp(ago(20))} server: check passed: merged`, ''].join('\n'))
  const queued = build({ items: [b701], outbox: [
    sent('w1', {}),
    sent('w2', { command: 'work', kind: 'partner-ask', about: 'Q1', text: 'work: Q1 is yours to answer for the person; run work next' }),
    sent('w3', { command: undefined, text: 'a line typed to it' }),
  ] })
  // The questions it answers are in its list; an old "check step" word that still waits is a message until the sweep closes it.
  assert.equal(queued.advisor.queued.words, 2, 'the typed line and the old word')
})
