// S4 of the PC plan: the core map (which logical processors are the person's, the work's and Low's), the mode file the
// heavy-run queue reads, and who switched the CPU level.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { cpuLimiter, levelWho } from '../src/cpu.mjs'
import { hexOf, masksOf, modeFileOf, parseTopology, topologyOf, writeMode } from '../src/cpuTopology.mjs'

/** This PC (2026-11-26, GetSystemCpuSetInformation): 8 P-cores with two threads each (LP0-15), then 8 E-cores (LP16-23). */
const THIS_PC = '0,0,0,1;0,1,0,1;0,2,2,1;0,3,2,1;0,4,4,1;0,5,4,1;0,6,6,1;0,7,6,1;0,8,8,1;0,9,8,1;0,10,10,1;0,11,10,1;0,12,12,1;0,13,12,1;0,14,14,1;0,15,14,1;0,16,16,0;0,17,17,0;0,18,18,0;0,19,19,0;0,20,20,0;0,21,21,0;0,22,22,0;0,23,23,0;'

/** A CPU of `cores` cores with `threads` each, all of one class. */
const uniform = (cores, threads) => Array.from({ length: cores * threads }, (_, logical) => ({ group: 0, logical, core: Math.floor(logical / threads), efficiency: 0 }))

test('S4: this PC keeps LP0-3 for the person, LP4-23 for the work and LP22-23 for Low', () => {
  const masks = masksOf(parseTopology(THIS_PC))
  assert.deepEqual(hexOf(masks), { person: '0x00000F', work: '0xFFFFF0', low: '0xC00000' })
  assert.deepEqual(masks.threads, { person: 4, work: 20, low: 2, all: 24 })
})

test('S4: a 12-core CPU with two threads per core and no E-cores: the first two cores for the person, Low on the last two threads', () => {
  const masks = masksOf(uniform(12, 2))
  assert.deepEqual(hexOf(masks), { person: '0x00000F', work: '0xFFFFF0', low: '0xC00000' })
})

test('S4: an 8-thread laptop (4 cores, 2 threads each): 0-3 for the person, 4-7 for the work, Low the last two', () => {
  const masks = masksOf(uniform(4, 2))
  assert.deepEqual(hexOf(masks), { person: '0x00000F', work: '0x0000F0', low: '0x0000C0' })
})

test('S4: a PC with no room beside the person (2 cores) has no map; nor one with more than one group or a broken read', () => {
  assert.equal(masksOf(uniform(2, 2)), null)
  assert.equal(masksOf([...uniform(4, 2), { group: 1, logical: 0, core: 0, efficiency: 0 }]), null)
  assert.equal(masksOf([]), null)
  assert.equal(parseTopology(''), null)
  assert.equal(parseTopology('0,1,x,0;'), null)
})

test('S4: the topology is read once and cached; not on a PC that is not Windows; a failed read throws for the loop', async () => {
  const folder = await mkdtemp(join(tmpdir(), 's4-topology-'))
  try {
    const file = join(folder, 'cpu-topology.json')
    let reads = 0
    const read = async () => { reads += 1; return THIS_PC }
    assert.equal((await topologyOf({ file, logical: 24, platform: 'win32', read })).length, 24)
    assert.equal((await topologyOf({ file, logical: 24, platform: 'win32', read })).length, 24)
    assert.equal(reads, 1)
    // A PC with another count of logical processors reads anew.
    await topologyOf({ file, logical: 16, platform: 'win32', read: async () => { reads += 1; return '0,0,0,0;0,1,0,0;'.repeat(1) } }).catch(() => {})
    assert.equal(reads, 2)
    assert.equal(await topologyOf({ file: join(folder, 'none.json'), logical: 24, platform: 'linux', read }), null)
    await assert.rejects(topologyOf({ file: join(folder, 'empty.json'), logical: 24, platform: 'win32', read: async () => '' }))
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('S4: the mode file sits beside the queue\'s lock, says level, masks, threads, since and who; no map removes it', async () => {
  const folder = await mkdtemp(join(tmpdir(), 's4-mode-'))
  try {
    const lock = join(folder, 'one-heavy-run.lock')
    const file = modeFileOf({ HEAVY_RUN_LOCK: lock })
    assert.equal(file, `${lock}.mode.json`)
    const masks = masksOf(parseTopology(THIS_PC))
    await writeMode(file, { level: 'low', masks, since: 1000, who: 'the board page' })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { level: 'low', masks: { person: '0x00000F', work: '0xFFFFF0', low: '0xC00000' }, threads: { work: 20, low: 2 }, since: 1000, who: 'the board page' })
    await writeMode(file, { level: 'full', masks: null, since: 2000, who: null })
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
  // A name with line breaks or markup is no name.
  assert.equal(levelWho({ 'user-agent': 'curl/8.9.1' }, { chat: 'x\n<b>' }), 'a script (curl/8.9.1)')
})

test('S4: the limiter tells the level at start and on a change, with since and who, and keeps who in its file', async () => {
  const folder = await mkdtemp(join(tmpdir(), 's4-level-'))
  try {
    const file = join(folder, 'cpu.json')
    await writeFile(file, `${JSON.stringify({ level: 'full', at: 500, who: 'the board page' })}\n`)
    const heard = []
    const processes = { list: async () => [], set: async () => [], masks: async () => new Map() }
    const cpu = cpuLimiter({ file, platform: 'win32', cores: 24, sessions: async () => [], processes, now: () => 9000, onLevel: async one => { heard.push(one) } })
    await cpu.apply()
    assert.deepEqual(heard, [{ level: 'full', since: 500, who: 'the board page' }])
    const done = await cpu.set('low', 'chat Game - Worker 2')
    assert.equal(done.ok, true)
    assert.deepEqual(heard.at(-1), { level: 'low', since: 9000, who: 'chat Game - Worker 2' })
    assert.deepEqual([done.result.since, done.result.who], [9000, 'chat Game - Worker 2'])
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { level: 'low', at: 9000, who: 'chat Game - Worker 2' })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('S4: the head\'s CPU line names who set the level and when; not while a click waits, nor before the board knows', async () => {
  const vm = await import('node:vm')
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// cpu:start'), script.indexOf('// cpu:end'))}\nthis.cpuView = cpuView`, page)
  const since = new Date(2026, 10, 26, 9, 5).getTime()
  const cpu = { available: true, level: 'low', count: 3, fault: null, cores: 24, lowCores: 2, since, who: 'chat Game - Worker 2' }
  assert.equal(page.cpuView(cpu).count, '3 processes on 2 cores, lowest priority: tests and builds run slower · set 09:05 by chat Game - Worker 2')
  assert.equal(page.cpuView({ ...cpu, level: 'full' }).count, 'full power · set 09:05 by chat Game - Worker 2')
  assert.equal(page.cpuView(cpu, 'full').count, '')
  assert.equal(page.cpuView({ ...cpu, who: null }).count, '3 processes on 2 cores, lowest priority: tests and builds run slower')
})

test('S4: only the person\'s board writes the mode file: never a trial copy, a test board in a gate, the demo or another\'s history', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const line = server.split('\n').find(one => one.includes('const writesMode ='))
  assert.ok(line, 'server.mjs says when the board writes the mode file')
  for (const part of ["process.platform === 'win32'", '!isDemo', '!isShowOnly', 'historyFrom === undefined', "process.env.HEAVY_RUN_HELD !== '1'"]) assert.ok(line.includes(part), part)
  assert.match(server, /onLevel: heardLevel/)
  assert.match(server, /cpu\(\{ \.\.\.parsed, who: levelWho\(req\.headers, parsed\) \}\)/)
})

test('S4: Low takes efficiency-core threads even where they are not the last logical processors', () => {
  const eFirst = [0, 1, 2, 3].map(logical => ({ group: 0, logical, core: logical, efficiency: 0 }))
    .concat([4, 5, 6, 7, 8, 9, 10, 11].map(logical => ({ group: 0, logical, core: 4 + Math.floor((logical - 4) / 2), efficiency: 1 })))
  assert.deepEqual(hexOf(masksOf(eFirst)), { person: '0x0000F0', work: '0x000F0F', low: '0x00000C' })
})
