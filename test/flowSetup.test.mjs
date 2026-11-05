// 2026-11-05: the board's setup brings a project's own flow.json up to date with the moves of DEFAULT_FLOW, adding only. Every test
// works in a temporary folder; no real project's flow file is touched.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { addBoardMoves, describeFlow, missingMoves, moveWords, setupFlow, withBoardMoves } from '../src/flowSetup.mjs'
import { DEFAULT_FLOW, GIVE_BACK_GUARD, parseFlow } from '../src/work/flow.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'flow-setup-test-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
let counter = 0
const fresh = () => join(scratch, `case-${(counter += 1)}`, 'flow.json')
const put = async (file, text) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}
const clone = value => JSON.parse(JSON.stringify(value))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** An older flow: DEFAULT_FLOW without the three give-back moves and done → review (the trial case). */
function older() {
  const flow = clone(DEFAULT_FLOW)
  flow.step.moves = flow.step.moves.filter(move => move.when !== GIVE_BACK_GUARD && !(move.from === 'done' && move.to === 'review'))
  return flow
}

test('the trial case: exactly the four missing moves, each right after its base predecessor, CRLF kept', () => {
  const text = JSON.stringify(older(), null, 2).replace(/\n/g, '\r\n') + '\r\n'
  const result = withBoardMoves(text)
  assert.equal(result.ok, true)
  assert.equal(result.changed, true)
  assert.equal(result.added.length, 4)
  assert.deepEqual(result.states, [])
  assert.ok(result.text.includes('\r\n') && !/[^\r]\n/.test(result.text), 'CRLF all through')
  const read = parseFlow(result.text)
  assert.equal(read.problem, null)
  assert.deepEqual(read.flow, DEFAULT_FLOW, 'the older flow plus those four is the default, in its order')
  assert.deepEqual(missingMoves(read.flow), [])
})

test('an up to date flow: changed false, text as it was, no write, no backup', async () => {
  const text = JSON.stringify(DEFAULT_FLOW, null, 2) + '\n'
  assert.deepEqual(withBoardMoves(text), { ok: true, text, added: [], states: [], changed: false })
  const file = fresh()
  await put(file, text)
  const done = await addBoardMoves({ file })
  assert.equal(done.ok, true)
  assert.equal(done.backup, null)
  assert.deepEqual(readdirSync(join(file, '..')), ['flow.json'])
  assert.equal(readFileSync(file, 'utf8'), text)
})

test('the person\'s own moves stay; a base move whose `by` differs is added beside it, the person\'s one is not changed', () => {
  const flow = clone(DEFAULT_FLOW)
  const mine = { from: 'new', to: 'dropped', by: 'person' }
  flow.step.moves.push(mine)
  const at = flow.step.moves.findIndex(move => move.from === 'done' && move.to === 'review')
  flow.step.moves[at] = { from: 'done', to: 'review', by: 'main' }
  const result = withBoardMoves(JSON.stringify(flow, null, 2))
  assert.equal(result.ok, true)
  assert.equal(result.added.length, 1)
  assert.deepEqual(result.added[0].move, { from: 'done', to: 'review', by: 'person' })
  const moves = parseFlow(result.text).flow.step.moves
  assert.deepEqual(moves[at], { from: 'done', to: 'review', by: 'person' }, 'the board move lands after its base predecessor')
  assert.deepEqual(moves[at + 1], { from: 'done', to: 'review', by: 'main' }, 'the person move is as it was')
  assert.ok(moves.some(move => same(move, mine)))
  assert.equal(moves.length, flow.step.moves.length + 1)
})

test('the order of `by` does not matter', () => {
  const flow = clone(DEFAULT_FLOW)
  const at = flow.step.moves.findIndex(move => Array.isArray(move.by))
  flow.step.moves[at].by = [...flow.step.moves[at].by].reverse()
  assert.deepEqual(missingMoves(flow), [])
})

test('a state a move needs is added after the nearest earlier base state', () => {
  const flow = clone(DEFAULT_FLOW)
  flow.step.states = flow.step.states.filter(state => state !== 'review')
  flow.step.moves = flow.step.moves.filter(move => move.from !== 'review' && move.to !== 'review')
  const result = withBoardMoves(JSON.stringify(flow, null, 2))
  assert.equal(result.ok, true)
  assert.deepEqual(result.states, [{ kind: 'step', state: 'review' }])
  const read = parseFlow(result.text)
  assert.equal(read.problem, null)
  assert.deepEqual(read.flow.step.states, DEFAULT_FLOW.step.states)
})

test('a kind the file lacks is added whole; other keys stay in place', () => {
  const base = { ...clone(DEFAULT_FLOW), extra: { states: ['a', 'b'], moves: [{ from: 'a', to: 'b', by: 'person' }] } }
  const flow = clone(DEFAULT_FLOW)
  const result = withBoardMoves(JSON.stringify(flow, null, 2), base)
  assert.equal(result.ok, true)
  assert.deepEqual(JSON.parse(result.text).extra, base.extra)
  assert.deepEqual(Object.keys(JSON.parse(result.text)), ['step', 'extra'])
  assert.deepEqual(missingMoves(flow, base), [{ kind: 'extra', move: base.extra.moves[0] }])
})

test('a BOM is kept', () => {
  const text = '﻿' + JSON.stringify(older(), null, 2) + '\n'
  const result = withBoardMoves(text)
  assert.ok(result.text.startsWith('﻿'))
  assert.equal(parseFlow(result.text).problem, null)
})

test('broken JSON or a flow the board rejects: ok false, nothing written', async () => {
  assert.equal(withBoardMoves('{ nope').ok, false)
  const bad = JSON.stringify({ step: { states: ['new'], moves: [{ from: 'new', to: 'gone', by: 'person' }] } })
  const result = withBoardMoves(bad)
  assert.equal(result.ok, false)
  assert.match(result.why, /gone/)
  const file = fresh()
  await put(file, '{ nope')
  const done = await addBoardMoves({ file })
  assert.equal(done.ok, false)
  assert.equal(readFileSync(file, 'utf8'), '{ nope')
  assert.deepEqual(readdirSync(join(file, '..')), ['flow.json'])
})

test('no file: none, nothing written', async () => {
  const file = fresh()
  const done = await addBoardMoves({ file })
  assert.deepEqual(done, { ok: true, none: true, added: [], states: [], backup: null, file })
  assert.ok(!existsSync(file))
  assert.deepEqual((await describeFlow({ file })).slice(1), ['  none: the board uses its own default flow'])
})

test('the backup holds the old bytes, the file the new moves', async () => {
  const file = fresh()
  const text = JSON.stringify(older(), null, 2).replace(/\n/g, '\r\n') + '\r\n'
  await put(file, text)
  const done = await addBoardMoves({ file, now: new Date(2026, 10, 5, 9, 8, 7) })
  assert.equal(done.ok, true)
  assert.equal(done.added.length, 4)
  assert.equal(done.backup, `${file}.bak-20261105-090807`)
  assert.equal(readFileSync(done.backup, 'utf8'), text)
  assert.deepEqual(parseFlow(readFileSync(file, 'utf8')).flow, DEFAULT_FLOW)
})

test('setupFlow: no keyboard and no flag writes nothing, the flag writes, a no writes nothing, check writes nothing', async () => {
  const file = fresh()
  const text = JSON.stringify(older(), null, 2) + '\n'
  await put(file, text)
  assert.deepEqual(await setupFlow({ answer: 'y', flag: undefined, isTty: false, file }), { wrote: false })
  assert.deepEqual(await setupFlow({ answer: 'n', flag: undefined, isTty: true, file }), { wrote: false })
  const checked = await setupFlow({ answer: 'y', flag: 'yes', isTty: true, check: true, file })
  assert.equal(checked.wrote, false)
  assert.equal(checked.check, true)
  assert.equal(checked.lines.filter(line => line.startsWith('    - ')).length, 4)
  assert.equal(readFileSync(file, 'utf8'), text)
  assert.deepEqual(readdirSync(join(file, '..')), ['flow.json'])
  const done = await setupFlow({ answer: 'Yes', flag: 'yes', isTty: false, file })
  assert.equal(done.wrote, true)
  assert.equal(done.added.length, 4)
  assert.deepEqual(parseFlow(readFileSync(file, 'utf8')).flow, DEFAULT_FLOW)
})

test('the words for the person', () => {
  assert.equal(moveWords('step', { from: 'done', to: 'review', by: 'person' }), 'a step: done → review, by you')
  assert.equal(moveWords('step', { from: 'in progress', to: 'refined', by: 'server', when: GIVE_BACK_GUARD }), `a step: in progress → refined, by the board, when "${GIVE_BACK_GUARD}"`)
  assert.match(moveWords('step', { from: 'taken', to: 'in progress', by: ['worker', 'main'] }), /by worker or main$/)
})

test('describeFlow lists what would be added', async () => {
  const file = fresh()
  await put(file, JSON.stringify(older(), null, 2))
  const lines = await describeFlow({ file })
  assert.equal(lines[0], `Your project's flow, ${file}:`)
  assert.equal(lines[1], '  4 moves would be added:')
  assert.equal(lines.length, 7)
  assert.equal(lines.at(-1), '  the old file is copied to flow.json.bak-<time> first')
  const ok = fresh()
  await put(ok, JSON.stringify(DEFAULT_FLOW))
  assert.deepEqual((await describeFlow({ file: ok })).slice(1), ['  nothing to add (it has every move the board needs)'])
})

test('examples/work/flow.json equals DEFAULT_FLOW, so a new project gets every board move', () => {
  const text = readFileSync(new URL('../examples/work/flow.json', import.meta.url), 'utf8')
  assert.deepEqual(parseFlow(text).flow, DEFAULT_FLOW)
  assert.deepEqual(missingMoves(JSON.parse(text)), [])
})
