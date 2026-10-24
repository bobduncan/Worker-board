// B488: one board process per project runs the loops. Two board processes (two ports) on one project copy: the lines the
// loops send (a step's line to its chat, the board's asks) go out once, not twice, and when the process that holds the
// lock ends, the other takes over within a run, without sending again what was sent. A copy of the board on a made-up
// project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, readdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
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

test('two board processes on one project: each line goes out once, and the other takes over when the holder ends', { timeout: 300_000 }, async t => {
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
  // The clock's morning round is due at both processes' first look; the store has a step queued for Units.
  await put(join(board, 'data', 'rounds.json'), JSON.stringify({ morning: NOW - 48 * 60 * MIN, weekly: NOW - 48 * 60 * MIN, nextWeekly: null, skipped: null }))
  const store = join(project, '.claude', 'work')
  const steps = ids => migrateBacklog(`## Art\n${ids.map(id => `- [ ] ${id} Draw the shield (for ${id === 'B14' ? 'Maps' : 'Units'}; about 1 h)\n`).join('')}`, { now: NOW })
  await writeStore(store, steps(['B13']), undefined, { now: NOW })
  const [one, two] = [await freePort(), await freePort()]
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'loops', project, port: one, refreshSeconds: 5, morningRound: '00:00', weeklyRound: false, gamePort: 7300, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const env = { WORKER_BOARD_HOME: join(dir, 'pc') }
  const outbox = join(board, 'data', 'outbox.jsonl')
  const lock = join(project, '.claude', 'sync-loop.json')
  const sent = async what => (await readLines(outbox)).filter(message => what(message))
  const isRound = message => message.command === 'round'
  const isLineOf = id => message => typeof message.text === 'string' && message.text.includes(`${id} is yours`)

  // Both start at once, so both meet an empty lock and a due round.
  const [first, second] = await Promise.all([run(started, board, env, one), run(started, board, env, two)])
  await until(async () => (await sent(isRound)).length > 0 && (await sent(isLineOf('B13'))).length > 0, 'the round and the line of B13')
  const holder = JSON.parse(await readFile(lock, 'utf8'))
  const [mine, other] = holder.pid === first.child.pid ? [first, second] : [second, first]
  assert.equal(holder.pid, mine.child.pid)
  assert.match(other.out(), /Another board process of this project runs the loops/)
  // Everything the loops do has had its turns in both processes by now (the reconciler's refresh is 5 s).
  await wait(14_000)
  assert.equal((await sent(isRound)).length, 1, 'the round went out once')
  assert.equal((await sent(isLineOf('B13'))).length, 1, 'the line of B13 went out once')
  assert.equal(JSON.parse(await readFile(lock, 'utf8')).pid, mine.child.pid, 'the holder still holds the lock')
  assert.equal(JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8')).url, `http://127.0.0.1:${holder.port}`, 'the chats find the holder')

  // The holder ends without a word: the other takes the lock within a run, tells the chats where it is, and sends the
  // next step's line once, and nothing it knew the holder had sent.
  await stop(mine.child)
  await writeStore(store, steps(['B13', 'B14']), undefined, { now: NOW })
  await until(async () => (await sent(isLineOf('B14'))).length > 0, 'the line of B14, sent by the process that took over', 20_000)
  assert.equal(JSON.parse(await readFile(lock, 'utf8')).pid, other.child.pid, 'the other holds the lock')
  assert.equal(JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8')).url, `http://127.0.0.1:${other.child.pid === first.child.pid ? one : two}`, 'the chats find the one that took over')
  await wait(8_000)
  assert.equal((await sent(isLineOf('B14'))).length, 1, 'the line of B14 went out once')
  assert.equal((await sent(isLineOf('B13'))).length, 1, 'the line of B13 was not sent again')
  assert.equal((await sent(isRound)).length, 1, 'the round was not sent again')
})
