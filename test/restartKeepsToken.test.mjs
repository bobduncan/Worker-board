// Signals change 5 (2026-11-02, B913): a board restart never costs the person anything. On 2026-11-01 the board restarted
// eight times for landings, and each time the page reloaded on the board's new token and the recap popup's text was lost.
// Here a copy of the board runs under its own keeper, as the Run pane starts it: a restart for a new version keeps the
// page's token, so the open page is answered 200 all the way through and has nothing to reload; and a second process on
// the board's port ends before it opens the board's files (it took data/stop.json and wrote a gap line until now). A copy of
// the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const MIN = 60_000

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

/** The env of a cold start: nothing kept from a board before (a test run by a board's own chat must not look like a child). */
function coldEnv(board) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(dirname(board), 'claude-config'), WORKER_BOARD_HOME: join(dirname(board), 'pc') }
  for (const name of ['WORKER_BOARD_CHILD', 'WORKER_BOARD_KEY', 'WORKER_BOARD_TOKEN']) delete env[name]
  return env
}

/** Runs `node server.mjs` as a command does: `child` true runs the board itself (as its keeper does), else its keeper. */
function launch(started, board, { args = [], child = false } = {}) {
  const env = coldEnv(board)
  if (child) env.WORKER_BOARD_CHILD = '1'
  const process_ = spawn(process.execPath, [join(board, 'server.mjs'), ...args], { cwd: board, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  started.push(process_)
  const run = { process: process_, out: '' }
  const read = chunk => { run.out += chunk }
  process_.stdout.on('data', read)
  process_.stderr.on('data', read)
  run.ended = new Promise(done => process_.once('exit', code => done(code)))
  run.listening = new Promise((done, fail) => {
    const late = setTimeout(() => fail(new Error(`The board did not start: ${run.out}`)), 90_000)
    const look = () => {
      if (!/Worker board: http:\/\/127\.0\.0\.1:\d+\//.test(run.out)) return
      clearTimeout(late)
      done(run)
    }
    process_.stdout.on('data', look)
    process_.stderr.on('data', look)
    run.ended.then(code => {
      clearTimeout(late)
      fail(new Error(`The board ended (${code}): ${run.out}`))
    })
  })
  run.listening.catch(() => {})
  return run
}

/** Ends what was started; the keeper's board ends with it (its channel closes). */
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const gone = new Promise(done => child.once('exit', done))
  child.kill('SIGKILL')
  await gone
}

async function boardCopy(dir, port) {
  const [board, project, app, transcripts] = ['board', 'project', 'app', 'transcripts'].map(name => join(dir, name))
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  await mkdir(join(project, '.claude', 'chats'), { recursive: true })
  await writeFile(join(project, '.claude', 'chats', 'list.json'), '{"prefix":"Studio · ","main":"Lead"}')
  await writeFile(join(board, 'config.json'), JSON.stringify({
    name: 'orchard', refreshSeconds: 2, project, port, gamePort: 7462, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'),
  }))
  // The board before this one ran 30 minutes ago: the first start writes a gap line, with how it was started.
  const before = Date.now() - 30 * MIN
  await mkdir(join(board, 'data'), { recursive: true })
  await writeFile(join(board, 'data', 'history.jsonl'), `${JSON.stringify({ at: before, chat: 'Lead', state: 'free', task: null })}\n`)
  await writeFile(join(board, 'data', 'alive.json'), JSON.stringify({ at: before }))
  return board
}

test('a board its keeper starts anew keeps the page\'s token: the open page is answered 200 all the way, and has nothing to reload', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-token-'))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  const port = await freePort()
  const board = await boardCopy(dir, port)
  const base = `http://127.0.0.1:${port}`

  const keeper = launch(started, board)
  await keeper.listening
  const pageToken = async () => /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  const token = await pageToken()
  assert.ok(token, 'the served page carries the token')
  const ask = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token }, signal: AbortSignal.timeout(5_000) })
  const first = await (await ask()).json()
  assert.match(await readFile(join(board, 'data', 'history.jsonl'), 'utf8'), /"gap":true,"why":"unknown","start":"hand"/, 'a cold start: started by hand')
  assert.equal(first.board.lastStop.start, 'hand')

  // The page's click: the board ends with the restart code and its keeper starts the next one.
  const restarted = await fetch(`${base}/api/restart`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: '{}' })
  assert.equal(restarted.status, 200)
  const statuses = []
  let next = null
  for (let tries = 0; tries < 600 && next === null; tries += 1) {
    try {
      const answer = await ask()
      statuses.push(answer.status)
      if (answer.status === 200) {
        const state = await answer.json()
        if (state.version.since !== first.version.since) next = state
      } else await answer.text()
    } catch {
      statuses.push('none')
    }
    if (next === null) await new Promise(wait => setTimeout(wait, 200))
  }
  assert.ok(next !== null, `the next board answered the old page: ${[...new Set(statuses)].join(', ')}`)
  assert.equal(statuses.includes(403), false, `the old page's token was never refused: ${[...new Set(statuses)].join(', ')}`)
  assert.equal(await pageToken(), token, 'a page loaded now gets the same token')
  assert.equal(keeper.process.exitCode, null, 'the keeper that was started is still the one that runs')
  // The new board serves before it prints its line (that comes after its loops' first look): give it a moment.
  for (let tries = 0; tries < 100 && !/Worker board: http[\s\S]*Worker board: http/.test(keeper.out); tries += 1) await new Promise(wait => setTimeout(wait, 200))
  assert.match(keeper.out, /Worker board: http[\s\S]*Worker board: http/, 'two boards, one after the other, under one keeper')
})

test('a second process on the board\'s port ends with one line before it opens the board\'s files: no stop record taken, no gap line', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-port-'))
  const started = []
  const holder = createServer((_req, res) => res.end('another program'))
  t.after(async () => {
    await Promise.all(started.map(stop))
    await new Promise(done => holder.close(done))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  const port = await freePort()
  await new Promise(done => holder.listen(port, '127.0.0.1', done))
  const board = await boardCopy(dir, port)
  // The board ended for a restart a minute after its last look, 30 minutes ago; another program holds its port now.
  const record = JSON.stringify({ at: Date.now() - 29 * MIN, why: 'restart' })
  await writeFile(join(board, 'data', 'stop.json'), record)
  const history = await readFile(join(board, 'data', 'history.jsonl'), 'utf8')

  const second = launch(started, board, { args: ['--port', String(port)], child: true })
  assert.equal(await second.ended, 1)
  assert.match(second.out, new RegExp(`Port ${port} is in use: the board may be running already\\. This one ends before it opens its files\\.`))
  assert.equal(existsSync(join(board, 'data', 'stop.json')), true, 'the stop record is left for the board it belongs to')
  assert.equal(await readFile(join(board, 'data', 'stop.json'), 'utf8'), record)
  assert.equal(await readFile(join(board, 'data', 'history.jsonl'), 'utf8'), history, 'no gap line')

  // Started as the Run pane or a chat's mod does: its keeper hears that the board never came up, and is not started again.
  const keeper = launch(started, board, { args: ['--port', String(port)] })
  assert.equal(await keeper.ended, 1)
  assert.match(keeper.out, /The board ended with code 1 before it was up: the keeper does not start it again\./)
  assert.equal([...keeper.out.matchAll(/is in use/g)].length, 1, 'one board was started, once')
  assert.equal(await readFile(join(board, 'data', 'history.jsonl'), 'utf8'), history)
})

// The lead's review (2026-11-02): a start that hangs after it took the port must not hold the port with 503 for ever.

/** A clock whose one timer runs only when the test says so. */
function fakeTimers() {
  const timers = { set: [], cleared: [] }
  return {
    timers,
    setTimer: (run, ms) => { const timer = { run, ms }; timers.set.push(timer); return timer },
    clearTimer: timer => { timers.cleared.push(timer) },
  }
}

test('holdPort: a board that does not serve within START_TIMEOUT_MS (4 minutes) after taking its port ends; one that serves in time does not', async t => {
  const { START_TIMEOUT_MS, holdPort } = await import('../server.mjs')
  assert.equal(START_TIMEOUT_MS, 4 * MIN)
  const hung = fakeTimers()
  let late = 0
  const stuck = await holdPort({ port: 0, host: '127.0.0.1', onLate: () => { late += 1 }, setTimer: hung.setTimer, clearTimer: hung.clearTimer })
  t.after(() => new Promise(done => stuck.server.close(done)))
  assert.equal(hung.timers.set.length, 1)
  assert.equal(hung.timers.set[0].ms, START_TIMEOUT_MS)
  const answer = await fetch(`http://127.0.0.1:${stuck.server.address().port}/api/state`)
  assert.equal(answer.status, 503, 'while it starts it says so')
  assert.match(await answer.text(), /starting/)
  hung.timers.set[0].run()
  assert.equal(late, 1, 'serve never came: the board ends')

  const quick = fakeTimers()
  let quickLate = 0
  const fine = await holdPort({ port: 0, host: '127.0.0.1', onLate: () => { quickLate += 1 }, setTimer: quick.setTimer, clearTimer: quick.clearTimer })
  t.after(() => new Promise(done => fine.server.close(done)))
  fine.serve(createServer((_req, res) => res.end('the board')))
  assert.deepEqual(quick.timers.cleared, [quick.timers.set[0]], 'serve clears the timer')
  quick.timers.set[0].run()
  assert.equal(quickLate, 0, 'a board that serves is never ended by it')
  assert.equal(await fetch(`http://127.0.0.1:${fine.server.address().port}/`).then(reply => reply.text()), 'the board')
})

test('the late start says why in one line and ends with 1, not up, so its keeper does not start it again', async () => {
  const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  const late = server.slice(server.indexOf('function lateStart('), server.indexOf('function lateStart(') + 400)
  assert.match(late, /The board did not come up within \$\{Math\.round\(timeoutMs \/ 60_000\)\} minutes after taking port \$\{port\}: it ends so its keeper and the chats see it off\./)
  assert.match(late, /process\.exit\(1\)/)
})
