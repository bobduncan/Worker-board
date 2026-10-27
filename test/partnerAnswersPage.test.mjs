// Partner answers (the person, 2026-10-19), what the board shows: the switch on the Focus page, the routed ask kept
// out of Needs your attention, the partner's answer with its Undo on the ask's closed card and in the daily note, the
// line of an ask handed on or taken back; and the server's part: the asking chat woken from the work tool too, an Undo
// of a partner's answer told to the asking chat, not typed to the partner (test/partnerAnswersBoard.test.mjs, on a
// running board). B415, B730: the page is only ever read and clicked through the DOM harness, with its own constants.
// Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { openPage, reply, TOKEN } from './pageHarness.mjs'
import { asSent, DAY, GOALS, RUN_GOALS, L1, L2, L3, L4, MIN, NOW, answered, ask, build, note, parsed, sinceOf } from './partnerState.mjs'

const waiting = parsed(`Id: B12\nKind: step\nTitle: Plant the hedge\nState: waiting on you\nOwner: Digger\nSince: ${sinceOf(NOW - 30 * MIN)}\n`)
const routed = parsed(`Id: Q1\nKind: ask\nTitle: Box or yew?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 20 * MIN)}\nFiled: ${NOW - 20 * MIN}\nAsks: decide\nBlocking: yes\nOf: B12\nOptions: A box | B yew\nAdvice: B\nRoute: partner\n`)
const takenBack = parsed(`Id: Q8\nKind: ask\nTitle: Icons?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 10 * MIN)}\nAsks: decide\nBlocking: no\nOf: B12\nRoute: person\nDaily note: N2\n\n## Route\nYour partner had answered: A; you took it back\n\n## Note line\n${L3}\n`)
/** The garden after a day with the partner (the board adds `goalsEdit`: whether goals.md may be written): a question with it, an answer of today and one of two days ago, one taken back. */
const garden = (goalsEdit = { canWrite: true }) => asSent({ ...build([
  waiting, routed, takenBack,
  answered('Q5', 'N1', L1, NOW - 2 * DAY), answered('Q6', 'N2', L2, NOW - 30 * MIN),
  note('N1', NOW - 2 * DAY, [L1]), note('N2', NOW - 60 * MIN, [L2, 'Kept the icons', L3], [L3]),
], undefined, RUN_GOALS), goalsEdit })
const TAKE_BACK = 'Take back your partner\'s answer: the question comes to you, and its chat waits for your answer'

/** The Focus page of a garden whose store keeps the switch as `partner` (undefined: no store). */
async function focusPage(partner) {
  const state = asSent({ ...build([], partner, RUN_GOALS), goalsEdit: { canWrite: true } })
  if (partner === undefined) delete state.partnerAnswers
  const page = await openPage({ state })
  await page.click('[data-tab="advice"]')
  return page
}

test('the Focus page\'s switch: "Your partner answers detail questions", on or off as the store keeps it', async () => {
  const none = await focusPage(undefined)
  try { assert.equal(none.all('.focus-partner-switch').length, 0, 'no store: no switch') } finally { await none.close() }
  const on = await focusPage({ on: true })
  try {
    assert.equal(on.text('.focus-partner-switch span'), 'Your partner answers detail questions')
    assert.equal(on.find('[data-partner-answers="switch"]').checked, true)
    assert.equal(on.find('[data-partner-answers="switch"]').disabled, false)
    assert.match(on.find('.focus-partner-switch').getAttribute('title'), /questions only you can answer still come to you/)
  } finally { await on.close() }
  const off = await focusPage({ on: false })
  try {
    assert.equal(off.find('[data-partner-answers="switch"]').checked, false)
    assert.match(off.find('.focus-partner-switch').getAttribute('title'), /every question comes to you/)
  } finally { await off.close() }
})

test('the daily note: a partner\'s answer of an ask has its Undo, then "taken back" by its field; other lines keep "undo asked"', async () => {
  // The review's findings: a line that only looks like an answer ("Q9 (old notes): ...") is the partner's own line.
  const state = asSent({ ...build([
    answered('Q1', 'N4', 'Q1 (Digger, B1): Number or bar? → A number (your advice)', NOW - 30 * MIN),
    parsed(`Id: Q2\nKind: ask\nTitle: Yellow?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 10 * MIN)}\nAsks: decide\nBlocking: no\nOf: B12\nRoute: person\nDaily note: N4\n\n## Route\nYour partner had answered: A; you took it back\n\n## Note line\nQ2 (Digger, B1): Yellow? → A (your advice)\n`),
    note('N4', NOW - 60 * MIN, ['Q1 (Digger, B1): Number or bar? → A number (your advice)', 'Q2 (Digger, B1): Yellow? → A (your advice)', 'Kept the icons', 'Q9 (old notes): kept the icons'], ['Q2 (Digger, B1): Yellow? → A (your advice)', 'Kept the icons']),
  ], undefined, RUN_GOALS), goalsEdit: { canWrite: true } })
  const page = await openPage({ state })
  try {
    await page.click('[data-tab="advice"]')
    const undos = page.all('.focus-daily .focus-undo')
    assert.deepEqual(undos.map(one => [one.textContent, one.disabled, one.getAttribute('data-focus-ask')]), [['Undo', false, 'Q1'], ['taken back', true, 'Q2'], ['undo asked', true, null], ['Undo', false, null]])
    assert.equal(undos[0].getAttribute('title'), TAKE_BACK)
    assert.equal(undos[3].getAttribute('title'), 'Ask your partner to undo this')
    assert.equal(undos[2].getAttribute('title'), 'You asked your partner to undo this')
  } finally { await page.close() }
})

test('the review\'s findings: "With your partner" (count, a click lists them as links), "Decided for you" with Undo, the lane waiting for the partner', async () => {
  const none = await openPage({ state: asSent(build([waiting, ask('Q2', 'person', NOW - 40 * MIN)])) })
  try {
    assert.equal(none.all('[data-with-partner="toggle"]').length, 0, 'no question with the partner: no line')
    assert.equal(none.all('[data-decided="toggle"]').length, 0, 'no answer decided for the person: no line')
    // Without a question with the partner a lane says its state in the page's own words, not that it waits for the partner.
    const { STATES } = none.constants
    const pills = none.all('#lanes .pill').map(one => [one.closest('[data-lane]')?.dataset.lane ?? null, one.textContent])
    assert.ok(pills.some(([lane, text]) => lane === 'Digger' && text === STATES.working), 'the lane says its state')
    assert.ok(pills.every(([, text]) => !/partner/.test(text)))
  } finally { await none.close() }
  const two = await openPage({ state: asSent(build([waiting, routed, parsed(`Id: Q3\nKind: ask\nTitle: Icons?\nState: open\nOwner: Lead\nSince: ${sinceOf(NOW - 20 * MIN)}\nFiled: ${NOW - 20 * MIN}\nAsks: decide\nBlocking: no\nOf: B12\nOptions: A icons | B words\nAdvice: A\nRoute: partner\n`)])) })
  try {
    assert.equal(two.text('[data-with-partner="toggle"]'), '▸ With your partner: 2 questions')
    await two.click('[data-with-partner="toggle"]')
    // The person, 2026-10-26: each row is a link that opens its ask ("i just need it clickable").
    assert.deepEqual(two.all('.with-partner-ask').map(one => [one.textContent, one.getAttribute('href')]), [['Q1 · Digger: Box or yew?', '#details=Q1'], ['Q3 · Lead: Icons?', '#details=Q3']])
  } finally { await two.close() }
  const page = await openPage({ state: garden() })
  try {
    assert.equal(page.text('[data-with-partner="toggle"]'), '▸ With your partner: 1 question')
    await page.click('[data-decided="toggle"]')
    assert.match(page.text('[data-decided="toggle"]'), /^Decided for you by your partner · 1/)
    assert.equal(page.find('.decided-for-you [data-take-back="Q5"]').getAttribute('title'), TAKE_BACK)
    assert.match(page.text('.decided-for-you'), /Q5 \(Digger, B12\): Icons\? → A \(your advice\)/)
  } finally { await page.close() }
})

test('the ask\'s card: the partner\'s answer with its why and Undo; the line of an ask handed on or taken back', async () => {
  const handed = parsed(`Id: Q2\nKind: ask\nTitle: Money?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 10 * MIN)}\nAsks: decide\nBlocking: no\nOf: B12\nRoute: person\n\n## Route\nYour partner hands this to you: it is about money\n`)
  const page = await openPage({ state: asSent(build([waiting, handed, takenBack, answered('Q6', 'N2', L2, NOW - 30 * MIN), note('N2', NOW - 60 * MIN, [L2, L3])], undefined, RUN_GOALS)) })
  try {
    await page.change('#needs-closed', true)
    const [answeredCard] = page.all('.partner-answer').filter(one => one.closest('[data-id="work:Q6"]') !== null)
    assert.ok(answeredCard, 'the answered ask has its part of the partner')
    assert.match(answeredCard.textContent, /Your partner answered: A/)
    assert.match(answeredCard.textContent, /Why: your advice/)
    assert.equal(answeredCard.querySelector('[data-take-back="Q6"]').getAttribute('title'), TAKE_BACK)
    const handedCard = page.find('[data-id="work:Q2"] .partner-answer')
    assert.equal(handedCard.textContent, 'Your partner hands this to you: it is about money')
    assert.equal(handedCard.querySelector('[data-take-back]'), null, 'a handed ask has no Undo')
    assert.equal(page.text('[data-id="work:Q8"] .partner-answer'), 'Your partner had answered: A; you took it back')
    // An ask the partner never touched has no part of the partner.
    const plain = await openPage({ state: asSent(build([ask('Q3', null, NOW - 40 * MIN)])) })
    try { assert.equal(plain.all('.partner-answer').length, 0) } finally { await plain.close() }
  } finally { await page.close() }
})

// ---- the state ----

test('the state: a routed ask is not under Needs your attention; the partner is woken for it; the switch as the store keeps it', () => {
  const state = build([ask('Q1', 'partner', NOW - 20 * MIN), ask('Q2', 'person', NOW - 40 * MIN), ask('Q3', null, NOW - 40 * MIN)])
  assert.deepEqual(state.forYou.filter(one => one.workId !== undefined).map(one => one.workId).sort(), ['Q2', 'Q3'])
  assert.deepEqual(state.reconciled.partnerAsks.map(one => [one.id, one.chat]), [['Q1', 'Advisor']])
  // Filed 20 minutes ago: not handed on yet; 40 minutes ago: handed on (the review's findings: from its filing).
  assert.deepEqual(state.reconciled.escalations, [])
  assert.deepEqual(build([ask('Q1', 'partner', NOW - 40 * MIN)]).reconciled.escalations, [{ id: 'Q1', why: 'the partner did not answer in 30 min' }])
  assert.deepEqual(state.partnerAnswers, { on: true })
  assert.deepEqual(build([], { on: false, since: NOW }).partnerAnswers, { on: false, since: NOW })
})

test('the review\'s findings, the state: the lane waits for the partner; "With your partner"; the note\'s lines by their asks; 7 days of Undo', () => {
  const state = build([
    waiting, routed, takenBack,
    answered('Q5', 'N1', L1, NOW - 2 * DAY), answered('Q6', 'N2', L2, NOW - 30 * MIN), answered('Q7', 'N0', L4, NOW - 8 * DAY),
    note('N1', NOW - 2 * DAY, [L1]), note('N2', NOW - 60 * MIN, [L2, 'Kept the icons', L3], [L3]),
  ], undefined, GOALS)
  const digger = state.chats.find(one => one.name === 'Digger')
  assert.deepEqual([digger.state, digger.waitsForPartner], ['working', ['Q1']])
  assert.match(digger.between, /waits for your partner's answer \(Q1\)/)
  // A chat that does not run (the app started after its last word) says "Not running", not that it waits for the partner.
  const gone = build([waiting, routed], undefined, undefined, { appStartedAt: NOW + 1 }).chats.find(one => one.name === 'Digger')
  assert.deepEqual([gone.state, gone.waitsForPartner], ['off', null])
  assert.deepEqual(state.withPartner.map(one => [one.id, one.from, one.title]), [['Q1', 'Digger', 'Box or yew?']])
  // Today's note: every line, the answers by their asks (a field), one taken back.
  assert.deepEqual(state.focus.note.decided, [
    { text: L2, undoAsked: false, ask: 'Q6', takenBack: false },
    { text: 'Kept the icons', undoAsked: false },
    { text: L3, undoAsked: true, ask: 'Q8', takenBack: true },
  ])
  // An answer not on that note keeps its Undo under Needs your attention for 7 days.
  assert.deepEqual(state.partnerDecided.map(one => [one.ask, one.line]), [['Q5', L1]])
  // Without a focus every answer of the last 7 days is there.
  assert.deepEqual(build([answered('Q5', 'N1', L1, NOW - 2 * DAY), answered('Q6', 'N2', L2, NOW - 30 * MIN)]).partnerDecided.map(one => one.ask), ['Q6', 'Q5'])
})

// ---- the page, clicked (B415: through the DOM harness, with a fake fetch) ----

test('the page: the Focus page\'s switch is on as the store keeps it; a click sends the person\'s change of the store', async () => {
  const page = await openPage({ state: garden() })
  try {
    await page.click('[data-tab="advice"]')
    assert.equal(page.find('[data-partner-answers="switch"]').checked, true)
    assert.match(page.text('.focus-partner-switch'), /Your partner answers detail questions/)
    assert.equal(page.text('.focus-partner-switch small'), 'on: detail questions go to your partner first')
    await page.change('[data-partner-answers="switch"]', false)
    const sent = page.sent('/api/work')
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0].body, { action: 'partner-answers', on: false })
    assert.equal(sent[0].headers['X-Board-Token'], TOKEN)
  } finally { await page.close() }
})

test('the page: a refused change of the switch shows its problem under the switch', async () => {
  const page = await openPage({ state: garden(), answers: () => reply('The store is locked', 409) })
  try {
    await page.click('[data-tab="advice"]')
    await page.change('[data-partner-answers="switch"]', false)
    assert.equal(page.text('.focus-partner-switch .problem'), 'Not sent: The store is locked')
  } finally { await page.close() }
})

test('the page: the daily note\'s Undo of a partner\'s answer says the question came back; of another line, that the partner is asked', async () => {
  const page = await openPage({ state: garden() })
  try {
    await page.click('[data-tab="advice"]')
    assert.deepEqual(page.all('.focus-daily .focus-undo').map(one => [one.textContent, one.disabled]), [['Undo', false], ['Undo', false], ['taken back', true]])
    await page.click('.focus-undo[data-focus-ask="Q6"]')
    assert.deepEqual(page.sent('/api/goals').map(one => one.body), [{ command: 'note-undo', id: 'G6', note: 'N2', line: L2 }])
    assert.equal(page.text('.focus-note'), 'Taken back: the question comes to you under Needs your attention, and its chat waits for your answer.')
    await page.click('.focus-undo:not([data-focus-ask])')
    assert.equal(page.sent('/api/goals').length, 2)
    assert.equal(page.sent('/api/goals')[1].body.line, 'Kept the icons')
    assert.equal(page.text('.focus-note'), 'Your partner is asked to undo it.')
  } finally { await page.close() }
})

test('the page: on a board that only shows, the daily note\'s Undo cannot be pressed', async () => {
  const page = await openPage({ state: garden({ canWrite: false, whyNot: 'This board only shows.' }) })
  try {
    await page.click('[data-tab="advice"]')
    assert.deepEqual(page.all('.focus-daily .focus-undo').map(one => one.disabled), [true, true, true])
    await page.click('.focus-undo[data-focus-ask="Q6"]')
    assert.equal(page.sent('/api/goals').length, 0)
  } finally { await page.close() }
})

test('the page: "With your partner" opens at once on a click and lists each ask as a link to its details', async () => {
  const page = await openPage({ state: garden() })
  try {
    assert.equal(page.text('[data-with-partner="toggle"]'), '▸ With your partner: 1 question')
    assert.equal(page.all('.with-partner-ask').length, 0)
    await page.click('[data-with-partner="toggle"]')
    assert.equal(page.text('[data-with-partner="toggle"]'), '▾ With your partner: 1 question')
    const [link, ...more] = page.all('.with-partner-ask')
    assert.equal(more.length, 0)
    assert.equal(link.textContent, 'Q1 · Digger: Box or yew?')
    assert.equal(link.getAttribute('href'), '#details=Q1')
    await page.click('[data-with-partner="toggle"]')
    assert.equal(page.all('.with-partner-ask').length, 0, 'a second click folds it')
  } finally { await page.close() }
})

test('the page: the lane of a chat that waits for the partner says so, in the colour of its own', async () => {
  const page = await openPage({ state: garden() })
  try {
    const pill = page.all('#lanes .pill').find(one => one.textContent.startsWith('Waiting for your partner'))
    assert.ok(pill, 'a lane waits for the partner')
    assert.equal(pill.textContent, 'Waiting for your partner (Q1)')
    assert.ok(pill.classList.contains('is-partner'))
    assert.equal(pill.closest('[data-lane]').dataset.lane, 'Digger')
  } finally { await page.close() }
})

test('the page: "Decided for you by your partner" is folded until opened, and its Undo takes the answer back', async () => {
  const page = await openPage({ state: garden() })
  try {
    assert.equal(page.text('[data-decided="toggle"]'), 'Decided for you by your partner · 1 ›')
    assert.equal(page.all('[data-take-back]').length, 0)
    await page.click('[data-decided="toggle"]')
    assert.equal(page.text('[data-decided="toggle"]'), 'Decided for you by your partner · 1 ▾')
    assert.match(page.text('.decided-for-you'), /Q5 \(Digger, B12\): Icons\? → A \(your advice\)/)
    await page.click('.decided-for-you [data-take-back="Q5"]')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'undo', id: 'Q5' }])
    assert.equal(page.sent('/api/work')[0].headers['X-Board-Token'], TOKEN)
  } finally { await page.close() }
})

test('the page: a refused Undo shows its problem under the answer', async () => {
  const page = await openPage({ state: garden(), answers: () => reply('Q5 is not the partner\'s any more', 409) })
  try {
    await page.click('[data-decided="toggle"]')
    await page.click('[data-take-back="Q5"]')
    assert.equal(page.text('.decided-for-you .problem'), 'Not sent: Q5 is not the partner\'s any more')
  } finally { await page.close() }
})

test('the page: an ask\'s card shows the partner\'s answer with its Undo; an ask taken back says so', async () => {
  const page = await openPage({ state: garden() })
  try {
    await page.change('#needs-closed', true)
    const cards = page.all('.partner-answer')
    const [answeredCard] = cards.filter(one => !one.classList.contains('is-routed'))
    assert.ok(answeredCard, 'the answered ask has its part of the partner')
    assert.match(answeredCard.textContent, /Your partner answered: A/)
    assert.match(answeredCard.textContent, /Why: your advice/)
    const [back] = cards.filter(one => one.classList.contains('is-routed'))
    assert.equal(back.textContent, 'Your partner had answered: A; you took it back')
    await page.click('#needs [data-take-back="Q6"]')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'undo', id: 'Q6' }])
  } finally { await page.close() }
})
