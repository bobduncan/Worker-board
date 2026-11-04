// B1011 (the test B978 lacked), end to end on a running board: what forces the board to rebuild its state. A copy of the board on a
// made-up project in a temporary folder only, with its state kept for an hour (WORKER_BOARD_STATE_MS) so that only a reset makes
// it read anew, and a file of one line per rebuild (WORKER_BOARD_READ_LOG). B978 cut two forced rebuilds that changed nothing:
// Autopilot's pass for the main chat (once a refresh) and the whoami of a session the board shows under no name (once a second,
// for ever). Each is pinned here, with the case beside it that must still rebuild.

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
const MOD = '0.31.0'
const pause = ms => new Promise(done => setTimeout(done, ms))

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

async function until(check, what) {
  for (const end = Date.now() + 90_000; Date.now() < end;) {
    const found = await check()
    if (found) return found
    await pause(200)
  }
  throw new Error(`Not within 90 s: ${what}`)
}

/** A board copy with a main chat (Lead) and a worker (Digger), Autopilot on, its state kept an hour; what the tests call it by. */
async function startBoard(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `board-${name}-`))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const [board, project, app, transcripts] = ['board', 'project', 'app', 'transcripts'].map(part => join(dir, part))
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  const put = async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const chats = join(project, '.claude', 'chats')
  await put(join(chats, 'list.json'), '{"prefix":"Garden · ","main":"Lead"}')
  const appChat = (chat, cliSessionId) => JSON.stringify({ title: `Garden · ${chat}`, sessionId: `local_${chat}`, cliSessionId, cwd: project, isArchived: false, createdAt: chat.length, lastActivityAt: NOW })
  for (const [id, chat, role] of [['lead-id', 'Lead', 'main'], ['digger-id', 'Digger', 'worker']]) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name: chat, role, state: 'waiting', task: null, at: NOW }))
    await put(join(app, 'a', 'b', `local_${chat.toLowerCase()}.json`), appChat(chat, id))
    await put(join(transcripts, `${id}.jsonl`), `${typed(NOW - 9 * MIN, 'Status?')}\n${answer(NOW - 8 * MIN, 'All fine.')}\n`)
  }
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Garden\n- [ ] B12 Plant the hedge (for Digger; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: name, project, port, gamePort: 7380, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), autopilot: true, refreshSeconds: 5 }))
  const log = join(dir, 'rebuilds.log')
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_STATE_MS: String(60 * MIN), WORKER_BOARD_READ_LOG: log })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const base = `http://127.0.0.1:${port}`
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  assert.ok(token, 'the served page carries the token')
  const bridge = (path, body) => fetch(`${base}/api/bridge/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': MOD }, body: JSON.stringify(body) })
    .then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  return {
    board,
    work,
    state: () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json()),
    bridge,
    whoami: session => bridge('whoami', { session }),
    asChat: (chat, body) => bridge('work', { chat, session: `${chat.toLowerCase()}-id`, ...body }),
    /** When the board rebuilt its state, each time since it started (ms), oldest first. */
    rebuilt: async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(Number),
    outbox: async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text)),
  }
}

test('B978: Autopilot\'s pass for the main chat that neither drops nor sends a word keeps the board\'s state; one that sends a word resets it', { timeout: 300_000 }, async t => {
  const board = await startBoard(t, 'pass')
  // The main chat runs and is free; the board has settled when its rebuilds stop for a refresh.
  assert.equal((await board.bridge('report', { chat: 'Lead', session: 'lead-id', report: { state: 'idle', since: NOW - 2 * MIN, seq: 1, run: 1 } })).status, 200)
  await board.state()
  await pause(6_000)
  await board.state()
  const settled = (await board.rebuilt()).length

  // Two refreshes with Autopilot on and nothing to ask the main chat: each pass looks, changes nothing, and the state stands.
  await pause(12_000)
  assert.equal((await board.rebuilt()).length, settled, 'an Autopilot pass that changed nothing threw the state away')

  // A pass that sends the main chat its word does reset it: the next read rebuilds after the word (an hour's cache otherwise).
  assert.equal((await board.asChat('Digger', { action: 'take', minutes: 30, id: 'B12', branch: 'b12' })).status, 200)
  const ask = await board.asChat('Digger', { action: 'ask', of: 'B12', kind: 'do', title: 'Merge B12 into main', text: 'Merge B12 into main once its check passed.' })
  assert.equal(ask.status, 200, JSON.stringify(ask.body))
  const word = await until(async () => (await board.outbox()).find(one => one.to === 'Lead' && one.kind === 'main-ask'), 'the main chat\'s word')
  // (The pass resets it when the word is written down, a moment after it stands in the outbox: read until then.)
  let rebuiltAfter = false
  for (const end = Date.now() + 5_000; Date.now() < end && !rebuiltAfter;) {
    await board.state()
    rebuiltAfter = (await board.rebuilt()).some(at => at >= word.at)
    if (!rebuiltAfter) await pause(100)
  }
  assert.ok(rebuiltAfter, 'the pass that sent a word did not reset the state')
})

test('B978: a session the board shows under no name costs a rebuild at most once a second for 30 s, and then at most one in 30 s; a read under a second old is not thrown away; a named session costs none', { timeout: 300_000 }, async t => {
  const board = await startBoard(t, 'whoami')
  await board.state()
  await pause(1_500)
  const count = async () => (await board.rebuilt()).length

  // A named session asks again and again: the board answers from the state it keeps.
  const before = await count()
  for (let ask = 0; ask < 5; ask += 1) {
    assert.deepEqual((await board.whoami('digger-id')).body, { name: 'Digger', role: 'worker', card: null })
    await pause(300)
  }
  assert.equal(await count(), before, 'a named session\'s whoami threw the state away')

  // Two sessions of no chat, half a second apart, each asking once a second: the first of each second reads anew, the second finds
  // a state read half a second ago and keeps it. A rebuild for each ask would be twelve in six seconds, one a second is six.
  const first = Date.now()
  const start = await count()
  for (let second = 0; second < 6; second += 1) {
    assert.equal((await board.whoami('ghost-a')).status, 200)
    await pause(500)
    assert.equal((await board.whoami('ghost-b')).status, 200)
    await pause(500)
  }
  const early = (await count()) - start
  assert.ok(early >= 3, `an unnamed session's whoami read the state anew only ${early} times in six seconds: a chat the app lists later would wait`)
  assert.ok(early <= 8, `${early} rebuilds in six seconds from two unnamed sessions: a state read under a second ago was thrown away`)

  // The first 30 s over, the one session keeps asking every second: its read anew comes once in 30 s, not once a second for ever.
  while (Date.now() - first < 32_000) {
    await board.whoami('ghost-a')
    await pause(1_000)
  }
  const settled = await count()
  for (let second = 0; second < 20; second += 1) {
    assert.equal((await board.whoami('ghost-a')).status, 200)
    await pause(1_000)
  }
  const late = (await count()) - settled
  assert.ok(late <= 2, `${late} rebuilds in 20 s from one unnamed session that asked every second after its first 30 s`)
})
