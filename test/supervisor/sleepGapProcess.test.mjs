// B715 (the fix of B714's result check): the board's own pass, not buildState, reads a night's sleep. A real board process on
// a made-up project in a temporary folder serves /api/state; its `gaps` go on to the stale-checkpoint rule. The board runs
// as the process that does NOT run the loops (a live process of the test holds the lock), so it only reads: each look
// reloads history.jsonl and alive.json as the holder left them, and nothing writes the gap line. That is the first read after
// a wake, before the tick: the sleep is the open gap that server.mjs hands to the state from alive.json. Cases: a closed gap
// a day and more old still counts (the gap lines over all history), and an open gap of a whole night (9 h) counts, so a step
// taken before the sleep is not late after it, while a step quiet 2 h of running time still is.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const MIN = 60_000
const HOUR = 60 * MIN

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(started, board, env, port) {
  const child = spawn(process.execPath, [join(board, 'server.mjs'), '--port', String(port)], { cwd: board, env: { ...process.env, ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
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

const wait = ms => new Promise(done => setTimeout(done, ms))

async function until(check, what, within) {
  for (const end = Date.now() + within; Date.now() < end;) {
    const found = await check()
    if (found) return found
    await wait(500)
  }
  throw new Error(`Not within ${within / 1000} s: ${what}`)
}

const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'working', isRunning: true, queue: [], compaction: null, task: null, ...more })
const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const check = view => WATCH_RULES.find(one => one.id === 'stale-checkpoint').check(view, { seen: new Map(), observed: [] })

/** The rule on a step in progress since `since`, fed the gaps the board served and the hours the chat ran. */
function lateAt({ gaps, since, now, ran }) {
  const items = new Map([['B704', item({ Id: 'B704', Kind: 'step', Title: 'Step B704 of the orchard', State: 'in progress', Since: stamp(since), Owner: 'Picker' })]])
  return check(buildView({
    state: { chats: [lane('Lead', { isMain: true }), lane('Picker')], chatPrefix: '', pause: null, today: [{ chat: 'Picker', spans: [{ from: ran, to: now, state: 'working' }] }], gaps, limits: {} },
    items, settings: {}, now,
  })).length
}

test('B715: through a running board, a gap over a day old and a night\'s sleep read before the tick are board-off time, not a late step', { timeout: 240_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-sleep-'))
  const started = []
  let beat = null
  t.after(async () => {
    clearInterval(beat)
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
  const start = Date.now()
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main"}')
  for (const [name, role] of [['Main', 'main'], ['Picker', 'worker']]) {
    await put(join(chats, `${name.toLowerCase()}-id.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: start }))
    await put(join(app, 'a', 'b', `local_${name.toLowerCase()}.json`), JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `${name.toLowerCase()}-id`, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: start }))
    await put(join(transcripts, `${name.toLowerCase()}-id.jsonl`), '')
  }
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'sleep', project, port, refreshSeconds: 5, morningRound: '00:00', weeklyRound: false, gamePort: 7400, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))

  // The history before the run: Picker working to 30 h ago, the board off from then for an hour (a closed gap, written long ago),
  // working again, and the last line 9 h 10 min ago (the board had it that way when the PC went to sleep).
  const working = at => ({ at, chat: 'Picker', state: 'working', task: 'Pick', step: null, steps: null, leftMs: null, estimateAt: null, startedAt: null, source: 'chat', by: null })
  const old = { from: start - 30 * HOUR, to: start - 29 * HOUR }
  const lines = [working(old.from - 10 * MIN), { at: old.from, gap: true }, working(old.to), working(start - 9 * HOUR - 10 * MIN)]
  await put(join(board, 'data', 'history.jsonl'), `${lines.map(one => JSON.stringify(one)).join('\n')}\n`)
  // The board that ran last looked a minute ago: it starts with no gap of its own to write.
  await put(join(board, 'data', 'alive.json'), JSON.stringify({ at: start - MIN }))
  // Another process of this project holds the loops: this one only reads what that one keeps.
  const lock = join(project, '.claude', 'sync-loop.json')
  const hold = () => writeFile(lock, JSON.stringify({ pid: process.pid, port: 1, at: Date.now() }))
  await hold()
  beat = setInterval(() => hold().catch(() => {}), 500)

  const child = await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') }, port)
  assert.equal(child.exitCode, null)
  const page = await fetch(`http://127.0.0.1:${port}/`).then(res => res.text())
  const token = page.match(/name="board-token" content="([0-9a-f]{64})"/)?.[1]
  assert.ok(token, 'the page holds its token')
  const stateNow = () => fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'X-Board-Token': token } }).then(res => res.json())

  // 1. The closed gap of a day and more ago stands in the state, from the gap lines over all of the history.
  const first = await stateNow()
  assert.deepEqual(first.gaps, [old], 'a gap 30 h old is served')

  // 2. The PC sleeps: the holder's last look was 9 h ago, its history ends with a work line, no gap line is written yet (the
  // holder is asleep). The next look of this process reads both files again; the state serves the sleep as the open gap.
  const asleep = Date.now() - 9 * HOUR
  await put(join(board, 'data', 'alive.json'), JSON.stringify({ at: asleep }))
  const slept = await until(async () => {
    const state = await stateNow()
    return state.gaps.length === 2 ? state : null
  }, 'the state to serve the night as an open gap', 100_000)
  assert.deepEqual(slept.gaps[0], old)
  assert.equal(slept.gaps[1].from, asleep, 'the open gap begins when the board last looked')
  assert.ok(slept.gaps[1].to >= slept.readAt - 1000 && slept.gaps[1].to <= Date.now(), 'and runs to now')

  // The rule on what the board served: B704 was taken 10 min before the sleep and the chat has run 10 min since the wake: not late.
  const wake = slept.gaps[1].to
  assert.equal(lateAt({ gaps: slept.gaps, since: asleep - 10 * MIN, now: wake + 10 * MIN, ran: wake }), 0)
  // The guard: without the gaps the wall time counts and the same step is late.
  assert.equal(lateAt({ gaps: [], since: asleep - 10 * MIN, now: wake + 10 * MIN, ran: wake }), 1)
  // A step quiet 2 h of running time after the wake is late, the sleep notwithstanding.
  assert.equal(lateAt({ gaps: slept.gaps, since: asleep - 10 * MIN, now: wake + 130 * MIN, ran: wake }), 1)
})
