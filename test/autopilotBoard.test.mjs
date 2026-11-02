// Autopilot (the person, 2026-10-31: "yes to the plan go build"), end to end on a running board: switched on in the settings
// panel, the open asks are routed at once (the partner's own advice taken, an action to the main chat, a goal question to the
// person, a checker's look to the goal's recap); the main chat is woken for its ask through the delivery's line while it runs
// and is free; the recap's Send closes what waited for it; a new ask is routed as it is filed. A copy of the board on a
// made-up project in a temporary folder only.

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
const MOD = '0.27.1'

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

test('Autopilot switched on routes the open asks at once, wakes the main chat for its ask, and the recap\'s Send closes what waited for it', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-autopilot-'))
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
  const people = [['lead-id', 'Lead', 'main'], ['digger-id', 'Digger', 'worker'], ['checker-id', 'Checker', 'worker'], ['advisor-id', 'Advisor', 'worker']]
  const appChat = (name, cliSessionId) => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  for (const [id, name, role] of people) {
    await put(join(chats, `${id}.json`), JSON.stringify({ name, role, state: 'waiting', task: null, at: NOW }))
    await put(join(app, 'a', 'b', `local_${name.toLowerCase()}.json`), appChat(name, id))
    await put(join(transcripts, `${id}.jsonl`), `${typed(NOW - 9 * MIN, 'Status?')}\n${answer(NOW - 8 * MIN, 'All fine.')}\n`)
  }
  await put(join(project, '.claude', 'goals.md'), RUN_GOALS)
  // The goal demo of G6: its one part shows the hedge, B12.
  await put(join(project, 'pictures', 'g6', 'demo.json'), JSON.stringify({ goal: 'G6', title: 'The polish', step: 'B12', sections: [{ kind: 'reached', rows: [{ title: '1. Hedge', steps: ['B12'], pictures: [{ kind: 'target', caption: 't', path: 'a.png' }] }] }] }))
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Garden\n- [ ] B12 Plant the hedge (for Digger; about 1 h)\n- [ ] B13 Quality Assurance: B12 Plant the hedge\n- [ ] B14 Label the hedges\n', { now: NOW }), undefined, { now: NOW })
  // B12 is of the focus goal G6; B13 is its Quality Assurance task, done by Checker.
  const b12 = await readFile(join(work, 'B12.md'), 'utf8')
  await writeFile(join(work, 'B12.md'), b12.replace(/^(Kind: step\n)/m, '$1Goal: G6\n'))
  const b13 = await readFile(join(work, 'B13.md'), 'utf8')
  await writeFile(join(work, 'B13.md'), b13.replace(/^State: .*$/m, 'State: done').replace(/^(Kind: step\n)/m, '$1Owner: Checker\nGoal: G6\nChecks: B12\n'))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'autopilot', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }, null, 2))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })

  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const base = `http://127.0.0.1:${port}`
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(reply => reply.text()))?.[0]
  assert.ok(token, 'the served page carries the token')
  const call = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': MOD }, body: JSON.stringify(body) })
  const asChat = (chat, body) => call('/api/bridge/work', { chat, session: `${chat.toLowerCase()}-id`, ...body }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  const asPerson = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: await reply.text() }))
  const state = () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const outbox = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text))
  const head = async (id, field) => (await readFile(join(work, `${id}.md`), 'utf8')).match(new RegExp(`^${field}: (.*)$`, 'm'))?.[1] ?? null
  const idOf = reply => reply.body.result?.id ?? reply.body.id
  const ok = (reply, what) => assert.equal(reply.status, 200, `${what}: ${JSON.stringify(reply.body)}`)

  // The main chat runs and is free (its Workers mod reports it idle).
  const reported = await call('/api/bridge/report', { chat: 'Lead', session: 'lead-id', report: { state: 'idle', since: NOW - 2 * MIN, seq: 1, run: 1 } })
  assert.equal(reported.status, 200, await reported.text())

  // Before Autopilot: four open asks, each the person's or the partner's as today.
  ok(await asChat('Digger', { action: 'take', minutes: 30, id: 'B12', branch: 'b12' }), 'take')
  const merge = await asChat('Digger', { action: 'ask', of: 'B12', kind: 'do', title: 'Merge B12 into main', text: 'Merge B12 into main once its check passed.' })
  ok(merge, 'the do')
  // The ruling of 2026-10-31: the partner's advice is taken only for an ask under a step (its own step: a second question under
  // B12 would join the open one there, one question per task).
  const names = await asChat('Advisor', { action: 'ask', of: 'B14', kind: 'decide', title: 'Shorter names on the hedge labels?', text: 'Shorter names fit the labels.', advice: 'yes' })
  ok(names, 'the partner\'s')
  // Autopilot v2 (on purpose: "Which part first?" of the focus goal now takes its advice): a goal's start stays the person's.
  const part = await asChat('Advisor', { action: 'ask', of: 'G6', kind: 'decide', title: 'Which goal comes next: damage or the bars?', text: 'Damage first or the bars first?', options: ['A damage', 'B bars'], advice: 'A' })
  ok(part, 'the goal\'s')
  const look = await asChat('Checker', { action: 'ask', of: 'B12', kind: 'look', title: 'Approve the hedge as it is?', text: 'It stands a little low.', advice: 'yes' })
  ok(look, 'the checker\'s')
  const [mergeId, namesId, partId, lookId] = [merge, names, part, look].map(idOf)
  assert.deepEqual(await Promise.all([mergeId, namesId, partId, lookId].map(id => head(id, 'Route'))), [null, null, null, null])

  // On: routed at once.
  const switched = await asPerson('/api/settings', { key: 'autopilot', value: true })
  assert.equal(switched.status, 200, switched.body)
  assert.equal(JSON.parse(switched.body).autopilot, true)
  assert.match(await readFile(join(board, 'config.json'), 'utf8'), /"autopilot": true/)
  assert.deepEqual(await Promise.all([mergeId, namesId, partId, lookId].map(id => head(id, 'Route'))), ['main', 'advice', 'person', 'recap'])
  assert.deepEqual([await head(namesId, 'State'), await head(namesId, 'Answered by')], ['answered', 'autopilot'])
  // The partner's own ask: it is told the board took its advice.
  await until(async () => (await outbox()).some(one => one.to === 'Advisor' && /Autopilot is on: the board took your advice/.test(one.text ?? '')), 'the word to the Advisor')
  // The main chat: woken for its ask through the delivery's work line (command work), once.
  const word = await until(async () => (await outbox()).find(one => one.to === 'Lead' && one.kind === 'main-ask' && one.about === mergeId), 'the main chat\'s word')
  assert.equal(word.command, 'work')
  assert.equal(word.text, `autopilot: do ${mergeId} if a chat can, else escalate it with one line why`)
  const next = await asChat('Lead', { action: 'next' })
  ok(next, 'next')
  assert.match(next.body.result?.text ?? next.body.text, new RegExp(`Asks you do for the person \\(Autopilot[^\\n]*\\n- ${mergeId} do from Digger on B12: Merge B12 into main`))
  // Needs your attention: only the goal's question; the quiet line's count; the routed asks for their windows.
  const shown = await until(async () => {
    const now = await state()
    return now.autopilot?.on === true ? now : null
  }, 'the state with Autopilot')
  assert.deepEqual(shown.forYou.filter(one => one.workId !== undefined && one.answer === null).map(one => one.workId), [partId])
  assert.equal(shown.autopilot.decidedToday, 1)
  assert.deepEqual(shown.routedAway.map(one => [one.id, one.route]), [[mergeId, 'main'], [lookId, 'recap']])

  // The main chat does it.
  ok(await asChat('Lead', { action: 'partner-answer', id: mergeId, text: 'Merged B12 into main.', why: 'a chat can merge' }), 'the main chat\'s answer')
  assert.equal(await head(mergeId, 'Answered by'), 'main')

  // The recap's Send: the part that shows B12 sent back closes the checker's look with the person's words.
  const sent = await asPerson('/api/demo-feedback', { path: 'pictures/g6/demo.json', round: 1, parts: [{ key: '1. Hedge', verdict: 'sent-back', comment: 'taller, please' }] })
  assert.equal(sent.status, 200, sent.body)
  assert.equal(await head(lookId, 'State'), 'answered')
  assert.match(await readFile(join(work, `${lookId}.md`), 'utf8'), /## Answer\nSent back in the recap of G6, round 1: 1\. Hedge: "taller, please"/)
  await until(async () => (await outbox()).some(one => one.to === 'Checker' && /taller, please/.test(one.text ?? '')), 'the recap\'s answer to Checker')

  // A new ask while Autopilot is on is routed as it is filed.
  // Autopilot v2: without advice (with it the board takes the advice).
  const fresh = await asChat('Digger', { action: 'ask', of: 'B12', kind: 'decide', title: 'Box or yew for the hedge?', text: 'Both grow well here.', options: ['A box', 'B yew'] })
  ok(fresh, 'the new ask')
  assert.equal(await head(idOf(fresh), 'Route'), 'partner')
  assert.match(await readFile(join(work, `${idOf(fresh)}.md`), 'utf8'), /server: autopilot: routed to partner/)

  // Off: nothing is routed back by itself.
  ok(await asPerson('/api/settings', { key: 'autopilot', value: false }), 'off')
  assert.deepEqual(await Promise.all([partId, idOf(fresh)].map(id => head(id, 'Route'))), ['person', 'partner'])
})
