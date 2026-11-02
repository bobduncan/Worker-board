// B930 (X131, X109), end to end on a running board: the save-log a worker's Workers mod asks before it clears the chat is
// refused only for background work that still runs, read from the one source the hold's release reads (the mod's fresh idle
// report, else the transcript, which now ends a task the chat stopped itself). A copy of the board on a made-up project in a
// temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { cet, launched, stoppedTwice } from '../fixtures/stoppedBackground.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MIN = 60_000
const REFUSED = /Background work it started is still running/

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

test('save-log: a worker that stopped its own background work is not refused; one whose work runs is, until its mod\'s fresh idle report says none runs', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-stopped-'))
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
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  await put(join(app, 'a', 'b', 'local_main.json'), appChat('Main', 'main-id'))
  await put(join(transcripts, 'main-id.jsonl'), `${[typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n')}\n`)
  // Digger: the real case, two commands it stopped itself. Units: a command whose end its transcript does not show.
  const lines = {
    digger: stoppedTwice(),
    units: [...launched(cet(15, 57, 17), 'toolu_watch2', 'bvr2wx5br'), answer(cet(16, 17, 0), 'B917 is reported.')],
  }
  for (const [name, id] of [['Digger', 'digger'], ['Units', 'units']]) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role: 'worker', state: 'waiting', task: null, at: NOW }))
    await put(join(app, 'a', 'b', `local_${id}.json`), appChat(name, id))
    await put(join(transcripts, `${id}.jsonl`), `${lines[id].join('\n')}\n`)
  }
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Art\n- [ ] B13 Draw the shield (about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'stopped', project, port, gamePort: 7310, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), unknownAfterSeconds: 5 }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const call = (path, body) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.27.1' }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, text: await reply.text() }))
  const saveLog = (chat, session) => call('/api/bridge/work', { action: 'save-log', stepId: 'B917', chat, session })
  const report = (chat, session, background, seq) => call('/api/bridge/report', { chat, session, report: { state: 'idle', since: Date.now() - MIN, background, seq, run: 1 } })

  // Part 1: no report, the transcript decides: Digger's stops ended both commands.
  const digger = await saveLog('Digger', 'digger')
  assert.equal(digger.status, 200, digger.text)
  // Units' transcript counts one; no report: refused.
  const before = await saveLog('Units', 'units')
  assert.equal(before.status, 409)
  assert.match(before.text, REFUSED)
  // Part 2: its mod's fresh idle report says background work runs: refused; says none runs: kept (the release reads the same).
  assert.equal((await report('Units', 'units', true, 1)).status, 200)
  assert.match((await saveLog('Units', 'units')).text, REFUSED)
  assert.equal((await report('Units', 'units', false, 2)).status, 200)
  const after = await saveLog('Units', 'units')
  assert.equal(after.status, 200, after.text)
  // A stale report (older than unknownAfterSeconds) leaves it to the transcript too.
  assert.equal((await report('Units', 'units', false, 4)).status, 200)
  await new Promise(done => setTimeout(done, 6000))
  assert.equal((await saveLog('Units', 'units')).status, 409)
})
