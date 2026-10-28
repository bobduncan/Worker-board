// The person, 2026-10-28, about the Advisor's card on the Overview: "it's not clear what else will be picked up from the
// refinement. i see B774 is waiting for B774 which is also confusing. i cant click on the 5 waiting for it and get an expand of
// what those 5 are". The card's task line names the item it is on (B774); that item no longer stands in the list of what waits
// for it; "N waiting for it" is a button, "Next for it (N)", that opens the WHOLE queue in pick-up order, one row each with a
// link where it has one: the board's open words to the Advisor (the questions it answers first, the refines it was asked,
// incidents, goal evaluations, any other word), oldest first, then the steps the board will ask it to refine next. What is
// stale (an incident fixed, a step done) is not shown. The server works the words out (advisorNextOf, the state's
// `advisor.next`) and adds the refine queue (withRefineQueue, in server.mjs getState); the page only words them. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { advisorNextOf, leaveOut, withRefineQueue } from '../src/work/advisorWork.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 28, 20, 30).getTime()
const ago = minutes => NOW - minutes * MIN
const plain = value => JSON.parse(JSON.stringify(value))

// ---- the module ----

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const itemsOf = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const incident = (id, state) => item({ Id: id, Kind: 'incident', Title: `Title of ${id}`, State: state, Since: stamp(ago(300)) })
const stepItem = (id, state) => item({ Id: id, Kind: 'step', Title: `Title of ${id}`, State: state, Since: stamp(ago(300)) })
const word = (extra = {}) => ({ id: `w-${Math.random()}`, at: ago(20), to: 'Advisor', command: 'incident', about: 'X104', text: 'incident: X104 Something odd\nState: new', state: 'waiting', ...extra })
const standOf = since => ({ kind: 'queued', since })
const question = (id, since) => ({ kind: 'question', id, title: `Title of ${id}`, who: 'Worker 1', stand: { kind: 'queued', since, toYouAt: since + 30 * MIN } })
const refine = (id, since, stand = standOf(since)) => ({ kind: 'refine', id, title: `Title of ${id}`, who: null, stand })
const next = (more = {}) => advisorNextOf({ waiting: [], on: null, words: [], items: itemsOf(), ...more })
const shape = rows => rows.map(one => [one.kind, one.id])

test('the item it is on stands in no list: not in what waits for it, not in what is next for it', () => {
  const waiting = [refine('B774', ago(30), { kind: 'working', since: ago(25) }), refine('B703', ago(10)), question('Q423', ago(12))]
  const on = { kind: 'refine', id: 'B774', title: 'Title of B774', since: ago(25) }
  assert.deepEqual(shape(next({ waiting })), [['refine', 'B774'], ['question', 'Q423'], ['refine', 'B703']])
  assert.deepEqual(shape(next({ waiting, on })), [['question', 'Q423'], ['refine', 'B703']])
  assert.deepEqual(shape(leaveOut(waiting, on)), [['refine', 'B703'], ['question', 'Q423']])
  // The same id of another kind is another item; a word about the item it is on is left out too (an incident it took).
  assert.deepEqual(shape(next({ waiting: [], words: [word({ about: 'X104' }), word({ about: 'X103', text: 'incident: X103 Another' })], on: { kind: 'incident', id: 'X104' }, items: itemsOf(incident('X104', 'open'), incident('X103', 'open')) })), [['incident', 'X103']])
  assert.deepEqual(leaveOut(waiting, null), waiting)
})

test('the order: oldest first, the questions it answers, the refines it was asked, incidents, evaluations and any other word together', () => {
  const words = [
    word({ at: ago(15), about: 'X104' }),
    word({ at: ago(30), command: 'evaluate', about: 'G61', text: 'evaluate G61 Make the arena feel alive\nAttempts: 3 failed checks' }),
    word({ at: ago(5), command: undefined, about: undefined, text: 'Please look at the tree first' }),
    word({ at: ago(8), command: 'work', about: 'B12', text: 'work: B12 is yours; run work next' }),
  ]
  const waiting = [question('Q423', ago(10)), refine('B703', ago(20))]
  const rows = next({ waiting, words, items: itemsOf(incident('X104', 'open'), stepItem('B12', 'in progress')) })
  assert.deepEqual(shape(rows), [['evaluate', 'G61'], ['refine', 'B703'], ['incident', 'X104'], ['question', 'Q423'], ['work', 'B12'], ['message', null]])
  // Each row says where it stands, from the board's own facts: queued since it began to wait.
  assert.deepEqual(rows.map(one => one.stand.kind), ['queued', 'queued', 'queued', 'queued', 'queued', 'queued'])
  assert.deepEqual(rows.map(one => one.stand.since), [ago(30), ago(20), ago(15), ago(10), ago(8), ago(5)])
  // A word the Advisor took is on it (taken lately), with the time it took it.
  const taken = next({ words: [word({ state: 'taken', takenAt: ago(2) })], items: itemsOf(incident('X104', 'open')) })
  assert.deepEqual(plain(taken[0].stand), { kind: 'working', since: ago(2) })
  // Nothing waits: no rows.
  assert.deepEqual(next(), [])
})

test('a row\'s title: the store item\'s, else the first line of the word without what the board put before it, cut at 100 characters', () => {
  const rows = next({ words: [
    word({ about: 'X104', at: ago(30) }),
    word({ about: 'G61', command: 'evaluate', text: 'evaluate G61 Make the arena feel alive\nAttempts: 3', at: ago(20) }),
    word({ about: undefined, command: undefined, text: `A line typed to it ${'and on '.repeat(30)}`, at: ago(10) }),
    word({ about: 'I4', command: 'work', text: 'work: I4 your instruction', at: ago(5) }),
  ], items: itemsOf(incident('X104', 'open')) })
  assert.deepEqual(rows.map(one => one.title.length >= 100 ? `${one.title.length} chars` : one.title), ['Title of X104', 'Make the arena feel alive', '100 chars', 'your instruction'])
  assert.ok(rows[2].title.endsWith('…'))
  assert.equal(rows[2].id, null)
  // An id that is none of an item's (a worker's name, a path) is no id: the word stands without one.
  const odd = next({ words: [word({ about: 'Digger', command: 'note', text: 'note: a thing' })] })
  assert.deepEqual([odd[0].kind, odd[0].id, odd[0].title], ['note', null, 'a thing'])
})

test('the same kind and item twice is one row: a goal asked twice, once; the oldest word gives the time', () => {
  const words = [
    word({ command: 'evaluate', about: 'G61', text: 'evaluate G61 Title of G61', at: ago(40) }),
    word({ command: 'evaluate', about: 'G61', text: 'evaluate G61 Title of G61 (again: asked 20:00, not evaluated yet)', at: ago(10) }),
    word({ command: 'evaluate', about: 'G62', text: 'evaluate G62 Another', at: ago(25) }),
  ]
  const rows = next({ words })
  assert.deepEqual(shape(rows), [['evaluate', 'G61'], ['evaluate', 'G62']])
  assert.equal(rows[0].stand.since, ago(40))
  // A word of the same kind about the same item as one of its waiting list (a sync check's repeat of a refine) is that row, once.
  const again = next({ waiting: [refine('B703', ago(20))], words: [word({ command: 'work', kind: 'sync', syncKey: 'refine-again B703 2', about: 'B703', at: ago(3) }), word({ command: 'refine', about: 'B703', at: ago(3) })] })
  assert.deepEqual(shape(again), [['refine', 'B703']])
})

test('what is stale is not shown: an incident that is fixed or closed, a step that is done or dropped; nor is a round of the clock', () => {
  const items = itemsOf(incident('X1', 'fixed'), incident('X2', 'closed'), incident('X3', 'came back'), stepItem('B1', 'done'), stepItem('B2', 'dropped'), stepItem('B3', 'in progress'))
  const words = ['X1', 'X2', 'X3'].map((about, at) => word({ about, at: ago(30 - at) }))
    .concat(['B1', 'B2', 'B3'].map((about, at) => word({ command: 'work', about, text: `work: ${about} is yours`, at: ago(20 - at) })))
    .concat(word({ command: 'round', about: undefined, text: 'round: look at the goals', at: ago(25) }), word({ command: 'recheck', about: undefined, text: 'recheck', at: ago(24) }))
  assert.deepEqual(shape(next({ words, items })), [['incident', 'X3'], ['work', 'B3']])
  // The same for what waits in its list: a refine of a step that is done is no row.
  assert.deepEqual(shape(next({ waiting: [refine('B1', ago(5)), refine('B3', ago(4))], items })), [['refine', 'B3']])
  // A word about an item the store does not hold (the store is not read) is shown: nothing says it is stale.
  assert.deepEqual(shape(next({ words: [word({ about: 'X9' })] })), [['incident', 'X9']])
})

test('the steps the board asks it to refine next come after, each "next to refine", unless the item is in the list or is the one it is on', () => {
  const queue = ['B770', 'B775', 'B780'].map(id => ({ step: { id, title: `Title of ${id}` }, why: 'new' }))
  const rows = [refine('B775', ago(9)), { kind: 'incident', id: 'X104', title: 'T', who: null, stand: standOf(ago(5)) }]
  const all = withRefineQueue(rows, queue, { kind: 'refine', id: 'B780' })
  assert.deepEqual(shape(all), [['refine', 'B775'], ['incident', 'X104'], ['refine', 'B770']])
  assert.deepEqual(plain(all[2]), { kind: 'refine', id: 'B770', title: 'Title of B770', who: null, stand: { kind: 'next', since: null }, why: 'new' })
  assert.deepEqual(shape(withRefineQueue([], queue)), [['refine', 'B770'], ['refine', 'B775'], ['refine', 'B780']])
  assert.deepEqual(withRefineQueue(rows, []), rows)
})

// ---- the state ----

const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const app = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: ago(5), lastAssistantUuid: 'u-1' })
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })

function build({ items, advisor, outbox = [] }) {
  const store = storeFromText('## Garden\n', { now: ago(600) })
  for (const one of items) {
    store.items.set(one.head.get('Id'), one)
    if (one.head.get('Kind') === 'step') store.activities[0].steps.push(one.head.get('Id'))
  }
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(ago(30), 'ok')]), 'cli-Digger': tail([answer(ago(30), 'ok')]), 'cli-Advisor': tail(advisor) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work: store,
  }
  return buildState(raw, { lines: [], outbox, runs: [], board: null, seen: null, now: NOW, config })
}
const sent = (id, extra) => ({ id, at: ago(20), to: 'Advisor', ask: null, step: null, title: null, version: null, verdict: null, command: 'incident', about: 'X104', text: 'incident: X104 Something odd', state: 'waiting', ...extra })
const newStep = (id, title) => parseItem([`Id: ${id}`, 'Kind: step', `Title: ${title}`, 'State: new', `Since: ${stamp(ago(300))}`, '', '## What we build', '- a lamp', ''].join('\n'))
const openIncident = (id, state = 'open') => parseItem([`Id: ${id}`, 'Kind: incident', `Title: Title of ${id}`, `State: ${state}`, `Since: ${stamp(ago(300))}`, ''].join('\n'))

test('the state: what the Advisor is on is on its task line only; "next" holds the rest of its queue, the stale words and the clock\'s rounds left out', () => {
  const items = [newStep('B774', 'Hero hurt gets a sound'), openIncident('X104'), openIncident('X103'), openIncident('X1', 'fixed')]
  const outbox = [
    sent('w1', { command: 'refine', about: 'B774', round: 1, state: 'delivered', takenAt: ago(25), text: 'refine step\nStep: B774 Hero hurt gets a sound' }),
    sent('w2', { about: 'X104', at: ago(20) }), sent('w3', { about: 'X103', at: ago(30), text: 'incident: X103 Another' }), sent('w4', { about: 'X1', at: ago(40), text: 'incident: X1 Old' }),
    sent('w5', { command: 'evaluate', about: 'G61', at: ago(50), text: 'evaluate G61 Make the arena feel alive' }), sent('w6', { command: 'evaluate', about: 'G61', at: ago(10), text: 'evaluate G61 Make the arena feel alive' }),
    sent('w7', { command: 'round', about: undefined, at: ago(15), text: 'round: look at the goals' }),
  ]
  const state = build({ items, outbox, advisor: [typed(ago(26), 'Refine B774')] })
  assert.equal(state.advisor.state, 'working')
  assert.deepEqual(plain(state.advisor.on), { kind: 'refine', id: 'B774', title: 'Hero hurt gets a sound', since: ago(25) })
  // B774 is on its task line: not again in its list of what waits for it, nor in what is next.
  assert.deepEqual(state.advisor.waiting, [])
  assert.deepEqual(shape(state.advisor.next), [['evaluate', 'G61'], ['incident', 'X103'], ['incident', 'X104']])
  assert.deepEqual(state.advisor.next.map(one => one.title), ['Make the arena feel alive', 'Title of X103', 'Title of X104'])
  // What it counted before stays: the words by kind (the clock's round among them).
  assert.deepEqual(state.advisor.queued, { refines: 0, rounds: 1, words: 5 })
})

test('the state: while the Advisor does not work it is on nothing, so the refine it took stays in both lists', () => {
  const items = [newStep('B774', 'Hero hurt gets a sound')]
  const outbox = [sent('w1', { command: 'refine', about: 'B774', round: 1, state: 'delivered', takenAt: ago(25), text: 'refine step\nStep: B774' })]
  const state = build({ items, outbox, advisor: [typed(ago(26), 'Refine B774'), answer(ago(24), 'ok')] })
  assert.equal(state.advisor.on, null)
  assert.deepEqual(shape(state.advisor.waiting), [['refine', 'B774']])
  assert.deepEqual(shape(state.advisor.next), [['refine', 'B774']])
  assert.equal(state.advisor.next[0].stand.kind, 'taken')
})

// ---- the page ----

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
/** The source of a top-level function, by its name. */
function source(name) {
  const start = script.search(new RegExp(`^(async )?function ${name}[(]`, 'm'))
  assert.ok(start >= 0, `${name} is not in board.js`)
  const lines = script.slice(start).split('\n')
  const end = lines.findIndex((line, index) => index > 0 && line.startsWith('}'))
  return lines.slice(0, end + 1).join('\n')
}

class Node {
  constructor(tag) {
    Object.assign(this, { tag, className: '', textContent: '', children: [], dataset: {}, attrs: {}, disabled: false, title: '', type: '', href: '', tabIndex: -1, listeners: [] })
  }
  append(...items) { for (const one of items) this.children.push(typeof one === 'string' ? Object.assign(new Node('#text'), { textContent: one }) : one) }
  replaceChildren(...items) { this.children = []; this.append(...items) }
  setAttribute(name, value) { this.attrs[name] = value }
  addEventListener(name, handler) { this.listeners.push([name, handler]) }
  get childElementCount() { return this.children.filter(one => one.tag !== '#text').length }
  get firstElementChild() { return this.children.find(one => one.tag !== '#text') ?? null }
  focus() { this.isFocused = true }
}
const words = node => (node.textContent ?? '') + (node.children ?? []).map(words).join('')
const all = (node, test) => [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(one => all(one, test))]

/** The page's pieces of the Advisor's card, with the page's own parts it needs made small; `host` stands for the lanes. */
function pageWith() {
  const host = new Node('div')
  const page = { document: { createElement: tag => new Node(tag) }, problems: new Map(), sending: new Set(), board: null, host, drawn: 0 }
  vm.runInNewContext([
    'const MIN = 60000', cut('times'), cut('askstand'), cut('advisorlane'), source('el'), source('advisorProgress'), source('drawAdvisorLane'),
    'const $ = () => host', 'host.querySelector = selector => { assert.equal(selector, "[data-advisor-next]"); return all(host, node => node.dataset.advisorNext !== undefined)[0] ?? null }',
    "const drawHelperCard = () => null, icon = () => document.createElement('svg'), runChipOf = () => null, drawRunChip = () => null, advisorRefine = () => null",
    "const drawEta = () => document.createElement('div'), taskTitle = () => document.createElement('p')",
    'function drawLanes(state) { host.replaceChildren(drawAdvisorLane(state)); drawn += 1 }',
    'Object.assign(this, { advisorQueued, advisorNextHref, advisorNextWords, drawWaitingAsks, drawAdvisorLane, drawLanes, advisorNextUi })',
  ].join('\n'), Object.assign(page, { assert, all }))
  return page
}
const advisorState = more => ({
  readAt: NOW, backlog: [], withPartner: [],
  advisor: { name: 'Advisor', state: 'free', isRunning: true, task: null, on: null, doingNow: null, queued: { refines: 0, rounds: 0, words: 0 }, waiting: [], idle: null, ...more },
})
const NEXT = [
  { kind: 'evaluate', id: 'G61', title: 'Make the arena feel alive', who: null, stand: { kind: 'queued', since: ago(30) } },
  { kind: 'question', id: 'Q423', title: 'Merge the chain?', who: 'Worker 1', stand: { kind: 'queued', since: ago(10), toYouAt: ago(-20) } },
  { kind: 'incident', id: 'X104', title: 'A card left on the wrong lane', who: null, stand: { kind: 'working', since: ago(3) } },
  { kind: 'refine', id: 'B770', title: 'Show the damage', who: null, stand: { kind: 'next', since: null } },
  { kind: 'message', id: null, title: 'Please look at the tree first', who: null, stand: null },
]

test('the page: a link for each kind of item, none for another word', () => {
  const { advisorNextHref } = pageWith()
  assert.deepEqual(['B774', 'Q423', 'I4'].map(advisorNextHref), ['#details=B774', '#details=Q423', '#details=I4'])
  assert.equal(advisorNextHref('X104'), '#supervisor')
  assert.equal(advisorNextHref('G61'), '#advice/goals/G61')
  for (const none of [null, undefined, '', 'Digger', 'B', 'X', 'b12', 'B12 and more', 'T9']) assert.equal(advisorNextHref(none), null, String(none))
})

test('the page: the queue in words as the person reads it, and the count with the rounds of the clock in its tooltip', () => {
  const { advisorQueued } = pageWith()
  const view = plain(advisorQueued({ refines: 0, rounds: 2, words: 5 }, [], NEXT))
  assert.equal(view.count, 7)
  assert.equal(view.isNext, true)
  assert.equal(view.text, '1 question, 1 refine, 1 incident, 1 evaluation, 1 message, 2 rounds of the clock')
  assert.deepEqual(view.asks.map(one => [one.id, one.href, one.text, one.stand]), [
    ['G61', '#advice/goals/G61', 'evaluate G61: Make the arena feel alive', "in the Advisor's queue since 20:00"],
    ['Q423', '#details=Q423', 'Q423 · Worker 1: Merge the chain?', "in the Advisor's queue since 20:20 · comes to you at 20:50"],
    ['X104', '#supervisor', 'incident X104: A card left on the wrong lane', 'the Advisor is on it since 20:27'],
    ['B770', '#details=B770', 'refine B770: Show the damage', 'next to refine'],
    [null, null, 'message: Please look at the tree first', null],
  ])
  // Nothing waits: no button. Only the clock's rounds: the count, with nothing to open.
  assert.equal(advisorQueued({ refines: 0, rounds: 0, words: 0 }, [], []), null)
  assert.deepEqual(plain(advisorQueued({ refines: 0, rounds: 1, words: 0 }, [], [])), { count: 1, isNext: true, text: '1 round of the clock', asks: [] })
  // A server that sends no queue: the lines as they were.
  assert.equal(advisorQueued({ refines: 1, rounds: 0, words: 0 }, [{ id: 'B703', kind: 'refine', title: 'T' }]).isNext, undefined)
})

test('the page: "Next for it (N)" is a button, closed at first; a click shows the rows, a second hides them; the card\'s own click is not taken', () => {
  const page = pageWith()
  const draw = () => {
    page.drawLanes(page.board)
    const card = page.host.children[0]
    return { card, button: all(card, node => node.tag === 'button' && node.className.includes('advisor-waits-count'))[0], list: all(card, node => node.className === 'advisor-lane-asks')[0] }
  }
  page.board = advisorState({ queued: { refines: 0, rounds: 1, words: 6 }, next: NEXT, on: { kind: 'refine', id: 'B774', title: 'Hero hurt gets a sound', since: ago(25) } })
  const closed = draw()
  // The count is in the cell where "waiting for it" was, as a button; collapsed: no list.
  assert.equal(words(closed.button), 'Next for it (6)')
  assert.equal(closed.button.type, 'button')
  assert.equal(closed.button.attrs['aria-expanded'], 'false')
  assert.equal(closed.button.title, '1 question, 1 refine, 1 incident, 1 evaluation, 1 message, 1 round of the clock')
  assert.equal(closed.list, undefined)
  assert.ok(!words(closed.card).includes('waiting for it'))
  assert.equal(closed.button.disabled, false)
  // The click opens it (the board draws again) and does not open the Advisor's chat.
  let stopped = 0
  const click = button => button.listeners.filter(([name]) => name === 'click').forEach(([, handler]) => handler({ stopPropagation: () => { stopped += 1 } }))
  click(closed.button)
  assert.equal(stopped, 1)
  assert.equal(page.drawn, 2, 'the lanes were drawn again')
  const open = draw()
  assert.equal(open.button.attrs['aria-expanded'], 'true')
  assert.match(words(open.list), /^Next for it: /)
  const rows = all(open.list, node => node.className === 'advisor-lane-ask-row')
  assert.deepEqual(rows.map(words), [
    "evaluate G61: Make the arena feel alivein the Advisor's queue since 20:00",
    "Q423 · Worker 1: Merge the chain?in the Advisor's queue since 20:20 · comes to you at 20:50",
    'incident X104: A card left on the wrong lanethe Advisor is on it since 20:27',
    'refine B770: Show the damagenext to refine',
    'message: Please look at the tree first',
  ])
  assert.deepEqual(all(open.list, node => node.tag === 'a').map(node => node.href), ['#advice/goals/G61', '#details=Q423', '#supervisor', '#details=B770'])
  // The links do not open the chat either; the row without an id is no link.
  for (const link of all(open.list, node => node.tag === 'a')) assert.ok(link.listeners.some(([name]) => name === 'click'))
  assert.equal(all(open.list, node => node.tag === 'a').length, rows.length - 1)
  // The open state survives the board's redraws (the same state drawn again), and a second click closes it.
  assert.equal(draw().button.attrs['aria-expanded'], 'true')
  assert.ok(draw().list !== undefined)
  click(open.button)
  assert.equal(draw().list, undefined)
  assert.equal(draw().button.attrs['aria-expanded'], 'false')
  assert.equal(page.host.children[0] !== undefined, true)
})

test('the page: nothing waits, no button; only the clock\'s rounds, a count with nothing to open; an older server\'s line as before', () => {
  const page = pageWith()
  const cell = advisor => {
    page.board = advisorState(advisor)
    page.drawLanes(page.board)
    const card = page.host.children[0]
    return { card, cell: all(card, node => node.className === 'queue advisor-waits')[0] }
  }
  assert.equal(cell({ next: [] }).cell.children.length, 0, 'nothing waits: no button')
  const rounds = cell({ next: [], queued: { refines: 0, rounds: 2, words: 0 } })
  assert.equal(words(rounds.cell), 'Next for it (2)')
  assert.equal(rounds.cell.children[0].disabled, true)
  // No `next` (an older board): "N waiting for it" and the list always shown, as it was.
  const older = cell({ queued: { refines: 1, rounds: 0, words: 1 }, waiting: [{ kind: 'refine', id: 'B703', title: 'Title of B703', who: null, stand: null }] })
  assert.equal(words(older.cell), '2 waiting for it')
  assert.equal(older.cell.children[0].tag, 'span')
  assert.match(words(all(older.card, node => node.className === 'advisor-lane-asks')[0]), /^Waiting for it: refine B703: Title of B703/)
})

test('the page: the button reads as a quiet count: pointer, no colour of attention', () => {
  // The rules without their comments (a comment may name the colours it avoids).
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter(rule => /advisor-waits-count|advisor-lane-asks|advisor-lane-ask-row/.test(rule))
  assert.ok(rules.some(rule => /button\.advisor-waits-count \{[^}]*cursor: pointer/.test(`${rule}}`)))
  for (const rule of rules) assert.doesNotMatch(rule, /amber|gold|orange|\bred\b|#[a-f0-9]{3,6}\b|--warn|--bad|--attention|--waiting/i)
})

test('the server adds the steps to refine next to the Advisor\'s queue where it keeps the refine gate, and only when the state carries one', async () => {
  const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  const start = server.indexOf('getState: async () => {')
  const getState = server.slice(start, server.indexOf('openChats:', start))
  assert.match(getState, /Array\.isArray\(state\.advisor\?\.next\) \? firstLook\(refineKept, state\) : null/)
  assert.match(getState, /withRefineQueue\(state\.advisor\.next, refineQueue\(state, sentNow\(\), refineGateNow, clock\(\)\), state\.advisor\.on\)/)
  assert.match(getState, /return \{ \.\.\.state, advisor,/)
})
