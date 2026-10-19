// B406: a data file torn by a restart or a power cut no longer keeps the board from starting. The board sets the file
// aside as <name>.broken-<time>, starts without it, and its page says so; the page's note is tested here too. A copy
// of the board for a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { removeDir } from './tempDir.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures', 'mods']

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

test('a board whose data files were torn starts, sets them aside and says so on its page', { timeout: 120_000 }, async t => {
  // The board is stopped before its folder goes: a running board holds its files.
  const dir = await mkdtemp(join(tmpdir(), 'board-torn-'))
  let child = null
  t.after(async () => {
    if (child !== null && child.exitCode === null && child.signalCode === null) {
      const gone = new Promise(done => child.once('exit', done))
      child.kill('SIGKILL')
      await gone
    }
    await removeDir(dir)
  })
  const [board, project, empty] = [join(dir, 'kiwi-board'), join(dir, 'kiwi'), join(dir, 'kiwi-app')]
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  for (const one of [join(project, '.claude'), empty, join(board, 'data')]) await mkdir(one, { recursive: true })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({
    name: 'kiwi', project, port, gamePort: 7300, gameRepo: '', appSessions: empty, transcripts: empty, usageHistory: join(empty, 'none.json'),
  }))
  // Torn mid-write: the minute's task times, and an empty file where the rounds were.
  await writeFile(join(board, 'data', 'task-times.json'), '{"scans":{"s1":{"wor')
  await writeFile(join(board, 'data', 'rounds.json'), '')
  await writeFile(join(board, 'data', 'finished.json'), '{"B7":1}')

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
    child.once('exit', code => fail(new Error(`The board ended (${code}): ${out}`)))
  })

  const names = await readdir(join(board, 'data'))
  const asideOf = name => names.find(one => one.startsWith(`${name}.broken-`))
  assert.match(asideOf('task-times.json') ?? '', /^task-times\.json\.broken-\d{8}-\d{6}$/, names.join(' '))
  assert.match(asideOf('rounds.json') ?? '', /^rounds\.json\.broken-\d{8}-\d{6}$/, names.join(' '))
  assert.equal(await readFile(join(board, 'data', asideOf('task-times.json')), 'utf8'), '{"scans":{"s1":{"wor')
  // A file that parses is read as it is, and never set aside.
  assert.equal(asideOf('finished.json'), undefined)

  const page = await (await fetch(`http://127.0.0.1:${listening}/`)).text()
  const token = page.match(/<meta name="board-token" content="([0-9a-f]+)">/)[1]
  const state = await (await fetch(`http://127.0.0.1:${listening}/api/state`, { headers: { 'X-Board-Token': token } })).json()
  assert.deepEqual(state.setAside.map(one => one.file).sort(), ['rounds.json', 'task-times.json'])
  assert.equal(state.setAside.find(one => one.file === 'task-times.json').aside, asideOf('task-times.json'))
})

test('the page\'s note on top names each file set aside, and is gone when there is none', async () => {
  const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
  const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8')
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// setAside:start'), script.indexOf('// setAside:end'))}\nthis.setAsideNote = setAsideNote`, page)
  assert.equal(page.setAsideNote([]), null)
  assert.equal(page.setAsideNote(undefined), null)
  const note = page.setAsideNote([{ file: 'task-times.json', aside: 'task-times.json.broken-20261019-230509' }, { file: 'rounds.json', aside: 'rounds.json.broken-20261019-230509' }])
  assert.equal(note, 'At its start the board could not read task-times.json and rounds.json in its data folder (torn, perhaps by a restart or a power cut). It kept them aside as task-times.json.broken-20261019-230509 and rounds.json.broken-20261019-230509 and started without them. Delete those files once you no longer need them.')
  const one = page.setAsideNote([{ file: 'finished.json', aside: 'finished.json.broken-20261019-230509' }])
  assert.match(one, /could not read finished\.json in its data folder .* It kept it aside as finished\.json\.broken-20261019-230509 and started without it\. Delete that file once you no longer need it\.$/)
  // The note has its place on top, and the page draws it with the others.
  assert.match(html, /<p class="app-note is-problem" id="set-aside-note" role="status" hidden><\/p>/)
  assert.match(script, /\n {2}drawSetAsideNote\(state\)\n/)
})
