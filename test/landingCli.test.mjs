// The small program the go-live script calls where PowerShell would be fragile: node tools/landing.mjs <command>. Its answers
// are one line of ASCII JSON; its exit code says the verdict (0 ok, 1 not). Temporary files only.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../tools/landing.mjs', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'landing-cli-test-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
let counter = 0
const folder = () => {
  const dir = join(scratch, `case-${++counter}`)
  mkdirSync(dir)
  return dir
}

/** Runs the program; `{ status, said }` with what it printed read as JSON (null when it printed none). */
function run(...args) {
  const ran = spawnSync(process.execPath, [CLI, ...args.map(String)], { encoding: 'utf8' })
  const text = ran.stdout.trim()
  return { status: ran.status, said: text === '' ? null : JSON.parse(text), err: ran.stderr }
}

/** The same, many at once: each `{ status, said }` as the process ended. */
function runAll(argLists) {
  return Promise.all(argLists.map(args => new Promise(done => {
    const child = spawn(process.execPath, [CLI, ...args.map(String)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.on('exit', status => done({ status, said: out.trim() === '' ? null : JSON.parse(out.trim()) }))
  })))
}

test('gate-check reads the log file: a summary of fail 0 and a good exit code pass, the rest does not', () => {
  const dir = folder()
  const good = join(dir, 'good.log')
  writeFileSync(good, '\u2714 one (0.4ms)\n\u2139 tests 1\n\u2139 pass 1\n\u2139 fail 0\n')
  assert.deepEqual(run('gate-check', '--kind', 'board', '--file', good, '--exit', 0), { status: 0, said: { ok: true, why: null }, err: '' })
  const bad = run('gate-check', '--kind', 'board', '--file', good, '--exit', 1)
  assert.equal(bad.status, 1)
  assert.match(bad.said.why, /code 1/)
  const red = join(dir, 'red.log')
  writeFileSync(red, '\u2139 tests 3\n\u2139 pass 1\n\u2139 fail 2\n')
  assert.equal(run('gate-check', '--kind', 'board', '--file', red, '--exit', 1).said.ok, false)
  // A log that is not there or empty is no summary.
  assert.match(run('gate-check', '--kind', 'board', '--file', join(dir, 'none.log')).said.why, /no summary/)
  const mod = join(dir, 'mod.log')
  writeFileSync(mod, '(pass) a\n\n 3 pass\n 0 fail\nRan 3 tests across 1 files.\n')
  assert.equal(run('gate-check', '--kind', 'mod', '--file', mod, '--exit', 0).said.ok, true)
  // A byte-order mark in front (Windows PowerShell writes one) does not hide the first line.
  const bom = join(dir, 'bom.log')
  writeFileSync(bom, '\ufeff\u2139 fail 0\n')
  assert.equal(run('gate-check', '--kind', 'board', '--file', bom).said.ok, true)
})

test('lock-take and lock-release: one taker wins when six start at once, the others are told who holds it', async () => {
  const dir = folder()
  const file = join(dir, 'landing.lock')
  const all = await runAll([1, 2, 3, 4, 5, 6].map(n => ['lock-take', '--file', file, '--by', `chat ${n}`, '--branch', `branch-${n}`, '--pid', 1000 + n]))
  const winners = all.filter(one => one.said.ok)
  assert.equal(winners.length, 1, JSON.stringify(all.map(one => one.said)))
  assert.deepEqual(all.map(one => one.status).sort(), [0, 1, 1, 1, 1, 1])
  const held = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(held.by, winners[0].said.by)
  for (const loser of all.filter(one => !one.said.ok)) assert.match(loser.said.why, new RegExp(`^a landing by ${held.by} of ${held.branch} holds the lock since \\d\\d:\\d\\d$`))
  // Not given back by another run; given back by the one that took it.
  assert.equal(run('lock-release', '--file', file, '--pid', 1, '--at', held.at).said.released, false)
  assert.equal(existsSync(file), true)
  assert.deepEqual(run('lock-release', '--file', file, '--pid', held.pid, '--at', held.at).said, { released: true })
  assert.equal(existsSync(file), false)
})

test('lock-take breaks a stale lock and says so; --stale-minutes sets how old that is', () => {
  const dir = folder()
  const file = join(dir, 'landing.lock')
  writeFileSync(file, JSON.stringify({ by: 'chat 1', branch: 'old', at: new Date(Date.now() - 16 * 60_000).toISOString(), pid: 1 }))
  const took = run('lock-take', '--file', file, '--by', 'chat 3', '--branch', 'new', '--pid', 2)
  assert.equal(took.status, 0)
  assert.match(took.said.broke, /^broke a stale landing lock of chat 1 \(old, since \d\d:\d\d\)$/)
  const young = run('lock-take', '--file', file, '--by', 'chat 4', '--branch', 'x', '--pid', 3, '--stale-minutes', 60)
  assert.equal(young.status, 1)
  assert.match(young.said.why, /chat 3 of new/)
})

test('inspect takes the lists as PowerShell writes them (one object is no array, a byte-order mark in front) and answers with the verdict', () => {
  const dir = folder()
  const boards = join(dir, 'boards.json')
  const processes = join(dir, 'processes.json')
  const connections = join(dir, 'connections.json')
  writeFileSync(boards, '\ufeff' + JSON.stringify([{ dir: 'C:\\b\\worker-board', port: 4310 }]))
  writeFileSync(processes, '\ufeff' + JSON.stringify([
    { pid: 10, ppid: 1, name: 'node.exe', commandLine: 'node C:\\b\\worker-board\\server.mjs' },
    { pid: 50, ppid: 1, name: 'node.exe', commandLine: 'node trace.mjs' },
  ]))
  // One connection only: PowerShell writes it as an object, not a list.
  writeFileSync(connections, JSON.stringify({ state: 'Listen', localAddress: '127.0.0.1', localPort: 4310, remoteAddress: '0.0.0.0', remotePort: 0, pid: 10 }))
  const clear = run('inspect', '--boards', boards, '--processes', processes, '--connections', connections)
  assert.equal(clear.status, 0)
  assert.equal(clear.said.verdict, 'ok')
  const link = (pid, localPort, remotePort) => ({ state: 'Established', localAddress: '127.0.0.1', localPort, remoteAddress: '127.0.0.1', remotePort, pid })
  writeFileSync(connections, JSON.stringify([
    { state: 'Listen', localAddress: '127.0.0.1', localPort: 4310, remoteAddress: '0.0.0.0', remotePort: 0, pid: 10 },
    { state: 'Listen', localAddress: '127.0.0.1', localPort: 9229, remoteAddress: '0.0.0.0', remotePort: 0, pid: 10 },
  ]))
  const note = run('inspect', '--boards', boards, '--processes', processes, '--connections', connections)
  assert.deepEqual([note.status, note.said.verdict, note.said.notes.length], [0, 'note', 1])
  writeFileSync(connections, JSON.stringify([
    { state: 'Listen', localAddress: '127.0.0.1', localPort: 4310, remoteAddress: '0.0.0.0', remotePort: 0, pid: 10 },
    { state: 'Listen', localAddress: '127.0.0.1', localPort: 9229, remoteAddress: '0.0.0.0', remotePort: 0, pid: 10 },
    link(10, 9229, 60000), link(50, 60000, 9229),
  ]))
  const held = run('inspect', '--boards', boards, '--processes', processes, '--connections', connections)
  assert.equal(held.status, 1)
  assert.equal(held.said.verdict, 'refuse')
  assert.match(held.said.refusal, /^a debugger is attached to the 4310 board's child \(pid 10, inspector port 9229, client pid 50 node trace\.mjs\): stop it first$/)
  assert.deepEqual(held.said.processes.map(one => [one.port, one.role, one.pid]), [[4310, 'child', 10]])
  // An empty list file (PowerShell's pipeline of nothing) is an empty list.
  writeFileSync(connections, '')
  assert.equal(run('inspect', '--boards', boards, '--processes', processes, '--connections', connections).said.verdict, 'ok')
})

test('log-line appends one line per call to the landings log, making its folder, and prints it', () => {
  const dir = folder()
  const file = join(dir, 'data', 'landings.jsonl')
  const fields = join(dir, 'fields.json')
  writeFileSync(fields, '\ufeff' + JSON.stringify({ at: '2026-11-04T18:00:00.000Z', by: 'chat 3', branch: 'x', head: 'h', before: 'b', after: 'a', result: 'landed', boards: [{ port: 4310, commit: 'a', since: 1 }], cold: false, gateLog: 'g.log' }))
  const first = run('log-line', '--file', file, '--fields', fields)
  assert.equal(first.status, 0)
  writeFileSync(fields, JSON.stringify({ at: '2026-11-04T18:05:00.000Z', by: 'unknown', branch: 'y', head: 'h2', before: 'b', result: 'refused', why: 'merge main into y first' }))
  run('log-line', '--file', file, '--fields', fields)
  const lines = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(lines.map(line => [line.branch, line.result, line.after]), [['x', 'landed', 'a'], ['y', 'refused', null]])
  // A result that is none of the four is a usage error, and writes nothing.
  writeFileSync(fields, JSON.stringify({ at: 'A', by: 'b', branch: 'c', head: 'h', before: 'b', result: 'done' }))
  const wrong = spawnSync(process.execPath, [CLI, 'log-line', '--file', file, '--fields', fields], { encoding: 'utf8' })
  assert.equal(wrong.status, 2)
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2)
})

test('a command it does not know is a usage error', () => {
  const ran = spawnSync(process.execPath, [CLI, 'frobnicate'], { encoding: 'utf8' })
  assert.equal(ran.status, 2)
  assert.match(ran.stderr, /frobnicate/)
})
