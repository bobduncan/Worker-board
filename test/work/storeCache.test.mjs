// B741: the store keeps the item files parsed in memory and reads anew only the files that are new, changed or gone.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { parseItem, valueOf } from '../../src/work/item.mjs'
import { parsedCount, readStore, removeItem, share, writeItem, writeStore } from '../../src/work/store.mjs'

const folder = () => mkdtemp(join(tmpdir(), 'work-cache-'))
const step = (id, title, state = 'queued') => `Id: ${id}\nKind: step\nTitle: ${title}\nState: ${state}\nSince: -\n`
const activities = '{ "preamble": [], "activities": [] }\n'

async function withStore(t, count = 5) {
  const dir = await folder()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'activities.json'), activities)
  for (let n = 1; n <= count; n += 1) await writeFile(join(dir, `B${n}.md`), step(`B${n}`, `Step ${n}`))
  return dir
}

/** B917: the store's clock, moved on by hand: a hand edit is seen once a shared listing's `share.ms` are past. */
function clockOf(t) {
  let at = Date.now()
  const was = share.now
  share.now = () => at
  t.after(() => {
    share.now = was
  })
  return { pass: () => { at += share.ms }, by: ms => { at += ms } }
}

/** The item files the read parsed. */
async function readCounting(dir) {
  const before = parsedCount(dir)
  const store = await readStore(dir)
  return { store, parsed: parsedCount(dir) - before }
}

test('the first read parses every file; a read with nothing changed parses none and gives the same store', async t => {
  const dir = await withStore(t)
  const first = await readCounting(dir)
  assert.equal(first.parsed, 5)
  const again = await readCounting(dir)
  assert.equal(again.parsed, 0)
  assert.deepEqual([...again.store.items.keys()], ['B1', 'B2', 'B3', 'B4', 'B5'])
  assert.deepEqual(again.store.items, first.store.items)
})

test('a step changed by hand outside the board is seen at the next read, and only that file is read', async t => {
  const clock = clockOf(t)
  const dir = await withStore(t)
  await readStore(dir)
  await writeFile(join(dir, 'B3.md'), step('B3', 'Step 3 changed by hand', 'done'))
  clock.pass()
  const { store, parsed } = await readCounting(dir)
  assert.equal(parsed, 1)
  assert.equal(valueOf(store.items.get('B3'), 'State'), 'done')
  assert.equal(valueOf(store.items.get('B3'), 'Title'), 'Step 3 changed by hand')
})

test('a file put back with an older time and the same size is read anew', async t => {
  const clock = clockOf(t)
  const dir = await withStore(t)
  const file = join(dir, 'B2.md')
  const was = await stat(file)
  await readStore(dir)
  await writeFile(file, step('B2', 'Step 9'))
  assert.equal((await stat(file)).size, was.size)
  const older = new Date(was.mtimeMs - 86_400_000)
  await utimes(file, older, older)
  clock.pass()
  const { store, parsed } = await readCounting(dir)
  assert.equal(parsed, 1)
  assert.equal(valueOf(store.items.get('B2'), 'Title'), 'Step 9')
})

test('a new step shows at once; a removed file is gone; a removed and made again id is the new file', async t => {
  const clock = clockOf(t)
  const dir = await withStore(t)
  await readStore(dir)
  await writeFile(join(dir, 'B6.md'), step('B6', 'New'))
  await rm(join(dir, 'B1.md'))
  clock.pass()
  const { store, parsed } = await readCounting(dir)
  assert.equal(parsed, 1)
  assert.deepEqual([...store.items.keys()], ['B2', 'B3', 'B4', 'B5', 'B6'])
  await writeFile(join(dir, 'B1.md'), step('B1', 'Back again'))
  clock.pass()
  assert.equal(valueOf((await readStore(dir)).items.get('B1'), 'Title'), 'Back again')
})

// B917 (X93): the live board read the store 2.4 times a second, each stating every item file.
test('B917: reads within the shared time state the folder once; after it, every file again', async t => {
  const clock = clockOf(t)
  const dir = await withStore(t)
  const { readFile, readdir, stat: realStat } = await import('node:fs/promises')
  const counted = { readFile, readdir, writeFile, rename: (await import('node:fs/promises')).rename, rm, mkdir: (await import('node:fs/promises')).mkdir, open: (await import('node:fs/promises')).open, stats: 0, lists: 0 }
  counted.stat = (...args) => { counted.stats += 1; return realStat(...args) }
  counted.readdir = (...args) => { counted.lists += 1; return readdir(...args) }
  await readStore(dir, counted)
  assert.deepEqual([counted.lists, counted.stats], [1, 5])
  for (let n = 0; n < 10; n += 1) {
    clock.by(100)
    await readStore(dir, counted)
  }
  // The old path: 11 listings and 55 stats.
  assert.deepEqual([counted.lists, counted.stats], [1, 5])
  clock.pass()
  await readStore(dir, counted)
  assert.deepEqual([counted.lists, counted.stats], [2, 10])
})

test('B917: within the shared time every write and remove of the board shows at once; a hand edit once it is past', async t => {
  const clock = clockOf(t)
  const dir = await withStore(t)
  await readStore(dir)
  // The board's own writes: a change, a new item and a remove, each seen by the very next read.
  assert.equal((await writeItem(dir, parseItem(step('B2', 'Step 2', 'done')))).ok, true)
  assert.equal(valueOf((await readStore(dir)).items.get('B2'), 'State'), 'done')
  assert.equal((await writeItem(dir, parseItem(step('B9', 'Made by the board')))).ok, true)
  assert.equal((await readStore(dir)).items.has('B9'), true)
  assert.equal((await removeItem(dir, 'B3')).ok, true)
  assert.equal((await readStore(dir)).items.has('B3'), false)
  // A hand edit: within the shared time the read before it stands, after it the edit shows.
  await readStore(dir)
  await writeFile(join(dir, 'B4.md'), step('B4', 'Step 4 by hand', 'done'))
  clock.by(share.ms - 1)
  assert.equal(valueOf((await readStore(dir)).items.get('B4'), 'State'), 'queued')
  clock.by(1)
  assert.equal(valueOf((await readStore(dir)).items.get('B4'), 'State'), 'done')
})

test('B917: a step without an id that writeStore takes away is gone at the next read within the shared time', async t => {
  clockOf(t)
  const dir = await withStore(t, 2)
  await writeFile(join(dir, 'L-0000abcd.md'), 'Id: L-0000abcd\nKind: step\nTitle: A loose line\nState: queued\nSince: -\n')
  // Written once by writeStore, so the second write changes no item file: only the take-away can drop the listing.
  await writeStore(dir, { items: (await readStore(dir)).items, activities: [] })
  share.now = (now => () => now)(share.now() + share.ms)
  const first = await readStore(dir)
  assert.equal(first.items.has('L-0000abcd'), true)
  const items = new Map([...first.items].filter(([id]) => id !== 'L-0000abcd'))
  await writeStore(dir, { items, activities: [] })
  assert.equal((await readStore(dir)).items.has('L-0000abcd'), false)
})

test('B917: a read the board wrote under while it stated the folder does not share what it saw', async t => {
  const clock = clockOf(t)
  const dir = await withStore(t)
  const { readFile, readdir, stat: realStat, rename, mkdir, open } = await import('node:fs/promises')
  let lists = 0
  let writeNow = false
  // The board writes B1 between a read's listing and its stats, when `writeNow` says so.
  const fs = { readFile, writeFile, rename, rm, mkdir, open, stat: realStat, readdir: async (...args) => {
    lists += 1
    const names = await readdir(...args)
    if (writeNow) {
      writeNow = false
      assert.equal((await writeItem(dir, parseItem(step('B1', 'Step 1', 'done')), fs)).ok, true)
    }
    return names
  } }
  await readStore(dir, fs)
  clock.pass()
  writeNow = true
  await readStore(dir, fs)
  // That read kept nothing to share: the next one lists and states anew, and sees the write.
  const next = await readStore(dir, fs)
  assert.equal(lists, 3)
  assert.equal(valueOf(next.items.get('B1'), 'State'), 'done')
})

test('a dropped step shows dropped at once: the board\'s own write and remove reach the next read', async t => {
  const dir = await withStore(t)
  const first = await readStore(dir)
  const dropped = parseItem(step('B4', 'Step 4', 'dropped'))
  assert.equal((await writeItem(dir, dropped)).ok, true)
  assert.equal(valueOf((await readStore(dir)).items.get('B4'), 'State'), 'dropped')
  assert.equal((await removeItem(dir, 'B5')).ok, true)
  assert.equal((await readStore(dir)).items.has('B5'), false)
  assert.equal(valueOf(first.items.get('B4'), 'State'), 'queued')
})

test('a broken file stays in problems on every read, also when it is not read anew', async t => {
  const dir = await withStore(t, 2)
  await writeFile(join(dir, 'B7.md'), 'Id: B7\nKind: step\nOwner Support\nState: new\n')
  await writeFile(join(dir, 'B8.md'), step('B1', 'Wrong file'))
  const expected = [
    { file: 'B7.md', line: 'B7.md: line 3 is no head line: "Owner Support"' },
    { file: 'B8.md', line: 'B8.md: its Id is B1, its file B8.md' },
    { file: 'B8.md', line: 'B8.md: the id B1 stands twice' },
  ]
  assert.deepEqual((await readStore(dir)).problems, expected)
  const { store, parsed } = await readCounting(dir)
  assert.equal(parsed, 0)
  assert.deepEqual(store.problems, expected)
})

test('a change made to a read item does not reach the next read', async t => {
  const dir = await withStore(t, 1)
  const first = await readStore(dir)
  first.items.get('B1').head.set('State', 'done')
  first.items.get('B1').sections.set('History', ['- a line'])
  const again = await readStore(dir)
  assert.equal(valueOf(again.items.get('B1'), 'State'), 'queued')
  assert.equal(again.items.get('B1').sections.has('History'), false)
})

test('pause.json and activities.json are read on every read: a pause and a new order are seen at once', async t => {
  const dir = await withStore(t, 1)
  assert.equal((await readStore(dir)).pause, null)
  await writeFile(join(dir, 'pause.json'), '{"state":"pausing","since":1,"by":"person"}\n')
  await writeFile(join(dir, 'activities.json'), '{ "preamble": [], "activities": [{ "name": "Board", "steps": ["B1"] }] }\n')
  const store = await readStore(dir)
  assert.equal(store.pause?.state, 'pausing')
  assert.deepEqual(store.activities.map(one => one.name), ['Board'])
})

test('a board restart reads every file again', async t => {
  const dir = await withStore(t, 3)
  await readStore(dir)
  const url = pathToFileURL(join(import.meta.dirname, '../../src/work/store.mjs')).href
  const code = `const s = await import(${JSON.stringify(url)}); const dir = ${JSON.stringify(dir)}; await s.readStore(dir); console.log(s.parsedCount(dir))`
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim(), '3')
})

test('an fs without stat (a test\'s) parses every file on every read, as before', async t => {
  const dir = await withStore(t, 2)
  const { readFile, readdir } = await import('node:fs/promises')
  const fs = { readFile, readdir }
  const before = parsedCount(dir)
  await readStore(dir, fs)
  await readStore(dir, fs)
  assert.equal(parsedCount(dir) - before, 4)
})
