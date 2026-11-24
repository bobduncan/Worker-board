// B49: the main chat corrects a step's Touches line, so a line written too wide stops holding another step. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { DEFAULT_FLOW, mayMove } from '../../src/work/flow.mjs'
import { touchesOf } from '../../src/work/guards.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { readStore, share, writeItem } from '../../src/work/store.mjs'

share.ms = 0
const NOW = new Date(2026, 10, 22, 23, 0).getTime()
const ROLES = { Main: 'main', Units: 'worker', Advisor: 'advisor' }
const step = (id, state, body, extra = [], more = []) => parseItem([`Id: ${id}`, 'Kind: step', `Title: Step ${id}`, `State: ${state}`, 'Since: 2026-11-22 22:00', ...extra, '', '## Context', ...body, '', ...more, '## History', '- 2026-11-22 22:00 Main: made', ''].join('\n'))

async function board(items) {
  const dir = await mkdtemp(join(tmpdir(), 'work-touches-'))
  for (const item of items) assert.equal((await writeItem(dir, item, undefined, { expected: null })).ok, true)
  const ctx = { dir, now: NOW, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, overlapsOfStore: true }
  return {
    dir,
    as: chat => body => workApi({ chat, action: 'touches', ...body }, ctx),
    person: body => workApi({ action: 'touches', ...body }, { ...ctx, as: 'person' }),
    read: async id => (await readStore(dir)).items.get(id),
  }
}

const WIDE = '  Touches: src/content/arenas/, docs/game-design.md'

test('B49: the main chat replaces the line in place; History has old, new and why; nothing else changes', async () => {
  const b = await board([step('B1', 'in progress', ['  What it does.', WIDE, '  More words.', '  Touches: tools/old.mjs'], ['Owner: Units'])])
  try {
    const before = await b.read('B1')
    const done = await b.as('Main')({ id: 'B1', text: 'src/content/layouts/world2/, docs/game-design.md', why: 'it only adds world2' })
    assert.equal(done.ok, true, done.why)
    const after = await b.read('B1')
    assert.deepEqual(after.sections.get('Context').filter(one => one.trim() !== ''), ['  What it does.', '  Touches: src/content/layouts/world2/, docs/game-design.md', '  More words.'])
    assert.deepEqual(touchesOf(after).map(one => one.path), ['src/content/layouts/world2', 'docs/game-design.md'])
    const last = after.sections.get('History').at(-1)
    assert.ok(last.includes('"src/content/arenas/, docs/game-design.md; tools/old.mjs" → "src/content/layouts/world2/, docs/game-design.md" (it only adds world2)'), last)
    for (const key of ['State', 'Owner', 'Title']) assert.equal(valueOf(after, key), valueOf(before, key))
  } finally { await rm(b.dir, { recursive: true, force: true }) }
})

test('B49: a Touches section and a step without a line become the one line in Context', async () => {
  const b = await board([step('B1', 'refined', ['  Words.'], [], ['## Touches', 'src/wide/', '']), step('B2', 'new', ['  Words.'])])
  try {
    assert.deepEqual(touchesOf(await b.read('B1')).map(one => one.path), ['src/wide'])
    const done = await b.as('Main')({ id: 'B1', text: 'Touches: src/narrow.mjs', why: 'narrower' })
    assert.equal(done.ok, true, done.why)
    const one = await b.read('B1')
    assert.equal(one.sections.has('Touches'), false)
    assert.deepEqual(touchesOf(one).map(two => two.path), ['src/narrow.mjs'])
    assert.equal((await b.as('Main')({ id: 'B2', text: 'src/first.mjs', why: 'it had none' })).ok, true)
    assert.ok((await b.read('B2')).sections.get('History').at(-1).includes('"(none)" → "src/first.mjs"'))
  } finally { await rm(b.dir, { recursive: true, force: true }) }
})

test('B49: refused for a done or dropped step, any chat but main, the person, no why and a line with no path', async () => {
  const b = await board([step('B1', 'done', [WIDE]), step('B2', 'dropped', [WIDE]), step('B3', 'in progress', [WIDE], ['Owner: Units'])])
  try {
    const ok = { text: 'src/narrow.mjs', why: 'narrower' }
    assert.equal((await b.as('Main')({ id: 'B1', ...ok })).status, 409)
    assert.equal((await b.as('Main')({ id: 'B2', ...ok })).status, 409)
    for (const other of [b.as('Units'), b.as('Advisor'), b.person]) assert.equal((await other({ id: 'B3', ...ok })).status, 403)
    assert.equal((await b.as('Main')({ id: 'B3', text: 'src/narrow.mjs' })).status, 400)
    for (const text of ['', '   ', 'tests/', 'test', 'Touches:', 'the words of nothing here']) {
      assert.equal((await b.as('Main')({ id: 'B3', text, why: 'x' })).status, 400, text)
    }
    assert.ok((await b.read('B3')).sections.get('Context').includes(WIDE))
  } finally { await rm(b.dir, { recursive: true, force: true }) }
})

test('B49: the step that waited on the false overlap may go out at the next hand-out', async () => {
  const b = await board([
    step('B41', 'in progress', ['  Touches: src/content/arenas/, src/content/worldMaps.ts'], ['Owner: Units']),
    step('B10', 'refined', ['  Touches: src/content/arenas/warmup.json'], ['Refined: ready']),
  ])
  const give = async () => {
    const { items } = await readStore(b.dir)
    return mayMove(DEFAULT_FLOW, items.get('B10'), 'queued', 'server', { store: { items } })
  }
  try {
    const held = await give()
    assert.equal(held.ok, false)
    assert.ok(held.why.includes('B41 is in progress'), held.why)
    assert.equal((await b.as('Main')({ id: 'B41', text: 'src/content/layouts/world2/, src/content/worldMaps.ts', why: 'it only adds world2' })).ok, true)
    const free = await give()
    assert.equal(free.ok, true, free.why)
  } finally { await rm(b.dir, { recursive: true, force: true }) }
})
