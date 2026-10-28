// B760 (the result check of B736, X73, X87, X89): on 2026-10-27 a whole read of the board took up to 2 s, and every chat's
// ping and the supervisor's work health waited for one, so no report was kept for minutes and health timed out twice.
// Through the server's own pass: a copy of the board whose every whole read takes 5 s (WORKER_BOARD_READ_DELAY_MS) still
// keeps a chat's report and answers work health within 2 s while a read is under way, and counts the work calls it
// answered after the chat's mod gave up (the rule board-slow). A copy of the board on a made-up project in a temporary
// folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MIN = 60_000
/** Every whole read of the copy takes this long; what must not wait for one answers well within it. */
const READ_MS = 5_000
const QUICK_MS = 2_000
const pause = ms => new Promise(done => setTimeout(done, ms))

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(started, board, env) {
  // B570: the copy reads no Workers mod installed on this PC (an empty Claude folder beside it).
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

/** What `call` answered and how long it took. */
async function timed(call) {
  const from = Date.now()
  const answered = await call()
  return { answered, ms: Date.now() - from }
}

test('a whole read of 5 s: a chat\'s report is kept and work health answers within 2 s while one is under way; late work calls are counted', { timeout: 400_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-slow-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Garden - ","main":"Lead","supervisor":"Watcher"}')
  const NAMES = { Lead: 'lead-id', Digger: 'digger-id', Watcher: 'watcher-id' }
  for (const [name, id] of Object.entries(NAMES)) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role: name === 'Lead' ? 'main' : 'worker', state: 'waiting', task: null, at: NOW - 5 * MIN }))
    await put(join(app, 'a', 'b', `local_${id}.json`), JSON.stringify({ title: `Garden - ${name}`, sessionId: `local_${id}`, cliSessionId: id, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW - MIN }))
    await put(join(transcripts, `${id}.jsonl`), `${[typed(NOW - 9 * MIN, 'Go on.'), answer(NOW - 8 * MIN, 'On it.')].join('\n')}\n`)
  }
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Garden\n- [ ] B730 Something else (about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'slow', project, port, gamePort: 7370, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_READ_DELAY_MS: String(READ_MS) })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const base = `http://127.0.0.1:${port}`
  // A work call's request id comes in its header, as the Workers mod sends it (`<session>-<sent at>-<count>`).
  const bridge = (path, body, request) => fetch(`${base}/api/bridge/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.21.0', ...(request === undefined ? {} : { 'X-Work-Request': request }) },
    body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  let seq = 0
  const report = (name, state) => bridge('report', { chat: name, session: NAMES[name], report: { state, since: Date.now(), background: false, run: 1, seq: ++seq } })
  const work = (name, body, request) => bridge('work', { chat: name, session: NAMES[name], ...body }, request)

  // The board knows the chats (its first reads are slow too).
  await until(async () => (await report('Digger', 'busy')).status === 200 && (await report('Lead', 'busy')).status === 200 && (await report('Watcher', 'busy')).status === 200, 'every chat\'s report kept')
  // The supervisor's health once, so the store and the state the board has are there.
  await until(async () => /^The board's health/.test((await work('Watcher', { action: 'health' })).body?.text ?? ''), 'work health answers')

  // The lead's turn ends: the board reads anew at once (a whole read of 5 s starts).
  assert.equal((await report('Lead', 'idle')).status, 200)
  // While it runs: a worker's report is kept from the state the board has.
  const kept = await timed(() => report('Digger', 'busy'))
  assert.equal(kept.answered.status, 200, JSON.stringify(kept.answered.body))
  assert.ok(kept.ms < QUICK_MS, `a report waited ${kept.ms} ms for a whole read`)
  // And the supervisor's work health answers from what the board has: the state, the store, and its own check of the call.
  assert.equal((await report('Lead', 'busy')).status, 200)
  assert.equal((await report('Lead', 'idle')).status, 200)
  const health = await timed(() => work('Watcher', { action: 'health' }))
  assert.match(health.answered.body?.text ?? JSON.stringify(health.answered.body), /^The board's health/)
  assert.ok(health.ms < QUICK_MS, `work health waited ${health.ms} ms for a whole read`)

  // Two work calls answered after their mods gave up (sent 15 s and 20 s before): the board counts both, and board-slow
  // finds them as one.
  await work('Digger', { action: 'next' }, `digger-id-${Date.now() - 15_000}-1`)
  await work('Lead', { action: 'next' }, `lead-id-${Date.now() - 20_000}-2`)
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  let state = null
  await until(async () => {
    state = await fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
    return (state.lateCalls ?? []).length >= 2
  }, 'the late work calls in the board\'s state')
  const rule = WATCH_RULES.find(one => one.id === 'board-slow')
  const found = rule.check(buildView({ state, items: new Map(), now: Date.now() }), { seen: new Map(), observed: [] })
  assert.deepEqual(found.map(one => one.key), ['board-slow board'])
})
