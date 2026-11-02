// B949 (the board development chat's live check, 2026-11-02): the board dropped its own "asset ready" words 0.6 s after it
// wrote them ("A17 is gone"), so Worker 1 never heard that A17 was ready: the stale-line sweep (deliver.mjs withdrawStale)
// judged every waiting work line by the work store, which holds no A-ids. An asset word is the asset's: judged by its
// request.json. Made-up chats and a made-up evening; the real case is outbox 7e26250b1dbb543f (A17 to Worker 1).

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { memoryStore } from '../src/store.mjs'
import { wordMatters } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { deliverWork } from '../src/work/deliver.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'
import { assetResends, workLineWhy } from '../src/work/workLines.mjs'
import { tempDir } from './tempDir.mjs'

const NOW = new Date(2026, 10, 2, 21, 33).getTime()
const READY_AT = NOW - 1000

const step = (id, state, owner) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: ${owner}\nSince: ${stamp(NOW - 3_600_000)}\n`)
const request = (id, more = {}) => ({ id, who: 'Digger', of: 'B7', kind: 'visual', provider: 'codex', mode: 'auto', text: 'a picture', pictures: [], follows: null, state: 'ready', why: '', files: ['1.png'], ask: null, pick: null, times: { asked: NOW - 600_000, started: NOW - 500_000, ended: READY_AT }, ...more })

/** A project folder: the work store (steps B7 held by Digger in progress, B8 done, B9 Weeder's) and the asset requests. */
async function world(t, requests, steps = { B7: ['in progress', 'Digger'], B8: ['done', 'Digger'], B9: ['in progress', 'Weeder'] }) {
  const root = await tempDir(t, 'asset-word-')
  const dir = join(root, 'work')
  await writeStore(dir, { items: new Map(Object.entries(steps).map(([id, [state, owner]]) => [id, step(id, state, owner)])), activities: [] }, undefined, { now: NOW - 7_200_000 })
  const assets = join(root, 'assets')
  for (const one of requests) {
    await mkdir(join(assets, one.id), { recursive: true })
    await writeFile(join(assets, one.id, 'request.json'), `${JSON.stringify(one, null, 2)}\n`)
  }
  return { dir, assets }
}

/** The board's word for a request that turned ready (server.mjs `tell`), as the outbox holds it. */
const readyWord = (id, to = 'Digger', more = {}) => ({ id: `w-${id}-${to}`, at: READY_AT, to, ask: null, step: null, title: null, version: null, verdict: null, command: 'work', about: id, text: `asset ${id} ready: C:\\garden\\.claude\\assets\\${id}`, kind: 'asset', state: 'waiting', ...more })

async function refresh(dir, outbox, now = NOW) {
  let n = 0
  return deliverWork({ state: { reconciled: {}, chatPrefix: 'Garden · ', chats: [] }, dir, outbox, apply: async () => ({ ok: true }), now, maxChars: 2000, newId: () => `n${++n}`, keep: { messageMs: 600_000, answerMs: 48 * 3_600_000 } })
}
const dropped = outbox => outbox.outbox().filter(one => one.state === 'dropped')

test('B949 the real case: a ready asset word 0.6 s old is not dropped as gone and is delivered', async t => {
  const { dir } = await world(t, [request('A17')])
  const outbox = memoryStore()
  await outbox.say(readyWord('A17'))
  const done = await refresh(dir, outbox, READY_AT + 600)
  assert.deepEqual(done.withdrawn, [])
  assert.equal(outbox.outbox().find(one => one.id === 'w-A17-Digger').state, 'waiting')
  assert.deepEqual((await outbox.take('Digger', READY_AT + 700, { messageMs: 600_000, answerMs: 1e9 })).map(one => one.text), ['asset A17 ready: C:\\garden\\.claude\\assets\\A17'])
})

test('B949 a request still being made, or whose step is not named, holds its word', async t => {
  const { dir } = await world(t, [request('A1', { state: 'running' }), request('A2', { of: null })])
  const outbox = memoryStore()
  await outbox.say(readyWord('A1'))
  await outbox.say(readyWord('A2'))
  await refresh(dir, outbox)
  assert.deepEqual(dropped(outbox), [])
})

test('B949 a request that is gone, or failed, drops its ready word with the reason', async t => {
  const { dir } = await world(t, [request('A3', { state: 'failed', why: 'no credit' })])
  const outbox = memoryStore()
  await outbox.say(readyWord('A3'))
  await outbox.say(readyWord('A4'))
  await refresh(dir, outbox)
  assert.deepEqual(dropped(outbox).map(one => [one.about, one.why]), [['A3', 'A3 failed'], ['A4', 'A4 is gone']])
})

test('B949 a failed word holds while its request failed, and goes when the request is gone', async t => {
  const { dir } = await world(t, [request('A5', { state: 'failed', why: 'no credit' })])
  const outbox = memoryStore()
  await outbox.say(readyWord('A5', 'Digger', { text: 'asset A5 failed: no credit' }))
  await outbox.say(readyWord('A6', 'Digger', { text: 'asset A6 failed: no credit' }))
  await refresh(dir, outbox)
  assert.deepEqual(dropped(outbox).map(one => one.about), ['A6'])
})

test('B949 the word goes when its step is done, dropped or another chat\'s', async t => {
  const { dir } = await world(t, [request('A7', { of: 'B8' }), request('A8', { of: 'B9' }), request('A9')])
  const outbox = memoryStore()
  for (const id of ['A7', 'A8', 'A9']) await outbox.say(readyWord(id))
  await refresh(dir, outbox)
  assert.deepEqual(dropped(outbox).map(one => [one.about, one.why]), [['A7', 'B8 is done'], ['A8', "B9 is Weeder's now"]])
})

test('B949 words that are not asset words are still judged by the work store', async t => {
  const { dir } = await world(t, [])
  const outbox = memoryStore()
  await outbox.say(readyWord('B8', 'Digger', { kind: undefined, text: 'work: B8 is yours; run work next' }))
  await outbox.say(readyWord('B7', 'Digger', { kind: undefined, text: 'work: B7 is yours; run work next' }))
  await refresh(dir, outbox)
  assert.deepEqual(dropped(outbox).map(one => [one.about, one.why]), [['B8', 'B8 is done']])
})

test('B949 the health summary and rule 8 name no held asset word as gone; without the requests such a word holds', async t => {
  const { dir } = await world(t, [request('A17')])
  const word = readyWord('A17')
  const items = new Map([['B7', step('B7', 'in progress', 'Digger')]])
  assert.equal(workLineWhy(word, items, { prefix: 'Garden · ', now: NOW }), null)
  assert.equal(workLineWhy(word, items, { prefix: 'Garden · ', now: NOW, assets: new Map() }), 'A17 is gone')
  const mattersWith = assets => wordMatters(buildView({ state: {}, items, outbox: [word], keep: { messageMs: 600_000, answerMs: 1e9 }, assets, now: NOW }))(word)
  assert.equal(mattersWith(null), true)
  assert.equal(mattersWith(new Map([['A17', request('A17')]])), true)
  assert.equal(mattersWith(new Map()), false)
  assert.ok(dir)
})

test('B949 a ready word dropped as gone is written again once, while its step is still that chat\'s', async t => {
  const { dir } = await world(t, [request('A17'), request('A18', { of: 'B8' }), request('A19', { state: 'failed', why: 'x' })])
  const outbox = memoryStore()
  for (const id of ['A17', 'A18', 'A19']) {
    await outbox.say(readyWord(id))
    await outbox.update(`w-${id}-Digger`, { state: 'dropped', why: `${id} is gone`, closedAt: READY_AT + 600 })
  }
  const first = await refresh(dir, outbox)
  assert.deepEqual(first.sent.map(one => [one.to, one.about, one.kind, one.text]), [['Digger', 'A17', 'asset', `asset A17 ready: ${join(dir, '..', 'assets', 'A17')}`]])
  const second = await refresh(dir, outbox, NOW + 60_000)
  assert.deepEqual(second.sent, [])
  assert.equal(outbox.outbox().filter(one => one.about === 'A17' && one.state !== 'dropped').length, 1)
})

test('B949 no second word: one by hand later, or one in the outbox already, keeps the send away', () => {
  const items = new Map([['B7', step('B7', 'in progress', 'Digger')]])
  const assets = new Map([['A17', request('A17')]])
  const drop = readyWord('A17', 'Digger', { state: 'dropped', why: 'A17 is gone' })
  assert.equal(assetResends([drop], items, assets, { prefix: 'Garden · ' }).length, 1)
  const later = { ...readyWord('A17', 'Digger', { id: 'later', at: READY_AT + 5000, kind: 'answer' }), state: 'delivered' }
  assert.equal(assetResends([drop, later], items, assets, { prefix: 'Garden · ' }).length, 0)
  const other = { ...readyWord('A17', 'Weeder', { id: 'other', at: READY_AT + 5000 }), state: 'delivered' }
  assert.equal(assetResends([drop, other], items, assets, { prefix: 'Garden · ' }).length, 1)
  assert.equal(assetResends([drop], new Map([['B7', step('B7', 'review', 'Digger')]]), assets).length, 0)
  assert.equal(assetResends([drop], items, undefined).length, 0)
})
