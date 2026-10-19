// Pause 2 (spec 2026-10-18-pause-resume-design.md, point 7): the old restart path is gone from the board. No
// "prepare restart" word, no `.claude/restart.md` read, no "Safe point:" line read (B291, B314); the copied-word
// banner (B315) stays for the other words. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as limits from '../src/limits.mjs'
import { parseConfig } from '../src/config.mjs'
import { readSources } from '../src/sources.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = path => readFile(join(ROOT, path), 'utf8')

test('the safe-point line is no longer read: its readers are gone', () => {
  for (const name of ['SAFE_POINT', 'safePointNote', 'storeSafePoint']) assert.equal(name in limits, false, name)
  // The pause for the limit stays as it was.
  assert.equal(typeof limits.pauseNote, 'function')
  assert.equal(typeof limits.storePause, 'function')
})

test('restart.md is not read, even when the project has one', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pause2-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await mkdir(join(dir, '.claude'), { recursive: true })
  await writeFile(join(dir, '.claude', 'restart.md'), '# who was on what\n')
  const config = { ...parseConfig('{}', {}), project: dir, appSessions: join(dir, 'none'), transcripts: join(dir, 'none') }
  const raw = await readSources(config, async () => null, Date.now())
  assert.equal('restartNote' in raw, false)
})

test('the page, the server and the state say nothing of "prepare restart", restart.md or a stop for the restart', async () => {
  const page = await read('public/board.js')
  for (const gone of ['Prepare restart', 'restart.md', 'Stopped for the restart', 'stopped for the restart', 'restart.prepared', 'restart.preparing', 'restart.resuming']) {
    assert.equal(page.includes(gone), false, gone)
  }
  assert.doesNotMatch(await read('server.mjs'), /restartAt|restart\.md/)
  const state = await read('src/state.mjs')
  assert.doesNotMatch(state, /restartNote|restartSince|by: 'restart'|storeSafePoint|safePointNote/)
  assert.doesNotMatch(await read('src/say.mjs'), /'prepare restart'/)
  assert.doesNotMatch(await read('src/store.mjs'), /prepare restart|RESTART_KNOWN/)
  // The copied-word banner stays for the other words.
  assert.match(page, /button\('Copy again', 'is-quiet', 'copy'\)/)
})

test('the job texts: no restart.md and no safe-point line; a checkpoint with every commit, and the mod\'s resume list', async () => {
  const main = await read('roles/main.md')
  const worker = await read('roles/worker.md')
  const protocol = await read('roles/protocol.md')
  for (const [name, text] of Object.entries({ main, worker, protocol })) {
    assert.doesNotMatch(text, /restart\.md|Safe point:|prepare restart/, name)
  }
  assert.match(worker, /checkpoint with every commit/)
  assert.match(worker, /## A pause of all chats/)
  assert.match(main, /resume your step B<id> from your checkpoint/)
  assert.match(await read('roles/partner.md'), /A pause of all chats/)
  assert.match(protocol, /## What the Workers mod puts beside a chat's turn/)
})
