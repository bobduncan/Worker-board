// B675: an ask that sends the person to a page of the game carries the link itself. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { checkGame } from '../../src/games.mjs'
import { gamePageIn, localAddressIn } from '../../src/places.mjs'
import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 26, 11, 5).getTime()
const BACKLOG = ['# Backlog', '', '## Board work', '- [ ] B1 Pick a sound (for Board; about 1 h)', ''].join('\n')
const URL = 'http://127.0.0.1:4310'

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-page-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => (chat === 'Board' ? 'worker' : null), freeChats: new Set(['Board']), boardUrl: URL }
  return { dir, board: body => workApi({ chat: 'Board', ...body }, ctx) }
}

test('gamePageIn: the sound board by its words or by its address; an address of another page is none', () => {
  assert.equal(gamePageIn('Open the sound board and pick one'), 'soundboard')
  assert.equal(gamePageIn('Open http://localhost:5173/soundboard.html and pick one'), 'soundboard')
  assert.equal(gamePageIn('Open http://127.0.0.1:5300/soundboard.html?x=1'), 'soundboard')
  assert.equal(gamePageIn('Open http://localhost:5173/index.html'), null)
  assert.equal(gamePageIn('the keyboard of a soundboardless room'), null)
  assert.equal(localAddressIn('Go to http://localhost:5173/other.html now'), 'http://localhost:5173/other.html')
  assert.equal(localAddressIn('no address here'), null)
})

test('an ask naming the sound board carries a play link on the step\'s branch, in the block', async () => {
  const { dir, board } = await fresh()
  try {
    await board({ action: 'take', id: 'B1', branch: 'b1-sound' })
    const made = await board({ action: 'ask', of: 'B1', kind: 'do', title: 'Pick the best sound', text: 'Open the sound board and pick one.' })
    assert.equal(made.ok, true, made.why)
    assert.match(made.result.text, /\[Play it: the sound board\]\(http:\/\/127\.0\.0\.1:4310\/#play=b1-sound&page=soundboard\)/)
    assert.deepEqual((await readStore(dir)).items.get('Q1').sections.get('Play'), ['b1-sound&page=soundboard'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a play the worker gave stays; an address of the sound board becomes the link; an ask under no step uses main', async () => {
  const { dir, board } = await fresh()
  try {
    await board({ action: 'take', id: 'B1', branch: 'b1-sound' })
    const given = await board({ action: 'ask', of: 'B1', kind: 'do', title: 'Pick the best sound', text: 'Open the sound board.', play: 'b1-sound&screen=shop' })
    assert.match(given.result.text, /#play=b1-sound&screen=shop\)/)
    const address = await board({ action: 'ask', kind: 'look', goal: 'G1', title: 'Try the new sounds in the game', text: 'Open http://localhost:5173/soundboard.html and listen.' })
    assert.equal(address.ok, true, address.why)
    assert.match(address.result.text, /#play=main&page=soundboard\)/)
    assert.doesNotMatch(address.result.text, /Note:/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a do ask with a local address the board cannot link gets a note, and is not refused', async () => {
  const { dir, board } = await fresh()
  try {
    await board({ action: 'take', id: 'B1', branch: 'b1-sound' })
    const made = await board({ action: 'ask', of: 'B1', kind: 'do', title: 'Check the tool page', text: 'Open http://localhost:5173/tool.html and check it.' })
    assert.equal(made.ok, true, made.why)
    assert.match(made.result.text, /\n\nNote: http:\/\/localhost:5173\/tool\.html is no link the person can open/)
    assert.equal(valueOf((await readStore(dir)).items.get('Q1'), 'Id'), 'Q1')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('checkGame: a branch\'s game may name a page of the game\'s list, nothing else', () => {
  const state = { baseBranch: 'main', mainGame: { path: 'C:\game' }, chats: [{ folders: [{ branch: 'b1-sound', path: 'C:\game-b1' }] }] }
  assert.deepEqual(checkGame({ item: 'branch', branch: 'b1-sound', action: 'start', page: 'soundboard' }, state), { ok: true, action: 'start', branch: 'b1-sound', path: 'C:\game-b1', page: 'soundboard' })
  assert.equal(checkGame({ item: 'branch', branch: 'b1-sound', action: 'start', page: '../secret' }, state).ok, false)
  assert.equal(checkGame({ item: 'branch', branch: 'b1-sound', action: 'start', page: 'toString' }, state).ok, false)
  assert.deepEqual(checkGame({ item: 'branch', branch: 'main', action: 'start' }, state), { ok: true, action: 'start', branch: 'main', path: 'C:\game' })
})
