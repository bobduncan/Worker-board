// B1273 (F36a): the whole board over a made-up project while the Claude app is on another account (the 11-19 case: the app's
// config.json names the other account; the board's chats live in its own). The board holds by itself: B738, ready, is handed to
// nobody, no wake goes out, the page has one calm line; back on the board's account it goes on and B738 goes to Worker 4.

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
import { readStore, writeStore } from '../src/work/store.mjs'
import { AWAY_LINE } from '../src/appAccount.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MIN = 60_000
const DONE = 'It is in.\n\n---\n\n```diff\n  Prompt: a step\n  Who:    Game - Worker 4\n+ Done:   yes\n```'
const BOARD = '26b81206-0000-4000-8000-0000000000a1'
const OTHER = '7b36a87b-0000-4000-8000-0000000000b2'
const ORG = 'b9a34978-0000-4000-8000-0000000000c3'

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(started, board, env) {
  const claude = join(dirname(board), 'claude-config')
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, CLAUDE_CONFIG_DIR: claude, WORKER_BOARD_TICK_MS: '1000', ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
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
    if (await check()) return
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Not within 90 s: ${what}`)
}

test('the app on another account: the board holds by itself (no hand-out, no wake, one calm line); back on its account B738 goes to Worker 4', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-account-'))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const [board, project, appData, transcripts] = ['board', 'project', 'appdata', 'transcripts'].map(name => join(dir, name))
  const app = join(appData, 'claude-code-sessions')
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  const put = async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const chats = join(project, '.claude', 'chats')
  await put(join(chats, 'list.json'), '{"prefix":"Game - ","main":"Main","afterStep":"clear"}')
  await put(join(chats, 'main-id.json'), JSON.stringify({ name: 'Main', role: 'main', state: 'waiting', task: null, at: NOW }))
  const appChat = (name, cliSessionId, at = NOW) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: at, completedTurns: 5, lastAssistantUuid: 'a1' })
  await put(join(app, BOARD, ORG, 'local_main.json'), appChat('Main', 'main-id'))
  // The other account: an old copy of Main, and the person's own chat there, newer than everything (the newest folder).
  await put(join(app, OTHER, 'ecf3becd-0000-4000-8000-0000000000d4', 'local_main.json'), appChat('Main', 'main-id', NOW - 15 * 24 * 60 * MIN))
  await put(join(app, OTHER, 'ecf3becd-0000-4000-8000-0000000000d4', 'local_other.json'), JSON.stringify({ title: 'My own chat', sessionId: 'local_other', cliSessionId: 'other-id', cwd: join(dir, 'elsewhere'), lastActivityAt: NOW + MIN }))
  await put(join(transcripts, 'main-id.jsonl'), `${[typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n')}\n`)
  await put(join(chats, 'worker-4-id.json'), JSON.stringify({ name: 'Worker 4', role: 'worker', state: 'waiting', task: null, at: NOW - MIN }))
  await put(join(app, BOARD, ORG, 'local_worker-4.json'), appChat('Worker 4', 'worker-4-id'))
  await put(join(transcripts, 'worker-4-id.jsonl'), `${[typed(NOW - 20 * MIN, 'Go on.'), answer(NOW - 3 * MIN, DONE)].join('\n')}\n`)
  await writeStore(join(project, '.claude', 'work'), migrateBacklog('## Board\n- [ ] B738 Draw the shield (about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  await put(join(project, '.claude', 'work', 'B738.md'), `Id: B738\nKind: step\nTitle: Draw the shield\nState: refined\nRefined: ready\nGoal: G15\nQueued by: person, 2026-10-27 22:20:00\nSince: ${stamp(NOW - 5 * MIN)}\n`)
  // The app's own config: signed in with the OTHER account (lastKnownAccountUuid), as on 11-19 until 19:11.
  const appConfig = join(appData, 'config.json')
  await put(appConfig, JSON.stringify({ locale: 'en', lastKnownAccountUuid: OTHER }))
  const usage = join(appData, 'usage.json')
  await put(usage, JSON.stringify({ version: 2, samples: [{ t: NOW - MIN, org: 'org-1', u: { fh: 10, sd: 10 } }] }))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'away', project, port, gamePort: 7330, gameRepo: '', appSessions: app, transcripts, usageHistory: usage, refreshSeconds: 5 }))
  // B1555: the reconciler every 5 s (not the 30 s default), so the 6 s below covers a pass of it and the hand-out comes soon once back.
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc'), WORKER_BOARD_ACCOUNT_SETTLE_MS: '2000' })
  const outbox = async () => JSON.parse(await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').then(text => `[${text.trim().split('\n').filter(Boolean).join(',')}]`, () => '[]'))
  const base = `http://127.0.0.1:${port}`
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  for (const name of ['Main', 'Worker 4']) {
    const sent = await fetch(`${base}/api/bridge/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': '0.27.0' },
      body: JSON.stringify({ chat: name, session: `${name.toLowerCase().replace(/\W+/g, '-')}-id`, report: { state: 'idle', since: NOW - 3 * MIN, seq: 1, run: 1 } }),
    })
    assert.equal(sent.status, 200, await sent.text())
  }
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  const state = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  await until(async () => (await state()).pause?.state === 'away', 'the away hold in the state')
  let seen = await state()
  assert.deepEqual([seen.pause.line, seen.account.app, seen.account.board, seen.account.away], [AWAY_LINE, OTHER, BOARD, true])
  assert.deepEqual(seen.chats.filter(lane => !lane.isLeftover).map(lane => lane.name).sort(), ['Main', 'Worker 4'], 'the board\'s own chats, read in its account')
  assert.equal(JSON.parse(await readFile(join(board, 'data', 'app-account.json'), 'utf8')).account, BOARD, 'the board\'s account recorded from its main chat')
  // Its loops pass a few times: nothing is handed out, nothing is sent.
  await new Promise(done => setTimeout(done, 6000))
  seen = await state()
  assert.deepEqual(seen.readyList.ready.map(one => one.id), ['B738'])
  assert.equal(seen.reconciled.handOutHeld, true)
  const early = (await outbox()).filter(one => one.command === 'handover' || one.step === 'B738')
  assert.deepEqual(early, [], `no hand-out while away: ${JSON.stringify(early).slice(0, 900)}`)
  // B1283 (F37): past the settle the board filed its one ask in the store (a decide of the board's own, routed to the person).
  const askOf = async () => [...(await readStore(join(project, '.claude', 'work'))).items.values()].find(item => item.head.get('Kind') === 'ask' && /^The Claude app is on account/.test(item.head.get('Title') ?? ''))
  await until(async () => (await askOf()) !== undefined, 'the account ask in the store')
  const asked = await askOf()
  assert.deepEqual([asked.head.get('State'), asked.head.get('Asks'), asked.head.get('Options')], ['open', 'decide', 'A Run the board on this account | B Keep waiting until I switch back'])
  assert.equal((await state()).pause.ask, asked.head.get('Id'), 'the away line links to it')
  await new Promise(done => setTimeout(done, 3000))
  assert.equal([...(await readStore(join(project, '.claude', 'work'))).items.values()].filter(item => item.head.get('Kind') === 'ask').length, 1, 'one ask, not one per read')
  // Back on the board's account: after the settle time the hold lifts, the ask closes by itself and B738 goes to Worker 4.
  await writeFile(appConfig, JSON.stringify({ locale: 'en', lastKnownAccountUuid: BOARD }))
  await until(async () => (await outbox()).some(one => one.command === 'handover' && one.step === 'B738'), 'the hand-over of B738 once back')
  assert.equal((await outbox()).find(one => one.step === 'B738').to, 'Worker 4')
  seen = await state()
  assert.notEqual(seen.pause?.state, 'away')
  assert.equal(seen.account.away, false)
  await until(async () => (await askOf())?.head.get('State') === 'withdrawn', 'the ask withdrawn once home')
  assert.match((await askOf()).sections.get('History')?.join('\n') ?? '', /withdrawn: the Claude app came back to 26b81206; nothing to decide/)
})
