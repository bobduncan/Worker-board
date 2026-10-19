// B142: the board starts itself anew on the person's click. A keeper runs the board as its child and starts it
// again when the board asks; the board knows which version it runs and whether its folder holds a newer one; the
// page's note says so. The person, 2026-10-14: "i want the board to show a little notification on top that a new
// version is available and I click it to start it. dont auto refresh." Made-up samples only.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createBoard } from '../server.mjs'
import { START_ANEW, keep } from '../src/keeper.mjs'
import { kindOf, loads, readVersion } from '../src/version.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, '..', 'data')
const PUBLIC = join(HERE, '..', 'public')

// The keeper

/** A made-up board process: the keeper only listens for its messages and its end. */
function fakeBoards() {
  const started = []
  const start = key => {
    const child = Object.assign(new EventEmitter(), { killed: false, kill() { this.killed = true } })
    started.push({ key, child })
    return child
  }
  return { started, start }
}

test('the keeper starts the board anew when it ends asking for that, with the key it had for the chats', () => {
  const { started, start } = fakeBoards()
  const ended = []
  keep({ start, done: code => ended.push(code) })
  assert.deepEqual(started.map(one => one.key), [null])
  started[0].child.emit('message', { key: 'k'.repeat(64) })
  started[0].child.emit('exit', START_ANEW)
  assert.deepEqual(started.map(one => one.key), [null, 'k'.repeat(64)])
  assert.deepEqual(ended, [])
  // A board that ends for another reason ends the keeper with its code: the port was taken, or it was stopped.
  started[1].child.emit('exit', 1)
  assert.deepEqual(ended, [1])
  assert.equal(started.length, 2)
})

test('a board that keeps asking to start anew without getting going makes the keeper give up', () => {
  const { started, start } = fakeBoards()
  const ended = []
  let now = 0
  keep({ start, done: code => ended.push(code), now: () => now, most: 3, withinMs: 60_000 })
  for (let i = 0; i < 3; i += 1) started.at(-1).child.emit('exit', START_ANEW)
  assert.deepEqual([started.length, ended], [4, []])
  started.at(-1).child.emit('exit', START_ANEW)
  assert.deepEqual([started.length, ended], [4, [1]])
  // Spread over more than a minute, new starts are fine.
  const slow = fakeBoards()
  const slowEnded = []
  keep({ start: slow.start, done: code => slowEnded.push(code), now: () => now, most: 3, withinMs: 60_000 })
  for (let i = 0; i < 6; i += 1) {
    now += 30_000
    slow.started.at(-1).child.emit('exit', START_ANEW)
  }
  assert.deepEqual([slow.started.length, slowEnded], [7, []])
})

test('stopping the keeper stops the board it runs', () => {
  const { started, start } = fakeBoards()
  const keeper = keep({ start, done: () => {} })
  keeper.stop()
  assert.equal(started[0].child.killed, true)
})

// The version

test('a change under public is the page\'s, the server\'s own files are the server\'s, the rest is neither', () => {
  for (const path of ['public/board.js', 'public/index.html', 'public/board.css']) assert.equal(kindOf(path), 'page', path)
  for (const path of ['server.mjs', 'run-game.mjs', 'src/state.mjs', 'src/deep/x.mjs', 'config.json']) assert.equal(kindOf(path), 'server', path)
  for (const path of ['README.md', 'DESIGN.md', 'test/x.test.mjs', 'fixtures/demo.mjs', 'design/a.webp', '']) assert.equal(kindOf(path), null, path)
})

/** git as the board asks it, answered from a made-up history: `changed` are the files between the two commits. */
const fakeGit = ({ head = 'b189217', page = 'a1b2c3d', changed = [] } = {}) => async args => {
  const said = args.join(' ')
  if (said.endsWith('rev-parse --short HEAD')) return `${head}\n`
  if (said.includes('log -1 --format=%h HEAD -- public')) return `${page}\n`
  if (said.includes(' diff --name-only ')) return changed.map(name => `${name}\n`).join('')
  return null
}

test('the board reads which version its folder holds, and whether its server is newer than the one it runs', async () => {
  assert.deepEqual(await readVersion(fakeGit(), 'C:/board', 'b189217'), { head: 'b189217', page: 'a1b2c3d', isServerNewer: false })
  assert.deepEqual(await readVersion(fakeGit({ changed: ['public/board.js', 'README.md'] }), 'C:/board', '5fb7da8'), { head: 'b189217', page: 'a1b2c3d', isServerNewer: false })
  assert.deepEqual(await readVersion(fakeGit({ changed: ['README.md', 'src/say.mjs'] }), 'C:/board', '5fb7da8'), { head: 'b189217', page: 'a1b2c3d', isServerNewer: true })
  // Without git's answer nothing is said to be newer.
  assert.deepEqual(await readVersion(async () => null, 'C:/board', '5fb7da8'), { head: null, page: null, isServerNewer: false })
  assert.equal((await readVersion(fakeGit({ changed: ['src/say.mjs'] }), 'C:/board', null)).isServerNewer, false)
})

test('before the board ends for a new version, that version is loaded once: one that does not load is refused', async t => {
  await mkdir(DATA, { recursive: true })
  const dir = await mkdtemp(join(DATA, 'test-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeFile(join(dir, 'good.mjs'), 'export const fine = 1\n')
  await writeFile(join(dir, 'broken.mjs'), 'export const = \n')
  await writeFile(join(dir, 'missing.mjs'), "import { nothing } from './nowhere.mjs'\n")
  assert.deepEqual(await loads(join(dir, 'good.mjs')), { ok: true, why: null })
  for (const name of ['broken.mjs', 'missing.mjs']) {
    const answer = await loads(join(dir, name))
    assert.equal(answer.ok, false, name)
    assert.ok(answer.why.length > 0 && answer.why.length <= 200 && !answer.why.includes('\n'), answer.why)
  }
})

// The route

const TOKEN = 'a'.repeat(64)

async function board(t, restart) {
  const server = createBoard({ token: TOKEN, getState: async () => ({}), say: async () => ({ ok: false, status: 400, why: 'x' }), restart, pageVersion: async () => 'a1b2c3d' })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const self = `127.0.0.1:${server.address().port}`
  const ask = ({ method = 'GET', path, headers = {}, body = null }) => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, method, path, headers: { Host: self, ...headers } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => done({ status: res.statusCode, text }))
    })
    req.on('error', fail)
    req.end(body ?? undefined)
  })
  const good = { 'X-Board-Token': TOKEN, Origin: `http://${self}`, 'Content-Type': 'application/json' }
  return { ask, good }
}

test('the board is started anew only from its own page, and ends only after its answer went out', async t => {
  const calls = []
  const ended = []
  const { ask, good } = await board(t, async body => {
    calls.push(body)
    return { ok: true, result: { at: 5 }, after: () => ended.push('ended') }
  })
  const anew = headers => ask({ method: 'POST', path: '/api/restart', headers, body: '{}' })
  assert.equal((await anew({ ...good, 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  assert.equal((await anew({ ...good, Origin: 'http://evil.example' })).status, 403)
  assert.equal((await anew({ ...good, 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await ask({ path: '/api/restart', headers: good })).status, 405)
  assert.deepEqual([calls.length, ended.length], [0, 0])
  const answer = await anew(good)
  assert.deepEqual([answer.status, JSON.parse(answer.text)], [200, { at: 5 }])
  assert.deepEqual([calls, ended], [[{}], ['ended']])
})

test('a board that cannot start anew says why, and nothing ends', async t => {
  const { ask, good } = await board(t, async () => ({ ok: false, status: 409, why: 'This board was started without its keeper.' }))
  const answer = await ask({ method: 'POST', path: '/api/restart', headers: good, body: '{}' })
  assert.deepEqual([answer.status, answer.text.includes('without its keeper')], [409, true])
})

test('the page is served with the version of the page it is', async t => {
  const { ask } = await board(t, async () => ({ ok: false, status: 404, why: 'x' }))
  const page = await ask({ path: '/' })
  assert.match(page.text, /<meta name="board-page" content="a1b2c3d">/)
})

// The note on the page

const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('update')}\nObject.assign(this, { clock, updateView, versionLine })`, page)
const plain = value => JSON.parse(JSON.stringify(value))
const version = more => ({ commit: '5fb7da8', since: new Date(2026, 9, 14, 9, 31).getTime(), head: '5fb7da8', page: 'a1b2c3d', isServerNewer: false, canRestart: true, ...more })

test('the note says a new version is there and that a click starts it; nothing new, no note', () => {
  const view = (more, loaded = 'a1b2c3d', now = {}) => plain(page.updateView(version(more), loaded, now))
  assert.equal(page.updateView(version(), 'a1b2c3d'), null)
  assert.equal(page.updateView(undefined, 'a1b2c3d'), null)
  assert.deepEqual(view({ head: 'b189217', isServerNewer: true }), { text: 'A new version of the board is available. Click to start it.', action: 'restart', tone: 'new' })
  // Only the page is newer: a click loads it, the board goes on as it is.
  assert.deepEqual(view({ head: 'b189217', page: 'c0ffee1' }), { text: 'A new version of the page is available. Click to load it.', action: 'reload', tone: 'new' })
  // A page served without its version knows nothing to compare.
  assert.equal(page.updateView(version({ page: 'c0ffee1' }), ''), null)
  assert.deepEqual(view({ isServerNewer: true, canRestart: false }), { text: 'A new version of the board is available. This board cannot start itself anew: start it once from where it was started.', action: null, tone: 'new' })
  assert.deepEqual(view({ isServerNewer: true }, 'a1b2c3d', { isStarting: true }), { text: 'Starting the new version of the board…', action: null, tone: 'busy' })
  assert.deepEqual(view({ isServerNewer: true }, 'a1b2c3d', { problem: 'Not started: The new version does not start: SyntaxError.' }), { text: 'Not started: The new version does not start: SyntaxError. Click to try again.', action: 'restart', tone: 'problem' })
})

test('the top bar says which version of the board runs, and since when', () => {
  assert.equal(page.versionLine(version()), 'Board 5fb7da8 · since 09:31')
  assert.equal(page.versionLine(version({ commit: null })), '')
  assert.equal(page.versionLine(undefined), '')
})

test('the note sits on top of the page in the yellow of "waiting for you", and the page knows its own version', () => {
  assert.ok(html.indexOf('id="update-note"') > html.indexOf('<body>') && html.indexOf('id="update-note"') < html.indexOf('<nav'))
  assert.match(html, /<meta name="board-page" content="\{\{page\}\}">/)
  assert.match(html, /id="version"/)
  assert.match(style, /\.update-note \{[^}]*background: var\(--waiting\)/)
})
