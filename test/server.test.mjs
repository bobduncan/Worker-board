import assert from 'node:assert/strict'
import { request } from 'node:http'
import test from 'node:test'

import { createBoard } from '../server.mjs'

const TOKEN = 'a'.repeat(64)
const KEY = 'c'.repeat(64)

/** A board on a free port, with a made-up state and a list of what was sent to it. */
async function board(t) {
  const said = []
  const asked = []
  const taken = []
  const designed = []
  const worked = []
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
    bridgeKey: KEY,
    // B297: the work store's API; the real one is tested in work/api.test.mjs.
    work: async body => {
      worked.push(['page', body])
      return { ok: true, result: { text: 'Id: B1' } }
    },
    bridgeWork: async body => {
      worked.push(['mod', body])
      return body?.action === 'take' ? { ok: false, status: 409, why: 'B1: Units holds it (in progress).' } : { ok: true, result: { text: 'Yours, Board:' } }
    },
    take: async body => {
      taken.push(body)
      return { ok: true, result: { messages: [{ id: 'm1', text: 'Hello\n(typed on the worker board, 16:02)' }] } }
    },
    typed: async body => {
      taken.push({ typed: body })
      return { ok: true, result: {} }
    },
    // The real checks are tested in design.test.mjs.
    design: async body => {
      designed.push(body)
      return body?.action === 'make' ? { ok: true, result: { idea: 'i1' } } : { ok: false, status: 409, why: 'That idea is not there any more.' }
    },
    reference: async bytes => {
      designed.push({ bytes: bytes.length })
      return { ok: true, result: { path: 'art-inbox/ideas/_references/0123456789abcdef.png' } }
    },
    // B167: the real keeping is the server's own, by the bytes; this one stands in for it.
    talkPicture: async bytes => {
      designed.push({ talk: bytes.length })
      return { ok: true, result: { path: 'art-inbox/talk/2026-10-14-1144.png' } }
    },
    // The real check is tested in games.test.mjs.
    game: async body => {
      asked.push(body)
      return body?.item === 'walk' ? { ok: true, result: { url: 'http://127.0.0.1:5301/' } } : { ok: false, status: 409, why: 'That request names no branch to run.' }
    },
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
  return { server, port, origin, ask, say, good, said, asked, taken, designed, worked }
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

test('a game is started only by the board\'s own page: the token, its origin and JSON, as for sending', async t => {
  const { ask, good, asked, origin } = await board(t)
  const game = (headers, body = JSON.stringify({ item: 'walk', action: 'start' })) => ask({ method: 'POST', path: '/api/game', headers, body })
  assert.equal((await game({ ...good, 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  assert.equal((await game({ 'X-Board-Token': TOKEN, 'Content-Type': 'application/json' })).status, 403)
  assert.equal((await game({ ...good, Origin: 'http://evil.example' })).status, 403)
  assert.equal((await game({ ...good, 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await ask({ path: '/api/game', headers: good })).status, 405)
  assert.equal(asked.length, 0)

  const started = await game(good)
  assert.equal(started.status, 200)
  assert.deepEqual(JSON.parse(started.text), { url: 'http://127.0.0.1:5301/' })
  assert.deepEqual(asked, [{ item: 'walk', action: 'start' }])
  // No other website is told it may read the answer.
  assert.equal(started.headers['access-control-allow-origin'], undefined)
  assert.equal(origin.startsWith('http://127.0.0.1:'), true)

  const refused = await game(good, JSON.stringify({ item: 'other', action: 'start' }))
  assert.equal(refused.status, 409)
  assert.match(refused.text, /names no branch/)
})

test('the mod takes what waits for its chat with the bridge\'s key; the page\'s token does not open it, and the key sends nothing', async t => {
  const { ask, say, good, taken, said } = await board(t)
  const take = (headers, body = JSON.stringify({ chat: 'Units' })) => ask({ method: 'POST', path: '/api/bridge/take', headers, body })
  const json = { 'Content-Type': 'application/json' }
  assert.equal((await take(json)).status, 403)
  assert.equal((await take({ ...json, 'X-Board-Key': 'd'.repeat(64) })).status, 403)
  assert.equal((await take(good)).status, 403)
  assert.equal((await take({ 'X-Board-Key': KEY, 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await ask({ path: '/api/bridge/take', headers: { 'X-Board-Key': KEY } })).status, 405)
  assert.equal((await take({ ...json, 'X-Board-Key': KEY, Host: 'evil.example' })).status, 403)
  assert.equal(taken.length, 0)

  const answer = await take({ ...json, 'X-Board-Key': KEY })
  assert.equal(answer.status, 200)
  assert.deepEqual(JSON.parse(answer.text), { messages: [{ id: 'm1', text: 'Hello\n(typed on the worker board, 16:02)' }] })
  assert.deepEqual(taken, [{ chat: 'Units' }])
  assert.equal(answer.headers['access-control-allow-origin'], undefined)

  // What was typed is reported the same way, and by the same key only.
  const report = headers => ask({ method: 'POST', path: '/api/bridge/typed', headers, body: JSON.stringify({ chat: 'Units', typed: ['m1'] }) })
  assert.equal((await report(good)).status, 403)
  assert.equal((await report({ ...json, 'X-Board-Key': KEY })).status, 200)
  assert.deepEqual(taken.at(-1), { typed: { chat: 'Units', typed: ['m1'] } })

  // The key is for taking only.
  assert.equal((await say({ 'X-Board-Key': KEY, 'Content-Type': 'application/json' })).status, 403)
  assert.equal(said.length, 0)
})

test('a board without a bridge key has no bridge', async t => {
  const server = createBoard({ token: TOKEN, getState: async () => ({}), say: async () => ({}) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const answer = await fetch(`http://127.0.0.1:${server.address().port}/api/bridge/take`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': '' }, body: '{"chat":"Units"}' })
  assert.equal(answer.status, 403)
})

test('the Design tab\'s calls come from the board\'s own page only, as sending does', async t => {
  const { ask, good, designed } = await board(t)
  const call = (headers, body = JSON.stringify({ action: 'make', kind: 'screen', text: 'A shop screen' })) => ask({ method: 'POST', path: '/api/design', headers, body })
  assert.equal((await call({ ...good, 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  assert.equal((await call({ 'X-Board-Token': TOKEN, 'Content-Type': 'application/json' })).status, 403)
  assert.equal((await call({ ...good, Origin: 'http://evil.example' })).status, 403)
  assert.equal((await call({ ...good, 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await call({ ...good, 'X-Board-Key': KEY, 'X-Board-Token': '' })).status, 403)
  assert.equal(designed.length, 0)

  const made = await call(good)
  assert.equal(made.status, 200)
  assert.deepEqual(JSON.parse(made.text), { idea: 'i1' })
  assert.deepEqual(designed, [{ action: 'make', kind: 'screen', text: 'A shop screen' }])
  const refused = await call(good, JSON.stringify({ action: 'drop', idea: 'gone' }))
  assert.deepEqual([refused.status, refused.text.trim()], [409, 'That idea is not there any more.'])
})

test('a reference picture is taken from the board\'s own page only, as a picture, and not a large one', async t => {
  const { ask, good, designed } = await board(t)
  const picture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const send = (headers, body = picture) => ask({ method: 'POST', path: '/api/design/reference', headers, body })
  const asPicture = { ...good, 'Content-Type': 'image/png' }
  assert.equal((await send({ 'Content-Type': 'image/png' })).status, 403)
  assert.equal((await send({ ...asPicture, Origin: 'http://evil.example' })).status, 403)
  assert.equal((await send({ ...asPicture, 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  // A form another page could post, or anything that is no picture, is not read at all.
  assert.equal((await send({ ...asPicture, 'Content-Type': 'multipart/form-data; boundary=x' })).status, 415)
  assert.equal((await send({ ...asPicture, 'Content-Type': 'image/svg+xml' })).status, 415)
  assert.equal((await ask({ path: '/api/design/reference', headers: asPicture })).status, 405)
  assert.equal((await send(asPicture, Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413)
  assert.equal(designed.length, 0)

  const kept = await send(asPicture)
  assert.equal(kept.status, 200)
  assert.deepEqual(JSON.parse(kept.text), { path: 'art-inbox/ideas/_references/0123456789abcdef.png' })
  assert.deepEqual(designed, [{ bytes: picture.length }])
})

test('B167: a picture pasted into Talk to Main is taken as a reference picture is: from the board\'s own page, as a picture, not a large one', async t => {
  const { ask, good, designed } = await board(t)
  const picture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const send = (headers, body = picture) => ask({ method: 'POST', path: '/api/talk/picture', headers, body })
  const asPicture = { ...good, 'Content-Type': 'image/png' }
  assert.equal((await send({ 'Content-Type': 'image/png' })).status, 403)
  assert.equal((await send({ ...asPicture, Origin: 'http://evil.example' })).status, 403)
  assert.equal((await send({ ...asPicture, 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await ask({ path: '/api/talk/picture', headers: asPicture })).status, 405)
  assert.equal((await send(asPicture, Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413)
  assert.equal(designed.length, 0)
  const kept = await send(asPicture)
  assert.deepEqual([kept.status, JSON.parse(kept.text)], [200, { path: 'art-inbox/talk/2026-10-14-1144.png' }])
  assert.deepEqual(designed, [{ talk: picture.length }])
})

test('B297: /api/bridge/work needs the key; /api/work needs the token and the origin', async t => {
  const { ask, good, worked } = await board(t)
  const json = { 'Content-Type': 'application/json' }
  const mod = (headers, body = JSON.stringify({ chat: 'Board', action: 'next' })) => ask({ method: 'POST', path: '/api/bridge/work', headers, body })
  const page = (headers, body = JSON.stringify({ action: 'list' })) => ask({ method: 'POST', path: '/api/work', headers, body })
  assert.equal((await mod(json)).status, 403)
  assert.equal((await mod(good)).status, 403)
  assert.equal((await mod({ 'X-Board-Key': KEY, 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await page({ ...json, 'X-Board-Key': KEY })).status, 403)
  assert.equal((await page({ ...good, Origin: 'http://evil.example' })).status, 403)
  assert.equal(worked.length, 0)
  const next = await mod({ ...json, 'X-Board-Key': KEY })
  assert.equal(next.status, 200)
  assert.deepEqual(JSON.parse(next.text), { text: 'Yours, Board:' })
  const refused = await mod({ ...json, 'X-Board-Key': KEY }, JSON.stringify({ chat: 'Board', action: 'take', id: 'B1' }))
  assert.equal(refused.status, 409)
  assert.match(refused.text, /Units holds it/)
  assert.equal((await page(good)).status, 200)
  assert.deepEqual(worked, [['mod', { chat: 'Board', action: 'next' }], ['mod', { chat: 'Board', action: 'take', id: 'B1' }], ['page', { action: 'list' }]])
})

test("B412: a work call's request id comes in its X-Work-Request header; one in the body is not taken", async t => {
  const { ask, worked } = await board(t)
  const headers = { 'Content-Type': 'application/json', 'X-Board-Key': KEY }
  const body = JSON.stringify({ chat: 'Board', action: 'next', request: 'from-the-body-1' })
  await ask({ method: 'POST', path: '/api/bridge/work', headers: { ...headers, 'X-Work-Request': 'cli-board-7-abc' }, body })
  await ask({ method: 'POST', path: '/api/bridge/work', headers, body })
  assert.deepEqual(worked, [['mod', { chat: 'Board', action: 'next', request: 'cli-board-7-abc' }], ['mod', { chat: 'Board', action: 'next' }]])
})
