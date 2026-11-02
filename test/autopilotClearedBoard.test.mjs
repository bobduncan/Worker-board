// Autopilot switched on clears what it can (the person, 2026-11-02, on a 47-hour-old Do card "Open the recap and try it": "if
// autopilot is turned on, the outstanding, needing for attentions get reevaluated and possible resolved if autopilot would answer
// them"), end to end on a running board: the switch-on in the settings panel moves the asks the focus goal's recap asks already
// into the recap (the sweep), keeps them in autopilot-cleared.json, and asks the Advisor to check what still stands for the person
// (the check "by Autopilot"); the Advisor's closes join the record and the page's state; the Undo opens it all again, once. A copy of
// the board on a made-up project in a temporary folder only.

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
const MOD = '0.27.1'
const RECAP = 'pictures/g6/demo.json'

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

/** An open ask file; `routed`: the board's own route to the person is in its History (what the first switch-on wrote). */
const askFile = (id, head, words, routed) => `${Object.entries({ Id: id, Kind: 'ask', State: 'open', Since: stamp(NOW - 50 * MIN), Filed: String(NOW - 50 * MIN), Blocking: 'no', Via: 'chat', ...head }).map(([key, value]) => `${key}: ${value}`).join('\n')}

## Text
${words}

## History
- ${stamp(NOW - 50 * MIN)} ${head.Owner}: asked (${head.Asks})
${routed ? `- ${stamp(NOW - 40 * MIN)} server: autopilot: routed to person\n` : ''}`

test('switching Autopilot on moves the asks the focus recap asks into the recap, asks the Advisor to check the rest, keeps both for an Undo', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-cleared-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Garden · ","main":"Lead","afterStep":"clear"}')
  const people = [['lead-id', 'Lead', 'main'], ['digger-id', 'Digger', 'worker'], ['advisor-id', 'Advisor', 'worker']]
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  for (const [id, name, role] of people) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW }))
    await put(join(app, 'a', 'b', `local_${name.toLowerCase()}.json`), appChat(name, id))
    await put(join(transcripts, `${id}.jsonl`), `${typed(NOW - 9 * MIN, 'Status?')}\n${answer(NOW - 8 * MIN, 'All fine.')}\n`)
  }
  await put(join(project, '.claude', 'goals.md'), RUN_GOALS)
  // The focus goal G6's recap: its one part shows the hedge, B12.
  await put(join(project, ...RECAP.split('/')), JSON.stringify({ goal: 'G6', title: 'The polish', step: 'B12', sections: [{ kind: 'reached', rows: [{ title: '1. Hedge', steps: ['B12'], pictures: [{ kind: 'target', caption: 't', path: 'a.png' }] }] }] }))
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Garden\n- [ ] B12 Plant the hedge (for Digger; about 1 h)\n- [ ] B14 Label the hedges\n', { now: NOW }), undefined, { now: NOW })
  const b12 = await readFile(join(work, 'B12.md'), 'utf8')
  await writeFile(join(work, 'B12.md'), b12.replace(/^State: .*$/m, 'State: review').replace(/^(Kind: step\n)/m, '$1Goal: G6\n'))
  // What the first switch-on left with the person (the live Q569 and Q578), and a question that stands for them for real.
  await writeFile(join(work, 'Q1.md'), askFile('Q1', { Title: `Open the recap and try it: [Open the recap](http://127.0.0.1:4314/#demo=${RECAP}).`, Owner: 'Digger', Asks: 'do', Route: 'person' }, `Open the recap and try it: [Open the recap](http://127.0.0.1:4314/#demo=${RECAP}).`, true))
  await writeFile(join(work, 'Q2.md'), askFile('Q2', { Title: 'Is 68 good enough for this map, or should the 75 target be reset for this panel?', Owner: 'Digger', Asks: 'look', Pictures: 'pictures/B12/evidence.png', Advice: 'accepting it', Route: 'person' }, 'Is 68 good enough for this map, or should the 75 target be reset for this panel? I advise accepting it.', true))
  await writeFile(join(work, 'Q3.md'), askFile('Q3', { Title: 'Which spade for the hedge?', Owner: 'Digger', Asks: 'provide' }, 'Which spade for the hedge?', false))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'cleared', project, port, gamePort: 7342, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }, null, 2))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })

  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const base = `http://127.0.0.1:${port}`
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  assert.ok(token, 'the served page carries the token')
  const asChat = (chat, body) => fetch(`${base}/api/bridge/work`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': MOD }, body: JSON.stringify({ chat, session: `${chat.toLowerCase()}-id`, ...body }),
  }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  const asPerson = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: await reply.text() }))
  const state = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const outbox = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text))
  const head = async (id, field) => (await readFile(join(work, `${id}.md`), 'utf8')).match(new RegExp(`^${field}: (.*)$`, 'm'))?.[1] ?? null
  const file = async name => JSON.parse(await readFile(join(work, name), 'utf8'))

  // Before: no record, Autopilot off.
  assert.equal((await state()).autopilotCleared, null)
  assert.equal((await asPerson('/api/work', { action: 'autopilot-undo' })).status, 404, 'nothing cleared: nothing to undo')

  // On: the sweep moves Q1 and Q2 into the recap at once; the settings answer does not wait for the Advisor.
  const switched = await asPerson('/api/settings', { key: 'autopilot', value: true })
  assert.equal(switched.status, 200, switched.body)
  // (Q3 is only a question for the person: the pass gives it its route, the person's own.)
  assert.deepEqual(await Promise.all(['Q1', 'Q2', 'Q3'].map(id => head(id, 'Route'))), ['recap', 'recap', 'person'])
  assert.equal(await head('Q2', 'Of'), 'B12')
  const record = await file('autopilot-cleared.json')
  assert.deepEqual(record.items.map(one => [one.id, one.how, one.why]), [['Q1', 'recap', 'moved into your recap'], ['Q2', 'recap', 'moved into your recap']])
  assert.equal(record.undoneAt, null)
  assert.equal(Math.abs(record.at - Date.now()) < 120_000, true)
  assert.deepEqual((await state()).autopilotCleared, record, 'the page reads the same record')

  // The check by Autopilot: one word to the Advisor, for the one ask that still stands for the person (and nothing else).
  const word = await until(async () => (await outbox()).find(one => one.to === 'Advisor' && one.command === 'obsolete-check'), 'the word to the Advisor')
  assert.match(word.text, /^obsolete check: 1 open item under Needs your attention\nItems: Q3\n/)
  assert.equal((await file('obsolete-check.json')).by, 'autopilot')
  // The Advisor judges it obsolete; the close joins the record, and the page's state.
  const verdicts = await asChat('Advisor', { action: 'obsolete', points: ['obsolete: Q3 · the spade was chosen long ago · none'] })
  assert.equal(verdicts.status, 200, JSON.stringify(verdicts.body))
  assert.equal(await head('Q3', 'State'), 'withdrawn')
  const closed = await file('autopilot-cleared.json')
  assert.deepEqual(closed.items.map(one => [one.id, one.how, one.why]), [['Q1', 'recap', 'moved into your recap'], ['Q2', 'recap', 'moved into your recap'], ['Q3', 'closed', 'the spade was chosen long ago']])
  assert.equal(closed.at, record.at)
  assert.deepEqual((await state()).autopilotCleared, closed)

  // Undo: all three are the person's again; once.
  const undone = await asPerson('/api/work', { action: 'autopilot-undo' })
  assert.equal(undone.status, 200, undone.body)
  assert.deepEqual(JSON.parse(undone.body).undone, ['Q1', 'Q2', 'Q3'])
  assert.deepEqual(await Promise.all(['Q1', 'Q2', 'Q3'].map(id => head(id, 'Route'))), ['person', 'person', 'person'])
  assert.equal(await head('Q3', 'State'), 'open')
  const after = await state()
  assert.equal(typeof after.autopilotCleared.undoneAt, 'number')
  assert.deepEqual(after.forYou.filter(one => one.workId !== undefined && one.answer === null).map(one => one.workId).sort(), ['Q1', 'Q2', 'Q3'], 'back in Needs your attention')
  const twice = await asPerson('/api/work', { action: 'autopilot-undo' })
  assert.equal(twice.status, 409)
  assert.match(twice.body, /Undone already\./)
  // Off and on again: what the person took back stays theirs.
  assert.equal((await asPerson('/api/settings', { key: 'autopilot', value: false })).status, 200)
  assert.equal((await asPerson('/api/settings', { key: 'autopilot', value: true })).status, 200)
  assert.deepEqual(await Promise.all(['Q1', 'Q2', 'Q3'].map(id => head(id, 'Route'))), ['person', 'person', 'person'])
})
