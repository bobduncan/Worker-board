// B934 (X93 on 2026-11-02: the board stalled 6 to 13 s around the workers' hand-overs and nothing named what it did):
// through the server's own pass, a copy of the board whose every state rebuild holds its event loop 2.6 s
// (WORKER_BOARD_READ_BLOCK_MS) writes each such stall to data/stalls.json naming the rebuild, shows it in its state, and
// the rule board-slow cites it. A copy of the board on a made-up project in a temporary folder only.

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
/** Every state rebuild of the copy holds the event loop this long: over the stall log's 2 s. */
const BLOCK_MS = 2_600
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


test('a state rebuild that holds the loop 2.6 s is a stall in data/stalls.json naming the rebuild; board-slow cites it', { timeout: 400_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-stalls-'))
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
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'stalls', project, port, gamePort: 7370, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_READ_BLOCK_MS: String(BLOCK_MS) })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const base = `http://127.0.0.1:${port}`
  const bridge = (path, body, request) => fetch(`${base}/api/bridge/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.21.0', ...(request === undefined ? {} : { 'X-Work-Request': request }) },
    body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  let seq = 0
  const report = (name, state) => bridge('report', { chat: name, session: NAMES[name], report: { state, since: Date.now(), background: false, run: 1, seq: ++seq } })
  const work = (name, body, request) => bridge('work', { chat: name, session: NAMES[name], ...body }, request)
  await until(async () => (await report('Digger', 'busy')).status === 200 && (await report('Lead', 'busy')).status === 200, 'every chat\'s report kept')

  // The lead's turn ends: the board reads anew at once, and the rebuild holds the loop.
  assert.equal((await report('Lead', 'idle')).status, 200)
  const stallsFile = join(board, 'data', 'stalls.json')
  let logged = []
  await until(async () => {
    logged = await readFile(stallsFile, 'utf8').then(text => JSON.parse(text).stalls, () => [])
    return logged.some(one => one.kind === 'loop' && one.jobs.includes('state rebuild'))
  }, 'a stall of the loop naming the state rebuild in data/stalls.json')
  const stall = logged.find(one => one.kind === 'loop' && one.jobs.includes('state rebuild'))
  assert.ok(stall.ms > 2000 && stall.ms < 60_000, JSON.stringify(stall))

  // Two work calls answered after their mods gave up: board-slow opens, and cites the stall from the board's own state.
  await work('Digger', { action: 'next' }, `digger-id-${Date.now() - 15_000}-1`)
  await work('Lead', { action: 'next' }, `lead-id-${Date.now() - 20_000}-2`)
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  let state = null
  await until(async () => {
    state = await fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
    return (state.lateCalls ?? []).length >= 2 && (state.stalls ?? []).some(one => one.jobs.includes('state rebuild'))
  }, 'the late calls and the stall in the board\'s state')
  const rule = WATCH_RULES.find(one => one.id === 'board-slow')
  const found = rule.check(buildView({ state, items: new Map(), now: Date.now() }), { seen: new Map(), observed: [] })
  assert.deepEqual(found.map(one => one.key), ['board-slow board'])
  assert.match(found[0].evidence, /stalls: .*s the loop blocked \([^)]*jobs: [^)]*state rebuild/)
})
