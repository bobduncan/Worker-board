// Shut down (2026-11-21, src/shutdown.mjs) on a running board: a copy of the board on a made-up project in a temporary folder (as
// test/pauseTruthBoard.test.mjs does). The page's Shut down pauses every chat (pause.json pausing), then the board ends with 0 and
// leaves the person's stop sign (by command, a shutdown), which holds it down; a demo is not shut down from its page.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { isHeldSign, startAllowed } from '../src/shutdown.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

/** Starts the copy's server; resolves with the child and a promise of its exit code once it says where it runs. */
function run(started, board, env) {
  const claude = join(dirname(board), 'claude-config')
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, CLAUDE_CONFIG_DIR: claude, ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
  started.push(child)
  const ended = new Promise(done => child.once('exit', code => done(code)))
  return new Promise((done, fail) => {
    let out = ''
    const late = setTimeout(() => fail(new Error(`The board did not start: ${out}`)), 90_000)
    const read = chunk => {
      out += chunk
      if (!/Worker board: http:\/\/127\.0\.0\.1:\d+\//.test(out)) return
      clearTimeout(late)
      done({ child, ended, out: () => out })
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

test('on a running board: Shut down pauses every chat, ends the board with 0 and leaves a stop sign that holds it down', { timeout: 240_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-shutdown-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Team - ","main":"Lead"}')
  await put(join(chats, 'lead-id.json'), JSON.stringify({ name: 'Lead', role: 'main', state: 'waiting', task: null, at: NOW }))
  const work = join(project, '.claude', 'work')
  await put(join(work, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [] }, null, 1)}\n`)
  await mkdir(app, { recursive: true })
  await mkdir(transcripts, { recursive: true })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'shut', project, port, gamePort: 7360, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), refreshSeconds: 1 }))
  const { ended, out } = await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const base = `http://127.0.0.1:${port}`
  const token = (await (await fetch(`${base}/`)).text()).match(/name="board-token" content="([^"]+)"/)[1]
  const state = await (await fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } })).json()
  assert.equal(state.canShutdown, true)
  assert.equal(state.shutdown, null)
  const asked = await fetch(`${base}/api/work`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify({ action: 'shutdown' }) })
  assert.equal(asked.status, 200, await asked.clone().text())
  const answered = await asked.json()
  assert.ok(Number.isFinite(answered.at) && answered.until > answered.at, JSON.stringify(answered))
  assert.equal(JSON.parse(await readFile(join(work, 'pause.json'), 'utf8')).state, 'pausing', 'Pause all came first')
  // Nobody works: the pause is safe at once, and the board ends after its notice (about one refresh).
  const code = await Promise.race([ended, new Promise(done => setTimeout(() => done('still running'), 60_000))])
  assert.equal(code, 0, out())
  const sign = JSON.parse(await readFile(join(board, 'data', 'stop.json'), 'utf8'))
  assert.equal(isHeldSign(sign), true, JSON.stringify(sign))
  assert.equal(sign.how, 'shutdown')
  assert.equal(startAllowed({ stop: sign, args: ['--quiet'] }).ok, false, 'the chats\' mod and the hook start nothing now')
})
