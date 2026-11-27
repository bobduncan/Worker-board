// P2.1 on a running board (chat 1's review, 2026-11-27: "untested wiring is where 'the fix did not work' comes from"): a hand's wake
// message answered by the app's slow 20-second "not delivered" goes through the hands route as a SENT message, the chat's own report
// makes it the wake, and the verdict ends as one line in data/wake-outcomes.jsonl; the courier's call reaches the state as `wakeCourierAt`.
// A copy of the board on a made-up project in a temporary folder (as test/wakeCarryBoard.test.mjs).

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
import { SLOW_START_WHY } from '../src/wake.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MIN = 60_000
const SPELL = NOW - 40 * MIN
/** The app's answer as the live hands brought it on 2026-11-25..27 (the session id and the project's name replaced). */
const SLOW_ANSWER = 'Message not delivered to session local_w2 ("Game - Worker 2"): "that session gave no sign of starting on it within 20s (it may be waiting for approval there, or still starting)". (delivery: undelivered; message_id: 00000000-0000-4000-8000-000000000001)'
/** The page's word to wake Worker 2 (a B577 wake word): a hand's job. */
const WAKE_WORD = { id: 'wakeword0000001', at: NOW - MIN, to: 'Main', ask: null, step: null, title: null, version: null, verdict: null, command: 'wake', about: 'Worker 2', text: 'The worker board holds words for you: run work next', state: 'waiting' }

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

async function until(check, what, ms = 60_000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within ${Math.round(ms / 1000)} s: ${what}`)
}

/** A board over a made-up project: Main and Worker 1 run (idle), Worker 2's session ended at SPELL (asleep); the page's wake word waits. */
async function boardWith(t) {
  const dir = await mkdtemp(join(tmpdir(), 'board-outcomes-'))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    await rm(dir, { recursive: true, force: true, maxRetries: 60, retryDelay: 500 })
  })
  const [board, project, app, transcripts] = ['board', 'project', 'app', 'transcripts'].map(name => join(dir, name))
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  const put = async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  await put(join(board, 'data', 'outbox.jsonl'), `${JSON.stringify(WAKE_WORD)}\n`)
  await put(join(board, 'data', 'wakes.json'), `${JSON.stringify({ wakes: {} })}\n`)
  const chats = join(project, '.claude', 'chats')
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main"}')
  const appChat = (name, sessionId, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId, cliSessionId, cwd: project, isArchived: false, createdAt: NOW - 600 * MIN, lastActivityAt: NOW - 2 * MIN })
  for (const [name, sessionId, cli, role] of [['Main', 'local_main', 'main-id', 'main'], ['Worker 1', 'local_w1', 'w1-id', 'worker'], ['Worker 2', 'local_w2', 'w2-id', 'worker']]) {
    await put(join(app, 'a', 'b', `${sessionId}.json`), appChat(name, sessionId, cli))
    if (name === 'Worker 2') continue
    await put(join(transcripts, `${cli}.jsonl`), `${[typed(NOW - 8 * MIN, 'Status?'), answer(NOW - 7 * MIN, 'All fine.')].join('\n')}\n`)
    await put(join(chats, `${cli}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW - MIN }))
  }
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'outcomes', refreshSeconds: 5, project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const { out } = await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_CARRY_BY_MODEL: '0', WORKER_BOARD_OPEN_STUB: join(dir, 'launches.jsonl') })
  const base = `http://127.0.0.1:${port}`
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const call = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.27.1' }, body: JSON.stringify(body) })
  const json = async (path, body) => {
    const reply = await call(path, body)
    const text = await reply.text()
    assert.equal(reply.status, 200, text)
    const parsed = JSON.parse(text)
    return parsed.result ?? parsed
  }
  for (const [chat, session] of [['Main', 'main-id'], ['Worker 1', 'w1-id']]) await json('/api/bridge/report', { chat, session, report: { state: 'idle', since: NOW - 2 * MIN, seq: 1, run: 1 } })
  await json('/api/bridge/report', { chat: 'Worker 2', session: 'w2-id', report: { state: 'ended', since: SPELL, seq: 1, run: 1 } })
  const claim = async () => (await json('/api/bridge/hands', { chat: 'Worker 1', session: 'w1-id', mod: '0.27.1', can: ['send'] })).jobs ?? []
  const words = async () => foldOutbox(await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8'))
  const record = async () => JSON.parse(await readFile(join(board, 'data', 'wakes.json'), 'utf8'))
  const outcomes = () => readFile(join(board, 'data', 'wake-outcomes.jsonl'), 'utf8').then(text => text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)), () => [])
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  const state = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  return { out, json, claim, words, record, outcomes, state }
}

test('P2.1 wired: the hand\'s slow answer is a sent wake on the board, the chat\'s report is the arrival, the outcome line is written, and the courier\'s call reaches the state', { timeout: 240_000 }, async t => {
  const { out, json, claim, words, record, outcomes, state } = await boardWith(t)
  // The courier has not called: the state says so (the rule wake-nothing-runs reads it).
  assert.equal((await state()).wakeCourierAt, null)
  // Worker 1's hand gets the page's wake word for Worker 2.
  let jobs = []
  await until(async () => {
    jobs = (await claim()).filter(job => job.id === WAKE_WORD.id)
    return jobs.length > 0
  }, 'the hand gets the wake word')
  assert.equal(jobs[0].chat, 'Worker 2')
  // The app's answer after its 20 seconds: the hand reports the job as failed with the app's words.
  const answered = Date.now()
  await json('/api/bridge/hands-done', { chat: 'Worker 1', session: 'w1-id', results: [{ id: WAKE_WORD.id, ok: false, why: SLOW_ANSWER }] })
  await until(async () => (await record()).wakes?.['Worker 2']?.at(-1)?.attempts.some(one => one.jobId === WAKE_WORD.id && one.slow === true), 'the record marks the attempt slow')
  const attempt = (await record()).wakes['Worker 2'].at(-1).attempts.find(one => one.jobId === WAKE_WORD.id)
  assert.equal(attempt.verdict, null, 'no verdict from the app\'s answer')
  assert.ok(Number.isFinite(attempt.sentAt) && attempt.sentAt >= answered - 1000, 'sent at the answer\'s time')
  assert.equal(attempt.by, 'Worker 1')
  assert.deepEqual(await outcomes(), [], 'no outcome line before the verdict')
  // The page: waking, with the slow words; the word itself went (settled as typed, not failed).
  await until(async () => (await state()).chats.find(lane => lane.name === 'Worker 2')?.wake?.state === 'sent', 'the lane reads the wake as sent')
  const lane = (await state()).chats.find(one => one.name === 'Worker 2')
  assert.match(lane.wake.words?.text ?? '', new RegExp(`^waking · message sent \\d\\d:\\d\\d by Worker 1 \\(${SLOW_START_WHY.replace(/[()]/g, '\\$&')}\\)$`))
  assert.match(out(), /Wake: the message to Worker 2 went at \d\d:\d\d \(Worker 1's hands\): the app took longer than 20 s to start it; the verdict waits for its own report\./)
  assert.equal((await words()).find(one => one.id === WAKE_WORD.id).state, 'delivered')
  // Worker 2 comes up 40 s later (a new run): the message's wake, one outcome line.
  await json('/api/bridge/report', { chat: 'Worker 2', session: 'w2-id', report: { state: 'idle', since: Date.now(), seq: 2, run: 2 } })
  await until(async () => (await outcomes()).length > 0, 'the outcome line')
  const lines = await outcomes()
  assert.equal(lines.length, 1)
  const [line] = lines
  assert.deepEqual([line.chat, line.path, line.by, line.carry, line.outcome, line.slow, line.why], ['Worker 2', 'message', 'Worker 1', null, 'arrived', true, null])
  assert.ok(Number.isFinite(line.at) && Number.isFinite(line.spell) && line.afterMs >= 0 && line.afterMs < 60_000, JSON.stringify(line))
  // The record's file follows a second later (WAKES_SAVE_MS).
  await until(async () => (await record()).wakes['Worker 2'].at(-1).attempts.find(one => one.jobId === WAKE_WORD.id).verdict === 'woke', 'the record says woke')
  assert.match(out(), /Wake: Worker 2 woke at \d\d:\d\d \(its own report after the message of \d\d:\d\d by Worker 1/)
  // The courier calls: the state carries when.
  const before = Date.now()
  await json('/api/bridge/wakes-due', {})
  await until(async () => Number.isFinite((await state()).wakeCourierAt), 'the courier\'s call in the state')
  assert.ok((await state()).wakeCourierAt >= before - 1000)
  await until(async () => Number.isFinite((await record()).courierAt), 'and in the record\'s file (a second later)')
})
