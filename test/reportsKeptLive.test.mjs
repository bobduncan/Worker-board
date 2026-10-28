// T13 part 1, through the server's own pass: a copy of the board hears two chats through their mods' pings (the lead idle,
// a worker busy), keeps their reports in data/reports.json, is stopped, and started anew a while after the reports went
// stale. At its start each lane reads as the chat last said (free, working), not Unknown; a chat that reports after the
// restart is read from its new report. A torn reports file is set aside and the board starts without it. The settings'
// 15 s stand for the 30 s of every day. A copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
/** A report silent this long is unknown; the pause before the restart is longer, so the saved reports are stale by then. */
const UNKNOWN_S = 15
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
  for (const end = Date.now() + 90_000; Date.now() < end;) {
    if (await check()) return
    await pause(200)
  }
  throw new Error(`Not within 90 s: ${what}`)
}

test('a restart of the board keeps each chat\'s last state: free stays free, working stays working, a torn file is set aside', { timeout: 400_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-reports-'))
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
    await put(join(transcripts, `${id}.jsonl`), `${[typed(NOW - 9 * MIN, 'Go on.'), answer(NOW - 8 * MIN, 'On it.')].join('\n')}\n`)
  }
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Garden\n- [ ] B730 Something else (about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'kept', project, port, gamePort: 7380, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), unknownAfterSeconds: UNKNOWN_S }))
  const base = `http://127.0.0.1:${port}`
  const start = async () => {
    const child = await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_TICK_MS: '1000' })
    const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
    const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
    assert.ok(token, 'the served page carries the token')
    return { child, key, token }
  }
  const stateOf = token => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const lanesOf = state => Object.fromEntries(Object.keys(NAMES).map(name => {
    const lane = (state.chats ?? []).find(one => one.name === name && !one.isLeftover)
    return [name, `${lane?.state}${lane?.isRunning === true ? '' : ` (running ${lane?.isRunning})`}`]
  }))
  // Each chat's mod: its 5-second ping (a take with its report).
  let seq = 0
  const ping = (key, name, state) => fetch(`${base}/api/bridge/take`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.21.0' },
    body: JSON.stringify({ chat: name, session: NAMES[name], report: { state, since: Date.now(), background: false, run: 1, seq: ++seq } }),
  }).then(reply => reply.ok, () => false)

  // The first board hears the lead idle and the worker busy, and writes them down within a second or two.
  const first = await start()
  await until(async () => {
    await Promise.all([ping(first.key, 'Lead', 'idle'), ping(first.key, 'Digger', 'busy')])
    const lanes = lanesOf(await stateOf(first.token))
    return lanes.Lead === 'free' && lanes.Digger === 'working'
  }, 'the lead free and the worker working')
  const file = join(board, 'data', 'reports.json')
  await until(async () => {
    const text = await readFile(file, 'utf8').catch(() => '{}')
    const saved = JSON.parse(text).reports ?? {}
    return saved.Lead?.state === 'idle' && saved.Digger?.state === 'busy'
  }, 'the reports in data/reports.json')
  assert.deepEqual((await readdir(join(board, 'data'))).filter(name => name.includes('reports')), ['reports.json'], 'nothing is left beside the file')

  // The board stops and starts again after its reports went stale (longer than 15 s).
  await stop(first.child)
  await pause((UNKNOWN_S + 3) * 1000)
  const second = await start()
  const atStart = lanesOf(await stateOf(second.token))
  assert.deepEqual(atStart, { Lead: 'free', Digger: 'working' }, 'each lane reads as its chat last said, not unknown')
  // A chat that reports after the restart is read from its new report; the other is still read as saved.
  await until(async () => (await ping(second.key, 'Digger', 'idle')) === true, 'the worker\'s new report taken')
  await until(async () => lanesOf(await stateOf(second.token)).Digger === 'free', 'the worker read from its new report')
  assert.equal(lanesOf(await stateOf(second.token)).Lead, 'free')
  // Its own write: the new report is in the file within a second or two.
  await until(async () => JSON.parse(await readFile(file, 'utf8')).reports?.Digger?.state === 'idle', 'the new report in data/reports.json')

  // A torn file (a power cut in the middle of a write) is set aside and the board starts without it.
  await stop(second.child)
  await writeFile(file, '{"reports":{"Lead":{"state":"idle","since":')
  const third = await start()
  const state = await stateOf(third.token)
  assert.ok(Array.isArray(state.chats), 'the board runs')
  assert.deepEqual((state.setAside ?? []).map(one => one.file), ['reports.json'])
  assert.match(state.setAside[0].aside, /^reports\.json\.broken-\d{8}-\d{6}$/)
  assert.ok((await readdir(join(board, 'data'))).includes(state.setAside[0].aside), 'the torn file is kept beside the others')
})
