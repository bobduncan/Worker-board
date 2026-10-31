// Signals change 2: the same word in every view. The page is clicked through the DOM harness (test/README-page-tests.md):
// text and classes only. One lane per word is handed to it; every view must draw that word and no other state word.
// Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { WORDS, WORD_FACTS, WORD_LIST, countsOf } from '../src/chatWord.mjs'
import { openPage } from './pageHarness.mjs'
import { MIN, NOW, asSent, build } from './partnerState.mjs'

const SEC = 1000
/** The states the board's decisions keep for each word (they stay: the word is display only). */
const STATE_OF = {
  [WORDS.WORKING]: 'working', [WORDS.WAITING]: 'waiting', [WORDS.CHECKING]: 'free', [WORDS.HANDING]: 'free', [WORDS.OFFERED]: 'free', [WORDS.HELD]: 'free',
  [WORDS.NO_ANSWER]: 'unknown', [WORDS.PAUSED]: 'suspended', [WORDS.RESTARTING]: 'unknown', [WORDS.STOPPED]: 'interrupted', [WORDS.FREE]: 'free',
  [WORDS.ASLEEP]: 'free', [WORDS.NOT_RUNNING]: 'off', [WORDS.UNKNOWN]: 'unknown',
}
const baseState = asSent(build([], undefined, undefined))
const template = baseState.chats.find(chat => chat.name === 'Digger')

/** A lane of the made-up garden carrying `word`, with the old fields a board would keep for it. */
function lane(word, more = {}) {
  const name = `Lane ${WORD_LIST.indexOf(word)}`
  return {
    ...structuredClone(template), name, state: STATE_OF[word], isRunning: word !== WORDS.NOT_RUNNING, asleep: word === WORDS.ASLEEP, asleepSince: word === WORDS.ASLEEP ? NOW - 7 * MIN : null,
    suspended: word === WORDS.PAUSED ? { by: 'app', limit: 'fiveHour', since: NOW - MIN, until: NOW + 30 * MIN, isBack: false } : null, offWhy: word === WORDS.NOT_RUNNING ? 'silent since 11:50' : null,
    word, why: null, since: null, reportAt: NOW - 2 * SEC, age: 2 * SEC, task: null, eta: null, queue: [], flags: [], ...more,
  }
}

const everyWord = (more = () => ({})) => WORD_LIST.map(word => lane(word, more(word)))
const stateOf = chats => ({ ...baseState, chats, counts: countsOf(chats) })
const laneNamed = (page, name) => page.all('#lanes [data-lane]').find(one => one.dataset.lane === name)

test('every lane draws exactly one word, from the word list, as its pill', async () => {
  const chats = everyWord()
  const page = await openPage({ state: stateOf(chats), now: NOW })
  try {
    for (const one of chats) {
      const drawn = laneNamed(page, one.name)
      const pills = [...drawn.querySelectorAll('.pill')]
      assert.equal(pills.length, 1, `${one.word}: one pill`)
      assert.ok(WORD_LIST.some(word => pills[0].textContent.startsWith(word)), `${one.word}: "${pills[0].textContent}" starts with a word of the list`)
      assert.equal(pills[0].dataset.word, one.word)
      // Exactly one word beside the name: no small tag ("asleep", "not running") says a second one.
      const beside = drawn.querySelector('.who').textContent.toLowerCase()
      assert.deepEqual(WORD_LIST.filter(word => beside.includes(word.toLowerCase())), [one.word], `${one.word}: one word in the name block: ${beside}`)
      assert.ok(pills[0].classList.contains(`is-${WORD_FACTS[one.word].key}`), `${one.word}: the class of its word`)
    }
  } finally { await page.close() }
})

test('the pill, the Workers list and the head count agree for every word', async () => {
  const chats = everyWord()
  const page = await openPage({ state: stateOf(chats), now: NOW })
  try {
    const rows = page.all('#simple-workers .simple-worker')
    for (const one of chats) {
      const pill = laneNamed(page, one.name).querySelector('.pill').textContent
      const row = rows.find(found => found.querySelector('.simple-name')?.textContent === one.name)
      assert.ok(row, `${one.word}: a row in the Workers list`)
      assert.ok(row.textContent.includes(pill), `${one.word}: row "${row.textContent}" says the pill's word "${pill}"`)
      assert.ok(row.classList.contains(`is-${WORD_FACTS[one.word].key}`), `${one.word}: the row takes the class of its word`)
    }
    // The head: one count per word that has a chat, named as the word; working and free always.
    const head = page.all('#counts .count-pill').map(one => one.textContent)
    for (const word of WORD_LIST) assert.ok(head.some(text => text.toLowerCase().includes(word.toLowerCase())), `${word} is counted in the head: ${head.join(' | ')}`)
    assert.ok(head.some(text => /^1\s*working/.test(text) || /1working/.test(text)), 'the Working count is one number')
  } finally { await page.close() }
})

test('the lane window\'s chip is the word, for the words that open one', async () => {
  const windowed = [WORDS.WORKING, WORDS.PAUSED, WORDS.STOPPED]
  const chats = windowed.map(word => lane(word, { task: { text: 'Hedge', step: 1, steps: 2, stepId: 'B12', startedAt: NOW - 5 * MIN }, taskStepId: 'B12' }))
  for (const one of chats) {
    const page = await openPage({ state: stateOf([one]), now: NOW })
    try {
      await page.click(`[data-lane="${one.name}"] .lane-row .what`)
      const chip = page.all('.details-head .chip.is-kind').map(found => found.textContent)
      assert.deepEqual(chip, [one.word], `${one.word}: the window's chip`)
    } finally { await page.close() }
  }
})

test('the age shows at 11 s and not at 9 s; Unknown always says no report for N; Asleep says since when', async () => {
  const chats = [lane(WORDS.WORKING, { name: 'At nine', age: 9 * SEC }), lane(WORDS.WORKING, { name: 'At eleven', age: 11 * SEC }), lane(WORDS.UNKNOWN, { name: 'Unknown', age: 45 * SEC }),
    lane(WORDS.UNKNOWN, { name: 'Quiet one', age: 3 * MIN }), lane(WORDS.ASLEEP, { name: 'Sleeper', since: NOW - 7 * MIN })]
  const page = await openPage({ state: stateOf(chats), now: NOW })
  try {
    const text = name => laneNamed(page, name).querySelector('.pill').textContent
    assert.equal(text('At nine'), 'Working')
    assert.equal(text('At eleven'), 'Working · 11 s ago')
    assert.equal(text('Unknown'), 'Unknown · no report for 45 s')
    assert.equal(text('Quiet one'), 'Unknown · no report for 3 min')
    assert.match(text('Sleeper'), /^Asleep · since \d\d:\d\d$/)
    // Unknown is quiet under two minutes, attention after; Working is quiet.
    assert.ok(!laneNamed(page, 'Unknown').querySelector('.pill').classList.contains('is-late'))
    assert.ok(laneNamed(page, 'Quiet one').querySelector('.pill').classList.contains('is-late'))
  } finally { await page.close() }
})

test('the age is the board\'s: the page\'s own clock moving on changes nothing (mutant: the age from the page clock)', async () => {
  const page = await openPage({ state: stateOf([lane(WORDS.WORKING, { name: 'Steady', age: 25 * SEC })]), now: NOW })
  try {
    assert.equal(laneNamed(page, 'Steady').querySelector('.pill').textContent, 'Working · 25 s ago')
    page.advance(2 * MIN)
    assert.equal(laneNamed(page, 'Steady').querySelector('.pill').textContent, 'Working · 25 s ago')
  } finally { await page.close() }
})

test('no old name is drawn from the state: not "Cut off", "Idle, task open", "Suspended", "Interrupted", "Available" or "Waiting for your partner"', async () => {
  const chats = everyWord(word => (word === WORDS.WORKING ? { waitsForPartner: ['Q1'], why: 'waits for the partner' } : word === WORDS.STOPPED ? { why: 'task open since 11:55', report: { state: 'idle', since: NOW - 5 * MIN, at: NOW - SEC } } : {}))
  const page = await openPage({ state: stateOf(chats), now: NOW })
  try {
    const drawn = `${page.text('#lanes')}\n${page.text('#simple-workers')}\n${page.text('#counts')}`
    for (const old of ['Cut off', 'Idle, task open', 'Suspended', 'Interrupted', 'Available', 'Waiting for your partner', 'Closed']) assert.ok(!drawn.includes(old), `"${old}" is not drawn`)
  } finally { await page.close() }
})

test('a lane that came without a word (an older board) reads its old state as a word of the list', async () => {
  const chats = ['working', 'waiting', 'free', 'unknown', 'interrupted', 'suspended', 'off'].map(state => {
    const { word, why, since, reportAt, age, ...rest } = lane(WORDS.FREE, { name: `Old ${state}`, state, isRunning: state !== 'off', suspended: state === 'suspended' ? { by: 'app', limit: 'fiveHour', since: NOW, until: NOW + MIN, isBack: false } : null })
    return rest
  })
  const page = await openPage({ state: { ...stateOf(chats), counts: { working: 1, free: 1 } }, now: NOW })
  try {
    const drawn = chats.map(one => laneNamed(page, one.name).querySelector('.pill').textContent)
    assert.deepEqual(drawn, ['Working', 'Waiting for you', 'Free', 'Unknown', 'Stopped', 'Paused', 'Not running'])
  } finally { await page.close() }
})

test('the page\'s word map is the board\'s: the same words, keys and tones', async () => {
  const page = await openPage({ state: stateOf([]), now: NOW })
  try {
    const view = page.constants.WORD_VIEW
    assert.deepEqual(Object.keys(view), WORD_LIST)
    for (const word of WORD_LIST) assert.deepEqual({ ...view[word] }, { key: WORD_FACTS[word].key, tone: WORD_FACTS[word].tone }, word)
  } finally { await page.close() }
})

test('the day bars keep the history\'s state and name it through the old-state map', async () => {
  const page = await openPage({ state: stateOf([]), now: NOW })
  try {
    assert.deepEqual({ ...page.constants.STATES }, { working: WORDS.WORKING, waiting: WORDS.WAITING, free: WORDS.FREE, unknown: WORDS.UNKNOWN, interrupted: WORDS.STOPPED, suspended: WORDS.PAUSED, off: WORDS.NOT_RUNNING })
  } finally { await page.close() }
})
