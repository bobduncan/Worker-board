// B771 (X98), end to end on a running board: the evening of 2026-10-27, the week at 98% from 22:20. Worker 2 reported B742 at
// 22:50 and its turn ran on (its clear still to come); fifteen seconds later the board typed it the week's stop word, which
// started a new turn before the clear ran, so it stayed uncleared. A limit's stop word (the week's, the 5-hour limit's) now
// goes only to a worker that holds a step not yet reported: Workers 3 and 5 still on theirs get one, Worker 2 (its step in
// review, its hand-out held already) and Worker 4 (free, no step) none; a worker whose report failed the board's check holds its
// step again and gets one. A copy of the board on a made-up project in a temporary folder only.

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
const WORKERS = ['Worker 2', 'Worker 3', 'Worker 5', 'Worker 4']

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
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within 90 s: ${what}`)
}

/** The History of a step a worker took and reported `ago` ms before now (the board's check after it, when it ran). */
const reported = (who, ago, check = null) => [
  `- ${stamp(NOW - ago - 30 * MIN)} ${who}: queued → taken`,
  `- ${stamp(NOW - ago - 29 * MIN)} ${who}: taken → in progress`,
  `- ${stamp(NOW - ago)} ${who}: in progress → review`,
  ...(check === null ? [] : [`- ${stamp(NOW - ago)} server: check ${check}`]),
]

/**
 * A board over a made-up project, `week` and `fiveHour` percent used. `steps` is what the store holds for each worker (null: no
 * step): `{ id, state, history }`. Workers 2, 3 and 5 run a turn (busy), Worker 4 ended its turn (idle, free).
 */
async function boardAt(t, { week = 10, fiveHour = 10, steps }) {
  const dir = await mkdtemp(join(tmpdir(), 'board-onstep-'))
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
  const busy = name => name !== 'Worker 4'
  for (const name of WORKERS) {
    const id = name.toLowerCase().replace(/\W+/g, '-')
    const task = busy(name) ? { text: 'A step', names: ['Do it'], step: 1, minutes: 30, stepMinutes: 30 } : null
    await put(join(chats, `${id}-id.json`), JSON.stringify({ name, role: 'worker', state: busy(name) ? 'working' : 'waiting', task, at: NOW - MIN }))
    await put(join(app, 'a', 'b', `local_${id}.json`), appChat(name, `${id}-id`))
    await put(join(transcripts, `${id}-id.jsonl`), `${[typed(NOW - 20 * MIN, 'Go on.'), answer(NOW - 3 * MIN, busy(name) ? 'Working.' : DONE)].join('\n')}\n`)
  }
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Board\n', { now: NOW }), undefined, { now: NOW })
  for (const [name, step] of Object.entries(steps)) {
    if (step === null) continue
    const history = step.history ?? [`- ${stamp(NOW - 30 * MIN)} ${name}: queued → taken`, `- ${stamp(NOW - 29 * MIN)} ${name}: taken → in progress`]
    await put(join(project, '.claude', 'work', `${step.id}.md`), [
      `Id: ${step.id}`, 'Kind: step', 'Title: A board step', `State: ${step.state}`, `Owner: ${name}`, 'Activity: Board', `Since: ${stamp(NOW - 5 * MIN)}`, '', '## History', ...history, '',
    ].join('\n'))
  }
  // The app's own usage history: the week at `week`, the 5-hour window at `fiveHour`.
  const usage = join(app, 'usage.json')
  await put(usage, JSON.stringify({ version: 2, samples: [{ t: NOW - MIN, org: 'org-1', u: { fh: fiveHour, sd: week } }] }))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'onstep', project, port, gamePort: 7330, gameRepo: '', appSessions: app, transcripts, usageHistory: usage }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const outbox = async () => JSON.parse(await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').then(text => `[${text.trim().split('\n').filter(Boolean).join(',')}]`, () => '[]'))
  const base = `http://127.0.0.1:${port}`
  // What each chat's mod reports of its turn: Worker 4 ended its turn (idle), the others run one (Worker 2's runs on after its report).
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  for (const name of WORKERS) {
    const sent = await fetch(`${base}/api/bridge/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.24.2' },
      body: JSON.stringify({ chat: name, session: `${name.toLowerCase().replace(/\W+/g, '-')}-id`, report: { state: busy(name) ? 'busy' : 'idle', since: NOW - 3 * MIN, seq: 1, run: 1 } }),
    })
    assert.equal(sent.status, 200, await sent.text())
  }
  return { outbox }
}

/** Who the board typed the stop word `command` to, once it has typed `count` of them and a few passes more (nothing is said twice or to anyone else). */
async function stopWords(outbox, command, count) {
  const words = async () => (await outbox()).filter(one => one.command === command)
  await until(async () => (await words()).length >= count, `${count} words of ${command}`)
  await new Promise(done => setTimeout(done, 6000))
  return (await words()).map(one => one.to).sort()
}

// The evening: Worker 2 reported B742 and its turn runs on, Workers 3 and 5 are on their steps, Worker 4 holds none.
const EVENING = {
  'Worker 2': { id: 'B742', state: 'review', history: reported('Worker 2', 15_000, 'pending') },
  'Worker 3': { id: 'B743', state: 'in progress' },
  'Worker 5': { id: 'B745', state: 'taken', history: [`- ${stamp(NOW - 2 * MIN)} Worker 5: queued → taken`] },
  'Worker 4': null,
}

test('the week at 98: Workers 3 and 5, still on their steps, are told once; Worker 2, which just reported B742, and Worker 4, which holds none, hear nothing', { timeout: 300_000 }, async t => {
  const { outbox } = await boardAt(t, { week: 98, steps: EVENING })
  assert.deepEqual(await stopWords(outbox, 'week-stop', 2), ['Worker 3', 'Worker 5'])
  assert.deepEqual((await outbox()).filter(one => one.command === 'five-hour-stop'), [])
})

test('the 5-hour limit at 98 with its reset unread: the same rule, one word to each of Workers 3 and 5 and none to Worker 2', { timeout: 300_000 }, async t => {
  const { outbox } = await boardAt(t, { fiveHour: 98, steps: EVENING })
  assert.deepEqual(await stopWords(outbox, 'five-hour-stop', 2), ['Worker 3', 'Worker 5'])
  assert.deepEqual((await outbox()).filter(one => one.command === 'week-stop'), [])
})

test('a step dropped since its report: its worker holds nothing and hears nothing; the workers still on their steps are told', { timeout: 300_000 }, async t => {
  const steps = { ...EVENING, 'Worker 2': { id: 'B742', state: 'dropped', history: [...reported('Worker 2', 15_000, 'passed'), `- ${stamp(NOW - 10_000)} Main: review → dropped`] } }
  const { outbox } = await boardAt(t, { week: 98, steps })
  assert.deepEqual(await stopWords(outbox, 'week-stop', 2), ['Worker 3', 'Worker 5'])
})

test('a report the board\'s check handed back: the worker stays on its step to fix it, so it is told with the others', { timeout: 300_000 }, async t => {
  const steps = { ...EVENING, 'Worker 2': { id: 'B742', state: 'review', history: reported('Worker 2', 15_000, 'failed: the change touches tests but the result names no mutant') } }
  const { outbox } = await boardAt(t, { week: 98, steps })
  assert.deepEqual(await stopWords(outbox, 'week-stop', 3), ['Worker 2', 'Worker 3', 'Worker 5'])
})
