// B319: two projects, each with its own copy of the board, run at once on one PC without touching each other. The
// person, 2026-10-18 15:23: "i can run 2 projects using the same worker board code without it interfering with
// eachother. I do not need the same instance of the worker board todo both. i can runt he worker board twice perhaps
// each using their own workers." A list of the PC's boards (one file in the person's home folder) holds each
// project's port and its games' ports: the first board to run on a port keeps it for its project, and a board whose
// port another project holds takes the next free one. Made-up projects in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { GAME_SPAN, HAND_PORTS, OWN_PORTS_FROM, boardProject, boardsFile, chooseHome, parseBoards, portIsBusy, readBoards, registerHome, resolvePort } from '../src/ports.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const A = 'C:\\Work\\alpha'
const B = 'D:\\Work\\beta'
const entry = (project, port, gamePort, asked = { port, gamePort }) => ({ project, folder: `${project}\\worker-board`, port, gamePort, asked })

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

async function folder(t, name = 'board-two-') {
  const dir = await mkdtemp(join(tmpdir(), name))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('boardsFile: one list per PC, in the person\'s home folder; WORKER_BOARD_HOME moves it', () => {
  assert.equal(boardsFile({}), join(homedir(), '.worker-board', 'boards.json'))
  assert.equal(boardsFile({ WORKER_BOARD_HOME: 'E:\\boards' }), join('E:\\boards', 'boards.json'))
})

test('parseBoards: the boards the list holds; anything else in it is left out', () => {
  const text = JSON.stringify({ boards: [entry(A, 4310, 5300), { project: B, port: 'x', gamePort: 5400 }, { port: 4312, gamePort: 5500 }, entry(B, 4311, 5400)] })
  assert.deepEqual(parseBoards(text).map(one => [one.project, one.port, one.gamePort]), [[A, 4310, 5300], [B, 4311, 5400]])
  for (const none of ['', 'not json', '[]', '{"boards":3}', 'null']) assert.deepEqual(parseBoards(none), [], none)
  // A board written before it knew what it was asked for keeps its ports as what it asked for.
  assert.deepEqual(parseBoards(JSON.stringify({ boards: [{ project: A, port: 4310, gamePort: 5300 }] }))[0].asked, { port: 4310, gamePort: 5300 })
})

test('chooseHome: the first project keeps its port; another project\'s board takes the next free port and game range', () => {
  const asked = { configured: 4310, gamePort: 5300 }
  // Alone on the PC: the configured ports.
  assert.deepEqual(chooseHome({ project: A, ...asked, boards: [] }), { port: 4310, gamePort: 5300, why: 'main', holder: null })
  // Its own entry is its own: started again, nothing changes.
  assert.deepEqual(chooseHome({ project: A, ...asked, boards: [entry(A, 4310, 5300)] }), { port: 4310, gamePort: 5300, why: 'main', holder: null })
  // Another project holds 4310 and the games from 5300: the next free port, the next free range, and who holds it.
  // 4311 and 4312 are given by hand (the demo, a board that shows another's history) and 4320 up are the copies':
  // a board that moves passes over them.
  assert.deepEqual(HAND_PORTS, [4311, 4312])
  assert.deepEqual(chooseHome({ project: B, ...asked, boards: [entry(A, 4310, 5300)] }), { port: 4313, gamePort: 5300 + GAME_SPAN, why: 'moved', holder: A })
  // Ports something else uses are passed over too.
  assert.equal(chooseHome({ project: B, ...asked, boards: [entry(A, 4310, 5300)], busy: [4313, 4314] }).port, 4315)
  const crowded = [4313, 4314, 4315, 4316, 4317, 4318, 4319].map((port, at) => entry(`E:\\p${at}`, port, 6000 + at * GAME_SPAN))
  assert.equal(chooseHome({ project: B, ...asked, boards: [entry(A, 4310, 5300), ...crowded] }).port, OWN_PORTS_FROM + 100)
  // A project keeps what it was given, also once the other one is gone: its launch entry names that port.
  const beta = entry(B, 4311, 5400, { port: 4310, gamePort: 5300 })
  assert.deepEqual(chooseHome({ project: B, ...asked, boards: [entry(A, 4310, 5300), beta] }), { port: 4311, gamePort: 5400, why: 'kept', holder: null })
  assert.deepEqual(chooseHome({ project: B, ...asked, boards: [beta] }), { port: 4311, gamePort: 5400, why: 'kept', holder: null })
  // The first project keeps 4310 whoever else came: Lava Tactics' board works as today.
  assert.deepEqual(chooseHome({ project: A, ...asked, boards: [beta, entry(A, 4310, 5300)] }).port, 4310)
  // Paths are the same project whatever their case and slashes on Windows.
  assert.equal(chooseHome({ project: 'c:/work/ALPHA/', ...asked, boards: [entry(A, 4310, 5300)], platform: 'win32' }).why, 'main')
})

test('chooseHome: a port the person sets in config.json again is chosen anew from there', () => {
  const beta = entry(B, 4311, 5400, { port: 4310, gamePort: 5300 })
  assert.deepEqual(chooseHome({ project: B, configured: 4400, gamePort: 6000, boards: [entry(A, 4310, 5300), beta] }), { port: 4400, gamePort: 6000, why: 'main', holder: null })
  // Asked for a port another project holds: the next free one from there.
  assert.equal(chooseHome({ project: B, configured: 4310, gamePort: 5300, boards: [entry(A, 4310, 5300), entry('E:\\gamma', 4313, 5400)] }).port, 4314)
})

test('chooseHome: game ranges never meet another project\'s, whatever port they start on', () => {
  const boards = [entry(A, 4310, 5300), entry('E:\\gamma', 4312, 5450)]
  // 5300 meets A's range, 5400 meets gamma's (5450 to 5549): the first range of its own is 5600.
  const chosen = chooseHome({ project: B, configured: 4310, gamePort: 5300, boards })
  assert.equal(chosen.gamePort, 5600)
  for (const other of boards) assert.ok(chosen.gamePort >= other.gamePort + GAME_SPAN || other.gamePort >= chosen.gamePort + GAME_SPAN, String(other.gamePort))
  // A range that meets no other is kept as configured.
  assert.equal(chooseHome({ project: B, configured: 4311, gamePort: 7000, boards }).gamePort, 7000)
})

test('readBoards and registerHome: the list on disk; a project folder that is gone holds no port', async t => {
  const dir = await folder(t)
  const file = join(dir, 'home', 'boards.json')
  assert.deepEqual(await readBoards(file), [])
  const [alpha, beta] = [join(dir, 'alpha'), join(dir, 'beta')]
  await mkdir(alpha)
  await mkdir(beta)
  await registerHome(file, entry(alpha, 4310, 5300))
  await registerHome(file, entry(beta, 4311, 5400, { port: 4310, gamePort: 5300 }))
  // Registered again with other ports, a project has one entry, never two.
  await registerHome(file, entry(alpha, 4310, 5300))
  assert.deepEqual((await readBoards(file)).map(one => [one.project, one.port, one.gamePort]), [[alpha, 4310, 5300], [beta, 4311, 5400]])
  await rm(alpha, { recursive: true })
  assert.deepEqual((await readBoards(file)).map(one => one.project), [beta])
  // Two boards that register at the same moment both stay in the list.
  const more = await Promise.all(['one', 'two', 'three'].map(async (name, at) => {
    await mkdir(join(dir, name))
    return registerHome(file, entry(join(dir, name), 4320 + at, 6000 + at * GAME_SPAN))
  }))
  assert.equal(more.length, 3)
  assert.deepEqual((await readBoards(file)).map(one => one.port).sort(), [4311, 4320, 4321, 4322])
  assert.ok(!(await readFile(file, 'utf8')).includes('.lock'))
})

test('resolvePort: a project new to the list does not take a port another board listens on, unless that board is its own', async t => {
  const dir = await folder(t)
  const file = join(dir, 'boards.json')
  const [alpha, beta, here] = [join(dir, 'alpha'), join(dir, 'beta'), join(dir, 'board')]
  for (const one of [alpha, beta]) await mkdir(one)
  const start = more => resolvePort({ here, configured: 4310, gamePort: 5300, project: beta, boards: file, run: async () => null, ...more })
  // A board of before the list (it never wrote itself into it) listens on 4310 for alpha: beta does not take 4310.
  const busy = async port => port === 4310
  assert.deepEqual(await start({ isBusy: busy, identify: async () => alpha }), { port: 4313, gamePort: 5300, why: 'moved', holder: alpha, main: here, isMain: true })
  // Something that does not say whose it is, likewise.
  const unknown = await start({ isBusy: busy, identify: async () => null })
  assert.deepEqual([unknown.port, unknown.holder], [4313, null])
  // Its own board, running already: it keeps 4310.
  assert.equal((await start({ isBusy: busy, identify: async () => beta })).port, 4310)
  // Once in the list it is not asked again: the list says the port is its own.
  await registerHome(file, entry(beta, 4310, 5300))
  assert.equal((await start({ isBusy: busy, identify: async () => alpha })).port, 4310)
})

test('boardProject: the project of the board on a port, as its /api/board says; null for anything else', async t => {
  const serve = handler => new Promise(done => {
    const server = createServer(handler).listen(0, '127.0.0.1', () => done(server))
  })
  const board = await serve((req, res) => res.end(req.url === '/api/board' ? JSON.stringify({ board: 'worker-board', project: A }) : 'x'))
  const other = await serve((req, res) => res.end('<title>Something else</title>'))
  t.after(() => {
    board.close()
    other.close()
  })
  assert.equal(await boardProject(board.address().port), A)
  assert.equal(await boardProject(other.address().port), null)
  assert.equal(await boardProject(await freePort()), null)
})

test('portIsBusy: a port something listens on is busy, a free one is not', async t => {
  const server = createServer().listen(0, '127.0.0.1')
  await new Promise(done => server.once('listening', done))
  t.after(() => server.close())
  const { port } = server.address()
  assert.equal(await portIsBusy(port), true)
  server.close()
  await new Promise(done => server.once('close', done))
  assert.equal(await portIsBusy(port), false)
})

test('resolvePort with the PC\'s list: the main folder takes its project\'s port and games; a copy keeps away from other projects', async t => {
  const dir = await folder(t)
  const file = join(dir, 'boards.json')
  const [alpha, beta] = [join(dir, 'alpha'), join(dir, 'beta')]
  for (const one of [alpha, beta]) await mkdir(one)
  await registerHome(file, entry(alpha, 4310, 5300))
  const noGit = async () => null
  const here = join(dir, 'beta-board')
  const start = (more = {}) => resolvePort({ here, configured: 4310, gamePort: 5300, project: beta, boards: file, run: noGit, isBusy: async () => false, identify: async () => null, ...more })
  assert.deepEqual(await start(), { port: 4313, gamePort: 5400, why: 'moved', holder: alpha, main: here, isMain: true })
  // A port busy with something else is passed over; one where this project's own board listens already is its own.
  assert.equal((await start({ isBusy: async port => port === 4313 })).port, 4314)
  assert.equal((await start({ isBusy: async port => port === 4313, identify: async () => beta })).port, 4313)
  // A given port wins; the games keep the project's range.
  await registerHome(file, entry(beta, 4311, 5400, { port: 4310, gamePort: 5300 }))
  assert.deepEqual(await start({ given: '4399' }), { port: 4399, gamePort: 5400, why: 'given', main: here, isMain: true })
  // A copy in another folder of beta's board: its own port, never one another project holds, and beta's games.
  const copy = join(dir, 'beta-board-two')
  const list = [here, copy].map(path => `worktree ${path}\nHEAD 0\nbranch refs/heads/x\n`).join('\n')
  await registerHome(file, entry(join(dir, 'alpha'), 4320, 5300))
  const copied = await resolvePort({ here: copy, configured: 4310, gamePort: 5300, project: beta, boards: file, run: async () => list, isBusy: async () => false })
  assert.deepEqual([copied.port, copied.gamePort, copied.isMain], [4321, 5400, false])
  // A new copy's port that something listens on is passed over.
  const third = join(dir, 'beta-board-three')
  const three = [here, copy, third].map(path => `worktree ${path}\nHEAD 0\nbranch refs/heads/x\n`).join('\n')
  assert.equal((await resolvePort({ here: third, configured: 4310, gamePort: 5300, project: beta, boards: file, run: async () => three, isBusy: async port => port === 4322 })).port, 4323)
  // Without the list (the demo, the tests of old) nothing changes.
  assert.deepEqual(await resolvePort({ here, configured: 4310, run: noGit }), { port: 4310, why: 'main', main: here, isMain: true })
})

// The proof: two copies of the board, each with its own project, run at once and never meet.

const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures', 'mods']


/** A copy of this board in `dir/<name>-board` for a new project `dir/<name>`, configured on `port`. */
async function boardFor(dir, name, port) {
  const [board, project] = [join(dir, `${name}-board`), join(dir, name)]
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  await mkdir(join(project, '.claude'), { recursive: true })
  const empty = join(dir, `${name}-app`)
  await mkdir(empty)
  await writeFile(join(board, 'config.json'), JSON.stringify({
    name, project, port, gamePort: 7300, gameRepo: '', appSessions: empty, transcripts: empty, usageHistory: join(empty, 'none.json'),
  }))
  return { board, project }
}

/** Ends a board started here, and waits until it is gone. */
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const gone = new Promise(done => child.once('exit', done))
  child.kill('SIGKILL')
  await gone
}

/** Starts a board and answers once it listens (and has said `until`), with the port it says. */
function run(started, board, env, until = null) {
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
  started.push(child)
  return new Promise((done, fail) => {
    let out = ''
    const late = setTimeout(() => fail(new Error(`The board did not start: ${out}`)), 30_000)
    const read = chunk => {
      out += chunk
      const said = out.match(/Worker board: http:\/\/127\.0\.0\.1:(\d+)\//)
      if (said === null || (until !== null && !until.test(out))) return
      clearTimeout(late)
      done({ child, port: Number(said[1]), out })
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('exit', code => fail(new Error(`The board ended (${code}): ${out}`)))
  })
}

const take = (port, key) => fetch(`http://127.0.0.1:${port}/api/bridge/take`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key }, body: '{}',
}).then(answer => answer.status)

test('two projects\' boards run at once on one PC, each on its own port, with its own chats\' bridge and games', { timeout: 120_000 }, async t => {
  // The boards are stopped before their folders go: a running board holds its files.
  const dir = await mkdtemp(join(tmpdir(), 'board-two-run-'))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    await rm(dir, { recursive: true, force: true, maxRetries: 5 })
  })
  const home = join(dir, 'pc')
  const port = await freePort()
  const alpha = await boardFor(dir, 'alpha', port)
  const beta = await boardFor(dir, 'beta', port)
  const env = { WORKER_BOARD_HOME: home }

  const first = await run(started, alpha.board, env)
  assert.equal(first.port, port)
  // The second board is configured on the same port: it takes the next free one, and says whose that port is.
  const second = await run(started, beta.board, env, /belongs to the board of/)
  assert.notEqual(second.port, port)
  assert.ok(second.out.includes(`${port} belongs to the board of ${alpha.project}`), second.out)

  // Each board wrote where it is into its own project's folder, with a key of its own.
  const noteOf = async project => JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const [noteA, noteB] = [await noteOf(alpha.project), await noteOf(beta.project)]
  assert.deepEqual([noteA.url, noteB.url], [`http://127.0.0.1:${port}`, `http://127.0.0.1:${second.port}`])
  assert.notEqual(noteA.key, noteB.key)
  // A chat of one project cannot take from the other's board: the key is the board's own.
  assert.equal(await take(second.port, noteA.key), 403)
  assert.equal(await take(port, noteB.key), 403)
  assert.notEqual(await take(port, noteA.key), 403)
  assert.notEqual(await take(second.port, noteB.key), 403)

  // Each board says whose it is.
  const whose = async at => (await (await fetch(`http://127.0.0.1:${at}/api/board`)).json()).project
  assert.deepEqual([await whose(port), await whose(second.port)], [alpha.project, beta.project])

  // The PC's list holds both, with game ranges that never meet.
  const boards = await readBoards(boardsFile(env))
  const [listedA, listedB] = [alpha, beta].map(one => boards.find(board => board.project === one.project))
  assert.deepEqual([listedA.port, listedB.port], [port, second.port])
  assert.ok(listedB.gamePort >= listedA.gamePort + GAME_SPAN, `${listedA.gamePort} ${listedB.gamePort}`)

  // The second project's launch entry names its own port, so the Run pane and the Workers mod find it there.
  const entry = spawn(process.execPath, [join(beta.board, 'server.mjs'), '--launch-entry'], { cwd: beta.board, env: { ...process.env, ...env }, windowsHide: true })
  await new Promise(done => entry.once('exit', done))
  const launch = JSON.parse(await readFile(join(beta.project, '.claude', 'launch.json'), 'utf8'))
  assert.deepEqual(launch.configurations.map(one => [one.name, one.port]), [['beta-board', second.port]])

  // Started again, the first project's board still takes its own port: it is not another project's to take.
  await stop(first.child)
  const again = await run(started, alpha.board, env)
  assert.equal(again.port, port)
})
