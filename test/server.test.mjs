import assert from 'node:assert/strict'
import { request } from 'node:http'
import test from 'node:test'

import { createBoard } from '../server.mjs'

const TOKEN = 'a'.repeat(64)

/** A board on a free port, with a made-up state and a list of what was sent to it. */
async function board(t) {
  const said = []
  const server = createBoard({
    token: TOKEN,
    getState: async () => ({ readAt: 1, chats: [] }),
    // The real check of a message is tested in say.test.mjs; this one stands in for it.
    say: async body => {
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (text === '') return { ok: false, status: 400, why: 'No text.' }
      if (text.length > 50) return { ok: false, status: 413, why: 'Too long.' }
      const message = { id: `m${said.length}`, at: 1, to: body.to ?? null, text, state: 'waiting' }
      said.push(message)
      return { ok: true, message }
    },
    picture: async path => (path === 'art-inbox/a b.png' ? { type: 'image/png', body: Buffer.from('made-up picture') } : null),
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const port = server.address().port
  const origin = `http://127.0.0.1:${port}`

  const ask = ({ method = 'GET', path = '/', headers = {}, body = null }) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(body)
  })
  const say = (headers, body = JSON.stringify({ text: 'Hello' })) => ask({ method: 'POST', path: '/api/say', headers, body })
  const good = { 'X-Board-Token': TOKEN, Origin: origin, 'Content-Type': 'application/json' }
  return { server, port, origin, ask, say, good, said }
}

test('the board listens on this machine only', async t => {
  const { server } = await board(t)
  assert.equal(server.address().address, '127.0.0.1')
})

test('the page carries the token and forbids scripts and styles from anywhere else', async t => {
  const { ask } = await board(t)
  const page = await ask({ path: '/' })
  assert.equal(page.status, 200)
  assert.match(page.headers['content-type'], /^text\/html/)
  assert.ok(page.text.includes(`<meta name="board-token" content="${TOKEN}">`))
  assert.match(page.headers['content-security-policy'], /default-src 'none'/)
  assert.match(page.headers['content-security-policy'], /script-src 'self'/)
  // Pictures come from the board itself, or from what the page fetched from it.
  assert.match(page.headers['content-security-policy'], /img-src 'self' blob:;/)
  // No other page may hold the board in a frame, and no form on it may post anywhere.
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.match(page.headers['content-security-policy'], /form-action 'none'/)
  assert.equal(page.headers['x-frame-options'], 'DENY')
  assert.equal(page.headers['x-content-type-options'], 'nosniff')
  assert.equal(page.headers['cache-control'], 'no-store')
})

test('the script and the style sheet are served, and nothing else from the folder', async t => {
  const { ask } = await board(t)
  assert.match((await ask({ path: '/board.js' })).headers['content-type'], /^text\/javascript/)
  assert.match((await ask({ path: '/board.css' })).headers['content-type'], /^text\/css/)
  for (const path of ['/config.json', '/../config.json', '/..%2Fconfig.json', '/server.mjs', '/data/outbox.jsonl', '/public/index.html']) {
    assert.equal((await ask({ path })).status, 404, path)
  }
})

test('the state is given to the page only: it needs the token', async t => {
  const { ask } = await board(t)
  assert.equal((await ask({ path: '/api/state' })).status, 403)
  assert.equal((await ask({ path: '/api/state', headers: { 'X-Board-Token': 'b'.repeat(64) } })).status, 403)
  const answer = await ask({ path: '/api/state', headers: { 'X-Board-Token': TOKEN } })
  assert.equal(answer.status, 200)
  assert.deepEqual(JSON.parse(answer.text), { readAt: 1, chats: [] })
  assert.equal(answer.headers['cache-control'], 'no-store')
})

test('a picture is given to the page only, by the path the board may show', async t => {
  const { ask } = await board(t)
  const path = `/api/picture?path=${encodeURIComponent('art-inbox/a b.png')}`
  assert.equal((await ask({ path })).status, 403)
  const answer = await ask({ path, headers: { 'X-Board-Token': TOKEN } })
  assert.deepEqual([answer.status, answer.headers['content-type'], answer.text], [200, 'image/png', 'made-up picture'])
  assert.equal(answer.headers['x-content-type-options'], 'nosniff')
  assert.equal((await ask({ path: '/api/picture?path=art-inbox/other.png', headers: { 'X-Board-Token': TOKEN } })).status, 404)
  assert.equal((await ask({ path: '/api/picture', headers: { 'X-Board-Token': TOKEN } })).status, 404)
})

test('no answer carries a header that lets another website read it', async t => {
  const { ask, say, good } = await board(t)
  const answers = [
    await ask({ path: '/' }),
    await ask({ path: '/api/state', headers: { 'X-Board-Token': TOKEN, Origin: 'https://example.com' } }),
    await ask({ method: 'OPTIONS', path: '/api/say', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' } }),
    await say(good),
  ]
  for (const answer of answers) {
    assert.equal(Object.keys(answer.headers).filter(name => name.startsWith('access-control-')).length, 0)
  }
  assert.equal(answers[2].status, 405)
})

test('sending is refused without the token', async t => {
  const { say, good, said } = await board(t)
  const { 'X-Board-Token': _, ...withoutToken } = good
  assert.equal((await say(withoutToken)).status, 403)
  assert.equal((await say({ ...good, 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  assert.equal((await say({ ...good, 'X-Board-Token': 'short' })).status, 403)
  assert.equal(said.length, 0)
})

test('sending is refused from another origin, and without one', async t => {
  const { say, good, said, port } = await board(t)
  const { Origin: _, ...withoutOrigin } = good
  assert.equal((await say({ ...good, Origin: 'https://example.com' })).status, 403)
  assert.equal((await say({ ...good, Origin: `http://localhost:${port}` })).status, 403)
  assert.equal((await say({ ...good, Origin: 'null' })).status, 403)
  assert.equal((await say(withoutOrigin)).status, 403)
  assert.equal(said.length, 0)
})

test('sending is refused when the body is not announced as JSON', async t => {
  const { say, good, said } = await board(t)
  assert.equal((await say({ ...good, 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await say({ ...good, 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415)
  assert.equal(said.length, 0)
})

test('sending is accepted with the token, the page\'s own origin and a JSON body', async t => {
  const { say, good, said } = await board(t)
  const answer = await say({ ...good, 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ text: '  Hello Main  ' }))
  assert.equal(answer.status, 200)
  assert.deepEqual(JSON.parse(answer.text), { id: 'm0', at: 1, to: null, text: 'Hello Main', state: 'waiting' })
  assert.deepEqual(said.map(message => message.text), ['Hello Main'])
})

test('sending refuses a body that is not a message: broken, empty, too long, too large', async t => {
  const { say, good, said } = await board(t)
  assert.equal((await say(good, '{ broken')).status, 400)
  assert.equal((await say(good, JSON.stringify({ text: '   ' }))).status, 400)
  assert.equal((await say(good, JSON.stringify({ text: 5 }))).status, 400)
  assert.equal((await say(good, JSON.stringify(['Hello']))).status, 400)
  assert.equal((await say(good, JSON.stringify({ text: 'x'.repeat(51) }))).status, 413)
  assert.equal((await say(good, JSON.stringify({ text: 'x', padding: 'y'.repeat(40_000) }))).status, 413)
  assert.equal(said.length, 0)
})

test('a request that names another host is refused, so a website cannot pose as the board', async t => {
  const { ask, say, good, said, port } = await board(t)
  assert.equal((await ask({ path: '/', headers: { Host: 'evil.example:4310' } })).status, 403)
  assert.equal((await ask({ path: '/api/state', headers: { Host: 'evil.example', 'X-Board-Token': TOKEN } })).status, 403)
  assert.equal((await say({ ...good, Host: `evil.example:${port}` })).status, 403)
  assert.equal(said.length, 0)
})

test('the page opened as localhost is sent on to 127.0.0.1, where sending works', async t => {
  const { ask, port, origin } = await board(t)
  const answer = await ask({ path: '/', headers: { Host: `localhost:${port}` } })
  assert.equal(answer.status, 307)
  assert.equal(answer.headers.location, `${origin}/`)
})

test('other methods and other paths are refused', async t => {
  const { ask } = await board(t)
  assert.equal((await ask({ method: 'PUT', path: '/api/state', headers: { 'X-Board-Token': TOKEN } })).status, 405)
  assert.equal((await ask({ method: 'GET', path: '/api/say', headers: { 'X-Board-Token': TOKEN } })).status, 405)
  assert.equal((await ask({ method: 'POST', path: '/', body: 'x' })).status, 405)
  assert.equal((await ask({ path: '/api/other', headers: { 'X-Board-Token': TOKEN } })).status, 404)
})

test('a state that cannot be built answers an error without details', async t => {
  const server = createBoard({ token: TOKEN, getState: async () => { throw new Error('secret words from a chat') }, say: async () => ({}) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const answer = await fetch(`http://127.0.0.1:${server.address().port}/api/state`, { headers: { 'X-Board-Token': TOKEN } })
  assert.equal(answer.status, 500)
  assert.ok(!(await answer.text()).includes('secret'))
})
