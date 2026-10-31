// Signals change 1 (2026-10-31): the line on top of the page always says Running, Slow, Off since or Restarting, with the
// time from the board's own clock. The page is opened with a fake fetch and a fake clock (test/README-page-tests.md); the
// tests read the drawn words and classes, never the page's source. Made-up times only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { openPage, reply } from './pageHarness.mjs'
import { asSent, build, NOW } from './partnerState.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const BASE = asSent(build([]))
const never = () => new Promise(() => {})
/** Moves the page's clock on in steps: the fake clock runs a step's timers before the page's promises settle, so a long
 * jump would fire the 5 s limit of an ask that had already failed. */
async function advanceBy(page, total, step = 1_000) {
  for (let left = total; left > 0; left -= step) await page.advance(Math.min(step, left))
}
const two = value => String(value).padStart(2, '0')
/** The time as the page draws it: the viewer's local hours and minutes. */
const hhmm = at => `${two(new Date(at).getHours())}:${two(new Date(at).getMinutes())}`
const hhmmss = at => `${hhmm(at)}:${two(new Date(at).getSeconds())}`

/** The state with the board's own part: its clock is `boardNow`, whatever the page's clock says. */
const stateAt = (boardNow, board = {}, more = {}) => ({
  ...BASE,
  ...more,
  board: { now: boardNow, loop: { lastTickAt: boardNow - 10_000 }, restart: { state: 'none', at: null, why: null }, lastStop: null, ...board },
})
const banner = page => page.text('#updated')
const isStale = page => page.find('#updated').classList.contains('is-stale')

const BOARD_NOW = NOW + 7_000
/** A page whose own clock is two hours away from the board's. */
const PAGE_CLOCK = BOARD_NOW + 2 * HOUR

test('Running: the line says the time of the board\'s answer, also when the page\'s clock is two hours off', async () => {
  const page = await openPage({ state: stateAt(BOARD_NOW), now: PAGE_CLOCK })
  try {
    assert.equal(banner(page), `Running · updated ${hhmmss(BOARD_NOW)}`)
    assert.notEqual(hhmmss(BOARD_NOW), hhmmss(PAGE_CLOCK), 'the two clocks differ, so the line can only come from the board')
    assert.equal(isStale(page), false)
    assert.doesNotMatch(banner(page), /Last updated|has not answered/)
  } finally { await page.close() }
})

test('Slow: an ask that does not settle in 5 s turns the line to Slow with the last data\'s time; an answer brings Running back', async () => {
  let isUp = true
  const page = await openPage({ state: () => (isUp ? stateAt(BOARD_NOW) : never()), now: PAGE_CLOCK })
  const { BANNER_WAIT_MS } = page.constants
  try {
    isUp = false
    await page.advance(30_000)
    await page.advance(BANNER_WAIT_MS - 1_000)
    assert.match(banner(page), /^Running/, 'inside the limit the page still waits')
    await page.advance(1_000)
    assert.equal(banner(page), `Slow · the board has not answered for ${30 + BANNER_WAIT_MS / 1000} s · showing ${hhmm(BOARD_NOW)}'s data`)
    assert.equal(isStale(page), true)
    isUp = true
    await page.advance(page.constants.AWAY_MS)
    assert.equal(banner(page), `Running · updated ${hhmmss(BOARD_NOW)}`)
    assert.equal(isStale(page), false)
  } finally { await page.close() }
})

test('Off: an ask that fails at once says Off since the last answer\'s board time; the page asks again every few seconds', async () => {
  let isUp = true
  const page = await openPage({ state: () => { if (!isUp) throw new TypeError('fetch failed'); return stateAt(BOARD_NOW) }, now: PAGE_CLOCK })
  const { AWAY_MS } = page.constants
  const reads = () => page.requests.filter(one => one.url === '/api/state').length
  try {
    isUp = false
    await page.advance(30_000)
    assert.equal(banner(page), `Off since ${hhmm(BOARD_NOW)}`)
    assert.equal(isStale(page), true)
    const before = reads()
    await page.advance(AWAY_MS - 1)
    assert.equal(reads(), before, 'not before its time')
    await page.advance(1)
    assert.equal(reads(), before + 1)
    await advanceBy(page, 10 * MIN, 5_000)
    assert.equal(banner(page), `Off since ${hhmm(BOARD_NOW)}`, 'the time stays the board\'s last answer, not the page\'s clock')
  } finally { await page.close() }
})

test('Off: a refusal that is not the 403 reload (a 500) is an off board too', async () => {
  let isUp = true
  const page = await openPage({ state: () => (isUp ? stateAt(BOARD_NOW) : reply('broken', 500)), now: PAGE_CLOCK })
  try {
    isUp = false
    await page.advance(30_000)
    assert.equal(banner(page), `Off since ${hhmm(BOARD_NOW)}`)
  } finally { await page.close() }
})

test('Restarting: the last answer said the board is leaving, then the asks fail: Restarting for a minute, then Off since the time it left', async () => {
  const leftAt = BOARD_NOW + 2_000
  let isUp = true
  const page = await openPage({ state: () => { if (!isUp) throw new TypeError('fetch failed'); return stateAt(BOARD_NOW, { restart: { state: 'leaving', at: leftAt, why: 'new-version' } }) }, now: PAGE_CLOCK })
  const { RESTART_GIVE_UP_MS } = page.constants
  try {
    assert.match(banner(page), /^Running/, 'a board that is about to leave still runs')
    isUp = false
    await page.advance(30_000)
    assert.equal(banner(page), 'Restarting · a new version starts, usually back within 30 s')
    assert.equal(isStale(page), false, 'a restart is plain information, not an alarm')
    await advanceBy(page, RESTART_GIVE_UP_MS - 5_000)
    assert.match(banner(page), /^Restarting/)
    await advanceBy(page, 10_000)
    assert.equal(banner(page), `Off since ${hhmm(leftAt)}`)
    assert.equal(isStale(page), true)
  } finally { await page.close() }
})

test('Restarting: the click on "Click to start it" of this page also makes failing asks a restart', async () => {
  let isUp = true
  const newer = { commit: 'abc1234', since: BOARD_NOW, isServerNewer: true, canRestart: true, page: 'test', selfUpdate: null }
  const page = await openPage({ state: () => { if (!isUp) throw new TypeError('fetch failed'); return stateAt(BOARD_NOW, {}, { version: newer }) }, now: PAGE_CLOCK })
  try {
    await page.click('#update-note')
    assert.equal(page.sent('/api/restart').length, 1)
    isUp = false
    await page.advance(30_000)
    assert.equal(banner(page), 'Restarting · a new version starts, usually back within 30 s')
  } finally { await page.close() }
})

test('Back: the first answer after a start says for a minute why the board was off, then plain Running', async () => {
  const from = BOARD_NOW - 9 * MIN
  const stop = { from, to: BOARD_NOW - 5_000, why: 'restart' }
  const page = await openPage({ state: stateAt(BOARD_NOW, { lastStop: stop }), now: PAGE_CLOCK })
  const { BACK_SHOWN_MS } = page.constants
  try {
    assert.equal(banner(page), `Running · was off ${hhmm(from)} to ${hhmm(stop.to)} (a new version started)`)
    assert.equal(isStale(page), false)
    await advanceBy(page, BACK_SHOWN_MS - 1_000)
    assert.match(banner(page), /^Running · was off/, 'still inside the minute, also after the next reads (the same return is not told again)')
    await page.advance(1_000)
    assert.equal(banner(page), `Running · updated ${hhmmss(BOARD_NOW)}`)
  } finally { await page.close() }
})

test('the long "was off" text is also the title of the line, so a text cut by the header shows whole on hover', async () => {
  const from = BOARD_NOW - 4 * MIN
  const page = await openPage({ state: stateAt(BOARD_NOW, { lastStop: { from, to: BOARD_NOW - 5_000, why: 'unknown' } }), now: PAGE_CLOCK })
  try {
    const line = page.find('#updated')
    assert.match(line.textContent, /^Running · was off .* \(the PC slept or the board was ended\)$/, 'the long text is on the line')
    assert.ok(line.textContent.length > 44, 'longer than the 44ch the header lets the line take')
    assert.equal(line.getAttribute('title'), line.textContent)
  } finally { await page.close() }
})

test('Back: each reason is said in plain words', async () => {
  const words = { restart: 'a new version started', stopped: 'stopped', crash: 'it crashed', unknown: 'the PC slept or the board was ended' }
  for (const [why, said] of Object.entries(words)) {
    const page = await openPage({ state: stateAt(BOARD_NOW, { lastStop: { from: BOARD_NOW - 20 * MIN, to: BOARD_NOW - MIN, why } }), now: PAGE_CLOCK })
    try {
      assert.match(banner(page), new RegExp(`\\(${said}\\)$`))
    } finally { await page.close() }
  }
})

test('Slow: an answer comes but the work loop has not run for over the gap: the line says so, with the loop\'s last time', async () => {
  const { GAP_MS } = (await openPage({ state: {} }).then(async page => { try { return page.constants } finally { await page.close() } }))
  const quiet = BOARD_NOW - GAP_MS - 1_000
  const page = await openPage({ state: stateAt(BOARD_NOW, { loop: { lastTickAt: quiet } }), now: PAGE_CLOCK })
  try {
    assert.equal(banner(page), `Slow · the board answers, but it has not done its work since ${hhmm(quiet)}`)
    assert.equal(isStale(page), true)
  } finally { await page.close() }
  const exact = await openPage({ state: stateAt(BOARD_NOW, { loop: { lastTickAt: BOARD_NOW - GAP_MS } }), now: PAGE_CLOCK })
  try {
    assert.match(banner(exact), /^Running/, 'exactly the gap is not over it')
  } finally { await exact.close() }
  const none = await openPage({ state: stateAt(BOARD_NOW, { loop: { lastTickAt: null } }), now: PAGE_CLOCK })
  try {
    assert.match(banner(none), /^Running/, 'a board that has no work loop (the demo) is not called slow')
  } finally { await none.close() }
})

test('a state without the board\'s part (an older board) still reads: Running with the time the state was read', async () => {
  const page = await openPage({ state: BASE, now: PAGE_CLOCK })
  try {
    assert.equal(banner(page), `Running · updated ${hhmmss(BASE.readAt)}`)
  } finally { await page.close() }
})
