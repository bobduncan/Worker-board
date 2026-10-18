// B311: "CPU for the chats". The person, 2026-10-18, while playing: "i want a setting in the worker board to limit how
// much cpu the workers do, because i am experiencing lag now". Off, Gentle (BelowNormal), Strong (Idle, the higher half
// of the cores), for the project's chats and everything below them only. Made-up processes; Windows is replaced.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createBoard } from '../server.mjs'
import { configProblem, parseConfig } from '../src/config.mjs'
import {
  affinityMask, changesFor, chosenProcesses, cpuLimiter, parseLevel, parseListing, readLevel, saveLevel, sessionOf, sessionsOfCards, strongCores,
} from '../src/cpu.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const A = 'aaaaaaaa-1111-2222-3333-444444444444'
const B = 'bbbbbbbb-1111-2222-3333-444444444444'
const OTHER = 'cccccccc-1111-2222-3333-444444444444'
const CLI = 'C:\\Users\\sam\\AppData\\Local\\SomeApp\\claude-code\\2.1.0\\claude.exe --output-format stream-json'

/** A made-up PC: the desktop app with its helpers, two of the project's chats with their trees, a chat of another project, and the rest. */
function machine() {
  return [
    { pid: 100, parent: 1, name: 'Claude.exe', commandLine: '"C:\\Program Files\\WindowsApps\\Claude\\app\\Claude.exe"', priority: 8, created: 10 },
    { pid: 101, parent: 100, name: 'Claude.exe', commandLine: '"C:\\Program Files\\WindowsApps\\Claude\\app\\Claude.exe" --type=renderer', priority: 8, created: 11 },
    { pid: 200, parent: 100, name: 'claude.exe', commandLine: `${CLI} --resume=${A} --allowedTools=x`, priority: 8, created: 20 },
    { pid: 201, parent: 200, name: 'bash.exe', commandLine: null, priority: 8, created: 21 },
    { pid: 202, parent: 201, name: 'node.exe', commandLine: null, priority: 8, created: 22 },
    { pid: 203, parent: 202, name: 'msedge.exe', commandLine: null, priority: 8, created: 23 },
    { pid: 300, parent: 100, name: 'claude.exe', commandLine: `${CLI} --resume ${B}`, priority: 6, created: 30 },
    { pid: 301, parent: 300, name: 'git.exe', commandLine: null, priority: 6, created: 31 },
    { pid: 400, parent: 100, name: 'claude.exe', commandLine: `${CLI} --resume=${OTHER}`, priority: 8, created: 40 },
    { pid: 401, parent: 400, name: 'node.exe', commandLine: null, priority: 8, created: 41 },
    { pid: 500, parent: 1, name: 'game.exe', commandLine: null, priority: 8, created: 50 },
    // A process whose parent number was given out again: it started before process 200, so it is not its child.
    { pid: 600, parent: 200, name: 'old.exe', commandLine: null, priority: 8, created: 5 },
  ]
}

test('a level comes from a click or a setting; anything else is none', () => {
  assert.deepEqual(['off', 'Gentle', ' STRONG '].map(parseLevel), ['off', 'gentle', 'strong'])
  assert.deepEqual(['', 'max', null, 3, undefined].map(parseLevel), [null, null, null, null, null])
})

test('the level is kept in the data folder and read back; without it the setting stands, else Off', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'data', 'cpu.json')
  assert.equal(await readLevel(file), 'off')
  assert.equal(await readLevel(file, 'gentle'), 'gentle')
  assert.equal(await readLevel(file, 'nonsense'), 'off')
  await saveLevel(file, 'strong', 1234)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { level: 'strong', at: 1234 })
  assert.equal(await readLevel(file, 'gentle'), 'strong')
  await writeFile(file, '{ broken')
  assert.equal(await readLevel(file, 'gentle'), 'gentle')
})

test('config.json may give the default level, and a wrong one stops the board with one line', () => {
  assert.equal(parseConfig('{}', {}).cpuLimit, 'off')
  assert.equal(parseConfig('{"cpuLimit": "Gentle"}', {}).cpuLimit, 'gentle')
  assert.equal(parseConfig('{"cpuLimit": "max"}', {}).cpuLimit, 'off')
  assert.equal(configProblem('{"cpuLimit": "strong"}'), null)
  assert.match(configProblem('{"cpuLimit": "max"}'), /"cpuLimit" must be "off", "gentle" or "strong"/)
})

test('the affinity mask: all cores for Off and Gentle, the higher half for Strong', () => {
  assert.equal(affinityMask(24, 'off'), String(0xFFFFFF))
  assert.equal(affinityMask(24, 'gentle'), String(0xFFFFFF))
  assert.equal(affinityMask(24, 'strong'), String(0xFFF000))
  assert.equal(strongCores(24), 12)
  assert.equal(affinityMask(8, 'strong'), String(0xF0))
  assert.equal(affinityMask(5, 'strong'), String(0b11000))
  // One core: Strong keeps it.
  assert.equal(affinityMask(1, 'strong'), '1')
  // 64 cores: the signed number Windows takes.
  assert.equal(affinityMask(64, 'off'), '-1')
  assert.equal(affinityMask(64, 'strong'), String(BigInt.asIntN(64, 0xFFFFFFFF00000000n)))
})

test('a CLI names its session; the desktop app names none', () => {
  assert.equal(sessionOf(`${CLI} --resume=${A} --x`), A)
  assert.equal(sessionOf(`${CLI} --resume ${A}`), A)
  assert.equal(sessionOf(`${CLI} --session-id "${A}"`), A)
  assert.equal(sessionOf('"C:\\Program Files\\WindowsApps\\Claude\\app\\Claude.exe" --type=renderer'), null)
  assert.equal(sessionOf(null), null)
  assert.deepEqual(sessionsOfCards([`${A}.json`, 'list.json', 'notes.txt', '../x.json', `${B}.json`]), [A, B])
})

test('the chosen processes: the project\'s chats and their whole trees; not the desktop app, not another project, not the rest', () => {
  const chosen = chosenProcesses(machine(), [A, B])
  assert.deepEqual(chosen.map(one => one.pid).sort((x, y) => x - y), [200, 201, 202, 203, 300, 301])
  // Parents come before their children.
  const at = pid => chosen.findIndex(one => one.pid === pid)
  assert.ok(at(200) < at(201) && at(201) < at(202) && at(202) < at(203))
  assert.deepEqual(chosenProcesses(machine(), []), [])
  // A session id in the desktop app's name or another program's does not make it a chat.
  assert.deepEqual(chosenProcesses([{ pid: 9, parent: 1, name: 'Claude.exe', commandLine: `x --type=renderer --resume=${A}`, priority: 8, created: 1 }].map(one => ({ ...one, name: 'node.exe' })), [A]), [])
})

test('what to set: only what is not at the level; a child that inherited from a done parent needs nothing', () => {
  const chosen = chosenProcesses(machine(), [A, B])
  const applied = new Map()
  const first = changesFor(chosen, 'gentle', applied, 24)
  // Everything once, also process 300 that is BelowNormal already: the board did not set its cores.
  assert.deepEqual(first.changes.map(one => one.pid).sort((x, y) => x - y), [200, 201, 202, 203, 300, 301])
  assert.deepEqual(new Set(first.changes.map(one => `${one.priority} ${one.affinity}`)), new Set([`BelowNormal ${0xFFFFFF}`]))
  for (const change of first.changes) applied.set(change.key, 'gentle')
  // The next look: Windows reports them BelowNormal; a new child of a done chat inherited it.
  const later = [...machine().map(one => (chosen.some(c => c.pid === one.pid) ? { ...one, priority: 6 } : one)), { pid: 204, parent: 202, name: 'python.exe', commandLine: null, priority: 6, created: 60 }]
  const again = changesFor(chosenProcesses(later, [A, B]), 'gentle', applied, 24)
  assert.deepEqual(again.changes, [])
  assert.ok(again.inherited.some(key => key.startsWith('204@')))
  // A process that set itself back to Normal is set again, and so is a child the board has not seen done.
  const backToNormal = later.map(one => (one.pid === 202 ? { ...one, priority: 8 } : one))
  assert.deepEqual(changesFor(chosenProcesses(backToNormal, [A, B]), 'gentle', applied, 24).changes.map(one => one.pid), [202, 204])
  // Strong sets everything anew: Idle and the higher half.
  const strong = changesFor(chosenProcesses(later, [A, B]), 'strong', applied, 24)
  assert.equal(strong.changes.length, 7)
  assert.deepEqual(new Set(strong.changes.map(one => `${one.priority} ${one.affinity}`)), new Set([`Idle ${0xFFF000}`]))
})

test('a process listing in PowerShell\'s JSON, also a single one', () => {
  assert.deepEqual(parseListing('{"pid":4,"parent":0,"name":"System","priority":8,"created":null,"commandLine":null}'), [{ pid: 4, parent: 0, name: 'System', commandLine: null, priority: 8, created: null }])
  assert.equal(parseListing('[{"pid":1},{"name":"no pid"}]').length, 1)
  assert.deepEqual(parseListing(''), [])
})

/** A made-up Windows: its processes, what was set, and a listing that can fail. */
function fakeWindows(list) {
  const calls = { lists: 0, sets: [] }
  let fails = false
  return {
    calls,
    failNext: () => { fails = true },
    processes: {
      list: async () => {
        calls.lists += 1
        if (fails) {
          fails = false
          throw new Error('Access is denied')
        }
        return list()
      },
      set: async changes => {
        calls.sets.push(changes)
        return changes.map(one => one.pid)
      },
    },
  }
}

test('the limiter: Off does nothing; Gentle and Strong set the chats; back to Off gives Normal and all cores once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const state = new Map(machine().map(one => [one.pid, one]))
  const windows = fakeWindows(() => [...state.values()])
  const limiter = cpuLimiter({ file: join(dir, 'cpu.json'), platform: 'win32', cores: 24, sessions: async () => [A, B], processes: windows.processes, now: () => 7 })
  // Off from the start: no listing at all.
  await limiter.apply()
  assert.deepEqual([windows.calls.lists, windows.calls.sets.length, limiter.view().level, limiter.view().count], [0, 0, 'off', 0])

  const gentle = await limiter.set('gentle')
  assert.deepEqual([gentle.ok, gentle.result.level, gentle.result.count], [true, 'gentle', 6])
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'cpu.json'), 'utf8')), { level: 'gentle', at: 7 })
  assert.equal(windows.calls.sets.length, 1)
  assert.ok(windows.calls.sets[0].every(one => one.priority === 'BelowNormal' && ![100, 101, 400, 401, 500, 600].includes(one.pid)))
  // Windows now reports them so: the next refresh lists once and sets nothing.
  for (const change of windows.calls.sets[0]) state.set(change.pid, { ...state.get(change.pid), priority: 6 })
  await limiter.apply()
  assert.deepEqual([windows.calls.lists, windows.calls.sets.length], [2, 1])

  await limiter.set('strong')
  assert.equal(windows.calls.sets.length, 2)
  assert.ok(windows.calls.sets[1].every(one => one.priority === 'Idle' && one.affinity === String(0xFFF000)))
  assert.equal(limiter.view().count, 6)

  await limiter.set('off')
  assert.equal(windows.calls.sets.length, 3)
  assert.deepEqual(windows.calls.sets[2].map(one => one.pid).sort((x, y) => x - y), [200, 201, 202, 203, 300, 301])
  assert.ok(windows.calls.sets[2].every(one => one.priority === 'Normal' && one.affinity === String(0xFFFFFF)))
  // After that one pass Off lists nothing any more.
  const lists = windows.calls.lists
  await limiter.apply()
  assert.deepEqual([windows.calls.lists, windows.calls.sets.length, limiter.view().count], [lists, 3, 0])
})

test('a listing that fails is one line, and the next one clears it; a level is refused when it is none', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const windows = fakeWindows(() => machine())
  const limiter = cpuLimiter({ file: join(dir, 'cpu.json'), fallback: 'gentle', platform: 'win32', cores: 24, sessions: async () => [A], processes: windows.processes })
  windows.failNext()
  await limiter.apply()
  assert.match(limiter.view().fault, /could not read the list of processes \(Access is denied\)/)
  assert.equal(limiter.view().level, 'gentle')
  await limiter.apply()
  assert.equal(limiter.view().fault, null)
  assert.equal(limiter.view().count, 4)
  assert.deepEqual(await limiter.set('max'), { ok: false, status: 400, why: 'The level is off, gentle or strong.' })
})

test('on another platform the control says not available and nothing runs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const windows = fakeWindows(() => machine())
  const limiter = cpuLimiter({ file: join(dir, 'cpu.json'), fallback: 'strong', platform: 'linux', cores: 8, sessions: async () => [A], processes: windows.processes })
  await limiter.apply()
  const refused = await limiter.set('gentle')
  assert.deepEqual([refused.ok, refused.status], [false, 409])
  assert.deepEqual([windows.calls.lists, windows.calls.sets.length, limiter.view().available], [0, 0, false])
})

test('the level is set only from the board\'s own page', async t => {
  const TOKEN = 'a'.repeat(64)
  const calls = []
  const server = createBoard({
    token: TOKEN, getState: async () => ({}), say: async () => ({ ok: false, status: 400, why: 'x' }),
    cpu: async body => {
      calls.push(body)
      return { ok: true, result: { level: body.level } }
    },
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const self = `127.0.0.1:${server.address().port}`
  const ask = headers => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/api/cpu', headers: { Host: self, ...headers } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => done({ status: res.statusCode, text }))
    })
    req.on('error', fail)
    req.end('{"level":"gentle"}')
  })
  const good = { 'X-Board-Token': TOKEN, Origin: `http://${self}`, 'Content-Type': 'application/json' }
  assert.equal((await ask({ ...good, 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  assert.equal((await ask({ ...good, Origin: 'http://evil.example' })).status, 403)
  assert.equal(calls.length, 0)
  const answer = await ask(good)
  assert.deepEqual([answer.status, JSON.parse(answer.text)], [200, { level: 'gentle' }])
})

test('the head shows the level, and how many processes it applies to when not Off', async () => {
  const [script, html] = await Promise.all([readFile(join(HERE, '..', 'public', 'board.js'), 'utf8'), readFile(join(HERE, '..', 'public', 'index.html'), 'utf8')])
  // Beside Prepare restart, one button per level.
  assert.match(html, /id="prepare-restart"[^]*?<div class="cpu" id="cpu"[^]*?data-cpu="off"[^]*?data-cpu="gentle"[^]*?data-cpu="strong"/)
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// cpu:start'), script.indexOf('// cpu:end'))}\nthis.cpuView = cpuView`, page)
  const cpu = { available: true, level: 'off', count: 0, fault: null, cores: 24, strongCores: 12 }
  assert.equal(page.cpuView(null), null)
  assert.deepEqual([page.cpuView(cpu).level, page.cpuView(cpu).count], ['off', ''])
  assert.equal(page.cpuView({ ...cpu, level: 'gentle', count: 14 }).count, '14 processes, below normal')
  assert.equal(page.cpuView({ ...cpu, level: 'strong', count: 1 }).count, '1 process, idle, 12 of 24 cores')
  // A click lights the new level at once, and the buttons wait for the answer.
  const pending = page.cpuView({ ...cpu, level: 'gentle', count: 14 }, 'strong')
  assert.deepEqual([pending.level, pending.disabled, pending.count], ['strong', true, ''])
  const elsewhere = page.cpuView({ ...cpu, available: false })
  assert.deepEqual([elsewhere.label, elsewhere.disabled], ['CPU for the chats: not available here', true])
  assert.match(page.cpuView({ ...cpu, level: 'gentle', fault: 'The board could not read the list of processes (x).' }).note, /could not read/)
})
