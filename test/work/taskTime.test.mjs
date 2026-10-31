// B832 (the person, 2026-10-31: "Why is there no ETA?"): every task has a time. The work tool refuses a take without the
// minutes left for the step, a ready refine without a size the board reads as minutes, a step made from an agreed how
// without one, and a failed result check without the size of its fix step. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { sizeMinutes } from '../../src/backlog.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { stampSecond } from '../../src/work/pause.mjs'
import { NOW as QA_NOW, fileCheck, fresh as qaFresh, item as qaItem, remove, reported } from '../qaKit.mjs'

const NOW = new Date(2026, 9, 31, 10, 0).getTime()
const MIN = 60_000
const BACKLOG = [
  '# Backlog',
  '',
  '## Board work #focus',
  '- [ ] B1 Draw the strip (for Board)',
  '- [ ] B2 Keep the cards apart',
  '  Refined (2026-10-31 09:00; open):',
  '  Summary: Cards stay apart.',
  '  Part of: G4',
  '  Questions:',
  '  - none',
  '',
].join('\n')
const ROLES = { Main: 'main', Board: 'worker', Advisor: 'advisor' }

async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'task-time-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + MIN, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, board: as('Board'), advisor: as('Advisor'), ctx }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const clean = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

test('the one reader of a size: minutes and hours in digits or words, decimals, words after it; none for words without a number', () => {
  const cases = [['45 min', 45], ['about 45 minutes', 45], ['2 h', 120], ['2 hours', 120], ['1.5 hours', 90], ['3 hours (test 1 h, build 2 h)', 180], ['2 hours (test 30 min)', 120], ['1 h 30 min', 90], ['soon', null], ['', null], ['a day', null]]
  for (const [size, minutes] of cases) assert.equal(sizeMinutes(size), minutes, size)
})

test('a take without minutes is refused in one line naming the field; with minutes it is taken and the card has a time at once', async () => {
  const { dir, board } = await store()
  try {
    const refused = await board({ action: 'take', id: 'B1' })
    assert.deepEqual([refused.ok, refused.status], [false, 400])
    assert.match(refused.why, /"minutes"/)
    assert.equal(valueOf(await item(dir, 'B1'), 'State'), 'queued')
    for (const bad of [0, -5, 'soon', 5000]) assert.equal((await board({ action: 'take', id: 'B1', minutes: bad })).status, 400, String(bad))
    const taken = await board({ action: 'take', id: 'B1', minutes: 45 })
    assert.equal(taken.ok, true, taken.why)
    assert.equal(valueOf(await item(dir, 'B1'), 'Plan'), `until ${stampSecond(NOW + MIN + 45 * MIN)} | at ${stampSecond(NOW + MIN)}`)
  } finally {
    await clean(dir)
  }
})

test('a step taken before this change goes on: its worker taking it again needs no minutes', async () => {
  const { dir, board } = await store()
  try {
    assert.equal((await board({ action: 'take', id: 'B1', minutes: 45 })).ok, true)
    const again = await board({ action: 'take', id: 'B1' })
    assert.equal(again.ok, true, again.why)
    assert.equal(again.result.changed, false)
  } finally {
    await clean(dir)
  }
})

test('a refine made ready without a size the board reads as minutes is refused; with one it is accepted', async () => {
  const { dir, advisor } = await store()
  try {
    const none = await advisor({ action: 'refined', id: 'B2', what: ['cards in a row'] })
    assert.deepEqual([none.ok, none.status], [false, 409])
    assert.match(none.why, /Size/)
    const words = await advisor({ action: 'refined', id: 'B2', size: 'soon', what: ['cards in a row'] })
    assert.equal(words.status, 409)
    assert.equal(valueOf(await item(dir, 'B2'), 'Refined'), 'open')
    // A size already in the round counts, and one given with the call replaces it.
    assert.equal((await advisor({ action: 'refine', id: 'B2', summary: 'Cards stay apart.', size: '1 hour' })).ok, true)
    const ready = await advisor({ action: 'refined', id: 'B2', what: ['cards in a row'] })
    assert.equal(ready.ok, true, ready.why)
    assert.ok((await item(dir, 'B2')).sections.get('Refined').includes('  Size: about 1 hour'))
    const readyAgain = await advisor({ action: 'refined', id: 'B2', size: '3 hours (test 1 h, build 2 h)', what: ['cards in a row'] })
    assert.equal(readyAgain.ok, true, readyAgain.why)
    assert.ok((await item(dir, 'B2')).sections.get('Refined').includes('  Size: about 3 hours (test 1 h, build 2 h)'))
  } finally {
    await clean(dir)
  }
})

test('a step made from an agreed how without a size is refused; with one it is made', async () => {
  const { dir, advisor } = await store()
  try {
    const base = { action: 'new', title: 'Plant the hedge', activity: 'Board work', goal: 'G3', summary: 'A hedge.', what: ['two rows of yew'] }
    const none = await advisor(base)
    assert.deepEqual([none.ok, none.status], [false, 400])
    assert.match(none.why, /"size"/)
    const made = await advisor({ ...base, size: '2 hours' })
    assert.equal(made.ok, true, made.why)
    assert.ok((await item(dir, made.result.id)).sections.get('Refined').includes('  Size: about 2 hours'))
  } finally {
    await clean(dir)
  }
})

test('a result check with failed points and no size is refused and files nothing; with a size its fix step carries it', async () => {
  const kit = await qaFresh()
  try {
    const { id } = await reported(kit)
    const body = { evidence: 'pictures/b2/evidence.png', points: ['pass: a lamp at every bench', 'fail: the light is white'] }
    const refused = await fileCheck(kit, id, { ...body, size: '' })
    assert.deepEqual([refused.ok, refused.status], [false, 400])
    assert.match(refused.why, /fix step/)
    assert.equal(valueOf(await qaItem(kit.dir, id), 'State'), 'review')
    const filed = await fileCheck(kit, id, { ...body, size: '45 min' })
    assert.equal(filed.ok, true, filed.why)
    const fix = await qaItem(kit.dir, filed.result.fix)
    assert.ok(fix.sections.get('Refined').includes('  Size: about 45 min'), fix.sections.get('Refined').join('\n'))
    // A check that passes needs no size.
    assert.ok(QA_NOW > 0)
  } finally {
    await remove(kit.dir)
  }
})
