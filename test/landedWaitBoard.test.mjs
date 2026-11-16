// F33 (B1256), end to end on a running board (the server's own pass): B1236's owner waits on chat 1 for its go to land; the
// landing of its branch stands in data/landings.jsonl (the live 10:42 line's shape). The board ends the wait with one History line
// and words Worker 1 once, and not again after the board starts anew. A copy of the board on a made-up project in a temporary
// folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { migrateBacklog, stamp } from '../src/work/migrate.mjs'
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
  // B570: the copy reads no Workers mod installed on this PC (an empty Claude folder beside it), so no restart for a
  // newer mod holds the lines this test watches.
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

/** The board's first look at the store (and its line out) may take a while on a busy machine. */
async function until(check, what) {
  for (const end = Date.now() + 90_000; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within 90 s: ${what}`)
}

test('a landing of its own branch ends its wait for the go to land and words its owner once, also across a restart', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-landed-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main","afterStep":"clear"}')
  await put(join(chats, 'main-id.json'), JSON.stringify({ name: 'Main', role: 'main', state: 'waiting', task: null, at: NOW }))
  await put(join(chats, 'w1-id.json'), JSON.stringify({ name: 'Worker 1', role: 'worker', state: 'waiting', task: null, at: NOW }))
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name.replace(' ', '')}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  await put(join(app, 'a', 'b', 'local_main.json'), appChat('Main', 'main-id'))
  await put(join(app, 'a', 'b', 'local_worker1.json'), appChat('Worker 1', 'w1-id'))
  const NL = String.fromCharCode(10)
  await put(join(transcripts, 'main-id.jsonl'), [typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join(NL) + NL)
  await put(join(transcripts, 'w1-id.jsonl'), [typed(NOW - 40 * MIN, 'work: B1236 is yours; run work next'), answer(NOW - 20 * MIN, 'Waiting for the go to land.')].join(NL) + NL)
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog(['## Board', '- [ ] B730 Something else (about 1 h)', ''].join(NL), { now: NOW }), undefined, { now: NOW })
  const waitAt = NOW - 30 * MIN
  await put(join(work, 'B1236.md'), [
    'Id: B1236', 'Kind: step', 'Title: Fix something', 'State: in progress', 'Owner: Worker 1', 'Activity: Board', `Waits on: chat 1 · its go to land · ${stamp(waitAt)}`, `Since: ${stamp(NOW - 40 * MIN)}`, 'Branch: b1236-x202-fix', '',
    '## History', `- ${stamp(NOW - 40 * MIN)} Worker 1: taken → in progress`, `- ${stamp(waitAt)} Worker 1: waits on chat 1 · its go to land`, '',
  ].join(NL))
  const head = '4ba4f404e34fa0863965b787990173d208510452'
  const line = (branch, result, at) => JSON.stringify({ at: new Date(at).toISOString(), by: 'Board lead', branch, head, before: null, after: head, trial: head, result, why: null, boards: [{ port: 1 }, { port: 2 }], cold: false, gateLog: null, branches: { swept: [], kept: [], landed: { remote: 'removed', local: 'removed' } } })
  await put(join(board, 'data', 'landings.jsonl'), [line('b1236-x202-fix', 'refused', NOW - 25 * MIN), line('b1299-other', 'landed', NOW - 20 * MIN), line('b1236-x202-fix', 'landed', NOW - 15 * MIN)].join(NL) + NL)
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'landed', project, port, gamePort: 7341, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const env = { WORKER_BOARD_HOME: join(dir, 'pc') }
  const told = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => ''))
    .split(NL).filter(Boolean).map(text => JSON.parse(text)).filter(message => message.command === 'work' && message.kind === 'landed')
  const step = () => readFile(join(work, 'B1236.md'), 'utf8')
  const first = await run(started, board, env)
  await until(async () => (await told()).length > 0, 'the landed word to Worker 1 in the outbox')
  await new Promise(done => setTimeout(done, 3000))
  const [word, ...more] = await told()
  assert.deepEqual(more, [])
  assert.equal(word.to, 'Worker 1')
  assert.equal(word.about, 'B1236')
  assert.equal(word.text, 'B1236 landed (4ba4f404, both boards): report it (merged 4ba4f404); its branch is gone from origin')
  const text = await step()
  assert.doesNotMatch(text, /^Waits on:/m)
  assert.match(text, /^State: in progress$/m)
  assert.equal(text.match(/ server: landed 4ba4f404 by Board lead at /g)?.length, 1)

  // The board starts anew and reads landings.jsonl again: no second clear, no second word.
  await stop(first)
  await run(started, board, env)
  await new Promise(done => setTimeout(done, 8000))
  assert.equal((await told()).length, 1)
  assert.equal((await step()).match(/ server: landed /g)?.length, 1)
})
