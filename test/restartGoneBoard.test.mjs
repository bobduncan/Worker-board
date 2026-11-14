// F19 end to end on a running board (a copy on a made-up project in a temporary folder), section 8's real case first: Worker 4's two
// deltas (2026-11-13 21:36:27Z, 22:36 on this PC's clock), an ended turn, background 0, quiet over 10 min, the courier alive: wakes-due
// lists one restart entry with its list; a second call lists nothing; wakes-sent records `sentAt`; a report after it clears Link gone and
// closes the word "its link is back". The board's own wakes-due and wakes-sent routes, as test/wakeCarryBoard.test.mjs drives them.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
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
// The lines as Worker 4's transcript holds them (F9's real case, test/modGone.test.mjs), cut to the fields that matter.
const retract = at => JSON.stringify({ parentUuid: 'a', isSidechain: false, attachment: { type: 'deferred_tools_delta', addedNames: [], removedNames: [], readdedNames: [], retractedTools: [{ name: 'mcp__workers__chat', cause: 'not_configured' }, { name: 'mcp__workers__work', cause: 'not_configured' }] }, type: 'attachment', uuid: 'e82b', timestamp: at })
const removed = at => JSON.stringify({ parentUuid: 'e82b', isSidechain: false, attachment: { type: 'mcp_instructions_delta', addedNames: [], addedBlocks: [], removedNames: ['workers'] }, type: 'attachment', uuid: '5a6e', timestamp: at })
const GONE = Date.parse('2026-11-13T21:36:27.000Z')
const hm = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

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

/** Waits for `check`; the wake pass runs 10 s after the board's start, then once a minute: up to 130 s. */
async function until(check, what, ms = 130_000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 300))
  }
  throw new Error(`Not within ${ms / 1000} s: ${what}`)
}

/**
 * A board over a made-up project: Main and Worker 1 report idle (they run, quiet for 20 min); `target`'s transcript holds Worker 4's two
 * deltas and an ended turn after them (written 20 min ago); it never reported since the unload.
 */
async function boardWith(t, { target = 'Worker 4', lines: given = [], archived = [], quietMs = null, children = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'board-restart-'))
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
  await put(join(board, 'data', 'outbox.jsonl'), given.length === 0 ? '' : `${given.map(line => JSON.stringify(line)).join('\n')}\n`)
  const chats = join(project, '.claude', 'chats')
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main"}')
  const appChat = (name, sessionId, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId, cliSessionId, cwd: project, isArchived: archived.includes(name), createdAt: NOW - 600 * MIN, lastActivityAt: NOW - 20 * MIN, ...(typeof children[name] === 'string' ? { spawnedFrom: { sessionId: children[name] } } : {}) })
  const lanes = [['Main', 'local_main', 'main-id', 'main'], ['Worker 1', 'local_w1', 'w1-id', 'worker'], ['Worker 4', 'local_w4', 'ddde6d5e-worker-4', 'worker']]
  for (const [name, sessionId, cli, role] of lanes) {
    await put(join(app, 'a', 'b', `${sessionId}.json`), appChat(name, sessionId, cli))
    const file = join(transcripts, `${cli}.jsonl`)
    const lines = name === target
      ? [typed(GONE - 30 * MIN, 'Build the strip.'), retract('2026-11-13T21:36:27.000Z'), removed('2026-11-13T21:36:27.400Z'), answer(GONE + 30_000, 'The strip is built.')]
      : [typed(NOW - 22 * MIN, 'Status?'), answer(NOW - 21 * MIN, 'All fine.')]
    await put(file, `${lines.join('\n')}\n`)
    // Quiet over 10 min: its last write 20 minutes ago (the target's `quietMs` ago, when given).
    const written = name === target && Number.isFinite(quietMs) ? NOW - quietMs : NOW - 20 * MIN
    await utimes(file, new Date(written), new Date(written))
    await put(join(chats, `${cli}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW - 20 * MIN }))
  }
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'restart', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const { out } = await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_CARRY_BY_MODEL: '0' })
  const base = `http://127.0.0.1:${port}`
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  const call = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.27.1' }, body: JSON.stringify(body) })
  const json = async (path, body) => {
    const reply = await call(path, body)
    const text = await reply.text()
    assert.equal(reply.status, 200, text)
    const parsed = JSON.parse(text)
    return parsed.result ?? parsed
  }
  for (const [chat, session] of [['Main', 'main-id'], ['Worker 1', 'w1-id']]) if (chat !== target) await json('/api/bridge/report', { chat, session, report: { state: 'idle', since: NOW - 21 * MIN, seq: 1, run: 1 } })
  const words = async () => foldOutbox(await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8'))
  const record = async () => JSON.parse(await readFile(join(board, 'data', 'wakes.json'), 'utf8').catch(() => '{"wakes":{}}'))
  const state = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const laneOf = async name => (await state()).chats.find(one => one.name === name)
  return { out, call, json, words, record, state, laneOf, app, project }
}

const restarts = list => list.filter(one => one.command === 'chat-restart')
/** The restart prompt's handshake (the fix round, item 1). */
const RESTARTS = { restarts: true }

test('the real case: Worker 4\'s two deltas, idle and quiet, the courier alive: ONE restart entry; a second call lists nothing; sent records sentAt; its report closes the word "its link is back"', { timeout: 300_000 }, async t => {
  const { json, words, record, laneOf } = await boardWith(t)
  // No courier yet: no word, and its row says why in the attention colour (F9's way out).
  await until(async () => (await laneOf('Worker 4'))?.status === 'Link gone', 'Worker 4 reads Link gone', 60_000)
  await new Promise(done => setTimeout(done, 12_000))
  assert.deepEqual(restarts(await words()), [], 'no courier, no word')
  const before = await laneOf('Worker 4')
  assert.deepEqual([before.status, before.why, before.quiet === true], ['Link gone', 'restart this chat: archive it, then unarchive it', false])
  // The fix round, item 1: a courier on the old prompt (body `{}`) gets no restart entry, and no restart word is made for it; the row stays as is.
  assert.deepEqual((await json('/api/bridge/wakes-due', {})).wakes, [])
  await new Promise(done => setTimeout(done, 65_000))
  assert.deepEqual(restarts(await words()), [], 'an old prompt\'s courier: no word')
  assert.equal((await laneOf('Worker 4')).quiet === true, false, 'nor "restarts by itself"')
  // The courier on the restart prompt calls: from now the board counts on it. (A wake pass may run inside a call: what this and the next calls hand out.)
  const handed = [...(await json('/api/bridge/wakes-due', RESTARTS)).wakes]
  let made = []
  await until(async () => {
    made = restarts(await words())
    return made.length > 0
  }, 'the restart word')
  assert.equal(made.length, 1)
  assert.deepEqual([made[0].to, made[0].about, made[0].session, made[0].spell, made[0].forModel], ['the courier', 'Worker 4', 'local_w4', GONE, true])
  if (handed.length === 0) handed.push(...(await json('/api/bridge/wakes-due', RESTARTS)).wakes)
  const text = `The worker board restarted this chat: its Workers mod was unloaded at ${hm(GONE)}. Go on where you were; if nothing waits for you, end this turn.`
  assert.deepEqual(handed, [{ id: made[0].id, chat: 'Worker 4', session: 'local_w4', text, restart: true, alsoUnarchive: [] }])
  // Taken once: a second call lists nothing; the try is the spell's.
  assert.deepEqual((await json('/api/bridge/wakes-due', RESTARTS)).wakes, [])
  assert.equal((await words()).find(one => one.id === made[0].id).state, 'taken')
  await until(async () => (await record()).restartTries?.['Worker 4']?.[0]?.spell === GONE, 'the try in the record', 10_000)
  // Restarting once taken.
  await until(async () => (await laneOf('Worker 4')).status === 'Restarting', 'Restarting', 30_000)
  // wakes-sent: sentAt, still taken.
  assert.deepEqual(await json('/api/bridge/wakes-sent', { ids: [made[0].id], refused: [], stuck: [] }), { closed: 0, restarts: 1 })
  assert.deepEqual(await json('/api/bridge/wakes-sent', { ids: [made[0].id] }), { closed: 0 }, 'said twice: once')
  const sent = (await words()).find(one => one.id === made[0].id)
  assert.deepEqual([sent.state, typeof sent.sentAt], ['taken', 'number'])
  await until(async () => typeof (await record()).restartTries['Worker 4'][0].sentAt === 'number', 'sentAt in the record', 10_000)
  // The restarted chat's mod reports: the link is back, the word closes at the next pass.
  await json('/api/bridge/report', { chat: 'Worker 4', session: 'ddde6d5e-worker-4', report: { state: 'idle', since: Date.now(), seq: 1, run: 2 } })
  await until(async () => (await words()).find(one => one.id === made[0].id).state === 'delivered', 'the word closed')
  assert.equal((await words()).find(one => one.id === made[0].id).why, 'its link is back')
  assert.notEqual((await laneOf('Worker 4')).status, 'Link gone')
  await until(async () => (await record()).restartTries['Worker 4'][0].verdict === 'back', 'the verdict', 10_000)
})

test('a starter: Main\'s restart entry lists the board\'s other chats to unarchive; refused spends no try; a quiet Link gone says when it restarts', { timeout: 300_000 }, async t => {
  // Main's transcript was last written 9 min ago: its quiet clock ends a minute after the test's start. Main started Worker 1 and Worker 4 (D3').
  const { json, words, record, laneOf } = await boardWith(t, { target: 'Main', quietMs: 9 * MIN, children: { 'Worker 1': 'local_main', 'Worker 4': 'local_main' } })
  const calling = Date.now()
  const handed = [...(await json('/api/bridge/wakes-due', RESTARTS)).wakes]
  const called = Date.now()
  // The courier calls, the quiet clock still runs: the quiet colour, "restarts by itself at the courier's next run (about HH:MM)": the later of
  // the clock's end and the courier's next run (its call and 10 min).
  if (handed.length === 0) {
    await until(async () => (await laneOf('Main'))?.quiet === true, 'the quiet row', 30_000)
    const lane = await state(laneOf, 'Main')
    const times = [calling, called].map(at => `restarts by itself at the courier's next run (about ${hm(Math.max(NOW + MIN, at + 10 * MIN))})`)
    assert.equal(lane.status, 'Link gone')
    assert.ok(times.includes(lane.why), `${lane.why} is one of ${times.join(', ')}`)
  }
  await until(async () => restarts(await words()).length > 0, 'the restart word')
  if (handed.length === 0) handed.push(...(await json('/api/bridge/wakes-due', RESTARTS)).wakes)
  assert.equal(handed.length, 1)
  assert.deepEqual([handed[0].chat, handed[0].restart, handed[0].alsoUnarchive.sort()], ['Main', true, ['local_w1', 'local_w4']])
  // The app refused the archive: closed, no try spent, no new word for 30 min.
  assert.deepEqual(await json('/api/bridge/wakes-sent', { ids: [], refused: [handed[0].id], stuck: [] }), { closed: 0, restarts: 1 })
  const closed = (await words()).find(one => one.id === handed[0].id)
  assert.deepEqual([closed.state, closed.why], ['dropped', 'the app refused the archive'])
  await until(async () => (await record()).restartTries?.Main?.[0]?.verdict === 'refused', 'refused in the record', 10_000)
  // The verifier's N6: the refused row says when the courier tries again.
  await until(async () => /^the app refused the archive · tries again about \d\d:\d\d$/.test((await laneOf('Main')).why ?? ''), 'the refused why', 30_000)
  assert.notEqual((await laneOf('Main')).quiet, true, 'attention')
  assert.deepEqual((await json('/api/bridge/wakes-due', RESTARTS)).wakes, [])
  assert.equal(restarts(await words()).length, 1, 'no second word within 30 min')
})

/** The lane, read again until the board's state has it. */
async function state(laneOf, name) {
  let lane
  await until(async () => {
    lane = await laneOf(name)
    return lane !== undefined
  }, `${name}'s lane`, 30_000)
  return lane
}

test('section 5 and the stuck close: a taken word whose chat the board saw archived gets ONE unarchive-only entry at its 15-min close, and the Overview names it; stuck closes failed', { timeout: 300_000 }, async t => {
  const word = (id, about, session, more = {}) => ({ id, at: NOW - 20 * MIN, to: 'the courier', command: 'chat-restart', forModel: true, about, session, spell: GONE, alsoUnarchive: [], wakeText: 'x', text: 'Restart it', state: 'waiting', ...more })
  // Worker 4's word, taken 16 min ago, its chat seen archived 14 min ago (the courier's archive) and still archived (off the board).
  const four = word('r0000000000000a4', 'Worker 4', 'local_w4')
  const one = word('r0000000000000a1', 'Worker 1', 'local_w1')
  const lines = [four, { id: four.id, state: 'taken', takenBy: 'the courier', takenAt: NOW - 16 * MIN, alsoUnarchive: ['local_w1'] }, { id: four.id, archivedAt: NOW - 14 * MIN },
    one, { id: one.id, state: 'taken', takenBy: 'the courier', takenAt: NOW - MIN }]
  const { json, words, record, state } = await boardWith(t, { target: 'Worker 1', lines, archived: ['Worker 4'] })
  // The 15-min close at the wake pass: failed, the unarchive due.
  await until(async () => (await words()).find(one => one.id === four.id).state === 'dropped', 'the 15-min close')
  const closed = (await words()).find(one => one.id === four.id)
  assert.deepEqual([closed.why, closed.failed, closed.unarchive], ['the courier did not say what became of it', true, 'due'])
  // Listed once: the unarchive entry with the take's chats archived now (Worker 1 is not), never again.
  assert.deepEqual((await json('/api/bridge/wakes-due', RESTARTS)).wakes.filter(one => one.id === four.id), [{ id: four.id, chat: 'Worker 4', session: 'local_w4', unarchive: true, alsoUnarchive: [] }])
  assert.deepEqual((await json('/api/bridge/wakes-due', RESTARTS)).wakes.filter(one => one.id === four.id), [], 'once')
  // The Overview's one wake line names it.
  await until(async () => /Worker 4 is archived: unarchive it/.test((await state()).wakeNotice?.text ?? ''), 'the Overview names it', 30_000)
  // Worker 1's taken word: the courier says it stayed archived: closed failed, the try spent.
  assert.deepEqual(await json('/api/bridge/wakes-sent', { ids: [], refused: [], stuck: [one.id] }), { closed: 0, restarts: 1 })
  const stuck = (await words()).find(entry => entry.id === one.id)
  assert.deepEqual([stuck.state, stuck.why, stuck.failed], ['dropped', 'it stayed archived', true])
})
