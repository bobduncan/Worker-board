// B730: the page harness itself (test/pageHarness.mjs): the fake clock moves the page's dates and timers only when a
// test says so, and `type` is what the person's typing is to the page. Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { openPage, reply, TOKEN } from './pageHarness.mjs'
import { asSent, build, ask, MIN, NOW } from './partnerState.mjs'

const state = () => asSent(build([ask('Q2', 'person', NOW - 40 * MIN)]))
const ANSWER = 'textarea[aria-label="Answer to Digger"]'
const never = () => new Promise(() => {})

test('type: the person\'s words reach the page\'s field and go with the Send', async () => {
  const page = await openPage({ state: state() })
  try {
    await page.type(ANSWER, 'Bar, please')
    await page.click('[data-send]')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'answer', id: 'Q2', text: 'Bar, please', verdict: null }])
    assert.equal(page.sent('/api/work')[0].headers['X-Board-Token'], TOKEN)
  } finally { await page.close() }
})

test('the fake clock: the page reads the board again when the clock reaches its refresh time, not before', async () => {
  const page = await openPage({ state: state(), now: NOW })
  try {
    const reads = () => page.requests.filter(one => one.url === '/api/state').length
    assert.equal(reads(), 1)
    await page.advance(29_000)
    assert.equal(reads(), 1)
    await page.advance(1_000)
    assert.equal(reads(), 2)
  } finally { await page.close() }
  await assert.rejects(async () => {
    const real = await openPage({ state: state() })
    try { await real.advance(1) } finally { await real.close() }
  }, /no fake clock/)
})

test('the fake clock: a board that is away is told in words with the time it has been away', async () => {
  let up = true
  const page = await openPage({ state: () => { if (!up) throw new TypeError('fetch failed'); return state() }, now: NOW })
  try {
    up = false
    await page.advance(30_000)
    assert.match(page.text('#updated'), /^The board has not answered since \d\d:\d\d \(under a minute\)\. Asking again every few seconds; showing what was read at \d\d:\d\d\.$/)
  } finally { await page.close() }
})

test('the fake clock: a board that does not answer ends the wait only when the clock reaches the page\'s limit', async () => {
  const page = await openPage({ state: state(), now: NOW, answers: never })
  try {
    await page.type(ANSWER, 'Bar, please')
    await page.click('[data-send]')
    await page.advance(14_000)
    assert.equal(page.all('#needs .problem').length, 0, 'inside the limit it still waits')
    await page.advance(1_000)
    assert.match(page.text('#needs .problem'), /^Not sent: the board did not answer within 15 s/)
    assert.equal(page.sent('/api/work').length, 1)
  } finally { await page.close() }
})

test('reply: a refusal is shown by the page with the board\'s own words', async () => {
  const page = await openPage({ state: state(), now: NOW, answers: () => reply('The store is locked', 409) })
  try {
    await page.type(ANSWER, 'Bar, please')
    await page.click('[data-send]')
    assert.equal(page.text('#needs .problem'), 'Not sent: The store is locked')
  } finally { await page.close() }
})
