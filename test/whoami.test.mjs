// 2026-10-28 (the person: "'which chat you' are by session id even seems more robust"): a chat's mod asks the board who its
// session is (`POST /api/bridge/whoami`), instead of learning its name from the app's title (which the app's guard skips on
// a work login). The parts that need no running board: the name from the app's chat list, the role, where the card is
// filed after a clear in a new process, how a call counts for `seen`, and how the route is asked. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answerWhoami, cardSessionOf, noteWhoami, shownSessions, whoamiOf, whoamiSession } from '../src/bridge.mjs'
import { cardFiledUnder, readCardRows } from '../src/chatCards.mjs'
import { parseConfig } from '../src/config.mjs'
import { POST_ROUTES, createBoard } from '../server.mjs'
import { buildState } from './withStore.mjs'

const NOW = Date.UTC(2026, 9, 28, 9, 0)
const MIN = 60_000

/** The board's state as the bridge reads it: lanes by name with their session, and the partners. */
const STATE = {
  chats: [
    { name: 'Main', isMain: true, isLeftover: false, session: 'main-id' },
    { name: 'Worker 5', isMain: false, isLeftover: false, session: 'w5-new' },
    { name: 'Gone', isMain: false, isLeftover: true, session: 'gone-id' },
    { name: '  ', isMain: false, isLeftover: false, session: 'blank-id' },
  ],
  advisor: { name: 'Advisor', session: 'advisor-id' },
  advisorHelper: { name: 'Advisor 2', session: 'helper-id' },
  supervisorChat: { name: 'Supervisor', session: 'sup-id' },
}

const card = (name, more = {}) => JSON.stringify({ name, role: 'worker', state: 'waiting', task: null, at: NOW - 5 * MIN, ...more })

test('the name is the one the board shows the session under: a lane, the partner, its helper, the supervisor; none for any other', () => {
  assert.equal(whoamiOf(STATE, 'main-id'), 'Main')
  assert.equal(whoamiOf(STATE, ' w5-new '), 'Worker 5')
  assert.equal(whoamiOf(STATE, 'advisor-id'), 'Advisor')
  assert.equal(whoamiOf(STATE, 'helper-id'), 'Advisor 2')
  assert.equal(whoamiOf(STATE, 'sup-id'), 'Supervisor')
  // A session of no chat of the list, a leftover lane, a name the mod would not take, and no session at all.
  assert.equal(whoamiOf(STATE, 'nobody'), null)
  assert.equal(whoamiOf(STATE, 'gone-id'), null)
  assert.equal(whoamiOf(STATE, 'blank-id'), null)
  assert.equal(whoamiOf(STATE, ''), null)
  assert.equal(whoamiOf(STATE, 'x'.repeat(121)), null)
  assert.equal(whoamiOf(STATE, undefined), null)
  assert.equal(whoamiOf({ chats: [{ name: 'N'.repeat(81), session: 'long-id' }] }, 'long-id'), null)
  assert.equal(whoamiOf({}, 'main-id'), null)
})

test('the answer says name, role and card; nothing but the name for a session the board shows under none', () => {
  assert.deepEqual(answerWhoami(STATE, { session: 'main-id' }), { ok: true, result: { name: 'Main', role: 'main', card: null } })
  assert.deepEqual(answerWhoami(STATE, { session: 'w5-new' }, 'w5-old'), { ok: true, result: { name: 'Worker 5', role: 'worker', card: 'w5-old' } })
  assert.equal(answerWhoami(STATE, { session: 'advisor-id' }).result.role, 'advisor')
  assert.equal(answerWhoami(STATE, { session: 'helper-id' }).result.role, 'helper')
  assert.equal(answerWhoami(STATE, { session: 'sup-id' }).result.role, 'supervisor')
  // An unknown session: no name, no role, and a card named by mistake is not passed on.
  assert.deepEqual(answerWhoami(STATE, { session: 'nobody' }, 'w5-old'), { ok: true, result: { name: null, role: null, card: null } })
  // The chat's name in the body is nobody's word: only the session counts.
  assert.equal(answerWhoami(STATE, { chat: 'Main', session: 'w5-new' }).result.name, 'Worker 5')
  for (const body of [null, [], 'main-id', {}, { session: '' }, { session: 3 }, { session: 'x'.repeat(121) }]) {
    const refused = answerWhoami(STATE, body)
    assert.equal(refused.ok, false, JSON.stringify(body))
    assert.equal(refused.status, 400)
  }
  assert.equal(whoamiSession({ session: ' abc ' }), 'abc')
  assert.deepEqual([...shownSessions(STATE)].sort(), ['advisor-id', 'blank-id', 'helper-id', 'main-id', 'sup-id', 'w5-new'])
})

test('a card filed under another session is the chat\'s own: the newest of its name, never a left, moved or another live chat\'s', () => {
  const rows = [
    { session: 'w5-old', text: card('Worker 5', { at: NOW - 9 * MIN }) },
    { session: 'w5-older', text: card('worker 5', { at: NOW - 60 * MIN }) },
    { session: 'w5-left', text: '{ "left": true }\n' },
    { session: 'w5-moved', text: JSON.stringify({ movedTo: 'w5-old', at: NOW }) },
    { session: 'w6-old', text: card('Worker 6') },
    { session: 'broken', text: '{ not json' },
    { session: 'list-like', text: '[1]' },
  ]
  assert.equal(cardSessionOf(rows, { name: 'Worker 5', session: 'w5-new' }), 'w5-old')
  // The name is read as the board shows it, whatever the case.
  assert.equal(cardSessionOf(rows, { name: 'WORKER 5', session: 'w5-new' }), 'w5-old')
  assert.equal(cardSessionOf(rows, { name: 'Worker 6', session: 'w5-new' }), 'w6-old')
  assert.equal(cardSessionOf(rows, { name: 'Worker 7', session: 'w5-new' }), null)
  assert.equal(cardSessionOf(rows, { name: '', session: 'w5-new' }), null)
  // The asking session's own file is no "other" card.
  assert.equal(cardSessionOf(rows, { name: 'Worker 5', session: 'w5-old' }), 'w5-older')
  // A card under a session the board shows under a name belongs to that chat (two chats with one title).
  assert.equal(cardSessionOf(rows, { name: 'Worker 5', session: 'w5-new', shown: new Set(['w5-old']) }), 'w5-older')
  assert.equal(cardSessionOf(rows, { name: 'Worker 5', session: 'w5-new', shown: new Set(['w5-old', 'w5-older']) }), null)
  assert.equal(cardSessionOf([], { name: 'Worker 5', session: 'w5-new' }), null)
})

test('the cards are read from the project\'s chats folder: the asking session\'s own file ends the search, list.json and a folder are no card', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-cards-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeFile(join(dir, 'list.json'), '{"prefix":"Game - ","main":"Main"}')
  await writeFile(join(dir, 'w5-old.json'), card('Worker 5'))
  await writeFile(join(dir, 'main-id.json'), card('Main', { role: 'main' }))
  await writeFile(join(dir, 'notes.txt'), 'not a card')
  await writeFile(join(dir, 'bad name.json'), card('Worker 5'))
  await mkdir(join(dir, 'own'))
  await writeFile(join(dir, 'own', 'worker-5.json'), card('Worker 5'))
  assert.deepEqual((await readCardRows(dir)).map(row => row.session).sort(), ['main-id', 'w5-old'])
  assert.deepEqual(await readCardRows(join(dir, 'nowhere')), [])

  assert.equal(await cardFiledUnder(dir, { name: 'Worker 5', session: 'w5-new', shown: new Set() }), 'w5-old')
  // The session that asks has a file: its card is where it belongs (a chat that left is not pulled back either).
  assert.equal(await cardFiledUnder(dir, { name: 'Worker 5', session: 'w5-old', shown: new Set() }), null)
  await writeFile(join(dir, 'w5-new.json'), '{ "left": true }\n')
  assert.equal(await cardFiledUnder(dir, { name: 'Worker 5', session: 'w5-new', shown: new Set() }), null)
  // A session that is no file name, and a folder that is not there.
  assert.equal(await cardFiledUnder(dir, { name: 'Worker 5', session: '../w5-old', shown: new Set() }), null)
  assert.equal(await cardFiledUnder(join(dir, 'nowhere'), { name: 'Worker 5', session: 'w5-new', shown: new Set() }), null)
})

const config = { ...parseConfig('{}', {}), project: 'C:\\p' }
const raw = { listText: '{"prefix":"Team - ","main":"Lead"}', appChatTexts: [], tails: {}, planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {} }
const isMissing = (seen, startedAt = NOW - 5 * MIN) => buildState(raw, { outbox: [], board: { startedAt, offSince: null }, seen, now: NOW, config }).bridge.isMissing

test('a whoami call says its mod runs: by the name it is shown under, or, for a session of no chat, under a key no chat\'s name can be', () => {
  const nobody = () => ({ shown: {}, other: {} })
  assert.equal(isMissing(nobody()), true)
  const known = nobody()
  noteWhoami(known, 'main-id', 'Main', NOW - 2000)
  assert.deepEqual(known, { shown: { Main: NOW - 2000 }, other: {} })
  assert.equal(isMissing(known), false)
  // A session the board shows under no name: no lane reads it, and the board still knows a mod runs.
  const unknown = nobody()
  noteWhoami(unknown, 'stranger-id', null, NOW - 2000)
  assert.deepEqual(unknown, { shown: {}, other: { 'session stranger-id': NOW - 2000 } })
  assert.equal(isMissing(unknown), false)
  // The same session again is one entry, not two.
  noteWhoami(unknown, 'stranger-id', null, NOW - 1000)
  assert.equal(Object.keys(unknown.other).length, 1)
  // A board without a bridge keeps no record.
  assert.doesNotThrow(() => noteWhoami(null, 'main-id', 'Main', NOW))
  assert.doesNotThrow(() => noteWhoami(undefined, 'main-id', null, NOW))
})

const KEY = 'c'.repeat(64)
const TOKEN = 'a'.repeat(64)

test('the route is the mod\'s: the bridge key, JSON and a POST; the page\'s token does not open it; it only reads, so a board without the loops answers it too', async t => {
  assert.deepEqual([POST_ROUTES['/api/bridge/whoami'].kind, POST_ROUTES['/api/bridge/whoami'].guard], ['bridge', 'free'])
  const asked = []
  const server = createBoard({
    token: TOKEN, bridgeKey: KEY, getState: async () => ({}), say: async () => ({}),
    whoami: async body => {
      asked.push(body)
      return body.session === 'w5-new' ? { ok: true, result: { name: 'Worker 5', role: 'worker', card: null } } : { ok: false, status: 400, why: 'Name the session.' }
    },
    mayWrite: async () => 'Another board process runs the loops.',
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const port = server.address().port
  const ask = ({ method = 'POST', headers = {}, body = JSON.stringify({ session: 'w5-new' }) }) => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path: '/api/bridge/whoami', headers }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => done({ status: res.statusCode, text }))
    })
    req.on('error', fail)
    req.end(body)
  })
  const json = { 'Content-Type': 'application/json' }
  assert.equal((await ask({ headers: json })).status, 403)
  assert.equal((await ask({ headers: { ...json, 'X-Board-Token': TOKEN, Origin: `http://127.0.0.1:${port}` } })).status, 403)
  assert.equal((await ask({ headers: { 'X-Board-Key': KEY, 'Content-Type': 'text/plain' } })).status, 415)
  assert.equal((await ask({ method: 'GET', headers: { 'X-Board-Key': KEY }, body: null })).status, 405)
  assert.equal((await ask({ headers: { ...json, 'X-Board-Key': KEY }, body: 'not json' })).status, 400)
  assert.deepEqual(asked, [])

  const answered = await ask({ headers: { ...json, 'X-Board-Key': KEY, 'X-Workers-Mod': '0.22.0' } })
  assert.equal(answered.status, 200)
  assert.deepEqual(JSON.parse(answered.text), { name: 'Worker 5', role: 'worker', card: null })
  // The mod says its version in its header, as with every call of the bridge.
  assert.deepEqual(asked, [{ session: 'w5-new', mod: '0.22.0' }])
  assert.equal((await ask({ headers: { ...json, 'X-Board-Key': KEY }, body: '{}' })).status, 400)
})
