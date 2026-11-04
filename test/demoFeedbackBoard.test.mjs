// B860, end to end on a running board: the person's Send on a goal demo writes feedback.json beside it, puts their words on the
// demo's step once, types one word to the partner, refuses a round sent already and shows round 2 with only the parts sent back.
// A copy of the board on a made-up project in a temporary folder only.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
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

test('the Send on a goal demo: feedback.json, the words on the step once, one word to the partner, round 2 shows what came back', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-recap-'))
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
  const demo = {
    goal: 'G6', title: 'The polish', step: 'B12',
    sections: [
      { kind: 'reached', rows: [{ title: '1. Lava', pictures: [{ kind: 'target', caption: 't', path: 'a.png' }] }, { title: '2. Cliffs', pictures: [{ kind: 'target', caption: 't', path: 'b.png' }] }] },
      { kind: 'not-reached', rows: [{ title: '3. Round shapes', pictures: [{ kind: 'final-not', caption: 'last', path: 'c.png' }] }] },
    ],
  }
  await put(join(project, 'pictures', 'g6', 'demo.json'), JSON.stringify(demo))
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Garden\n- [ ] B12 Plant the hedge (for Digger; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'recap', project, port, gamePort: 7340, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), refreshSeconds: 5 }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })

  const base = `http://127.0.0.1:${port}`
  const page = await fetch(`${base}/`).then(reply => reply.text())
  const token = /[0-9a-f]{64}/.exec(page)?.[0]
  assert.ok(token, 'the served page carries the token')
  const asPerson = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body),
  }).then(async reply => ({ status: reply.status, body: await reply.text() }))
  const demoPage = () => fetch(`${base}/api/demo?path=${encodeURIComponent('pictures/g6/demo.json')}`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  const outbox = async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text))
  const toPartner = async () => (await outbox()).filter(message => message.to === 'Advisor' && message.command === 'recap-feedback')
  const stepText = async () => readFile(join(work, 'B12.md'), 'utf8')
  const rowsOf = shown => shown.sections.flatMap(section => section.rows.map(row => row.key))

  const first = await demoPage()
  assert.deepEqual([first.feedback.round, first.feedback.canSend, first.feedback.whyNot, rowsOf(first)], [1, true, null, ['1. Lava', '2. Cliffs', '3. Round shapes']])

  // Refused before anything is written: a part the demo lacks, a part sent back without words.
  const send = body => asPerson('/api/demo-feedback', { path: 'pictures/g6/demo.json', ...body })
  assert.equal((await send({ round: 1, parts: [{ key: '9. Nothing', verdict: 'approved' }] })).status, 400)
  assert.equal((await send({ round: 1, parts: [{ key: '3. Round shapes', verdict: 'sent-back', comment: '' }] })).status, 400)
  assert.equal((await demoPage()).feedback.round, 1)

  const sent = await send({ round: 1, parts: [{ key: '1. Lava', verdict: 'approved' }, { key: '2. Cliffs', verdict: 'approved', comment: 'good' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'still stepped' }] })
  assert.equal(sent.status, 200, sent.body)
  // T22: with `said`, the id of the word to the partner, by which the page draws the Send's wait line.
  const { said: firstSaid, ...sentResult } = JSON.parse(sent.body)
  assert.deepEqual(sentResult, { round: 1, approved: 2, sentBack: 1, looks: 0, lookFailed: [], done: false, notedOn: 'B12', closed: [] })
  const kept = JSON.parse(await readFile(join(project, 'pictures', 'g6', 'feedback.json'), 'utf8'))
  assert.deepEqual(kept.rounds[0].parts, [{ key: '1. Lava', verdict: 'approved', comment: '' }, { key: '2. Cliffs', verdict: 'approved', comment: 'good' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'still stepped' }])
  // The step's "Your words" holds the round as one point (its history line quotes it too).
  const words = await stepText()
  const yours = words.split('## Your words')[1].split('\n## ')[0]
  assert.equal(yours.match(/Sent back: 3\. Round shapes: "still stepped"/g)?.length, 1, 'the words stand once as a point of Your words')
  assert.match(yours, /Recap feedback, round 1: 2 approved, 1 sent back\./)
  const toldPartner = await until(async () => { const found = await toPartner(); return found.length > 0 ? found : null }, 'the word to the partner')
  assert.equal(toldPartner.length, 1)
  assert.equal(firstSaid, toldPartner[0].id)
  // T22: the state carries the Send's wait line by that id, until the partner's next tries are filed.
  const state = await fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  assert.deepEqual([state.waits?.[firstSaid]?.command, state.waits?.[firstSaid]?.about, state.waits?.[firstSaid]?.state], ['recap-feedback', 'G6', 'sent'])
  // T22: this board offers Send again; one for a chat it does not show is refused at once, nothing tried.
  assert.equal(state.waitAgain, true)
  const refused = await asPerson('/api/say', { command: 'wake-again', chat: 'Nobody', word: firstSaid })
  assert.deepEqual([refused.status, refused.body.trim()], [404, 'That chat is not on the board.'])
  assert.match(toldPartner[0].text, /recap feedback: G6 The polish, round 1: 1 part sent back\nStep: B12\n/)
  assert.match(toldPartner[0].text, /- 3\. Round shapes: "still stepped"/)

  // The same round again (a double click, a second tab): refused, nothing is written or typed twice.
  const again = await send({ round: 1, parts: [{ key: '3. Round shapes', verdict: 'sent-back', comment: 'twice' }] })
  assert.equal(again.status, 409, again.body)
  assert.equal((await stepText()).split('## Your words')[1].split('\n## ')[0].match(/Recap feedback, round/g).length, 1)
  assert.equal((await toPartner()).length, 1)

  // T17.1 (the person: "the same pictures are provided and i see no evidence of what i asked it to fix"): right after the Send, round 2 is
  // being made: the part sent back with the person's words and no picture, nothing to send, and a Send is refused.
  const making = await demoPage()
  assert.deepEqual([making.feedback.round, making.feedback.making, making.feedback.canSend, rowsOf(making), making.sections[0].rows[0].pictures, making.sections[0].rows[0].reworking], [2, { round: 2 }, false, ['3. Round shapes'], [], true])
  assert.equal((await send({ round: 2, parts: [{ key: '3. Round shapes', verdict: 'approved' }] })).status, 409)
  // T17.1 (the coordinator's review of 6f197a4): a next try (a step of the goal filed after the Send) that turns done while the round is being
  // made is told to the partner, once for each step: "recap: G6 round 2: B20 is done; write the round with its row, `pending` for the rest".
  const nextTry = id => [`Id: ${id}`, 'Kind: step', 'Title: Round the shapes again', 'State: done', 'Owner: Digger', 'Activity: Garden', 'Goal: G6', `Since: ${stamp(Date.now())}`, '',
    '## History', `- ${stamp(Date.now())} Digger: new → done`, ''].join('\n')
  const nudges = async () => (await outbox()).filter(message => message.command === 'recap-round')
  await writeFile(join(work, 'B20.md'), nextTry('B20'))
  const nudged = await until(async () => { const found = await nudges(); return found.length > 0 ? found : null }, 'the word for the next try that is done')
  assert.equal(nudged.length, 1)
  assert.equal(nudged[0].text.split('\n')[0], 'recap: G6 round 2: B20 is done; write the round with its row, `pending` for the rest')
  assert.deepEqual([nudged[0].to, nudged[0].step, nudged[0].about], ['Advisor', 'B20', 'G6'])
  // The partner writes the demo again (a later minute than the Send), the part sent back with what changed: round 2 is ready.
  const file = join(project, 'pictures', 'g6', 'demo.json')
  const written = JSON.parse(await readFile(file, 'utf8'))
  written.sections[1].rows[0].changed = 'still stepped -> rounded off'
  written.sections[1].rows[0].play = 'ring'
  await writeFile(file, JSON.stringify(written))
  const later = new Date(Date.now() + 5 * MIN)
  await utimes(file, later, later)

  // Round 2 shows only the part sent back, with the person's comment and what changed; the approved ones are folded.
  const second = await demoPage()
  assert.deepEqual([second.feedback.round, second.feedback.making, second.feedback.canSend, rowsOf(second), second.sections[0].rows[0].said, second.feedback.folded.map(one => one.key)], [2, null, true, ['3. Round shapes'], { comment: 'still stepped', round: 1 }, ['1. Lava', '2. Cliffs']])
  assert.deepEqual([second.sections[0].rows[0].changed, second.sections[0].rows[0].play, second.sections[0].rows[0].pictures.length], ['still stepped -> rounded off', 'ring', 1])
  const done = await send({ round: 2, parts: [{ key: '3. Round shapes', verdict: 'approved' }] })
  const { said: doneSaid, ...doneResult } = JSON.parse(done.body)
  assert.deepEqual(doneResult, { round: 2, approved: 1, sentBack: 0, looks: 0, lookFailed: [], done: true, notedOn: 'B12', closed: [] })
  assert.equal(typeof doneSaid, 'string')
  const finished = await demoPage()
  assert.deepEqual([finished.feedback.done, finished.feedback.canSend, rowsOf(finished)], [true, false, []])
})
