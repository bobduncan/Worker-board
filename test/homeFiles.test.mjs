// T5.2 A6b: the chat home's rules files once the board's data lives in `<data>`: CLAUDE.md and the two briefings point at their copies
// in `<data>/home`; a few files are one-way copies of a template there; a file that differs is one amber line with two buttons, the
// person's click only. With `data` unset nothing changes. A made-up wrapper folder (the chat home) holding the game repo (the project).

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { fixHomeFile, homeFilesNow, homeFilesOf, homeFilesPart, homeFileState, wanted, writeMissingPointers } from '../src/homeFiles.mjs'
import { removeDir } from './tempDir.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV = { USERPROFILE: 'C:\\Users\\someone', APPDATA: 'C:\\Users\\someone\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local' }

async function world(t, { withData = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'home-files-'))
  t.after(() => removeDir(dir))
  const wrapper = join(dir, 'kiwi-wrapper')
  const game = join(wrapper, 'kiwi')
  const data = join(game, '.workerboard')
  for (const one of [join(wrapper, '.claude', 'chats'), join(data, 'home', '.claude', 'chats')]) await mkdir(one, { recursive: true })
  await writeFile(join(data, 'home', 'CLAUDE.md'), '# Kiwi rules\n')
  await writeFile(join(data, 'home', '.claude', 'main-briefing.md'), 'Main: hand out.\n')
  await writeFile(join(data, 'home', '.claude', 'chats', 'list.json'), '{ "chats": [] }\n')
  const config = { project: game, gameRepo: game, chatHome: withData ? wrapper : '', data: withData ? data : '' }
  return { dir, wrapper, game, data, config }
}

test('with data unset there are no home files: nothing is read, written or shown', async t => {
  const one = await world(t, { withData: false })
  await writeFile(join(one.game, 'CLAUDE.md'), 'today\'s own rules\n')
  assert.deepEqual(homeFilesOf(one.config), [])
  assert.deepEqual(await homeFilesNow(one.config), [])
  assert.deepEqual((await writeMissingPointers(one.config)).written, [])
  assert.equal(await readFile(join(one.game, 'CLAUDE.md'), 'utf8'), 'today\'s own rules\n')
  const board = join(one.dir, 'board')
  await mkdir(board)
  await writeFile(join(board, 'config.json'), JSON.stringify({ ...one.config, appSessions: join(one.dir, 'app'), usageHistory: join(one.dir, 'u.json') }))
  assert.deepEqual(await homeFilesPart({ boardDir: board, isCheck: false, env: ENV }), { ok: true, lines: [] })
  assert.deepEqual(await homeFilesPart({ boardDir: join(one.dir, 'no-board'), isCheck: false, env: ENV }), { ok: true, lines: [] }, 'no config.json: nothing, and none made')
})

test('setup writes the missing pointers, relative to the chat home, and never a file that is there', async t => {
  const one = await world(t)
  await writeFile(join(one.wrapper, '.claude', 'worker-briefing.md'), 'the person\'s own words\n')
  const done = await writeMissingPointers(one.config)
  assert.deepEqual(done.written, ['CLAUDE.md', '.claude/main-briefing.md'], 'the worker briefing has no template yet, and is there')
  assert.equal(await readFile(join(one.wrapper, 'CLAUDE.md'), 'utf8'), '@kiwi/.workerboard/home/CLAUDE.md\n')
  assert.equal(await readFile(join(one.wrapper, '.claude', 'main-briefing.md'), 'utf8'), 'Your briefing as the main chat is in kiwi/.workerboard/home/.claude/main-briefing.md: read it there.\n')
  assert.equal(await readFile(join(one.wrapper, '.claude', 'worker-briefing.md'), 'utf8'), 'the person\'s own words\n')
  assert.deepEqual((await writeMissingPointers(one.config)).written, [], 'a second run writes nothing')
  const board = join(one.dir, 'board')
  await mkdir(board)
  await writeFile(join(board, 'config.json'), JSON.stringify({ ...one.config, appSessions: join(one.dir, 'app'), usageHistory: join(one.dir, 'u.json') }))
  await writeFile(join(one.wrapper, 'CLAUDE.md'), 'edited by hand\n')
  const checked = await homeFilesPart({ boardDir: board, isCheck: true, env: ENV })
  assert.deepEqual(checked.lines, [])
  assert.equal(await readFile(join(one.wrapper, 'CLAUDE.md'), 'utf8'), 'edited by hand\n', 'setup never overwrites')
})

test('a home file\'s state: same, differs, missing, or no template; line ends and a last newline do not count', () => {
  const [claude] = homeFilesOf({ project: 'C:\\w\\kiwi', chatHome: 'C:\\w', data: 'C:\\w\\kiwi\\.workerboard' })
  const pointer = wanted(claude, 'C:\\w', '# rules')
  assert.equal(pointer, '@kiwi/.workerboard/home/CLAUDE.md\n')
  assert.equal(homeFileState(claude, 'C:\\w', { text: pointer.replace('\n', '\r\n'), templateText: '# rules' }), 'same')
  assert.equal(homeFileState(claude, 'C:\\w', { text: '# rules\n', templateText: '# rules' }), 'differs')
  assert.equal(homeFileState(claude, 'C:\\w', { text: null, templateText: '# rules' }), 'missing')
  assert.equal(homeFileState(claude, 'C:\\w', { text: 'x', templateText: null }), 'no template')
  const all = homeFilesOf({ project: 'C:\\w\\kiwi', chatHome: 'C:\\w', data: 'C:\\w\\kiwi\\.workerboard' })
  const agents = all.find(one => one.name === 'AGENTS.md')
  assert.equal(homeFileState(agents, 'C:\\w', { text: 'rules 2', templateText: 'rules' }), 'differs')
  assert.equal(homeFileState(agents, 'C:\\w', { text: 'rules\n', templateText: 'rules' }), 'same')
  // The chat list and start.json change all the time: copied only at the move, never on the amber line.
  assert.deepEqual(all.map(one => one.name), ['CLAUDE.md', '.claude/main-briefing.md', '.claude/worker-briefing.md', 'AGENTS.md'])
  const [outside] = homeFilesOf({ project: 'D:\\kiwi', chatHome: 'C:\\w', data: 'D:\\kiwi\\.workerboard' })
  assert.equal(wanted(outside, 'C:\\w', ''), '@D:/kiwi/.workerboard/home/CLAUDE.md\n', 'a data home outside the chat home: its whole path')
})

test('the two buttons: Write again puts back what it should be; Copy this PC\'s keeps the chat home\'s text in the template', async t => {
  const one = await world(t)
  await writeMissingPointers(one.config)
  await writeFile(join(one.wrapper, 'CLAUDE.md'), '# Kiwi rules, edited here\n')
  assert.deepEqual((await homeFilesNow(one.config)).filter(f => f.state === 'differs').map(f => f.name), ['CLAUDE.md'])
  assert.equal((await fixHomeFile(one.config, { name: 'CLAUDE.md', action: 'adopt' })).ok, true)
  assert.equal(await readFile(join(one.data, 'home', 'CLAUDE.md'), 'utf8'), '# Kiwi rules, edited here\n', 'the edit kept with the data')
  assert.equal(await readFile(join(one.wrapper, 'CLAUDE.md'), 'utf8'), '@kiwi/.workerboard/home/CLAUDE.md\n', 'and the pointer back')
  assert.equal((await fixHomeFile(one.config, { name: 'AGENTS.md', action: 'write' })).status, 409, 'no template to write from')
  await writeFile(join(one.data, 'home', 'AGENTS.md'), 'the rules\n')
  await writeFile(join(one.wrapper, 'AGENTS.md'), 'edited\n')
  assert.equal((await fixHomeFile(one.config, { name: 'AGENTS.md', action: 'write' })).ok, true)
  assert.equal(await readFile(join(one.wrapper, 'AGENTS.md'), 'utf8'), 'the rules\n')
  await writeFile(join(one.wrapper, 'AGENTS.md'), 'edited\n')
  assert.equal((await fixHomeFile(one.config, { name: 'AGENTS.md', action: 'adopt' })).ok, true)
  assert.equal(await readFile(join(one.data, 'home', 'AGENTS.md'), 'utf8'), 'edited\n')
  // A chat list that differs from its template shows nothing, and no button can write it.
  await writeFile(join(one.wrapper, '.claude', 'chats', 'list.json'), '{ "chats": ["Main"] }\n')
  assert.deepEqual((await homeFilesNow(one.config)).filter(f => f.state === 'differs'), [])
  assert.equal((await fixHomeFile(one.config, { name: '.claude/chats/list.json', action: 'write' })).status, 400)
  assert.equal(await readFile(join(one.wrapper, '.claude', 'chats', 'list.json'), 'utf8'), '{ "chats": ["Main"] }\n')
  assert.equal((await fixHomeFile(one.config, { name: '../secret', action: 'write' })).status, 400)
  assert.equal((await fixHomeFile(one.config, { name: 'CLAUDE.md', action: 'delete' })).status, 400)
})

test('the page\'s amber line names the first file that differs, with its two buttons', async () => {
  const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
  const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8')
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// homeFiles:start'), script.indexOf('// homeFiles:end'))}\nthis.note = homeFilesNote`, page)
  assert.equal(page.note([]), null)
  assert.equal(page.note(undefined), null)
  assert.equal(page.note([{ name: 'CLAUDE.md', kind: 'pointer', state: 'same' }]), null)
  assert.deepEqual({ ...page.note([{ name: 'CLAUDE.md', kind: 'pointer', state: 'differs' }, { name: 'AGENTS.md', kind: 'copy', state: 'differs' }]) },
    { name: 'CLAUDE.md', text: 'CLAUDE.md in the chat home differs from its template: it should only point at its copy with the board\'s data (and 1 more after it).' })
  assert.match(html, /id="home-files-note" role="status" hidden><span id="home-files-note-text"><\/span> <button[^>]*id="home-files-write">Write again<\/button> <button[^>]*id="home-files-adopt">Copy this PC's into the template<\/button>/)
  assert.match(script, /drawSettingsIgnoredNote\(state\)\n {2}drawHomeFilesNote\(state\)/)
})

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

test('a real board: a CLAUDE.md that differs is in the state, the person\'s Write again fixes it, and the line is gone', { timeout: 240_000 }, async t => {
  const one = await world(t)
  await writeMissingPointers(one.config)
  await writeFile(join(one.wrapper, 'CLAUDE.md'), 'edited\n')
  const board = join(one.dir, 'board')
  for (const part of ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures', 'mods']) await cp(join(ROOT, part), join(board, part), { recursive: true })
  const empty = join(one.dir, 'app')
  for (const dir of [empty, join(board, 'data'), join(one.game, '.claude')]) await mkdir(dir, { recursive: true })
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'kiwi', ...one.config, port: await freePort(), gamePort: 7300, appSessions: empty, transcripts: empty, usageHistory: join(empty, 'none.json') }))
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, WORKER_BOARD_HOME: join(one.dir, 'pc'), WORKER_BOARD_CHILD: '1' }, windowsHide: true })
  // Ended here, before the test's folder is removed (an after hook would come behind the removal, which fails on a running board).
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const gone = new Promise(done => child.once('exit', done))
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      else child.kill('SIGKILL')
      await gone
    }
    child.stdout.destroy()
    child.stderr.destroy()
  }
  try {
  const port = await new Promise((done, fail) => {
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
    child.once('exit', code => { clearTimeout(late); fail(new Error(`The board ended (${code}): ${out}`)) })
  })
  const token = (await (await fetch(`http://127.0.0.1:${port}/`)).text()).match(/<meta name="board-token" content="([0-9a-f]+)">/)[1]
  const headers = { 'X-Board-Token': token, 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` }
  const state = async () => (await fetch(`http://127.0.0.1:${port}/api/state`, { headers })).json()
  assert.deepEqual((await state()).homeFiles, [{ name: 'CLAUDE.md', kind: 'pointer', state: 'differs' }])
  const fixed = await fetch(`http://127.0.0.1:${port}/api/home-file`, { method: 'POST', headers, body: JSON.stringify({ name: 'CLAUDE.md', action: 'write' }) })
  const said = await fixed.text()
  assert.equal(fixed.status, 200, said)
  assert.equal(await readFile(join(one.wrapper, 'CLAUDE.md'), 'utf8'), '@kiwi/.workerboard/home/CLAUDE.md\n')
  assert.deepEqual((await state()).homeFiles, [])
  } finally {
    await stop()
  }
})
