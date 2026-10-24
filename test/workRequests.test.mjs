// B412: a work call is recorded once, even when its answer is slow or cut off. The Workers mod sends each call with a
// request id; the board keeps the answer by chat and id (in memory and a small file) and gives a repeat the same answer,
// also after a restart; a repeat while the first still runs waits for it. The store is read once per call.
// Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import * as nodeFs from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { isReadAction, workApi } from '../src/work/api.mjs'
import { isRequestId, requestKeeper } from '../src/work/requests.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ID = 'cli-digger-1-abc123'

async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'b412-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('slow, then done: a repeat while the first call still runs waits for it, and the call is made once', async () => {
  const keeper = requestKeeper()
  let runs = 0
  let finish
  const run = () => {
    runs += 1
    return new Promise(resolve => {
      finish = () => resolve({ ok: true, result: { id: 'Q7', text: 'Q7: asked.' } })
    })
  }
  const first = keeper.answer('Digger', ID, run)
  const again = keeper.answer('Digger', ID, run)
  await new Promise(resolve => setImmediate(resolve))
  finish()
  assert.deepEqual(await first, { ok: true, result: { id: 'Q7', text: 'Q7: asked.' } })
  assert.deepEqual(await again, await first)
  // Asked a third time, once it is done: the kept answer, not a second ask.
  assert.deepEqual(await keeper.answer('Digger', ID, run), await first)
  assert.equal(runs, 1)
})

test('a repeat after a restart gets the first answer from the file', async t => {
  const file = join(await folder(t), 'data', 'work-requests.json')
  const before = requestKeeper({ file, clock: () => 1000 })
  await before.answer('Digger', ID, async () => ({ ok: true, result: { id: 'B5', text: 'B5 is reported.' } }))
  await before.saved()
  const after = requestKeeper({ file, clock: () => 2000 })
  const again = await after.answer('Digger', ID, async () => assert.fail('made a second time'))
  assert.deepEqual(again, { ok: true, result: { id: 'B5', text: 'B5 is reported.' } })
  // Another chat's same id is its own call.
  assert.equal((await after.answer('Pruner', ID, async () => ({ ok: true, result: { text: 'its own' } }))).result.text, 'its own')
})

test('kept: answers and refusals; not kept: a store that could not be reached, a call without an id', async () => {
  const keeper = requestKeeper()
  let runs = 0
  const refused = async () => {
    runs += 1
    return { ok: false, status: 409, why: 'B5 is done already.' }
  }
  await keeper.answer('Digger', 'request-409-x', refused)
  await keeper.answer('Digger', 'request-409-x', refused)
  assert.equal(runs, 1, 'a refusal is the answer: the same refusal again')
  const down = async () => {
    runs += 1
    return { ok: false, status: 503, why: 'The work store cannot be read.' }
  }
  await keeper.answer('Digger', 'request-503-x', down)
  await keeper.answer('Digger', 'request-503-x', down)
  assert.equal(runs, 3, 'the store was not reached: a repeat tries again')
  const later = async () => {
    runs += 1
    return { ok: false, status: 429, why: 'Come back later.' }
  }
  await keeper.answer('Digger', 'request-429-x', later)
  await keeper.answer('Digger', 'request-429-x', later)
  assert.equal(runs, 5, 'come back later: a repeat tries again')
  runs = 3
  // An older mod sends no id: every call is made.
  await keeper.answer('Digger', undefined, refused)
  await keeper.answer('Digger', undefined, refused)
  assert.equal(runs, 5)
  assert.equal(isRequestId('short'), false)
  assert.equal(isRequestId('ok-id-<script>'), false)
  assert.equal(isRequestId(ID), true)
})

test('old answers go: after a day, or beyond the most kept', async () => {
  let now = 0
  const keeper = requestKeeper({ clock: () => now, most: 2 })
  let runs = 0
  const run = async () => ({ ok: true, result: { n: ++runs } })
  await keeper.answer('Digger', 'request-one-x', run)
  await keeper.answer('Digger', 'request-two-x', run)
  await keeper.answer('Digger', 'request-three', run)
  assert.equal((await keeper.answer('Digger', 'request-one-x', run)).result.n, 4, 'the oldest went beyond two')
  now = 25 * 60 * 60 * 1000
  await keeper.answer('Digger', 'request-four-x', run)
  assert.equal((await keeper.answer('Digger', 'request-three', run)).result.n, 6, 'a day old: gone')
})

test('known: the kept answer or the one still being made, without making it', async () => {
  const keeper = requestKeeper()
  assert.equal(await keeper.known('units', ID), undefined)
  let finish
  const first = keeper.answer('units', ID, () => new Promise(resolve => {
    finish = () => resolve({ ok: true, result: { text: 'made' } })
  }))
  await new Promise(resolve => setImmediate(resolve))
  const meanwhile = keeper.known('units', ID)
  finish()
  assert.deepEqual(await meanwhile, { ok: true, result: { text: 'made' } })
  await first
  assert.deepEqual(await keeper.known('units', ID), { ok: true, result: { text: 'made' } })
  assert.equal(await keeper.known('units', 'no'), undefined)
})

test('a torn file keeps nothing and breaks nothing', async t => {
  const file = join(await folder(t), 'work-requests.json')
  await writeFile(file, '{"answers": [', 'utf8')
  const keeper = requestKeeper({ file })
  assert.deepEqual(await keeper.answer('Digger', ID, async () => ({ ok: true, result: { text: 'made' } })), { ok: true, result: { text: 'made' } })
  await keeper.saved()
  assert.match(await readFile(file, 'utf8'), /"made"/)
})

test('the store is read once per work call; the reads are not kept by request', async t => {
  const dir = await folder(t)
  await writeFile(join(dir, 'activities.json'), JSON.stringify({ preamble: [], activities: [] }), 'utf8')
  let reads = 0
  const fs = { ...nodeFs, readdir: async (...args) => { reads += 1; return nodeFs.readdir(...args) } }
  const done = await workApi({ action: 'list', chat: 'Lead' }, { dir, fs, now: 1, roleOf: () => 'main', overlapsOfStore: true })
  assert.equal(done.ok, true, done.why)
  assert.equal(reads, 1)
  // The server no longer reads the store itself for a call: the overlaps of Touches come from the call's own reading.
  const server = await readFile(join(HERE, '..', 'server.mjs'), 'utf8')
  const ctx = server.slice(server.indexOf('const workCtx = async'), server.indexOf('const askResultCheck'))
  assert.ok(ctx.includes('overlapsOfStore: true'))
  assert.ok(!ctx.includes('readStore('))
  assert.ok(isReadAction('next') && isReadAction('pause-state') && !isReadAction('report'))
  // The bridge keeps changes by their request id, and reads go straight through.
  const bridge = server.slice(server.indexOf('    bridgeWork: async body => {'), server.indexOf('    take: async body => {'))
  assert.ok(bridge.includes('if (isReadAction(asked.action)) return bridgeWorkOnce(asked, checked)'))
  assert.ok(bridge.includes('requests.answer(session, request, () => bridgeWorkOnce(asked, checked))'))
  // A repeat finds its kept answer before the chat is looked up: right after a restart the board may not show it yet.
  assert.ok(bridge.indexOf('requests.known(session, request)') < bridge.indexOf('checkFresh(body)'))
})
