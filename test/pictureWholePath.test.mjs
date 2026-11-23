// F49: a check's Evidence line may hold a whole path. A whole path inside the project is read as its stored path; nothing outside the
// project, or outside the folders the board shows, becomes readable. A real board on a made-up project.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { storedOfWholePath } from '../src/projectPaths.mjs'
import { removeDir } from './tempDir.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('a whole path inside the project is its stored path; anything else stays as given', () => {
  const config = { project: 'D:\\kiwi', data: '' }
  assert.equal(storedOfWholePath(config, 'D:\\kiwi\\shots\\b1\\x.png'), 'shots/b1/x.png')
  assert.equal(storedOfWholePath(config, 'd:/KIWI/shots/x.png'), 'shots/x.png', 'Windows: the case of a path does not count')
  for (const value of ['shots/x.png', 'D:\\kiwi-other\\shots\\x.png', 'D:\\elsewhere\\x.png', 'D:\\kiwi\\..\\elsewhere\\x.png', 'D:\\kiwi\\shots\\..\\..\\x.png', 'D:\\kiwi\\.\\shots\\x.png', 'D:\\kiwi', '', null]) {
    assert.equal(storedOfWholePath(config, value), value, String(value))
  }
  const moved = { project: 'D:\\kiwi', data: 'D:\\kiwi\\.workerboard', pictureRoots: ['shots'] }
  assert.equal(storedOfWholePath(moved, 'D:\\kiwi\\.workerboard\\pictures\\shots\\x.png'), 'shots/x.png', 'with the data moved: from its pictures folder')
})

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

test('the picture route on a real board: a whole path inside opens; one outside, with .., or in a folder not shown does not', { timeout: 200_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'picture-whole-'))
  t.after(() => removeDir(dir))
  const [board, project, empty] = [join(dir, 'kiwi-board'), join(dir, 'kiwi'), join(dir, 'kiwi-app')]
  for (const part of ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures', 'mods']) await cp(join(ROOT, part), join(board, part), { recursive: true })
  for (const one of [join(project, '.claude'), join(project, 'shots', 'b1'), join(project, 'private'), empty, join(board, 'data'), join(dir, 'kiwi-other', 'shots')]) await mkdir(one, { recursive: true })
  for (const file of [join(project, 'shots', 'b1', 'x.png'), join(project, 'private', 'x.png'), join(dir, 'outside.png'), join(dir, 'kiwi-other', 'shots', 'x.png')]) await writeFile(file, PNG)
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'kiwi', project, port: await freePort(), gamePort: 7300, gameRepo: '', pictureRoots: ['shots'], appSessions: empty, transcripts: empty, usageHistory: join(empty, 'none.json') }))
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_CHILD: '1' }, windowsHide: true })
  try {
    const port = await new Promise((done, fail) => {
      let out = ''
      const late = setTimeout(() => fail(new Error(`The board did not start: ${out}`)), 120_000)
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
    const statusOf = async path => {
      const answer = await fetch(`http://127.0.0.1:${port}/api/picture?path=${encodeURIComponent(path)}`, { headers: { 'X-Board-Token': token } })
      await answer.arrayBuffer()
      return answer.status
    }
    assert.equal(await statusOf('shots/b1/x.png'), 200, 'the stored path, as before')
    assert.equal(await statusOf(join(project, 'shots', 'b1', 'x.png')), 200, 'the whole path inside the project')
    assert.equal(await statusOf(join(dir, 'outside.png')), 404, 'a whole path outside the project')
    assert.equal(await statusOf(join(dir, 'kiwi-other', 'shots', 'x.png')), 404, 'a folder that only starts like the project')
    assert.equal(await statusOf(`${project}\\shots\\..\\..\\outside.png`), 404, 'out of it with ..')
    assert.equal(await statusOf(`${project}\\shots\\..\\private\\x.png`), 404, 'with .. inside it')
    assert.equal(await statusOf(join(project, 'private', 'x.png')), 404, 'inside the project, in a folder the board does not show')
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const gone = new Promise(done => child.once('exit', done))
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      else child.kill('SIGKILL')
      await gone
    }
    child.stdout.destroy()
    child.stderr.destroy()
  }
})
