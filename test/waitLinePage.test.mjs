// The wait line on the page (T22, spec art-inbox/focus-mocks/wait-rule/spec.md, mock.png; the person, 2026-11-02: "either the
// board responds immediately, e.g. via code. or we expect an ai chat todo something in which case i always need clear visual
// indications, maybe a loader. and the status if its being picked up or not. I want to know whats going on."), clicked through
// the DOM harness (test/README-page-tests.md). The server's `waits` (src/waitLine.mjs) are added by hand, as the server adds
// them to the state. Wave 1: an answered ask stays as a slim card with its line until done, Find obsolete items, a Check now
// sweep, and the goal recap's Send feedback (its popup and the Focus page's card). Made-up garden chats.
import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { demoPage } from '../src/demo.mjs'
import { roundPage, withRound } from '../src/demoFeedback.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { MIN, NOW, RUN_GOALS, app, ask, asSent, build, tail } from './partnerState.mjs'
import { buildState } from './withStore.mjs'

const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
/** A line as the server puts it in the state's `waits` (src/waitLine.mjs `waitsOf`). */
const line = (state, lead, rest, more = {}) => ({ state, lead, rest, at: NOW - 3 * MIN, chat: 'Digger', canSendAgain: false, link: null, command: 'answer', about: null, ask: 'work:Q5', sentAt: NOW - 3 * MIN, title: 'A', ...more })
/** The garden with the person's answer to Q5 in the outbox (`answered`: its word), and the server's `waits`. */
function answeredState(waits, word = { id: 'w5', to: 'Digger', ask: 'work:Q5', step: 'B12', title: 'Number or bar?', version: null, verdict: null, text: 'A', at: NOW - 3 * MIN, state: 'waiting' }) {
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW - 60 * MIN })
  work.items.set('Q5', ask('Q5', null, NOW - 10 * MIN))
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail([typed(NOW - 20 * MIN, 'hi'), answer(NOW - 12 * MIN, 'ok')]) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
  }
  const state = asSent(buildState(raw, { lines: [], outbox: [word], runs: [], board: null, seen: null, now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\\garden' } }))
  return { ...state, waits }
}

test('the state names the answer\'s word id (state.mjs asAnswer), by which the card finds its line', () => {
  const need = answeredState({}).forYou.find(one => one.workId === 'Q5')
  assert.equal(need.answer.id, 'w5')
})

test('an answered ask stays as a slim card with its line and its chat\'s pill until the line is Done; a code answer goes at once', async () => {
  const sent = line('sent', `Sent ${hhmm(NOW - 3 * MIN)}`, 'waits for Digger to pick it up · next in its queue')
  const page = await openPage({ state: answeredState({ w5: sent }) })
  try {
    const slim = page.all('#needs .need.is-slim')
    assert.equal(slim.length, 1, 'the answered card stays, slim')
    assert.equal(slim[0].dataset.id, 'work:Q5')
    assert.equal(words(slim[0].querySelector('h4')), 'Number or bar?')
    assert.equal(words(slim[0].querySelector('.wait-line .wait-words')), `Sent ${hhmm(NOW - 3 * MIN)} · waits for Digger to pick it up · next in its queue`)
    assert.ok(slim[0].querySelector('.wait-line.is-sent'), 'Sent, in a quiet tone')
    assert.equal(slim[0].querySelector('.wait-line .pill')?.className.startsWith('pill is-'), true, 'the chat\'s own status pill beside it')
    assert.equal(page.text('#needs-count'), '', 'an answered card is not counted: nothing waits for the person')
    assert.equal(page.all('#needs .need:not(.is-slim)').length, 0, 'no full card: it is answered')
  } finally { await page.close() }
  // Done: the card goes, as an answered card always went; "Show closed" still shows it.
  const done = await openPage({ state: answeredState({ w5: line('done', `Digger answered ${hhmm(NOW - MIN)}`, '', { at: NOW - MIN, isFallback: true }) }) })
  try {
    assert.equal(done.all('#needs .need.is-slim').length, 0)
    assert.match(done.text('#needs .empty'), /Nothing waits for you\. 1 answered, hidden\./)
  } finally { await done.close() }
  // No line (the board answered it itself, or the word is closed): no slim card either.
  const none = await openPage({ state: answeredState({}) })
  try {
    assert.equal(none.all('#needs .need.is-slim').length, 0)
  } finally { await none.close() }
})

test('the four states: a ring, a loader, a tick, and Late the only one in the attention class; a Done line\'s link opens its step', async () => {
  const states = {
    sent: line('sent', 'Sent 09:57', 'waits for Digger to pick it up'),
    'picked-up': line('picked-up', 'Digger is on it', 'since 09:58'),
    late: line('late', 'Not picked up after 12 min', "it waits in Digger's queue"),
  }
  for (const [state, given] of Object.entries(states)) {
    const page = await openPage({ state: answeredState({ w5: given }) })
    try {
      const drawn = page.find('#needs .wait-line')
      assert.equal(drawn.className, `wait-line is-${state}`)
      const sign = drawn.querySelector('.wait-sign')
      if (state === 'picked-up') assert.ok(sign.classList.contains('calm-spinner'), 'the loader while its chat is on it')
      else assert.equal(sign.textContent, state === 'sent' ? '○' : '!')
      assert.equal(drawn.querySelector('.wait-lead').textContent, given.lead)
      assert.equal(drawn.querySelector('.wait-again'), null, 'no Send again while the board does not offer it')
    } finally { await page.close() }
  }
  // A Done line of the obsolete check... and a recap Send's Done with its new task: the link opens B12's window at once.
  const linked = line('done', `Done ${hhmm(NOW - MIN)}`, '1 new task for what you sent back', { at: NOW - MIN, link: { step: 'B12', text: 'See B12 →' }, command: 'recap-feedback', about: 'G6', ask: null })
  const page = await openPage({ state: { ...asSent(build([], undefined, RUN_GOALS)), waits: { r1: linked } } })
  try {
    await page.click('[data-tab="advice"]')
    const card = page.find('#advisor-focus .focus-recap-sent')
    assert.equal(words(card.querySelector('h3')), 'G6 · Your recap · feedback sent')
    assert.ok(card.querySelector('.wait-line.is-done'))
    assert.equal(card.querySelector('.wait-sign').textContent, '✓')
    assert.equal(page.all('dialog[open]:not(#help)').length, 0)
    await page.click('#advisor-focus [data-wait-step="B12"]')
    assert.equal(page.all('dialog[open]:not(#help)').length, 1, 'a window opened for B12 (the help tour of a first visit aside)')
    assert.match(words(page.find('dialog[open]:not(#help)')), /B12/)
  } finally { await page.close() }
})

test('Find obsolete items: "Asked" and the line until the Advisor\'s turn is on it, never "checking" from the record alone; Late beats the 15-minute words', async () => {
  const check = (state, more = {}) => ({ state, at: NOW - 4 * MIN, openCount: 3, rows: [], last: null, canCheck: true, whyNot: null, ...more })
  const obsoleteLine = (state, lead, rest) => line(state, lead, rest, { chat: 'Advisor', command: 'obsolete-check', about: 'obsolete', ask: null, sentAt: NOW - 4 * MIN })
  const base = asSent(build([], undefined))
  const page = await openPage({ state: { ...base, obsolete: check('checking'), waits: { o1: obsoleteLine('sent', 'Sent 09:56', 'waits for Advisor to pick it up · 2nd in its queue') } } })
  try {
    const part = page.find('#needs .obsolete-check')
    assert.equal(words(part.querySelector('[data-obsolete="check"]')), 'Asked', 'not "The Advisor is checking": its turn has not taken the word')
    assert.equal(part.querySelector('[data-obsolete="check"] .calm-spinner'), null)
    assert.equal(words(part.querySelector('.wait-line .wait-words')), 'Sent 09:56 · waits for Advisor to pick it up · 2nd in its queue')
  } finally { await page.close() }
  const late = await openPage({ state: { ...base, obsolete: check('late'), waits: { o1: obsoleteLine('late', 'Not picked up after 16 min', "it waits in Advisor's queue") } } })
  try {
    const part = late.find('#needs .obsolete-check')
    assert.ok(part.querySelector('.wait-line.is-late'))
    assert.doesNotMatch(words(part), /did not answer in 15 minutes/, 'one clock: the line says it')
    assert.equal(words(part.querySelector('[data-obsolete="check"]')), 'Try again')
  } finally { await late.close() }
  // A board without the line (an older server): as before.
  const old = await openPage({ state: { ...base, obsolete: check('checking') } })
  try {
    assert.equal(words(old.find('#needs .obsolete-check [data-obsolete="check"]')), 'The Advisor is checking')
  } finally { await old.close() }
})

test('Check now: the asked sweep\'s line under the supervisor\'s head, folded or open; none for a sweep by the clock', async () => {
  const supervisor = sweep => ({ run: null, checkedAt: NOW - MIN, rules: [], incidents: [], cards: [], lastSweep: sweep, sweepNote: null, sweepEvery: 10, sweepsToday: null })
  const sweepLine = line('picked-up', 'Supervisor is on it', `since ${hhmm(NOW - MIN)}`, { chat: 'Supervisor', command: 'sweep', about: 'board', ask: null })
  const base = asSent(build([], undefined))
  const asked = { at: NOW - 2 * MIN, asked: true, subject: null, ended: null, how: null, found: 0, read: false, tokens: null, tokenParts: null, note: null, word: 's1' }
  const page = await openPage({ state: { ...base, supervisor: supervisor(asked), waits: { s1: sweepLine } } })
  try {
    const drawn = page.find('#supervisor .wait-line')
    assert.equal(drawn.className, 'wait-line is-picked-up')
    assert.equal(words(drawn.querySelector('.wait-words')), `Supervisor is on it · since ${hhmm(NOW - MIN)}`)
  } finally { await page.close() }
  const byClock = await openPage({ state: { ...base, supervisor: supervisor({ ...asked, asked: false }), waits: { s1: sweepLine } } })
  try {
    assert.equal(byClock.all('#supervisor .wait-line').length, 0)
  } finally { await byClock.close() }
})

const PATH = 'pictures/g6/demo.json'
const list = () => ({
  goal: 'G6', title: 'The polish', step: 'B7',
  sections: [
    { kind: 'reached', rows: [{ title: '1. Lava', pictures: [{ kind: 'target', caption: 'target', path: 'a.png' }] }] },
    { kind: 'not-reached', rows: [{ title: '3. Round shapes', pictures: [{ kind: 'final-not', caption: 'last try', path: 'c.png' }] }] },
  ],
})
const shown = (feedback = null) => {
  const page = roundPage(demoPage(list(), 'pictures/g6'), feedback)
  return { ...page, feedback: { ...page.feedback, canSend: true, whyNot: null } }
}

test('the recap\'s Send feedback: the popup draws the line of the word its answer named, and follows the state (Sent, then the partner on it)', async () => {
  let demo = shown()
  let waits = {}
  const recapLine = (state, lead, rest) => line(state, lead, rest, { chat: 'Advisor', command: 'recap-feedback', about: 'G6', ask: null, title: 'recap feedback: G6 The polish, round 1: 1 part sent back' })
  const answers = request => {
    if (request.url.startsWith('/api/demo?')) return reply(demo)
    if (request.url === '/api/demo-feedback') return reply({ round: 1, approved: 1, sentBack: 1, done: false, notedOn: 'B7', closed: [], said: 'r1' })
    return reply({})
  }
  const page = await openPage({ state: () => ({ ...asSent(build([], undefined)), waits }), answers, hash: `demo=${PATH}` })
  try {
    await settle(10)
    await page.click('[data-demo-verdict="approved"][data-demo-key="1. Lava"]')
    await page.click('[data-demo-verdict="sent-back"][data-demo-key="3. Round shapes"]')
    await page.type('[data-demo-comment="3. Round shapes"]', 'still stepped')
    demo = shown(withRound(null, 1, [{ key: '1. Lava', verdict: 'approved', comment: '' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'still stepped' }], 'x'))
    waits = { r1: recapLine('sent', 'Sent 09:57', 'waits for Advisor to pick it up') }
    await page.reread()
    await page.click('[data-demo-send]')
    await settle(10)
    assert.match(page.text('.demo-notice'), /Sent: 1 approved, 1 sent back/)
    assert.equal(words(page.find('.demo-side .demo-wait .wait-words')), 'Sent 09:57 · waits for Advisor to pick it up')
    waits = { r1: recapLine('picked-up', 'Advisor is on it', 'since 09:59') }
    await page.reread()
    await settle(10)
    assert.equal(page.find('.demo-side .demo-wait .wait-line').className, 'wait-line is-picked-up', 'the open popup follows the state')
  } finally { await page.close() }
})
