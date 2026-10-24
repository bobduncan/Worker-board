// B2: the links a question writes into a For you block open the board where it runs, also when it took another port
// than its settings name. Made-up ports only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { boardAddress, recordingBoardPort } from '../src/ports.mjs'
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

test('B3: the board that records is found at the port the PC\'s list of boards keeps for its project, else at the settings\' port', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'board-recording-'))
  try {
    const project = join(dir, 'project')
    const other = join(dir, 'other')
    await mkdir(project)
    await mkdir(other)
    const boards = join(dir, 'boards.json')
    await writeFile(boards, JSON.stringify({ boards: [
      { project: other, folder: other, port: 4310, gamePort: 4400 },
      { project, folder: project, port: 4314, gamePort: 4500, asked: { port: 4310, gamePort: 4500 } },
    ] }))
    assert.equal(await recordingBoardPort({ boards, project, fallback: 4310 }), 4314)
    assert.equal(await recordingBoardPort({ boards, project: join(dir, 'nobody'), fallback: 4310 }), 4310)
    assert.equal(await recordingBoardPort({ boards: join(dir, 'missing.json'), project, fallback: 4310 }), 4310)
    assert.equal(await recordingBoardPort({ boards: null, project, fallback: 4310 }), 4310)
    assert.equal(await recordingBoardPort({ boards, project: null, fallback: 4310 }), 4310)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B3: every "only shows" notice names the recording board by the port of the list, never by the settings\' port', async () => {
  const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  const notices = server.split('\n').filter(one => /This board only shows\./.test(one) && /http:\/\/\$\{HOST\}:/.test(one))
  assert.ok(notices.length >= 7, `found ${notices.length} notices`)
  for (const one of notices) {
    assert.match(one, /\$\{recordingPort\}/)
    assert.doesNotMatch(one, /\$\{homePort\}/)
  }
})
