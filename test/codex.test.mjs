import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { findCodex, makePicture as make } from '../src/codex.mjs'

const FAKE = [process.execPath, join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-codex.mjs')]

// These tests never touch the person's Codex folder or the board's data folder: a home of their own.
const HOMES = join(tmpdir(), `board-codex-homes-${process.pid}`)
const makePicture = options => make({ codexHome: join(HOMES, 'clean'), userHome: join(HOMES, 'user'), ...options })
test.after(() => rm(HOMES, { recursive: true, force: true }))

async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'board-codex-test-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
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
  // B1311: a path the settings give that is gone (an old package folder) falls back to the search; no Codex at all is null.
  assert.equal(await findCodex({ given: join(bin, 'nope.exe'), env: { LOCALAPPDATA: home } }), join(bin, 'bbb', 'codex.exe'))
  assert.equal(await findCodex({ env: { LOCALAPPDATA: join(home, 'elsewhere') }, execFile: noStore }), null)
  assert.equal(await findCodex({ given: join(home, 'gone.exe'), env: {}, execFile: noStore }), null)
})

// B1311 (Q848, 2026-11-22): the Codex app updated itself into a Microsoft Store package.
const noStore = (command, args, options, done) => done(null, '')
const storeAnswer = (lines, seen = []) => (command, args, options, done) => { seen.push({ command, args, options }); done(null, lines.join('\r\n')) }
async function storePackage(root, version, { exe = true } = {}) {
  const location = join(root, `OpenAI.Codex_${version}_x64__abc`)
  await mkdir(join(location, 'app', 'resources'), { recursive: true })
  if (exe) await writeFile(join(location, 'app', 'resources', 'codex.exe'), 'x')
  return location
}

test('the Store package is the last place: found when the old folder and the PATH have none, the newest version, a gone settings path falls back to it', async t => {
  const root = await folder(t)
  const old = await storePackage(root, '26.1.0')
  const newer = await storePackage(root, '26.10.0')
  const empty = await storePackage(root, '27.0.0', { exe: false })
  const seen = []
  const ask = storeAnswer([`26.1.0|${old}`, `27.0.0|${empty}`, `26.10.0|${newer}`, ''], seen)
  const env = { LOCALAPPDATA: join(root, 'no-local'), PATH: join(root, 'no-path') }
  const wanted = join(newer, 'app', 'resources', 'codex.exe')
  assert.equal(await findCodex({ env, platform: 'win32', execFile: ask }), wanted)
  assert.equal(await findCodex({ given: join(root, 'gone', 'codex.exe'), env, platform: 'win32', execFile: ask }), wanted)
  // Asked by the package's name, hidden and with a time limit.
  assert.equal(seen[0].command, 'powershell.exe')
  assert.ok(seen[0].args.includes('-NoProfile') && seen[0].args.some(arg => arg.includes('Get-AppxPackage OpenAI.Codex')))
  assert.equal(seen[0].options.windowsHide, true)
  assert.ok(seen[0].options.timeout > 0 && seen[0].options.timeout <= 15_000)
  // The folder of the Codex app comes first: the Store is not asked then.
  const before = seen.length
  const bin = join(root, 'local', 'OpenAI', 'Codex', 'bin', 'aaa')
  await mkdir(bin, { recursive: true })
  await writeFile(join(bin, 'codex.exe'), 'x')
  assert.equal(await findCodex({ env: { LOCALAPPDATA: join(root, 'local') }, platform: 'win32', execFile: ask }), join(bin, 'codex.exe'))
  assert.equal(seen.length, before)
  // A failing or silent PowerShell is "not found", never a throw.
  assert.equal(await findCodex({ env, platform: 'win32', execFile: (c, a, o, done) => done(new Error('timeout')) }), null)
  assert.equal(await findCodex({ env, platform: 'win32', execFile: () => { throw new Error('no powershell') } }), null)
})

test('the Store is never asked on a Mac or Linux', async () => {
  const seen = []
  assert.equal(await findCodex({ env: { PATH: '/nowhere' }, platform: 'darwin', execFile: storeAnswer(['1|/x'], seen) }), null)
  assert.equal(await findCodex({ env: { PATH: '/nowhere' }, platform: 'linux', execFile: storeAnswer(['1|/x'], seen) }), null)
  assert.deepEqual(seen, [])
})

// B1310 (A499, 2026-11-22): Codex drew the picture, its sandbox refused the copy into the job folder, so no picture.png.
test('a picture Codex drew but could not copy is kept from its own folder; none, or two, fail naming the folder', async t => {
  const out = await folder(t)
  const clean = join(HOMES, 'clean-b1310')
  const options = { codexHome: clean, userHome: join(HOMES, 'user'), command: FAKE, images: [], seconds: 20 }
  const generated = join(clean, 'generated_images')
  // An older picture of an earlier job lies there already: never taken for this job's.
  await mkdir(join(generated, 'old-session'), { recursive: true })
  await writeFile(join(generated, 'old-session', 'exec-old.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 7, 7, 7, 7]))
  await utimes(join(generated, 'old-session', 'exec-old.png'), 1_000, 1_000)

  const to = join(out, '1.png')
  const kept = await make({ ...options, prompt: 'DRAWNONE', to })
  assert.equal(kept.ok, true)
  assert.deepEqual([...(await readFile(to)).subarray(8)], [9, 9, 9, 9])
  assert.equal(await readFile(join(out, '1.prompt.txt'), 'utf8'), 'DRAWNONE')

  // The next job: two pictures made during it, not told apart.
  await rm(generated, { recursive: true, force: true })
  await mkdir(join(generated, 'old-session'), { recursive: true })
  const two = await make({ ...options, prompt: 'DRAWNTWO', to: join(out, '2.png') })
  assert.equal(two.ok, false)
  assert.ok(two.why.includes(generated) && /2 pictures/.test(two.why), two.why)
  // None at all (an older picture only): fails naming the folder.
  await rm(generated, { recursive: true, force: true })
  await mkdir(join(generated, 'old-session'), { recursive: true })
  await writeFile(join(generated, 'old-session', 'exec-old.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 7, 7, 7, 7]))
  await utimes(join(generated, 'old-session', 'exec-old.png'), 1_000, 1_000)
  const none = await make({ ...options, prompt: 'NOTHING', to: join(out, '3.png') })
  assert.equal(none.ok, false)
  assert.ok(none.why.includes(generated) && /no picture/.test(none.why), none.why)
  assert.deepEqual((await readdir(out)).sort(), ['1.png', '1.prompt.txt'])
})
