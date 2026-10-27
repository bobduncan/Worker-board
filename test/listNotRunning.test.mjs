// B738 (the result check of B728): the Workers list says "Not running" for a chat the board shows off, from the board's own
// verdict: the answer to a chat's take names the chats that do not run (`off`), and a chat that runs is not among them.
// End to end on a running board (the server's own pass): a copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { migrateBacklog, stamp } from '../src/work/migrate.mjs'
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

function run(started, board, env) {
  // B570: the copy reads no Workers mod installed on this PC (an empty Claude folder beside it), so no restart for a
  // newer mod holds the lines this test watches.
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

/** The board's first look at the store (and its line out) may take a while on a busy machine. */
async function until(check, what) {
  for (const end = Date.now() + 90_000; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within 90 s: ${what}`)
}

test('the answer to a take names the chats that do not run, and not the one that asks', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-list-off-'))
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
  await put(join(chats, 'main-id.json'), JSON.stringify({ name: 'Main', role: 'main', state: 'waiting', task: null, at: NOW }))
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name.replace(' ', '')}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 30 * 60 * MIN })
  await put(join(app, 'a', 'b', 'local_main.json'), appChat('Main', 'main-id'))
  await put(join(transcripts, 'main-id.jsonl'), `${[typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n')}\n`)
  // Worker 5 has not run for a day and a half; Worker 6 runs (it takes below).
  const names = ['Worker 5', 'Worker 6']
  for (const [index, name] of names.entries()) {
    const id = `w${index + 5}-id`
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role: 'worker', state: 'waiting', task: null, at: NOW - 36 * 60 * MIN }))
    await put(join(app, 'a', 'b', `local_worker${index + 5}.json`), appChat(name, id))
    await put(join(transcripts, `${id}.jsonl`), `${[typed(NOW - 40 * 60 * MIN, 'Go on.'), answer(NOW - 36 * 60 * MIN, 'Done.')].join('\n')}\n`)
  }
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Board\n- [ ] B730 Something else (about 1 h)\n',{ now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'list-off', project, port, gamePort: 7350, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const take = async (chat, session) => {
    const answered = await fetch(`http://127.0.0.1:${port}/api/bridge/take`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.21.0' }, body: JSON.stringify({ chat, session, report: { state: 'idle', since: Date.now(), background: false, run: 1, seq: 1 } }) })
    return answered.ok ? JSON.parse(await answered.text()) : null
  }
  await until(async () => (await take('Worker 6', 'w6-id'))?.off?.includes('Worker 5') === true, 'Worker 5 named off in the answer to a take')
  const answered = await take('Worker 6', 'w6-id')
  assert.ok(answered.off.includes('Worker 5'), 'the chat that does not run is named')
  assert.ok(!answered.off.includes('Worker 6'), 'the chat that asks runs: it is not named')
})
