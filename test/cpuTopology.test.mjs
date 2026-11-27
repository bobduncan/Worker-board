// S4 of the PC plan: the core map (which logical processors are the person's, the work's and Low's), the mode file the
// heavy-run queue reads (its writer: opt-in, owner, beat, one write at a time), and who switched the CPU level.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

import { affinityMask, cpuLimiter, levelWho } from '../src/cpu.mjs'
import { heavyModeSetup, hexOf, masksOf, modeFileOf, modeWriter, parseTopology, topologyOf, writesModeOf } from '../src/cpuTopology.mjs'
import { loadConfig } from '../src/config.mjs'

/** This PC (2026-11-26, GetSystemCpuSetInformation): 8 P-cores with two threads each (LP0-15), then 8 E-cores (LP16-23). */
const THIS_PC = '0,0,0,1;0,1,0,1;0,2,2,1;0,3,2,1;0,4,4,1;0,5,4,1;0,6,6,1;0,7,6,1;0,8,8,1;0,9,8,1;0,10,10,1;0,11,10,1;0,12,12,1;0,13,12,1;0,14,14,1;0,15,14,1;0,16,16,0;0,17,17,0;0,18,18,0;0,19,19,0;0,20,20,0;0,21,21,0;0,22,22,0;0,23,23,0;'

/** A CPU of `cores` cores with `threads` each, all of one class. */
const uniform = (cores, threads) => Array.from({ length: cores * threads }, (_, logical) => ({ group: 0, logical, core: Math.floor(logical / threads), efficiency: 0 }))
const temp = async name => mkdtemp(join(tmpdir(), `s4-${name}-`))

test('S4: this PC keeps LP0-3 for the person, LP4-23 for the work, and Low is the limiter\'s own (LP22-23)', () => {
  const masks = masksOf(parseTopology(THIS_PC))
  assert.deepEqual(hexOf(masks), { person: '0x00000F', work: '0xFFFFF0', low: '0xC00000' })
  assert.deepEqual(masks.threads, { person: 4, work: 20, low: 2, all: 24 })
  assert.equal(masks.low, BigInt(affinityMask(24, 'low')))
})

test('S4: a 12-core CPU with two threads per core and no E-cores: the first two cores for the person, Low on the last two threads', () => {
  assert.deepEqual(hexOf(masksOf(uniform(12, 2))), { person: '0x00000F', work: '0xFFFFF0', low: '0xC00000' })
})

test('S4: an 8-thread laptop (4 cores, 2 threads each): 0-3 for the person, 4-7 for the work, Low the last two', () => {
  assert.deepEqual(hexOf(masksOf(uniform(4, 2))), { person: '0x00000F', work: '0x0000F0', low: '0x0000C0' })
})

test('S4: Low is always the limiter\'s last two logical processors, also on a PC whose efficiency cores come first', () => {
  const eFirst = [0, 1, 2, 3].map(logical => ({ group: 0, logical, core: logical, efficiency: 0 }))
    .concat([4, 5, 6, 7, 8, 9, 10, 11].map(logical => ({ group: 0, logical, core: 4 + Math.floor((logical - 4) / 2), efficiency: 1 })))
  const masks = masksOf(eFirst)
  assert.deepEqual(hexOf(masks), { person: '0x0000F0', work: '0x000F0F', low: '0x000C00' })
  assert.equal(masks.low, BigInt(affinityMask(12, 'low')))
})

test('S4: with two or fewer performance cores the person keeps one, so the work is never left the efficiency cores alone', () => {
  const twoP = [0, 1, 2, 3].map(logical => ({ group: 0, logical, core: Math.floor(logical / 2), efficiency: 1 }))
    .concat([4, 5, 6, 7].map(logical => ({ group: 0, logical, core: logical, efficiency: 0 })))
  assert.deepEqual(hexOf(masksOf(twoP)), { person: '0x000003', work: '0x0000FC', low: '0x0000C0' })
  assert.deepEqual(hexOf(masksOf(uniform(2, 2))), { person: '0x000003', work: '0x00000C', low: '0x00000C' })
})

test('S4: no map with one core, more than one group, or a broken read', () => {
  assert.equal(masksOf(uniform(1, 2)), null)
  assert.equal(masksOf([...uniform(4, 2), { group: 1, logical: 0, core: 0, efficiency: 0 }]), null)
  assert.equal(masksOf([]), null)
  assert.equal(masksOf([{ group: 0, logical: 'x' }]), null)
  assert.equal(parseTopology(''), null)
  assert.equal(parseTopology('0,1,x,0;'), null)
})

test('S4: the topology is read once and cached per count; a failed read is kept as no map, never read again; a bad cache is read anew', async () => {
  const folder = await temp('topology')
  try {
    const file = join(folder, 'cpu-topology.json')
    let reads = 0
    const read = async () => { reads += 1; return THIS_PC }
    assert.equal((await topologyOf({ file, logical: 24, platform: 'win32', read })).topology.length, 24)
    assert.equal((await topologyOf({ file, logical: 24, platform: 'win32', read })).topology.length, 24)
    assert.equal(reads, 1)
    const failing = join(folder, 'failing.json')
    const fail = async () => { reads += 1; throw new Error('Add-Type failed') }
    assert.deepEqual(await topologyOf({ file: failing, logical: 24, platform: 'win32', read: fail }), { none: 'the CPU sets could not be read (Add-Type failed)' })
    assert.deepEqual(await topologyOf({ file: failing, logical: 24, platform: 'win32', read: fail }), { none: 'the CPU sets could not be read (Add-Type failed)' })
    assert.equal(reads, 2)
    // Another count of logical processors reads anew; so does a cache whose rows are wrong.
    assert.equal((await topologyOf({ file: failing, logical: 2, platform: 'win32', read: async () => { reads += 1; return '0,0,0,0;0,1,0,0;' } })).topology.length, 2)
    await writeFile(file, JSON.stringify({ logical: 24, topology: [...parseTopology(THIS_PC).slice(1), { group: 0, logical: 'x', core: 0, efficiency: 1 }] }))
    assert.equal((await topologyOf({ file, logical: 24, platform: 'win32', read })).topology.length, 24)
    assert.equal(reads, 4)
    assert.deepEqual(await topologyOf({ file: join(folder, 'none.json'), logical: 24, platform: 'linux', read }), { none: 'not Windows' })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('S4: only a board whose config opts in writes the mode file: never the trial copy, the Test board, a test board, the demo or a gate\'s run', () => {
  const config = { project: 'D:\\boards\\game', heavyModeWriter: true }
  const base = { platform: 'win32', config, isDemo: false, isShowOnly: false, historyFrom: undefined, env: {} }
  assert.equal(writesModeOf(base), true)
  assert.equal(writesModeOf({ ...base, config: { ...config, heavyModeWriter: false } }), false)
  assert.equal(writesModeOf({ ...base, config: { project: config.project } }), false)
  assert.equal(writesModeOf({ ...base, isDemo: true }), false)
  assert.equal(writesModeOf({ ...base, isShowOnly: true }), false)
  assert.equal(writesModeOf({ ...base, historyFrom: 'C:\\other' }), false)
  assert.equal(writesModeOf({ ...base, env: { HEAVY_RUN_HELD: '1' } }), false)
  assert.equal(writesModeOf({ ...base, platform: 'linux' }), false)
  assert.equal(writesModeOf({ ...base, config: { ...config, project: '' } }), false)
})

test('S4: the config keeps heavyModeWriter as a PC key, false unless it says true', async () => {
  const folder = await temp('config')
  try {
    const file = join(folder, 'config.json')
    await writeFile(file, JSON.stringify({ name: 'x', project: folder }))
    assert.equal((await loadConfig(file)).heavyModeWriter, false)
    await writeFile(file, JSON.stringify({ name: 'x', project: folder, heavyModeWriter: true }))
    assert.equal((await loadConfig(file)).heavyModeWriter, true)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('S4: setup gives the PC\'s first board heavyModeWriter once, keeps the file\'s line ends, and leaves the others and a config that says it', () => {
  const here = 'D:\\boards\\game\\worker-board'
  const boards = [{ folder: here }, { folder: 'D:\\boards\\trial\\worker-board' }]
  const text = '{\r\n  "name": "Lava Tactics"\r\n}\r\n'
  const first = heavyModeSetup({ here: 'D:/boards/game/worker-board/', boards, text })
  assert.equal(first.text, '{\r\n  "name": "Lava Tactics",\r\n  "heavyModeWriter": true\r\n}\r\n')
  assert.equal(heavyModeSetup({ here: 'D:\\boards\\trial\\worker-board', boards, text }).text, null)
  assert.equal(heavyModeSetup({ here, boards, text: '{ "heavyModeWriter": false }' }).text, null)
  assert.equal(heavyModeSetup({ here, boards, text: '{ broken' }).text, null)
  assert.equal(heavyModeSetup({ here, boards: [], text }).text, null)
})

const MASKS = masksOf(parseTopology(THIS_PC))
const owner = { pid: 4242, port: 4310, project: 'D:\\boards\\game' }

test('S4: the mode file sits beside the queue\'s lock and says level, masks, threads, since, who, its owner and its beat', async () => {
  const folder = await temp('mode')
  try {
    const lock = join(folder, 'one-heavy-run.lock')
    const file = modeFileOf({ HEAVY_RUN_LOCK: lock })
    assert.equal(file, `${lock}.mode.json`)
    let clock = 1000
    const writer = modeWriter({ file, owner, now: () => clock })
    await writer.level({ level: 'low', since: 900, who: 'the board page' })
    await assert.rejects(readFile(file, 'utf8'), { code: 'ENOENT' }, 'nothing before the map is known')
    await writer.masks(MASKS)
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { level: 'low', masks: { person: '0x00000F', work: '0xFFFFF0', low: '0xC00000' }, threads: { work: 20, low: 2 }, since: 900, who: 'the board page', pid: 4242, port: 4310, project: owner.project, beat: 1000 })
    clock = 6000
    await writer.beat()
    assert.equal(JSON.parse(await readFile(file, 'utf8')).beat, 6000)
    // A clean stop removes it; another board's file is left alone.
    writer.stop()
    await assert.rejects(readFile(file, 'utf8'), { code: 'ENOENT' })
    await writeFile(file, JSON.stringify({ pid: 1, level: 'full' }))
    writer.stop()
    assert.equal(JSON.parse(await readFile(file, 'utf8')).pid, 1)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('S4: one write at a time, always the latest level; a failed write is tried again on the next beat; no map removes the file', async () => {
  const folder = await temp('serial')
  try {
    const file = join(folder, 'one-heavy-run.lock.mode.json')
    const failures = []
    let release
    let slow = new Promise(done => { release = done })
    let failNext = false
    const write = async (path, text) => {
      // Only the start's write is slow: a level set meanwhile must still be what stays.
      const wait = slow
      slow = null
      if (wait) await wait
      if (failNext) { failNext = false; throw new Error('EBUSY') }
      await writeFile(path, text)
    }
    const run = async fn => { try { return await fn() } catch (error) { failures.push(error.message) } }
    const writer = modeWriter({ file, owner, write, run })
    writer.level({ level: 'full', since: 1, who: null })
    const start = writer.masks(MASKS)
    // The level changes while the start's write (of Full) still runs.
    await new Promise(done => setTimeout(done, 50))
    const change = writer.level({ level: 'low', since: 2, who: 'chat Game - Worker 2' })
    await new Promise(done => setTimeout(done, 50))
    release()
    await Promise.all([start, change])
    assert.equal(JSON.parse(await readFile(file, 'utf8')).level, 'low')
    failNext = true
    await writer.level({ level: 'full', since: 3, who: 'the board page' })
    assert.deepEqual(failures, ['EBUSY'])
    assert.equal(JSON.parse(await readFile(file, 'utf8')).level, 'low')
    await writer.beat()
    assert.equal(JSON.parse(await readFile(file, 'utf8')).level, 'full')
    await writer.masks(null)
    await assert.rejects(readFile(file, 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('S4: who switched the level: a chat by name or session, else the board page, else a script by its User-Agent', () => {
  assert.equal(levelWho({ 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' }, { level: 'low', chat: 'Game - Worker 2' }), 'chat Game - Worker 2')
  assert.equal(levelWho({ 'x-board-chat': '1. Lava Tactics board' }, {}), 'chat 1. Lava Tactics board')
  assert.equal(levelWho({}, { session: '080d897d-be67-4b91-ae95-2207ea9e5c9e' }), 'chat session 080d897d-be67-4b91-ae95-2207ea9e5c9e')
  assert.equal(levelWho({ 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' }, { level: 'low' }), 'the board page')
  assert.equal(levelWho({ 'user-agent': 'curl/8.9.1' }, {}), 'a script (curl/8.9.1)')
  assert.equal(levelWho({}, {}), 'a script (no User-Agent)')
  assert.equal(levelWho({ 'user-agent': 'curl/8.9.1' }, { chat: 'x\n<b>' }), 'a script (curl/8.9.1)')
})

test('S4: the limiter tells the level at start and on a change without waiting on it, and keeps who in its file', { timeout: 10_000 }, async () => {
  const folder = await temp('level')
  try {
    const file = join(folder, 'cpu.json')
    await writeFile(file, `${JSON.stringify({ level: 'full', at: 500, who: 'the board page' })}\n`)
    const heard = []
    const processes = { list: async () => [], set: async () => [], masks: async () => new Map() }
    // A writer that never settles must not hold the CPU pass (F24: the first pass gives the board its Normal priority back).
    const cpu = cpuLimiter({ file, platform: 'win32', cores: 24, sessions: async () => [], processes, now: () => 9000, onLevel: one => { heard.push(one); return new Promise(() => {}) }, note: () => 'No core map (x): heavy runs are not fenced.' })
    await cpu.apply()
    assert.deepEqual(heard, [{ level: 'full', since: 500, who: 'the board page' }])
    const done = await cpu.set('low', 'chat Game - Worker 2')
    assert.equal(done.ok, true)
    assert.deepEqual(heard.at(-1), { level: 'low', since: 9000, who: 'chat Game - Worker 2' })
    assert.deepEqual([done.result.since, done.result.who, done.result.coreMap], [9000, 'chat Game - Worker 2', 'No core map (x): heavy runs are not fenced.'])
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { level: 'low', at: 9000, who: 'chat Game - Worker 2' })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('S4: the head\'s CPU line names who set the level and when, with the date when not today; no map is said in its tip', async () => {
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  const page = { Date }
  vm.runInNewContext(`${script.slice(script.indexOf('// cpu:start'), script.indexOf('// cpu:end'))}\nthis.cpuView = cpuView`, page)
  const now = new Date()
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5).getTime()
  const cpu = { available: true, level: 'low', count: 3, fault: null, cores: 24, lowCores: 2, since, who: 'chat Game - Worker 2', coreMap: null }
  assert.equal(page.cpuView(cpu).count, '3 processes on 2 cores, lowest priority: tests and builds run slower · set 09:05 by chat Game - Worker 2')
  assert.equal(page.cpuView({ ...cpu, level: 'full' }).count, 'full power · set 09:05 by chat Game - Worker 2')
  assert.equal(page.cpuView({ ...cpu, level: 'full', since: new Date(2026, 10, 24, 9, 5).getTime() }).count, 'full power · set 24 Nov 09:05 by chat Game - Worker 2')
  assert.equal(page.cpuView(cpu, 'full').count, '')
  assert.equal(page.cpuView({ ...cpu, who: null }).count, '3 processes on 2 cores, lowest priority: tests and builds run slower')
  assert.equal(page.cpuView({ ...cpu, level: 'full', coreMap: 'No core map (x): heavy runs are not fenced.' }).title, 'Claude runs at full power. No core map (x): heavy runs are not fenced.')
})

test('S4: the server wires the writer: opt-in, level without waiting, beat on every CPU pass, stop on exit, who from the call', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /const heavyMode = writesModeOf\(\{ config, isDemo, isShowOnly, historyFrom \}\) \? modeWriter\(/)
  assert.match(server, /onLevel: state => heavyMode\?\.level\(state\)/)
  assert.match(server, /loops\.run\('cpu', \(\) => cpu\.apply\(\)\)\.then\(\(\) => heavyMode\?\.beat\(\)\)/)
  assert.match(server, /process\.on\('exit', \(\) => heavyMode\.stop\(\)\)/)
  assert.match(server, /cpu\(\{ \.\.\.parsed, who: levelWho\(req\.headers, parsed\) \}\)/)
  // The core map is read only by a board that writes the file, and inside the loop that records its failure.
  assert.match(server, /if \(heavyMode !== null\) \{[^]*?loops\.run\('cpu-topology', async \(\) => \{[^]*?masksOf\(found\.topology\)/)
})
