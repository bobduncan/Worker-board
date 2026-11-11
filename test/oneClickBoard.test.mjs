// Reactive board, brief P4a, on a running board (a copy on a made-up project in a temporary folder): ONE CLICK IS ONE SERVER ACTION.
// The real case: a talk answer was written with one call and its word typed with a second; when the second failed, half an action
// stayed and the person was told to answer again elsewhere. Now one call stores the answer and queues exactly one word, a second
// call with the same click id queues none, and a queue that cannot take the word (no partner chat on the board: made to fail on
// purpose through the server's own route) leaves the answer standing with `not sent: <why>, HH:MM`, which the Retry (the same
// click id) turns into exactly one word once a partner is there. Made-up names only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseThread } from '../src/brainstorm.mjs'
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

const TALK = '.claude/brainstorms/2026-11-09-how-we-lay-paths.md'
const TALK_TEXT = '# Brainstorm: How we lay paths\nGoal: G6 Paths through the garden\nStarted: 2026-11-09 09:00 · State: running\nOpening: What makes a good path?\n\n## Q1 (09:01)\nWhat is a path for?\nContext: The goal has one part so far.\n- A: getting somewhere (advised)\n- B: a stroll\n'
const GOALS = ['# Goals', 'Last id: G6', 'Focus: G6', '', '- [~] G6 Paths through the garden', '  Done when: a visitor walks every path without getting lost', `  Brainstorm: ${TALK} (running)`, '  Steps: B12', ''].join('\n')

test('one call stores the answer and queues one word; the same click id queues none; a queue that fails keeps the answer with "not sent", and the Retry queues exactly one word', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-click-'))
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
  const addChat = async (id, name, role) => {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW }))
    await put(join(app, 'a', 'b', `local_${name.toLowerCase()}.json`), JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: id, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW }))
    await put(join(transcripts, `${id}.jsonl`), `${typed(NOW - 9 * MIN, 'Status?')}\n${answer(NOW - 8 * MIN, 'All fine.')}\n`)
  }
  await put(join(chats, 'list.json'), '{"prefix":"Garden · ","main":"Main","afterStep":"clear"}')
  // Only the main chat to begin with: no partner on the board, so the queue cannot take a talk word.
  await addChat('main-id', 'Main', 'main')
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW }), undefined, { now: NOW })
  await put(join(project, '.claude', 'goals.md'), GOALS)
  await put(join(project, TALK), TALK_TEXT)
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'click', project, port, gamePort: 7342, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const base = `http://127.0.0.1:${port}`
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  assert.ok(token, 'the served page carries the token')
  const post = (route, body) => fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body) })
  const lines = async file => (await readFile(join(board, 'data', file), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text))
  const words = async () => (await lines('outbox.jsonl')).filter(one => one.command === 'brainstorm-answer')
  const state = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token, Origin: base } }).then(reply => reply.json())

  // 1. No partner on the board: the answer is written under the question, nothing is queued, and the click says why.
  const click = 'click-real-0001'
  const first = await post('/api/brainstorm', { command: 'answer', path: TALK, n: 1, key: 'A', words: '', via: 'talk-send', click })
  assert.equal(first.status, 200, await first.clone().text())
  const result = await first.json()
  assert.equal(result.click, click)
  assert.equal(result.notSent, 'no chat on the board takes it')
  assert.match(result.notSentAt, /^\d\d:\d\d$/)
  assert.equal(result.said, undefined)
  const thread = parseThread(await readFile(join(project, TALK), 'utf8'))
  assert.equal(thread.questions[0].answer.key, 'A', 'the answer stands in the thread')
  assert.deepEqual(await words(), [], 'no word was queued')
  assert.deepEqual((await state()).clicksUnsent, [{ click, via: 'talk-send', key: TALK, route: '/api/brainstorm', why: 'no chat on the board takes it', at: result.notSentAt }], 'the card draws its Retry from this')
  // One line of the click in the actions log, with its own via and the click id: not pause-all or resume-all.
  assert.deepEqual((await lines('actions.jsonl')).map(one => [one.via, one.click]), [['talk-send', click]])

  // 2. A partner joins the board; the Retry reuses the click id: the answer is not written again, exactly one word is queued.
  await addChat('advisor-id', 'Advisor', 'worker')
  for (let tries = 0; tries < 40 && (await state()).advisor == null; tries += 1) await new Promise(done => setTimeout(done, 500))
  assert.ok((await state()).advisor, 'the partner is on the board now')
  const before = await readFile(join(project, TALK), 'utf8')
  const retried = await post('/api/brainstorm', { command: 'click-retry', click })
  assert.equal(retried.status, 200, await retried.clone().text())
  const sent = await retried.json()
  assert.equal(typeof sent.said, 'string')
  assert.equal(sent.notSent, undefined)
  assert.equal(await readFile(join(project, TALK), 'utf8'), before, 'the thread was not written again')
  const queued = await words()
  assert.equal(queued.length, 1)
  assert.equal(queued[0].id, sent.said)
  assert.equal(queued[0].to, 'Advisor')
  assert.match(queued[0].text, new RegExp(`^brainstorm answer\\nThread: ${TALK}\\nQ1: A$`))
  assert.deepEqual((await state()).clicksUnsent, [])

  // 3. The same click id again, by either way: the first result, and no second word.
  const again = await (await post('/api/brainstorm', { command: 'answer', path: TALK, n: 1, key: 'A', words: '', via: 'talk-send', click })).json()
  assert.equal(again.said, sent.said)
  assert.equal(again.again, true)
  const retriedAgain = await (await post('/api/brainstorm', { command: 'click-retry', click })).json()
  assert.equal(retriedAgain.said, sent.said)
  assert.equal((await words()).length, 1)
  assert.equal((await lines('actions.jsonl')).length, 1, 'one log line for the click, retries included')

  // 4. A new click: the same route, in one call, with the partner there: exactly one word at once.
  const wrap = await post('/api/brainstorm', { command: 'wrap', path: TALK, click: 'click-real-0002' })
  assert.equal(wrap.status, 200, await wrap.clone().text())
  const wrapped = await wrap.json()
  assert.equal(typeof wrapped.said, 'string')
  assert.deepEqual((await lines('outbox.jsonl')).filter(one => one.command === 'brainstorm-wrap').map(one => one.id), [wrapped.said])
  assert.deepEqual((await lines('actions.jsonl')).map(one => one.via), ['talk-send', 'brainstorm-wrap'])

  // 5. Goals "Ask the Advisor": the Ask line under the goal and its word in ONE call; the same click id writes no second ask and queues no second word.
  const asked = await (await post('/api/goals', { command: 'ask', id: 'G6', text: 'why are the paths grey?', pictures: [], click: 'click-real-0003' })).json()
  assert.equal(asked.id, 'A1')
  assert.equal(typeof asked.said, 'string')
  const askAgain = await (await post('/api/goals', { command: 'ask', id: 'G6', text: 'why are the paths grey?', pictures: [], click: 'click-real-0003' })).json()
  assert.equal(askAgain.said, asked.said)
  assert.equal((await readFile(join(project, '.claude', 'goals.md'), 'utf8')).match(/^\s+Ask \(A\d+/gm).length, 1, 'one Ask line under the goal')
  assert.deepEqual((await lines('outbox.jsonl')).filter(one => one.command === 'goal-ask').map(one => [one.id, one.to, one.about]), [[asked.said, 'Advisor', 'A1']])

  // 6. Refine: the first "Refine" of a step (nothing to write) is the word alone in ONE call; the same click id queues no second word. Answers for a
  // step that was not refined are refused by the store, and then no word is queued.
  const refine = { action: 'refine-send', step: 'B12', answers: [], feedback: '', click: 'click-real-0004' }
  const refined = await post('/api/backlog', refine)
  assert.equal(refined.status, 200, await refined.clone().text())
  const sentRefine = await refined.json()
  assert.equal(typeof sentRefine.said, 'string')
  assert.equal((await (await post('/api/backlog', refine)).json()).said, sentRefine.said)
  assert.deepEqual((await lines('outbox.jsonl')).filter(one => one.command === 'refine').map(one => [one.id, one.to]), [[sentRefine.said, 'Advisor']])
  const refused = await post('/api/backlog', { action: 'refine-send', step: 'B12', answers: [], feedback: 'keep it small', click: 'click-real-0005' })
  assert.equal(refused.status, 409)
  assert.equal((await lines('outbox.jsonl')).filter(one => one.command === 'refine').length, 1, 'a refused write queues no word')
  assert.deepEqual((await lines('actions.jsonl')).map(one => one.via), ['talk-send', 'brainstorm-wrap', 'goal-ask', 'refine-send'])

  // 7. The /api/say click branch (a plain Send): the same id twice queues one word and writes one actions line; the same id with other words is refused.
  const say = { to: 'Advisor', text: 'hello partner', via: 'talk-send', click: 'click-real-0006' }
  const said = await (await post('/api/say', say)).json()
  const saidAgain = await (await post('/api/say', say)).json()
  assert.equal(saidAgain.id, said.id)
  assert.equal((await lines('outbox.jsonl')).filter(one => String(one.text ?? '').includes('hello partner')).length, 1, 'one word for one click id')
  assert.equal((await lines('actions.jsonl')).filter(one => one.click === 'click-real-0006').length, 1)
  // P4c: the word keeps the kind of free message it is (`free`), so its line is drawn where its button was; a nudge also keeps what it is about.
  assert.equal((await lines('outbox.jsonl')).find(one => String(one.text ?? '').includes('hello partner')).free, 'talk-send')
  const nudge = await (await post('/api/say', { to: 'Advisor', text: 'are you stuck?', via: 'nudge', freeAbout: 'Q7', click: 'click-real-0007' })).json()
  const nudged = (await lines('outbox.jsonl')).find(one => one.id === nudge.id)
  assert.deepEqual([nudged.free, nudged.freeAbout], ['nudge', 'Q7'])
  // A word with no click via has no kind: no line is invented for it.
  const plain = await (await post('/api/say', { to: 'Advisor', text: 'a plain word without a click' })).json()
  assert.equal((await lines('outbox.jsonl')).find(one => one.id === plain.id).free, undefined)
  const other = await post('/api/say', { ...say, text: 'something else' })
  assert.equal(other.status, 409)
  assert.match(await other.text(), /different input under this click/)
  assert.equal((await lines('outbox.jsonl')).filter(one => String(one.text ?? '').includes('something else')).length, 0)
  // The same id with another input on a route is refused too, and the new input under a new id is stored and queued.
  const clash = await post('/api/brainstorm', { command: 'wrap', path: TALK, click: 'click-real-0002', via: 'other' })
  assert.equal(clash.status, 409)

  // A click id that is no id is refused, and nothing is written for it.
  const bad = await post('/api/brainstorm', { command: 'wrap', path: TALK, click: 'x' })
  assert.equal(bad.status, 400)
})
