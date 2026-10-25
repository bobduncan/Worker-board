// B640 (the fix of B632's check): the supervisor chat looks the limits up with get_usage and is cleared after its turn;
// the board reads only a chat's new transcript, so the lookup was lost at once. The board keeps the newest reading of
// each window itself: `limits.mjs newestPerWindow` / `keptReadingsOf`, `state.limitReadings`, the project's
// `.claude/limit-readings.json` the server writes, and `buildState`'s `keptReadings`. Made-up samples only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed, usageResult } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { keptReadingsOf, newestPerWindow, usageReadings } from '../src/limits.mjs'
import { parseTail } from '../src/transcript.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = Date.now()
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const reading = (at, five, week) => ({ at, fiveHour: five === null ? null : { used: five, resetsAt: at + 120 * MIN }, week: week === null ? null : { used: week, resetsAt: at + 3 * 24 * 60 * MIN } })

test('newestPerWindow keeps the newest figure of each window, one reading per window; keptReadingsOf drops what is none', () => {
  const kept = newestPerWindow([reading(1000, 10, 50), reading(3000, 12, null), reading(2000, null, 52)])
  assert.deepEqual(kept, [{ at: 3000, fiveHour: { used: 12, resetsAt: 3000 + 120 * MIN }, week: null }, { at: 2000, fiveHour: null, week: { used: 52, resetsAt: 2000 + 3 * 24 * 60 * MIN } }])
  assert.deepEqual(newestPerWindow([]), [])
  assert.deepEqual(newestPerWindow(null), [])
  // The file's form round-trips; anything else gives nothing.
  assert.deepEqual(keptReadingsOf(JSON.parse(JSON.stringify(kept))), kept)
  for (const none of [null, 'text', {}, [null, 3, { at: 'soon' }, { at: 5, fiveHour: { used: 'much' } }]]) assert.deepEqual(keptReadingsOf(none), [], String(none))
})

const app = name => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1' })
function build({ watcher, keptReadings }) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main","supervisor":"Watcher"}',
    appChatTexts: ['Main', 'Watcher'].map(app),
    tails: { 'cli-Main': { text: answer(NOW - 90 * MIN, 'ok'), isCut: false, modifiedAt: NOW - 90 * MIN }, 'cli-Watcher': { text: watcher.join('\n'), isCut: false, modifiedAt: NOW - 2 * MIN } },
    planLineTexts: {}, backlogText: '## Board\n', adviceText: null, folders: null, askTexts: [], pictureLists: {}, usageText: null,
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config, keptReadings })
}

test('a lookup of the supervisor chat survives its clear: the board keeps it and reads it back as a chat reading', () => {
  const looked = [typed(NOW - 40 * MIN, 'sweep: run work health'), usageResult(NOW - 38 * MIN, { fiveHour: { used: 11, resetsAt: NOW + 100 * MIN }, week: { used: 58, resetsAt: NOW + 2 * 24 * 60 * MIN } }), answer(NOW - 37 * MIN, 'nothing looks wrong')]
  // The chat's transcript holds the lookup (usageReadings reads it): the state names it as the reading to keep.
  assert.equal(usageReadings(parseTail(looked.join('\n'), false)).length, 1)
  const first = build({ watcher: looked })
  assert.deepEqual(first.limitReadings.map(one => [one.at, one.fiveHour?.used ?? null, one.week?.used ?? null]), [[NOW - 38 * MIN, 11, null], [NOW - 38 * MIN, null, 58]])
  assert.equal(first.limits.fiveHour.at, NOW - 38 * MIN)
  // After its clear the chat's new transcript holds nothing of it: without the kept reading the limits are not known ...
  const cleared = [typed(NOW - 2 * MIN, 'sweep: run work health')]
  const lost = build({ watcher: cleared })
  assert.deepEqual([lost.limits.fiveHour, lost.limits.week, lost.limitReadings], [null, null, []])
  // ... with it they stand as the lookup made them, and the same readings are kept for the next look.
  const kept = build({ watcher: cleared, keptReadings: keptReadingsOf(JSON.parse(JSON.stringify(first.limitReadings))) })
  assert.deepEqual([kept.limits.fiveHour.at, kept.limits.fiveHour.used, kept.limits.week.at, kept.limits.week.used], [NOW - 38 * MIN, 11, NOW - 38 * MIN, 58])
  assert.equal(kept.limits.fiveHour.resetsAt, Math.round((NOW + 100 * MIN) / MIN) * MIN)
  assert.deepEqual(kept.limitReadings, first.limitReadings)
  // A newer lookup of the chat takes the place of the kept one.
  const again = build({ watcher: [usageResult(NOW - 3 * MIN, { fiveHour: { used: 15, resetsAt: NOW + 95 * MIN }, week: { used: 59, resetsAt: NOW + 2 * 24 * 60 * MIN } })], keptReadings: first.limitReadings })
  assert.deepEqual([again.limits.fiveHour.at, again.limits.fiveHour.used], [NOW - 3 * MIN, 15])
})

// End to end on a running board: the file is written, and read back after the chat moved to a new, empty session.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})
function run(started, board, env) {
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
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
  for (const end = Date.now() + 30_000; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 100))
  }
  throw new Error(`Not within 30 s: ${what}`)
}
const exists = path => stat(path).then(() => true, () => false)

test('the running board writes the supervisor chat\'s lookup to the project and still shows it after the chat moved to a new session', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-readings-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main","supervisor":"Watcher","afterStep":"clear"}')
  await put(join(chats, 'main-id.json'), JSON.stringify({ name: 'Main', role: 'main', state: 'waiting', task: null, at: NOW }))
  await put(join(chats, 'watch-old.json'), JSON.stringify({ name: 'Watcher', role: 'supervisor', state: 'waiting', task: null, at: NOW }))
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  await put(join(app, 'a', 'b', 'local_main.json'), appChat('Main', 'main-id'))
  await put(join(app, 'a', 'b', 'local_watch.json'), appChat('Watcher', 'watch-old'))
  await put(join(transcripts, 'main-id.jsonl'), `${[typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n')}\n`)
  const looked = [typed(NOW - 5 * MIN, 'sweep: run work health'), usageResult(NOW - 4 * MIN, { fiveHour: { used: 11, resetsAt: NOW + 100 * MIN }, week: { used: 58, resetsAt: NOW + 2 * 24 * 60 * MIN } }), answer(NOW - 3 * MIN, 'nothing looks wrong')]
  await put(join(transcripts, 'watch-old.jsonl'), `${looked.join('\n')}\n`)
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Art\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'readings', project, port, gamePort: 7300, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  const env = { WORKER_BOARD_HOME: join(dir, 'pc') }
  await run(started, board, env)
  // The page names its token (a new one at every start); the state is read with it.
  const limits = async () => {
    const token = (await fetch(`http://127.0.0.1:${port}/`).then(reply => reply.text())).match(/<meta name="board-token" content="([^"]+)">/)[1]
    return fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json()).then(state => state.limits)
  }
  const file = join(project, '.claude', 'limit-readings.json')
  await until(async () => (await limits())?.fiveHour?.used === 11, 'the lookup read from the chat')
  await until(() => exists(file), 'the kept readings')
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).map(one => [one.fiveHour?.used ?? null, one.week?.used ?? null]), [[11, null], [null, 58]])

  // The chat is cleared: its card moves to a new session with an empty transcript. The board's own memory of the lookup stays.
  await put(join(chats, 'watch-new.json'), JSON.stringify({ name: 'Watcher', role: 'supervisor', state: 'waiting', task: null, at: NOW }))
  await put(join(chats, 'watch-old.json'), JSON.stringify({ movedTo: 'watch-new', at: NOW }))
  await put(join(transcripts, 'watch-new.jsonl'), '')
  // It also holds after the board starts anew.
  await stop(started.pop())
  await run(started, board, env)
  await until(async () => (await limits())?.fiveHour?.used === 11, 'the kept lookup read after the clear and a restart')
  const after = await limits()
  assert.deepEqual([after.fiveHour.at, after.week.used], [NOW - 4 * MIN, 58])
})
