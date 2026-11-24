// T5.2 A6a (chat 1's review, finding 15): with the data moved, a chat names pictures from its own folder (the chat home, a wrapper that
// holds the game repo); the board keeps them in the stored form, tells chats folders they can reach, and copies a picture in from a
// worker's worktree in the chat home. With `data` unset everything is as today. A made-up wrapper in a temp folder.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { PROVIDERS } from '../src/providers/index.mjs'
import { adoptPicture, pictureProblem, shownFolders, shownRoots } from '../src/pictures.mjs'
import { resolveStored, storedOfChatPath, wordsPath } from '../src/projectPaths.mjs'
import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { removeDir } from './tempDir.mjs'

const NOW = new Date(2026, 10, 21, 13, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Shop', '- [ ] B7 Paint the shop (for Features; about 1 h)', '- [ ] B8 Paint the gate (about 1 h)', ''].join('\n')
const ROLES = { Main: 'main', Features: 'worker' }

/** The wrapper (chat home) holding the game repo (project) and its data home; or, `moved` false, today's layout in one folder. */
async function world(t, { moved = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chat-paths-'))
  t.after(() => removeDir(dir))
  const wrapper = join(dir, 'kiwi-wrapper')
  const game = join(wrapper, 'kiwi')
  const data = join(game, '.workerboard')
  const config = moved
    ? { project: game, gameRepo: game, chatHome: wrapper, data, pictureRoots: ['art-inbox'], kinds: [], work: '.claude/work' }
    : { project: wrapper, gameRepo: game, chatHome: '', data: '', pictureRoots: ['art-inbox'], kinds: [], work: '.claude/work' }
  const pictures = moved ? join(data, 'pictures') : wrapper
  for (const folder of [join(pictures, 'art-inbox', 'vision'), join(pictures, 'art-inbox', 'b7'), join(wrapper, 'kiwi-b12', 'art')]) await mkdir(folder, { recursive: true })
  await writeFile(join(pictures, 'art-inbox', 'vision', 'look.png'), 'png')
  await writeFile(join(pictures, 'art-inbox', 'b7', 'shop.png'), 'png')
  await writeFile(join(wrapper, 'kiwi-b12', 'art', 'y.png'), 'png')
  const store = join(dir, 'work')
  await writeStore(store, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  // As server.mjs builds them.
  const home = { root: config.project, abs: path => resolveStored(config, path) }
  const roots = shownRoots(config)
  const chatHome = moved ? wrapper : wrapper
  const ctx = {
    dir: store, now: NOW + 60_000, prefix: 'Game - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(),
    pictureProblem: path => pictureProblem(home, roots, path), shownFolders: shownFolders(config),
    storedPicture: path => storedOfChatPath(config, path),
    shownFoldersWords: shownFolders(config).map(folder => wordsPath(config, resolveStored(config, folder))),
    adoptPicture: async (path, subject) => (await adoptPicture(home, shownFolders(config)[0], subject, path)) ?? (moved ? adoptPicture(home, shownFolders(config)[0], subject, path, chatHome) : null),
    assets: {
      dir: join(dir, 'assets'), project: config.project, base: moved ? wrapper : config.project, abs: path => resolveStored(config, path),
      providerOf: () => ({ provider: PROVIDERS.codex, folder: null }), tools: () => ({ project: config.project }),
    },
  }
  const ask = body => workApi({ chat: 'Features', action: 'ask', of: 'B7', kind: 'look', title: 'Does the shop look right?', ...body }, ctx)
  const asset = body => workApi({ chat: 'Features', action: 'asset', kind: 'visual', text: 'a stone stair', of: 'B7', ...body }, ctx)
  return { dir, wrapper, game, data, pictures, config, store, ask, asset, ctx }
}
const lastAsk = async store => [...(await readStore(store)).items.values()].filter(one => /^Q\d+$/.test(valueOf(one, 'Id') ?? '')).at(-1)

test('data unset: a chat\'s path is kept as it gave it, and the folders it is told are the stored names', async t => {
  const one = await world(t, { moved: false })
  for (const path of ['art-inbox/b7/shop.png', 'art-inbox\\b7\\shop.png', './art-inbox/b7/shop.png', 'kiwi-b12/art/y.png', '../x.png', 'C:\\elsewhere\\x.png', '']) assert.equal(storedOfChatPath(one.config, path), path)
  assert.deepEqual(one.ctx.shownFoldersWords, one.ctx.shownFolders)
  assert.equal((await one.asset({ pictures: ['art-inbox/vision/look.png'] })).ok, true)
})

test('a picture path from the chat home is kept in its stored form; the refusal names a folder the chat reaches', async t => {
  const one = await world(t)
  assert.equal(storedOfChatPath(one.config, 'kiwi/.workerboard/pictures/art-inbox/b7/shop.png'), 'art-inbox/b7/shop.png')
  assert.equal(storedOfChatPath(one.config, 'kiwi\\docs\\plan.md'), 'docs/plan.md', 'under the project: project-relative')
  assert.equal(storedOfChatPath(one.config, 'kiwi-b12/art/y.png'), 'kiwi-b12/art/y.png', 'neither: as given')
  assert.equal(storedOfChatPath(one.config, 'art-inbox/b7/shop.png'), 'art-inbox/b7/shop.png', 'the stored form itself still works')
  const done = await one.ask({ pictures: ['kiwi/.workerboard/pictures/art-inbox/b7/shop.png'] })
  assert.equal(done.ok, true, done.why)
  assert.equal(valueOf(await lastAsk(one.store), 'Pictures'), 'art-inbox/b7/shop.png')
  const refused = await one.ask({ title: 'And this one?', pictures: ['kiwi-b12/art/y.png'] })
  assert.equal(refused.ok, false)
  assert.match(refused.why, /Copy it there, for example to kiwi\/\.workerboard\/pictures\/art-inbox\/b7\/y\.png, and ask again/)
  const missing = await one.ask({ title: 'And that?', pictures: ['kiwi/.workerboard/pictures/art-inbox/b7/gone.png'] })
  assert.match(missing.why, /There is no picture at art-inbox\/b7\/gone\.png: make it first/)
})

test('a For you block\'s picture in a worker\'s worktree in the chat home is copied in again (Q311)', async t => {
  const one = await world(t)
  const done = await one.ask({ via: 'chat', pictures: ['kiwi-b12/art/y.png'] })
  assert.equal(done.ok, true, done.why)
  assert.equal(valueOf(await lastAsk(one.store), 'Pictures'), 'art-inbox/b7/y.png')
  assert.equal(await readFile(join(one.pictures, 'art-inbox', 'b7', 'y.png'), 'utf8'), 'png')
  assert.equal(await adoptPicture({ root: one.game, abs: p => resolveStored(one.config, p) }, 'art-inbox', 'b7', '../../outside.png', one.wrapper), null, 'never from outside the chat home')
})

test('an asset request\'s reference picture: from the chat home, or in the stored form; a missing one is refused', async t => {
  const one = await world(t)
  const fromChat = await one.asset({ pictures: ['kiwi/.workerboard/pictures/art-inbox/vision/look.png'] })
  assert.equal(fromChat.ok, true, fromChat.why)
  const stored = await one.asset({ text: 'a wooden door', pictures: ['art-inbox/vision/look.png'] })
  assert.equal(stored.ok, true, stored.why)
  const worktree = await one.asset({ text: 'a window', pictures: ['kiwi-b12/art/y.png'] })
  assert.equal(worktree.ok, true, `a picture only the chat home holds: ${worktree.why}`)
  const gone = await one.asset({ text: 'a gate', pictures: ['art-inbox/vision/gone.png'] })
  assert.match(gone.why, /There is no picture at art-inbox\/vision\/gone\.png/)
})

test('the server gives the work tool the chat-home paths', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /base: resolve\(HERE, chatHomeOf\(config\)\), abs: path => resolve\(HERE, resolveStored\(config, path, \{ boardDir: HERE \}\)\)/)
  assert.match(server, /storedPicture: path => storedOfChatPath\(config, path\)/)
  assert.match(server, /shownFoldersWords: shownFolders\(config\)\.map\(folder => wordsPath\(config, resolveStored\(config, folder, \{ boardDir: HERE \}\)\)\)/)
  assert.match(server, /\?\? \(dataOf\(config\) === null \? null : await adoptPicture\(pictureHome\(\), shownFolders\(config\)\[0\], subject, path, resolve\(HERE, chatHomeOf\(config\)\)\)\)/)
})

test('chat 1\'s review 2: a worker\'s ask is filed under the step its pictures belong to, also when it names them from the chat home', async t => {
  const one = await world(t)
  // Asked under B8, which Features does not hold; the picture is B7's (Features holds it), named from the chat home.
  const done = await one.ask({ of: 'B8', pictures: ['kiwi/.workerboard/pictures/art-inbox/b7/shop.png'] })
  assert.equal(done.ok, true, done.why)
  const filed = await lastAsk(one.store)
  assert.deepEqual([valueOf(filed, 'Of'), valueOf(filed, 'Pictures')], ['B7', 'art-inbox/b7/shop.png'])
})

test('chat 1\'s review 1: a picture under the data home\'s pictures but outside every picture root keeps the path the chat gave', async t => {
  const one = await world(t)
  assert.equal(storedOfChatPath(one.config, 'kiwi/.workerboard/pictures/assets/A12/out.png'), 'kiwi/.workerboard/pictures/assets/A12/out.png')
  assert.equal(storedOfChatPath(one.config, 'kiwi/.workerboard/pictures/art-inbox/b7/shop.png'), 'art-inbox/b7/shop.png', 'under a root: its stored form')
  // Kept as given, it is read from the chat's own folder (and adopted into the shown folder), never stored in a form nothing maps back.
  assert.notEqual(storedOfChatPath(one.config, 'kiwi/.workerboard/pictures/assets/A12/out.png'), 'assets/A12/out.png')
})
