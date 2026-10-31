// B730 (the server's part of Partner answers, 2026-10-19, end to end on a running board instead of matched in server.mjs's
// text): the partner's answer through the work tool wakes the chat that asked, the person's answer on the page does the
// same, an Undo of a partner's answer is told to the asking chat and not typed to the partner, and the daily note of the
// focus goal gets the line. A copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

test('a partner\'s answer, a person\'s answer and an Undo reach the chat that asked, and the focus goal\'s daily note holds the line', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-partner-'))
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
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Garden\n- [ ] B12 Plant the hedge (for Digger; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'partner', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })

  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const base = `http://127.0.0.1:${port}`
  const page = await fetch(`${base}/`).then(reply => reply.text())
  const token = /[0-9a-f]{64}/.exec(page)?.[0]
  assert.ok(token, 'the served page carries the token')
  const asChat = (chat, body) => fetch(`${base}/api/bridge/work`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': MOD }, body: JSON.stringify({ chat, session: `${chat.toLowerCase()}-id`, ...body }),
  }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  const asPerson = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: await reply.text() }))
  const state = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const outbox = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text))
  const toChat = async (name, pattern) => (await outbox()).filter(message => message.to === name && pattern.test(message.text ?? ''))
  const idOf = reply => reply.body.result?.id ?? reply.body.id

  // Digger asks with options and advice: the board routes it to the partner.
  const taken = await asChat('Digger', { action: 'take', minutes: 30, id: 'B12', branch: 'b12' })
  assert.equal(taken.status, 200, JSON.stringify(taken.body))
  const asked = await asChat('Digger', { action: 'ask', of: 'B12', kind: 'decide', blocking: true, text: 'Box or yew?', options: ['A box', 'B yew'], advice: 'B' })
  assert.equal(asked.status, 200, JSON.stringify(asked.body))
  const id = idOf(asked)
  assert.match(String(id), /^Q\d+$/)
  assert.deepEqual((await state()).withPartner.map(one => one.id), [id], 'the ask stands with the partner')

  // The partner answers in its chat (the work tool): the chat that asked is woken with the answer, and the note gets the line.
  const answered = await asChat('Advisor', { action: 'partner-answer', id, text: 'B yew', why: 'your advice' })
  assert.equal(answered.status, 200, JSON.stringify(answered.body))
  await until(async () => (await toChat('Digger', /B yew/)).length > 0, 'the partner\'s answer in the outbox to Digger')
  const after = await state()
  assert.equal(after.focus.id, 'G6')
  assert.deepEqual(after.focus.note.decided.map(one => [one.ask ?? null, one.takenBack ?? false]), [[id, false]])

  // The person takes it back on the page: the chat that asked is told, nothing is typed to the partner for it.
  const before = (await outbox()).length
  const undone = await asPerson('/api/work', { action: 'undo', id })
  assert.equal(undone.status, 200, undone.body)
  const lines = await until(async () => {
    const told = (await outbox()).slice(before)
    return told.some(message => message.to === 'Digger') ? told : null
  }, 'the word about the taken-back answer to Digger')
  assert.deepEqual(lines.filter(message => message.to === 'Advisor'), [], 'nothing is typed to the partner')
  assert.equal((await state()).focus.note.decided.find(one => one.ask === id).takenBack, true)

  // The person answers a question of their own on the page: the chat that asked is woken as for the partner's answer.
  const second = await asChat('Digger', { action: 'ask', of: 'B12', kind: 'decide', blocking: true, text: 'Water the hedge?' })
  assert.equal(second.status, 200, JSON.stringify(second.body))
  const yes = await asPerson('/api/work', { action: 'answer', id: idOf(second), text: 'Yes, every day', verdict: null })
  assert.equal(yes.status, 200, yes.body)
  await until(async () => (await toChat('Digger', /Yes, every day/)).length > 0, 'the person\'s answer in the outbox to Digger')
})
