// Signals change 5 (2026-11-02, C of B913): the board's own restart waits while the person is busy on the page. On 2026-11-01
// the board restarted eight times for landings while the person typed. The page's poll says it (X-Board-Active: a key or
// click in the last minute, or a field with the focus, in a shown tab); the self-updater waits for it, never longer than
// 3 minutes from the first look at which only the person holds it. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createBoard } from '../server.mjs'
import { ACTIVE_KEPT_MS, PERSON_BUSY, PERSON_WAIT_MS, SELF_UPDATE_WAIT_MS, activePages, blockersOf, readActive, selfUpdater } from '../src/selfUpdate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = Date.UTC(2026, 10, 2, 10, 0, 0)

test('readActive: the header is a page id and how long the person has been busy; anything else is nothing', () => {
  assert.deepEqual(readActive('k3j9x0a1 42000'), { page: 'k3j9x0a1', forMs: 42000 })
  assert.deepEqual(readActive(' p-1 0 '), { page: 'p-1', forMs: 0 })
  for (const odd of [null, undefined, '', 'k3j9x0a1', 'k3j9x0a1 -5', 'k3j9x0a1 1.5', 'two words 5', 'k3j9x0a1 5 6', `${'a'.repeat(41)} 5`, 42]) {
    assert.equal(readActive(odd), null, String(odd))
  }
})

test('activePages: any page that said so within 90 s makes the person busy, since the earliest of them; a quiet page is forgotten', () => {
  const pages = activePages()
  assert.equal(pages.personActive(NOW), null)
  pages.heard('tab 30000', NOW)
  pages.heard('pane 5000', NOW + 10_000)
  pages.heard('nonsense', NOW + 10_000)
  assert.deepEqual(pages.personActive(NOW + 10_000), { since: NOW - 30_000 })
  // The board's clock: since is now minus what the page says, whatever the page's own clock reads.
  assert.deepEqual(pages.personActive(NOW + ACTIVE_KEPT_MS), { since: NOW - 30_000 })
  assert.deepEqual(pages.personActive(NOW + ACTIVE_KEPT_MS + 1), { since: NOW + 5_000 }, 'the tab went quiet: the pane still says so')
  assert.equal(pages.personActive(NOW + 10_000 + ACTIVE_KEPT_MS + 1), null)
})

test('blockersOf: the person busy on the page is a blocker in its own words, and only then', () => {
  assert.deepEqual(blockersOf({ now: NOW, personActive: { since: NOW - 1_000 } }), [PERSON_BUSY])
  assert.deepEqual(blockersOf({ now: NOW, personActive: null }), [])
  assert.deepEqual(blockersOf({ now: NOW, checks: 1, personActive: { since: NOW } }), ['a check runs', PERSON_BUSY])
})

test('the self-updater waits while the person is busy, never longer than 3 minutes from the first look where only the person holds it', () => {
  let now = NOW
  const updater = selfUpdater({ now: () => now })
  const look = blockers => updater.look({ isNewer: true, canRestart: true, blockers })
  // A check runs and the person types: the check holds it; the person's 3 minutes have not started.
  assert.equal(look(['a check runs', PERSON_BUSY]).restart, false)
  now += 5 * 60_000
  const held = look([PERSON_BUSY])
  assert.deepEqual([held.restart, held.shown.state], [false, 'waiting'])
  assert.match(held.shown.line, /waiting: the person is busy on the page\.$/)
  now += PERSON_WAIT_MS - 1_000
  assert.equal(look([PERSON_BUSY]).restart, false, 'still inside the 3 minutes')
  now += 1_000
  assert.equal(look([PERSON_BUSY]).restart, true, 'released after 3 minutes')
  // The person stopped before the cap: the start comes at once.
  const quick = selfUpdater({ now: () => now })
  assert.equal(quick.look({ isNewer: true, blockers: [PERSON_BUSY] }).restart, false)
  now += 20_000
  assert.equal(quick.look({ isNewer: true, blockers: [] }).restart, true)
})

test('while only the person holds it, the note on top is never "late"; with another blocker it turns late after 10 minutes as before', () => {
  let now = NOW
  const updater = selfUpdater({ now: () => now, personWaitMs: 60 * 60_000 })
  updater.look({ isNewer: true, blockers: ['a check runs'] })
  now += SELF_UPDATE_WAIT_MS
  assert.equal(updater.look({ isNewer: true, blockers: ['a check runs'] }).shown.state, 'late')
  assert.equal(updater.look({ isNewer: true, blockers: [PERSON_BUSY] }).shown.state, 'waiting')
  assert.equal(updater.look({ isNewer: true, blockers: ['a check runs', PERSON_BUSY] }).shown.state, 'late')
})

test('the page\'s poll hands its X-Board-Active header to the board; a page without the board\'s token is not heard', async t => {
  const heard = []
  const server = createBoard({ token: 'good-token', getState: async () => ({ fine: true }), heardActive: header => heard.push(header) })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const base = `http://127.0.0.1:${server.address().port}`
  const ask = headers => fetch(`${base}/api/state`, { headers })
  assert.equal((await ask({ 'X-Board-Token': 'good-token', 'X-Board-Active': 'tab 1200' })).status, 200)
  assert.equal((await ask({ 'X-Board-Token': 'good-token' })).status, 200)
  assert.equal((await ask({ 'X-Board-Token': 'wrong', 'X-Board-Active': 'tab 99' })).status, 403)
  assert.deepEqual(heard, ['tab 1200', null])
})

test('the server waits for the person through the pages\' polls; a restart the person asks for does not wait (C3)', async () => {
  const server = await readFile(join(HERE, '..', 'server.mjs'), 'utf8')
  assert.match(server, /heardActive: header => pagesActive\.heard\(header, clock\(\)\)/)
  assert.match(server, /blockersOf\(\{[\s\S]*?personActive: pagesActive\.personActive\(clock\(\)\)/)
  // The click's route goes straight to restartNow, which asks no blocker.
  assert.match(server, /restart: restartNow,/)
  const restartNow = server.slice(server.indexOf('const restartNow = async () => {'), server.indexOf('const server = createBoard({'))
  assert.ok(restartNow.length > 0)
  assert.doesNotMatch(restartNow, /blockersOf|personActive|selfUpdate\.look/)
})
