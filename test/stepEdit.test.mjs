// B221: the person closes or deletes a backlog step from the board's Backlog tab. Close ticks it and keeps it in the
// file as history; Delete takes it and its lines out; both only on the board that delivers, only from its own page.
// Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createBoard } from '../server.mjs'
import { deleteStep, editStep } from '../src/tick.mjs'

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

/** A backlog file in memory, with the calls `editStep` makes. */
function memoryFile(text) {
  const files = new Map([['backlog.md', Buffer.from(text, 'latin1')]])
  return {
    files,
    fs: {
      readFile: async name => {
        if (!files.has(name)) throw new Error('gone')
        return files.get(name)
      },
      writeFile: async (name, bytes) => { files.set(name, Buffer.from(bytes)) },
      rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from) },
      rm: async name => { files.delete(name) },
    },
  }
}

test('delete takes the step and the lines under it out, and leaves every other byte as it was', () => {
  const done = deleteStep(BACKLOG, 'B11')
  assert.equal(done.ok, true)
  assert.equal(done.text, BACKLOG.replace('- [ ] B11 Teach the zebracorn to sing (for Units; now; about 1 h)\r\n  Requirements:\r\n  - a song at dawn\r\n', ''))
  // a finished step may be deleted too; the last step of the file as well
  assert.equal(deleteStep(BACKLOG, 'B12').text.includes('B12'), false)
  assert.equal(deleteStep(BACKLOG, 'B13').text.endsWith('- [x] B12 Feed the quokkaberry\r\n'), true)
  // a number that is not there, or twice, changes nothing
  assert.deepEqual(deleteStep(BACKLOG, 'B99'), { ok: false, why: 'gone' })
  assert.deepEqual(deleteStep(`${BACKLOG}- [ ] B13 Again\r\n`, 'B13'), { ok: false, why: 'twice' })
  // B1 is not B11
  assert.deepEqual(deleteStep(BACKLOG, 'B1'), { ok: false, why: 'gone' })
})

test('close ticks the step and writes who closed it, when, and why, under its own lines', async () => {
  const { files, fs } = memoryFile(BACKLOG)
  const now = new Date(2026, 9, 14, 13, 5).getTime()
  const done = await editStep({ action: 'close', step: 'B11', reason: 'not  needed\nany more' }, { canWrite: true, file: 'backlog.md', now, fs })
  assert.deepEqual(done, { ok: true, result: { step: 'B11', action: 'close' } })
  const after = files.get('backlog.md').toString('latin1')
  assert.equal(after, BACKLOG.replace('- [ ] B11', '- [x] B11').replace('  - a song at dawn\r\n', '  - a song at dawn\r\n  Closed by you on the worker board on 2026-10-14 at 13:05: not needed any more\r\n'))
  // closed already: said so, nothing written
  assert.deepEqual(await editStep({ action: 'close', step: 'B11' }, { canWrite: true, file: 'backlog.md', now, fs }), { ok: false, status: 409, why: 'That step is closed already.' })
  assert.equal(files.get('backlog.md').toString('latin1'), after)
})

test('delete through the board writes the file; a step that is gone is said to be gone', async () => {
  const { files, fs } = memoryFile(BACKLOG)
  assert.deepEqual(await editStep({ action: 'delete', step: 'B13' }, { canWrite: true, file: 'backlog.md', now: 0, fs }), { ok: true, result: { step: 'B13', action: 'delete' } })
  assert.equal(files.get('backlog.md').toString('latin1').includes('B13'), false)
  assert.equal((await editStep({ action: 'delete', step: 'B13' }, { canWrite: true, file: 'backlog.md', now: 0, fs })).status, 404)
})

test('only the board that delivers writes, and only a close or a delete of a step named by its number', async () => {
  const { files, fs } = memoryFile(BACKLOG)
  assert.equal((await editStep({ action: 'delete', step: 'B13' }, { canWrite: false, file: 'backlog.md', now: 0, fs })).status, 409)
  assert.equal((await editStep({ action: 'rename', step: 'B13' }, { canWrite: true, file: 'backlog.md', now: 0, fs })).status, 400)
  assert.equal((await editStep({ action: 'delete', step: 'B13\n- [ ] B99' }, { canWrite: true, file: 'backlog.md', now: 0, fs })).status, 400)
  assert.equal(files.get('backlog.md').toString('latin1'), BACKLOG)
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
