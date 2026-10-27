// A real board process on a made-up project in a temporary folder, for the tests of a PC's sleep (B715, B724). The board runs
// as the process that does NOT run the loops (a live process of the test holds the lock), so it only reads history.jsonl and
// alive.json as written before it started: no minute look is awaited, and nothing writes a gap line.

import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loopOwner } from '../../src/supervisor/loop.mjs'
import { writeAtomic } from '../../src/write.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']

export const MIN = 60_000
export const HOUR = 60 * MIN

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(board, env, port) {
  const child = spawn(process.execPath, [join(board, 'server.mjs'), '--port', String(port)], { cwd: board, env: { ...process.env, ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
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

/** A run that was killed leaves its folder (3.5 MB each): the ones of earlier runs, older than an hour, go at the start. */
let cleared = null
const clearOld = () => cleared ??= (async () => {
  for (const name of await readdir(tmpdir()).catch(() => [])) {
    if (!name.startsWith('board-sleep-')) continue
    const folder = join(tmpdir(), name)
    const old = await stat(folder).then(one => Date.now() - one.mtimeMs > HOUR, () => false)
    if (old) await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
  }
})()

const wait = ms => new Promise(done => setTimeout(done, ms))

/** Polls `check` until it answers something, or fails after `within` ms. */
export async function until(check, what, within) {
  for (const end = Date.now() + within; Date.now() < end;) {
    const found = await check()
    if (found) return found
    await wait(100)
  }
  throw new Error(`Not within ${within / 1000} s: ${what}`)
}

/** A history line of the chat Picker working. */
export const working = at => ({ at, chat: 'Picker', state: 'working', task: 'Pick', step: null, steps: null, leftMs: null, estimateAt: null, startedAt: null, source: 'chat', by: null })

/**
 * Starts a board whose history and alive.json are written by `prepare({ start, put, board })` before it runs. Returns
 * `{ start, stateNow, write, close }`: `start` is the time the files were written against, `stateNow()` the board's /api/state,
 * `write(name, text)` rewrites a file of its data folder (the board's next look, 300 ms, reads it again), `close()` ends the board and removes its folder.
 */
export async function startBoard(prepare) {
  await clearOld()
  const dir = await mkdtemp(join(tmpdir(), 'board-sleep-'))
  let child = null
  let beat = null
  const close = async () => {
    clearInterval(beat)
    if (child !== null) await stop(child)
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  try {
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
    await prepare({ start, put, board })
    // Another process of this project holds the loops: this one only reads what that one keeps. The lock is held with the
    // board's own lock code (loopOwner, written atomically as the board writes it), so a board never reads it empty and
    // takes the loops, however busy the PC is.
    const lock = join(project, '.claude', 'sync-loop.json')
    const holder = loopOwner({
      read: () => readFile(lock, 'utf8'),
      write: text => writeAtomic(lock, text),
      alive: () => true,
      pid: process.pid,
      port: 1,
      now: Date.now,
    })
    await holder()
    beat = setInterval(() => holder().catch(() => {}), 500)

    child = await run(board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_TICK_MS: '300' }, port)
    const page = await fetch(`http://127.0.0.1:${port}/`).then(res => res.text())
    const token = page.match(/name="board-token" content="([0-9a-f]{64})"/)?.[1]
    if (!token) throw new Error('the page holds no token')
    const stateNow = () => fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'X-Board-Token': token } }).then(res => res.json())
    const write = (name, text) => put(join(board, 'data', name), text)
    return { start, stateNow, write, close }
  } catch (error) {
    await close()
    throw error
  }
}
