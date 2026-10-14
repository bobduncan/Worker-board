import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { findCodex, makePicture } from '../src/codex.mjs'

const FAKE = [process.execPath, join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-codex.mjs')]

async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'board-codex-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('a picture is made in a folder of its own and copied where it belongs, with its words beside it', async t => {
  const out = await folder(t)
  const log = join(out, 'log.json')
  process.env.FAKE_CODEX_LOG = log
  t.after(() => { delete process.env.FAKE_CODEX_LOG })
  const made = await makePicture({ command: FAKE, prompt: 'A shop screen\n', images: ['C:\\ref\\one.png', 'C:/ref/two.png'], to: join(out, 'ideas', 'shop', 'v1.png'), seconds: 20 })
  assert.equal(made.ok, true)
  assert.ok(Number.isInteger(made.seconds))
  assert.equal((await readFile(join(out, 'ideas', 'shop', 'v1.png'))).subarray(1, 4).toString('latin1'), 'PNG')
  assert.equal(await readFile(join(out, 'ideas', 'shop', 'v1.prompt.txt'), 'utf8'), 'A shop screen\n')

  const seen = JSON.parse(await readFile(log, 'utf8'))
  // Started as Codex is: told to work in its own folder, to write there only, with the pictures in their order.
  assert.deepEqual(seen.args.slice(0, 2), ['exec', '-C'])
  assert.ok(seen.args.includes('workspace-write') && seen.args.includes('--skip-git-repo-check'))
  assert.deepEqual(seen.images, ['C:/ref/one.png', 'C:/ref/two.png'])
  assert.equal(seen.told, 'A shop screen\n')
  assert.ok(seen.args[2].includes('worker-board-design-'))
  assert.equal(seen.args.at(-1), '-')
  // Its folder is gone again. B166: the very folder it was started in, not "no such folder in the temporary
  // folder": that one is shared, and another run of these tests, or the board making a picture, has its own there.
  await assert.rejects(stat(seen.args[2]), { code: 'ENOENT' })
})

test('when Codex makes no picture the reason is said, and nothing is kept', async t => {
  const out = await folder(t)
  const to = join(out, 'v1.png')
  const none = await makePicture({ command: FAKE, prompt: 'NOTOOL', images: [], to, seconds: 20 })
  assert.deepEqual([none.ok, none.why], [false, 'Codex has no picture tool in this session.'])
  const nothing = await makePicture({ command: FAKE, prompt: 'NOTHING', images: [], to, seconds: 20 })
  assert.equal(nothing.ok, false)
  assert.match(nothing.why, /made no picture \(it ended with code 3\)\. It said: I could not make that\./)
  // A file of that name that is no picture is not taken for one.
  assert.equal((await makePicture({ command: FAKE, prompt: 'TEXTFILE', images: [], to, seconds: 20 })).ok, false)
  assert.deepEqual(await readdir(out), [])
})

test('a picture that takes too long is stopped, and one that cannot be started says so', async t => {
  const out = await folder(t)
  const began = Date.now()
  const late = await makePicture({ command: FAKE, prompt: 'SLOW', images: [], to: join(out, 'v1.png'), seconds: 1 })
  assert.deepEqual([late.ok, late.why], [false, 'Codex took longer than 1 seconds and was stopped.'])
  assert.ok(Date.now() - began < 15_000)
  const gone = await makePicture({ command: [join(out, 'no-such-codex.exe')], prompt: 'x', images: [], to: join(out, 'v1.png'), seconds: 5 })
  assert.equal(gone.ok, false)
})

test('Codex is found where its app keeps it: the newest one, or the one the settings name', async t => {
  const home = await folder(t)
  const bin = join(home, 'OpenAI', 'Codex', 'bin')
  for (const [name, at] of [['aaa', 1_000], ['bbb', 3_000], ['ccc', 2_000]]) {
    await mkdir(join(bin, name), { recursive: true })
    await writeFile(join(bin, name, 'codex.exe'), 'x')
    await utimes(join(bin, name, 'codex.exe'), at, at)
  }
  await mkdir(join(bin, 'empty'), { recursive: true })
  assert.equal(await findCodex({ env: { LOCALAPPDATA: home } }), join(bin, 'bbb', 'codex.exe'))
  assert.equal(await findCodex({ given: join(bin, 'aaa', 'codex.exe'), env: { LOCALAPPDATA: home } }), join(bin, 'aaa', 'codex.exe'))
  // A path the settings give that is not there is not replaced by a guess.
  assert.equal(await findCodex({ given: join(bin, 'nope.exe'), env: { LOCALAPPDATA: home } }), null)
  assert.equal(await findCodex({ env: { LOCALAPPDATA: join(home, 'elsewhere') } }), null)
  assert.equal(await findCodex({ env: {} }), null)
})
