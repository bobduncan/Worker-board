// B488: one board process per project runs the loops. Two board processes (two ports) on one project copy: the lines the
// loops send (a step's line to its chat, the board's asks) go out once, not twice, and when the process that holds the
// lock ends, the other takes over within a run, without sending again what was sent. A copy of the board on a made-up
// project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, readdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { createBoard } from '../server.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MIN = 60_000

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

/** Starts a board process (on `port` when given) and answers once it listens. */
function run(started, board, env, port) {
  const child = spawn(process.execPath, [join(board, 'server.mjs'), ...(port === undefined ? [] : ['--port', String(port)])], { cwd: board, env: { ...process.env, ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
  started.push(child)
  return new Promise((done, fail) => {
    let out = ''
    const late = setTimeout(() => fail(new Error(`The board did not start: ${out}`)), 90_000)
    const read = chunk => {
      out += chunk
      if (!/Worker board: http:\/\/127\.0\.0\.1:\d+\//.test(out)) return
      clearTimeout(late)
      done({ child, out: () => out })
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('exit', code => {
      clearTimeout(late)
      fail(new Error(`The board ended (${code}): ${out}`))
    })
  })
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const gone = new Promise(done => child.once('exit', done))
  child.kill('SIGKILL')
  await gone
}

const wait = ms => new Promise(done => setTimeout(done, ms))

async function until(check, what, within = 40_000) {
  for (const end = Date.now() + within; Date.now() < end;) {
    if (await check()) return
    await wait(100)
  }
  throw new Error(`Not within ${within / 1000} s: ${what}`)
}

const readLines = async file => (await readFile(file, 'utf8').catch(() => '')).split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line))

/** One POST of the board's own page to `server` (on `port`): its status and words. */
function post(port, path, body, headers = {}) {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path, headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json', ...headers } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => done({ status: res.statusCode, text }))
    })
    req.on('error', fail)
    req.end(JSON.stringify(body))
  })
}

test('B529: a board process without the loops refuses the page\'s writes and names the holder; its own things it still does', async () => {
  const TOKEN = 'c'.repeat(64)
  let why = 'Another board process of this project runs the loops: do this on its page, http://127.0.0.1:4310/.'
  const did = []
  const answer = name => async () => { did.push(name); return { ok: true, result: {} } }
  const server = createBoard({
    token: TOKEN, getState: async () => ({}), say: async () => { did.push('say'); return { ok: true, message: {} } },
    work: answer('work'), backlog: answer('backlog'), goals: answer('goals'), brainstorm: answer('brainstorm'), design: answer('design'),
    settings: answer('settings'), game: answer('game'), cpu: answer('cpu'), talkPicture: answer('talk picture'),
    mayWrite: async () => why,
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  try {
    const { port } = server.address()
    const headers = { 'X-Board-Token': TOKEN }
    for (const path of ['/api/say', '/api/work', '/api/backlog', '/api/goals', '/api/brainstorm', '/api/design', '/api/settings']) {
      const sent = await post(port, path, { to: 'Game - Main', text: 'Hello' }, headers)
      assert.equal(sent.status, 409, path)
      assert.match(sent.text, /http:\/\/127\.0\.0\.1:4310\//, path)
    }
    const picture = await new Promise((done, fail) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/talk/picture', headers: { ...headers, Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'image/png' } }, res => { res.resume(); res.on('end', () => done(res.statusCode)) })
      req.on('error', fail)
      req.end(Buffer.from([1, 2, 3]))
    })
    assert.equal(picture, 409)
    // A game and the CPU level are this process's own.
    assert.equal((await post(port, '/api/game', { branch: 'main' }, headers)).status, 200)
    assert.equal((await post(port, '/api/cpu', { level: 'off' }, headers)).status, 200)
    assert.deepEqual(did, ['game', 'cpu'])
    // Once it holds the lock, the page's words are taken.
    why = null
    assert.equal((await post(port, '/api/say', { to: 'Game - Main', text: 'Hello' }, headers)).status, 200)
    assert.deepEqual(did, ['game', 'cpu', 'say'])
  } finally {
    await new Promise(done => server.close(done))
  }
})

test('two board processes on one project: each line goes out once, and the other takes over when the holder ends', { timeout: 360_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-loops-'))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const [board, project, app, transcripts] = ['board', 'project', 'app', 'transcripts'].map(name => join(dir, name))
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  const put = async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const chats = join(project, '.claude', 'chats')
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main"}')
  const card = (name, role) => put(join(chats, `${name.toLowerCase()}-id.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW }))
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  for (const [name, role] of [['Main', 'main'], ['Advisor', 'worker'], ['Units', 'worker'], ['Maps', 'worker']]) {
    await card(name, role)
    await put(join(app, 'a', 'b', `local_${name.toLowerCase()}.json`), appChat(name, `${name.toLowerCase()}-id`))
    await put(join(transcripts, `${name.toLowerCase()}-id.jsonl`), `${[typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n')}\n`)
  }
  // The clock's morning round is due at both processes' first look. The board began refining when B13 was the highest
  // step, queued then; B14 was queued since without being refined, so the first look asks the Advisor to refine it.
  await put(join(board, 'data', 'rounds.json'), JSON.stringify({ morning: NOW - 48 * 60 * MIN, weekly: NOW - 48 * 60 * MIN, nextWeekly: null, skipped: null }))
  await put(join(board, 'data', 'refine-gate.json'), JSON.stringify({ since: 13, queuedBefore: ['B13'], waiting: [] }))
  // B529: a chat log the journal names whose transcript is gone: given up once, by the holder only.
  const logs = join(project, '.claude', 'chat-logs', 'Units')
  const journal = join(board, 'data', 'chat-logs.json')
  const job = (id, session) => ({ id, chat: 'Units', session, step: 'B9', at: NOW, state: 'copy', source: join(transcripts, `${session}.jsonl`), jsonl: join(logs, `${id}.jsonl`), txt: join(logs, `${id}.txt`), log: `.claude/chat-logs/Units/${id}.txt` })
  await put(journal, JSON.stringify({ jobs: [job('gone', 'gone-id')], left: [] }))
  const store = join(project, '.claude', 'work')
  const FOR = { B13: 'Units', B14: 'Maps', B15: 'Units' }
  const steps = (ids, refined = [], done = []) => migrateBacklog(`## Art\n${ids.map(id => `- [${done.includes(id) ? 'x' : ' '}] ${id} Draw the shield (for ${FOR[id]}; about 1 h)\n${refined.includes(id) ? '  Refined (2026-10-24 09:00; ready):\n  Summary: A shield.\n' : ''}`).join('')}`, { now: NOW })
  await writeStore(store, steps(['B13', 'B14']), undefined, { now: NOW })
  const [one, two] = [await freePort(), await freePort()]
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'loops', project, port: one, refreshSeconds: 5, morningRound: '00:00', weeklyRound: false, gamePort: 7300, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const env = { WORKER_BOARD_HOME: join(dir, 'pc') }
  const outbox = join(board, 'data', 'outbox.jsonl')
  const lock = join(project, '.claude', 'sync-loop.json')
  const sent = async what => (await readLines(outbox)).filter(message => what(message))
  const isRound = message => message.command === 'round'
  const isLineOf = id => message => typeof message.text === 'string' && message.text.includes(`${id} is yours`)
  const isRefineOf = id => message => message.command === 'refine' && message.about === id
  const isNoticeOf = id => message => message.command === 'refined' && message.about === id
  /** Every word the board sent but its wakes (one may follow another after two minutes), sent more than once. */
  const twice = async () => {
    const seen = new Map()
    for (const message of await sent(one => one.command !== 'start')) {
      const key = JSON.stringify([message.to, message.command ?? null, message.about ?? null, message.text ?? null])
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    return [...seen].filter(([, count]) => count > 1).map(([key]) => key)
  }

  // Both start at once, so both meet an empty lock and a due round.
  const [first, second] = await Promise.all([run(started, board, env, one), run(started, board, env, two)])
  await until(async () => (await sent(isRound)).length > 0 && (await sent(isLineOf('B13'))).length > 0 && (await sent(isRefineOf('B14'))).length > 0, 'the round, the line of B13 and the refine of B14')
  const holder = JSON.parse(await readFile(lock, 'utf8'))
  const [mine, other] = holder.pid === first.child.pid ? [first, second] : [second, first]
  const otherPort = other === first ? one : two
  assert.equal(holder.pid, mine.child.pid)
  assert.match(other.out(), /Another board process of this project runs the loops/)
  // Everything the loops do has had its turns in both processes by now (the reconciler's refresh is 5 s).
  await wait(14_000)
  assert.equal((await sent(isRound)).length, 1, 'the round went out once')
  assert.equal((await sent(isLineOf('B13'))).length, 1, 'the line of B13 went out once')
  assert.equal((await sent(isRefineOf('B14'))).length, 1, 'the refine of B14 went out once')
  assert.equal(JSON.parse(await readFile(lock, 'utf8')).pid, mine.child.pid, 'the holder still holds the lock')
  assert.equal(JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8')).url, `http://127.0.0.1:${holder.port}`, 'the chats find the holder')
  // B529: only the holder finished the journal's open log (here: gave it up); the other's page takes no word, and names
  // the holder's.
  assert.match(mine.out(), /A chat log was given up: \.claude\/chat-logs\/Units\/gone\.txt/)
  assert.doesNotMatch(other.out(), /A chat log was given up/)
  const page = await fetch(`http://127.0.0.1:${otherPort}/`).then(res => res.text())
  const token = page.match(/name="board-token" content="([0-9a-f]{64})"/)?.[1]
  assert.ok(token, 'the page holds its token')
  const said = await post(otherPort, '/api/say', { to: 'Main', text: 'Hello' }, { 'X-Board-Token': token })
  assert.equal(said.status, 409)
  assert.match(said.text, new RegExp(`http://127\\.0\\.0\\.1:${holder.port}/`))
  assert.deepEqual(await twice(), [], 'nothing went out twice')

  // The holder put a chat log in the journal and ended without a word before it was written; meanwhile B14 was refined
  // and B13 done, B15 queued for the same chat. The other takes the lock within a run, tells the chats where it is, finishes the log, and from its
  // own first look on sends the next step's line, its refine and the notice of B14 once, and nothing the holder sent.
  await put(join(transcripts, 'left-id.jsonl'), `${[typed(NOW - 9 * MIN, 'Draw it.'), answer(NOW - 8 * MIN, 'The shield is in.')].join('\n')}\n`)
  await put(journal, JSON.stringify({ jobs: [job('left', 'left-id')], left: [{ session: 'left-id', chat: 'Units', at: NOW }] }))
  await stop(mine.child)
  const endedAt = Date.now()
  await writeStore(store, steps(['B13', 'B14', 'B15'], ['B14'], ['B13']), undefined, { now: NOW })
  await until(async () => (await sent(isLineOf('B15'))).length > 0, 'the line of B15, sent by the process that took over', 20_000)
  assert.equal(JSON.parse(await readFile(lock, 'utf8')).pid, other.child.pid, 'the other holds the lock')
  const note = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  assert.equal(note.url, `http://127.0.0.1:${otherPort}`, 'the chats find the one that took over')
  // The Workers mod finds it there and asks it (this one has had no mod asking it since its start, a minute ago).
  const asked = await fetch(`${note.url}/api/bridge/take`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': note.key }, body: JSON.stringify({ chat: 'Game - Maps', session: 'maps-id' }) })
  assert.equal(asked.status, 200, await asked.text())
  await until(async () => stat(join(logs, 'left.txt')).then(() => true, () => false), 'the log the holder left, finished by the one that took over')
  assert.match(await readFile(join(logs, 'left.txt'), 'utf8'), /The shield is in\./)
  // Its own first look (once a minute): it writes when it last ran.
  await until(async () => JSON.parse(await readFile(join(board, 'data', 'alive.json'), 'utf8').catch(() => '{}')).at > endedAt, 'the first look of the one that took over', 75_000)
  await until(async () => (await sent(isRefineOf('B15'))).length > 0 && (await sent(isNoticeOf('B14'))).length > 0, 'the refine of B15 and the notice of B14', 10_000)
  await wait(8_000)
  assert.equal((await sent(isLineOf('B15'))).length, 1, 'the line of B15 went out once')
  assert.equal((await sent(isLineOf('B14'))).length, 1, 'the line of B14 was not sent again')
  assert.equal((await sent(isLineOf('B13'))).length, 1, 'the line of B13 was not sent again')
  assert.equal((await sent(isRound)).length, 1, 'the round was not sent again')
  assert.equal((await sent(isRefineOf('B14'))).length, 1, 'the refine of B14 was not sent again')
  assert.equal((await sent(isRefineOf('B15'))).length, 1, 'the refine of B15 went out once')
  assert.equal((await sent(isNoticeOf('B14'))).length, 1, 'the notice of B14 went out once')
  assert.deepEqual(await twice(), [], 'nothing went out twice')
  assert.deepEqual(JSON.parse(await readFile(journal, 'utf8')).jobs, [], 'the journal names no open log')
})
