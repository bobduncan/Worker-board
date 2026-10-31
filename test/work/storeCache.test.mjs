// B741: the store keeps the item files parsed in memory and reads anew only the files that are new, changed or gone.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { parseItem, valueOf } from '../../src/work/item.mjs'
import { parsedCount, readStore, removeItem, writeItem } from '../../src/work/store.mjs'

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
  const dir = await withStore(t)
  await readStore(dir)
  await writeFile(join(dir, 'B3.md'), step('B3', 'Step 3 changed by hand', 'done'))
  const { store, parsed } = await readCounting(dir)
  assert.equal(parsed, 1)
  assert.equal(valueOf(store.items.get('B3'), 'State'), 'done')
  assert.equal(valueOf(store.items.get('B3'), 'Title'), 'Step 3 changed by hand')
})

test('a file put back with an older time and the same size is read anew', async t => {
  const dir = await withStore(t)
  const file = join(dir, 'B2.md')
  const was = await stat(file)
  await readStore(dir)
  await writeFile(file, step('B2', 'Step 9'))
  assert.equal((await stat(file)).size, was.size)
  const older = new Date(was.mtimeMs - 86_400_000)
  await utimes(file, older, older)
  const { store, parsed } = await readCounting(dir)
  assert.equal(parsed, 1)
  assert.equal(valueOf(store.items.get('B2'), 'Title'), 'Step 9')
})

test('a new step shows at once; a removed file is gone; a removed and made again id is the new file', async t => {
  const dir = await withStore(t)
  await readStore(dir)
  await writeFile(join(dir, 'B6.md'), step('B6', 'New'))
  await rm(join(dir, 'B1.md'))
  const { store, parsed } = await readCounting(dir)
  assert.equal(parsed, 1)
  assert.deepEqual([...store.items.keys()], ['B2', 'B3', 'B4', 'B5', 'B6'])
  await writeFile(join(dir, 'B1.md'), step('B1', 'Back again'))
  assert.equal(valueOf((await readStore(dir)).items.get('B1'), 'Title'), 'Back again')
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
