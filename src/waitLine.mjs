// The wait line (T22, the wait rule's spec and mock, the person's yes "Yes, both" of 2026-11-02). The person,
// 2026-11-02: "either the board responds immediately, e.g. via code. or we expect an ai chat todo something in which case i
// always need clear visual indications, maybe a loader. and the status if its being picked up or not. I want to know whats
// going on." Before it, an answered ask vanished at once, the recap's Send feedback said "Your partner makes the next tries"
// and nothing after, Find obsolete items said "checking" from the moment its record was written (not delivered), and a
// Check now sweep said "checking…" whether the supervisor's chat took its word or not (audit.md).
//
// ONE line per word an action of the person typed, on the card itself, through four states (mock.png), the first that holds:
// 1. Done: the action's own result (`done`, from its source: the recap's next tries filed, the obsolete check answered, the
//    sweep's end), else, for an action without such a source, the fallback "<Chat> answered HH:MM" once the turn that began on
//    the word has ended (the board-dev chat's answer 3: never "Done" without a result). An action WITH its own source whose
//    turn ended without the result says so, quietly: "<Chat>'s turn ended at HH:MM without it" (the review of 2026-11-02).
//    Once seen, both are kept on the word (`doneAt`, `answeredAt`, written once by the server) and read first: a later turn
//    never turns a word back into "is on it";
// 2. Late: a word that could not be delivered for good, rule 8's own lateness for this word (watch.mjs `isUndelivered`, the
//    alarm's one function: no second clock, the board-dev chat's condition 2), or the wake failed on every path (wake.mjs
//    `wakeOf(...).final`), with the cause from the record; "Send again" only while no wake is pending and nobody pauses;
// 3. Picked up: the word arrived and the turn that began on it runs: the lane's status Working (the board-dev chat's answer 2);
// 4. Sent: anything else, with what the board knows of why not yet: the queue place while the chat runs, the wake record
//    while it does not (condition 1). A chat whose session ended (closed or crashed mid-turn) did not answer: its wake words.
//
// WHICH TURN is the word's (the signals lead's decision of 2026-11-02, .claude/plans/2026-11-02-wait-line-turn-code-check.md, after
// Q587's card read "is on it" for a word answered in an earlier turn): the board does not guess it from busy and idle reports. The
// mod queues a word, one word is one turn, and a busy report's since moves on every state change (a question that opens and closes
// mid-turn), so the Workers mod KNOWS and says it: `report.word`, the outbox id the current (busy) or last (idle) turn ran on, null
// for a turn that was no word's, and `report.turn`, that turn's own start. This word: busy on it is "is on it", idle on it is
// "answered HH:MM"; the chat on a later turn (`turn` after the word was delivered) on another word is "answered by HH:MM" (bound,
// never exact); a turn that began before the word was delivered says nothing. A report without `word` (an older mod) keeps the
// older rule, narrowed: an idle answers only when the turn it ended began at or after the word arrived.
// The chat's status pill stays beside the line as it is (condition 3): the page draws it from the lane, never from here.
//
// WAVE 2 (T22, 2026-11-04, the wait rule's plan-wave2.md, beside its spec.md): the same line for every other action of the person that
// waits on a chat, eight places, each with the Done source of its own (`placeOfWord`, the `*Done` functions): a refine (its block written
// after the word), Go (the work blocks' tasks filed), Change this goal (a new goal
// definition written after the word; a next question is progress only), a goal ask (its answer under the goal), an Overturn (the fix step made), Stop or Remove a worker (its lane
// stopped or gone), the Focus talk (no result of its own: the fallback "answered"), and an incident that waits for the
// Supervisor's judgment (`judgeLinesOf`: one line per incident, from its judge word and the incident's own state). The person,
// 2026-11-02: "I want to know whats going on." A result that ends the very reason for the word (a refine written closes its word,
// the outbox sweep drops it) still reads as Done: `outlives`.
//
// P3 (T2.11, 2026-11-09, DESIGN.md "The wait line: records, honest limits, no silent end"): a wait is a record, not a guess. `pickedUpAt` is
// written once; waiting counts from the end of the turn ahead; "on it" is Late only for a stopped chat or a report stale for 2 minutes of
// heard running time; a turn that ended without the result is Late 5 minutes after the chat came to rest (never while it still works);
// a merged prompt is never Late; Late names the person's action; a closed or expired or 24-hour-old word says so, and the last two end
// their wait; a failed pass keeps the last lines (`lastGoodWaits`). The review of 2026-11-09 (two core reviews) set the last of these.
//
// PURE: every fact is passed in, `now` included, and rule 8's judgement as `judge` (the supervisor's `wordJudge`: nothing
// outside the supervisor imports its parts). The server puts the lines in the state as `waits`, by word id (`waitsOf`: only
// the words an action of the person typed, the last 24 h); the page draws a line where it finds a word id.

import { refinedAt } from './backlog.mjs'
import { UNKNOWN_ATTENTION_MS } from './chatStatus.mjs'
import { blocksOf } from './goals.mjs'
import { STOP_HANDS_MS, isHandTaken } from './hands.mjs'
import { planAnswered } from './plan.mjs'
import { PLAN_DECISIONS, PLAN_MOVES } from './planMoves.mjs'
import { isLate } from './store.mjs'
import { WAKE_PENDING, triedWords } from './wake.mjs'
import { sinceMs, valueOf } from './work/item.mjs'
import { TRIES, passesBySelf } from './work/passing.mjs'
import { JUDGE_LONGEST_MS } from './work/judgeWord.mjs'
import { afterPause, isHolding } from './work/pause.mjs'
import { isBlockWritten } from './work/refineWait.mjs'
import { fixesOf } from './work/resultCheck.mjs'
import { madeAtMs } from './work/qaTask.mjs'

const MIN = 60_000
/** The words a wait is drawn for: those an action of the person typed in the last 24 hours (the spec, "Where it shows"). */
export const WAITS_KEPT_MS = 24 * 60 * MIN
/**
 * P3 (T2.11, the wait line's honest limits). A turn that ended without the result of an action that has one is quiet this long, then Late
 * (the result may be filed a moment after the turn); a closed word says why this long; a word past WAITS_KEPT_MS without a Done says
 * "no answer recorded in 24 h" for one more day, so no wait ends without a trace.
 */
export const TURN_GRACE_MS = 5 * MIN
export const CLOSED_SHOWN_MS = 10 * MIN
export const ENDED_SHOWN_MS = 24 * 60 * MIN
/** A chat's report older than this (running time) is unknown (config `unknownAfterSeconds`); the server gives its own. */
export const REPORT_FRESH_MS = 30_000
/**
 * P3 (the review of 2026-11-09, 2): an "on it" line turns Late for a quiet chat only after this much of the board's heard running time (the
 * Unknown pill's own attention age, chatStatus.mjs `UNKNOWN_ATTENTION_MS`): a board stall or a landing restart is no chat's fault. Before it,
 * past `REPORT_FRESH_MS`, the line says quietly "no news from X since HH:MM".
 */
export const REPORT_STALE_MS = UNKNOWN_ATTENTION_MS
/** How often the server keeps what the lines saw (a turn ended, an action's result) while no page asks for the state. */
export const WAITS_KEEP_MS = 30_000
/** The four states, in the order the first that holds wins. */
export const WAIT_STATES = ['done', 'late', 'picked-up', 'sent']
/** The person's actions of wave 1 that type a word to a chat, by the word's command (an answer is any word with `ask`). */
export const WAIT_COMMANDS = ['recap-feedback', 'obsolete-check', 'sweep']
/** The commands of the actions with a Done source of their own (an all-approved recap Send names no step: it has none). */
const OWN_DONE = ['obsolete-check', 'sweep', 'recap-feedback']
/**
 * Wave 2: the places an action of the person has (`placeOfWord`). The six first have a Done source of their own (`OWN_PLACES`), the
 * talk the fallback, the judgment of an incident its own lines (`judgeLinesOf`).
 */
export const WAVE2_PLACES = ['refine', 'go', 'change', 'goal-ask', 'overturn', 'worker', 'talk', 'focus', 'judge', 'plan', 'recommend', 'free']
const OWN_PLACES = ['refine', 'go', 'change', 'goal-ask', 'overturn', 'worker', 'plan', 'recommend']
/** The Focus talk's words: the talk bar, "Not yet", "Re-check the goals now", and the words of a brainstorm that is no change of a goal. */
const TALK_COMMANDS = ['talk', 'vibe-not-yet', 'how-not-yet', 'recheck']
/**
 * Reactive board, brief P4b: the other words the Focus and Goals pages send (the person's click, then the partner's turn). They have no
 * Done record of their own yet: P3's general rule (the chat's turn on the word ended) says Done, Late or closed for them. The page draws
 * each where its button was (`wordLineOf`); the board's own demo word (`goal-demo`, asked by the loop) is drawn the same.
 */
export const FOCUS_COMMANDS = ['focus', 'vibe-agreed', 'vibe-there-yes', 'vibe-there-no', 'goal-recheck', 'goal-demo', 'done-when', 'undo']
/**
 * Reactive board, brief P4c: the Vision tab's words to the partner (src/planMoves.mjs `PLAN_MOVES`, a test keeps the two lists equal): place 'plan',
 * Done by the partner's own write of the plan page after the word (`planDone`). The seven decisions the board writes itself (`PLAN_DECISIONS`)
 * are no wait; the follow-up word that says so is one: its Done is the partner's write too, with no result of its own owed (the fallback "answered" when its turn ends).
 */
export const PLAN_COMMANDS = PLAN_MOVES
/**
 * Reactive board, brief P4c: the free messages the person types (no command): the Advisor talk's Send, Talk to Main, a hint's nudge, the words
 * "Ask for pictures" types to an ask's chat. The board keeps their kind on the word (`free`, with `freeAbout` for the nudge's card and the
 * ask), so the line is drawn where the button was. Done is the turn report (P3's general rule): the chat's answer is the chat itself.
 */
export const FREE_KINDS = ['talk-send', 'main-send', 'nudge', 'ask-pictures']
/** The words of a brainstorm thread the person types (the board's own `brainstorm-fix` and `brainstorm-stranded` are no action of theirs). */
const BRAINSTORM_COMMANDS = ['brainstorm', 'brainstorm-answer', 'brainstorm-wrap', 'brainstorm-change', 'brainstorm-understood', 'brainstorm-not-quite']
/** The states of an incident that waits for a judgment; the ones that end it are `ENDED` of supervisor/incidents.mjs, and 'fix' (given a fix step). */
const INCIDENT_WAITS = ['open', 'came back', 'with the supervisor', 'with the advisor']
/**
 * Who holds the person's Send again on the message way until a hand that may send takes it (server.mjs `wakeAgainNow`, the
 * attempt's `by`): the line then reads "waking X (message on its way, held by the board)".
 */
export const AGAIN_BY = 'the board'
/** The key under which `waitsOf` keeps the first moment it saw a word closed, in the server's `firstSeen` map (beside a result's own). */
const CLOSED_KEY = 'closed:'
/** How far a retried word is followed to the copy that stands for it (store.mjs `retriedAs`). */
const RETRY_HOPS = 6

const pad = value => String(value).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const isTime = value => Number.isFinite(value)
const minutes = ms => Math.max(0, Math.floor(ms / MIN))
const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

/**
 * When the word reached its chat, as the board knows it: null while it is on its way. Delivered, or taken by the addressee's
 * own Workers mod (not a hand's, `isHandTaken`). The time is the take that began its delivery (`takenAt`), else its
 * `deliveredAt`: the mod takes the word, types it and says "typed" a moment after the turn it began reported its since, so a
 * turn's since can be a second before `deliveredAt` while it is never before the take (the board-dev chat's answer 2, "the
 * report's since at or after deliveredAt", read so that this race never shows a running turn as not picked up).
 */
export function arrivedAt(word) {
  // The coordinator's rule 2 of 2026-11-04: a judge word whose text sat in another word's merged prompt counts as typed. The
  // outbox record's `wordsIn` that would say so is not on this main: it plugs in here (a word named in another's `wordsIn`).
  if (word?.state === 'delivered') return [word.takenAt, word.deliveredAt, word.at].find(isTime) ?? null
  if (word?.state === 'taken' && !isHandTaken(word)) return [word.takenAt, word.at].find(isTime) ?? null
  return null
}

/** Whether the action of a word has a Done source of its own (`recapDone`, `obsoleteDone`, `sweepDone`): then the fallback "answered" is never used. */
export function hasOwnDone(word) {
  if (!OWN_DONE.includes(word?.command)) return false
  return word.command !== 'recap-feedback' || (Array.isArray(word.backSteps) && word.backSteps.length > 0)
}

/**
 * A word that failed and will not go again (as store.mjs `retryFailed` decides: refused for good, a why that never passes by
 * itself, its tries spent, a work line or envelope, or late): it can never reach its chat (the review of 2026-11-02, 4).
 */
export function isLostForGood(word, now, keep = {}) {
  if (word?.state !== 'failed' || word.retriedAs !== undefined) return false
  return word.final === true || !passesBySelf(word.why) || ['work', 'handover'].includes(word.command) || (word.tries ?? 1) >= TRIES || isLate(word, now, keep)
}

const oneLine = (words, max = 120) => String(words ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * The line of one word: `{ state, lead, rest, at, chat, canSendAgain, link, seen }`, or null when the word is no wait: closed,
 * dropped or superseded (`judge.matters` false), copied for the person to paste, or expired and not late by rule 8. `seen`
 * what the server keeps on the word once (`{ answeredAt }` with `answeredBound` when only the later turn's start is known,
 * `{ doneAt, doneWords, doneStep }`), null when nothing new was seen.
 * - `word`: the outbox record (`id`, `to`, `state`, `at`, `takenAt`, `deliveredAt`, ...), the copy that stands for it when retried;
 * - `lane`: the addressee as the state draws it (`name`, `isRunning`, `status`), or null when it is not on the board;
 * - `report`: its chat's last turn report (`{ state, since, busyAt, word, turn }`, chatReport.mjs: `word` and `turn` only from a mod
 *   that says them, `busyAt` the board's receipt of the last turn start), or null;
 * - `ahead`: the word the report's turn ran on is one of this chat that stood ahead of this word in its queue (`waitsOf`): the
 *   chat has not moved past this word then, whatever the turn's time;
 * - `wake`: its wake as the state carries it (state.mjs `withWakes`: `{ state, final, at, by, why, attempts }`), or null;
 * - `done`: the action's own result when its source says so (`{ at, words, link }`), else null;
 * - `now`, `keep`: the board's clock and the outbox's keep (store.mjs `isLate`);
 * - `queue`: how many of the addressee's waiting words came before it;
 * - `judge`: rule 8's judgement of one word (supervisor/index.mjs `wordJudge`): `isUndelivered(word)`, watch.mjs's function that
 *   `undeliveredWords` uses (the alarm's own: no second clock), and `matters(word)`, the outbox sweep's (`wordMatters`);
 * - `paused`: the person pauses the chats (no Send again then: the board wakes nobody);
 * - wave 2: `own` whether the action has a Done source of its own (else `hasOwnDone(word)`: the places say it, `OWN_PLACES`);
 *   `outlives` a result that ends the reason for the word (a refine written: the sweep drops the word as no longer needed) still
 *   reads as Done; `needsPill` false for the Supervisor's judge word (the coordinator's rule 2 of 2026-11-04: "on it" reads the word's
 *   own state and the mod's `report.word`, never the chat's status pill); `exact` too: only the turn the mod says ran on this very word
 *   ends it, never "answered by" a later turn on another word; `progress` (`{ at, words }`) what its chat wrote that is no result of the
 *   action (the partner's next question in a change of a goal): "<Chat> answered HH:MM" with the words, never "Done"; `keepsClosed`
 *   the line of a word that the outbox sweep closed or a newer word superseded stands while its own wait does (an incident that still
 *   waits for its judgment: the review of 2026-11-04, "the line goes only when the incident is judged or ended by code").
 */
export function waitLineOf({ word, lane = null, report = null, ahead = false, wake = null, done = null, now, keep = {}, queue = 0, judge, paused = false, own: ownGiven = undefined, outlives = false, needsPill = true, exact = false, progress = null, keepsClosed = false, running = from => now - from, heard = running, wall = from => now - from, unknownMs = REPORT_FRESH_MS, staleMs = REPORT_STALE_MS, showsClosed = true, turnLate = true, closedSeenAt = null }) {
  if (word === null || word === undefined || typeof word.to !== 'string' || !isTime(word.at)) return null
  if (['stopped', 'copied'].includes(word.state)) return null
  const hasResult = isTime(word.doneAt) || (done !== null && done !== undefined)
  const chat = lane?.name ?? word.to
  const line = (state, lead, rest, at, more = {}) => ({ state, lead, rest, at, chat, canSendAgain: false, link: null, seen: null, ...more })
  // P3, no silent end: a word the outbox sweep closes (dropped, or one that no longer matters and waits for the sweep) says why, quietly, for
  // CLOSED_SHOWN_MS, dated by its `closedAt`, else by the first moment the board saw it closed (`closedSeenAt`, kept by `waitsOf`), never
  // by the clock of each draw (the review of 2026-11-09, 3: a line dated `now` never went).
  if ((word.state === 'dropped' || !judge.matters(word)) && !((outlives && hasResult) || keepsClosed)) {
    const why = oneLine(word.state === 'dropped' && typeof word.why === 'string' ? word.why : judge.whyClosed?.(word))
    const closedAt = isTime(word.closedAt) ? word.closedAt : word.state === 'dropped' ? word.at : isTime(closedSeenAt) ? closedSeenAt : now
    return showsClosed && why !== '' && now - closedAt < CLOSED_SHOWN_MS ? line('closed', `closed: ${why}`, '', closedAt) : null
  }
  const own = ownGiven ?? hasOwnDone(word)
  // P3: Late is counted in the board's RUNNING time (rule 8's: a person's pause and the board's off time do not count), and names what
  // the person does (the review of 2026-11-09, 7): a turn on it ended, "ask X in its chat"; its session ended or went quiet, "open X's
  // chat"; not delivered yet, "open X's chat so its mod takes it". Send again only for a word its chat has not taken (`arrived` null,
  // as before P3: for a taken word it could only wake the chat), and never on an "on it" line.
  const isPending = WAKE_PENDING.includes(wake?.state)
  const noId = wake?.why === 'no id' && (wake.attempts ?? []).length === 0
  const arrived = arrivedAt(word)
  const canAgain = arrived === null && lane?.isRunning === false && !isPending && !noId && paused !== true
  const askIt = `ask ${chat} in its chat`
  const openIt = `open ${chat}'s chat`
  const lateLine = (since, words, action) => line('late', `No answer since ${clockOf(since)}`, `${words} · ${action}`, since)
  // The report as the board heard it: fresh (under the unknown limit), quiet (past it, before REPORT_STALE_MS), or stale; `heard` the
  // board's running time since board start, its deaf spans left out (watch.mjs `deafMs`).
  const isReport = report !== null && report !== undefined && isTime(report.since)
  const quietFor = isReport && isTime(report.at) ? heard(report.at) : 0
  const isStale = isReport && quietFor > staleMs
  const isQuiet = isReport && !isStale && quietFor > unknownMs
  const noNews = `no news from ${chat} since ${isReport && isTime(report.at) ? clockOf(report.at) : '?'}`
  // 1. Done, as kept on the word first (the review of 2026-11-02, 2a: once seen, it stays), then as seen now.
  if (isTime(word.doneAt)) {
    const link = done?.link ?? (typeof word.doneStep === 'string' ? { step: word.doneStep, text: `See ${word.doneStep} →` } : null)
    return line('done', `Done ${clockOf(word.doneAt)}`, done?.words ?? word.doneWords ?? '', word.doneAt, { link })
  }
  if (done !== null && done !== undefined) {
    const at = isTime(done.at) ? done.at : now
    return line('done', `Done ${clockOf(at)}`, done.words ?? '', at, { link: done.link ?? null, seen: { doneAt: at, doneWords: oneLine(done.words, 160), ...(typeof done.link?.step === 'string' ? { doneStep: done.link.step } : {}) } })
  }
  // Progress of an action whose result is something else (the partner asked its next question): said as an answer, never as Done.
  if (progress !== null && progress !== undefined) {
    const at = isTime(progress.at) ? progress.at : now
    return line('done', `${chat} answered ${clockOf(at)}`, progress.words ?? '', at, { isFallback: true })
  }
  // A turn seen ended at `at` (exact), or moved past by `at` (bound: the chat's later turn began then, so the word's turn ended
  // before: "by", never an exact time).
  // P3 (the review of 2026-11-09, 1): the turn ended without the result is Late only while the chat is at REST now (`restNow`), counted from
  // the later of the turn's end and the moment it came to rest (its background work or a later turn done: the report's `restAt`); while it
  // still works (a background task, the partner waiting on its helper, a worker stopping at a safe point) it is quiet. Judge lines never.
  const ended = (at, isBound = false) => {
    const more = { isTurnEnded: true, ...(isBound ? { isBound } : {}) }
    if (!own) return line('done', `${chat} answered ${isBound ? 'by ' : ''}${clockOf(at)}`, '', at, { isFallback: true, ...(isBound ? { isBound } : {}) })
    const lead = `${chat}'s turn ended ${isBound ? 'by' : 'at'} ${clockOf(at)} without it`
    // Chat 1's ruling (2026-11-09): with no report at all (a chat on an older mod) no guess either way: never "still working", never Late.
    if (!isReport) return line('sent', lead, `no report from ${chat}: not confirmed`, at, more)
    const rest = restNow()
    const from = Math.max(at, rest.since ?? at)
    if (turnLate && rest.isAtRest && paused !== true && running(from) > TURN_GRACE_MS) return { ...lateLine(from, lead, rest.isSession ? openIt : askIt), ...more }
    // An asking report: the chat waits for the person's answer in its own chat (P3 fix), never "still working".
    const busyWords = report.state === 'asking' && !isStale ? `${chat} asks you in its chat` : isStale || isQuiet ? noNews : `${chat} still working`
    return line('sent', lead, rest.isAtRest ? '' : busyWords, at, more)
  }
  // Whether the chat is at rest now, and since when: a fresh idle report with no background work and a lane neither Working nor Waiting for
  // you (rest since `restAt`, the board's receipt of that rest, else the report's since); or its session ended (an `ended` report, the lane not running).
  function restNow() {
    if (lane?.isRunning === false || (isReport && report.state === 'ended')) return { isAtRest: true, isSession: true, since: isReport && report.state === 'ended' ? report.since : null }
    const isIdle = isReport && !isStale && !isQuiet && report.state === 'idle' && report.background !== true && !['Working', 'Waiting for you'].includes(lane?.status)
    // The later of `restAt` and the idle's own since (P3 fix): a busy report the board missed (a turn on another word, unheard) leaves an
    // older restAt kept; the rest can never have begun before the idle it is part of.
    return isIdle ? { isAtRest: true, isSession: false, since: isTime(report.restAt) ? Math.max(report.restAt, report.since) : report.since } : { isAtRest: false }
  }
  if (isTime(word.answeredAt)) return ended(word.answeredAt, word.answeredBound === true)
  // The Supervisor's judge word says its own turn's end (`endedAt`, supervisor/index.mjs `markWord`): exact, never guessed.
  if (isTime(word.endedAt)) return ended(word.endedAt)
  const hasReport = isReport && arrived !== null
  // The mod names the word its turn ran on (`report.word`, a string, or null for a turn that was no word's): then the board knows
  // the turn of this word, it does not guess it from busy and idle. A report without it is from an older mod (the older rule).
  const isNamed = hasReport && report.word !== undefined
  const isOurs = isNamed && report.word === word.id
  // The turn that ran on the word has ended, seen now; kept from now on (`seen`). An `ended` report (the session closed or crashed
  // mid-turn) is no answer.
  // `exact` (the judge word): only the turn the mod says ran on this very word ends it, never a later turn on another word ("answered by").
  const found = hasReport ? turnAnswer({ word, report, arrived, isNamed, isOurs, ahead }) : null
  const answer = exact && found?.isBound === true ? null : found
  if (answer !== null) return { ...ended(answer.at, answer.isBound), seen: { answeredAt: answer.at, ...(answer.isBound ? { answeredBound: true } : {}) } }
  // 2. Late: a word that can never reach its chat; rule 8's own judgement; or every way to wake the chat failed while the word
  // was not in it. Send again only for a chat that does not run, while no wake is pending, nobody pauses, and the board has
  // an id to reach it (one without could only be refused: open its chat).
  // P3: a person's word that expired before it reached its chat is attention and keeps its words (nothing was done with them).
  // Its age is the one it expired at (`closedAt`, the store's), never one that grows with each draw (the review of 2026-11-09, 9).
  if (arrived === null && word.command !== 'sweep' && (word.state === 'expired' || (word.state === 'waiting' && isLate(word, now, keep)))) {
    const age = word.state === 'expired' && isTime(word.closedAt) ? word.closedAt - word.at : running(word.at)
    return line('late', `Not delivered: expired after ${minutes(age)} min`, `your words: "${oneLine(word.text, 160)}"`, word.at, { text: String(word.text ?? '').slice(0, 600), isExpired: true })
  }
  // Rule 8's own Late, "Not picked up after N min": N in WALL time after the person's pause, as rule 8 counts it (watch.mjs `isUndelivered`),
  // so the card and the alarm say one number (the review of 2026-11-09, 10); running time is only for P3's new rules.
  if (isLostForGood(word, now, keep)) {
    return line('late', `Not picked up after ${minutes(wall(word.at))} min`, `could not be delivered: ${oneLine(word.why) || 'the chat did not take it'}`, word.at)
  }
  const isUndelivered = judge.isUndelivered(word) === true
  const wakeFailed = arrived === null && wake?.final === true
  if (isUndelivered || wakeFailed) {
    const tried = triedWords(wake?.attempts ?? [], clockOf)
    const cause = noId ? `the board has no id to wake ${chat}: open its chat`
      : wakeFailed || tried.length > 0 ? `${chat} did not wake: ${tried.join('; ') || wake?.why || 'no way left to wake it'}`
        : word.state === 'failed' && oneLine(word.why) !== '' ? `it could not be typed: ${oneLine(word.why)}`
          : `it waits in ${chat}'s queue${canAgain ? '' : ` · open ${chat}'s chat so its mod takes it`}`
    return line('late', `Not picked up after ${minutes(wall(word.at))} min`, cause, word.at, { canSendAgain: canAgain })
  }
  // The supervisor's own sweep word expires in ten minutes by design (rule 8 leaves it out): no wait any more.
  if (word.state === 'expired' || (word.state === 'waiting' && isLate(word, now, keep))) return null
  // 3. Picked up (P3: the record first). The word was picked up when the mod named it on a busy or asking report: the server writes that
  // time on the word once (`pickedUpAt`), and the line reads it, so a later report of another turn does not undo it. With the mod's `word`:
  // the report is busy (or asking, the chat's own question inside that turn, the lane Waiting for you) on this very word, since that
  // turn's own start. Late only when the chat stopped or its report went stale (older than the lane's unknown limit): a fresh turn
  // that runs long is quiet ("on it for 95 min"), there are no limits per kind. Without `word` (an older mod; a word its chat took
  // inside a turn that runs, taken and never typed: on in that turn, from the take) the older rule stands.
  // The stale limit is REPORT_STALE_MS of heard running time (the review of 2026-11-09, 2); a quiet report before it says "no news".
  if (isNamed || isTime(word.pickedUpAt)) {
    const isLive = isOurs && (report.state === 'busy' ? !needsPill || lane?.status === 'Working' : report.state === 'asking' && (!needsPill || lane?.status === 'Waiting for you'))
    const pickedAt = isTime(word.pickedUpAt) ? word.pickedUpAt : isLive || (isOurs && report.state === 'ended') ? turnOf(report) : null
    if (pickedAt !== null) {
      const isStopped = (hasReport && report.state === 'ended') || lane?.isRunning === false
      const was = `${chat} was on it since ${clockOf(pickedAt)}`
      const why = isStopped ? 'its chat stopped' : 'its chat went quiet'
      if (isStopped || isStale) {
        // While the person pauses the chats: said quietly, never Late (the review of 2026-11-09, 8).
        if (paused === true) return line('sent', was, why, pickedAt)
        const at = isStopped ? (hasReport && report.state === 'ended' ? report.since : pickedAt) : report.at
        return lateLine(Math.max(at, pickedAt), `${was}; ${why}`, openIt)
      }
      const span = running(pickedAt)
      const seen = isLive && !isTime(word.pickedUpAt) ? { pickedUpAt: pickedAt } : null
      return line('picked-up', `${chat} is on it`, `since ${clockOf(pickedAt)}${span >= JUDGE_LONGEST_MS ? ` · for ${minutes(span)} min` : ''}${isQuiet ? ` · ${noNews}` : ''}`, pickedAt, { seen })
    }
  } else if (hasReport && !isStale && (needsPill ? lane?.status === 'Working' : report.state === 'busy') && (report.since >= arrived || word.state === 'taken')) {
    return line('picked-up', `${chat} is on it`, `since ${clockOf(Math.max(report.since, arrived))}`, Math.max(report.since, arrived))
  }
  // 4. Sent: why it is not picked up yet, as far as the board knows. A chat that does not run first: its wake words.
  const sent = `Sent ${clockOf(word.at)}`
  if (word.isHeld === true) return line('sent', sent, 'held while you pause the chats', word.at)
  if (lane?.isRunning === false) return line('sent', sent, wakingWords(chat, lane, wake), word.at)
  if (arrived !== null) {
    const turn = waitingTurn({ report: hasReport ? report : null, ahead, arrived, chat, paused, running, limitMs: judge.limitMs ?? DELIVERY_LIMIT_MS })
    if (turn.isLate) return lateLine(turn.since, turn.words, askIt)
    return line('sent', sent, turn.words, word.at)
  }
  if (word.state === 'failed') return line('sent', sent, `${chat} could not take it; the board tries again`, word.at)
  const place = queue > 0 ? [`${ordinal(queue + 1)} in its queue`] : lane?.isRunning === true ? ['next in its queue'] : []
  return line('sent', sent, [`waits for ${chat} to pick it up`, ...place].join(' · '), word.at)
}

/** What rule 8 waits for a word (config `undeliveredMinutes`) when the judge does not say. */
const DELIVERY_LIMIT_MS = 10 * MIN

/**
 * P3: a word typed into its chat that the chat has not picked up: `{ words, isLate, since }`. Counted from the END of the turn that was
 * running when it arrived (the `ahead` logic: the report's own turn), never from its delivery:
 * - the chat's turn began after the word arrived, on a word ahead of it: the mod merges the prompts of words that wait together, so that
 *   turn may have taken this one: quiet "X's turn at HH:MM may have taken it (not confirmed)", never Late;
 * - the chat is busy (or asks) on something else, a turn that began before the word arrived: quiet "waits for its turn: X busy since HH:MM";
 * - the chat is idle: the wait counts from the end of that turn (or the arrival); Late once it exceeds rule 8's limit in running time.
 */
function waitingTurn({ report, ahead, arrived, chat, paused, running, limitMs }) {
  const quiet = { words: `in ${chat}'s chat since ${clockOf(arrived)}, waits for its turn`, isLate: false, since: arrived }
  if (report === null) return quiet
  if (ahead === true && isTime(report.turn) && report.turn > arrived) return { ...quiet, words: `${chat}'s turn at ${clockOf(report.turn)} may have taken it (not confirmed)` }
  if (['busy', 'asking'].includes(report.state)) return { ...quiet, words: `waits for its turn: ${chat} busy since ${clockOf(turnOf(report))}` }
  const since = report.state === 'idle' ? Math.max(arrived, report.since) : arrived
  return report.state === 'idle' && paused !== true && running(since) > limitMs ? { words: `${chat}'s turn ended and it has not taken the word`, isLate: true, since } : quiet
}

/** The start of the turn a report is of: the mod's `turn` (unchanged by a question that opens and closes inside it), else its since. */
const turnOf = report => (isTime(report.turn) ? report.turn : report.since)

/**
 * Whether the turn that ran on the word has ended, and when: `{ at, isBound }` or null (the signals lead's decision of
 * 2026-11-02, .claude/plans/2026-11-02-wait-line-turn-code-check.md). Words are queued by the mod, never injected, one word is one
 * turn, in order, so a busy report's start says nothing of the word (an ask that opens and closes gives a later one inside one
 * turn): the board reads which turn it was only from the mod's `word`.
 * - the mod names the word (`isNamed`): the report is idle on this very word: exact, at its since (the turn's end). Else, bound:
 *   the report is of a later turn of the chat (`turn` after the word was delivered, on another word or none, and not on a word
 *   that stood ahead of this one in the queue) with the chat running or at rest: the word's turn ended before it began, "by"
 *   that time, never an exact one. A turn that began before the word was delivered (the one running while it waited, a wake
 *   message's first turn) says nothing;
 * - an older mod: an idle report answers only when the turn it ended began at or after the word arrived (`busyAt`, the board's
 *   receipt of that turn's start, kept with the report): the idle that ends the turn running while the word waited does not.
 */
function turnAnswer({ word, report, arrived, isNamed, isOurs, ahead }) {
  if (!isNamed) {
    return report.state === 'idle' && report.since >= arrived && isTime(report.busyAt) && report.busyAt >= arrived ? { at: report.since, isBound: false } : null
  }
  if (isOurs && report.state === 'idle') return { at: report.since, isBound: false }
  // The review of 2026-11-09, 4: the last idle the chat reported (`lastIdle`, kept on the report entry by bridge.mjs `noteReport`), so an
  // idle on this word that no pass saw before an `ended` (or a later turn) replaced it still ends the word's turn, exactly.
  const idle = report.lastIdle
  if (idle?.word === word.id && isTime(idle.since) && idle.since >= arrived) return { at: idle.since, isBound: false }
  if (isOurs) return null
  const isLater = isTime(report.turn) && word.state === 'delivered' && isTime(word.deliveredAt) && report.turn > word.deliveredAt
  return isLater && ahead !== true && ['busy', 'idle', 'asking'].includes(report.state) ? { at: report.turn, isBound: true } : null
}

/** Condition 1: the Sent line of a chat that does not run reads its wake record. */
function wakingWords(chat, lane, wake) {
  switch (wake?.state) {
    case 'on-its-way': return `waking ${chat} (message on its way${wake.by ? `, held by ${wake.by}` : ''})`
    case 'sent': return `waking ${chat} (message sent ${clockOf(wake.at)}${wake.by ? ` by ${wake.by}` : ''})`
    case 'launched': return `waking ${chat} (launched ${clockOf(wake.at)})`
    case 'waiting-sender': return `waking ${chat} (waits for a chat that can send)`
    case 'failed': return `waking ${chat} (${wake.why ?? 'the first way failed'}; trying the other way)`
    default: return lane?.status === 'Not running' ? `${chat} does not run; the board wakes it` : `${chat} is asleep; the board wakes it`
  }
}

/**
 * Whether a word is one an action of the person typed: an answer, the recap's feedback, the obsolete check, an asked sweep (wave 1);
 * and, wave 2, a refine the person asked for (not the gate's own `board`, the supervisor's repeat `syncKey`, nor Autopilot's `isAuto`),
 * Go, a goal ask, a talk word, a brainstorm word of theirs, and a Stop or Remove the main chat does (`byCode`: the board does it, instantly).
 * The judge word is no such word: its lines are the incidents' (`judgeLinesOf`).
 */
export function isPersonWord(word, { sweepWord = null, now = null } = {}) {
  if (typeof word?.to !== 'string' || word.to === '' || !isTime(word.at)) return false
  if ((word.ask ?? null) !== null) return true
  if (word.command === 'sweep') return typeof sweepWord === 'string' && word.id === sweepWord
  if (['recap-feedback', 'obsolete-check', 'how-go', 'goal-ask', ...TALK_COMMANDS, ...FOCUS_COMMANDS, ...BRAINSTORM_COMMANDS, ...PLAN_COMMANDS].includes(word.command)) return true
  if (word.command === 'recommend') return word.answer === 'no'
  if (FREE_KINDS.includes(word.free) && (word.command ?? null) === null) return true
  if (word.command === 'refine') return word.board !== true && word.isAuto !== true && (word.syncKey ?? null) === null
  if (!['stop', 'remove'].includes(word.command)) return false
  // A stop or remove the board carries out by code is instant (no line) for STOP_HANDS_MS; after it the main chat takes it after all
  // (hands.mjs `isForHandsYet`), and that hand-over is a wait like any other: its line, while the word still waits or was taken.
  if (word.byCode !== true) return true
  return isTime(now) && now - word.at >= STOP_HANDS_MS && (['waiting', 'taken'].includes(word.state) || (word.state === 'delivered' && isTime(word.takenAt)))
}

/**
 * Where an action of the person has its line (wave 2, the eight places of plan-wave2.md): 'refine', 'go', 'change' (a word of a
 * change thread, `Kind: change`), 'goal-ask', 'overturn' (the answer to a recap of finished work that the person overturned),
 * 'worker' (Stop or Remove), 'focus' (the Focus and Goals clicks: Pick, Start, This is the goal definition, Did we reach the goal, the
 * re-check, the demo, Done when, Undo), 'talk' (every other word of the Focus talk and of a brainstorm), else the wave 1 places 'answer',
 * 'recap', 'obsolete', 'sweep'. `threads` the state's brainstorm threads, `items` the work store's items.
 */
export function placeOfWord(word, { threads = [], items = null } = {}) {
  if ((word?.ask ?? null) !== null) return isOverturn(word, items) ? 'overturn' : 'answer'
  switch (word?.command) {
    case 'refine': return 'refine'
    case 'how-go': return 'go'
    case 'goal-ask': return 'goal-ask'
    case 'stop': case 'remove': return 'worker'
    case 'recap-feedback': return 'recap'
    case 'obsolete-check': return 'obsolete'
    case 'sweep': return 'sweep'
    default: break
  }
  if (BRAINSTORM_COMMANDS.includes(word?.command)) return threadOf(word, threads)?.kind === 'change' ? 'change' : 'talk'
  if (FOCUS_COMMANDS.includes(word?.command)) return 'focus'
  if (PLAN_COMMANDS.includes(word?.command)) return 'plan'
  if (word?.command === 'recommend') return 'recommend'
  if (FREE_KINDS.includes(word?.free) && (word?.command ?? null) === null) return 'free'
  return TALK_COMMANDS.includes(word?.command) ? 'talk' : null
}

/** The thread a brainstorm word is about (its `about` is the thread's path). */
const threadOf = (word, threads) => (Array.isArray(threads) ? threads : []).find(one => one?.path === word?.about) ?? null

/** The recap (a note of the store, `Recap: overturned`) a person's answer overturned: the answer's `ask` is `work:<id>`. */
function overturnedRecap(word, items) {
  const id = String(word?.ask ?? '').match(/^work:(.+)$/)?.[1]
  const item = id === undefined || !(items instanceof Map) ? undefined : items.get(id)
  return item !== undefined && valueOf(item, 'Kind') === 'note' && valueOf(item, 'Recap') === 'overturned' ? item : null
}
const isOverturn = (word, items) => overturnedRecap(word, items) !== null

/** The goal a word is about (G<n>), for the page to find the line of the goal's card: its `goal`, `about`, or its thread's goal. */
function goalOfWord(word, place, threads) {
  if (typeof word.goal === 'string') return word.goal
  if (['go', 'talk', 'focus'].includes(place) && /^G\d+$/.test(String(word.about ?? ''))) return word.about
  const goal = threadOf(word, threads)?.goal?.id
  return typeof goal === 'string' ? goal : null
}

/** The copy that stands for a retried word (`retriedAs`, a few hops at most), else the word itself. */
export function standingWord(word, byId) {
  let found = word
  for (let hop = 0; hop < RETRY_HOPS && typeof found?.retriedAs === 'string' && byId.has(found.retriedAs); hop += 1) found = byId.get(found.retriedAs)
  return found
}

/** The minute a time falls in: a step's Since and History are stamped to the minute. */
const minuteOf = at => Math.floor(at / MIN) * MIN

/**
 * The recap's own result (the supervisor's dropped-fix rule, resultCheck.mjs `reviewWaitOf`: a step whose part was sent back
 * waits for the partner's next try until a new fix, a block on its next try or a new check stands): Done once every step of a
 * part sent back (`word.backSteps`, the steps in review at the Send) has its next try filed after the Send, or left review.
 * `{ at, words, link }` with the new tasks, or null while one still waits (or the word names no steps: the fallback).
 */
export function recapDone(word, items) {
  const steps = Array.isArray(word?.backSteps) ? word.backSteps.filter(id => typeof id === 'string') : []
  if (steps.length === 0 || !(items instanceof Map)) return null
  const from = minuteOf(word.at)
  const after = item => (isTime(madeAtMs(item)) && madeAtMs(item) >= from ? madeAtMs(item) : null)
  const tries = []
  for (const id of steps) {
    const item = items.get(id)
    if (item === undefined) continue
    if (valueOf(item, 'State') !== 'review') {
      const at = sinceMs(valueOf(item, 'Since'))
      tries.push({ id: null, at: isTime(at) ? at : null })
      continue
    }
    const blockers = [...new Set(`${valueOf(item, 'Blocked by') ?? ''} ${valueOf(item, 'Waits for') ?? ''}`.match(/\bB\d+\b/g) ?? [])].filter(one => one !== id)
    const next = [...fixesOf(id, items), ...blockers.map(one => items.get(one)).filter(Boolean)]
      .map(one => ({ id: valueOf(one, 'Id'), at: after(one) })).filter(one => one.at !== null).sort((a, b) => a.at - b.at)
    if (next.length === 0) return null
    tries.push(...next)
  }
  if (tries.length === 0) return null
  const made = [...new Set(tries.map(one => one.id).filter(Boolean))]
  const times = tries.map(one => one.at).filter(isTime)
  return {
    at: times.length === 0 ? null : Math.max(...times),
    words: made.length === 0 ? 'what you sent back moved on' : `${made.length} new task${made.length === 1 ? '' : 's'} for what you sent back`,
    link: made.length === 0 ? null : { step: made[0], text: `See ${made[0]} →` },
  }
}

/**
 * The obsolete check's own result: its record (obsolete.mjs `parseObsolete`) answered, for the check this word asked (the
 * record is written just before its word, and a newer check replaces it). `{ at, words }` or null.
 */
export function obsoleteDone(word, record) {
  if (record?.state !== 'done' || !isTime(record.answeredAt) || !isTime(record.at) || record.at > word.at || word.at - record.at > 5 * MIN) return null
  const verdicts = Object.values(record.verdicts ?? {})
  const closed = verdicts.filter(one => one.verdict === 'obsolete').length
  const stay = record.items.length - closed
  return { at: record.answeredAt, words: `${closed} closed as obsolete · ${stay} ${stay === 1 ? 'stays' : 'stay'}`, link: null }
}

/**
 * The asked sweep's own result: its end by its chat's turn (sweep.mjs `heard`, how "told"), for the sweep this word asked
 * (`sweep.word`). One the board ended because nothing took its word (how "quiet") is no result: the line follows the word.
 */
export function sweepDone(word, sweep) {
  if (sweep?.word !== word.id || !isTime(sweep.ended) || sweep.how !== 'told') return null
  const found = Number.isInteger(sweep.found) ? sweep.found : 0
  return { at: sweep.ended, words: found === 0 ? 'nothing new found' : `${found} incident${found === 1 ? '' : 's'} filed`, link: null }
}

/**
 * Wave 2, place 1, a refine (Send answers, Refine again, Ask for pictures): the step's refine written after the word, as the
 * state's own refine ask reads it (refineWait.mjs `isBlockWritten`: the round the word asked for, or the block's key changed
 * since the word, or its stamp at or after the word's minute). `step` the state's backlog step. `{ at, words }` or null.
 */
export function refineDone(word, step) {
  if (step === undefined || step === null || step.refined === undefined || step.refined === null || !isBlockWritten(step.refined, word)) return null
  const written = refinedAt(step.refined)
  return { at: isTime(written) ? Math.max(written, minuteOf(word.at)) : null, words: 'refined', link: null }
}

/**
 * Place 2, Go on a goal: the goal's round opened with its steps. Of the work blocks of the goal (`blocksOf`; of the round's open ones when
 * the state's `focus` is this goal's: `openNow`, by their place in its parts, so a block carried as done is none of it) each one that
 * had no task before the word has a task filed after it (`items`: the store's; a task's own made time). A block that had tasks is
 * carried (kept): it needs none. At least one task must be made after the word. `node` the goal map's node. `{ at, words, link }` or null.
 */
export function goDone(word, node, items, focus = null) {
  if (!(items instanceof Map)) return null
  const open = focus?.id === node?.id && Array.isArray(focus.openNow) && focus.openNow.length > 0 ? new Set(focus.openNow.map(one => one.index)) : null
  const blocks = blocksOf(node).filter(part => open === null || open.has(node.parts.indexOf(part)))
  if (blocks.length === 0) return null
  const from = minuteOf(word.at)
  const madeOf = id => (items.has(id) ? madeAtMs(items.get(id)) : Number.NaN)
  const filed = blocks.map(part => ({
    isCarried: (part.steps ?? []).some(id => isTime(madeOf(id)) && madeOf(id) < from),
    made: (part.steps ?? []).map(id => ({ id, at: madeOf(id) })).filter(one => isTime(one.at) && one.at >= from),
  }))
  if (filed.some(block => !block.isCarried && block.made.length === 0)) return null
  const steps = [...new Map(filed.flatMap(block => block.made).map(one => [one.id, one])).values()].sort((a, b) => a.at - b.at)
  if (steps.length === 0) return null
  return { at: Math.max(...steps.map(one => one.at)), words: `${steps.length} step${steps.length === 1 ? '' : 's'}`, link: { step: steps[0].id, text: `See ${steps[0].id} →` } }
}

/**
 * The clock entries of a change thread (its questions, what it understood, its proposal), each with its date: the thread's lines carry
 * only HH:MM, so they are dated from its start (`started`, "2026-10-19 09:00") forward, a day on for every time earlier than the one
 * before (the talk went past midnight). Never later than the real time: that is dated early at worst (a talk idle for days), so a line
 * can read "not yet" but never "done" from something written before the word. `ms` is NaN where it cannot be dated, or would be after `now`.
 */
function threadTimes(thread, now) {
  const start = String(thread?.started ?? '').match(/^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d{1,2}):(\d\d))?/)
  if (start === null) return null
  const questions = [...(thread.earlier ?? []), ...(thread.latest ? [thread.latest] : [])]
  const understood = thread.understood ?? null
  const entries = []
  questions.forEach((question, index) => {
    if (understood !== null && understood.after === index) entries.push({ kind: 'understood', at: understood.at })
    entries.push({ kind: 'question', at: question.at, question })
  })
  if (understood !== null && !(understood.after < questions.length)) entries.push({ kind: 'understood', at: understood.at })
  if (thread.proposal !== null && thread.proposal !== undefined) entries.push({ kind: 'proposal', at: thread.proposal.at })
  let offset = 0
  let before = Number(start[4] ?? 0) * 60 + Number(start[5] ?? 0)
  return entries.map(entry => {
    const clock = String(entry.at ?? '').match(/(\d{1,2}):(\d\d)/)
    if (clock === null) return { ...entry, ms: Number.NaN }
    const minutes = Number(clock[1]) * 60 + Number(clock[2])
    if (minutes < before) offset += 1
    before = minutes
    const ms = new Date(Number(start[1]), Number(start[2]) - 1, Number(start[3]) + offset, Number(clock[1]), Number(clock[2])).getTime()
    return { ...entry, ms: ms > now ? Number.NaN : ms }
  })
}

/**
 * Place 3, Change this goal (the review of 2026-11-04): Done only by a new goal-definition draft the partner wrote after the word (the
 * proposal's Objective), its time in the minutes after the word's, compared as full date-times (`threadTimes`). `thread` the state's
 * brainstorm thread. `{ at, words }` or null; a next question or what it understood is `changeProgress`, not a result.
 */
export function changeDone(word, thread, now = Date.now()) {
  const times = thread === undefined || thread === null ? null : threadTimes(thread, now)
  const draft = times?.find(one => one.kind === 'proposal')
  if (draft === undefined || !isTime(draft.ms) || draft.ms <= minuteOf(word.at)) return null
  const objective = thread.proposal?.objective
  return typeof objective === 'string' && objective !== '' ? { at: draft.ms, words: 'new definition', link: null } : null
}

/**
 * Reactive board, P4b round 2 (chat 1's pick B, 2026-11-10): the Done of a word of a brainstorm talk that is no change of a goal: the thread's
 * next stage from the thread record, as `changeDone` reads the change thread's: a new question, what it understood, a proposal written after
 * the word (dated by `threadTimes`, never by the clock of each draw), or the thread done or discarded. Null while none stands; a word that names
 * no thread (the Focus talk bar's) has none. With it the talk word is an own-result word: its chat's turn ended without it is P3's own
 * "turn ended at HH:MM without it" (Late after the grace, with the chat at rest), never a Done "answered" for a turn that wrote nothing.
 */
export function talkDone(word, thread, now = Date.now(), goal = null) {
  if (thread === undefined || thread === null) return null
  const from = minuteOf(word.at)
  // Thread times are whole minutes: a question stamped in the SAME minute as the word is its next stage when it is the latest and unanswered, or
  // what the partner understood stands unanswered (the word answers an earlier one); a proposal needs a strictly later minute (a Change word is
  // sent while a proposal stands).
  const isOpen = one => (one.kind === 'question' && one.question === thread.latest && (thread.latest.answer ?? null) === null) || (one.kind === 'understood' && (thread.understood?.answer ?? null) === null)
  const next = (threadTimes(thread, now) ?? []).filter(one => isTime(one.ms) && (one.ms > from || (one.ms === from && isOpen(one)))).sort((a, b) => a.ms - b.ms)[0]
  if (next !== undefined) return { at: next.ms, words: { question: 'a new question', understood: 'what it understood', proposal: 'a proposal' }[next.kind], link: null }
  if (['done', 'discarded'].includes(thread.state)) return { at: null, words: thread.state === 'done' ? 'the talk is over' : 'the talk is discarded', link: null }
  return goalPassed(thread, goal, now, null) ? { at: null, words: 'the goal moved on', link: null } : null
}

/**
 * Whether the goal's own stage has passed the stage of the thread's last question (the live G64 case of 2026-11-11: the person's answer "the how
 * fits" came after Go, the partner gave the go, the goal went to its run, and the thread never got a next question): the goal is done, or a stage
 * stamp of its lines (`Goal definition agreed`, `How agreed`) is at or after the time the last question was asked, so the question belongs to a
 * stage that has passed. With `focusId` (the stuck rule) a goal that is no longer the focus is past too. A goal not in the map is no evidence.
 */
function goalPassed(thread, goal, now, focusId) {
  if (goal === undefined || goal === null) return false
  if (goal.state === 'done') return true
  if (typeof focusId === 'string' && focusId !== goal.id) return true
  const asked = thread.latest === undefined || thread.latest === null ? undefined : (threadTimes(thread, now) ?? []).find(one => one.kind === 'question' && one.question === thread.latest)
  if (asked === undefined || !isTime(asked.ms)) return false
  return [goal.vibeAgreed, goal.howAgreed].some(stamp => { const at = sinceMs(stamp); return isTime(at) && at >= asked.ms })
}

/**
 * Whether the thread gives the partner the turn, as the page's `brainstormTurnOf` reads it (a second copy: the page cannot import this file): not
 * over (done or discarded), no proposal waiting for the person's tick or created, no open question and no open "what I understood" waiting for them.
 * A "wrapping up" thread with no proposal yet is the partner's.
 */
function partnerHasTurn(thread) {
  if (['done', 'discarded'].includes(thread?.state)) return false
  if ((thread.proposal ?? null) !== null) return false
  if (thread.state === 'running' && thread.latest != null && (thread.latest.answer ?? null) === null) return false
  return !(thread.state === 'running' && thread.understood?.isOpen === true && (thread.understood.answer ?? null) === null)
}

/**
 * P4b round 2c (chat 1's answer for a stuck talk past P3's 24/48 h line window): the brainstorm threads whose LAST talk word ended (its turn was
 * seen to end, `answeredAt`/`endedAt`; else its `closedAt`, else its own time) without the thread's next stage, from the outbox and the thread record, not from P3's line: `[{ path,
 * since, chat }]`, `since` the end of that turn. The page shows the quiet "no answer from <partner> since HH:MM" with its Retry for as long as
 * the thread still gives the partner the turn; a change thread (its Done is a proposal) and the board's own words are left out.
 */
export function stuckTalksOf({ state, outbox = [], now }) {
  const found = []
  for (const thread of state?.brainstorms?.threads ?? []) {
    if (thread?.kind === 'change' || !partnerHasTurn(thread)) continue
    // The goal done, no longer the focus, or past the stage of the last question: the talk is never stuck.
    const goal = (state?.goals?.nodes ?? []).find(node => node.id === thread.goal?.id) ?? null
    if (goalPassed(thread, goal, now, state?.focus?.id ?? '')) continue
    const mine = outbox.filter(word => isTime(word?.at) && typeof word.to === 'string' && BRAINSTORM_COMMANDS.includes(word.command) && (word.about === thread.path || String(word.text ?? '').includes(`Thread: ${thread.path}`)))
      .sort((a, b) => b.at - a.at)
    const last = mine[0]
    if (last === undefined) continue
    // The end of the word's turn when it was seen; else (it expired before delivery, its chat never reported, the sweep closed it) the word's own
    // close, else its own time: the thread still gives the partner the turn, and that is what the person needs to know.
    const end = [last.answeredAt, last.endedAt, last.closedAt, last.at].find(isTime)
    if (talkDone(last, thread, now, goal) !== null) continue
    found.push({ path: thread.path, since: end, chat: last.to })
  }
  return found
}

/**
 * Place 3: what the partner wrote after the word that is no result of it: the next question it waits for the person's answer to, or what
 * it understood and waits for their yes (written after the word, still unanswered). Shown as "<Partner> answered: a question for you".
 */
export function changeProgress(word, thread, now = Date.now()) {
  const times = thread === undefined || thread === null ? null : threadTimes(thread, now)
  if (times === null) return null
  const from = minuteOf(word.at)
  const open = times.filter(one => isTime(one.ms) && one.ms > from && ((one.kind === 'question' && one.question === thread.latest && (thread.latest.answer ?? null) === null) || (one.kind === 'understood' && (thread.understood?.answer ?? null) === null)))
    .sort((a, b) => b.ms - a.ms)[0]
  return open === undefined ? null : { at: open.ms, words: open.kind === 'question' ? 'a question for you' : 'what it understood, for your yes' }
}

/**
 * Reactive board, brief P4c: a word to the partner about the plan is Done once the PARTNER wrote the plan page after it (or, for Go deeper, Get
 * options and an answer, its question about that card): `plan.pageAt` is the page's time as `partnerPageAt` (src/planWrite.mjs) reads it, so the
 * board's own write of a decision never counts as the partner's answer. `plan` the state's plan (null: no page yet, no result). The same rule
 * `withPlanWork` uses, one copy (src/plan.mjs `planAnswered`). `{ at, words, link }` or null.
 */
export function planDone(word, plan) {
  if (plan === null || plan === undefined || !isTime(word?.at)) return null
  const about = word.about ?? 'plan'
  if (!planAnswered(plan, word.command, about, word.at, plan.pageAt ?? null)) return null
  const asked = word.command === 'plan-deeper' ? 'deeper questions' : word.command === 'plan-ask' ? 'the options' : 'your plan is written'
  return { at: isTime(plan.pageAt) && plan.pageAt > word.at ? plan.pageAt : null, words: asked, link: null }
}

/**
 * "No, because…" on the way card (the word to the Advisor): the record the way card reads is the milestone's recommendation: Done once the
 * Advisor's recommendation is another one than the word's (`about` its id). `milestone` the state's. `{ at, words, link }` or null; no time of
 * its own (the first moment the board saw it).
 */
export function recommendDone(word, milestone) {
  const rec = milestone?.recommendation ?? null
  if (rec === null || typeof word?.about !== 'string' || rec.id === word.about) return null
  return { at: null, words: 'another task proposed', link: null }
}

/** Place 4, a goal ask: the partner's answer under that goal. `goal` the goal map's node, the word's `about` the ask's id. */
export function goalAskDone(word, goal) {
  const answer = (goal?.asks ?? []).find(one => one.id === word.about)?.answer ?? null
  if (answer === null) return null
  const at = sinceMs(answer.at)
  return { at: isTime(at) ? Math.max(at, minuteOf(word.at)) : null, words: `answered under ${goal.id}`, link: null }
}

/** The words of a text a person's words are looked for in: longer than three letters, each once, in small letters. */
const wordsOfText = text => [...new Set(String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])]

/** Whether a step was made from an overturn: its text names the recap (N<n>), or holds half of the person's words (two at least). */
function namesOverturn(item, recapId, said) {
  const text = [valueOf(item, 'Title') ?? '', ...[...item.sections.values()].flat()].join('\n')
  if (typeof recapId === 'string' && new RegExp(`\\b${recapId}\\b`, 'i').test(text)) return true
  const wanted = wordsOfText(said)
  if (wanted.length === 0) return false
  const have = new Set(wordsOfText(text))
  const hits = wanted.filter(one => have.has(one)).length
  return hits >= Math.min(wanted.length, Math.max(2, Math.ceil(wanted.length / 2)))
}

/**
 * Place 5, Overturn: the fix step made from the person's words, filed after the word. For a step's recap: a step that fixes it (`Fix of`).
 * For a goal's recap (the review of 2026-11-04): a step of that goal made from the person's overturn words, its text naming the recap or
 * holding their words, never any step of the goal. The recap is the note the answer's `ask` (work:<id>) names. `{ at, words, link }` or null.
 */
export function overturnDone(word, items) {
  const recap = overturnedRecap(word, items)
  const about = recap === null ? null : (recap.sections.get('About') ?? [])[0]?.trim() ?? null
  if (about === null || about === '') return null
  const from = minuteOf(word.at)
  const said = (recap.sections.get('Answer') ?? []).join(' ')
  const recapId = valueOf(recap, 'Id')
  const candidates = /^G\d+$/.test(about) ? [...items.values()].filter(one => valueOf(one, 'Kind') === 'step' && valueOf(one, 'Goal') === about && namesOverturn(one, recapId, said)) : fixesOf(about, items)
  const made = candidates.map(one => ({ id: valueOf(one, 'Id'), at: madeAtMs(one) })).filter(one => typeof one.id === 'string' && isTime(one.at) && one.at >= from).sort((a, b) => a.at - b.at)
  if (made.length === 0) return null
  return { at: made[0].at, words: made.length === 1 ? made[0].id : `${made[0].id} and ${made.length - 1} more`, link: { step: made[0].id, text: `See ${made[0].id} →` } }
}

/** The lane states in which a worker no longer runs the task it was told to stop. */
const STOPPED_LANE_STATES = ['free', 'suspended', 'interrupted', 'off']

/**
 * Place 6, Stop or Remove a worker the main chat does (a stop the board does in code has no word, instantly, until STOP_HANDS_MS): a stop
 * is done once the worker's lane no longer holds the task it was told to stop (the word names it: `taskStep`, `taskText`): its task gone or
 * changed, the worker gone from the list, or (the lane was working when told: `laneState`) it no longer works; a word without them reads
 * the task gone. A remove is done once the worker is gone from the list (or its lane says it was removed). `lane` the worker's lane in the
 * state, or undefined when the list no longer has it. `{ at, words }` or null; `at` null when the source has no time (the first moment
 * the board saw it is kept, `waitsOf`).
 */
export function workerDone(word, lane) {
  if (word.command === 'remove') {
    if (lane !== undefined && lane !== null && lane.isLeftover !== true && !isTime(lane.removedAt)) return null
    return { at: isTime(lane?.removedAt) ? lane.removedAt : null, words: 'removed', link: null }
  }
  const done = { at: null, words: 'stopped', link: null }
  if (lane === undefined || lane === null || lane.isLeftover === true) return done
  const task = lane.task ?? null
  if (task === null) return done
  const named = typeof word.taskStep === 'string' ? word.taskStep : null
  const isChanged = named !== null ? task.stepId !== named : typeof word.taskText === 'string' && word.taskText !== '' && String(task.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) !== word.taskText
  if (isChanged) return done
  return word.laneState === 'working' && STOPPED_LANE_STATES.includes(lane.state) ? done : null
}

/** How an incident's wait ended (the Supervisor's verdict, or code's 60-minute rule): the words and the fix step it names. */
function judgmentOf(state, fix) {
  const named = typeof fix === 'string' && /^B\d+$/.test(fix) ? { step: fix, text: `See ${fix} →` } : null
  switch (state) {
    case 'closed': return { words: 'false alarm: no fault left', link: null }
    case 'gone': return { words: 'went by itself', link: null }
    case 'fixed': return { words: named === null ? 'fixed' : `fixed by ${fix}`, link: named }
    case 'fix': return { words: named === null ? 'given a fix step' : `fix step ${fix}`, link: named }
    default: return null
  }
}

/**
 * Place 8, an incident that waits for the Supervisor's judgment: one line per incident, from its newest judge word (the outbox
 * record signals change 6 keeps: `incidents`, `endedAt`) and the incident's own state in the store. The coordinator's rules of
 * 2026-11-04: Done also when code ends it (the 60-minute "gone" or "fixed" rule, its fix step done), the same as the Supervisor's
 * verdict; the counting of an incident (a repeat of its key) never starts a new wait or moves the clock (the clock is the word's);
 * "on it" reads the word's own state (`needsPill` false). A judgment that came before the incident's state change (an incident that
 * came back after it) is no wait of this word. `{ [<word id>#<incident id>]: line }`; no kept result: the incident's state is the
 * store's, kept for good, and one judge word covers many incidents.
 */
export function judgeLinesOf({ outbox, items, now, keep, judge, lanes, reports, paused, running = from => now - from, heard = running, wall = from => now - from, unknownMs = REPORT_FRESH_MS, staleMs = REPORT_STALE_MS }) {
  const newest = new Map()
  for (const word of outbox) {
    if (word?.command !== 'judge' || !Array.isArray(word.incidents) || !isTime(word.at) || now - word.at >= WAITS_KEPT_MS) continue
    // The newest word that NAMES the incident is its line: a newer word that does not name it never ends it (the review of 2026-11-04).
    for (const id of word.incidents) if (!(newest.get(id)?.at > word.at)) newest.set(id, word)
  }
  const out = {}
  if (!(items instanceof Map)) return out
  for (const [id, word] of newest) {
    const item = items.get(id)
    if (item === undefined || valueOf(item, 'Kind') !== 'incident') continue
    const state = valueOf(item, 'State')
    const since = sinceMs(valueOf(item, 'Since'))
    const isWaiting = INCIDENT_WAITS.includes(state)
    // An incident that opened or came back after this word waits for the next one; one that ended before it, no word of this one's.
    if (isWaiting ? ['open', 'came back'].includes(state) && isTime(since) && since > word.at : !(isTime(since) && since >= minuteOf(word.at))) continue
    const judgment = isWaiting ? null : judgmentOf(state, valueOf(item, 'Fix'))
    if (!isWaiting && judgment === null) continue
    const lane = lanes.get(word.to) ?? null
    const report = (reports instanceof Map ? reports.get(word.to) : null) ?? lane?.report ?? null
    const queue = outbox.filter(one => one.to === word.to && one.state === 'waiting' && one.isHeld !== true && one.id !== word.id && isTime(one.at) && one.at < word.at).length
    const line = waitLineOf({
      word, lane, report, wake: lane?.wake ?? null, done: judgment === null ? null : { at: since, words: judgment.words, link: judgment.link }, now, keep, queue, judge, paused,
      own: true, outlives: true, needsPill: false, exact: true, keepsClosed: isWaiting, running, heard, wall, unknownMs, staleMs, showsClosed: false, turnLate: false,
    })
    if (line === null) continue
    out[`${word.id}#${id}`] = { ...line, seen: line.seen?.doneAt === undefined ? line.seen : null, place: 'judge', word: word.id, command: 'judge', about: id, ask: null, goal: null, sentAt: word.at, title: String(valueOf(item, 'Title') ?? '').slice(0, 160) }
  }
  return out
}

/**
 * The own result of a wave 2 place (`refineDone` and the others), or null: a source that cannot be read (a task the store does not hold
 * yet, a thread half written) is no result, and never stops the lines of the others (a line is information).
 */
function doneOfPlace(word, place, { state, items, steps, goals, threads, now }) {
  try {
    switch (place) {
      case 'refine': return refineDone(word, steps.get(word.about))
      case 'go': return goDone(word, goals.get(word.about), items, state?.focus ?? null)
      case 'change': return changeDone(word, threadOf(word, threads), now)
      case 'talk': return talkDone(word, threadOf(word, threads), now, goals.get(threadOf(word, threads)?.goal?.id) ?? null)
      case 'goal-ask': return goalAskDone(word, goals.get(word.goal))
      case 'overturn': return overturnDone(word, items)
      case 'plan': return planDone(word, state?.plan ?? null)
      case 'recommend': return recommendDone(word, state?.milestone ?? null)
      case 'worker': return workerDone(word, (state?.chats ?? []).find(one => one?.name === word.about && one.isLeftover !== true))
      default: return null
    }
  } catch {
    return null
  }
}

/** `changeProgress`, never stopping the other lines (as `doneOfPlace`). */
function changeProgressOf(word, thread, now) {
  try {
    return changeProgress(word, thread, now)
  } catch {
    return null
  }
}

/**
 * The board's RUNNING time since `from` (rule 8's clock, watch.mjs `isUndelivered`/`boardOffMs`): the time the person paused the chats
 * does not count (the last pause's end is the earliest start), nor the time the board itself did not run (`state.gaps`, history.mjs).
 */
export function runningOf(state, now) {
  const gaps = Array.isArray(state?.gaps) ? state.gaps : []
  return from => {
    const start = afterPause(state?.pause ?? null, from)
    if (!isTime(start)) return 0
    const off = gaps.reduce((sum, gap) => sum + Math.max(0, Math.min(gap.to, now) - Math.max(gap.from, start)), 0)
    return Math.max(0, now - start - off)
  }
}

/**
 * P3 (the review of 2026-11-09, 2): the board's HEARD running time since `from`, for a report's quiet: counted from the later of `from` and
 * the board's start (`startedAt`: a report kept across a restart did not go quiet while the board was down), the pause and off time left
 * out as `runningOf` does, and the stretches the board heard no chat though chats ran (`state.deaf`, watch.mjs `deafMs`): a board stall or
 * a landing restart is no chat's fault.
 */
export function heardOf(state, now, startedAt = null) {
  const running = runningOf(state, now)
  const deaf = Array.isArray(state?.deaf) ? state.deaf : []
  return from => {
    if (!isTime(from)) return 0
    const start = isTime(startedAt) ? Math.max(from, startedAt) : from
    const off = deaf.reduce((sum, span) => sum + (isTime(span?.from) && isTime(span?.to) ? Math.max(0, Math.min(span.to, now) - Math.max(span.from, start)) : 0), 0)
    return Math.max(0, running(start) - off)
  }
}

/** Rule 8's clock for "Not picked up after N min": WALL time since `from`, from the end of the person's last pause (watch.mjs `isUndelivered`). */
export function wallOf(state, now) {
  return from => {
    const start = afterPause(state?.pause ?? null, from)
    return isTime(start) ? Math.max(0, now - start) : 0
  }
}

/**
 * P3 (no silent end): the last lines made well, kept by the server. `made(waits, at)` keeps them and gives `{ waits, asOf: null }`;
 * `failed(at)` (a pass that threw) gives the kept lines with `asOf`, the time they were made (else `at` with no lines), so the page draws
 * them under "as of HH:MM" and a card never loses its line, nor reads a missing one as done, because one pass failed.
 */
export function lastGoodWaits() {
  let good = null
  return {
    made(waits, at) {
      good = { waits, at }
      return { waits, asOf: null }
    },
    failed(at) {
      return { waits: good?.waits ?? {}, asOf: good?.at ?? at }
    },
  }
}

/** Every board chat the state draws, by name: the lanes, the partner, its helper, the supervisor's chat, the Product owner. */
function lanesOf(state) {
  const lanes = [...(state?.chats ?? []).filter(lane => lane?.isLeftover !== true), state?.advisor, state?.advisorHelper, state?.supervisorChat, state?.productOwner]
  return new Map(lanes.filter(lane => typeof lane?.name === 'string').map(lane => [lane.name, lane]))
}

/**
 * The state's `waits`: the line of every word an action of the person typed in the last 24 hours (`isPersonWord`), by its
 * id; a retried word by the copy that stands for it. `outbox` the board's raw outbox (as rule 8 reads it), `now` and `keep`
 * the board's clock and the outbox's keep, `judge` rule 8's judgement of the same moment (the supervisor's `wordJudge`, made
 * once for every word), `reports` the board's kept turn reports by chat (a Map), `items` the
 * work store's items, `obsolete` the obsolete check's record, `sweep` the supervisor's last sweep (`{ word, asked, ended, how,
 * found }`). Each line also carries what the page finds it by: `command` ('answer' for an answer), `place` (`placeOfWord`), `about`,
 * `goal` (G<n> when the word is about one), `ask`, `sentAt`, and `title`, the word's first line. Wave 2: the other places' own
 * results are read from the same `state` the page draws (its backlog steps, goal map, brainstorm threads, lanes) and the store's `items`;
 * an incident that waits for the Supervisor's judgment has a line of its own under `<word id>#<incident id>` (`judgeLinesOf`).
 */
export function waitsOf({ state, outbox = [], now, keep = {}, judge, reports = null, items = null, obsolete = null, sweep = null, firstSeen = null, unknownMs = REPORT_FRESH_MS, staleMs = REPORT_STALE_MS, startedAt = null }) {
  const paused = isHolding(state?.pause) || state?.pause?.state === 'resuming'
  const running = runningOf(state, now)
  const heard = heardOf(state, now, startedAt)
  const wall = wallOf(state, now)
  const byId = new Map(outbox.filter(word => typeof word?.id === 'string').map(word => [word.id, word]))
  // The place of each word in the outbox, which is the order its chat takes them in (store.mjs `take`) and types them.
  const placeOf = new Map(outbox.map((word, place) => [word?.id, place]))
  const lanes = lanesOf(state)
  const sweepWord = sweep?.asked === true && typeof sweep.word === 'string' ? sweep.word : null
  const threads = state?.brainstorms?.threads ?? []
  const steps = new Map((state?.backlog ?? []).flatMap(activity => activity?.steps ?? []).filter(step => typeof step?.id === 'string').map(step => [step.id, step]))
  const goals = new Map((state?.goals?.nodes ?? []).filter(node => typeof node?.id === 'string').map(node => [node.id, node]))
  const waits = {}
  for (const asked of outbox) {
    if (!isPersonWord(asked, { sweepWord, now }) || now - asked.at >= WAITS_KEPT_MS + ENDED_SHOWN_MS) continue
    const word = standingWord(asked, byId)
    const place = placeOfWord(word, { threads, items })
    const lane = lanes.get(word.to) ?? null
    const report = (reports instanceof Map ? reports.get(word.to) : null) ?? lane?.report ?? null
    const queue = outbox.filter(one => one.to === word.to && one.state === 'waiting' && one.isHeld !== true && one.id !== word.id && isTime(one.at) && one.at < word.at).length
    const found = word.command === 'recap-feedback' ? recapDone(word, items) : word.command === 'obsolete-check' ? obsoleteDone(word, obsolete) : word.command === 'sweep' ? sweepDone(word, sweep)
      : doneOfPlace(word, place, { state, items, steps, goals, threads, now })
    // A result with no time of its own (a stop, a remove, a refine block with no stamp) is dated by the first moment the board saw it,
    // kept (`firstSeen`, the server's own map, and on the word once the server writes it), never by the clock of each draw.
    const done = found === null || isTime(found.at) || !(firstSeen instanceof Map) ? found : { ...found, at: firstSeen.get(word.id) ?? now }
    if (done !== null && firstSeen instanceof Map && !isTime(found.at)) firstSeen.set(word.id, done.at)
    const progress = place === 'change' && done === null ? changeProgressOf(word, threadOf(word, threads), now) : null
    // The word the chat's turn ran on, when it is one of the chat's that came before this one: its turn is not this word's.
    const ranOn = typeof report?.word === 'string' ? byId.get(report.word) : undefined
    const ahead = ranOn !== undefined && ranOn.to === word.to && ranOn.id !== word.id && ['taken', 'delivered'].includes(ranOn.state) && placeOf.get(ranOn.id) < placeOf.get(word.id)
    // Wave 2: a place with a Done source of its own says "turn ended without it" when its turn ended without the result; the talk has none.
    // P4b round 2: a word of a brainstorm talk (its thread known) has the thread's next stage as its own Done, as a change thread's word has.
    const isOwnPlace = (OWN_PLACES.includes(place) && !(place === 'plan' && PLAN_DECISIONS.includes(word.command))) || (place === 'talk' && threadOf(word, threads) !== null)
    // The first moment the board saw a word closed that has no `closedAt` of its own (one the sweep would close): its "closed" line is dated by it.
    const closedKey = `${CLOSED_KEY}${word.id}`
    const closedSeenAt = firstSeen instanceof Map ? firstSeen.get(closedKey) ?? null : null
    const first = waitLineOf({ word, lane, report, ahead, wake: lane?.wake ?? null, done, now, keep, queue, judge, paused, outlives: isOwnPlace, progress, running, heard, wall, unknownMs, staleMs, closedSeenAt, ...(WAVE2_PLACES.includes(place) ? { own: isOwnPlace } : {}) })
    if (firstSeen instanceof Map && !isTime(word.closedAt) && closedSeenAt === null && (first?.state === 'closed' || (first === null && word.state !== 'dropped' && !judge.matters(word)))) firstSeen.set(closedKey, first?.at ?? now)
    if (first === null) continue
    // P3, no silent end: a word past a day without a Done says so for one more day ("no answer recorded in 24 h"), quietly, and its wait has
    // ENDED (`isEnded`: Needs your attention lets its card go): the chat may have answered in its own chat, which the board did not see. A
    // closed line has none (it shows ten minutes). An expired word's line is not rewritten (the review of 2026-11-09, 9): it keeps its
    // attention and the person's words, and is marked ended too.
    const isOld = now - asked.at >= WAITS_KEPT_MS
    if (isOld && first.state === 'closed') continue
    const line = !isOld || first.state === 'done' ? first
      : first.isExpired === true ? { ...first, isEnded: true, seen: null }
        : { ...first, state: 'sent', lead: `Sent ${clockOf(asked.at)}`, rest: 'no answer recorded in 24 h', canSendAgain: false, link: null, seen: null, at: asked.at, isEnded: true }
    const title = String(asked.text ?? '').split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 160)
    waits[asked.id] = { ...line, word: word.id, command: (asked.ask ?? null) !== null ? 'answer' : asked.command ?? asked.free, place, about: asked.about ?? asked.freeAbout ?? null, ...(place === 'plan' && typeof asked.said === 'string' ? { said: asked.said } : {}), goal: goalOfWord(asked, place, threads), ask: asked.ask ?? null, sentAt: asked.at, title }
  }
  // Place 8: an incident that waits for the Supervisor's judgment, a line of its own each.
  Object.assign(waits, judgeLinesOf({ outbox, items, now, keep, judge, lanes, reports, paused, running, heard, wall, unknownMs, staleMs }))
  if (firstSeen instanceof Map) for (const id of firstSeen.keys()) if (!byId.has(id.startsWith(CLOSED_KEY) ? id.slice(CLOSED_KEY.length) : id)) firstSeen.delete(id)
  return waits
}

/**
 * The review of 2026-11-02 (2a): what the server keeps on the words once (`answeredAt`, `doneAt` with its words), out of the
 * lines of `waitsOf` (each line's `seen`), and the lines as the page gets them (without `seen`). `{ waits, seen: [{ id, fields }] }`,
 * `id` the word the line read (the copy that stands for a retried word), once per word.
 */
export function splitSeen(waits) {
  const seen = new Map()
  const shown = {}
  for (const [id, { seen: fields, ...line }] of Object.entries(waits ?? {})) {
    shown[id] = line
    if (fields !== null && fields !== undefined && typeof line.word === 'string' && !seen.has(line.word)) seen.set(line.word, fields)
  }
  return { waits: shown, seen: [...seen].map(([id, fields]) => ({ id, fields })) }
}
