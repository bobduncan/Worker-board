// Signals change 1 (2026-10-31) on a running board: /api/state carries the board's own part, a start after a stop reads
// data/stop.json into its gap line and the state, and the board's own exits (a restart for a new version, the keeper's
// disconnect) write the stop record. A copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { START_ANEW } from '../src/keeper.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const MIN = 60_000

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

/** Starts the copy with a channel to this test, as its keeper does (so it can start itself anew and sees a disconnect). */
function run(started, board) {
  const child = spawn(process.execPath, [join(board, 'server.mjs')], {
    cwd: board, env: { ...process.env, CLAUDE_CONFIG_DIR: join(dirname(board), 'claude-config'), WORKER_BOARD_HOME: join(dirname(board), 'pc'), WORKER_BOARD_CHILD: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  })
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

const exited = child => new Promise(done => {
  if (child.exitCode !== null) done(child.exitCode)
  else child.once('exit', code => done(code))
})

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const gone = exited(child)
  child.kill('SIGKILL')
  await gone
}

test('a running board tells its own clock and loop, says why it was off after a stop, and writes why it ends', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-self-'))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const [board, project, app, transcripts] = ['board', 'project', 'app', 'transcripts'].map(name => join(dir, name))
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  await mkdir(join(project, '.claude', 'chats'), { recursive: true })
  await writeFile(join(project, '.claude', 'chats', 'list.json'), '{"prefix":"Studio · ","main":"Lead"}')
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({
    name: 'orchard', refreshSeconds: 2, project, port, gamePort: 7362, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'),
  }))
  // The board before this one ran 30 minutes ago and ended for a new version one minute after its last look.
  const before = Date.now() - 30 * MIN
  await mkdir(join(board, 'data'), { recursive: true })
  await writeFile(join(board, 'data', 'history.jsonl'), `${JSON.stringify({ at: before, chat: 'Lead', state: 'free', task: null })}\n`)
  await writeFile(join(board, 'data', 'alive.json'), JSON.stringify({ at: before }))
  await writeFile(join(board, 'data', 'stop.json'), JSON.stringify({ at: before + MIN, why: 'restart' }))

  const base = `http://127.0.0.1:${port}`
  const stateOf = async () => {
    const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
    assert.ok(token, 'the served page carries the token')
    return { token, state: await (await fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } })).json() }
  }

  // First start: the gap is told, with the stop record's why, and the record is used up.
  const first = await run(started, board)
  const asked = Date.now()
  const { token, state } = await stateOf()
  assert.ok(Math.abs(state.board.now - asked) < 30_000, 'the board\'s clock is now')
  assert.equal(state.board.restart.state, 'none')
  assert.deepEqual([state.board.lastStop.from, state.board.lastStop.why], [before, 'restart'])
  assert.ok(state.board.lastStop.to > before + MIN, 'to is when this board started')
  assert.ok(state.board.loop.lastTickAt >= state.board.lastStop.to, 'the loop time is never before the start')
  assert.equal(existsSync(join(board, 'data', 'stop.json')), false, 'the record is taken at the start')
  assert.match(await readFile(join(board, 'data', 'history.jsonl'), 'utf8'), /"gap":true,"why":"restart"/)

  // The board starts itself anew on the page's click: it ends with the restart code and writes why.
  let exitedAt = null
  const gone = exited(first).then(code => {
    exitedAt = Date.now()
    return code
  })
  const answer = await fetch(`${base}/api/restart`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: '{}' })
  const restartAt = Date.now()
  assert.equal(answer.status, 200)
  // Gap 2 of the live proof: nothing runs, yet the board keeps answering "leaving" for a whole refresh (2 s here) and a
  // second, so a page that asks every refresh sees it before the board is gone.
  // 2026-11-02 (a gate flake under load: "leaving was seen for 1575 ms"): the window is measured as the board keeps it, from
  // the restart's answer to the board's exit, not between the first and last of the polls, which thin out under load.
  const leavingSeen = []
  for (let tries = 0; tries < 200 && first.exitCode === null; tries += 1) {
    try {
      const answered = await fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
      if (answered.board.restart.state === 'leaving') leavingSeen.push(Date.now())
    } catch {
      break
    }
    await new Promise(wait => setTimeout(wait, 100))
  }
  assert.equal(await gone, START_ANEW)
  assert.ok(leavingSeen.length > 0, 'the state said leaving')
  assert.ok(exitedAt - restartAt >= 2000, `the board left ${exitedAt - restartAt} ms after the restart's answer, less than the 2 s refresh`)
  const stopped = JSON.parse(await readFile(join(board, 'data', 'stop.json'), 'utf8'))
  assert.equal(stopped.why, 'restart')
  assert.ok(Math.abs(stopped.at - Date.now()) < 60_000)

  // The next start finds no gap (it ran a moment ago): no lastStop. Then its keeper goes: it stops, and says so.
  const second = await run(started, board)
  const again = (await stateOf()).state
  assert.equal(again.board.lastStop, null)
  assert.equal(existsSync(join(board, 'data', 'stop.json')), false)
  const ended = exited(second)
  second.disconnect()
  assert.equal(await ended, 0)
  assert.equal(JSON.parse(await readFile(join(board, 'data', 'stop.json'), 'utf8')).why, 'stopped')
})

const git = (dir, ...args) => promisify(execFile)('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { windowsHide: true })

test('one restart per landing (2026-11-21 00:34): while the board leaves, a second restart is refused with 409, whether land.ps1\'s POST came first and the self-update second, or the self-update first and the POST second', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-once-'))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const [board, project, app, transcripts] = ['board', 'project', 'app', 'transcripts'].map(name => join(dir, name))
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  await mkdir(join(project, '.claude', 'chats'), { recursive: true })
  await writeFile(join(project, '.claude', 'chats', 'list.json'), '{"prefix":"Studio · ","main":"Lead"}')
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({
    name: 'orchard', refreshSeconds: 2, project, port, gamePort: 7362, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'),
  }))
  // The copy is a git folder of its own, so the board knows the commit it runs and sees a newer one (B454).
  await git(board, 'init', '-q')
  await git(board, 'add', 'server.mjs', 'src')
  await git(board, 'commit', '-q', '-m', 'base')
  const base = `http://127.0.0.1:${port}`
  const tokenOf = async () => /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  const stateOf = token => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const restart = token => fetch(`${base}/api/restart`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: '{}' })

  // Order 1: land.ps1's POST first. A second ask while the board leaves (the self-update goes through the same door) is refused.
  const first = await run(started, board)
  const token = await tokenOf()
  assert.equal((await restart(token)).status, 200)
  const again = await restart(token)
  assert.equal(again.status, 409)
  assert.match(await again.text(), /restarts already/)
  assert.equal(await exited(first), START_ANEW, 'one restart: the board left once, for the new version')

  // Order 2: the self-update first. A newer server commit lands in the folder; the board decides to leave by itself; land.ps1's POST then is refused.
  const second = await run(started, board)
  const token2 = await tokenOf()
  assert.equal((await stateOf(token2)).board.restart.state, 'none')
  await writeFile(join(board, 'src', 'zz-newer.mjs'), 'export const newer = true\n')
  await git(board, 'add', 'src/zz-newer.mjs')
  await git(board, 'commit', '-q', '-m', 'newer server')
  let leaving = null
  for (let tries = 0; tries < 700 && leaving === null && second.exitCode === null; tries += 1) {
    const state = await stateOf(token2).catch(() => null)
    if (state?.board?.restart?.state === 'leaving') leaving = state.board.restart
    else await new Promise(wait => setTimeout(wait, 100))
  }
  assert.ok(leaving !== null, 'the board decided to start the new version by itself')
  const late = await restart(token2)
  assert.equal(late.status, 409, 'the landing\'s POST after the self-update is refused')
  assert.match(await late.text(), /restarts already/)
  assert.equal(await exited(second), START_ANEW)
})
