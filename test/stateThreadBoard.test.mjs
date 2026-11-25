// B1535 (X93, chat 1's way A): the live cases of 2026-11-25 through the server's own pass. At 19:50 Worker 2's turn-ended took
// 28 s, 26 s of it in its hand-over's decide (a whole rebuild); at 19:55 the main chat's next took 49 s, 39 s of it before the
// board's handler even began, as the loop was held by a build. A copy of the board whose every build holds its thread 6 s
// (WORKER_BOARD_BUILD_BLOCK_MS): while one runs, other chats' calls are taken and answered within 1 s from the kept state, a
// call that needs a fresh state (the decide, a next after a write) awaits the build without holding anyone, and the call trace
// shows the loop free. A copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
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
/** Every build of the copy holds its thread this long (the 19:50 decide waited 26 s on a full PC). */
const BUILD_MS = 6_000
/** What must not wait for a build is answered within this. */
const QUICK_MS = 1_000
const MOD = '0.33.0'
const pause = ms => new Promise(done => setTimeout(done, ms))

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(started, board, env) {
  const claude = join(dirname(board), 'claude-config')
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, CLAUDE_CONFIG_DIR: claude, ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
  started.push(child)
  return new Promise((done, fail) => {
    let out = ''
    const late = setTimeout(() => fail(new Error(`The board did not start: ${out}`)), 90_000)
    const read = chunk => {
      out += chunk
      if (!/Worker board: http:\/\/127\.0\.0\.1:\d+\//.test(out)) return
      clearTimeout(late)
      done(child)
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

async function until(check, what) {
  for (const end = Date.now() + 120_000; Date.now() < end;) {
    if (await check()) return
    await pause(200)
  }
  throw new Error(`Not within 120 s: ${what}`)
}

async function timed(call) {
  const from = Date.now()
  const answered = await call()
  return { answered, ms: Date.now() - from }
}

/** A copy of the board on a made-up project with three chats, started with `env`; its work and report calls. */
async function boardWith(t, env) {
  const dir = await mkdtemp(join(tmpdir(), 'board-thread-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Garden - ","main":"Lead"}')
  const NAMES = { Lead: 'lead-id', Digger: 'digger-id', Delver: 'delver-id' }
  for (const [name, id] of Object.entries(NAMES)) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role: name === 'Lead' ? 'main' : 'worker', state: 'waiting', task: null, at: NOW - 5 * MIN }))
    await put(join(app, 'a', 'b', `local_${id}.json`), JSON.stringify({ title: `Garden - ${name}`, sessionId: `local_${id}`, cliSessionId: id, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW - MIN }))
    await put(join(transcripts, `${id}.jsonl`), `${[typed(NOW - 9 * MIN, 'Go on.'), answer(NOW - 8 * MIN, 'On it.')].join('\n')}\n`)
  }
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Garden\n- [ ] B730 Something else (about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'thread', project, port, gamePort: 7371, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), handover: 'sequence' }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), ...env })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const base = `http://127.0.0.1:${port}`
  let count = 0
  const requestOf = name => `${NAMES[name]}-${Date.now()}-${++count}`
  // A connection of its own per call (no kept-alive socket the board may close while its loop is held: a reset, not an answer).
  const bridge = (path, body, request = null) => new Promise((done, fail) => {
    const text = JSON.stringify(body)
    const sent = httpRequest(`${base}/api/bridge/${path}`, {
      method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'X-Board-Key': key, 'X-Workers-Mod': MOD, ...(request === null ? {} : { 'X-Work-Request': request }) },
    }, reply => {
      let got = ''
      reply.setEncoding('utf8')
      reply.on('data', chunk => { got += chunk })
      reply.on('end', () => {
        let parsed = got
        try {
          parsed = JSON.parse(got)
        } catch {
          // a refusal's words
        }
        done({ status: reply.statusCode, body: parsed })
      })
    })
    sent.on('error', fail)
    sent.end(text)
  })
  let seq = 0
  const report = (name, state) => bridge('report', { chat: name, session: NAMES[name], report: { state, since: Date.now(), background: false, run: 1, seq: ++seq } })
  const work = (name, body, request = requestOf(name)) => ({ request, done: bridge('work', { chat: name, session: NAMES[name], ...body }, request) })

  await until(async () => (await report('Digger', 'busy')).status === 200 && (await report('Delver', 'busy')).status === 200 && (await report('Lead', 'busy')).status === 200, 'every chat\'s report kept')
  await until(async () => (await work('Delver', { action: 'pause-state' }).done).status === 200, 'the board answers work calls')
  return { board, work, report }
}

test('the 19:50 and 19:55 cases: while a build of 6 s runs in its thread, other calls are answered within 1 s and the loop stays free', { timeout: 400_000 }, async t => {
  const { board, work } = await boardWith(t, { WORKER_BOARD_BUILD_BLOCK_MS: String(BUILD_MS) })

  // 19:50: Digger's turn ends; its hand-over's decide reads the state anew, a build of 6 s.
  const turnFrom = Date.now()
  const turn = work('Digger', { action: 'turn-ended', since: Date.now() - MIN })
  await pause(1_500)
  // Meanwhile: Delver's note and the Lead's pause-state are answered from the kept state, each within 1 s.
  const note = work('Delver', { action: 'note', to: 'main', text: 'a note while the board builds' })
  const noted = await timed(() => note.done)
  assert.equal(noted.answered.status, 200, JSON.stringify(noted.answered.body))
  assert.ok(noted.ms < QUICK_MS, `a work note waited ${noted.ms} ms while a build ran`)
  const asked = await timed(() => work('Lead', { action: 'pause-state' }).done)
  assert.equal(asked.answered.status, 200, JSON.stringify(asked.answered.body))
  assert.ok(asked.ms < QUICK_MS, `pause-state waited ${asked.ms} ms while a build ran`)
  // The turn end itself waited for its build (it needs the fresh state), without holding the others.
  const ended = await turn.done
  const turnMs = Date.now() - turnFrom
  assert.equal(ended.status, 200, JSON.stringify(ended.body))
  assert.ok(turnMs >= BUILD_MS - 500, `the turn end did not wait for its build (${turnMs} ms)`)

  // 19:55: a next sent while a build runs is taken at once (before, 39 s passed before the handler began); it may await the build.
  const busyTurn = work('Delver', { action: 'turn-ended', since: Date.now() - MIN })
  await pause(1_500)
  const next = work('Lead', { action: 'next' })
  const nexted = await next.done
  assert.equal(nexted.status, 200, JSON.stringify(nexted.body))
  await busyTurn.done

  // The trace (data/call-trace.jsonl): the note and the next were taken within 1 s of their send, the loop never held over 1 s
  // while they ran, and the build ran in its thread.
  let traced = []
  await until(async () => {
    traced = (await readFile(join(board, 'data', 'call-trace.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line))
    return [note.request, next.request].every(request => traced.some(one => one.request === request))
  }, 'the trace of the note and the next')
  for (const request of [note.request, next.request]) {
    const line = traced.find(one => one.request === request)
    assert.ok(line.beforeBoard < QUICK_MS, `${line.action}: taken ${line.beforeBoard} ms after its send: ${JSON.stringify(line)}`)
    assert.ok(line.loopMax < QUICK_MS, `${line.action}: the loop was held ${line.loopMax} ms: ${JSON.stringify(line)}`)
    assert.ok(line.jobs.includes('state build (thread)'), `${line.action}: ${JSON.stringify(line.jobs)}`)
  }
  assert.equal(traced.find(one => one.request === note.request).stateWhy, 'kept')
})

test('chat 1\'s core review: a stuck thread (10 s, its limit 3 s) holds nobody: calls answer from the kept state, the turn end gets a read anew', { timeout: 400_000 }, async t => {
  const STUCK_MS = 10_000
  const { work } = await boardWith(t, { WORKER_BOARD_BUILD_LIMIT_MS: '3000', WORKER_BOARD_THREAD_BLOCK_MS: String(STUCK_MS) })
  // Digger's turn ends: its decide reads anew; the thread's build sticks, is ended at 3 s, and a read anew is made in the loop.
  const turnFrom = Date.now()
  const turn = work('Digger', { action: 'turn-ended', since: Date.now() - MIN })
  await pause(1_500)
  const noted = await timed(() => work('Delver', { action: 'note', to: 'main', text: 'a note while the thread is stuck' }).done)
  assert.equal(noted.answered.status, 200, JSON.stringify(noted.answered.body))
  assert.ok(noted.ms < QUICK_MS, `a work note waited ${noted.ms} ms while the thread was stuck`)
  const ended = await turn.done
  const turnMs = Date.now() - turnFrom
  assert.equal(ended.status, 200, JSON.stringify(ended.body))
  assert.ok(turnMs < STUCK_MS - 2_000, `the turn end waited ${turnMs} ms for a stuck thread`)
})
