// F74, the simplified design (the person's "Yes, simplify", 2026-11-27; the goal of 2026-11-26: "after it's finished it should give priority to
// work that's almost completed vs completely new items, so it doesn't stall"): a worker holds ONE step. A step whose holder recorded that it
// only waits, with its checkpoint in, is PUT DOWN by the board's give-back (its record, branch and checkpoint kept, its builder named); the
// worker takes new work at once; when the wait ends the step is first in line, nearly finished, its builder preferred while free. The live
// shapes of 2026-11-26 (Worker 1 on B1442 blocked by the unlanded B1440 for 14 hours; Worker 4 on B1081 waiting for chat 1's go), made-up names.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { CHOICE_WHY, NEARLY_RANK, isNearlyFinished, match, readyList } from '../../src/work/handOut.mjs'
import { STATES, decide } from '../../src/work/handover.mjs'
import { GIVEN_BACK, continuationOf, givenBackOf, givenBackRefusal, putDownLine, putDownOf, putDownWords } from '../../src/work/holderTimers.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { waitOf } from '../../src/work/parked.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { waitsOnLine } from '../../src/work/waitsOn.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 27, 16, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(90)), ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, sections)
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
const said = (minutesAgo, who, words) => `- ${stamp(ago(minutesAgo))} ${who}: ${words}`
const worker = (name, more = {}) => ({ name, state: 'free', isMain: false, isLeftover: false, isRunning: true, mod: '0.34.0', report: { state: 'idle', since: ago(30), at: ago(1) }, resting: null, ...more })
const historyOf = item => (item.sections.get('History') ?? []).map(String)

/** Worker 1 holds B1442 in progress on its branch, no checkpoint yet; B1440 (Worker 3) is in review, unlanded; B1500 is a ready focus step. */
const held = (more = {}) => step('B1442', 'in progress', { Owner: 'Worker 1', Branch: 'b1442-sandbox', Goal: 'G108', Refined: 'ready', 'Taken for': '60 min', ...more }, { History: [said(601, 'Worker 1', 'queued → taken'), said(600, 'Worker 1', 'taken → in progress')] })
const blocker = (state = 'review') => step('B1440', state, { Owner: 'Worker 3', Branch: 'b1440-isle', Goal: 'G108' })
const focusStep = (id = 'B1500') => step(id, 'refined', { Goal: 'G108' })

const ROLES = { Lead: 'main', 'Worker 1': 'worker', 'Worker 3': 'worker', Partner: 'advisor' }
async function garden(items) {
  const dir = await mkdtemp(join(tmpdir(), 'f74s-'))
  const byId = mapOf(items)
  await writeStore(dir, { items: byId, activities: [{ name: 'Maps', isFocus: true, steps: [...byId.keys()], notes: [], loose: [] }] }, undefined, { now: ago(600) })
  const ctx = (at = NOW) => ({ dir, now: at, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), overlapsOfStore: true })
  return {
    dir,
    person: (body, at) => workApi(body, { ...ctx(at), as: 'person' }),
    server: (body, at) => workApi(body, { ...ctx(at), as: 'server' }),
    as: chat => (body, at) => workApi({ chat, ...body }, ctx(at)),
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
    const recorded = await w1({ action: 'block', id: 'B1442', on: 'B1440' })
    assert.equal(recorded.ok, true, recorded.why)
    assert.match(recorded.result.text, /B1442 blocked by B1440\. It stays yours until your checkpoint is in: push the branch and write work step B1442 commit <hash> next <words>; then the board puts it down and you get new work\./)
    let items = await read()
    assert.deepEqual([valueOf(items.get('B1442'), 'State'), valueOf(items.get('B1442'), 'Owner'), valueOf(items.get('B1442'), 'Blocked by')], ['in progress', 'Worker 1', 'B1440'])
    assert.deepEqual(waitOf(items.get('B1442'), items), { kind: 'blocked', on: ['B1440'], words: 'waits for B1440' })
    // The checkpoint: put down.
    const saved = await w1({ action: 'step', id: 'B1442', commit: 'abc1234', next: 'merge once B1440 landed' }, NOW + MIN)
    assert.equal(saved.ok, true, saved.why)
    assert.match(saved.result.text, /The board put B1442 down: it waits for B1440; you are free: run work next\. It comes back first when the wait ends, to you when you are free\. Remove your task folder for B1442 now with node \S+remove-task-folder\.mjs <folder>/)
    items = await read()
    const put = items.get('B1442')
    assert.deepEqual([valueOf(put, 'State'), valueOf(put, 'Owner'), valueOf(put, 'Blocked by'), valueOf(put, 'Branch')], ['refined', null, 'B1440', 'b1442-sandbox'])
    assert.match(valueOf(put, 'Checkpoint'), /^abc1234 · merge once B1440 landed · /)
    assert.equal(valueOf(put, 'Put down'), putDownLine('Worker 1', NOW + MIN))
    assert.deepEqual(putDownOf(put), { builder: 'Worker 1', at: NOW + MIN })
    assert.match(historyOf(put).at(-1), /server: in progress → refined \(given back by the board: Worker 1 put it down \(waits for B1440\)\)$/)
    assert.deepEqual(givenBackOf(put).at(-1), { at: NOW + MIN, chat: 'Worker 1', putDown: true })
    assert.deepEqual(continuationOf(put), { at: NOW + MIN, chat: 'Worker 1', putDown: true }, 'the next worker continues from the checkpoint')
    // Held off the ready list by its record; B1500 ready; Worker 1 holds nothing and is given B1500 at once.
    const ready = list(items)
    assert.deepEqual(ready.held.find(one => one.id === 'B1442')?.why, 'blocked by B1440 (review)')
    assert.deepEqual(ready.ready.map(one => one.id), ['B1500'])
    const decision = decide({ worker: worker('Worker 1'), items, ready: ready.ready, now: NOW + 2 * MIN, event: { kind: 'turn-ended', since: NOW + MIN } })
    assert.deepEqual([decision.state, decision.give], [STATES.HANDING, 'B1500'])
    // Its builder is not refused when it comes back to it (a plain give-back would refuse the worker that dropped it).
    assert.equal(givenBackRefusal(put, 'Worker 1'), null)
  } finally {
    await end()
  }
})

test('the wait ends (the blocker done): the step is ready first, nearly finished, its builder preferred when idle, else the first idle worker at once (nothing stalls); another worker takes it and goes on from the checkpoint', async () => {
  const { person, server, as, read, end } = await garden([held({ 'Blocked by': 'B1440', Checkpoint: 'abc1234 · merge once B1440 landed · 2026-11-27 15:30:00' }), blocker(), focusStep(), step('B2', 'refined', { Priority: 'fix' })])
  try {
    const w1 = as('Worker 1')
    // The record is in place already (the fixture); the checkpoint's writing puts it down.
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

test('a wait on a chat: put down at once when the checkpoint is in; held by the record ("waits on chat 1"); only its builder, the main chat or the person clears it; then nearly finished', async () => {
  const { as, read, end } = await garden([step('B1081', 'in progress', { Owner: 'Worker 1', Branch: 'b1081-open-fix-check', Goal: 'G108', Refined: 'ready', Checkpoint: '03ac0c10 · wait for the go · 2026-11-27 15:30:00' }, { History: [said(100, 'Worker 1', 'queued → taken'), said(99, 'Worker 1', 'taken → in progress')] }), focusStep()])
  try {
    const w1 = as('Worker 1')
    const recorded = await w1({ action: 'block', id: 'B1081', on: 'chat 1', why: 'its go to land' })
    assert.equal(recorded.ok, true, recorded.why)
    assert.match(recorded.result.text, /B1081 waits on chat 1 \(its go to land\) since 16:00\..* The board put B1081 down: it waits on chat 1 \(its go to land\); you are free: run work next\./)
    let items = await read()
    assert.deepEqual([valueOf(items.get('B1081'), 'State'), valueOf(items.get('B1081'), 'Owner'), valueOf(items.get('B1081'), 'Waits on')], ['refined', null, waitsOnLine('chat 1', 'its go to land', NOW)])
    assert.equal(list(items).held.find(one => one.id === 'B1081')?.why, 'waits on chat 1 (its go to land)')
    // Another worker may not clear it; its builder may (as the main chat and the person).
    assert.equal((await as('Worker 3')({ action: 'unblock', id: 'B1081' }, NOW + MIN)).status, 403)
    const cleared = await w1({ action: 'unblock', id: 'B1081' }, NOW + 2 * MIN)
    assert.equal(cleared.ok, true, cleared.why)
    items = await read()
    assert.equal(valueOf(items.get('B1081'), 'Waits on'), null)
    const ready = list(items).ready.find(one => one.id === 'B1081')
    assert.deepEqual([ready?.rank, ready?.prefers], [NEARLY_RANK, 'Worker 1'])
  } finally {
    await end()
  }
})

test('not put down: a checkpoint without a record, a record the main chat wrote, a branch of none; the go-live (no record) keeps its worker', async () => {
  const { as, read, end } = await garden([held({ Checkpoint: 'abc1234 · nearly there · 2026-11-27 15:30:00' }), blocker(), step('B7', 'in progress', { Owner: 'Worker 3', Branch: 'none', 'Blocked by': 'B1440' }, { History: [said(50, 'Worker 3', 'queued → taken')] })])
  try {
    // A checkpoint while nothing is recorded (the go-live runs, say): the step stays with its worker, no put-down words.
    const plain = await as('Worker 1')({ action: 'step', id: 'B1442', commit: 'def5678', next: 'land it' })
    assert.equal(plain.ok, true)
    assert.doesNotMatch(plain.result.text, /put .* down|stays yours until/)
    assert.equal(valueOf((await read()).get('B1442'), 'Owner'), 'Worker 1')
    // The main chat records the blocker: not the holder's own call: nothing is put down.
    const byMain = await as('Lead')({ action: 'block', id: 'B1442', on: 'B1440' }, NOW + MIN)
    assert.equal(byMain.ok, true, byMain.why)
    assert.doesNotMatch(byMain.result.text ?? '', /put .* down/)
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

test('nearly finished covers the real fix rounds (a failed result check, a send-back) and never a next try of an unbuilt or dropped root; the pick rule comes first', () => {
  const checked = (root, fix, goal = 'G108') => step(root, 'review', { Owner: 'Worker 2', Goal: goal }, { History: [said(40, 'Worker 2', 'in progress → review'), said(20, 'Partner', `result check failed: one point; fix ${fix} for Worker 2`)] })
  const items = mapOf([
    step('B1', 'refined', { Goal: 'G108' }),
    step('B4', 'refined', { Goal: 'G108', 'Fix of': 'B40' }), checked('B40', 'B4'),
    step('B6', 'refined', { Goal: 'G108', 'Fix of': 'B60' }), step('B60', 'done', { Owner: 'Worker 2', Goal: 'G108' }, { History: [said(30, 'Partner', 'sent back by the person: the next try is B6')] }),
    step('B5', 'refined', { Goal: 'G108', 'Fix of': 'B50' }), step('B50', 'refined', { Goal: 'G108' }),
    step('B7', 'refined', { Goal: 'G108', 'Fix of': 'B70' }), step('B70', 'dropped', { Goal: 'G108' }, { History: [said(20, 'Partner', 'result check failed: x; fix B7 for Worker 2')] }),
    step('B8', 'refined', { Goal: 'G2', 'Fix of': 'B80' }), checked('B80', 'B8', 'G2'),
    step('B9', 'refined', { Goal: 'G108', 'Fix of': 'B90' }), step('B90', 'review', { Owner: 'Worker 2', Goal: 'G108' }, { History: [said(40, 'Worker 2', 'in progress → review')] }),
  ])
  const ready = list(items)
  const rankOf = id => ready.ready.find(one => one.id === id)?.rank ?? null
  assert.deepEqual([rankOf('B4'), rankOf('B6'), rankOf('B5'), rankOf('B7'), rankOf('B9'), rankOf('B1')], [NEARLY_RANK, NEARLY_RANK, 1, 1, 1, 1])
  assert.deepEqual(ready.held.filter(one => one.id === 'B8').map(one => one.why), [CHOICE_WHY], 'an unpicked fix round outside the focus waits for the pick')
  assert.deepEqual([isNearlyFinished(items.get('B4'), items), isNearlyFinished(items.get('B9'), items)], [true, false])
  // Picked (its root pinned): the fix round goes out, nearly finished.
  const picked = new Map(items)
  picked.set('B80', step('B80', 'review', { Owner: 'Worker 2', Goal: 'G2', Pinned: 'Worker 2' }, { History: [said(20, 'Partner', 'result check failed: one point; fix B8 for Worker 2')] }))
  assert.equal(list(picked).ready.find(one => one.id === 'B8')?.rank, NEARLY_RANK)
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
