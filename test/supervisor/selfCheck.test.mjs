// B465: the board's own list of the ways work got stuck, each with its fix (src/supervisor: its repair rules and its loop,
// moved there from src/work/sync.mjs unchanged, the supervisor's Task 1). The person, 2026-10-21
// (I50): "i want a structural fix for preventing this it gets stuck". One test per check and per fix, on made-up items
// and chats; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { memoryStore } from '../../src/store.mjs'
import { workWords } from '../../src/say.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork } from '../../src/work/deliver.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { AGAIN_MS, CHECKS, NOT_TAKEN_MS, OWNER_GONE_MS, findStuck, leftoverFindings } from '../../src/supervisor/rules/repair.mjs'
import { LOOP_LOCK_MS, SYNC_SHOWN_MS, applySync, loopGate, loopOwner, mayRunLoop, readLoopLock, syncRunner } from '../../src/supervisor/loop.mjs'

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
const checkedPass = { History: [`- ${stamp(ago(30))} server: check passed: merged`] }

test('the list names every check once, with its words', () => {
  assert.deepEqual(CHECKS.map(one => one.key), ['blocked', 'not-taken', 'review-wait', 'owner-gone', 'refine-drop', 'limit-back', 'old-name', 'helper', 'partner-ask', 'unchecked', 'worktrees'])
  assert.ok(CHECKS.every(one => typeof one.words === 'string' && one.words.length > 0))
})

test('blocked: a step blocked by one in review or done is unblocked; one the store lacks, or a Waits for, is for Main', () => {
  const found = findStuck(base({
    items: items(
      step('B1', 'review', {}, { History: [`- ${stamp(ago(30))} server: check passed: merged`] }), step('B9', 'done'),
      step('B2', 'queued', { Owner: 'Painter', 'Blocked by': 'B1' }),
      step('B3', 'queued', { Owner: 'Painter', 'Blocked by': 'B9' }),
      step('B4', 'refined', { 'Blocked by': 'B77' }),
      step('B5', 'queued', { Owner: 'Painter', 'Waits for': 'B1 is checked' }),
      step('B6', 'done', { 'Blocked by': 'B1' }),
    ),
    lanes: [LEAD, lane('Painter', { state: 'working' })],
  }))
  const blocked = of(found, 'blocked')
  assert.deepEqual(blocked.map(one => [one.key, one.fix.do]), [['blocked B2 B1', 'unblock'], ['blocked B3 B9', 'unblock'], ['blocked B4 B77', 'main'], ['blocked B5 B1', 'main']])
  assert.deepEqual([blocked[0].fix.id, blocked[0].fix.on], ['B2', 'B1'])
  assert.match(blocked[0].text, /^B2 waited on B1, which is in review$/)
  assert.match(blocked[1].text, /^B3 waited on B9, which is done$/)
  assert.match(blocked[2].text, /B4 is blocked by B77, which the store does not hold/)
  assert.match(blocked[3].text, /B5 waits for B1 \(in review\)/)
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
    // The runner has missed it for longer than OWNER_GONE_MS (the review: watched, not read from the step's Since).
    seen: new Map([['missing ghost', NOW - OWNER_GONE_MS - MIN]]),
    ...more,
  })
  const moved = of(findStuck(world()), 'owner-gone')
  assert.deepEqual(moved.map(one => [one.fix.do, one.fix.id, one.fix.to]), [['requeue', 'B3', 'Painter']])
  assert.match(moved[0].text, /^B3 was queued for Ghost, no longer in the list$/)
  // Missed only a moment ago (a chat about to join, or one read without its file).
  assert.equal(of(findStuck(world({ seen: new Map([['missing ghost', ago(5)]]) })), 'owner-gone').length, 0)
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
  const world = at => base({ lanes: [LEAD, lane('Painter', { session: 's-2' })], refused: [{ name: 'Builder', session: 's-2', first: at - 5 * MIN, at }] })
  const sent = of(findStuck(world(ago(2))), 'old-name')
  assert.deepEqual(sent.map(one => [one.key, one.fix.do]), [['old-name Builder Painter', 'send']])
  assert.match(sent[0].fix.text, /Painter asks under its old name Builder: ask it to join as "Painter"/)
  assert.equal(of(findStuck(world(ago(30))), 'old-name').length, 0)
  // A refusal of a session the board does not show under another name is no rename.
  assert.equal(of(findStuck(base({ lanes: [LEAD], refused: [{ name: 'Builder', session: 's-9', first: ago(9), at: ago(2) }] })), 'old-name').length, 0)
})

test('helper: not running while refines or result checks wait, it is woken; still not running later, its work goes to the partner', () => {
  const partner = { name: 'Partner', state: 'working', isRunning: true }
  const helper = { name: 'Second', state: 'off', isRunning: false }
  const world = (more = {}) => base({
    partner, helper,
    items: items(step('B8', 'new'), step('B9', 'review')),
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

test('unchecked (B449): a step in review with no result check after 30 minutes wakes the partner once per 30 minutes; not before', () => {
  const partner = { name: 'Partner', state: 'working', isRunning: true }
  const history = [`- ${stamp(ago(40))} server: check passed: merged`]
  const reviewed = (since, more = {}, sections = {}) => step('B7', 'review', { Since: stamp(ago(since)), ...more }, { 'What we build': ['- a lamp at every bench'], History: history, ...sections })
  const world = (more = {}) => base({ partner, items: items(reviewed(40)), ...more })
  const woke = of(findStuck(world()), 'unchecked')
  assert.deepEqual(woke.map(one => [one.fix.do, one.fix.chat, one.fix.id]), [['wake', 'Partner', 'B7']])
  assert.match(woke[0].fix.text, /^check step B7/)
  // Not before 30 minutes; not for a step that needs no check, one whose board check did not pass, or while the person pauses.
  assert.equal(of(findStuck(world({ items: items(reviewed(25)) })), 'unchecked').length, 0)
  assert.equal(of(findStuck(world({ items: items(step('B7', 'review', { Since: stamp(ago(40)) }, { History: history })) })), 'unchecked').length, 0)
  assert.equal(of(findStuck(world({ items: items(reviewed(40, {}, { History: [`- ${stamp(ago(40))} server: check failed: not merged`] })) })), 'unchecked').length, 0)
  assert.equal(of(findStuck(world({ pause: { state: 'pausing', since: stamp(ago(1)) } })), 'unchecked').length, 0)
  assert.equal(of(findStuck(world({ partner: null })), 'unchecked').length, 0)
  // A line to the partner about it still waiting, or sent within 30 minutes, counts as the wake; an old taken one does not.
  const line = more => ({ id: 'c1', command: 'result-check', about: 'B7', to: 'Partner', at: ago(40), state: 'taken', ...more })
  assert.equal(of(findStuck(world({ outbox: [line({ state: 'waiting' })] })), 'unchecked').length, 0)
  assert.equal(of(findStuck(world({ outbox: [line({ at: ago(10), state: 'taken' })] })), 'unchecked').length, 0)
  assert.equal(of(findStuck(world({ outbox: [line()] })), 'unchecked').length, 1)
  // A check that was filed stops it; so does one that waits for the person while an ask under the step is still open.
  const waits = [...history, `- ${stamp(ago(35))} Partner: result check waits for you: 1 of 2 points pass; 1 for you to judge`]
  assert.equal(of(findStuck(world({ items: items(reviewed(40, {}, { History: [...history, `- ${stamp(ago(35))} Partner: result check passed: 1 of 1 points pass`] })) })), 'unchecked').length, 0)
  assert.equal(of(findStuck(world({ items: items(reviewed(40, {}, { History: waits }), ask('Q9', { Of: 'B7' })) })), 'unchecked').length, 0)
  // Its ask point answered and no check filed again after 30 minutes: woken, saying so.
  const answered = of(findStuck(world({ items: items(reviewed(40, {}, { History: waits }), ask('Q9', { Of: 'B7', State: 'answered' })) })), 'unchecked')
  assert.equal(answered.length, 1)
  assert.match(answered[0].fix.text, /^check step B7 \(its ask point is answered/)
  // Every 30 minutes anew: a new key per window.
  assert.notEqual(woke[0].key, of(findStuck(world({ now: NOW + 31 * MIN })), 'unchecked')[0].key)
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
  // B6's file changed meanwhile: the next run tries again, nothing for the main chat.
  assert.deepEqual(first.keys, ['blocked B4 B77', 'helper Second'])
  assert.equal(first.note.length, 2)
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

test('the runner: one run at a time, the main chat told once per key across runs, and the page shows the run asked or that found something', async () => {
  const applied = []
  let saved = null
  const world = items(step('B1', 'review', {}, checkedPass), step('B2', 'queued', { Owner: 'Painter', 'Blocked by': 'B1' }), step('B4', 'refined', { 'Blocked by': 'B77' }))
  let clock = NOW
  const runner = syncRunner({
    state: async () => ({ chats: [LEAD, lane('Painter', { state: 'working' })], chatPrefix: '', limits: {}, pause: null }),
    items: async () => world,
    outbox: () => [],
    refused: () => [],
    apply: async body => (applied.push(body), { ok: true }),
    wake: async () => ({ id: 'w' }),
    // what is saved is what the next run reads (B482: read at every run)
    noted: { load: async () => saved ?? ['blocked B9 B99'], save: async keys => { saved = keys } },
    now: () => clock,
  })
  const [first, second] = await Promise.all([runner.run(), runner.run({ asked: true })])
  assert.deepEqual(first.rows.map(one => one.status), ['Fixed', 'For Main'])
  assert.equal(second.asked, true)
  // B2 unblocked twice over two runs (the fake store does not change); B4 told to the main chat once.
  assert.deepEqual(applied.filter(one => one.action === 'unblock').map(one => [one.id, one.on]), [['B2', 'B1'], ['B2', 'B1']])
  const notes = applied.filter(one => one.action === 'note')
  assert.equal(notes.length, 1)
  assert.equal(notes[0].to, 'main')
  assert.match(notes[0].text[0], /^The board's sync check at \d\d:\d\d: what it could not fix itself$/)
  assert.match(notes[0].text[1], /^- B4 is blocked by B77/)
  assert.deepEqual(saved, { noted: ['blocked B9 B99', 'blocked B4 B77'], seen: {} })
  assert.equal(runner.shown(clock).asked, true)
  clock += SYNC_SHOWN_MS
  assert.equal(runner.shown(clock), null)
})

// The review of B465.

test('the review: a blocker in review counts as merged only when the board\'s check passed; pending or failed holds the step', () => {
  const world = history => base({ items: items(step('B10', 'review', {}, { History: history }), step('B11', 'queued', { Owner: 'Painter', 'Blocked by': 'B10' })), lanes: [LEAD, lane('Painter', { state: 'working' })] })
  assert.equal(of(findStuck(world(checkedPass.History)), 'blocked')[0].fix.do, 'unblock')
  assert.equal(of(findStuck(world([`- ${stamp(ago(30))} server: check failed: the branch b10 is still there`])), 'blocked').length, 0)
  assert.equal(of(findStuck(world([`- ${stamp(ago(30))} server: check pending`])), 'blocked').length, 0)
})

test('the review: an owner counts as gone only once the runner has missed it for OWNER_GONE_MS, never while the person pauses', () => {
  const world = more => base({ items: items(step('B3', 'queued', { Owner: 'Ghost', Since: stamp(ago(600)) })), lanes: [LEAD, lane('Painter')], ...more })
  // First missed now (one read without its file): watched, nothing moved.
  const observed = []
  assert.equal(of(findStuck(world({ observed })), 'owner-gone').length, 0)
  assert.deepEqual(observed, ['missing ghost'])
  assert.equal(of(findStuck(world({ seen: new Map([['missing ghost', NOW - OWNER_GONE_MS + MIN]]) })), 'owner-gone').length, 0)
  assert.equal(of(findStuck(world({ seen: new Map([['missing ghost', NOW - OWNER_GONE_MS]]) })), 'owner-gone')[0].fix.do, 'requeue')
  assert.equal(of(findStuck(world({ seen: new Map([['missing ghost', ago(600)]]), pause: { state: 'pausing' } })), 'owner-gone').length, 0)
})

test('the review: the helper counts no refine that waits for the person, and keeps one key while it stays off', () => {
  const partner = { name: 'Partner', state: 'working', isRunning: true }
  const helper = { name: 'Second', state: 'off', isRunning: false }
  const lines = ids => ids.map(id => ({ id: `r${id}`, command: 'refine', about: id, to: 'Partner', at: ago(20), state: 'delivered' }))
  const world = (stepsNow, ids, more = {}) => base({ partner, helper, items: items(...stepsNow), outbox: lines(ids), seen: new Map([['helper off second', ago(7)]]), ...more })
  assert.equal(of(findStuck(world([step('B8', 'new', { Refined: 'open' })], ['B8'])), 'helper').length, 0)
  const one = of(findStuck(world([step('B8', 'new'), step('B9', 'new')], ['B8'])), 'helper')[0]
  const two = of(findStuck(world([step('B8', 'new'), step('B9', 'new')], ['B8', 'B9'])), 'helper')[0]
  assert.equal(one.key, two.key)
  assert.match(two.text, /2 refines and checks wait/)
})

test('the review: one refusal the mod follows is no old name; refusals over two minutes are', () => {
  const world = first => base({ lanes: [LEAD, lane('Painter', { session: 's-2' })], refused: [{ name: 'Builder', session: 's-2', first, at: ago(1) }] })
  assert.equal(of(findStuck(world(ago(1))), 'old-name').length, 0)
  assert.equal(of(findStuck(world(ago(4))), 'old-name').length, 1)
})

test('the review: a fix whose file changed meanwhile, or a wake that throws, is one row; only what will not right itself goes to Main', async () => {
  const findings = [
    { check: 'blocked', key: 'blocked B2 B1', text: 'B2 waited on B1, which is in review', fix: { do: 'unblock', id: 'B2', on: 'B1' } },
    { check: 'not-taken', key: 'not-taken B5 Painter', text: 'Painter: its queued B5 waited 12 min while it was free', fix: { do: 'wake', chat: 'Painter', id: 'B5', text: 'work: B5 is yours; run work next' } },
    { check: 'limit-back', key: 'limit-back Mason', text: 'Mason: paused for the limit, the limit is back', fix: { do: 'wake', chat: 'Mason', id: 'B6', text: 'work: the limit is back' } },
  ]
  const ports = {
    unblock: async () => ({ ok: false, why: 'B2.md changed in the meantime' }),
    requeue: async () => ({ ok: true }),
    wake: async one => { if (one.chat === 'Painter') throw new Error('EBUSY: delivered.json'); return { id: 'w' } },
  }
  const done = await applySync(findings, ports, new Set())
  assert.deepEqual(done.rows.map(one => one.status), ['For Main', 'For Main', 'Woke'])
  assert.match(done.rows[1].text, /not woken \(EBUSY: delivered\.json\)/)
  assert.deepEqual(done.keys, ['not-taken B5 Painter'])
})

test('the review: the runner keeps since when it misses an owner, and a later run that finds nothing clears what it found by itself', async () => {
  let clock = NOW
  let world = items(step('B3', 'queued', { Owner: 'Ghost' }))
  const applied = []
  const runner = syncRunner({
    state: async () => ({ chats: [LEAD, lane('Painter')], chatPrefix: '', limits: {}, pause: null }),
    items: async () => world, outbox: () => [], refused: () => [],
    apply: async body => (applied.push(body), { ok: true }), wake: async () => ({ id: 'w' }),
    noted: { load: async () => [], save: async () => {} }, now: () => clock,
  })
  assert.deepEqual((await runner.run()).rows, [])
  clock += OWNER_GONE_MS
  const moved = await runner.run()
  assert.deepEqual(moved.rows.map(one => one.status), ['Fixed'])
  assert.deepEqual(applied.map(one => [one.action, one.id, one.for]), [['requeue', 'B3', 'Painter']])
  assert.equal(runner.shown(clock).rows.length, 1)
  world = items(step('B3', 'queued', { Owner: 'Painter' }))
  clock += MIN
  await runner.run()
  assert.equal(runner.shown(clock), null)
})

test('the review: a line of the sync check is withdrawn once its step is done or another chat\'s, or after half an hour; otherwise it holds', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sync-lines-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B1 Draw (for Painter)\n- [ ] B2 Paint (for Mason)\n- [ ] B3 Hang (for Painter)\n', { now: ago(120) }), undefined, { now: ago(120) })
  const outbox = memoryStore()
  const line = (id, to, at, key) => outbox.say({ id: `${id}-${to}`, at, ...workWords(to, id, `work: ${id} is yours; run work next`), kind: 'sync', syncKey: key, state: 'waiting' })
  await line('B1', 'Painter', ago(5), 'not-taken B1 Painter')
  await line('B2', 'Painter', ago(5), 'not-taken B2 Painter')
  await line('B3', 'Painter', ago(40), 'not-taken B3 Painter')
  await line('B3', 'Helper', ago(5), 'helper Helper x')
  const state = { restart: { main: 'Lead' }, chatPrefix: '', chats: [], reconciled: { moves: [], deliveries: [], says: [] } }
  await deliverWork({ state, dir, outbox, apply: async () => null, now: NOW, maxChars: 2000, newId: () => 'n', keep: { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN } })
  assert.deepEqual(outbox.outbox().map(one => [one.about, one.to, one.state]), [['B1', 'Painter', 'waiting'], ['B2', 'Painter', 'dropped'], ['B3', 'Painter', 'dropped'], ['B3', 'Helper', 'waiting']])
})

// B482: the result check of B465.
test('B482: a blocker in review holds its step until its result check passed too, when it needs one', () => {
  const merged = (line) => step('B10', 'review', {}, {
    'What we build': ['- the strip'],
    History: [`- ${stamp(ago(40))} Painter: in progress → review`, `- ${stamp(ago(39))} server: check passed: merged`, ...(line === null ? [] : [`- ${stamp(ago(20))} Partner: ${line}`])],
  })
  const world = (line) => base({ items: items(merged(line), step('B11', 'queued', { Owner: 'Painter', 'Blocked by': 'B10' })), lanes: [LEAD, lane('Painter', { state: 'working' })] })
  assert.equal(of(findStuck(world(null)), 'blocked').length, 0, 'no result check yet')
  assert.equal(of(findStuck(world('result check failed: 3 of 5 points pass')), 'blocked').length, 0, 'a failed one')
  assert.equal(of(findStuck(world('result check waits for the person')), 'blocked').length, 0, 'one that waits')
  assert.equal(of(findStuck(world('result check passed')), 'blocked')[0]?.fix.do, 'unblock')
})

test('B482: what was seen and noted is kept over a restart: the helper is not woken, nor Main told, anew', async () => {
  const partner = { name: 'Partner', state: 'working', isRunning: true }
  const helper = { name: 'Second', state: 'off', isRunning: false }
  let stored = { noted: [], seen: {} }
  const applied = []
  const sent = [{ id: 'r1', command: 'refine', about: 'B8', to: 'Partner', at: NOW - 20 * MIN, state: 'delivered' }]
  let clock = NOW
  const make = () => syncRunner({
    state: async () => ({ chats: [LEAD], advisor: partner, advisorHelper: helper, chatPrefix: '', limits: {}, pause: null }),
    items: async () => items(step('B8', 'new')),
    // the board's outbox is kept over a restart too, with the line the check sent
    outbox: () => sent,
    refused: () => [],
    apply: async body => (applied.push(body), { ok: true }),
    wake: async one => {
      applied.push({ wake: one.key })
      sent.push({ id: `w${applied.length}`, command: 'work', about: one.id, to: one.chat, at: clock, state: 'waiting', kind: 'sync', syncKey: one.key })
      return { id: 'w' }
    },
    noted: { load: async () => JSON.parse(JSON.stringify(stored)), save: async state => { stored = JSON.parse(JSON.stringify(state)) } },
    now: () => clock,
  })
  await make().run()
  const wakes = applied.filter(one => one.wake !== undefined).length
  assert.equal(wakes, 1)
  assert.ok(Object.keys(stored.seen).some(key => key.startsWith('helper off')))
  // a restart a minute later: the same episode, the same key: woken a moment ago, nothing sent again
  clock += MIN
  await make().run()
  assert.equal(applied.filter(one => one.wake !== undefined).length, wakes)
  assert.equal(applied.filter(one => one.action === 'note').length, 0, 'nothing for Main')
})

test('B482: one loop per project: a lock held by another board process that runs is left alone; a stale one is taken', () => {
  assert.equal(mayRunLoop(null, 7, NOW), true)
  assert.equal(mayRunLoop({ pid: 7, port: 4310, at: NOW - MIN }, 7, NOW), true)
  assert.equal(mayRunLoop({ pid: 8, port: 4311, at: NOW - MIN }, 7, NOW), false)
  assert.equal(mayRunLoop({ pid: 8, port: 4311, at: NOW - LOOP_LOCK_MS - 1 }, 7, NOW), true)
})

test('B487: a lock file cut off mid-write is taken over like a dead one; an unreadable one is thrown', async () => {
  assert.equal(await readLoopLock(async () => '{"pid":8,"po'), null)
  assert.equal(await readLoopLock(async () => ''), null)
  assert.equal(await readLoopLock(() => Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))), null)
  assert.deepEqual(await readLoopLock(async () => '{"pid":8,"port":1,"at":5}'), { pid: 8, port: 1, at: 5 })
  await assert.rejects(readLoopLock(() => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))), /denied/)
  // and a torn lock lets this process run the list
  assert.equal(mayRunLoop(await readLoopLock(async () => '{"pid":8'), 7, NOW), true)
})

test('B489: with a torn lock file two board processes run the list once between them, and nothing is told twice', async () => {
  let file = '{"pid":8,"po'
  let clock = NOW
  const applied = []
  let stored = { noted: [], seen: {} }
  let world = items(step('B3', 'queued', { Owner: 'Ghost' }))
  const runner = syncRunner({
    state: async () => ({ chats: [LEAD, lane('Painter')], chatPrefix: '', limits: {}, pause: null }),
    items: async () => world, outbox: () => [], refused: () => [],
    apply: async body => (applied.push(body), world = items(step('B3', 'queued', { Owner: body.for })), { ok: true }), wake: async () => ({ id: 'w' }),
    noted: { load: async () => JSON.parse(JSON.stringify(stored)), save: async state => { stored = JSON.parse(JSON.stringify(state)) } },
    now: () => clock,
  })
  const board = (pid, port) => loopOwner({ read: async () => file, write: async text => { file = text }, alive: () => true, pid, port, now: () => clock })
  const first = board(7, 4310)
  const second = board(8, 4311)
  const tick = async () => {
    const ran = []
    for (const [name, own] of [['first', first], ['second', second]]) if (await own()) { ran.push(name); await runner.run() }
    return ran
  }
  await runner.run()
  applied.length = 0
  clock += OWNER_GONE_MS
  assert.deepEqual(await tick(), ['first'], 'the torn lock is taken by the first; the second finds it held')
  assert.equal(JSON.parse(file).pid, 7)
  assert.deepEqual(applied.map(one => [one.action, one.id]), [['requeue', 'B3']], 'the list ran once')
  clock += MIN
  assert.deepEqual(await tick(), ['first'])
  assert.equal(applied.filter(one => one.action === 'requeue').length, 1, 'no repeat fix, no repeat note')
  assert.equal(applied.filter(one => one.action === 'note' || one.wake !== undefined).length, 0)
})

test('B492: a state that tells (a missing blocker, a queued step not taken) is told once: one note and one wake over two runs', async () => {
  let clock = NOW
  const applied = []
  const sent = [{ id: 'm1', command: 'work', about: 'B5', to: 'Painter', at: NOW - 20 * MIN, state: 'delivered' }]
  let stored = { noted: [], seen: {} }
  const runner = syncRunner({
    state: async () => ({ chats: [LEAD, lane('Painter')], chatPrefix: '', limits: {}, pause: null }),
    items: async () => items(step('B4', 'queued', { Owner: 'Painter', 'Blocked by': 'B99' }), step('B5', 'queued', { Owner: 'Painter' })),
    outbox: () => sent, refused: () => [],
    apply: async body => (applied.push(body), { ok: true }),
    wake: async one => {
      applied.push({ wake: one.key })
      sent.push({ id: `w${sent.length}`, command: 'work', about: one.id, to: one.chat, at: clock, state: 'waiting', kind: 'sync', syncKey: one.key })
      return { id: 'w' }
    },
    noted: { load: async () => JSON.parse(JSON.stringify(stored)), save: async state => { stored = JSON.parse(JSON.stringify(state)) } },
    now: () => clock,
  })
  const count = () => [applied.filter(one => one.action === 'note').length, applied.filter(one => one.wake !== undefined).length]
  await runner.run()
  assert.deepEqual(count(), [1, 1], 'tick 1: it tells')
  clock += MIN
  await runner.run()
  assert.deepEqual(count(), [1, 1], 'tick 2: the same state is not told again')
})

// Worktree clean-up (the person, 2026-10-24: "cleanup leftover working tree's please. ensure this is part of the cleanup
// step."): the check `worktrees`. What worktrees.mjs `findLeftovers` finds safe the board removes (Cleaned); the rest
// it lists with the reason (Left) and tells no chat. test/work/worktrees.test.mjs has the finding and the removal.
const LEFTOVERS = [
  { path: '/projects/game-b5', kind: 'worktree', repo: '/projects/game', what: 'a worktree of game on b5-lamps', clean: true, why: null },
  { path: '/projects/game-b3', kind: 'folder', repo: null, what: 'an empty folder', clean: true, why: null },
  { path: '/projects/game-b410', kind: 'worktree', repo: '/projects/game', what: 'a worktree of game on b410-hero', clean: false, why: 'held by B410' },
  { path: '/projects/board-parked', kind: 'worktree', repo: '/projects/board', what: 'a worktree of board on parked', clean: false, why: 'not merged into main' },
]

test('worktree clean-up: a safe leftover is removed (Cleaned), one that could not be is Left, the rest Left with its reason; no chat is told', async () => {
  const findings = leftoverFindings(LEFTOVERS)
  assert.deepEqual(findings.map(one => [one.check, one.key, one.fix.do]), [
    ['worktrees', 'worktree /projects/game-b5', 'clean'], ['worktrees', 'worktree /projects/game-b3', 'clean'],
    ['worktrees', 'worktree /projects/game-b410', 'list'], ['worktrees', 'worktree /projects/board-parked', 'list'],
  ])
  const cleaned = []
  const ports = { clean: async one => (cleaned.push(one.path), one.kind === 'folder' ? { ok: false, why: 'it is not empty' } : { ok: true }) }
  const done = await applySync(findings, ports, new Set())
  assert.deepEqual(cleaned, ['/projects/game-b5', '/projects/game-b3'])
  assert.deepEqual(done.rows.map(one => [one.status, one.text]), [
    ['Cleaned', '/projects/game-b5: a worktree of game on b5-lamps'],
    ['Left', '/projects/game-b3: an empty folder: not removed (it is not empty)'],
    ['Left', '/projects/game-b410 (a worktree of game on b410-hero): held by B410'],
    ['Left', '/projects/board-parked (a worktree of board on parked): not merged into main'],
  ])
  assert.deepEqual([done.note, done.keys], [[], []])
  // A check that removed something found something; one that only lists counts as fine.
  assert.equal(done.fine, CHECKS.length - 1)
  assert.equal((await applySync(leftoverFindings(LEFTOVERS.slice(2)), ports, new Set())).fine, CHECKS.length)
  // A removal that throws is one row, not the end of the run.
  const thrown = await applySync(findings.slice(0, 1), { clean: async () => { throw new Error('git was not there') } }, new Set())
  assert.deepEqual(thrown.rows.map(one => [one.status, one.text]), [['Left', '/projects/game-b5: a worktree of game on b5-lamps: not removed (git was not there)']])
})

test('worktree clean-up in the runner: it looks with the store\'s items; a run that only lists shows nothing by itself, and a failed look is one row', async () => {
  const looked = []
  let found = LEFTOVERS.slice(2)
  let isBroken = false
  const world = items(step('B410', 'in progress', { Owner: 'Painter', Branch: 'b410-hero' }))
  const runner = syncRunner({
    state: async () => ({ chats: [LEAD, lane('Painter', { state: 'working' })], chatPrefix: '', limits: {}, pause: null }),
    items: async () => world,
    outbox: () => [],
    refused: () => [],
    apply: async () => ({ ok: true }),
    wake: async () => ({ id: 'w' }),
    noted: { load: async () => [], save: async () => {} },
    now: () => NOW,
    leftovers: async ({ items: seen, now }) => {
      looked.push([seen, now])
      if (isBroken) throw new Error('the project folder could not be read')
      return found
    },
    clean: async () => ({ ok: true }),
  })
  const quiet = await runner.run()
  assert.deepEqual(looked, [[world, NOW]])
  assert.deepEqual(quiet.rows.map(one => one.status), ['Left', 'Left'])
  // Only listed: the page shows nothing for it (held worktrees are the usual), and an asked run shows them all.
  assert.equal(runner.shown(NOW), null)
  assert.deepEqual((await runner.run({ asked: true })).rows.map(one => one.status), ['Left', 'Left'])
  assert.equal(runner.shown(NOW).asked, true)
  // Something removed: shown.
  found = LEFTOVERS.slice(0, 1)
  assert.deepEqual((await runner.run()).rows.map(one => [one.status, one.text]), [['Cleaned', '/projects/game-b5: a worktree of game on b5-lamps']])
  assert.equal(runner.shown(NOW).rows[0].status, 'Cleaned')
  isBroken = true
  assert.deepEqual((await runner.run()).rows.map(one => [one.status, one.text]), [['Left', 'leftover worktrees: not looked at (the project folder could not be read)']])
})

test('B488: of two processes that claim an empty lock at once, the write that stands wins and the other finds out', async () => {
  let file = ''
  const clock = NOW
  // each writes, then the other writes before the first reads the lock back
  const board = (pid, port) => loopOwner({
    read: async () => file, write: async text => { file = text }, alive: () => true, pid, port, now: () => clock, settleMs: 50,
    wait: async () => { if (pid === 7 && file.includes('"pid":7')) file = JSON.stringify({ pid: 8, port: 4311, at: clock }) },
  })
  assert.equal(await board(7, 4310)(), false, 'the first claim was written over before it settled')
  assert.equal(JSON.parse(file).pid, 8)
  assert.equal(await board(8, 4311)(), true, 'the claim that stands is the second\'s; it needs no second settle to keep the loops')
  const refresh = []
  const owner = loopOwner({ read: async () => file, write: async text => { file = text }, alive: () => true, pid: 8, port: 4311, now: () => clock, settleMs: 50, wait: async ms => refresh.push(ms) })
  assert.equal(await owner(), true)
  assert.deepEqual(refresh, [], 'a lock that is already its own is refreshed without waiting')
})

test('B488: the loop gate answers from the lock at most once a second, says no when the check fails, and reads the files again when it gains the loops', async () => {
  let clock = NOW
  let answers = [false, true, true]
  let asked = 0
  const gained = []
  const failed = []
  const gate = loopGate({
    owner: async () => { asked += 1; const next = answers.shift(); if (next === undefined) throw new Error('lock unreadable'); return next },
    now: () => clock, onGained: async () => { gained.push(clock) }, onFailed: error => failed.push(error.message),
  })
  assert.equal(await gate(), false)
  assert.equal(await gate(), false, 'the answer of this second stands')
  assert.equal(asked, 1)
  clock += 1500
  assert.deepEqual([await Promise.all([gate(), gate()])].flat(), [true, true], 'two asks at once make one check')
  assert.equal(asked, 2)
  assert.deepEqual(gained, [clock], 'gained after it was refused: once, before the loops run')
  clock += 1500
  assert.equal(await gate(), true)
  assert.equal(gained.length, 1, 'holding the lock again is no gain')
  clock += 1500
  assert.equal(await gate(), false, 'a lock that cannot be read is a no')
  assert.deepEqual(failed, ['lock unreadable'])
  answers = [true]
  clock += 1500
  assert.equal(await gate(), true)
  assert.equal(gained.length, 2, 'a no from a failing check counts as refused')
  const first = loopGate({ owner: async () => true, now: () => clock, onGained: async () => { throw new Error('never') } })
  assert.equal(await first(), true, 'a process that starts with the lock gains nothing')
})
