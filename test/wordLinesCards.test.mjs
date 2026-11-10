// Reactive board, brief P4b, part D (the person, 2026-11-09: "i submit things but i see not enough loaders"): the Focus talk card and the
// Brainstorm card have ONE status: the line of their word (P3's line, drawn from the records). "Your partner is thinking...", "thinking ·
// usually under a minute" and the 30-minute "Stopped · nothing sent" are gone; "Type it to your partner again" shows only where the
// records say so (the line is Late, or its turn ended without the answer); a not-sent click keeps its own line and Retry as the one
// status while it stands. Clicked through the DOM harness (test/README-page-tests.md); made-up garden names.
import assert from 'node:assert/strict'
import test from 'node:test'

import { openPage, reply } from './pageHarness.mjs'
import { talkPartnerOf } from '../src/talkPartner.mjs'
import { MIN, NOW, asSent, build } from './partnerState.mjs'

const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const PATH = '.claude/brainstorms/2026-10-19-paths-through-the-garden.md'
const GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', '    Goal definition: every fight reads at a glance', ''].join('\n')
// A running talk of the focus goal G6 whose last question the person answered: the partner has the turn.
const THREAD = '# Brainstorm: Paths\nGoal: G6 The polish\nStarted: 2026-10-19 09:00 · State: running\nOpening: Where do the paths go?\n\n## Q1 (09:01)\nWhere first?\n- A: By the gate (advised)\n- B: By the pond\nAnswer (09:02): A\n'
const state = (more = {}) => {
  const made = asSent({ ...build([], undefined, GOALS, { threadTexts: [{ path: PATH, text: THREAD, at: 1 }] }), goalsEdit: { canWrite: true }, ...more })
  // The talk partner as the server sends it, from the partner of this state.
  return { ...made, talkPartner: talkPartnerOf(made) }
}
const talkLine = (lineState, lead, rest, more = {}) => ({ w1: { state: lineState, lead, rest, at: NOW - 3 * MIN, chat: 'Advisor', canSendAgain: false, link: null, place: 'talk', command: 'brainstorm-answer', about: PATH, goal: 'G6', ask: null, sentAt: NOW - 3 * MIN, title: 'words', ...more } })
const CASES = {
  none: { waits: {}, wanted: null },
  sent: { waits: talkLine('sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Advisor to pick it up · next in its queue'), wanted: `Sent ${hhmm(NOW - 3 * MIN)} · waits for Advisor to pick it up · next in its queue` },
  picked: { waits: talkLine('picked-up', 'Advisor is on it', `since ${hhmm(NOW - 2 * MIN)}`, { at: NOW - 2 * MIN }), wanted: `Advisor is on it · since ${hhmm(NOW - 2 * MIN)}` },
  ended: { waits: talkLine('done', `Done ${hhmm(NOW - MIN)}`, `Advisor answered by ${hhmm(NOW - MIN)}`, { at: NOW - MIN }), wanted: `Done ${hhmm(NOW - MIN)} · Advisor answered by ${hhmm(NOW - MIN)}` },
}
/** The texts of a card's statuses: its wait line, a not-sent line, a head word, a sentence about the partner's turn or chat. */
const statusesOf = (card, selector) => [...card.querySelectorAll(selector)].map(node => words(node.classList.contains('wait-line') ? node.querySelector('.wait-words') : node))

// ---------------------------------------------------------------------------------------------------------------------
// The Focus talk card

for (const [name, found] of Object.entries(CASES)) {
  test(`the Focus talk card, ${name}: ${found.wanted === null ? 'no record, no status text at all' : 'the line of its word is its one status'}; never "thinking"`, async () => {
    const page = await openPage({ state: { ...state(), waits: found.waits } })
    try {
      await page.click('[data-tab="advice"]')
      const card = page.find('#advisor-focus .focus-talk')
      const statuses = statusesOf(card, '.wait-line, .click-unsent, .focus-waiting')
      assert.deepEqual(statuses, found.wanted === null ? [] : [found.wanted], 'one status per card')
      assert.doesNotMatch(card.textContent, /thinking|Stopped|nothing sent|usually under a minute/)
    } finally { await page.close() }
  })
}

test('the Focus talk card: a not-sent click keeps its own line and Retry as the one status, the line of an older word waits; and the chat not running stays muted when no line says it', async () => {
  const unsent = { click: 'click-aaaa-1111', via: 'brainstorm-answer', key: PATH, route: '/api/brainstorm', why: 'no chat on the board takes it', at: '14:07' }
  const page = await openPage({ state: { ...state({ clicksUnsent: [unsent] }), waits: CASES.sent.waits } })
  try {
    await page.click('[data-tab="advice"]')
    const card = page.find('#advisor-focus .focus-talk')
    assert.deepEqual(statusesOf(card, '.wait-line, .click-unsent, .focus-waiting'), ['Not sent: no chat on the board takes it, 14:07. Your input stands. Retry'])
  } finally { await page.close() }
  const off = state()
  const stopped = await openPage({ state: { ...off, advisor: { ...off.advisor, isRunning: false }, talkPartner: { ...off.talkPartner, isRunning: false } } })
  try {
    await stopped.click('[data-tab="advice"]')
    const card = stopped.find('#advisor-focus .focus-talk')
    const only = card.querySelectorAll('.focus-waiting')
    assert.equal(only.length, 1)
    assert.match(words(only[0]), /^Your partner's chat is not running/)
    assert.equal(only[0].className.includes('is-off'), false, 'colour only for what needs the person: this one is plain information')
  } finally { await stopped.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// The Brainstorm card

const open = async (more = {}, answers) => {
  const page = await openPage({ state: { ...state(), ...more }, answers })
  await page.click('[data-tab="advice"]')
  await page.click('[data-advisor-pane="brainstorm"]')
  return page
}

for (const [name, found] of Object.entries(CASES)) {
  test(`the Brainstorm card, ${name}: ${found.wanted === null ? 'no record, no status text at all' : 'the line of its word is its one status'}; never "thinking"`, async () => {
    const page = await open({ waits: found.waits })
    try {
      const card = page.find('#brainstorm-card')
      const statuses = statusesOf(card, '.wait-line, .click-unsent, .brainstorm-status, .brainstorm-waiting')
      assert.deepEqual(statuses, found.wanted === null ? [] : [found.wanted], 'one status per card')
      assert.doesNotMatch(card.textContent, /thinking|Stopped|nothing sent|usually under a minute|Type it to your partner again/)
    } finally { await page.close() }
  })
}

test('the Brainstorm card: "Type it to your partner again" shows when the line is Late or its turn ended without the answer, never while it waits or is picked up', async () => {
  const shown = async waits => {
    const page = await open({ waits })
    try { return page.all('#brainstorm-card .brainstorm-again').map(words) } finally { await page.close() }
  }
  assert.deepEqual(await shown(CASES.sent.waits), [])
  assert.deepEqual(await shown(CASES.picked.waits), [])
  assert.deepEqual(await shown({}), [], 'no record: no retry, however old the thread')
  assert.deepEqual(await shown(talkLine('late', 'Not picked up after 12 min', 'it waits in Advisor\'s queue', { at: NOW - 12 * MIN, sentAt: NOW - 12 * MIN })), ['Type it to your partner again'])
  assert.deepEqual(await shown(talkLine('sent', `Advisor's turn ended at ${hhmm(NOW - MIN)} without it`, '', { isTurnEnded: true, place: 'change' })), ['Type it to your partner again'])
})

test('the Brainstorm card: a not-sent click is the one status (its line and Retry) while it stands; the Retry sends the same click id', async () => {
  const unsent = { click: 'click-aaaa-1111', via: 'brainstorm-answer', key: PATH, route: '/api/brainstorm', why: 'no chat on the board takes it', at: '14:07' }
  const page = await open({ clicksUnsent: [unsent], waits: CASES.sent.waits }, () => reply({}))
  try {
    const card = page.find('#brainstorm-card')
    assert.deepEqual(statusesOf(card, '.wait-line, .click-unsent, .brainstorm-status, .brainstorm-waiting'), ['Not sent: no chat on the board takes it, 14:07. Your input stands. Retry'])
    await page.click('.click-unsent .click-retry')
    assert.deepEqual(page.sent('/api/brainstorm').map(one => one.body), [{ command: 'click-retry', click: 'click-aaaa-1111' }])
  } finally { await page.close() }
})

test('the partner\'s chat is not running: muted, as landed (fa21ca6), and only when no line speaks for the card', async () => {
  const base = state()
  const page = await open({ advisor: { ...base.advisor, isRunning: false }, talkPartner: { ...base.talkPartner, isRunning: false } })
  try {
    const card = page.find('#brainstorm-card .brainstorm-waiting')
    assert.equal(words(card.querySelector('.brainstorm-wait-line')), 'Your partner\'s chat is not running')
    assert.equal(card.classList.contains('is-off'), true)
  } finally { await page.close() }
  const lined = await open({ advisor: { ...base.advisor, isRunning: false }, talkPartner: { ...base.talkPartner, isRunning: false }, waits: CASES.sent.waits })
  try {
    assert.equal(lined.all('#brainstorm-card .brainstorm-waiting').length, 0, 'the line is the one status: it names the wake')
    assert.equal(lined.all('#brainstorm-card .wait-line').length, 1)
  } finally { await lined.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// Round 2 (the review of 2026-11-10, finding 2): the Brainstorm card's own "Sent…" notes (page memory) are gone: the line is the one status
// after the REAL buttons: Type it again, Yes that's it, Not quite, Change.

const CHANGE_THREAD = '# Brainstorm: Change: Paths\nGoal: G6 The polish\nKind: change\nStarted: 2026-10-19 09:00 · State: running\nOpening: Rethink the paths.\n\n## Q1 (09:01)\nWhere first?\n- A: By the gate (advised)\n- B: By the pond\nAnswer (09:02): A\n\n## Understood (09:10)\nA path is right when a visitor finds the gate.\n'
const PROPOSAL = '\n## Proposal (09:20)\nDecided:\n- the gate first\nGoals:\n- [ ] Paths by the gate — under G6 — Done when: a visitor finds the gate at night\nSteps:\n- [ ] Make a path sprite — Units — about 1 h\nNote: most visitors come in by the gate.\n'
const noNote = page => page.all('#brainstorm-card .brainstorm-note').map(words)
const statusCount = page => page.all('#brainstorm-card .wait-line, #brainstorm-card .click-unsent, #brainstorm-card .brainstorm-note, #brainstorm-card .brainstorm-waiting').length
const openWith = async (threadText, waits) => {
  const made = asSent({ ...build([], undefined, GOALS, { threadTexts: [{ path: PATH, text: threadText, at: 1 }] }), goalsEdit: { canWrite: true }, waits })
  const page = await openPage({ state: { ...made, talkPartner: talkPartnerOf(made) }, answers: () => reply({}) })
  await page.click('[data-tab="advice"]')
  await page.click('[data-advisor-pane="brainstorm"]')
  return page
}
const lineOf = (command, lineState = 'sent') => ({ w1: { state: lineState, lead: lineState === 'late' ? 'Not picked up after 12 min' : `Sent ${hhmm(NOW - 3 * MIN)}`, rest: 'waits for Advisor to pick it up', at: NOW - 3 * MIN, chat: 'Advisor', canSendAgain: false, link: null, place: 'talk', command, about: PATH, goal: 'G6', ask: null, sentAt: NOW - 3 * MIN, title: 'words' } })

test('Brainstorm: after Type it again, Yes that\'s it, Not quite and Change no note of the page stands beside the line: one status', async () => {
  const again = await openWith(THREAD, lineOf('brainstorm-answer', 'late'))
  try {
    await again.click('.brainstorm-again')
    assert.deepEqual(noNote(again), [], 'no "Typed into the Advisor\'s chat again."')
    assert.equal(again.sent('/api/brainstorm').length, 1)
    assert.equal(statusCount(again), 1)
  } finally { await again.close() }
  const yes = await openWith(CHANGE_THREAD, lineOf('brainstorm-understood'))
  try {
    await yes.click('[data-brainstorm-act="understood-yes"]')
    assert.deepEqual(noNote(yes), [], 'no "Your partner writes the new goal…"')
    assert.equal(statusCount(yes), 1)
  } finally { await yes.close() }
  const quite = await openWith(CHANGE_THREAD, lineOf('brainstorm-not-quite'))
  try {
    await quite.click('[data-brainstorm-act="not-quite"]')
    await quite.type('#brainstorm-not-quite-text', 'the gate too')
    await quite.click('[data-brainstorm-act="send-not-quite"]')
    assert.equal(quite.sent('/api/brainstorm').length, 1)
    assert.deepEqual(noNote(quite), [], 'no "Sent to your partner: it asks on."')
    assert.equal(statusCount(quite), 1)
  } finally { await quite.close() }
  const change = await openWith(`${THREAD}${PROPOSAL}`, lineOf('brainstorm-change'))
  try {
    await change.click('[data-brainstorm-act="change"]')
    await change.type('#brainstorm-change-text', 'add one for the pond')
    await change.click('[data-brainstorm-act="send-change"]')
    assert.equal(change.sent('/api/brainstorm').length, 1)
    assert.deepEqual(noNote(change), [], 'no "Sent to the Advisor: it writes the proposal anew."')
    assert.equal(statusCount(change), 1)
  } finally { await change.close() }
})
