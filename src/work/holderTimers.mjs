// Signals change 3 (the lead's brief .claude/plans/2026-11-01-held-step-never-stuck-brief.md, its code check and the
// lead's Addendum; the person's yes of 2026-11-01: "5 minutes, then one 'go on', 15 minutes later the task goes back with
// its checkpoint"): a worker that holds a task can never sit on it for ever. The hand-over's one decision (handover.mjs
// `decide`, rule 2) runs two timers for a holder on the sequence that stopped:
//
// - after `resumeAfterMinutes` (5) of the board's running time: ONE "go on" line per stopped spell, built from the step's
//   checkpoint and branch, as a back-like envelope (step null, a `resume` marker that makes it once per spell); at most
//   GO_ON_MOST (2) per holder and step, after which only a checkpoint or a busy spell over 2 minutes resets the count;
// - `giveBackAfterMinutes` (15) after that line was written with no progress: the give-back (giveBack.mjs: the work API's
//   give-back path, the flow's server move "the board gives it back").
//
// PURE. Every fact comes from the store (the step's state, Since, Checkpoint, Branch, History, the asks), the lane (its
// state and report), the outbox (its resume envelopes, the person's stop words) and pause.json; nothing is stored anew.

import { afterPause, checkpointOf } from './pause.mjs'
import { waitsOnOf } from './waitsOn.mjs'
import { assetProgressAt, assetWaitOf } from './assetWait.mjs'
import { sinceMs, valueOf } from './item.mjs'
import { isKeptLook } from './keptLook.mjs'

const MIN = 60_000
/** The envelope kind of the "go on" line (the Workers mod 0.27.x reads an unknown kind as 'task': it types the line, no clear). */
export const RESUME_KIND = 'resume'
/** The settings' defaults (config.mjs `resumeAfterMinutes`, `giveBackAfterMinutes`). */
export const RESUME_MINUTES = 5
export const GIVE_BACK_MINUTES = 15
/** The lane states of a holder that does not work on its step: Stopped (idle or ended with it), off, or not known. */
export const STOPPED_LANES = ['interrupted', 'off', 'unknown']
/** The step states the timers watch: the worker's work now; never one that waits on the person, nor one in review. */
export const TIMED_STATES = ['taken', 'in progress']
/**
 * The Supervisor's watch rules these timers retire (watch.mjs): unknown-lane and holder-not-running. Their open incidents
 * are closed with one line by the board's pass over the incidents (api.mjs `incidentsFixed`).
 */
export const RETIRED_WATCH_RULES = Object.freeze(['unknown-lane', 'holder-not-running'])
/** The line an open incident of a retired rule is closed with. */
export const retiredWords = rule => `closed: the rule ${rule} is retired (signals change 3): the board's own timers give a stopped holder one "go on" line, then give its step back`
/** The person's pause states in which no timer runs (pausing and its resume, which wakes the holders itself). */
const PAUSE_STATES = ['pausing', 'resuming']

const finite = value => Number.isFinite(value)
const two = n => String(n).padStart(2, '0')
/** A time as HH:MM, the board's clock. */
export const hourMinute = ms => `${two(new Date(ms).getHours())}:${two(new Date(ms).getMinutes())}`
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const isMine = (item, name, prefix) => plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix)
const historyOf = item => item?.sections?.get('History') ?? []

/** The marker of a resume envelope: once per step and stopped spell (`since`, when the spell began). */
export const resumeMarker = (id, since) => `resume ${id} ${since}`
const MARKER = /^resume ([A-Z]\d+) (-?\d+)$/
/** The step a resume marker names, or null. */
export const markerStep = marker => MARKER.exec(String(marker ?? ''))?.[1] ?? null

/** Where a step's work stands: its Branch field and its checkpoint's commit and next action, "none" for what it lacks. */
export function standOf(item) {
  const checkpoint = checkpointOf(item)
  return { branch: valueOf(item, 'Branch') ?? 'none', commit: checkpoint?.commit ?? 'none', next: checkpoint?.next ?? 'none' }
}

/** The "go on" line (the Addendum's words): `go on with B12 from your checkpoint: branch X, commit Y, next: Z`. */
export function goOnLine(item) {
  const { branch, commit, next } = standOf(item)
  return `go on with ${valueOf(item, 'Id')} from your checkpoint: branch ${branch}, commit ${commit}, next: ${next}`
}

/** The step's History line when the board wrote the "go on" line (the board writes it as `server`). */
export const goOnWords = (chat, since) => `the board asked ${chat} to go on (stopped since ${hourMinute(since)})`
/** That History line, read back: `[, stamp, chat, HH:MM]`. */
export const GO_ON_LINE = /^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?)\s+server: the board asked (.+?) to go on \(stopped since (\d\d:\d\d)\)/

/**
 * The give-back's History words, the move's why (api.mjs `giveBackHeld`, through giveBack.mjs): `given back by the board:
 * Worker N did not resume it (asked HH:MM)`.
 */
export const giveBackWords = (chat, askedAt) => `given back by the board: ${chat} did not resume it (asked ${hourMinute(askedAt)})`
/** The same for a holder gone from the list of chats (repair.mjs owner-gone): `given back by the board: Worker N left the list of chats`. */
export const goneWords = chat => `given back by the board: ${chat} left the list of chats`
/** That History line (either), read back: `[, stamp, chat]`. */
export const GIVEN_BACK = /^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?)\s+server: .*?\bgiven back by the board: (.+?) (?:did not resume it|left the list of chats)\b/
/** A History line that took a step: "queued → taken", "queued → in progress" (`[, stamp, who]`). */
const TAKE_LINE = /^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?)\s+([^:]{1,80}): queued → (?:taken|in progress)\b/

/** A step's give-backs, oldest first: `[{ at, chat }]`. */
export function givenBackOf(item) {
  const found = []
  for (const line of historyOf(item)) {
    const hit = GIVEN_BACK.exec(line)
    if (hit !== null) found.push({ at: sinceMs(hit[1]), chat: hit[2].trim() })
  }
  return found
}

/** When a step was last taken (any taker), or -Infinity. */
const lastTakenAt = item => Math.max(-Infinity, ...historyOf(item).map(line => TAKE_LINE.exec(line)).filter(Boolean).map(hit => sinceMs(hit[1])).filter(finite))

/**
 * The give-back the step's next hand-out continues from, or null: its newest give-back, when no take came after it.
 * `{ at, chat }` (`chat` the worker that dropped it).
 */
export function continuationOf(item) {
  const back = givenBackOf(item).at(-1) ?? null
  return back !== null && finite(back.at) && back.at >= lastTakenAt(item) ? back : null
}

/**
 * The line that gives a given-back step to its next worker (the Addendum's words after the usual line): `work: B12 is
 * yours; run work next, then continue B12 from its checkpoint: branch X, commit Y, next: Z; fetch the branch, the old
 * worktree is removed by the sync`, with "(local only)" after a commit that is on no remote branch (`localOnly`).
 */
export function continuationLine(item, { localOnly = false } = {}) {
  const id = valueOf(item, 'Id')
  const { branch, commit, next } = standOf(item)
  return `work: ${id} is yours; run work next, then continue ${id} from its checkpoint: branch ${branch}, commit ${commit}${localOnly && commit !== 'none' ? ' (local only)' : ''}, next: ${next}; fetch the branch, the old worktree is removed by the sync`
}

/**
 * The board's refusal for a worker whose step was given back, when it calls step, report or take on it later: `B12 was
 * given back by the board at HH:MM: stop that work and run work next`; null when the step names no give-back from that
 * worker, or the step is its own again (given or held anew).
 */
export function givenBackRefusal(item, who, prefix = '') {
  const back = givenBackOf(item).filter(one => plain(one.chat, prefix) === plain(who, prefix)).at(-1) ?? null
  if (back === null) return null
  const state = valueOf(item, 'State')
  if (isMine(item, who, prefix) && ['queued', 'taken', 'in progress', 'waiting on you', 'review'].includes(state)) return null
  return `${valueOf(item, 'Id')} was given back by the board at ${finite(back.at) ? hourMinute(back.at) : 'a time not known'}: stop that work and run work next`
}

/**
 * The steps given back from worker `name` since its last take (its lane's line "did not resume B12, given back HH:MM",
 * until its next task): `[{ id, at }]`, oldest first.
 */
export function givenBackFrom(items, name, prefix = '') {
  let since = -Infinity
  for (const item of items.values()) {
    for (const line of historyOf(item)) {
      const hit = TAKE_LINE.exec(line)
      if (hit !== null && plain(hit[2], prefix) === plain(name, prefix)) since = Math.max(since, sinceMs(hit[1]))
    }
  }
  const found = []
  for (const item of items.values()) {
    for (const back of givenBackOf(item)) {
      if (plain(back.chat, prefix) === plain(name, prefix) && finite(back.at) && back.at >= since) found.push({ id: valueOf(item, 'Id'), at: back.at })
    }
  }
  return found.sort((a, b) => a.at - b.at)
}

/** The lead's review (2026-11-01): the most "go on" lines one holder gets for one step (a constant, no setting). */
export const GO_ON_MOST = 2
/** After the last line, a busy spell longer than this starts the give-back's 15 minutes anew (a shorter one does not). */
export const LONG_BUSY_MS = 2 * MIN

/** P1 (2026-11-09): the History's record and clear of a wait on a chat ("waits on chat 1 · ...", "no longer waits on chat 1 ..."). */
const WAIT_MARK = /^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?)\s+[^:]{1,80}: (?:no longer )?waits on \S/
/** When the holder recorded or cleared a wait on a chat: progress of its own, so the spell and the "go on" count start anew. */
const waitMarksOf = item => historyOf(item).map(line => WAIT_MARK.exec(line)).filter(Boolean).map(hit => sinceMs(hit[1])).filter(finite)
/** P1: when a landing of the step's branch landed (`landings`, data/landings.jsonl): the holder's progress too (the release itself). */
const landedAtOf = (item, landings) => {
  const branch = String(valueOf(item, 'Branch') ?? '').trim().toLowerCase()
  if (branch === '' || branch === 'none' || branch === '-') return -Infinity
  return Math.max(-Infinity, ...(Array.isArray(landings) ? landings : []).filter(one => one?.result === 'landed' && String(one.branch ?? '').trim().toLowerCase() === branch && finite(one.at)).map(one => one.at))
}

/** When the step's History says the board asked holder `name` to go on since `from` (its take), oldest first. */
function goOnsOf(item, name, prefix, from) {
  return historyOf(item).map(line => GO_ON_LINE.exec(line)).filter(hit => hit !== null && plain(hit[2], prefix) === plain(name, prefix))
    .map(hit => sinceMs(hit[1])).filter(at => finite(at) && !(at < from))
}

/**
 * The worker's last busy spell that began after `at`, from its lane: `{ ms, end }`, or null. A turn begun after it
 * (`turnAt`) that ended (its report idle, or its session ended, since then), or a busy report begun after it (heard last
 * at `report.at`).
 */
function busySpellAfter(worker, at) {
  const report = worker.report ?? null
  // F26 (B1151, 2026-11-14): a turn of any kind counts: the transcript's typed turn (`turnAt`), and the turn the report holds (the mod's
  // own `turn`, the board's receipt `busyAt`): a turn the chat's own background work began (a task finished, a helper handed back)
  // moves only those two. The latest start after `at`.
  const starts = [worker.turnAt, report?.turn, report?.busyAt].filter(start => finite(start) && start > at)
  const turnAt = starts.length === 0 ? worker.turnAt : Math.max(...starts)
  if (finite(turnAt) && turnAt > at && ['idle', 'ended'].includes(report?.state) && finite(report.since) && report.since >= turnAt) return { ms: report.since - turnAt, end: report.since }
  // F26 (chat 1): a turn still running (its report busy, no end yet) counts from its start too: the report's own since, or a turn start it holds.
  const busyFrom = Math.max(-Infinity, ...[report?.since, report?.turn, report?.busyAt].filter(start => finite(start) && start > at))
  if (report?.state === 'busy' && finite(busyFrom) && finite(report.at)) return { ms: report.at - busyFrom, end: report.at }
  return null
}

/**
 * The two timers of one holder (rule 2 of the decision), or null when none runs: its lane works (fresh busy, background
 * work, a wait for the partner: lane state working) or waits for the person, the step is not taken or in progress, an ask
 * of the worker (or under the step) is open (B308), the person's Stop or Remove of the worker came since the take (B769),
 * the worker is being removed or paused for a limit, or the person pauses (or resumes) the chats. Facts:
 *
 * - `worker` its lane, `holding` its step, `items` the store, `prefix`;
 * - `envelopes` its envelopes in the outbox (only the resume ones are read), `stops` the person's stop and remove words
 *   about it, `pause` the store's pause record, `runningMs(from)` the board's running time since `from`;
 * - `resumeMs`, `giveBackMs` the two settings.
 *
 * The spell: since the latest of the step's take or its last state change (Since), its checkpoint, an answer to an ask of
 * the worker, its last turn's start and the time its report stopped (idle or ended since, or the last busy report heard),
 * counted from the end of the person's last pause at the earliest. A resume envelope of the step belongs to the spell
 * while nothing showed work after it (no checkpoint, take or answer, no turn begun, no report idle since or busy after
 * it). Answer `{ since, asked, resume, giveBack, close }`: `asked` when the spell's line was written (or null), `resume`
 * `{ line, marker }` the line due now, `giveBack` `{ step, chat, askedAt }` due now, `close` the waiting line to close
 * with the give-back.
 */
export function holderTimers({ worker, holding, items = new Map(), prefix = '', envelopes = [], stops = [], pause = null, runningMs, resumeMs = RESUME_MINUTES * MIN, giveBackMs = GIVE_BACK_MINUTES * MIN, landings = [], assets = [] }) {
  const id = valueOf(holding, 'Id')
  const name = worker.name
  if (!TIMED_STATES.includes(valueOf(holding, 'State')) || !STOPPED_LANES.includes(worker.state)) return null
  if (finite(worker.removedAt) || worker.removal?.isOpen === true || (worker.suspended ?? null) !== null) return null
  // P1 of the one wait system (2026-11-09): a holder that recorded a wait on a chat (`Waits on`, waitsOn.mjs) is nudged by nobody
  // and gives nothing back, whatever its lane reads (interrupted, unknown after a report blip, off after a failed wake): the wait
  // is a record; its limit is the person's Late (state.mjs `lateWaits`).
  if (waitsOnOf(holding) !== null) return null
  // The asset wait (2026-11-11, the B1124 case): a holder with an open request for its step's pictures (work/assetWait.mjs) waits for
  // the provider, not for a nudge: no "go on" line and no give-back while Codex draws; its limit is the person's Late (state.mjs `lateWaits`).
  if (assetWaitOf(holding, assets, { chat: name, prefix }) !== null) return null
  if (PAUSE_STATES.includes(pause?.state)) return null
  const asks = [...items.values()].filter(item => valueOf(item, 'Kind') === 'ask')
  // The lead's live check (2026-11-02, change 3 BROKEN): the timers paused for ANY open ask of the worker (its own, under
  // any step, blocking or not), so a holder with one old question somewhere was never nudged nor given back. Only a
  // BLOCKING ask of the held step pauses them: that is the one wait that is the person's, not the holder's. A look the
  // partner handed over that Autopilot keeps for the recap (keptLook.mjs, the person's "A" of 2026-11-02) holds no worker
  // either: it is never blocking, so this rule covers it.
  if (asks.some(ask => valueOf(ask, 'State') === 'open' && valueOf(ask, 'Of') === id && valueOf(ask, 'Blocking') === 'yes')) return null
  // Rule 15: an ask of the step held for the person's words, the holder's own, blocking or not, is a wait too: its chat re-checks it, so no go-on and no give-back.
  if (asks.some(ask => valueOf(ask, 'State') === 'open' && valueOf(ask, 'Of') === id && valueOf(ask, 'Route') === 'asker' && isMine(ask, name, prefix))) return null
  const changedAt = sinceMs(valueOf(holding, 'Since'))
  const took = lastTakenAt(holding)
  const takenAt = finite(took) ? took : changedAt
  if (stops.some(word => finite(word.at) && (!finite(takenAt) || word.at >= takenAt))) return null

  // The progress the store knows: the take or last state change, the checkpoint, the person's answer to an ask of it.
  const answered = asks.filter(ask => valueOf(ask, 'State') === 'answered' && isMine(ask, name, prefix)).map(ask => sinceMs(valueOf(ask, 'Since')) + MIN - 1)
  // P1: the record and the clear of a wait on a chat, and the landing of the step's branch, are the holder's progress too.
  const waitMarks = waitMarksOf(holding)
  const landedAt = landedAtOf(holding, landings)
  // The asset wait: the provider's work on the step (a request asked, started or ended) is the holder's progress too: the minutes Codex drew
  // are no stopped spell, so the step is not given back the moment the last picture came (the review of 2026-11-11, finding 1).
  const assetAt = assetProgressAt(holding, assets, { chat: name, prefix })
  const progressAt = Math.max(-Infinity, ...[changedAt, checkpointOf(holding)?.at, ...answered, ...waitMarks, landedAt, assetAt].filter(finite))
  const report = worker.report ?? null
  const stoppedAt = report === null ? -Infinity : ['idle', 'ended'].includes(report.state) ? (finite(report.since) ? report.since : report.at) : report.at
  const since = Math.max(progressAt, ...[stoppedAt, worker.turnAt].filter(finite))
  if (!finite(since)) return null

  const mine = envelopes.filter(one => one?.kind === RESUME_KIND && markerStep(one.resume) === id && finite(one.at))
  const asked = mine.at(-1) ?? null
  // The lead's review (2026-11-01): at most GO_ON_MOST lines per holder and step (since its take). After the last one the
  // give-back's 15 minutes count whatever short turns come: only a checkpoint after it, or a busy spell of over
  // LONG_BUSY_MS after it, starts them anew, and no further line goes.
  // P1: the "go on" lines count from the take, or from the last record or clear of a wait on a chat (an unblock starts them anew).
  const countFrom = Math.max(...[takenAt, ...waitMarks].filter(finite))
  const noted = goOnsOf(holding, name, prefix, countFrom)
  const sent = mine.filter(one => !finite(countFrom) || one.at >= countFrom)
  if (Math.max(noted.length, sent.length) >= GO_ON_MOST) {
    // The last line's time: its envelope, else (an outbox that let it go) the History's line.
    const lastAt = Math.max(-Infinity, ...[asked?.at, noted.at(-1)].filter(finite))
    const checkpointAt = checkpointOf(holding)?.at
    const busy = busySpellAfter(worker, lastAt)
    const from = Math.max(lastAt, ...[checkpointAt, landedAt, assetAt, busy !== null && busy.ms > LONG_BUSY_MS ? busy.end : null].filter(at => finite(at) && at > lastAt))
    const isOver = runningMs(afterPause(pause, from)) >= giveBackMs
    return { since, asked: lastAt, resume: null, giveBack: isOver ? { step: id, chat: name, askedAt: lastAt } : null, close: isOver && asked?.state === 'waiting' ? asked.id : null }
  }
  const workedAfter = at => progressAt > at || (finite(worker.turnAt) && worker.turnAt > at)
    || (report?.state === 'idle' && finite(report.since) && report.since > at) || (report?.state === 'busy' && finite(report.at) && report.at > at)
  if (asked !== null && !workedAfter(asked.at)) {
    // The 15 minutes count from the line being written, not delivered: a chat the app will not open never holds it for ever.
    const isOver = runningMs(afterPause(pause, asked.at)) >= giveBackMs
    return { since, asked: asked.at, resume: null, giveBack: isOver ? { step: id, chat: name, askedAt: asked.at } : null, close: isOver && asked.state === 'waiting' ? asked.id : null }
  }
  const idle = { since, asked: null, resume: null, giveBack: null, close: null }
  if (runningMs(afterPause(pause, since)) < resumeMs) return idle
  const marker = resumeMarker(id, since)
  if (mine.some(one => one.resume === marker)) return idle
  return { ...idle, resume: { line: goOnLine(holding), marker } }
}
