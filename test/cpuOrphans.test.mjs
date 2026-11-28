// F87 (chat 1, 2026-11-28; the person's lag at 17:15 on 2026-11-27): a `find /` that a chat's shell started kept running at Normal on
// every core after the shell ended, so Low did not catch it (no parent in a chat tree, no project tool). Since F87 the limiter remembers
// what it saw under a chat (pid and start time) and keeps it the chat's after its parent dies; a project node run with no parent is the
// project's too. A Git-Bash tool the person started themselves is left alone.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { adoptedOf, chatDescendants, cpuLimiter } from '../src/cpu.mjs'

const A = 'aaaaaaaa-1111-2222-3333-444444444444'
const CLI = 'D:\\Apps\\claude-code\\2.1.0\\claude.exe --output-format stream-json'
const ALL = String(0xFFFFFF)
const WORK = String(0xFFFFF0)
const IDLE = 4
const NORMAL = 8
const NAME = { 4: 'Idle', 6: 'BelowNormal', 8: 'Normal' }
const PROJECT = 'D:\\Projects\\game'

const desktop = { pid: 100, parent: 1, name: 'Claude.exe', commandLine: '"D:\\Apps\\Claude\\Claude.exe"', priority: NORMAL, created: 10 }
const chat = { pid: 200, parent: 100, name: 'claude.exe', commandLine: `${CLI} --resume=${A}`, priority: NORMAL, created: 20 }
const bash = { pid: 201, parent: 200, name: 'bash.exe', commandLine: null, priority: NORMAL, created: 21 }
const find = { pid: 202, parent: 201, name: 'find.exe', commandLine: null, priority: NORMAL, created: 22 }
const findChild = { pid: 203, parent: 202, name: 'grep.exe', commandLine: null, priority: NORMAL, created: 23 }
const board = { pid: 400, parent: 1, name: 'node.exe', commandLine: 'node server.mjs', priority: NORMAL, created: 40 }
// The person's own Git Bash: its terminal is gone too, and it was never under a chat.
const ownFind = { pid: 600, parent: 599, name: 'find.exe', commandLine: null, priority: NORMAL, created: 60 }
const projectNode = { pid: 700, parent: 698, name: 'node.exe', commandLine: 'node D:\\Projects\\game\\worktree-2\\tools\\probe.mjs', priority: NORMAL, created: 70 }
const otherNode = { pid: 701, parent: 698, name: 'node.exe', commandLine: 'node E:\\shop\\serve.mjs', priority: NORMAL, created: 71 }

function fake(list) {
  const state = new Map(list.map(one => [one.pid, { ...one, mask: ALL, eco: false }]))
  return {
    state,
    processes: {
      list: async () => [...state.values()].map(({ mask: _mask, eco: _eco, ...one }) => ({ ...one })),
      masks: async pids => new Map(pids.filter(pid => state.has(pid)).map(pid => [pid, state.get(pid).mask])),
      set: async changes => {
        for (const change of changes) {
          const one = state.get(change.pid)
          if (!one) continue
          if (change.priority) one.priority = { Idle: 4, BelowNormal: 6, Normal: 8 }[change.priority]
          one.mask = change.affinity
          one.eco = change.eco === true
        }
        return changes.filter(one => state.has(one.pid)).map(one => one.pid)
      },
    },
  }
}
async function limiterOn(t, windows, { level, clock, onList } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cpu-f87-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return cpuLimiter({ file: join(dir, 'cpu.json'), fallback: level, platform: 'win32', cores: 24, sessions: async () => [A], processes: windows.processes, now: () => clock.now, spare: [board.pid], fence: () => WORK, project: PROJECT, onList })
}
const view = (windows, pid) => { const one = windows.state.get(pid); return [NAME[one.priority], one.eco] }
const key = one => `${one.pid}@${one.created}`

test('F87: yesterday\'s case: a chat\'s bash starts find, the bash dies, and find (with what it started) is still lowered in Low', async t => {
  const windows = fake([desktop, chat, bash, find, board, ownFind])
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { level: 'low', clock })
  await cpu.apply()
  assert.deepEqual(view(windows, find.pid), ['Idle', true], 'under the chat it is limited as before')
  // The shell ends; find runs on, and starts one more tool. Something (the person, a restore) gave it Normal back.
  windows.state.delete(bash.pid)
  windows.state.set(findChild.pid, { ...findChild, mask: ALL, eco: false })
  Object.assign(windows.state.get(find.pid), { priority: NORMAL, mask: ALL, eco: false })
  await cpu.set('full')
  await cpu.set('low')
  clock.now += 1000
  await cpu.apply()
  assert.deepEqual(view(windows, find.pid), ['Idle', true], 'find stays the chat\'s after its shell died')
  assert.deepEqual(view(windows, findChild.pid), ['Idle', true], 'and what it started comes with it')
  assert.deepEqual(view(windows, ownFind.pid), ['Normal', false], 'a Git-Bash tool that was never under a chat is left alone')
  assert.equal(windows.state.get(ownFind.pid).mask, ALL)
})

test('F87: in Full an orphaned helper a chat started is fenced to the work cores like its siblings; the person\'s own is not', async t => {
  const windows = fake([desktop, chat, bash, find, board, ownFind])
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { level: 'full', clock })
  await cpu.apply()
  assert.equal(windows.state.get(find.pid).mask, WORK)
  windows.state.delete(bash.pid)
  // Low and back: the restore pass gives Normal back and fences it again, though its shell is gone.
  await cpu.set('low')
  clock.now += 31_000
  await cpu.set('full')
  assert.deepEqual([windows.state.get(find.pid).mask, NAME[windows.state.get(find.pid).priority]], [WORK, 'Normal'])
  assert.equal(windows.state.get(ownFind.pid).mask, ALL)
})

test('F87: a number Windows gave out again is another process: a new find on a dead helper\'s pid is not adopted', () => {
  const seen = new Set([key(find)])
  const reused = { ...find, created: 99 }
  assert.deepEqual(adoptedOf([desktop, chat, reused], { seen, project: PROJECT }), [])
  assert.deepEqual(adoptedOf([desktop, chat, find], { seen, project: PROJECT }).map(one => one.pid), [find.pid])
})

test('F87: a node.exe with no parent is adopted when its command line names the project or a worktree, never when it names another folder', () => {
  const pids = adoptedOf([projectNode, otherNode], { project: PROJECT }).map(one => one.pid)
  assert.deepEqual(pids, [projectNode.pid])
  const parent = { pid: 698, parent: 1, name: 'pwsh.exe', commandLine: null, priority: NORMAL, created: 5 }
  assert.deepEqual(adoptedOf([parent, projectNode], { project: PROJECT }), [], 'with its parent alive it is the parent\'s, not an orphan')
})

test('F87: never a chat\'s own process, the board\'s own, or what is in a tree already', () => {
  const seen = new Set([key(chat), key(board), key(find)])
  assert.deepEqual(adoptedOf([desktop, chat, board, find], { seen, inTree: new Set([find.pid]), own: new Set([board.pid]), project: PROJECT }), [])
})

test('F87: chatDescendants names what descends from a chat, not the chat, not the board\'s tree', () => {
  const chosen = [
    { ...chat, key: 'c', parentKey: null },
    { ...bash, key: 'b', parentKey: 'c' },
    { ...find, key: 'f', parentKey: 'b' },
    { ...board, key: 'o', parentKey: null },
    { pid: 401, parent: 400, name: 'powershell.exe', key: 'p', parentKey: 'o' },
  ]
  assert.deepEqual([...chatDescendants(chosen)].sort(), ['b', 'f'])
})

test('F87: the lag recorder hears every listing the limiter makes, with what was found and adopted', async t => {
  const heard = []
  const windows = fake([desktop, chat, bash, find, board])
  const clock = { now: 1_000_000 }
  const cpu = await limiterOn(t, windows, { level: 'low', clock, onList: one => heard.push(one) })
  await cpu.apply()
  assert.equal(heard.length, 1)
  assert.equal(heard[0].level, 'low')
  assert.ok(heard[0].found.some(one => one.pid === find.pid))
  assert.ok(Array.isArray(heard[0].list) && Array.isArray(heard[0].adopted))
})
