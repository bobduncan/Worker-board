// Stop and rethink (docs/stop-and-rethink.md, T13.2.1; chat 1's condition 1, ONE STOP PATH), end to end on a running board: the page's
// POST /api/goals {command: 'rethink'} on a topic with a step in progress. The stop goes out through the Stop button's own word (the
// `stop` command to the main chat, by code for a worker whose mod can), the held steps are not handed out again while the rethink's
// words stand in their `Waits for` (a free worker is handed the control task of another part, never theirs), and once the evaluation
// ends (the partner's marked how-draft) the board frees them, tells the partner in one line, and the next free worker is handed one
// of them as any ready task. A copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MIN = 60_000
const MOD = '0.31.0'
const pause = ms => new Promise(done => setTimeout(done, ms))

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
    await pause(250)
  }
  throw new Error(`Not within 90 s: ${what}`)
}

const GOALS = [
  'Last id: G60', 'Focus: G60', '', '- [~] G60 The stairs', '    Done when: you walk the stairs', '    Goal definition: stairs that read as stone',
  '    Goal definition agreed: 2026-10-18 10:00', '    Part: Side stairs · about 1 h · steps B1, B14', '    Part: Walls · about 1 h · steps B15', '    How agreed: 2026-10-18 11:00', '',
].join('\n')
const file = (head, history) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n## History\n${history.join('\n')}\n`)

test('a rethink on a topic with a step in progress: the stop goes the Stop button\'s way, nothing of the topic is handed out while it stands, and all of it is freed when the evaluation ends', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-rethink-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Team - ","main":"Lead","afterStep":"clear"}')
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  const people = [['lead-id', 'Lead', 'main'], ['advisor-id', 'Advisor', 'worker'], ['worker-5-id', 'Worker 5', 'worker'], ['worker-2-id', 'Worker 2', 'worker'], ['worker-3-id', 'Worker 3', 'worker']]
  for (const [id, name, role] of people) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW }))
    await put(join(app, 'a', 'b', `local_${name.replace(/\W+/g, '-').toLowerCase()}.json`), appChat(name, id))
    await put(join(transcripts, `${id}.jsonl`), `${[typed(NOW - 40 * MIN, 'Go on.'), answer(NOW - 30 * MIN, 'Done.')].join('\n')}\n`)
  }
  await put(join(project, '.claude', 'goals.md'), GOALS)
  const ready = (id, more = {}) => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'refined', Refined: 'ready', Activity: 'Art', Goal: 'G60', Since: stamp(NOW - 60 * MIN), ...more }, [`- ${stamp(NOW - 60 * MIN)} Advisor: made`])
  const building = file({ Id: 'B1', Kind: 'step', Title: 'The side stairs', State: 'in progress', Refined: 'ready', Owner: 'Worker 5', Activity: 'Art', Goal: 'G60', Since: stamp(NOW - 20 * MIN) },
    [`- ${stamp(NOW - 30 * MIN)} Worker 5: queued → taken`, `- ${stamp(NOW - 20 * MIN)} Worker 5: taken → in progress`])
  const items = new Map([['B1', building], ['B14', ready('B14')], ['B15', ready('B15')]])
  const work = join(project, '.claude', 'work')
  await writeStore(work, { items, activities: [{ name: 'Art', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: NOW - 60 * MIN })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'rethink', project, port, gamePort: 7330, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), refreshSeconds: 5, handOutBeyondFocus: true, handover: 'sequence' }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })

  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const base = `http://127.0.0.1:${port}`
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  assert.ok(token, 'the served page carries the token')
  const asPerson = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body) })
    .then(async reply => ({ status: reply.status, body: await reply.json().catch(() => null) }))
  const call = (path, body) => fetch(`${base}/api/bridge/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': MOD }, body: JSON.stringify(body) })
    .then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  const outbox = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text))
  const head = async (id, field) => (await readFile(join(work, `${id}.md`), 'utf8')).match(new RegExp(`^${field}: (.*)$`, 'm'))?.[1] ?? null
  let seq = 0
  const ping = (name, report) => call('take', { chat: name, session: `${name.toLowerCase().replace(/\W+/g, '-')}-id`, report: { run: 1, seq: (seq += 1), ...report } })

  // Worker 5 works on B1 (its mod can be stopped by code); Advisor and Lead run.
  assert.equal((await ping('Worker 5', { state: 'busy', since: Date.now() - 5 * MIN })).status, 200)
  assert.equal((await ping('Lead', { state: 'idle', since: Date.now() - 2 * MIN })).status, 200)
  assert.equal((await ping('Advisor', { state: 'idle', since: Date.now() - 2 * MIN })).status, 200)

  // The rethink of the Side stairs, from the page.
  const sent = await asPerson('/api/goals', { command: 'rethink', id: 'G60', part: 'Side stairs', text: 'all wrong, stop it and rethink', pictures: [] })
  assert.equal(sent.status, 200, JSON.stringify(sent.body))
  const result = sent.body
  assert.deepEqual([result.topic, result.held.toSorted(), result.stopped, result.evaluation], ['Side stairs', ['B1', 'B14'], [{ id: 'B1', owner: 'Worker 5' }], 'started'])
  const mark = /^the rethink of G60 "Side stairs" \(\d{4}-\d\d-\d\d \d\d:\d\d\)$/
  assert.match(await head('B1', 'Waits for'), mark)
  assert.match(await head('B14', 'Waits for'), mark)
  assert.equal(await head('B15', 'Waits for'), null, 'the other part goes on')
  assert.equal(await head('B1', 'Owner'), 'Worker 5', 'until its stop checkpoint is in the step stays with its worker')

  // ONE STOP PATH: the word is the Stop button's (command stop, to the main chat, about the worker, by code for a mod that can), and
  // the partner got the evaluate word with the person's block, and the talk partner (no Product owner here: the partner) the talk word.
  const words = await until(async () => {
    const all = await outbox()
    return all.some(one => one.command === 'stop') && all.some(one => one.command === 'evaluate') && all.some(one => one.command === 'talk') ? all : null
  }, 'the stop, evaluate and talk words')
  const stopWord = words.find(one => one.command === 'stop')
  assert.deepEqual([stopWord.to, stopWord.about, stopWord.byCode, stopWord.taskStep], ['Lead', 'Worker 5', true, 'B1'])
  assert.match(stopWord.text, /^stop task\nName: Worker 5\nTask: B1 /)
  const evaluate = words.find(one => one.command === 'evaluate')
  assert.equal(evaluate.to, 'Advisor')
  assert.match(evaluate.text, /^evaluate G60 The stairs\nAsked by the person \(\d{4}-\d\d-\d\d \d\d:\d\d\): "all wrong, stop it and rethink"\nTopic: Side stairs; held until your how-draft ends the evaluation: B1, B14/)
  const talk = words.find(one => one.command === 'talk')
  assert.deepEqual([talk.to, /^rethink started by the person: G60 "Side stairs"; held: B1, B14; stopped: B1 \(Worker 5\); their words: "all wrong, stop it and rethink"; pictures: none\. Confirm it in the talk in one line\.$/.test(talk.text)], ['Advisor', true])

  // The stop checkpoint is in: the step is given back (refined, still held), and the worker is free for other work.
  const saved = await call('work', { action: 'step', chat: 'Worker 5', session: 'worker-5-id', id: 'B1', commit: 'abc1234', next: 'stopped for the rethink' })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.equal(await head('B1', 'State'), 'refined')
  assert.equal(await head('B1', 'Owner'), null)
  assert.match(await head('B1', 'Waits for'), mark)
  // It takes another ready step (the Walls' B15), never one of the held topic; nor does any other free worker.
  assert.equal((await ping('Worker 5', { state: 'idle', since: Date.now() - MIN, background: false })).status, 200)
  const first = await call('work', { action: 'turn-ended', chat: 'Worker 5', session: 'worker-5-id', since: Date.now() - 5 * MIN })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(first.body.handover?.envelope?.step, 'B15', JSON.stringify(first.body.handover))
  assert.equal((await ping('Worker 2', { state: 'idle', since: Date.now() - MIN, background: false })).status, 200)
  const second = await call('work', { action: 'turn-ended', chat: 'Worker 2', session: 'worker-2-id', since: Date.now() - 5 * MIN })
  assert.equal(second.status, 200, JSON.stringify(second.body))
  assert.ok(!['B1', 'B14'].includes(second.body.handover?.envelope?.step ?? null), 'a held task is not handed out')
  await pause(7_000)
  assert.deepEqual([await head('B14', 'Owner'), await head('B14', 'State'), await head('B1', 'State')], [null, 'refined', 'refined'])

  // The evaluation runs on the goal; a second rethink of it sends the words as "more" and holds the same steps again.
  const goals = await readFile(join(project, '.claude', 'goals.md'), 'utf8')
  assert.match(goals, /Evaluation asked: \d{4}-\d\d-\d\d \d\d:\d\d/)
  assert.match(goals, /Evaluation part: Side stairs/)
  const more = await asPerson('/api/goals', { command: 'rethink', id: 'G60', part: 'Side stairs', text: 'and the rail is too thin' })
  assert.equal(more.status, 200, JSON.stringify(more.body))
  assert.equal(more.body.evaluation, 'running')
  await until(async () => (await outbox()).some(one => one.command === 'evaluate' && /More from the person: "and the rail is too thin"/.test(one.text)), 'the more-word to the partner')

  // The board's tick does not free them while the evaluation runs.
  await pause(7_000)
  assert.match(await head('B14', 'Waits for'), mark)

  // The end: the partner's marked how-draft. The next free worker is handed B14 as any ready task, and the partner is told in one line.
  const drafted = await call('work', { action: 'how-draft', chat: 'Advisor', session: 'advisor-id', goal: 'G60', parts: ['Side stairs from a reference · about 1 h · steps B14', 'Walls · about 1 h · steps B15'], partnerDecides: ['Evaluation: stairs from a reference'] })
  assert.equal(drafted.status, 200, JSON.stringify(drafted.body))
  // A tick before the end freed nothing (above); now the end is recorded.
  await until(async () => (await head('B14', 'Waits for')) === null, 'B14 freed when the evaluation ended')
  assert.equal(await head('B1', 'Waits for'), null)
  const line = await until(async () => (await outbox()).find(one => one.to === 'Advisor' && one.command === 'work' && /^held for the rethink, now free: B1, B14; drop or keep each$|now free/.test(one.text.split('\n').at(-1))), 'the partner\'s line')
  assert.match(line.text, /held for the rethink, now free: B\d+(, B\d+)*; drop or keep each/)
  assert.match((await readFile(join(work, 'B14.md'), 'utf8')), /no longer waits for: the rethink of G60 "Side stairs" .* \(the evaluation of G60 ended\)/)
  let given = null
  await until(async () => {
    const reply = await call('work', { action: 'turn-ended', chat: 'Worker 3', session: 'worker-3-id', since: Date.now() })
    given = reply.body.handover?.envelope?.step ?? null
    return ['B1', 'B14'].includes(given)
  }, 'a task of the topic handed out after the rethink ended')
  // Ticks after the end free nothing again and tell the partner once.
  await pause(12_000)
  assert.equal((await outbox()).filter(one => one.to === 'Advisor' && one.command === 'work' && /now free/.test(one.text)).length, 1)
})
