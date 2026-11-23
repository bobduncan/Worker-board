// B1307 (chat 1's core review, point 7): the server's own look on a running board (a copy on a made-up project in a temporary folder).
// Worker 1 waits on "chat 1" and Worker 2 on "chat 3", both past the limit; the local side-chats.json knows only chat 1, by a fake id.
// Over several looks and a board restart there is exactly one record per wait: one word a hand sends to chat 1's id, one "could not
// go" record for chat 3 with the card saying why. Fake ids only.

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
import { stamp } from '../src/work/migrate.mjs'
import { SIDE_WORD } from '../src/work/sideWord.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MIN = 60_000
const SINCE = NOW - 95 * MIN
const FAKE_SIDE = 'local_fake-side-chat-1'

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(started, board, env) {
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, ...env, WORKER_BOARD_TICK_MS: '500', WORKER_BOARD_CHILD: '1' }, windowsHide: true })
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
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within 60 s: ${what}`)
}

const step = (id, owner, who) => `${[
  `Id: ${id}`, 'Kind: step', `Title: Step ${id}`, 'State: in progress', `Owner: ${owner}`, 'Activity: Art', `Waits on: ${who} · its review · ${stamp(SINCE).slice(0, 16)}`,
  `Since: ${stamp(NOW - 200 * MIN)}`, `Branch: ${id.toLowerCase()}-work`, 'Taken for: 60 min', 'Refined: ready',
].join('\n')}\n\n## History\n- ${stamp(NOW - 200 * MIN)} ${owner}: taken → in progress\n`

test('over two looks and a restart: exactly one word to chat 1 by a hand, exactly one "could not go" record for chat 3 and its card', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-side-'))
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
  await put(join(board, 'data', 'outbox.jsonl'), '')
  await put(join(project, '.claude', 'side-chats.json'), JSON.stringify({ 'chat 1': [FAKE_SIDE] }))
  await put(join(project, '.claude', 'work', 'B901.md'), step('B901', 'Worker 1', 'chat 1'))
  await put(join(project, '.claude', 'work', 'B902.md'), step('B902', 'Worker 2', 'chat 3'))
  await put(join(project, '.claude', 'work', 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Art', steps: ['B901', 'B902'] }] }, null, 1)}\n`)
  const chats = join(project, '.claude', 'chats')
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main"}')
  const appChat = (title, sessionId, cliSessionId) => JSON.stringify({ title, sessionId, cliSessionId, cwd: project, isArchived: false, createdAt: NOW - 600 * MIN, lastActivityAt: NOW - 2 * MIN })
  await put(join(app, 'a', 'b', `${FAKE_SIDE}.json`), appChat('A side chat', FAKE_SIDE, 'side-id'))
  for (const [name, sessionId, cli, role] of [['Main', 'local_main', 'main-id', 'main'], ['Worker 1', 'local_w1', 'w1-id', 'worker'], ['Worker 2', 'local_w2', 'w2-id', 'worker']]) {
    await put(join(app, 'a', 'b', `${sessionId}.json`), appChat(`Game - ${name}`, sessionId, cli))
    await put(join(transcripts, `${cli}.jsonl`), `${[typed(NOW - 8 * MIN, 'Status?'), answer(NOW - 7 * MIN, 'All fine.')].join('\n')}\n`)
    await put(join(chats, `${cli}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW - MIN }))
  }
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'side', project, port, gamePort: 7341, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const env = { CLAUDE_CONFIG_DIR: join(dir, 'claude-config'), WORKER_BOARD_HOME: join(dir, 'pc') }
  const base = `http://127.0.0.1:${port}`
  const start = async () => {
    const child = await run(started, board, env)
    const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
    return { child, key }
  }
  let { child, key } = await start()
  const call = async (path, body) => {
    const reply = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.27.1' }, body: JSON.stringify(body) })
    const text = await reply.text()
    assert.equal(reply.status, 200, text)
    const parsed = JSON.parse(text)
    return parsed.result ?? parsed
  }
  const reportAll = async () => {
    for (const [chat, session] of [['Main', 'main-id'], ['Worker 1', 'w1-id'], ['Worker 2', 'w2-id']]) await call('/api/bridge/report', { chat, session, report: { state: 'idle', since: NOW - 2 * MIN, seq: 1, run: 1 } })
  }
  await reportAll()
  const sides = async () => foldOutbox(await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8')).filter(one => one.command === SIDE_WORD)
  const byWho = async who => (await sides()).filter(one => one.about === who)
  const looks = () => new Promise(done => setTimeout(done, 2_500))

  // The first look: one word for chat 1, one record for chat 3. Two more looks: no second.
  await until(async () => (await sides()).length >= 2, 'a record for each late wait')
  await looks()
  assert.equal((await byWho('chat 1')).length, 1)
  assert.equal((await byWho('chat 3')).length, 1)
  const [word] = await byWho('chat 1')
  const [record] = await byWho('chat 3')
  assert.deepEqual([word.state, word.session, word.step], ['waiting', FAKE_SIDE, 'B901'])
  assert.match(word.text, /^The worker board: Worker 1 waits for you on B901 since \d\d:\d\d \(its review\)\./)
  assert.deepEqual([record.state, record.text, record.step], ['dropped', '', 'B902'])
  assert.match(record.why, /chat 3 is not known to the board/)

  // A hand sends it, once, to chat 1's own id; the next claim has no job for it.
  const { jobs } = await call('/api/bridge/hands', { chat: 'Worker 2', session: 'w2-id', mod: '0.27.1', can: ['send'] })
  assert.deepEqual(jobs.filter(job => job.id === word.id).map(job => [job.to, job.chat]), [[FAKE_SIDE, 'chat 1']])
  await call('/api/bridge/hands-done', { chat: 'Worker 2', session: 'w2-id', results: [{ id: word.id, ok: true }] })
  await until(async () => (await byWho('chat 1'))[0].state === 'delivered', 'the word delivered')
  const again = await call('/api/bridge/hands', { chat: 'Worker 2', session: 'w2-id', mod: '0.27.1', can: ['send'] })
  assert.deepEqual(again.jobs.filter(job => job.id === word.id), [])

  // A restart: the outbox keeps both, so no look says a second one.
  await stop(child)
  ;({ child, key } = await start())
  await reportAll()
  await looks()
  await looks()
  assert.deepEqual((await byWho('chat 1')).map(one => [one.id, one.state]), [[word.id, 'delivered']])
  assert.deepEqual((await byWho('chat 3')).map(one => [one.id, one.state]), [[record.id, 'dropped']])
})
