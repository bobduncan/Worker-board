// B296: the independent review's findings on increment 1, each pinned. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseBacklog } from '../../src/backlog.mjs'
import { storeAsBacklog } from '../../src/work/adapter.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { nextId, readStore, writeStore } from '../../src/work/store.mjs'

const T1 = new Date(2026, 9, 17, 11, 5).getTime()
const T2 = new Date(2026, 9, 17, 12, 30).getTime()
const folder = () => mkdtemp(join(tmpdir(), 'work-review-'))
const byTitle = (items, title) => [...items.values()].find(item => valueOf(item, 'Title') === title)

test('1. a step without an id keeps its own id when another is put above it; no history moves between steps', async () => {
  const dir = await folder()
  try {
    const before = '## Old\n- [x] Get a review\n- [ ] Tidy the folder\n'
    const first = migrateBacklog(before, { now: T1 })
    const ids = [...first.items.keys()]
    assert.ok(ids.every(id => /^L-[0-9a-f]{8}$/.test(id)), ids.join(', '))
    await writeStore(dir, first, undefined, { now: T1 })
    const after = '## Old\n- [ ] A new step on top\n- [x] Get a review\n- [ ] Tidy the folder\n'
    const second = migrateBacklog(after, { now: T2 })
    assert.equal(valueOf(byTitle(second.items, 'Get a review'), 'Id'), ids[0])
    assert.equal(valueOf(byTitle(second.items, 'Tidy the folder'), 'Id'), ids[1])
    const done = await writeStore(dir, second, undefined, { now: T2 })
    assert.equal(done.written.filter(name => name.startsWith('L-')).length, 1)
    for (const id of ids) {
      const item = parseItem(await readFile(join(dir, `${id}.md`), 'utf8'))
      assert.equal(valueOf(item, 'Since'), '2026-10-17 11:05', id)
      assert.deepEqual(item.sections.get('History'), ['- 2026-10-17 11:05 server: migrated from the backlog'], id)
    }
    // An id-less step that left the backlog: its file only ever held a copy of its line, so it goes; no problem.
    const gone = await writeStore(dir, migrateBacklog('## Old\n- [ ] A new step on top\n- [ ] Tidy the folder\n', { now: T2 }), undefined, { now: T2 })
    assert.deepEqual(gone.problems, [])
    assert.ok(!(await readdir(dir)).includes(`${ids[0]}.md`))
    assert.deepEqual((await readStore(dir)).problems, [])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('1. two id-less steps with the same words each get an id of their own, and parity holds', () => {
  const text = '## A\n- [ ] Same words\n- [ ] Same words\n- [ ] B1 One\n- [ ] B1 Again\n'
  const migrated = migrateBacklog(text, { now: T1 })
  assert.equal(migrated.items.size, 4)
  assert.equal(migrated.problems.length, 1)
  assert.match(migrated.problems[0], /^B1 stands twice on the backlog \(line 5\): the second is kept as L-[0-9a-f]{8}$/)
  assert.deepEqual(storeAsBacklog(migrated.items, migrated.activities), parseBacklog(text))
})

test('2. nextId hands out every id once, also when asked six times at once', async () => {
  const dir = await folder()
  try {
    const ids = await Promise.all(Array.from({ length: 6 }, () => nextId(dir, 'Q')))
    assert.deepEqual([...ids].sort(), ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'])
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'last-ids.json'), 'utf8')), { Q: 6 })
    assert.deepEqual((await readdir(dir)).filter(name => name.endsWith('.claim')), [])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('2. a broken last-ids.json gives no id back: its readable values and the files count, and it is never lowered', async () => {
  const dir = await folder()
  try {
    await writeFile(join(dir, 'last-ids.json'), '{"B": 40, "Q": 3,')
    await writeFile(join(dir, 'B7.md'), 'Id: B7\nKind: step\nState: new\nSince: -\n')
    assert.equal(await nextId(dir, 'B'), 'B41')
    await writeFile(join(dir, 'last-ids.json'), '{"B": 50, broken')
    await writeStore(dir, migrateBacklog('## A\n- [ ] B7 Seven\n', { now: T1 }), undefined, { now: T1 })
    const last = JSON.parse(await readFile(join(dir, 'last-ids.json'), 'utf8'))
    assert.equal(last.B, 50)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('4. a note that reads like the mark of a refine block is kept', () => {
  const text = '## A\n- [ ] B1 One\n  (the refine block stands under ## Refined)\n  More.\n'
  const migrated = migrateBacklog(text, { now: T1 })
  assert.deepEqual(storeAsBacklog(migrated.items, migrated.activities), parseBacklog(text))
})
