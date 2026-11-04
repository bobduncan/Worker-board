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
const lineOf = (w, { advisor = partner(), report = null, done = null, queue = 0, outbox = [w], paused = false, ahead = false } = {}) => waitLineOf({ word: w, lane: advisor, report, ahead, wake: advisor.wake, done, now: NOW, keep: view().keep, queue, judge: judgeOf({ outbox, advisor }), paused })

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
  const fallback = lineOf(typed, { report: { state: 'idle', since: at(4), busyAt: at(8) } })
  assert.deepEqual([fallback.state, fallback.lead, fallback.rest, fallback.isFallback, fallback.seen], ['done', `Advisor answered ${hhmm(at(4))}`, '', true, { answeredAt: at(4) }])
  assert.equal(lineOf(typed, { report: { state: 'idle', since: at(30), busyAt: at(31) } }).state, 'sent', 'an idle that began before the word is no answer to it')
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
  const without = lineOf(check, { report: { state: 'idle', since: at(4), busyAt: at(8) } })
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
  const board = { id: 'b1', to: 'Advisor', ask: null, command: 'refine', board: true, about: 'B12', text: 'refine', at: at(2), state: 'waiting' }
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

// ---- Which turn is the word's (the signals lead's decision of 2026-11-02, .claude/plans/2026-11-02-wait-line-turn-code-check.md) ----
// The first real card, Q587's answer (word 75bc2b9b to Worker 5), read "Worker 5 is on it · since 16:26" for a word answered in an
// earlier turn: the board guessed the word's turn from busy and idle reports. The Workers mod KNOWS it and says it: `report.word`
// (the outbox id the current or last turn ran on, null for a turn that was no word's), `report.turn` (that turn's own start).

const clock = (hour, minute, second = 0) => new Date(2026, 10, 2, hour, minute, second).getTime()
const working = (more = {}) => partner({ status: 'Working', state: 'working', ...more })
/** A word delivered to the partner: taken ten minutes ago, typed a second later. */
const typedWord = (more = {}) => word({ state: 'delivered', at: at(12), takenAt: at(10), deliveredAt: at(10) + 1000, ...more })
/** The partner's report as the board keeps it: `busyAt` the board's receipt of the turn's start; `word`, `turn` only from a mod that says them. */
const said = (state, since, more = {}) => ({ state, since, background: false, run: 1, seq: 1, busyAt: null, ...more })

test('the live case (Q587, word 75bc2b9b to Worker 5): answered in an earlier turn, the chat busy on another task is "answered by", never "on it since 16:26"', () => {
  const now = clock(16, 35)
  const w = { id: '75bc2b9b', to: 'Worker 5', ask: 'work:Q587', command: null, text: 'A', at: clock(16, 17, 30), state: 'delivered', takenAt: clock(16, 17, 50), deliveredAt: clock(16, 18, 0) }
  const lane = partner({ name: 'Worker 5', status: 'Working', state: 'working' })
  const lineAt = (report, more = {}) => waitLineOf({ word: w, lane, report, now, keep: view().keep, judge: judgeOf({ outbox: [w], advisor: lane, now }), ...more })
  // The process began at 16:17:43 on the wake message; the word was taken at 16:17:50, during that first turn: it waits for its turn.
  const wake = lineAt(said('busy', clock(16, 17, 43), { busyAt: clock(16, 17, 43), word: null, turn: clock(16, 17, 43) }))
  assert.deepEqual([wake.state, wake.rest], ['sent', "in Worker 5's chat since 16:17, waits for its turn"], "a message wake's first turn never answers the word")
  // Its own turn, then the end of it.
  const own = lineAt(said('busy', clock(16, 18, 5), { busyAt: clock(16, 18, 5), word: '75bc2b9b', turn: clock(16, 18, 5) }))
  assert.deepEqual([own.state, own.lead, own.rest], ['picked-up', 'Worker 5 is on it', 'since 16:18'])
  const exact = lineAt(said('idle', clock(16, 19, 10), { busyAt: clock(16, 18, 5), word: '75bc2b9b', turn: clock(16, 18, 5) }))
  assert.deepEqual([exact.state, exact.lead, exact.seen], ['done', 'Worker 5 answered 16:19', { answeredAt: clock(16, 19, 10) }], 'exact: the board heard that very turn end')
  // The keep did not see that: at 16:26 the chat is busy on B920's word, a later turn.
  const live = lineAt(said('busy', clock(16, 26), { busyAt: clock(16, 26), word: 'b920-word', turn: clock(16, 26) }))
  assert.deepEqual([live.state, live.lead, live.isBound, live.at], ['done', 'Worker 5 answered by 16:26', true, clock(16, 26)])
  assert.deepEqual(live.seen, { answeredAt: clock(16, 26), answeredBound: true }, 'kept as bound, so the card never turns it into an exact time')
  // Kept: read first from then on; a bound time keeps its "by", an older kept time (75bc2b9b's own, 16:29) its plain words.
  const keptBound = lineAt(said('busy', clock(16, 31), { word: 'other', turn: clock(16, 31) }), { word: { ...w, answeredAt: clock(16, 26), answeredBound: true } })
  assert.deepEqual([keptBound.lead, keptBound.seen], ['Worker 5 answered by 16:26', null])
  assert.equal(lineAt(said('busy', clock(16, 31)), { word: { ...w, answeredAt: clock(16, 29, 48) } }).lead, 'Worker 5 answered 16:29', 'a time kept before this rule stands as it was')
})

test('an older mod (a report without word): an idle answers only when the turn it ended began at or after the word arrived', () => {
  const typed = typedWord()
  // The chat ran a turn (since at(30)) when the word was typed into it; the word waits for its own turn.
  const running = lineOf(typed, { advisor: working(), report: said('busy', at(30), { busyAt: at(30) }) })
  assert.deepEqual([running.state, running.rest], ['sent', `in Advisor's chat since ${hhmm(at(10))}, waits for its turn`])
  // That turn ends: an idle (since at(4)) at or after the arrival, but of a turn begun before it: no answer, nothing kept.
  const first = lineOf(typed, { report: said('idle', at(4), { busyAt: at(30) }) })
  assert.deepEqual([first.state, first.rest, first.seen], ['sent', `in Advisor's chat since ${hhmm(at(10))}, waits for its turn`, null], "a busy chat's idle does not answer the word that waits for its turn")
  assert.equal(lineOf(typed, { report: said('idle', at(4)) }).state, 'sent', 'the board did not hear the turn begin (no busyAt): no answer')
  // Its own turn begins (the board heard it: busyAt) and ends: answered, exact.
  const on = lineOf(typed, { advisor: working(), report: said('busy', at(9), { busyAt: at(9) }) })
  assert.deepEqual([on.state, on.rest], ['picked-up', `since ${hhmm(at(9))}`])
  const done = lineOf(typed, { report: said('idle', at(4), { busyAt: at(9) }) })
  assert.deepEqual([done.state, done.lead, done.seen], ['done', `Advisor answered ${hhmm(at(4))}`, { answeredAt: at(4) }])
})

test('a word typed into a busy chat (the mod says its word): the idle at the end of the running turn does not answer it; its own turn does', () => {
  const typed = typedWord()
  const turn0 = at(30)
  // The running turn, then its end (word null: a typed line): Sent, whatever the idle's time.
  assert.equal(lineOf(typed, { advisor: working(), report: said('busy', turn0, { busyAt: turn0, word: null, turn: turn0 }) }).state, 'sent')
  const ended = lineOf(typed, { report: said('idle', at(4), { busyAt: turn0, word: null, turn: turn0 }) })
  assert.deepEqual([ended.state, ended.seen], ['sent', null], 'the end of the turn that was running while the word waited')
  const other = lineOf(typed, { report: said('idle', at(4), { busyAt: turn0, word: 'older-word', turn: turn0 }) })
  assert.equal(other.state, 'sent', 'also when that turn ran on another word')
  // Its own turn: on it; and its end: answered, exact.
  const own = lineOf(typed, { advisor: working(), report: said('busy', at(3), { busyAt: at(3), word: 'w1', turn: at(3) }) })
  assert.deepEqual([own.state, own.rest, own.at], ['picked-up', `since ${hhmm(at(3))}`, at(3)])
  const exact = lineOf(typed, { report: said('idle', at(1), { busyAt: at(3), word: 'w1', turn: at(3) }) })
  assert.deepEqual([exact.lead, exact.isBound, exact.seen], [`Advisor answered ${hhmm(at(1))}`, undefined, { answeredAt: at(1) }])
})

test("an ask that opens and closes inside the word's turn keeps \"on it\", since the turn's own start", () => {
  const typed = typedWord()
  const turn = at(8)
  const asking = lineOf(typed, { advisor: partner({ status: 'Waiting for you', state: 'waiting' }), report: said('asking', at(3), { busyAt: turn, word: 'w1', turn }) })
  assert.deepEqual([asking.state, asking.lead, asking.rest], ['picked-up', 'Advisor is on it', `since ${hhmm(turn)}`])
  // Busy again with a fresh since (the mod stamps every state change): still the same turn.
  const back = lineOf(typed, { advisor: working(), report: said('busy', at(1), { busyAt: turn, word: 'w1', turn }) })
  assert.deepEqual([back.state, back.rest, back.at], ['picked-up', `since ${hhmm(turn)}`, turn])
  // A question inside the turn running while the word waited is not "on it"; a stale report (the lane no longer Working) is not either.
  assert.equal(lineOf(typed, { advisor: partner({ status: 'Waiting for you', state: 'waiting' }), report: said('asking', at(3), { word: 'other', turn: at(30) }) }).state, 'sent')
  assert.equal(lineOf(typed, { report: said('busy', at(1), { word: 'w1', turn }) }).state, 'sent')
})

test('answered by: only a later turn, after the word was delivered, on another word that did not stand ahead of it; never from an ended session', () => {
  const typed = typedWord()
  const later = (state, more = {}) => said(state, at(2), { busyAt: at(2), word: 'b-other', turn: at(2), ...more })
  assert.deepEqual([lineOf(typed, { report: later('idle') }).lead, lineOf(typed, { report: later('idle') }).isBound], [`Advisor answered by ${hhmm(at(2))}`, true])
  assert.equal(lineOf(typed, { advisor: working(), report: later('busy') }).lead, `Advisor answered by ${hhmm(at(2))}`)
  assert.equal(lineOf(typed, { report: later('idle', { word: null }) }).lead, `Advisor answered by ${hhmm(at(2))}`, "also after a turn that was no word's (a typed line)")
  // A turn that began before the word was delivered, or at that moment, says nothing about it.
  assert.equal(lineOf(typed, { report: later('idle', { turn: typed.deliveredAt }) }).state, 'sent')
  assert.equal(lineOf(typed, { report: later('idle', { turn: at(11) }) }).state, 'sent')
  // The turn ran on a word that stood ahead of this one in the chat's queue: the chat has not reached this one.
  assert.equal(lineOf(typed, { report: later('idle'), ahead: true }).state, 'sent')
  // A session that ended, a word taken and not typed yet, no turn start given: no answer.
  assert.equal(lineOf(typed, { advisor: partner({ isRunning: false, status: 'Asleep' }), report: later('ended') }).state, 'sent')
  assert.equal(lineOf(word({ state: 'taken', takenAt: at(10) }), { report: later('idle') }).state, 'sent')
  assert.equal(lineOf(typed, { report: later('idle', { turn: undefined }) }).state, 'sent')
  // An action with its own Done source says it quietly, and still not as an exact time.
  const check = typedWord({ command: 'obsolete-check', about: 'obsolete' })
  const quiet = lineOf(check, { report: later('idle') })
  assert.deepEqual([quiet.state, quiet.lead, quiet.seen], ['sent', `Advisor's turn ended by ${hhmm(at(2))} without it`, { answeredAt: at(2), answeredBound: true }])
  assert.equal(lineOf({ ...check, answeredAt: at(2), answeredBound: true }).lead, `Advisor's turn ended by ${hhmm(at(2))} without it`)
})

test('waitsOf: two words of one take run one turn each, in order: the second reads "on it" in its own turn, and not before', () => {
  const x = { id: 'x1', to: 'Advisor', ask: 'work:Q1', command: null, text: 'A', at: at(12), state: 'delivered', takenAt: at(10), deliveredAt: at(10) + 1000 }
  const y = { ...x, id: 'y1', ask: 'work:Q2', at: at(11) }
  const outbox = [x, y]
  const judge = wordJudge({ state: { chats: [], advisor: partner(), pause: null, chatPrefix: '' }, outbox, settings: {}, now: NOW })
  const waits = (status, report) => waitsOf({ state: { chats: [], advisor: partner({ status, state: status === 'Working' ? 'working' : 'free' }) }, outbox, now: NOW, keep: view().keep, judge, reports: new Map([['Advisor', report]]) })
  // Its turn on the first word runs: the first is on it; the second waits for its turn (the word is ahead of it).
  const first = waits('Working', said('busy', at(8), { busyAt: at(8), word: 'x1', turn: at(8) }))
  assert.deepEqual([first.x1.state, first.y1.state, first.y1.rest], ['picked-up', 'sent', `in Advisor's chat since ${hhmm(at(10))}, waits for its turn`])
  // It ended: the first answered (exact), the second still waits.
  const between = waits('Free', said('idle', at(6), { busyAt: at(8), word: 'x1', turn: at(8) }))
  assert.deepEqual([between.x1.lead, between.y1.state], [`Advisor answered ${hhmm(at(6))}`, 'sent'])
  // The second turn runs on the second word: it is on it; the first (not kept here) is bound to this later turn.
  const second = waits('Working', said('busy', at(5), { busyAt: at(5), word: 'y1', turn: at(5) }))
  assert.deepEqual([second.y1.state, second.y1.rest, second.x1.lead], ['picked-up', `since ${hhmm(at(5))}`, `Advisor answered by ${hhmm(at(5))}`])
})
