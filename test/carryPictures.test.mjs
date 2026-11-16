// T5 B3 (chat 1's brief of 2026-11-16): the pictures in use go to a cloud folder and back. Temp folders only, never the real Drive: a "Drive"
// folder whose copies carry whole-millisecond times (as Google Drive keeps them), a project with a picture root and an asset folder, and a
// keep set shaped as the live one (`made`, `items: [{ path, bytes, groups, why }]`).

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { SAME_MS, cloudFolders, fromDrive, pictureList, toDrive } from '../src/carry/pictures.mjs'

const MADE = Date.parse('2026-11-16T10:52:15+01:00')
const NAME = 'garden'

/** A project with `pictures/` (a root) and `.claude/assets/` (the asset folder), the keep set beside it, and an empty "Drive". */
async function world(t) {
  const dir = await mkdtemp(join(tmpdir(), 'carry-pictures-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const project = join(dir, 'project')
  const drive = join(dir, 'drive')
  await mkdir(drive, { recursive: true })
  /** A file at `path` (relative), its time `at` (ms, with a fraction as NTFS keeps it). */
  const put = async (path, text, at) => {
    const file = join(project, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
    await utimes(file, at / 1000, at / 1000)
  }
  await put('pictures/old/kept.png', 'kept picture', MADE - 3_600_000 + 0.4567)
  await put('.claude/assets/A102/1.png', 'asset picture', MADE - 7_200_000 + 0.25)
  await put('pictures/old/not-kept.png', 'old, not in the keep set', MADE - 3_600_000 + 0.5)
  await put('pictures/new/made-after.png', 'made after the keep set', MADE + 60_000 + 0.75)
  await put('pictures/new/notes.json', '{"a":1}', MADE + 60_000)
  await put('pictures/new/notes.md', '# words', MADE + 60_000)
  await put('pictures/named/old.png', 'named in a changed text', MADE - 9_000_000 + 0.1)
  const keepSetFile = join(dir, 'keep-set.json')
  await writeFile(keepSetFile, JSON.stringify({
    made: new Date(MADE).toISOString(),
    items: [
      { path: 'pictures/old/kept.png', bytes: 12, groups: ['focus'], why: 'B1 Picture section' },
      { path: '.claude/assets/A102/1.png', bytes: 13, groups: ['assets'], why: 'A102 named' },
      { path: 'pictures/gone.png', bytes: 1, groups: ['focus'], why: 'deleted since' },
      { path: 'pictures/old/record.json', bytes: 1, groups: ['focus'], why: 'a text record' },
    ],
  }))
  const list = () => pictureList({ keepSetFile, project, roots: ['pictures', '.claude/assets'], changedTexts: ['see pictures/named/old.png and elsewhere/other.png'] })
  return { dir, project, drive, put, list }
}

test('the list: the keep set, the pictures made after it under a root, a picture a changed text names; no text record; a gone file is missing', async t => {
  const { list } = await world(t)
  const found = await list()
  assert.deepEqual(found.map(one => one.path), ['.claude/assets/A102/1.png', 'pictures/named/old.png', 'pictures/new/made-after.png', 'pictures/old/kept.png'])
  assert.deepEqual(found.missing, ['pictures/gone.png'])
  assert.deepEqual(found.skipped, [])
  assert.ok(found.every(one => Number.isFinite(one.size) && Number.isFinite(one.mtimeMs)))
})

test('save: every listed file goes to <folder>/<name>/<path> with its source\'s time; a second save to a whole-millisecond Drive copies nothing', async t => {
  const { project, drive, list } = await world(t)
  const first = await toDrive({ list: await list(), project, folder: drive, name: NAME })
  assert.equal(first.copied, 4)
  assert.equal(first.same, 0)
  assert.ok(first.bytes > 0 && first.free > 0)
  assert.deepEqual(first.record.map(one => one.path).sort(), ['.claude/assets/A102/1.png', 'pictures/named/old.png', 'pictures/new/made-after.png', 'pictures/old/kept.png'])
  const copy = join(drive, NAME, 'pictures/old/kept.png')
  assert.equal(await readFile(copy, 'utf8'), 'kept picture')
  const [local, remote] = [await stat(join(project, 'pictures/old/kept.png')), await stat(copy)]
  assert.ok(Math.abs(local.mtimeMs - remote.mtimeMs) < 1, 'the copy has its source\'s time')
  // Drive keeps whole milliseconds: the times differ by the fraction the local file has.
  for (const one of first.record) {
    const file = join(drive, NAME, one.path)
    const whole = Math.floor((await stat(file)).mtimeMs)
    await utimes(file, whole / 1000, whole / 1000)
  }
  const second = await toDrive({ list: await list(), project, folder: drive, name: NAME })
  assert.deepEqual([second.copied, second.same, second.bytes], [0, 4, 0])
})

test('save never deletes in the folder; dryRun copies nothing and counts the bytes', async t => {
  const { project, drive, list } = await world(t)
  const extra = join(drive, NAME, 'pictures/from-the-other-pc.png')
  await mkdir(dirname(extra), { recursive: true })
  await writeFile(extra, 'theirs')
  const dry = await toDrive({ list: await list(), project, folder: drive, name: NAME, dryRun: true })
  assert.deepEqual([dry.copied, dry.record.length], [0, 0])
  assert.ok(dry.bytes > 0)
  assert.equal(fs.existsSync(join(drive, NAME, 'pictures/old/kept.png')), false)
  await toDrive({ list: await list(), project, folder: drive, name: NAME })
  assert.equal(await readFile(extra, 'utf8'), 'theirs', 'never deleted')
})

test('load: a missing local file comes from the folder with its time; a newer local file is kept; one not synced down yet is missing', async t => {
  const { project, drive, put, list } = await world(t)
  const { record } = await toDrive({ list: await list(), project, folder: drive, name: NAME })
  // The other PC: the kept picture is gone, the asset was edited there since (newer, another size), one entry is not in Drive yet.
  await rm(join(project, 'pictures/old/kept.png'))
  await put('.claude/assets/A102/1.png', 'edited on this PC, newer', MADE + 3_600_000)
  const notYet = { path: 'pictures/not-yet.png', size: 3, mtimeMs: MADE }
  const loaded = await fromDrive({ record: [...record, notYet], project, folder: drive, name: NAME })
  assert.deepEqual([loaded.copied, loaded.missing], [1, ['pictures/not-yet.png']])
  assert.equal(await readFile(join(project, 'pictures/old/kept.png'), 'utf8'), 'kept picture')
  const kept = record.find(one => one.path === 'pictures/old/kept.png')
  assert.ok(Math.abs((await stat(join(project, 'pictures/old/kept.png'))).mtimeMs - kept.mtimeMs) < 1, 'its time set')
  assert.equal(await readFile(join(project, '.claude/assets/A102/1.png'), 'utf8'), 'edited on this PC, newer', 'a newer local file is never overwritten')
  // An older local file of another size: copied.
  await put('pictures/new/made-after.png', 'x', MADE - 99_000_000)
  const again = await fromDrive({ record, project, folder: drive, name: NAME })
  assert.equal(again.copied, 1)
  assert.equal(await readFile(join(project, 'pictures/new/made-after.png'), 'utf8'), 'made after the keep set')
})

test('a file over 50 MB is left out and named', async t => {
  const { dir, project } = await world(t)
  const big = join(project, 'pictures/new/huge.png')
  await writeFile(big, Buffer.alloc(51 * 1024 * 1024))
  const keepSetFile = join(dir, 'big.json')
  await writeFile(keepSetFile, JSON.stringify({ made: new Date(MADE).toISOString(), items: [{ path: 'pictures/new/huge.png' }] }))
  const found = await pictureList({ keepSetFile, project, roots: [], changedTexts: [] })
  assert.deepEqual([found.length, found.skipped.map(one => one.path)], [0, ['pictures/new/huge.png']])
})

test('the cloud folders: Google Drive on any letter, OneDrive from the environment, Dropbox under the profile', () => {
  const dirs = new Set(['Q:\\My Drive', 'C:\\Users\\someone\\OneDrive', 'C:\\Users\\someone\\Dropbox'])
  const fake = { statSync: path => { if (!dirs.has(path)) throw new Error('none'); return { isDirectory: () => true } } }
  assert.deepEqual(cloudFolders({ env: { OneDrive: 'C:\\Users\\someone\\OneDrive', USERPROFILE: 'C:\\Users\\someone' }, fs: fake }), [
    { kind: 'Google Drive', path: 'Q:\\My Drive' },
    { kind: 'OneDrive', path: 'C:\\Users\\someone\\OneDrive' },
    { kind: 'Dropbox', path: 'C:\\Users\\someone\\Dropbox' },
  ])
  assert.equal(SAME_MS, 2000)
})
