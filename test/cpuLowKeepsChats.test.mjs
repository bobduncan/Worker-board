// F44, the real case (2026-11-21 and 11-23): five chats lost their Workers mod ("Link gone"), all five under "CPU for Claude: Low". At Idle on
// two crowded cores a chat's hooks thread starved (hooks took up to 287 s) and the CLI's watchdog unloaded the mod until the process
// restarted. Under Low a chat's own claude.exe now runs at BelowNormal on all cores (above all Idle work, below a game); what it starts is limited. Back at Full, a test run
// that Low left at Idle on two cores with its parent gone gets its priority and cores back. Made-up processes; Windows is replaced: no
// test here changes a real process.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { chatChanges, chosenProcesses, commandArgs, cpuLimiter, fileTimeOf, isChatProcess, MASK_SCRIPT, orphansOf, parseMasks, saveLevel, sessionOf, strandedCandidates, strandedProcesses } from '../src/cpu.mjs'

const A = 'aaaaaaaa-1111-2222-3333-444444444444'
const CLI = 'C:\\Apps\\claude-code\\2.1.0\\claude.exe --output-format stream-json'
const ALL = String(0xFFFFFF)
const LOW = String(0xC00000)
const IDLE = 4
const BELOW = 6
const NORMAL = 8

const desktop = { pid: 100, parent: 1, name: 'Claude.exe', commandLine: '"C:\\Apps\\Claude\\Claude.exe"', priority: NORMAL, created: 10 }
const chat = (priority = IDLE) => ({ pid: 200, parent: 100, name: 'claude.exe', commandLine: `${CLI} --resume=${A}`, priority, created: 20 })
const bash = (priority = IDLE) => ({ pid: 201, parent: 200, name: 'bash.exe', commandLine: null, priority, created: 21 })
const tests = (priority = IDLE) => ({ pid: 202, parent: 201, name: 'node.exe', commandLine: 'node --test', priority, created: 22 })
const game = { pid: 500, parent: 1, name: 'game.exe', commandLine: null, priority: NORMAL, created: 50 }

/** A fake Windows: `state` the processes, each set reported back as Windows would. */
function fake(list, { masks = new Map(), failSets = 0 } = {}) {
  const state = new Map(list.map(one => [one.pid, { ...one }]))
  const calls = { sets: [], masks: [] }
  let failing = failSets
  return {
    state,
    calls,
    processes: {
      list: async () => [...state.values()].map(one => ({ ...one })),
      masks: async pids => {
        calls.masks.push(pids)
        if (masks instanceof Error) throw masks
        return masks
      },
      set: async changes => {
        calls.sets.push(changes)
        if (failing > 0) {
          failing -= 1
          throw new Error('Access is denied')
        }
        for (const change of changes) if (state.has(change.pid)) state.get(change.pid).priority = { Idle: IDLE, BelowNormal: BELOW, Normal: NORMAL }[change.priority]
        return changes.map(one => one.pid)
      },
    },
  }
}

async function limiterOn(t, windows, { level = 'low', cores = 24, now = Date.now } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-f44-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return cpuLimiter({ file: join(dir, 'cpu.json'), fallback: level, platform: 'win32', cores, sessions: async () => [A], processes: windows.processes, now })
}
const byPid = (sets, pid) => sets.flat().filter(one => one.pid === pid)

test('the real case: a chat Low had put at Idle gets BelowNormal on all cores first; what it started stays limited', async t => {
  const windows = fake([desktop, chat(IDLE), bash(IDLE), tests(IDLE), game])
  const limiter = await limiterOn(t, windows)
  await limiter.apply()
  const [first] = windows.calls.sets
  assert.equal(first[0].pid, 200, 'the chat goes first: a pass cut short must not leave it starved')
  assert.deepEqual([first[0].priority, first[0].affinity, first[0].eco], ['BelowNormal', ALL, false])
  for (const pid of [201, 202]) assert.deepEqual(byPid(windows.calls.sets, pid).map(one => [one.priority, one.affinity, one.eco]), [['Idle', LOW, true]])
  for (const pid of [100, 500]) assert.deepEqual(byPid(windows.calls.sets, pid), [], `process ${pid} is not touched`)
  assert.equal(limiter.view().count, 2, 'the count says what is limited')
  // Windows reports them so: nothing is set again.
  windows.calls.sets.length = 0
  await limiter.apply()
  assert.deepEqual(windows.calls.sets, [])
})

test('a chat at BelowNormal counts as done under Low: no pass rewrites it; one found at another priority is set again', async t => {
  const windows = fake([desktop, chat(NORMAL)])
  const limiter = await limiterOn(t, windows)
  await limiter.apply()
  assert.deepEqual(byPid(windows.calls.sets, 200).map(one => [one.priority, one.affinity]), [['BelowNormal', ALL]], 'a new chat, born at Normal')
  assert.equal(windows.state.get(200).priority, BELOW)
  windows.calls.sets.length = 0
  for (let pass = 0; pass < 3; pass += 1) await limiter.apply()
  assert.deepEqual(windows.calls.sets, [], 'done: three passes write nothing')
  for (const found of [IDLE, NORMAL]) {
    windows.state.get(200).priority = found
    windows.calls.sets.length = 0
    await limiter.apply()
    assert.deepEqual(byPid(windows.calls.sets, 200).map(one => one.priority), ['BelowNormal'], `found at ${found}`)
  }
})

test('a chat the board has not set yet is set once, also at BelowNormal: the listing holds no cores', async t => {
  const windows = fake([desktop, chat(BELOW)])
  const limiter = await limiterOn(t, windows)
  await limiter.apply()
  assert.deepEqual(byPid(windows.calls.sets, 200).map(one => [one.priority, one.affinity, one.eco]), [['BelowNormal', ALL, false]])
})

test('back at Full a chat at BelowNormal gets Normal on all cores', async t => {
  const windows = fake([desktop, chat(BELOW), bash(IDLE)])
  const limiter = await limiterOn(t, windows)
  await limiter.apply()
  assert.equal(windows.state.get(200).priority, BELOW)
  windows.calls.sets.length = 0
  await limiter.set('full')
  assert.deepEqual(byPid(windows.calls.sets, 200).map(one => [one.priority, one.affinity, one.eco]), [['Normal', ALL, false]])
  assert.equal(windows.state.get(200).priority, NORMAL)
  assert.equal(windows.state.get(201).priority, NORMAL)
})

test('a set that failed for a chat is tried again on the next pass, also when its priority already reads right (its cores may not)', async t => {
  const windows = fake([desktop, chat(BELOW)], { failSets: 1 })
  const limiter = await limiterOn(t, windows)
  await limiter.apply()
  await limiter.apply()
  assert.equal(byPid(windows.calls.sets, 200).length, 2)
  windows.calls.sets.length = 0
  await limiter.apply()
  assert.deepEqual(windows.calls.sets, [], 'once it went, it is done')
})

test('a child born at BelowNormal under a chat after Low was set ends up limited on the next pass, with what it started', async t => {
  const windows = fake([desktop, chat(NORMAL)])
  const limiter = await limiterOn(t, windows)
  await limiter.apply()
  windows.calls.sets.length = 0
  windows.state.set(201, bash(BELOW))
  windows.state.set(202, tests(BELOW))
  await limiter.apply()
  for (const pid of [201, 202]) assert.deepEqual(byPid(windows.calls.sets, pid).map(one => [one.priority, one.affinity, one.eco]), [['Idle', LOW, true]])
  assert.deepEqual(byPid(windows.calls.sets, 200), [], 'the chat itself is left as it is')
  assert.equal(windows.state.get(201).priority, IDLE)
  // A child a limited process starts later inherits Idle; it still gets its cores once.
  windows.calls.sets.length = 0
  windows.state.set(203, { pid: 203, parent: 202, name: 'node.exe', commandLine: 'node worker', priority: IDLE, created: 23 })
  await limiter.apply()
  assert.deepEqual(byPid(windows.calls.sets, 203).map(one => one.affinity), [LOW])
  assert.equal(limiter.view().count, 3)
})

test('only a chat\'s own CLI counts as a chat: not the desktop app, not a one-off claude a tool started', () => {
  assert.equal(isChatProcess(chat()), true)
  assert.equal(isChatProcess(desktop), false)
  assert.equal(isChatProcess({ pid: 7, parent: 201, name: 'claude.exe', commandLine: `${CLI} -p "a question"`, priority: NORMAL, created: 30 }), false)
  assert.equal(isChatProcess({ pid: 8, parent: 201, name: 'node.exe', commandLine: `node x --resume=${A}`, priority: NORMAL, created: 30 }), false)
  // A one-off claude started by a tool is limited with the tree.
  const oneOff = { pid: 7, parent: 201, name: 'claude.exe', commandLine: `${CLI} -p "a question"`, priority: NORMAL, created: 30 }
  const found = chosenProcesses([desktop, chat(), bash(), oneOff], [A])
  assert.deepEqual(found.filter(one => !isChatProcess(one)).map(one => one.pid).sort(), [201, 7].sort())
  assert.deepEqual(chatChanges(found.filter(isChatProcess), new Map(), 24).map(one => one.pid), [200])
})

/** After Full: a test run whose starter is gone (300 → 301), the mark on both, and everything that must be left alone. */
const left = [
  desktop,
  game,
  { pid: 300, parent: 299, name: 'node.exe', commandLine: 'node --test', priority: IDLE, created: 30 },
  { pid: 301, parent: 300, name: 'node.exe', commandLine: 'node worker', priority: IDLE, created: 31 },
  // The same mark on what is not the project's programs.
  { pid: 510, parent: 299, name: 'game.exe', commandLine: null, priority: IDLE, created: 32 },
  { pid: 520, parent: 299, name: 'msedge.exe', commandLine: '"msedge.exe"', priority: IDLE, created: 33 },
  { pid: 530, parent: 299, name: 'Claude.exe', commandLine: '"C:\\Apps\\Claude\\Claude.exe"', priority: IDLE, created: 34 },
  // A node at Idle on other cores: somebody else's choice.
  { pid: 540, parent: 299, name: 'node.exe', commandLine: 'node own.js', priority: IDLE, created: 35 },
  // The mark, but its parent runs: a tree the board does not know.
  { pid: 550, parent: 500, name: 'node.exe', commandLine: 'node helper.js', priority: IDLE, created: 60 },
  // Its parent number was given out again to a later process: the parent is gone.
  { pid: 560, parent: 500, name: 'python.exe', commandLine: null, priority: IDLE, created: 40 },
  // On Low's cores, but at Normal: not Low's mark.
  { pid: 570, parent: 299, name: 'node.exe', commandLine: 'node pinned.js', priority: NORMAL, created: 41 },
]
const leftMasks = () => new Map([[300, LOW], [301, LOW], [510, LOW], [520, LOW], [530, LOW], [540, ALL], [550, LOW], [560, LOW], [570, LOW]])

test('the stranded: Low\'s mark, its parent gone, a tool\'s program, with what it started; never a game, a browser, the app or another\'s process', () => {
  assert.deepEqual(strandedCandidates(left, []).map(one => one.pid), [300, 301, 540, 550, 560])
  assert.deepEqual(strandedProcesses(left, leftMasks(), 24).map(one => one.pid), [300, 301, 560])
  assert.deepEqual(strandedProcesses(left, leftMasks(), 24, { chosen: [left[2]] }).map(one => one.pid), [560], 'one already chosen is Full\'s own; its child is reached through it')
  assert.deepEqual(strandedProcesses(left, new Map(), 24), [], 'no reading of the cores: nothing')
  assert.deepEqual(strandedProcesses(left, new Map([[300, '3']]), 2), [], 'on a PC where Low leaves every core there is no mark')
})

test('back at Full the stranded get Normal on all cores; a failed reading of the cores touches none of them and the restore goes on', async t => {
  const windows = fake([chat(IDLE), ...left], { masks: leftMasks() })
  const limiter = await limiterOn(t, windows)
  await limiter.ready()
  await limiter.apply()
  assert.deepEqual(windows.calls.masks, [], 'under Low no cores are read')
  windows.calls.sets.length = 0
  await limiter.set('full')
  for (const pid of [300, 301, 560]) assert.deepEqual(byPid(windows.calls.sets, pid).map(one => [one.priority, one.affinity, one.eco]), [['Normal', ALL, false]])
  for (const pid of [100, 500, 510, 520, 530, 540, 550, 570]) assert.deepEqual(byPid(windows.calls.sets, pid), [], `process ${pid} is not touched`)
  assert.equal(windows.state.get(300).priority, NORMAL)

  const broken = fake([chat(IDLE), ...left], { masks: new Error('Access is denied') })
  const other = await limiterOn(t, broken)
  await other.apply()
  broken.calls.sets.length = 0
  await other.set('full')
  assert.deepEqual(byPid(broken.calls.sets, 300), [])
  assert.ok(byPid(broken.calls.sets, 200).every(one => one.priority === 'Normal') && byPid(broken.calls.sets, 200).length > 0, 'the rest of the restore still runs')
})

test('Full from the start reads no cores and changes nothing', async t => {
  const windows = fake([chat(NORMAL), ...left], { masks: leftMasks() })
  const limiter = await limiterOn(t, windows, { level: 'full' })
  await limiter.apply()
  assert.deepEqual([windows.calls.masks, windows.calls.sets], [[], []])
})

test('the script that reads the cores sets nothing; its answer reads as a list, one process or none', () => {
  assert.doesNotMatch(MASK_SCRIPT, /\$p\.PriorityClass|\$p\.ProcessorAffinity\s*=/)
  assert.deepEqual([...parseMasks('[{"pid":5,"mask":"12582912"},{"pid":6,"mask":"3"}]')], [[5, '12582912'], [6, '3']])
  assert.deepEqual([...parseMasks('{"pid":5,"mask":"12582912"}')], [[5, '12582912']])
  assert.deepEqual([...parseMasks('')], [])
  assert.deepEqual([...parseMasks('[]')], [])
})

/** Low was switched on at T. A chat's starter ended before the next pass: what it started has no parent left. */
const T = new Date(2026, 10, 23, 15, 0).getTime()
const born = ms => fileTimeOf(T + ms)
const loose = (pid, more = {}) => ({ pid, parent: 299, name: 'node.exe', commandLine: 'node vitest', priority: BELOW, created: born(5_000), ...more })
const notOurs = [
  loose(710, { created: born(-60_000) }), // at BelowNormal since before Low: no chat handed it that
  loose(720, { priority: NORMAL }), // a program of the person's starts at Normal
  loose(730, { name: 'game.exe', commandLine: null }),
  loose(740, { name: 'msedge.exe', commandLine: '"msedge.exe"' }),
  loose(750, { name: 'Claude.exe', commandLine: '"C:\\Apps\\Claude\\Claude.exe"' }),
  loose(760, { parent: 500 }), // its parent, a game, still runs
]

test('the real case of the review: what a chat started whose starter ended before the pass is limited, with its children; nothing else is', async t => {
  const windows = fake([desktop, chat(BELOW), game, loose(700), loose(701, { parent: 700, created: born(6_000) }), ...notOurs])
  const limiter = await limiterOn(t, windows, { now: () => T })
  await limiter.apply()
  for (const pid of [700, 701]) assert.deepEqual(byPid(windows.calls.sets, pid).map(one => [one.priority, one.affinity, one.eco]), [['Idle', LOW, true]])
  for (const { pid } of notOurs) assert.deepEqual(byPid(windows.calls.sets, pid), [], `process ${pid} is not touched`)
  assert.equal(limiter.view().count, 2)
  windows.calls.sets.length = 0
  await limiter.apply()
  assert.deepEqual(windows.calls.sets, [], 'once limited it is done')
})

test('the orphan rule: a tool program, exactly BelowNormal, its parent gone, born since Low; a reused parent number is no parent; without a time, none', () => {
  const list = [game, loose(700), ...notOurs, loose(770, { parent: 500, created: 10 })]
  assert.deepEqual(orphansOf(list, [], { since: born(0) }).map(one => one.pid), [700])
  assert.deepEqual(orphansOf([game, loose(780, { parent: 500, name: 'python.exe', created: born(1) })], [], { since: born(0) }).map(one => one.pid), [], 'the game started before it: a living parent')
  assert.deepEqual(orphansOf([{ ...game, created: born(9_000) }, loose(781, { parent: 500 })], [], { since: born(0) }).map(one => one.pid), [781], 'the number was given out again after it started')
  assert.deepEqual(orphansOf(list, [], {}), [])
  assert.deepEqual(orphansOf(list, [loose(700)], { since: born(0) }), [], 'already in a tree')
  assert.deepEqual(orphansOf(list, [], { since: born(0), skip: [700] }), [], 'the board\'s own')
})

test('a board restarted under Low counts from when Low was set, not from its start', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-f44-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const file = join(dir, 'cpu.json')
  await saveLevel(file, 'low', T)
  const windows = fake([desktop, chat(BELOW), loose(700)])
  const limiter = cpuLimiter({ file, platform: 'win32', cores: 24, sessions: async () => [A], processes: windows.processes, now: () => T + 3_600_000 })
  await limiter.apply()
  assert.deepEqual(byPid(windows.calls.sets, 700).map(one => one.priority), ['Idle'])
})

test('back at Full an orphan gets Normal on all cores: one Low limited, and one the pass had not reached yet', async t => {
  const windows = fake([desktop, chat(BELOW), loose(700)])
  const limiter = await limiterOn(t, windows, { now: () => T })
  await limiter.apply()
  assert.equal(windows.state.get(700).priority, IDLE)
  windows.state.set(702, loose(702))
  windows.calls.sets.length = 0
  await limiter.set('full')
  for (const pid of [700, 702]) assert.deepEqual(byPid(windows.calls.sets, pid)[0], { pid, key: `${pid}@${born(5_000)}`, priority: 'Normal', affinity: ALL, eco: false })
  assert.equal(windows.state.get(700).priority, NORMAL)
  assert.equal(windows.state.get(702).priority, NORMAL)
  assert.deepEqual(windows.calls.masks.flat().filter(pid => pid === 700 || pid === 702), [], 'what the board knows needs no reading of its cores')
})

test('Low, Full, Low: a process given back is limited again; the same number on a later process is not', async t => {
  const stranded = { pid: 300, parent: 299, name: 'node.exe', commandLine: 'node --test', priority: IDLE, created: 30 }
  const windows = fake([desktop, chat(BELOW), stranded], { masks: new Map([[300, LOW]]) })
  const limiter = await limiterOn(t, windows, { now: () => T })
  await limiter.apply()
  await limiter.set('full')
  assert.equal(windows.state.get(300).priority, NORMAL)
  windows.calls.sets.length = 0
  await limiter.set('low')
  assert.deepEqual(byPid(windows.calls.sets, 300).map(one => [one.priority, one.affinity, one.eco]), [['Idle', LOW, true]])
  await limiter.set('full')
  windows.state.set(300, { ...stranded, priority: NORMAL, created: 31 })
  windows.calls.sets.length = 0
  await limiter.set('low')
  assert.deepEqual(byPid(windows.calls.sets, 300), [], 'another process with that number')
})

test('a one-off claude and a session flag inside a quoted prompt make no chat', async t => {
  assert.equal(isChatProcess({ name: 'claude.exe', commandLine: `${CLI} --input-format stream-json --resume=${A}` }), true)
  assert.equal(isChatProcess({ name: 'claude.exe', commandLine: `${CLI} -p --resume=${A}` }), false)
  assert.equal(isChatProcess({ name: 'claude.exe', commandLine: `${CLI} --resume ${A} --print` }), false)
  assert.equal(isChatProcess({ name: 'claude.exe', commandLine: `${CLI} --resume=${A} --append-system-prompt "-p is a flag"` }), true, 'a quoted -p is words')
  assert.equal(isChatProcess({ name: 'claude.exe', commandLine: `${CLI} --resume=${A} "-p"` }), true)
  assert.equal(sessionOf(`${CLI} -p "please run --resume ${A} for me"`), null)
  assert.equal(sessionOf(`${CLI} -p "--resume=${A}"`), null)
  assert.equal(sessionOf(`${CLI} -p "a \\" --resume=${A} b"`), null, 'an escaped quote does not end the prompt')
  assert.equal(sessionOf(`"C:\\Program Files\\x\\claude.exe" --resume "${A}"`), A)
  assert.equal(sessionOf(`${CLI} --resume="${A}"`), A)
  assert.equal(sessionOf(`${CLI} --resume`), null)
  assert.deepEqual(commandArgs('a "b c" d\\e "f\\"g" h\\\\"i j"').map(one => one.text), ['a', 'b c', 'd\\e', 'f"g', 'h\\i j'])
  assert.deepEqual(commandArgs('a "b" --c="d e"').map(one => one.quoted), [false, true, false])
  // A one-off naming the chat's session is limited with its tree; the chat is not.
  const oneOff = { pid: 205, parent: 201, name: 'claude.exe', commandLine: `${CLI} -p --resume=${A}`, priority: BELOW, created: 25 }
  const windows = fake([desktop, chat(BELOW), bash(IDLE), oneOff])
  const limiter = await limiterOn(t, windows)
  await limiter.apply()
  assert.deepEqual(byPid(windows.calls.sets, 205).map(one => one.priority), ['Idle'])
  assert.deepEqual(byPid(windows.calls.sets, 200).map(one => one.priority), ['BelowNormal'])
})

test('a click on Low starts the count: what stood at BelowNormal before it is left alone, what is born after it is limited', async t => {
  let clock = T
  const windows = fake([desktop, chat(NORMAL), loose(700, { created: born(-1_000) })])
  const limiter = await limiterOn(t, windows, { level: 'full', now: () => clock })
  await limiter.apply()
  await limiter.set('low')
  assert.deepEqual(byPid(windows.calls.sets, 700), [])
  windows.state.set(701, loose(701))
  clock = T + 10_000
  await limiter.apply()
  assert.deepEqual(byPid(windows.calls.sets, 701).map(one => one.priority), ['Idle'])
  assert.deepEqual(byPid(windows.calls.sets, 700), [])
})
