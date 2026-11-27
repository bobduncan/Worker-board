// F74, the simplified design (the person's "Yes, simplify", 2026-11-27; the goal of 2026-11-26: "after it's finished it should give priority to
// work that's almost completed vs completely new items, so it doesn't stall"): a worker holds ONE step. A step BLOCKED BY another step, whose
// holder recorded that itself and then wrote its checkpoint (pushed), is PUT DOWN by the board's give-back: its record, branch, checkpoint
// and builder kept; the worker takes new work at once; when the blocker is done the step is first in line, nearly finished, its builder
// preferred while free. Chat 1's re-check (2026-11-27): only a blocked-by wait; a wait on a chat keeps its step as before F74. The live shapes
// of 2026-11-26 (Worker 1 on B1442 blocked by the unlanded B1440 for 14 hours), made-up names.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { overlapIn } from '../../src/work/guards.mjs'
import { CHOICE_WHY, NEARLY_RANK, isNearlyFinished, match, readyList } from '../../src/work/handOut.mjs'
import { STATES, decide } from '../../src/work/handover.mjs'
import { GIVEN_BACK, continuationOf, givenBackFrom, givenBackOf, givenBackRefusal, putDownLine, putDownOf, putDownWords } from '../../src/work/holderTimers.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { putDownCheck, recordOf, recordWriterOf, waitOf } from '../../src/work/parked.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { isLeftBack } from '../../src/work/worktrees.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 27, 16, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(90)), ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, sections)
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
const said = (minutesAgo, who, words) => `- ${stamp(ago(minutesAgo))} ${who}: ${words}`
const worker = (name, more = {}) => ({ name, state: 'free', isMain: false, isLeftover: false, isRunning: true, mod: '0.34.0', report: { state: 'idle', since: ago(30), at: ago(1) }, resting: null, ...more })
const historyOf = item => (item.sections.get('History') ?? []).map(String)

/** Worker 1 holds B1442 in progress on its branch (taken 10 hours ago); B1440 (Worker 3) is in review, unlanded; B1500 is a ready focus step. */
const held = (more = {}, lines = []) => step('B1442', 'in progress', { Owner: 'Worker 1', Branch: 'b1442-sandbox', Goal: 'G108', Refined: 'ready', 'Taken for': '60 min', ...more }, { History: [said(601, 'Worker 1', 'queued → taken'), said(600, 'Worker 1', 'taken → in progress'), ...lines] })
/** The same, with the holder's own record of the blocker and a checkpoint written after it. */
const recorded = (more = {}) => held({ 'Blocked by': 'B1440', Checkpoint: `abc1234 · merge once B1440 landed · ${stamp(ago(10))}`, ...more }, [said(30, 'Worker 1', 'blocked by B1440')])
const blocker = (state = 'review') => step('B1440', state, { Owner: 'Worker 3', Branch: 'b1440-isle', Goal: 'G108' })
const focusStep = (id = 'B1500') => step(id, 'refined', { Goal: 'G108' })
/** A step the board put down at `at` (B1442 by Worker 1): refined, no Owner, its builder named, the put-down line in its History. */
const putDownStep = (at, more = {}) => step('B1442', 'refined', { Goal: 'G108', Branch: 'b1442-sandbox', Checkpoint: `abc1234 · go on · ${stamp(at - 5 * MIN)}`, 'Put down': putDownLine('Worker 1', at), ...more }, {
  History: [said(600, 'Worker 1', 'queued → taken'), said(599, 'Worker 1', 'taken → in progress'), said(30, 'Worker 1', 'blocked by B1440'), `- ${stamp(at)} server: in progress → refined (${putDownWords('Worker 1', 'waits for B1440')})`],
})

const ROLES = { Lead: 'main', 'Worker 1': 'worker', 'Worker 3': 'worker', Partner: 'advisor' }
/** A store in a temporary folder; the context's git says every commit is pushed unless a test says otherwise. */
async function garden(items) {
  const dir = await mkdtemp(join(tmpdir(), 'f74s-'))
  const byId = mapOf(items)
  await writeStore(dir, { items: byId, activities: [{ name: 'Maps', isFocus: true, steps: [...byId.keys()], notes: [], loose: [] }] }, undefined, { now: ago(600) })
  const ctx = (at = NOW, more = {}) => ({ dir, now: at, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), overlapsOfStore: true, isPushed: async () => true, ...more })
  return {
    dir,
    person: (body, at) => workApi(body, { ...ctx(at), as: 'person' }),
    server: (body, at) => workApi(body, { ...ctx(at), as: 'server' }),
    as: chat => (body, at, more) => workApi({ chat, ...body }, ctx(at, more)),
    read: async () => (await readStore(dir)).items,
    end: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  }
}
const list = (items, more = {}) => readyList(items, { now: NOW, focus: 'G108', backup: null, followUpMs: 0, beyondFocus: false, ...more })

test('put down: the holder records the blocker, then its checkpoint: the step leaves the worker by the give-back, record, branch, checkpoint and builder kept; the worker gets the next ready step at once', async () => {
  const { as, read, end } = await garden([held(), blocker(), focusStep()])
  try {
    const w1 = as('Worker 1')
    // The record first, without a checkpoint: the step stays, the answer says what to write.
    const noted = await w1({ action: 'block', id: 'B1442', on: 'B1440' })
    assert.equal(noted.ok, true, noted.why)
    assert.match(noted.result.text, /B1442 blocked by B1440\. It stays yours until your checkpoint is in: push the branch and write work step B1442 commit <hash> next <words> \(a checkpoint written after this record\); then the board puts it down and you get new work\./)
    let items = await read()
    assert.deepEqual([valueOf(items.get('B1442'), 'State'), valueOf(items.get('B1442'), 'Owner'), valueOf(items.get('B1442'), 'Blocked by')], ['in progress', 'Worker 1', 'B1440'])
    assert.deepEqual(waitOf(items.get('B1442'), items), { kind: 'blocked', on: ['B1440'], words: 'waits for B1440' })
    // The checkpoint: put down.
    const saved = await w1({ action: 'step', id: 'B1442', commit: 'abc1234', next: 'merge once B1440 landed' }, NOW + MIN)
    assert.equal(saved.ok, true, saved.why)
    assert.match(saved.result.text, /The board put B1442 down: it waits for B1440; you are free: run work next\. It comes back first when B1440 is done, to you when you are free\. Remove your task folder for B1442 now with node \S+remove-task-folder\.mjs <folder>/)
    items = await read()
    const put = items.get('B1442')
    assert.deepEqual([valueOf(put, 'State'), valueOf(put, 'Owner'), valueOf(put, 'Blocked by'), valueOf(put, 'Branch')], ['refined', null, 'B1440', 'b1442-sandbox'])
    assert.match(valueOf(put, 'Checkpoint'), /^abc1234 · merge once B1440 landed · /)
    assert.equal(valueOf(put, 'Put down'), putDownLine('Worker 1', NOW + MIN))
    assert.deepEqual(putDownOf(put), { builder: 'Worker 1', at: NOW + MIN })
    assert.match(historyOf(put).at(-1), /server: in progress → refined \(given back by the board: Worker 1 put it down \(waits for B1440\)\)$/)
    assert.deepEqual(givenBackOf(put).at(-1), { at: NOW + MIN, chat: 'Worker 1', putDown: true })
    assert.deepEqual(continuationOf(put), { at: NOW + MIN, chat: 'Worker 1', putDown: true }, 'the next worker continues from the checkpoint')
    // Held off the ready list by its blocker; B1500 ready; Worker 1 holds nothing and is given B1500 at once.
    const ready = list(items)
    assert.equal(ready.held.find(one => one.id === 'B1442')?.why, 'blocked by B1440 (review)')
    assert.deepEqual(ready.ready.map(one => one.id), ['B1500'])
    const decision = decide({ worker: worker('Worker 1'), items, ready: ready.ready, now: NOW + 2 * MIN, event: { kind: 'turn-ended', since: NOW + MIN } })
    assert.deepEqual([decision.state, decision.give], [STATES.HANDING, 'B1500'])
    // Its builder is not refused when it comes back to it, and no amber "did not resume" shows on its lane.
    assert.equal(givenBackRefusal(put, 'Worker 1'), null)
    assert.deepEqual(givenBackFrom(items, 'Worker 1'), [])
  } finally {
    await end()
  }
})

test('the wait ends (the blocker done): the step is ready first, nearly finished, its builder preferred when idle, else the first idle worker at once (nothing stalls); another worker takes it and goes on from the checkpoint', async () => {
  const { person, server, as, read, end } = await garden([recorded(), blocker(), focusStep(), step('B2', 'refined', { Priority: 'fix' })])
  try {
    const w1 = as('Worker 1')
    // The record and the checkpoint are in place (the fixture); the checkpoint's writing puts it down.
    assert.match((await w1({ action: 'step', id: 'B1442', commit: 'abc1234', next: 'merge once B1440 landed' })).result.text, /The board put B1442 down/)
    let items = await read()
    assert.equal(valueOf(items.get('B1442'), 'Owner'), null)
    // B1440 done: the sync clears Blocked by; B1442 is ready, nearly finished: before the board's repair B2 and the focus step B1500.
    const landed = await person({ action: 'tick', id: 'B1440' }, NOW + MIN)
    assert.equal(landed.ok, true, JSON.stringify(landed))
    items = await read()
    assert.equal(valueOf(items.get('B1442'), 'Blocked by'), null)
    assert.equal(valueOf(items.get('B1442'), 'Put down'), putDownLine('Worker 1', NOW))
    const ready = list(items)
    assert.deepEqual(ready.ready.map(one => [one.id, one.rank, one.prefers, one.keptFor]), [['B1442', NEARLY_RANK, 'Worker 1', null], ['B2', 0, null, null], ['B1500', 1, null, null]])
    assert.equal(NEARLY_RANK, -0.5, 'after the checks (-1), before the repairs (0)')
    // The builder idle: it gets it; the builder busy: the first idle worker gets it at once.
    const given = (idle, ready = list(items).ready) => match({ ready, idle, items, prefix: '' }).map(one => [one.id, one.chat])
    assert.deepEqual(given([worker('Worker 3'), worker('Worker 1')]).find(([id]) => id === 'B1442'), ['B1442', 'Worker 1'])
    assert.deepEqual(given([worker('Worker 3')]).find(([id]) => id === 'B1442'), ['B1442', 'Worker 3'])
    // With a follow-up window (followUpMs) the builder is still only preferred, never kept, and the blocker's owner (a follow-up today) does not
    // keep it either: no stall while anyone is busy.
    const kept = list(items, { followUpMs: 10 * MIN }).ready.find(one => one.id === 'B1442')
    assert.deepEqual([kept.prefers, kept.keptFor, kept.keptUntil], ['Worker 1', null, null])
    // The decision for the idle builder gives it its own step (a put-down bars nobody).
    assert.equal(decide({ worker: worker('Worker 1'), items, ready: ready.ready, now: NOW + 2 * MIN, event: { kind: 'turn-ended', since: NOW + MIN } }).give, 'B1442')
    // The board gives it to Worker 3 (the builder busy), which takes it: it continues from the checkpoint (the hand-over's line), the Put down
    // line goes, the branch stays.
    const given2 = await server({ action: 'advance', to: 'queued', id: 'B1442', for: 'Worker 3' }, NOW + 2 * MIN)
    assert.equal(given2.ok, true, JSON.stringify(given2))
    const taken = await as('Worker 3')({ action: 'take', id: 'B1442', minutes: 45 }, NOW + 2 * MIN)
    assert.equal(taken.ok, true, taken.why)
    items = await read()
    const on = items.get('B1442')
    assert.deepEqual([valueOf(on, 'State'), valueOf(on, 'Owner'), valueOf(on, 'Put down'), valueOf(on, 'Branch')], ['in progress', 'Worker 3', null, 'b1442-sandbox'])
    assert.match(valueOf(on, 'Checkpoint'), /^abc1234 · merge once B1440 landed/)
    assert.equal(continuationOf(on), null, 'taken: the continuation is spent')
    assert.equal(list(items).ready.some(one => one.id === 'B1442'), false)
  } finally {
    await end()
  }
})

test('blocker 1 of the review: an idle builder is given its own put-down step by the decision; a plain give-back still bars its worker and shows the amber flag', () => {
  const items = mapOf([putDownStep(ago(20)), blocker('done')])
  const ready = list(items)
  assert.deepEqual(ready.ready.map(one => [one.id, one.rank, one.prefers]), [['B1442', NEARLY_RANK, 'Worker 1']])
  const decision = decide({ worker: worker('Worker 1'), items, ready: ready.ready, now: NOW, event: { kind: 'turn-ended', since: ago(1) } })
  assert.deepEqual([decision.state, decision.give], [STATES.HANDING, 'B1442'], JSON.stringify(decision))
  assert.deepEqual(givenBackFrom(items, 'Worker 1'), [])
  const dropped = step('B1442', 'refined', { Goal: 'G108' }, { History: [said(600, 'Worker 1', 'queued → taken'), `- ${stamp(ago(20))} server: in progress → refined (given back by the board: Worker 1 did not resume it (asked 15:30))`] })
  const barredItems = mapOf([dropped, blocker('done')])
  assert.equal(decide({ worker: worker('Worker 1'), items: barredItems, ready: list(barredItems).ready, now: NOW, event: { kind: 'turn-ended', since: ago(1) } }).give, null)
  assert.deepEqual(givenBackFrom(barredItems, 'Worker 1').map(one => one.id), ['B1442'])
})

test('a wait on a chat is never put down (chat 1\'s re-check): the step stays with its worker, its answer and its clearing as before F74; so does the go-live wait; a blocker beside a chat wait neither', async () => {
  const { as, read, end } = await garden([step('B1081', 'in progress', { Owner: 'Worker 1', Branch: 'b1081-open-fix-check', Goal: 'G108', Refined: 'ready', Checkpoint: `03ac0c10 · wait · ${stamp(ago(10))}` }, { History: [said(100, 'Worker 1', 'queued → taken'), said(99, 'Worker 1', 'taken → in progress')] }), focusStep(), blocker()])
  try {
    const w1 = as('Worker 1')
    for (const why of ['its go to land', 'its core review']) {
      const noted = await w1({ action: 'block', id: 'B1081', on: 'chat 1', why })
      assert.equal(noted.ok, true, noted.why)
      assert.match(noted.result.text, /The board holds it for you: no "go on" line and no give-back/)
      assert.doesNotMatch(noted.result.text, /put .* down|stays yours until/)
      const items = await read()
      assert.deepEqual([valueOf(items.get('B1081'), 'State'), valueOf(items.get('B1081'), 'Owner')], ['in progress', 'Worker 1'])
      assert.equal(putDownCheck(items.get('B1081'), items, { who: 'Worker 1' }).why, 'chat')
      // A checkpoint while the chat wait stands: the reminder, no put-down.
      const saved = await w1({ action: 'step', id: 'B1081', commit: '03ac0c10', next: 'wait' }, NOW + MIN)
      assert.match(saved.result.text, /You still wait on chat 1/)
      assert.doesNotMatch(saved.result.text, /put .* down/)
      assert.equal((await w1({ action: 'unblock', id: 'B1081' }, NOW + 2 * MIN)).ok, true)
    }
    // A blocker recorded beside a chat wait: the chat wait keeps the step.
    assert.equal((await w1({ action: 'block', id: 'B1081', on: 'chat 1', why: 'its review' }, NOW + 3 * MIN)).ok, true)
    assert.equal((await w1({ action: 'block', id: 'B1081', on: 'B1440' }, NOW + 4 * MIN)).ok, true)
    const both = await w1({ action: 'step', id: 'B1081', commit: '03ac0c10', next: 'wait for both' }, NOW + 5 * MIN)
    assert.doesNotMatch(both.result.text, /put .* down/)
    const items = await read()
    assert.equal(valueOf(items.get('B1081'), 'Owner'), 'Worker 1')
    assert.equal(putDownCheck(items.get('B1081'), items, { who: 'Worker 1' }).why, 'chat')
  } finally {
    await end()
  }
})

test('the one judgement (putDownCheck): only the holder\'s own record, a checkpoint written after that record, a branch, no landing lock', () => {
  const base = held({ 'Blocked by': 'B1440', Checkpoint: `abc1234 · go on · ${stamp(ago(10))}` })
  // No record line in the History: nobody known to have written it: not the holder's own.
  assert.equal(putDownCheck(base, mapOf([base, blocker()]), { who: 'Worker 1' }).why, 'other')
  assert.equal(recordWriterOf(base, { kind: 'blocked', on: ['B1440'] }), null)
  // The main chat wrote it: not put down, not at the holder's checkpoint either.
  const byLead = held({ 'Blocked by': 'B1440', Checkpoint: `abc1234 · go on · ${stamp(ago(10))}` }, [said(30, 'Lead', 'blocked by B1440')])
  assert.deepEqual([recordOf(byLead, { kind: 'blocked', on: ['B1440'] }), putDownCheck(byLead, mapOf([byLead, blocker()]), { who: 'Worker 1' }).why], [{ who: 'Lead', at: ago(30) }, 'other'])
  // The holder's own record, the checkpoint after it: put down.
  const own = recorded()
  const ok = putDownCheck(own, mapOf([own, blocker()]), { who: 'Worker 1' })
  assert.deepEqual([ok.ok, ok.wait.kind, ok.branch, ok.commit], [true, 'blocked', 'b1442-sandbox', 'abc1234'])
  // The checkpoint older than the record (written before the block): not put down; the first checkpoint after it is the one.
  const before = held({ 'Blocked by': 'B1440', Checkpoint: `abc1234 · go on · ${stamp(ago(40))}` }, [said(30, 'Worker 1', 'blocked by B1440')])
  assert.equal(putDownCheck(before, mapOf([before, blocker()]), { who: 'Worker 1' }).why, 'checkpoint')
  // A stale checkpoint (an earlier holder's, before this holder's take): not put down.
  const stale = held({ 'Blocked by': 'B1440', Checkpoint: `abc1234 · old next of Worker 0 · ${stamp(ago(700))}` }, [said(30, 'Worker 1', 'blocked by B1440')])
  assert.equal(putDownCheck(stale, mapOf([stale, blocker()]), { who: 'Worker 1' }).why, 'checkpoint')
  // A branch of none: nothing to continue from.
  const none = held({ 'Blocked by': 'B1440', Branch: 'none', Checkpoint: `abc1234 · go on · ${stamp(ago(10))}` }, [said(30, 'Worker 1', 'blocked by B1440')])
  assert.equal(putDownCheck(none, mapOf([none, blocker()]), { who: 'Worker 1' }).why, 'checkpoint')
  // The landing lock holds its branch: no put-down during land.ps1; another branch's landing is no bar.
  assert.equal(putDownCheck(own, mapOf([own, blocker()]), { who: 'Worker 1', landing: 'b1442-sandbox' }).why, 'landing')
  assert.equal(putDownCheck(own, mapOf([own, blocker()]), { who: 'Worker 1', landing: 'other-branch' }).ok, true)
  // No record at all; a blocker done: nothing to put down for.
  assert.equal(putDownCheck(held(), mapOf([held(), blocker()]), { who: 'Worker 1' }).why, 'none')
  assert.equal(putDownCheck(own, mapOf([own, blocker('done')]), { who: 'Worker 1' }).why, 'none')
})

test('through the work API: the push must be known (no git, no answer: the step stays); a branch under land.ps1 keeps it; the pin stays on a put-down', async () => {
  const pinned = recorded({ Pinned: 'Worker 1', Goal: 'G2' })
  const { dir, read, end } = await garden([pinned, blocker()])
  try {
    const call = (body, more = {}) => workApi({ chat: 'Worker 1', ...body }, { dir, now: NOW, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), overlapsOfStore: true, ...more })
    // No git to ask (no isPushed), or git not answering, or not pushed: stays, and the answer says what to push.
    for (const more of [{}, { isPushed: async () => null }, { isPushed: async () => false }, { isPushed: () => { throw new Error('git down') } }]) {
      const kept = await call({ action: 'step', id: 'B1442', commit: 'abc1234', next: 'wait' }, more)
      assert.match(kept.result.text, /It stays yours until your checkpoint commit abc1234 is on the remote \(push b1442-sandbox, then write the checkpoint again\); then the board puts it down/, JSON.stringify(Object.keys(more)))
      assert.equal(valueOf((await read()).get('B1442'), 'Owner'), 'Worker 1')
    }
    // The branch holds the landing lock: stays, quietly; a landingNow that throws is no put-down either.
    for (const landingNow of [() => 'b1442-sandbox', () => { throw new Error('lock unreadable') }, async () => 'b1442-sandbox']) {
      const landing = await call({ action: 'step', id: 'B1442', commit: 'abc1234', next: 'landing' }, { isPushed: async () => true, landingNow })
      assert.equal(landing.ok, true, landing.why)
      assert.doesNotMatch(landing.result.text, /put .* down|stays yours/)
      assert.equal(valueOf((await read()).get('B1442'), 'Owner'), 'Worker 1')
    }
    // Pushed, no landing: put down, the pin kept (the person's pick: the step waits for its pinned worker, not for the pick).
    const down = await call({ action: 'step', id: 'B1442', commit: 'abc1234', next: 'wait' }, { isPushed: async () => true, landingNow: () => null })
    assert.match(down.result.text, /The board put B1442 down/)
    const items = await read()
    assert.deepEqual([valueOf(items.get('B1442'), 'Owner'), valueOf(items.get('B1442'), 'Pinned')], [null, 'Worker 1'])
    const ready = list(items)
    assert.equal(ready.held.find(one => one.id === 'B1442')?.why, 'blocked by B1440 (review)')
    assert.equal(ready.held.some(one => one.id === 'B1442' && one.why === CHOICE_WHY), false)
  } finally {
    await end()
  }
})

test('a retried block that changes nothing puts the step down once the checkpoint came after it; a put-down step counts its Touches only once it is ready again', async () => {
  const own = held({ 'Blocked by': 'B1440' }, [said(30, 'Worker 1', 'blocked by B1440')])
  own.sections.set('Context', ['  Touches: lava-tactics src/maps/isle.ts'])
  const { as, person, read, end } = await garden([own, blocker(), step('B1600', 'refined', { Goal: 'G108' }, { Context: ['  Touches: lava-tactics src/maps/isle.ts'] })])
  try {
    const w1 = as('Worker 1')
    // The same blocker again, no checkpoint: unchanged, with the hint.
    const same = await w1({ action: 'block', id: 'B1442', on: 'B1440' })
    assert.equal(same.ok, true, same.why)
    assert.deepEqual([same.ok, same.result.changed], [true, false])
    assert.match(same.result.text, /It stays yours until your checkpoint is in/)
    let items = await read()
    assert.equal(valueOf(items.get('B1442'), 'Owner'), 'Worker 1')
    assert.equal(list(items).held.find(one => one.id === 'B1600')?.why, 'waits: same files as B1442, under way')
    // The checkpoint: put down.
    const saved = await w1({ action: 'step', id: 'B1442', commit: 'abc1234', next: 'wait' })
    assert.match(saved.result.text, /The board put B1442 down/)
    items = await read()
    assert.equal(valueOf(items.get('B1442'), 'Owner'), null)
    // Still blocked: it holds no files (two put-down steps never hold each other); B1600 is free to go.
    assert.equal(overlapIn(items, items.get('B1600'), ['queued', 'taken', 'in progress', 'waiting on you']), null)
    assert.equal(list(items).ready.some(one => one.id === 'B1600'), true)
    // The blocker done: B1442 is ready and holds its files again: B1600 waits behind it, with the words.
    assert.equal((await person({ action: 'tick', id: 'B1440' }, NOW + MIN)).ok, true)
    items = await read()
    assert.equal(overlapIn(items, items.get('B1600'), ['queued', 'taken', 'in progress', 'waiting on you'])?.state, 'put down')
    assert.equal(list(items).held.find(one => one.id === 'B1600')?.why, 'waits: same files as B1442, put down (nearly finished: it comes first)')
    // The retry on a step nobody holds any more changes nothing.
    const again = await w1({ action: 'block', id: 'B1442', on: 'B1440' })
    assert.equal(again.ok, true, again.why)
    assert.equal(valueOf((await read()).get('B1442'), 'Owner'), null)
  } finally {
    await end()
  }
})

test('two put-down steps on the same files, both ready again (chat 1\'s re-check 2): only the older put-down holds the other, so one goes out; the same stamp: the lower id', () => {
  const touching = (id, at, more = {}) => {
    const item = step(id, 'refined', { Goal: 'G108', Branch: `${id.toLowerCase()}-x`, Checkpoint: `abc1234 · go on · ${stamp(at - 5 * MIN)}`, 'Put down': putDownLine('Worker 1', at), ...more }, {
      History: [said(600, 'Worker 1', 'queued → taken'), said(30, 'Worker 1', 'blocked by B1440'), `- ${stamp(at)} server: in progress → refined (${putDownWords('Worker 1', 'waits for B1440')})`],
    })
    item.sections.set('Context', ['  Touches: lava-tactics src/maps/isle.ts'])
    return item
  }
  const older = touching('B1442', ago(40))
  const newer = touching('B1443', ago(20))
  const items = mapOf([older, newer, blocker('done')])
  assert.equal(overlapIn(items, newer, ['queued', 'taken', 'in progress', 'waiting on you'])?.id, 'B1442', 'the newer waits behind the older')
  assert.equal(overlapIn(items, older, ['queued', 'taken', 'in progress', 'waiting on you']), null, 'the older is held by nothing')
  const ready = list(items)
  assert.deepEqual(ready.ready.map(one => one.id), ['B1442'])
  assert.equal(ready.held.find(one => one.id === 'B1443')?.why, 'waits: same files as B1442, put down (nearly finished: it comes first)')
  // The same stamp: the lower id goes first.
  const same = mapOf([touching('B1442', ago(20)), touching('B1443', ago(20)), blocker('done')])
  assert.deepEqual(list(same).ready.map(one => one.id), ['B1442'])
  // Still blocked (B1440 in review): neither holds the other, neither is ready: the blocker holds both, and says so.
  const blocked = mapOf([touching('B1442', ago(40), { 'Blocked by': 'B1440' }), touching('B1443', ago(20), { 'Blocked by': 'B1440' }), blocker()])
  assert.deepEqual(list(blocked).held.map(one => [one.id, one.why]), [['B1442', 'blocked by B1440 (review)'], ['B1443', 'blocked by B1440 (review)']])
  // A blocked put-down step beside a READY newer put-down on the same files: the ready one holds it (the two-way rule is for two ready ones).
  const mixed = mapOf([touching('B1442', ago(40), { 'Blocked by': 'B1440' }), touching('B1443', ago(20)), blocker()])
  assert.equal(overlapIn(mixed, mixed.get('B1442'), ['queued', 'taken', 'in progress', 'waiting on you'])?.id, 'B1443')
  // A put-down step beside a step under way on the same files: the step under way holds it, as any ready step.
  const underWay = mapOf([older, step('B1600', 'in progress', { Owner: 'Worker 3' }, { Context: ['  Touches: lava-tactics src/maps/isle.ts'] }), blocker('done')])
  assert.equal(list(underWay).held.find(one => one.id === 'B1442')?.why, 'waits: same files as B1600, under way')
})

test('the unchanged-record retry puts the step down when the checkpoint came between the record and the retry', async () => {
  const { as, read, end } = await garden([recorded(), blocker()])
  try {
    const again = await as('Worker 1')({ action: 'block', id: 'B1442', on: 'B1440' })
    assert.equal(again.ok, true, again.why)
    assert.match(again.result.text, /^B1442 blocked by B1440\. The board put B1442 down: it waits for B1440;/)
    assert.equal(valueOf((await read()).get('B1442'), 'Owner'), null)
  } finally {
    await end()
  }
})

test('not put down: a checkpoint without a record, a record the main chat wrote (also at the holder\'s next checkpoint), a branch of none; the go-live (no record) keeps its worker', async () => {
  const noneBranch = step('B7', 'in progress', { Owner: 'Worker 3', Branch: 'none', Refined: 'ready', 'Blocked by': 'B1440' }, { History: [said(50, 'Worker 3', 'queued → taken'), said(40, 'Worker 3', 'blocked by B1440')] })
  const { as, read, end } = await garden([held({ Checkpoint: `abc1234 · nearly there · ${stamp(ago(10))}` }), blocker(), noneBranch])
  try {
    // A checkpoint while nothing is recorded (the go-live runs, say): the step stays with its worker, no put-down words.
    const plain = await as('Worker 1')({ action: 'step', id: 'B1442', commit: 'def5678', next: 'land it' })
    assert.equal(plain.ok, true)
    assert.doesNotMatch(plain.result.text, /put .* down|stays yours until/)
    assert.equal(valueOf((await read()).get('B1442'), 'Owner'), 'Worker 1')
    // The main chat records the blocker: nothing is put down, not now and not at the holder's next checkpoint.
    const byMain = await as('Lead')({ action: 'block', id: 'B1442', on: 'B1440' }, NOW + MIN)
    assert.equal(byMain.ok, true, byMain.why)
    assert.doesNotMatch(byMain.result.text ?? '', /put .* down/)
    const later = await as('Worker 1')({ action: 'step', id: 'B1442', commit: 'abc1234', next: 'still building, unrelated to B1440' }, NOW + 2 * MIN)
    assert.doesNotMatch(later.result.text, /put .* down/)
    assert.equal(valueOf((await read()).get('B1442'), 'Owner'), 'Worker 1')
    // A branch of none: nothing pushed to continue from; the answer says so.
    const none = await as('Worker 3')({ action: 'step', id: 'B7', commit: 'abc9999', next: 'x' }, NOW + MIN)
    assert.equal(none.ok, true, none.why)
    assert.match(none.result.text, /It stays yours until your checkpoint is in: push the branch/)
    assert.equal(valueOf((await read()).get('B7'), 'Owner'), 'Worker 3')
  } finally {
    await end()
  }
})

test('nearly finished covers the real fix rounds (a failed result check; the person\'s Send back, read from the fix\'s own words) and never a next try of an unbuilt or dropped root; the pick rule comes first', () => {
  const checked = (root, fix, goal = 'G108') => step(root, 'review', { Owner: 'Worker 2', Goal: goal }, { History: [said(40, 'Worker 2', 'in progress → review'), said(20, 'Partner', `result check failed: one point; fix ${fix} for Worker 2`)] })
  const items = mapOf([
    step('B1', 'refined', { Goal: 'G108' }),
    step('B4', 'refined', { Goal: 'G108', 'Fix of': 'B40' }), checked('B40', 'B4'),
    step('B6', 'refined', { Goal: 'G108', 'Fix of': 'B60' }, { History: [said(30, 'server', 'made by your Send back in Q1, open: the partner refines it from your words')] }), step('B60', 'done', { Owner: 'Worker 2', Goal: 'G108' }),
    step('B5', 'refined', { Goal: 'G108', 'Fix of': 'B50' }), step('B50', 'refined', { Goal: 'G108' }),
    step('B7', 'refined', { Goal: 'G108', 'Fix of': 'B70' }), step('B70', 'dropped', { Goal: 'G108' }, { History: [said(20, 'Partner', 'result check failed: x; fix B7 for Worker 2')] }),
    step('B8', 'refined', { Goal: 'G2', 'Fix of': 'B80' }), checked('B80', 'B8', 'G2'),
    step('B9', 'refined', { Goal: 'G108', 'Fix of': 'B90' }), step('B90', 'review', { Owner: 'Worker 2', Goal: 'G108' }, { History: [said(40, 'Worker 2', 'in progress → review')] }),
  ])
  const ready = list(items)
  const rankOf = id => ready.ready.find(one => one.id === id)?.rank ?? null
  assert.deepEqual([rankOf('B4'), rankOf('B6'), rankOf('B5'), rankOf('B7'), rankOf('B9'), rankOf('B1')], [NEARLY_RANK, NEARLY_RANK, 1, 1, 1, 1])
  assert.deepEqual(ready.held.filter(one => one.id === 'B8').map(one => one.why), [CHOICE_WHY], 'an unpicked fix round outside the focus waits for the pick')
  assert.deepEqual([isNearlyFinished(items.get('B4'), items), isNearlyFinished(items.get('B6'), items), isNearlyFinished(items.get('B9'), items)], [true, true, false])
  const picked = new Map(items)
  picked.set('B80', step('B80', 'review', { Owner: 'Worker 2', Goal: 'G2', Pinned: 'Worker 2' }, { History: [said(20, 'Partner', 'result check failed: one point; fix B8 for Worker 2')] }))
  assert.equal(list(picked).ready.find(one => one.id === 'B8')?.rank, NEARLY_RANK)
})

test('the sweep: a put-down\'s worktree is left while the step still has no owner, whatever its builder\'s process does; a plain give-back\'s only once the worker\'s process is gone', () => {
  const runs = name => name === 'Worker 1'
  const unowned = putDownStep(NOW)
  const owned = step('B1442', 'in progress', { Owner: 'Worker 3', Branch: 'b1442-sandbox' })
  assert.equal(isLeftBack({ at: NOW, chat: 'Worker 1', putDown: true }, runs, unowned), true)
  assert.equal(isLeftBack({ at: NOW, chat: 'Worker 1', putDown: true }, runs, owned), false, 'taken again: the folder is the new worker\'s business')
  assert.equal(isLeftBack({ at: NOW, chat: 'Worker 1', putDown: false }, runs, unowned), false)
  assert.equal(isLeftBack({ at: NOW, chat: 'Worker 2', putDown: false }, runs, unowned), true)
  assert.equal(isLeftBack(null, runs, unowned), false)
})

test('the words and their reading: GIVEN_BACK reads the put-down line as a give-back; the head line parses; a plain give-back still refuses the worker that dropped it', () => {
  const line = `- ${stamp(NOW)} server: in progress → refined (${putDownWords('Worker 1', 'waits for B1440')})`
  assert.match(line, GIVEN_BACK)
  const item = step('B1442', 'refined', { 'Put down': putDownLine('Worker 1', NOW) }, { History: [said(600, 'Worker 1', 'queued → taken'), line] })
  assert.deepEqual(givenBackOf(item), [{ at: NOW, chat: 'Worker 1', putDown: true }])
  assert.deepEqual(putDownOf(item), { builder: 'Worker 1', at: NOW })
  assert.equal(putDownOf(step('B1', 'refined')), null)
  assert.equal(givenBackRefusal(item, 'Worker 1'), null)
  const dropped = step('B1442', 'refined', {}, { History: [said(600, 'Worker 1', 'queued → taken'), `- ${stamp(NOW)} server: in progress → refined (given back by the board: Worker 1 did not resume it (asked 15:30))`] })
  assert.deepEqual(givenBackOf(dropped), [{ at: NOW, chat: 'Worker 1', putDown: false }])
  assert.match(givenBackRefusal(dropped, 'Worker 1'), /^B1442 was given back by the board at 16:00: stop that work and run work next$/)
})
