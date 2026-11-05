// Stability (2026-11-05, task 2): the per-minute record of idle-with-work (data/ready-minutes.jsonl). The fixture is the shape of
// the night of 2026-11-05: Workers 3 and 4 free with a Sonnet ban in their why, B1050 (a Quality Assurance step), B1042, B1046,
// B1048 and B1043 ready, copied as literals from the board's lanes and the work store.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { MINUTES_KEEP_MS, minuteKeeper, minuteOf } from '../src/stability.mjs'
import { parseItem } from '../src/work/item.mjs'

const DAY = 24 * 60 * 60_000
const NOW = new Date(2026, 10, 5, 22, 40).getTime()
const BAN = 'free; gets no sonnet steps: its set failed at 21:12 (the model menu did not answer) until 23:12'

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const sonnet = { Model: ['sonnet · routine work'] }
const step = (id, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'refined', Since: '2026-11-05 21:00', Refined: 'ready', ...more }, { ...sonnet, ...sections })
const items = new Map([
  ['B1050', step('B1050', { Title: 'Quality Assurance: B1021 Fix of X148', Checks: 'B1021', 'Not by': 'Worker 2, Worker 1' }, { Context: ['  Built by: Worker 2, Worker 1'] })],
  ['B1042', step('B1042', { Title: 'Fix of X152: chain-long must find "Tried before:"', Priority: 'fix', Goal: 'G15' })],
  ['B1046', step('B1046', { Title: 'Fix: left/right stairs', Goal: 'G60', 'Fix of': 'B1031' })],
  ['B1048', step('B1048', { Title: 'Fix: Standard map 71 of 75', Goal: 'G60', 'Fix of': 'B1018' })],
  ['B1043', step('B1043', { Title: 'Fix: Judged at play size', Goal: 'G29', 'Fix of': 'B851' })],
])
const entry = (id, more = {}) => ({ id, rank: 1, keptFor: null, keptUntil: null, pinned: null, prefers: null, ...more })
const READY = [entry('B1050', { rank: -1, notBy: ['Worker 2', 'Worker 1'] }), entry('B1042', { rank: 0 }), entry('B1046', { rank: 0 }), entry('B1048', { rank: 0 }), entry('B1043', { rank: 0 })]
const lane = (name, why, more = {}) => ({ name, state: 'free', isMain: false, isLeftover: false, isRunning: true, model: 'claude-sonnet-5-5', handover: { state: 'free', why, step: null, asked: null }, ...more })
const stateOf = ({ lanes = [lane('Worker 3', BAN), lane('Worker 4', BAN)], ready = READY } = {}) => ({ chats: lanes, readyList: { ready, held: [] } })
const IDS = ['B1050', 'B1042', 'B1046', 'B1048', 'B1043']

test('both free workers are banned from Sonnet and every ready step is Sonnet: nothing they could take', () => {
  assert.deepEqual(minuteOf(stateOf(), items, '', NOW), { at: NOW, free: [] })
})

test('without the ban text each free worker could take all five ready steps', () => {
  const state = stateOf({ lanes: [lane('Worker 3', null), lane('Worker 4', 'free')] })
  assert.deepEqual(minuteOf(state, items, '', NOW), { at: NOW, free: [{ chat: 'Worker 3', could: IDS }, { chat: 'Worker 4', could: IDS }] })
})

test('a ban on another family leaves a Sonnet step open; the ban is read from the words "gets no <family> steps"', () => {
  const opusBan = 'free; gets no opus steps: its set failed at 21:12 (x) until 23:12'
  assert.deepEqual(minuteOf(stateOf({ lanes: [lane('Worker 3', opusBan)] }), items, '', NOW).free[0].could, IDS)
})

test('a step kept for another chat is not offered; a step kept for the lane is', () => {
  const kept = READY.map(one => (one.id === 'B1046' ? { ...one, keptFor: 'Worker 4', pinned: 'Worker 4' } : one))
  const done = minuteOf(stateOf({ lanes: [lane('Worker 3', null), lane('Worker 4', null)], ready: kept }), items, '', NOW)
  assert.deepEqual(done.free[0], { chat: 'Worker 3', could: ['B1050', 'B1042', 'B1048', 'B1043'] })
  assert.deepEqual(done.free[1], { chat: 'Worker 4', could: IDS })
})

test('a step with the lane in its notBy is excluded for that lane only', () => {
  const barred = READY.map(one => (one.id === 'B1050' ? { ...one, notBy: ['Worker 3'] } : one))
  const done = minuteOf(stateOf({ lanes: [lane('Worker 3', null), lane('Worker 4', null)], ready: barred }), items, '', NOW)
  assert.deepEqual(done.free[0].could, ['B1042', 'B1046', 'B1048', 'B1043'])
  assert.deepEqual(done.free[1].could, IDS)
})

test('a lane that is not free in the hand-over (working, held), a main chat and a step missing from the store are left out', () => {
  const lanes = [lane('Worker 1', null, { handover: { state: 'working', why: null } }), lane('Worker 2', null, { handover: { state: 'held', why: 'paused' } }), lane('Main', null, { isMain: true }), lane('Worker 5', null, { handover: null }), lane('Worker 3', null)]
  const done = minuteOf(stateOf({ lanes, ready: [...READY, entry('B9999')] }), items, '', NOW)
  assert.deepEqual(done, { at: NOW, free: [{ chat: 'Worker 3', could: IDS }] })
})

test('an empty minute (nothing ready, or no state) writes { at, free: [] }', () => {
  assert.deepEqual(minuteOf(stateOf({ ready: [] }), items, '', NOW), { at: NOW, free: [] })
  assert.deepEqual(minuteOf({}, items, '', NOW), { at: NOW, free: [] })
})

test('the writer appends one line a minute and prunes to 31 days at the first write of a day only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ready-minutes-'))
  try {
    const target = join(dir, 'ready-minutes.jsonl')
    const old = { at: NOW - MINUTES_KEEP_MS - 60_000, free: [] }
    const edge = { at: NOW - MINUTES_KEEP_MS + 60_000, free: [{ chat: 'Worker 3', could: ['B1'] }] }
    const recent = { at: NOW - DAY, free: [] }
    await writeFile(target, [old, edge, recent].map(one => JSON.stringify(one)).join('\n') + '\n')
    let now = NOW
    const keep = minuteKeeper({ file: target, clock: () => now })
    const state = stateOf({ lanes: [lane('Worker 3', null)] })
    await keep(state, items)
    const lines = async () => (await readFile(target, 'utf8')).trim().split('\n').map(one => JSON.parse(one))
    assert.deepEqual(await lines(), [edge, recent, { at: NOW, free: [{ chat: 'Worker 3', could: IDS }] }])
    // The same day: an old line that turns up is left alone (the file is not read again for each minute).
    await writeFile(target, `${JSON.stringify(old)}\n`, { flag: 'a' })
    now = NOW + 60_000
    await keep(stateOf(), items)
    assert.equal((await lines()).length, 5)
    assert.deepEqual((await lines()).at(-1), { at: NOW + 60_000, free: [] })
    // The next day: pruned again; the line that was 31 days less a minute old a day ago has aged out now.
    now = NOW + DAY + 2 * 60_000
    await keep(stateOf(), items)
    assert.deepEqual((await lines()).map(one => one.at), [recent.at, NOW, NOW + 60_000, now])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
