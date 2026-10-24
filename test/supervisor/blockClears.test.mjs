// B542 (incidents X7 and X10, 2026-10-24): queued steps waited hours while their workers were free, still blocked by a
// step long done (B522 behind B509), and steps in progress still showed a wait (B506 for B503, B526 for B529). The board
// now sets a step free the moment its blocker is done, queued or already taken; clears what it waited for at its take;
// says of a blocker in review that it waits for its check, and after an hour with its worker free tells the main chat
// once; and the health summary dates a word of another day. Made-up items and chats only; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { REVIEW_WAIT_MS, findStuck } from '../../src/supervisor/rules/repair.mjs'
import { applySync } from '../../src/supervisor/loop.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 19, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(90)), ...more }, sections)
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, idle: { since: ago(80) }, ...more })
const LEAD = lane('Lead', { isMain: true, state: 'working' })
const base = more => ({ items: new Map(), lanes: [LEAD], partner: null, helper: null, prefix: '', now: NOW, outbox: [], limits: {}, pause: null, refused: [], ...more })
const of = (found, check) => found.filter(one => one.check === check)
const pending = { History: [`- ${stamp(ago(70))} server: check pending`] }

test('a blocker done or dropped is unblocked, queued and in progress; one in progress or in review with its check open holds', () => {
  const found = of(findStuck(base({
    items: items(
      step('B9', 'done'), step('B8', 'dropped'), step('B7', 'in progress', { Owner: 'Mason' }), step('B6', 'review', {}, pending),
      step('B1', 'queued', { Owner: 'Painter', 'Blocked by': 'B9' }),
      step('B2', 'in progress', { Owner: 'Mason', 'Blocked by': 'B9 and B8' }),
      step('B3', 'queued', { Owner: 'Painter', 'Blocked by': 'B7' }),
      step('B4', 'queued', { Owner: 'Painter', 'Blocked by': 'B6' }),
    ),
    lanes: [LEAD, lane('Painter', { state: 'working' }), lane('Mason', { state: 'working' })],
  })), 'blocked')
  assert.deepEqual(found.map(one => [one.key, one.fix.do, one.fix.id, one.fix.on]), [
    ['blocked B1 B9', 'unblock', 'B1', 'B9'],
    ['blocked B2 B9', 'unblock', 'B2', 'B9'],
    ['blocked B2 B8', 'unblock', 'B2', 'B8'],
  ])
  assert.equal(found[0].text, 'B1 waited on B9, which is done')
  assert.equal(found[2].text, 'B2 waited on B8, which is dropped')
})

test('a Waits for that names only steps done is cleared by the board; one naming a step still open is not', () => {
  const found = of(findStuck(base({
    items: items(
      step('B9', 'done'), step('B7', 'in progress', { Owner: 'Mason' }),
      step('B1', 'in progress', { Owner: 'Painter', 'Waits for': 'B9 has its picture' }),
      step('B2', 'queued', { Owner: 'Painter', 'Waits for': 'B9 and B7' }),
    ),
    lanes: [LEAD, lane('Painter', { state: 'working' }), lane('Mason', { state: 'working' })],
  })), 'blocked')
  assert.deepEqual(found.map(one => [one.key, one.fix.do, one.fix.on]), [['blocked B1 waits B9', 'unblock', 'B9']])
  assert.equal(found[0].text, 'B1 waited for B9, which is done')
})

/** A store in a folder: B1 done, B5 in review, B2 queued for Painter behind them, as the test sets. */
async function storeWith(t, heads) {
  const dir = await mkdtemp(join(tmpdir(), 'block-clears-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const backlog = '# Backlog\n\n## Work\n- [ ] B1 Draw the strip (for Painter; about 1 h)\n- [ ] B2 Keep the cards apart (for Painter; about 30 min)\n- [ ] B5 Sort the seeds (for Mason; about 30 min)\n'
  const work = migrateBacklog(backlog, { now: NOW })
  for (const [id, head] of Object.entries(heads)) for (const [key, value] of Object.entries(head)) {
    if (value === null) work.items.get(id).head.delete(key)
    else work.items.get(id).head.set(key, value)
  }
  await writeStore(dir, work, undefined, { now: NOW })
  const ctx = { dir, now: NOW + MIN, prefix: '', roleOf: chat => ({ Lead: 'main', Painter: 'worker', Mason: 'worker' })[chat] ?? null }
  const head = async (id, key) => (await readStore(dir)).items.get(id).head.get(key) ?? null
  const history = async id => (await readStore(dir)).items.get(id).sections.get('History').join('\n')
  return { ctx, head, history }
}

test('the board\'s unblock of a done step clears a Waits for that names only steps done, with a History line', async t => {
  const { ctx, head, history } = await storeWith(t, { B1: { State: 'done' }, B2: { State: 'in progress', Owner: 'Painter', 'Waits for': 'B1 has its picture' } })
  const freed = await workApi({ action: 'unblock', id: 'B2', on: 'B1', why: 'B2 waited for B1, which is done' }, { ...ctx, as: 'server' })
  assert.equal(freed.ok, true, freed.why)
  assert.equal(await head('B2', 'Waits for'), null)
  assert.match(await history('B2'), /server: no longer waits for: B1 has its picture \(the board's sync check: B2 waited for B1, which is done\)$/)
})

test('at its take a step no longer names a blocker done, with a History line; one in review still holds the worker\'s take', async t => {
  const { ctx, head, history } = await storeWith(t, {
    B1: { State: 'done' }, B5: { State: 'done' },
    B2: { State: 'queued', Owner: 'Painter', 'Blocked by': 'B1 and B5', 'Waits for': 'B1 and B5' },
  })
  const taken = await workApi({ chat: 'Painter', action: 'take', id: 'B2', branch: 'b2' }, ctx)
  assert.equal(taken.ok, true, taken.why)
  assert.deepEqual([await head('B2', 'State'), await head('B2', 'Blocked by'), await head('B2', 'Waits for')], ['in progress', null, null])
  assert.match(await history('B2'), /Painter: no longer blocked by B1, B5 at its take \(B1 is done, B5 is done\)/)
  assert.match(await history('B2'), /Painter: no longer waits for: B1 and B5 at its take \(B1 is done, B5 is done\)/)
  // The flow lets a worker take its step once what blocks it is resolved: a blocker in review still holds it.
  const { ctx: early } = await storeWith(t, { B5: { State: 'review' }, B2: { State: 'queued', Owner: 'Painter', 'Blocked by': 'B5' } })
  const held = await workApi({ chat: 'Painter', action: 'take', id: 'B2', branch: 'b2' }, early)
  assert.equal(held.ok, false)
  assert.match(held.why, /B5 is review/)
})

test('a step taken while its blocker is in review (the main chat\'s take) drops the wait, naming the blocker', async t => {
  const { ctx, head, history } = await storeWith(t, {
    B5: { State: 'review' },
    B2: { State: 'taken', Owner: 'Painter', 'Blocked by': 'B5' },
  })
  const started = await workApi({ chat: 'Painter', action: 'take', id: 'B2', branch: 'b2' }, ctx)
  assert.equal(started.ok, true, started.why)
  assert.equal(await head('B2', 'Blocked by'), null)
  assert.match(await history('B2'), /Painter: no longer blocked by B5 at its take \(B5 is review\)/)
})

test('a step queued an hour with its owner free behind one in review: the main chat hears it once per pair; not before, not while working, not behind one in progress', async () => {
  const world = (more = {}) => base({
    items: items(
      step('B6', 'review', {}, pending), step('B7', 'in progress', { Owner: 'Mason' }),
      step('B1', 'queued', { Owner: 'Painter', 'Blocked by': 'B6', Since: stamp(NOW - REVIEW_WAIT_MS - MIN) }),
      step('B3', 'queued', { Owner: 'Digger', 'Blocked by': 'B7', Since: stamp(ago(120)) }),
    ),
    lanes: [LEAD, lane('Painter'), lane('Mason', { state: 'working' }), lane('Digger')],
    ...more,
  })
  const found = of(findStuck(world()), 'review-wait')
  assert.deepEqual(found.map(one => [one.key, one.fix.do]), [['review-wait B1 B6', 'send']])
  assert.match(found[0].text, /^B1 waits for the check of B6: queued 61 min while Painter is free$/)
  assert.match(found[0].fix.text, /B6 is in review: see that it is checked, or give Painter other work$/)
  // Told once: the second run's note is empty for the same pair.
  const ports = { unblock: async () => ({ ok: true }), requeue: async () => ({ ok: true }), wake: async () => null, clean: async () => ({ ok: true }) }
  const first = await applySync(found, ports, new Set())
  assert.equal(first.note.length, 1)
  assert.deepEqual((await applySync(found, ports, new Set(first.keys))).note, [])
  // Free for less than an hour (it was working until 20 minutes ago), or working: nothing.
  assert.equal(of(findStuck(world({ lanes: [LEAD, lane('Painter', { idle: { since: ago(20) } })] })), 'review-wait').length, 0)
  assert.equal(of(findStuck(world({ lanes: [LEAD, lane('Painter', { state: 'working' })] })), 'review-wait').length, 0)
  // Its blocker's check passed: `blocked` unblocks it, and nothing is said.
  const passed = world({ items: items(step('B6', 'review', {}, { History: [`- ${stamp(ago(70))} server: check passed: merged`] }), step('B1', 'queued', { Owner: 'Painter', 'Blocked by': 'B6', Since: stamp(ago(120)) })) })
  assert.equal(of(findStuck(passed), 'review-wait').length, 0)
  assert.equal(of(findStuck(passed), 'blocked')[0].fix.do, 'unblock')
})

test('the work tool\'s line of a step blocked by one in review says it waits for its check', async t => {
  const { ctx } = await storeWith(t, { B5: { State: 'review' }, B2: { State: 'queued', Owner: 'Painter', 'Blocked by': 'B5' } })
  const listed = await workApi({ chat: 'Painter', action: 'next' }, ctx)
  assert.equal(listed.ok, true, listed.why)
  assert.match(listed.result.text, /- B2 queued \(waits for the check of B5\): Keep the cards apart/)
})

test('the health summary: a step shows only what still holds it, and a word of another day carries its date', () => {
  const lanes = [{ name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true, queue: [] }, { name: 'Painter', isMain: false, isLeftover: false, state: 'free', isRunning: true, queue: [] }]
  const view = buildView({
    state: { chats: lanes, chatPrefix: '' },
    items: items(
      step('B9', 'done'), step('B6', 'review'),
      step('B1', 'in progress', { Owner: 'Painter', 'Blocked by': 'B9', 'Waits for': 'B9' }),
      step('B2', 'queued', { Owner: 'Painter', 'Blocked by': 'B9 and B6' }),
    ),
    outbox: [
      { id: 'r1', at: new Date(2026, 9, 15, 18, 13).getTime(), to: 'Partner', command: 'round', state: 'waiting' },
      { id: 'r2', at: ago(20), to: 'Partner', command: 'round', state: 'waiting' },
    ],
    now: NOW,
  })
  const text = healthSummary(view, NOW)
  const line = id => text.split('\n').find(one => one.includes(` ${id} `)) ?? ''
  assert.doesNotMatch(line('B1'), /waits for/)
  assert.match(line('B2'), /\(waits for the check of B6\)/)
  assert.match(text, /- ! 2026-10-15 18:13 round to Partner: waiting for 9 d/)
  assert.match(text, /- ! 18:40 round to Partner: waiting for 20 min/)
})
