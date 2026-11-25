// B1535 (X93): the app's chat files are read and parsed again only when their stamp changed (src/appChats.mjs): on 2026-11-25
// every state rebuild read and parsed 566 files (37 MB), about 0.45 s, and parsed them twice more after.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { appChatReads, readAccountFolders, readAppChatList, readAppChats } from '../src/appChats.mjs'

const chat = (name, at) => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\garden', isArchived: false, createdAt: 1, lastActivityAt: at })

test('a chat file is read again only when its stamp changed; the chats, texts and folders read as before', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'app-chats-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const folder = join(dir, 'account', 'org')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'local_Lead.json'), chat('Lead', 100))
  await writeFile(join(folder, 'local_Digger.json'), chat('Digger', 200))
  await writeFile(join(folder, 'local_broken.json'), '{ not json')
  // Files that stand still (a file written in the last 2 s is read again each time: git's racy rule).
  const still = new Date(Date.now() - 60_000)
  for (const name of ['local_Lead.json', 'local_Digger.json', 'local_broken.json']) await utimes(join(folder, name), still, still)

  const before = appChatReads()
  const first = await readAppChatList(dir)
  assert.deepEqual(first.map(one => one.title).sort(), ['Garden · Digger', 'Garden · Lead'])
  assert.equal(appChatReads() - before, 3)
  // Read again, nothing changed: no file is read, and the chats are the same.
  assert.deepEqual(await readAppChatList(dir), first)
  assert.equal(appChatReads() - before, 3)
  // The texts and the folder's facts as before (the other readers of the folders).
  assert.deepEqual((await readAppChats(dir)).sort(), [chat('Digger', 200), chat('Lead', 100), '{ not json'].sort())
  const [one] = await readAccountFolders(dir)
  assert.deepEqual([one.account, one.org, one.at, [...one.ids].sort(), [...one.chats.keys()].sort()], ['account', 'org', 200, ['local_Digger', 'local_Lead', 'local_broken'], ['local_Digger', 'local_Lead']])
  assert.equal(appChatReads() - before, 3)

  // A chat the app wrote anew (another stamp): that one file is read again, and its new words count.
  await writeFile(join(folder, 'local_Lead.json'), chat('Lead', 300))
  await utimes(join(folder, 'local_Lead.json'), still, new Date(Date.now() - 30_000))
  const again = await readAppChatList(dir)
  assert.equal(appChatReads() - before, 4)
  assert.equal(again.find(found => found.title === 'Garden · Lead').lastActivityAt, 300)

  // What a read hands out never changes the kept parse.
  again[0].title = 'changed by a reader'
  assert.ok((await readAppChatList(dir)).every(found => found.title !== 'changed by a reader'))

  // A file the app wrote a moment ago is read again at every look until it stands still, even at the same stamp.
  await writeFile(join(folder, 'local_Digger.json'), chat('Digger', 201))
  const reads = appChatReads()
  await readAppChatList(dir)
  await readAppChatList(dir)
  assert.equal(appChatReads() - reads, 2)

  // A file gone is gone from the chats.
  await rm(join(folder, 'local_Digger.json'))
  assert.deepEqual((await readAppChatList(dir)).map(found => found.title), ['Garden · Lead'])
})
