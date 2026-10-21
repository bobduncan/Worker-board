// B465: the board's own list of the ways work got stuck, each with its fix (src/work/sync.mjs). The person, 2026-10-21
// (I50): "i want a structural fix for preventing this it gets stuck". One test per check and per fix, on made-up items
// and chats; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

import { AGAIN_MS, CHECKS, NOT_TAKEN_MS, OWNER_GONE_MS, applySync, findStuck } from '../../src/work/sync.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 21, 2, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(60)), ...more }, sections)
const ask = (id, more = {}, sections = {}) => item({ Id: id, Kind: 'ask', Title: `Ask ${id}`, State: 'open', Since: stamp(ago(60)), ...more }, sections)
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, idle: { since: ago(30) }, ...more })
const LEAD = lane('Lead', { isMain: true, state: 'working' })
const base = more => ({ items: new Map(), lanes: [LEAD], partner: null, helper: null, prefix: '', now: NOW, outbox: [], limits: {}, pause: null, refused: [], ...more })
const of = (found, check) => found.filter(one => one.check === check)

test('the list names every check once, with its words', () => {
  assert.deepEqual(CHECKS.map(one => one.key), ['blocked', 'not-taken', 'owner-gone', 'refine-drop', 'limit-back', 'old-name', 'helper', 'partner-ask'])
  assert.ok(CHECKS.every(one => typeof one.words === 'string' && one.words.length > 0))
})

test('blocked: a step blocked by one in review is unblocked; one done holds nothing; one the store lacks, or a Waits for, is for Main', () => {
  const found = findStuck(base({
    items: items(
      step('B1', 'review'), step('B9', 'done'),
      step('B2', 'queued', { Owner: 'Painter', 'Blocked by': 'B1' }),
      step('B3', 'queued', { Owner: 'Painter', 'Blocked by': 'B9' }),
      step('B4', 'refined', { 'Blocked by': 'B77' }),
      step('B5', 'queued', { Owner: 'Painter', 'Waits for': 'B1 is checked' }),
      step('B6', 'done', { 'Blocked by': 'B1' }),
    ),
    lanes: [LEAD, lane('Painter', { state: 'working' })],
  }))
  const blocked = of(found, 'blocked')
  assert.deepEqual(blocked.map(one => [one.key, one.fix.do]), [['blocked B2 B1', 'unblock'], ['blocked B4 B77', 'main'], ['blocked B5 B1', 'main']])
  assert.deepEqual([blocked[0].fix.id, blocked[0].fix.on], ['B2', 'B1'])
  assert.match(blocked[0].text, /^B2 waited on B1, which is in review$/)
  assert.match(blocked[1].text, /B4 is blocked by B77, which the store does not hold/)
  assert.match(blocked[2].text, /B5 waits for B1 \(in review\)/)
})

test('not taken: a queued step its free owner was told of and did not take is woken again; once more is for Main', () => {
  const told = { id: 'm1', command: 'work', about: 'B2', to: 'Painter', at: ago(15), state: 'delivered' }
  const world = (more = {}) => base({
    items: items(step('B2', 'queued', { Owner: 'Painter', Since: stamp(ago(20)) })),
    lanes: [LEAD, lane('Painter', { idle: { since: ago(25) } })],
    outbox: [told],
    ...more,
  })
  const woke = of(findStuck(world()), 'not-taken')
  assert.equal(woke.length, 1)
  assert.equal(woke[0].fix.do, 'wake')
  assert.deepEqual([woke[0].fix.chat, woke[0].fix.id], ['Painter', 'B2'])
  assert.match(woke[0].fix.text, /^work: B2 is yours; run work next/)
  assert.match(woke[0].text, /Painter: its queued B2 waited \d+ min while it was free/)
  const key = woke[0].key
  // Woken a moment ago: it waits for that wake, and nothing goes again.
  const waiting = of(findStuck(world({ outbox: [told, { id: 'm2', command: 'work', about: 'B2', to: 'Painter', at: ago(4), state: 'delivered', syncKey: key }] })), 'not-taken')
  assert.equal(waiting[0].fix.do, 'woken')
  // Woken longer ago than AGAIN_MS and still queued: for Main.
  const late = of(findStuck(world({ outbox: [told, { id: 'm2', command: 'work', about: 'B2', to: 'Painter', at: NOW - AGAIN_MS - MIN, state: 'delivered', syncKey: key }] })), 'not-taken')
  assert.equal(late[0].fix.do, 'main')
  // Nothing while the owner works, the line went only a moment ago, it was never told, or the person pauses.
  assert.equal(of(findStuck(world({ lanes: [LEAD, lane('Painter', { state: 'working' })] })), 'not-taken').length, 0)
  assert.equal(of(findStuck(world({ outbox: [{ ...told, at: NOW - NOT_TAKEN_MS + MIN }] })), 'not-taken').length, 0)
  assert.equal(of(findStuck(world({ outbox: [] })), 'not-taken').length, 0)
  assert.equal(of(findStuck(world({ pause: { state: 'pausing', since: stamp(ago(5)) } })), 'not-taken').length, 0)
})

test('owner gone: a queued step whose chat left the list goes to a free worker; one in progress, or with none free, is for Main', () => {
  const world = (more = {}) => base({
    items: items(step('B3', 'queued', { Owner: 'Ghost', Since: stamp(NOW - OWNER_GONE_MS - MIN) })),
    lanes: [LEAD, lane('Painter'), lane('Mason', { state: 'working' })],
    ...more,
  })
  const moved = of(findStuck(world()), 'owner-gone')
  assert.deepEqual(moved.map(one => [one.fix.do, one.fix.id, one.fix.to]), [['requeue', 'B3', 'Painter']])
  assert.match(moved[0].text, /^B3 was queued for Ghost, no longer in the list$/)
  // A chat about to join: queued for it a moment ago.
  assert.equal(of(findStuck(world({ items: items(step('B3', 'queued', { Owner: 'Ghost', Since: stamp(ago(5)) })) })), 'owner-gone').length, 0)
  // In progress for a chat that left: its work may stand on a branch, so Main decides.
  assert.equal(of(findStuck(world({ items: items(step('B3', 'in progress', { Owner: 'Ghost', Since: stamp(ago(90)) })) })), 'owner-gone')[0].fix.do, 'main')
  // No free worker to give it to.
  assert.equal(of(findStuck(world({ lanes: [LEAD, lane('Mason', { state: 'working' })] })), 'owner-gone')[0].fix.do, 'main')
  // A list without workers (the app's list could not be read) moves nothing.
  assert.equal(of(findStuck(world({ lanes: [] })), 'owner-gone').length, 0)
  // The partner and its helper own steps too, and a leftover of the same name is no chat of the list.
  const kept = world({ items: items(step('B3', 'queued', { Owner: 'Partner', Since: stamp(ago(90)) })), partner: { name: 'Partner', state: 'free', isRunning: true } })
  assert.equal(of(findStuck(kept), 'owner-gone').length, 0)
  const leftover = world({ lanes: [LEAD, lane('Painter'), lane('Ghost', { isLeftover: true })] })
  assert.equal(of(findStuck(leftover), 'owner-gone')[0].fix.to, 'Painter')
})

test('refine drop: a yes to dropping a step in its refine is sent to Main, which drops it', () => {
  const world = (answer, state = 'refined') => base({
    items: items(
      step('B7', state, { Refined: 'open' }),
      ask('Q1', { Of: 'B7', State: 'answered', Via: 'refine', Title: 'Drop B7, since every part of it stands in another step?' }, { Answer: [answer] }),
    ),
  })
  const sent = of(findStuck(world('yes')), 'refine-drop')
  assert.deepEqual(sent.map(one => [one.key, one.fix.do]), [['refine-drop B7 Q1', 'send']])
  assert.match(sent[0].fix.text, /B7: the person answered yes to dropping it \(Q1\): drop it/)
  assert.equal(of(findStuck(world('no, keep it')), 'refine-drop').length, 0)
  assert.equal(of(findStuck(world('yes', 'dropped')), 'refine-drop').length, 0)
})

test('limit back: a worker paused for the limit whose time has passed is woken, never while a limit is full', () => {
  const held = lane('Painter', { state: 'suspended', suspended: { by: 'note', limit: 'fiveHour', since: ago(300), until: ago(10), isBack: true } })
  const world = (more = {}) => base({ lanes: [LEAD, held], items: items(step('B4', 'in progress', { Owner: 'Painter' })), ...more })
  const woke = of(findStuck(world()), 'limit-back')
  assert.deepEqual(woke.map(one => [one.fix.do, one.fix.chat, one.fix.id]), [['wake', 'Painter', 'B4']])
  assert.match(woke[0].fix.text, /the limit is back/)
  assert.match(woke[0].text, /^Painter: paused for the limit until \d\d:\d\d, the limit is back$/)
  assert.equal(of(findStuck(world({ limits: { fiveHour: { level: 'full' } } })), 'limit-back').length, 0)
  assert.equal(of(findStuck(world({ lanes: [LEAD, { ...held, suspended: { ...held.suspended, isBack: false } }] })), 'limit-back').length, 0)
})

test('old name: a chat refused under an old name is for Main to ask it to join under the name the board shows', () => {
  const world = at => base({ lanes: [LEAD, lane('Painter', { session: 's-2' })], refused: [{ name: 'Builder', session: 's-2', at }] })
  const sent = of(findStuck(world(ago(2))), 'old-name')
  assert.deepEqual(sent.map(one => [one.key, one.fix.do]), [['old-name Builder Painter', 'send']])
  assert.match(sent[0].fix.text, /Painter asks under its old name Builder: ask it to join as "Painter"/)
  assert.equal(of(findStuck(world(ago(30))), 'old-name').length, 0)
  // A refusal of a session the board does not show under another name is no rename.
  assert.equal(of(findStuck(base({ lanes: [LEAD], refused: [{ name: 'Builder', session: 's-9', at: ago(2) }] })), 'old-name').length, 0)
})

test('helper: not running while refines or result checks wait, it is woken; still not running later, its work goes to the partner', () => {
  const partner = { name: 'Partner', state: 'working', isRunning: true }
  const helper = { name: 'Second', state: 'off', isRunning: false }
  const world = (more = {}) => base({
    partner, helper,
    items: items(step('B8', 'new', { Refined: 'open' }), step('B9', 'review')),
    outbox: [
      { id: 'r1', command: 'refine', about: 'B8', to: 'Partner', at: ago(20), state: 'delivered' },
      { id: 'c1', command: 'result-check', about: 'B9', to: 'Partner', at: ago(20), state: 'delivered' },
    ],
    ...more,
  })
  const woke = of(findStuck(world()), 'helper')
  assert.deepEqual(woke.map(one => [one.fix.do, one.fix.chat]), [['wake', 'Second']])
  assert.match(woke[0].text, /^Second is not running: 2 refines and checks wait/)
  const key = woke[0].key
  const late = of(findStuck(world({ outbox: [...world().outbox, { id: 'w1', command: 'work', about: 'B8', to: 'Second', at: NOW - AGAIN_MS - MIN, state: 'delivered', syncKey: key }] })), 'helper')
  assert.equal(late[0].fix.do, 'hand')
  assert.equal(late[0].fix.chat, 'Partner')
  assert.match(late[0].fix.text, /Second is not running: do the waiting refines and result checks yourself/)
  // Running, or nothing waiting: nothing.
  assert.equal(of(findStuck(world({ helper: { ...helper, state: 'free', isRunning: true } })), 'helper').length, 0)
  assert.equal(of(findStuck(world({ items: items(step('B8', 'refined', { Refined: 'ready' }), step('B9', 'done')) })), 'helper').length, 0)
})

test('partner ask: an ask routed to the partner open ten minutes with no line about it lately wakes the partner', () => {
  const partner = { name: 'Partner', state: 'working', isRunning: true }
  const world = (more = {}) => base({ partner, items: items(ask('Q5', { Route: 'partner', Since: stamp(ago(15)) })), ...more })
  const woke = of(findStuck(world()), 'partner-ask')
  assert.deepEqual(woke.map(one => [one.fix.do, one.fix.chat, one.fix.id]), [['wake', 'Partner', 'Q5']])
  assert.equal(of(findStuck(world({ outbox: [{ id: 'p1', kind: 'partner-ask', about: 'Q5', to: 'Partner', at: ago(4), state: 'delivered' }] })), 'partner-ask').length, 0)
  assert.equal(of(findStuck(world({ items: items(ask('Q5', { Route: 'partner', Since: stamp(ago(5)) })) })), 'partner-ask').length, 0)
  assert.equal(of(findStuck(world({ pause: { state: 'pausing', since: stamp(ago(1)) } })), 'partner-ask').length, 0)
})

test('the fixes: each carried out through its port, with its row; what cannot be fixed goes to Main in one note, never twice', async () => {
  const findings = [
    { check: 'blocked', key: 'blocked B2 B1', text: 'B2 waited on B1, which is in review', fix: { do: 'unblock', id: 'B2', on: 'B1' } },
    { check: 'owner-gone', key: 'owner-gone B3 Ghost', text: 'B3 was queued for Ghost, no longer in the list', fix: { do: 'requeue', id: 'B3', to: 'Painter' } },
    { check: 'not-taken', key: 'not-taken B5 Painter', text: 'Painter: its queued B5 waited 12 min while it was free', fix: { do: 'wake', chat: 'Painter', id: 'B5', text: 'work: B5 is yours; run work next' } },
    { check: 'refine-drop', key: 'refine-drop B7 Q1', text: 'B7: a yes to dropping it', fix: { do: 'send', text: 'B7: the person answered yes to dropping it (Q1): drop it' } },
    { check: 'blocked', key: 'blocked B4 B77', text: 'B4 is blocked by B77, which the store does not hold', fix: { do: 'main', text: 'B4 is blocked by B77, which the store does not hold: unblock it or make B77' } },
    { check: 'blocked', key: 'blocked B6 B1', text: 'B6 waited on B1, which is in review', fix: { do: 'unblock', id: 'B6', on: 'B1' } },
    { check: 'helper', key: 'helper Second', text: 'Second is not running: 1 refines and checks wait', fix: { do: 'hand', chat: 'Partner', id: 'B8', text: 'work: Second is not running: do the waiting refines and result checks yourself' } },
  ]
  const done = []
  const ports = {
    unblock: async (id, on) => (done.push(['unblock', id, on]), id === 'B6' ? { ok: false, why: 'B6 changed in the meantime' } : { ok: true }),
    requeue: async (id, to) => (done.push(['requeue', id, to]), { ok: true }),
    wake: async one => (done.push(['wake', one.chat, one.id, one.key]), { id: 'x' }),
  }
  const first = await applySync(findings, ports, new Set(['refine-drop B7 Q1']))
  assert.deepEqual(done, [['unblock', 'B2', 'B1'], ['requeue', 'B3', 'Painter'], ['wake', 'Painter', 'B5', 'not-taken B5 Painter'], ['unblock', 'B6', 'B1'], ['wake', 'Partner', 'B8', 'helper Second hand']])
  assert.deepEqual(first.rows.map(one => one.status), ['Fixed', 'Fixed', 'Woke', 'Sent', 'For Main', 'For Main', 'For Main'])
  assert.match(first.rows[0].text, /B2 waited on B1, which is in review: unblocked/)
  assert.match(first.rows[1].text, /queued for Painter/)
  assert.match(first.rows[5].text, /B6 changed in the meantime/)
  // One note, with only what Main was not told before (the drop was).
  assert.deepEqual(first.keys, ['blocked B4 B77', 'blocked B6 B1', 'helper Second'])
  assert.equal(first.note.length, 3)
  assert.match(first.note[0], /B4 is blocked by B77/)
  assert.equal(first.fine, CHECKS.length - 5)
  // Nothing found: no note, every check fine.
  const calm = await applySync([], ports, new Set())
  assert.deepEqual([calm.rows, calm.note, calm.fine], [[], [], CHECKS.length])
  // A wake that cannot go (sent before under its key) is for Main.
  const again = await applySync([findings[2]], { ...ports, wake: async () => null }, new Set())
  assert.deepEqual(again.rows.map(one => one.status), ['For Main'])
})

test('the board itself may unblock and requeue a step, and its History says why; Waits for words stay the main chat\'s', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sync-api-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const backlog = '# Backlog\n\n## Work\n- [ ] B1 Draw the strip (for Painter; about 1 h)\n- [ ] B2 Keep the cards apart (for Painter; about 30 min)\n'
  await writeStore(dir, migrateBacklog(backlog, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + MIN, prefix: '', roleOf: chat => ({ Lead: 'main', Painter: 'worker', Mason: 'worker' })[chat] ?? null }
  const lead = body => workApi({ chat: 'Lead', ...body }, ctx)
  const board = body => workApi(body, { ...ctx, as: 'server' })
  const history = async id => (await readStore(dir)).items.get(id).sections.get('History').at(-1)
  assert.equal((await lead({ action: 'block', id: 'B2', on: 'B1' })).ok, true)
  const freed = await board({ action: 'unblock', id: 'B2', on: 'B1', why: 'B1 is in review' })
  assert.equal(freed.ok, true, freed.why)
  assert.match(await history('B2'), /server: no longer blocked by B1 \(the board's sync check: B1 is in review\)$/)
  const moved = await board({ action: 'requeue', id: 'B2', for: 'Mason', why: 'Painter left the list' })
  assert.equal(moved.ok, true, moved.why)
  assert.match(await history('B2'), /server: requeued for Mason \(was Painter\) \(the board's sync check: Painter left the list\)$/)
  // The main chat's own unblock says no why; the board may not clear what a step waits for in words.
  await lead({ action: 'block', id: 'B2', on: 'B1' })
  await lead({ action: 'unblock', id: 'B2', on: 'B1', why: 'ignored' })
  assert.match(await history('B2'), /Lead: no longer blocked by B1$/)
  assert.equal((await board({ action: 'unblock', id: 'B2' })).status, 403)
})
