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

const stateOf = item => valueOf(item, 'State')
const idOf = item => valueOf(item, 'Id')
/** A chat's name without the list's prefix, for comparing. */
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const sameOwner = (a, b, prefix) => valueOf(a, 'Owner') !== null && plain(valueOf(a, 'Owner'), prefix) === plain(valueOf(b, 'Owner'), prefix)
const stepsIn = items => [...(items?.values?.() ?? items ?? [])].filter(one => (valueOf(one, 'Kind') ?? 'step') === 'step')

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
export function parkedAfter(item, items = null) {
  // F74: a step that only waited (taken or in progress) is parked behind the step its worker was given meanwhile, state unchanged.
  if (!WAITABLE.includes(stateOf(item))) return null
  const history = item.sections?.get('History') ?? []
  const at = history.findLastIndex(line => PARK_LINE.test(line))
  if (at < 0 || history.findLastIndex(line => MOVE_LINE.test(line) || RESUME_LINE.test(line)) > at) return null
  if (items !== null && openAskIds(items, idOf(item)).length > 0) return null
  return history[at].match(PARK_LINE)[1]
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
  const parked = parkedAfter(item, items)
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
  if (typeof landing === 'string' && landing !== '' && typeof branch === 'string' && logBranchName(branch) !== '' && logBranchName(branch) === logBranchName(landing)) return { kind: 'landing', branch, words: 'its landing runs' }
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
  if (lane === undefined || lane === null || lane.isMain === true || lane.isLeftover === true || lane.state === 'suspended' || lane.isRunning === false) return false
  const mine = stepsIn(items).filter(one => HELD_FOR_CAP.includes(stateOf(one)) && valueOf(one, 'Owner') !== null && plain(valueOf(one, 'Owner'), prefix) === plain(lane.name, prefix))
  return mine.length === 1 && onlyWaits(mine[0], items, { landing })
}
