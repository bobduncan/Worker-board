// B454: the board loads its new version by itself. A new page is loaded when the page is idle; a new server is started
// anew at a safe moment (no line typed into a chat, no check, no chat log being written, no chat's call being answered,
// not just after a chat was cleared); without a safe moment within 10 minutes the note on top asks for the click as
// before (B142). The person, 2026-10-20 (Q259): nine questions in two days only asked to click that note.
// Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { AFTER_LOG_MS, REPORTED_BLOCKS_MS, SELF_UPDATE_WAIT_MS, TAKEN_BLOCKS_MS, blockersOf, reportedNotLogged, selfUpdater } from '../src/selfUpdate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = Date.UTC(2026, 9, 24, 14, 0, 0)

// The safe moment

test('a moment with nothing running is safe; each thing that runs blocks it, in its own words', () => {
  assert.deepEqual(blockersOf({ now: NOW }), [])
  assert.deepEqual(blockersOf({ now: NOW, checks: 1 }), ['a check runs'])
  assert.deepEqual(blockersOf({ now: NOW, checks: 2 }), ['checks run'])
  assert.deepEqual(blockersOf({ now: NOW, isReconciling: true }), ['the board looks over the work'])
  assert.deepEqual(blockersOf({ now: NOW, logs: 1 }), ['a chat log is written'])
  assert.deepEqual(blockersOf({ now: NOW, calls: 3 }), ['a chat\'s call is answered'])
  assert.deepEqual(blockersOf({ now: NOW, isPaused: true }), ['Pause all stands'])
})

test('a line taken by a chat and not yet typed blocks; a waiting, delivered or long-forgotten line does not', () => {
  const taken = at => ({ to: 'Worker 1', state: 'taken', takenAt: at })
  assert.deepEqual(blockersOf({ now: NOW, outbox: [taken(NOW - 5_000)] }), ['a line is typed into Worker 1'])
  assert.deepEqual(blockersOf({ now: NOW, outbox: [taken(NOW - 5_000), { to: 'Advisor', state: 'taken', takenAt: NOW - 1_000 }, taken(NOW - 2_000)] }), ['a line is typed into Worker 1 and Advisor'])
  assert.deepEqual(blockersOf({ now: NOW, outbox: [taken(NOW - TAKEN_BLOCKS_MS - 1)] }), [])
  assert.deepEqual(blockersOf({ now: NOW, outbox: [{ to: 'Worker 1', state: 'waiting' }, { to: 'Worker 1', state: 'delivered', takenAt: NOW - 1_000 }, { to: 'Worker 1', state: 'held' }] }), [])
})

test('a chat that was just cleared after its step keeps the board up until its log and fresh conversation are through', () => {
  assert.deepEqual(blockersOf({ now: NOW, lastLogAt: NOW - 1_000 }), ['a chat is cleared'])
  assert.deepEqual(blockersOf({ now: NOW, lastLogAt: NOW - AFTER_LOG_MS + 1 }), ['a chat is cleared'])
  assert.deepEqual(blockersOf({ now: NOW, lastLogAt: NOW - AFTER_LOG_MS }), [])
  assert.deepEqual(blockersOf({ now: NOW, lastLogAt: null }), [])
})

// The board's look at its new version

test('a board with nothing newer does nothing and shows nothing', () => {
  const update = selfUpdater({ now: () => NOW })
  assert.deepEqual(update.look({ isNewer: false, canRestart: true, blockers: [] }), { restart: false, shown: null })
  assert.deepEqual(update.look({ isNewer: false, canRestart: true, blockers: ['a check runs'] }), { restart: false, shown: null })
})

test('a newer server starts at the first safe moment, and waits, saying what for, until then', () => {
  let now = NOW
  const update = selfUpdater({ now: () => now })
  const first = update.look({ isNewer: true, canRestart: true, blockers: ['a check runs', 'a chat is cleared'] })
  assert.equal(first.restart, false)
  assert.deepEqual(first.shown, { state: 'waiting', since: NOW, line: 'The new version of the board starts by itself at a safe moment; waiting: a check runs and a chat is cleared.' })
  now += 30_000
  const later = update.look({ isNewer: true, canRestart: true, blockers: ['a check runs'] })
  assert.deepEqual([later.restart, later.shown.state, later.shown.since], [false, 'waiting', NOW])
  now += 30_000
  assert.equal(update.look({ isNewer: true, canRestart: true, blockers: [] }).restart, true)
})

test('without a safe moment within 10 minutes the note on top is left to the person\'s click, as before', () => {
  let now = NOW
  const update = selfUpdater({ now: () => now })
  update.look({ isNewer: true, canRestart: true, blockers: ['a chat log is written'] })
  now += SELF_UPDATE_WAIT_MS - 1
  assert.equal(update.look({ isNewer: true, canRestart: true, blockers: ['a chat log is written'] }).shown.state, 'waiting')
  now += 1
  const late = update.look({ isNewer: true, canRestart: true, blockers: ['a chat log is written'] })
  assert.deepEqual([late.restart, late.shown.state], [false, 'late'])
  // A safe moment after that still starts the new version: it is safe, and nobody has to click.
  assert.equal(update.look({ isNewer: true, canRestart: true, blockers: [] }).restart, true)
})

test('a start the board refused (a broken settings file, a version that does not load) is not tried again for 10 minutes', () => {
  let now = NOW
  const update = selfUpdater({ now: () => now })
  assert.equal(update.look({ isNewer: true, canRestart: true, blockers: [] }).restart, true)
  update.refused('The new version does not start: SyntaxError.')
  const refused = update.look({ isNewer: true, canRestart: true, blockers: [] })
  assert.deepEqual([refused.restart, refused.shown.state, refused.shown.line], [false, 'late', 'The board could not start itself anew: The new version does not start: SyntaxError.'])
  now += SELF_UPDATE_WAIT_MS - 1
  assert.equal(update.look({ isNewer: true, canRestart: true, blockers: [] }).restart, false)
  now += 1
  assert.equal(update.look({ isNewer: true, canRestart: true, blockers: [] }).restart, true)
})

test('a board that cannot start itself anew (no keeper) leaves the note as it was, and a newer version that went away forgets the wait', () => {
  let now = NOW
  const update = selfUpdater({ now: () => now })
  assert.deepEqual(update.look({ isNewer: true, canRestart: false, blockers: [] }), { restart: false, shown: null })
  update.look({ isNewer: true, canRestart: true, blockers: ['a check runs'] })
  now += SELF_UPDATE_WAIT_MS
  assert.equal(update.look({ isNewer: true, canRestart: true, blockers: ['a check runs'] }).shown.state, 'late')
  update.look({ isNewer: false, canRestart: true, blockers: [] })
  now += 1_000
  assert.deepEqual(update.look({ isNewer: true, canRestart: true, blockers: ['a check runs'] }).shown, { state: 'waiting', since: now, line: 'The new version of the board starts by itself at a safe moment; waiting: a check runs.' })
})

// The page

const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('update')}\nObject.assign(this, { updateView, reloadsNow, updatedView })`, page)
const plain = value => JSON.parse(JSON.stringify(value))
const version = more => ({ commit: '5fb7da8', since: NOW, head: '5fb7da8', page: 'a1b2c3d', isServerNewer: false, canRestart: true, ...more })

test('the note says what the board waits for while it waits, and asks for the click again after 10 minutes', () => {
  const waiting = { state: 'waiting', since: NOW, line: 'The new version of the board starts by itself at a safe moment; waiting: a check runs.' }
  assert.deepEqual(plain(page.updateView(version({ isServerNewer: true, selfUpdate: waiting }), 'a1b2c3d')), { text: waiting.line, action: null, tone: 'quiet' })
  assert.deepEqual(plain(page.updateView(version({ isServerNewer: true, selfUpdate: { ...waiting, state: 'late' } }), 'a1b2c3d')), { text: 'A new version of the board is available. Click to start it.', action: 'restart', tone: 'new' })
  // A board that tells nothing of the kind (an older one, a copy) keeps the click.
  assert.equal(page.updateView(version({ isServerNewer: true }), 'a1b2c3d').action, 'restart')
})

test('a newer page loads itself when the page is idle, at most once a minute, and never for a newer server', () => {
  const newer = version({ page: 'c0ffee1' })
  const now = 10 * 60_000
  assert.equal(page.reloadsNow(newer, 'a1b2c3d', { isIdle: true, lastAt: 0, now }), true)
  assert.equal(page.reloadsNow(newer, 'a1b2c3d', { isIdle: false, lastAt: 0, now }), false)
  assert.equal(page.reloadsNow(newer, 'a1b2c3d', { isIdle: true, lastAt: now - 30_000, now }), false)
  assert.equal(page.reloadsNow(newer, 'a1b2c3d', { isIdle: true, lastAt: now - 61_000, now }), true)
  assert.equal(page.reloadsNow(version({ page: 'a1b2c3d' }), 'a1b2c3d', { isIdle: true, lastAt: 0, now }), false)
  assert.equal(page.reloadsNow({ ...newer, isServerNewer: true }, 'a1b2c3d', { isIdle: true, lastAt: 0, now }), false)
  assert.equal(page.reloadsNow(newer, '', { isIdle: true, lastAt: 0, now }), false)
  assert.equal(page.reloadsNow(undefined, 'a1b2c3d', { isIdle: true, lastAt: 0, now }), false)
})

test('after the page loaded itself a short note says so, for a few seconds', () => {
  assert.deepEqual(plain(page.updatedView(NOW, NOW + 3_000)), { text: 'The page was updated to the new version.', action: null, tone: 'quiet' })
  assert.equal(page.updatedView(NOW, NOW + 8_000), null)
  assert.equal(page.updatedView(0, NOW), null)
})

test('the idle check looks at popups, focus, words typed and what is on its way; the quiet note has its own cool tone', async () => {
  const idle = script.slice(script.indexOf('function isPageIdle()'), script.indexOf('/** The note on top (see `updateView`)'))
  assert.match(idle, /dialog\[open\]/)
  assert.match(idle, /sending\.size > 0/)
  assert.match(idle, /document\.activeElement/)
  assert.match(idle, /field\.value\.trim\(\) !== ''/)
  const style = await readFile(join(HERE, '..', 'public', 'board.css'), 'utf8')
  assert.match(style, /\.update-note\.is-quiet \{[^}]*background: var\(--inset\)/)
  assert.doesNotMatch(style.match(/\.update-note\.is-quiet \{[^}]*\}/)[0], /waiting|warn/)
})

test('the server looks at its new version every few seconds and starts it through the one restart that checks it first', async () => {
  const server = await readFile(join(HERE, '..', 'server.mjs'), 'utf8')
  assert.match(server, /restart: restartNow,/)
  assert.match(server, /const done = await restartNow\(\)/)
  assert.match(server, /blockersOf\(\{[\s\S]*?runningChecks\.size[\s\S]*?reconciling !== null[\s\S]*?chatLogs\.pending\(\)[\s\S]*?callsNow, lastLogAt/)
  assert.match(server, /selfUpdate: updateShown/)
  for (const call of ['bridgeWork: counted(', 'take: counted(', 'typed: counted(']) assert.ok(server.includes(call), call)
  assert.match(server, /lastLogAt = clock\(\)/)
})

// B512: the two holes the result check found in B454

test('a step reported a moment ago whose chat log is not kept yet holds the restart, for 2 minutes at most', () => {
  const step = (owner, at, state = 'review') => ({
    head: new Map([['Kind', 'step'], ['State', state], ['Owner', owner]]),
    sections: new Map([['History', ['- 2026-10-24 13:50 server: queued', `- ${at} ${owner}: in progress → review`]]]),
  })
  const noon = new Date(2026, 9, 24, 14, 0, 30).getTime()
  const items = [step('Worker 1', '2026-10-24 14:00')]
  assert.deepEqual(reportedNotLogged({ items, now: noon }), ['Worker 1'])
  assert.deepEqual(blockersOf({ now: noon, reported: ['Worker 1'] }), ['Worker 1 just reported a step'])
  assert.deepEqual(blockersOf({ now: noon, reported: ['Worker 1', 'Worker 2'] }), ['Worker 1 and Worker 2 just reported a step'])
  // 2 minutes on, the chat is not cleared by the board any more (a chat the mod does not clear, or a log that never came).
  assert.deepEqual(reportedNotLogged({ items, now: noon + REPORTED_BLOCKS_MS }), [])
  // Its log was asked for after the report (the chat's title carries the project's prefix): the log's own wait takes over.
  assert.deepEqual(reportedNotLogged({ items, now: noon, loggedAt: new Map([['Game - Worker 1', noon]]) }), [])
  assert.deepEqual(reportedNotLogged({ items, now: noon, loggedAt: new Map([['Game - Worker 1', new Date(2026, 9, 24, 13, 59).getTime()]]) }), ['Worker 1'])
  assert.deepEqual(reportedNotLogged({ items, now: noon, loggedAt: new Map([['Game - Worker 11', noon]]) }), ['Worker 1'])
  // A step not in review, or one without an owner, holds nothing.
  assert.deepEqual(reportedNotLogged({ items: [step('Worker 1', '2026-10-24 14:00', 'in progress')], now: noon }), [])
  assert.deepEqual(reportedNotLogged({ items: [], now: noon }), [])
})

test('the server counts the reported steps as a blocker and notes each chat log it is asked for; the page waits for idle also after a restart', async () => {
  const server = await readFile(join(HERE, '..', 'server.mjs'), 'utf8')
  assert.match(server, /reported: reportedNotLogged\(\{ items: itemsOf\(await work\(\)\), now: clock\(\), loggedAt \}\)/)
  assert.match(server, /loggedAt\.set\(String\(checked\.chat\), lastLogAt\)/)
  const read = script.slice(script.indexOf('async function read()'), script.indexOf('/** B221: asks the board to close or delete'))
  assert.match(read, /answer\.status === 403[\s\S]*?isPageIdle\(\)[\s\S]*?location\.reload\(\)/)
  assert.doesNotMatch(read.slice(0, read.indexOf('isPageIdle()')), /location\.reload\(\)/)
})
