// refine-stop-tone (chat 1, 2026-11-11): no chat could record B1030's deliberate hold, so its Advisor card stayed red "stopped ·
// Send again". `work block id=<step> on="<words>"` on a step nobody holds yet (new, refined or queued with no owner) writes
// `Waits for: <words>`, by the main chat, the partner or the person; `work unblock id=<step>` clears it. A worker may not; a rethink
// hold (the person's Stop and rethink) keeps its own words, and the main chat's or the partner's clear never lifts it.
// Made-up samples, with B1030's real hold words.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { waitWords } from '../../src/work/guards.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { readStore, share, writeStore } from '../../src/work/store.mjs'

share.ms = 0

const NOW = new Date(2026, 10, 11, 12, 0).getTime()
const HOLD = "chat 1's decision after the 3-day stability count (Fri 11-13)"
const RETHINK = 'the rethink of G60 "side stairs" (2026-11-07 10:55)'
const text = head => `${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n`
const step = (id, state, more = {}) => text({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: '2026-11-04 22:10', ...more })
const ROLES = { Main: 'main', Kites: 'worker', Advisor: 'advisor' }

async function fresh(texts) {
  const dir = await mkdtemp(join(tmpdir(), 'work-hold-words-'))
  await writeStore(dir, { items: new Map(), activities: [{ name: 'Crew work', steps: [] }] }, undefined, { now: NOW })
  for (const one of texts) await writeFile(join(dir, `${valueOf(parseItem(one), 'Id')}.md`), one)
  const ctx = { dir, now: NOW, prefix: 'Crew - ', roleOf: chat => ROLES[chat] ?? null, advisor: 'Advisor', freeChats: new Set(['Kites']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, main: as('Main'), kites: as('Kites'), partner: as('Advisor'), person: body => workApi(body, { ...ctx, as: 'person' }) }
}
const itemOf = async (dir, id) => (await readStore(dir)).items.get(id)
const done = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

test('B1030 (the live case): Main writes the hold in words on a new step; the hand-out reads it as a hold; Main clears it', async () => {
  const { dir, main } = await fresh([step('B1030', 'new')])
  try {
    const held = await main({ action: 'block', id: 'B1030', on: HOLD, why: 'chat 1 decides after the count' })
    assert.equal(held.ok, true, held.why)
    const item = await itemOf(dir, 'B1030')
    assert.equal(valueOf(item, 'Waits for'), HOLD)
    assert.equal(waitWords(item), HOLD, 'the hand-out holds a step on these words')
    assert.match(item.sections.get('History').at(-1), /held: waits for chat 1's decision .* \(chat 1 decides after the count\)/)
    const again = await main({ action: 'block', id: 'B1030', on: HOLD })
    assert.equal(again.result.changed, false)
    const cleared = await main({ action: 'unblock', id: 'B1030' })
    assert.equal(cleared.ok, true, cleared.why)
    assert.equal(valueOf(await itemOf(dir, 'B1030'), 'Waits for'), null)
  } finally { await done(dir) }
})

test('the partner and the person write and clear it too, on new, refined and queued steps with no owner', async () => {
  const { dir, partner, person } = await fresh([step('B1', 'refined'), step('B2', 'queued'), step('B3', 'new')])
  try {
    for (const id of ['B1', 'B2']) {
      const held = await partner({ action: 'block', id, on: HOLD })
      assert.equal(held.ok, true, held.why)
      assert.equal(valueOf(await itemOf(dir, id), 'Waits for'), HOLD)
      assert.equal((await partner({ action: 'unblock', id })).ok, true)
      assert.equal(valueOf(await itemOf(dir, id), 'Waits for'), null)
    }
    assert.equal((await person({ action: 'block', id: 'B3', on: HOLD })).ok, true)
    assert.equal((await person({ action: 'unblock', id: 'B3' })).ok, true)
  } finally { await done(dir) }
})

test('a worker may not write it; the partner writes nothing else; ids and rethink words are refused; a held step keeps P1', async () => {
  const { dir, kites, partner, main } = await fresh([step('B1030', 'new'), step('B9', 'new'), step('B5', 'in progress', { Owner: 'Kites' }), step('B6', 'queued', { Owner: 'Kites' })])
  try {
    const worker = await kites({ action: 'block', id: 'B1030', on: HOLD })
    assert.equal(worker.status, 403)
    assert.equal(valueOf(await itemOf(dir, 'B1030'), 'Waits for'), null)
    assert.equal((await partner({ action: 'block', id: 'B1030', on: 'B9' })).status, 403, 'the partner writes no Blocked by')
    assert.equal((await partner({ action: 'block', id: 'B5', on: HOLD })).status, 403, 'nor a hold on a step a worker holds')
    assert.equal((await main({ action: 'block', id: 'B1030', on: 'after B9 lands' })).status, 400)
    assert.equal((await main({ action: 'block', id: 'B1030', on: RETHINK })).status, 400)
    // A queued step a worker was given is held: Main's words go the old way (P1: only its holder waits on a chat).
    assert.equal((await main({ action: 'block', id: 'B6', on: HOLD })).ok, false)
    assert.equal(valueOf(await itemOf(dir, 'B6'), 'Waits for'), null)
  } finally { await done(dir) }
})

test('a rethink hold stays the person\'s: Main\'s hold goes beside it, and Main\'s or the partner\'s clear lifts only its own words', async () => {
  const { dir, main, partner, person } = await fresh([step('B7', 'new', { 'Waits for': RETHINK })])
  try {
    assert.equal((await main({ action: 'unblock', id: 'B7' })).status, 409, 'Main cannot lift a rethink hold')
    assert.equal((await partner({ action: 'unblock', id: 'B7' })).status, 409)
    assert.equal(valueOf(await itemOf(dir, 'B7'), 'Waits for'), RETHINK)
    assert.equal((await main({ action: 'block', id: 'B7', on: HOLD })).ok, true)
    assert.equal(valueOf(await itemOf(dir, 'B7'), 'Waits for'), `${HOLD}; ${RETHINK}`)
    assert.equal((await main({ action: 'unblock', id: 'B7' })).ok, true)
    assert.equal(valueOf(await itemOf(dir, 'B7'), 'Waits for'), RETHINK, 'the rethink hold stands')
    assert.equal((await person({ action: 'unblock', id: 'B7' })).ok, true, 'the person lifts it')
    assert.equal(valueOf(await itemOf(dir, 'B7'), 'Waits for'), null)
  } finally { await done(dir) }
})
