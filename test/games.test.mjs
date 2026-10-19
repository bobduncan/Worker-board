import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkGame, createGames, gameLauncher, idleWatch } from '../src/games.mjs'

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), '..', 'run-game.mjs')
// B197: the board's folder, and the start command examples/config.json gives for a Vite game: the tests run it.
const BOARD = join(dirname(fileURLToPath(import.meta.url)), '..')
const COMMAND = JSON.parse(readFileSync(join(BOARD, 'examples', 'config.json'), 'utf8')).runGame

const need = (id, game) => ({ id, game })
const state = {
  forYou: [need('walk', { branch: 'fix/walk', folder: 'units', path: 'C:\\game-units', url: null, since: null }), need('chat:Units:1', null)],
  backlogForYou: [need('backlog:B14', { branch: 'main', folder: 'game', path: 'C:\\game', url: null, since: null })],
  backlogClosed: [need('backlog:B02', { branch: 'gone', folder: null, path: null, url: null, since: null })],
  mainGame: { branch: 'main', folder: 'game', path: 'C:\\game', url: null, since: null },
}

test('checkGame: a request with a branch that is in a working folder may be started and stopped', () => {
  assert.deepEqual(checkGame({ item: 'walk', action: 'start' }, state), { ok: true, action: 'start', branch: 'fix/walk', path: 'C:\\game-units' })
  assert.deepEqual(checkGame({ item: 'backlog:B14', action: 'stop' }, state), { ok: true, action: 'stop', branch: 'main', path: 'C:\\game' })
})

test('checkGame: the game of main is always there to start, when git knows the folder of main', () => {
  assert.deepEqual(checkGame({ item: 'main', action: 'start' }, state), { ok: true, action: 'start', branch: 'main', path: 'C:\\game' })
  assert.equal(checkGame({ item: 'main', action: 'start' }, { ...state, mainGame: null }).status, 409)
})

test('checkGame: the page names a request, never a folder or a command', () => {
  assert.equal(checkGame({ item: 'walk', action: 'start', path: 'C:\\elsewhere' }, state).path, 'C:\\game-units')
  assert.equal(checkGame({ path: 'C:\\game', action: 'start' }, state).ok, false)
  assert.equal(checkGame({ item: 'walk', action: 'delete' }, state).status, 400)
  assert.equal(checkGame(null, state).status, 400)
  assert.equal(checkGame([], state).status, 400)
})

test('checkGame: a request without a branch, or whose branch is in no folder, starts nothing and says why', () => {
  assert.equal(checkGame({ item: 'chat:Units:1', action: 'start' }, state).status, 409)
  assert.equal(checkGame({ item: 'unknown', action: 'start' }, state).status, 409)
  const gone = checkGame({ item: 'backlog:B02', action: 'start' }, state)
  assert.equal(gone.status, 409)
  assert.match(gone.why, /gone/)
})

/** A launcher that starts nothing: it counts the starts and lets the test end a game. */
function fakeLauncher(hold = false) {
  const started = []
  const launch = ({ path, port, onExit }) => {
    const game = { path, port, onExit, isStopped: false }
    started.push(game)
    // `hold` keeps a game starting until the test lets it serve.
    const ready = new Promise(resolve => {
      game.serve = () => resolve(`http://127.0.0.1:${port}/`)
      if (!hold) game.serve()
    })
    return { ready, stop: () => { game.isStopped = true } }
  }
  return { started, launch }
}

test('a folder\'s game is started once: asking again gives the same address', async () => {
  const { started, launch } = fakeLauncher()
  const games = createGames({ launch, now: () => 500 })
  const [first, second] = await Promise.all([games.start({ path: 'C:\\game-units', port: 5301 }), games.start({ path: 'c:/game-units', port: 5301 })])
  assert.equal(first, 'http://127.0.0.1:5301/')
  assert.equal(second, first)
  assert.equal(await games.start({ path: 'C:\\game-units', port: 5301 }), first)
  assert.equal(started.length, 1)
  assert.deepEqual(games.list(), [{ path: 'C:\\game-units', url: first, startedAt: 500 }])
})

test('a game that stops by itself is no longer listed, and can be started again', async () => {
  const { started, launch } = fakeLauncher()
  const games = createGames({ launch })
  await games.start({ path: 'C:\\game', port: 5300 })
  started[0].onExit()
  assert.deepEqual(games.list(), [])
  await games.start({ path: 'C:\\game', port: 5300 })
  assert.equal(started.length, 2)
})

test('stopping ends the game of that folder only; stopping all ends every one', async () => {
  const { started, launch } = fakeLauncher()
  const games = createGames({ launch })
  await games.start({ path: 'C:\\game', port: 5300 })
  await games.start({ path: 'C:\\game-units', port: 5301 })
  assert.equal(games.stop('C:\\game'), true)
  assert.equal(games.stop('C:\\game'), false)
  assert.deepEqual([started[0].isStopped, started[1].isStopped], [true, false])
  assert.deepEqual(games.list().map(game => game.path), ['C:\\game-units'])
  games.stopAll()
  assert.equal(started[1].isStopped, true)
  assert.deepEqual(games.list(), [])
})

test('a game that is still starting is stopped too: by its Stop, and when the board ends', async () => {
  const { started, launch } = fakeLauncher(true)
  const games = createGames({ launch })
  games.start({ path: 'C:\\game', port: 5300 }).catch(() => {})
  games.start({ path: 'C:\\game-units', port: 5301 }).catch(() => {})
  assert.equal(games.stop('C:\\game'), true)
  assert.deepEqual([started[0].isStopped, started[1].isStopped], [true, false])
  games.stopAll()
  assert.equal(started[1].isStopped, true)
})

test('a game that does not start leaves nothing behind and says why', async () => {
  const games = createGames({ launch: () => ({ ready: Promise.reject(new Error('The game did not start.')), stop: () => {} }) })
  await assert.rejects(games.start({ path: 'C:\\game', port: 5300 }), /did not start/)
  assert.deepEqual(games.list(), [])
})

test('a game that ended before it was listed is not listed', async () => {
  const games = createGames({
    launch: ({ onExit }) => {
      onExit()
      return { ready: Promise.resolve('http://127.0.0.1:5300/'), stop: () => {} }
    },
  })
  await assert.rejects(games.start({ path: 'C:\\game', port: 5300 }), /stopped/)
  assert.deepEqual(games.list(), [])
})

test('idleWatch: a game nobody opened is over after the time allowed for opening it', () => {
  const watch = idleWatch({ idleMs: 30_000, graceMs: 120_000, now: 0 })
  assert.equal(watch.isOver(119_000), false)
  assert.equal(watch.isOver(120_000), true)
})

test('idleWatch: a game is over once its last tab has been closed for the idle time, not while one is open', () => {
  const watch = idleWatch({ idleMs: 30_000, graceMs: 120_000, now: 0 })
  watch.opened()
  watch.opened()
  watch.closed(10_000)
  assert.equal(watch.isOver(900_000), false)
  watch.closed(1_000_000)
  assert.equal(watch.isOver(1_029_000), false)
  assert.equal(watch.isOver(1_030_000), true)
})

test('idleWatch: a reload closes and opens again, and the game stays', () => {
  const watch = idleWatch({ idleMs: 30_000, graceMs: 120_000, now: 0 })
  watch.opened()
  watch.closed(5_000)
  watch.opened()
  assert.equal(watch.isOver(500_000), false)
})

/**
 * A made-up game folder: its "vite" is a plain web server with the two calls the runner uses, so the runner is
 * tried for real without the real game.
 */
async function madeUpGame(t) {
  const folder = await mkdtemp(join(tmpdir(), 'board-game-'))
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const vite = join(folder, 'node_modules', 'vite')
  await mkdir(vite, { recursive: true })
  await writeFile(join(vite, 'package.json'), JSON.stringify({ name: 'vite', type: 'module', exports: { '.': './index.js' } }))
  await writeFile(join(vite, 'index.js'), `
import { createServer as http } from 'node:http'
export async function createServer(config) {
  const httpServer = http((req, res) => res.end(JSON.stringify({ root: config.root, cacheDir: config.cacheDir, host: config.server.host })))
  return {
    httpServer,
    listen: () => new Promise(done => httpServer.listen(config.server.port, config.server.host, done)),
    close: () => new Promise(done => httpServer.close(done)),
  }
}
`)
  return folder
}

const exited = child => new Promise(done => child.once('exit', code => done(code)))

test('the runner stops by itself when nothing was opened', async t => {
  const folder = await madeUpGame(t)
  const child = spawn(process.execPath, [RUNNER, '--folder', folder, '--port', '0', '--idle', '1', '--grace', '1', '--cache', join(folder, 'cache')], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  let out = ''
  child.stdout.on('data', chunk => { out += chunk })
  const started = Date.now()
  assert.equal(await exited(child), 0)
  assert.match(out, /^ready \d+$/m)
  assert.ok(Date.now() - started < 15_000)
})

test('the launcher serves the folder on this machine only; the game stays while a tab is open and ends after it is closed', async t => {
  const folder = await madeUpGame(t)
  let hasExited = false
  const launch = gameLauncher({ command: COMMAND, board: BOARD, cacheDir: join(folder, 'cache'), idleSeconds: 1, graceSeconds: 20 })
  const game = launch({ path: folder, port: 0, onExit: () => { hasExited = true } })
  t.after(() => game.stop())
  const url = await game.ready
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/)

  const port = Number(new URL(url).port)
  const tab = connect(port, '127.0.0.1')
  await new Promise(done => tab.once('connect', done))
  // What the folder's vite was asked to serve, and where it was told to listen.
  const asked = await (await fetch(url)).json()
  assert.deepEqual([asked.root, asked.host, asked.cacheDir], [folder, '127.0.0.1', join(folder, 'cache', folder.replace(/\\/g, '/').split('/').pop().toLowerCase())])
  await new Promise(done => setTimeout(done, 2_500))
  assert.equal(hasExited, false, 'it stays while a tab is open')

  tab.destroy()
  const until = Date.now() + 10_000
  while (!hasExited && Date.now() < until) await new Promise(done => setTimeout(done, 100))
  assert.equal(hasExited, true, 'it ends once the tab is closed')
})

test('the launcher says so when a folder has no game to start', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'board-game-'))
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  let hasExited = false
  const launch = gameLauncher({ command: COMMAND, board: BOARD, cacheDir: join(folder, 'cache'), idleSeconds: 1, graceSeconds: 1 })
  await assert.rejects(launch({ path: folder, port: 0, onExit: () => { hasExited = true } }).ready, /did not start/)
  assert.equal(hasExited, true)
})

test('B197: the start command\'s words get the folder, the port and the rest filled in; an unknown word stays', async () => {
  const { commandFor } = await import('../src/games.mjs')
  assert.deepEqual(commandFor(['{node}', '{board}/run.mjs', '--at', '{folder}', '--port={port}', '{other}'], { node: 'node', board: '/b', folder: '/g', port: 5300 }),
    ['node', '/b/run.mjs', '--at', '/g', '--port=5300', '{other}'])
  assert.equal(COMMAND[1], '{board}/run-game.mjs')
})
