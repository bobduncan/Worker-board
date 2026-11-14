// The wait line's turn rule, the board's side of the mod's `report.word` and `report.turn` (the signals lead's decision of
// 2026-11-02, .claude/plans/2026-11-02-wait-line-turn-code-check.md): the two fields are read from the report, kept with it (in
// memory and in data/reports.json) and passed to the lane; the keep (the server's pass that writes `answeredAt` once on a word)
// runs when a report MOVES (its state, its turn, its word), never on the 5-second ping that repeats them. Made-up garden chats.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { answerReport, checkTake, noteReport } from '../src/bridge.mjs'
import { hasMoved, parseReport } from '../src/chatReport.mjs'
import { reportsOfFile, savedEntry, textOfReports } from '../src/reportsKept.mjs'

const board = { chats: [{ name: 'Units', session: 's-units' }] }

test('parseReport reads word and turn only as the mod gave them: a word id or null, a turn not after now; none from an older mod', () => {
  const plain = { state: 'busy', since: 100, background: false, run: null, seq: null }
  assert.deepEqual(parseReport({ state: 'busy', since: 100 }, 200), plain, 'an older mod: the report as it was, neither key')
  assert.deepEqual(parseReport({ state: 'busy', since: 100, word: 'w1', turn: 90 }, 200), { ...plain, word: 'w1', turn: 90 })
  assert.deepEqual(parseReport({ state: 'idle', since: 100, word: null, turn: 90 }, 200), { ...plain, state: 'idle', word: null, turn: 90 }, 'null: the turn was no word\'s')
  assert.deepEqual(parseReport({ state: 'idle', since: 100, word: null }, 200), { ...plain, state: 'idle', word: null }, 'a word without a turn')
  // Not a word id, not a time: left out as if the mod did not say (the older rule), never a guess.
  for (const word of [7, '', 'x'.repeat(65), {}, [], true]) assert.equal('word' in parseReport({ state: 'busy', since: 100, word }, 200), false, `word ${JSON.stringify(word)}`)
  for (const turn of ['soon', null, 999, NaN, {}]) assert.equal('turn' in parseReport({ state: 'busy', since: 100, turn }, 200), false, `turn ${JSON.stringify(turn)}`)
})

test('the board keeps word and turn with the report, through a take as through a report call, and the out-of-order report changes none', () => {
  const reports = new Map()
  const body = (state, seq, more = {}) => ({ chat: 'Units', session: 's-units', mod: '0.30.0', report: { state, since: 300, run: 7, seq, ...more } })
  assert.deepEqual(answerReport(reports, body('busy', 1, { word: 'w1', turn: 290 }), checkTake(body('busy', 1), board), 500), { ok: true, result: { ok: true } })
  assert.deepEqual(reports.get('Units'), { state: 'busy', since: 300, background: false, run: 7, seq: 1, word: 'w1', turn: 290, at: 500, session: 's-units', mod: '0.30.0', busyAt: 500, workFrom: 300 })
  const note = (one, now) => noteReport(reports, one, checkTake(one, board), now)
  note(body('idle', 2, { word: 'w1', turn: 290 }), 600)
  assert.deepEqual([reports.get('Units').state, reports.get('Units').word, reports.get('Units').turn, reports.get('Units').busyAt], ['idle', 'w1', 290, 500])
  // A report of a lower seq (late) leaves the kept word and turn as they are.
  note(body('busy', 1, { word: 'older', turn: 100 }), 700)
  assert.deepEqual([reports.get('Units').word, reports.get('Units').turn, reports.get('Units').at], ['w1', 290, 700])
  // A turn that was no word's: word null is kept as null. A mod that stops saying them (an older one) leaves neither.
  note(body('busy', 3, { word: null, turn: 650 }), 800)
  assert.deepEqual([reports.get('Units').word, reports.get('Units').turn], [null, 650])
  note(body('idle', 4), 900)
  assert.equal('word' in reports.get('Units'), false)
  assert.equal('turn' in reports.get('Units'), false)
})

test('data/reports.json keeps word and turn with the report, and a saved report from before has neither; a wrong kind of either leaves the entry out', () => {
  const now = 10_000
  const good = { state: 'busy', since: 100, background: false, run: 'r-1', seq: 3, at: 200, session: 'cli-Lead', mod: '0.30.0', busyAt: 150 }
  assert.deepEqual(savedEntry(good, now), good, 'from before: neither key')
  assert.deepEqual(savedEntry({ ...good, word: 'w1', turn: 120 }, now), { ...good, word: 'w1', turn: 120 })
  assert.deepEqual(savedEntry({ ...good, word: null }, now), { ...good, word: null })
  for (const bad of [{ word: 7 }, { word: '' }, { word: 'x'.repeat(65) }, { turn: 'then' }, { turn: null }]) assert.equal(savedEntry({ ...good, ...bad }, now), null, JSON.stringify(bad))
  // Through the file's text: written and read back equal.
  const reports = new Map([['Lead', { ...good, word: 'w1', turn: 120 }], ['Digger', { ...good, word: null }], ['Weeder', good]])
  assert.deepEqual(reportsOfFile(JSON.parse(textOfReports(reports)), now), reports)
})

test('the keep runs once per move of a report, never on the 5-second ping that repeats it', () => {
  const reports = new Map()
  let moves = 0
  let seq = 0
  // As the server's keepReport does: the kept entry before, the kept entry after, one keep when it moved.
  const hear = (state, now, more = {}) => {
    const one = { chat: 'Units', session: 's-units', report: { state, since: now, run: 7, seq: (seq += 1), ...more } }
    const before = reports.get('Units')
    noteReport(reports, one, checkTake(one, board), now)
    if (hasMoved(before, reports.get('Units'))) moves += 1
  }
  const ping = (state, now, more) => hear(state, now - 1, more)
  hear('idle', 1000)
  assert.equal(moves, 1, 'the first report of the chat')
  for (const at of [6000, 11_000, 16_000]) ping('idle', at)
  assert.equal(moves, 1, 'pings of an idle chat')
  hear('busy', 20_000, { word: 'w1', turn: 20_000 })
  assert.equal(moves, 2, 'the turn begins')
  for (const at of [25_000, 30_000, 35_000, 40_000]) ping('busy', at, { word: 'w1', turn: 20_000 })
  assert.equal(moves, 2, 'pings of a busy chat')
  hear('asking', 41_000, { word: 'w1', turn: 20_000 })
  hear('busy', 45_000, { word: 'w1', turn: 20_000 })
  assert.equal(moves, 4, 'a question that opens and closes: each state is a move')
  hear('idle', 50_000, { word: 'w1', turn: 20_000 })
  assert.equal(moves, 5, 'the turn ends: the keep sees the word answered at once')
  // Back to back turns: the idle may not reach the board; busy again with another word and turn is a move too.
  hear('busy', 60_000, { word: 'w2', turn: 60_000 })
  hear('busy', 61_000, { word: 'w3', turn: 61_000 })
  assert.equal(moves, 7)
  // A late report of a lower seq changes nothing.
  const late = { chat: 'Units', session: 's-units', report: { state: 'idle', since: 5, run: 7, seq: 1, word: null } }
  const before = reports.get('Units')
  noteReport(reports, late, checkTake(late, board), 62_000)
  assert.equal(hasMoved(before, reports.get('Units')), false)
  assert.equal(hasMoved(undefined, undefined), false)
  assert.equal(hasMoved(undefined, { state: 'idle' }), true)
})

test('the server: the move keeps the lines through loops.single, never awaited in the route; the 30 s clock runs the same pass; nothing on the demo or a board that only shows', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const keep = server.slice(server.indexOf('const keepWaitsNow = '), server.indexOf('const keepWaitsNow = ') + 400)
  assert.match(keep, /isDemo \|\| isShowOnly \|\| bridgeKey === null \|\| isClosing \? undefined : loops\.single\('waits-keep', \(\) => waitsNow\(readState\.last\(\) \?\? null, work\.last\?\.\(\) \?\? null, null\)\)/)
  const route = server.slice(server.indexOf('const keepReport = '), server.indexOf('// The supervisor\'s Part 2: the version of each chat\'s Workers mod'))
  assert.match(route, /if \(checked\?\.ok === true && hasMoved\(entryBefore, entryAfter\)\) void keepWaitsNow\(\)/)
  assert.doesNotMatch(route, /await keepWaitsNow/)
  assert.match(server, /setInterval\(\(\) => void keepWaitsNow\(\), WAITS_KEEP_MS\)/)
  assert.doesNotMatch(server, /loops\.run\('waits-keep'/, 'one name, one pass at a time')
  // The writes still need the loops (waitsNow: only the board that delivers).
  assert.match(server, /if \(!isShowOnly && await ownsLoops\(\)\) \{\s+for \(const \{ id, fields \} of seen\)/)
})
