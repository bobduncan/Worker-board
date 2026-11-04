// Fix 0.31.0, part 1 on a running board (the harness of handoverLive.test.mjs): the Workers mod says its version in the
// X-Workers-Mod header of every call; the board keeps it per chat. The typed route (where the mod posts the clear's stages,
// at the very moment its session moves) used to be left out of the header's merge, and a call that said no version erased the
// known one: Worker 1's 0.31.0 became unknown at 21:22 on 2026-11-04. Here the real routes: a chat whose FIRST call is a typed
// one is known by its header, a typed call after a call with the header keeps 0.31.0 (with or without a header of its own), and
// a chat whose mod never says a version stays unknown. Made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
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
  for (const end = Date.now() + 60_000; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 250))
  }
  throw new Error(`Not within 60 s: ${what}`)
}

test('the typed route says the mod too: a chat first heard on a typed call is known by its header; no later call without a version erases it; a mod that never says one stays unknown', { timeout: 240_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-typed-mod-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Team - ","main":"Lead","afterStep":"clear"}')
  const names = [['Lead', 'lead-id'], ['Fresh', 'fresh-id'], ['Known', 'known-id'], ['Old', 'old-id']]
  for (const [name, session] of names) {
    await put(join(chats, `${session}.json`), JSON.stringify({ name, role: name === 'Lead' ? 'main' : 'worker', state: 'waiting', task: null, at: NOW }))
    await put(join(app, 'a', 'b', `local_${name}.json`), JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: session, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW }))
    await put(join(transcripts, `${session}.jsonl`), `${[typed(NOW - 40 * MIN, 'Go on.'), answer(NOW - 30 * MIN, 'Done.')].join('\n')}\n`)
  }
  await writeStore(join(project, '.claude', 'work'), { items: new Map(), activities: [] }, undefined, { now: NOW - 60 * MIN })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'typed-mod', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), refreshSeconds: 5, handOutBeyondFocus: true, handover: 'sequence' }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const base = `http://127.0.0.1:${port}`
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  /** One call of a chat's mod to the bridge; `mod` undefined sends no X-Workers-Mod header (an older mod). */
  const call = (path, body, mod) => fetch(`${base}/api/bridge/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, ...(mod === undefined ? {} : { 'X-Workers-Mod': mod }) }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  assert.ok(token, 'the served page carries the token')
  const lane = async name => (await fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())).chats.find(chat => chat.name === name)
  const modOf = async name => (await lane(name))?.mod ?? null
  const NEW = '0.31.0'
  let seq = 0
  const ping = (name, session, mod) => call('take', { chat: name, session, report: { run: 1, seq: (seq += 1), state: 'idle', since: Date.now(), background: false } }, mod)
  const post = (name, session, mod) => call('typed', { chat: name, session, stages: [{ stage: 'cleared', at: Date.now(), session: `${session}-new` }] }, mod)

  // Fresh: the very first call the board hears of it is a typed one (a board just restarted, a mod posting a stage first).
  assert.equal((await post('Fresh', 'fresh-id', NEW)).status, 200)
  await until(async () => (await modOf('Fresh')) === NEW, 'a chat first heard on a typed call is known by its header')
  assert.equal((await lane('Fresh')).onSequence, true)

  // Known: a call with the header (whoami: it makes no report, so only the board's note of the mod can tell), then a typed call with it
  // (the real case), then one with no header at all: 0.31.0 stays.
  assert.equal((await call('whoami', { session: 'known-id' }, NEW)).status, 200)
  await until(async () => (await modOf('Known')) === NEW, 'the mod said by a whoami call')
  assert.equal((await post('Known', 'known-id', NEW)).status, 200)
  assert.equal((await post('Known', 'known-id', undefined)).status, 200)
  await new Promise(done => setTimeout(done, 6_000))
  assert.equal(await modOf('Known'), NEW, 'a typed call that said no version erased nothing')
  assert.equal((await lane('Known')).onSequence, true)

  // Old: a mod that never says a version (older than 0.16.0) stays unknown, take or typed.
  assert.equal((await ping('Old', 'old-id', undefined)).status, 200)
  assert.equal((await post('Old', 'old-id', undefined)).status, 200)
  await new Promise(done => setTimeout(done, 6_000))
  assert.equal(await modOf('Old'), null)
  assert.equal((await lane('Old')).onSequence, false)
})
