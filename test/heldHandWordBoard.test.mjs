// B880, end to end on a running board: the real case of X2 (outbox 20e17b272740a56f), the board's word to start the Product
// owner, taken by Worker 2's hand at 12:22 and held without a word of it. With the Product owner on the board the word is moot:
// it goes back and the sweep closes it, no hand gets it. Without the Product owner it goes back and the next hand gets it; a
// hand that gives it back unsent leaves it waiting, and its late answer that it went keeps it delivered (never sent twice). A
// copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { foldOutbox } from '../src/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MIN = 60_000
const ID = '20e17b272740a56f'

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

// The real word, sent and taken by Worker 2's hand `ago` minutes back (its lines in data/outbox.jsonl, at today's times): half an
// hour in the real case; four minutes, just past the hands' hold, where the word still matters and is not yet late.
const realLines = ago => [
  { id: ID, at: NOW - (ago + 1) * MIN, to: 'Main', ask: null, step: null, title: null, version: null, verdict: null, command: 'spawn', count: 1, why: 'owner', about: 'Product owner',
    routine: { role: 'owner', title: 'Game - Product owner', tasks: ['project-product-owner', 'project-product-owner-2'] },
    text: 'start the Product owner\nIts chat "Game - Product owner" is not on the board, and the person\'s talks wait for it.', state: 'waiting' },
  { id: ID, state: 'taken', takenAt: NOW - ago * MIN, takenBy: 'Worker 2', handTakenAt: NOW - ago * MIN },
]

/** A board over the made-up project; with `owner`, the Product owner's chat is on it. */
async function boardWith(t, { owner, ago }) {
  const dir = await mkdtemp(join(tmpdir(), 'board-held-'))
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
  await put(join(board, 'data', 'outbox.jsonl'), `${realLines(ago).map(line => JSON.stringify(line)).join('\n')}\n`)
  const chats = join(project, '.claude', 'chats')
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main","owner":"Product owner"}')
  const appChat = (name, sessionId, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId, cliSessionId, cwd: project, isArchived: false, createdAt: NOW - 600 * MIN, lastActivityAt: NOW - 2 * MIN })
  const chatsOf = [['Main', 'local_main', 'main-id', 'main'], ['Worker 1', 'local_w1', 'w1-id', 'worker'], ['Worker 2', 'local_w2', 'w2-id', 'worker'], ...(owner ? [['Product owner', 'local_owner', 'owner-id', 'worker']] : [])]
  for (const [name, sessionId, cli, role] of chatsOf) {
    await put(join(app, 'a', 'b', `${sessionId}.json`), appChat(name, sessionId, cli))
    await put(join(transcripts, `${cli}.jsonl`), `${[typed(NOW - 8 * MIN, 'Status?'), answer(NOW - 7 * MIN, 'All fine.')].join('\n')}\n`)
    await put(join(chats, `${cli}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW - MIN }))
  }
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'held', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const { out } = await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const base = `http://127.0.0.1:${port}`
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const call = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.27.1' }, body: JSON.stringify(body) })
  for (const [chat, session] of [['Worker 1', 'w1-id'], ['Worker 2', 'w2-id'], ...(owner ? [['Product owner', 'owner-id']] : [])]) {
    const sent = await call('/api/bridge/report', { chat, session, report: { state: 'idle', since: NOW - 2 * MIN, seq: 1, run: 1 } })
    assert.equal(sent.status, 200, await sent.text())
  }
  const claim = async () => {
    const reply = await call('/api/bridge/hands', { chat: 'Worker 1', session: 'w1-id', mod: '0.27.1', can: ['send', 'spawn'] })
    const body = JSON.parse(await reply.text())
    assert.equal(reply.status, 200, JSON.stringify(body))
    return body.jobs ?? body.result?.jobs ?? []
  }
  const word = async () => foldOutbox(await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8')).find(one => one.id === ID)
  return { out, call, claim, word }
}

test('the real case with the Product owner on the board: the held word goes back and is closed as moot; no hand runs the routine again', { timeout: 240_000 }, async t => {
  const { out, claim, word } = await boardWith(t, { owner: true, ago: 30 })
  for (let at = 0; at < 3; at += 1) {
    assert.deepEqual((await claim()).filter(job => job.id === ID), [], `claim ${at}`)
    await new Promise(done => setTimeout(done, 500))
  }
  await until(async () => (await word()).state === 'dropped', 'the word closed')
  const closed = await word()
  assert.equal(closed.why, 'Product owner is on the board now')
  assert.equal(closed.takenBy, null)
  assert.match(out(), new RegExp(`B880: gave back the word ${ID} \\(spawn Product owner\\) that Worker 2's hand held since \\d\\d:\\d\\d without a word of it\\.`))
})

test('the real case without the Product owner: the held word goes to the next hand; given back unsent it waits again, and a late send keeps it delivered', { timeout: 240_000 }, async t => {
  const { call, claim, word } = await boardWith(t, { owner: false, ago: 4 })
  let jobs = []
  await until(async () => {
    jobs = (await claim()).filter(job => job.id === ID)
    return jobs.length > 0
  }, 'the spawn job for Worker 1')
  assert.deepEqual(jobs.map(job => [job.chat, job.spawn.title, job.spawn.tasks]), [['Game - Product owner', 'Game - Product owner', ['project-product-owner', 'project-product-owner-2']]])
  assert.equal((await word()).takenBy, 'Worker 1')
  // Worker 1's call gave no answer in two minutes: it gives the word back unsent; no try is spent, it waits again.
  const back = await call('/api/bridge/hands-done', { chat: 'Worker 1', session: 'w1-id', results: [{ id: ID, ok: false, back: true, why: 'the app gave no answer within 2 minutes: given back for another hand' }] })
  assert.equal(back.status, 200, await back.text())
  const waiting = await word()
  assert.deepEqual([waiting.state, waiting.takenBy, waiting.backFrom, waiting.tries], ['waiting', null, 'Worker 1', undefined])
  // Another hand's late word changes nothing; Worker 1's late answer that it went: delivered, and no hand gets it again.
  await call('/api/bridge/hands-done', { chat: 'Worker 2', session: 'w2-id', results: [{ id: ID, ok: true }] })
  assert.equal((await word()).state, 'waiting')
  await call('/api/bridge/hands-done', { chat: 'Worker 1', session: 'w1-id', results: [{ id: ID, ok: true }] })
  assert.equal((await word()).state, 'delivered')
  assert.deepEqual((await claim()).filter(job => job.id === ID), [])
})
