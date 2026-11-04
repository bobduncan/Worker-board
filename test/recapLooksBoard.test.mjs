// T20.1, end to end on a running board (the person, 2026-11-04: "These numbers are all over the place and non consistent"): the kept looks
// of the focus goal are rows of the recap; the popup's page holds them and counts them with the ready rows ("N to judge"), and the Send
// answers each one the person judged as the look's own window does (Looks right / Send back with the note) and wakes the chat that asked.
// A copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { migrateBacklog, stamp } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'
import { MIN, RUN_GOALS } from './partnerState.mjs'

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

async function until(check, what) {
  for (const end = Date.now() + 90_000; Date.now() < end;) {
    const found = await check()
    if (found) return found
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within 90 s: ${what}`)
}

const KEPT = 'Your partner hands this to you; Autopilot keeps it for the goal\'s recap'
/** A look Autopilot keeps for the goal's recap (the partner handed it over): routed to the recap, with the kept line in its Route section. */
const keptLook = (n, title, of = 'B19') => [
  `Id: Q${n}`, 'Kind: ask', `Title: ${title}`, 'State: open', 'Owner: Digger', `Since: ${stamp(NOW - 40 * MIN)}`, `Filed: ${NOW - 40 * MIN}`, `Pictures: art/B19/after${n}.jpg`,
  'Asks: look', 'Blocking: no', 'Advice: yes', `Of: ${of}`, 'Route: recap', '', '## Route', KEPT, '',
].join('\n')
const doneStep = (id, title) => [`Id: ${id}`, 'Kind: step', `Title: ${title}`, 'State: done', 'Owner: Digger', 'Goal: G6', 'Activity: Garden', `Since: ${stamp(NOW - 120 * MIN)}`, '', '## History', `- ${stamp(NOW - 120 * MIN)} Digger: review → done`, ''].join('\n')

test('the recap\'s Send answers the kept looks it holds: Looks right (your recap, round N) or Send back with the note, each chat woken with it; a Send of looks alone writes no round', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-looks-'))
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
  const people = [['main-id', 'Main', 'main'], ['digger-id', 'Digger', 'worker'], ['advisor-id', 'Advisor', 'worker']]
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  for (const [id, name, role] of people) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW }))
    await put(join(app, 'a', 'b', `local_${name.toLowerCase()}.json`), appChat(name, id))
    await put(join(transcripts, `${id}.jsonl`), `${typed(NOW - 9 * MIN, 'Status?')}\n${answer(NOW - 8 * MIN, 'All fine.')}\n`)
  }
  await put(join(project, '.claude', 'goals.md'), RUN_GOALS)
  // The recap: one row, whose step B15 is done (so the row is ready).
  const demo = { goal: 'G6', title: 'The polish', step: 'B12', sections: [{ kind: 'reached', rows: [{ title: '1. Lava', steps: ['B15'], pictures: [{ kind: 'target', caption: 't', path: 'a.png' }] }] }] }
  await put(join(project, 'pictures', 'g6', 'recap', 'demo.json'), JSON.stringify(demo))
  const work = join(project, '.claude', 'work')
  const backlog = ['## Garden', '- [ ] B12 The recap (for Digger; about 1 h)', '- [x] B15 Lava flows (for Digger; about 1 h)', '- [x] B19 Whole move squares (for Digger; about 1 h)', ''].join('\n')
  await writeStore(work, migrateBacklog(backlog, { now: NOW }), undefined, { now: NOW })
  await writeFile(join(work, 'B19.md'), doneStep('B19', 'Whole move squares'))
  await writeFile(join(work, 'B15.md'), doneStep('B15', 'Lava flows'))
  for (const [n, title] of [[590, 'Does the wizard\'s move range look right?'], [591, 'Does the bridge look right?'], [592, 'Does the ring look right?']]) await writeFile(join(work, `Q${n}.md`), keptLook(n, title))
  // A kept look of the step the recap's row names (B15): the verdict on that row does not answer it.
  await writeFile(join(work, 'Q593.md'), keptLook(593, 'Does the lava glow right?', 'B15'))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'recap', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), autopilot: true }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })

  const base = `http://127.0.0.1:${port}`
  const page = await fetch(`${base}/`).then(reply => reply.text())
  const token = /[0-9a-f]{64}/.exec(page)?.[0]
  assert.ok(token, 'the served page carries the token')
  const asPerson = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: await reply.text() }))
  const get = path => fetch(`${base}${path}`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const askText = id => readFile(join(work, `${id}.md`), 'utf8')
  const outbox = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text))
  const file = join(project, 'pictures', 'g6', 'recap')
  const send = body => asPerson('/api/demo-feedback', { path: 'pictures/g6/recap/demo.json', ...body })

  // The board holds the one count: 1 ready row + 4 kept looks.
  const now = await until(async () => { const state = await get('/api/state'); return state.recapRound?.looks?.length === 4 ? state : null }, 'the state with the four kept looks')
  assert.deepEqual([now.recapRound.ready, now.recapRound.toJudge, now.recapCard.count], [1, 5, 5])
  const shown = await get('/api/demo?path=pictures/g6/recap/demo.json')
  assert.deepEqual([shown.looks.map(one => one.key), shown.feedback.toJudge, shown.feedback.canSend], [['look:Q590', 'look:Q591', 'look:Q592', 'look:Q593'], 5, true])

  // A look the popup does not hold is refused, and nothing is written.
  const unknown = await send({ round: 1, parts: [{ key: 'look:Q999', verdict: 'approved' }] })
  assert.equal(unknown.status, 400, unknown.body)

  // The Send: the row approved, one look right, one look sent back.
  const first = await send({ round: 1, parts: [{ key: '1. Lava', verdict: 'approved' }, { key: 'look:Q590', verdict: 'approved' }, { key: 'look:Q591', verdict: 'sent-back', comment: 'the bridge is too long' }] })
  assert.equal(first.status, 200, first.body)
  assert.equal(JSON.parse(first.body).looks, 2)
  assert.match(await askText('Q590'), /^State: answered$/m)
  assert.match(await askText('Q590'), /## Answer\nApproved\. Looks right \(your recap, round 1\)/)
  assert.match(await askText('Q591'), /^State: answered$/m)
  assert.match(await askText('Q591'), /## Answer\nRejected\. Send back: the bridge is too long/)
  assert.match(await askText('Q592'), /^State: open$/m, 'the look the person did not judge stays open')
  assert.match(await askText('Q593'), /^State: open$/m, 'so does a look of the step of the row they approved: the verdict on the row is not its answer')
  // The chat that asked is woken with each answer.
  const wakes = await until(async () => { const said = (await outbox()).filter(one => one.to === 'Digger'); return said.length >= 2 ? said : null }, 'the words to the chat that asked')
  assert.ok(wakes.some(one => /Looks right \(your recap, round 1\)/.test(one.text ?? '')))
  assert.ok(wakes.some(one => /Send back: the bridge is too long/.test(one.text ?? '')))
  const rounds = JSON.parse(await readFile(join(file, 'feedback.json'), 'utf8')).rounds
  assert.deepEqual(rounds.map(round => round.parts.map(part => part.key)), [['1. Lava']], 'feedback.json holds the rows only')

  // Every row approved, a look left: a Send of that look alone is a Send, and writes no round.
  const left = await until(async () => { const state = await get('/api/state'); return state.recapRound?.looks?.length === 2 ? state : null }, 'the state with the two looks left')
  assert.equal(left.recapRound.toJudge, 2)
  const alone = await send({ round: 1, parts: [{ key: 'look:Q592', verdict: 'approved', comment: 'good' }] })
  assert.equal(alone.status, 200, alone.body)
  assert.deepEqual([JSON.parse(alone.body).looks, JSON.parse(alone.body).approved, JSON.parse(alone.body).sentBack], [1, 0, 0])
  assert.match(await askText('Q592'), /## Answer\nApproved\. Looks right \(your recap, round 1\): good/)
  assert.equal(JSON.parse(await readFile(join(file, 'feedback.json'), 'utf8')).rounds.length, 1, 'no round of its own')
  // The look of the row's step is still to judge; once it is, nothing is left and the recap takes no more.
  assert.match(await askText('Q593'), /^State: open$/m)
  assert.equal((await send({ round: 1, parts: [{ key: 'look:Q593', verdict: 'approved' }] })).status, 200)
  assert.equal((await send({ round: 1, parts: [{ key: '1. Lava', verdict: 'approved' }] })).status, 409)
})
