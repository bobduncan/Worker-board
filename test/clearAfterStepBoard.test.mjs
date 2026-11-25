// Clear after each step, end to end on a running board: the Workers mod's `save-log` through the bridge keeps the
// conversation as a log (only a worker's), the chat goes on under its new session id without a refusal, and a log the
// board had not finished when it stopped is finished at its next start. A copy of the board on a made-up project in a
// temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

/** Starts the board and answers once it listens. */
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

async function until(check, what) {
  for (const end = Date.now() + 30_000; Date.now() < end;) {
    const found = await check()
    if (found) return found
    await new Promise(done => setTimeout(done, 100))
  }
  throw new Error(`Not within 30 s: ${what}`)
}

const exists = path => stat(path).then(() => true, () => false)

test('save-log through the bridge keeps a worker\'s conversation, the chat goes on under its new id, and the journal is finished after a restart', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-clear-'))
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
  await put(join(transcripts, 'main-id.jsonl'), `${[typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n')}\n`)
  await put(join(transcripts, 'units-old.jsonl'), `${[typed(NOW - 30 * MIN, 'Draw the knight.'), answer(NOW - 20 * MIN, 'B12 is in.')].join('\n')}\n`)
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Art\n- [ ] B13 Draw the shield (for Units; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'clear', project, port, gamePort: 7300, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const env = { WORKER_BOARD_HOME: join(dir, 'pc') }
  await run(started, board, env)
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const work = body => fetch(`http://127.0.0.1:${port}/api/bridge/work`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))

  // Only a worker's conversation is kept for a clear; the main chat's is refused.
  const main = await work({ action: 'save-log', stepId: 'B12', chat: 'Main', session: 'main-id' })
  assert.equal(main.status, 409)
  assert.match(main.body, /Main is the main chat: only a worker's conversation is cleared\./)
  const saved = await work({ action: 'save-log', stepId: 'B12', chat: 'Units', session: 'units-old' })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.match(saved.body.log, /^\.claude\/chat-logs\/Units\/\d{4}-\d\d-\d\d \d{4} B12\.txt$/)
  await until(() => exists(saved.body.file), 'the text log')
  assert.match(await readFile(saved.body.file, 'utf8'), /The person:\nDraw the knight\.[\s\S]*Units:\nB12 is in\./)
  assert.equal(await readFile(saved.body.jsonl, 'utf8'), await readFile(join(transcripts, 'units-old.jsonl'), 'utf8'))

  // Review 2: the old transcript's last lines come after the log was asked for (here, the step's report): the board
  // reads them on for the task times and the spending, though its lane reads the new session from now on.
  const report = JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - MIN).toISOString(), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Reported B12.' }] } })
  await writeFile(join(transcripts, 'units-old.jsonl'), `${await readFile(join(transcripts, 'units-old.jsonl'), 'utf8')}${report}\n`)
  // The /clear: the mod moves the card to the new session; the app still names the old one. The board serves the new
  // session at once, under the chat's name.
  await put(join(chats, 'units-new.json'), JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW, cleared: { at: NOW, step: 'B12', log: saved.body.log } }))
  await put(join(chats, 'units-old.json'), JSON.stringify({ movedTo: 'units-new', at: NOW }))
  await put(join(transcripts, 'units-new.jsonl'), '')
  const next = await work({ action: 'next', chat: 'Units', session: 'units-new' })
  assert.equal(next.status, 200, JSON.stringify(next.body))
  assert.match(next.body.text, /B13/)
  // B1502: that first call was answered from the kept state (its card chain) and read the state again in the background after its
  // answer: once that read lands, the new session shows and the session the clear left is refused.
  await until(async () => (await work({ action: 'next', chat: 'Units', session: 'units-old' })).status === 409, 'the session the clear left refused once the read landed')

  // The board stops before a log is written; its next start finishes it.
  await stop(started.pop())
  const folder = join(project, '.claude', 'chat-logs', 'Units')
  const job = { id: 'units-old-1', chat: 'Units', session: 'units-old', step: 'B11', at: NOW, state: 'copy', source: join(transcripts, 'units-old.jsonl'), jsonl: join(folder, 'late B11.jsonl'), txt: join(folder, 'late B11.txt'), log: '.claude/chat-logs/Units/late B11.txt' }
  const before = JSON.parse(await readFile(join(board, 'data', 'chat-logs.json'), 'utf8'))
  // The session the clear left is named in the journal, to be read on after the restart.
  assert.deepEqual(before.left.map(one => one.session), ['units-old'])
  await put(join(board, 'data', 'chat-logs.json'), JSON.stringify({ ...before, jobs: [job] }))
  await run(started, board, env)
  await until(() => exists(job.txt), 'the log the journal named')
  assert.match(await readFile(job.txt, 'utf8'), /after its reported step B11/)
  await until(async () => JSON.parse(await readFile(join(board, 'data', 'chat-logs.json'), 'utf8')).jobs.length === 0, 'an empty journal')
  // Review 2: the old session was read to its end for the task times and the spending, and is no longer named.
  const size = (await stat(join(transcripts, 'units-old.jsonl'))).size
  await until(async () => JSON.parse(await readFile(join(board, 'data', 'task-times.json'), 'utf8')).scans?.['units-old']?.offset === size, 'the old session read to its end')
  await until(async () => JSON.parse(await readFile(join(board, 'data', 'chat-logs.json'), 'utf8')).left.length === 0, 'the old session read out')
})

// B1502 (X93, the live case of 2026-11-25 00:13:19: Worker 1's first next after its clear took 16 s, 11.2 s of it a whole read of the
// board). The board's state is kept an hour here (WORKER_BOARD_STATE_MS), so only a reset makes it read anew, and each read is a line
// of WORKER_BOARD_READ_LOG. Chat 1's review pinned: the call before the card moved reads anew; the one after does not and works end to
// end (next, then take and step, under the chat's name); a stranger under a shown name is refused as before, read anew once per FRESH_MS.
test('B1502: a worker\'s first call after its clear is answered from the kept state once its card moved; a stranger is not', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-moved-'))
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
  await put(join(chats, 'shields-old.json'), JSON.stringify({ name: 'Shields', role: 'worker', state: 'waiting', task: null, at: NOW }))
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  await put(join(app, 'a', 'b', 'local_main.json'), appChat('Main', 'main-id'))
  await put(join(app, 'a', 'b', 'local_units.json'), appChat('Units', 'units-old'))
  await put(join(app, 'a', 'b', 'local_shields.json'), appChat('Shields', 'shields-old'))
  await put(join(transcripts, 'shields-old.jsonl'), `${typed(NOW - 30 * MIN, 'Draw the buckler.')}
`)
  await put(join(transcripts, 'main-id.jsonl'), `${typed(NOW - 9 * MIN, 'Status?')}\n`)
  await put(join(transcripts, 'units-old.jsonl'), `${typed(NOW - 30 * MIN, 'Draw the knight.')}\n${answer(NOW - 20 * MIN, 'B12 is in.')}\n`)
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Art\n- [ ] B13 Draw the shield (for Units; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'moved', project, port, gamePort: 7310, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const log = join(dir, 'rebuilds.log')
  // Chat 1's third review: each read of the state takes 1.5 s here, so a read started after a moved call is still under way when the
  // chat's next arrives: only a next answered from the kept state (`stateWhy` kept) shows apart from one that waited for it.
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_STATE_MS: String(60 * MIN), WORKER_BOARD_READ_LOG: log, WORKER_BOARD_READ_DELAY_MS: '1500' })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const work = body => fetch(`http://127.0.0.1:${port}/api/bridge/work`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  const typedAs = body => fetch(`http://127.0.0.1:${port}/api/bridge/typed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key }, body: JSON.stringify(body),
  }).then(reply => reply.status)
  const rebuilt = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).length
  // The board has settled once a read of its state (the main chat's typed post reads it) rebuilds nothing for a while.
  const settle = async () => {
    for (let last = -1, end = Date.now() + 60_000; Date.now() < end;) {
      assert.equal(await typedAs({ chat: 'Main', session: 'main-id', typed: [] }), 200)
      await new Promise(done => setTimeout(done, 1_500))
      const now = await rebuilt()
      if (now === last) return now
      last = now
    }
    throw new Error('The board did not settle within 60 s')
  }

  // The call before the mod wrote movedTo: the board does not know the session and reads anew (as before), then refuses it.
  let before = await settle()
  const early = await work({ action: 'next', chat: 'Units', session: 'units-new' })
  assert.equal(early.status, 409, JSON.stringify(early.body))
  assert.ok(await rebuilt() > before, 'the call before the card moved read the board anew')

  // A stranger under the name of a shown chat (the card names no move): refused, read anew once, then not again within FRESH_MS.
  before = await settle()
  assert.equal((await work({ action: 'next', chat: 'Units', session: 'units-stranger' })).status, 409)
  const once = await rebuilt()
  assert.ok(once > before, 'the stranger\'s first call read the board anew')
  assert.equal((await work({ action: 'next', chat: 'Units', session: 'units-stranger' })).status, 409)
  assert.equal(await rebuilt(), once, 'the stranger was read anew twice within FRESH_MS')

  // Chat 1's review, point 1: the mod's typed post (its hand-over outcome, the clear's stages) from the NEW session, while the state
  // the board keeps still shows the old one, is the chat's by its card chain, not refused (its outcome would be lost).
  await put(join(chats, 'shields-new.json'), JSON.stringify({ name: 'Shields', role: 'worker', state: 'waiting', task: null, at: NOW }))
  await put(join(chats, 'shields-old.json'), JSON.stringify({ movedTo: 'shields-new', at: NOW }))
  before = await settle()
  assert.equal(await typedAs({ chat: 'Shields', session: 'shields-stranger', typed: [] }), 409)
  assert.equal(await typedAs({ chat: 'Shields', session: 'shields-new', typed: [] }), 200)

  // The /clear: the mod moves the card; the app still names the old session. The first next of the new session is the chat's,
  // answered with no read anew (its trace line: moved, no rebuild during the call).
  before = await settle()
  await put(join(chats, 'units-new.json'), JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW, cleared: { at: NOW, step: 'B12', log: 'x.txt' } }))
  await put(join(chats, 'units-old.json'), JSON.stringify({ movedTo: 'units-new', at: NOW }))
  before = await settle()
  // The trace line of the chat's first answered call of `action` that arrived from `since` on.
  const traceOf = async (action, since) => until(async () => (await readFile(join(board, 'data', 'call-trace.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map(line => JSON.parse(line)).find(one => one.chat === 'Units' && one.action === action && one.status === 200 && one.arrived >= since), `the trace line of the ${action}`)
  const firstAt = Date.now()
  const next = await work({ action: 'next', chat: 'Units', session: 'units-new' })
  assert.equal(next.status, 200, JSON.stringify(next.body))
  assert.match(next.body.text, /B13/)
  const traced = await traceOf('next', firstAt)
  assert.deepEqual([traced.status, traced.moved, traced.rebuilds, traced.stateWhy], [200, true, 0, 'kept'], 'the first call after the clear read the board anew')
  // Its answer read the state again in the background: once that read lands the session the clear left is refused.
  await until(async () => (await work({ action: 'next', chat: 'Units', session: 'units-old' })).status === 409, 'the session the clear left refused once the read landed')

  // Chat 1's second review: the real order after a clear. The new session's mod reports it works, pings its take and posts the
  // clear's stage before its next: every one a moved call. None of them may leave the state to be read anew by the next.
  await put(join(chats, 'units-new2.json'), JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW }))
  await put(join(chats, 'units-new.json'), JSON.stringify({ movedTo: 'units-new2', at: NOW }))
  before = await settle()
  const as = (path, body) => fetch(`http://127.0.0.1:${port}/api/bridge/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key }, body: JSON.stringify({ chat: 'Units', session: 'units-new2', ...body }),
  }).then(reply => reply.status)
  assert.equal(await as('report', { report: { state: 'busy', since: Date.now(), background: false, seq: 1, run: 2 } }), 200)
  assert.equal(await as('take', {}), 200)
  assert.equal(await as('typed', { typed: [], handover: 'h-1', stages: [{ stage: 'cleared', at: Date.now(), ticket: 'clear-2-1' }] }), 200)
  const secondAt = Date.now()
  const second = await work({ action: 'next', chat: 'Units', session: 'units-new2' })
  assert.equal(second.status, 200, JSON.stringify(second.body))
  const secondTrace = await traceOf('next', secondAt)
  assert.deepEqual([secondTrace.status, secondTrace.rebuilds, secondTrace.stateWhy], [200, 0, 'kept'], 'the next after the report, take ping and typed stage read the board anew')
  // The same calls in another order (the typed stage first, the take ping last before the next): a moved call right before the
  // next. With a reset after a moved call (chat 1's second review) this next waits for a whole read; with the read in the
  // background it does not.
  await put(join(chats, 'units-new3.json'), JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW }))
  await put(join(chats, 'units-new2.json'), JSON.stringify({ movedTo: 'units-new3', at: NOW }))
  before = await settle()
  const as3 = (path, body) => as(path, { session: 'units-new3', ...body })
  assert.equal(await as3('typed', { typed: [], handover: 'h-2', stages: [{ stage: 'cleared', at: Date.now(), ticket: 'clear-3-1' }] }), 200)
  assert.equal(await as3('report', { report: { state: 'busy', since: Date.now(), background: false, seq: 1, run: 3 } }), 200)
  assert.equal(await as3('take', {}), 200)
  const thirdAt = Date.now()
  const third = await work({ action: 'next', chat: 'Units', session: 'units-new3' })
  assert.equal(third.status, 200, JSON.stringify(third.body))
  const thirdTrace = await traceOf('next', thirdAt)
  assert.deepEqual([thirdTrace.status, thirdTrace.rebuilds, thirdTrace.stateWhy], [200, 0, 'kept'], 'the next right after a moved take ping read the board anew')
  // And a moved call that neither reads nor changes the state right before the next (a work list; the take ping and the typed post
  // read the state themselves, and a busy report changes it, so after those a reset would cost the next nothing). The read the list
  // started is still under way (1.5 s): the next is answered from the kept state, never after a reset that makes it wait for that read.
  await put(join(chats, 'units-new4.json'), JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW }))
  await put(join(chats, 'units-new3.json'), JSON.stringify({ movedTo: 'units-new4', at: NOW }))
  before = await settle()
  assert.equal((await work({ action: 'list', chat: 'Units', session: 'units-new4' })).status, 200)
  const fourthAt = Date.now()
  const fourth = await work({ action: 'next', chat: 'Units', session: 'units-new4' })
  assert.equal(fourth.status, 200, JSON.stringify(fourth.body))
  const fourthTrace = await traceOf('next', fourthAt)
  assert.deepEqual([fourthTrace.status, fourthTrace.moved, fourthTrace.stateWhy], [200, true, 'kept'], 'the next right after a moved list waited for a read')
  // A stranger is still refused after the move: the chain ends at the chat's new session, not at the stranger's.
  assert.equal((await work({ action: 'next', chat: 'Units', session: 'units-stranger-2' })).status, 409)
  // End to end under the chat's name: the take and a checkpoint are the chat's (the store's owner and state), not refused.
  const take = await work({ action: 'take', chat: 'Units', session: 'units-new4', id: 'B13', branch: 'b13', minutes: 30 })
  assert.equal(take.status, 200, JSON.stringify(take.body))
  const step = await work({ action: 'step', chat: 'Units', session: 'units-new4', id: 'B13', step: 1, steps: 2, minutes: 30 })
  assert.equal(step.status, 200, JSON.stringify(step.body))
  const stored = await readFile(join(project, '.claude', 'work', 'B13.md'), 'utf8')
  assert.match(stored, /^State: in progress$/m)
  assert.match(stored, /^Owner: Units$/m)
})
