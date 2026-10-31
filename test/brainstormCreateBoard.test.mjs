// "Do what's ticked" of a change, end to end on a running board (a copy on a made-up project in a temporary folder): the board
// makes the ticked tasks itself in the work store, links them under their goal and the Done-when bullets they are for, writes
// the Created line with their ids, drops the ticked drop, and closes the goal's other running talk. The person, 2026-10-31:
// "i do not see if it created the new tasks or not. who is picking that up?". Made-up names only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseGoals } from '../src/goals.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'
import { MIN } from './partnerState.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(started, board, env) {
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

const TALK = '.claude/brainstorms/2026-10-12-how-we-lay-paths.md'
const CHANGE = '.claude/brainstorms/2026-10-19-change-paths-through-the-garden.md'
const TALK_TEXT = '# Brainstorm: How we lay paths\nGoal: G6 Paths through the garden\nStarted: 2026-10-12 20:00 · State: running\nOpening: What makes a good path?\n\n## Q1 (20:01)\nWhat is a path for?\nContext: The goal has one part so far.\n- A: getting somewhere (advised)\n- B: a stroll\nAnswer (20:05): A\n'
const CHANGE_TEXT = [
  '# Brainstorm: Change: Paths through the garden', 'Goal: G6 Paths through the garden', 'Kind: change', 'Started: 2026-10-19 09:00 · State: running', 'Opening: Steps are missing.', '',
  '## Q1 (09:01)', 'What is a path for?', 'Context: The goal has one part so far.', '- A: getting somewhere (advised)', 'Answer (09:02): A', '',
  '## Understood (09:05)', 'A path is good when a visitor reaches every bench without a map.', 'Answer (09:06): yes', '',
  '## Proposal (09:10)', 'Decided:', '- every bench reachable', 'Objective: A garden a visitor crosses without a map.', 'Done when:', '- 1. Every bench is on a path', '- 2. A visitor finds the gate from any bench',
  'Covered:', '- 1: B12', 'Steps:', '- [ ] Sign the gate from every bench — Digger — about 1 h — for 2', '- [ ] Join the dead ends — Main decides — about 30 min — for 2', '- [ ] Sweep the gravel — Digger — about 15 min',
  'Drop:', '- [ ] B13 — the old maze is no longer needed', 'Note: the visitor first.', '',
].join('\n')
const GOALS = [
  '# Goals', 'Last id: G6', 'Focus: G6', '', '- [~] G6 Paths through the garden', '  Done when: a visitor walks every path without getting lost', `  Brainstorm: ${TALK} (running)`, '  Steps: B12', '',
].join('\n')

test('Do what\'s ticked on a running board: the tasks are made, the Created line names them, the old talk is closed', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-create-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Garden · ","main":"Main","afterStep":"clear"}')
  for (const [id, name, role] of [['main-id', 'Main', 'main'], ['advisor-id', 'Advisor', 'worker']]) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW }))
    await put(join(app, 'a', 'b', `local_${name.toLowerCase()}.json`), JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: id, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW }))
    await put(join(transcripts, `${id}.jsonl`), `${typed(NOW - 9 * MIN, 'Status?')}\n${answer(NOW - 8 * MIN, 'All fine.')}\n`)
  }
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Garden\n- [ ] B12 Plant the hedge\n- [ ] B13 Mow the maze\n', { now: NOW }), undefined, { now: NOW })
  await put(join(project, '.claude', 'goals.md'), GOALS)
  await put(join(project, TALK), TALK_TEXT)
  await put(join(project, CHANGE), CHANGE_TEXT)
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'create', project, port, gamePort: 7342, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const base = `http://127.0.0.1:${port}`
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  assert.ok(token, 'the served page carries the token')

  const seen = (await readFile(join(project, CHANGE), 'utf8')).length
  const sent = await fetch(`${base}/api/brainstorm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base },
    body: JSON.stringify({ command: 'create', path: CHANGE, goals: [], steps: [0, 1], drops: [0], seen }),
  })
  assert.equal(sent.status, 200, await sent.clone().text())
  const result = await sent.json()

  // The two ticked tasks were made by the board: their ids come back with them and stand in the Created line.
  const ids = result.steps.map(one => one.id)
  assert.equal(ids.length, 2)
  assert.ok(ids.every(id => /^B\d+$/.test(id)), JSON.stringify(result.steps))
  assert.deepEqual(result.dropped, ['B13'])
  assert.deepEqual(result.replaced, [TALK])
  const thread = await readFile(join(project, CHANGE), 'utf8')
  assert.match(thread, new RegExp(`\\nCreated \\(\\d\\d:\\d\\d\\): no goals; tasks ${ids.join(', ')}; dropped: B13; left out: Sweep the gravel\\n`))
  assert.doesNotMatch(thread, /asked of the main chat/)

  // In the work store, new, under the goal, with where they came from; and the dropped one is dropped.
  for (const [id, title] of [[ids[0], 'Sign the gate from every bench'], [ids[1], 'Join the dead ends']]) {
    const item = await readFile(join(work, `${id}.md`), 'utf8')
    assert.match(item, new RegExp(`^Title: ${title}$`, 'm'))
    assert.match(item, /^State: new$/m)
    assert.match(item, /^Goal: G6$/m)
    assert.match(item, /from the brainstorm "Change: Paths through the garden"/)
  }
  assert.match(await readFile(join(work, 'B13.md'), 'utf8'), /^State: dropped$/m)

  // In the goal map: the steps under the goal and the bullet each is for, and the old talk's line reads (done).
  const goal = parseGoals(await readFile(join(project, '.claude', 'goals.md'), 'utf8')).byId.get('G6')
  assert.deepEqual(goal.steps, ['B12', ...ids])
  assert.deepEqual(goal.doneBullets.map(one => [one.n, one.steps]), [[1, ['B12']], [2, ids]])
  assert.deepEqual(goal.brainstorm, { path: TALK, state: 'done' })
  const talk = await readFile(join(project, TALK), 'utf8')
  assert.match(talk, /State: done/)
  assert.match(talk, /\nClosed \(\d\d:\d\d\): by the board, replaced by the change of G6\n/)

  // The state the page reads: the tasks are on the backlog as new, for the Result card.
  const state = await fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const rows = state.backlog.flatMap(activity => activity.steps).filter(step => ids.includes(step.id))
  assert.deepEqual(rows.map(step => step.item?.state), ['new', 'new'])
  const thread2 = state.brainstorms.threads.find(one => one.path === CHANGE)
  assert.deepEqual(thread2.proposal.created.steps, ids)
})
