// S8 of the PC plan (the person, 2026-11-25: "if i dont game, e.g. watch videos, i dont want my pc to lag. using full power"): in
// Full the board puts what the chats started (and the project's tools) on the work cores every 30 s, priority as it is, efficiency
// mode off. A chat's own claude.exe and the board itself keep all cores (F44, F24). Low is as before.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { cpuLimiter, fenceableKeys, FULL_FENCE_MS, fullChanges, helperMask, inProject, isBoardStart, isHeavyRun, SET_SCRIPT, strandedProcesses } from '../src/cpu.mjs'

const A = 'aaaaaaaa-1111-2222-3333-444444444444'
const CLI = 'D:\\Apps\\claude-code\\2.1.0\\claude.exe --output-format stream-json'
const ALL = String(0xFFFFFF)
const WORK = String(0xFFFFF0)
const LOW = String(0xC00000)
const IDLE = 4
const BELOW = 6
const NORMAL = 8
const NAME = { [IDLE]: 'Idle', [BELOW]: 'BelowNormal', [NORMAL]: 'Normal' }

const desktop = { pid: 100, parent: 1, name: 'Claude.exe', commandLine: '"D:\\Apps\\Claude\\Claude.exe"', priority: NORMAL, created: 10 }
const chat = { pid: 200, parent: 100, name: 'claude.exe', commandLine: `${CLI} --resume=${A}`, priority: NORMAL, created: 20 }
const bash = { pid: 201, parent: 200, name: 'bash.exe', commandLine: null, priority: NORMAL, created: 21, createdText: '133000000000000021' }
const vitest = { pid: 202, parent: 201, name: 'node.exe', commandLine: 'node vitest run one.test.ts', priority: BELOW, created: 22 }
const PROJECT = 'D:\\Projects\\game'
const vite = { pid: 300, parent: 1, name: 'node.exe', commandLine: 'node D:\\Projects\\game\\worktree-3\\node_modules\\vite\\bin\\vite.js --port 5301', priority: NORMAL, created: 30 }
const otherVite = { pid: 301, parent: 1, name: 'node.exe', commandLine: 'node E:\\shop\\node_modules\\vite\\bin\\vite.js', priority: NORMAL, created: 31 }
const board = { pid: 400, parent: 1, name: 'node.exe', commandLine: 'node server.mjs', priority: NORMAL, created: 40 }
const boardChild = { pid: 401, parent: 400, name: 'powershell.exe', commandLine: 'powershell -NoProfile', priority: BELOW, created: 41 }
const game = { pid: 500, parent: 1, name: 'game.exe', commandLine: null, priority: NORMAL, created: 50 }

/** A fake Windows: each process's priority, cores and efficiency mode, set as Windows would. */
function fake(list) {
  const state = new Map(list.map(one => [one.pid, { ...one, mask: ALL, eco: false }]))
  const calls = { sets: [], lists: 0 }
  return {
    state,
    calls,
    processes: {
      list: async () => { calls.lists += 1; if (calls.failLists > 0) { calls.failLists -= 1; throw new Error('Get-CimInstance timed out') } return [...state.values()].map(({ mask: _mask, eco: _eco, ...one }) => ({ ...one })) },
      masks: async pids => new Map(pids.filter(pid => state.has(pid)).map(pid => [pid, state.get(pid).mask])),
      set: async changes => {
        calls.sets.push(changes)
        for (const change of changes) {
          const one = state.get(change.pid)
          if (!one) continue
          if (change.priority) one.priority = { Idle: IDLE, BelowNormal: BELOW, Normal: NORMAL }[change.priority]
          one.mask = change.affinity
          one.eco = change.eco === true
        }
        // Windows reports back only what it set: a process that is gone is not among them.
        return changes.filter(one => state.has(one.pid)).map(one => one.pid)
      },
    },
  }
}

async function limiterOn(t, windows, { level = 'full', clock, mask = WORK } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-s8-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return cpuLimiter({ file: join(dir, 'cpu.json'), fallback: level, platform: 'win32', cores: 24, sessions: async () => [A], processes: windows.processes, now: () => clock.now, spare: [board.pid], fence: () => mask, project: PROJECT })
}
const view = (windows, pid) => { const one = windows.state.get(pid); return [one.mask, NAME[one.priority], one.eco] }

test('S8: Full puts what the chats started and the project\'s tools on the work cores, priority as it is; chats, the board and others keep all cores', async t => {
  const windows = fake([desktop, chat, bash, vitest, vite, board, boardChild, game])
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { clock })
  await cpu.apply()
  assert.deepEqual(view(windows, bash.pid), [WORK, 'Normal', false])
  assert.deepEqual(view(windows, vitest.pid), [WORK, 'BelowNormal', false], 'its priority stays as it was')
  assert.deepEqual(view(windows, vite.pid), [WORK, 'Normal', false])
  assert.deepEqual(view(windows, chat.pid), [ALL, 'Normal', false], 'a chat\'s own claude.exe is never fenced (F44)')
  assert.deepEqual(view(windows, board.pid), [ALL, 'Normal', false], 'the board itself is never fenced (F24)')
  assert.deepEqual(view(windows, game.pid), [ALL, 'Normal', false], 'a program the project did not start is never touched')
  assert.deepEqual(view(windows, desktop.pid), [ALL, 'Normal', false])
  assert.ok(windows.calls.sets.flat().every(change => change.pid !== chat.pid || change.affinity === ALL))
})

test('S8: one pass per 30 s, and each process is set once; a child born later is fenced by the next pass', async t => {
  const windows = fake([desktop, chat, bash, board])
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { clock })
  await cpu.apply()
  const lists = windows.calls.lists
  const sets = windows.calls.sets.length
  windows.state.set(vitest.pid, { ...vitest, mask: ALL, eco: false })
  clock.now += FULL_FENCE_MS - 1
  await cpu.apply()
  assert.equal(windows.calls.lists, lists, 'no listing between two passes')
  assert.deepEqual(view(windows, vitest.pid), [ALL, 'BelowNormal', false], 'up to 30 s on every core (FULL_FENCE_MS)')
  clock.now += 1
  await cpu.apply()
  assert.deepEqual(view(windows, vitest.pid), [WORK, 'BelowNormal', false])
  assert.deepEqual(windows.calls.sets.slice(sets).flat().map(one => one.pid), [vitest.pid], 'only the new one; bash is fenced already')
})

test('S8: without a core map (or on a board that is not the mode writer) Full fences nothing and lists nothing, as before', async t => {
  const windows = fake([desktop, chat, bash, vite])
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { clock, mask: null })
  await cpu.apply()
  clock.now += FULL_FENCE_MS
  await cpu.apply()
  assert.equal(windows.calls.lists, 0)
  assert.deepEqual(view(windows, vite.pid), [ALL, 'Normal', false])
})

test('S8, chat 1\'s case 1: Low then Full gives a helper Low left at Idle its Normal priority and efficiency mode back before it is fenced', async t => {
  const windows = fake([desktop, chat, bash, vitest, vite])
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { clock, level: 'low' })
  await cpu.apply()
  assert.deepEqual(view(windows, vitest.pid), [LOW, 'Idle', true])
  await cpu.set('full')
  assert.deepEqual(view(windows, vitest.pid), [WORK, 'Normal', false])
  assert.deepEqual(view(windows, vite.pid), [WORK, 'Normal', false])
  assert.deepEqual(view(windows, chat.pid), [ALL, 'Normal', false])
  // The restore passes go on; the helper stays Normal on the work cores.
  for (let i = 0; i < 3; i += 1) {
    clock.now += FULL_FENCE_MS
    await cpu.apply()
  }
  assert.deepEqual(view(windows, vitest.pid), [WORK, 'Normal', false])
})

test('S8, chat 1\'s case 2: Full then Low still limits a helper Full fenced (its mark is Full\'s, not Low\'s)', async t => {
  const windows = fake([desktop, chat, bash, vitest])
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { clock })
  await cpu.apply()
  assert.deepEqual(view(windows, vitest.pid), [WORK, 'BelowNormal', false])
  await cpu.set('low')
  assert.deepEqual(view(windows, vitest.pid), [LOW, 'Idle', true])
  assert.deepEqual(view(windows, bash.pid), [LOW, 'Idle', true])
  assert.deepEqual(view(windows, chat.pid), [ALL, 'BelowNormal', false], 'F44: a chat under Low, unchanged')
})

test('S8: a process Full fenced is never taken for one Low left behind (it is not Idle on Low\'s cores)', () => {
  const fenced = { ...vitest, parent: 9999, priority: BELOW }
  const idleOnWork = { ...vitest, pid: 203, parent: 9999, priority: IDLE }
  const masks = new Map([[fenced.pid, WORK], [idleOnWork.pid, WORK]])
  assert.deepEqual(strandedProcesses([fenced, idleOnWork], masks, 24), [])
})

test('S8: fullChanges: a restore gives Normal and efficiency off, the work cores to all but a chat; between restores only cores, only once', () => {
  const chosen = [chat, bash, vitest].map(one => ({ ...one, key: `${one.pid}@${one.created}` }))
  const fenceable = new Set(chosen.slice(1).map(one => one.key))
  assert.deepEqual(fullChanges(chosen, new Map(), 24, { fenceMask: WORK, isRestore: true, fenceable }).changes.map(one => [one.pid, one.priority, one.affinity, one.eco]),
    [[chat.pid, 'Normal', ALL, false], [bash.pid, 'Normal', WORK, false], [vitest.pid, 'Normal', WORK, false]])
  const applied = new Map([[`${bash.pid}@${bash.created}`, 'fenced']])
  assert.deepEqual(fullChanges(chosen, applied, 24, { fenceMask: WORK, fenceable }).changes.map(one => [one.pid, one.priority, one.affinity, one.eco]), [[vitest.pid, null, WORK, false]])
  assert.deepEqual(fullChanges(chosen, new Map(), 24, { fenceMask: null }).changes, [])
  assert.deepEqual(fullChanges(chosen, new Map(), 24, { fenceMask: null, isRestore: true }).changes.map(one => one.affinity), [ALL, ALL, ALL])
})

test('S8: the set script leaves a priority alone when the change names none', () => {
  assert.match(SET_SCRIPT, /if \(\$c\.priority\) \{ \$p\.PriorityClass = \[string\]\$c\.priority \}/)
})

test('S8: the server gives the limiter the work cores of the core map, only on the board that writes the mode file', async () => {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /fence: \(\) => workMask,/)
  assert.match(server, /if \(heavyMode !== null\) \{[^]*?workMask = masks === null \? null : helperMask\(masks\.work, masks\.low\)/)
})

test('S8 review 1: what the board itself started is never fenced, each change names the process\'s start, and the set script skips a PID given out again', async t => {
  const windows = fake([desktop, chat, bash, board, boardChild])
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { clock })
  await cpu.apply()
  assert.deepEqual(view(windows, boardChild.pid), [ALL, 'BelowNormal', false], 'the board\'s own listing PowerShell is left alone')
  const sets = windows.calls.sets.flat()
  assert.ok(sets.every(change => change.pid !== boardChild.pid))
  assert.equal(sets.find(change => change.pid === bash.pid).created, bash.createdText)
  assert.match(SET_SCRIPT, /if \(\$c\.created -and \[math\]::Abs\(\[long\]\$p\.StartTime\.ToFileTimeUtc\(\) - \[long\]\$c\.created\) -gt 10000\) \{ continue \}/)
  // Nothing new to fence: the next passes set nothing at all.
  const before = windows.calls.sets.length
  clock.now += FULL_FENCE_MS
  await cpu.apply()
  assert.equal(windows.calls.sets.length, before)
})

test('S8 review 2: a fence pass leaves an orphan Low left behind alone (that is the restore passes\' work, as before S8)', async t => {
  const orphan = { pid: 700, parent: 9999, name: 'node.exe', commandLine: 'node x.mjs', priority: IDLE, created: 70 }
  const windows = fake([desktop, chat, bash, board, orphan])
  windows.state.get(orphan.pid).mask = LOW
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { clock })
  await cpu.apply()
  assert.deepEqual(view(windows, orphan.pid), [LOW, 'Idle', false])
})

test('S8 review 3: a pass counts from its start, so a failing listing is not tried again for 30 s', async t => {
  const windows = fake([desktop, chat, bash, board])
  windows.calls.failLists = 1
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { clock })
  await cpu.apply()
  clock.now += 10_000
  await cpu.apply()
  assert.equal(windows.calls.lists, 1)
  clock.now += FULL_FENCE_MS
  await cpu.apply()
  assert.equal(windows.calls.lists, 2)
  assert.deepEqual(view(windows, bash.pid), [WORK, 'Normal', false])
})

test('S8 review 4: a heavy run\'s tree (a gate, a check) is left to its own fence; the rest of the chat\'s tree is fenced', async t => {
  const queue = { pid: 210, parent: 201, name: 'node.exe', commandLine: 'node tools/one-at-a-time.mjs test -- node tools/test.mjs', priority: BELOW, created: 23 }
  const gateTests = { pid: 211, parent: 210, name: 'node.exe', commandLine: 'node --test test/startBoard.test.mjs', priority: BELOW, created: 24 }
  const windows = fake([desktop, chat, bash, board, queue, gateTests])
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { clock })
  await cpu.apply()
  assert.deepEqual(view(windows, queue.pid), [ALL, 'BelowNormal', false])
  assert.deepEqual(view(windows, gateTests.pid), [ALL, 'BelowNormal', false])
  assert.deepEqual(view(windows, bash.pid), [WORK, 'Normal', false])
  assert.equal(isHeavyRun(queue), true)
})

test('S8 review 5: a project tool found PC-wide is fenced only when its command line names the project', async t => {
  const windows = fake([desktop, chat, bash, board, vite, otherVite])
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { clock })
  await cpu.apply()
  assert.deepEqual(view(windows, vite.pid), [WORK, 'Normal', false])
  assert.deepEqual(view(windows, otherVite.pid), [ALL, 'Normal', false], 'another program\'s vite')
  assert.equal(inProject('node D:/projects/GAME/x.mjs', PROJECT), true)
  assert.equal(inProject('node D:\\Projects\\game\\x.mjs', PROJECT), true)
  assert.equal(inProject('node D:\\Projects\\gameplay\\x.mjs', PROJECT), false, 'a folder that only starts like the project is another one')
  assert.equal(inProject('"D:\\Projects\\game" --flag', PROJECT), true)
  assert.equal(inProject('node x.mjs', ''), false)
})

test('S8: fenceableKeys leaves out a chat itself, the board\'s children, heavy runs and outside tools, each with what it started', () => {
  const key = one => `${one.pid}@${one.created}`
  const queue = { pid: 210, parent: 201, name: 'node.exe', commandLine: 'node tools/one-at-a-time.mjs x -- y', priority: BELOW, created: 23 }
  const underQueue = { pid: 211, parent: 210, name: 'cmd.exe', commandLine: null, priority: BELOW, created: 24 }
  const chosen = [
    { ...chat, key: key(chat), parentKey: null }, { ...bash, key: key(bash), parentKey: key(chat) },
    { ...queue, key: key(queue), parentKey: key(bash) }, { ...underQueue, key: key(underQueue), parentKey: key(queue) },
    { ...boardChild, key: key(boardChild), parentKey: key(board) }, { ...otherVite, key: key(otherVite), parentKey: null }, { ...vite, key: key(vite), parentKey: null },
  ]
  assert.deepEqual([...fenceableKeys(chosen, { own: new Set([board.pid]), project: PROJECT })], [key(bash), key(vite)])
})

test('S8 (chat 1, F24): Full keeps Low\'s cores free of helpers, and a board a chat starts is never fenced', async t => {
  assert.equal(helperMask(0xFFFFF0n, 0xC00000n), String(0x3FFFF0))
  assert.equal(helperMask(0xC00000n, 0xC00000n), null)
  const HELPERS = String(0x3FFFF0)
  const starter = { pid: 220, parent: 201, name: 'node.exe', commandLine: 'node D:/x/worker-board/start-board.mjs --port 4399', priority: IDLE, created: 25 }
  const newBoard = { pid: 221, parent: 220, name: 'node.exe', commandLine: '"D:\\Apps\\node.exe" D:/x/worker-board/server.mjs --launch-entry', priority: IDLE, created: 26 }
  const boardTool = { pid: 222, parent: 221, name: 'powershell.exe', commandLine: 'powershell -NoProfile', priority: IDLE, created: 27 }
  const windows = fake([desktop, chat, bash, board, starter, newBoard, boardTool, vitest])
  for (const one of [starter, newBoard, boardTool]) windows.state.get(one.pid).mask = LOW
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { clock, mask: HELPERS })
  await cpu.apply()
  assert.deepEqual(view(windows, vitest.pid), [HELPERS, 'BelowNormal', false], 'a helper is off Low\'s cores')
  for (const one of [starter, newBoard, boardTool]) assert.deepEqual(view(windows, one.pid), [LOW, 'Idle', false], `${one.commandLine} is left to raise itself`)
  assert.equal(isBoardStart(newBoard), true)
  assert.equal(isBoardStart({ name: 'node.exe', commandLine: 'node tools/server.mjs.bak' }), false)
})
