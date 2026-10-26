// B724 (the fix of B715's result check): every shape of a PC's sleep through the real board, in one table. Each row starts a
// board whose history.jsonl and alive.json were written before it ran (sleepBoard.mjs), so no minute look is awaited, and
// reads what it serves at /api/state. The sleeps: a gap line already written (the board ran again after it) and an open gap
// (the board's last look is in alive.json, no gap line yet), each of 1 h, 4 h, 9 h (a night) and 30 h. The stale-checkpoint
// rule then reads a step taken before the sleep, fed what the board served: not late after the sleep, late again when the
// chat ran 2 h after the wake, and late when the board served no gap at all.

import assert from 'node:assert/strict'
import test from 'node:test'

import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { HOUR, MIN, startBoard, until, working } from './sleepBoard.mjs'

const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'working', isRunning: true, queue: [], compaction: null, task: null, ...more })
const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const check = view => WATCH_RULES.find(one => one.id === 'stale-checkpoint').check(view, { seen: new Map(), observed: [] })

/** The rule on a step in progress since `since`, fed the gaps the board served and the time the chat ran from `ran` to `now`. */
function lateAt({ gaps, since, now, ran }) {
  const items = new Map([['B704', item({ Id: 'B704', Kind: 'step', Title: 'Step B704 of the orchard', State: 'in progress', Since: stamp(since), Owner: 'Picker' })]])
  return check(buildView({
    state: { chats: [lane('Lead', { isMain: true }), lane('Picker')], chatPrefix: '', pause: null, today: [{ chat: 'Picker', spans: [{ from: ran, to: now, state: 'working' }] }], gaps, limits: {} },
    items, settings: {}, now,
  })).length
}

const SLEEPS = [['1 h', HOUR], ['4 h', 4 * HOUR], ['9 h, a night', 9 * HOUR], ['30 h', 30 * HOUR]]

/** The history before the board runs: a work line, then the sleep as a gap line (written) or as the last look in alive.json (open). */
const rows = SLEEPS.flatMap(([label, length]) => [
  {
    name: `a written gap line of ${label}`,
    prepare: async ({ start, put, board }) => {
      const from = start - length - 5 * MIN
      const lines = [working(from - 10 * MIN), { at: from, gap: true }, working(from + length)]
      await put(`${board}/data/history.jsonl`, `${lines.map(one => JSON.stringify(one)).join('\n')}\n`)
      await put(`${board}/data/alive.json`, JSON.stringify({ at: start - 2 * MIN }))
    },
    expected: start => ({ from: start - length - 5 * MIN, to: start - 5 * MIN, open: false }),
  },
  {
    name: `an open gap of ${label}`,
    // The board runs with a fresh alive.json (no gap at its start); then the PC sleeps: alive.json is the board's last look
    // `length` ago, the history ends with a work line, and no gap line is written (the holder of the loops sleeps).
    prepare: async ({ start, put, board }) => {
      await put(`${board}/data/history.jsonl`, `${JSON.stringify(working(start - length - 10 * MIN))}
`)
      await put(`${board}/data/alive.json`, JSON.stringify({ at: start - MIN }))
    },
    sleep: async (board, start) => board.write('alive.json', JSON.stringify({ at: start - length })),
    expected: start => ({ from: start - length, to: null, open: true }),
  },
])

test('B724: every shape of a sleep, written down or still open, is served by the real board and read as board-off time', { timeout: 120_000 }, async () => {
  const boards = await Promise.all(rows.map(row => startBoard(row.prepare)))
  try {
    // The first look of each board: a written gap line is served at once; for an open gap the PC sleeps now, and the board's
    // next look (300 ms) reads alive.json again.
    const states = await Promise.all(boards.map(async (one, index) => {
      const first = await one.stateNow()
      if (rows[index].sleep === undefined) return first
      assert.deepEqual(first.gaps, [], `${rows[index].name}: no gap before the sleep`)
      await rows[index].sleep(one, one.start)
      return until(async () => {
        const state = await one.stateNow()
        return state.gaps.length === 1 ? state : null
      }, `${rows[index].name}: the state to serve the sleep as an open gap`, 30_000)
    }))
    rows.forEach((row, index) => {
      const { start } = boards[index]
      const want = row.expected(start)
      const { gaps } = states[index]
      assert.equal(gaps.length, 1, `${row.name}: one gap is served, got ${JSON.stringify(gaps)}`)
      assert.equal(gaps[0].from, want.from, `${row.name}: the gap begins at the sleep`)
      if (want.open) assert.ok(gaps[0].to >= states[index].readAt - 1000 && gaps[0].to <= Date.now(), `${row.name}: and runs to now`)
      else assert.equal(gaps[0].to, want.to, `${row.name}: and ends when the board ran again`)

      // B704 was taken 10 min before the sleep; the chat has run 70 min since the wake (checkpointMinutes is 120): not late.
      const wake = gaps[0].to
      const since = gaps[0].from - 10 * MIN
      assert.equal(lateAt({ gaps, since, now: wake + 70 * MIN, ran: wake }), 0, `${row.name}: a step taken before the sleep is not late after it`)
      // The guard: without the gaps the wall time counts and the same step is late.
      assert.equal(lateAt({ gaps: [], since, now: wake + 70 * MIN, ran: wake }), 1, `${row.name}: without the gap it would be late`)
      // A step quiet 2 h of running time after the wake is late, the sleep notwithstanding.
      assert.equal(lateAt({ gaps, since, now: wake + 130 * MIN, ran: wake }), 1, `${row.name}: 2 h of running time is late`)
    })
  } finally {
    await Promise.all(boards.map(one => one.close()))
  }
})
