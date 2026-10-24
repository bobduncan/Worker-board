// B2: the links a question writes into a For you block open the board where it runs, also when it took another port
// than its settings name. Made-up ports only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { boardAddress } from '../src/ports.mjs'
import { forYouBlock } from '../src/work/api.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('the address is the port the board runs on, and the links written from it carry that port', () => {
  const settings = { port: 4310 }
  const running = { ...settings, port: 4314 }
  assert.equal(boardAddress('127.0.0.1', running), 'http://127.0.0.1:4314')
  const block = forYouBlock({ id: 'Q1', kind: 'look', title: 'Which screen?', pictures: ['b1/a.png'], play: 'main&x=1' }, boardAddress('127.0.0.1', running))
  assert.match(block, /http:\/\/127\.0\.0\.1:4314\/#picture=/)
  assert.match(block, /http:\/\/127\.0\.0\.1:4314\/#play=/)
  assert.doesNotMatch(block, /:4310/)
})

test('the board hands the work API the address of the port it runs on, read after the port was chosen', async () => {
  const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  const line = server.split('\n').find(one => /\bboardUrl:/.test(one))
  assert.ok(line, 'server.mjs gives the work API a boardUrl')
  assert.match(line, /boardAddress\(HOST, config\)/)
  assert.doesNotMatch(line, /homePort/)
})
