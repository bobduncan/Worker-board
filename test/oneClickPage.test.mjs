// Reactive board, brief P4a: ONE CLICK IS ONE SERVER ACTION, on the page. Each click that used to write the person's input with one
// call and type its word with a second call to /api/say now makes ONE call to the route that stores the input, with a click id;
// it never calls /api/say for it. A word the board did not queue leaves the input standing with "Not sent: <why>, HH:MM" and a
// Retry on the card, drawn from the board's record, and the Retry sends the same click id. Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { openPage, reply, settle } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const PATH = '.claude/brainstorms/2026-11-09-lanterns.md'
const HEAD = '# Brainstorm: Lanterns\nGoal: G6 The polish\nStarted: 2026-11-09 09:00 · State: running\nOpening: Where should the lanterns go?\n\n'
const Q1 = '## Q1 (09:01)\nWhere first?\nContext: Most visitors come in by the gate.\n- A: By the gate (advised)\n- B: By the pond\n'
const A1 = 'Answer (09:02): A\n'
const Q2 = '\n## Q2 (09:04)\nHow bright should they be?\n- A: Dim (advised)\n- B: Bright\n'
// The focus goal before its goal definition is agreed: the Focus page shows the talk with the partner (the run's talk is a bar of its own).
const GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', ''].join('\n')
const idOk = /^[\w-]{8,64}$/

/** The board's state over a made-up thread; `more` adds to it (the board's record of unsent clicks). */
const stateOf = (texts, more = {}) => {
  const state = asSent({ ...build([], undefined, GOALS, { threadTexts: texts.map(([path, text], at) => ({ path, text, at: at + 1 })) }), goalsEdit: { canWrite: true } })
  return { ...state, advisor: { ...state.advisor, isRunning: true }, ...more }
}
const without = body => {
  const { click, via, ...rest } = body
  assert.match(click, idOk, 'a click id is on the call')
  return rest
}

async function brainstormPage(texts, options = {}) {
  const page = await openPage({ state: options.state ?? stateOf(texts), answers: options.answers, hash: options.hash })
  await page.click('[data-tab="advice"]')
  await page.click('[data-advisor-pane="brainstorm"]')
  return page
}

test('Brainstorm: an option, Skip, Back, Wrap up, "Yes, that\'s it", "Not quite" and Change are each ONE call to /api/brainstorm with a click id, and none to /api/say', async () => {
  const page = await brainstormPage([[PATH, `${HEAD}${Q1}${A1}${Q2}`]])
  try {
    await page.click('[data-option="A"]')
    await page.click('.brainstorm-menu-button')
    await page.click('[data-brainstorm-act="skip"]')
    await page.click('.brainstorm-menu-button')
    await page.click('[data-brainstorm-act="back"]')
    await page.click('.brainstorm-menu-button')
    await page.click('[data-brainstorm-act="wrap"]')
    assert.deepEqual(page.sent('/api/say'), [], 'the page types no word itself')
    const calls = page.sent('/api/brainstorm').map(one => one.body)
    assert.deepEqual(calls.map(body => body.command), ['answer', 'skip', 'back', 'wrap'])
    assert.deepEqual(calls.map(without), [{ path: PATH, n: 2, command: 'answer', key: 'A', words: '' }, { path: PATH, n: 2, command: 'skip' }, { path: PATH, n: 2, command: 'back', to: 1 }, { command: 'wrap', path: PATH }])
    assert.equal(new Set(calls.map(body => body.click)).size, 4, 'one id per click')
  } finally { await page.close() }
})

test('Brainstorm: "Change" on a proposal sends its words in ONE call, which the board stores with the click; "type it again" is one call too', async () => {
  const PROPOSAL = '\n## Proposal (09:20)\nDecided:\n- the gate first\nGoals:\n- [ ] Lanterns by the gate — under G6 — Done when: a visitor finds the gate at night\nSteps:\n- [ ] Make a lantern sprite — Units — about 1 h\nNote: most visitors come in by the gate.\n'
  const page = await brainstormPage([[PATH, `${HEAD}${Q1}${A1}${PROPOSAL}`]])
  try {
    await page.click('[data-brainstorm-act="change"]')
    await page.type('#brainstorm-change-text', 'add one for the pond')
    await page.click('[data-brainstorm-act="send-change"]')
    assert.deepEqual(page.sent('/api/say'), [])
    assert.deepEqual(page.sent('/api/brainstorm').map(one => without(one.body)), [{ command: 'change', path: PATH, text: 'add one for the pond' }])
  } finally { await page.close() }
  // P4b: "type it again" shows only where the records say so: the thread's word is Late.
  const late = { w1: { state: 'late', lead: 'Not picked up after 12 min', rest: 'it waits in the queue', at: 1, chat: 'Advisor', canSendAgain: false, link: null, place: 'talk', command: 'brainstorm-answer', about: PATH, goal: null, ask: null, sentAt: 1, title: 'words' } }
  const stopped = await brainstormPage([[PATH, `${HEAD}${Q1}${A1}`]], { state: stateOf([[PATH, `${HEAD}${Q1}${A1}`]], { waits: late }) })
  try {
    await stopped.click('.brainstorm-menu-button')
    await stopped.click('[data-brainstorm-act="again"]')
    assert.deepEqual(stopped.sent('/api/say'), [])
    assert.deepEqual(stopped.sent('/api/brainstorm').map(one => without(one.body)), [{ command: 'again', path: PATH, word: { command: 'brainstorm-answer', n: 1 } }])
  } finally { await stopped.close() }
})

test('Brainstorm: New brainstorm Start is ONE call (the board starts the thread and queues its first word)', async () => {
  const page = await brainstormPage([], { answers: request => reply(request.url === '/api/brainstorm' ? { path: '.claude/brainstorms/2026-11-09-new.md' } : {}) })
  try {
    await page.click('[data-brainstorm-new]')
    await page.type('#brainstorm-new-title', 'Benches')
    await page.type('#brainstorm-new-opening', 'Where do people sit?')
    page.find('#brainstorm-new').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    assert.deepEqual(page.sent('/api/say'), [])
    assert.deepEqual(page.sent('/api/brainstorm').map(one => without(one.body)), [{ command: 'start', title: 'Benches', goal: null, opening: 'Where do people sit?' }])
  } finally { await page.close() }
})

test('Brainstorm: a word the board did not queue leaves the input standing: "Not sent: <why>, HH:MM" with a Retry that sends the same click id and nothing else', async () => {
  const unsent = { click: 'click-aaaa-1111', via: 'brainstorm-answer', key: PATH, route: '/api/brainstorm', why: 'no chat on the board takes it', at: '14:07' }
  const page = await brainstormPage([[PATH, `${HEAD}${Q1}${A1}`]], { state: stateOf([[PATH, `${HEAD}${Q1}${A1}`]], { clicksUnsent: [unsent] }) })
  try {
    assert.equal(page.text('#brainstorm-card .click-unsent'), 'Not sent: no chat on the board takes it, 14:07. Your input stands. Retry')
    await page.click('.click-unsent .click-retry')
    assert.deepEqual(page.sent('/api/brainstorm').map(one => one.body), [{ command: 'click-retry', click: 'click-aaaa-1111' }], 'the same click id, no new input')
    assert.deepEqual(page.sent('/api/say'), [])
  } finally { await page.close() }
  // The record gone (the word queued): the line is gone.
  const sent = await brainstormPage([[PATH, `${HEAD}${Q1}${A1}`]])
  try {
    assert.equal(sent.all('.click-unsent').length, 0)
  } finally { await sent.close() }
})

test('Brainstorm: the answer that came back "not sent" shows its line at once, from the board\'s record', async () => {
  const texts = [[PATH, `${HEAD}${Q1}${A1}${Q2}`]]
  const unsent = { click: 'click-bbbb-2222', via: 'brainstorm-answer', key: PATH, route: '/api/brainstorm', why: 'the outbox is locked', at: '09:05' }
  const page = await brainstormPage(texts, {
    state: requests => stateOf(texts, requests.some(one => one.url === '/api/brainstorm') ? { clicksUnsent: [unsent] } : {}),
    answers: request => reply(request.url === '/api/brainstorm' ? { click: unsent.click, notSent: unsent.why, notSentAt: unsent.at } : {}),
  })
  try {
    await page.click('[data-option="A"]')
    assert.equal(page.all('#brainstorm-card .click-unsent').length, 1)
    assert.match(page.text('#brainstorm-card .click-unsent'), /^Not sent: the outbox is locked, 09:05\./)
    assert.deepEqual(page.sent('/api/say'), [])
  } finally { await page.close() }
})

test('Focus: the talk\'s Send is ONE call (the answer under the question and its word), a click id on it, and none to /api/say', async () => {
  const texts = [[PATH, `${HEAD}${Q1}${A1}${Q2}`]]
  const page = await openPage({ state: stateOf(texts) })
  try {
    await page.click('[data-tab="advice"]')
    await page.click('[data-focus-option="B"]')
    await page.type('#focus-talk-words', 'a bit more than that')
    await page.click('[data-focus-act="talk"]')
    assert.deepEqual(page.sent('/api/say'), [])
    const [call] = page.sent('/api/brainstorm').map(one => one.body)
    assert.equal(call.via, 'talk-send')
    assert.deepEqual(without(call), { command: 'answer', path: PATH, n: 2, key: 'B', words: 'a bit more than that' })
  } finally { await page.close() }
})

test('Focus: a fresh page whose state holds a not-sent talk answer shows the line and its Retry, with no call made first; the Retry sends the stored click id', async () => {
  const texts = [[PATH, `${HEAD}${Q1}${A1}${Q2}`]]
  const unsent = { click: 'click-cccc-3333', via: 'talk-send', key: PATH, route: '/api/brainstorm', why: 'no chat on the board takes it', at: '09:10' }
  const page = await openPage({ state: stateOf(texts, { clicksUnsent: [unsent] }) })
  try {
    await page.click('[data-tab="advice"]')
    assert.deepEqual(page.requests.filter(one => one.method === 'POST'), [], 'nothing was sent yet')
    assert.equal(page.text('.focus-talk .click-unsent'), 'Not sent: no chat on the board takes it, 09:10. Your input stands. Retry')
    await page.click('.focus-talk .click-retry')
    assert.deepEqual(page.sent('/api/brainstorm').map(one => one.body), [{ command: 'click-retry', click: 'click-cccc-3333' }])
    assert.deepEqual(page.sent('/api/say'), [])
  } finally { await page.close() }
  const none = await openPage({ state: stateOf(texts) })
  try {
    await none.click('[data-tab="advice"]')
    assert.equal(none.all('.focus-talk .click-unsent').length, 0, 'no record, no line')
  } finally { await none.close() }
})

test('Goals: a fresh page whose state holds a not-sent ask shows the line and its Retry under the ask, with no call made first', async () => {
  const goals = ['# Goals', 'Last id: G6', 'Last ask: A1', 'Focus: G6', '', '- [~] G6 Benches that match the picture', '  Steps: B12', '  Ask (A1, 2026-11-09 09:00): why are the benches grey?', '  Ask (A2, 2026-11-09 09:05): and the gate?', ''].join('\n')
  const unsent = { click: 'click-dddd-4444', via: 'goal-ask', key: 'G6:A2', route: '/api/goals', why: 'no chat on the board takes it', at: '09:10' }
  const stateWith = more => asSent({ ...build([], undefined, goals), goalsEdit: { canWrite: true }, ...more })
  const page = await openPage({ state: stateWith({ clicksUnsent: [unsent] }), hash: 'advice/goals/G6' })
  try {
    assert.deepEqual(page.requests.filter(one => one.method === 'POST'), [], 'nothing was sent yet')
    // Keyed by the ask: A1 (sent, waiting) shows no line, A2 shows it.
    assert.equal(page.all('.goal-ask-block .click-unsent').length, 1)
    assert.equal(page.text('[data-ask-block="A2"] .click-unsent'), 'Not sent: no chat on the board takes it, 09:10. Your input stands. Retry')
    assert.equal(page.all('[data-ask-block="A1"] .click-unsent').length, 0)
    await page.click('.goal-ask-block .click-retry')
    assert.deepEqual(page.sent('/api/goals').map(one => one.body), [{ command: 'click-retry', click: 'click-dddd-4444' }])
    assert.deepEqual(page.sent('/api/say'), [])
  } finally { await page.close() }
  const none = await openPage({ state: stateWith({}), hash: 'advice/goals/G6' })
  try {
    assert.equal(none.all('.goal-ask-block .click-unsent').length, 0)
  } finally { await none.close() }
})

test('Goals: "Ask the Advisor" Send is ONE call to /api/goals (the Ask line under the goal and its word), none to /api/say; a word not queued keeps the box open and "Send again" is the Retry by the click id', async () => {
  const goals = ['# Goals', 'Last id: G6', 'Last ask: A1', 'Focus: G6', '', '- [~] G6 Benches that match the picture', '  Steps: B12', ''].join('\n')
  let notSent = true
  const page = await openPage({
    state: () => ({ ...asSent({ ...build([], undefined, goals), goalsEdit: { canWrite: true } }), clicksUnsent: notSent ? [{ click: 'click-dddd-4444', via: 'goal-ask', key: 'G6', route: '/api/goals', why: 'no chat on the board takes it', at: '09:10' }] : [] }),
    answers: request => reply(request.url === '/api/goals' && request.body.command === 'ask' ? { id: 'A1', click: 'click-dddd-4444', notSent: 'no chat on the board takes it', notSentAt: '09:10' } : request.url === '/api/goals' ? { click: 'click-dddd-4444', said: 'w1' } : {}),
    hash: 'advice/goals/G6',
  })
  try {
    await page.click('[data-goal-tool="ask"]')
    await page.type('#goals-ask-text', 'why are the benches grey?')
    await page.click('#goals-ask-send')
    assert.deepEqual(page.sent('/api/say'), [])
    const [call] = page.sent('/api/goals').map(one => one.body)
    assert.deepEqual(without(call), { command: 'ask', id: 'G6', text: 'why are the benches grey?', pictures: [], page: call.page })
    assert.match(page.text('#goals-ask-note'), /^A1 stands under the goal, but Not sent: no chat on the board takes it, 09:10\. Your input stands\./)
    assert.equal(page.text('#goals-ask-send'), 'Send again')
    notSent = false
    await page.click('#goals-ask-send')
    assert.deepEqual(page.sent('/api/goals').slice(1).map(one => one.body), [{ command: 'click-retry', click: 'click-dddd-4444' }], 'the retry sends the click id only: no second ask is written')
    assert.deepEqual(page.sent('/api/say'), [])
  } finally { await page.close() }
})

test('a plain talk Send carries a click id: kept while the board did not answer (the retry reuses it), a new one after an answer', async () => {
  let answering = 'down'
  const page = await openPage({ state: stateOf([]), answers: request => (request.url === '/api/say' && answering === 'down' ? reply('the outbox is locked', 500) : reply({ id: 'w1' })) })
  try {
    const send = async text => {
      await page.type('#say-text', text)
      page.find('#say').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
      await settle()
    }
    await send('hello partner')
    await send('hello partner')
    answering = 'up'
    await send('hello partner')
    await send('and one more')
    const calls = page.sent('/api/say').map(one => one.body)
    assert.equal(calls.length, 4)
    assert.ok(calls.every(body => body.via === 'talk-send' && idOk.test(body.click)))
    assert.equal(new Set(calls.slice(0, 3).map(body => body.click)).size, 1, 'a failed call is retried with the same click id')
    assert.notEqual(calls[3].click, calls[0].click, 'a click after an answer has a new id')
  } finally { await page.close() }
})

// ---- Round 3 (the review) ----

test('one id per input: a changed input after a failed call gets a new id (A cut off, then B is sent as its own click); the board\'s "different input" refusal is answered by one more send under a new id', async () => {
  let down = true
  const page = await openPage({ state: stateOf([]), answers: request => (request.url === '/api/say' && down ? reply('cut off', 500) : reply({ id: 'w1' })) })
  try {
    const send = async text => {
      await page.type('#say-text', text)
      page.find('#say').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
      await settle()
    }
    await send('A: the gate first')
    down = false
    await send('B: the pond first')
    const [a, b] = page.sent('/api/say').map(one => one.body)
    assert.notEqual(a.click, b.click, 'B is another input: another click')
  } finally { await page.close() }
  let clashes = 0
  const texts = [[PATH, `${HEAD}${Q1}${A1}${Q2}`]]
  const brainstorm = await brainstormPage(texts, { answers: request => (request.url === '/api/brainstorm' && clashes++ === 0 ? reply('a different input under this click', 409) : reply({})) })
  try {
    await brainstorm.click('[data-option="A"]')
    const calls = brainstorm.sent('/api/brainstorm').map(one => one.body)
    assert.equal(calls.length, 2)
    assert.notEqual(calls[0].click, calls[1].click)
    assert.deepEqual(without(calls[0]), without(calls[1]))
  } finally { await brainstorm.close() }
})

test('Goals "Send again": the retry\'s own answer decides: a click the board does not know shows "not found: send it anew", never "Asked"', async () => {
  const goals = ['# Goals', 'Last id: G6', 'Last ask: A1', 'Focus: G6', '', '- [~] G6 Benches that match the picture', '  Steps: B12', ''].join('\n')
  const page = await openPage({
    state: () => asSent({ ...build([], undefined, goals), goalsEdit: { canWrite: true } }),
    answers: request => (request.url === '/api/goals' && request.body.command === 'click-retry' ? reply('That click is not on the board any more: do it again.', 404)
      : reply(request.url === '/api/goals' ? { id: 'A1', click: 'click-ffff-6666', notSent: 'no chat on the board takes it', notSentAt: '09:10' } : {})),
    hash: 'advice/goals/G6',
  })
  try {
    await page.click('[data-goal-tool="ask"]')
    await page.type('#goals-ask-text', 'why are the benches grey?')
    await page.click('#goals-ask-send')
    await page.click('#goals-ask-send')
    assert.match(page.text('#goals-ask-note'), /not found, send it anew/)
    assert.doesNotMatch(page.text('#goals-ask-note'), /Asked/)
    assert.equal(page.find('#goals-ask').hidden, false, 'the box stays open')
  } finally { await page.close() }
})

test('the Retry button handles its answer: the retried word is put on the clipboard without a Workers mod, and the button is enabled again after any answer', async () => {
  const unsent = { click: 'click-gggg-7777', via: 'brainstorm-answer', key: PATH, route: '/api/brainstorm', why: 'locked', at: '09:05' }
  const texts = [[PATH, `${HEAD}${Q1}${A1}`]]
  const page = await brainstormPage(texts, { state: stateOf(texts, { clicksUnsent: [unsent] }), answers: () => reply('refused again', 409) })
  try {
    await page.click('#brainstorm-card .click-retry')
    assert.equal(page.find('#brainstorm-card .click-retry').disabled, false, 'enabled again after the answer')
  } finally { await page.close() }
  const copied = await brainstormPage(texts, { state: stateOf(texts, { clicksUnsent: [unsent] }), answers: () => reply({ said: 'w9', paste: { text: 'brainstorm answer\nThread: t', chat: 'Garden · Advisor' } }) })
  try {
    await copied.click('#brainstorm-card .click-retry')
    assert.ok(copied.all('.paste-note').length > 0, 'the paste bar shows the retried word')
  } finally { await copied.close() }
})

test('Refine "Ask for pictures": a word not queued is drawn from the board\'s record only, not from the page\'s memory', async () => {
  const script = (await import('node:fs/promises')).readFile
  const source = await script(new URL('../public/board.js', import.meta.url), 'utf8')
  const asked = source.slice(source.indexOf('async function askQuestionPictures('), source.indexOf("$('details').addEventListener('click'", source.indexOf('async function askQuestionPictures(')))
  assert.doesNotMatch(asked, /notSentWords/)
})
