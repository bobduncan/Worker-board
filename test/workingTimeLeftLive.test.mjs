// B793 (the person, 2026-10-30): Worker 1 worked B781 and the Left column said "45 h 33 over". The step had been taken on
// 28 Oct, the chat worked 35 minutes, then the board and the chat were off for 44 hours; the chat was started again and
// resumed the step. Here a copy of the board runs on a made-up project with that history (the same shape, made-up names:
// the chat works the step 30 minutes, the board is off for 45 hours, the chat works again) and the state it serves says what
// the step has left of its 3 hours in working time. Set B793_SHOT to a folder to also keep the picture of the board.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { step, typed } from '../fixtures/lines.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MIN = 60_000
const H = 60 * MIN
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
  for (const end = Date.now() + 90_000; Date.now() < end;) {
    if (await check()) return
    await pause(200)
  }
  throw new Error(`Not within 90 s: ${what}`)
}

test('a step taken 45 hours ago, worked 30 minutes and resumed after the board was off: the served time left is its 3 hours less what was worked, never hours over', { timeout: 200_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-left-'))
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
  const NAMES = { Lead: 'lead-id', Digger: 'digger-id' }
  for (const [name, id] of Object.entries(NAMES)) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role: name === 'Lead' ? 'main' : 'worker', state: 'waiting', task: null, at: NOW - 5 * MIN }))
    await put(join(app, 'a', 'b', `local_${id}.json`), JSON.stringify({ title: `Garden - ${name}`, sessionId: `local_${id}`, cliSessionId: id, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW - MIN }))
    // The worker's turn runs: it resumed the step two minutes ago.
    const lines = name === 'Lead' ? [typed(NOW - 9 * MIN, 'Go on.')] : [typed(NOW - 2 * MIN, 'Carry on with B81.'), step(Date.now(), 'Run the tests')]
    await put(join(transcripts, `${id}.jsonl`), `${lines.join('\n')}\n`)
  }
  // B81 is Digger's, with 3 hours.
  const backlog = '## Garden\n- [ ] B81 Fix look (for Digger; about 3 h) (branch b81)\n'
  await writeStore(join(project, '.claude', 'work'), migrateBacklog(backlog, { now: NOW - 45 * H }), undefined, { now: NOW - 45 * H })
  // The history the board kept: the step began 45 h ago, was worked 30 minutes, then the board was off for 45 hours.
  const task = 'B81 Fix look'
  const line = (at, state) => ({ at, chat: 'Digger', state, task, step: null, steps: null, leftMs: null, estimateAt: null, startedAt: NOW - 45 * H, source: 'step', by: null })
  const kept = [line(NOW - 45 * H, 'working'), { at: NOW - 45 * H + 30 * MIN, gap: true }]
  await put(join(board, 'data', 'history.jsonl'), `${kept.map(one => JSON.stringify(one)).join('\n')}\n`)
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({
    name: 'left', project, port, gamePort: 7361, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'),
  }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_TICK_MS: '1000' })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const base = `http://127.0.0.1:${port}`
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  assert.ok(token, 'the served page carries the token')
  const stateNow = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  let seq = 0
  const ping = (name, state) => fetch(`${base}/api/bridge/take`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.21.0' },
    body: JSON.stringify({ chat: name, session: NAMES[name], report: { state, since: NOW - 3 * MIN, background: false, run: 1, seq: ++seq } }),
  }).then(reply => reply.ok, () => false)
  let lane = null
  await until(async () => {
    await Promise.all([ping('Lead', 'idle'), ping('Digger', 'busy')])
    lane = ((await stateNow()).chats ?? []).find(one => one.name === 'Digger' && !one.isLeftover)
    return lane?.state === 'working' && lane.eta !== null
  }, 'Digger working with a time')
  // 3 hours planned, 30 minutes worked: 2 h 30 left (a few seconds more worked since the board woke); wall time says 42 h over.
  assert.equal(lane.eta.from, 'step')
  assert.equal(lane.eta.isOver, false)
  assert.equal(lane.eta.isOverdue, false)
  assert.ok(lane.eta.leftMs > 148 * MIN && lane.eta.leftMs <= 150 * MIN, `time left ${Math.round(lane.eta.leftMs / MIN)} min`)
  assert.ok(lane.task.offStartMs > 44 * H, 'the 45 hours since the start hold the 44.5 hours not worked')

  const shots = process.env.B793_SHOT
  if (shots) await shoot(base, join(shots, 'left.png'))
})

/** The page as a picture: headless Edge over its debugging port, the tour closed and the Details view up; closed again at the end. */
async function shoot(base, file) {
  const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].map(root => root && join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(path => path && existsSync(path))
  const profile = await mkdtemp(join(tmpdir(), 'edge-b793-'))
  const port = await freePort()
  const child = spawn(edge, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--window-size=1400,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  try {
    let target = null
    await until(async () => {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then(reply => reply.json(), () => [])).find(one => one.type === 'page') ?? null
      return target !== null
    }, 'the browser page')
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail })
    let id = 0
    const waiting = new Map()
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (waiting.has(message.id)) waiting.get(message.id)(message.result)
    }
    const call = (method, params = {}) => new Promise(done => {
      id += 1
      waiting.set(id, done)
      socket.send(JSON.stringify({ id, method, params }))
    })
    await call('Page.navigate', { url: `${base}/` })
    await pause(3000)
    await call('Runtime.evaluate', { expression: "localStorage.setItem('help-seen','yes'); localStorage.setItem('overview-mode','details')" })
    await call('Page.navigate', { url: `${base}/` })
    await pause(6000)
    const shot = await call('Page.captureScreenshot', { format: 'png' })
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, Buffer.from(shot.data, 'base64'))
    socket.close()
  } finally {
    child.kill()
    await pause(500)
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
}
