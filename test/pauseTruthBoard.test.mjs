// Pause truth, review 5: the server's own wiring on a running board (a copy of the board on a made-up project in a temporary
// folder, as test/handoverLive.test.mjs does). Four calls in server.mjs carried the fixes and no test noticed one gone:
// the popup-asks pass, the pause handed to the supervisor's view, and the step's state and end time handed to replacedChats.
// (The fourth place, the guard of src/say.mjs spawnWhenAlone, is tested in test/pauseTruth.test.mjs.)

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { stamp } from '../src/work/migrate.mjs'

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
  for (const end = Date.now() + 60_000; Date.now() < end;) {
    if (await check()) return
    await new Promise(done => setTimeout(done, 250))
  }
  throw new Error(`Not within 60 s: ${what}`)
}

const lines = (head, history) => `${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n## History\n${history.join('\n')}\n`
const POPUP = 'A popup in its chat may wait for you: it has tried to use ccd directory (change directory) (garden) for over a minute.'

/** A board on a made-up project: a main chat Lead, a worker Units, and `extra` files in the work store and the app's folder. */
async function boardWith(t, { files = {}, app: appFiles = {}, pause = null, advisor = false }) {
  const dir = await mkdtemp(join(tmpdir(), 'board-pause-truth-'))
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
  await put(join(chats, 'list.json'), '{"prefix":"Team - ","main":"Lead"}')
  await put(join(chats, 'lead-id.json'), JSON.stringify({ name: 'Lead', role: 'main', state: 'waiting', task: null, at: NOW }))
  await put(join(chats, 'units-id.json'), JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW }))
  const appChat = (name, cli, more = {}) => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: cli, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: NOW, ...more })
  if (advisor) await put(join(chats, 'advisor-id.json'), JSON.stringify({ name: 'Advisor', role: 'advisor', state: 'waiting', task: null, at: NOW }))
  for (const [name, session] of [['Lead', 'lead-id'], ['Units', 'units-id'], ...(advisor ? [['Advisor', 'advisor-id']] : [])]) {
    await put(join(app, 'a', 'b', `local_${name}.json`), appChat(name, session))
    await put(join(transcripts, `${session}.jsonl`), `${[typed(NOW - 40 * MIN, 'Go on.'), answer(NOW - 30 * MIN, 'Done.')].join('\n')}\n`)
  }
  for (const [name, text] of Object.entries(appFiles)) await put(join(app, 'a', 'b', name), text(appChat))
  const work = join(project, '.claude', 'work')
  for (const [id, text] of Object.entries(files)) await put(join(work, `${id}.md`), text)
  await put(join(work, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Art', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  if (pause !== null) await put(join(work, 'pause.json'), JSON.stringify(pause))
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'truth', project, port, gamePort: 7350, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), refreshSeconds: 5, ...(advisor ? { advisor: 'Advisor' } : {}) }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const base = `http://127.0.0.1:${port}`
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const call = (path, body, mod = '0.31.0') => fetch(`${base}/api/bridge/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': mod }, body: JSON.stringify(body) })
    .then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() }))
  const token = (await (await fetch(`${base}/`)).text()).match(/name="board-token" content="([^"]+)"/)[1]
  const state = async () => (await fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } })).json()
  const head = async (id, field) => (await readFile(join(work, `${id}.md`), 'utf8')).match(new RegExp(`^${field}: (.*)$`, 'm'))?.[1] ?? null
  const addFile = (id, text) => writeFile(join(work, `${id}.md`), text)
  return { call, state, head, addFile }
}

test('on a running board: the popup ask of a done step is withdrawn by the pass, and a new fix step waits for Resume all while the pause holds', { timeout: 240_000 }, async t => {
  const done = lines({ Id: 'B11', Kind: 'step', Title: 'Task B11', State: 'done', Owner: 'Units', Activity: 'Art', Since: stamp(NOW - 30 * MIN) }, [`- ${stamp(NOW - 30 * MIN)} Units: in progress → done`])
  const fresh = lines({ Id: 'B30', Kind: 'step', Title: 'Fix of X1: a thing that fails', Priority: 'fix', State: 'new', Activity: 'Art', Since: stamp(NOW - 20 * MIN) }, [`- ${stamp(NOW - 20 * MIN)} Supervisor: made`])
  const popup = lines({ Id: 'Q1', Kind: 'ask', Title: POPUP, State: 'open', Owner: 'Units', Activity: 'Art', Since: stamp(NOW - 25 * MIN), Filed: NOW - 25 * MIN, Asks: 'do', Blocking: 'no', Of: 'B11', Via: 'form', Route: 'person' }, [`- ${stamp(NOW - 25 * MIN)} Units: asked (do, with the app's question form)`]).replace('\n\n## History', `\n\n## Text\n${POPUP} Open its chat and look.\n\n## History`)
  const incident = lines({ Id: 'X1', Kind: 'incident', Title: 'A thing fails', State: 'fix', Source: 'chain-long', Subject: 'B1', Key: 'chain-long B1', Since: stamp(NOW - 25 * MIN), 'First seen': stamp(NOW - 25 * MIN), 'Last seen': stamp(NOW - 22 * MIN), Count: 3, Fix: 'B30', Evidence: 'the chain' }, [`- ${stamp(NOW - 25 * MIN)} Supervisor: fix B30`])
  const { state, head } = await boardWith(t, { files: { B11: done, B30: fresh, Q1: popup, X1: incident }, pause: { state: 'pausing', since: NOW - 10 * MIN, by: 'person' } })
  // The popup-asks pass (server.mjs): Units reports no asking and its step is done. Mutant: the call left out.
  await until(async () => (await head('Q1', 'State')) === 'withdrawn', 'the popup ask withdrawn by the board')
  // The pause handed to the supervisor's cards (server.mjs `pause: state.pause`). Mutant: the line left out.
  let chip = null
  await until(async () => {
    chip = ((await state()).supervisor?.cards ?? []).find(card => card.step === 'B30')?.state?.text ?? null
    return chip !== null
  }, 'the supervisor card of B30')
  assert.equal(chip, 'new · waits for Resume all')
})

test('on a running board: a leftover chat whose need names a step that ended after it was active is archived (state and end time handed to replacedChats)', { timeout: 240_000 }, async t => {
  const done = lines({ Id: 'B11', Kind: 'step', Title: 'Task B11', State: 'done', Owner: 'Units', Activity: 'Art', Since: stamp(NOW - 20 * MIN) }, [`- ${stamp(NOW - 20 * MIN)} Units: in progress → done`])
  const leftover = appChat => appChat('Units', 'units-old', { sessionId: 'local_UnitsOld', createdAt: 1, lastActivityAt: NOW - 90 * MIN, postTurnSummary: { status_category: 'blocked', status_detail: 'waits', needs_action: 'answer B11: http://127.0.0.1:4310/#details=B11' } })
  const live = appChat => appChat('Units', 'units-id', { createdAt: NOW - 60 * MIN })
  const { call } = await boardWith(t, { files: { B11: done }, app: { 'local_UnitsOld.json': leftover, 'local_Units.json': live } })
  // The live Units checked in (it runs and has reported); the main chat's mod can archive (0.31.0, can restart).
  assert.equal((await call('report', { chat: 'Units', session: 'units-id', report: { state: 'idle', since: Date.now() - 2 * MIN, seq: 1, run: 1 } })).status, 200)
  let jobs = []
  await until(async () => {
    const reply = await call('hands', { chat: 'Lead', session: 'lead-id', mod: '0.31.0', can: ['restart'] })
    jobs = reply.body.jobs ?? reply.body.result?.jobs ?? []
    return jobs.some(job => job.archive === true)
  }, 'the job that archives the leftover')
  assert.equal(jobs.find(job => job.archive === true).to, 'local_UnitsOld')
})

const popupOf = (id, owner, of) => lines({ Id: id, Kind: 'ask', Title: POPUP, State: 'open', Owner: owner, Activity: 'Art', Since: stamp(NOW - 25 * MIN), Filed: NOW - 25 * MIN, Asks: 'do', Blocking: 'no', Of: of, Via: 'form', Route: 'person' }, [`- ${stamp(NOW - 25 * MIN)} ${owner}: asked (do, with the app's question form)`]).replace('\n\n## History', `\n\n## Text\n${POPUP} Open its chat and look.\n\n## History`)

test('on a running board: a popup ask stays while its chat, a worker or the Advisor, still reports asking on a done step; one of a chat that does not ask goes', { timeout: 240_000 }, async t => {
  const done = lines({ Id: 'B11', Kind: 'step', Title: 'Task B11', State: 'done', Owner: 'Units', Activity: 'Art', Since: stamp(NOW - 30 * MIN) }, [`- ${stamp(NOW - 30 * MIN)} Units: in progress → done`])
  const { call, head, state, addFile } = await boardWith(t, { advisor: true, files: { B11: done } })
  for (const [chat, session] of [['Units', 'units-id'], ['Advisor', 'advisor-id']]) {
    assert.equal((await call('report', { chat, session, report: { state: 'asking', since: Date.now() - MIN, seq: 1, run: 1 } })).status, 200)
  }
  // The chats' reports are in before the asks are filed (the pass runs at every refresh).
  await until(async () => (await state()).chats.find(chat => chat.name === 'Units')?.state === 'waiting', 'Units reads as asking')
  for (const [id, owner] of [['Q1', 'Units'], ['Q2', 'Advisor'], ['Q3', 'Lead']]) await addFile(id, popupOf(id, owner, 'B11'))
  // The control: the main chat does not ask, so its popup of the done step goes (the pass has run).
  await until(async () => (await head('Q3', 'State')) === 'withdrawn', 'the popup ask of the chat that does not ask withdrawn')
  // The asking worker's (mutant: the asking list not sent) and the asking Advisor's (mutant: side chats left out) stay.
  assert.equal(await head('Q1', 'State'), 'open')
  assert.equal(await head('Q2', 'State'), 'open')
})
