// B775: "Find obsolete items": the check's start (open items with their evidence, one check at a time), the Advisor's
// verdicts (`work obsolete`), and the person's close of the ticked ones. Temporary stores, made-up items; no word names
// a project. The case it was made for: refine questions on steps built outside the board, a Do left from an outage.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { serializeItem } from '../../src/work/item.mjs'
import { LATE_MS, obsoleteView, openItemsOf, parseObsolete } from '../../src/work/obsolete.mjs'
import { workApi } from '../../src/work/api.mjs'
import { readStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 28, 16, 0).getTime()
const ROLES = { Lead: 'main', Painter: 'worker', Mason: 'worker', Partner: 'advisor' }

const entry = (head, sections = {}) => ({ head: new Map(Object.entries(head).filter(([, value]) => value !== null)), sections: new Map(Object.entries(sections)) })
const step = (id, state, more = {}) => entry({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: '2026-10-28 09:00', ...more })
const ask = (id, of, more = {}) => entry({ Id: id, Kind: 'ask', Title: `Question ${id}`, State: 'open', Owner: 'Partner', Since: '2026-10-28 09:10', Of: of, Asks: 'decide', ...more })
const incident = (id, more = {}) => entry({ Id: id, Kind: 'incident', Title: `Incident ${id}`, State: 'open', Source: 'sweep', Subject: 'Painter', Key: `k ${id}`, Since: '2026-10-28 09:20', 'First seen': '2026-10-28 09:20', Count: '1', ...more })

/** A store with: B1 and B2 refined (built since, outside the board), B3 in progress (a worker holds it), refine questions on each, a Do, an incident. */
async function garden(t, { evidence = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'obsolete-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await mkdir(dir, { recursive: true })
  const items = [
    step('B1', 'refined'), step('B2', 'refined'), step('B3', 'in progress', { Owner: 'Painter' }), step('B4', 'waiting on you', { Owner: 'Mason' }),
    ask('Q1', 'B1', { Via: 'refine' }), ask('Q2', 'B1', { Via: 'refine' }), ask('Q3', 'B2', { Via: 'refine' }), ask('Q4', 'B3', { Via: 'refine' }),
    ask('Q5', null, { Asks: 'do', Owner: 'Painter', Title: 'Restart the board' }),
    ask('Q6', 'B4', { Owner: 'Mason', Blocking: 'yes' }),
    ask('Q7', 'B2', { Route: 'partner', Via: '-' }),
    ask('Q8', 'B2', { State: 'answered' }),
    incident('X1'), incident('X2', { State: 'fixed' }), incident('X3', { State: 'fix', Fix: 'B3' }),
  ]
  for (const one of items) await writeFile(join(dir, `${one.head.get('Id')}.md`), serializeItem(one))
  let clock = NOW
  const ctx = () => ({ dir, now: clock, prefix: '', roleOf: chat => ROLES[chat] ?? null, ...(evidence === null ? {} : { obsoleteEvidence: evidence }) })
  return {
    dir,
    tick: minutes => { clock += minutes * MIN },
    person: body => workApi(body, { ...ctx(), as: 'person' }),
    chat: (chat, body) => workApi({ chat, ...body }, ctx()),
    item: async id => (await readStore(dir)).items.get(id),
    file: async () => parseObsolete(await readFile(join(dir, 'obsolete-check.json'), 'utf8').catch(() => null)),
  }
}
const state = item => item.head.get('State')
const history = item => item.sections.get('History') ?? []
const POINTS = [
  'obsolete: Q1 · B1 was built since · commit abc1234 names B1',
  'obsolete: Q2 · B1 was built since · commit abc1234 names B1',
  'obsolete: Q3 · B2 was built since · commit def5678 names B2',
  'unsure: Q4 · B3 is at work · its worker wrote an hour ago',
  'obsolete: Q5 · the outage ended · the board restarted since',
  'open: Q6 · its worker still waits · B4 is waiting on you',
  'obsolete: X1 · it did not come back · last seen 3 days ago',
]

test('the open items a check judges: asks for the person (refine questions and Do among them) and incidents not fixed, closed or being fixed', async t => {
  const s = await garden(t)
  const open = openItemsOf((await readStore(s.dir)).items)
  assert.deepEqual(open.map(one => [one.id, one.kind]), [['Q1', 'refine'], ['Q2', 'refine'], ['Q3', 'refine'], ['Q4', 'refine'], ['Q5', 'do'], ['Q6', 'ask'], ['X1', 'incident']])
})

test('Find obsolete items: the person starts a check with each item\'s evidence; the board then types it (result.obsoleteCheck); one at a time, late after 15 minutes', async t => {
  const asked = []
  const s = await garden(t, { evidence: async open => { asked.push(open.map(one => one.id)); return new Map(open.map(one => [one.id, [`evidence of ${one.id}`]])) } })
  const started = await s.person({ action: 'obsolete-check' })
  assert.equal(started.ok, true)
  assert.deepEqual(started.result.obsoleteCheck.ids, ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'X1'])
  // Never `check`: that field starts the board's own check of a reported step (server.mjs workAction).
  assert.equal(started.result.check, undefined)
  assert.deepEqual(asked, [['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'X1']])
  const record = await s.file()
  assert.equal(record.state, 'checking')
  assert.deepEqual(record.items.find(one => one.id === 'Q3').evidence, ['evidence of Q3'])
  // Nothing is closed by the start.
  assert.equal(state(await s.item('Q1')), 'open')
  // Two checks at once: refused, and the first stands.
  s.tick(5)
  const twice = await s.person({ action: 'obsolete-check' })
  assert.equal(twice.ok, false)
  assert.equal(twice.status, 409)
  assert.equal((await s.file()).at, NOW)
  assert.equal(asked.length, 1)
  // The page's view: checking, then late; the next check may start.
  assert.equal(obsoleteView(await s.file(), { now: NOW + 5 * MIN, openCount: 7 }).state, 'checking')
  assert.equal(obsoleteView(await s.file(), { now: NOW + LATE_MS, openCount: 7 }).state, 'late')
  s.tick(10)
  assert.equal((await s.person({ action: 'obsolete-check' })).ok, true)
  assert.equal((await s.file()).at, NOW + 15 * MIN)
})

test('with nothing open there is nothing to check, and the person alone starts a check', async t => {
  const s = await garden(t)
  assert.equal((await s.chat('Painter', { action: 'obsolete-check' })).ok, false, 'a worker')
  assert.equal((await s.chat('Partner', { action: 'obsolete-check' })).ok, false, 'the partner')
  for (const id of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']) await s.person({ action: 'tick', id })
  await s.chat('Partner', { action: 'drop', id: 'X1', why: 'handled' })
  const none = await s.person({ action: 'obsolete-check' })
  assert.equal(none.ok, true)
  assert.equal(none.result.none, true)
  assert.equal(none.result.obsoleteCheck, undefined)
  assert.equal(none.result.check, undefined)
  assert.equal(await s.file(), null)
})

test('the Advisor reads the check with `work obsolete` and answers once; its verdicts come back as the page\'s rows, obsolete ones ticked', async t => {
  const s = await garden(t, { evidence: async open => new Map(open.map(one => [one.id, [`${one.id}: its step stands refined`]])) })
  assert.equal((await s.chat('Partner', { action: 'obsolete' })).status, 409, 'no check asked yet')
  await s.person({ action: 'obsolete-check' })
  const read = await s.chat('Partner', { action: 'obsolete' })
  assert.equal(read.ok, true)
  assert.equal(read.result.changed, false)
  assert.match(read.result.text, /Q1 \(refine question of B1\): Question Q1\n {2}· Q1: its step stands refined/)
  assert.equal((await s.chat('Painter', { action: 'obsolete', points: POINTS })).ok, false, 'a worker gives no verdict')
  assert.equal((await s.person({ action: 'obsolete', points: POINTS })).ok, false, 'nor does the person')
  const done = await s.chat('Partner', { action: 'obsolete', points: POINTS })
  assert.equal(done.ok, true)
  assert.match(done.result.text, /Recorded 7 verdicts: 5 obsolete, 1 unsure, 1 open/)
  const view = obsoleteView(await s.file(), { now: NOW, openCount: 7 })
  assert.equal(view.state, 'done')
  assert.deepEqual(view.rows.map(row => [row.id, row.verdict, row.ticked]), [
    ['Q1', 'obsolete', true], ['Q2', 'obsolete', true], ['Q3', 'obsolete', true], ['Q5', 'obsolete', true], ['X1', 'obsolete', true], ['Q4', 'unsure', false], ['Q6', 'open', false]])
  assert.deepEqual([view.rows[0].why, view.rows[0].evidence], ['B1 was built since', 'commit abc1234 names B1'])
  // Once: a second answer is refused.
  assert.equal((await s.chat('Partner', { action: 'obsolete', points: POINTS })).status, 409)
  // Nothing was closed by the verdicts.
  for (const id of ['Q1', 'Q5', 'X1']) assert.notEqual(state(await s.item(id)), 'closed')
  assert.equal(state(await s.item('Q1')), 'open')
})

test('a verdict for an id the check does not hold, or a line that is none, refuses the whole answer; one not open any more is left out', async t => {
  const s = await garden(t)
  await s.person({ action: 'obsolete-check' })
  // Q8 is answered, Q7 goes to the partner, X2 is fixed: never in the check.
  const unknown = await s.chat('Partner', { action: 'obsolete', points: ['obsolete: Q1 · built · commit', 'obsolete: Q8 · answered · it is'] })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.status, 400)
  assert.match(unknown.why, /Q8 is not in this check/)
  const bad = await s.chat('Partner', { action: 'obsolete', points: ['probably obsolete: Q1'] })
  assert.equal(bad.status, 400)
  assert.equal((await s.file()).state, 'checking', 'nothing was recorded')
  // Q2 is answered meanwhile: its verdict is left out.
  await s.person({ action: 'tick', id: 'Q2' })
  assert.equal((await s.chat('Partner', { action: 'obsolete', points: ['obsolete: Q1 · built · commit', 'obsolete: Q2 · built · commit'] })).ok, true)
  const record = await s.file()
  assert.deepEqual(record.items.map(one => one.id).includes('Q2'), false)
  assert.deepEqual(Object.keys(record.verdicts), ['Q1'])
  // An item the Advisor gave no line is unsure, never ticked.
  const view = obsoleteView(record, { now: NOW, openCount: 5 })
  assert.deepEqual(view.rows.filter(row => row.id === 'Q3').map(row => [row.verdict, row.ticked]), [['unsure', false]])
})

test('Close the ticked closes only the ticked ones: a refine question ticks its step and is withdrawn, a Do is withdrawn, an incident is closed; none is woken', async t => {
  const s = await garden(t)
  await s.person({ action: 'obsolete-check' })
  await s.chat('Partner', { action: 'obsolete', points: POINTS })
  s.tick(30)
  const closed = await s.person({ action: 'obsolete-close', ids: ['Q1', 'Q3', 'Q5', 'X1'] })
  assert.equal(closed.ok, true)
  assert.deepEqual(closed.result.closed, ['Q1', 'Q3', 'Q5', 'X1'])
  assert.deepEqual(closed.result.failed, [])
  // No wake of any chat: the answer carries no word to the asking chat or the step's owner.
  assert.equal(closed.result.wake, undefined)
  assert.equal(closed.result.wakeOwner, undefined)
  // The refine questions: their steps are done, they are withdrawn with the why, by the person.
  for (const id of ['B1', 'B2']) assert.equal(state(await s.item(id)), 'done', id)
  for (const id of ['Q1', 'Q3']) {
    const one = await s.item(id)
    assert.equal(state(one), 'withdrawn', id)
    assert.match(history(one).at(-1), /person: withdrawn: obsolete: B[12] was built since$/)
  }
  assert.equal(state(await s.item('Q5')), 'withdrawn')
  const x1 = await s.item('X1')
  assert.equal(state(x1), 'closed')
  assert.match(history(x1).at(-1), /person: closed: obsolete: it did not come back$/)
  // Not ticked: untouched, whatever its verdict.
  assert.equal(state(await s.item('Q2')), 'open', 'obsolete but not ticked')
  assert.equal(state(await s.item('Q4')), 'open', 'unsure')
  assert.equal(state(await s.item('Q6')), 'open', 'open')
  assert.equal(state(await s.item('B3')), 'in progress')
  // The check keeps what is left, with what the close did.
  const record = await s.file()
  assert.deepEqual(record.items.map(one => one.id), ['Q2', 'Q4', 'Q6'])
  assert.deepEqual(record.last, { at: NOW + 30 * MIN, closed: 4 })
})

test('a refine question of a step a worker holds is only withdrawn: the step keeps its state; a step waiting on an ask goes on when it is withdrawn', async t => {
  const s = await garden(t)
  await s.person({ action: 'obsolete-check' })
  await s.chat('Partner', { action: 'obsolete', points: ['obsolete: Q4 · stale · none', 'obsolete: Q6 · its worker went on · none'] })
  const closed = await s.person({ action: 'obsolete-close', ids: ['Q4', 'Q6'] })
  assert.deepEqual(closed.result.closed, ['Q4', 'Q6'])
  assert.equal(state(await s.item('B3')), 'in progress', 'the held step is not ticked')
  assert.equal(state(await s.item('Q4')), 'withdrawn')
  assert.equal(state(await s.item('B4')), 'in progress', 'the step that waited on Q6 goes on')
})

test('Close the ticked refuses an id the check does not hold (nothing closed), and needs an answered check and at least one tick', async t => {
  const s = await garden(t)
  assert.equal((await s.person({ action: 'obsolete-close', ids: ['Q1'] })).status, 409, 'no check')
  await s.person({ action: 'obsolete-check' })
  assert.equal((await s.person({ action: 'obsolete-close', ids: ['Q1'] })).status, 409, 'not answered yet')
  await s.chat('Partner', { action: 'obsolete', points: POINTS })
  assert.equal((await s.person({ action: 'obsolete-close', ids: [] })).status, 400, 'no tick')
  const unknown = await s.person({ action: 'obsolete-close', ids: ['Q1', 'Q7'] })
  assert.equal(unknown.status, 400)
  assert.match(unknown.why, /Q7: not in the check/)
  assert.equal(state(await s.item('Q1')), 'open')
  // Only the person closes.
  assert.equal((await s.chat('Partner', { action: 'obsolete-close', ids: ['Q1'] })).ok, false)
  assert.equal((await s.chat('Lead', { action: 'obsolete-close', ids: ['Q1'] })).ok, false)
  assert.equal(state(await s.item('Q1')), 'open')
})

test('an item that was answered after the check is reported as not closed, and the rest still close', async t => {
  const s = await garden(t)
  await s.person({ action: 'obsolete-check' })
  await s.chat('Partner', { action: 'obsolete', points: POINTS })
  await s.person({ action: 'tick', id: 'Q5' })
  const closed = await s.person({ action: 'obsolete-close', ids: ['Q5', 'X1'] })
  assert.deepEqual(closed.result.closed, ['X1'])
  assert.deepEqual(closed.result.failed, [{ id: 'Q5', why: 'Q5 is not open any more.' }])
  assert.match(closed.result.text, /Closed 1: X1; not closed: Q5/)
})

test('the incident drop stays the partner\'s: the person\'s `drop X1` is refused as before', async t => {
  const s = await garden(t)
  assert.equal((await s.person({ action: 'drop', id: 'X1', why: 'no' })).ok, false)
  assert.equal(state(await s.item('X1')), 'open')
})
