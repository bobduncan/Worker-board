// S8 of the PC plan (the person, 2026-11-25: "if i dont game, e.g. watch videos, i dont want my pc to lag. using full power"): in
// Full the board puts what the chats started (and the project's tools) on the work cores every 30 s, priority as it is, efficiency
// mode off. A chat's own claude.exe and the board itself keep all cores (F44, F24). Low is as before.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { cpuLimiter, FULL_FENCE_MS, fullChanges, SET_SCRIPT, strandedProcesses } from '../src/cpu.mjs'

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
const bash = { pid: 201, parent: 200, name: 'bash.exe', commandLine: null, priority: NORMAL, created: 21 }
const vitest = { pid: 202, parent: 201, name: 'node.exe', commandLine: 'node vitest run one.test.ts', priority: BELOW, created: 22 }
const vite = { pid: 300, parent: 1, name: 'node.exe', commandLine: 'node node_modules/vite/bin/vite.js --port 5301', priority: NORMAL, created: 30 }
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
      list: async () => { calls.lists += 1; return [...state.values()].map(({ mask: _mask, eco: _eco, ...one }) => ({ ...one })) },
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
        return changes.map(one => one.pid)
      },
    },
  }
}

async function limiterOn(t, windows, { level = 'full', clock, mask = WORK } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-s8-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return cpuLimiter({ file: join(dir, 'cpu.json'), fallback: level, platform: 'win32', cores: 24, sessions: async () => [A], processes: windows.processes, now: () => clock.now, spare: [board.pid], fence: () => mask })
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
  const windows = fake([desktop, chat, bash])
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
  assert.deepEqual(fullChanges(chosen, new Map(), 24, { fenceMask: WORK, isRestore: true }).changes.map(one => [one.pid, one.priority, one.affinity, one.eco]),
    [[chat.pid, 'Normal', ALL, false], [bash.pid, 'Normal', WORK, false], [vitest.pid, 'Normal', WORK, false]])
  const applied = new Map([[`${bash.pid}@${bash.created}`, 'fenced']])
  assert.deepEqual(fullChanges(chosen, applied, 24, { fenceMask: WORK }).changes.map(one => [one.pid, one.priority, one.affinity, one.eco]), [[vitest.pid, null, WORK, false]])
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
  assert.match(server, /if \(heavyMode !== null\) \{[^]*?workMask = masks === null \? null : BigInt\.asIntN\(64, masks\.work\)\.toString\(\)/)
})
