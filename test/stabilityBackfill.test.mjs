// Stability backfill (2026-11-05, plan task 5): the closed day lines for the days before the records existed, on a 3-day fixture
// made relative to today (the tool reads the clock). READ ONLY on the records; never rewrites a line that is already there.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { dayOf } from '../src/stability.mjs'
import { mergeLines } from '../tools/stability-backfill.mjs'

const TOOL = fileURLToPath(new URL('../tools/stability-backfill.mjs', import.meta.url))
const today = new Date()
const dayAt = (back, hour, minute = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, hour, minute).getTime()
const dayName = back => dayOf(dayAt(back, 12))
const stamp = (back, hour, minute = 0) => `${dayName(back)} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

/** Three days back (3, 2, 1). Day 3: Worker 1 free 09:00-10:00 with B1 ready 09:00-09:30 (30 min idle). Day 2: a rollback and an incident. Day 1: nothing. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stability-backfill-'))
  const data = join(root, 'data')
  const store = join(root, 'work')
  await mkdir(data)
  await mkdir(store)
  const lines = [
    { at: dayAt(3, 8), chat: 'Worker 1', state: 'working' },
    { at: dayAt(3, 9), chat: 'Worker 1', state: 'free' },
    { at: dayAt(3, 10), chat: 'Worker 1', state: 'working' },
  ]
  await writeFile(join(data, 'history.jsonl'), `${lines.map(line => JSON.stringify(line)).join('\n')}\n`)
  await writeFile(join(data, 'landings.jsonl'), `${JSON.stringify({ at: new Date(dayAt(2, 14)).toISOString(), by: 'Worker 1', branch: 'b1', result: 'rolled back: the gate failed' })}\n`)
  await writeFile(join(store, 'B1.md'), `Id: B1\nKind: step\nTitle: A step\nState: done\nSince: ${stamp(3, 8)}\n\n## History\n- ${stamp(3, 9)} Advisor: refined is ready\n- ${stamp(3, 9, 30)} server: refined → queued (given by the board to Worker 1)\n`)
  await writeFile(join(store, 'X1.md'), `Id: X1\nKind: incident\nTitle: an alarm\nState: open\nSince: ${stamp(2, 9)}\nFirst seen: ${stamp(2, 9)}\n`)
  return { root, data, store }
}
const run = (data, store, ...more) => execFileSync(process.execPath, [TOOL, data, store, '--days', '3', ...more], { encoding: 'utf8' })
const linesOf = output => output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))

test('the 3 days are closed and backfilled; idle is null (not known); rollback and alarm come from the records', async () => {
  const { root, data, store } = await fixture()
  try {
    const output = run(data, store)
    const lines = linesOf(output)
    assert.deepEqual(lines.map(line => line.day), [dayName(3), dayName(2), dayName(1)])
    for (const line of lines) assert.deepEqual([line.closed, line.backfilled, line.idleEstimated], [true, true, false])
    // Idle is not known for a backfilled day: null for every day (not an estimate, not 0).
    assert.deepEqual(lines.map(line => line.idleWithWorkMinutes), [null, null, null])
    assert.deepEqual(lines[1].interventions.map(one => one.kind), ['rollback'])
    assert.deepEqual(lines[1].alarms, { real: 1, false: 0, ids: ['X1'] })
    // No actions log: every day carries an unsure resume-all with the why, never a guess.
    for (const line of lines) assert.ok(line.unsure.some(one => one.kind === 'resume-all' && /actions log/.test(one.why)))
    assert.match(output, /^# resume-all: not known before/m)
    // The default target is the data folder's stability.jsonl.
    assert.deepEqual((await readFile(join(data, 'stability.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).day), lines.map(line => line.day))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a closed line already in stability.jsonl is never rewritten', async () => {
  const { root, data, store } = await fixture()
  try {
    const mine = { day: dayName(3), idleWithWorkMinutes: 999, idleEstimated: false, interventions: [], unsure: [], alarms: { real: 0, false: 0, ids: [] }, writtenAt: 1, closed: true }
    await writeFile(join(data, 'stability.jsonl'), `${JSON.stringify(mine)}\n`)
    run(data, store)
    const lines = (await readFile(join(data, 'stability.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(lines[0], mine)
    assert.equal(lines.length, 3)
    assert.equal(lines[1].backfilled, true)
    assert.deepEqual(mergeLines([mine], [{ ...mine, idleWithWorkMinutes: 1 }]), [mine])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('--out writes the merged result there and leaves the data folder untouched', async () => {
  const { root, data, store } = await fixture()
  try {
    const before = Object.fromEntries(await Promise.all((await readdir(data)).map(async name => [name, await readFile(join(data, name), 'utf8')])))
    const out = join(root, 'out.jsonl')
    run(data, store, '--out', out)
    assert.equal((await readFile(out, 'utf8')).trim().split('\n').length, 3)
    assert.deepEqual(await readdir(data), Object.keys(before))
    for (const [name, text] of Object.entries(before)) assert.equal(await readFile(join(data, name), 'utf8'), text)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
