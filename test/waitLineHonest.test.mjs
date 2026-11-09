// P3 of T2.11 (the plan .claude/plans/2026-11-09-one-wait-system-plan.md, "The wait line: records, honest limits, no silent end"; the
// person, 2026-11-09: "i dont want to wait for a week"). The wait line says only what the board KNOWS: a record (`pickedUpAt`, written
// once), a count from the right moment, a Late only for a real stop, and no wait that ends without a trace. One test per point; the real
// case is Worker 3's answer to Q707 (the live word 6deb6aaed6a78d49 and the chat's real report, data/reports.json 2026-11-09): its chat
// ended on that word, and the line read "waits for its turn" for ever.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { memoryStore } from '../src/store.mjs'
import { wordJudge } from '../src/supervisor/index.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { lastGoodWaits, runningOf, waitLineOf, waitsOf } from '../src/waitLine.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 9, 13, 0).getTime()
const at = minutesAgo => NOW - minutesAgo * MIN
const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const keep = buildView({ state: { chats: [], chatPrefix: '' }, outbox: [], settings: {}, now: NOW }).keep

const lane = (more = {}) => ({ name: 'Advisor', isRunning: true, status: 'Working', state: 'working', report: null, wake: null, ...more })
const judgeFor = (outbox, advisor = lane(), { now = NOW, pause = null } = {}) => wordJudge({ state: { chats: [], advisor, pause, chatPrefix: '' }, outbox, settings: {}, now })
/** A word of the person's (an answer), typed into its chat 10 minutes ago unless told otherwise. */
const word = (more = {}) => ({ id: 'w1', to: 'Advisor', ask: 'work:Q1', command: null, text: 'Yes, please', at: at(12), state: 'delivered', takenAt: at(10), deliveredAt: at(10) + 1000, ...more })
const report = (state, since, more = {}) => ({ state, since, background: false, run: 1, seq: 1, busyAt: since, at: NOW - 2000, ...more })
function lineOf(w, { advisor = lane(), rep = null, ahead = false, pause = null, outbox = [w], now = NOW, ...more } = {}) {
  return waitLineOf({ word: w, lane: advisor, report: rep, ahead, wake: advisor.wake, now, keep, queue: 0, judge: judgeFor(outbox, advisor, { now, pause }), paused: false, running: runningOf({ pause }, now), ...more })
}

// ---- The real case: Worker 3, Q707's answer (real word id, times and report; data/reports.json) ----
const REAL_AT = 1794223136767
const REAL_REPORT = { state: 'ended', since: 1794224044517, background: false, run: 1794217043439, seq: 1477, word: '6deb6aaed6a78d49', turn: 1794223140071, at: 1794224044522, mod: '0.31.0', busyAt: 1794223140080 }
const REAL_WORD = { id: '6deb6aaed6a78d49', to: 'Worker 3', ask: 'work:Q707', step: 'Q707', text: 'Yes', at: REAL_AT, state: 'delivered', takenAt: REAL_AT + 2000, deliveredAt: REAL_AT + 3000 }

test('the real case: Worker 3 ended its session on Q707\'s answer: Late "no answer since", never "waits for its turn" (it read so before)', () => {
  const now = REAL_REPORT.since + 8 * MIN
  const worker = lane({ name: 'Worker 3', status: 'Not running', state: 'off', isRunning: true })
  const found = waitsOf({ state: { chats: [worker], advisor: null }, outbox: [REAL_WORD], now, keep, judge: judgeFor([REAL_WORD], lane({ name: 'Worker 3' }), { now }), reports: new Map([['Worker 3', REAL_REPORT]]) })['6deb6aaed6a78d49']
  assert.equal(found.state, 'late')
  assert.equal(found.lead, `No answer since ${hhmm(REAL_REPORT.since)}`)
  assert.match(found.rest, /Worker 3 was on it since \d\d:\d\d; its chat stopped · open Worker 3's chat: the word waits there/)
  assert.equal(found.canSendAgain, false, 'no Send again for a running chat: the person opens its chat')
})

// ---- Bullet 1: pickedUpAt, written once ----
test('pickedUpAt: the first busy report that names the word is the record; the line reads it once written; the store never overwrites it', async () => {
  const w = word()
  const busy = report('busy', at(8), { word: 'w1', turn: at(8) })
  const first = lineOf(w, { rep: busy })
  assert.deepEqual([first.state, first.rest, first.seen], ['picked-up', `since ${hhmm(at(8))}`, { pickedUpAt: at(8) }], 'the first sight asks for the record')
  // Written: the line reads the record, and asks for nothing; a later report of another turn does not undo it.
  const kept = { ...w, pickedUpAt: at(8) }
  const later = lineOf(kept, { rep: report('busy', at(1), { word: 'other', turn: at(1) }), ahead: true })
  assert.deepEqual([later.state, later.rest, later.seen], ['picked-up', `since ${hhmm(at(8))}`, null], 'the record, not the live report alone')
  // The store keeps the first time.
  const store = memoryStore()
  await store.say({ ...w })
  await store.update('w1', { pickedUpAt: at(8) })
  await store.update('w1', { pickedUpAt: at(2) })
  assert.equal(store.outbox().find(one => one.id === 'w1').pickedUpAt, at(8), 'written once')
  await store.update('w1', { answeredAt: at(1) })
  assert.equal(store.outbox().find(one => one.id === 'w1').answeredAt, at(1), 'other fields still change')
  // The server asks for it only when the word has none.
  const server = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8')
  assert.match(server, /Object\.hasOwn\(fields, 'pickedUpAt'\) \? !Number\.isFinite\(word\?\.pickedUpAt\)/)
})

// ---- Bullet 2: waiting for its turn, counted from the end of the turn ahead ----
test('waiting for its turn: quiet while the chat is busy on something else; counted from the END of that turn, not from the delivery', () => {
  const w = word({ at: at(62), takenAt: at(60), deliveredAt: at(60) + 1000 })
  // Busy on another turn (begun before the word arrived) for an hour: quiet, whose turn it is.
  const busy = lineOf(w, { rep: report('busy', at(90), { word: 'other', turn: at(90) }) })
  assert.deepEqual([busy.state, busy.rest], ['sent', `waits for its turn: Advisor busy since ${hhmm(at(90))}`])
  // That turn ended 5 minutes ago: counted from then (5 min), not from the delivery an hour ago.
  const justEnded = lineOf(w, { rep: report('idle', at(5), { word: 'other', turn: at(90) }) })
  assert.equal(justEnded.state, 'sent', 'five minutes since the turn ahead ended is under the limit')
  // Idle for 20 minutes and still not picked up: Late, from the END of the turn ahead.
  const stuck = lineOf(w, { rep: report('idle', at(20), { word: 'other', turn: at(90) }) })
  assert.deepEqual([stuck.state, stuck.lead], ['late', `No answer since ${hhmm(at(20))}`])
  assert.match(stuck.rest, /open Advisor's chat: the word waits there/)
})

// ---- Bullet 3: on it, Late only for a stop or a stale report ----
test('on it: Late only when the chat stopped or its report went stale; a fresh turn that runs long is quiet "on it for 95 min"', () => {
  const w = word({ at: at(100), takenAt: at(98), deliveredAt: at(98) + 1000 })
  const busy = report('busy', at(95), { word: 'w1', turn: at(95) })
  const long = lineOf(w, { rep: busy })
  assert.deepEqual([long.state, long.lead, long.rest], ['picked-up', 'Advisor is on it', `since ${hhmm(at(95))} · for 95 min`])
  const stopped = lineOf({ ...w, pickedUpAt: at(95) }, { rep: { ...busy, state: 'ended', since: at(30) } })
  assert.deepEqual([stopped.state, stopped.lead], ['late', `No answer since ${hhmm(at(30))}`])
  const stale = lineOf({ ...w, pickedUpAt: at(95) }, { rep: { ...busy, at: NOW - 3 * MIN } })
  assert.deepEqual([stale.state, stale.lead], ['late', `No answer since ${hhmm(NOW - 3 * MIN)}`])
  assert.match(stale.rest, /its chat went quiet/)
  const gone = lineOf({ ...w, pickedUpAt: at(95) }, { advisor: lane({ isRunning: false, status: 'Not running' }), rep: busy })
  assert.equal(gone.state, 'late', 'the lane does not run')
  assert.equal(gone.canSendAgain, true, 'a chat that does not run can be woken again')
})

// ---- Bullet 4: turn ended without it, 5 min grace ----
test('turn ended without it (a place with a result of its own): quiet for 5 minutes, then Late', () => {
  const w = { ...word(), ask: null, command: 'recap-feedback', backSteps: ['B1'], answeredAt: at(4) }
  const quiet = lineOf(w, {})
  assert.deepEqual([quiet.state, quiet.lead], ['sent', `Advisor's turn ended at ${hhmm(at(4))} without it`])
  const late = lineOf({ ...w, answeredAt: at(6) }, {})
  assert.deepEqual([late.state, late.lead], ['late', `No answer since ${hhmm(at(6))}`])
  assert.match(late.rest, /turn ended at \d\d:\d\d without it · open Advisor's chat: the word waits there/)
})

// ---- Bullet 5: merged prompts, never Late ----
test('merged prompts: a turn that began after the word arrived, on a word ahead of it, may have taken it: quiet, never Late', () => {
  const w = word({ at: at(80), takenAt: at(79), deliveredAt: at(79) })
  const turn = lineOf(w, { rep: report('busy', at(70), { word: 'ahead', turn: at(70) }), ahead: true })
  assert.deepEqual([turn.state, turn.rest], ['sent', `Advisor's turn at ${hhmm(at(70))} may have taken it (not confirmed)`])
  const over = lineOf(w, { rep: report('idle', at(60), { word: 'ahead', turn: at(70) }), ahead: true })
  assert.deepEqual([over.state, over.rest], ['sent', `Advisor's turn at ${hhmm(at(70))} may have taken it (not confirmed)`], 'an hour idle: still quiet')
})

// ---- Bullet 6: Late counts running time after pauses, and names the person's action ----
test('Late counts the board\'s running time (a pause\'s end, the board\'s off time); the person\'s action is named', () => {
  const w = { ...word(), ask: null, command: 'recap-feedback', backSteps: ['B1'], answeredAt: at(30) }
  // The chats were paused until 3 minutes ago: the turn that ended 30 minutes ago has been Late for 3 running minutes only.
  assert.equal(lineOf(w, { pause: { state: 'running', since: at(3) } }).state, 'sent', 'inside the grace after the pause')
  assert.equal(lineOf(w, { pause: { state: 'running', since: at(7) } }).state, 'late')
  // The board itself did not run for 28 of the 30 minutes (a sleeping PC).
  const running = runningOf({ gaps: [{ from: at(29), to: at(1) }] }, NOW)
  assert.equal(running(at(30)), 2 * MIN)
  assert.equal(lineOf(w, { running: running }).state, 'sent')
  // rule 8's Late: "Not picked up after N min" is N running minutes.
  const waiting = word({ state: 'waiting', at: at(30), takenAt: undefined, deliveredAt: undefined })
  const late = lineOf(waiting, { pause: { state: 'running', since: at(11) } })
  assert.deepEqual([late.state, late.lead], ['late', 'Not picked up after 11 min'])
  assert.match(late.rest, /open Advisor's chat: the word waits there/, 'the person\'s action, until Send again exists for a running chat')
})

// ---- Bullet 7: closed: <why> for 10 minutes ----
test('a word the sweep closes says "closed: <why>" quietly for 10 minutes, then goes', () => {
  const dropped = word({ state: 'dropped', why: 'B12 is no longer given to Worker 2', closedAt: at(4), command: 'refine', ask: null, deliveredAt: undefined, takenAt: undefined })
  const line = lineOf(dropped)
  assert.deepEqual([line.state, line.lead], ['closed', 'closed: B12 is no longer given to Worker 2'])
  assert.equal(lineOf({ ...dropped, closedAt: at(11) }), null, 'after ten minutes')
  // A word not yet closed that the sweep would close names the sweep's own reason.
  const older = word({ id: 'w0', command: 'obsolete-check', about: 'obsolete', ask: null, state: 'waiting', at: at(20), deliveredAt: undefined, takenAt: undefined })
  const newer = { ...older, id: 'w1', at: at(2) }
  const superseded = lineOf(older, { outbox: [older, newer] })
  assert.equal(superseded.state, 'closed')
  assert.match(superseded.lead, /^closed: superseded by a newer word of the same kind/)
  assert.equal(superseded.state === 'late', false, 'quiet, never amber')
})

// ---- Bullet 8: the person's expired word stays attention ----
test('a person\'s word that expired before it reached its chat is attention and keeps its words', () => {
  const expired = word({ state: 'expired', ask: null, command: 'talk', about: 'G1', text: 'Please make the bridge wider', at: at(180), takenAt: undefined, deliveredAt: undefined })
  const line = lineOf(expired)
  assert.deepEqual([line.state, line.lead], ['late', 'Not delivered: expired after 180 min'])
  assert.match(line.rest, /Please make the bridge wider/)
  assert.equal(line.text, 'Please make the bridge wider')
})

// ---- Bullet 9: no answer recorded in 24 h ----
test('a word past 24 h without a Done says "no answer recorded in 24 h" for one more day, then goes', () => {
  const old = word({ at: at(25 * 60), takenAt: at(25 * 60 - 1), deliveredAt: at(25 * 60 - 1) })
  const state = { chats: [], advisor: lane() }
  const run = outbox => waitsOf({ state, outbox, now: NOW, keep, judge: judgeFor(outbox), reports: new Map() })
  assert.deepEqual([run([old]).w1.state, run([old]).w1.rest], ['sent', 'no answer recorded in 24 h'])
  assert.deepEqual(Object.keys(run([{ ...old, at: at(49 * 60) }])), [], 'after two days it goes')
  const answered = run([{ ...old, answeredAt: at(25 * 60 - 5) }]).w1
  assert.equal(answered.state, 'done', 'a Done line is not rewritten')
})

// ---- Bullet 10: waitsAsOf ----
test('waitsAsOf: a pass that fails gives back the last good lines with their time; needs-attention reads a missing line as done only without an error', async () => {
  const kept = lastGoodWaits()
  assert.deepEqual(kept.made({ w1: { state: 'sent' } }, at(5)), { waits: { w1: { state: 'sent' } }, asOf: null })
  assert.deepEqual(kept.failed(NOW), { waits: { w1: { state: 'sent' } }, asOf: at(5) }, 'the last good lines, as of their time')
  assert.deepEqual(lastGoodWaits().failed(NOW), { waits: {}, asOf: NOW }, 'nothing good yet: no lines, but the error is said')
  // The server uses it and puts waitsAsOf in the state; the page says "as of".
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..')
  const server = await readFile(join(dir, 'server.mjs'), 'utf8')
  assert.match(server, /waitsGood\.failed\(clock\(\)\)/)
  assert.match(server, /waits, waitsAsOf, waitAgain/)
  const script = await readFile(join(dir, 'public', 'board.js'), 'utf8')
  assert.match(script, /as of \$\{clock\(view\.asOf\)\}/)
  // The page's own test of a card: cut from board.js, with the line reader stubbed.
  const cut = script.slice(script.indexOf('// closed:start'), script.indexOf('// closed:end'))
  const page = { waitViewOf: (part, id) => (part.waits?.[id] ?? null) }
  vm.runInNewContext(`${cut}\nthis.isWaitingAnswer = isWaitingAnswer`, page)
  const need = { isClosed: false, answer: { id: 'w1', state: 'delivered', at: at(3), text: 'A' } }
  assert.equal(page.isWaitingAnswer(need, { waits: {} }), false, 'no error: a missing line is done')
  assert.equal(page.isWaitingAnswer(need, { waits: {}, waitsAsOf: at(2) }), true, 'an error: a missing line is unknown, the card stays')
  assert.equal(page.isWaitingAnswer(need, { waits: { w1: { state: 'done' } }, waitsAsOf: at(2) }), false, 'a kept Done line is still done')
  assert.equal(page.isWaitingAnswer(need, { waits: { w1: { state: 'closed' } } }), false, 'a closed line ends the wait')
  assert.equal(page.isWaitingAnswer(need, { waits: { w1: { state: 'sent' } } }), true)
})

// ---- Bullet 11: the judge line needs a fresh report ----
test('the judge line: "is on it" needs a fresh report (a busy report that stopped coming is not on it for ever)', () => {
  const supervisor = lane({ name: 'Supervisor', status: 'Free', state: 'free' })
  const judgeWord = { id: 'j1', to: 'Supervisor', command: 'judge', kind: 'judge', ask: null, about: 'X5', incidents: ['X5'], text: 'judge', at: at(40), state: 'delivered', takenAt: at(39), deliveredAt: at(39) }
  const item = { sections: new Map(), head: new Map([['Id', 'X5'], ['Kind', 'incident'], ['State', 'with the supervisor'], ['Since', `${new Date(at(39)).getFullYear()}-11-09 ${hhmm(at(39))}`], ['Title', 'x']]) }
  const run = rep => waitsOf({ state: { chats: [], advisor: null, supervisorChat: supervisor }, outbox: [judgeWord], now: NOW, keep, judge: judgeFor([judgeWord], supervisor), reports: new Map([['Supervisor', rep]]), items: new Map([['X5', item]]) })['j1#X5']
  const fresh = run(report('busy', at(35), { word: 'j1', turn: at(35) }))
  assert.deepEqual([fresh.state, fresh.rest], ['picked-up', `since ${hhmm(at(35))} · for 35 min`], 'a long turn with a fresh report is quiet')
  const stale = run(report('busy', at(35), { word: 'j1', turn: at(35), at: NOW - 5 * MIN }))
  assert.equal(stale.state, 'late', 'the report went stale: not "on it"')
})
