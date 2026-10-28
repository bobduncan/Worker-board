// B539: every POST route of the board says whether the loop lock (B488, B529) guards it. A route the server takes a
// POST on without a guard in POST_ROUTES fails here, and every guarded one is refused on a board process that does not
// run the loops, naming the page of the one that does.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createBoard, POST_ROUTES } from '../server.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOKEN = 'd'.repeat(64)
const KEY = 'e'.repeat(64)
const WHY = 'Another board process of this project runs the loops: do this on its page, http://127.0.0.1:4310/.'

/** One POST to the board on `port`, as its own page and the Workers mod would send it: its status and words. */
function post(port, path, { type = 'application/json', body = '{}' } = {}) {
  return new Promise((done, fail) => {
    const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': type, 'X-Board-Token': TOKEN, 'X-Board-Key': KEY }
    const req = request({ host: '127.0.0.1', port, method: 'POST', path, headers }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => done({ status: res.statusCode, text }))
    })
    req.on('error', fail)
    req.end(body)
  })
}

/** A board whose handlers only note that they ran; `mayWrite` answers `why()`. */
async function board(why) {
  const did = []
  const answer = name => async () => { did.push(name); return { ok: true, result: {} } }
  const names = ['take', 'typed', 'report', 'whoami', 'bridgeWork', 'reference', 'talkPicture', 'design', 'backlog', 'goals', 'plan', 'brainstorm', 'work', 'settings', 'game', 'cpu', 'newProject']
  const server = createBoard({
    token: TOKEN, bridgeKey: KEY, getState: async () => ({}),
    say: async () => { did.push('say'); return { ok: true, message: {} } },
    restart: async () => { did.push('restart'); return { ok: true, result: {} } },
    ...Object.fromEntries(names.map(name => [name, answer(name)])),
    mayWrite: async () => why(),
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  return { port: server.address().port, did, close: () => new Promise(done => server.close(done)) }
}

const sendAs = path => (POST_ROUTES[path]?.kind === 'picture' ? { type: 'image/png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) } : {})

test('B539: every route the server takes a POST on states its guard: the loop lock, or free with a reason', async () => {
  // The server's routes, read from its own words: every '/api/...' it names is asked with a POST; one that is not
  // answered "Only GET." takes POSTs.
  const source = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  const named = [...new Set(source.match(/'\/api\/[a-z][a-z/-]*'/g).map(quoted => quoted.slice(1, -1)))]
  const { port, close } = await board(() => null)
  try {
    const taking = []
    for (const path of named) {
      const sent = await post(port, path, sendAs(path))
      if (!(sent.status === 405 && /Only GET/.test(sent.text))) taking.push(path)
    }
    assert.ok(taking.length >= 19, `the routes found: ${taking.join(', ')}`)
    for (const path of taking) {
      const route = POST_ROUTES[path]
      assert.ok(route !== undefined, `${path} takes a POST but says nothing in POST_ROUTES`)
      assert.ok(route.guard === 'lock' || (route.guard === 'free' && typeof route.why === 'string' && route.why.trim() !== ''), `${path}: guard 'lock', or 'free' with its reason`)
    }
    // And every route in the table is one the server serves.
    for (const path of Object.keys(POST_ROUTES)) assert.ok(taking.includes(path), `${path} is in POST_ROUTES but not served`)
  } finally {
    await close()
  }
})

test('B539: the decisions for the routes outside the old list: the mod\'s writes are the holder\'s; a game, the CPU, a new project and a restart are this process\'s own', () => {
  for (const path of ['/api/bridge/work', '/api/bridge/take', '/api/bridge/typed']) assert.equal(POST_ROUTES[path].guard, 'lock', path)
  for (const path of ['/api/game', '/api/cpu', '/api/new-project', '/api/restart', '/api/bridge/report', '/api/bridge/whoami']) assert.equal(POST_ROUTES[path].guard, 'free', path)
})

test('B539: on a board process without the loops every guarded route is refused with 409 naming the holder\'s page, and does nothing; the free ones still run', async () => {
  let why = WHY
  const { port, did, close } = await board(() => why)
  try {
    const guarded = Object.keys(POST_ROUTES).filter(path => POST_ROUTES[path].guard === 'lock')
    for (const path of guarded) {
      const sent = await post(port, path, sendAs(path))
      assert.equal(sent.status, 409, path)
      assert.match(sent.text, /http:\/\/127\.0\.0\.1:4310\//, path)
    }
    assert.deepEqual(did, [], 'no guarded handler ran')
    for (const path of Object.keys(POST_ROUTES).filter(path => POST_ROUTES[path].guard === 'free')) {
      assert.equal((await post(port, path, sendAs(path))).status, 200, path)
    }
    assert.deepEqual(did.sort(), ['cpu', 'game', 'newProject', 'report', 'restart', 'whoami'])
    // Once it holds the lock, a chat's work call is taken.
    why = null
    assert.equal((await post(port, '/api/bridge/work', { body: '{"action":"next"}' })).status, 200)
    assert.ok(did.includes('bridgeWork'))
  } finally {
    await close()
  }
})
