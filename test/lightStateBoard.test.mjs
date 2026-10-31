// Light state on a running board (2026-10-31): a copy of the board on a made-up project serves a finished step light in
// /api/state and its full row in /api/step, for the page's token only. A copy of the board in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(started, board, env) {
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, CLAUDE_CONFIG_DIR: join(dirname(board), 'claude-config'), ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
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

test('a running board sends a finished step light and gives its full row at /api/step to its own page only', { timeout: 200_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-light-'))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const [board, project, app, transcripts] = ['board', 'project', 'app', 'transcripts'].map(name => join(dir, name))
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  await mkdir(join(project, '.claude', 'chats'), { recursive: true })
  await writeFile(join(project, '.claude', 'chats', 'list.json'), '{"prefix":"Studio · ","main":"Lead"}')
  const backlog = '## Orchard\n- [x] B31 Plant the pear trees (for Worker 1) (branch b31-pears)\n  - four trees on the south wall\n- [ ] B32 Prune the apple trees\n'
  await writeStore(join(project, '.claude', 'work'), migrateBacklog(backlog, { now: NOW - 60_000 }), undefined, { now: NOW - 60_000 })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({
    name: 'orchard', project, port, gamePort: 7362, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'),
  }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const base = `http://127.0.0.1:${port}`
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  assert.ok(token, 'the served page carries the token')
  const get = (path, headers = { 'X-Board-Token': token }) => fetch(`${base}${path}`, { headers })

  const state = await (await get('/api/state')).json()
  const rows = state.backlog.flatMap(activity => activity.steps)
  const pear = rows.find(one => one.id === 'B31')
  assert.equal(pear.light, true)
  assert.equal(pear.status, 'done')
  assert.equal(pear.title, 'Plant the pear trees')
  for (const field of ['item', 'notes', 'refined', 'flow']) assert.equal(Object.hasOwn(pear, field), false, `no ${field}`)
  const prune = rows.find(one => one.id === 'B32')
  assert.equal(Object.hasOwn(prune, 'light'), false, 'an open step goes whole')
  assert.ok(prune.item !== null && prune.flow !== null)

  const answer = await get('/api/step?id=B31')
  assert.equal(answer.status, 200)
  const row = await answer.json()
  assert.equal(row.key, 'B31')
  assert.equal(row.title, 'Plant the pear trees')
  assert.equal(row.item.state, 'done')
  assert.equal(row.flow.state, 'done')
  assert.equal(Object.hasOwn(row, 'light'), false)
  for (const field of ['key', 'id', 'title', 'status', 'worker', 'branch', 'doneAt']) assert.deepEqual(row[field], pear[field], field)
  assert.equal((await get('/api/step?id=B31', {})).status, 403)
  assert.equal((await get('/api/step?id=B99')).status, 404)
})
