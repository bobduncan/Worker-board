// Signals change 5 (2026-11-02, B913): a board restart never costs the person anything. On 2026-11-01 the board restarted
// eight times for landings, and each time the page reloaded on the new token and threw away what the person had typed in
// the recap popup. The page in a DOM with a fake fetch and a fake clock (test/README-page-tests.md): what it draws, what it
// sends and whether it reloads, never its source. Made-up samples only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { openPage } from './pageHarness.mjs'
import { asSent, build, NOW } from './partnerState.mjs'

const BASE = asSent(build([]))
const BOARD_NOW = NOW + 7_000
const version = (since, more = {}) => ({ commit: 'abc1234', since, isServerNewer: false, canRestart: true, page: 'test', selfUpdate: null, ...more })
const stateOf = (since, { board = {}, ...more } = {}) => ({
  ...BASE,
  version: version(since, more),
  board: { now: BOARD_NOW, loop: { lastTickAt: BOARD_NOW - 10_000 }, restart: { state: 'none', at: null, why: null }, lastStop: null, ...board },
})
const banner = page => page.text('#updated')

// A: through a restart of its own board the page keeps going (G1 of the code check)

test('a restart this page asked for: Restarting while the board is away, then Running on the new board\'s first answer, with no reload', async () => {
  let phase = 'old'
  const OLD = BOARD_NOW - 60 * 60_000
  const NEW = BOARD_NOW - 1_000
  const page = await openPage({
    now: BOARD_NOW,
    state: () => {
      if (phase === 'away') throw new TypeError('fetch failed')
      return phase === 'old' ? stateOf(OLD, { isServerNewer: true }) : stateOf(NEW)
    },
  })
  const { AWAY_MS } = page.constants
  try {
    await page.type('#main-text', 'half a sentence to Main')
    await page.click('#update-note')
    assert.equal(page.sent('/api/restart').length, 1)
    assert.equal(page.text('#update-note'), 'Starting the new version of the board…')
    phase = 'away'
    await page.advance(30_000)
    assert.match(banner(page), /^Restarting/)
    phase = 'new'
    await page.advance(AWAY_MS)
    assert.match(banner(page), /^Running · updated/)
    assert.equal(page.find('#update-note').hidden, true, 'the note no longer says "starting"')
    assert.equal(page.reloads(), 0, 'nothing reloads')
    assert.equal(page.find('#main-text').value, 'half a sentence to Main', 'what was typed is where it was')
    // The restart is over: a board that goes away later is Off, not "Restarting" for ever.
    phase = 'away'
    await page.advance(30_000)
    assert.match(banner(page), /^Off since/)
  } finally { await page.close() }
})

test('the same board answering again is no new board: the restart this page asked for still shows as starting', async () => {
  const page = await openPage({ now: BOARD_NOW, state: () => stateOf(BOARD_NOW - 60 * 60_000, { isServerNewer: true }) })
  try {
    await page.click('#update-note')
    await page.advance(30_000)
    assert.equal(page.text('#update-note'), 'Starting the new version of the board…')
  } finally { await page.close() }
})

test('a board started cold has a new token: the page still loads itself at once (B519), keeping what was typed first', async () => {
  let refused = false
  const page = await openPage({ now: BOARD_NOW, state: () => (refused ? { ok: false, status: 403, json: async () => ({}), text: async () => 'Only the board\'s own page may read.' } : stateOf(BOARD_NOW - 1_000)) })
  try {
    await page.type('#main-text', 'kept across the reload')
    refused = true
    await page.advance(30_000)
    assert.equal(page.reloads(), 1)
    assert.match(page.window.sessionStorage.getItem('kept-state') ?? '', /kept across the reload/)
  } finally { await page.close() }
})
