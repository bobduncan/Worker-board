// B760 (the result check of B736): the evening of 2026-10-27 replayed through the server's own pass. From 21:12:44 to
// 21:21:20 the board heard no chat while every chat worked; its history then wrote every lane unknown (21:13:14) and off
// (21:18:39), and working-not-running opened for chats that were fine (X73, X87). Here a copy of the board hears the
// evening's chats (the lead idle, two workers busy) through their mods' pings, then nothing for longer than its off time
// while the workers' conversations are still written: no lane reads unknown or off, no history line says so, and the
// lead reads as before. Then it hears the lead and one worker again: the worker still silent alone reads off. The
// evening's minutes run as seconds (the settings' least unknownAfterSeconds and offAfterMinutes). A copy of the board on a
// made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MIN = 60_000
/** The settings' least: a report silent 5 s is unknown, 1 min off (the evening's 30 s and 5 min). */
const UNKNOWN_S = 5
const OFF_MIN = 1
const pause = ms => new Promise(done => setTimeout(done, ms))

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(started, board, env) {
  // B570: the copy reads no Workers mod installed on this PC (an empty Claude folder beside it).
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
    await pause(200)
  }
  throw new Error(`Not within 90 s: ${what}`)
}

test('the evening of 2026-10-27 through the server\'s own pass: while the board hears no chat no lane reads unknown or off and no working-not-running opens; one chat silent alone reads off', { timeout: 400_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-deaf-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Garden - ","main":"Lead"}')
  // That evening's chats: the lead idle since 21:09:53 (Main), two workers busy (Worker 2 and Worker 3).
  const NAMES = { Lead: 'lead-id', Digger: 'digger-id', Weeder: 'weeder-id' }
  for (const [name, id] of Object.entries(NAMES)) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role: name === 'Lead' ? 'main' : 'worker', state: 'waiting', task: null, at: NOW - 5 * MIN }))
    await put(join(app, 'a', 'b', `local_${id}.json`), JSON.stringify({ title: `Garden - ${name}`, sessionId: `local_${id}`, cliSessionId: id, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW - MIN }))
    await put(join(transcripts, `${id}.jsonl`), `${[typed(NOW - 9 * MIN, 'Go on.'), answer(NOW - 8 * MIN, 'On it.')].join('\n')}\n`)
  }
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Garden\n- [ ] B730 Something else (about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({
    name: 'deaf', project, port, gamePort: 7360, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'),
    unknownAfterSeconds: UNKNOWN_S, offAfterMinutes: OFF_MIN,
  }))
  // The board writes its history lines every second, as its look would have every minute that evening.
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_TICK_MS: '1000' })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const base = `http://127.0.0.1:${port}`
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  assert.ok(token, 'the served page carries the token')
  const stateNow = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const lanesOf = state => Object.fromEntries(Object.keys(NAMES).map(name => {
    const lane = (state.chats ?? []).find(one => one.name === name && !one.isLeftover)
    return [name, `${lane?.state}${lane?.isRunning === true ? '' : ` (running ${lane?.isRunning})`}`]
  }))
  // Each chat's mod: its 5-second ping (a take with its report), as that evening's mods sent them.
  let seq = 0
  const ping = (name, state) => fetch(`${base}/api/bridge/take`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.21.0' },
    body: JSON.stringify({ chat: name, session: NAMES[name], report: { state, since: NOW - 3 * MIN, background: false, run: 1, seq: ++seq } }),
  }).then(reply => reply.ok, () => false)
  const EVENING = { Lead: 'idle', Digger: 'busy', Weeder: 'busy' }
  const pingAll = names => Promise.all(names.map(name => ping(name, EVENING[name])))
  const write = name => appendFile(join(transcripts, `${NAMES[name]}.jsonl`), `${step(Date.now(), 'Build')}\n`)

  // 21:09 to 21:12:44: the board hears every chat.
  await until(async () => {
    await pingAll(Object.keys(NAMES))
    const lanes = lanesOf(await stateNow())
    return lanes.Lead === 'free' && lanes.Digger === 'working' && lanes.Weeder === 'working'
  }, 'the lead free and both workers working')
  const before = lanesOf(await stateNow())

  // 21:12:44 to 21:21:20: the board hears no chat, past the off time, while the workers write their conversations.
  const deafFrom = Date.now()
  const seen = []
  let deafNow = null
  while (Date.now() - deafFrom < OFF_MIN * MIN + 15_000) {
    await Promise.all([write('Digger'), write('Weeder')])
    const state = await stateNow()
    seen.push(lanesOf(state))
    deafNow = state.deafNow ?? deafNow
    await pause(3_000)
  }
  const last = await stateNow()
  assert.ok(seen.length >= 20, `the board was asked through the stretch (${seen.length})`)
  assert.deepEqual(seen.filter(lanes => JSON.stringify(lanes) !== JSON.stringify(before)), [], 'no lane changes while the board hears no chat')
  assert.ok(Number.isFinite(deafNow?.from) && deafNow.from <= deafFrom, 'the state names the stretch the board hears no chat')
  // No history line of the stretch reads a chat unknown or off (that evening: all unknown at 21:13:14, all off at 21:18:39).
  const history = (await readFile(join(board, 'data', 'history.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
  assert.deepEqual(history.filter(line => line.at >= deafFrom && ['unknown', 'off'].includes(line.state)).map(line => `${line.chat} ${line.state}`), [])
  // working-not-running finds nothing on the board's state, even counted 6 min on.
  const rule = WATCH_RULES.find(one => one.id === 'working-not-running')
  const found = rule.check(buildView({ state: last, items: new Map(), now: Date.now() + 6 * MIN }), { seen: new Map(), observed: [] })
  assert.deepEqual(found.map(one => one.subject), [])

  // 21:21:20: the board hears the lead and one worker again; the other, silent alone past the off time, reads off.
  await until(async () => {
    await pingAll(['Lead', 'Digger'])
    const lanes = lanesOf(await stateNow())
    return lanes.Weeder !== 'working'
  }, 'the worker silent alone no longer read as working')
  const after = lanesOf(await stateNow())
  assert.deepEqual(after, { Lead: 'free', Digger: 'working', Weeder: 'off (running false)' })
})
