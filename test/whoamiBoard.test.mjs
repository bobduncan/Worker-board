// 2026-10-28: `POST /api/bridge/whoami` end to end on a running board (the server's own pass): a copy of the board on a made-up
// project in a temporary folder only. The board names a session from the app's chat list: a chat of the list by its name and
// role, the chat the app made anew after a clear with the session its card is still filed under, and a session of no chat
// by none; and the call counts as a call of a mod (`bridge.isMissing`), also from a session of no chat.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

function run(started, board, env) {
  // The copy reads no Workers mod installed on this PC (an empty Claude folder beside it).
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
    const found = await check()
    if (found) return found
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within 90 s: ${what}`)
}

test('the board names a session: its chat, its role, where its card is filed; and a call of it counts as a mod that runs', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-whoami-'))
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
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name.replace(' ', '')}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 30 * MIN })
  // Main and Digger keep their cards under their own sessions. Worker 5 was cleared in a new process: the app names its new
  // session, its card is still filed under the old one (and Worker 6's, an old chat of another name, stays where it is).
  const people = [['Main', 'main-id', 'main-id', 'main'], ['Digger', 'digger-id', 'digger-id', 'worker'], ['Worker 5', 'w5-new', 'w5-old', 'worker']]
  for (const [name, session, filed, role] of people) {
    await put(join(chats, `${filed}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW - 5 * MIN }))
    await put(join(app, 'a', 'b', `local_${name.replace(' ', '')}.json`), appChat(name, session))
    await put(join(transcripts, `${session}.jsonl`), `${[typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n')}\n`)
  }
  await put(join(chats, 'w6-old.json'), JSON.stringify({ name: 'Worker 6', role: 'worker', state: 'waiting', task: null, at: NOW - 60 * MIN }))
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Board\n- [ ] B730 Something else (about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'whoami', project, port, gamePort: 7360, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const base = `http://127.0.0.1:${port}`
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const page = await fetch(`${base}/`).then(reply => reply.text())
  const token = /[0-9a-f]{64}/.exec(page)?.[0]
  assert.ok(token, 'the served page carries the token')
  const state = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const whoami = async body => {
    const answered = await fetch(`${base}/api/bridge/whoami`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.22.0' }, body: JSON.stringify(body) })
    return { status: answered.status, body: answered.ok ? await answered.json() : await answered.text() }
  }

  // No mod has asked yet: past the first half minute the board knows none runs.
  await until(async () => (await state()).bridge?.isMissing === true, 'the board knows no mod asked it')

  // Worker 5 in a new process: its session is the app's new one, its card the old session's; the answer needs the board's
  // first reading of the app's chats, so it is asked until the board shows the chat.
  const fifth = await until(async () => {
    const asked = await whoami({ session: 'w5-new' })
    return asked.body?.name === 'Worker 5' ? asked : null
  }, 'Worker 5 named by its session')
  assert.deepEqual(fifth, { status: 200, body: { name: 'Worker 5', role: 'worker', card: 'w5-old' } })
  assert.deepEqual(await whoami({ session: 'main-id' }), { status: 200, body: { name: 'Main', role: 'main', card: null } })
  assert.deepEqual(await whoami({ session: 'digger-id' }), { status: 200, body: { name: 'Digger', role: 'worker', card: null } })
  // A chat's name in the body is nobody's word; a session of no chat of the list has none; no session is refused.
  assert.deepEqual(await whoami({ chat: 'Main', session: 'stranger-id' }), { status: 200, body: { name: null, role: null, card: null } })
  assert.equal((await whoami({ chat: 'Main' })).status, 400)

  // The calls counted: the board knows a mod runs, as it did not before the first of them.
  assert.equal((await state()).bridge.isMissing, false)
})
