// Stability (2026-11-05, task 1): the person's actions log, data/actions.jsonl. One line for each change the person makes on the
// board (the work API's page actions, Restart, and the typed Check now, Start and Resume); none for a read, a list, a dry run,
// the board's own actions or a chat's. Made-up samples in a temporary folder.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createBoard } from '../../server.mjs'
import { keepPersonAction, workApi } from '../../src/work/api.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { share, writeStore } from '../../src/work/store.mjs'

// These tests edit store files by hand and read at once.
share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 10, 5, 21, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Board work', '- [ ] B1 Draw the strip (for Board; about 1 h)', '- [ ] B2 Keep the cards apart (for Support; about 30 min)', '- [ ] B3 A new idea (later; not handed out)', ''].join('\n')
const ROLES = { Lead: 'main', Board: 'worker', Support: 'worker', Partner: 'advisor' }

/** A store with two steps, and the actions log's path beside it (not yet there). */
async function fresh(t) {
  const dir = await mkdtemp(join(tmpdir(), 'actions-log-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  const actionsFile = join(dir, 'actions.jsonl')
  const base = { dir, now: NOW, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), freeChats: new Set(['Board', 'Support']), actionsFile }
  return {
    dir,
    person: (body, more = {}) => workApi(body, { ...base, ...more, as: 'person' }),
    server: body => workApi(body, { ...base, as: 'server' }),
    chat: (who, body) => workApi({ chat: who, ...body }, base),
    lines: async () => (await readFile(actionsFile, 'utf8').catch(() => '')).split('\n').filter(one => one !== '').map(one => JSON.parse(one)),
  }
}

test('the person\'s pause-all, resume-all and pin each append one line: when, by, via, action, id', async t => {
  const { person, lines } = await fresh(t)
  assert.equal((await person({ action: 'pause-all' })).ok, true)
  assert.deepEqual(await lines(), [{ at: NOW, by: 'person', via: 'work', action: 'pause-all', id: null }])
  assert.equal((await person({ action: 'resume-all' })).ok, true)
  const pinned = await person({ action: 'pin', id: 'B3', for: 'Support' })
  assert.equal(pinned.ok, true, pinned.why)
  assert.deepEqual((await lines()).map(one => [one.by, one.via, one.action, one.id]), [
    ['person', 'work', 'pause-all', null], ['person', 'work', 'resume-all', null], ['person', 'work', 'pin', 'B3'],
  ])
})

/** A step with an ask the board's autopilot answered from the advice: the person's Undo gives it back. */
async function withTakenAdvice(t) {
  const made = await fresh(t)
  const at = minutes => stamp(NOW - minutes * MIN)
  const text = (head, sections) => `${[...Object.entries(head).map(([key, value]) => `${key}: ${value}`), ...Object.entries(sections).flatMap(([name, body]) => ['', `## ${name}`, ...body])].join('\n')}\n`
  await writeFile(join(made.dir, 'B33.md'), text({ Id: 'B33', Kind: 'step', Activity: 'Garden', Title: 'Calm the lava', State: 'in progress', Owner: 'Board', Goal: 'G29', Since: at(90) }, { History: [`- ${at(90)} Lead: made`] }))
  await writeFile(join(made.dir, 'Q10.md'), text({ Id: 'Q10', Kind: 'ask', Title: 'for B33, which do you want?', State: 'open', Since: at(50), Filed: String(NOW - 50 * MIN), Blocking: 'no', Owner: 'Partner', Asks: 'decide', Advice: 'A', Via: 'chat', Of: 'B33' },
    { Text: ['for B33, which do you want? A: keep the lava as the rules say (about 1 h). B: try a darker lava (about 2 h). I advise A.'], History: [`- ${at(50)} Partner: asked (decide)`] }))
  await writeFile(join(made.dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: ['B33'] }] }, null, 1)}\n`)
  const swept = await made.server({ action: 'autopilot', on: true })
  assert.equal(swept.ok, true, swept.why)
  return made
}

test('the person\'s undo appends a line; its dry run (check) and a refused undo do not', async t => {
  const { person, lines } = await withTakenAdvice(t)
  assert.deepEqual(await lines(), [], 'the board\'s own sweep logs nothing')
  const dry = await person({ action: 'undo', id: 'Q10', check: true })
  assert.equal(dry.ok, true, dry.why)
  assert.deepEqual(await lines(), [])
  const undone = await person({ action: 'undo', id: 'Q10' })
  assert.equal(undone.ok, true, undone.why)
  assert.deepEqual(await lines(), [{ at: NOW, by: 'person', via: 'work', action: 'undo', id: 'Q10' }])
  const again = await person({ action: 'undo', id: 'Q10' })
  assert.equal(again.ok && again.result.changed !== false, false, 'a second undo changes nothing')
  assert.equal((await lines()).length, 1)
})

test('read and list append nothing, whoever asks; nor does the person marking an item read', async t => {
  const { person, chat, lines } = await fresh(t)
  assert.equal((await person({ action: 'list' })).ok, true)
  assert.equal((await person({ action: 'pause-state' })).ok, true)
  assert.equal((await chat('Board', { action: 'next' })).ok, true)
  assert.equal((await person({ action: 'read', id: 'B1' })).ok !== undefined, true)
  assert.deepEqual(await lines(), [])
})

test('an action by the server, by a chat or by nobody on the list appends nothing', async t => {
  const { server, chat, lines } = await fresh(t)
  assert.equal((await server({ action: 'unblock', id: 'B1' })).ok !== undefined, true)
  assert.equal((await chat('Board', { action: 'take', id: 'B1', minutes: 30 })).ok, true)
  assert.equal((await chat('Board', { action: 'pause-all' })).ok, false, 'a chat may not pause-all')
  assert.equal((await chat('Stranger', { action: 'step', id: 'B1' })).ok, false)
  assert.deepEqual(await lines(), [])
})

test('a refused person action, and a board with no actions file, append nothing', async t => {
  const { person, lines } = await fresh(t)
  assert.equal((await person({ action: 'pin', id: 'B99', for: 'Support' })).ok, false)
  assert.deepEqual(await lines(), [])
  const shown = await person({ action: 'pause-all' }, { actionsFile: undefined })
  assert.equal(shown.ok, true)
  assert.deepEqual(await lines(), [])
  const onlyShows = await person({ action: 'resume-all' }, { onlyShows: true })
  assert.equal(onlyShows.ok, true)
  assert.deepEqual(await lines(), [])
})

test('a log that cannot be written does not fail the person\'s action', async t => {
  const { person } = await fresh(t)
  const failed = await person({ action: 'pause-all' }, { actionsFile: join(tmpdir(), 'no-such-folder-for-actions', 'deeper', 'actions.jsonl') })
  assert.equal(failed.ok, true)
})

// The restart route and the typed words

async function board(t, ports) {
  const server = createBoard({ token: 't'.repeat(64), getState: async () => ({}), say: async () => ({ ok: true, message: { ok: true } }), pageVersion: async () => 'a1b2c3d', ...ports })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const self = `127.0.0.1:${server.address().port}`
  const post = (path, body) => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path, headers: { Host: self, 'X-Board-Token': 't'.repeat(64), Origin: `http://${self}`, 'Content-Type': 'application/json' } }, res => {
      res.resume()
      res.on('end', () => done(res.statusCode))
    })
    req.on('error', fail)
    req.end(JSON.stringify(body))
  })
  return { post }
}

test('the restart route appends one line when the restart is taken, none when it is refused', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'actions-route-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const file = join(dir, 'actions.jsonl')
  let canRestart = false
  const { post } = await board(t, {
    restart: async () => (canRestart ? { ok: true, result: { at: NOW } } : { ok: false, status: 409, why: 'No keeper.' }),
    record: entry => keepPersonAction(file, entry, NOW),
  })
  assert.equal(await post('/api/restart', {}), 409)
  assert.equal(await readFile(file, 'utf8').catch(() => ''), '')
  canRestart = true
  assert.equal(await post('/api/restart', {}), 200)
  assert.deepEqual((await readFile(file, 'utf8')).trim().split('\n').map(one => JSON.parse(one)), [{ at: NOW, by: 'person', via: 'restart', action: 'restart', id: null }])
})

test('the typed Check now, Start and Resume append a line; other words and refused words do not', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'actions-say-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const file = join(dir, 'actions.jsonl')
  let ok = true
  const { post } = await board(t, {
    say: async () => (ok ? { ok: true, message: {} } : { ok: false, status: 409, why: 'No.' }),
    record: entry => keepPersonAction(file, entry, NOW),
  })
  for (const command of ['sync', 'start', 'resume', 'stop']) assert.equal(await post('/api/say', { command }), 200)
  ok = false
  assert.equal(await post('/api/say', { command: 'start' }), 409)
  assert.deepEqual((await readFile(file, 'utf8')).trim().split('\n').map(one => JSON.parse(one).action), ['sync', 'start', 'resume'])
  assert.deepEqual(JSON.parse((await readFile(file, 'utf8')).split('\n')[0]), { at: NOW, by: 'person', via: 'say', action: 'sync', id: null })
})
