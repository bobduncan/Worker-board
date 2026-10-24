// B547 (X13, X14), end to end on a running board: a worker whose last report is newer than its last clear gets no new
// step on its old conversation. Its next step's line waits at its mod's take, the take names the clear instead (a mod
// that can clear only), its work take is refused; once its card says cleared, the line goes and the take is its own. A
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
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
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

test('a worker that owes a clear: its next step waits, the take names the clear and refuses the step; after the clear both go', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-owed-'))
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
  // Units was cleared after B11, then reported B12 and was not cleared since.
  const card = cleared => JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW, cleared })
  await put(join(chats, 'units-old.json'), card({ at: NOW - 90 * MIN, step: 'B11', log: null }))
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  await put(join(app, 'a', 'b', 'local_main.json'), appChat('Main', 'main-id'))
  await put(join(app, 'a', 'b', 'local_units.json'), appChat('Units', 'units-old'))
  await put(join(transcripts, 'main-id.jsonl'), `${[typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n')}\n`)
  await put(join(transcripts, 'units-old.jsonl'), `${[typed(NOW - 40 * MIN, 'work: B12 is yours; run work next'), answer(NOW - 30 * MIN, 'B12 is in.')].join('\n')}\n`)
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Art\n- [ ] B13 Draw the shield (for Units; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  await put(join(work, 'B12.md'), [
    'Id: B12', 'Kind: step', 'Title: Draw the knight', 'State: done', 'Owner: Units', 'Activity: Art', `Since: ${stamp(NOW - 25 * MIN)}`, '',
    '## History', `- ${stamp(NOW - 40 * MIN)} Units: queued → taken`, `- ${stamp(NOW - 30 * MIN)} Units: in progress → review`, `- ${stamp(NOW - 25 * MIN)} server: review → done`, '',
  ].join('\n'))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'owed', project, port, gamePort: 7310, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const call = (path, body, mod) => fetch(`http://127.0.0.1:${port}/api/bridge/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, ...(mod === null ? {} : { 'X-Workers-Mod': mod }) }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  const take = (session, mod = '0.17.0') => call('take', { chat: 'Units', session }, mod)
  const outbox = async () => JSON.parse(await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').then(text => `[${text.trim().split('\n').filter(Boolean).join(',')}]`, () => '[]'))
  const stepLine = async () => (await outbox()).some(message => message.about === 'B13' && message.command === 'work')

  // The board puts B13's line out for Units (no mod has asked yet, so none is known that can clear).
  await until(stepLine, 'the line of B13 in the outbox')
  // A mod that can clear: the line waits, and the take names the clear of B12.
  const owed = await take('units-old')
  assert.equal(owed.status, 200, JSON.stringify(owed.body))
  assert.deepEqual(owed.body.messages, [])
  assert.equal(owed.body.clear?.step, 'B12')
  // Its work tool's take of B13 is refused with why.
  const refused = await call('work', { action: 'take', id: 'B13', branch: 'b13', chat: 'Units', session: 'units-old' }, '0.17.0')
  assert.equal(refused.status, 409)
  assert.match(refused.body, /Not yet: this chat is cleared after B12 first/)

  // The /clear: the mod moves the card to the new session, cleared after B12. The line goes, and the take is the chat's.
  await put(join(chats, 'units-new.json'), card({ at: Date.now(), step: 'B12', log: null }))
  await put(join(chats, 'units-old.json'), JSON.stringify({ movedTo: 'units-new', at: Date.now() }))
  await put(join(transcripts, 'units-new.jsonl'), '')
  let handed = null
  await until(async () => {
    handed = await take('units-new')
    return handed.status === 200 && handed.body.messages.length > 0
  }, 'the line of B13 handed out after the clear')
  assert.match(handed.body.messages[0].text, /^work: B13 is yours; run work next/)
  assert.equal(handed.body.clear, undefined)
  const taken = await call('work', { action: 'take', id: 'B13', branch: 'b13', chat: 'Units', session: 'units-new' }, '0.17.0')
  assert.equal(taken.status, 200, JSON.stringify(taken.body))
})

test('a mod older than 0.17.0 is held to nothing: it could not run the clear the board would name', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-owed-old-'))
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
  await put(join(chats, 'units-old.json'), JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW }))
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  await put(join(app, 'a', 'b', 'local_main.json'), appChat('Main', 'main-id'))
  await put(join(app, 'a', 'b', 'local_units.json'), appChat('Units', 'units-old'))
  await put(join(transcripts, 'main-id.jsonl'), `${typed(NOW - 9 * MIN, 'Status?')}\n${answer(NOW - 8 * MIN, 'All fine.')}\n`)
  await put(join(transcripts, 'units-old.jsonl'), `${typed(NOW - 40 * MIN, 'Draw.')}\n${answer(NOW - 30 * MIN, 'B12 is in.')}\n`)
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Art\n- [ ] B13 Draw the shield (for Units; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  await put(join(work, 'B12.md'), ['Id: B12', 'Kind: step', 'Title: Draw the knight', 'State: done', 'Owner: Units', 'Activity: Art', `Since: ${stamp(NOW - 25 * MIN)}`, '', '## History', `- ${stamp(NOW - 30 * MIN)} Units: in progress → review`, ''].join('\n'))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'owed-old', project, port, gamePort: 7320, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const call = (path, body) => fetch(`http://127.0.0.1:${port}/api/bridge/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.16.1' }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  let handed = null
  await until(async () => {
    handed = await call('take', { chat: 'Units', session: 'units-old' })
    return handed.status === 200 && handed.body.messages.length > 0
  }, 'the line of B13 handed to the older mod')
  assert.equal(handed.body.clear, undefined)
  assert.equal((await call('work', { action: 'take', id: 'B13', branch: 'b13', chat: 'Units', session: 'units-old' })).status, 200)
})
