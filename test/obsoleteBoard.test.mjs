// B775, end to end on a running board (a copy on a made-up project in a temporary folder): the person's click types one
// word to the partner and writes the check; the partner reads it and answers once; the person's close withdraws the ticked
// ask without a word to the chat that asked; one check at a time. Made-up names only.

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
import { MIN } from './partnerState.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']
const NOW = Date.now()
const MOD = '0.26.6'

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

/** A board on a made-up project; `advisor` names the partner chat ('' keeps the default, "Advisor"). */
async function garden(t, { advisor = '' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'board-obsolete-'))
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
  const work = join(project, '.claude', 'work')
  await writeStore(work, migrateBacklog('## Garden\n- [ ] B12 Plant the hedge (for Digger; about 1 h)\n- [ ] B13 Water the hedge (for Digger; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'obsolete', project, port, gamePort: 7341, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json'), ...(advisor === '' ? {} : { advisor }) }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const { key } = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  const base = `http://127.0.0.1:${port}`
  const page = await fetch(`${base}/`).then(reply => reply.text())
  const token = /[0-9a-f]{64}/.exec(page)?.[0]
  assert.ok(token, 'the served page carries the token')
  return {
    asChat: (chat, body) => fetch(`${base}/api/bridge/work`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': key, 'X-Workers-Mod': MOD }, body: JSON.stringify({ chat, session: `${chat.toLowerCase()}-id`, ...body }),
    }).then(async reply => ({ status: reply.status, body: reply.ok ? await reply.json() : await reply.text() })),
    asPerson: (path, body) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body),
    }).then(async reply => ({ status: reply.status, body: await reply.text() })),
    state: () => fetch(`${base}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json()),
    outbox: async () => (await readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(text => JSON.parse(text)),
    item: id => readFile(join(work, `${id}.md`), 'utf8'),
  }
}
const idOf = reply => reply.body.result?.id ?? reply.body.id

test('Find obsolete items on a running board: one word to the partner, its verdicts, the close of the ticked, none woken', { timeout: 300_000 }, async t => {
  const g = await garden(t)
  assert.equal((await g.asChat('Digger', { action: 'take', id: 'B12', branch: 'b12' })).status, 200)
  const first = await g.asChat('Digger', { action: 'ask', of: 'B12', kind: 'provide', text: 'Which spade?' })
  const second = await g.asChat('Digger', { action: 'ask', of: 'B12', kind: 'do', text: 'Restart the board' })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  const [q1, q2] = [idOf(first), idOf(second)]
  assert.equal((await g.state()).obsolete.state, 'none')
  assert.equal((await g.state()).obsolete.openCount, 2)

  // The click: one word to the partner, the check written; a second click while it waits is refused.
  const started = await g.asPerson('/api/work', { action: 'obsolete-check' })
  assert.equal(started.status, 200, started.body)
  const words = (await g.outbox()).filter(message => message.to === 'Advisor' && message.command === 'obsolete-check')
  assert.equal(words.length, 1)
  assert.match(words[0].text, new RegExp(`^obsolete check: 2 open items under Needs your attention\\nItems: ${q1}, ${q2}\\n`))
  assert.equal((await g.state()).obsolete.state, 'checking')
  assert.equal((await g.asPerson('/api/work', { action: 'obsolete-check' })).status, 409, 'one check at a time')
  assert.equal((await g.outbox()).filter(message => message.command === 'obsolete-check').length, 1, 'no second word')

  // The partner reads the items with their evidence, and answers once; a worker gives no verdict.
  const read = await g.asChat('Advisor', { action: 'obsolete' })
  assert.equal(read.status, 200, JSON.stringify(read.body))
  assert.match(read.body.text ?? read.body.result?.text, new RegExp(`${q1} \\(ask of B12\\): Which spade\\?\\n {2}· asked .* by Digger`))
  assert.equal((await g.asChat('Digger', { action: 'obsolete', points: [`obsolete: ${q1} · stale · none`] })).status, 403)
  assert.equal((await g.asChat('Advisor', { action: 'obsolete', points: ['obsolete: Q99 · stale · none'] })).status, 400, 'an id the check does not hold')
  const verdicts = await g.asChat('Advisor', { action: 'obsolete', points: [`obsolete: ${q1} · the hedge is planted · B12 is in progress`, `open: ${q2} · the board still needs it · no restart since`] })
  assert.equal(verdicts.status, 200, JSON.stringify(verdicts.body))
  const done = (await g.state()).obsolete
  assert.deepEqual(done.rows.map(row => [row.id, row.verdict, row.ticked]), [[q1, 'obsolete', true], [q2, 'open', false]])

  // The close: only the ticked id; the ask is withdrawn, and no word goes to the chat that asked.
  const before = (await g.outbox()).length
  assert.equal((await g.asChat('Advisor', { action: 'obsolete-close', ids: [q1] })).status, 403, 'a chat never closes')
  const closed = await g.asPerson('/api/work', { action: 'obsolete-close', ids: [q1] })
  assert.equal(closed.status, 200, closed.body)
  assert.match(await g.item(q1), /State: withdrawn/)
  assert.match(await g.item(q1), /person: withdrawn: obsolete: the hedge is planted/)
  assert.match(await g.item(q2), /State: open/)
  assert.deepEqual((await g.outbox()).slice(before).filter(message => message.to === 'Digger'), [], 'nobody is woken')
  const left = (await g.state()).obsolete
  assert.deepEqual(left.rows.map(row => row.id), [q2])
  assert.equal(left.last.closed, 1)
})

test('a board whose list holds no partner chat refuses the check, and writes none', { timeout: 300_000 }, async t => {
  const g = await garden(t, { advisor: 'Nobody' })
  await g.asChat('Digger', { action: 'take', id: 'B12', branch: 'b12' })
  assert.equal((await g.asChat('Digger', { action: 'ask', of: 'B12', kind: 'provide', text: 'Which spade?' })).status, 200)
  const view = (await g.state()).obsolete
  assert.equal(view.canCheck, false)
  assert.match(view.whyNot, /No partner chat/)
  const refused = await g.asPerson('/api/work', { action: 'obsolete-check' })
  assert.equal(refused.status, 409)
  assert.match(refused.body, /No partner chat/)
  assert.equal((await g.state()).obsolete.state, 'none')
})
