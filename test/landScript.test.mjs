// The go-live script, tools/land.ps1 (2026-11-04), run for real in Windows PowerShell against made-up things only: a temporary
// bare remote, a temporary "main checkout" with a made-up board in it (fixtures/land/server.mjs, a small http server that
// answers what the script asks of a board), a temporary "trial" clone with the remote `local`, and made-up gates (fixtures/land/
// gate.mjs). Never against the real boards on 4310 and 4314: the ports are free ones, the folders are temporary, and the
// script's own settings (-Config) say so. Each landing takes some ten seconds (PowerShell, a worktree, the PC's process list).
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { hhmm } from '../src/landing.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'tools', 'land.ps1')
const FIXTURES = join(ROOT, 'fixtures', 'land')
const isWindows = process.platform === 'win32'
const skip = isWindows ? false : 'tools/land.ps1 runs in Windows PowerShell only'
const MIN = 60_000
const LONG = { timeout: 400_000, skip }

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})
const sleep = ms => new Promise(done => setTimeout(done, ms))
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true }).trim()
const lines = text => text.replace(/\r/g, '').split('\n').filter(line => line !== '')

/** What a made-up board answers: `{ commit, since }`, null when it does not answer. */
async function boardState(port) {
  try {
    const page = await (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) })).text()
    const token = page.match(/name="board-token" content="([^"]+)"/)[1]
    return (await (await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'X-Board-Token': token }, signal: AbortSignal.timeout(3000) })).json()).version
  } catch {
    return null
  }
}

/** Gives the made-up checkouts, remote, boards and settings of one test; everything is removed after it. */
async function makeWorld(t, { live = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'land-script-'))
  const world = {
    root, main: join(root, 'main'), trial: join(root, 'trial'), remote: join(root, 'remote.git'), tmp: join(root, 'tmp'), configFile: join(root, 'config.json'),
    processesFile: join(root, 'processes.json'), connectionsFile: join(root, 'connections.json'), started: [], ports: [await freePort(), await freePort()],
  }
  world.data = join(world.main, 'data')
  t.after(async () => {
    const pids = [...world.started.map(child => child.pid), ...[world.main, world.trial].map(dir => Number(existsSync(join(dir, 'data', 'pid.txt')) ? readFileSync(join(dir, 'data', 'pid.txt'), 'utf8') : 0))]
    for (const pid of pids.filter(Boolean)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    await sleep(300)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  })
  mkdirSync(world.tmp)
  mkdirSync(world.main)
  git(world.main, 'init', '-q', '-b', 'main')
  for (const [name, value] of [['user.name', 'Land Test'], ['user.email', 'land@test.invalid']]) git(world.main, 'config', name, value)
  await cp(join(FIXTURES, 'server.mjs'), join(world.main, 'server.mjs'))
  await cp(join(FIXTURES, 'start-board.mjs'), join(world.main, 'start-board.mjs'))
  await writeFile(join(world.main, '.gitignore'), 'data/\nnode_modules/\n')
  await writeFile(join(world.main, 'README.md'), 'a made-up worker board\n')
  git(world.main, 'add', '-A')
  git(world.main, 'commit', '-q', '-m', 'the made-up board')
  git(root, 'init', '-q', '--bare', '-b', 'main', world.remote)
  git(world.main, 'remote', 'add', 'origin', world.remote)
  git(world.main, 'push', '-q', 'origin', 'main')
  git(root, 'clone', '-q', '-o', 'local', world.main, world.trial)
  git(world.trial, 'remote', 'add', 'origin', world.remote)
  for (const [name, value] of [['user.name', 'Land Test'], ['user.email', 'land@test.invalid']]) git(world.trial, 'config', name, value)
  mkdirSync(join(world.main, 'node_modules'))
  writeFileSync(join(world.main, 'node_modules', 'marker.txt'), 'the junction must show this and must never be emptied')
  for (const [dir, port] of [[world.main, world.ports[0]], [world.trial, world.ports[1]]]) {
    mkdirSync(join(dir, 'data'), { recursive: true })
    writeFileSync(join(dir, 'data', 'port.txt'), String(port))
  }
  world.before = git(world.main, 'rev-parse', 'HEAD')
  writeFileSync(world.processesFile, '[]')
  writeFileSync(world.connectionsFile, '[]')

  world.gate = mode => `node "${join(FIXTURES, 'gate.mjs')}" ${mode}`
  /** Writes the script's settings (the PowerShell run reads them); `changes` replace the defaults. */
  world.config = (changes = {}) => {
    const settings = {
      main: world.main, boards: [{ dir: world.main, port: world.ports[0] }, { dir: world.trial, port: world.ports[1] }], remote: 'origin', trialRemote: 'local',
      gateBoard: world.gate('board-pass'), gateMod: world.gate('mod-pass'), tempRoot: world.tmp, nodeModules: join(world.main, 'node_modules'),
      comeBackSeconds: 20, pollMs: 200, lockStaleMinutes: 15, ...(live ? {} : { processesFile: world.processesFile, connectionsFile: world.connectionsFile }), ...changes,
    }
    writeFileSync(world.configFile, JSON.stringify(settings))
  }
  world.config()
  /** Starts the made-up board of a folder as a board's process (its folder's server.mjs by full path) and waits until it answers. */
  world.board = async (dir, port, { args = [], nodeArgs = [] } = {}) => {
    const child = spawn(process.execPath, [...nodeArgs, join(dir, 'server.mjs'), '--port', String(port), ...args], { cwd: dir, stdio: 'ignore', windowsHide: true })
    world.started.push(child)
    for (let tries = 0; tries < 100 && (await boardState(port)) === null; tries += 1) await sleep(100)
    assert.notEqual(await boardState(port), null, `the made-up board on ${port} did not start`)
    return child
  }
  /** Both made-up boards; the first gets `first`'s options. */
  world.boards = async (first = {}) => {
    await world.board(world.main, world.ports[0], first)
    await world.board(world.trial, world.ports[1])
  }
  /** A branch from main's head with `files` in one commit; the checkout goes back to main. Gives the branch's head. */
  world.branch = (name, files = { 'feature.txt': `${name}\n` }) => {
    git(world.main, 'switch', '-q', '-c', name)
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(world.main, file)), { recursive: true })
      writeFileSync(join(world.main, file), text)
    }
    git(world.main, 'add', '-A')
    git(world.main, 'commit', '-q', '-m', `work on ${name}`)
    const head = git(world.main, 'rev-parse', 'HEAD')
    git(world.main, 'switch', '-q', 'main')
    return head
  }
  /** A commit on main itself, so a branch made before it no longer contains main. */
  world.mainMoves = () => {
    writeFileSync(join(world.main, 'other.txt'), 'someone else landed\n')
    git(world.main, 'add', '-A')
    git(world.main, 'commit', '-q', '-m', 'another landing')
    git(world.main, 'push', '-q', 'origin', 'main')
    return git(world.main, 'rev-parse', 'HEAD')
  }
  /** Runs the script as a chat does, with the made-up settings. `{ status, out }`; the words as lines. */
  world.land = (...args) => new Promise(done => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args, '-Config', world.configFile], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { out += chunk })
    const late = setTimeout(() => child.kill(), 380_000)
    child.on('exit', status => {
      clearTimeout(late)
      done({ status, out: out.replace(/\r/g, '').trim() })
    })
  })
  world.landings = () => (existsSync(join(world.data, 'landings.jsonl')) ? readFileSync(join(world.data, 'landings.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [])
  world.worktrees = () => git(world.main, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length
  return world
}

/** What every run leaves behind however it ended: no gate worktree, no junction, no helper folder, no lock, node_modules whole. */
function assertCleanedUp(world) {
  assert.deepEqual(readdirSync(world.tmp), [], 'the temporary folders of the run are gone')
  assert.equal(world.worktrees(), 1, 'the gate worktree is removed and pruned')
  assert.equal(existsSync(join(world.main, 'node_modules', 'marker.txt')), true, 'the junction was removed with rmdir: the target is whole')
  assert.equal(existsSync(join(world.data, 'landing.lock')), false, 'the lock is given back')
}

test('a landing: main moves to the gated head, the remote and the trial copy follow, both boards come back on it, one line says so', LONG, async t => {
  const world = await makeWorld(t, { live: true })
  const head = world.branch('feat')
  await world.boards()
  const was = await Promise.all(world.ports.map(boardState))
  const ran = await world.land('feat', '-By', 'chat 3')
  assert.equal(ran.status, 0, ran.out)
  const out = lines(ran.out)
  assert.match(out.at(-1), /^landed: feat by chat 3$/)
  assert.ok(out.some(line => line === `before ${world.before.slice(0, 7)} -> after ${head.slice(0, 7)} (trial ${head.slice(0, 7)})`), ran.out)
  // Main, the remote and the trial copy are on the gated head, as a fast-forward.
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), head)
  assert.equal(git(world.remote, 'rev-parse', 'main'), head)
  assert.equal(git(world.trial, 'rev-parse', 'HEAD'), head)
  assert.equal(git(world.main, 'rev-parse', 'main^'), world.before)
  // Both boards restarted and run the new commit.
  const now = await Promise.all(world.ports.map(boardState))
  now.forEach((state, at) => {
    assert.equal(state.commit, head.slice(0, 7))
    assert.ok(state.since > was[at].since, 'restarted')
  })
  for (const port of world.ports) assert.ok(out.some(line => new RegExp(`^${port}: commit ${head.slice(0, 7)} since \\d\\d:\\d\\d:\\d\\d$`).test(line)), ran.out)
  // The gate ran on the exact head in a worktree with the junction, and left no trace.
  const log = readFileSync(world.landings()[0].gateLog, 'utf8')
  assert.match(log, /node_modules marker: present/)
  assert.match(log, /\u2139 fail 0/)
  assert.ok(!log.includes('mod gate'), 'the branch does not touch mods/workers: no mod gate')
  assertCleanedUp(world)
  // One landings line, with every field.
  const written = world.landings()
  assert.equal(written.length, 1)
  const [line] = written
  assert.deepEqual(Object.keys(line), ['at', 'by', 'branch', 'head', 'before', 'after', 'trial', 'result', 'why', 'boards', 'cold', 'gateLog'])
  assert.deepEqual([line.by, line.branch, line.head, line.before, line.after, line.trial, line.result, line.why, line.cold], ['chat 3', 'feat', head, world.before, head, head, 'landed', null, false])
  assert.deepEqual(line.boards.map(one => [one.port, one.commit]), world.ports.map(port => [port, head.slice(0, 7)]))
  assert.ok(line.boards.every(one => Number.isFinite(one.since)))
  assert.match(line.gateLog, /landings[\\/]\d{8}-\d{6}-feat\.log$/)
})

test('a branch that does not contain main is refused before anything changes: main, the remote and the boards stay as they were', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  const moved = world.mainMoves()
  await world.boards()
  const was = await Promise.all(world.ports.map(boardState))
  const ran = await world.land('feat')
  assert.equal(ran.status, 1)
  assert.equal(lines(ran.out).at(-1), 'refused: merge main into feat first')
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), moved)
  assert.equal(git(world.remote, 'rev-parse', 'main'), moved)
  assert.deepEqual(await Promise.all(world.ports.map(boardState)), was, 'nothing restarted')
  assert.equal(existsSync(join(world.data, 'landings')), false, 'no gate ran')
  assertCleanedUp(world)
  const [line] = world.landings()
  assert.deepEqual([line.result, line.after, line.why, line.by, line.branch, line.gateLog], ['refused', null, 'merge main into feat first', 'unknown', 'feat', null])
})

test('a failing gate is refused: its log is named, and the temporary worktree and its junction are gone', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  await world.boards()
  const was = await Promise.all(world.ports.map(boardState))
  world.config({ gateBoard: world.gate('board-fail') })
  const ran = await world.land('feat')
  assert.equal(ran.status, 1)
  const [line] = world.landings()
  assert.match(lines(ran.out).at(-1), new RegExp(`^refused: the gate failed on ${line.head.slice(0, 7)}: the summary says fail 2 \\(see .*landings.*\\.log\\)$`))
  assert.equal(existsSync(line.gateLog), true, 'the log is there')
  const log = readFileSync(line.gateLog, 'utf8')
  assert.match(log, /node_modules marker: present/, 'the gate saw the junction')
  assert.match(log, /\u2139 fail 2/)
  assert.equal(line.result, 'refused')
  assert.equal(line.after, null)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  assert.equal(git(world.remote, 'rev-parse', 'main'), world.before)
  assert.deepEqual(await Promise.all(world.ports.map(boardState)), was)
  assertCleanedUp(world)
})

test('a gate with no summary line is refused, even when the command ended with 0', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  world.config({ gateBoard: world.gate('no-summary') })
  const ran = await world.land('feat')
  assert.equal(ran.status, 1)
  assert.match(lines(ran.out).at(-1), /^refused: the gate failed on [0-9a-f]{7}: no summary line in the output/)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  assertCleanedUp(world)
})

test('the mod gate runs only when the branch touches mods/workers/, and a failing one is refused', LONG, async t => {
  const world = await makeWorld(t)
  await world.boards()
  const head = world.branch('mod-change', { 'mods/workers/note.txt': 'the mod changed\n' })
  const landed = await world.land('mod-change', '-By', 'chat 3')
  assert.equal(landed.status, 0, landed.out)
  const log = readFileSync(world.landings()[0].gateLog, 'utf8')
  assert.match(log, /===== mod gate: node .*gate\.mjs"? mod-pass =====/)
  assert.match(log, /^ 0 fail$/m)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), head)
  // A second branch whose mod gate fails.
  world.branch('mod-break', { 'mods/workers/note.txt': 'broken\n' })
  world.config({ gateMod: world.gate('mod-fail') })
  const refused = await world.land('mod-break')
  assert.equal(refused.status, 1)
  assert.match(lines(refused.out).at(-1), /^refused: the mod gate failed on [0-9a-f]{7}: the summary says fail 3 \(see /)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), head, 'main stays where the first landing left it')
  assertCleanedUp(world)
})

test('a lock another landing holds for 5 minutes refuses this one; its lock stays', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  await world.boards()
  const since = new Date(Date.now() - 5 * MIN).toISOString()
  writeFileSync(join(world.data, 'landing.lock'), JSON.stringify({ by: 'chat 1', branch: 'mod-x', at: since, pid: 1 }))
  const ran = await world.land('feat', '-By', 'chat 3')
  assert.equal(ran.status, 1)
  assert.equal(lines(ran.out).at(-1), `refused: a landing by chat 1 of mod-x holds the lock since ${hhmm(since)}`)
  assert.equal(JSON.parse(readFileSync(join(world.data, 'landing.lock'), 'utf8')).by, 'chat 1', 'the other landing\'s lock is not removed')
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  assert.equal(world.worktrees(), 1)
  assert.deepEqual(readdirSync(world.tmp), [])
})

test('a lock older than 15 minutes is broken with a line, and the landing goes on', LONG, async t => {
  const world = await makeWorld(t)
  const head = world.branch('feat')
  await world.boards()
  const since = new Date(Date.now() - 16 * MIN).toISOString()
  writeFileSync(join(world.data, 'landing.lock'), JSON.stringify({ by: 'chat 1', branch: 'mod-x', at: since, pid: 1 }))
  const ran = await world.land('feat', '-By', 'chat 3')
  assert.equal(ran.status, 0, ran.out)
  assert.ok(lines(ran.out).includes(`broke a stale landing lock of chat 1 (mod-x, since ${hhmm(since)})`), ran.out)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), head)
  assertCleanedUp(world)
})

test('a board that comes back with the OLD commit is rolled back with ONE revert commit: no reset, no force, the remote keeps its history', LONG, async t => {
  const world = await makeWorld(t)
  const head = world.branch('feat')
  await world.boards({ args: ['--stale-once'] })
  world.config({ comeBackSeconds: 3 })
  const ran = await world.land('feat', '-By', 'chat 3')
  assert.equal(ran.status, 2, ran.out)
  const out = lines(ran.out)
  assert.equal(out.at(-1), `rolled back: ${world.ports[0]} did not come back with ${head.slice(0, 7)} within 3 s`)
  // Main has the revert on top of the landing, its tree is the old head's, and the remote has both (a push, never a force).
  const revert = git(world.main, 'rev-parse', 'HEAD')
  assert.notEqual(revert, head)
  assert.notEqual(revert, world.before, 'main was not reset')
  assert.equal(git(world.main, 'rev-parse', 'HEAD^'), head)
  assert.equal(git(world.main, 'rev-parse', 'HEAD^{tree}'), git(world.main, 'rev-parse', `${world.before}^{tree}`))
  assert.equal(git(world.main, 'log', '-1', '--format=%s'), `Revert the landing of feat (${world.before.slice(0, 7)}..${head.slice(0, 7)}): ${world.ports[0]} did not come back with ${head.slice(0, 7)} within 3 s`)
  assert.equal(git(world.remote, 'rev-parse', 'main'), revert)
  git(world.remote, 'merge-base', '--is-ancestor', head, 'main')
  assert.equal(existsSync(join(world.main, 'feature.txt')), false, 'the working tree is the old tree again')
  assert.equal(git(world.trial, 'rev-parse', 'HEAD'), revert)
  // Both boards were restarted on the revert and answer with it.
  for (const port of world.ports) assert.equal((await boardState(port)).commit, revert.slice(0, 7))
  const [line] = world.landings()
  assert.deepEqual([line.result, line.head, line.before, line.after, line.cold], ['rolled-back', head, world.before, head, false])
  assert.match(line.why, new RegExp(`^${world.ports[0]} did not come back with ${head.slice(0, 7)} within 3 s$`))
  assert.deepEqual(line.boards.map(one => one.commit), [revert.slice(0, 7), revert.slice(0, 7)])
  assertCleanedUp(world)
})

test('a debugger attached to a board is refused before anything changes (the list of connections is made up here)', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  await world.boards()
  const was = await Promise.all(world.ports.map(boardState))
  const trace = 'node C:\\Web\\lava-tactics-project\\art-inbox\\X93\\trace-b978.mjs'
  writeFileSync(world.processesFile, JSON.stringify([
    { pid: 7001, ppid: 1, name: 'node.exe', commandLine: `node ${join(world.main, 'server.mjs')}` },
    { pid: 7002, ppid: 1, name: 'node.exe', commandLine: trace },
  ]))
  const link = (pid, localPort, remotePort) => ({ state: 'Established', localAddress: '127.0.0.1', localPort, remoteAddress: '127.0.0.1', remotePort, pid })
  writeFileSync(world.connectionsFile, JSON.stringify([
    { state: 'Listen', localAddress: '127.0.0.1', localPort: world.ports[0], remoteAddress: '0.0.0.0', remotePort: 0, pid: 7001 },
    { state: 'Listen', localAddress: '127.0.0.1', localPort: 9229, remoteAddress: '0.0.0.0', remotePort: 0, pid: 7001 },
    link(7001, 9229, 61000), link(7002, 61000, 9229),
  ]))
  const ran = await world.land('feat', '-By', 'chat 3')
  assert.equal(ran.status, 1)
  assert.equal(lines(ran.out).at(-1), `refused: a debugger is attached to the ${world.ports[0]} board's child (pid 7001, inspector port 9229, client pid 7002 ${trace}): stop it first`)
  // Refused before the ff: main, the remote and the trial copy never moved, and no gate was run.
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  assert.equal(git(world.remote, 'rev-parse', 'main'), world.before)
  assert.equal(git(world.trial, 'rev-parse', 'HEAD'), world.before)
  assert.deepEqual(await Promise.all(world.ports.map(boardState)), was)
  assert.equal(existsSync(join(world.data, 'landings')), false)
  assertCleanedUp(world)
  assert.equal(world.landings()[0].result, 'refused')
})

test('a debugger that comes during the gate is caught under the lock, still before the fast-forward', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  await world.boards()
  const attached = join(world.root, 'attached.json')
  const link = (pid, localPort, remotePort) => ({ state: 'Established', localAddress: '127.0.0.1', localPort, remoteAddress: '127.0.0.1', remotePort, pid })
  writeFileSync(world.processesFile, JSON.stringify([{ pid: 7001, ppid: 1, name: 'node.exe', commandLine: `node ${join(world.trial, 'server.mjs')}` }]))
  writeFileSync(attached, JSON.stringify([
    { state: 'Listen', localAddress: '127.0.0.1', localPort: world.ports[1], remoteAddress: '0.0.0.0', remotePort: 0, pid: 7001 },
    { state: 'Listen', localAddress: '127.0.0.1', localPort: 9230, remoteAddress: '0.0.0.0', remotePort: 0, pid: 7001 },
    link(7001, 9230, 61001),
  ]))
  world.config({ gateBoard: `${world.gate('board-pass-then-copy')} "${attached}" "${world.connectionsFile}"` })
  const ran = await world.land('feat')
  assert.equal(ran.status, 1, ran.out)
  assert.match(lines(ran.out).at(-1), new RegExp(`^refused: a debugger is attached to the ${world.ports[1]} board's child \\(pid 7001, inspector port 9230, client pid unknown\\): stop it first$`))
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before, 'main did not move')
  assert.equal(git(world.remote, 'rev-parse', 'main'), world.before)
  assert.equal(existsSync(world.landings()[0].gateLog), true, 'the gate had run')
  assertCleanedUp(world)
})

test('a real debugger on a real board process: refused while a client is connected, a note and a landing when none is', LONG, async t => {
  const world = await makeWorld(t, { live: true })
  const inspector = await freePort()
  world.branch('feat')
  const child = await world.board(world.main, world.ports[0], { nodeArgs: [`--inspect=127.0.0.1:${inspector}`] })
  await world.board(world.trial, world.ports[1])
  // A plain request that closes its connection: a kept-alive one would look like a client of the inspector.
  const listed = await new Promise((done, fail) => {
    get(`http://127.0.0.1:${inspector}/json/list`, { agent: false, headers: { connection: 'close' } }, reply => {
      let body = ''
      reply.on('data', chunk => { body += chunk })
      reply.on('end', () => done(JSON.parse(body)))
    }).on('error', fail)
  })
  const client = new WebSocket(listed[0].webSocketDebuggerUrl)
  await new Promise((done, fail) => {
    client.onopen = done
    client.onerror = () => fail(new Error('the debugger client did not connect'))
  })
  const refused = await world.land('feat', '-By', 'chat 3')
  assert.equal(refused.status, 1, refused.out)
  const said = lines(refused.out).at(-1)
  assert.ok(said.startsWith(`refused: a debugger is attached to the ${world.ports[0]} board's child (pid ${child.pid}, inspector port ${inspector}, client pid ${process.pid} `), said)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  client.close()
  await sleep(1500)
  const head = git(world.main, 'rev-parse', 'refs/heads/feat')
  const landed = await world.land('feat', '-By', 'chat 3')
  assert.equal(landed.status, 0, landed.out)
  assert.ok(lines(landed.out).some(line => line === `note: an inspector listens on ${inspector} at the ${world.ports[0]} board's child (pid ${child.pid}); no client is attached, going on`), landed.out)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), head)
  assert.equal((await boardState(world.ports[0])).commit, head.slice(0, 7))
})

test('a board that does not answer is started with node start-board.mjs in its folder, then checked like the others', LONG, async t => {
  const world = await makeWorld(t)
  const head = world.branch('feat')
  await world.board(world.main, world.ports[0])
  assert.equal(await boardState(world.ports[1]), null)
  const ran = await world.land('feat')
  assert.equal(ran.status, 0, ran.out)
  assert.ok(lines(ran.out).includes(`note: the board on ${world.ports[1]} does not answer: starting it with node start-board.mjs`), ran.out)
  assert.equal((await boardState(world.ports[1])).commit, head.slice(0, 7))
  assertCleanedUp(world)
})

test('-Cold starts new keepers first and stops the old processes of each board (found by its folder and port), and the boards come back', LONG, async t => {
  const world = await makeWorld(t, { live: true })
  const head = world.branch('feat')
  const olds = [await world.board(world.main, world.ports[0]), await world.board(world.trial, world.ports[1])]
  const ran = await world.land('feat', '-Cold', '-By', 'chat 3')
  assert.equal(ran.status, 0, ran.out)
  for (const port of world.ports) assert.equal((await boardState(port)).commit, head.slice(0, 7))
  for (const old of olds) assert.notEqual(old.exitCode ?? old.signalCode, null, 'the old process was stopped')
  const [line] = world.landings()
  assert.deepEqual([line.result, line.cold], ['landed', true])
  assertCleanedUp(world)
})

test('a dirty main checkout is refused (an untracked .claude/ does not count); a push that fails puts main back', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  mkdirSync(join(world.main, '.claude'))
  writeFileSync(join(world.main, '.claude', 'note.txt'), 'a chat\'s own folder\n')
  writeFileSync(join(world.main, 'junk.txt'), 'left over\n')
  const dirty = await world.land('feat')
  assert.equal(dirty.status, 1)
  assert.equal(lines(dirty.out).at(-1), 'refused: the main checkout is not clean: ?? junk.txt')
  await rm(join(world.main, 'junk.txt'))
  // The remote cannot be reached: the push fails, main goes back to where it was, nothing else moved.
  git(world.main, 'remote', 'set-url', 'origin', join(world.root, 'nowhere.git'))
  const ran = await world.land('feat')
  assert.equal(ran.status, 1, ran.out)
  assert.match(lines(ran.out).at(-1), new RegExp(`^refused: the push to origin failed \\(.*\\); main is back at ${world.before.slice(0, 7)}$`))
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  assert.equal(existsSync(join(world.main, 'feature.txt')), false, 'the working tree went back too')
  assert.equal(git(world.trial, 'rev-parse', 'HEAD'), world.before)
  const written = world.landings()
  assert.deepEqual(written.map(line => [line.result, line.after]), [['refused', null], ['refused', null]])
  assert.equal(world.worktrees(), 1)
})

test('nothing to land, a main checkout on another branch and a trial copy that cannot fast-forward are each refused before the gate', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  git(world.main, 'branch', 'same')
  const nothing = await world.land('same')
  assert.equal(nothing.status, 1)
  assert.equal(lines(nothing.out).at(-1), `refused: nothing to land: same is at main's head (${world.before.slice(0, 7)}) already`)
  git(world.main, 'switch', '-q', 'feat')
  const elsewhere = await world.land('feat')
  assert.equal(lines(elsewhere.out).at(-1), "refused: the main checkout is on 'feat', not main")
  git(world.main, 'switch', '-q', 'main')
  // The trial copy has a file of its own, then a commit main does not have.
  writeFileSync(join(world.trial, 'junk.txt'), 'left over\n')
  const dirty = await world.land('feat')
  assert.equal(lines(dirty.out).at(-1), `refused: the trial copy ${world.trial} is not clean: ?? junk.txt`)
  await rm(join(world.trial, 'junk.txt'))
  git(world.trial, 'commit', '-q', '--allow-empty', '-m', 'only here')
  const diverged = await world.land('feat')
  assert.equal(diverged.status, 1)
  assert.match(lines(diverged.out).at(-1), new RegExp(`^refused: the trial copy .* is at [0-9a-f]{7}, which main with this branch does not contain: it cannot fast-forward$`))
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  assert.equal(git(world.remote, 'rev-parse', 'main'), world.before)
  assert.equal(existsSync(join(world.data, 'landings')), false, 'no gate ran for any of them')
  assert.deepEqual(world.landings().map(line => line.result), ['refused', 'refused', 'refused', 'refused'])
  assert.deepEqual(readdirSync(world.tmp), [])
})

// The script's own text.

const text = () => readFileSync(SCRIPT, 'utf8')

/** The lines of the script that push; the git calls are arrays like @('push', $remote, 'main'). */
const pushLines = source => source.split('\n').filter(line => /'push'/.test(line))
const forcesAPush = source => pushLines(source).some(line => /--force|--mirror|'-f'|\+main|--delete|:main/.test(line))

test('no push in the script is forced, and no command in it takes work back by force', () => {
  const source = text()
  assert.ok(pushLines(source).length >= 2, 'the landing\'s push and the revert\'s push are both there')
  assert.equal(forcesAPush(source), false)
  assert.ok(!/--force/.test(source), 'no --force anywhere (a git worktree remove without it)')
  assert.ok(!/\s-f(\s|$)/.test(source), 'no -f anywhere')
  for (const forbidden of ['reset --hard', 'checkout --', "'checkout'", "'restore'", "'stash'", "'clean'"]) assert.ok(!source.includes(forbidden), forbidden)
  // The check catches the mutant: a push with --force, or with a plus in front of the branch.
  assert.equal(forcesAPush(source.replace("@('push', $remote, 'main')", "@('push', '--force', $remote, 'main')")), true)
  assert.equal(forcesAPush(source.replace("@('push', $remote, 'main')", "@('push', $remote, '+main')")), true)
  assert.equal(forcesAPush(source.replace("@('push', $remote, 'main')", "@('push', '-f', $remote, 'main')")), true)
})

test('the debugger check comes before the fast-forward in the order of the run, the lock after the gate', () => {
  const run = text().slice(text().indexOf('function Invoke-Run'))
  const at = word => run.indexOf(word)
  assert.ok(at('Test-Ready $false') < at('Test-Debugger') && at('Test-Debugger') < at('Invoke-Gate'), 'the early debugger check, then the gate')
  assert.ok(at('Invoke-Gate') < at("'lock-take'"), 'the gate runs before the lock')
  assert.ok(at("'lock-take'") < at('Test-Ready $true'), 'the second look is under the lock')
  assert.ok(run.lastIndexOf('Test-Debugger') < at("'merge', '--ff-only', $script:headFull"), 'the second debugger check is before the fast-forward')
  assert.ok(at("'merge', '--ff-only', $script:headFull") < at("'push', $remote, 'main'"))
})

test('the script is plain ASCII and has no syntax error in Windows PowerShell', { skip }, () => {
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text()), 'a character above ASCII')
  const ran = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:LAND_SCRIPT, [ref]$null, [ref]$errors); $errors.Count'],
  { encoding: 'utf8', env: { ...process.env, LAND_SCRIPT: SCRIPT }, windowsHide: true })
  assert.equal(ran.stdout.trim(), '0', ran.stdout + ran.stderr)
})
