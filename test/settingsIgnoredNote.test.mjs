// T5.2 A7: while the project's settings file is in use, project keys config.json still holds are ignored; the page says so in one
// amber line on top. And the carry tool reads this PC's pictures home from config.json (setup's pictures question). A made-up board.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { removeDir } from './tempDir.mjs'
import { rootsOf } from '../tools/carry.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures', 'mods']

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

/** A copy of the board in a temp folder, started on `config` (and `settings` in its data folder when given): the state it serves. */
async function boardState(t, { config, settings = null }) {
  const dir = await mkdtemp(join(tmpdir(), 'board-ignored-'))
  let child = null
  t.after(async () => {
    if (child !== null && child.exitCode === null && child.signalCode === null) {
      const gone = new Promise(done => child.once('exit', done))
      child.kill('SIGKILL')
      await gone
    }
    await removeDir(dir)
  })
  const [board, project, empty, data] = [join(dir, 'kiwi-board'), join(dir, 'kiwi'), join(dir, 'kiwi-app'), join(dir, 'kiwi-data')]
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  for (const one of [join(project, '.claude'), empty, join(board, 'data'), data]) await mkdir(one, { recursive: true })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({
    name: 'kiwi', project, port, gamePort: 7300, gameRepo: '', appSessions: empty, transcripts: empty, usageHistory: join(empty, 'none.json'),
    ...(settings === null ? {} : { data }), ...config,
  }))
  if (settings !== null) await writeFile(join(data, 'board-settings.json'), JSON.stringify(settings))
  child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_CHILD: '1' }, windowsHide: true })
  const listening = await new Promise((done, fail) => {
    let out = ''
    const late = setTimeout(() => fail(new Error(`The board did not start: ${out}`)), 90_000)
    const read = chunk => {
      out += chunk
      const said = out.match(/Worker board: http:\/\/127\.0\.0\.1:(\d+)\//)
      if (said === null) return
      clearTimeout(late)
      done(Number(said[1]))
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('exit', code => {
      clearTimeout(late)
      fail(new Error(`The board ended (${code}): ${out}`))
    })
  })
  const page = await (await fetch(`http://127.0.0.1:${listening}/`)).text()
  const token = page.match(/<meta name="board-token" content="([0-9a-f]+)">/)[1]
  return (await fetch(`http://127.0.0.1:${listening}/api/state`, { headers: { 'X-Board-Token': token } })).json()
}

test('a board with the project\'s settings file names the project keys config.json still holds; one without has none', { timeout: 240_000 }, async t => {
  const used = await boardState(t, { config: { maxWorkers: 9, approveRebuilds: true }, settings: { name: 'kiwi', maxWorkers: 2 } })
  assert.deepEqual(used.settingsIgnored, { file: 'board-settings.json', keys: ['approveRebuilds', 'maxWorkers', 'name'] })
  const today = await boardState(t, { config: { maxWorkers: 9 } })
  assert.equal(today.settingsIgnored, null, 'no data: nothing changes')
})

test('the page\'s amber line names the keys and the file, and is gone when there is none', async () => {
  const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
  const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8')
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// settingsIgnored:start'), script.indexOf('// settingsIgnored:end'))}\nthis.note = settingsIgnoredNote`, page)
  assert.equal(page.note(null), null)
  assert.equal(page.note(undefined), null)
  assert.equal(page.note({ file: 'board-settings.json', keys: [] }), null)
  assert.equal(page.note({ file: 'board-settings.json', keys: ['maxWorkers'] }),
    'config.json still holds "maxWorkers": the board ignores it there and reads the project\'s settings from board-settings.json. Move it into board-settings.json (or delete it from config.json).')
  assert.match(page.note({ file: 'board-settings.json', keys: ['a', 'b', 'c'] }), /^config\.json still holds "a", "b" and "c": the board ignores them there .* Move them into/)
  assert.match(html, /<p class="app-note is-problem" id="settings-ignored-note" role="status" hidden><\/p>/)
  assert.match(script, /drawSetAsideNote\(state\)\n {2}drawSettingsIgnoredNote\(state\)/)
})

test('the carry tool takes this PC\'s pictures home from config.json, else its record; --pictures before both', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'carry-pictures-home-'))
  t.after(() => removeDir(dir))
  const project = join(dir, 'kiwi')
  const configOf = extra => writeFile(join(dir, 'config.json'), JSON.stringify({ project, gameRepo: project, appSessions: join(dir, 'app'), usageHistory: join(dir, 'u.json'), ...extra }))
  await mkdir(join(dir, 'data'), { recursive: true })
  await writeFile(join(dir, 'data', 'carry.json'), JSON.stringify({ picturesHome: join(dir, 'recorded') }))
  const roots = flags => rootsOf({ boardDir: dir, flags: { remote: 'https://example.test/kiwi.git', ...flags }, env: {}, git: async () => { throw new Error('no git here') } })
  await configOf({ picturesHome: join(dir, 'drive') })
  assert.equal((await roots({})).picturesFolder, join(dir, 'drive'))
  assert.equal((await roots({ pictures: join(dir, 'flag') })).picturesFolder, join(dir, 'flag'))
  await configOf({})
  assert.equal((await roots({})).picturesFolder, join(dir, 'recorded'), 'no picturesHome: the record as before')
})
