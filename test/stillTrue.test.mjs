// P5 (2026-11-09): every item on the person's lists re-checks itself (src/stillTrue.mjs), a thin runner over tests the board already has.
// An ask of any Route whose step ended after it was filed, a wake line of a chat that ran since its failed wake, a Supervisor's alarm whose
// incidents are over: each comes down on its second pass (or a minute), with a record of why in the history. Made-up names throughout.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { gapsOf, isCameDown, notWorkedCounter, parseHistory, startGap, taskFacts, today } from '../src/history.mjs'
import { asksOf } from '../src/startupCheck.mjs'
import { CHAIN_SHOWN, chainWordsOf, incidentCards } from '../src/supervisor/cards.mjs'
import { BACKOFF_MS, MIN_AGE_MS, stillTrue, stillTruePass, wakeChatsOf } from '../src/stillTrue.mjs'
import { claim, emptyWakes, noticeOf, nothingWaitsFor, pass, sent } from '../src/wake.mjs'
import { workApi } from '../src/work/api.mjs'
import { parseItem } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, share, writeStore } from '../src/work/store.mjs'
import { openPage } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

// B917: these tests edit store files by hand and read at once; on the board a hand edit shows within share.ms.
share.ms = 0

const at = (h, m, s = 0) => new Date(2026, 10, 9, h, m, s).getTime()
const NOW = at(12, 0)
const clockOf = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${clockOf(ms)}` }

const make = fields => parseItem(`${Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${value}`).join('\n')}\n`)
const itemsOf = list => new Map(list.map(one => [one.head.get('Id'), one]))
const step = (id, state, since, more = {}) => make({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(since), ...more })
const ask = (id, of, since, more = {}) => make({ Id: id, Kind: 'ask', Title: `Question about ${of}`, State: 'open', Owner: 'Digger', Since: stamp(since), Asks: 'decide', Blocking: 'no', Of: of, Route: 'partner', ...more })

/** Asks of three routes about steps that ended after them, one that ended before, and a kept look. */
function asksStore() {
  const keptLook = parseItem(`Id: Q4\nKind: ask\nTitle: Look at B1\nState: open\nOwner: Digger\nSince: ${stamp(at(10, 0))}\nAsks: look\nBlocking: no\nOf: B1\nRoute: recap\n\n## Route\nAutopilot keeps this look for the goal's recap\n`)
  return itemsOf([
    step('B1', 'done', at(11, 0)), step('B2', 'dropped', at(10, 30)),
    ask('Q1', 'B1', at(10, 0), { Route: 'partner' }),
    ask('Q2', 'B2', at(10, 0), { Route: 'main' }),
    ask('Q3', 'B1', at(11, 30), { Route: 'partner' }),
    keptLook,
    ask('Q5', 'B1', at(10, 0), { Route: 'person' }),
    step('B3', 'in progress', at(9, 0)), ask('Q6', 'B3', at(10, 0), { Route: 'partner' }),
    // No Of: the title's B<n> names the step only for an ask routed to the person.
    make({ Id: 'Q13', Kind: 'ask', Title: 'After B1 lands, start G61 with A or B?', State: 'open', Owner: 'Digger', Since: stamp(at(10, 0)), Asks: 'decide', Blocking: 'no', Route: 'person' }),
  ])
}
const factsOf = (items, now, more = {}) => ({ state: { wakeNotice: null }, items, outbox: [], wakes: null, reports: new Map(), now, ...more })
/** The two passes a finding needs: the first notes it, the second (this much later) brings it down. */
const LATER = MIN_AGE_MS + 5000

test('asksOf with anyRoute lists every open ask with a step, never a kept look; without it only the person\'s', () => {
  const items = asksStore()
  assert.deepEqual(asksOf(items).map(one => one.id), ['Q5', 'Q13'])
  assert.deepEqual(asksOf(items, { anyRoute: true }).map(one => one.id), ['Q1', 'Q2', 'Q3', 'Q5', 'Q6', 'Q13'])
})

test('an ask of Route partner whose step ended after it comes down on the second pass, not the first; a kept look, an older step, a running step never', () => {
  const items = asksStore()
  const memory = new Map()
  assert.deepEqual(stillTrue(factsOf(items, NOW), memory).down, [], 'the first pass only notes it')
  const second = stillTrue(factsOf(items, NOW + LATER), memory).down
  assert.deepEqual(second.map(one => one.id), ['Q1', 'Q2', 'Q5', 'Q13'], 'Q3 (its step ended before it), Q4 (a kept look) and Q6 (a running step) never')
  assert.deepEqual(second.find(one => one.id === 'Q1'), { kind: 'ask', id: 'Q1', why: 'its step B1 is done (still-true)' })
  assert.equal(second.find(one => one.id === 'Q2').why, 'its step B2 is dropped (still-true)')
  // Down means gone from the memory too: a third pass finds nothing new until the item is found again.
  assert.deepEqual(stillTrue(factsOf(items, NOW + 2 * LATER), memory).down, [])
})

/** The asks the board must leave alone whatever their step does (the review of 2026-11-11, the blocker), each about the done step B1. */
function leftAloneStore() {
  const head = (id, more) => `Id: ${id}\nKind: ask\nTitle: Question ${id}\nState: open\nOwner: Digger\nSince: ${stamp(at(10, 0))}\nAsks: decide\nBlocking: no\nOf: B1\n${more}`
  const titled = route => make({ Id: `Q2${route === 'partner' ? 6 : 7}`, Kind: 'ask', Title: 'After B1 lands, start G61 with A or B?', State: 'open', Owner: 'Digger', Since: stamp(at(10, 0)), Asks: 'decide', Blocking: 'no', Route: route })
  return itemsOf([
    step('B1', 'done', at(11, 0)),
    // A worker's decide routed to the recap WITHOUT a kept line: non-blocking, its step goes on; recapAnswered owns it.
    parseItem(head('Q20', 'Route: recap\n')),
    // A recap's verdict look or do (rule 15's `mayBeHeld` leaves them too).
    parseItem(head('Q21', 'Route: partner\n').replace('Asks: decide', 'Asks: look')),
    parseItem(head('Q22', 'Route: partner\n').replace('Asks: decide', 'Asks: do')),
    // The person took it back: theirs, never closed by the board.
    parseItem(`${head('Q23', 'Route: person\n')}\n## Route\nThe person took it back from the partner\n`),
    parseItem(head('Q24', 'Route: partner\nVia: form\n')),
    parseItem(head('Q25', 'Route: partner\nVia: refine\n')),
    // The title's step names nothing for an ask that is not the person's.
    titled('partner'), titled('advice'),
  ])
}

test('the blocker: the board never takes down a recap ask, a verdict look or do, a taken-back ask, a popup, a refine question, or a partner ask the title\'s step names', () => {
  const items = leftAloneStore()
  assert.deepEqual(asksOf(items, { anyRoute: true }), [], 'asksOf lists none of them')
  const memory = new Map()
  stillTrue(factsOf(items, NOW), memory)
  assert.deepEqual(stillTrue(factsOf(items, NOW + LATER), memory).down, [])
})

test('hysteresis: two passes in a row AND the finding first found MIN_AGE_MS ago; a finding that is not found on a pass starts again', () => {
  const items = asksStore()
  const quick = new Map()
  stillTrue(factsOf(items, NOW), quick)
  assert.deepEqual(stillTrue(factsOf(items, NOW + MIN_AGE_MS - 1000), quick).down.map(one => one.id), [], 'a second pass, but under the minimum age')
  assert.deepEqual(stillTrue(factsOf(items, NOW + MIN_AGE_MS), quick).down.map(one => one.id), ['Q1', 'Q2', 'Q5', 'Q13'], 'two passes in a row and old enough')
  // Old enough but not on the pass before: no (the memory's `pass` is not the one before).
  const gap = new Map([['#pass', 5], ['ask:Q1', { firstAt: NOW - 60_000, pass: 3 }]])
  assert.deepEqual(stillTrue(factsOf(items, NOW), gap).down.map(one => one.id), [])
  const memory = new Map()
  stillTrue(factsOf(items, NOW), memory)
  stillTrue(factsOf(itemsOf([]), NOW + 1000), memory)
  assert.deepEqual(stillTrue(factsOf(items, NOW + LATER), memory).down, [])
})

test('stillTruePass: ONE batched asks-withdrawn with all ids, anyRoute, one history line each; nothing is called on the first pass', async () => {
  const items = new Map([...asksStore()].filter(([id]) => ['B1', 'B2', 'Q1', 'Q2'].includes(id)))
  const calls = []
  const written = []
  const run = now => stillTruePass({
    facts: factsOf(items, now), memory, history: async lines => { written.push(...lines) },
    apply: async body => { calls.push(body); return { ok: true, result: { withdrawn: body.withdraw.map(one => one.id) } } },
  })
  const memory = new Map()
  assert.deepEqual(await run(NOW), [])
  assert.equal(calls.length, 0)
  const came = await run(NOW + LATER)
  assert.deepEqual(came.map(one => one.id), ['Q1', 'Q2'])
  assert.deepEqual(calls, [{ action: 'asks-withdrawn', anyRoute: true, withdraw: [{ id: 'Q1' }, { id: 'Q2' }] }])
  assert.deepEqual(written, [
    { at: NOW + LATER, kind: 'came down', id: 'Q1', why: 'its step B1 is done (still-true)' },
    { at: NOW + LATER, kind: 'came down', id: 'Q2', why: 'its step B2 is dropped (still-true)' },
  ])
})

test('stillTruePass: a throw stops nothing, a refused write is left alone for BACKOFF_MS with one log line per item, and writes no history line', async () => {
  const items = asksStore()
  const logs = []
  const written = []
  const memory = new Map()
  let calls = 0
  const run = (now, apply) => stillTruePass({ facts: factsOf(items, now), memory, apply, log: line => logs.push(line), history: async lines => written.push(...lines) })
  const busy = async () => { calls += 1; throw new Error('store busy') }
  await run(NOW, busy)
  assert.equal(calls, 0, 'the first pass only notes')
  assert.deepEqual(await run(NOW + LATER, busy), [], 'a throw stops nothing')
  assert.equal(calls, 1)
  assert.equal(logs.length, 4, 'one line per item (Q1, Q2, Q5, Q13)')
  assert.match(logs[0], /^still-true: Q1 not taken down \(store busy\); not tried again for 10 min$/)
  // Every later pass inside the backoff leaves them alone: no call, no new line.
  for (let pass = 2; pass < 6; pass += 1) await run(NOW + pass * LATER, busy)
  assert.equal(calls, 1)
  assert.equal(logs.length, 4)
  // A refusal (the work API withdrew nothing) is the same: back off, no history line.
  const refusing = new Map()
  const refusals = []
  const logs2 = []
  const runRefused = now => stillTruePass({ facts: factsOf(items, now), memory: refusing, apply: async () => { refusals.push(now); return { ok: true, result: { withdrawn: [] } } }, log: line => logs2.push(line), history: async lines => written.push(...lines) })
  await runRefused(NOW)
  await runRefused(NOW + LATER)
  await runRefused(NOW + 2 * LATER)
  assert.equal(refusals.length, 1)
  assert.deepEqual(written, [], 'nothing came down')
  // After the backoff the finding is found afresh (two passes again) and tried once more.
  await runRefused(NOW + BACKOFF_MS + LATER)
  await runRefused(NOW + BACKOFF_MS + 2 * LATER)
  assert.equal(refusals.length, 2)
})

/** A store dir for the work API: asks of three routes, steps, incidents. */
async function storeDir(t, files) {
  const dir = await mkdtemp(join(tmpdir(), 'still-true-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 A fix (for Digger; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, `${name}.md`), text)
  return dir
}
const api = (dir, role) => body => workApi(body, { dir, now: NOW, prefix: '', as: role, roleOf: () => null, who: 'Main' })
const fileOf = (id, fields, extra = '') => `${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${extra}`
const askFile = (id, fields, extra = '') => fileOf(id, { Id: id, Kind: 'ask', Title: `Question about ${fields.Of}`, State: 'open', Owner: 'Digger', Since: '2026-11-09 10:00', Asks: 'decide', Blocking: 'no', ...fields }, extra)

test('the work API: asks-withdrawn with anyRoute takes a partner\'s ask (why names still-true), leaves a kept look; without it the person\'s asks only', async t => {
  const dir = await storeDir(t, {
    B50: fileOf('B50', { Id: 'B50', Kind: 'step', Title: 'Step', State: 'done', Owner: 'Digger', Since: '2026-11-09 11:00' }),
    Q60: askFile('Q60', { Of: 'B50', Route: 'partner' }),
    Q61: askFile('Q61', { Of: 'B50', Route: 'person' }),
    Q62: askFile('Q62', { Of: 'B50', Route: 'recap', Asks: 'look' }, '\n## Route\nAutopilot keeps this look for the goal\'s recap\n'),
    // The review's blocker: a recap-routed decide with no kept line, a popup, a taken-back ask, and a partner ask only the title ties to the step.
    Q63: askFile('Q63', { Of: 'B50', Route: 'recap' }),
    Q64: askFile('Q64', { Of: 'B50', Route: 'partner', Via: 'form' }),
    Q65: fileOf('Q65', { Id: 'Q65', Kind: 'ask', Title: 'After B50 lands, start G61 with A or B?', State: 'open', Owner: 'Digger', Since: '2026-11-09 10:00', Asks: 'decide', Blocking: 'no', Route: 'partner' }),
    Q66: askFile('Q66', { Of: 'B50', Route: 'person' }, '\n## Route\nThe person took it back from the partner\n'),
  })
  const plain = await api(dir, 'server')({ action: 'asks-withdrawn', withdraw: [{ id: 'Q60' }, { id: 'Q61' }, { id: 'Q62' }] })
  assert.deepEqual(plain.result.withdrawn, ['Q61'])
  const any = await api(dir, 'server')({ action: 'asks-withdrawn', anyRoute: true, withdraw: ['Q60', 'Q62', 'Q63', 'Q64', 'Q65', 'Q66'].map(id => ({ id })) })
  assert.deepEqual(any.result.withdrawn, ['Q60'], 'the recap, popup, title-only and taken-back asks stay')
  const text = await readFile(join(dir, 'Q60.md'), 'utf8')
  assert.match(text, /State: withdrawn/)
  assert.match(text, /withdrawn: its step B50 is done \(still-true\)/)
  assert.match(await readFile(join(dir, 'Q61.md'), 'utf8'), /withdrawn: its step B50 is done\n/, 'the person-route way keeps its old words')
  assert.equal((await readStore(dir)).items.get('Q62').head.get('State'), 'open')
  assert.equal((await api(dir, 'worker')({ action: 'asks-withdrawn', anyRoute: true, withdraw: [{ id: 'Q62' }] })).ok, false, 'still the board\'s alone')
})

test('the Supervisor\'s note gets Incidents from its text; it comes down once both incidents are over, not while one is open; the server takes it down with notes-came-down, which checks it again', async t => {
  const incident = (id, state) => fileOf(id, { Id: id, Kind: 'incident', Title: `Trouble ${id}`, State: state, Source: 'review-held', Subject: 'B12', Key: `k ${id}`, Since: '2026-11-09 09:00' })
  const dir = await storeDir(t, { X1: incident('X1', 'fix'), X2: incident('X2', 'open') })
  const made = await api(dir, 'server')({ action: 'note', to: 'you', text: ['Supervisor: X1 came back: stuck, and X2 with it'], of: 'X1', via: 'supervisor' })
  assert.equal(made.ok, true)
  const read = async () => [...(await readStore(dir)).items.values()]
  const note = (await read()).find(one => one.head.get('Kind') === 'note')
  const id = note.head.get('Id')
  assert.equal(note.head.get('Incidents'), 'X1, X2')
  const none = await api(dir, 'server')({ action: 'note', to: 'you', text: ['Information only'] })
  assert.equal((await read()).find(one => one.head.get('Id') === none.result.id).head.has('Incidents'), false)
  const run = async (now, apply = api(dir, 'server')) => stillTruePass({ facts: factsOf((await readStore(dir)).items, now), memory, apply, history: async lines => written.push(...lines) })
  const memory = new Map()
  const written = []
  await run(NOW)
  assert.deepEqual(await run(NOW + LATER), [], 'both incidents are still open')
  await writeFile(join(dir, 'X1.md'), incident('X1', 'fixed'))
  await run(NOW + 2 * LATER)
  assert.deepEqual(await run(NOW + 3 * LATER), [], 'X2 is still open')
  await writeFile(join(dir, 'X2.md'), incident('X2', 'gone'))
  await run(NOW + 4 * LATER)
  const came = await run(NOW + 5 * LATER)
  assert.deepEqual(came.map(one => [one.id, one.why]), [[id, 'came down: X1 fixed, X2 gone']])
  assert.deepEqual(written.map(one => [one.kind, one.id, one.why]), [['came down', id, 'came down: X1 fixed, X2 gone']])
  const done = (await read()).find(one => one.head.get('Id') === id)
  assert.equal(done.head.get('State'), 'read')
  assert.match(await readFile(join(dir, `${id}.md`), 'utf8'), /came down: X1 fixed, X2 gone/)
  // An incident the store no longer holds is gone: the note comes down too.
  const missing = await api(dir, 'server')({ action: 'note', to: 'you', text: ['Supervisor: X9 came back: lost'], via: 'supervisor' })
  assert.equal(missing.ok, true)
  const memory2 = new Map()
  await stillTruePass({ facts: factsOf((await readStore(dir)).items, NOW), memory: memory2, apply: api(dir, 'server') })
  const gone = await stillTruePass({ facts: factsOf((await readStore(dir)).items, NOW + LATER), memory: memory2, apply: api(dir, 'server') })
  assert.deepEqual(gone.map(one => one.why), ['came down: X9 gone'])
})

test('the read action stays the person alone; notes-came-down is the board alone, takes ids only and checks each note itself', async t => {
  const note = (id, more = {}) => fileOf(id, { Id: id, Kind: 'note', From: 'Board', To: 'you', Via: 'supervisor', Incidents: 'X1', State: 'unread', Since: '2026-11-09 10:00', Text: 'x', ...more })
  const incident = state => fileOf('X1', { Id: 'X1', Kind: 'incident', Title: 'Trouble', State: state, Source: 'review-held', Subject: 'B12', Key: 'k', Since: '2026-11-09 09:00' })
  const dir = await storeDir(t, { X1: incident('open'), N9: note('N9'), N10: note('N10', { Via: 'report' }), N11: note('N11', { Incidents: undefined }) })
  for (const role of ['server', 'main', 'worker']) assert.equal((await api(dir, role)({ action: 'read', id: 'N9', why: 'came down: X1 fixed' })).ok, false, `${role} may not read`)
  for (const role of ['main', 'worker', 'person']) assert.equal((await api(dir, role)({ action: 'notes-came-down', notes: ['N9'] })).ok, false, `${role} may not call notes-came-down`)
  const stateOf = async id => (await readStore(dir)).items.get(id).head.get('State')
  const open = await api(dir, 'server')({ action: 'notes-came-down', notes: ['N9'] })
  assert.deepEqual(open.result.read, [], 'X1 is still open: the server does not trust the list')
  await writeFile(join(dir, 'X1.md'), incident('fixed'))
  const done = await api(dir, 'server')({ action: 'notes-came-down', notes: ['N9', 'N10', 'N11', 'N404'] })
  assert.deepEqual(done.result.read, ['N9'], 'a note not Via supervisor, one with no incidents and a missing one are left')
  assert.deepEqual(done.result.whys, { N9: 'came down: X1 fixed' })
  assert.deepEqual([await stateOf('N9'), await stateOf('N10'), await stateOf('N11')], ['read', 'unread', 'unread'])
  assert.match(await readFile(join(dir, 'N9.md'), 'utf8'), /came down: X1 fixed/)
  assert.equal((await api(dir, 'person')({ action: 'read', id: 'N10' })).ok, true, 'the person reads as before')
  // It is in the work API's SERVER and CHANGES lists (and the table) only: never in the page's or a mod's list of actions.
  const apiSource = await readFile(join(import.meta.dirname, '..', 'src', 'work', 'api.mjs'), 'utf8')
  assert.equal([...apiSource.matchAll(/'notes-came-down'/g)].length, 4, 'CHANGES, SERVER, OFF_VIEW and the table')
  assert.doesNotMatch(await readFile(join(import.meta.dirname, '..', 'public', 'board.js'), 'utf8'), /notes-came-down/)
})

// ---- the wake notice ----

const W_SPELL = at(10, 0)
/** A record in which Worker 2's wake failed on both paths (launch 10:32, message 10:35, verdict 10:37). */
function failedRecord() {
  const record = emptyWakes()
  claim(record, { chat: 'Worker 2', spell: W_SPELL, path: 'launch', by: 'board', jobId: 'l', now: at(10, 32) })
  sent(record, 'Worker 2', 'l', at(10, 32))
  pass(record, at(10, 34, 1))
  claim(record, { chat: 'Worker 2', spell: W_SPELL, path: 'message', by: 'Advisor', jobId: 'm', now: at(10, 35) })
  sent(record, 'Worker 2', 'm', at(10, 35))
  pass(record, at(10, 37, 1))
  return record
}
const target = (more = {}) => ({ chat: 'Worker 2', spell: W_SPELL, paths: ['message', 'launch'], need: true, ...more })

test('the wake notice leaves out a chat that ran since its failed wake, and says a quiet line for a chat nothing waits for', () => {
  const record = failedRecord()
  const opts = { senderClaims: true }
  const stale = noticeOf(record, [target()], at(11, 0), clockOf, { ...opts, reports: { 'Worker 2': { state: 'idle', at: at(10, 50), run: at(10, 45) } } })
  assert.equal(stale, null, 'its session started after the failure: the line is stale')
  assert.equal(noticeOf(record, [target()], at(11, 0), clockOf, { ...opts, reports: new Map([['Worker 2', { state: 'working', at: at(10, 50), run: at(10, 45) }]]) }), null, 'a Map of reports reads the same')
  const before = noticeOf(record, [target()], at(11, 0), clockOf, { ...opts, reports: { 'Worker 2': { state: 'ended', at: at(10, 20), run: at(10, 5) } } })
  assert.equal(before.tone, 'attention')
  assert.match(before.text, /^could not wake Worker 2: the app did not start it/, 'a report from before the failure leaves the line')
  assert.equal(noticeOf(record, [target()], at(11, 0), clockOf, opts).tone, 'attention', 'no reports given: as before')
  // Quiet ONLY for a chat the caller says nothing waits for: `need: false` says only that the wake list does not name it now.
  const quiet = noticeOf(record, [target({ need: false })], at(11, 0), clockOf, { ...opts, nothingWaits: new Set(['Worker 2']) })
  assert.deepEqual(quiet, { tone: 'quiet', text: 'could not wake Worker 2 at 10:37; nothing waits for it now' })
  for (const nothingWaits of [undefined, new Set(['Worker 9'])]) {
    const held = noticeOf(record, [target({ need: false })], at(11, 0), clockOf, { ...opts, nothingWaits })
    assert.equal(held.tone, 'attention', 'it may still hold a step, a queue or a waiting word')
    assert.match(held.text, /^could not wake Worker 2: the app did not start it/)
  }
  // The tone is attention as soon as one line is a real one.
  const mixed = noticeOf(record, [target({ need: false }), { ...target(), chat: 'Worker 2', need: true }], at(11, 0), clockOf, { ...opts, nothingWaits: new Set(['Worker 2']) })
  assert.equal(mixed.tone, 'attention')
  assert.deepEqual(wakeChatsOf(quiet), ['Worker 2'])
  assert.deepEqual(wakeChatsOf({ text: 'nobody answers the board\'s wake-ups: open any chat · could not wake A B: the app did not start it (launched 10:32); open its chat' }), ['A B'])
})

test('nothingWaitsFor: no step held, none queued, no word waiting, no pause; any one of them keeps the attention line', () => {
  const lane = { name: 'Worker 2', storeSteps: [], queue: [], held: null }
  assert.equal(nothingWaitsFor(lane, {}), true)
  assert.equal(nothingWaitsFor(lane, { outbox: [{ to: 'Worker 2', state: 'taken' }, { to: 'Worker 3', state: 'waiting' }] }), true, 'a word taken, or one for another chat, waits for nobody here')
  assert.equal(nothingWaitsFor({ ...lane, storeSteps: [{ id: 'B1', state: 'in progress' }] }, {}), false, 'it holds a step')
  assert.equal(nothingWaitsFor({ ...lane, storeSteps: [{ id: 'B1', state: 'taken' }] }, {}), false)
  assert.equal(nothingWaitsFor({ ...lane, held: { id: 'B1' } }, {}), false)
  assert.equal(nothingWaitsFor({ ...lane, queue: [{ id: 'B2' }] }, {}), false, 'a step is queued for it')
  assert.equal(nothingWaitsFor({ ...lane, handover: { state: 'held' } }, {}), false)
  assert.equal(nothingWaitsFor(lane, { outbox: [{ to: 'Worker 2', state: 'waiting', command: 'handover' }] }), false, 'a word of any command waits for it')
  assert.equal(nothingWaitsFor(lane, { isPaused: true }), false, 'the board is paused')
})

test('a wake line shown on the last pass and gone now comes down with its reason in the history', async () => {
  const record = failedRecord()
  const wakes = { record, senderClaims: true, canLaunch: true }
  const memory = new Map()
  const written = []
  const run = (now, wakeNotice, reports) => stillTruePass({ facts: factsOf(itemsOf([]), now, { state: { wakeNotice }, wakes, reports }), memory, apply: async () => ({ ok: true, result: {} }), history: async lines => written.push(...lines) })
  const shown = noticeOf(record, [target()], at(11, 0), clockOf, { senderClaims: true })
  await run(at(11, 0), shown, {})
  assert.deepEqual(written, [])
  await run(at(11, 1), null, { 'Worker 2': { state: 'idle', at: at(10, 55), run: at(10, 45) } })
  assert.deepEqual(written, [{ at: at(11, 1), kind: 'came down', id: 'wake Worker 2', why: 'Worker 2 ran since its failed wake' }])
  // The notice itself is the state's: a chat that is still listed has no record.
  await run(at(11, 2), null, {})
  assert.equal(written.length, 1)
})

// ---- the incident card ----

const D = (month, day, h = 10) => stamp(new Date(2026, month - 1, day, h, 0).getTime())
function chainItems(extra = []) {
  return itemsOf([
    make({ Id: 'B978', Kind: 'step', Title: 'Fix of X1: stuck', State: 'review', Since: D(11, 4) }),
    make({ Id: 'B1011', Kind: 'step', Title: 'Second', State: 'queued', Since: D(11, 5), 'Fix of': 'B978' }),
    make({ Id: 'B1030', Kind: 'step', Title: 'Third', State: 'new', Since: D(11, 4, 12), 'Fix of': 'B1011' }),
    ...extra,
  ])
}
const incident = { id: 'X1', state: 'fix', fix: 'B978', since: at(9, 0) }

test('the incident card names the open fix chain with its dates; attention only when the end is an ask to the person', () => {
  const quiet = incidentCards({ incidents: [incident], items: chainItems() })[0]
  assert.equal(quiet.chain, 'waits for its fix B978, in review since 11-04 → B1011 → B1030, not refined since 11-04')
  assert.equal(quiet.tone, 'quiet')
  const toPerson = incidentCards({ incidents: [incident], items: chainItems([make({ Id: 'Q7', Kind: 'ask', Title: 'Which way?', State: 'open', Since: D(11, 6), Of: 'B1030', Route: 'person' })]) })[0]
  assert.equal(toPerson.tone, 'attention')
  const toPartner = incidentCards({ incidents: [incident], items: chainItems([make({ Id: 'Q7', Kind: 'ask', Title: 'Which way?', State: 'open', Since: D(11, 6), Of: 'B1030', Route: 'partner' })]) })[0]
  assert.equal(toPartner.tone, 'quiet', 'an ask to the partner is not the person\'s')
  const middle = incidentCards({ incidents: [incident], items: chainItems([make({ Id: 'Q7', Kind: 'ask', Title: 'Which way?', State: 'open', Since: D(11, 6), Of: 'B1011', Route: 'person' })]) })[0]
  assert.equal(middle.tone, 'quiet', 'the ask must be about the open END of the chain')
  // A fix alone names itself; a done fix names no chain.
  const alone = incidentCards({ incidents: [incident], items: itemsOf([make({ Id: 'B978', Kind: 'step', Title: 'Fix of X1', State: 'in progress', Since: D(11, 4) })]) })[0]
  assert.equal(alone.chain, 'waits for its fix B978, in progress since 11-04')
  const done = incidentCards({ incidents: [{ ...incident, state: 'fixed' }], items: itemsOf([make({ Id: 'B978', Kind: 'step', Title: 'Fix of X1', State: 'done', Since: D(11, 4) })]) })[0]
  assert.equal(done.chain, null)
})

test('the chain is capped at ten links, then "…"', () => {
  const links = Array.from({ length: 14 }, (_, n) => make({ Id: `B${100 + n}`, Kind: 'step', Title: `Link ${n}`, State: n === 0 ? 'review' : 'queued', Since: D(11, 4), ...(n === 0 ? {} : { 'Fix of': `B${99 + n}` }) }))
  const words = chainWordsOf('B100', itemsOf(links))
  assert.equal(CHAIN_SHOWN, 10)
  assert.equal(words.text.match(/B\d+/g).length, 10)
  // The first link with its words, "…", the last ones, and the open end with its words: the end is what the person waits for.
  assert.equal(words.text, 'waits for its fix B100, in review since 11-04 → … → B105 → B106 → B107 → B108 → B109 → B110 → B111 → B112 → B113, not taken since 11-04')
  assert.equal(words.end, 'B113', 'the end is the real open end')
})

// ---- the history line ----

test('a came-down line is kept by parseHistory and ignored by today, gapsOf, taskFacts, notWorkedCounter, startGap', () => {
  const line = { at: at(10, 30), kind: 'came down', id: 'Q1', why: 'its step B1 is done (still-true)' }
  assert.equal(isCameDown(line), true)
  assert.equal(isCameDown({ at: 1, chat: 'A', state: 'working' }), false)
  const work = (time, state, task) => ({ at: time, chat: 'Digger', state, task })
  const base = [work(at(9, 0), 'working', 'Plant'), { at: at(10, 0), gap: true }, work(at(11, 0), 'working', 'Plant')]
  const mixed = [base[0], base[1], line, base[2]]
  assert.deepEqual(parseHistory(mixed.map(one => JSON.stringify(one)).join('\n')), mixed, 'the line survives a restart (it is read back)')
  const range = { from: at(8, 0), to: at(13, 0), names: ['Digger'] }
  assert.deepEqual(today(mixed, range), today(base, range))
  assert.deepEqual(gapsOf(mixed, at(13, 0)), gapsOf(base, at(13, 0)), 'the line is no end of the gap')
  assert.deepEqual(taskFacts(mixed, 'Digger', 'Plant', at(13, 0)), taskFacts(base, 'Digger', 'Plant', at(13, 0)))
  assert.equal(notWorkedCounter(mixed, 'Digger', at(13, 0))(at(8, 0)), notWorkedCounter(base, 'Digger', at(13, 0))(at(8, 0)))
  // A last line that came down does not hide that the board was off.
  assert.deepEqual(startGap([...base, line], null, at(15, 0)), startGap(base, null, at(15, 0)))
})

// ---- links ----

const script = await readFile(join(import.meta.dirname, '..', 'public', 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))

/** A tiny element, enough for `chatPieces`: the page's own code runs in a vm with it as `el`. */
function fakeEl(tag, className, text) {
  return { tag, className, text, dataset: {}, children: [], append(...more) { this.children.push(...more) } }
}

test('chatPieces turns each chat name into a link to its task window and leaves the words alone; the longest name first', () => {
  const sandbox = { el: fakeEl }
  vm.runInNewContext(`${cut('chatlinks')}\nthis.chatPieces = chatPieces`, sandbox)
  const out = sandbox.chatPieces('Cut off in the middle of a task: Game - Worker 1, Worker 1.', ['Worker 1', 'Game - Worker 1'])
  assert.deepEqual(JSON.parse(JSON.stringify(out.map(one => (typeof one === 'string' ? one : [one.text, one.dataset.place])))), [
    'Cut off in the middle of a task: ', ['Game - Worker 1', '#task=Game%20-%20Worker%201'], ', ', ['Worker 1', '#task=Worker%201'], '.',
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.chatPieces('nothing to link', []))), ['nothing to link'])
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.chatPieces('Worker (2) a+b', ['Worker (2)', 'a+b']).filter(one => typeof one !== 'string').map(one => one.text))), ['Worker (2)', 'a+b'], 'a name with signs needs no escaping')
})

const linksOf = node => [...node.querySelectorAll('button.ask-link')].map(one => [one.textContent, one.dataset.place])

/** The page's state with Lead running, Digger off (a window opens) and Napper asleep (nothing opens), as the board builds lanes. */
function pageState() {
  const base = asSent(build([]))
  const lane = more => ({ ...base.chats[1], isRunning: false, ...more })
  return { ...base, chats: [base.chats[0], lane({ name: 'Digger', title: 'Digger', status: 'Not running', state: 'off' }), lane({ name: 'Napper', title: 'Napper', status: 'Asleep', state: 'free', asleep: true })] }
}

test('the page draws the wake notice and the restart banner cut-off chats as links only where a window opens; a role chat and an asleep lane stay plain words', async () => {
  const state = {
    ...pageState(),
    wakeNotice: { tone: 'attention', text: 'could not wake Digger: the app did not start it (launched 10:32); no report after the message for B12 (sent 10:35 by Advisor); open its chat · could not wake Napper: no id; open its chat · could not wake Advisor: no id; open its chat' },
    restart: { off: null, main: 'Garden · Lead', interrupted: ['Digger', 'Napper'], notRunning: [], starting: [], copied: null },
  }
  const page = await openPage({ state })
  try {
    const notice = page.find('#needs .nobody-runs')
    assert.match(notice.textContent, /^Could not wake Digger: the app did not start it \(launched 10:32\); no report after the message for B12/)
    assert.deepEqual(linksOf(notice).filter(one => one[1] !== undefined), [['Digger', '#task=Digger']], 'Napper (asleep) and Advisor (a role chat) open nothing: plain words')
    assert.match(notice.textContent, /could not wake Napper: no id; open its chat · could not wake Advisor: no id/)
    assert.equal(notice.querySelectorAll('[data-ask-link="B12"]').length, 1, 'a step id in the notice is a link to its step')
    const banner = page.all('#restart p').find(one => /Cut off/.test(one.textContent))
    assert.equal(banner.textContent, 'Cut off in the middle of a task: Digger, Napper.')
    assert.deepEqual(linksOf(banner), [['Digger', '#task=Digger']])
  } finally { await page.close() }
})

test('a quiet notice is not in the attention class and leaves the empty line "Nothing waits for you."; an attention notice hides it', async () => {
  const state = { ...pageState(), restart: { off: null, main: 'Garden · Lead', interrupted: [], notRunning: [], starting: [], copied: null } }
  const quiet = await openPage({ state: { ...state, wakeNotice: { tone: 'quiet', text: 'could not wake Digger at 10:37; nothing waits for it now' } } })
  try {
    assert.equal(quiet.all('#needs .nobody-runs').length, 0)
    assert.match(quiet.find('#needs .nobody-runs-quiet').textContent, /nothing waits for it now/)
    assert.equal(quiet.find('#needs .empty').textContent, 'Nothing waits for you.', 'a quiet notice is information: the empty line stays')
  } finally { await quiet.close() }
  const loud = await openPage({ state: { ...state, wakeNotice: { tone: 'attention', text: 'could not wake Digger: the app did not start it (launched 10:32); open its chat' } } })
  try {
    assert.equal(loud.all('#needs .empty').length, 0, 'an attention notice is something that waits for the person')
  } finally { await loud.close() }
})

test('the incident card is drawn with the card\'s own tone when it names its fix chain, else with its chip\'s tone', () => {
  const names = ['incidentCardOf', 'gistOf', 'seenOf', 'lastSeenWords']
  const source = names.map(name => script.slice(script.indexOf(`function ${name}(`), script.indexOf('\n}\n', script.indexOf(`function ${name}(`)) + 3)).join('\n')
  const consts = ['const EVIDENCE_SHOWN', 'const TRAILING_SMALL'].map(head => script.slice(script.indexOf(head), script.indexOf('\n', script.indexOf(head)))).join('\n')
  const sandbox = { clock: ms => String(ms) }
  vm.runInNewContext(`${consts}\n${source}\nthis.incidentCardOf = incidentCardOf`, sandbox)
  const cardOf = more => JSON.parse(JSON.stringify(sandbox.incidentCardOf({
    key: 'B978', step: 'B978', title: 'Fix of X1', state: { text: 'in review', tone: 'review' }, phase: 'review', incidents: [{ id: 'X1', word: null }], ...more,
  }, new Map([['X1', { id: 'X1', title: 'Stuck', state: 'fix', fix: 'B978', count: 1, firstSeen: 1, lastSeen: 1, evidence: null }]]))))
  const plain = cardOf({})
  assert.deepEqual([plain.tone, plain.lines.length], ['review', 1], 'no chain: the chip\'s tone, as before')
  const toPerson = cardOf({ chain: 'waits for its fix B978, in review since 11-04 → B1011', tone: 'attention' })
  assert.equal(toPerson.tone, 'attention')
  assert.equal(toPerson.lines.at(-1), 'waits for its fix B978, in review since 11-04 → B1011')
  assert.equal(cardOf({ chain: 'waits for its fix B978, in review since 11-04', tone: 'quiet' }).tone, 'quiet')
  // The tone has a class: the chip's CSS for both words exists.
  return readFile(join(import.meta.dirname, '..', 'public', 'board.css'), 'utf8').then(css => {
    assert.match(css, /\.inc-state\.is-attention \{/)
    assert.match(css, /\.inc-state\.is-quiet \{/)
  })
})

test('server.mjs: the pass reads the kept work and the state last built, never readStore, and resets only for what was written in the store', async () => {
  const server = await readFile(join(import.meta.dirname, '..', 'server.mjs'), 'utf8')
  const pass = server.slice(server.indexOf("loops.run('still-true'"), server.indexOf("loops.run('evaluate-again'"))
  assert.match(pass, /const stored = await work\(\)/)
  assert.match(pass, /readState\.last\(\) \?\? await readState\(\)/)
  assert.match(pass, /items: stored\.items/)
  assert.doesNotMatch(pass, /readStore\(/, 'a deep copy of the whole store every pass is what the kept read saves')
  assert.match(pass, /came\.some\(one => one\.kind !== 'wake'\)/, 'a wake line is a history line alone: nothing to reset')
})
