// Pause and resume from the store, not from messages (spec 2026-10-18-pause-resume-design.md). A step a chat holds
// carries a checkpoint in its record (`Checkpoint: <commit or none> · <next action> · <date time>`, written with work
// step's `commit` and `next`). The person's "Pause all" and "Resume all" write `<work>/pause.json`
// (`{ state: pausing | resuming | running, since, by, pausedSince }`); the board says from facts alone whether it is safe to restart,
// and whom a resume still waits for. Nothing here reads a chat's words.

import { sinceMs, valueOf } from './item.mjs'

export const PAUSE_FILE = 'pause.json'
export const PAUSE_STATES = ['pausing', 'resuming', 'running']
/** The states of a step a chat holds for the pause: it carries a checkpoint before a restart, and is resumed after. */
export const HOLDING = ['taken', 'in progress']
const SEP = ' · '

const two = n => String(n).padStart(2, '0')
/** The time to the second, as a checkpoint writes it: a checkpoint a moment after the pause is told from one before. */
export const stampSecond = now => {
  const at = new Date(now)
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
}

/** pause.json's record, or null: no file, or one the board cannot read (no pause then). */
export function parsePause(text) {
  if (typeof text !== 'string') return null
  try {
    const raw = JSON.parse(text)
    if (!PAUSE_STATES.includes(raw?.state)) return null
    const record = { state: raw.state, since: Number.isFinite(raw.since) ? raw.since : null, by: typeof raw.by === 'string' ? raw.by : null }
    // A resume after a pause keeps when the pause began (`pausedSince`).
    return Number.isFinite(raw.pausedSince) ? { ...record, pausedSince: raw.pausedSince } : record
  } catch {
    return null
  }
}

/** The checkpoint's value in a step's head. `next` is one line, its separator taken out. */
export function checkpointLine({ commit, next, now }) {
  return [commit, next.replaceAll(SEP, ' - '), stampSecond(now)].join(SEP)
}

/** A step's checkpoint as its record holds it: `{ commit, next, at, line }`, or null when it has none. */
export function checkpointOf(item) {
  const value = valueOf(item, 'Checkpoint')
  if (typeof value !== 'string' || value.trim() === '') return null
  const parts = value.split(SEP)
  if (parts.length < 3) return { commit: null, next: value, at: null, line: value }
  const at = sinceMs(parts.at(-1))
  return { commit: parts[0], next: parts.slice(1, -1).join(SEP), at: Number.isFinite(at) ? at : null, line: value }
}

/** A chat's name without the list's prefix, for comparing. */
const plain = (name, prefix = '') => {
  let words = String(name ?? '').trim()
  if (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase())) words = words.slice(prefix.length)
  return words.trim().toLowerCase()
}

/** Whether a checkpoint was written at or after `since` (to the second it is written with). */
const isSince = (checkpoint, since) => checkpoint !== null && Number.isFinite(checkpoint?.at) && Number.isFinite(since) && checkpoint.at >= Math.floor(since / 1000) * 1000

/** The steps held (taken or in progress) by a chat, in id order: `{ id, chat, checkpoint }`, `chat` without the prefix. */
export function holdersOf(items, prefix = '') {
  const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true })
  return [...(items?.values?.() ?? [])]
    .filter(item => valueOf(item, 'Kind') === 'step' && HOLDING.includes(valueOf(item, 'State')) && (valueOf(item, 'Owner') ?? '') !== '')
    .map(item => ({ id: valueOf(item, 'Id'), owner: valueOf(item, 'Owner'), checkpoint: checkpointOf(item) }))
    .sort((a, b) => byId(a.id, b.id))
    .map(({ id, owner, checkpoint }) => {
      const name = String(owner).trim()
      return { id, chat: prefix !== '' && name.toLowerCase().startsWith(prefix.toLowerCase()) ? name.slice(prefix.length).trim() : name, checkpoint }
    })
}

/** A lane runs a turn now: working, and not only between two turns (held by its card or a background task). */
const runsTurn = lane => lane?.state === 'working' && (lane.between ?? null) === null

/** A holder's lane has started a turn since `since`: it runs one now, or its last turn began after then. */
const hasStarted = (lane, since) => lane !== undefined && (runsTurn(lane) || (Number.isFinite(lane.turnAt) && Number.isFinite(since) && lane.turnAt >= since))

/**
 * What the board says of a pause, from facts (spec point 4): `lanes` are the board's chats (`{ name, isMain, state,
 * between, turnAt, session, appSession }`). Null without pause.json. Pausing: `working` (chats running a turn now),
 * `unsaved` (`{ chat, id }`: a step held with no checkpoint since the pause), `isSafe` when both are empty. Resuming:
 * `waiting` (`{ chat, id }`: a holder that has not started a turn since the resume), `isResumed` when none is left.
 * Only steps of chats the board shows count: a chat that is not on the board can neither be waited for nor woken.
 */
export function pauseFacts({ pause, items, lanes = [], prefix = '' }) {
  if (pause === null || pause === undefined) return null
  const laneOf = chat => lanes.find(lane => plain(lane.name, prefix) === plain(chat, prefix))
  const holders = holdersOf(items, prefix).filter(holder => laneOf(holder.chat) !== undefined)
  if (pause.state === 'pausing') {
    const working = lanes.filter(runsTurn).map(lane => lane.name)
    const unsaved = holders.filter(holder => !isSince(holder.checkpoint, pause.since)).map(({ chat, id }) => ({ chat, id }))
    return { state: 'pausing', since: pause.since, working, unsaved, isSafe: working.length === 0 && unsaved.length === 0 }
  }
  if (pause.state === 'resuming') {
    const waiting = holders.filter(holder => !hasStarted(laneOf(holder.chat), pause.since)).map(({ chat, id }) => ({ chat, id }))
    return { state: 'resuming', since: pause.since, waiting, isResumed: waiting.length === 0 }
  }
  return { state: 'running', since: pause.since }
}

/**
 * The answer of the bridge's `pause-state` (and of turn-ended's `pause`) for `chat` in `role`: `{ state, since,
 * forChat: { holds: [{ id, checkpoint }], mustStop }, resumeList }`. `state` is running without pause.json. A hold's
 * checkpoint is `{ commit, next, at, line, isSincePause }` or null. `mustStop` while pausing, for every chat.
 * `resumeList`, for the main chat while resuming: every other chat holding a step, `{ chat, session (the app's id for
 * it), cliSession, step, checkpoint, hasStarted }`.
 */
export function pauseAnswer({ pause, items, lanes = [], prefix = '', chat, role }) {
  const state = pause?.state ?? 'running'
  const since = pause?.since ?? null
  // While resuming a checkpoint counts from when the pause began; a resume with no pause before it has none.
  const pausedAt = state === 'resuming' ? pause?.pausedSince ?? null : since
  const withMark = checkpoint => (checkpoint === null ? null : { ...checkpoint, isSincePause: isSince(checkpoint, pausedAt) })
  const holders = holdersOf(items, prefix)
  const holds = holders.filter(holder => plain(holder.chat, prefix) === plain(chat, prefix)).map(holder => ({ id: holder.id, checkpoint: withMark(holder.checkpoint) }))
  const laneOf = name => lanes.find(lane => plain(lane.name, prefix) === plain(name, prefix))
  const resumeList = state !== 'resuming' || role !== 'main' ? [] : holders
    .filter(holder => plain(holder.chat, prefix) !== plain(chat, prefix) && laneOf(holder.chat) !== undefined)
    .map(holder => {
      const lane = laneOf(holder.chat)
      return { chat: lane.name, session: lane.appSession ?? null, cliSession: lane.session ?? null, step: holder.id, checkpoint: withMark(holder.checkpoint), hasStarted: hasStarted(lane, since) }
    })
  return { state, since, forChat: { holds, mustStop: state === 'pausing' }, resumeList }
}

/**
 * After Resume all: the main chat the board types "resume" into, when it runs (spec point 5); null when it does not,
 * or the board cannot tell: then the banner opens it, and its Workers mod reads the resume from pause.json.
 */
export function resumeTypeTo(state) {
  const main = state?.restart?.main ?? null
  if (main === null) return null
  return (state.chats ?? []).some(chat => chat.isMain && chat.name === main && chat.isRunning === true) ? main : null
}
