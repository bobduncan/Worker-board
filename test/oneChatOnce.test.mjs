// B314: one chat shows once, though the app kept an old account's copy of the list of chats. (Its other half, a
// worker's safe-point line filed as a work note, went with Pause 2: a stop for a restart is the store's pause.)
// Made-up samples only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { readAppChats } from '../src/appChats.mjs'

const MIN = 60_000
const at = (hour, minute = 0, second = 0) => new Date(2026, 9, 18, hour, minute, second).getTime()
const PROJECT = 'C:\\game'

test('one chat shows once: only the chats of the account the app uses now are read, not an old account\'s copies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'b314-'))
  try {
    const now = join(dir, 'account-new', 'org-1')
    const old = join(dir, 'account-old', 'org-1')
    await mkdir(now, { recursive: true })
    await mkdir(old, { recursive: true })
    // 2026-10-18: the old account's folder still held an open "Game - Worker 1" of 14 October, beside today's.
    await writeFile(join(now, 'local_a.json'), JSON.stringify({ title: 'Game - Worker 1', cliSessionId: 'today', cwd: PROJECT, lastActivityAt: at(16, 22) }))
    await writeFile(join(now, 'local_b.json'), JSON.stringify({ title: 'Game - Main', cliSessionId: 'main', cwd: PROJECT, lastActivityAt: at(16, 20) }))
    await writeFile(join(old, 'local_c.json'), JSON.stringify({ title: 'Game - Worker 1', cliSessionId: 'old', cwd: PROJECT, lastActivityAt: at(16, 0) - 4 * 24 * 60 * MIN }))
    await writeFile(join(old, 'local_b.json'), JSON.stringify({ title: 'Game - Main', cliSessionId: 'main', cwd: PROJECT, lastActivityAt: at(16, 0) - 3 * 24 * 60 * MIN }))
    const texts = await readAppChats(dir)
    assert.deepEqual(texts.map(one => JSON.parse(one).cliSessionId).sort(), ['main', 'today'])
    // One account only: all of it.
    await rm(join(dir, 'account-new'), { recursive: true })
    assert.deepEqual((await readAppChats(dir)).map(one => JSON.parse(one).cliSessionId).sort(), ['main', 'old'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
