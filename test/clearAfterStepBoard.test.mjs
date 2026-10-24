// Clear after each step, end to end on a running board: the Workers mod's `save-log` through the bridge keeps the
// conversation as a log (only a worker's), the chat goes on under its new session id without a refusal, and a log the
// board had not finished when it stopped is finished at its next start. A copy of the board on a made-up project in a
// temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

/** Starts the board and answers once it listens. */
function run(started, board, env) {
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
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
  for (const end = Date.now() + 30_000; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 100))
  }
  throw new Error(`Not within 30 s: ${what}`)
}

const exists = path => stat(path).then(() => true, () => false)

test('save-log through the bridge keeps a worker\'s conversation, the chat goes on under its new id, and the journal is finished after a restart', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-clear-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main","afterStep":"clear"}')
  await put(join(chats, 'main-id.json'), JSON.stringify({ name: 'Main', role: 'main', state: 'waiting', task: null, at: NOW }))
  await put(join(chats, 'units-old.json'), JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW }))
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  await put(join(app, 'a', 'b', 'local_main.json'), appChat('Main', 'main-id'))
  await put(join(app, 'a', 'b', 'local_units.json'), appChat('Units', 'units-old'))
  await put(join(transcripts, 'main-id.jsonl'), `${[typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n')}\n`)
  await put(join(transcripts, 'units-old.jsonl'), `${[typed(NOW - 30 * MIN, 'Draw the knight.'), answer(NOW - 20 * MIN, 'B12 is in.')].join('\n')}\n`)
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Art\n- [ ] B13 Draw the shield (for Units; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'clear', project, port, gamePort: 7300, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const env = { WORKER_BOARD_HOME: join(dir, 'pc') }
  await run(started, board, env)
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const work = body => fetch(`http://127.0.0.1:${port}/api/bridge/work`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))

  // Only a worker's conversation is kept for a clear; the main chat's is refused.
  const main = await work({ action: 'save-log', stepId: 'B12', chat: 'Main', session: 'main-id' })
  assert.equal(main.status, 409)
  assert.match(main.body, /Main is the main chat: only a worker's conversation is cleared\./)
  const saved = await work({ action: 'save-log', stepId: 'B12', chat: 'Units', session: 'units-old' })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.match(saved.body.log, /^\.claude\/chat-logs\/Units\/\d{4}-\d\d-\d\d \d{4} B12\.txt$/)
  await until(() => exists(saved.body.file), 'the text log')
  assert.match(await readFile(saved.body.file, 'utf8'), /The person:\nDraw the knight\.[\s\S]*Units:\nB12 is in\./)
  assert.equal(await readFile(saved.body.jsonl, 'utf8'), await readFile(join(transcripts, 'units-old.jsonl'), 'utf8'))

  // Review 2: the old transcript's last lines come after the log was asked for (here, the step's report): the board
  // reads them on for the task times and the spending, though its lane reads the new session from now on.
  const report = JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - MIN).toISOString(), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Reported B12.' }] } })
  await writeFile(join(transcripts, 'units-old.jsonl'), `${await readFile(join(transcripts, 'units-old.jsonl'), 'utf8')}${report}\n`)
  // The /clear: the mod moves the card to the new session; the app still names the old one. The board serves the new
  // session at once, under the chat's name.
  await put(join(chats, 'units-new.json'), JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW, cleared: { at: NOW, step: 'B12', log: saved.body.log } }))
  await put(join(chats, 'units-old.json'), JSON.stringify({ movedTo: 'units-new', at: NOW }))
  await put(join(transcripts, 'units-new.jsonl'), '')
  const next = await work({ action: 'next', chat: 'Units', session: 'units-new' })
  assert.equal(next.status, 200, JSON.stringify(next.body))
  assert.match(next.body.text, /B13/)
  assert.equal((await work({ action: 'next', chat: 'Units', session: 'units-old' })).status, 409)

  // The board stops before a log is written; its next start finishes it.
  await stop(started.pop())
  const folder = join(project, '.claude', 'chat-logs', 'Units')
  const job = { id: 'units-old-1', chat: 'Units', session: 'units-old', step: 'B11', at: NOW, state: 'copy', source: join(transcripts, 'units-old.jsonl'), jsonl: join(folder, 'late B11.jsonl'), txt: join(folder, 'late B11.txt'), log: '.claude/chat-logs/Units/late B11.txt' }
  const before = JSON.parse(await readFile(join(board, 'data', 'chat-logs.json'), 'utf8'))
  // The session the clear left is named in the journal, to be read on after the restart.
  assert.deepEqual(before.left.map(one => one.session), ['units-old'])
  await put(join(board, 'data', 'chat-logs.json'), JSON.stringify({ ...before, jobs: [job] }))
  await run(started, board, env)
  await until(() => exists(job.txt), 'the log the journal named')
  assert.match(await readFile(job.txt, 'utf8'), /after its reported step B11/)
  await until(async () => JSON.parse(await readFile(join(board, 'data', 'chat-logs.json'), 'utf8')).jobs.length === 0, 'an empty journal')
  // Review 2: the old session was read to its end for the task times and the spending, and is no longer named.
  const size = (await stat(join(transcripts, 'units-old.jsonl'))).size
  await until(async () => JSON.parse(await readFile(join(board, 'data', 'task-times.json'), 'utf8')).scans?.['units-old']?.offset === size, 'the old session read to its end')
  await until(async () => JSON.parse(await readFile(join(board, 'data', 'chat-logs.json'), 'utf8')).left.length === 0, 'the old session read out')
})
