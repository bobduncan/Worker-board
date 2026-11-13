// Signals change 7 (B914, 2026-11-02): the step a worker holds, as the work store records it, for the worker's row. The case:
// B855, taken 11:10 for 90 min (size about 2 h), showed "step 4/4, about 40 min left" at 11:14 from the line the chat typed
// on its own card, its head Since read 11:52 after later moves, and the take's minutes were gone from the Plan at 11:14.
// The row claims only what the store records: which step (`heldOf`), since when (its take's History line), its size (the
// refine's Size, else the take's fixed `Taken for`), its last checkpoint and its saved plan. The card's words never set
// any of them. PURE: every fact comes in as an argument.

import { sizeMinutes, withoutNotes } from '../backlog.mjs'
import { handedBackOf } from '../clearOwed.mjs'
import { sinceMs, valueOf } from './item.mjs'
import { checkpointOf } from './pause.mjs'
import { estimateAtOf, planOf } from './stepPlan.mjs'

/** The states in which a step is its worker's work now, in the order one of them is picked over another (R1). */
export const HELD_RANK = ['in progress', 'waiting on you', 'taken']
/** A History line and who wrote it: `- <date time> <who>: <words>`. */
const LINE_WHO = /^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?) ([^:]{1,80}):\s*(.*)$/
/** Addendum 4: the words of a take: a move to taken, taken to in progress, or a claim (by the holder itself). */
const TAKE_WORDS = /(?:→ taken\b|^taken → in progress\b|^claimed\b)/
/** The server's move to taken for a chat: "queued → taken (for Worker 1)". */
const TAKEN_FOR = /→ taken \(for ([^)]+)\)/
/** A report: the move to review. */
const REPORT_WORDS = /→ review\b/
/** eta-remaining (review A): the work API's History line that it asked the holder a fresh estimate, for the estimate given then. */
export const ASKED_ESTIMATE = /\basked a fresh estimate \(estimated (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\)/
/** Addendum 7: a checkpoint's next action is clipped to this many characters (B855's ran to ~300). */
export const NEXT_CHARS = 120

const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const isMine = (item, name, prefix) => plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix)
const isStep = item => (valueOf(item, 'Kind') ?? 'step') === 'step'
const linesOf = item => (item?.sections?.get('History') ?? []).map(line => LINE_WHO.exec(line)).filter(found => found !== null)
  .map(([, at, who, words]) => ({ at: sinceMs(at), who, words })).filter(line => Number.isFinite(line.at))

/** The newest History line of the step written by `name`, as a time (ms), or -Infinity: its holder's last activity on it. */
function activityOf(item, name, prefix) {
  return linesOf(item).filter(line => plain(line.who, prefix) === plain(name, prefix)).reduce((newest, line) => Math.max(newest, line.at), -Infinity)
}

/**
 * Addendum 4: when the step's current Owner took it: the newest History line `→ taken`, `taken → in progress` or `claimed`
 * written by that Owner (or the server's `→ taken (for <Owner>)`). Never the head's Since, which every move rewrites (B855's
 * read 11:52; it was taken 11:10). Null when the History holds no such line.
 */
export function takenAtOf(item, prefix = '') {
  const owner = valueOf(item, 'Owner')
  if (owner === null) return null
  const takes = linesOf(item).filter(line => (plain(line.who, prefix) === plain(owner, prefix) && TAKE_WORDS.test(line.words))
    || (plain(line.who) === 'server' && plain(TAKEN_FOR.exec(line.words)?.[1] ?? '', prefix) === plain(owner, prefix)))
  return takes.length === 0 ? null : Math.max(...takes.map(line => line.at))
}

/**
 * Addendum 5: the step's size in minutes: the refine's `Size:` ("about 2 h"), else the fixed record the take wrote (`Taken
 * for: 90 min`), else null. Never the Plan's `until` or `step until`: every `work step minutes` rewrites them.
 */
export function sizeOf(item) {
  const refined = (item?.sections?.get('Refined') ?? []).map(one => one.trim().match(/^Size:\s*(.*)$/)?.[1]).find(one => one !== undefined)
  const fromRefine = refined === undefined ? null : sizeMinutes(refined)
  if (fromRefine !== null && fromRefine > 0) return fromRefine
  const taken = String(valueOf(item, 'Taken for') ?? '').match(/^(\d+)\s*min\b/)
  return taken === null ? null : Number(taken[1])
}

/** The take's fixed record of its minutes, as the head writes it: "Taken for: 90 min". */
export const takenForLine = minutes => `${Math.round(minutes)} min`

/**
 * R1 (Addendum 3): which of the steps a holder holds is the one it is on: the hand-over's step first (`handoverStep`, when
 * it is one of them); else in progress over waiting on you over taken, a step handed back after a failed check (review)
 * last; ties by the holder's newest History activity (X23, 24 Oct 21:15: Worker 3 held B547 and B534 in progress; its
 * newest activity was on B534). Undefined for none.
 */
export function pickHeld(candidates, holder, prefix = '', handoverStep = null) {
  const byHandover = handoverStep === null ? undefined : candidates.find(item => valueOf(item, 'Id') === handoverStep)
  if (byHandover !== undefined) return byHandover
  const rank = item => { const at = HELD_RANK.indexOf(valueOf(item, 'State')); return at < 0 ? HELD_RANK.length : at }
  return [...candidates].sort((a, b) => rank(a) - rank(b) || activityOf(b, holder, prefix) - activityOf(a, holder, prefix))[0]
}

/**
 * The step `chatName` holds by the store: `{ id, title, state, since, size, checkpoint, plan }`, or null when it holds none.
 * A step taken, in progress or waiting on you with it as Owner, and (R2) one in review that the board's check handed back to
 * it (clearOwed.mjs `handedBackOf`: it stays in its turn to fix it). `since` is its take (`takenAtOf`), `size` in minutes
 * (`sizeOf`), `checkpoint` `{ commit, next, at }` (next clipped to NEXT_CHARS; one older than the take belongs to an earlier
 * run: null), `plan` the store's saved plan `{ step, steps, names, at }` or null.
 */
export function heldOf(items, chatName, prefix = '', { handoverStep = null } = {}) {
  if (!(items instanceof Map) || typeof chatName !== 'string' || chatName === '') return null
  const mine = [...items.values()].filter(item => isStep(item) && HELD_RANK.includes(valueOf(item, 'State')) && isMine(item, chatName, prefix))
  const back = handedBackOf(items, chatName, prefix)
  const backItem = back === null ? undefined : items.get(back.id)
  if (backItem !== undefined && valueOf(backItem, 'State') === 'review' && isMine(backItem, chatName, prefix)) mine.push(backItem)
  const item = pickHeld(mine, chatName, prefix, handoverStep)
  if (item === undefined) return null
  const since = takenAtOf(item, prefix)
  const point = checkpointOf(item)
  const isOld = point !== null && since !== null && Number.isFinite(point.at) && point.at < since
  const next = point === null ? '' : String(point.next ?? '').trim()
  const saved = planOf(item)
  return {
    id: valueOf(item, 'Id'),
    title: withoutNotes(valueOf(item, 'Title') ?? ''),
    state: valueOf(item, 'State'),
    since,
    size: sizeOf(item),
    checkpoint: point === null || isOld ? null
      : { commit: point.commit, next: next.length > NEXT_CHARS ? `${next.slice(0, NEXT_CHARS - 1).trimEnd()}…` : next, at: Number.isFinite(point.at) ? point.at : null },
    // eta-remaining: the estimate the board last asked a fresh one for (its History line), as ms, or null.
    askedFor: askedForOf(item),
    // eta-remaining (2026-11-11): the task's latest minutes-left as the plan keeps it (`until`, given at `estimatedAt`).
    plan: saved === null ? null : { step: saved.on, steps: saved.steps, names: saved.names, at: saved.writtenAt, until: saved.until, estimatedAt: estimateAtOf(saved) },
  }
}

/** eta-remaining: the estimate time (ms) of the newest "asked a fresh estimate" History line, or null. */
export function askedForOf(item) {
  const found = (item?.sections?.get('History') ?? []).map(String).findLast(one => ASKED_ESTIMATE.test(one))
  const at = found === undefined ? Number.NaN : sinceMs(ASKED_ESTIMATE.exec(found)[1])
  return Number.isFinite(at) ? at : null
}

/**
 * B148 (Addendum 9): the step `chatName` reported last: the newest History line written by it that moves a step to review,
 * `{ id, title, at }`, or null. A free worker's "Last task" is this, never its card's leftover text.
 */
export function lastReportedOf(items, chatName, prefix = '') {
  let newest = null
  for (const item of items instanceof Map ? items.values() : []) {
    if (!isStep(item)) continue
    for (const line of linesOf(item)) {
      if (plain(line.who, prefix) !== plain(chatName, prefix) || !REPORT_WORDS.test(line.words)) continue
      if (newest === null || line.at >= newest.at) newest = { id: valueOf(item, 'Id'), title: withoutNotes(valueOf(item, 'Title') ?? ''), at: line.at }
    }
  }
  return newest
}
