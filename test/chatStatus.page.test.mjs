// Signals change 2: the same status in every view. The page is clicked through the DOM harness (test/README-page-tests.md):
// text and classes only. One lane per status is handed to it; every view must draw that status and no other state status.
// Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { STATUSES, STATUS_FACTS, STATUS_LIST, countsOf } from '../src/chatStatus.mjs'
import { openPage } from './pageHarness.mjs'
import { MIN, NOW, asSent, build } from './partnerState.mjs'

const SEC = 1000
/** The states the board's decisions keep for each status (they stay: the status is display only). */
const STATE_OF = {
  [STATUSES.WORKING]: 'working', [STATUSES.WAITING]: 'waiting', [STATUSES.CHECKING]: 'free', [STATUSES.HANDING]: 'free', [STATUSES.OFFERED]: 'free', [STATUSES.HELD]: 'free',
  [STATUSES.NO_ANSWER]: 'unknown', [STATUSES.PAUSED]: 'suspended', [STATUSES.RESTARTING]: 'unknown', [STATUSES.STOPPED]: 'interrupted', [STATUSES.FREE]: 'free',
  [STATUSES.ASLEEP]: 'free', [STATUSES.NOT_RUNNING]: 'off', [STATUSES.UNKNOWN]: 'unknown',
}
const baseState = asSent(build([], undefined, undefined))
const template = baseState.chats.find(chat => chat.name === 'Digger')

/** A lane of the made-up garden carrying `status`, with the old fields a board would keep for it. */
function lane(status, more = {}) {
  const name = `Lane ${STATUS_LIST.indexOf(status)}`
  return {
    ...structuredClone(template), name, state: STATE_OF[status], isRunning: status !== STATUSES.NOT_RUNNING, asleep: status === STATUSES.ASLEEP, asleepSince: status === STATUSES.ASLEEP ? NOW - 7 * MIN : null,
    suspended: status === STATUSES.PAUSED ? { by: 'app', limit: 'fiveHour', since: NOW - MIN, until: NOW + 30 * MIN, isBack: false } : null, offWhy: status === STATUSES.NOT_RUNNING ? 'silent since 11:50' : null,
    status, why: null, since: null, reportAt: NOW - 2 * SEC, age: 2 * SEC, task: null, eta: null, queue: [], flags: [], ...more,
  }
}

const everyStatus = (more = () => ({})) => STATUS_LIST.map(status => lane(status, more(status)))
const stateOf = chats => ({ ...baseState, chats, counts: countsOf(chats) })
const laneNamed = (page, name) => page.all('#lanes [data-lane]').find(one => one.dataset.lane === name)

test('every lane draws exactly one status, from the status list, as its pill', async () => {
  const chats = everyStatus()
  const page = await openPage({ state: stateOf(chats), now: NOW })
  try {
    for (const one of chats) {
      const drawn = laneNamed(page, one.name)
      const pills = [...drawn.querySelectorAll('.pill')]
      assert.equal(pills.length, 1, `${one.status}: one pill`)
      assert.ok(STATUS_LIST.some(status => pills[0].textContent.startsWith(status)), `${one.status}: "${pills[0].textContent}" starts with a status of the list`)
      assert.equal(pills[0].dataset.status, one.status)
      // Exactly one status beside the name: no small tag ("asleep", "not running") says a second one.
      const beside = drawn.querySelector('.who').textContent.toLowerCase()
      assert.deepEqual(STATUS_LIST.filter(status => beside.includes(status.toLowerCase())), [one.status], `${one.status}: one status in the name block: ${beside}`)
      assert.ok(pills[0].classList.contains(`is-${STATUS_FACTS[one.status].key}`), `${one.status}: the class of its status`)
    }
  } finally { await page.close() }
})

test('the pill, the Workers list and the head count agree for every status', async () => {
  const chats = everyStatus()
  const page = await openPage({ state: stateOf(chats), now: NOW })
  try {
    const rows = page.all('#simple-workers .simple-worker')
    for (const one of chats) {
      const pill = laneNamed(page, one.name).querySelector('.pill').textContent
      const row = rows.find(found => found.querySelector('.simple-name')?.textContent === one.name)
      assert.ok(row, `${one.status}: a row in the Workers list`)
      assert.ok(row.textContent.includes(pill), `${one.status}: row "${row.textContent}" says the pill's status "${pill}"`)
      assert.ok(row.classList.contains(`is-${STATUS_FACTS[one.status].key}`), `${one.status}: the row takes the class of its status`)
    }
    // The head: one count per status that has a chat, named as the status; working and free always.
    const head = page.all('#counts .count-pill').map(one => one.textContent)
    for (const status of STATUS_LIST) assert.ok(head.some(text => text.toLowerCase().includes(status.toLowerCase())), `${status} is counted in the head: ${head.join(' | ')}`)
    assert.ok(head.some(text => /^1\s*working/.test(text) || /1working/.test(text)), 'the Working count is one number')
  } finally { await page.close() }
})

test('the lane window\'s chip is the status, for the statuses that open one', async () => {
  const windowed = [STATUSES.WORKING, STATUSES.PAUSED, STATUSES.STOPPED]
  const chats = windowed.map(status => lane(status, { task: { text: 'Hedge', step: 1, steps: 2, stepId: 'B12', startedAt: NOW - 5 * MIN }, taskStepId: 'B12' }))
  for (const one of chats) {
    const page = await openPage({ state: stateOf([one]), now: NOW })
    try {
      await page.click(`[data-lane="${one.name}"] .lane-row .what`)
      const chip = page.all('.details-head .chip.is-kind').map(found => found.textContent)
      assert.deepEqual(chip, [one.status], `${one.status}: the window's chip`)
    } finally { await page.close() }
  }
})

test('the age shows at 11 s and not at 9 s; Unknown always says no report for N; Asleep says since when', async () => {
  const chats = [lane(STATUSES.WORKING, { name: 'At nine', age: 9 * SEC }), lane(STATUSES.WORKING, { name: 'At eleven', age: 11 * SEC }), lane(STATUSES.UNKNOWN, { name: 'Unknown', age: 45 * SEC }),
    lane(STATUSES.UNKNOWN, { name: 'Quiet one', age: 3 * MIN }), lane(STATUSES.ASLEEP, { name: 'Sleeper', since: NOW - 7 * MIN })]
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
  const page = await openPage({ state: stateOf([lane(STATUSES.WORKING, { name: 'Steady', age: 25 * SEC })]), now: NOW })
  try {
    assert.equal(laneNamed(page, 'Steady').querySelector('.pill').textContent, 'Working · 25 s ago')
    page.advance(2 * MIN)
    assert.equal(laneNamed(page, 'Steady').querySelector('.pill').textContent, 'Working · 25 s ago')
  } finally { await page.close() }
})

test('no old name is drawn from the state: not "Cut off", "Idle, task open", "Suspended", "Interrupted", "Available" or "Waiting for your partner"', async () => {
  const chats = everyStatus(status => (status === STATUSES.WORKING ? { waitsForPartner: ['Q1'], why: 'waits for the partner' } : status === STATUSES.STOPPED ? { why: 'task open since 11:55', report: { state: 'idle', since: NOW - 5 * MIN, at: NOW - SEC } } : {}))
  const page = await openPage({ state: stateOf(chats), now: NOW })
  try {
    const drawn = `${page.text('#lanes')}\n${page.text('#simple-workers')}\n${page.text('#counts')}`
    for (const old of ['Cut off', 'Idle, task open', 'Suspended', 'Interrupted', 'Available', 'Waiting for your partner', 'Closed']) assert.ok(!drawn.includes(old), `"${old}" is not drawn`)
  } finally { await page.close() }
})

test('a lane that came without a status (an older board) reads its old state as a status of the list', async () => {
  const chats = ['working', 'waiting', 'free', 'unknown', 'interrupted', 'suspended', 'off'].map(state => {
    const { status, why, since, reportAt, age, ...rest } = lane(STATUSES.FREE, { name: `Old ${state}`, state, isRunning: state !== 'off', suspended: state === 'suspended' ? { by: 'app', limit: 'fiveHour', since: NOW, until: NOW + MIN, isBack: false } : null })
    return rest
  })
  const page = await openPage({ state: { ...stateOf(chats), counts: { working: 1, free: 1 } }, now: NOW })
  try {
    const drawn = chats.map(one => laneNamed(page, one.name).querySelector('.pill').textContent)
    assert.deepEqual(drawn, ['Working', 'Waiting for you', 'Free', 'Unknown', 'Stopped', 'Paused', 'Not running'])
  } finally { await page.close() }
})

test('the page\'s status map is the board\'s: the same statuses, keys and tones', async () => {
  const page = await openPage({ state: stateOf([]), now: NOW })
  try {
    const view = page.constants.STATUS_VIEW
    assert.deepEqual(Object.keys(view), STATUS_LIST)
    for (const status of STATUS_LIST) assert.deepEqual({ ...view[status] }, { key: STATUS_FACTS[status].key, tone: STATUS_FACTS[status].tone }, status)
  } finally { await page.close() }
})

test('the day bars keep the history\'s state and name it through the old-state map', async () => {
  const page = await openPage({ state: stateOf([]), now: NOW })
  try {
    assert.deepEqual({ ...page.constants.STATES }, { working: STATUSES.WORKING, waiting: STATUSES.WAITING, free: STATUSES.FREE, unknown: STATUSES.UNKNOWN, interrupted: STATUSES.STOPPED, suspended: STATUSES.PAUSED, off: STATUSES.NOT_RUNNING })
  } finally { await page.close() }
})

// B1051 (X153), C2: an Asleep lane shows its why (the ban why) as a small line; one without a why shows no empty tag.
// Mutant: the Asleep exclusion put back in timeOf, simpleIdle or the names block.
test('an Asleep lane shows its ban why in the lane, its row and its time column; one without a why shows no tag', async () => {
  const ban = 'free; gets no sonnet steps: its set failed at 11:30, until 12:30 (Session x not found.)'
  const chats = [lane(STATUSES.ASLEEP, { name: 'Banned sleeper', why: ban }), lane(STATUSES.ASLEEP, { name: 'Plain sleeper' })]
  const page = await openPage({ state: stateOf(chats), now: NOW })
  try {
    const banned = laneNamed(page, 'Banned sleeper')
    const whys = [...banned.querySelectorAll('small.status-why')].map(one => one.textContent)
    assert.deepEqual(whys, [ban], 'the names block draws the why once, as a small line')
    assert.equal(banned.querySelectorAll('.pill').length, 1, 'still one pill')
    assert.ok(banned.querySelector('.pill').title.includes('asleep since'), 'the pill tooltip keeps the asleep words')
    assert.ok(banned.textContent.includes('gets no sonnet steps'), 'the lane holds the ban words')
    const rows = page.all('#simple-workers .simple-worker')
    const row = name => rows.find(found => found.querySelector('.simple-name')?.textContent === name)
    assert.ok(row('Banned sleeper').textContent.includes('gets no sonnet steps'), 'the Workers row holds the ban words')
    assert.ok(row('Banned sleeper').textContent.includes('Asleep'), 'and still says Asleep')
    const plain = laneNamed(page, 'Plain sleeper')
    assert.equal(plain.querySelectorAll('.status-why').length, 0, 'no empty tag without a why')
    assert.ok(!row('Plain sleeper').textContent.includes('·  ') && !/Asleep · since \d\d:\d\d ·/.test(row('Plain sleeper').textContent), 'no empty why in its row')
  } finally { await page.close() }
})
