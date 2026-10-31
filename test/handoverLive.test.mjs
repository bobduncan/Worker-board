// T8.5, step 2, end to end on a running board (the harness of clearOwedBoard.test.mjs): the setting "sequence" and a worker
// on the Workers mod 0.27.0. Its turn end (T) answers one envelope (its clear, then its next task); the take hands out no
// clear of the old path and no envelope twice; the outcome through `typed` (D) with a refused clear takes the task back at
// once; its report gone idle with nothing in the background (B) brings the next envelope at the refresh; a turn that
// ended after the line without a take gives it back at once and the next task in the same answer; the take of the task
// is its own (no old refusal). Step 6: a worker on an older mod on the same board is handed nothing at all (no clear at
// its take, no envelope, no line).
// A copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'
import { parseItem } from '../src/work/item.mjs'

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
  for (const end = Date.now() + 90_000; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 250))
  }
  throw new Error(`Not within 90 s: ${what}`)
}

const file = (head, history) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n## History\n${history.join('\n')}\n`)

test('the sequence on a running board: T answers the envelope, D takes back at once, B decides again, an untaken line goes back; an older mod is handed nothing (step 6)', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-handover-'))
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
  await put(join(chats, 'lead-id.json'), JSON.stringify({ name: 'Lead', role: 'main', state: 'waiting', task: null, at: NOW }))
  const card = (name, cleared) => JSON.stringify({ name, role: 'worker', state: 'waiting', task: null, at: NOW, cleared })
  // Units on the new mod, Props on an older one: each cleared before its last report, so each owes a clear.
  await put(join(chats, 'units-id.json'), card('Units', { at: NOW - 90 * MIN, step: 'B11', log: null }))
  await put(join(chats, 'props-id.json'), card('Props', { at: NOW - 90 * MIN, step: 'B19', log: null }))
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  for (const [name, session] of [['Lead', 'lead-id'], ['Units', 'units-id'], ['Props', 'props-id']]) {
    await put(join(app, 'a', 'b', `local_${name}.json`), appChat(name, session))
    await put(join(transcripts, `${session}.jsonl`), `${[typed(NOW - 40 * MIN, 'Go on.'), answer(NOW - 30 * MIN, 'Done.')].join('\n')}\n`)
  }
  const reported = (id, who) => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'done', Owner: who, Activity: 'Art', Since: stamp(NOW - 25 * MIN) },
    [`- ${stamp(NOW - 40 * MIN)} ${who}: queued → taken`, `- ${stamp(NOW - 30 * MIN)} ${who}: in progress → review`, `- ${stamp(NOW - 30 * MIN)} server: check passed`, `- ${stamp(NOW - 25 * MIN)} server: review → done`])
  const ready = id => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'refined', Refined: 'ready', Activity: 'Art', Since: stamp(NOW - 60 * MIN) }, [`- ${stamp(NOW - 60 * MIN)} Advisor: made`])
  const items = new Map([['B12', reported('B12', 'Units')], ['B20', reported('B20', 'Props')], ['B13', ready('B13')], ['B14', ready('B14')]])
  const work = join(project, '.claude', 'work')
  await writeStore(work, { items, activities: [{ name: 'Art', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: NOW - 60 * MIN })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'handover', project, port, gamePort: 7330, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), refreshSeconds: 5, handOutBeyondFocus: true, handover: 'sequence' }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const call = (path, body, mod) => fetch(`http://127.0.0.1:${port}/api/bridge/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': mod }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  const NEW = '0.27.0'
  const head = async (id, field) => (await readFile(join(work, `${id}.md`), 'utf8')).match(new RegExp(`^${field}: (.*)$`, 'm'))?.[1] ?? null
  const lastLine = async id => (await readFile(join(work, `${id}.md`), 'utf8')).trim().split('\n').at(-1)
  let seq = 0
  const ping = (name, session, mod, report) => call('take', { chat: name, session, report: { run: 1, seq: (seq += 1), ...report } }, mod)

  // T: the turn of Units ends; one answer: the envelope, its clear first, then B13 (given in the same call).
  const ended = await call('work', { action: 'turn-ended', chat: 'Units', session: 'units-id', since: Date.now() - 5 * MIN }, NEW)
  assert.equal(ended.status, 200, JSON.stringify(ended.body))
  const first = ended.body.handover
  assert.equal(first.state, 'handing', JSON.stringify(first))
  assert.deepEqual([first.envelope.clear?.step, first.envelope.step, first.envelope.line], ['B12', 'B13', 'work: B13 is yours; run work next'])
  assert.equal(ended.body.pull, undefined)
  assert.deepEqual([await head('B13', 'State'), await head('B13', 'Owner')], ['queued', 'Units'])

  // K's path: its take names no old clear and hands the envelope out no second time.
  const pinged = await ping('Units', 'units-id', NEW, { state: 'idle', since: Date.now(), background: true })
  assert.equal(pinged.status, 200, JSON.stringify(pinged.body))
  assert.deepEqual([pinged.body.clear, pinged.body.handover, pinged.body.messages.filter(one => /hand-over/.test(one.text))], [undefined, undefined, []])

  // D: its mod could not clear (background work runs): the task back at once, before the answer.
  const refused = await call('typed', { chat: 'Units', session: 'units-id', handover: first.envelope.id, outcome: { cleared: false, set: null, typed: false, background: true, why: 'background work it started still runs' } }, NEW)
  assert.equal(refused.status, 200, JSON.stringify(refused.body))
  assert.equal(refused.body.settled, true)
  assert.equal(await head('B13', 'State'), 'refined')
  assert.match(await lastLine('B13'), /taken back from Units: its clear did not run: background work it started still runs/)

  // B: its report says idle with nothing in the background: the refresh decides again; the next take brings the envelope.
  let again = null
  const named = []
  await until(async () => {
    const reply = await ping('Units', 'units-id', NEW, { state: 'idle', since: Date.now() - 1000, background: false })
    if (reply.body.clear !== undefined) named.push(reply.body.clear)
    again = reply.body.handover ?? null
    return again !== null
  }, 'the next envelope after the report went idle')
  // Never the old path's clear at a take (mutant: both paths for one worker): the envelope alone clears it.
  assert.deepEqual(named, [])
  const after = await ping('Units', 'units-id', NEW, { state: 'idle', since: Date.now() - 1000, background: false })
  assert.equal(after.body.clear, undefined)
  assert.deepEqual([again.clear?.step, again.step], ['B12', 'B13'])
  assert.equal(await call('typed', { chat: 'Units', session: 'units-id', handover: again.id, outcome: { cleared: true, typed: true } }, NEW).then(reply => reply.body.settled), true)

  // T after the line, no take: B13 back ("did not take it in its turn"), B14 in the same answer.
  const untaken = await call('work', { action: 'turn-ended', chat: 'Units', session: 'units-id', since: Date.now() }, NEW)
  assert.equal(untaken.status, 200, JSON.stringify(untaken.body))
  assert.match(await lastLine('B13'), /taken back from Units: did not take it in its turn/)
  const second = untaken.body.handover
  assert.equal(second.envelope?.step, 'B14', JSON.stringify(second))
  // The take of B14 is its own: no refusal of the old path though the card still says no clear.
  const taken = await call('work', { action: 'take', minutes: 30, id: 'B14', branch: 'b14', chat: 'Units', session: 'units-id' }, NEW)
  assert.equal(taken.status, 200, JSON.stringify(taken.body))

  // Props on an older mod: idle, with B13 ready, and a clear owed for B20; step 6: handed nothing (the old path is gone).
  for (let n = 0; n < 3; n += 1) {
    const old = await ping('Props', 'props-id', '0.26.10', { state: 'idle', since: Date.now() - 3 * MIN, background: false })
    assert.equal(old.status, 200, JSON.stringify(old.body))
    assert.deepEqual([old.body.clear, old.body.handover], [undefined, undefined])
    await new Promise(done => setTimeout(done, 2000))
  }
  const outbox = (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(outbox.some(one => one.to === 'Props' && ['handover', 'work'].includes(one.command)), false)
  assert.notEqual(await head('B13', 'Owner'), 'Props')
})
