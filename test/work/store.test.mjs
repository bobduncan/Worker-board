import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { backlogText, storeProblems } from '../../src/work/adapter.mjs'

import { parseItem, valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { appendHistory, nextId, readStore, writeItem, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const LATER = new Date(2026, 9, 17, 12, 30).getTime()
const folder = () => mkdtemp(join(tmpdir(), 'work-store-'))
const BACKLOG = '# Backlog\n\n## Board #focus\n  A note of the activity.\n- [ ] B1 Draw the strip (for Board; after B2; about 1 h)\n  Plan: plans/strip.md\n- [x] B2 Read the store (for Board; about 2 h)\n  Done on 2026-10-16 by the person: merged.\n'

test('readStore reads every item and names a broken head by file and line, the item still listed as it is', async () => {
  const dir = await folder()
  try {
    await writeFile(join(dir, 'B1.md'), 'Id: B1\nKind: step\nTitle: One\nState: queued\nSince: -\n')
    await writeFile(join(dir, 'B2.md'), 'Id: B2\nKind: step\nOwner Support\nState: new\n\n## Context\n  a line\n')
    await writeFile(join(dir, 'N3.md'), 'Id: N3\nKind: note\nState: unread\nSince: -\nOwner: Board\n')
    await writeFile(join(dir, 'notes.txt'), 'not an item')
    const store = await readStore(dir)
    assert.deepEqual([...store.items.keys()].sort(), ['B1', 'B2', 'N3'])
    assert.equal(valueOf(store.items.get('B2'), 'Kind'), 'step')
    assert.deepEqual(store.problems, [
      { file: 'B2.md', line: 'B2.md: line 3 is no head line: "Owner Support"' },
      { file: 'N3.md', line: 'N3.md: Owner is no key of a note' },
      // B301: without activities.json no step is listed under an activity: that is a problem too.
      { file: 'activities.json', line: 'activities.json is missing, so no step is listed' },
    ])
    assert.deepEqual(store.flow.step.states.at(-1), 'dropped')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a store folder that is not there reads as not there; B301: one that cannot be read throws, so the board says so', async () => {
  const store = await readStore(join(tmpdir(), 'no-such-store-folder-b296'))
  assert.equal(store.items.size, 0)
  assert.equal(store.exists, false)
  assert.deepEqual(store.problems, [])
  const dir = await folder()
  try {
    await writeFile(join(dir, 'work'), 'a file, no folder')
    await assert.rejects(readStore(join(dir, 'work')), error => ['ENOTDIR', 'EEXIST', 'EINVAL'].includes(error.code))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('nextId never gives an id at or below last-ids.json, also when the file was deleted', async () => {
  const dir = await folder()
  try {
    await writeFile(join(dir, 'B7.md'), 'Id: B7\nKind: step\nState: new\nSince: -\n')
    assert.equal(await nextId(dir, 'B'), 'B8')
    assert.equal(await nextId(dir, 'B'), 'B9')
    await rm(join(dir, 'B7.md'))
    assert.equal(await nextId(dir, 'B'), 'B10')
    assert.equal(await nextId(dir, 'Q'), 'Q1')
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'last-ids.json'), 'utf8')), { B: 10, Q: 1 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('writeItem writes beside and puts in place; a concurrent change of another file stays', async () => {
  const dir = await folder()
  try {
    const item = parseItem('Id: B4\nKind: step\nTitle: Four\nState: new\nSince: -\n')
    assert.deepEqual(await writeItem(dir, item), { ok: true, changed: true })
    const before = await readFile(join(dir, 'B4.md'), 'utf8')
    await writeFile(join(dir, 'B5.md'), 'Id: B5\nKind: step\nState: new\nSince: -\n')
    const moved = appendHistory(item, 'server', 'moved', NOW)
    assert.deepEqual(await writeItem(dir, moved, undefined, { expected: before }), { ok: true, changed: true })
    assert.equal(await readFile(join(dir, 'B5.md'), 'utf8'), 'Id: B5\nKind: step\nState: new\nSince: -\n')
    assert.match(await readFile(join(dir, 'B4.md'), 'utf8'), /## History\n- 2026-10-17 11:05 server: moved\n$/)
    // A file that changed since the caller read it is not written over.
    assert.deepEqual(await writeItem(dir, item, undefined, { expected: before }), { ok: false, why: 'B4.md changed in the meantime' })
    assert.deepEqual(await writeItem(dir, moved), { ok: true, changed: false })
    assert.deepEqual((await readdir(dir)).sort(), ['B4.md', 'B5.md'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('writeStore writes only the files whose text changed, keeps Since while the state stays, and never deletes', async () => {
  const dir = await folder()
  try {
    const first = await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
    assert.deepEqual(first.written.sort(), ['B1', 'B2', 'activities.json', 'last-ids.json'])
    const again = await writeStore(dir, migrateBacklog(BACKLOG, { now: LATER }), undefined, { now: LATER })
    assert.deepEqual(again.written, [])
    const moved = await writeStore(dir, migrateBacklog(BACKLOG.replace('- [ ] B1', '- [x] B1'), { now: LATER }), undefined, { now: LATER })
    assert.deepEqual(moved.written, ['B1'])
    const b1 = parseItem(await readFile(join(dir, 'B1.md'), 'utf8'))
    assert.equal(valueOf(b1, 'Since'), '2026-10-17 12:30')
    assert.deepEqual(b1.sections.get('History'), ['- 2026-10-17 11:05 server: migrated from the backlog', '- 2026-10-17 12:30 server: queued → done (the backlog says so)'])
    const gone = await writeStore(dir, migrateBacklog(BACKLOG.replace(/- \[x\] B2[^\n]*\n[^\n]*\n/, ''), { now: LATER }), undefined, { now: LATER })
    assert.deepEqual(gone.problems, ['B2: in the store, but no longer on the backlog'])
    assert.ok((await readdir(dir)).includes('B2.md'))
    assert.equal((await readdir(dir)).includes('truth.json'), false)
    const store = await readStore(dir)
    assert.deepEqual(store.activities.map(one => one.steps), [['B1']])
    assert.deepEqual(store.activities[0].notes, ['  A note of the activity.'])
    assert.deepEqual(store.lastIds, { B: 2 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the example store reads without a problem and gives a backlog back', async () => {
  const store = await readStore(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples', 'work'))
  assert.deepEqual(store.problems, [])
  assert.deepEqual(storeProblems(store.items, store.activities), [])
  assert.deepEqual(backlogText(store.items, store.activities, store.preamble).split('\n'), [
    '# Backlog',
    '',
    '## The board #focus',
    '- [ ] B12 Show the state of each step as a strip (for Board; about 2 h) (branch b12-state-strip)',
    // B297: what the line cannot say stands in one line of the store's own.
    '  [store] Goal: G4 · Refined: ready',
    '  Touches: public/board.js, src/state.mjs',
    '- [ ] B13 Count the items of the store on the Backlog tab (for Board; after B12; about 30 min)',
    "  One line under the tab's head: how many items, and whether the store says what the backlog says.",
    '',
  ])
})
