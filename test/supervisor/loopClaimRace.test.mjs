// F55 (chat 1's review): the loop-owner check raced for real by two processes on one lock file, in bursts: never two owners in a
// round. Phase A: both meet an empty lock (the race B488's read-back lost: chat 1's probe saw 14 double owners in 40 rounds on main).
// Phase B: a dead process's claim stands before every round (review 2: a claim taken away by name; 68 double owners in 167 rounds
// before the fix). Phase C: the holder keeps the lock under bursts while the other asks (the heartbeat, review 3). The racers are
// test/fixtures/loopClaimRacer.mjs, on the ports server.mjs builds (claimFile.mjs, the unflushed lock write).

import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { claimFileOf } from '../../src/supervisor/claimFile.mjs'

const RACER = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'loopClaimRacer.mjs')
const DEAD_PID = 999_999

function racer(lock, port, started) {
  const child = spawn(process.execPath, [RACER, lock, String(port)], { env: { ...process.env, RACER_DEAD: String(DEAD_PID) }, windowsHide: true })
  started.push(child)
  const waiting = new Map()
  let out = ''
  let ready
  const isReady = new Promise(done => { ready = done })
  child.stdout.on('data', chunk => {
    out += chunk
    const lines = out.split('\n')
    out = lines.pop()
    for (const line of lines) {
      const [head, ...rest] = line.trim().split(' ')
      if (head === 'ready') { ready(Number(rest[0])); continue }
      waiting.get(head)?.(rest.join(' '))
      waiting.delete(head)
    }
  })
  let errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  const ask = round => new Promise((done, fail) => {
    waiting.set(String(round), done)
    const late = setTimeout(() => fail(new Error(`round ${round}: no answer in 20 s; stderr: ${errors}`)), 20_000)
    waiting.set(String(round), text => { clearTimeout(late); done(text) })
    child.stdin.write(`go ${round}\n`)
  })
  return { child, ask, isReady, errors: () => errors }
}

const readJson = file => readFile(file, 'utf8').then(text => JSON.parse(text), () => null)

test('two processes race the loop lock for real: an empty lock, a dead claim before every round, and the holder under bursts: never two owners', { timeout: 240_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loop-race-'))
  const started = []
  t.after(async () => {
    for (const child of started) { try { child.stdin.end('quit\n') } catch { /* gone */ } }
    await Promise.all(started.map(child => new Promise(done => { if (child.exitCode !== null) return done(); child.once('exit', done); setTimeout(() => { child.kill('SIGKILL'); done() }, 3000) })))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
  })
  const lock = join(dir, 'project', '.claude', 'sync-loop.json')
  const claim = claimFileOf(lock)
  const a = racer(lock, 4310, started)
  const b = racer(lock, 4311, started)
  const [pidA, pidB] = await Promise.all([a.isReady, b.isReady])
  const pids = new Set([pidA, pidB])
  const round = async n => {
    const [ownsA, ownsB] = await Promise.all([a.ask(n), b.ask(n)])
    for (const text of [ownsA, ownsB]) assert.ok(text === 'true' || text === 'false', `round ${n}: a racer failed: ${text}; ${a.errors()} ${b.errors()}`)
    return [ownsA === 'true', ownsB === 'true']
  }
  const clear = async () => { await rm(lock, { force: true }); await rm(claim, { force: true }) }
  // Phase A: an empty lock, 300 rounds back to back.
  let doubles = 0
  let owners = 0
  for (let n = 0; n < 300; n++) {
    await clear()
    const [x, y] = await round(`a${n}`)
    if (x && y) doubles += 1
    if (x || y) owners += 1
    const holder = await readJson(lock)
    assert.ok(holder !== null && pids.has(holder.pid), `round a${n}: the lock names one of the two (${JSON.stringify(holder)})`)
    if ((x && holder.pid !== pidA) || (y && holder.pid !== pidB)) assert.fail(`round a${n}: the lock names ${holder.pid}, but ${x ? pidA : pidB} answered yes`)
  }
  assert.equal(doubles, 0, 'phase A: never two owners')
  assert.equal(owners, 300, 'phase A: one owner every round (an empty lock is always won by one)')
  // Phase B: a dead process's claim before every round (review 2: taken away by name before the fix, and the other's fresh claim with it).
  doubles = 0
  owners = 0
  let noOwner = 0
  for (let n = 0; n < 300; n++) {
    await clear()
    await writeFile(claim, JSON.stringify({ pid: DEAD_PID, port: 1, at: Date.now() }))
    const [x, y] = await round(`b${n}`)
    if (x && y) doubles += 1
    if (x || y) owners += 1
    else noOwner += 1
    const holder = await readJson(lock)
    if (x || y) assert.ok(holder !== null && holder.pid === (x ? pidA : pidB), `round b${n}: the lock names the one that answered yes`)
    assert.equal(await readJson(claim), null, `round b${n}: no claim left behind (${await readFile(claim, 'utf8').catch(() => 'none')})`)
  }
  assert.equal(doubles, 0, 'phase B: never two owners')
  assert.ok(owners > 0, `phase B: some rounds end with an owner (${owners} of 300; ${noOwner} with none, the abandoned claim taken away first)`)
  // Phase C: the lock stays with its holder under 200 bursts (the heartbeat); the other is refused every time.
  await clear()
  const [firstA, firstB] = await round('c-first')
  assert.ok(firstA !== firstB, 'one holder to begin with')
  const holder = firstA ? pidA : pidB
  for (let n = 0; n < 200; n++) {
    const [x, y] = await round(`c${n}`)
    assert.deepEqual([x, y], [firstA, firstB], `round c${n}: the holder keeps the lock, the other is refused`)
  }
  assert.equal((await readJson(lock)).pid, holder)
  assert.equal(await readJson(claim), null, 'no claim stands at the end')
})
