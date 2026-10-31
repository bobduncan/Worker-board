// B847, end to end on a running board: a worker's routine ran twice, so the app's list holds two chats titled "Game - Worker 1",
// the older one idle since before the newer began. Once the newer one has checked in, the chat whose mod can archive is handed
// ONE archive job, for the older chat and nobody else (not the live chat, not a chat of another name, not one with
// uncommitted work), a chat on an older mod is handed none, and the result is one line in the board's log. A copy of the board
// on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'

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

function run(started, board, env) {
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, CLAUDE_CONFIG_DIR: join(dirname(board), 'claude-config'), WORKER_BOARD_TICK_MS: '1000', ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
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

async function until(check, what) {
  for (const end = Date.now() + 60_000; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within 60 s: ${what}`)
}

/** A board over the made-up project; with `git`, the project is a git work tree with files nobody committed. */
async function boardWith(t, { git = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'board-replaced-'))
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
  const appChat = (name, sessionId, cliSessionId, createdAt, lastActivityAt) => JSON.stringify({ title: `Game - ${name}`, sessionId, cliSessionId, cwd: project, isArchived: false, createdAt, lastActivityAt })
  // Main; Worker 1 twice (the older one quiet since before the newer began); Worker 2 once, whose only chat must never be named.
  const chatsOf = [
    ['Main', 'local_main', 'main-id', NOW - 600 * MIN, NOW - 3 * MIN],
    ['Worker 1', 'local_w1_old', 'w1-old-id', NOW - 600 * MIN, NOW - 90 * MIN],
    ['Worker 1', 'local_w1_live', 'w1-live-id', NOW - 30 * MIN, NOW - 2 * MIN],
    ['Worker 2', 'local_w2', 'w2-id', NOW - 500 * MIN, NOW - 4 * MIN],
  ]
  for (const [name, sessionId, cli, createdAt, lastActivityAt] of chatsOf) {
    await put(join(app, 'a', 'b', `${sessionId}.json`), appChat(name, sessionId, cli, createdAt, lastActivityAt))
    await put(join(transcripts, `${cli}.jsonl`), `${[typed(lastActivityAt - 6 * MIN, 'Status?'), answer(lastActivityAt - 5 * MIN, 'All fine.')].join('\n')}\n`)
  }
  await put(join(chats, 'main-id.json'), JSON.stringify({ name: 'Main', role: 'main', state: 'waiting', task: null, at: NOW }))
  await put(join(chats, 'w1-live-id.json'), JSON.stringify({ name: 'Worker 1', role: 'worker', state: 'waiting', task: null, at: NOW - MIN }))
  await put(join(chats, 'w2-id.json'), JSON.stringify({ name: 'Worker 2', role: 'worker', state: 'waiting', task: null, at: NOW - MIN }))
  if (git) await new Promise((done, fail) => spawn('git', ['init', '-q', project], { windowsHide: true }).once('exit', code => (code === 0 ? done() : fail(new Error('git init')))))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'replaced', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const { out } = await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const base = `http://127.0.0.1:${port}`
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const call = (path, mod, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': mod }, body: JSON.stringify(body) })
  // The newer chat checks in, and so does Worker 2.
  for (const [chat, session] of [['Worker 1', 'w1-live-id'], ['Worker 2', 'w2-id']]) {
    const sent = await call('/api/bridge/report', '0.26.10', { chat, session, report: { state: 'idle', since: NOW - 2 * MIN, seq: 1, run: 1 } })
    assert.equal(sent.status, 200, await sent.text())
  }
  const claim = (chat, session, mod, can) => call('/api/bridge/hands', mod, { chat, session, mod, can }).then(async reply => ({ status: reply.status, body: JSON.parse(await reply.text()) }))
  const archives = got => (got.body.jobs ?? got.body.result?.jobs ?? []).filter(job => job.archive)
  return { out, call, claim, archives }
}

test('a worker chat that a newer run of its routine replaced is handed to archive, once, to a chat whose mod can', { timeout: 240_000 }, async t => {
  const { out, call, claim, archives } = await boardWith(t)
  // A chat on an older mod, or one that may not close chats, is handed no archive job.
  for (const [mod, can] of [['0.26.9', ['restart']], ['0.26.10', ['send']]]) {
    const old = await claim('Worker 2', 'w2-id', mod, can)
    assert.equal(old.status, 200, JSON.stringify(old.body))
    assert.deepEqual(archives(old), [], `${mod} ${can}`)
  }
  // The chat whose mod can: one job, for the older chat of Worker 1 only.
  let jobs = []
  await until(async () => {
    const got = await claim('Worker 2', 'w2-id', '0.26.10', ['restart', 'send'])
    jobs = archives(got)
    return jobs.length > 0
  }, 'the archive job')
  assert.deepEqual(jobs.map(job => [job.id, job.to, job.chat, job.archive]), [['archive:local_w1_old', 'local_w1_old', 'Worker 1', true]])
  // It goes once: the next claim, a moment later, brings none (the chat is tried again only after five minutes).
  const again = await claim('Worker 2', 'w2-id', '0.26.10', ['restart', 'send'])
  assert.deepEqual(archives(again), [])
  // The mod says it archived: one line in the board's log.
  const done = await call('/api/bridge/hands-done', '0.26.10', { chat: 'Worker 2', session: 'w2-id', results: [{ id: 'archive:local_w1_old', ok: true }] })
  assert.equal(done.status, 200, await done.text())
  await until(async () => /B847: archived the replaced chat local_w1_old at \d\d:\d\d: Worker 1: a newer chat of the same name \(local_w1_live\) has checked in/.test(out()), 'the board.log line')
  assert.doesNotMatch(out(), /replaced chat local_w1_live|replaced chat local_w2|replaced chat local_main/)
})

test('a replaced chat whose folder holds uncommitted work is kept: no archive job, however often the mod claims', { timeout: 240_000 }, async t => {
  const { claim, archives } = await boardWith(t, { git: true })
  for (let at = 0; at < 4; at += 1) {
    assert.deepEqual(archives(await claim('Worker 2', 'w2-id', '0.26.10', ['restart', 'send'])), [], `claim ${at}`)
    await new Promise(done => setTimeout(done, 700))
  }
})
