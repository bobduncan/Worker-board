// 2026-11-09 (reactive board, brief A, round 3): the Vision decisions through the REAL server route (planNow in server.mjs) on a copy of
// the board on a made-up project; the original header follows. B730 (the server's part of Partner answers, 2026-10-19, end to end on a running board instead of matched in server.mjs's
// text): the partner's answer through the work tool wakes the chat that asked, the person's answer on the page does the
// same, an Undo of a partner's answer is told to the asking chat and not typed to the partner, and the daily note of the
// focus goal gets the line. A copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'
import { MIN, RUN_GOALS } from './partnerState.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MOD = '0.17.0'

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

const PLAN = `# Garden: the product plan

Pitch: A garden you can sit in.

## P7 · The road

- State: assumed (partner, 2026-10-18) · revisit after the first bench
- Point: **First** a bench

## Standards

### K2 · Paths

- State: proposed
- Bar: gravel, lit at night
`

/** A copy of the board on a made-up project, with the partner chat or without it. */
async function startBoard(t, { withAdvisor }) {
  const dir = await mkdtemp(join(tmpdir(), 'board-decide-'))
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
  const people = [['main-id', 'Main', 'main'], ...(withAdvisor ? [['advisor-id', 'Advisor', 'worker']] : [])]
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  for (const [id, name, role] of people) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW }))
    await put(join(app, 'a', 'b', `local_${name.toLowerCase()}.json`), appChat(name, id))
    await put(join(transcripts, `${id}.jsonl`), `${typed(NOW - 9 * MIN, 'Status?')}\n${answer(NOW - 8 * MIN, 'All fine.')}\n`)
  }
  await put(join(project, '.claude', 'goals.md'), RUN_GOALS)
  const planFile = join(project, 'docs', 'product-plan.md')
  await put(planFile, PLAN)
  // The partner's page is older than the person's words: set its time back.
  const old = new Date(Date.now() - 3600_000)
  await utimes(planFile, old, old)
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Garden\n- [ ] B12 Plant the hedge (for Digger; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'decide', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })

  const base = `http://127.0.0.1:${port}`
  const page = await fetch(`${base}/`).then(reply => reply.text())
  const token = /[0-9a-f]{64}/.exec(page)?.[0]
  assert.ok(token, 'the served page carries the token')
  const asPerson = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: await reply.text() }))
  const state = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const outbox = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text))
  const plan = () => readFile(planFile, 'utf8')

  return { board, planFile, asPerson, state, outbox, plan }
}

test('the real route: a Confirm is written into the plan first, then the word goes to the partner; a pending word of the partner stays pending', { timeout: 300_000 }, async t => {
  const { board, planFile, asPerson, state, outbox, plan } = await startBoard(t, { withAdvisor: true })
  // A judgment word first: Go deeper on P7 waits for the partner.
  const deeper = await asPerson('/api/plan', { command: 'plan-deeper', id: 'P7' })
  assert.equal(deeper.status, 200, deeper.body)
  assert.equal(await plan(), PLAN, 'a judgment word writes nothing')
  await until(async () => (await state()).plan?.working?.some(one => one.command === 'plan-deeper'), 'the Go deeper line')

  // The Confirm: written at once, by the board; the word to the partner says so.
  const refused = await asPerson('/api/plan', { command: 'plan-confirm', id: 'P99' })
  assert.equal(refused.status, 404)
  assert.equal(await plan(), PLAN)
  const done = await asPerson('/api/plan', { command: 'plan-confirm', id: 'P7' })
  assert.equal(done.status, 200, done.body)
  assert.match(await plan(), /- State: decided \(you, \d{4}-\d{2}-\d{2}\)\r?\n- Point: \*\*First\*\* a bench/)
  const word = await until(async () => (await outbox()).findLast(message => message.command === 'plan-confirm'), 'the word to the partner')
  assert.equal(word.to, 'Advisor')
  assert.match(word.text, /^plan: P7 confirmed\nThe person confirmed P7; it is written in the plan\./)
  assert.match(word.text, /commit and push the page/)
  // The board's own write is not the partner's answer: Go deeper is still being prepared, and no line stands for the Confirm.
  const after = await state()
  assert.equal(after.plan.working.some(one => one.command === 'plan-deeper'), true)
  assert.equal(after.plan.working.some(one => one.command === 'plan-confirm'), false)
  assert.equal(after.plan.answers.find(one => one.id === 'P7').state, 'decided')
  // The record of the write is a data file; a later write of the partner (another time on the file) ends the pending word.
  assert.equal(JSON.parse(await readFile(join(board, 'data', 'plan-writes.json'), 'utf8'))[planFile].ids[0], 'P7')
  const later = new Date(Date.now() + 60_000)
  await writeFile(planFile, `${await plan()}\n`)
  await utimes(planFile, later, later)
  await until(async () => !(await state()).plan.working.some(one => one.command === 'plan-deeper'), 'the partner write ends the Go deeper line')
})

test('the real route with no partner chat: the decision is written, no word goes out, the answer carries the quiet note', { timeout: 300_000 }, async t => {
  const { board, planFile, asPerson, outbox, plan } = await startBoard(t, { withAdvisor: false })
  // The board may type its own start-up words (a spawn word to Main) at any time: only words not for Main count.
  const planWords = async () => (await outbox()).filter(message => message.to !== 'Main')
  const before = (await planWords()).length
  const done = await asPerson('/api/plan', { command: 'plan-confirm', id: 'P7' })
  assert.equal(done.status, 200, done.body)
  assert.equal(JSON.parse(done.body).note, 'Written. No partner chat on the board: it reads it when one starts.')
  assert.match(await plan(), /- State: decided /)
  assert.equal((await planWords()).length, before, 'no plan word is typed to anyone')
  assert.equal((await asPerson('/api/plan', { command: 'plan-deeper', id: 'P7' })).status, 409)
  assert.equal(JSON.parse(await readFile(join(board, 'data', 'plan-writes.json'), 'utf8'))[planFile].ids[0], 'P7')
})
