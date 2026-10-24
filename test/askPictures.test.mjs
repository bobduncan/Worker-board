// 2026-10-24: an ask's picture the board cannot show is refused when the ask is filed, with where to put it (Worker 1's
// ask linked a picture in its worktree; the board answered "No such picture" and the person saw nothing). Made-up names.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { adoptPicture, pictureProblem, shownFolders, shownRoots } from '../src/pictures.mjs'
import { workApi } from '../src/work/api.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const NOW = new Date(2026, 9, 24, 13, 0).getTime()
const CONFIG = { pictureRoots: ['art-inbox'], kinds: [{ reference: 'art-inbox/vision' }, { reference: 'game/art/source' }, { reference: 'game/art/source/hud' }] }

async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'ask-pictures-'))
  for (const folder of ['art-inbox/b7', 'game-b7/tests/screens']) await mkdir(join(dir, ...folder.split('/')), { recursive: true })
  await writeFile(join(dir, 'art-inbox', 'b7', 'shop.png'), 'png')
  await writeFile(join(dir, 'art-inbox', 'b7', 'notes.txt'), 'text')
  await writeFile(join(dir, 'game-b7', 'tests', 'screens', 'shop.png'), 'png')
  return dir
}

test('the folders a chat is told: each shown folder once, none inside another', () => {
  assert.deepEqual(shownFolders(CONFIG), ['art-inbox', 'game/art/source'])
  assert.deepEqual(shownRoots(CONFIG).length, 4)
})

test('why the board cannot show a picture: outside its folders, or not there', async () => {
  const dir = await project()
  try {
    const roots = shownRoots(CONFIG)
    assert.equal(await pictureProblem(dir, roots, 'art-inbox/b7/shop.png'), null)
    assert.equal(await pictureProblem(dir, roots, 'art-inbox/b7/gone.png'), 'missing')
    assert.equal(await pictureProblem(dir, roots, 'game-b7/tests/screens/shop.png'), 'outside')
    assert.equal(await pictureProblem(dir, roots, '../elsewhere/shop.png'), 'outside')
    assert.equal(await pictureProblem(dir, roots, 'art-inbox/b7/notes.txt'), 'outside')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const BACKLOG = ['# Backlog', '', '## Shop', '- [ ] B7 Paint the shop (for Features; about 1 h)', ''].join('\n')
const ROLES = { Main: 'main', Features: 'worker' }

async function board() {
  const dir = await project()
  const store = join(dir, 'work')
  await writeStore(store, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const roots = shownRoots(CONFIG)
  const ctx = {
    dir: store, now: NOW + 60_000, prefix: 'Game - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(),
    pictureProblem: path => pictureProblem(dir, roots, path), shownFolders: shownFolders(CONFIG),
    adoptPicture: (path, subject) => adoptPicture(dir, shownFolders(CONFIG)[0], subject, path),
  }
  return { dir, store, ask: body => workApi({ chat: 'Features', action: 'ask', of: 'B7', kind: 'look', title: 'Does the shop look right?', ...body }, ctx) }
}
const asks = async store => [...(await readStore(store)).items.values()].filter(one => /^Q\d+$/.test(one.head?.get?.('Id') ?? ''))

test('an ask whose picture is in a shown folder is filed as before', async () => {
  const { dir, ask } = await board()
  try {
    const done = await ask({ pictures: ['art-inbox/b7/shop.png'] })
    assert.equal(done.ok, true, done.why)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an ask whose picture is outside the shown folders is refused, saying where to put it, and nothing is filed', async () => {
  const { dir, store, ask } = await board()
  try {
    const before = (await asks(store)).length
    const done = await ask({ pictures: ['game-b7/tests/screens/shop.png'] })
    assert.equal(done.ok, false)
    assert.equal(done.status, 400)
    assert.match(done.why, /cannot show game-b7\/tests\/screens\/shop\.png/)
    assert.match(done.why, /only from art-inbox, game\/art\/source/)
    assert.match(done.why, /art-inbox\/b7\/shop\.png/)
    assert.equal((await asks(store)).length, before)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an ask filed from a chat\'s For you block keeps its question: a picture outside is copied into the picture folder', async () => {
  // Q311 (2026-10-24) came this way, with a picture in a worktree; refusing would lose the person's question.
  const { dir, store, ask } = await board()
  try {
    const done = await ask({ via: 'chat', pictures: ['game-b7/tests/screens/shop.png'] })
    assert.equal(done.ok, true, done.why)
    const filed = [...(await readStore(store)).items.values()].find(one => (one.head?.get?.('Pictures') ?? '').includes('shop.png'))
    assert.equal(filed?.head.get('Pictures'), 'art-inbox/b7/shop.png')
    assert.equal(await pictureProblem(dir, shownRoots(CONFIG), 'art-inbox/b7/shop.png'), null)
    // A picture that is not inside the project is not copied: it is kept as it came.
    const outside = await ask({ via: 'chat', title: 'Does the other one look right?', pictures: ['../elsewhere/x.png'] })
    assert.equal(outside.ok, true, outside.why)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an ask whose picture is not there yet is refused: make it first', async () => {
  const { dir, ask } = await board()
  try {
    const done = await ask({ pictures: ['art-inbox/b7/gone.png'] })
    assert.equal(done.ok, false)
    assert.match(done.why, /no picture at art-inbox\/b7\/gone\.png/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
