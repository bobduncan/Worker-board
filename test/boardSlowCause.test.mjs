// B1535 (X93): the rule board-slow names the cause of the slow calls (callTrace.mjs `slowCause`), so a full PC and a busy board read
// apart: where they waited, the board's own CPU over their time, the loop's longest hold, the PC's CPU and its busiest programs then,
// and where the state is built. The live case: the slow work calls of 2026-11-25 19:50 to 19:55 as the board's trace kept them.

import assert from 'node:assert/strict'
import test from 'node:test'

import { busiestOf, pcTop, slowCause } from '../src/callTrace.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'

/** The trace's lines of 19:50 to 19:55 (the session part of each request id left out). */
const LIVE = [
  { request: 's-1795632601376-120', attempt: 1, sent: 1795632601376, arrived: 1795632601388, action: 'turn-ended', chat: 'Worker 2', marks: { lock: 0, body: 0, known: 0, begin: 0, fresh: 0, ctx: 0, action: 2189, decide: 28039, handout: 28040, answered: 28041 }, total: 28053, beforeBoard: 12, loopMax: 14250, cpuMax: 97, boardCpuMs: 13327 },
  { request: 's-1795632871164-26', attempt: 1, sent: 1795632871164, arrived: 1795632871167, action: 'next', chat: 'Main', marks: { lock: 0, body: 0, known: 0, begin: 0, fresh: 0, ctx: 8971, action: 11146, answered: 11146 }, total: 11149, beforeBoard: 3, loopMax: 2601, cpuMax: 99, boardCpuMs: 7047 },
  { request: 's-1795632900220-28', attempt: 1, sent: 1795632900220, arrived: 1795632908203, action: 'turn-ended', chat: 'Main', marks: { lock: 264, body: 264, known: 265, begin: 265, fresh: 265, ctx: 265, action: 701, answered: 701 }, total: 8684, beforeBoard: 7983, loopMax: 14306, cpuMax: 100, boardCpuMs: 874 },
  { request: 's-1795632884145-165', attempt: 1, sent: 1795632884145, arrived: 1795632884920, action: 'turn-ended', chat: 'Worker 5', marks: { lock: 812, body: 812, known: 812, begin: 812, fresh: 812, ctx: 812, action: 2294, answered: 29349 }, total: 30124, beforeBoard: 775, loopMax: 14306, cpuMax: 100, boardCpuMs: 11516 },
  { request: 's-1795632871164-26', attempt: 2, sent: 1795632871164, arrived: 1795632885689, action: 'next', chat: 'Main', marks: { lock: 43, body: 43, known: 43, begin: 43, fresh: 43, ctx: 27362, action: 29070, answered: 29071 }, total: 43596, beforeBoard: 14525, loopMax: 14306, cpuMax: 100, boardCpuMs: 12782 },
  { request: 's-1795632871164-26', attempt: 3, sent: 1795632871164, arrived: 1795632908202, action: 'next', chat: 'Main', marks: { lock: 265, body: 265, known: 266, begin: 266, fresh: 266, ctx: 9679, action: 11722, answered: 11741 }, total: 48779, beforeBoard: 37038, loopMax: 14306, cpuMax: 100, boardCpuMs: 14843 },
  { request: 's-1795632871164-26', attempt: 4, sent: 1795632871164, arrived: 1795632910258, action: 'next', chat: 'Main', marks: { lock: 9, body: 9, known: 9, begin: 9, fresh: 9, ctx: 7624, action: 9811, answered: 9836 }, total: 48930, beforeBoard: 39094, loopMax: 14306, cpuMax: 100, boardCpuMs: 13609 },
  { request: 's-1795632924311-167', attempt: 1, sent: 1795632924311, arrived: 1795632924313, action: 'turn-ended', chat: 'Worker 5', marks: { lock: 0, body: 0, known: 0, begin: 0, fresh: 0, ctx: 0, action: 856, decide: 7686, handout: 7702, answered: 7703 }, total: 7705, beforeBoard: 2, loopMax: 1390, cpuMax: 100, boardCpuMs: 10750 },
  // A quick call beside them counts for nothing.
  { request: 's-1795632930000-1', attempt: 1, sent: 1795632930000, arrived: 1795632930010, action: 'note', chat: 'Worker 1', marks: { lock: 0, answered: 120 }, total: 130, beforeBoard: 10, loopMax: 0, cpuMax: 60, boardCpuMs: 90 },
]
const AT = 1795632940000
const pad = n => String(n).padStart(2, '0')
const clock = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }

test('the cause of the slow calls of 19:50 to 19:55: where they waited, the board\'s CPU, the loop, the PC', () => {
  const pc = { at: 1795632905000, top: [{ name: 'msedge.exe', cores: 6.1 }, { name: 'node.exe', cores: 2.3 }] }
  const cause = slowCause(LIVE, { from: AT - 10 * 60_000, pc })
  // One per request (its last arrival): the five calls the chats waited on.
  assert.equal(cause.calls, 5)
  assert.equal(cause.from, 1795632601388)
  assert.deepEqual(cause.parts.map(([part]) => part), ['beforeBoard', 'decide', 'answered', 'ctx'])
  assert.equal(cause.parts.reduce((a, [, pct]) => a + pct, 0) <= 100, true)
  // The board's own CPU over the calls' time: 52 s of 123 s, the board computed part of it.
  assert.equal(cause.boardShare, Math.round(((13327 + 874 + 11516 + 13609 + 10750) / (28053 + 8684 + 30124 + 48930 + 7705)) * 100))
  assert.deepEqual([cause.cpuMax, cause.loopMax], [100, 14306])
  assert.deepEqual(cause.pc, pc)
  // A reading of the PC long before the slow calls is not theirs.
  assert.equal(slowCause(LIVE, { from: AT - 10 * 60_000, pc: { at: 1795632601388 - 5 * 60_000, top: pc.top } }).pc, null)
  // No slow call, no cause.
  assert.equal(slowCause(LIVE.slice(-1)), null)
})

test('board-slow cites the cause: a full PC and a busy board read apart, and the state build\'s way', () => {
  const pc = { at: 1795632905000, top: [{ name: 'msedge.exe', cores: 6.1 }, { name: 'node.exe', cores: 2.3 }] }
  const cause = { ...slowCause(LIVE, { from: AT - 10 * 60_000, pc }), build: 'thread' }
  const state = { lateCalls: [{ at: 1795632920000, ms: 48_930 }, { at: 1795632914000, ms: 30_124 }], slowCause: cause }
  const rule = WATCH_RULES.find(one => one.id === 'board-slow')
  const found = rule.check(buildView({ state, items: new Map(), now: AT }), { seen: new Map(), observed: [] })
  assert.equal(found.length, 1)
  const words = found[0].evidence.split('. ').find(part => part.startsWith('cause: '))
  assert.equal(words, `cause: 5 slow calls since ${clock(1795632601388)} waited in before the board took it ${cause.parts[0][1]}%, the hand-over's decide ${cause.parts[1][1]}%, the answer ${cause.parts[2][1]}%, the state it read ${cause.parts[3][1]}%`
    + `; the board's own CPU was ${cause.boardShare}% of their time (the board computed part of it); the loop held up to 14.3 s; the PC's CPU up to 100%`
    + `; busiest at ${clock(1795632905000)}: msedge.exe 6.1 cores, node.exe 2.3 cores; the state is built in its thread`)
  // The same calls with the board idle beside them read as the PC's, and a board whose thread is off says so.
  const waited = { ...cause, boardShare: 12, build: 'loop' }
  const other = rule.check(buildView({ state: { ...state, slowCause: waited }, items: new Map(), now: AT }), { seen: new Map(), observed: [] })[0].evidence
  assert.match(other, /the board's own CPU was 12% of their time \(the board waited for the PC or the disk\)/)
  assert.match(other, /the state is built in the loop \(its thread is off\)$/)
  // Without a cause the evidence is as before.
  const before = rule.check(buildView({ state: { lateCalls: state.lateCalls }, items: new Map(), now: AT }), { seen: new Map(), observed: [] })[0].evidence
  assert.ok(!before.includes('cause:'), before)
})

test('the PC\'s busiest programs: two listings 3 s apart, by name, in cores; looked up at most every 2 min', async () => {
  const before = [{ pid: 1, name: 'msedge.exe', cpuMs: 1000, created: 5 }, { pid: 2, name: 'msedge.exe', cpuMs: 0, created: 5 }, { pid: 3, name: 'node.exe', cpuMs: 500, created: 5 }, { pid: 4, name: 'idle.exe', cpuMs: 0, created: 5 }]
  const after = [{ pid: 1, name: 'msedge.exe', cpuMs: 10_000, created: 5 }, { pid: 2, name: 'msedge.exe', cpuMs: 9_300, created: 5 }, { pid: 3, name: 'node.exe', cpuMs: 7_400, created: 5 }, { pid: 4, name: 'idle.exe', cpuMs: 100, created: 5 }, { pid: 9, name: 'new.exe', cpuMs: 9_000, created: 6 }]
  assert.deepEqual(busiestOf(before, after, 3000), [{ name: 'msedge.exe', cores: 6.1 }, { name: 'node.exe', cores: 2.3 }])
  let now = 0
  let lists = 0
  const keeper = pcTop({ list: async () => (++lists % 2 === 1 ? before : after), now: () => now, wait: async () => {} })
  await keeper.look()
  assert.deepEqual(keeper.latest(), { at: 0, top: [{ name: 'msedge.exe', cores: 6.1 }, { name: 'node.exe', cores: 2.3 }] })
  now = 60_000
  await keeper.look()
  assert.equal(lists, 2)
  now = 121_000
  await keeper.look()
  assert.equal(lists, 4)
  assert.equal(pcTop({ list: null }).latest(), null)
})
