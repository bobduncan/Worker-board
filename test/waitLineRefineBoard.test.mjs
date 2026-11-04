// The wait line, wave 2, end to end on a running board (T22, 2026-11-04, plan-wave2.md; the person, 2026-11-02: "I want to know whats
// going on."): a refine. The person's Send answers (a refine word to the Advisor) shows as "Sent ... waits for Advisor to pick it up" in
// the state's waits; once the step's refine is written (its block, after the word) the line reads Done "refined", also after the outbox
// sweep dropped the word as no longer needed, and the board keeps it on the word. A copy of the board on a made-up project in a
// temporary folder only.

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

test('a refine end to end: Send answers is Sent in the state, the refine written makes it Done "refined", kept on the word after the sweep dropped it', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-wait-refine-'))
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
  await writeStore(work, migrateBacklog('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'wait', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), refreshSeconds: 5 }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })

  const base = `http://127.0.0.1:${port}`
  const page = await fetch(`${base}/`).then(reply => reply.text())
  const token = /[0-9a-f]{64}/.exec(page)?.[0]
  assert.ok(token, 'the served page carries the token')
  const asPerson = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: await reply.text() }))
  const stateNow = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const outbox = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text))

  // The person's Send answers: one refine word to the Advisor, and its line in the state at once.
  const sent = await asPerson('/api/say', { to: 'Advisor', command: 'refine', step: 'B12' })
  assert.equal(sent.status, 200, sent.body)
  const word = JSON.parse(sent.body)
  assert.deepEqual([word.command, word.about, word.to], ['refine', 'B12', 'Advisor'])
  const line = (await stateNow()).waits?.[word.id]
  assert.deepEqual([line?.state, line?.place, line?.command, line?.about, line?.chat], ['sent', 'refine', 'refine', 'B12', 'Advisor'])
  assert.match(line.lead, /^Sent \d\d:\d\d$/)
  assert.match(line.rest, /^(waits for Advisor to pick it up|Advisor is asleep|waking Advisor)/)

  // The partner writes the step's refine block (round 1) after the word: the line is Done "refined", the step is refined now
  // (the outbox sweep may close the word as no longer needed: the line stays), and the board keeps the result on the word.
  const at = stamp(Date.now() + MIN)
  await writeFile(join(work, 'B12.md'), ['Id: B12', 'Kind: step', 'Title: Plant the hedge', 'State: refined', 'Activity: Garden', `Since: ${at}`, '',
    '## Refined', `  Refined (round 1, by Advisor, ${at}):`, '  Summary: A hedge of yew along the road.', '  Size: about 1 hour', '',
    '## History', `- ${at} Advisor: new → refined`, ''].join('\n'))
  const done = await until(async () => { const found = (await stateNow()).waits?.[word.id]; return found?.state === 'done' ? found : null }, 'the Done line of the refine')
  assert.deepEqual([done.rest, done.place, done.lead.startsWith('Done ')], ['refined', 'refine', true])
  const kept = await until(async () => (await outbox()).find(one => one.id === word.id && Number.isFinite(one.doneAt)), 'the result kept on the word')
  assert.equal(kept.doneWords, 'refined')
  // Later reads still say Done (kept on the word), whatever became of the word.
  assert.equal((await stateNow()).waits?.[word.id]?.state, 'done')
})
