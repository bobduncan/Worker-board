// B221: the person closes or deletes a backlog step from the board's Backlog tab. Close ticks it and keeps it as
// history; Delete takes it out; both only on the board that delivers, only from its own page. B301: both change the
// work store through its API, and backlog.md follows as its view. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createBoard } from '../server.mjs'
import { editStep } from '../src/tick.mjs'
import { valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const BACKLOG = [
  '# Backlog\r\n',
  '\r\n',
  '## Zebracorns #focus\r\n',
  '- [ ] B11 Teach the zebracorn to sing (for Units; now; about 1 h)\r\n',
  '  Requirements:\r\n',
  '  - a song at dawn\r\n',
  '- [x] B12 Feed the quokkaberry\r\n',
  '- [ ] B13 Paint the narwhal bridge\r\n',
].join('')

/** A project folder with the backlog as a work store and its view; `run(body)` is the board's edit of a step. */
async function project() {
  const folder = await mkdtemp(join(tmpdir(), 'board-edit-'))
  const file = join(folder, 'backlog.md')
  const dir = join(folder, 'work')
  await writeFile(file, BACKLOG)
  await writeStore(dir, migrateBacklog(BACKLOG, { now: 0 }), undefined, { now: 0 })
  const work = { dir, viewFile: file }
  return {
    folder, file, work,
    run: (body, now = 0) => editStep(body, { now, work }),
    stateOf: async id => { const item = (await readStore(dir)).items.get(id); return item === undefined ? null : valueOf(item, 'State') },
    view: () => readFile(file, 'utf8'),
  }
}

test('close ticks the step in the store and writes who closed it, when, and why, under it in the view', async () => {
  const board = await project()
  try {
    const now = new Date(2026, 9, 14, 13, 5).getTime()
    const done = await board.run({ action: 'close', step: 'B11', reason: 'not  needed\nany more' }, now)
    assert.deepEqual(done, { ok: true, result: { step: 'B11', action: 'close' } })
    assert.equal(await board.stateOf('B11'), 'done')
    const after = await board.view()
    assert.match(after, /^- \[x\] B11 Teach the zebracorn to sing \(for Units; now; about 1 h\)\n {2}Requirements:\n {2}- a song at dawn\n {2}Closed by you on the worker board on 2026-10-14 at 13:05: not needed any more$/m)
    // Closed already: said so, nothing written.
    assert.deepEqual(await board.run({ action: 'close', step: 'B11' }, now), { ok: false, status: 409, why: 'B11 is ticked already.' })
    assert.equal(await board.view(), after)
  } finally {
    await rm(board.folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('delete through the board takes the item out of the store and the view; a step that is gone is said to be gone', async () => {
  const board = await project()
  try {
    assert.deepEqual(await board.run({ action: 'delete', step: 'B13' }), { ok: true, result: { step: 'B13', action: 'delete' } })
    assert.equal(await board.stateOf('B13'), null)
    assert.equal((await board.view()).includes('B13'), false)
    assert.equal((await board.run({ action: 'delete', step: 'B13' })).status, 404)
  } finally {
    await rm(board.folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('only the board that writes a store writes, and only a close or a delete of a step named by its number', async () => {
  const board = await project()
  try {
    assert.equal((await editStep({ action: 'delete', step: 'B13' }, { now: 0, work: null })).status, 409)
    assert.equal((await board.run({ action: 'rename', step: 'B13' })).status, 400)
    assert.equal((await board.run({ action: 'delete', step: 'B13\n- [ ] B99' })).status, 400)
    assert.equal(await board.view(), BACKLOG)
    assert.equal(await board.stateOf('B13'), 'new')
  } finally {
    await rm(board.folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the route takes only the board\'s own page: its token, its origin and JSON', async t => {
  const TOKEN = 'a'.repeat(64)
  const asked = []
  const server = createBoard({
    token: TOKEN,
    getState: async () => ({}),
    say: async () => ({ ok: false, status: 400, why: 'No.' }),
    backlog: async body => { asked.push(body); return { ok: true, result: { step: body.step, action: body.action } } },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const good = { 'X-Board-Token': TOKEN, Origin: origin, 'Content-Type': 'application/json' }
  const post = headers => fetch(`${origin}/api/backlog`, { method: 'POST', headers, body: JSON.stringify({ action: 'close', step: 'B11' }) })
  assert.equal((await post({ ...good, 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  assert.equal((await post({ ...good, Origin: 'http://evil.example' })).status, 403)
  assert.equal((await post({ ...good, 'Content-Type': 'text/plain' })).status, 415)
  assert.equal(asked.length, 0)
  const answer = await post(good)
  assert.equal(answer.status, 200)
  assert.deepEqual(await answer.json(), { step: 'B11', action: 'close' })
})

test('the page says before either when a worker is on the step or it is queued, and names the step', async () => {
  const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// stepedit:start'), script.indexOf('// stepedit:end'))}\nObject.assign(this, { stepEditQuestion })`, page)
  const step = { id: 'B11', title: 'Teach the zebracorn to sing', status: 'progress', worker: 'Units' }
  assert.match(page.stepEditQuestion(step, 'delete'), /^Units is working on this step now\. Delete B11 "Teach the zebracorn to sing"/)
  assert.match(page.stepEditQuestion({ ...step, status: 'queued' }, 'close'), /^This step is queued for Units\. Close B11/)
  assert.match(page.stepEditQuestion({ ...step, status: 'open', worker: null }, 'close'), /^Close B11 "Teach the zebracorn to sing"\? It is ticked/)
})
