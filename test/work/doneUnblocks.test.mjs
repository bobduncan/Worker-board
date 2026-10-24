// B574 (X25): a step that goes to done leaves the Blocked by of every open step naming it in the same move, so the
// board's sync check unblocks only what that missed. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 24, 21, 5).getTime()
const BACKLOG = [
  '# Backlog',
  '',
  '## Board work',
  '- [ ] B1 Draw the strip (for Board; about 1 h)',
  '- [ ] B2 Keep the cards apart (for Board; after B1; about 30 min)',
  '- [ ] B3 Build the menu (for Support; about 2 h)',
  '- [ ] B4 Polish the menu (for Support; about 1 h)',
  '',
].join('\n')
const ROLES = { Main: 'main', Board: 'worker', Support: 'worker' }

test('a step that goes done leaves its dependants\' Blocked by in the same move, by the board\'s check and by the person\'s tick', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'done-unblocks-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: '', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board', 'Support']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  const [main, board] = [as('Main'), as('Board')]
  const server = body => workApi(body, { ...ctx, as: 'server' })
  const person = body => workApi(body, { ...ctx, as: 'person' })
  const read = async id => (await readStore(dir)).items.get(id)
  const blockedBy = async id => valueOf(await read(id), 'Blocked by')
  const last = async id => (await read(id)).sections.get('History').at(-1)

  // B4 waits on B1 and B3; B2 on B1 alone.
  assert.equal((await main({ action: 'block', id: 'B4', on: 'B1' })).ok, true)
  assert.equal((await main({ action: 'block', id: 'B4', on: 'B3' })).ok, true)
  assert.equal(await blockedBy('B2'), 'B1')
  assert.equal(await blockedBy('B4'), 'B1 and B3')

  await board({ action: 'take', id: 'B1', branch: 'b1-strip' })
  assert.equal((await board({ action: 'report', id: 'B1', result: 'The strip shows.', merged: 'abc1234' })).ok, true)
  // In review: still blocking (the sync check frees it once its check passed).
  assert.equal(await blockedBy('B2'), 'B1')
  assert.equal((await server({ action: 'check', id: 'B1', passed: true, lines: ['branch gone'] })).ok, true)
  assert.equal(valueOf(await read('B1'), 'State'), 'done')
  assert.equal(await blockedBy('B2'), null)
  assert.equal(await last('B2'), '- 2026-10-24 21:06 server: no longer blocked by B1: done')
  assert.equal(await blockedBy('B4'), 'B3')
  assert.equal(await last('B4'), '- 2026-10-24 21:06 server: no longer blocked by B1: done')
  // The freed step can be taken at once.
  assert.equal((await board({ action: 'take', id: 'B2' })).ok, true)

  // The person ticks B3 done: B4 is free too.
  assert.equal((await person({ action: 'tick', id: 'B3' })).ok, true)
  assert.equal(await blockedBy('B4'), null)
  assert.equal(await last('B4'), '- 2026-10-24 21:06 server: no longer blocked by B3: done')
})
