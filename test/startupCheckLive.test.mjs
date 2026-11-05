// The start-up check on a running board (the harness of handoverLive.test.mjs): a copy of the board on a made-up project in a
// temporary folder. The app's folder holds two accounts: the one in use (the lead, a worker, and a stale copy of a second
// worker) and an older one with that second worker's real chat. The kept report of the second worker names the real chat
// (data/reports.json), as after an account switch. Checks: it runs at the board's start and the Overview's state carries its
// line (the account switch in ONE line) and data/check.json; the button answers at once with "running"; a report with a new
// run starts one app-restart check.

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

async function until(check, what, ms = 60_000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 250))
  }
  throw new Error(`Not within ${ms / 1000} s: ${what}`)
}

test('the start-up check on a running board: it runs at the start and names the account switch in one line; the button answers at once; a new run starts one more', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-check-'))
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
  const appChat = (name, cliSessionId, extra = {}) => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW, completedTurns: 5, ...extra })
  // The account in use: the lead, a worker, and a stale copy of the second worker (older, with its own id).
  for (const [name, session] of [['Lead', 'lead-id'], ['Units', 'units-id']]) {
    await put(join(app, 'new-account', 'org', `local_${name}.json`), appChat(name, session))
    await put(join(transcripts, `${session}.jsonl`), `${[typed(NOW - 40 * MIN, 'Go on.'), answer(NOW - 30 * MIN, 'Done.')].join('\n')}\n`)
  }
  await put(join(app, 'new-account', 'org', 'local_PropsOld.json'), appChat('Props', 'props-old', { sessionId: 'local_PropsOld', lastActivityAt: NOW - 60 * MIN }))
  // The older account: the real chat of the second worker.
  await put(join(app, 'old-account', 'org', 'local_PropsReal.json'), appChat('Props', 'props-real', { sessionId: 'local_PropsReal', lastActivityAt: NOW - 5 * 60 * MIN }))
  // Its kept report names the real chat, as before the switch.
  const report = { state: 'ended', since: NOW - 6 * 60 * MIN, background: false, run: NOW - 7 * 60 * MIN, seq: 3, at: NOW - 6 * 60 * MIN, session: 'props-real', mod: '0.31.0', busyAt: null, app: 'local_PropsReal' }
  await put(join(board, 'data', 'reports.json'), JSON.stringify({ reports: { Props: report } }))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'check', project, port, gamePort: 7330, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), refreshSeconds: 5 }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const base = `http://127.0.0.1:${port}`
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  assert.ok(token, 'the served page carries the token')
  const stateOf = async () => (await fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } })).json()
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))

  // At the start: one check, its line in the state and data/check.json.
  let check = null
  await until(async () => { check = (await stateOf()).check; return check !== null && check.running === false }, 'the start check ended')
  assert.equal(check.trigger, 'start')
  const lane = (await stateOf()).chats.find(one => one.name === 'Props')
  assert.deepEqual(check.elsewhere, ['Props'], JSON.stringify({ check, appSession: lane?.appSession, own: lane?.own, session: lane?.session }))
  assert.match(check.line, /^2 of 3 chats reachable · checked \d\d:\d\d · Props's chats are in your other Claude account: run \/reimport-chats, then restart the app$/)
  assert.equal(check.tone, 'attention')
  assert.doesNotMatch(check.line, /not in the app's list|open its chat/)
  const saved = JSON.parse(await readFile(join(board, 'data', 'check.json'), 'utf8'))
  assert.deepEqual([saved.line, saved.trigger, saved.running], [check.line, 'start', false])

  // The button: an answer within a second that says "running"; then the result with its trigger.
  const begun = Date.now()
  const clicked = await fetch(`${base}/api/check`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: '{}' })
  assert.equal(clicked.status, 200, await clicked.clone().text())
  assert.equal((await clicked.json()).running, true)
  assert.ok(Date.now() - begun < 1000, 'answered at once')
  await until(async () => { const now = (await stateOf()).check; return now?.trigger === 'button' && now.running === false }, 'the button check ended')
  // Not from another page.
  const foreign = await fetch(`${base}/api/check`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: 'http://example.test' }, body: '{}' })
  assert.equal(foreign.status, 403)

  // A report with a new run (some session started): one app-restart check follows within the debounce.
  const reply = await fetch(`${base}/api/bridge/take`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.31.0' },
    body: JSON.stringify({ chat: 'Units', session: 'units-id', report: { state: 'idle', since: Date.now(), background: false, run: Date.now(), seq: 1 } }),
  })
  assert.equal(reply.status, 200, await reply.text())
  await until(async () => (await stateOf()).check?.trigger === 'app-restart', 'the app-restart check', 40_000)
})
