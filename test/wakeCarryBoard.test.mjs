// F17 end to end on a running board (a copy on a made-up project in a temporary folder): the hands get no message job while the app
// refuses their sends (the live refusal's text), and the scheduled courier's two routes carry a wake once.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { foldOutbox } from '../src/store.mjs'

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
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, CLAUDE_CONFIG_DIR: join(dirname(board), 'claude-config'), WORKER_BOARD_TICK_MS: '1000', ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
  started.push(child)
  return new Promise((done, fail) => {
    let out = ''
    const late = setTimeout(() => fail(new Error(`The board did not start: ${out}`)), 90_000)
    const read = chunk => {
      out += chunk
      if (!/Worker board: http:\/\/127\.0\.0\.1:\d+\//.test(out)) return
      clearTimeout(late)
      done({ child, out: () => out })
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
  for (const end = Date.now() + 60_000; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within 60 s: ${what}`)
}

const REFUSAL = '{"deny":"PreToolUse:mcp__ccd_session_mgmt__send_message hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call."}'
const SPELL = NOW - 40 * MIN

/**
 * A board over a made-up project: Main and Worker 1 report idle (they run), Worker 2 never reported (asleep). `refused`: the wake record
 * holds the live refusal of a hand's send (08:16's, at today's time). `lines` the outbox; `attempts` more attempts of Worker 2's spell.
 */
async function boardWith(t, { refused, lines = [], attempts = [], refusedAt = NOW - 30 * MIN, byModel = false, pause = null, files = {} }) {
  const dir = await mkdtemp(join(tmpdir(), 'board-carry-'))
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
  await put(join(board, 'data', 'outbox.jsonl'), lines.length === 0 ? '' : `${lines.map(line => JSON.stringify(line)).join('\n')}\n`)
  const old = { path: 'message', at: refusedAt, by: 'Worker 1', jobId: `wake:${refusedAt - MIN}:Old`, sentAt: null, runBefore: null, verdict: 'failed', verdictAt: refusedAt, why: REFUSAL, step: null }
  const wakes = { wakes: { ...(refused ? { Old: [{ spell: refusedAt - MIN, attempts: [old], turnEndedAt: null, told: { failed: false, nobody: false } }] } : {}), ...(attempts.length > 0 ? { 'Worker 2': [{ spell: SPELL, attempts, turnEndedAt: null, told: { failed: false, nobody: false } }] } : {}) } }
  await put(join(board, 'data', 'wakes.json'), `${JSON.stringify(wakes)}\n`)
  if (pause !== null) await put(join(project, '.claude', 'work', 'pause.json'), JSON.stringify(pause))
  for (const [id, text] of Object.entries(files)) await put(join(project, '.claude', 'work', `${id}.md`), text)
  if (Object.keys(files).length > 0) await put(join(project, '.claude', 'work', 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Art', steps: Object.keys(files) }] }, null, 1)}\n`)
  const chats = join(project, '.claude', 'chats')
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main"}')
  const appChat = (name, sessionId, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId, cliSessionId, cwd: project, isArchived: false, createdAt: NOW - 600 * MIN, lastActivityAt: NOW - 2 * MIN })
  for (const [name, sessionId, cli, role] of [['Main', 'local_main', 'main-id', 'main'], ['Worker 1', 'local_w1', 'w1-id', 'worker'], ['Worker 2', 'local_w2', 'w2-id', 'worker']]) {
    await put(join(app, 'a', 'b', `${sessionId}.json`), appChat(name, sessionId, cli))
    // Worker 2 wrote nothing lately (its session ended at SPELL): never read as running before its report comes.
    if (name === 'Worker 2') continue
    await put(join(transcripts, `${cli}.jsonl`), `${[typed(NOW - 8 * MIN, 'Status?'), answer(NOW - 7 * MIN, 'All fine.')].join('\n')}\n`)
    await put(join(chats, `${cli}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW - MIN }))
  }
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'carry', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  // Landing 1 ships A off; a board copy that tests A (landing 2) turns it on.
  const { out } = await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_CARRY_BY_MODEL: byModel ? '1' : '0' })
  const base = `http://127.0.0.1:${port}`
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const call = (path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.27.1', ...headers }, body: JSON.stringify(body) })
  const json = async (path, body) => {
    const reply = await call(path, body)
    const text = await reply.text()
    assert.equal(reply.status, 200, text)
    const parsed = JSON.parse(text)
    return parsed.result ?? parsed
  }
  for (const [chat, session] of [['Main', 'main-id'], ['Worker 1', 'w1-id']]) await json('/api/bridge/report', { chat, session, report: { state: 'idle', since: NOW - 2 * MIN, seq: 1, run: 1 } })
  // Worker 2's session ended at SPELL: it does not run (its spell).
  await json('/api/bridge/report', { chat: 'Worker 2', session: 'w2-id', report: { state: 'ended', since: SPELL, seq: 1, run: 1 } })
  const claim = async () => (await json('/api/bridge/hands', { chat: 'Worker 1', session: 'w1-id', mod: '0.27.1', can: ['send'] })).jobs ?? []
  const words = async () => foldOutbox(await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8'))
  const record = async () => JSON.parse(await readFile(join(board, 'data', 'wakes.json'), 'utf8'))
  return { out, call, json, claim, words, record }
}

/** The page's word to wake Worker 2 (a B577 wake word): a hand's job, but only while the app runs the hands' sends. */
const WAKE_WORD = { id: 'wakeword0000001', at: NOW - MIN, to: 'Main', ask: null, step: null, title: null, version: null, verdict: null, command: 'wake', about: 'Worker 2', text: 'The worker board holds words for you: run work next', state: 'waiting' }

test('while the app refuses the hands\' sends, no hand gets a message job; without the refusal it does', { timeout: 240_000 }, async t => {
  const refused = await boardWith(t, { refused: true, lines: [WAKE_WORD] })
  for (let at = 0; at < 3; at += 1) {
    assert.deepEqual((await refused.claim()).filter(job => job.id === WAKE_WORD.id), [], `claim ${at}`)
    await new Promise(done => setTimeout(done, 300))
  }
  const free = await boardWith(t, { refused: false, lines: [WAKE_WORD] })
  let jobs = []
  await until(async () => {
    jobs = (await free.claim()).filter(job => job.id === WAKE_WORD.id)
    return jobs.length > 0
  }, 'the hand gets the wake word')
  assert.equal(jobs[0].chat, 'Worker 2')
  // Without the refusal the board writes no word for a model: the hands carry the wakes.
  await new Promise(done => setTimeout(done, 3000))
  assert.deepEqual((await free.words()).filter(one => one.command === 'wake-carry'), [])
})


test('review 8: while refused, the page\'s wake word for Worker 2 goes as one word for the courier (once it calls); once that word closes, so does the carry word', { timeout: 240_000 }, async t => {
  const { json, words } = await boardWith(t, { refused: true, lines: [WAKE_WORD] })
  // The courier calls (nothing due yet): from now the board counts on it.
  assert.deepEqual((await json('/api/bridge/wakes-due', {})).wakes, [])
  let carried = []
  await until(async () => {
    carried = (await words()).filter(one => one.command === 'wake-carry')
    return carried.length > 0
  }, 'a carry word for the wake word')
  assert.deepEqual([carried.length, carried[0].of, carried[0].about, carried[0].wakeText], [1, WAKE_WORD.id, 'Worker 2', 'The worker board holds words for you; they come in now.'])
  assert.equal(carried[0].to, 'the courier')
  // In this garden Worker 2 is no stopped chat: the outbox sweep closes the page's wake word, and the carry word follows it.
  await until(async () => (await words()).find(one => one.id === WAKE_WORD.id).state === 'dropped', 'the wake word closed')
  await until(async () => (await words()).find(one => one.id === carried[0].id).state === 'dropped', 'the carry word closed with it')
  assert.equal((await words()).find(one => one.id === carried[0].id).why, 'the word it carried is closed')
})

test('the courier: wakes-due hands each word once with a fresh window; never a carrier\'s word, never a target that woke; wakes-sent closes it once', { timeout: 240_000 }, async t => {
  const word = { id: 'c0c0c0c0c0c0c001', at: NOW - MIN, to: 'the courier', command: 'wake-carry', about: 'Worker 2', forModel: true, spell: SPELL, session: 'local_w2', wakeText: 'The worker board holds words for you: run work next', text: 'Wake Worker 2 for the worker board', state: 'waiting' }
  const taken = { ...word, id: 'c0c0c0c0c0c0c002', to: 'Worker 1' }
  const attempt = id => ({ path: 'message', at: NOW - MIN, by: id === word.id ? 'the courier' : 'Worker 1', jobId: id, sentAt: null, runBefore: 1, verdict: null, verdictAt: null, why: null, step: null, carry: id === word.id ? 'courier' : 'model' })
  const { call, json, words, record } = await boardWith(t, { refused: true, lines: [word, taken, { id: taken.id, state: 'taken', takenAt: NOW - 30_000 }], attempts: [attempt(word.id)] })
  // Only the board's key.
  assert.equal((await call('/api/bridge/wakes-due', {}, { 'X-Board-Key': 'no' })).status, 403)
  const due = { id: word.id, chat: 'Worker 2', session: 'local_w2', text: 'The worker board holds words for you: run work next' }
  const before = Date.now()
  assert.deepEqual((await json('/api/bridge/wakes-due', {})).wakes, [due], JSON.stringify((await words()).find(one => one.id === word.id)))
  assert.equal((await words()).find(one => one.id === word.id).takenBy, 'the courier')
  // Review 17: a second run before it said sent gets nothing (never sent twice).
  assert.deepEqual((await json('/api/bridge/wakes-due', {})).wakes, [])
  // Review 3, 11: its window from the take.
  await until(async () => ((await record()).wakes['Worker 2'].at(-1).attempts.find(one => one.jobId === word.id)?.heldAt ?? 0) >= before, 'the courier\'s window')
  assert.deepEqual((await json('/api/bridge/wakes-sent', { ids: [word.id, taken.id, 'nothing'] })), { closed: 1 })
  assert.deepEqual((await json('/api/bridge/wakes-sent', { ids: [word.id] })), { closed: 0 }, 'said twice: once')
  assert.equal((await words()).find(one => one.id === word.id).state, 'delivered')
  await until(async () => typeof (await record()).wakes['Worker 2'].at(-1).attempts.find(one => one.jobId === word.id)?.sentAt === 'number', 'the attempt sent')
})

test('review 12: a target that woke before the courier asked: its word is not listed', { timeout: 240_000 }, async t => {
  const word = { id: 'c0c0c0c0c0c0c003', at: NOW - MIN, to: 'the courier', command: 'wake-carry', about: 'Worker 2', forModel: true, spell: SPELL, session: 'local_w2', wakeText: 'x', text: 'Wake Worker 2', state: 'waiting' }
  const attempt = { path: 'message', at: NOW - MIN, by: 'the courier', jobId: word.id, sentAt: null, runBefore: 1, verdict: null, verdictAt: null, why: null, step: null, carry: 'courier' }
  const { json, words } = await boardWith(t, { refused: true, lines: [word], attempts: [attempt] })
  // Worker 2 is back by itself (the person opened it): a report with a new run.
  await json('/api/bridge/report', { chat: 'Worker 2', session: 'w2-id', report: { state: 'idle', since: Date.now(), seq: 2, run: 2 } })
  assert.deepEqual((await json('/api/bridge/wakes-due', {})).wakes, [])
  assert.notEqual((await words()).find(one => one.id === word.id).state, 'taken')
})

test('A (landing 2, on in this copy), review 1, 2: a carrier whose report is busy takes no carry word; the attempt is not sent at a take, only once its turn on the word began', { timeout: 240_000 }, async t => {
  const word = { id: 'c0c0c0c0c0c0c004', at: NOW - MIN, to: 'Main', command: 'wake-carry', about: 'Worker 2', forModel: true, spell: SPELL, session: 'local_w2', wakeText: 'x', text: 'Wake Worker 2 for the worker board: send_message with session_id "local_w2"', state: 'waiting' }
  const attempt = { path: 'message', at: NOW - MIN, by: 'Main', jobId: word.id, sentAt: null, runBefore: 1, verdict: null, verdictAt: null, why: null, step: null, carry: 'model' }
  const { json, claim, words, record } = await boardWith(t, { refused: true, lines: [word], attempts: [attempt], byModel: true })
  assert.deepEqual((await claim()).filter(job => job.id === word.id), [], 'no hand takes it')
  // Main busy on its own turn: its take does not get the word.
  await json('/api/bridge/report', { chat: 'Main', session: 'main-id', report: { state: 'busy', since: Date.now(), seq: 2, run: 1, word: null, turn: Date.now() - 1000 } })
  const busy = await json('/api/bridge/take', { chat: 'Main', session: 'main-id' })
  assert.deepEqual((busy.messages ?? []).filter(one => one.id === word.id), [])
  assert.equal((await words()).find(one => one.id === word.id).state, 'waiting')
  // Main idle: its take types it; not sent yet.
  await json('/api/bridge/report', { chat: 'Main', session: 'main-id', report: { state: 'idle', since: Date.now(), seq: 3, run: 1 } })
  const idle = await json('/api/bridge/take', { chat: 'Main', session: 'main-id' })
  assert.deepEqual((idle.messages ?? []).filter(one => one.id === word.id).map(one => one.text), [word.text])
  await new Promise(done => setTimeout(done, 1500))
  assert.equal((await record()).wakes['Worker 2'].at(-1).attempts.find(one => one.jobId === word.id).sentAt, null, 'not at the take')
  // Its turn on the word: sent.
  await json('/api/bridge/report', { chat: 'Main', session: 'main-id', report: { state: 'busy', since: Date.now(), seq: 4, run: 1, word: word.id, turn: Date.now() } })
  await until(async () => typeof (await record()).wakes['Worker 2'].at(-1).attempts.find(one => one.jobId === word.id)?.sentAt === 'number', 'sent at the carrier\'s turn')
})

test('A (landing 2, on in this copy), the real case on the board: Worker 2 asleep with an answer waiting, the hands\' sends refused: ONE carry word to a free chat, none twice', { timeout: 240_000 }, async t => {
  const answerWord = { id: 'answer000000001', at: NOW - MIN, to: 'Worker 2', ask: 'chat:Worker 2', step: null, title: null, version: null, verdict: null, text: 'Yes, go on.', state: 'waiting' }
  const { claim, words } = await boardWith(t, { refused: true, lines: [answerWord], byModel: true })
  let carried = []
  await until(async () => {
    carried = (await words()).filter(one => one.command === 'wake-carry')
    return carried.length > 0
  }, 'a carry word')
  assert.equal(carried.length, 1)
  assert.ok(['Main', 'Worker 1'].includes(carried[0].to), carried[0].to)
  assert.deepEqual([carried[0].about, carried[0].session, carried[0].forModel], ['Worker 2', 'local_w2', true])
  assert.deepEqual((await claim()).filter(job => job.chat === 'Worker 2'), [], 'no hand job beside it')
  await new Promise(done => setTimeout(done, 3000))
  assert.equal((await words()).filter(one => one.command === 'wake-carry').length, 1, 'never a second word for the spell')
})

test('the same case without the refusal: no carry word, the next hand gets the message job', { timeout: 240_000 }, async t => {
  const answerWord = { id: 'answer000000001', at: NOW - MIN, to: 'Worker 2', ask: 'chat:Worker 2', step: null, title: null, version: null, verdict: null, text: 'Yes, go on.', state: 'waiting' }
  const { claim, words } = await boardWith(t, { refused: false, lines: [answerWord] })
  await new Promise(done => setTimeout(done, 4000))
  assert.deepEqual((await words()).filter(one => one.command === 'wake-carry'), [])
  let jobs = []
  await until(async () => {
    jobs = (await claim()).filter(job => job.chat === 'Worker 2')
    return jobs.length > 0
  }, 'the hand\'s message job')
  assert.equal(jobs[0].to, 'local_w2')
})

test('review 16: a day after the refusal ONE probe goes to a hand, to a free chat other than itself, never a real wake; its send lifts the refusal', { timeout: 240_000 }, async t => {
  const answerWord = { id: 'answer000000002', at: NOW - MIN, to: 'Worker 2', ask: 'chat:Worker 2', step: null, title: null, version: null, verdict: null, text: 'Yes, go on.', state: 'waiting' }
  const { call, claim, record } = await boardWith(t, { refused: true, refusedAt: NOW - 25 * 60 * MIN, lines: [answerWord] })
  const jobs = await claim()
  const probes = jobs.filter(job => /^send-probe:/.test(job.id))
  assert.equal(probes.length, 1)
  assert.deepEqual([probes[0].chat, probes[0].to], ['Main', 'local_main'])
  assert.deepEqual(jobs.filter(job => job.chat === 'Worker 2'), [], 'the real wake is carried, never the probe')
  assert.deepEqual((await claim()).filter(job => /^send-probe:/.test(job.id)), [], 'once a day')
  const done = await call('/api/bridge/hands-done', { chat: 'Worker 1', session: 'w1-id', results: [{ id: probes[0].id, ok: true }] })
  assert.equal(done.status, 200, await done.text())
  // Lifted: the record says so (saved), and the hands may send again.
  await until(async () => typeof (await record()).sendsLiftedAt === 'number', 'the refusal lifted')
})

test('landing 1, the real case: Worker 2 asleep with an answer waiting, the hands\' sends refused, free chats but A off: no word until the courier calls; then ONE word for it, sent at its hand-off, credited when Worker 2 reports first', { timeout: 240_000 }, async t => {
  const answerWord = { id: 'answer000000003', at: NOW - MIN, to: 'Worker 2', ask: 'chat:Worker 2', step: null, title: null, version: null, verdict: null, text: 'Yes, go on.', state: 'waiting' }
  const { json, claim, words, record } = await boardWith(t, { refused: true, lines: [answerWord] })
  await new Promise(done => setTimeout(done, 4000))
  assert.deepEqual((await words()).filter(one => one.command === 'wake-carry'), [], 'no courier yet, no carrier: no word')
  assert.deepEqual((await claim()).filter(job => job.chat === 'Worker 2'), [], 'no hand job')
  assert.deepEqual((await json('/api/bridge/wakes-due', {})).wakes, [])
  let carried = []
  await until(async () => {
    carried = (await words()).filter(one => one.command === 'wake-carry')
    return carried.length > 0
  }, 'the courier\'s word')
  assert.deepEqual([carried.length, carried[0].to], [1, 'the courier'])
  assert.deepEqual((await json('/api/bridge/wakes-due', {})).wakes.map(one => one.id), [carried[0].id])
  await until(async () => typeof (await record()).wakes['Worker 2']?.at(-1).attempts.find(one => one.jobId === carried[0].id)?.sentAt === 'number', 'sent at the hand-off')
  // Worker 2 is woken by the courier's message and reports before the courier's wakes-sent: credited, never "woke by itself".
  await json('/api/bridge/report', { chat: 'Worker 2', session: 'w2-id', report: { state: 'busy', since: Date.now(), seq: 2, run: 2 } })
  await until(async () => (await record()).wakes['Worker 2'].at(-1).attempts.find(one => one.jobId === carried[0].id)?.verdict === 'woke', 'woke')
  const attempt = (await record()).wakes['Worker 2'].at(-1).attempts.find(one => one.jobId === carried[0].id)
  assert.deepEqual([attempt.carry, attempt.self], ['courier', undefined])
})

test('verifier 7, 11: a refusal known only from the record\'s old attempts becomes the record\'s own fact', { timeout: 240_000 }, async t => {
  const { record } = await boardWith(t, { refused: true })
  await until(async () => typeof (await record()).sendsRefusedSince === 'number', 'the fact saved')
  assert.equal((await record()).sendsRefusedSince, NOW - 30 * MIN)
})

test('F17 check 1: a start word\'s courier word handed out and never said sent holds no wake of Worker 2 off: its answer still gets the courier\'s word', { timeout: 240_000 }, async t => {
  const start = { ...WAKE_WORD, id: 'startword000001', command: 'start' }
  // The start word's carry, handed to the courier a minute ago and never said sent.
  const held = { id: 'c0c0c0c0c0c0c0f1', at: NOW - 2 * MIN, to: 'the courier', command: 'wake-carry', about: 'Worker 2', forModel: true, spell: null, session: 'local_w2', wakeText: 'x', text: 'Wake Worker 2', state: 'waiting', of: start.id }
  const answerWord = { id: 'answer000000004', at: NOW - MIN, to: 'Worker 2', ask: 'chat:Worker 2', step: null, title: null, version: null, verdict: null, text: 'Yes, go on.', state: 'waiting' }
  const { json, words } = await boardWith(t, { refused: true, lines: [start, held, { id: held.id, state: 'taken', takenBy: 'the courier', takenAt: Date.now() - MIN }, answerWord] })
  // The courier calls: from now the board counts on it.
  await json('/api/bridge/wakes-due', {})
  let carried = []
  await until(async () => {
    carried = (await words()).filter(one => one.command === 'wake-carry' && one.about === 'Worker 2' && typeof one.of !== 'string')
    return carried.length > 0
  }, 'the wake need\'s own courier word beside the start word\'s')
  assert.equal(carried.length, 1)
})

const two = n => String(n).padStart(2, '0')
const stampOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}` }
/** Worker 2 holds B12 (in progress): an asleep holder Resume all must wake. */
const HELD = { B12: `Id: B12\nKind: step\nTitle: Plant the hedge\nState: in progress\nOwner: Worker 2\nSince: ${stampOf(NOW - 60 * MIN)}\n\n## History\n- ${stampOf(NOW - 60 * MIN)} Worker 2: taken\n` }

test('chat 1\'s re-check 1: Resume all just began and Main runs: no courier word for the asleep holder (Main\'s list sends its line)', { timeout: 240_000 }, async t => {
  const pause = { state: 'resuming', since: Date.now() - 20_000, pausedSince: NOW - 60 * MIN, by: 'person' }
  const { json, words } = await boardWith(t, { refused: true, pause, files: HELD })
  // The board's state has read Main's report (it runs) before the courier calls.
  await new Promise(done => setTimeout(done, 3000))
  await json('/api/bridge/wakes-due', {})
  // The wake pass runs at the board's start, ten seconds on, then once a minute: past the next one.
  await new Promise(done => setTimeout(done, 15_000))
  assert.deepEqual((await words()).filter(one => one.command === 'wake-carry' && one.about === 'Worker 2'), [])
})

test('chat 1\'s re-check 1: past the grace the holder that still has not started gets the courier\'s word', { timeout: 240_000 }, async t => {
  const pause = { state: 'resuming', since: Date.now() - 4 * MIN, pausedSince: NOW - 60 * MIN, by: 'person' }
  const { json, words } = await boardWith(t, { refused: true, pause, files: HELD })
  // The board's state has read Main's report (it runs) before the courier calls.
  await new Promise(done => setTimeout(done, 3000))
  await json('/api/bridge/wakes-due', {})
  // Within 20 s (Main's report in this test goes stale after a minute; then Main no longer covers the list either way).
  let found = false
  for (const end = Date.now() + 20_000; Date.now() < end && !found;) {
    found = (await words()).some(one => one.command === 'wake-carry' && one.about === 'Worker 2' && typeof one.of !== 'string')
    if (!found) await new Promise(done => setTimeout(done, 250))
  }
  assert.ok(found, 'the courier\'s word for the holder, past the grace')
  assert.deepEqual((await words()).filter(one => one.command === 'wake-carry' && one.about === 'Worker 2').map(one => one.for), ['resume'])
})

test('chat 1\'s re-check 2: a carried start word that keeps waiting gets ONE word for the courier, never a second across the passes', { timeout: 240_000 }, async t => {
  const start = { ...WAKE_WORD, id: 'startword000002', command: 'start' }
  const { json, words } = await boardWith(t, { refused: true, lines: [start] })
  await json('/api/bridge/wakes-due', {})
  await until(async () => (await words()).some(one => one.of === start.id), 'the start word\'s carry word')
  // Past the next wake pass (once a minute).
  await new Promise(done => setTimeout(done, 65_000))
  assert.equal((await words()).find(one => one.id === start.id).state, 'waiting')
  assert.equal((await words()).filter(one => one.command === 'wake-carry' && typeof one.of === 'string' && one.about === 'Worker 2').length, 1)
})
