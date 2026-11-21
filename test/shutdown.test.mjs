// Shut down (2026-11-21, src/shutdown.mjs): the person's stop holds the board down against every start that is not the person's
// own (the chats' Workers mod ran start-board.mjs every minute and brought a stopped board back), and the page's Shut down pauses
// every chat first, then ends the board. The pure pieces with made-up facts; one run of start-board.mjs against a held sign (it
// starts nothing: the refusal comes before any probe); the page's button and lines through the page harness.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { watchDecision } from '../src/boardWatcher.mjs'
import { startEnv } from '../src/keeper.mjs'
import { PERSON_STARTS, SHUTDOWN_WAIT_MS, isHeldSign, isShutdownDue, shutdownSign, shutdownView, startAllowed } from '../src/shutdown.mjs'
import { openPage } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const MIN = 60_000
const AT = new Date(2026, 10, 21, 9, 30).getTime()

test('a held sign is the person\'s stop only: by command and stopped; a crash, a restart or the board\'s own exit holds nothing', () => {
  assert.equal(isHeldSign({ at: AT, why: 'stopped', by: 'command' }), true)
  assert.equal(isHeldSign(shutdownSign({ at: AT, started: AT - MIN })), true)
  assert.equal(isHeldSign({ at: AT, why: 'stopped' }), false, 'a Windows restart ends node with 0 and leaves such a sign: no hold')
  assert.equal(isHeldSign({ at: AT, why: 'crash', by: 'command' }), false)
  assert.equal(isHeldSign({ at: AT, why: 'restart' }), false)
  assert.equal(isHeldSign({ why: 'stopped', by: 'command' }), false, 'no time, no sign')
  assert.equal(isHeldSign(null), false)
})

test('startAllowed: a held sign refuses the automatic starts with one line; --resume, --open and --anew are the person\'s and start', () => {
  const sign = shutdownSign({ at: AT })
  assert.deepEqual(startAllowed({ stop: null, args: [] }), { ok: true })
  assert.deepEqual(startAllowed({ stop: { at: AT, why: 'crash' }, args: ['--quiet'] }), { ok: true })
  const refused = startAllowed({ stop: sign, args: ['--quiet'] })
  assert.equal(refused.ok, false)
  assert.equal(refused.line, 'The worker board was shut down on purpose at 09:30: it stays down. Start it again with the board\'s icon, or npm run resume (node start-board.mjs --resume).')
  assert.match(startAllowed({ stop: { at: AT, why: 'stopped', by: 'command' }, args: [] }).line, /^The worker board was stopped on purpose at 09:30/)
  assert.deepEqual(PERSON_STARTS, ['--resume', '--open', '--anew'])
  for (const flag of PERSON_STARTS) assert.deepEqual(startAllowed({ stop: sign, args: ['--quiet', flag] }), { ok: true }, flag)
})

test('the shutdown sign holds the watcher too, across a boot', () => {
  const decided = watchDecision({ answers: false, stop: shutdownSign({ at: AT, started: AT - 60 * MIN }), startedAt: AT - 60 * MIN, bootAt: AT + 60 * MIN, now: AT + 2 * 60 * MIN })
  assert.equal(decided.do, 'nothing')
  assert.match(decided.why, /stopped on purpose at 09:30 \(by command/)
})

test('isShutdownDue: at once for "now", when the pause is safe, else at SHUTDOWN_WAIT_MS; nothing without a shutdown', () => {
  const shutdown = { at: AT, isNow: false }
  assert.equal(isShutdownDue({ shutdown: null, pause: { state: 'pausing', isSafe: true }, now: AT }), false)
  assert.equal(isShutdownDue({ shutdown, pause: { state: 'pausing', isSafe: false }, now: AT + MIN }), false)
  assert.equal(isShutdownDue({ shutdown, pause: { state: 'pausing', isSafe: true }, now: AT + 1 }), true)
  assert.equal(isShutdownDue({ shutdown, pause: { state: 'resuming', isSafe: true }, now: AT + 1 }), false, 'only a pause is safe')
  assert.equal(isShutdownDue({ shutdown, pause: null, now: AT + SHUTDOWN_WAIT_MS - 1 }), false)
  assert.equal(isShutdownDue({ shutdown, pause: null, now: AT + SHUTDOWN_WAIT_MS }), true)
  assert.equal(isShutdownDue({ shutdown: { at: AT, isNow: true }, pause: null, now: AT }), true)
  assert.deepEqual(shutdownView(shutdown), { at: AT, until: AT + SHUTDOWN_WAIT_MS, isNow: false })
  assert.equal(shutdownView(null), null)
})

// The real folder's data/stop.json, kept and put back: the run refuses before it probes or starts anything.
const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')
const SIGN = join(HERE, 'data', 'stop.json')
const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

test('start-board.mjs: a held sign refuses a plain and a quiet start (the chats\' mod, the hook) and starts nothing', async t => {
  const before = existsSync(SIGN) ? readFileSync(SIGN) : null
  t.after(() => (before === null ? rmSync(SIGN, { force: true }) : writeFileSync(SIGN, before)))
  mkdirSync(dirname(SIGN), { recursive: true })
  writeFileSync(SIGN, JSON.stringify(shutdownSign({ at: AT })))
  const port = String(await freePort())
  const run = (...args) => spawnSync(process.execPath, [join(HERE, 'start-board.mjs'), '--port', port, ...args], { encoding: 'utf8', timeout: 30_000, env: startEnv(process.env) })
  const plain = run()
  assert.equal(plain.status, 0, plain.stderr)
  assert.match(plain.stdout, /^The worker board was shut down on purpose at 09:30: it stays down\./)
  const quiet = run('--quiet')
  assert.deepEqual([quiet.status, quiet.stdout], [0, ''])
  assert.ok(existsSync(SIGN), 'a refused start leaves the sign')
})

// The page: the Shut down button, its question, the request, the line while it waits, and the banner once the board is gone.
const BASE = asSent(build([]))
const stateWith = more => ({ ...BASE, canShutdown: true, shutdown: null, ...more })

test('the page: Shut down asks first, then sends the shutdown (or "now"); No sends nothing', async () => {
  const page = await openPage({ state: stateWith({}) })
  try {
    assert.equal(page.find('#shut-down').hidden, false)
    await page.click('#shut-down')
    assert.match(page.text('#restart'), /Shut down the board\? Every chat is paused first/)
    await page.click('[data-restart="cancel"]')
    assert.deepEqual(page.sent('/api/work'), [])
    await page.click('#shut-down')
    await page.click('[data-restart="shutdown"]')
    await page.click('#shut-down')
    await page.click('[data-restart="shutdown-now"]')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'shutdown' }, { action: 'shutdown', now: true }])
  } finally { await page.close() }
})

test('the page: no Shut down where the board cannot be shut down (the demo, a board that only shows)', async () => {
  const page = await openPage({ state: stateWith({ canShutdown: false }) })
  try {
    assert.equal(page.find('#shut-down').hidden, true)
  } finally { await page.close() }
})

test('the page: while it shuts down, the line says until when, with Shut down now; the button is gone', async () => {
  const until = AT + SHUTDOWN_WAIT_MS
  const page = await openPage({ state: stateWith({ shutdown: { at: AT, until, isNow: false } }) })
  try {
    assert.equal(page.find('#shut-down').hidden, true)
    assert.match(page.text('#restart'), /Shutting down: every chat is paused, and the board stops once each has ended its turn, at 09:35 at the latest\./)
    await page.click('[data-restart="shutdown-now"]')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'shutdown', now: true }])
  } finally { await page.close() }
})

test('the banner: a board gone for a shutdown says so and how to start it, not "Restarting"', async () => {
  let isUp = true
  const leaving = { state: 'leaving', at: AT, why: 'shutdown' }
  const page = await openPage({ state: () => { if (!isUp) throw new TypeError('fetch failed'); return stateWith({ board: { now: AT, loop: { lastTickAt: AT }, restart: leaving, lastStop: null } }) }, now: AT + 1_000 })
  try {
    isUp = false
    await page.advance(31_000)
    assert.equal(page.text('#updated'), 'Shut down at 09:30 · start it again with its icon, or npm run resume')
  } finally { await page.close() }
})
