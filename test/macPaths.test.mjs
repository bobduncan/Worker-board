// B214: the board on a Mac (and Linux): paths compared with "/" and their own letters, Codex found on the PATH. The
// system is passed as an argument, so these run on any PC; on Windows nothing changes. Made-up paths only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'

import { folderKey, isInside } from '../src/appChats.mjs'
import { findCodex } from '../src/codex.mjs'
import { pathKey } from '../src/games.mjs'

test('a Mac compares folders with "/" and their own letters; Windows as before', () => {
  assert.equal(folderKey('/Users/sam/Game/', 'darwin'), '/Users/sam/Game')
  assert.equal(isInside('/Users/sam/game/units', '/Users/sam/game', 'darwin'), true)
  assert.equal(isInside('/Users/sam/game', '/Users/sam/game/', 'darwin'), true)
  assert.equal(isInside('/Users/sam/Game/units', '/Users/sam/game', 'darwin'), false)
  assert.equal(isInside('/Users/sam/game-two', '/Users/sam/game', 'darwin'), false)
  assert.equal(isInside(String.raw`C:\Work\My\sub`, 'c:/work/my', 'win32'), true)
  assert.equal(folderKey('C:/Work/My/', 'win32'), String.raw`c:\work\my`)
})

test('a game\'s folder keeps its letters on a Mac; on Windows it is compared in small letters', () => {
  assert.equal(pathKey('/Users/sam/Game-units/', 'darwin'), '/Users/sam/Game-units')
  assert.equal(pathKey(String.raw`C:\Game\Units\ `.trim(), 'win32'), 'c:/game/units')
  assert.notEqual(pathKey('/a/Game', 'darwin'), pathKey('/a/game', 'darwin'))
})

test('Codex is found on the PATH on a Mac, and on Windows when it is not in its own folder', async t => {
  const root = await mkdtemp(join(tmpdir(), 'worker-board-codex-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'bin')
  await mkdir(bin)
  await writeFile(join(bin, 'codex'), '')
  await writeFile(join(bin, 'codex.exe'), '')
  // A Mac's PATH is split at ":": the made-up folder is named without a drive letter here.
  const near = relative(process.cwd(), bin)
  assert.equal(await findCodex({ env: { PATH: `/nowhere:${near}` }, platform: 'darwin' }), join(near, 'codex'))
  assert.equal(await findCodex({ env: { PATH: `C:\\nowhere;${bin}`, LOCALAPPDATA: join(root, 'no-local') }, platform: 'win32' }), join(bin, 'codex.exe'))
  assert.equal(await findCodex({ env: { PATH: '/nowhere' }, platform: 'darwin' }), null)
})
