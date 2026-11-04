// B934 (X93 on 2026-11-02, 22:07-22:11 on the live board): a work call waited up to 6.4 s at the workers' hand-overs, not
// for the event loop but for the board's flushes to disk of its own bookkeeping files (the loop lock's heartbeat 119 times
// in 4.7 min, the chats' reports 85 times; a flush of 0.7 to 6 s on the busy disk), which held node's file threads; and a
// call's answer waited for its own flush of work-requests.json (3.5 s). Now those files are written without the flush,
// and the answer goes out before its file is written. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { requestKeeper } from '../src/work/requests.mjs'

const ROOT = new URL('..', import.meta.url)

test('a work call\'s answer goes out before its file is written, and the file is written after it without a flush', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'b934-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'work-requests.json')
  let release = null
  const held = new Promise(done => { release = done })
  const steps = []
  // The disk of 22:10:24: the file's write hangs until released.
  const fs = {
    readFile, writeFile, rename, rm, mkdir: async () => {},
    open: async (path, flags) => {
      const handle = await open(path, flags)
      return {
        writeFile: async data => { steps.push('write'); await held; return handle.writeFile(data) },
        sync: () => { steps.push('sync'); return handle.sync() },
        close: () => handle.close(),
      }
    },
  }
  const requests = requestKeeper({ file, fs, clock: () => 1_000 })
  const answered = await Promise.race([
    requests.answer('cli-digger', 'cli-digger-1700000000000-1', async () => ({ ok: true, result: { text: 'B12: step 2.' } })),
    new Promise(done => setTimeout(() => done('waited for the file'), 2_000)),
  ])
  assert.deepEqual(answered, { ok: true, result: { text: 'B12: step 2.' } })
  // A repeat meanwhile gets the kept answer, from memory.
  assert.deepEqual(await requests.known('cli-digger', 'cli-digger-1700000000000-1'), { ok: true, result: { text: 'B12: step 2.' } })
  release()
  await requests.saved()
  assert.deepEqual(steps, ['write'])
  assert.equal(JSON.parse(await readFile(file, 'utf8')).answers[0].answer.result.text, 'B12: step 2.')
})

test('the board\'s bookkeeping files are written without the flush; the work store keeps it', async () => {
  const source = async path => readFile(new URL(path, ROOT), 'utf8')
  const server = await source('server.mjs')
  // The loop lock's heartbeat and the task times.
  assert.match(server, /await writeUnflushed\(LOOP_LOCK, text\)/)
  assert.match(server, /await writeUnflushed\(TASK_TIMES_FILE, /)
  // The board's heartbeat, the chats' reports, the wake record, the stall log, the chat logs' journal, the answers.
  assert.match(await source('src/store.mjs'), /alive: at => writeUnflushed\(files\.alive, /)
  assert.match(await source('src/reportsKept.mjs'), /export function reportsSaver\(\{[^}]*write = writeUnflushed,/)
  assert.match(await source('src/wake.mjs'), /export function wakesSaver\(\{[^}]*write = writeUnflushed,/)
  assert.match(await source('src/stalls.mjs'), /await writeUnflushed\(file, /)
  assert.match(await source('src/chatLogs.mjs'), /await writeUnflushed\(file, text\)/)
  assert.match(await source('src/work/requests.mjs'), /await writeUnflushed\(file, JSON\.stringify\(\{ answers \}\), fs\)/)
  // The work store's items are the truth: written with the flush.
  const store = await source('src/work/store.mjs')
  assert.ok(!store.includes('writeUnflushed') && !store.includes('flush: false'), 'the work store keeps the flush')
})
