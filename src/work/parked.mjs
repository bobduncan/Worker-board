// B567 (X21: Worker 3 filed Q338 as not blocking and rested on it from 19:55, so B547 stayed in progress with an idle
// chat and three steps queued behind it; X23: Q338 was answered at 21:09 while Worker 3 was on B534, and B547 still
// showed in progress; B522 sat in progress 2 h with its checkpoint "report B522" while its worker did other steps). A
// step its worker holds while it is on another gets a named state and a way back:
// - resting on an open ask: a worker whose turn has ended with nothing running, for REST_MS, while an ask under the step
//   it holds in progress is open: the step moves to waiting on you ("(rests for Q<n>)", the flow's server move
//   REST_GUARD), and the worker counts free for its queued steps (`restsFree`);
// - parked: the step's asks are answered while its worker works on another step: it stays waiting on you, its History
//   says "parked (resumes after B<n>)", and it goes on once that step is reported (`parkedAfter`);
// - anything else (a step in progress while the worker's card names another): named in the health summary and, after an
//   hour, to the main chat (the repair rule held-elsewhere).

import { sinceMs, valueOf } from './item.mjs'
import { isHeld } from './askHold.mjs'
import { isKeptLook } from './keptLook.mjs'
import { waitsOnOf } from './waitsOn.mjs'
import { logBranchName } from '../landing.mjs'

const MIN = 60_000
/** A worker resting this long on an open ask of the step it holds in progress: the step moves to waiting on you. */
export const REST_MS = 15 * MIN
/** The flow's guard of that move (flow.mjs DEFAULT_FLOW, guards.mjs); the reconciler checks the rest itself. */
export const REST_GUARD = 'its worker rests on an open ask'
/** The states of a step its worker works on now. */
export const ACTIVE = ['taken', 'in progress']

const PARK_LINE = /:\s+parked \(resumes after (B\d+)\)\s*$/
/** A History line that moves the step (F74: any move after a park cancels it; before F74 only the move to waiting on you did). */
const MOVE_LINE = / → (?:taken|in progress|waiting on you|review|refined|queued|done|dropped)\b/
/** F74: the board's line when an active parked step goes on (api.mjs `resumeParked`): it ends the park as a move does. */
const RESUME_LINE = /:\s+resumes after B\d+\s*$/
/** F74: the states in which a held step can only wait (its worker holds it, nothing is reported). */
export const WAITABLE = ['taken', 'in progress', 'waiting on you']
/** F74: the states that hold a step on its worker for the two-step cap (given, under way, or waiting on the person). */
export const HELD_FOR_CAP = ['queued', 'taken', 'in progress', 'waiting on you']
/** F74 rework (chat 1's review, 2026-11-27): the states in which a held step is its worker's own now; ONE list for every reader. */
export const HOLDS = ['taken', 'in progress', 'waiting on you']
/** F74: the cap (chat 1's hard cap of two, 2026-11-26): a worker holds at most this many steps, whatever their states. */
export const HOLD_CAP = 2

const stateOf = item => valueOf(item, 'State')
const idOf = item => valueOf(item, 'Id')
/** A chat's name without the list's prefix, for comparing. */
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const sameOwner = (a, b, prefix) => valueOf(a, 'Owner') !== null && plain(valueOf(a, 'Owner'), prefix) === plain(valueOf(b, 'Owner'), prefix)
const stepsIn = items => [...(items?.values?.() ?? items ?? [])].filter(one => (valueOf(one, 'Kind') ?? 'step') === 'step')
const mineOf = (items, owner, prefix = '') => stepsIn(items).filter(one => valueOf(one, 'Owner') !== null && plain(valueOf(one, 'Owner'), prefix) === plain(owner, prefix))
/** F74: the steps `owner` holds for the cap (HELD_FOR_CAP). */
export const heldForCap = (items, owner, prefix = '') => mineOf(items, owner, prefix).filter(one => HELD_FOR_CAP.includes(stateOf(one)))
/** F74: whether `owner` is at the cap: `except` a step this very decision takes back. One rule for the hand-out, the give and the decision. */
export const isCapped = (items, owner, prefix = '', { except = null } = {}) => heldForCap(items, owner, prefix).filter(one => idOf(one) !== except).length >= HOLD_CAP
/** F74: whether a landing runs for a step's branch now (`landing`, as the gate log names branches: `logBranchName`); one place for the match. */
export const isLandingOf = (branch, landing) => typeof landing === 'string' && landing !== '' && typeof branch === 'string' && logBranchName(branch) !== '' && logBranchName(branch) === logBranchName(landing)
/** The order of a held step's state for the active pick: in progress, waiting on you, taken (held.mjs HELD_RANK). */
const ACTIVE_RANK = ['in progress', 'waiting on you', 'taken']
/**
 * F74 rework (chat 1's blocker 1: once a parked step's wait ended, `holdingOf` took it by id and the hand-over's timers, the go-on line, the
 * give-back, the row and the mod's card all switched to it mid-step): the step `owner` is ON now. Of the steps it holds (HOLDS), never one
 * that only waits (`waiting`, the pass's set; else `waitOf` with `landing`) nor one parked behind another (`parkedAfter`); in progress over
 * waiting on you over taken, ties by the newest Since. Every reader of "the worker's step" goes by it. Null for none.
 */
export function activeStepOf(items, owner, prefix = '', { waiting = null, landing = null } = {}) {
  const isWaiting = one => (waiting instanceof Set ? waiting.has(idOf(one)) : onlyWaits(one, items, { landing }))
  const live = mineOf(items, owner, prefix).filter(one => HOLDS.includes(stateOf(one)) && !isWaiting(one) && parkedAfter(one, items, { landing }) === null)
  // Ties keep the store's order (a stable sort): the first held step, as every reader read it before.
  live.sort((a, b) => ACTIVE_RANK.indexOf(stateOf(a)) - ACTIVE_RANK.indexOf(stateOf(b)) || (sinceMs(valueOf(b, 'Since')) || 0) - (sinceMs(valueOf(a, 'Since')) || 0))
  return live[0] ?? null
}

/** Whether the flow lets the board move a step whose worker rests on an open ask (a project's own flow.json may not). */
export const flowRests = flow => (flow?.step?.moves ?? []).some(move => move.from === 'in progress' && move.to === 'waiting on you'
  && (Array.isArray(move.by) ? move.by : [move.by]).includes('server') && move.when === REST_GUARD)

/**
 * The open asks under a step, by id: not a look the partner handed over that Autopilot keeps for the goal's recap (it holds no worker, 2026-11-02),
 * and not an ask held for the person's words (rule 15: it asks nobody, so no rest moves its step to waiting on you).
 */
export const openAskIds = (items, id) => [...(items?.values?.() ?? [])]
  .filter(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'Of') === id && stateOf(one) === 'open' && !isKeptLook(one) && !isHeld(one)).map(idOf)
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

/** The step the owner of `item` works on now (taken or in progress), other than `item`, newest first: its id, or null. */
export function workingOnOther(items, item, prefix = '') {
  const others = stepsIn(items).filter(one => idOf(one) !== idOf(item) && ACTIVE.includes(stateOf(one)) && sameOwner(one, item, prefix))
    .sort((a, b) => (sinceMs(valueOf(b, 'Since')) || 0) - (sinceMs(valueOf(a, 'Since')) || 0))
  return others.length === 0 ? null : idOf(others[0])
}

/**
 * The step a parked step resumes after (its History's last "parked (resumes after B<n>)", written after it last moved to
 * waiting on you), or null: a step not waiting on you, never parked, or with an ask under it open again.
 */
export function parkedAfter(item, items = null, { landing = null, loose = false } = {}) {
  // F74: a step that only waited (taken or in progress) is parked behind the step its worker was given meanwhile, state unchanged.
  if (!WAITABLE.includes(stateOf(item))) return null
  const history = item.sections?.get('History') ?? []
  const at = history.findLastIndex(line => PARK_LINE.test(line))
  if (at < 0 || history.findLastIndex(line => MOVE_LINE.test(line) || RESUME_LINE.test(line)) > at) return null
  if (items !== null && openAskIds(items, idOf(item)).length > 0) return null
  const after = history[at].match(PARK_LINE)[1]
  // F74 rework (chat 1's review: two waits gave circular words): a park holds only while the step it is parked behind is still its worker's
  // active work. Reported, handed on, gone, or itself only waiting (`waitOf`): the park is void and this step is the worker's own again, so
  // every reader agrees. `loose`: the park as written, for the report that ends it (api.mjs `resumeParked`).
  if (items !== null && !loose) {
    const other = items.get?.(after)
    if (other === undefined || !['queued', ...ACTIVE].includes(stateOf(other)) || !sameOwner(other, item) || waitOf(other, items, { landing }) !== null) return null
  }
  return after
}

/** The History words of a park. */
export const parkWords = other => `parked (resumes after ${other})`

/**
 * Whether a worker counts free for its queued steps while it rests: its turn has ended with nothing running (`resting`),
 * it runs, is not suspended, and every step it holds waits on the person or is parked (at least one; `waiting`: ids
 * moved to waiting on you in this same refresh). A worker holding a step taken or in progress is not.
 */
export function restsFree(lane, items, prefix = '', waiting = []) {
  if (lane === undefined || lane === null || lane.isMain === true || lane.isLeftover === true || lane.state === 'suspended' || lane.isRunning === false
    || !Number.isFinite(lane.resting?.since)) return false
  const mine = stepsIn(items).filter(one => valueOf(one, 'Owner') !== null && plain(valueOf(one, 'Owner'), prefix) === plain(lane.name, prefix))
  const isWaiting = one => stateOf(one) === 'waiting on you' || waiting.includes(idOf(one))
  return mine.some(isWaiting) && !mine.some(one => ACTIVE.includes(stateOf(one)) && !waiting.includes(idOf(one)))
}

/**
 * Why a step its worker holds waits while the worker is on another (`on`): "rests for Q<n>", "resumes after B<n>",
 * "blocked by B<n>", "waits on <who>", "its landing runs" (F74: the records of `waitOf`), or null when nothing names it.
 */
export function heldReason(item, items, { landing = null } = {}) {
  const parked = parkedAfter(item, items, { landing })
  if (parked !== null) return `resumes after ${parked}`
  const open = openAskIds(items, idOf(item))
  if (open.length > 0) return `rests for ${open.join(', ')}`
  return waitOf(item, items, { landing })?.words ?? null
}

/**
 * F74 (the person, 2026-11-26: a worker whose work only waits takes something new): the RECORD a held step waits on, or null. One of
 * three, in this order: `blocked` (its `Blocked by` names a step not done or dropped; a blocker the store lacks is gone: no wait),
 * `chat` (a `Waits on` record, whoever it names: chat 1's go, a review, another chat's work), `landing` (its branch is the one a landing
 * runs for now, `landing`, as the gate log names branches). A wait that stands only in a checkpoint's words is none. Only a step taken,
 * in progress or waiting on you. `{ kind, words, ... }`: `on` the blockers, `who`/`what`/`since` the chat wait, `branch` the landing.
 */
export function waitOf(item, items, { landing = null } = {}) {
  if (item === null || item === undefined || !WAITABLE.includes(stateOf(item))) return null
  const blockers = (valueOf(item, 'Blocked by') ?? '').match(/\bB\d+\b/g) ?? []
  const open = blockers.filter(id => { const other = items?.get?.(id); return other !== undefined && !['done', 'dropped'].includes(stateOf(other)) })
  if (open.length > 0) return { kind: 'blocked', on: open, words: `blocked by ${open.join(', ')}` }
  const wait = waitsOnOf(item)
  if (wait !== null) return { kind: 'chat', who: wait.who, what: wait.what, since: wait.since, words: `waits on ${wait.who} (${wait.what})` }
  const branch = valueOf(item, 'Branch')
  if (isLandingOf(branch, landing)) return { kind: 'landing', branch, words: 'its landing runs' }
  return null
}

/** F74: whether a held step only waits (`waitOf` names a record). */
export const onlyWaits = (item, items, ctx = {}) => waitOf(item, items, ctx) !== null

/** F74: the ids of every held step that only waits, computed once per pass so every reader of the pass sees the same answer. */
export function waitingIds(items, { landing = null } = {}) {
  return new Set(stepsIn(items).filter(one => onlyWaits(one, items, { landing })).map(idOf))
}

/**
 * F74: whether a worker counts free for new work while its ONE held step only waits (chat 1's hard cap of two, 2026-11-26): the lane is a
 * worker's, runs and is not suspended (a pause, a limit, a recap or an asset wait), and of the steps it holds (given, under way or
 * waiting on the person) there is exactly one, and that one only waits (`waitOf`). A worker that holds two steps, whatever their
 * states, gets nothing new. Mirrors `restsFree`.
 */
export function waitsFree(lane, items, prefix = '', { landing = null } = {}) {
  // F74 rework (chat 1's review): an asleep worker (its process ended after its idle turn) is free as the hand-over counts it (`isThere`).
  if (lane === undefined || lane === null || lane.isMain === true || lane.isLeftover === true || lane.state === 'suspended' || (lane.isRunning === false && lane.asleep !== true)) return false
  const mine = heldForCap(items, lane.name, prefix)
  return mine.length === 1 && onlyWaits(mine[0], items, { landing })
}
