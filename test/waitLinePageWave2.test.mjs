// The wait line on the page, wave 2 (T22, 2026-11-04, art-inbox/focus-mocks/wait-rule/plan-wave2.md; the person, 2026-11-02: "either
// the board responds immediately, e.g. via code. or we expect an ai chat todo something in which case i always need clear visual
// indications, maybe a loader. and the status if its being picked up or not. I want to know whats going on."): the same one line
// where each of the eight places took its action. The server's `waits` (src/waitLine.mjs) are added by hand, as the server adds
// them to the state; clicked through the DOM harness (test/README-page-tests.md). Made-up garden chats.
import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { openPage } from './pageHarness.mjs'
import { MIN, NOW, RUN_GOALS, app, asSent, build, tail } from './partnerState.mjs'
import { buildState } from './withStore.mjs'

const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const config = { ...parseConfig('{}', {}), project: 'C:\\garden' }
/** A line as the server puts it in the state's `waits` (src/waitLine.mjs `waitsOf`), for a place. */
const line = (place, state, lead, rest, more = {}) => ({ state, lead, rest, at: NOW - 3 * MIN, chat: 'Advisor', canSendAgain: false, link: null, place, command: place, about: null, goal: null, ask: null, sentAt: NOW - 3 * MIN, title: 'words', ...more })

/** The garden's state (the real `buildState`), with the store given, plus what the board adds by hand. */
function gardenState(work, more = {}, { outbox = [] } = {}) {
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail([typed(NOW - 20 * MIN, 'hi'), answer(NOW - 12 * MIN, 'ok')]) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
  }
  return asSent({ ...buildState(raw, { lines: [], outbox, runs: [], board: null, seen: null, now: NOW, config }), goalsEdit: { canWrite: true }, ...more })
}
const storeWith = (...texts) => {
  const work = storeFromText('## Garden\n- [ ] B20 Plant the hedge\n', { now: NOW - 60 * MIN })
  for (const text of texts) {
    const item = parseItem(text)
    work.items.set(item.head.get('Id'), item)
  }
  return work
}
const B20 = ['Id: B20', 'Kind: step', 'Title: Plant the hedge', 'State: new', 'Activity: Garden', 'Since: 2026-10-19 09:00', '', '## History', '- 2026-10-19 09:00 person: made', ''].join('\n')

test('place 1, a refine: the step\'s window draws the line where the older "Asked at ..." sentence stood: Sent, then on it, Late with the chat\'s pill', async () => {
  const states = {
    sent: line('refine', 'sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Advisor to pick it up · next in its queue', { command: 'refine', about: 'B20' }),
    'picked-up': line('refine', 'picked-up', 'Advisor is on it', `since ${hhmm(NOW - 2 * MIN)}`, { command: 'refine', about: 'B20' }),
    late: line('refine', 'late', 'Not picked up after 12 min', "it waits in Advisor's queue", { command: 'refine', about: 'B20' }),
  }
  for (const [state, given] of Object.entries(states)) {
    const page = await openPage({ state: gardenState(storeWith(B20), { waits: { r1: given } }), hash: 'details=B20' })
    try {
      const drawn = page.find('#details .wait-line')
      assert.equal(drawn.className, `wait-line is-${state}`)
      assert.equal(drawn.querySelector('.wait-lead').textContent, given.lead)
      assert.equal(words(drawn.querySelector('.wait-words')), `${given.lead} · ${given.rest}`)
      assert.equal(drawn.querySelector('.pill')?.className.startsWith('pill is-'), true, 'the chat\'s own status pill beside it')
      assert.equal(page.all('#details .refine-working').length, 0, 'one line, not two')
    } finally { await page.close() }
  }
  // No line (a refine the board asked for itself): the older sentence stands.
  const none = await openPage({ state: gardenState(storeWith(B20), {}), hash: 'details=B20' })
  try {
    assert.equal(none.all('#details .wait-line').length, 0)
  } finally { await none.close() }
  // Done "refined": the step's window says it, the way a Done line goes after 10 minutes.
  const done = await openPage({ state: gardenState(storeWith(B20), { waits: { r1: line('refine', 'done', `Done ${hhmm(NOW - MIN)}`, 'refined', { command: 'refine', about: 'B20', at: NOW - MIN }) } }), hash: 'details=B20' })
  try {
    assert.equal(done.find('#details .wait-line.is-done .wait-sign').textContent, '✓')
    assert.equal(words(done.find('#details .wait-line .wait-words')), `Done ${hhmm(NOW - MIN)} · refined`)
  } finally { await done.close() }
  const old = await openPage({ state: gardenState(storeWith(B20), { waits: { r1: line('refine', 'done', `Done ${hhmm(NOW - 20 * MIN)}`, 'refined', { command: 'refine', about: 'B20', at: NOW - 20 * MIN }) } }), hash: 'details=B20' })
  try {
    assert.equal(old.all('#details .wait-line').length, 0, 'a Done line goes after 10 minutes')
  } finally { await old.close() }
})

// ---- the Focus page: Go, Change this goal, the talk (places 2, 3 and 7) ----
const VIBE_GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', '    Goal definition: every fight reads at a glance', ''].join('\n')

test('places 2 and 7 on the Focus page in its run: Go\'s line under the head, the talk\'s line under the talk bar, each with the chat\'s pill; a Done line goes after 10 minutes', async () => {
  const base = asSent(build([], undefined, RUN_GOALS))
  const go = line('go', 'sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Advisor to pick it up · next in its queue', { command: 'how-go', about: 'G6', goal: 'G6' })
  const talk = line('talk', 'picked-up', 'Advisor is on it', `since ${hhmm(NOW - 2 * MIN)}`, { command: 'talk', about: 'G6', goal: 'G6', sentAt: NOW - 2 * MIN })
  const page = await openPage({ state: { ...base, waits: { g1: go, t1: talk } } })
  try {
    await page.click('[data-tab="advice"]')
    const strip = page.find('#advisor-focus .focus-waits')
    assert.equal(strip.querySelectorAll('.wait-line').length, 1, 'Go\'s line only: the talk\'s stands under its bar')
    assert.equal(words(strip.querySelector('small')), 'Go')
    assert.equal(words(strip.querySelector('.wait-words')), `Sent ${hhmm(NOW - 3 * MIN)} · waits for Advisor to pick it up · next in its queue`)
    assert.equal(strip.querySelector('.wait-line .pill')?.className.startsWith('pill is-'), true)
    const bar = page.find('#advisor-focus .focus-column > .wait-line.is-picked-up')
    assert.equal(words(bar.querySelector('.wait-words')), `Advisor is on it · since ${hhmm(NOW - 2 * MIN)}`)
    assert.ok(bar.querySelector('.wait-sign.calm-spinner'), 'the loader while its chat is on it')
  } finally { await page.close() }
  const done = line('go', 'done', `Done ${hhmm(NOW - MIN)}`, '3 steps', { command: 'how-go', about: 'G6', goal: 'G6', at: NOW - MIN, link: { step: 'B12', text: 'See B12 →' } })
  const finished = await openPage({ state: { ...base, waits: { g1: done } } })
  try {
    await finished.click('[data-tab="advice"]')
    assert.equal(words(finished.find('#advisor-focus .focus-waits .wait-words')), `Done ${hhmm(NOW - MIN)} · 3 steps See B12 →`)
  } finally { await finished.close() }
  const old = await openPage({ state: { ...base, waits: { g1: { ...done, at: NOW - 20 * MIN } } } })
  try {
    await old.click('[data-tab="advice"]')
    assert.equal(old.all('#advisor-focus .focus-waits').length, 0, 'a Done line goes after 10 minutes')
  } finally { await old.close() }
})

test('places 3 and 7 before the run: the talk card carries the talk\'s line, the head the line of Change this goal; no line of another goal', async () => {
  const base = asSent(build([], undefined, VIBE_GOALS))
  const talk = line('talk', 'sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Advisor to pick it up · next in its queue', { command: 'talk', about: 'G6', goal: 'G6' })
  const change = line('change', 'sent', `Sent ${hhmm(NOW - 2 * MIN)}`, 'waits for Advisor to pick it up · 2nd in its queue', { command: 'brainstorm', about: 'brainstorms/change.md', goal: 'G6', sentAt: NOW - 2 * MIN })
  const other = line('talk', 'late', 'Not picked up after 40 min', 'x', { command: 'talk', about: 'G9', goal: 'G9' })
  const page = await openPage({ state: { ...base, waits: { t1: talk, c1: change, t9: other } } })
  try {
    await page.click('[data-tab="advice"]')
    assert.equal(words(page.find('#advisor-focus .focus-waits small')), 'Change this goal')
    assert.equal(words(page.find('#advisor-focus .focus-waits .wait-words')), `Sent ${hhmm(NOW - 2 * MIN)} · waits for Advisor to pick it up · 2nd in its queue`)
    const card = page.find('#advisor-focus .focus-talk .wait-line')
    assert.equal(words(card.querySelector('.wait-words')), `Sent ${hhmm(NOW - 3 * MIN)} · waits for Advisor to pick it up · next in its queue`)
    assert.equal(page.all('#advisor-focus .wait-line.is-late').length, 0, 'G9\'s line is not this goal\'s')
  } finally { await page.close() }
})

// ---- the Brainstorm part: the thread's line (places 3 and 7) ----
const PATH = '.claude/brainstorms/2026-10-19-change-paths-through-the-garden.md'
const THREAD = kind => `# Brainstorm: ${kind === null ? 'Paths' : 'Change: Paths'}\nGoal: G6 The polish\n${kind === null ? '' : `Kind: ${kind}\n`}Started: 2026-10-19 09:00 · State: running\nOpening: Steps are missing.\n\n`
const brainstormState = (kind, waits) => asSent({ ...build([], undefined, RUN_GOALS, { threadTexts: [{ path: PATH, text: THREAD(kind), at: 1 }] }), goalsEdit: { canWrite: true }, waits })

test('places 3 and 7 on the Brainstorm part: the thread\'s newest line stands in its card (Change this goal, or a plain talk), Done for ten minutes', async () => {
  const change = line('change', 'sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Advisor to pick it up · next in its queue', { command: 'brainstorm', about: PATH, goal: 'G6' })
  for (const [kind, place] of [['change', 'change'], [null, 'talk']]) {
    const page = await openPage({ state: brainstormState(kind, { w1: { ...change, place } }) })
    try {
      await page.click('[data-tab="advice"]')
      await page.click('[data-advisor-pane="brainstorm"]')
      assert.equal(words(page.find('#brainstorm-card .wait-line .wait-words')), `Sent ${hhmm(NOW - 3 * MIN)} · waits for Advisor to pick it up · next in its queue`, place)
      assert.equal(page.all('#brainstorm-card .wait-line .pill').length, 1)
    } finally { await page.close() }
  }
  // Done: its next stage of the thread; gone after 10 minutes; another thread's line is not this one's.
  const done = { ...change, state: 'done', lead: `Done ${hhmm(NOW - MIN)}`, rest: 'a question for you', at: NOW - MIN }
  const finished = await openPage({ state: brainstormState('change', { w1: done }) })
  try {
    await finished.click('[data-tab="advice"]')
    await finished.click('[data-advisor-pane="brainstorm"]')
    assert.equal(words(finished.find('#brainstorm-card .wait-line .wait-words')), `Done ${hhmm(NOW - MIN)} · a question for you`)
  } finally { await finished.close() }
  for (const waits of [{ w1: { ...done, at: NOW - 20 * MIN } }, { w1: { ...change, about: '.claude/brainstorms/other.md' } }]) {
    const page = await openPage({ state: brainstormState('change', waits) })
    try {
      await page.click('[data-tab="advice"]')
      await page.click('[data-advisor-pane="brainstorm"]')
      assert.equal(page.all('#brainstorm-card .wait-line').length, 0)
    } finally { await page.close() }
  }
})

// ---- the Goals part: a goal ask (place 4) ----
const ASKED_GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', '    Ask (A1, 2026-10-19 09:30): why is the path blue?', ''].join('\n')

test('place 4, a goal ask: the ask\'s box under its goal draws the line of its word, "answered under G6" once done; another goal\'s ask has none', async () => {
  const state = waits => asSent({ ...build([], undefined, ASKED_GOALS), goalsEdit: { canWrite: true }, waits })
  const ask = line('goal-ask', 'sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Advisor to pick it up · next in its queue', { command: 'goal-ask', about: 'A1', goal: 'G6' })
  const page = await openPage({ state: state({ w1: ask, w2: { ...ask, about: 'A1', goal: 'G7', lead: 'Sent 00:00' } }), hash: 'advice/goals/G6' })
  try {
    const box = page.find('#goals-frame [data-ask-block="A1"]')
    assert.equal(box.querySelectorAll('.wait-line').length, 1)
    assert.equal(words(box.querySelector('.wait-words')), `Sent ${hhmm(NOW - 3 * MIN)} · waits for Advisor to pick it up · next in its queue`)
    assert.equal(box.querySelector('.wait-line .pill')?.className.startsWith('pill is-'), true)
  } finally { await page.close() }
  const onIt = await openPage({ state: state({ w1: { ...ask, state: 'picked-up', lead: 'Advisor is on it', rest: `since ${hhmm(NOW - 2 * MIN)}` } }), hash: 'advice/goals/G6' })
  try {
    assert.ok(onIt.find('#goals-frame [data-ask-block="A1"] .wait-line.is-picked-up .calm-spinner'), 'the loader while it works on it')
  } finally { await onIt.close() }
  const done = await openPage({ state: state({ w1: { ...ask, state: 'done', lead: `Done ${hhmm(NOW - MIN)}`, rest: 'answered under G6', at: NOW - MIN } }), hash: 'advice/goals/G6' })
  try {
    assert.equal(words(done.find('#goals-frame [data-ask-block="A1"] .wait-line .wait-words')), `Done ${hhmm(NOW - MIN)} · answered under G6`)
  } finally { await done.close() }
  const none = await openPage({ state: state({}), hash: 'advice/goals/G6' })
  try {
    assert.equal(none.all('#goals-frame .wait-line').length, 0)
  } finally { await none.close() }
})

// ---- Needs your attention: an overturned recap (place 5) ----
test('place 5, Overturn: the closed recap stays while its fix waits, with the line of the answer under its status; Done links the step made; it goes after 10 minutes', async () => {
  const recap = { id: 'recap:N4', workId: 'N4', about: 'B2', isGoal: false, title: 'B2 Light the lamps is done', heading: 'Light the lamps', line: 'Every path has a lamp.', evidence: 'none', state: 'overturned', at: NOW - 30 * MIN, approvesAt: null, words: 'Too dim.', isClosed: true }
  const answerLine = more => line('overturn', 'sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Advisor to pick it up · next in its queue', { command: 'answer', ask: 'work:N4', ...more })
  const state = waits => ({ ...asSent(build([], undefined)), recaps: [recap], recapsShow: 'now', waits })
  const sent = await openPage({ state: state({ w1: answerLine() }) })
  try {
    const card = sent.find('#needs .need.is-recap')
    assert.match(words(card.querySelector('.recap-status')), /^Overturned: "Too dim"\./)
    assert.equal(words(card.querySelector('.wait-line .wait-words')), `Sent ${hhmm(NOW - 3 * MIN)} · waits for Advisor to pick it up · next in its queue`)
    assert.equal(card.querySelectorAll('button').length, 0, 'closed: it asks nothing more of the person')
  } finally { await sent.close() }
  const done = await openPage({ state: state({ w1: answerLine({ state: 'done', lead: `Done ${hhmm(NOW - MIN)}`, rest: 'B30', at: NOW - MIN, link: { step: 'B30', text: 'See B30 →' } }) }) })
  try {
    assert.equal(words(done.find('#needs .need.is-recap .wait-line .wait-words')), `Done ${hhmm(NOW - MIN)} · B30 See B30 →`)
    assert.equal(done.find('#needs .need.is-recap [data-wait-step="B30"]').dataset.waitStep, 'B30')
  } finally { await done.close() }
  for (const waits of [{}, { w1: answerLine({ state: 'done', lead: 'Done 12:00', rest: 'B30', at: NOW - 20 * MIN }) }, { w1: answerLine({ ask: 'work:N9' }) }]) {
    const gone = await openPage({ state: state(waits) })
    try {
      assert.equal(gone.all('#needs .need.is-recap').length, 0, 'a closed recap with no line to show is hidden, as before')
    } finally { await gone.close() }
  }
})

// ---- the worker's lane: Stop and Remove (place 6) ----
test('place 6, Stop or Remove a worker: the worker\'s row draws the line of the word to the main chat; a stop done in code has none', async () => {
  const base = asSent(build([], undefined))
  assert.ok(base.chats.some(lane => lane.name === 'Digger' && lane.isMain !== true), 'the garden has a worker named Digger')
  const stop = (state, lead, rest, more = {}) => line('worker', state, lead, rest, { chat: 'Lead', command: 'stop', about: 'Digger', ...more })
  const sent = await openPage({ state: { ...base, waits: { w1: stop('sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Lead to pick it up · next in its queue') } } })
  try {
    const row = sent.all('#lanes .lane').find(one => /Digger/.test(one.textContent))
    assert.equal(words(row.querySelector('.wait-line .wait-words')), `Sent ${hhmm(NOW - 3 * MIN)} · waits for Lead to pick it up · next in its queue`)
    assert.equal(row.querySelector('.wait-line .pill')?.className.startsWith('pill is-'), true, 'the main chat\'s own pill')
    assert.equal(sent.all('#lanes .wait-line').length, 1, 'no line on the other rows')
  } finally { await sent.close() }
  const onIt = await openPage({ state: { ...base, waits: { w1: stop('picked-up', 'Lead is on it', `since ${hhmm(NOW - 2 * MIN)}`) } } })
  try {
    assert.ok(onIt.find('#lanes .wait-line.is-picked-up .calm-spinner'))
  } finally { await onIt.close() }
  const done = await openPage({ state: { ...base, waits: { w1: stop('done', `Done ${hhmm(NOW - MIN)}`, 'removed', { command: 'remove', at: NOW - MIN }) } } })
  try {
    assert.equal(words(done.find('#lanes .wait-line .wait-words')), `Done ${hhmm(NOW - MIN)} · removed`)
  } finally { await done.close() }
  const other = await openPage({ state: { ...base, waits: { w1: stop('sent', 'Sent 12:00', 'x', { about: 'Nobody' }) } } })
  try {
    assert.equal(other.all('#lanes .wait-line').length, 0)
  } finally { await other.close() }
})

// ---- the way part: "Re-check the goals now" (place 7) ----
test('place 7, Re-check the goals now: the line of the round that was asked for stands under its button, with the chat\'s pill; Done is the fallback "answered"', async () => {
  const base = asSent(build([], undefined, RUN_GOALS))
  const recheck = (state, lead, rest, more = {}) => line('talk', state, lead, rest, { command: 'recheck', about: null, ...more })
  const sent = await openPage({ state: { ...base, waits: { r1: recheck('sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Advisor to pick it up · next in its queue') } } })
  try {
    await sent.click('[data-tab="advice"]')
    await sent.click('[data-advisor-pane="way"]')
    const part = sent.find('#advisor-way .way-recheck-line')
    assert.equal(words(part.querySelector('.wait-line .wait-words')), `Sent ${hhmm(NOW - 3 * MIN)} · waits for Advisor to pick it up · next in its queue`)
    assert.equal(part.querySelector('.wait-line .pill')?.className.startsWith('pill is-'), true)
  } finally { await sent.close() }
  const done = await openPage({ state: { ...base, waits: { r1: recheck('done', `Advisor answered ${hhmm(NOW - MIN)}`, '', { at: NOW - MIN, isFallback: true }) } } })
  try {
    await done.click('[data-tab="advice"]')
    await done.click('[data-advisor-pane="way"]')
    assert.equal(words(done.find('#advisor-way .way-recheck-line .wait-words')), `Advisor answered ${hhmm(NOW - MIN)}`)
  } finally { await done.close() }
  // A talk word of a goal is no re-check's line.
  const talk = await openPage({ state: { ...base, waits: { t1: line('talk', 'sent', 'Sent 12:00', 'x', { command: 'talk', about: 'G6', goal: 'G6' }) } } })
  try {
    await talk.click('[data-tab="advice"]')
    await talk.click('[data-advisor-pane="way"]')
    assert.equal(talk.all('#advisor-way .wait-line').length, 0)
  } finally { await talk.close() }
})

// ---- the Supervisor's part: an incident that waits for its judgment (place 8) ----
test('place 8, an incident waiting for the Supervisor\'s judgment: its line stands on its row in the Supervisor\'s part, never among Needs your attention; Done after the verdict', async () => {
  const incident = (id, state, more = {}) => ({ id, title: `something broke ${id}`, state, fix: null, source: 'worker-unknown', subject: 'Worker 2', count: 2, firstSeen: NOW - 30 * MIN, lastSeen: NOW - 5 * MIN, since: NOW - 20 * MIN, foundAt: NOW - 20 * MIN, evidence: 'x', ruleWanted: null, ...more })
  const supervisor = {
    run: null, checkedAt: NOW - MIN, rules: [], lastSweep: null, sweepNote: null, sweepEvery: 10, sweepsToday: null,
    incidents: [incident('X1', 'with the supervisor'), incident('X2', 'with the supervisor'), incident('X3', 'closed', { since: NOW - MIN })],
    cards: [{ key: 'nofix', step: null, title: 'Open, no fix task yet', state: { text: 'with the Supervisor', tone: 'sending' }, incidents: [{ id: 'X1', word: null }, { id: 'X2', word: null }, { id: 'X3', word: null }], at: NOW - 20 * MIN }],
  }
  const judge = (id, state, lead, rest, more = {}) => ({ ...line('judge', state, lead, rest, { chat: 'Supervisor', command: 'judge', about: id, word: 'j1' }), ...more })
  const waits = {
    'j1#X1': judge('X1', 'sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Supervisor to pick it up · next in its queue'),
    'j1#X2': judge('X2', 'picked-up', 'Supervisor is on it', `since ${hhmm(NOW - 2 * MIN)}`),
    'j1#X3': judge('X3', 'done', `Done ${hhmm(NOW - MIN)}`, 'false alarm: no fault left', { at: NOW - MIN }),
  }
  const base = { ...asSent(build([], undefined)), supervisorChat: { name: 'Supervisor', isRunning: true, status: 'Free', state: 'free', isMain: false } }
  const page = await openPage({ state: { ...base, supervisor, waits }, now: NOW })
  try {
    await page.click('[data-supervisor-fold]')
    const rows = Object.fromEntries(page.all('#supervisor .inc-card .inc-wait').map(row => [row.dataset.incidentWait, row]))
    assert.deepEqual(Object.keys(rows).sort(), ['X1', 'X2', 'X3'])
    assert.deepEqual(['X1', 'X2', 'X3'].map(id => words(rows[id].querySelector('.wait-words'))), [
      `Sent ${hhmm(NOW - 3 * MIN)} · waits for Supervisor to pick it up · next in its queue`, `Supervisor is on it · since ${hhmm(NOW - 2 * MIN)}`, `Done ${hhmm(NOW - MIN)} · false alarm: no fault left`])
    assert.ok(rows.X2.querySelector('.wait-line.is-picked-up .calm-spinner'))
    assert.equal(rows.X1.querySelector('.wait-line .pill')?.className.startsWith('pill is-'), true, 'the Supervisor\'s own pill beside it')
    assert.equal(page.all('#needs .wait-line').length, 0, 'never a Needs your attention card')
  } finally { await page.close() }
  const old = await openPage({ state: { ...base, supervisor, waits: { ...waits, 'j1#X3': { ...waits['j1#X3'], at: NOW - 20 * MIN } } }, now: NOW })
  try {
    await old.click('[data-supervisor-fold]')
    assert.deepEqual(old.all('#supervisor .inc-card .inc-wait').map(row => row.dataset.incidentWait).sort(), ['X1', 'X2'], 'a Done line goes after 10 minutes')
  } finally { await old.close() }
  // The newest word of an incident is its line.
  const newer = { ...waits, 'j2#X1': judge('X1', 'sent', 'Sent 13:30', 'waits for Supervisor to pick it up', { sentAt: NOW - MIN }) }
  const second = await openPage({ state: { ...base, supervisor, waits: newer }, now: NOW })
  try {
    await second.click('[data-supervisor-fold]')
    assert.match(words(second.find('#supervisor .inc-wait[data-incident-wait="X1"] .wait-words')), /^Sent 13:30/)
  } finally { await second.close() }
})

// ---- the review of 2026-11-04 ----
test('review 1, Overturn with Autopilot on (recaps gather in the daily note): the overturned recap stays listed there with its line until Done + 10 minutes', async () => {
  const recap = { id: 'recap:N4', workId: 'N4', about: 'B2', isGoal: false, title: 'B2 Light the lamps is done', heading: 'Light the lamps', line: 'Every path has a lamp.', evidence: 'none', state: 'overturned', at: NOW - 30 * MIN, approvesAt: null, words: 'Too dim.', isClosed: true }
  const open = { ...recap, id: 'recap:N5', workId: 'N5', state: 'open', isClosed: false, approvesAt: NOW + 20 * MIN, heading: 'Water the hedge' }
  const answerLine = more => line('overturn', 'sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Advisor to pick it up · next in its queue', { command: 'answer', ask: 'work:N4', ...more })
  const state = (waits, recaps = [recap]) => ({ ...asSent(build([], undefined, RUN_GOALS)), recaps, recapsShow: 'daily', waits })
  const sent = await openPage({ state: state({ w1: answerLine() }) })
  try {
    await sent.click('[data-tab="advice"]')
    const card = sent.find('#advisor-focus .need.is-recap')
    assert.match(words(card.querySelector('.recap-status')), /^Overturned: "Too dim"\./)
    assert.equal(words(card.querySelector('.wait-line .wait-words')), `Sent ${hhmm(NOW - 3 * MIN)} · waits for Advisor to pick it up · next in its queue`)
    assert.equal(words(sent.find('#advisor-focus .focus-recaps h3')), 'Overturned: your partner makes the fix')
    assert.equal(sent.all('#needs .need.is-recap').length, 0, 'in the daily note\'s part, not in Needs your attention')
  } finally { await sent.close() }
  const done = await openPage({ state: state({ w1: answerLine({ state: 'done', lead: `Done ${hhmm(NOW - MIN)}`, rest: 'B30', at: NOW - MIN, link: { step: 'B30', text: 'See B30 →' } }) }, [recap, open]) })
  try {
    await done.click('[data-tab="advice"]')
    assert.equal(done.all('#advisor-focus .need.is-recap').length, 2, 'the open recap, and the overturned one with its Done line')
    assert.equal(words(done.find('#advisor-focus .focus-recaps h3')), 'Finished: 1', 'only the open one counts as finished')
    assert.equal(done.find('#advisor-focus .need.is-recap.is-closed [data-wait-step="B30"]').dataset.waitStep, 'B30')
  } finally { await done.close() }
  for (const waits of [{}, { w1: answerLine({ state: 'done', lead: 'Done 12:00', rest: 'B30', at: NOW - 20 * MIN }) }]) {
    const gone = await openPage({ state: state(waits) })
    try {
      await gone.click('[data-tab="advice"]')
      assert.equal(gone.all('#advisor-focus .need.is-recap').length, 0, 'no line to show: gone, as before')
    } finally { await gone.close() }
  }
})

test('review 6, Stop and Remove: each word of a worker keeps its own line, by its word id; the older "asked" sentence of a remove gives way to its line only', async () => {
  const base = asSent(build([], undefined))
  const word = (id, command, state, lead, rest, more = {}) => ({ ...line('worker', state, lead, rest, { chat: 'Lead', command, about: 'Digger' }), ...more })
  const waits = {
    s1: word('s1', 'stop', 'done', `Done ${hhmm(NOW - 2 * MIN)}`, 'stopped', { at: NOW - 2 * MIN, sentAt: NOW - 9 * MIN }),
    m1: word('m1', 'remove', 'sent', `Sent ${hhmm(NOW - MIN)}`, 'waits for Lead to pick it up · next in its queue', { sentAt: NOW - MIN }),
  }
  const page = await openPage({ state: { ...base, waits } })
  try {
    const row = page.all('#lanes .lane').find(one => /Digger/.test(one.textContent))
    const lines = [...row.querySelectorAll('.wait-line')]
    assert.deepEqual(lines.map(one => one.dataset.wait), ['s1', 'm1'], 'both, oldest first, each by its own word id')
    assert.deepEqual(lines.map(one => words(one.querySelector('.wait-words'))), [`Done ${hhmm(NOW - 2 * MIN)} · stopped`, `Sent ${hhmm(NOW - MIN)} · waits for Lead to pick it up · next in its queue`])
  } finally { await page.close() }
})

test('review 7, a refine: the person\'s older line never hides a newer refine of the same step that runs now (the board\'s own, Autopilot\'s); the newest activity shows', async () => {
  const board = { id: 'b9', to: 'Advisor', ask: null, step: null, title: null, version: null, verdict: null, command: 'refine', about: 'B20', round: 1, text: 'refine step', at: NOW - MIN, state: 'waiting', board: true }
  const older = line('refine', 'done', `Done ${hhmm(NOW - 4 * MIN)}`, 'refined', { command: 'refine', about: 'B20', at: NOW - 4 * MIN, sentAt: NOW - 5 * MIN })
  const page = await openPage({ state: gardenState(storeWith(B20), { waits: { r1: older } }, { outbox: [board] }), hash: 'details=B20' })
  try {
    assert.equal(page.all('#details .wait-line').length, 0, 'the older Done line does not hide the refine that runs now')
    assert.match(words(page.find('#details .refine-working')), /^Asked at \d\d:\d\d: Advisor /)
  } finally { await page.close() }
  // The person's own refine is the newest one: its line stands, never two.
  const mine = { ...board, board: undefined, at: NOW - 3 * MIN }
  const own = line('refine', 'sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Advisor to pick it up · next in its queue', { command: 'refine', about: 'B20', sentAt: NOW - 3 * MIN })
  const second = await openPage({ state: gardenState(storeWith(B20), { waits: { r1: own } }, { outbox: [mine] }), hash: 'details=B20' })
  try {
    assert.equal(second.all('#details .wait-line').length, 1)
    assert.equal(second.all('#details .refine-working').length, 0)
  } finally { await second.close() }
})
