// Pause truth (2026-11-05, the person's real pause: Pause all on since 2026-11-04 23:36, the PC slept until 08:15, the app
// restarted). The page and the board told things that were not so. The real case is read from the board's own state of that
// day (test/fixtures/pause-2026-11-05/state-4310-trimmed.json: the live /api/state, thinned to what these tests read).
// One test per item; a mutant of each is killed by the test named in its comment.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { openPage } from './pageHarness.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const realCase = async () => JSON.parse(await readFile(join(HERE, 'fixtures', 'pause-2026-11-05', 'state-4310-trimmed.json'), 'utf8'))

/** The classes of the day bars of one chat's row on the page. */
const barsOf = (page, name) => {
  const row = page.all('#timeline .row').find(one => one.querySelector('.row-name')?.textContent === name)
  return [...row.querySelectorAll('.span')].map(one => one.className.replace(/^span /, ''))
}

// Item 1 (mutant: pausedToday left out of the page's read, or a bar drawn `interrupted` again).
test('item 1: the day bars of the chats the cards show as Paused are drawn Paused, not Stopped', async () => {
  const state = await realCase()
  const page = await openPage({ state, now: state.readAt })
  try {
    // The cards: the real case's six chats are all Paused.
    assert.equal(page.all('.lane.is-paused').length, 6)
    for (const name of ['Worker 1', 'Worker 2', 'Worker 5']) {
      assert.deepEqual(barsOf(page, name), ['is-suspended'], `${name}'s bar`)
    }
    // A chat that was free stays a free bar.
    assert.deepEqual(barsOf(page, 'Worker 3'), ['is-free'])
    // The bars say it in words too, for the hover: "Paused", never "Stopped".
    const titles = page.all('#timeline .span').map(one => one.title)
    assert.ok(titles.some(title => title.startsWith('Paused')))
    assert.ok(!titles.some(title => title.startsWith('Stopped')))
  } finally { await page.close() }
})

// Item 1, the part before the pause: a stop that began before the pause stays a stop up to the pause's start.
test('item 1: a stop before the pause is still drawn Stopped; from the pause on it is Paused', async () => {
  const state = await realCase()
  const since = state.pause.since
  state.today = state.today.map(lane => (lane.chat === 'Worker 1' ? { ...lane, spans: [{ from: since - 3_600_000, to: state.readAt, state: 'interrupted', task: 'B1046 x' }] } : lane))
  state.day = { ...state.day, from: since - 3_600_000 }
  const page = await openPage({ state, now: state.readAt })
  try {
    assert.deepEqual(barsOf(page, 'Worker 1'), ['is-interrupted', 'is-suspended'])
  } finally { await page.close() }
})
