// B878 (X116), end to end on a running board: a goal recap's part names the steps it shows. A step in review whose fix was
// dropped waits for the person's verdict there (the Backlog line says so); their Send back puts their words on the step and
// names it to the partner; their Approve closes it (done, their verdict in its History); a step not in review stays as it is.
// A copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

/** A step in review whose board check passed and whose result check failed, making the fix `fix`. */
const reviewStep = (id, title, fix) => [
  `Id: ${id}`, 'Kind: step', `Title: ${title}`, 'State: review', 'Owner: Digger', 'Activity: Garden', `Since: ${stamp(NOW - 120 * MIN)}`, '',
  '## What we build', '- a round pool', '',
  '## History',
  `- ${stamp(NOW - 120 * MIN)} Digger: in progress → review`,
  `- ${stamp(NOW - 119 * MIN)} server: check passed: work in garden; result named`,
  `- ${stamp(NOW - 110 * MIN)} Checker: result check failed: 1 of 2 points pass; fix ${fix} for Digger`, '',
].join('\n')
const droppedFix = (id, of) => [`Id: ${id}`, 'Kind: step', `Title: Fix: ${of}`, 'State: dropped', 'Owner: Digger', 'Activity: Garden', `Fix of: ${of}`,
  `Since: ${stamp(NOW - 100 * MIN)}`, '', '## History', `- ${stamp(NOW - 100 * MIN)} Advisor: new → dropped`, ''].join('\n')

test('a recap part names its steps: waits for the verdict, Send back words them, Approve closes those in review', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-verdict-'))
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
  const demo = {
    goal: 'G6', title: 'The polish', step: 'B12',
    sections: [
      { kind: 'reached', rows: [{ title: '1. Lava', steps: ['B15'], pictures: [{ kind: 'target', caption: 't', path: 'a.png' }] }] },
      { kind: 'not-reached', rows: [{ title: '3. Round shapes', steps: ['B13', 'B14'], pictures: [{ kind: 'final-not', caption: 'last', path: 'c.png' }] }] },
    ],
  }
  // Under the goal's own folder, as a recap is placed (pictures/<goal>/<any>/demo.json).
  await put(join(project, 'pictures', 'g6', 'recap', 'demo.json'), JSON.stringify(demo))
  const work = join(project, '.claude', 'work')
  const backlog = ['## Garden', '- [ ] B12 The recap (for Digger; about 1 h)', '- [ ] B13 Round pool (for Digger; about 1 h)', '- [ ] B14 Round ring (for Digger; about 1 h)',
    '- [ ] B15 Lava flows (for Digger; about 1 h)', '- [ ] B16 Fix: B13 (for Digger; about 1 h)', '- [ ] B17 Fix: B14 (for Digger; about 1 h)', ''].join('\n')
  await writeStore(work, migrateBacklog(backlog, { now: NOW }), undefined, { now: NOW })
  await writeFile(join(work, 'B13.md'), reviewStep('B13', 'Round pool', 'B16'))
  await writeFile(join(work, 'B14.md'), reviewStep('B14', 'Round ring', 'B17'))
  await writeFile(join(work, 'B16.md'), droppedFix('B16', 'B13'))
  await writeFile(join(work, 'B17.md'), droppedFix('B17', 'B14'))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'recap', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })

  const base = `http://127.0.0.1:${port}`
  const page = await fetch(`${base}/`).then(reply => reply.text())
  const token = /[0-9a-f]{64}/.exec(page)?.[0]
  assert.ok(token, 'the served page carries the token')
  const asPerson = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: await reply.text() }))
  const stateNow = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const waitOf = async id => (await stateNow()).backlog.flatMap(activity => activity.steps).find(step => step.id === id)?.reviewWait ?? null
  const stepText = id => readFile(join(work, `${id}.md`), 'utf8')
  const outbox = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text))
  const send = body => asPerson('/api/demo-feedback', { path: 'pictures/g6/recap/demo.json', ...body })

  // Before the person's verdict: the Backlog line says what the step waits for.
  await until(async () => (await waitOf('B13')) === 'waits for your verdict in the recap of G6', 'the recap wait on the Backlog')
  assert.equal(await waitOf('B14'), 'waits for your verdict in the recap of G6')

  // Round 1: the round shapes sent back, lava approved (B15 is not in review: it stays as it is).
  const first = await send({ round: 1, parts: [{ key: '1. Lava', verdict: 'approved' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'still stepped' }] })
  assert.equal(first.status, 200, first.body)
  assert.deepEqual(JSON.parse(first.body).closed, [])
  assert.doesNotMatch(await stepText('B15'), /^State: done$/m)
  for (const id of ['B13', 'B14']) {
    const text = await stepText(id)
    assert.match(text, /^State: review$/m)
    assert.match(text, /Sent back in the recap of G6, round 1: 3\. Round shapes: "still stepped"/)
  }
  const word = await until(async () => (await outbox()).find(message => message.command === 'recap-feedback') ?? null, 'the word to the partner')
  assert.match(word.text, /- 3\. Round shapes \(steps B13, B14: block each on its next try\): "still stepped"/)
  const back = await until(async () => { const said = await waitOf('B13'); return said?.includes('sent back') ? said : null }, 'the sent-back wait')
  assert.equal(back, 'its fix B16 was dropped; sent back in the recap of G6: the partner makes its next try')

  // Round 2, approved: both steps are closed, the person's verdict in their History.
  const second = await send({ round: 2, parts: [{ key: '3. Round shapes', verdict: 'approved' }] })
  assert.equal(second.status, 200, second.body)
  assert.deepEqual(JSON.parse(second.body).closed, ['B13', 'B14'])
  for (const id of ['B13', 'B14']) {
    const text = await stepText(id)
    assert.match(text, /^State: done$/m)
    assert.match(text, /person: review → done\r?\n- \d{4}-\d\d-\d\d \d\d:\d\d person: approved in the recap of G6, round 2/)
  }
})
