// B311: "CPU for the chats". The person, 2026-10-18, while playing: "i want a setting in the worker board to limit how
// much cpu the workers do, because i am experiencing lag now". B735 (2026-10-27): "CPU for Claude", two choices the
// person picks: Full (Normal priority, all cores) and Low (Idle, the last two cores, efficiency mode) for everything the
// project started: the chats' trees, the board itself, the vite servers, codex and a headless browser. Made-up
// processes; Windows is replaced.

import assert from 'node:assert/strict'
import { readFileSync as readFileSyncForTest } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { availableParallelism, cpus, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createBoard } from '../server.mjs'
import { configProblem, parseConfig } from '../src/config.mjs'
import {
  affinityMask, boardChanges, changesFor, chosenProcesses, cpuLimiter, LIST_SCRIPT, logicalCores, lowCores, parseLevel, parseListing, readLevel, RESTORE_PASSES, saveLevel, sessionOf, sessionsOfCards,
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

/** What the project's tools add to that PC: the board and its keeper (with a child), a vite server, codex, a headless Edge, and the person's own Edge. */
function tools() {
  return [
    { pid: 900, parent: 1, name: 'node.exe', commandLine: 'node start-board.mjs', priority: 8, created: 60 },
    { pid: 901, parent: 900, name: 'node.exe', commandLine: 'node server.mjs', priority: 8, created: 61 },
    { pid: 902, parent: 901, name: 'python.exe', commandLine: null, priority: 8, created: 62 },
    { pid: 700, parent: 1, name: 'node.exe', commandLine: 'node C:\\Projects\\game\\node_modules\\vite\\bin\\vite.js --port 5173', priority: 8, created: 70 },
    { pid: 800, parent: 1, name: 'codex.exe', commandLine: 'codex exec', priority: 8, created: 80 },
    { pid: 810, parent: 1, name: 'msedge.exe', commandLine: '"msedge.exe" --headless=new --user-data-dir=C:\\Temp\\edge-cdp-1', priority: 8, created: 81 },
    { pid: 811, parent: 810, name: 'msedge.exe', commandLine: '"msedge.exe" --type=renderer', priority: 8, created: 82 },
    { pid: 820, parent: 1, name: 'msedge.exe', commandLine: '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"', priority: 8, created: 90 },
    { pid: 830, parent: 1, name: 'node.exe', commandLine: 'node someones-other-script.js', priority: 8, created: 91 },
  ]
}

const sorted = chosen => chosen.map(one => one.pid).sort((x, y) => x - y)

test('a level comes from a click or a setting; the levels of before read on: strong is Low, off and gentle are Full', () => {
  assert.deepEqual(['full', 'Low', ' LOW '].map(parseLevel), ['full', 'low', 'low'])
  assert.deepEqual(['off', 'Gentle', ' STRONG '].map(parseLevel), ['full', 'full', 'low'])
  assert.deepEqual(['', 'max', null, 3, undefined].map(parseLevel), [null, null, null, null, null])
})

test('the level is kept in the data folder and read back; without it the setting stands, else Full; an old level reads right', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const file = join(dir, 'data', 'cpu.json')
  assert.equal(await readLevel(file), 'full')
  assert.equal(await readLevel(file, 'low'), 'low')
  assert.equal(await readLevel(file, 'nonsense'), 'full')
  await saveLevel(file, 'low', 1234)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { level: 'low', at: 1234 })
  assert.equal(await readLevel(file, 'full'), 'low')
  await writeFile(file, '{ "level": "strong" }')
  assert.equal(await readLevel(file, 'full'), 'low')
  await writeFile(file, '{ "level": "gentle" }')
  assert.equal(await readLevel(file, 'low'), 'full')
  await writeFile(file, '{ broken')
  assert.equal(await readLevel(file, 'low'), 'low')
})

test('config.json may give the default level (the old names read on), and a wrong one stops the board with one line', () => {
  assert.equal(parseConfig('{}', {}).cpuLimit, 'full')
  assert.equal(parseConfig('{"cpuLimit": "Low"}', {}).cpuLimit, 'low')
  assert.equal(parseConfig('{"cpuLimit": "strong"}', {}).cpuLimit, 'low')
  assert.equal(parseConfig('{"cpuLimit": "gentle"}', {}).cpuLimit, 'full')
  assert.equal(parseConfig('{"cpuLimit": "max"}', {}).cpuLimit, 'full')
  assert.equal(configProblem('{"cpuLimit": "strong"}'), null)
  assert.match(configProblem('{"cpuLimit": "max"}'), /"cpuLimit" must be "full" or "low"/)
})

test('the affinity mask: all cores for Full, the last two for Low', () => {
  assert.equal(affinityMask(24, 'full'), String(0xFFFFFF))
  assert.equal(affinityMask(24, 'low'), String(0xC00000))
  assert.equal(lowCores(24), 2)
  assert.equal(affinityMask(8, 'low'), String(0xC0))
  assert.equal(affinityMask(2, 'low'), '3')
  // One core: Low keeps it.
  assert.equal(affinityMask(1, 'low'), '1')
  assert.equal(lowCores(1), 1)
  // 64 cores: the signed number Windows takes.
  assert.equal(affinityMask(64, 'full'), '-1')
  assert.equal(affinityMask(64, 'low'), String(BigInt.asIntN(64, 0xC000000000000000n)))
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
  assert.deepEqual(sorted(chosen), [200, 201, 202, 203, 300, 301])
  // Parents come before their children.
  const at = pid => chosen.findIndex(one => one.pid === pid)
  assert.ok(at(200) < at(201) && at(201) < at(202) && at(202) < at(203))
  assert.deepEqual(chosenProcesses(machine(), []), [])
  // A session id in the desktop app's name or another program's does not make it a chat.
  assert.deepEqual(chosenProcesses([{ pid: 9, parent: 1, name: 'Claude.exe', commandLine: `x --type=renderer --resume=${A}`, priority: 8, created: 1 }].map(one => ({ ...one, name: 'node.exe' })), [A]), [])
})

test('B735: the board, a vite server, codex and a headless Edge are the project\'s too, with what they started; the person\'s own Edge and other programs are not', () => {
  const list = [...machine(), ...tools()]
  const chosen = chosenProcesses(list, [A, B], { boardPids: [900, 901] })
  assert.deepEqual(sorted(chosen), [200, 201, 202, 203, 300, 301, 700, 800, 810, 811, 900, 901, 902])
  for (const left of [100, 101, 400, 401, 500, 600, 820, 830]) assert.ok(!chosen.some(one => one.pid === left), `process ${left} is not the project's`)
  // The board counts only when its numbers are given; the tools are found by their command lines.
  assert.deepEqual(sorted(chosenProcesses(list, [], { boardPids: [] })), [700, 800, 810, 811])
})

test('the cores counted are the PC\'s, not the ones the board itself may use; the board gives itself Normal and all cores back', () => {
  // The bug of 2026-10-19: the board counted its own cores (availableParallelism), which a limit had halved, and halved
  // them again at every restart of the board.
  assert.equal(logicalCores(), cpus().length)
  assert.ok(logicalCores() >= availableParallelism())
  const server = String(readFileSyncForTest(join(HERE, '..', 'server.mjs')))
  assert.doesNotMatch(server, /cores: availableParallelism\(\)/)
  assert.deepEqual(boardChanges([42, 41], 24), [
    { pid: 42, key: 'board 42', priority: 'Normal', affinity: String(0xFFFFFF) },
    { pid: 41, key: 'board 41', priority: 'Normal', affinity: String(0xFFFFFF) },
  ])
  assert.deepEqual(boardChanges([42, 0, -1, 'x'], 8), [{ pid: 42, key: 'board 42', priority: 'Normal', affinity: String(0xFF) }])
})

test('what to set: Full is Normal on all cores, Low is Idle on the last two in efficiency mode; only what is not at the level; a new child is set once', () => {
  const chosen = chosenProcesses(machine(), [A, B])
  const applied = new Map()
  const low = changesFor(chosen, 'low', applied, 24)
  // Everything once, also process 300 that is BelowNormal already: the board did not set its cores.
  assert.deepEqual(low.changes.map(one => one.pid).sort((x, y) => x - y), [200, 201, 202, 203, 300, 301])
  assert.deepEqual(new Set(low.changes.map(one => `${one.priority} ${one.affinity} ${one.eco}`)), new Set([`Idle ${0xC00000} true`]))
  for (const change of low.changes) applied.set(change.key, 'low')
  // The next look: Windows reports them Idle; a new child of a limited chat inherited Idle, but not the cores or the efficiency mode: it is set once.
  const later = [...machine().map(one => (chosen.some(c => c.pid === one.pid) ? { ...one, priority: 4 } : one)), { pid: 204, parent: 202, name: 'python.exe', commandLine: null, priority: 4, created: 60 }]
  assert.deepEqual(changesFor(chosenProcesses(later, [A, B]), 'low', applied, 24).changes.map(one => one.pid), [204])
  // A process that set itself back to Normal is set again.
  const backToNormal = later.map(one => (one.pid === 202 ? { ...one, priority: 8 } : one))
  assert.deepEqual(changesFor(chosenProcesses(backToNormal, [A, B]), 'low', applied, 24).changes.map(one => one.pid), [202, 204])
  // Full sets everything anew with `all`: Normal, all cores, efficiency mode off.
  const full = changesFor(chosenProcesses(later, [A, B]), 'full', applied, 24, { all: true })
  assert.equal(full.changes.length, 7)
  assert.deepEqual(new Set(full.changes.map(one => `${one.priority} ${one.affinity} ${one.eco}`)), new Set([`Normal ${0xFFFFFF} false`]))
})

test('a process listing in PowerShell\'s JSON, also a single one', () => {
  assert.deepEqual(parseListing('{"pid":4,"parent":0,"name":"System","priority":8,"created":null,"commandLine":null}'), [{ pid: 4, parent: 0, name: 'System', commandLine: null, priority: 8, created: null }])
  assert.equal(parseListing('[{"pid":1},{"name":"no pid"}]').length, 1)
  assert.deepEqual(parseListing(''), [])
})

test('B735: the listing script asks for the command lines of the chats, node, codex and Edge, and is plain PowerShell (no JavaScript placeholder left in it)', () => {
  // The first real run found every command line empty: the placeholder of a template sat in a plain string.
  assert.ok(LIST_SCRIPT.includes("('claude.exe','node.exe','codex.exe','msedge.exe') -contains $_.Name.ToLower()"))
  assert.ok(!LIST_SCRIPT.includes('${'))
})

test('B735: the PowerShell helper gets BelowNormal from the board at once, so a board at Idle is never starved by its own helper', () => {
  // The first real switch back to Full took minutes: the helper inherited Idle and a busy PC never ran it.
  const source = readFileSyncForTest(join(HERE, '..', 'src', 'cpu.mjs'), 'utf8')
  const spawnAt = source.indexOf("spawn('powershell.exe'")
  const lowerAt = source.indexOf('setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)')
  assert.ok(spawnAt > 0 && lowerAt > spawnAt)
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

/** The made-up PC with the project's tools, as the state a fake Windows shows; `settle` makes it report what was set. */
function toolsMachine() {
  const state = new Map([...machine(), ...tools()].map(one => [one.pid, { ...one }]))
  const settle = changes => {
    for (const change of changes) if (state.has(change.pid)) state.get(change.pid).priority = change.priority === 'Idle' ? 4 : 8
  }
  return { state, settle }
}

test('Full from the start gives the board and its keeper Normal and all cores, once, and lists nothing', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { state } = toolsMachine()
  const windows = fakeWindows(() => [...state.values()])
  const limiter = cpuLimiter({ file: join(dir, 'cpu.json'), platform: 'win32', cores: 8, sessions: async () => [A], processes: windows.processes, spare: [901, 900] })
  await limiter.apply()
  await limiter.apply()
  assert.deepEqual(windows.calls.sets, [[
    { pid: 901, key: 'board 901', priority: 'Normal', affinity: String(0xFF) },
    { pid: 900, key: 'board 900', priority: 'Normal', affinity: String(0xFF) },
  ]])
  assert.equal(windows.calls.lists, 0)
})

// The person, 2026-10-30 (the board blank for minutes at Idle while a game ran): "it should not slow the board itself".
test('under Low what the board and its keeper start is limited with the rest, never they themselves; one found below Normal gets Normal and all cores', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { state, settle } = toolsMachine()
  const windows = fakeWindows(() => [...state.values()])
  const make = () => cpuLimiter({ file: join(dir, 'cpu.json'), fallback: 'low', platform: 'win32', cores: 24, sessions: async () => [A, B], processes: windows.processes, spare: [901, 900] })
  const limiter = make()
  await limiter.apply()
  const first = windows.calls.sets.flat()
  assert.deepEqual(sorted(first), [200, 201, 202, 203, 300, 301, 700, 800, 810, 811, 902])
  assert.ok(first.every(one => one.priority === 'Idle' && one.affinity === String(0xC00000) && one.eco === true))
  assert.equal(limiter.view().count, 11)
  settle(first)
  // The board restarts from a chat at Idle (a new limiter, a new process picture): its Idle is undone, Normal on all cores.
  state.get(901).priority = 4
  windows.calls.sets.length = 0
  const again = make()
  await again.apply()
  const board = windows.calls.sets.flat().filter(one => one.pid === 901 || one.pid === 900)
  assert.deepEqual(board.map(one => [one.pid, one.priority, one.affinity]), [[901, 'Normal', String(0xFFFFFF)]])
  assert.ok(windows.calls.sets.flat().filter(one => one.pid !== 901).every(one => one.priority === 'Idle'), 'everything else stays limited')
})

test('B735: a process started under Low is limited on the next refresh; a program not of the project is never touched', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { state, settle } = toolsMachine()
  const windows = fakeWindows(() => [...state.values()])
  const limiter = cpuLimiter({ file: join(dir, 'cpu.json'), fallback: 'low', platform: 'win32', cores: 24, sessions: async () => [A, B], processes: windows.processes, spare: [901, 900] })
  await limiter.apply()
  settle(windows.calls.sets.flat())
  windows.calls.sets.length = 0
  await limiter.apply()
  assert.deepEqual(windows.calls.sets, [], 'nothing new: nothing set')
  // A new vite server of the board and a new child of chat A, both at the Idle priority they inherited.
  state.set(710, { pid: 710, parent: 901, name: 'node.exe', commandLine: 'node vite.js', priority: 4, created: 200 })
  state.set(204, { pid: 204, parent: 202, name: 'python.exe', commandLine: null, priority: 4, created: 201 })
  await limiter.apply()
  assert.deepEqual(windows.calls.sets.flat().map(one => one.pid).sort((x, y) => x - y), [204, 710])
  const touched = new Set(windows.calls.sets.flat().map(one => one.pid))
  for (const left of [100, 101, 400, 401, 500, 600, 820, 830]) assert.ok(!touched.has(left), `process ${left} untouched`)
})

test('the limiter: Full does nothing; Low sets the project; back to Full gives Normal and all cores once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const state = new Map(machine().map(one => [one.pid, one]))
  const windows = fakeWindows(() => [...state.values()])
  const limiter = cpuLimiter({ file: join(dir, 'cpu.json'), platform: 'win32', cores: 24, sessions: async () => [A, B], processes: windows.processes, now: () => 7 })
  // Full from the start: no listing at all.
  await limiter.apply()
  assert.deepEqual([windows.calls.lists, windows.calls.sets.length, limiter.view().level, limiter.view().count], [0, 0, 'full', 0])

  const low = await limiter.set('low')
  assert.deepEqual([low.ok, low.result.level, low.result.count, low.result.lowCores], [true, 'low', 6, 2])
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'cpu.json'), 'utf8')), { level: 'low', at: 7 })
  assert.equal(windows.calls.sets.length, 1)
  assert.ok(windows.calls.sets[0].every(one => one.priority === 'Idle' && one.affinity === String(0xC00000) && ![100, 101, 400, 401, 500, 600].includes(one.pid)))
  // Windows now reports them so: the next refresh lists once and sets nothing.
  for (const change of windows.calls.sets[0]) state.set(change.pid, { ...state.get(change.pid), priority: 4 })
  await limiter.apply()
  assert.deepEqual([windows.calls.lists, windows.calls.sets.length], [2, 1])

  await limiter.set('full')
  assert.equal(windows.calls.sets.length, 2)
  assert.deepEqual(windows.calls.sets[1].map(one => one.pid).sort((x, y) => x - y), [200, 201, 202, 203, 300, 301])
  assert.ok(windows.calls.sets[1].every(one => one.priority === 'Normal' && one.affinity === String(0xFFFFFF) && one.eco === false))
  // Two more passes (a process born while Low was on inherited it), then Full lists nothing any more.
  await limiter.apply()
  await limiter.apply()
  assert.equal(windows.calls.sets.length, 1 + RESTORE_PASSES)
  const lists = windows.calls.lists
  await limiter.apply()
  assert.deepEqual([windows.calls.lists, windows.calls.sets.length, limiter.view().count], [lists, 1 + RESTORE_PASSES, 0])
})

test('B440: the board is set back to Normal again on the next pass when the first call failed or missed one', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const answers = [Promise.reject(new Error('timed out')), Promise.resolve([203]), Promise.resolve([203, 202])]
  answers[0].catch(() => {})
  const sets = []
  const processes = {
    list: async () => machine(),
    set: async changes => {
      sets.push(changes.map(one => one.pid))
      return changes.some(one => one.key.startsWith('board ')) ? answers.shift() : changes.map(one => one.pid)
    },
  }
  const limiter = cpuLimiter({ file: join(dir, 'cpu.json'), platform: 'win32', cores: 8, sessions: async () => [A], processes, spare: [203, 202] })
  const boardSets = () => sets.filter(pids => pids.includes(203)).length
  await limiter.apply()
  assert.equal(boardSets(), 1)
  await limiter.apply() // 202 was missed: again
  assert.equal(boardSets(), 2)
  await limiter.apply() // both taken
  assert.equal(boardSets(), 3)
  await limiter.apply()
  assert.equal(boardSets(), 3)
})

test('B440: a board Windows will not set back is tried each pass but logged once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const sets = []
  const processes = {
    list: async () => machine(),
    set: async changes => {
      sets.push(changes.map(one => one.pid))
      return changes.filter(one => one.pid !== 203).map(one => one.pid) // access denied for the board
    },
  }
  const lines = []
  const limiter = cpuLimiter({ file: join(dir, 'cpu.json'), platform: 'win32', cores: 8, sessions: async () => [A], processes, spare: [203], log: line => lines.push(line) })
  for (let pass = 0; pass < 4; pass += 1) await limiter.apply()
  assert.equal(sets.filter(pids => pids.includes(203)).length, 4)
  assert.equal(lines.length, 1)
})

test('a listing that fails is one line, and the next one clears it; a level is refused when it is none', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const windows = fakeWindows(() => machine())
  const limiter = cpuLimiter({ file: join(dir, 'cpu.json'), fallback: 'low', platform: 'win32', cores: 24, sessions: async () => [A], processes: windows.processes })
  windows.failNext()
  await limiter.apply()
  assert.match(limiter.view().fault, /could not read the list of processes \(Access is denied\)/)
  assert.equal(limiter.view().level, 'low')
  await limiter.apply()
  assert.equal(limiter.view().fault, null)
  assert.equal(limiter.view().count, 4)
  assert.deepEqual(await limiter.set('max'), { ok: false, status: 400, why: 'The level is full or low.' })
})

test('on another platform the control says not available and nothing runs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const windows = fakeWindows(() => machine())
  const limiter = cpuLimiter({ file: join(dir, 'cpu.json'), fallback: 'low', platform: 'linux', cores: 8, sessions: async () => [A], processes: windows.processes })
  await limiter.apply()
  const refused = await limiter.set('low')
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
    req.end('{"level":"low"}')
  })
  const good = { 'X-Board-Token': TOKEN, Origin: `http://${self}`, 'Content-Type': 'application/json' }
  assert.equal((await ask({ ...good, 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  assert.equal((await ask({ ...good, Origin: 'http://evil.example' })).status, 403)
  assert.equal(calls.length, 0)
  const answer = await ask(good)
  assert.deepEqual([answer.status, JSON.parse(answer.text)], [200, { level: 'low' }])
})

test('the head shows CPU for Claude with Full and Low, and what applies', async () => {
  const [script, html] = await Promise.all([readFile(join(HERE, '..', 'public', 'board.js'), 'utf8'), readFile(join(HERE, '..', 'public', 'index.html'), 'utf8')])
  // Beside Pause all (Prepare restart before), one button per level; Gentle is gone.
  assert.match(html, /id="pause-all"[^]*?<div class="cpu" id="cpu"[^]*?data-cpu="full"[^]*?data-cpu="low"/)
  assert.doesNotMatch(html, /data-cpu="(off|gentle|strong)"/)
  assert.match(html, /id="cpu-label">CPU for Claude</)
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// cpu:start'), script.indexOf('// cpu:end'))}\nthis.cpuView = cpuView`, page)
  const cpu = { available: true, level: 'full', count: 0, fault: null, cores: 24, lowCores: 2 }
  assert.equal(page.cpuView(null), null)
  assert.deepEqual([page.cpuView(cpu).level, page.cpuView(cpu).count, page.cpuView(cpu).label], ['full', 'full power', 'CPU for Claude'])
  assert.equal(page.cpuView({ ...cpu, level: 'low', count: 14 }).count, '14 processes on 2 cores, lowest priority: tests and builds run slower')
  assert.equal(page.cpuView({ ...cpu, level: 'low', count: 1 }).count, '1 process on 2 cores, lowest priority: tests and builds run slower')
  // A click lights the new level at once, and the buttons wait for the answer.
  const pending = page.cpuView({ ...cpu, level: 'full' }, 'low')
  assert.deepEqual([pending.level, pending.disabled, pending.count], ['low', true, ''])
  const elsewhere = page.cpuView({ ...cpu, available: false })
  assert.deepEqual([elsewhere.label, elsewhere.disabled], ['CPU for Claude: not available here', true])
  assert.match(page.cpuView({ ...cpu, level: 'low', fault: 'The board could not read the list of processes (x).' }).note, /could not read/)
})
