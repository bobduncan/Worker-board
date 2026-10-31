// B867 (fix of B741, its result check: a 'note' read the folder 3 times): a work call reads the store once. Its first
// read lists the folder with stats; its view, recap, the close of fixes and its new id take that listing and read anew
// only the item files the call wrote or removed. After the call a read is whole again. Made-up samples only.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { nextId, oneRead, parsedCount, readStore, removeItem, writeItem } from '../../src/work/store.mjs'

const step = (id, title, state = 'queued') => `Id: ${id}\nKind: step\nTitle: ${title}\nState: ${state}\nSince: -\nActivity: Garden\n`
const activities = '{ "preamble": [], "activities": [{ "name": "Garden", "steps": ["B1", "B2", "B3", "B4", "B5"] }] }\n'

/** A store of five steps, and an fs that counts its folder reads and stats (a fresh one: nothing kept in memory yet). */
async function garden(t) {
  const dir = await mkdtemp(join(tmpdir(), 'one-read-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'activities.json'), activities)
  for (let n = 1; n <= 5; n += 1) await writeFile(join(dir, `B${n}.md`), step(`B${n}`, `Step ${n}`))
  const count = { readdir: 0, stat: 0 }
  const fs = {
    readFile, writeFile, rename, rm, mkdir, open,
    readdir: (...args) => {
      count.readdir += 1
      return readdir(...args)
    },
    stat: (...args) => {
      count.stat += 1
      return stat(...args)
    },
  }
  return { dir, fs, count }
}

test('a note reads the folder once: its new id and its view take the call\'s read', async t => {
  const { dir, fs, count } = await garden(t)
  const viewFile = join(dir, '..', `${dir.split(/[\\/]/).at(-1)}-backlog.md`)
  t.after(() => rm(viewFile, { force: true }))
  const ctx = { dir, fs, viewFile, now: Date.UTC(2026, 9, 31, 12), roleOf: chat => (chat === 'Digger' ? 'worker' : null), freeChats: new Set() }
  const done = await workApi({ chat: 'Digger', action: 'note', to: 'you', text: 'The hedge is planted.' }, ctx)
  assert.equal(done.ok, true, done.why)
  assert.equal(done.result.view, 'written')
  assert.equal(count.readdir, 1)
  assert.equal(count.stat, 5)
  // The note the call made stands in the store a whole read gives after it.
  const after = await readStore(dir, fs)
  assert.equal(count.readdir, 2)
  assert.equal(after.items.get(done.result.id)?.head.get('Kind'), 'note')
})

test('within one call a later read takes the first read\'s listing and sees the call\'s own writes, new, changed and gone', async t => {
  const { dir, fs, count } = await garden(t)
  await oneRead(dir, fs, async () => {
    await readStore(dir, fs)
    assert.deepEqual(count, { readdir: 1, stat: 5 })
    const id = await nextId(dir, 'B', fs)
    assert.equal(id, 'B6')
    assert.equal((await writeItem(dir, parseItem(step(id, 'New')), fs)).ok, true)
    assert.equal((await writeItem(dir, parseItem(step('B2', 'Step 2', 'done')), fs)).ok, true)
    assert.equal((await removeItem(dir, 'B5', fs)).ok, true)
    const before = parsedCount(dir)
    const later = await readStore(dir, fs)
    assert.deepEqual(count, { readdir: 1, stat: 5 })
    // B6 and B2 read anew; B5 looked for and gone.
    assert.equal(parsedCount(dir) - before, 2)
    assert.deepEqual([...later.items.keys()], ['B1', 'B2', 'B3', 'B4', 'B6'])
    assert.equal(valueOf(later.items.get('B2'), 'State'), 'done')
    assert.equal(valueOf(later.items.get('B6'), 'Title'), 'New')
  })
})

test('after the call a read is whole again: a hand edit is seen, also by a read the call left running', async t => {
  const { dir, fs, count } = await garden(t)
  let late
  await oneRead(dir, fs, async () => {
    await readStore(dir, fs)
    late = new Promise(resolve => setTimeout(resolve, 20)).then(async () => {
      await writeFile(join(dir, 'B3.md'), step('B3', 'Step 3 by hand', 'done'))
      return readStore(dir, fs)
    })
  })
  const seen = await late
  assert.equal(count.readdir, 2)
  assert.equal(valueOf(seen.items.get('B3'), 'Title'), 'Step 3 by hand')
  await writeFile(join(dir, 'B4.md'), step('B4', 'Step 4 by hand', 'done'))
  assert.equal(valueOf((await readStore(dir, fs)).items.get('B4'), 'State'), 'done')
  assert.equal(count.readdir, 3)
})

test('a new id while another process holds the claim of the next one: the folder is listed anew, the id after it', async t => {
  const { dir, fs, count } = await garden(t)
  await oneRead(dir, fs, async () => {
    await readStore(dir, fs)
    await writeFile(join(dir, 'B6.claim'), '')
    assert.equal(await nextId(dir, 'B', fs), 'B7')
    assert.equal(count.readdir, 2)
  })
})

test('a call within a call is part of it: one folder read for both', async t => {
  const { dir, fs, count } = await garden(t)
  await oneRead(dir, fs, async () => {
    await readStore(dir, fs)
    await oneRead(dir, fs, () => readStore(dir, fs))
  })
  assert.equal(count.readdir, 1)
})
