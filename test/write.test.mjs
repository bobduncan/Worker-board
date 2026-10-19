// B406: the board's writes. A file is written beside and put in place (flushed first, tried again while Windows holds
// it), so a cut-off write leaves the old file whole; an appended record starts on a line of its own; and a kept file
// torn by a restart or a power cut is set aside at the start instead of stopping the board. Made-up samples only.

import assert from 'node:assert/strict'
import { appendFile, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { again, appendLines, readKept, writeAtomic } from '../src/write.mjs'
import { tempDir } from './tempDir.mjs'

const real = { open, writeFile, rename, rm, readFile, appendFile }
const busy = code => Object.assign(new Error(code), { code })

test('writeAtomic writes the whole file and leaves nothing beside it', async t => {
  const dir = await tempDir(t)
  const file = join(dir, 'llama-times.json')
  await writeAtomic(file, '{"alpacas":1}\n')
  await writeAtomic(file, '{"alpacas":2}\n')
  assert.equal(await readFile(file, 'utf8'), '{"alpacas":2}\n')
  assert.deepEqual(await readdir(dir), ['llama-times.json'])
})

test('a write cut off mid-way leaves the old file whole, and nothing beside it', async t => {
  const dir = await tempDir(t)
  const file = join(dir, 'wombats.json')
  await writeFile(file, '{"old":true}')
  // Cut off while the new text is written.
  const cut = { ...real, open: async (path, flags) => { const handle = await open(path, flags); return { ...handle, close: () => handle.close(), sync: () => handle.sync(), writeFile: async data => { await handle.writeFile(String(data).slice(0, 3)); throw busy('EIO') } } } }
  await assert.rejects(writeAtomic(file, '{"new":true}', cut), { code: 'EIO' })
  assert.equal(await readFile(file, 'utf8'), '{"old":true}')
  // Cut off before the new file is put in place.
  const noMove = { ...real, rename: async () => { throw busy('EIO') } }
  await assert.rejects(writeAtomic(file, '{"new":true}', noMove), { code: 'EIO' })
  assert.equal(await readFile(file, 'utf8'), '{"old":true}')
  assert.deepEqual(await readdir(dir), ['wombats.json'])
})

test('a write Windows refuses once with EBUSY goes through on the next try', async t => {
  const dir = await tempDir(t)
  const file = join(dir, 'quokkas.json')
  let refused = 0
  const once = { ...real, rename: async (from, to) => { if (refused++ === 0) throw busy('EBUSY'); return rename(from, to) } }
  await writeAtomic(file, '{"ok":1}', once)
  assert.equal(refused, 2)
  assert.equal(await readFile(file, 'utf8'), '{"ok":1}')
})

test('again tries five times on EPERM, EBUSY and EACCES, and never on anything else', async () => {
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    let tries = 0
    await assert.rejects(again(async () => { tries += 1; throw busy(code) }, { waitMs: 1 }), { code })
    assert.equal(tries, 5)
  }
  let tries = 0
  await assert.rejects(again(async () => { tries += 1; throw busy('ENOENT') }, { waitMs: 1 }), { code: 'ENOENT' })
  assert.equal(tries, 1)
  assert.equal(await again(async () => 'done'), 'done')
})

test('appendLines ends a torn last line first, so the next record stands on a line of its own', async t => {
  const dir = await tempDir(t)
  const file = join(dir, 'outbox.jsonl')
  // Not there yet, then whole lines, then a line torn by a power cut.
  await appendLines(file, '{"id":"a"}\n')
  await appendLines(file, '{"id":"b"}')
  assert.equal(await readFile(file, 'utf8'), '{"id":"a"}\n{"id":"b"}\n')
  await appendFile(file, '{"id":"c","sta')
  await appendLines(file, '{"id":"d"}\n')
  const lines = (await readFile(file, 'utf8')).split('\n')
  assert.deepEqual(lines, ['{"id":"a"}', '{"id":"b"}', '{"id":"c","sta', '{"id":"d"}', ''])
  // An empty file takes the record as it is; nothing to write writes nothing.
  const empty = join(dir, 'history.jsonl')
  await writeFile(empty, '')
  await appendLines(empty, '{"at":1}\n')
  await appendLines(empty, '')
  assert.equal(await readFile(empty, 'utf8'), '{"at":1}\n')
})

test('readKept: a file not there is null; a torn one is set aside as .broken-<time> and the board starts without it', async t => {
  const dir = await tempDir(t)
  const now = new Date(2026, 9, 19, 23, 5, 9).getTime()
  assert.deepEqual(await readKept(join(dir, 'none.json'), now), { value: null, setAside: null })
  await writeFile(join(dir, 'rounds.json'), '{"morning":"2026-10-19"}')
  assert.deepEqual(await readKept(join(dir, 'rounds.json'), now), { value: { morning: '2026-10-19' }, setAside: null })
  for (const torn of ['{"scans":{"s1":{"wor', '']) {
    const file = join(dir, 'task-times.json')
    await writeFile(file, torn)
    const read = await readKept(file, now)
    assert.deepEqual(read, { value: null, setAside: `${file}.broken-20261019-230509` })
    assert.equal(await readFile(read.setAside, 'utf8'), torn)
    await assert.rejects(readFile(file), { code: 'ENOENT' })
    await rm(read.setAside)
  }
})
