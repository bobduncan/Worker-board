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

const MIN = 60_000
/** A worker resting this long on an open ask of the step it holds in progress: the step moves to waiting on you. */
export const REST_MS = 15 * MIN
/** The flow's guard of that move (flow.mjs DEFAULT_FLOW, guards.mjs); the reconciler checks the rest itself. */
export const REST_GUARD = 'its worker rests on an open ask'
/** The states of a step its worker works on now. */
export const ACTIVE = ['taken', 'in progress']

const PARK_LINE = /:\s+parked \(resumes after (B\d+)\)\s*$/
const WAIT_LINE = / → waiting on you\b/

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

/** The open asks under a step, by id. */
export const openAskIds = (items, id) => [...(items?.values?.() ?? [])]
  .filter(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'Of') === id && stateOf(one) === 'open').map(idOf)
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
  if (stateOf(item) !== 'waiting on you') return null
  const history = item.sections?.get('History') ?? []
  const at = history.findLastIndex(line => PARK_LINE.test(line))
  if (at < 0 || history.findLastIndex(line => WAIT_LINE.test(line)) > at) return null
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
 * "blocked by B<n>", or null when nothing names it.
 */
export function heldReason(item, items) {
  const parked = parkedAfter(item, items)
  if (parked !== null) return `resumes after ${parked}`
  const open = openAskIds(items, idOf(item))
  if (open.length > 0) return `rests for ${open.join(', ')}`
  const blockers = (valueOf(item, 'Blocked by') ?? '').match(/\bB\d+\b/g) ?? []
  const holding = blockers.filter(id => !['done', 'dropped'].includes(stateOf(items.get(id) ?? { head: new Map() })))
  return holding.length > 0 ? `blocked by ${holding.join(', ')}` : null
}
