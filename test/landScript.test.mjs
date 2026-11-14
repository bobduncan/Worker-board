// The go-live script, tools/land.ps1 (2026-11-04), run for real in Windows PowerShell against made-up things only: a temporary
// bare remote, a temporary "main checkout" with a made-up board in it (fixtures/land/server.mjs, a small http server that
// answers what the script asks of a board), a temporary "trial" clone with the remote `local`, and made-up gates (fixtures/land/
// gate.mjs). Never against the real boards on 4310 and 4314: the ports are free ones, the folders are temporary, and the
// script's own settings (-Config) say so. Each landing takes some ten seconds (PowerShell, a worktree, the PC's process list).
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
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
      gateBoard: world.gate('board-pass'), gateMod: world.gate('mod-pass'), gateFile: `${world.gate('board-fail')} {file}`, tempRoot: world.tmp, nodeModules: join(world.main, 'node_modules'), nodeModulesMarker: 'marker.txt',
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
  /** Both made-up boards; the first (the main checkout's) gets `first`'s options, the second (the trial copy's) `second`'s. */
  world.boards = async (first = {}, second = {}) => {
    await world.board(world.main, world.ports[0], first)
    await world.board(world.trial, world.ports[1], second)
  }
  /** The made-up remote takes no push whose commit says "Revert the landing": a hook of the bare repository. */
  world.rejectReverts = () => writeFileSync(join(world.remote, 'hooks', 'pre-receive'), [
    '#!/bin/sh', 'while read old new ref; do',
    '  if git log -1 --format=%s "$new" | grep -q "^Revert the landing"; then echo "the made-up remote takes no reverts" >&2; exit 1; fi',
    'done', '',
  ].join('\n'))
  /** The made-up remote answers a push only after `seconds`, when the ref is already updated (a push that times out on the client). */
  world.slowRemote = seconds => writeFileSync(join(world.remote, 'hooks', 'post-receive'), ['#!/bin/sh', `sleep ${seconds}`, ''].join('\n'))
  /** What the script is run with besides the PC's own environment. */
  world.env = {}
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
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args, '-Config', world.configFile], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...world.env } })
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
  assert.ok(out.includes(`boards: the main board on ${world.ports[0]} (${world.main}), the trial board on ${world.ports[1]} (${world.trial})`), 'the boards chosen are said on every run')
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
  assert.deepEqual(Object.keys(line), ['at', 'by', 'branch', 'head', 'before', 'after', 'trial', 'result', 'why', 'boards', 'cold', 'gateLog', 'branches'])
  assert.deepEqual([line.by, line.branch, line.head, line.before, line.after, line.trial, line.result, line.why, line.cold], ['chat 3', 'feat', head, world.before, head, head, 'landed', null, false])
  assert.deepEqual(line.boards.map(one => [one.port, one.commit]), world.ports.map(port => [port, head.slice(0, 7)]))
  assert.ok(line.boards.every(one => Number.isFinite(one.since)))
  assert.match(line.gateLog, /landings[\\/]\d{8}-\d{6}-feat\.log$/)
  // 2026-11-09: the landed branch is cleaned up: the local one is gone (it was never on the remote); the line and a say line hold it.
  assert.equal(git(world.main, 'branch', '--list', 'feat'), '', 'the local branch is removed')
  assert.deepEqual(line.branches, { swept: [], kept: [], landed: { remote: 'kept: not on the remote', local: 'removed' } })
  assert.ok(out.includes('branch feat: kept on origin: not on the remote; removed locally'), ran.out)
})

// 2026-11-09, the person: "i want workers to be able to clean up after them selves" (Worker 5 had to ask for the delete of its remote
// branch: a chat may not `git push --delete`). Mutants: the delete after the landing skipped (feat stays on the remote); the sweep
// skipped (old-merged stays); the merge check of the sweep forced true (old-ahead is deleted).
test('a landed branch goes from the remote; one checked out in a worktree is kept locally; the sweep deletes landed leftovers that are fully merged, keeps the rest and never main', LONG, async t => {
  const world = await makeWorld(t, { live: true })
  const head = world.branch('feat')
  git(world.main, 'push', '-q', 'origin', 'feat')
  // The worker's own worktree still has feat checked out: the local branch stays, with the why.
  git(world.main, 'worktree', 'add', '-q', join(world.root, 'wt-feat'), 'feat')
  // Leftovers on the remote, each listed as landed before: old-merged is at main's head (fully merged), old-ahead has a commit of
  // its own; not-landed is fully merged but no landing lists it; main is listed (a made-up line) and never touched.
  git(world.main, 'push', '-q', 'origin', 'main:refs/heads/old-merged')
  const ahead = world.branch('old-ahead')
  git(world.main, 'push', '-q', 'origin', 'old-ahead')
  git(world.main, 'branch', '-D', 'old-ahead')
  git(world.main, 'push', '-q', 'origin', 'main:refs/heads/not-landed')
  mkdirSync(world.data, { recursive: true })
  const landedLine = branch => JSON.stringify({ at: '2026-11-08T20:00:00.000Z', by: 'Worker 5', branch, head: world.before, before: world.before, after: world.before, trial: world.before, result: 'landed', why: null, boards: [], cold: false, gateLog: null })
  writeFileSync(join(world.data, 'landings.jsonl'), [landedLine('old-merged'), landedLine('old-ahead'), landedLine('main'), JSON.stringify({ ...JSON.parse(landedLine('refused-one')), result: 'refused' })].join('\n') + '\n')
  await world.boards()
  const ran = await world.land('feat', '-By', 'chat 3')
  assert.equal(ran.status, 0, ran.out)
  const out = lines(ran.out)
  const remoteBranches = git(world.remote, 'branch', '--list', '--format=%(refname:short)').split('\n').map(one => one.trim()).filter(Boolean).sort()
  assert.deepEqual(remoteBranches, ['main', 'not-landed', 'old-ahead'], 'feat and old-merged are gone; the unmerged, the unlisted and main stay')
  assert.equal(git(world.remote, 'rev-parse', 'old-ahead'), ahead, 'the unmerged branch is untouched')
  assert.equal(git(world.main, 'rev-parse', 'feat'), head, 'the local branch checked out in a worktree stays')
  assert.ok(out.includes('note: swept the landed branch old-merged from origin: every commit of it is on main'), ran.out)
  assert.ok(out.includes('note: the landed branch old-ahead is kept on origin: not fully merged into main'), ran.out)
  assert.ok(out.some(line => line.startsWith(`branch feat: removed from origin; kept locally: checked out in ${join(world.root, 'wt-feat').replace(/\\/g, '/')}`)), ran.out)
  const line = world.landings().at(-1)
  assert.deepEqual([line.result, line.branches.swept, line.branches.kept, line.branches.landed.remote], ['landed', ['old-merged'], ['old-ahead (not fully merged into main)'], 'removed'])
  assert.match(line.branches.landed.local, /^kept: checked out in /)
  // The worktree of the test is the worker's, not a gate's: everything else of the run is cleaned up.
  assert.deepEqual(readdirSync(world.tmp), [])
  assert.equal(world.worktrees(), 2)
  assert.equal(existsSync(join(world.data, 'landing.lock')), false)
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

test('F14: the gate\'s clock starts once its run holds the one-at-a-time slot: a gate queued for 2.5 s passes under a 1.2 s clock; the run goes first-class', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  world.config({ gateBoard: world.gate('board-queued-then-pass'), gateMinutes: 0.02, pollMs: 200 })
  const ran = await world.land('feat')
  assert.equal(ran.status, 0, ran.out)
  assert.match(lines(ran.out).at(-1), /^landed: feat by /)
  const [line] = world.landings()
  const log = readFileSync(line.gateLog, 'utf8')
  assert.match(log, /waiting for test in C:\/elsewhere/)
  assert.match(log, /one-at-a-time: test runs now \(waited 2 s\) first=1/, 'the gate command runs first-class in the queue')
  assert.doesNotMatch(log, /was stopped/)
})

test('F14: a gate that hangs after it got its slot is stopped at the clock with its whole tree, and the refusal names the timeout', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  const pidFile = join(world.root, 'child.pid')
  world.config({ gateBoard: `${world.gate('board-hang-after-start')} "${pidFile}"`, gateMinutes: 0.02, pollMs: 200 })
  const ran = await world.land('feat')
  assert.equal(ran.status, 1)
  const [line] = world.landings()
  assert.match(lines(ran.out).at(-1), new RegExp(`^refused: the gate failed on ${line.head.slice(0, 7)}: the gate ran longer than 1 seconds after it got its slot and was stopped \\(see .*landings.*\\.log\\)$`))
  const log = readFileSync(line.gateLog, 'utf8')
  assert.match(log, /\nthe gate ran longer than 1 seconds after it got its slot and was stopped/)
  // The grandchild the gate started is gone too (the tree, not the root alone).
  const child = Number(readFileSync(pidFile, 'utf8'))
  await sleep(500)
  assert.throws(() => process.kill(child, 0), 'the gate\'s child process was killed with the tree')
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
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
  const trace = 'node D:\\tools\\trace.mjs'
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
  assert.ok(lines(ran.out).includes(`note: the board on ${world.ports[1]} still does not answer: starting it with node start-board.mjs`), ran.out)
  assert.equal((await boardState(world.ports[1])).commit, head.slice(0, 7))
  assertCleanedUp(world)
})

test('a board that drops right after the fast-forward (its own self-update) is waited for and comes back by itself: landed, no start-board, no restart asked', LONG, async t => {
  const world = await makeWorld(t)
  const head = world.branch('feat')
  await world.boards({ args: ['--drop-after-move', '6'] })
  const ran = await world.land('feat')
  assert.equal(ran.status, 0, ran.out)
  const out = lines(ran.out)
  assert.ok(out.includes(`note: the board on ${world.ports[0]} does not answer: waiting up to 20 s for it to come back by itself`), ran.out)
  assert.ok(out.includes(`note: the board on ${world.ports[0]} runs ${head.slice(0, 7)} already (it restarted itself)`), ran.out)
  assert.ok(!out.some(line => line.includes('start-board.mjs')), ran.out)
  assert.equal(existsSync(join(world.main, 'data', 'restarts.log')), false, 'the main board was not asked to restart: it came back by itself')
  assert.equal(world.landings()[0].result, 'landed')
  assertCleanedUp(world)
})

test('node_modules without its marker (happy-dom on the PC) at the start is refused before the sweep, the gate and any change', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  await world.boards()
  const was = await Promise.all(world.ports.map(boardState))
  rmSync(join(world.main, 'node_modules', 'marker.txt'))
  const ran = await world.land('feat')
  assert.equal(ran.status, 1, ran.out)
  const [line] = world.landings()
  assert.equal(lines(ran.out).at(-1), `refused: ${join(world.main, 'node_modules')} has no marker.txt at the start of the landing (it was emptied): run npm ci in ${world.main}, then land again`)
  assert.equal(line.result, 'refused')
  assert.equal(line.gateLog, null, 'no gate ran')
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  assert.deepEqual(await Promise.all(world.ports.map(boardState)), was)
  assert.deepEqual(readdirSync(world.tmp), [])
})

test('a gate that empties node_modules through the junction is caught at the teardown: refused before main moves, the worktree left for a look, swept by the next run', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  await world.boards()
  const was = await Promise.all(world.ports.map(boardState))
  world.config({ gateBoard: world.gate('board-pass-then-empty') })
  const ran = await world.land('feat')
  assert.equal(ran.status, 1, ran.out)
  const [line] = world.landings()
  assert.match(line.why, new RegExp(`^.*node_modules has no marker\\.txt after the gate \\(it was emptied\\): run npm ci in .*, then land again \\(the gate worktree .*land-gate-.* was left for a look\\)$`))
  assert.equal(lines(ran.out).at(-1), `refused: ${line.why}`)
  assert.match(readFileSync(line.gateLog, 'utf8'), /\nteardown: .*has no marker\.txt after the gate/)
  assert.equal(line.result, 'refused')
  assert.equal(line.after, null)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  assert.deepEqual(await Promise.all(world.ports.map(boardState)), was)
  assert.equal(world.worktrees(), 2, 'the gate worktree was left')
  const [left] = readdirSync(world.tmp).filter(name => name.startsWith('land-gate-') && !name.endsWith('.owner'))
  assert.equal(existsSync(join(world.tmp, left, 'node_modules')), false, 'its junction is gone')
  // node_modules made whole again (npm ci on the PC), the next run sweeps the leftover and lands.
  writeFileSync(join(world.main, 'node_modules', 'marker.txt'), 'whole again')
  world.config()
  const again = await world.land('feat')
  assert.equal(again.status, 0, again.out)
  assert.ok(lines(again.out).some(text => text.startsWith('note: removed the gate worktree ') && text.includes(left)), again.out)
  assert.equal(world.landings().at(-1).result, 'landed')
  assertCleanedUp(world)
})

test('a junction the teardown cannot remove is refused: git worktree remove never runs over a folder that may still be the junction, the target is whole', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  await world.boards()
  world.config({ gateBoard: world.gate('board-pass-then-block') })
  const ran = await world.land('feat')
  assert.equal(ran.status, 1, ran.out)
  const [line] = world.landings()
  assert.match(line.why, /^the gate's junction .*land-gate-.*node_modules could not be removed \(.*\); the gate worktree was left: remove the junction with cmd \/c rmdir \(never a recursive delete\), then the worktree, and land again$/)
  assert.equal(line.result, 'refused')
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  assert.equal(world.worktrees(), 2, 'the gate worktree was left, not removed through the folder')
  const [left] = readdirSync(world.tmp).filter(name => name.startsWith('land-gate-') && !name.endsWith('.owner'))
  assert.equal(existsSync(join(world.tmp, left, 'node_modules', 'held.txt')), true, 'the folder in the junction\'s place stands')
  assert.equal(existsSync(join(world.main, 'node_modules', 'marker.txt')), true, 'the target is whole')
  assert.equal(existsSync(join(world.data, 'landing.lock')), false)
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

test('without settings the boards are found, not named: git\'s first working tree, the ports of the PC\'s list, a trial copy is a clone of the main checkout; a list nobody can read or without a trial copy is a refusal', LONG, async t => {
  const world = await makeWorld(t)
  // The script runs from a folder of the made-up repository, as it does from the real one (its worktrees too).
  mkdirSync(join(world.main, 'tools'))
  await cp(SCRIPT, join(world.main, 'tools', 'land.ps1'))
  await cp(join(ROOT, 'tools', 'landing.mjs'), join(world.main, 'tools', 'landing.mjs'))
  mkdirSync(join(world.main, 'src'))
  await cp(join(ROOT, 'src', 'landing.mjs'), join(world.main, 'src', 'landing.mjs'))
  const copy = join(world.root, 'elsewhere')
  git(world.root, 'clone', '-q', world.remote, copy)
  const home = join(world.root, 'pc')
  mkdirSync(home)
  const entry = (folder, port) => ({ project: dirname(folder), folder, port, gamePort: 5300, asked: { port: 4310, gamePort: 5300 } })
  writeFileSync(join(home, 'boards.json'), JSON.stringify({ boards: [entry(world.trial, 4412), entry(world.main, 4411), entry(copy, 4413), entry(join(world.root, 'gone'), 4414)] }))
  const configFile = join(world.root, 'print.json')
  writeFileSync(configFile, JSON.stringify({ printBoards: true }))
  const boards = (home, ...flags) => new Promise(done => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(world.main, 'tools', 'land.ps1'), 'unused', ...flags, '-Config', configFile],
      { cwd: world.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WORKER_BOARD_HOME: home } })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { out += chunk })
    child.on('exit', status => done({ status, out: out.replace(/\r/g, '').trim() }))
  })
  const said = answer => JSON.parse(answer.out.replace(/^boards: /, ''))
  const listed = await boards(home)
  assert.equal(listed.status, 0, listed.out)
  // The main checkout first with its port from the list, then the clone of it (the copy that has no `local` remote is another's).
  assert.deepEqual(said(listed), [{ dir: world.main, port: 4411 }, { dir: world.trial, port: 4412 }])
  // A PC's list that names no trial copy is a refusal: a landing must not skip the trial copy quietly. -NoTrial says it is meant.
  const empty = join(world.root, 'nolist')
  mkdirSync(empty)
  const none = await boards(empty)
  assert.equal(none.status, 1)
  assert.match(lines(none.out).at(-1), /^refused: no trial copy of the main checkout was found in the PC's list of boards \(.*boards\.json\).*pass -NoTrial/)
  // No list and -NoTrial: the main board alone, on its config.json's port, else on 4310.
  assert.deepEqual(said(await boards(empty, '-NoTrial')), [{ dir: world.main, port: 4310 }])
  writeFileSync(join(world.main, 'config.json'), JSON.stringify({ port: 4455 }))
  assert.deepEqual(said(await boards(empty, '-NoTrial')), [{ dir: world.main, port: 4455 }])
  // A list that exists and cannot be read is a refusal too, and its line is written (the settings are read inside the run's try).
  const broken = join(world.root, 'brokenlist')
  mkdirSync(broken)
  writeFileSync(join(broken, 'boards.json'), '{ "boards": [ torn')
  const unreadable = await boards(broken, '-NoTrial')
  assert.equal(unreadable.status, 1)
  assert.match(lines(unreadable.out).at(-1), /^refused: the PC's list of boards .*boards\.json cannot be read \(.+\): fix it, or say the boards with -Config$/)
  const written = world.landings()
  assert.equal(written.at(-1).result, 'refused')
  assert.match(written.at(-1).why, /cannot be read/)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before, 'nothing was touched')
})

test('a rollback whose revert cannot be pushed restarts both boards on the local revert first: exit 3, the boards up, the line says exactly that', LONG, async t => {
  const world = await makeWorld(t)
  const head = world.branch('feat')
  world.rejectReverts()
  await world.boards({ args: ['--stale-once'] })
  world.config({ comeBackSeconds: 3 })
  const ran = await world.land('feat', '-By', 'chat 3')
  assert.equal(ran.status, 3, ran.out)
  const out = lines(ran.out)
  const revert = git(world.main, 'rev-parse', 'HEAD')
  assert.equal(git(world.main, 'rev-parse', 'HEAD^'), head, 'main has the revert on the landing, here')
  assert.equal(git(world.remote, 'rev-parse', 'main'), head, 'the remote still has the landing: it took no revert')
  assert.equal(git(world.trial, 'rev-parse', 'HEAD'), revert)
  // Both boards answer with the revert commit: they were restarted before the push was tried.
  for (const port of world.ports) assert.equal((await boardState(port)).commit, revert.slice(0, 7))
  const failed = out.find(line => line.startsWith('ROLLBACK FAILED:'))
  assert.ok(failed, ran.out)
  assert.ok(failed.includes(`the revert ${revert.slice(0, 7)} is on main here and the boards run it, but the push to origin failed`), failed)
  assert.ok(failed.includes(`origin/main still has ${head.slice(0, 7)}, the landing; push the revert by hand`), failed)
  assert.ok(out.some(line => line === `state: the board on ${world.ports[0]} runs ${revert.slice(0, 7)}`), ran.out)
  const [line] = world.landings()
  assert.deepEqual([line.result, line.after], ['rollback-failed', head])
  assert.deepEqual(line.boards.map(one => one.commit), [revert.slice(0, 7), revert.slice(0, 7)])
  assertCleanedUp(world)
})

test('the trial board restarts first as a canary: when it does not come back the live board is not touched before the rollback', LONG, async t => {
  const world = await makeWorld(t)
  const head = world.branch('feat')
  await world.boards({}, { args: ['--stale-once'] })
  world.config({ comeBackSeconds: 3 })
  const ran = await world.land('feat')
  assert.equal(ran.status, 2, ran.out)
  const out = lines(ran.out)
  assert.equal(out.at(-1), `rolled back: ${world.ports[1]} did not come back with ${head.slice(0, 7)} within 3 s`)
  assert.ok(out.includes(`note: restarting the trial board on ${world.ports[1]} first, as the canary`), ran.out)
  const restarts = dir => readFileSync(join(dir, 'data', 'restarts.log'), 'utf8').trim().split('\n').length
  assert.equal(restarts(world.trial), 2, 'the trial board: the landing\'s restart, then the rollback\'s')
  assert.equal(restarts(world.main), 1, 'the live board was restarted once only: by the rollback, never by the landing')
  const revert = git(world.main, 'rev-parse', 'HEAD')
  for (const port of world.ports) assert.equal((await boardState(port)).commit, revert.slice(0, 7))
  assertCleanedUp(world)
})

test('a board that was started without its keeper is refused before anything changes in warm mode: it needs -Cold', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  await world.boards({ args: ['--no-keeper'] })
  const ran = await world.land('feat')
  assert.equal(ran.status, 1)
  assert.equal(lines(ran.out).at(-1), `refused: the board on ${world.ports[0]} was started without its keeper and cannot restart itself: it needs -Cold`)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  assert.equal(git(world.remote, 'rev-parse', 'main'), world.before)
  assert.equal(existsSync(join(world.data, 'landings')), false, 'no gate ran')
  assertCleanedUp(world)
})

test('a push that times out but landed is found out with git ls-remote and the landing goes on', LONG, async t => {
  const world = await makeWorld(t)
  const head = world.branch('feat')
  await world.boards()
  world.slowRemote(8)
  world.config({ pushTimeoutSeconds: 3 })
  const ran = await world.land('feat')
  assert.equal(ran.status, 0, ran.out)
  assert.ok(lines(ran.out).some(line => /^note: the push to origin said it failed \(timed out after 3 s\), but origin\/main has [0-9a-f]{7}: going on$/.test(line)), ran.out)
  assert.equal(git(world.remote, 'rev-parse', 'main'), head)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), head)
  for (const port of world.ports) assert.equal((await boardState(port)).commit, head.slice(0, 7))
  assert.equal(world.landings()[0].result, 'landed')
})

test('an unexpected error after main moved is never silent: before the push main goes back, after it the rollback runs, and a rollback that stops too is logged with the state', LONG, async t => {
  const world = await makeWorld(t)
  const head = world.branch('feat')
  await world.boards()
  // A fault right after the fast-forward, before the push: main is put back.
  world.config({ failAfter: 'ff' })
  const early = await world.land('feat')
  assert.equal(early.status, 1, early.out)
  assert.equal(lines(early.out).at(-1), `refused: an unexpected error after main moved (a fault made on purpose after the fast-forward); main is back at ${world.before.slice(0, 7)}`)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
  assert.equal(git(world.remote, 'rev-parse', 'main'), world.before)
  // A fault right after the push: the rollback runs, the boards come back on the revert.
  world.config({ failAfter: 'push' })
  const late = await world.land('feat')
  assert.equal(late.status, 2, late.out)
  assert.equal(lines(late.out).at(-1), 'rolled back: an unexpected error after the push: a fault made on purpose after the push')
  const revert = git(world.main, 'rev-parse', 'HEAD')
  assert.equal(git(world.main, 'rev-parse', 'HEAD^'), head)
  assert.equal(git(world.remote, 'rev-parse', 'main'), revert)
  for (const port of world.ports) assert.equal((await boardState(port)).commit, revert.slice(0, 7))
  // A fault after the push and another in the rollback: nobody is left guessing: rollback-failed, with the state.
  world.branch('feat2')
  world.config({ failAfter: 'push,rollback' })
  const cut = await world.land('feat2')
  assert.equal(cut.status, 3, cut.out)
  const cutOut = lines(cut.out)
  assert.ok(cutOut.some(line => /^ROLLBACK FAILED: the run ended after main moved, before it finished: an unexpected error after the push \(a fault made on purpose after the push\), and the rollback stopped: a fault made on purpose at the rollback$/.test(line)), cut.out)
  assert.ok(cutOut.some(line => line.startsWith('state: main (local) is at ')), cut.out)
  const results = world.landings().map(line => line.result)
  assert.deepEqual(results, ['refused', 'rolled-back', 'rollback-failed'])
  assertCleanedUp(world)
})

test('the gate runs without colour (NO_COLOR, no FORCE_COLOR) and a refusal names the failing test files', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  world.env.FORCE_COLOR = '1'
  // A lock held by another landing ends the run right after the gate: the log is all this needs.
  writeFileSync(join(world.data, 'landing.lock'), JSON.stringify({ by: 'chat 1', branch: 'x', at: new Date().toISOString(), pid: 1 }))
  world.config({ gateBoard: world.gate('print-env') })
  const first = await world.land('feat')
  assert.equal(first.status, 1, first.out)
  assert.match(readFileSync(world.landings()[0].gateLog, 'utf8'), /env NO_COLOR=1 FORCE_COLOR=unset/)
  world.config({ gateBoard: world.gate('board-fail-files'), gateFile: `${world.gate('board-fail')} {file}` })
  const failed = await world.land('feat')
  assert.equal(failed.status, 1)
  assert.match(lines(failed.out).at(-1), /^refused: the gate failed on [0-9a-f]{7}: the summary says fail 2; failing test files: test\/alpha\.test\.mjs, test\/beta\.test\.mjs; rerun alone: test\/alpha\.test\.mjs failed again \(the summary says fail 2\) \(see /)
  const log = readFileSync(world.landings().at(-1).gateLog, 'utf8')
  assert.match(log, /===== rerun alone: test\/alpha\.test\.mjs =====/)
  assert.doesNotMatch(log, /rerun alone: test\/beta/, 'the first file that fails again ends the reruns')
  assert.deepEqual(readdirSync(world.tmp), [])
  assert.equal(world.worktrees(), 1)
})

test('a full run that fails under load is run again per failing test file, alone and once: all passing lands and the log says so; never a second full run', LONG, async t => {
  const world = await makeWorld(t)
  const head = world.branch('feat')
  await world.boards()
  world.config({ gateBoard: world.gate('board-fail-files'), gateFile: `${world.gate('board-pass')} {file}` })
  const ran = await world.land('feat')
  assert.equal(ran.status, 0, ran.out)
  const out = lines(ran.out)
  assert.ok(out.includes('note: the gate failed with 2 failing test file(s): each is run again alone, once'), ran.out)
  assert.ok(out.includes('note: 2 test file(s) failed under load, all passed alone: the gate counts as passed'), ran.out)
  const [line] = world.landings()
  assert.equal(line.result, 'landed')
  assert.equal(line.after, head)
  const log = readFileSync(line.gateLog, 'utf8')
  assert.equal(log.match(/^gate: /gm).length, 1, 'one full run only')
  assert.match(log, /===== rerun alone: test\/alpha\.test\.mjs =====/)
  assert.match(log, /===== rerun alone: test\/beta\.test\.mjs =====/)
  assert.match(log, /\nrerun: 2 test file\(s\) failed under load, all passed alone: the gate counts as passed/)
  assertCleanedUp(world)
})

test('the claude program for the mod gate is the app\'s CLI under its own data folder, never the desktop app; none is a refusal', LONG, async t => {
  const world = await makeWorld(t)
  const app = join(world.root, 'localapp')
  const cli = version => {
    const dir = join(app, 'Claude-Data', 'id1', 'claude-code', version, 'hash')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'claude.exe'), 'x')
    return join(dir, 'claude.exe')
  }
  const desktop = join(world.root, 'Desktop', 'claude.exe')
  const store = join(world.root, 'WindowsApps', 'Claude_1', 'claude-code', '9', 'claude.exe')
  for (const file of [desktop, store]) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'x')
  }
  world.env.LOCALAPPDATA = app
  const ask = async processes => {
    world.config({ printClaude: true, claudeProcesses: processes })
    const ran = await world.land('unused')
    assert.equal(ran.status, 0, ran.out)
    return lines(ran.out).find(line => line.startsWith('claude: '))
  }
  // Only the desktop app and the store's copy: none.
  assert.equal(await ask([desktop, store]), 'claude: none')
  const older = cli('1.0.0')
  const newer = cli('2.0.0')
  const later = new Date(Date.now() + 60_000)
  utimesSync(newer, later, later)
  // Without a running one, the newest of the app's data folder; the desktop app is passed over.
  assert.equal(await ask([desktop, store]), `claude: ${newer}`)
  // A running chat's version is the one in use.
  assert.equal(await ask([desktop, older]), `claude: ${older}`)
  // And a branch that changes the mod, with none found, is refused with the words.
  rmSync(join(app, 'Claude-Data'), { recursive: true, force: true })
  world.branch('mod-change', { 'mods/workers/note.txt': 'the mod changed\n' })
  world.config({ gateMod: '', claudeProcesses: [desktop, store] })
  const refused = await world.land('mod-change')
  assert.equal(refused.status, 1)
  assert.match(lines(refused.out).at(-1), /^refused: the mod gate cannot run: claude CLI not found \(the app's own claude\.exe is never used\) \(see /)
  assert.equal(git(world.main, 'rev-parse', 'HEAD'), world.before)
})

test('gate worktrees a cut landing left are swept at the start: the junction first (its target untouched), then the worktree; one whose landing still runs is left', LONG, async t => {
  const world = await makeWorld(t)
  world.branch('feat')
  const target = join(world.root, 'nm-target')
  mkdirSync(target)
  writeFileSync(join(target, 'keep.txt'), 'the files behind a junction must survive the sweep')
  const leftover = (name, { worktree = true, owner = null } = {}) => {
    const dir = join(world.tmp, name)
    if (worktree) git(world.main, 'worktree', 'add', '--detach', dir, 'HEAD')
    else mkdirSync(dir)
    const linked = spawnSync('cmd.exe', ['/c', 'mklink', '/J', join(dir, 'node_modules'), target], { windowsHide: true })
    assert.equal(linked.status, 0, String(linked.stdout))
    if (owner !== null) writeFileSync(`${dir}.owner`, String(owner))
    return dir
  }
  const dead = leftover('land-gate-dead0001', { owner: 999999 })
  const noOwner = leftover('land-gate-noown002')
  const plain = leftover('land-gate-plain003', { worktree: false })
  // A landing that is alive: a PowerShell process that runs for a while owns this one.
  const alive = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 300'], { stdio: 'ignore', windowsHide: true })
  world.started.push(alive)
  const live = leftover('land-gate-live0004', { owner: alive.pid })
  git(world.main, 'branch', 'same')
  const ran = await world.land('same')
  assert.equal(ran.status, 1, ran.out)
  const out = lines(ran.out)
  for (const dir of [dead, noOwner, plain]) {
    assert.equal(existsSync(dir), false, `${dir} is gone`)
    assert.ok(out.some(line => line.startsWith('note: removed the gate worktree ') && line.includes(dir)), ran.out)
  }
  assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'the files behind a junction must survive the sweep')
  assert.equal(existsSync(`${dead}.owner`), false)
  assert.equal(existsSync(join(live, 'node_modules', 'keep.txt')), true, 'the live landing\'s worktree and junction are untouched')
  assert.ok(out.some(line => line.includes(`${live} belongs to a landing that is still running`)), ran.out)
  assert.equal(world.worktrees(), 2, 'main and the live landing\'s worktree')
  // Its landing gone, the next run sweeps it too.
  spawnSync('taskkill', ['/PID', String(alive.pid), '/T', '/F'], { windowsHide: true })
  await sleep(500)
  const again = await world.land('same')
  assert.ok(lines(again.out).some(line => line.startsWith('note: removed the gate worktree ') && line.includes(live)), again.out)
  assert.equal(existsSync(live), false)
  assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'the files behind a junction must survive the sweep')
  assert.equal(world.worktrees(), 1)
})

// The script's own text.

const text = () => readFileSync(SCRIPT, 'utf8')

/** The lines of the script that push; the git calls are arrays like @('push', $remote, 'main'). */
const pushLines = source => source.split('\n').filter(line => /'push'/.test(line))
const forcesAPush = source => pushLines(source).some(line => /--force|--mirror|'-f'|\+main|:main/.test(line))
/** 2026-11-09: the one push that deletes is the branch clean-up's, of a name that is checked (never main, fully merged) first. */
const DELETE_PUSH = "@('push', $remote, '--delete', $Name)"

test('no push in the script is forced, and no command in it takes work back by force; the one delete is of a checked branch name, never main', () => {
  const source = text()
  assert.ok(pushLines(source).length >= 2, 'the landing\'s push and the revert\'s push are both there')
  assert.equal(forcesAPush(source), false)
  const deletes = pushLines(source).filter(line => /--delete/.test(line))
  assert.equal(deletes.length, 1, 'one push deletes: the branch clean-up')
  assert.ok(deletes[0].includes(DELETE_PUSH), deletes[0])
  const removeRemote = source.slice(source.indexOf('function Remove-RemoteBranch'), source.indexOf(DELETE_PUSH))
  assert.ok(removeRemote.includes("if ($Name -eq 'main') { return 'main is never removed' }"), 'main is refused before the delete')
  assert.ok(removeRemote.includes('Get-NotOnMainWhy $Heads[$Name] $Heads[\'main\']'), 'the merge check comes before the delete')
  assert.ok(/if \(\$null -ne \$why\) \{ return \$why \}/.test(removeRemote), 'an unmerged branch returns before the delete')
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
  assert.ok(at("'merge', '--ff-only', $script:headFull") < at('Publish-Main'), 'main moves, then it is pushed')
})

test('the lock is refreshed at each phase, the settings are read inside the try, and a process is stopped only through Stop-Tree', () => {
  const source = text()
  const run = source.slice(source.indexOf('function Invoke-Run'), source.indexOf('\ntry {\n  Invoke-Run'))
  // The heartbeat: after the lock is taken and checked, after the fast-forward, after the push, after the trial copy; and per board.
  assert.ok((run.match(/Update-LockBeat/g) ?? []).length >= 4)
  assert.ok(run.indexOf("'lock-take'") < run.indexOf('Update-LockBeat $true'), 'the first beat is under the lock and must hold')
  assert.ok(run.indexOf('Update-LockBeat $true') < run.indexOf("'merge', '--ff-only', $script:headFull"), 'a lock that is not ours is a refusal before main moves')
  assert.match(source, /function Restart-AllBoards[\s\S]*Update-LockBeat[\s\S]*function Read-Boards/)
  assert.match(source, /function Invoke-Rollback[\s\S]*Update-LockBeat/)
  // The settings: read by a function the run calls inside its try, never at the top of the script.
  assert.ok(run.startsWith('function Invoke-Run {\n  Initialize-Settings\n'))
  assert.ok(!/^\$cfg = .*ConvertFrom-Json/m.test(source), 'the settings file is not read outside the try')
  // taskkill, under an error preference of Stop, only where a complaint is caught.
  const kills = source.split('\n').filter(line => /taskkill/.test(line) && !/^\s*#/.test(line))
  assert.equal(kills.length, 1)
  assert.match(source, /function Stop-Tree\(\[int\]\$ProcId\) \{\n  try \{ & taskkill [^\n]*\} catch \{ \$null = \$_ \}/)
  assert.ok(!/Stop-Process[^\n]*\$process/.test(source.replace(/function Stop-Tree[\s\S]*?\n\}/, '')), 'a process the script started is stopped through Stop-Tree')
})

test('the script is plain ASCII and has no syntax error in Windows PowerShell', { skip }, () => {
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text()), 'a character above ASCII')
  const ran = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:LAND_SCRIPT, [ref]$null, [ref]$errors); $errors.Count'],
  { encoding: 'utf8', env: { ...process.env, LAND_SCRIPT: SCRIPT }, windowsHide: true })
  assert.equal(ran.stdout.trim(), '0', ran.stdout + ran.stderr)
})
