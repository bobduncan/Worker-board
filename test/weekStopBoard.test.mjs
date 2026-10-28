// B759 (B742's check), end to end on a running board: the case of 2026-10-27, the week at 98% from 22:20. B738 waits
// ready, Worker 4 is free and runs, Workers 2, 3 and 5 work. At the stop line the board hands B738 to nobody (no word to
// Worker 4, so no "not taking" either) and types its one stop word to each working worker; at 97% it hands out as before and
// says nothing. A copy of the board on a made-up project in a temporary folder only.

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
const DONE = 'It is in.\n\n---\n\n```diff\n  Prompt: a step\n  Who:    Game - Worker 4\n+ Done:   yes\n```'
const WORKING =['Worker 2', 'Worker 3', 'Worker 5']

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(started, board, env) {
  const claude = join(dirname(board), 'claude-config')
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, CLAUDE_CONFIG_DIR: claude, WORKER_BOARD_TICK_MS: '1000', ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
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
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within 90 s: ${what}`)
}

/** A board over a made-up project: the week at `week` percent, B738 ready, Worker 4 free, Workers 2, 3 and 5 working. */
async function boardAt(t, week, fiveHour = 10, settings = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'board-week-'))
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
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  await put(join(app, 'a', 'b', 'local_main.json'), appChat('Main', 'main-id'))
  await put(join(transcripts, 'main-id.jsonl'), `${[typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n')}\n`)
  const lanes = [...WORKING.map(name => [name, 'working']), ['Worker 4', 'waiting']]
  for (const [name, state] of lanes) {
    const id = name.toLowerCase().replace(/\W+/g, '-')
    const task = state === 'working' ? { text: 'A step', names: ['Do it'], step: 1, minutes: 30, stepMinutes: 30 } : null
    await put(join(chats, `${id}-id.json`), JSON.stringify({ name, role: 'worker', state, task, at: NOW - MIN }))
    await put(join(app, 'a', 'b', `local_${id}.json`), appChat(name, `${id}-id`))
    await put(join(transcripts, `${id}-id.jsonl`), `${[typed(NOW - 20 * MIN, 'Go on.'), answer(NOW - 3 * MIN, state === 'working' ? 'Working.' : DONE)].join('\n')}\n`)
  }
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Board\n- [ ] B738 Draw the shield (about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  // B771: a stop word goes only to a worker on a step not yet reported, so each working worker holds one in progress.
  for (const [at, name] of WORKING.entries()) {
    const history = [`- ${stamp(NOW - 30 * MIN)} ${name}: queued → taken`, `- ${stamp(NOW - 29 * MIN)} ${name}: taken → in progress`]
    await put(join(project, '.claude', 'work', `B90${at}.md`), [`Id: B90${at}`, 'Kind: step', 'Title: A board step', 'State: in progress', `Owner: ${name}`, 'Activity: Board', `Since: ${stamp(NOW - 5 * MIN)}`, '', '## History', ...history, ''].join('\n'))
  }
  // B738 is refined, ready and queued by the person: the board's list of what it may hand out holds it.
  await put(join(project, '.claude', 'work', 'B738.md'), `Id: B738\nKind: step\nTitle: Draw the shield\nState: refined\nRefined: ready\nGoal: G15\nQueued by: person, 2026-10-27 22:20:00\nSince: ${stamp(NOW - 5 * MIN)}\n`)
  // The app's own usage history: the 5-hour window low, the week at `week`.
  const usage = join(app, 'usage.json')
  await put(usage, JSON.stringify({ version: 2, samples: [{ t: NOW - MIN, org: 'org-1', u: { fh: fiveHour, sd: week } }] }))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'week', project, port, gamePort: 7330, gameRepo: '', appSessions: app, transcripts, usageHistory: usage, ...settings }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const outbox = async () => JSON.parse(await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').then(text => `[${text.trim().split('\n').filter(Boolean).join(',')}]`, () => '[]'))
  const base = `http://127.0.0.1:${port}`
  // What each chat's mod reports of its turn: Worker 4 ended its turn (idle, free), the others run one.
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  for (const [name, state] of lanes) {
    const sent = await fetch(`${base}/api/bridge/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.24.2' },
      body: JSON.stringify({ chat: name, session: `${name.toLowerCase().replace(/\W+/g, '-')}-id`, report: { state: state === 'working' ? 'busy' : 'idle', since: NOW - 3 * MIN, seq: 1, run: 1 } }),
    })
    assert.equal(sent.status, 200, await sent.text())
  }
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  return { outbox, state: () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json()) }
}

test('the week at 98: B738 goes to nobody, Worker 4 hears nothing, and Workers 2, 3 and 5 are each told once to stop', { timeout: 300_000 }, async t => {
  const { outbox, state } = await boardAt(t, 98)
  await until(async () => (await outbox()).filter(one => one.command === 'week-stop').length >= 3, 'the stop word to each of the three workers')
  // Its looking loop runs every second here: it passes a few more times: nothing is said twice, and nothing is handed out.
  await new Promise(done => setTimeout(done, 6000))
  const sent = await outbox()
  const stops = sent.filter(one => one.command === 'week-stop')
  assert.deepEqual(stops.map(one => one.to).sort(), WORKING)
  assert.match(stops[0].text, /reached the stop line \(98%\)/)
  assert.deepEqual(sent.filter(one => one.about === 'B738' || /B738/.test(one.text ?? '')), [])
  assert.deepEqual(sent.filter(one => one.to === 'Worker 4'), [])
  // B738 is ready all along (the 97 case hands it out): it is the stop line that holds it.
  const seen = await state()
  assert.deepEqual(seen.readyList.ready.map(one => one.id), ['B738'])
  assert.equal(seen.reconciled.handOutHeld, true)
  assert.deepEqual(seen.reconciled.gives, [])
})

/** Handed out as always: B738 goes to Worker 4 and nobody is told to stop. */
async function handsOut(t, ...args) {
  const { outbox } = await boardAt(t, ...args)
  await until(async () => (await outbox()).some(one => one.command === 'work' && one.about === 'B738'), 'the line of B738 in the outbox')
  await new Promise(done => setTimeout(done, 3000))
  const sent = await outbox()
  assert.equal(sent.find(one => one.about === 'B738').to, 'Worker 4')
  assert.deepEqual(sent.filter(one => one.command === 'week-stop'), [])
}

test('the week at 97: B738 goes to Worker 4 as always, and nobody is told to stop', { timeout: 300_000 }, async t => {
  await handsOut(t, 97)
})

test('the week at 98 with the stop line set to 99 in the settings: handed out as always', { timeout: 300_000 }, async t => {
  await handsOut(t, 98, 10, { weekStopAt: 99 })
})
