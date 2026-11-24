// F59 on a running board (a copy on a made-up project in a temporary folder), the real case of 2026-11-24: at 10:23 the app relaunched
// itself and every board chat's process ended; no hand claimed, the board launched five chats (all "the app did not start it") and the
// courier got an empty list at each run. Here five closed chats (Main, Workers 1, 2, 4 and 5) each have a word waiting, no hand claims
// (the hands' window, HANDS_GONE_MS, passes a minute after the board's start), and the copy records its launches in a file
// (WORKER_BOARD_OPEN_STUB) instead of starting the program.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { foldOutbox } from '../src/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const MIN = 60_000
const NAMES = ['Main', 'Worker 1', 'Worker 2', 'Worker 4', 'Worker 5']
const uuid = index => `${index}${index}${index}${index}${index}${index}${index}${index}-aaaa-4bbb-8ccc-dddddddddddd`
const appId = name => `local_${name.toLowerCase().replace(/ /g, '')}`
const sessionOf = name => uuid(NAMES.indexOf(name) + 1)
const pause = ms => new Promise(done => setTimeout(done, ms))

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
    await pause(250)
  }
  throw new Error(`Not within ${Math.round(ms / 1000)} s: ${what}`)
}

/**
 * A board whose five chats are closed: each reported its session ended at `spell` (40 minutes ago), none claims the hands. `waiting` the
 * chats a word (the person's answer) waits for; `attempts` more tries of each chat's spell, by name; `pause` the person's pause.
 */
async function boardOf(t, { waiting = NAMES, attempts = {}, pause: paused = null } = {}) {
  const now = Date.now()
  const spell = now - 40 * MIN
  const dir = await mkdtemp(join(tmpdir(), 'board-nohands-'))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    // B1304: Windows can hold a stopped board's files for seconds (EBUSY).
    await rm(dir, { recursive: true, force: true, maxRetries: 60, retryDelay: 500 })
  })
  const [board, project, app, transcripts] = ['board', 'project', 'app', 'transcripts'].map(name => join(dir, name))
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  const put = async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const lines = waiting.map((name, index) => ({ id: `answer00000000${index}`, at: now - 5 * MIN, to: name, ask: `chat:${name}`, step: null, title: null, version: null, verdict: null, text: 'Yes, go on.', state: 'waiting' }))
  await put(join(board, 'data', 'outbox.jsonl'), lines.length === 0 ? '' : `${lines.map(line => JSON.stringify(line)).join('\n')}\n`)
  const wakes = Object.fromEntries(Object.entries(attempts).map(([name, list]) => [name, [{ spell, attempts: list(spell, now), turnEndedAt: null, told: { failed: false, nobody: false } }]]))
  await put(join(board, 'data', 'wakes.json'), `${JSON.stringify({ wakes })}\n`)
  if (paused !== null) await put(join(project, '.claude', 'work', 'pause.json'), JSON.stringify(paused(now)))
  await put(join(project, '.claude', 'chats', 'list.json'), '{"prefix":"Game - ","main":"Main"}')
  for (const name of NAMES) {
    await put(join(app, 'a', 'b', `${appId(name)}.json`), JSON.stringify({ title: `Game - ${name}`, sessionId: appId(name), cliSessionId: sessionOf(name), cwd: project, isArchived: false, createdAt: now - 600 * MIN, lastActivityAt: spell }))
  }
  await mkdir(transcripts, { recursive: true })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'nohands', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const launchFile = join(dir, 'launches.jsonl')
  const { out } = await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_CARRY_BY_MODEL: '0', WORKER_BOARD_OPEN_STUB: launchFile })
  const upAt = Date.now()
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
  // Every chat's session ended at `spell`: none runs (the app's relaunch).
  for (const name of NAMES) await json('/api/bridge/report', { chat: name, session: sessionOf(name), report: { state: 'ended', since: spell, seq: 1, run: 1 } })
  const claim = async name => (await json('/api/bridge/hands', { chat: name, session: sessionOf(name), mod: '0.27.1', can: ['send'] })).jobs ?? []
  const courier = async () => (await json('/api/bridge/wakes-due', {})).wakes
  const words = async () => foldOutbox(await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8'))
  const carried = async () => (await words()).filter(one => one.command === 'wake-carry')
  const record = async () => JSON.parse(await readFile(join(board, 'data', 'wakes.json'), 'utf8'))
  const launches = () => readFile(launchFile, 'utf8').then(text => text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)), () => [])
  /** Waits until the hands' window (a minute) has passed since the board's start: from then no hand runs. */
  const handsGone = () => pause(Math.max(0, upAt + 65_000 - Date.now()))
  return { out, call, json, claim, courier, words, carried, record, launches, handsGone, spell }
}

test('F59, the 10:23 case: no hand, five wakes due, the courier calling: ONE courier word each, no launch before its window, none for a hand that comes back; the courier takes each once', { timeout: 300_000 }, async t => {
  const { claim, courier, carried, record, launches } = await boardOf(t)
  // The courier calls while the hands' window still runs: from now the board counts on it; nothing is due yet.
  assert.deepEqual(await courier(), [])
  // The wake pass once the hands' window passed (once a minute): one word for each closed chat, all to the courier.
  await until(async () => (await carried()).length >= NAMES.length, 'a courier word for each closed chat', 150_000)
  // A moment for a launch that would come in the same pass.
  await pause(3000)
  const first = await carried()
  assert.deepEqual(first.map(one => [one.about, one.to, one.state]).sort(), NAMES.map(name => [name, 'the courier', 'waiting']), JSON.stringify(first))
  assert.deepEqual(await launches(), [], 'no launch while the courier\'s words wait (the board-wide one neither)')
  // A hand comes back while the words wait: no message job for any of them, and no second word.
  const jobs = await claim('Main')
  assert.deepEqual(jobs.filter(job => NAMES.includes(job.chat)), [], JSON.stringify(jobs))
  // The courier's run: each word once; then nothing.
  const due = await courier()
  assert.deepEqual(due.map(one => one.chat).sort(), [...NAMES].sort())
  assert.deepEqual(due.map(one => one.session).sort(), NAMES.map(appId).sort())
  assert.deepEqual(await courier(), [], 'never handed twice')
  assert.equal((await carried()).length, NAMES.length, 'never a second word for a spell')
  await until(async () => {
    const saved = await record()
    return NAMES.every(name => Number.isFinite(saved.wakes[name]?.at(-1)?.attempts?.[0]?.heldAt))
  }, 'the hand-offs saved', 10_000)
  const kept = await record()
  for (const name of NAMES) assert.deepEqual(kept.wakes[name].at(-1).attempts.map(one => [one.path, one.by, one.carry]), [['message', 'the courier', 'courier']], name)
  assert.deepEqual(await launches(), [])
})

test('F59: the courier\'s window passed untaken: the launch goes (the main chat first), and the courier gets no second word', { timeout: 300_000 }, async t => {
  // Each chat's courier word went 16 minutes ago and was never taken: failed (wake.mjs `pass`, COURIER_WAIT_MS).
  const untaken = name => (spell, now) => [{ path: 'message', at: now - 16 * MIN, by: 'the courier', jobId: `c0c0c0c0c0c0c0${NAMES.indexOf(name)}0`, sentAt: null, runBefore: 1, verdict: 'failed', verdictAt: now - MIN, why: 'the scheduled courier did not carry the message within 10 minutes', step: null, carry: 'courier' }]
  const { courier, carried, launches, handsGone } = await boardOf(t, { attempts: Object.fromEntries(NAMES.map(name => [name, untaken(name)])) })
  assert.deepEqual(await courier(), [])
  await until(async () => (await launches()).length >= 1, 'the first launch')
  assert.deepEqual((await launches())[0].chat, 'Main')
  assert.equal((await launches())[0].session, sessionOf('Main'))
  // Past the hands' window, the courier calling: the next launch, one per check; still no word for the courier.
  await handsGone()
  await courier()
  await until(async () => (await launches()).length >= 2, 'the next launch, no hand and the courier calling', 150_000)
  assert.deepEqual((await carried()).filter(one => ['waiting', 'taken'].includes(one.state)), [], 'one word per chat per spell: the courier\'s was its one')
  assert.equal(new Set((await launches()).map(one => one.chat)).size, (await launches()).length, 'each chat launched once')
})

test('F59 point 3: a launch that failed before the courier called: at the courier\'s next call its word is made and handed in that very call', { timeout: 300_000 }, async t => {
  // 10:24 Worker 4's launch, which the app did not start (2 minutes without its report). Only Worker 4 has a word waiting.
  const launchFailed = (spell, now) => [{ path: 'launch', at: now - 20 * MIN, by: 'board', jobId: `launch:${now - 20 * MIN}:Worker 4`, sentAt: now - 20 * MIN, runBefore: 1, verdict: 'failed', verdictAt: now - 18 * MIN, why: 'the app did not start it', step: null }]
  const { courier, record, launches, handsGone } = await boardOf(t, { waiting: ['Worker 4'], attempts: { 'Worker 4': launchFailed } })
  // No courier yet; past the hands' window the spell would end here ("could not wake").
  await handsGone()
  const due = await courier()
  assert.deepEqual(due.map(one => [one.chat, one.session]), [['Worker 4', appId('Worker 4')]], 'handed in the call that found it')
  await until(async () => (await record()).wakes['Worker 4'].at(-1).attempts.length === 2, 'the courier\'s attempt saved', 10_000)
  const attempts = (await record()).wakes['Worker 4'].at(-1).attempts
  assert.deepEqual(attempts.map(one => [one.path, one.verdict, one.carry ?? null]), [['launch', 'failed', null], ['message', null, 'courier']])
  assert.deepEqual(await courier(), [], 'once')
  assert.deepEqual((await launches()).filter(one => one.chat === 'Worker 4'), [], 'Worker 4 is not launched again')
})

test('F59: the person\'s pause holds it: no hand, the courier calling, nothing for it and no launch', { timeout: 300_000 }, async t => {
  const { courier, carried, launches, handsGone } = await boardOf(t, { pause: now => ({ state: 'pausing', since: now - 2 * MIN, by: 'person' }) })
  assert.deepEqual(await courier(), [])
  await handsGone()
  assert.deepEqual(await courier(), [], 'the courier\'s call makes no word while the person pauses')
  // Past a wake pass with no hand and the courier calling.
  await pause(10_000)
  assert.deepEqual(await carried(), [])
  assert.deepEqual(await launches(), [])
})
