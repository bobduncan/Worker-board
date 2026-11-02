// The wait line (T22, spec art-inbox/focus-mocks/wait-rule/spec.md; the person, 2026-11-02: "either the board responds
// immediately, e.g. via code. or we expect an ai chat todo something in which case i always need clear visual indications,
// maybe a loader. and the status if its being picked up or not"): one line per word an action of the person typed, through
// Sent, Picked up, Done and Late, the first that holds. Late is rule 8's own judgement (watch.mjs `isUndelivered`, the alarm's
// one function), never a second clock. Made-up garden chats.
import assert from 'node:assert/strict'
import test from 'node:test'

import { wordJudge } from '../src/supervisor/index.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { isUndelivered, undeliveredWords } from '../src/supervisor/rules/watch.mjs'
import { arrivedAt, isPersonWord, obsoleteDone, recapDone, standingWord, sweepDone, waitLineOf, waitsOf } from '../src/waitLine.mjs'
import { parseItem } from '../src/work/item.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 2, 13, 0).getTime()
const at = minutesAgo => NOW - minutesAgo * MIN
const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm(ms)}` }

/** The partner as the state draws it: running and free unless told otherwise. */
const partner = (more = {}) => ({ name: 'Advisor', isRunning: true, status: 'Free', state: 'free', report: null, wake: null, ...more })
const view = ({ outbox = [], advisor = partner(), pause = null, now = NOW } = {}) => buildView({ state: { chats: [], advisor, pause, chatPrefix: '' }, outbox, settings: {}, now })
/** A word of the person's to the partner: the recap's feedback. */
const word = (more = {}) => ({ id: 'w1', to: 'Advisor', ask: null, command: 'recap-feedback', about: 'G6', text: 'recap feedback', at: at(3), state: 'waiting', ...more })
/** Rule 8's judgement as the server makes it (supervisor/index.mjs `wordJudge`, over the same view the rules build). */
const judgeOf = ({ outbox = [], advisor = partner(), pause = null, now = NOW } = {}) => wordJudge({ state: { chats: [], advisor, pause, chatPrefix: '' }, outbox, settings: {}, now })
const lineOf = (w, { advisor = partner(), report = null, done = null, queue = 0, outbox = [w], paused = false } = {}) => waitLineOf({ word: w, lane: advisor, report, wake: advisor.wake, done, now: NOW, keep: view().keep, queue, judge: judgeOf({ outbox, advisor }), paused })

test('Sent: the chat runs and has not taken it: its place in the queue; asleep: what the wake record says', () => {
  const first = lineOf(word())
  assert.deepEqual([first.state, first.lead, first.rest], ['sent', `Sent ${hhmm(at(3))}`, 'waits for Advisor to pick it up · next in its queue'])
  assert.equal(lineOf(word(), { queue: 1 }).rest, 'waits for Advisor to pick it up · 2nd in its queue', 'one of its words came before it')
  assert.equal(lineOf(word(), { queue: 10 }).rest, 'waits for Advisor to pick it up · 11th in its queue')
  // Condition 1: while it does not run, the Sent line reads the wake record.
  const asleep = wake => partner({ isRunning: false, status: 'Asleep', wake })
  assert.equal(lineOf(word(), { advisor: asleep({ state: 'none', final: false, attempts: [] }) }).rest, 'Advisor is asleep; the board wakes it')
  assert.equal(lineOf(word(), { advisor: asleep({ state: 'sent', final: false, at: at(2), by: 'Worker 2', attempts: [] }) }).rest, `waking Advisor (message sent ${hhmm(at(2))} by Worker 2)`)
  assert.equal(lineOf(word(), { advisor: asleep({ state: 'launched', final: false, at: at(1), attempts: [] }) }).rest, `waking Advisor (launched ${hhmm(at(1))})`)
  assert.equal(lineOf(word(), { advisor: asleep({ state: 'on-its-way', final: false, by: 'Lead', attempts: [] }) }).rest, 'waking Advisor (message on its way, held by Lead)')
  assert.equal(lineOf(word(), { advisor: { ...asleep(null), status: 'Not running' } }).rest, 'Advisor does not run; the board wakes it')
  // Typed into its chat, its turn not begun yet.
  const typed = word({ state: 'delivered', takenAt: at(2), deliveredAt: at(2) })
  assert.equal(lineOf(typed, { report: { state: 'busy', since: at(30) } }).rest, `in Advisor's chat since ${hhmm(at(2))}, waits for its turn`, 'a turn begun before it is not its turn')
})

test('Picked up: the word arrived and the turn that began on it runs, the lane Working; its since may be a moment before the typed report', () => {
  const working = partner({ status: 'Working', state: 'working' })
  const typed = word({ state: 'delivered', takenAt: at(2), deliveredAt: at(2) + 1500 })
  const line = lineOf(typed, { advisor: working, report: { state: 'busy', since: at(2) + 500 } })
  assert.deepEqual([line.state, line.lead, line.rest, line.at], ['picked-up', 'Advisor is on it', `since ${hhmm(at(2))}`, at(2) + 500])
  // The review of 2026-11-02 (2b): a busy report alone is not "on it"; the lane's status must be Working (answer 2).
  assert.equal(lineOf(typed, { report: { state: 'busy', since: at(2) + 500 } }).state, 'sent', 'a busy report with the lane not Working')
  assert.equal(lineOf(typed, { advisor: partner({ status: 'Waiting for you', state: 'waiting' }), report: { state: 'asking', since: at(1) } }).state, 'sent')
  // Taken by its own chat inside a turn that runs: on it from the take.
  const taken = word({ state: 'taken', takenAt: at(1) })
  assert.equal(lineOf(taken, { advisor: working, report: { state: 'busy', since: at(20) } }).state, 'picked-up')
  // A hand's take is no arrival: the word is still on its way.
  assert.equal(arrivedAt(word({ state: 'taken', takenAt: at(1), takenBy: 'Worker 2', handTakenAt: at(1) })), null)
})

test('Done: the action\'s own result first; else "<Chat> answered HH:MM" once the turn that began on it ended, never Done', () => {
  const typed = word({ state: 'delivered', takenAt: at(10), deliveredAt: at(10) })
  const own = lineOf(typed, { done: { at: at(1), words: '1 new task for what you sent back', link: { step: 'B930', text: 'See B930 →' } } })
  assert.deepEqual([own.state, own.lead, own.rest, own.link], ['done', `Done ${hhmm(at(1))}`, '1 new task for what you sent back', { step: 'B930', text: 'See B930 →' }])
  const fallback = lineOf(typed, { report: { state: 'idle', since: at(4) } })
  assert.deepEqual([fallback.state, fallback.lead, fallback.rest, fallback.isFallback, fallback.seen], ['done', `Advisor answered ${hhmm(at(4))}`, '', true, { answeredAt: at(4) }])
  assert.equal(lineOf(typed, { report: { state: 'idle', since: at(30) } }).state, 'sent', 'an idle that began before the word is no answer to it')
  // The review of 2026-11-02 (2a): kept on the word, read first; a later turn changes nothing, and nothing new is seen.
  const later = lineOf({ ...typed, answeredAt: at(4) }, { advisor: partner({ status: 'Working', state: 'working' }), report: { state: 'busy', since: at(1) } })
  assert.deepEqual([later.state, later.lead, later.seen], ['done', `Advisor answered ${hhmm(at(4))}`, null])
  // An action's own result is kept with its words, and read first: "Done" stays when the source no longer says it.
  assert.deepEqual(own.seen, { doneAt: at(1), doneWords: '1 new task for what you sent back', doneStep: 'B930' })
  const keptDone = lineOf({ ...typed, doneAt: at(1), doneWords: '1 new task for what you sent back', doneStep: 'B930' })
  assert.deepEqual([keptDone.state, keptDone.lead, keptDone.rest, keptDone.link], ['done', `Done ${hhmm(at(1))}`, '1 new task for what you sent back', { step: 'B930', text: 'See B930 →' }])
  // (2b) a session that ended after the word came is no answer: its wake words.
  const ended = lineOf(typed, { advisor: partner({ isRunning: false, status: 'Asleep', wake: null }), report: { state: 'ended', since: at(4) } })
  assert.deepEqual([ended.state, ended.rest, ended.seen], ['sent', 'Advisor is asleep; the board wakes it', null])
  // (2c) an action with its own Done source: its turn ended without the result, quietly, never "answered".
  const check = word({ command: 'obsolete-check', about: 'obsolete', state: 'delivered', takenAt: at(10), deliveredAt: at(10) })
  const without = lineOf(check, { report: { state: 'idle', since: at(4) } })
  assert.deepEqual([without.state, without.lead, without.isTurnEnded, without.seen], ['sent', `Advisor's turn ended at ${hhmm(at(4))} without it`, true, { answeredAt: at(4) }])
  assert.equal(lineOf({ ...check, answeredAt: at(4) }).lead, `Advisor's turn ended at ${hhmm(at(4))} without it`)
})

test('Late is rule 8\'s own judgement of this word (isUndelivered, the alarm\'s function), never a second clock', () => {
  const old = word({ at: at(12) })
  const board = view({ outbox: [old] })
  assert.equal(isUndelivered(board, old), true, 'over undeliveredMinutes (10) and still waiting')
  assert.deepEqual(undeliveredWords(board).map(one => one.id), ['w1'], 'the alarm names the same word')
  const late = lineOf(old)
  assert.deepEqual([late.state, late.lead, late.rest, late.canSendAgain], ['late', 'Not picked up after 12 min', "it waits in Advisor's queue", false])
  // Under the limit: no Late, whatever the minutes.
  assert.equal(lineOf(word({ at: at(9) })).state, 'sent')
  // The person pauses: rule 8 names nothing, and neither does the line.
  const pause = { state: 'pausing', at: at(30) }
  assert.equal(isUndelivered(view({ outbox: [old], pause }), old), false)
  assert.equal(judgeOf({ outbox: [old], pause }).isUndelivered(old), false, 'the judge the line reads says the same')
  // A chat in a pending wake leaves rule 8 (change 4, decision 7): the line reads the wake, not Late.
  const waking = partner({ isRunning: false, status: 'Asleep', wake: { state: 'sent', final: false, at: at(2), by: 'Lead', attempts: [] } })
  const line = lineOf(old, { advisor: waking })
  assert.deepEqual([line.state, line.rest], ['sent', `waking Advisor (message sent ${hhmm(at(2))} by Lead)`])
})

test('Late when every way to wake the chat failed, with the cause from the record; Send again only while no wake is pending', () => {
  const attempts = [
    { path: 'message', at: at(8), by: 'Lead', sentAt: at(8), verdict: 'failed', verdictAt: at(6), why: 'no report within 2 minutes of the message' },
    { path: 'launch', at: at(5), by: 'board', sentAt: at(5), verdict: 'failed', verdictAt: at(3), why: 'the app did not start it' },
  ]
  const failed = partner({ isRunning: false, status: 'Asleep', wake: { state: 'failed', final: true, why: 'the app did not start it', attempts } })
  const line = lineOf(word({ at: at(9) }), { advisor: failed })
  assert.equal(line.state, 'late')
  assert.equal(line.lead, 'Not picked up after 9 min')
  assert.equal(line.rest, `Advisor did not wake: no report after the message (sent ${hhmm(at(8))} by Lead); the app did not start it (launched ${hhmm(at(5))})`)
  assert.equal(line.canSendAgain, true)
  // Rule 8's late word to a chat that runs: nothing to wake, no Send again.
  assert.equal(lineOf(word({ at: at(12) })).canSendAgain, false)
  // The review of 2026-11-02 (3): none while the person pauses the chats (the board wakes nobody then).
  assert.equal(lineOf(word({ at: at(9) }), { advisor: failed, paused: true }).canSendAgain, false)
  // (5): a chat the board has no id to reach: Send again could only be refused; the line says to open its chat.
  const noId = partner({ isRunning: false, status: 'Not running', wake: { state: 'failed', final: true, why: 'no id', attempts: [] } })
  const open = lineOf(word({ at: at(9) }), { advisor: noId })
  assert.deepEqual([open.state, open.rest, open.canSendAgain], ['late', 'the board has no id to wake Advisor: open its chat', false])
})

test('the review of 2026-11-02 (4): a word that failed for good is Late, "could not be delivered", with no Send again; one the board tries again is Sent', () => {
  const lost = word({ at: at(5), state: 'failed', failedAt: at(4), final: true, why: 'too long for the Workers mod' })
  const line = lineOf(lost, { advisor: partner({ isRunning: false, status: 'Asleep', wake: { state: 'none', final: false, attempts: [] } }) })
  assert.deepEqual([line.state, line.rest, line.canSendAgain], ['late', 'could not be delivered: too long for the Workers mod', false])
  assert.equal(lineOf(word({ at: at(5), state: 'failed', failedAt: at(4), tries: 3, why: 'the app said no' })).state, 'late', 'its tries spent')
  const again = lineOf(word({ at: at(3), state: 'failed', failedAt: at(2), tries: 1, why: 'the app said no' }))
  assert.deepEqual([again.state, again.rest], ['sent', 'Advisor could not take it; the board tries again'])
})

test('no wait: a word the outbox sweep dropped or closed, one copied to paste, an expired one rule 8 no longer names', () => {
  assert.equal(lineOf(word({ state: 'dropped' })), null)
  assert.equal(lineOf(word({ state: 'copied' })), null)
  // Superseded: a newer word of the same kind stands (watch.mjs wordMatters).
  const older = word({ id: 'w0', at: at(20), command: 'obsolete-check', about: 'obsolete' })
  const newer = word({ id: 'w1', at: at(2), command: 'obsolete-check', about: 'obsolete' })
  assert.equal(waitLineOf({ word: older, lane: partner(), now: NOW, judge: judgeOf({ outbox: [older, newer] }) }), null)
  // The sweep's own word expires in ten minutes by design and rule 8 leaves it out (X43): no Late, no line once expired.
  const sweep = word({ command: 'sweep', about: 'board', at: at(11) })
  assert.equal(lineOf(sweep), null)
})

test('the actions\' own results: the recap\'s next tries filed after the Send, the obsolete check answered, the asked sweep told', () => {
  const item = text => parseItem(text)
  const sent = at(30)
  const review = (id, more = '') => item(`Id: ${id}\nKind: step\nTitle: t\nState: review\nSince: ${stamp(at(90))}\n${more}\n## History\n- ${stamp(at(90))} made\n`)
  const fix = (id, of, madeAt) => item(`Id: ${id}\nKind: step\nTitle: next try\nState: new\nFix of: ${of}\nSince: ${stamp(madeAt)}\n\n## History\n- ${stamp(madeAt)} made\n`)
  const items = new Map([['B1', review('B1')], ['B2', review('B2')]])
  const w = word({ at: sent, backSteps: ['B1', 'B2'] })
  assert.equal(recapDone(w, items), null, 'no next try yet')
  items.set('B9', fix('B9', 'B1', at(100)))
  assert.equal(recapDone(w, items), null, 'a fix from before the Send is no next try')
  items.set('B10', fix('B10', 'B1', at(20)))
  assert.equal(recapDone(w, items), null, 'B2 still waits')
  items.set('B2', review('B2', 'Blocked by: B11'))
  items.set('B11', item(`Id: B11\nKind: step\nTitle: next try\nState: new\nSince: ${stamp(at(10))}\n\n## History\n- ${stamp(at(10))} made\n`))
  assert.deepEqual(recapDone(w, items), { at: at(10), words: '2 new tasks for what you sent back', link: { step: 'B10', text: 'See B10 →' } })
  assert.equal(recapDone(word({ at: sent }), items), null, 'a Send with no step sent back has no own result: the fallback')
  // The obsolete check: its record answered, for this word's check.
  const record = { state: 'done', at: at(5) - 1000, answeredAt: at(1), items: [{ id: 'Q1' }, { id: 'Q2' }, { id: 'X3' }], verdicts: { Q1: { verdict: 'obsolete' }, Q2: { verdict: 'open' } } }
  assert.deepEqual(obsoleteDone(word({ at: at(5), command: 'obsolete-check' }), record), { at: at(1), words: '1 closed as obsolete · 2 stay', link: null })
  assert.equal(obsoleteDone(word({ at: at(5), command: 'obsolete-check' }), { ...record, state: 'checking' }), null)
  assert.equal(obsoleteDone(word({ at: at(60), command: 'obsolete-check' }), record), null, 'a newer check, not this one')
  // The sweep: ended by its chat's turn ("told"); a quiet end is no result.
  const sweep = { word: 'w1', asked: true, ended: at(1), how: 'told', found: 2 }
  assert.deepEqual(sweepDone(word({ command: 'sweep' }), sweep), { at: at(1), words: '2 incidents filed', link: null })
  assert.equal(sweepDone(word({ command: 'sweep' }), { ...sweep, how: 'quiet' }), null)
  assert.equal(sweepDone(word({ command: 'sweep', id: 'w2' }), sweep), null)
})

test('waitsOf: the words an action of the person typed in the last 24 h, by id; a retried one by the copy that stands for it', () => {
  const answer = { id: 'a1', to: 'Advisor', ask: 'work:Q5', command: null, text: 'A', at: at(4), state: 'waiting' }
  const failed = { id: 'a0', to: 'Advisor', ask: 'work:Q4', command: null, text: 'B', at: at(6), state: 'failed', retriedAs: 'a2' }
  const copy = { ...failed, id: 'a2', state: 'delivered', retriedAs: undefined, retryOf: 'a0', takenAt: at(3), deliveredAt: at(3) }
  const board = { id: 'b1', to: 'Advisor', ask: null, command: 'refine', about: 'B12', text: 'refine', at: at(2), state: 'waiting' }
  const yesterday = { ...answer, id: 'a9', at: at(25 * 60) }
  const sweep = { id: 's1', to: 'Supervisor', ask: null, command: 'sweep', about: 'board', text: 'sweep', at: at(1), state: 'waiting' }
  const outbox = [yesterday, failed, answer, copy, board, sweep]
  const state = { chats: [], advisor: partner(), supervisorChat: { name: 'Supervisor', isRunning: true, status: 'Free' } }
  const judge = wordJudge({ state, outbox, settings: {}, now: NOW })
  const waits = waitsOf({ state: { ...state, advisor: partner({ status: 'Working', state: 'working' }) }, outbox, now: NOW, keep: view().keep, judge, reports: new Map([['Advisor', { state: 'busy', since: at(3) }]]), sweep: { word: 's1', asked: true, ended: null } })
  assert.deepEqual(Object.keys(waits).sort(), ['a0', 'a1', 'a2', 's1'], 'not the board\'s own refine word, not yesterday\'s answer')
  assert.equal(waits.a0.word, 'a2', 'the failed word reads its copy')
  assert.equal(waits.a0.state, 'picked-up')
  assert.equal(waits.a1.rest, 'waits for Advisor to pick it up · 2nd in its queue', "yesterday's answer still waits before it (it has no line, being older than 24 h); the failed word and its copy wait no more; the refine word came after it")
  assert.deepEqual([waits.a1.command, waits.a1.ask], ['answer', 'work:Q5'])
  assert.equal(waits.s1.command, 'sweep')
  assert.equal(isPersonWord(sweep, { sweepWord: null }), false, 'a sweep by the clock is the board\'s')
  assert.equal(standingWord(failed, new Map(outbox.map(one => [one.id, one]))).id, 'a2')
})
