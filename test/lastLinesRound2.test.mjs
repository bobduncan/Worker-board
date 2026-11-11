// Reactive board, brief P4c round 2 (the review's findings): the Vision lines read from the records only, the open slide's line, the words
// of whole-plan words, the 24-hour ended line freeing its buttons, Start again from the word's kept words, no page memory of "sent", one line
// per word on the Interview, and the page parts of the nudge and "Ask for pictures". Made-up garden chats.
import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, step, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { planState, withPlanWork } from '../src/plan.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'
import { buildState } from './withStore.mjs'

const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const at = minutesAgo => NOW - minutesAgo * MIN
const lane = name => ({ name, isRunning: true, status: 'Free', state: 'free', task: null, report: null, wake: null })

const PLAN_OPEN = '# Garden\n\nPitch: A garden.\n\n## P1 · What it is\n\n- State: open\n\n## P7 · The road\n\n- State: assumed (partner, 2026-10-18)\n- Point: **First** a bench\n'
const PLAN_DECIDED = PLAN_OPEN.replace('- State: open', '- State: decided (you, 2026-10-19)')
const PLAN_ONLY_ROAD = '# Garden\n\nPitch: A garden.\n\n## P7 · The road\n\n- State: assumed (partner, 2026-10-18)\n- Point: **First** a bench\n'
const lineOf = (state, lead, rest, more = {}) => ({ state, lead, rest, at: at(3), chat: 'Advisor', canSendAgain: false, link: null, place: 'plan', command: 'plan-deeper', about: 'P1', goal: null, ask: null, sentAt: at(3), title: 'plan: P1', ...more })
const stateOf = (text, outbox, waits, more = {}) => {
  const base = asSent({ ...build([], undefined, ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', ''].join('\n')), goalsEdit: { canWrite: true } })
  return { ...base, advisor: lane('Advisor'), plan: withPlanWork(planState(text, [], 'p.md'), outbox, null, NOW), waits, readAt: NOW, ...more }
}
const word = (command, about, more = {}) => ({ id: `w-${command}-${about}`, to: 'Advisor', ask: null, step: null, text: `plan: ${command}`, command, about, at: at(3), state: 'delivered', ...more })

test('the open slide shows the line of the answer that asked for its next question (the record names the card), and the plan-ask line only once (slide, never also the list)', async () => {
  // The person answered P1.2: the record of that answer names its card (`planCard`), the partner has not written P1's next question yet.
  const answer = { id: 'a1', to: 'Advisor', ask: 'work:Q8', title: 'P1.2: how big?', text: 'A', at: at(3), state: 'delivered' }
  const waits = { a1: lineOf('picked-up', 'Advisor is on it', `since ${hhmm(at(2))}`, { place: 'answer', command: 'answer', about: null, planCard: 'P1', ask: 'work:Q8', title: 'A' }) }
  const page = await openPage({ state: stateOf(PLAN_OPEN, [answer], waits), now: NOW, answers: () => reply({}) })
  try {
    await page.click('[data-tab="vision"]')
    await page.click('[data-vision-act="page"][data-vision-id="interview"]')
    assert.match(words(page.find('#view-vision .vision-open')), /Advisor is on it/, 'P1.2 answered: the open slide of P1 shows the line')
  } finally { await page.close() }
  // Another card's answer is not this slide's line.
  const other = await openPage({ state: stateOf(PLAN_OPEN, [answer], { a1: { ...waits.a1, planCard: 'P5' } }), now: NOW })
  try {
    await other.click('[data-tab="vision"]')
    await other.click('[data-vision-act="page"][data-vision-id="interview"]')
    assert.equal(other.all('#view-vision .vision-open .wait-line').length, 0)
  } finally { await other.close() }
  // The word that asked for the options: one line on the open slide, none again in the tab's list.
  const ask = word('plan-ask', 'P1')
  const once = await openPage({ state: stateOf(PLAN_OPEN, [ask], { [ask.id]: lineOf('picked-up', 'Advisor is on it', `since ${hhmm(at(2))}`, { command: 'plan-ask', about: 'P1' }) }), now: NOW })
  try {
    await once.click('[data-tab="vision"]')
    await once.click('[data-vision-act="page"][data-vision-id="interview"]')
    assert.equal(once.all('#view-vision .wait-line').length, 1, 'one status for the word')
    assert.equal(once.all('#view-vision .vision-open .wait-line').length, 1, 'on the open slide')
    assert.equal(once.all('.vision-working .wait-line').length, 0, 'not in the list')
  } finally { await once.close() }
})

test('every row about the whole plan names its word, by the plan module\'s own label: two such words give two rows you can tell apart', async () => {
  const check = word('plan-check', 'plan')
  const tradeoffs = word('plan-tradeoffs', 'plan')
  const waits = {
    [check.id]: lineOf('picked-up', 'Advisor is on it', 'since 10:00', { command: 'plan-check', about: 'plan' }),
    [tradeoffs.id]: lineOf('picked-up', 'Advisor is on it', 'since 10:01', { command: 'plan-tradeoffs', about: 'plan', sentAt: at(2) }),
  }
  const page = await openPage({ state: stateOf(PLAN_OPEN, [check, tradeoffs], waits), now: NOW })
  try {
    await page.click('[data-tab="vision"]')
    const rows = page.all('.vision-working .vision-working-line').map(row => words(row.querySelector('.vision-working-about')))
    assert.deepEqual(rows.sort(), ['On the plan check', 'On the tradeoffs'])
  } finally { await page.close() }
})

test('a line that ended after 24 h is not busy: its Vision button is free and Send again stays offered; a Sent line holds the button', async () => {
  const deeper = word('plan-deeper', 'P1')
  const ended = { ...lineOf('sent', `Sent ${hhmm(at(3))}`, 'no answer recorded in 24 h', { isEnded: true }) }
  const page = await openPage({ state: stateOf(PLAN_DECIDED, [deeper], { [deeper.id]: ended }), now: NOW })
  try {
    await page.click('[data-tab="vision"]')
    assert.equal(page.find('[data-vision-act="deeper"][data-vision-id="P1"]').disabled, false)
    assert.equal(page.all('[data-vision-act="resend"]').length, 1, 'Send again')
  } finally { await page.close() }
  const sent = await openPage({ state: stateOf(PLAN_DECIDED, [deeper], { [deeper.id]: lineOf('sent', `Sent ${hhmm(at(3))}`, 'waits for Advisor to pick it up') }), now: NOW })
  try {
    await sent.click('[data-tab="vision"]')
    assert.equal(sent.find('[data-vision-act="deeper"][data-vision-id="P1"]').disabled, true)
    assert.equal(sent.all('[data-vision-act="resend"]').length, 0)
  } finally { await sent.close() }
})

test('Start again refills the box from the start word\'s kept words (the state), also on a fresh page; it shows with no line (a copied start) and with a closed line past its ten minutes, not on a just-sent start', async () => {
  const empty = (planStart, waits = {}) => ({ ...stateOf(PLAN_OPEN, [], waits), plan: null, planStart })
  for (const round of [1, 2]) {
    const page = await openPage({ state: empty({ at: at(30), state: 'working', said: 'a tactics game for short breaks' }), now: NOW })
    try {
      await page.click('[data-tab="vision"]')
      assert.equal(page.all('[data-vision-act="start-again"]').length, 1, `round ${round}: no line, its wait card stands: Start again`)
      await page.click('[data-vision-act="start-again"]')
      assert.equal(page.find('#vision-extra-words').value, 'a tactics game for short breaks', 'the kept words, from the record')
    } finally { await page.close() }
  }
  const closed = await openPage({ state: empty({ at: at(30), state: 'working' }, { w1: lineOf('closed', 'closed', '', { command: 'plan-start', about: 'plan', at: at(20) }) }), now: NOW })
  try {
    await closed.click('[data-tab="vision"]')
    assert.equal(closed.all('[data-vision-act="start-again"]').length, 1, 'a closed line past ten minutes shows no line: Start again')
  } finally { await closed.close() }
  const fresh = await openPage({ state: empty({ at: at(1), state: 'waiting' }, { w1: lineOf('sent', `Sent ${hhmm(at(1))}`, 'waits for Advisor to pick it up', { command: 'plan-start', about: 'plan' }) }), now: NOW })
  try {
    await fresh.click('[data-tab="vision"]')
    assert.equal(fresh.all('[data-vision-act="start-again"]').length, 0, 'a start with its Sent line shows no Start again')
  } finally { await fresh.close() }
})

test('a decision sent in your own words leaves the Interview because the record says it is with the partner, never because of page memory', async () => {
  const shows = async outbox => {
    const page = await openPage({ state: stateOf(PLAN_ONLY_ROAD, outbox, {}), now: NOW })
    try {
      await page.click('[data-tab="vision"]')
      await page.click('[data-vision-act="page"][data-vision-id="interview"]')
      return page.all('#view-vision [data-vision-act="decide-words"]').length
    } finally { await page.close() }
  }
  assert.equal(await shows([]), 1, 'the decision of P7 waits for you')
  assert.equal(await shows([word('plan-change', 'P7')]), 0, 'its word to the partner stands in the record: the slide is away, also on a fresh page')
})

// ---------------------------------------------------------------------------------------------------------------------
// The hint's nudge: the button and its line (the page part)

/** The board's state as the page reads it, with a worker that holds a step and ended its turn with nothing asked: a hint with the nudge way (made-up chats). */
function idleHintState() {
  const config = { ...parseConfig('{}', {}), project: 'C:\\game' }
  const held = parseItem(`Id: B269\nKind: step\nTitle: Step B269\nState: in progress\nOwner: Board\nSince: ${sinceOf(NOW - 60 * MIN)}\n`)
  const work = storeFromText('## Board\n', { now: NOW - 120 * MIN })
  work.items.set('B269', held)
  const app = name => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1' })
  const done = [typed(NOW - 20 * MIN, 'Show me B269.'), step(NOW - 19 * MIN, 'Build'), toolResult(NOW - 18 * MIN), answer(NOW - 10 * MIN, 'B269 is ready for your look.')]
  const names = ['Main', 'Board', 'Support', 'Advisor']
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: names.map(app),
    tails: Object.fromEntries(names.map(name => [`cli-${name}`, { text: (name === 'Board' ? done : [answer(NOW - 90 * MIN, 'ok')]).join('\n'), isCut: false, modifiedAt: NOW - 2 * MIN }])),
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return asSent(buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config }))
}

test('the hint\'s nudge: its line stands beside the button; the button is off while the line is Sent or Picked up and free with no line or a line past 24 h', async () => {
  const base = idleHintState()
  const hint = base.forYou.find(need => need.kind === 'idle')
  assert.ok(hint, 'the idle worker is a hint')
  const free = (state, more = {}) => ({ state, lead: state === 'sent' ? 'Sent 11:57' : 'Board is on it', rest: state === 'sent' ? 'waits for Board to pick it up' : 'since 11:58', at: at(3), chat: 'Board', canSendAgain: false, link: null, place: 'free', command: 'nudge', about: hint.id, goal: null, ask: null, sentAt: at(3), title: 'are you stuck?', ...more })
  const check = async (waits, test) => {
    const page = await openPage({ state: { ...base, waits, readAt: NOW }, now: NOW })
    try { await test(page) } finally { await page.close() }
  }
  await check({}, async page => {
    assert.equal(page.find('[data-nudge]').disabled, false)
    assert.equal(page.all('.need .wait-line, .inbox .wait-line').length, 0, 'no record: no line')
  })
  await check({ n1: free('sent') }, async page => {
    assert.equal(page.find('[data-nudge]').disabled, true, 'Sent: not pressed twice')
    assert.match(words(page.find('.inbox .wait-words')), /^Sent 11:57 · waits for Board to pick it up$/)
  })
  await check({ n1: free('picked-up') }, async page => assert.equal(page.find('[data-nudge]').disabled, true))
  await check({ n1: free('sent', { isEnded: true, rest: 'no answer recorded in 24 h' }) }, async page => assert.equal(page.find('[data-nudge]').disabled, false, 'ended after a day: free again'))
})

test('a task step\'s window is drawn again when a free line of its asks changes: its redraw key holds the free-line keys in the task branch too', async () => {
  const { readFile } = await import('node:fs/promises')
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  assert.match(script, /isTask \? \[taskItem, taskAsks\.map\(one => \[[^\]]*\]\), freeKeysOf\(state\)\] : null/)
})
