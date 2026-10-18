// Focus 4, seen live: the main chat queued steps with `for: "Game - Worker 2"` (the chat's whole title), so their Owner
// was the title while the list names the chat "Worker 2". The work API now takes every chat name it is given (queue and
// requeue `for`, rename `from` and `to`, a note's `to`, the chat that asks) without the list's prefix and matched to a
// known chat case-insensitively; a name it does not know is refused with the names it knows. An Owner already written
// as prefix + a known name counts as that name. Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { parseItem, serializeItem, valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { writeFile } from 'node:fs/promises'
import { reconcile } from '../../src/work/reconcile.mjs'

const NOW = new Date(2026, 9, 18, 17, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Fights', '- [ ] B1 Show the damage', '- [ ] B2 Heavier hits', ''].join('\n')
const ROLES = { Main: 'main', 'Worker 2': 'worker', 'Worker 3': 'worker', Partner: 'advisor' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'chat-names-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60_000 }), undefined, { now: NOW - 60_000 })
  // B1 and B2 are refined, so they may be queued.
  for (const id of ['B1', 'B2']) {
    const item = (await readStore(dir)).items.get(id)
    item.head.set('State', 'refined')
    await writeFile(join(dir, `${id}.md`), serializeItem(item))
  }
  const ctx = { dir, now: NOW, prefix: 'Game - ', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), freeChats: new Set(['Worker 2']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, ctx, main: as('Main'), as }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)

test('queue and requeue take the chat without the prefix, in any case, as the list names it', async () => {
  const { dir, main } = await fresh()
  try {
    assert.equal((await main({ action: 'queue', id: 'B1', for: 'Game - Worker 2' })).ok, true)
    assert.equal(valueOf(await item(dir, 'B1'), 'Owner'), 'Worker 2')
    assert.equal((await main({ action: 'queue', id: 'B2', for: 'worker 2' })).ok, true)
    assert.equal(valueOf(await item(dir, 'B2'), 'Owner'), 'Worker 2')
    assert.equal((await main({ action: 'requeue', id: 'B2', for: 'game - WORKER 3' })).ok, true)
    assert.equal(valueOf(await item(dir, 'B2'), 'Owner'), 'Worker 3')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a chat the list does not know is refused, naming the ones it knows', async () => {
  const { dir, main } = await fresh()
  try {
    const refused = await main({ action: 'queue', id: 'B1', for: 'Game - Worker 9' })
    assert.deepEqual([refused.ok, refused.status], [false, 400])
    assert.equal(refused.why, 'Worker 9 is no chat of the list: Main, Worker 2, Worker 3, Partner.')
    assert.equal(valueOf(await item(dir, 'B1'), 'State'), 'refined')
    await main({ action: 'queue', id: 'B1', for: 'Worker 2' })
    assert.equal((await main({ action: 'requeue', id: 'B1', for: 'Nobody' })).why, 'Nobody is no chat of the list: Main, Worker 2, Worker 3, Partner.')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the chat that asks, a note to the main chat and a rename take the list\'s names too', async () => {
  const { dir, as } = await fresh()
  try {
    // The chat that sends its whole title is the chat of the list; its ask's Owner is the list's name.
    const asked = await as('Game - Worker 2')({ action: 'ask', of: 'B1', kind: 'decide', text: 'Red or blue?' })
    assert.equal(asked.ok, true, asked.why)
    assert.equal(valueOf(await item(dir, 'Q1'), 'Owner'), 'Worker 2')
    // A note to the main chat by its name is a note to main.
    const noted = await as('Partner')({ action: 'note', to: 'Game - Main', text: 'Queue for G6: B1' })
    assert.equal(noted.ok, true, noted.why)
    assert.equal(valueOf(await item(dir, 'N1'), 'To'), 'main')
    // A rename: the old name may be gone from the list; the new one is the list's.
    const renamed = await as('Main')({ action: 'rename', from: 'Game - Worker 2', to: 'game - worker 3' })
    assert.equal(renamed.ok, true, renamed.why)
    assert.equal(valueOf(await item(dir, 'Q1'), 'Owner'), 'Worker 3')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an Owner already written as prefix + a known name counts as that name: its next, its take, its delivery', async () => {
  const { dir, as, ctx } = await fresh()
  try {
    const step = await item(dir, 'B1')
    step.head.set('State', 'queued')
    step.head.set('Owner', 'Game - Worker 2')
    await writeFile(join(dir, 'B1.md'), serializeItem(step))
    const store = await readStore(dir)
    const plan = reconcile({ store, lanes: [{ name: 'Worker 2', state: 'free', isRunning: true }], now: NOW, times: { graceMs: 600_000, askMs: 3_600_000, idleMs: 1_800_000 }, prefix: ctx.prefix })
    assert.deepEqual(plan.deliveries.map(one => [one.id, one.chat]), [['B1', 'Worker 2']])
    assert.match((await as('Worker 2')({ action: 'next' })).result.text, /B1 queued/)
    const taken = await as('Worker 2')({ action: 'take', id: 'B1', branch: 'b1-damage' })
    assert.equal(taken.ok, true, taken.why)
    assert.equal(valueOf(await item(dir, 'B1'), 'State'), 'in progress')
    // Repaired once its chat takes it: the list's name.
    assert.equal(valueOf(await item(dir, 'B1'), 'Owner'), 'Worker 2')
    assert.ok(parseItem(serializeItem(await item(dir, 'B1'))) !== null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
