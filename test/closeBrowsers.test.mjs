// B266: a chat closes every browser it starts. The user, 2026-10-15, after many check browsers were left running and
// took a lot of memory: close them, now and in the future, and say it in the board's job texts so it holds for everyone.
// The job texts name the kinds of browser, never one computer's paths.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const worker = (await readFile(join(ROOT, 'roles', 'worker.md'), 'utf8')).replace(/\s+/g, ' ')
const main = (await readFile(join(ROOT, 'roles', 'main.md'), 'utf8')).replace(/\s+/g, ' ')

test('a worker closes every browser it starts in the same script, and none is left when it reports', () => {
  assert.match(worker, /Close every browser you start \(B266\)/)
  assert.match(worker, /a headless one, one driven over CDP or by Playwright, one with a temporary profile folder/)
  assert.match(worker, /is closed in the same script that started it, also when the script fails/)
  assert.match(worker, /none of yours is left running when you report/)
  assert.match(worker, /Never close the user's own browser/)
})

test('at every report check the main chat closes the check browsers left behind, never the user\'s own browser', () => {
  assert.match(main, /Close the check browsers left behind \(B266\)/)
  assert.match(main, /at every report check/i)
  assert.match(main, /started with a temporary profile folder/)
  assert.match(main, /Never the user's own browser/)
})

test('the rule names the kinds of browser, not one computer\'s paths or programs', () => {
  for (const [name, text] of [['worker.md', worker], ['main.md', main]]) {
    assert.doesNotMatch(text, /msedge|edge-cdp|Get-CimInstance|\\Temp\\|\/tmp\//i, name)
  }
})
