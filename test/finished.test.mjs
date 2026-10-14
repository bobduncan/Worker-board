// B155: when a step of the backlog was finished, and by whom. The backlog holds no time for a tick, so the board
// finds one where it can: a line under the step ("Approved by you ... at ..."), a worker's report to the main chat
// that names the step, and the moment the board itself first saw the step ticked. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { fromChat } from '../fixtures/lines.mjs'
import { parseBacklog } from '../src/backlog.mjs'
import { doneIdsOf, finishedList, finishedMarks, reportsOf, seenTicks } from '../src/finished.mjs'
import { parseTail } from '../src/transcript.mjs'

const MIN = 60_000
/** A time of this machine's clock: the backlog's lines name times as the person reads them. */
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
const PREFIX = 'Game - '
const entries = lines => parseTail(lines.join('\n'), false)

// A line under the step

test('a line under a step that says it was approved, done or closed gives when, and by whom', () => {
  assert.deepEqual(finishedMarks(['Approved by you on the worker board on 2026-10-14 at 10:08.'], PREFIX), [{ at: at(14, 10, 8), isDay: false, by: 'you' }])
  assert.deepEqual(finishedMarks(['(Done on 2026-10-14 at 00:30 by Game - Board: merged into the board\'s main and pushed.)'], PREFIX), [{ at: at(14, 0, 30), isDay: false, by: 'Board' }])
  assert.deepEqual(finishedMarks(['Done by you on the worker board on 2026-10-14 at 9:05: looks right.'], PREFIX), [{ at: at(14, 9, 5), isDay: false, by: 'you' }])
  assert.deepEqual(finishedMarks(['Approved by you on 2026-10-13 at 00:23, in Game - Board, answered on the worker board: "1 yes 2 yes".'], PREFIX), [{ at: at(13, 0, 23), isDay: false, by: 'you' }])
  // Only the day: kept as the day, and said to be rough.
  assert.deepEqual(finishedMarks(['(Closed on 2026-10-12 when B51, B52 and B53 were made into one set.)'], PREFIX), [{ at: at(12, 0, 0), isDay: true, by: null }])
  assert.deepEqual(finishedMarks(['(Done on 2026-10-14 by Game - Board: merged.)'], PREFIX), [{ at: at(14, 0, 0), isDay: true, by: 'Board' }])
})

test('a date that does not say the step was finished is none', () => {
  for (const line of ['Context: asked in Game - Main on 2026-10-12 at 23:40 ("put a visual indicator ...").', 'Seen on 2026-10-14 at 10:06: Worker 1 recorded a card.', 'Requirements:', '- Approve on a step whose work is merged.']) {
    assert.deepEqual(finishedMarks([line], PREFIX), [], line)
  }
})

// A report to the main chat

test('a worker\'s report to the main chat names the steps it finished in its first line', () => {
  const lines = [
    fromChat(at(14, 9, 40), 'Game - Board', 'Report from Game - Board: B142 is merged into the board\'s main and pushed.\nB140 is mentioned here only.'),
    fromChat(at(14, 9, 50), 'Game - Units', 'Note from Game - Units: B118 is half done.'),
    fromChat(at(14, 10, 5), 'Game - Board', 'Report from Game - Board: B148 and B150 are merged.'),
    fromChat(at(14, 10, 20), 'Game - Board', 'Report from Game - Board: B148\'s second part is merged.'),
  ]
  const reports = reportsOf(entries(lines), PREFIX)
  assert.deepEqual(Object.fromEntries(reports), {
    B142: { at: at(14, 9, 40), by: 'Board' },
    // The last report that names a step: the last of its parts.
    B148: { at: at(14, 10, 20), by: 'Board' },
    B150: { at: at(14, 10, 5), by: 'Board' },
  })
})

// What the board saw

const backlog = text => parseBacklog(text, { prefix: PREFIX, names: ['Board', 'Units'] })

test('the board keeps when it first saw each step ticked; what was ticked before its first look is marked so', () => {
  const first = seenTicks(null, doneIdsOf(backlog('## A\n- [x] B1 One (for Board)\n- [ ] B2 Two (for Units)\n')), at(14, 9))
  assert.deepEqual(first, { B1: { at: at(14, 9), isFirstLook: true } })
  const later = seenTicks(first, doneIdsOf(backlog('## A\n- [x] B1 One (for Board)\n- [x] B2 Two (for Units)\n- [x] Old step without an id\n')), at(14, 9, 1))
  assert.deepEqual(later, { B1: { at: at(14, 9), isFirstLook: true }, B2: { at: at(14, 9, 1), isFirstLook: false } })
  // Nothing new: the same object, so nothing is written.
  assert.equal(seenTicks(later, doneIdsOf(backlog('## A\n- [x] B1 One\n- [x] B2 Two\n')), at(14, 9, 2)), later)
})

// The list

const TEXT = [
  '## Board',
  '- [x] B10 The limits (for Board; about 1 h)',
  '  (Done on 2026-10-13 at 00:30 by Game - Board: merged.)',
  '- [x] B11 Verify: the limits look right (Game - Board) @you',
  '  Approved by you on the worker board on 2026-10-14 at 10:08.',
  '- [x] B12 The workers ask (for Board; about 1 h)',
  '- [x] B13 A step closed long ago (for Units)',
  '  (Closed on 2026-10-12 when it was made into one set.)',
  '- [x] B14 Seen ticked by the board (for Units)',
  '- [x] B15 Nothing known (for Units)',
  '- [ ] B16 Still open (for Board)',
  '- [x] An old step without an id',
  '',
].join('\n')

test('the finished steps, newest first: the time a line under it gives, else its report, else when the board saw it ticked', () => {
  const reports = new Map([['B12', { at: at(14, 9, 40), by: 'Board' }], ['B10', { at: at(13, 0, 25), by: 'Board' }]])
  const seen = { B14: { at: at(14, 10, 1), isFirstLook: false }, B15: { at: at(14, 8), isFirstLook: true }, B10: { at: at(14, 8), isFirstLook: true } }
  const list = finishedList(backlog(TEXT), { reports, seen, prefix: PREFIX })
  assert.deepEqual(list.map(one => [one.id, one.at, one.how, one.by]), [
    ['B11', at(14, 10, 8), 'line', 'you'],
    ['B14', at(14, 10, 1), 'seen', 'Units'],
    ['B12', at(14, 9, 40), 'report', 'Board'],
    // A line under the step wins over its report.
    ['B10', at(13, 0, 30), 'line', 'Board'],
    ['B13', at(12, 0, 0), 'day', 'Units'],
  ])
  assert.deepEqual(list[0], { key: 'B11', id: 'B11', title: 'the limits look right (Game - Board)', at: at(14, 10, 8), how: 'line', by: 'you' })
  // B15 was ticked before the board first looked: no time to put it in order by.
})

test('at most the newest twenty', () => {
  const many = ['## A', ...Array.from({ length: 25 }, (_, i) => `- [x] B${i + 1} Step ${i + 1}\n  Approved by you on the worker board on 2026-10-14 at 09:${String(i + 10).padStart(2, '0')}.`), ''].join('\n')
  const list = finishedList(backlog(many), { reports: new Map(), seen: {}, prefix: PREFIX })
  assert.equal(list.length, 20)
  assert.deepEqual([list[0].id, list.at(-1).id], ['B25', 'B6'])
})

// In the board's state

test('the state lists the finished steps from the backlog, the main chat\'s reports and what the board saw', async () => {
  const { buildState } = await import('../src/state.mjs')
  const { parseConfig } = await import('../src/config.mjs')
  const config = { ...parseConfig('{}', {}), project: 'C:\game' }
  const app = name => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\game', isArchived: false, createdAt: name.length, lastActivityAt: at(14, 10), lastAssistantUuid: 'u-1' })
  const mainTail = [fromChat(at(14, 9, 40), 'Game - Board', 'Report from Game - Board: B2 is merged.')].join('\n')
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Board')],
    tails: { 'cli-Main': { text: mainTail, isCut: false, modifiedAt: at(14, 10) } },
    planLineTexts: {},
    backlogText: '## A\n- [x] B1 One (for Board)\n  Approved by you on the worker board on 2026-10-14 at 10:08.\n- [x] B2 Two (for Board)\n- [x] B3 Three (for Board)\n- [ ] B4 Four (for Board)\n',
    adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const state = buildState(raw, { now: at(14, 10, 30), config, finishedSeen: { B3: { at: at(14, 9, 55), isFirstLook: false } } })
  assert.deepEqual(state.finished.map(one => [one.id, one.how, one.by]), [['B1', 'line', 'you'], ['B3', 'seen', 'Board'], ['B2', 'report', 'Board']])
  // A main chat's reports never reach the page as such: only the list does.
  assert.equal(state.chats.find(one => one.name === 'Main').reports, undefined)
  assert.deepEqual(buildState(raw, { now: at(14, 10, 30), config }).finished.map(one => one.id), ['B1', 'B2'])
})
