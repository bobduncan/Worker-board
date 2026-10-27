// B739 (X91), end to end on a running board (the server's own pass): Worker 1 reported B720 and ended its turn with background
// work still running; the board types it one line, once, and not again after the board starts anew. A worker whose turn
// ended with nothing running, and one that reported a step since dropped, get none. A copy of the board on a made-up project
// in a temporary folder only.

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

const background = at => JSON.stringify({ type: 'user', timestamp: new Date(at).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'Command running in background with ID: b1' }] } })

test('a worker that reports and ends its turn with background work running is told once; one with nothing running, or a dropped step, is not', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-background-'))
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
  const names = ['Worker 1', 'Worker 2', 'Worker 3']
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name.replace(' ', '')}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  await put(join(app, 'a', 'b', 'local_main.json'), appChat('Main', 'main-id'))
  await put(join(transcripts, 'main-id.jsonl'), `${[typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n')}\n`)
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Board\n- [ ] B730 Something else (about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  for (const [index, name] of names.entries()) {
    const id = `w${index + 1}-old`
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role: 'worker', state: 'waiting', task: null, at: NOW, cleared: { at: NOW - 90 * MIN, step: 'B700', log: null } }))
    await put(join(app, 'a', 'b', `local_worker${index + 1}.json`), appChat(name, id))
    const reported = answer(NOW - 5 * MIN, `B72${index} is in.`)
    // Worker 1: background running at the turn's end; Worker 2: nothing running; Worker 3: background, but its step was dropped.
    await put(join(transcripts, `${id}.jsonl`), `${[typed(NOW - 40 * MIN, `work: B72${index} is yours; run work next`), ...(index === 1 ? [] : [background(NOW - 6 * MIN)]), reported].join('\n')}\n`)
    await put(join(work, `B72${index}.md`), [
      `Id: B72${index}`, 'Kind: step', 'Title: Fix something', `State: ${index === 2 ? 'dropped' : 'review'}`, `Owner: ${name}`, 'Activity: Board', `Since: ${stamp(NOW - 5 * MIN)}`, '',
      '## History', `- ${stamp(NOW - 40 * MIN)} ${name}: queued → taken`, `- ${stamp(NOW - 5 * MIN)} ${name}: in progress → review`, '',
    ].join('\n'))
  }
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'background', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const env = { WORKER_BOARD_HOME: join(dir, 'pc') }
  const told = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => ''))
    .split('\n').filter(Boolean).map(text => JSON.parse(text)).filter(message => message.command === 'report-background')
  const first = await run(started, board, env)
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  // Each worker's Workers mod asks the board once (a mod that can clear), as it does at the start of a turn.
  const ask = async () => {
    for (const [index, name] of names.entries()) {
      await fetch(`http://127.0.0.1:${port}/api/bridge/take`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.17.0' }, body: JSON.stringify({ chat: name, session: `w${index + 1}-old` }) })
    }
  }
  await ask()
  await until(async () => { await ask(); return (await told()).length > 0 }, 'the line to Worker 1 in the outbox')
  // The same pass looked at the other two: they get none. Then wait for further passes: still one.
  await new Promise(done => setTimeout(done, 3000))
  const [line, ...more] = await told()
  assert.deepEqual(more, [])
  assert.equal(line.to, 'Worker 1')
  assert.equal(line.text, 'B720 is reported; your background work still runs: stop it or wait for it, then end your turn')

  // The board starts anew: the same report is not told again.
  await stop(first)
  await run(started, board, env)
  await ask()
  await new Promise(done => setTimeout(done, 5000))
  assert.equal((await told()).length, 1)
})
