// B721, B733, end to end on a running board (B716's words through the server's own pass): the partner is told once of a
// question that stands in a talk the person cannot reach, never for a question the store has an ask of its goal for (the
// words decide nothing: one that only says "asked as Q428" is told) or for a done goal's talk, and not again after the
// board starts anew. A copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MIN = 60_000

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(started, board, env) {
  // The copy reads no Workers mod installed on this PC (an empty Claude folder beside it).
  const claude = join(dirname(board), 'claude-config')
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, CLAUDE_CONFIG_DIR: claude, ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
  started.push(child)
  return new Promise((done, fail) => {
    let out = ''
    const late = setTimeout(() => fail(new Error(`The board did not start: ${out}`)), 90_000)
    const read = chunk => {
      out += chunk
      if (!/Worker board: http:\/\/127\.0\.0\.1:\d+\//.test(out)) return
      clearTimeout(late)
      done(child)
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('exit', code => {
      clearTimeout(late)
      fail(new Error(`The board ended (${code}): ${out}`))
    })
  })
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const gone = new Promise(done => child.once('exit', done))
  child.kill('SIGKILL')
  await gone
}

async function until(check, what) {
  for (const end = Date.now() + 90_000; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within 90 s: ${what}`)
}

const GOAL = 'G6 Benches that match the picture'
const head = goal => `# Brainstorm: Lanterns\nGoal: ${goal}\nStarted: 2026-10-15 21:00 · State: running\nOpening: Where do lanterns go?\n\n`
const created = [
  '## Q1 (21:01)', 'Where first?', 'Why: it decides the order.', '- A: by the gate (advised)', '- B: by the pond', 'Answer (21:02): A', '',
  '## Proposal (21:20)', 'Decided:', '- the gate first', 'Goals:', '- [ ] Lanterns by the gate — under G6 — Done when: a visitor finds the gate at night',
  'Steps:', '- [ ] Make a lantern sprite — Units — about 1 h', 'Note: most visitors come in by the gate.',
  'Created (21:25): G22; 1 step asked of the main chat; left out: nothing', '',
].join('\n')
const question = why => `\n## Q3 (22:30)\nKeep the approach?\nContext: It failed three times.\nWhy: ${why}\n- A: keep (advised)\n- B: rebuild\n`

test('a question in a talk the person cannot reach is told to the partner once; one the store has an ask for or a done goal\'s talk is not', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-stranded-'))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const [board, project, app, transcripts] = ['board', 'project', 'app', 'transcripts'].map(name => join(dir, name))
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  const put = async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const chats = join(project, '.claude', 'chats')
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main","afterStep":"clear"}')
  await put(join(chats, 'main-id.json'), JSON.stringify({ name: 'Main', role: 'main', state: 'waiting', task: null, at: NOW }))
  await put(join(chats, 'advisor-id.json'), JSON.stringify({ name: 'Advisor', role: 'worker', state: 'waiting', task: null, at: NOW }))
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  await put(join(app, 'a', 'b', 'local_main.json'), appChat('Main', 'main-id'))
  await put(join(app, 'a', 'b', 'local_advisor.json'), appChat('Advisor', 'advisor-id'))
  for (const id of ['main-id', 'advisor-id']) await put(join(transcripts, `${id}.jsonl`), `${typed(NOW - 9 * MIN, 'Status?')}\n${answer(NOW - 8 * MIN, 'All fine.')}\n`)
  await put(join(project, '.claude', 'goals.md'), '# Goals\nLast id: G7\n\n- [~] G6 Benches that match the picture\n- [x] G7 An old goal\n- [~] G8 Lamps\n')
  const talks = join(project, '.claude', 'brainstorms')
  await put(join(talks, '2026-10-15-stuck.md'), `${head(GOAL)}${created}${question('your choice is asked as Q428, not here.')}`)
  await put(join(talks, '2026-10-15-asked-in-store.md'), `${head('G8 Lamps')}${created}${question('nothing new to choose.')}`)
  await put(join(project, '.claude', 'work', 'Q430.md'), ['Id: Q430', 'Kind: ask', 'Title: Keep the approach?', 'State: open', 'Owner: Advisor', `Since: ${new Date(NOW).toISOString().slice(0, 10)} 12:00`, `Filed: ${NOW}`, 'Asks: decide', 'Blocking: no', 'Of: G8', '', '## Text', 'Keep the approach?', ''].join('\n'))
  await put(join(talks, '2026-10-15-done-goal.md'), `${head('G7 An old goal')}${created}${question('nothing new to choose.')}`)
  await put(join(talks, '2026-10-15-running.md'), `${head(GOAL)}## Q1 (21:01)\nWhere first?\nContext: It decides the order.\n- A: by the gate (advised)\n- B: by the pond\n`)
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'stranded', project, port, gamePort: 7330, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const env = { WORKER_BOARD_HOME: join(dir, 'pc') }
  const told = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => ''))
    .split('\n').filter(Boolean).map(text => JSON.parse(text)).filter(message => message.command === 'brainstorm-stranded')

  const first = await run(started, board, env)
  await until(async () => (await told()).length > 0, 'the word about the stuck talk in the outbox')
  const [word, ...more] = await told()
  assert.deepEqual(more, [])
  assert.match(word.text, /^brainstorm stranded\nThread: \S*2026-10-15-stuck\.md\nQ3 in \S+ cannot reach the person: ask it with work ask/)

  // The board starts anew: the same question is not told again. A second stuck talk written meanwhile is told, which shows
  // that the new board's pass ran.
  await stop(first)
  await put(join(talks, '2026-10-16-stuck-too.md'), `${head(GOAL)}${created}${question('nothing new either.')}`)
  await run(started, board, env)
  await until(async () => (await told()).length > 1, 'the word about the second stuck talk')
  const all = await told()
  assert.deepEqual(all.map(message => message.text.split('\n')[1].replace(/^Thread: .*[\\/]/, 'Thread: ')).sort(), ['Thread: 2026-10-15-stuck.md', 'Thread: 2026-10-16-stuck-too.md'])
})
