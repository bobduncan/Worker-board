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

// B: everything half-done survives a reload a cold start still needs (B524's keep, extended)

/** A link of the page as the board draws them (a game file's, a picture's), added to the page; its selector for a click. */
function linkTo(page, data) {
  const link = page.document.createElement('a')
  link.id = 'test-link'
  for (const [name, value] of Object.entries(data)) link.dataset[name] = value
  page.document.body.append(link)
  return '#test-link'
}

const REFUSED = { ok: false, status: 403, json: async () => ({}), text: async () => 'Only the board\'s own page may read.' }
const SEEN = { 'help-seen': 'yes' }
const isPost = request => request.method === 'POST'

/**
 * The person does `act` on a page; the board comes back with a new token (403) and the page reloads (B519): the page that
 * loads then has what the reload kept in sessionStorage. Returns that new page.
 */
async function acrossAReload({ state = stateOf(BOARD_NOW - 1_000), answers, act }) {
  let refused = false
  const before = await openPage({ now: BOARD_NOW, state: () => (refused ? REFUSED : state), answers, storage: SEEN })
  let kept = null
  try {
    await act(before)
    refused = true
    await before.advance(30_000)
    assert.equal(before.reloads(), 1, 'the 403 reloads the page')
    kept = before.window.sessionStorage.getItem('kept-state')
  } finally { await before.close() }
  const after = await openPage({ now: BOARD_NOW + 31_000, state, answers, storage: SEEN, session: { 'kept-state': kept } })
  await after.advance(0)
  return after
}

test('the help tour comes back open on the card it was on', async () => {
  let heading = ''
  const page = await acrossAReload({ act: async before => {
    await before.click('#help-button')
    await before.click('#help-next')
    await before.click('#help-next')
    heading = before.text('#help-heading')
  } })
  try {
    assert.equal(page.find('#help').open, true)
    assert.equal(page.text('#help-heading'), heading)
    assert.equal(page.requests.some(isPost), false, 'nothing is sent by itself')
  } finally { await page.close() }
})

test('New project comes back open with its words, and a folder the person typed stays theirs', async () => {
  const page = await acrossAReload({ act: async before => {
    await before.click('#new-project-button')
    await before.type('#new-project-name', 'Orchard')
    await before.type('#new-project-folder', 'D:/trees/orchard')
    await before.type('#new-project-prefix', 'Orchard · ')
  } })
  try {
    assert.equal(page.find('#new-project').open, true)
    assert.deepEqual(['name', 'folder', 'prefix'].map(part => page.find(`#new-project-${part}`).value), ['Orchard', 'D:/trees/orchard', 'Orchard · '])
    await page.type('#new-project-name', 'Orchard two')
    assert.equal(page.find('#new-project-folder').value, 'D:/trees/orchard', 'the typed folder is not replaced by a suggestion')
    assert.equal(page.requests.some(isPost), false)
  } finally { await page.close() }
})

const GOALS = ['# Goals', 'Last id: G6', 'Focus: G6', '', '- [~] G6 Paths through the garden', '  Goal definition: calm', ''].join('\n')

test('Change this goal comes back open on its goal, with the words typed into it', async () => {
  const state = asSent({ ...build([], undefined, GOALS), goalsEdit: { canWrite: true }, version: version(BOARD_NOW - 1_000) })
  const page = await acrossAReload({ state, act: async before => {
    await before.click('[data-tab="advice"]')
    await before.click('.focus-title [data-focus-act="change-goal"]')
    await before.type('#change-goal-words', 'Every bench on a path, not just the big ones')
  } })
  try {
    assert.equal(page.find('#change-goal').open, true)
    assert.equal(page.text('#change-goal-title'), 'Change G6 · Paths through the garden')
    assert.equal(page.find('#change-goal-words').value, 'Every bench on a path, not just the big ones')
    assert.equal(page.requests.some(isPost), false)
  } finally { await page.close() }
})

test('a file of the game comes back open, scrolled where the person had it', async () => {
  const file = { ok: true, status: 200, headers: new Map([['Content-Type', 'text/plain; charset=utf-8'], ['X-Board-File', 'notes/plan.txt']]), text: async () => 'a line of the plan\n'.repeat(300) }
  const answers = request => (request.url.startsWith('/api/game-file') ? file : { ok: true, status: 200, json: async () => ({}), text: async () => '{}' })
  const page = await acrossAReload({ answers, act: async before => {
    await before.click(linkTo(before, { gameFile: 'notes/plan.txt' }))
    await before.advance(0)
    assert.equal(before.find('#file-view').open, true)
    before.find('#file-view .file-view-body').scrollTop = 480
  } })
  try {
    assert.equal(page.find('#file-view').open, true)
    assert.equal(page.text('#file-view h2'), 'notes/plan.txt')
    assert.equal(page.find('#file-view .file-view-body').scrollTop, 480)
    assert.equal(page.requests.filter(one => one.url.startsWith('/api/game-file')).length, 1, 'read once again, nothing sent')
    assert.equal(page.requests.some(isPost), false)
  } finally { await page.close() }
})

test('a picture comes back open in the picture popup', async () => {
  const shown = { ok: true, status: 200, blob: async () => new Blob(['png']), json: async () => ({}), text: async () => '' }
  const answers = request => (request.url.startsWith('/api/picture') ? shown : { ok: true, status: 200, json: async () => ({}), text: async () => '{}' })
  const page = await acrossAReload({ answers, act: async before => {
    await before.click(linkTo(before, { zoom: 'art-inbox/garden/bench.png', caption: 'The bench' }))
    await before.advance(0)
    assert.equal(before.find('#lightbox').open, true)
  } })
  try {
    assert.equal(page.find('#lightbox').open, true)
    assert.equal(page.text('#lightbox-caption'), 'The bench')
  } finally { await page.close() }
})

// C: the poll tells the board when the person is busy on the page, and nothing else

const polls = page => page.requests.filter(one => one.url === '/api/state')
/** Moves the page's clock on in steps, so each poll's answer settles and the next poll is set (as the banner's tests do). */
async function advanceBy(page, total, step = 5_000) {
  for (let left = total; left > 0; left -= step) await page.advance(Math.min(step, left))
}
const activeOf = request => request.headers['X-Board-Active'] ?? null

test('the poll says the person is busy for a minute after a key or click, and while a field has the focus; no words go with it', async () => {
  const page = await openPage({ now: BOARD_NOW, state: () => stateOf(BOARD_NOW - 1_000), storage: SEEN })
  const { MIN } = page.constants
  try {
    assert.equal(activeOf(polls(page).at(-1)), null, 'nothing done yet: no header')
    await page.type('#main-text', 'a secret plan for the pond')
    page.find('#main-text').blur()
    await page.advance(30_000)
    const first = activeOf(polls(page).at(-1))
    assert.match(first, /^[A-Za-z0-9-]{1,40} \d+$/)
    assert.doesNotMatch(first, /secret|pond/)
    const [id, forMs] = first.split(' ')
    assert.equal(Number(forMs), 30_000, 'for how long: since the key, by the page\'s own measure')
    await advanceBy(page, 30_000)
    assert.equal(activeOf(polls(page).at(-1)), null, 'a minute after the last key, no field with the focus: not busy')
    await page.click('#refresh-title')
    await advanceBy(page, 30_000)
    assert.equal(activeOf(polls(page).at(-1)), `${id} 30000`, 'a click: busy again, the same page id')
    page.find('#main-text').focus()
    await advanceBy(page, 10 * MIN)
    assert.match(activeOf(polls(page).at(-1)) ?? '', new RegExp(`^${id} \\d+$`), 'a field with the focus: busy, however long')
  } finally { await page.close() }
})

test('a tab that is not shown never says the person is busy', async () => {
  const page = await openPage({ now: BOARD_NOW, state: () => stateOf(BOARD_NOW - 1_000), storage: SEEN })
  try {
    Object.defineProperty(page.document, 'visibilityState', { value: 'hidden', configurable: true })
    page.find('#main-text').focus()
    await page.type('#main-text', 'typed, then the tab was hidden')
    await page.advance(30_000)
    assert.equal(activeOf(polls(page).at(-1)), null)
  } finally { await page.close() }
})

test('a page left with a popup open and words in a field, but no key, click or focus for a minute, does not hold the board', async () => {
  const page = await openPage({ now: BOARD_NOW, state: () => stateOf(BOARD_NOW - 1_000), storage: SEEN })
  try {
    await page.click('#help-button')
    await page.type('#main-text', 'left here since the morning')
    page.document.activeElement?.blur?.()
    await advanceBy(page, 2 * 60_000)
    assert.equal(page.find('#help').open, true)
    assert.equal(activeOf(polls(page).at(-1)), null)
  } finally { await page.close() }
})
