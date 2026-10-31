// Signals change 1 (2026-10-31), the board's part: why it ended (data/stop.json), the gap line that says why it was off, and
// the `board` part of /api/state. Pure helpers and a store on a temporary folder; made-up times only.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { LAST_STOP_SHOWN_MS, boardView, exitAt, lastStopOf, leavingNoticeMs, parseStop, stopWhy, takeStop, writeStop } from '../src/boardSelf.mjs'
import { GAP_MS, gapsOf, startGap } from '../src/history.mjs'
import { START_ANEW } from '../src/keeper.mjs'
import { fileStore, tick } from '../src/store.mjs'

const MIN = 60_000
const lines = [{ at: 10 * MIN, chat: 'Units', state: 'working', task: null }]

test('stopWhy: each way the board ends has its word', () => {
  assert.equal(stopWhy({ code: START_ANEW }), 'restart', 'ended for a new version')
  assert.equal(stopWhy({ code: 0 }), 'stopped', 'SIGINT, SIGTERM, SIGHUP, the keeper\'s disconnect and a plain exit all end with code 0')
  assert.equal(stopWhy({ code: 1 }), 'crash', 'an uncaught error')
  assert.equal(stopWhy({ code: 7 }), 'crash', 'any other code')
  assert.equal(stopWhy({ code: undefined }), 'crash', 'no code at all')
})

test('startGap: the stop record\'s why is taken when its time lies inside the gap, else unknown', () => {
  assert.deepEqual(startGap(lines, 12 * MIN, 60 * MIN, { at: 13 * MIN, why: 'restart' }), { at: 12 * MIN, gap: true, why: 'restart' })
  assert.deepEqual(startGap(lines, 12 * MIN, 60 * MIN, { at: 12 * MIN, why: 'crash' }), { at: 12 * MIN, gap: true, why: 'crash' }, 'at the start of the gap is inside it')
  assert.deepEqual(startGap(lines, 12 * MIN, 60 * MIN, { at: 60 * MIN, why: 'stopped' }), { at: 12 * MIN, gap: true, why: 'stopped' }, 'at the end of the gap is inside it')
  assert.equal(startGap(lines, 12 * MIN, 60 * MIN, { at: 11 * MIN, why: 'restart' }).why, 'unknown', 'a stop before the gap is an old one')
  assert.equal(startGap(lines, 12 * MIN, 60 * MIN, { at: 61 * MIN, why: 'restart' }).why, 'unknown', 'a stop after now cannot be')
  assert.equal(startGap(lines, 12 * MIN, 60 * MIN, null).why, 'unknown', 'no record: the PC slept, the board was killed, or the power went')
  assert.equal(startGap(lines, 12 * MIN, 60 * MIN).why, 'unknown')
  assert.equal(startGap(lines, 59 * MIN, 60 * MIN, { at: 59.5 * MIN, why: 'restart' }), null, 'no gap, no line')
})

test('startGap: the board ran again after a gap line and went off a second time (the live shape): a new gap line from when it was last alive', () => {
  const quiet = [{ at: 5 * MIN, chat: 'Units', state: 'free', task: null }, { at: 45 * MIN, gap: true, why: 'restart' }]
  // The last line is a gap at 0:45; the board ran until 3:03 and is back at 3:07 (quiet chats wrote no line since).
  assert.deepEqual(startGap(quiet, 183 * MIN, 187 * MIN, { at: 184 * MIN, why: 'stopped' }), { at: 183 * MIN, gap: true, why: 'stopped' })
  assert.deepEqual(startGap(quiet, 183 * MIN, 187 * MIN), { at: 183 * MIN, gap: true, why: 'unknown' })
  // The board was not alive after that gap line: no gap after a gap, as before.
  assert.equal(startGap(quiet, 45 * MIN, 187 * MIN), null, 'alive at the gap line itself is not newer')
  assert.equal(startGap(quiet, 30 * MIN, 187 * MIN), null, 'older than the gap line')
  assert.equal(startGap(quiet, null, 187 * MIN), null, 'no alive time')
  assert.equal(startGap(quiet, 185 * MIN, 187 * MIN), null, 'newer, but not off for longer than GAP_MS')
})

test('gapsOf: two gap lines in a row are two spells, and a gap still open after the last one is not counted twice', () => {
  const twice = [{ at: 5 * MIN, chat: 'Units', state: 'free', task: null }, { at: 45 * MIN, gap: true, why: 'restart' }, { at: 183 * MIN, gap: true, why: 'unknown' }]
  assert.deepEqual(gapsOf(twice, 190 * MIN), [{ from: 45 * MIN, to: 183 * MIN }, { from: 183 * MIN, to: 190 * MIN }])
  // The read after a wake, before the tick wrote the line: the open gap comes from alive.json; the earlier gap line ends where it begins.
  const once = twice.slice(0, 2)
  const open = gapsOf(once, 190 * MIN, 183 * MIN)
  assert.deepEqual(open, [{ from: 45 * MIN, to: 183 * MIN }, { from: 183 * MIN, to: 190 * MIN }])
  assert.equal(open.reduce((sum, gap) => sum + gap.to - gap.from, 0), 145 * MIN, 'every minute counted once')
})

test('fileStore and tick: the second outage of a board whose chats write no lines is written, and the state tells it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'board-twice-'))
  try {
    const chats = [{ name: 'Units', state: 'working', task: null }]
    const first = await fileStore(dir, 0)
    await tick(first, { chats }, 10 * MIN)
    writeStop(join(dir, 'stop.json'), { at: 11 * MIN, why: 'restart' })
    const second = await fileStore(dir, 40 * MIN)
    assert.equal(second.startedGap.why, 'restart')
    // No chat writes a line (the trial board, a quiet night): the loop keeps the board alive and nothing else.
    for (const at of [41, 42, 43, 44, 45]) await tick(second, { chats: [] }, at * MIN)
    assert.deepEqual(second.lines().filter(line => line.gap === true).length, 1)

    // The second outage: the last line is a gap line, and still the start writes one and the state has its lastStop.
    writeStop(join(dir, 'stop.json'), { at: 46 * MIN, why: 'restart' })
    const third = await fileStore(dir, 90 * MIN)
    assert.deepEqual(third.startedGap, { at: 45 * MIN, gap: true, why: 'restart' })
    assert.deepEqual(lastStopOf(third.startedGap, 90 * MIN), { from: 45 * MIN, to: 90 * MIN, why: 'restart' })
    assert.deepEqual(third.lines().filter(line => line.gap === true).map(line => line.at), [10 * MIN, 45 * MIN])
    assert.equal((await readFile(join(dir, 'history.jsonl'), 'utf8')).split(String.fromCharCode(10)).filter(line => line.includes('"gap":true')).length, 2)

    // A sleep in the middle of a run after a gap line is written by the tick, too.
    await tick(third, { chats: [] }, 91 * MIN)
    await tick(third, { chats: [] }, 120 * MIN)
    assert.deepEqual(third.lines().filter(line => line.gap === true).map(line => line.at), [10 * MIN, 45 * MIN, 91 * MIN])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('exitAt: the board keeps answering "leaving" for one refresh and a second, in parallel with the wait for its work', () => {
  assert.equal(leavingNoticeMs(10), 11_000)
  assert.equal(leavingNoticeMs(undefined), 31_000, 'the default refresh is 30 s')
  const at = 1_000_000
  const wait = 10_000
  // Nothing runs: the work settled at once, the notice decides.
  assert.equal(exitAt({ leavingAt: at, workSettledAt: at, refreshSeconds: 10, waitMs: wait }), at + 11_000)
  // Work that settles after the notice decides (in parallel, not added).
  assert.equal(exitAt({ leavingAt: at, workSettledAt: at + 20_000, refreshSeconds: 10, waitMs: wait }), at + 20_000)
  assert.equal(exitAt({ leavingAt: at, workSettledAt: at + 4_000, refreshSeconds: 2, waitMs: wait }), at + 4_000, 'work still running at 4 s, notice 3 s')
  // Never later than the wait plus the notice.
  assert.equal(exitAt({ leavingAt: at, workSettledAt: at + 500_000, refreshSeconds: 10, waitMs: wait }), at + wait + 11_000)
  assert.equal(exitAt({ leavingAt: at, workSettledAt: at, refreshSeconds: 0, waitMs: wait }), at + 1_000, 'a refresh of 0 still gives the second')
})

test('gapsOf: gap lines with a why read as before', () => {
  const history = [...lines, { at: 12 * MIN, gap: true, why: 'restart' }, { at: 20 * MIN, chat: 'Units', state: 'free', task: null }]
  const plain = [...lines, { at: 12 * MIN, gap: true }, { at: 20 * MIN, chat: 'Units', state: 'free', task: null }]
  assert.deepEqual(gapsOf(history, 30 * MIN), [{ from: 12 * MIN, to: 20 * MIN }])
  assert.deepEqual(gapsOf(history, 30 * MIN), gapsOf(plain, 30 * MIN))
  assert.ok(GAP_MS > 0)
})

test('parseStop, writeStop, takeStop: the record round-trips, a broken one is none, and taking it removes the file', async () => {
  assert.deepEqual(parseStop('{"at":5,"why":"crash"}'), { at: 5, why: 'crash' })
  for (const bad of ['', 'nope', '{}', '{"at":5}', '{"at":5,"why":"fire"}', '{"at":"x","why":"crash"}']) assert.equal(parseStop(bad), null, bad)
  const dir = await mkdtemp(join(tmpdir(), 'board-stop-'))
  try {
    const file = join(dir, 'stop.json')
    assert.equal(takeStop(file), null, 'no file, no record')
    writeStop(file, { at: 7, why: 'restart' })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { at: 7, why: 'restart' })
    assert.deepEqual(takeStop(file), { at: 7, why: 'restart' })
    assert.equal(existsSync(file), false, 'the record is removed once taken')
    await writeFile(file, 'torn')
    assert.equal(takeStop(file), null)
    assert.equal(existsSync(file), false, 'a broken record is removed too')
    writeStop(join(dir, 'missing', 'stop.json'), { at: 7, why: 'restart' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('fileStore: a start takes the stop record into the gap line and removes the file, so a later start never blames an old stop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'board-stop-'))
  try {
    const first = await fileStore(dir, 0)
    await tick(first, { chats: [{ name: 'Units', state: 'working', task: null }] }, 10 * MIN)
    writeStop(join(dir, 'stop.json'), { at: 11 * MIN, why: 'restart' })

    const second = await fileStore(dir, 40 * MIN)
    assert.deepEqual(second.startedGap, { at: 10 * MIN, gap: true, why: 'restart' })
    assert.deepEqual(second.lines().filter(line => line.gap === true), [{ at: 10 * MIN, gap: true, why: 'restart' }])
    assert.equal(existsSync(join(dir, 'stop.json')), false, 'the record is used up')
    assert.match(await readFile(join(dir, 'history.jsonl'), 'utf8'), /"gap":true,"why":"restart"/)

    // The board ran, then vanished without a record (the PC slept): the gap says unknown, not the old restart.
    await tick(second, { chats: [{ name: 'Units', state: 'free', task: null }] }, 41 * MIN)
    const third = await fileStore(dir, 90 * MIN)
    assert.equal(third.startedGap.why, 'unknown')

    // A start without a gap has none, and still takes a record away.
    writeStop(join(dir, 'stop.json'), { at: 90 * MIN, why: 'stopped' })
    await tick(third, { chats: [{ name: 'Units', state: 'free', task: null }] }, 91 * MIN)
    const fourth = await fileStore(dir, 92 * MIN)
    assert.equal(fourth.startedGap, null)
    assert.equal(existsSync(join(dir, 'stop.json')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('boardView: lastStop shows for 15 minutes after a start that found a gap, and never after a start without one', () => {
  const started = 100 * MIN
  const gap = { at: 80 * MIN, gap: true, why: 'crash' }
  const stop = lastStopOf(gap, started)
  assert.deepEqual(stop, { from: 80 * MIN, to: started, why: 'crash' })
  assert.deepEqual(boardView({ now: started + MIN, startedAt: started, lastStop: stop }).lastStop, stop)
  assert.deepEqual(boardView({ now: started + LAST_STOP_SHOWN_MS - 1, startedAt: started, lastStop: stop }).lastStop, stop)
  assert.equal(boardView({ now: started + LAST_STOP_SHOWN_MS, startedAt: started, lastStop: stop }).lastStop, null)
  assert.equal(lastStopOf(null, started), null, 'a start without a gap')
  assert.equal(boardView({ now: started + MIN, startedAt: started, lastStop: lastStopOf(null, started) }).lastStop, null)
  assert.equal(lastStopOf({ at: 80 * MIN, gap: true }, started).why, 'unknown', 'a gap line from before this change has no why')
})

test('boardView: the board\'s clock, when its work loop last ran, and the restart on its way', () => {
  const view = boardView({ now: 500, startedAt: 100, aliveAt: 400 })
  assert.deepEqual(view, { now: 500, loop: { lastTickAt: 400 }, restart: { state: 'none', at: null, why: null }, lastStop: null })
  assert.equal(boardView({ now: 500, startedAt: 100, aliveAt: 50 }).loop.lastTickAt, 100, 'alive.json from before this start is no sign the loop ran since')
  assert.equal(boardView({ now: 500, startedAt: 100, aliveAt: null }).loop.lastTickAt, null, 'nothing ticks (the demo)')
  assert.deepEqual(boardView({ now: 500, startedAt: 100, waiting: { since: 300 } }).restart, { state: 'waiting', at: 300, why: 'new-version' })
  assert.deepEqual(boardView({ now: 500, startedAt: 100, waiting: { since: 300 }, leaving: { at: 450, why: 'new-version' } }).restart, { state: 'leaving', at: 450, why: 'new-version' }, 'leaving wins over waiting')
})
