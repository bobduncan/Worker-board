// Pause and resume from the store, not from messages (spec 2026-10-18-pause-resume-design.md). A step a chat holds
// carries a checkpoint in its record (`Checkpoint: <commit or none> · <next action> · <date time>`, written with work
// step's `commit` and `next`). The person's "Pause all" and "Resume all" write `<work>/pause.json`
// (`{ state: pausing | resuming | running, since, by, pausedSince }`); the board says from facts alone whether it is safe to restart,
// and whom a resume still waits for. Nothing here reads a chat's words.

import { sinceMs, valueOf } from './item.mjs'

export const PAUSE_FILE = 'pause.json'
export const PAUSE_STATES = ['pausing', 'resuming', 'running']
/**
 * The states of a step a chat holds, as the work API holds it (the review of part 1): it carries a checkpoint before a
 * restart, and is resumed after. A chat in the app's question form (waiting on you) or with its step in review holds
 * uncommitted work too.
 */
export const HELD = ['taken', 'in progress', 'waiting on you', 'review']
/** The review of Pause 2: the states in which the board hands out nothing that starts a turn (until running). */
export const HOLDS = ['pausing', 'resuming']
/** Whether a pause record (pause.json, or the state's `pause`) holds what would start a turn. */
export const isHolding = pause => HOLDS.includes(pause?.state)
/** The review of Pause 2: how many of a held step's last History lines a resume without a checkpoint goes by. */
const HISTORY_LINES = 3
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

/** Whether a checkpoint was written at or after `since`, to the millisecond (one in the pause's own second counts not). */
const isSince = (checkpoint, since) => checkpoint !== null && Number.isFinite(checkpoint?.at) && Number.isFinite(since) && checkpoint.at >= since

/** A step's last History lines, newest last, without their list mark. */
const historyOf = item => (item?.sections?.get?.('History') ?? []).map(one => String(one).replace(/^-\s*/, '').trim()).filter(Boolean).slice(-HISTORY_LINES)

/**
 * The steps a chat holds (`HELD`), in id order: `{ id, chat, checkpoint, branch, history }`, `chat` without the prefix;
 * `branch` and the last History lines are what a resume goes by when the step has no checkpoint (the review of Pause 2).
 */
export function holdersOf(items, prefix = '') {
  const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true })
  return [...(items?.values?.() ?? [])]
    .filter(item => valueOf(item, 'Kind') === 'step' && HELD.includes(valueOf(item, 'State')) && (valueOf(item, 'Owner') ?? '') !== '')
    .map(item => ({ id: valueOf(item, 'Id'), owner: valueOf(item, 'Owner'), checkpoint: checkpointOf(item), branch: valueOf(item, 'Branch') ?? null, history: historyOf(item) }))
    .sort((a, b) => byId(a.id, b.id))
    .map(({ id, owner, ...rest }) => {
      const name = String(owner).trim()
      return { id, chat: prefix !== '' && name.toLowerCase().startsWith(prefix.toLowerCase()) ? name.slice(prefix.length).trim() : name, ...rest }
    })
}

/**
 * A lane may still change its work (the review of part 1): it runs a turn; background work it started still runs
 * (`heldBy` background); the board cannot read it (unknown); or its transcript shows a turn open behind a "suspended"
 * that may be stale (`isTurnOpen`). A lane whose process is not running, or that was cut off, changes nothing.
 */
const runsTurn = lane => {
  if (lane === undefined || lane.state === 'off' || lane.state === 'interrupted') return false
  return (lane.state === 'working' && (lane.between ?? null) === null) || lane.heldBy === 'background' || lane.state === 'unknown' || lane.isTurnOpen === true
}

/** A holder's lane has started a turn since `since`: it runs one now, or its last turn began after then. */
const hasStarted = (lane, since) => lane !== undefined && (runsTurn(lane) || (Number.isFinite(lane.turnAt) && Number.isFinite(since) && lane.turnAt >= since))

/**
 * What the board says of a pause, from facts (spec point 4): `lanes` are the board's chats (`{ name, isMain, state,
 * between, turnAt, session, appSession, isAsking }`), `pending` the outbox lines handed to a chat and not typed yet
 * (`{ to }`). Null without pause.json. Pausing: `working` (chats running a turn now), `asking` (chats in the app's
 * question form: a turn in flight that waits for the person), `typing` (chats a line was handed to, which starts a
 * turn), and `isSafe` when all three are empty: an app restart loses only a turn in flight, files on disk survive (the
 * review of Pause 2). `unsaved` (`{ chat, id }`: a step held with no checkpoint since the pause) and `offBoard` (`{ chat,
 * id, title }`: one held so by a chat the board does not show, named by its title) are said, and block nothing: such a
 * step resumes from its branch and History. `chats` (B364): every lane as `{ name, state }`, state one of working,
 * asking, typing, still or off (its process does not run). Resuming: `waiting` (`{ chat, id }`: a holder on the board that has not
 * started a turn since the resume), `isResumed` when none is left; a chat not on the board cannot be woken by its
 * session, so it is not waited for (the person's End resume ends it).
 */
export function pauseFacts({ pause, items, lanes = [], prefix = '', pending = [] }) {
  if (pause === null || pause === undefined) return null
  const laneOf = chat => lanes.find(lane => plain(lane.name, prefix) === plain(chat, prefix))
  const holders = holdersOf(items, prefix).filter(holder => laneOf(holder.chat) !== undefined)
  if (pause.state === 'pausing') {
    const asking = lanes.filter(lane => lane.isAsking === true && lane.state !== 'off').map(lane => lane.name)
    const working = lanes.filter(lane => runsTurn(lane) && !asking.includes(lane.name)).map(lane => lane.name)
    const typing = [...new Set((pending ?? []).map(one => one?.to).filter(to => typeof to === 'string' && to !== ''))]
    const unsaved = holders.filter(holder => !isSince(holder.checkpoint, pause.since)).map(({ chat, id }) => ({ chat, id }))
    const offBoard = holdersOf(items, prefix).filter(holder => laneOf(holder.chat) === undefined && !isSince(holder.checkpoint, pause.since))
      .map(({ chat, id }) => ({ chat, id, title: `${prefix}${chat}` }))
    // B364: every chat of the board by its state, in the board's order, for the panel's loader.
    const isTyped = lane => typing.some(to => plain(to, prefix) === plain(lane.name, prefix))
    const chats = lanes.map(lane => ({
      name: lane.name,
      state: lane.state === 'off' ? 'off' : asking.includes(lane.name) ? 'asking' : working.includes(lane.name) ? 'working' : isTyped(lane) ? 'typing' : 'still',
    }))
    return { state: 'pausing', since: pause.since, working, asking, typing, unsaved, offBoard, isSafe: working.length === 0 && asking.length === 0 && typing.length === 0, chats }
  }
  if (pause.state === 'resuming') {
    const waiting = holders.filter(holder => !hasStarted(laneOf(holder.chat), pause.since)).map(({ chat, id }) => ({ chat, id }))
    return { state: 'resuming', since: pause.since, waiting, isResumed: waiting.length === 0 }
  }
  return { state: 'running', since: pause.since }
}

/**
 * The answer of the bridge's `pause-state` (and of turn-ended's `pause`) for `chat` in `role`: `{ state, since,
 * forChat: { holds: [{ id, checkpoint, branch, history }], mustStop }, resumeList }`. `state` is running without
 * pause.json. A hold's checkpoint is `{ commit, next, at, line, isSincePause }` or null; `branch` and `history` (its last
 * History lines) are what it goes on from without one. `mustStop` while pausing, for every chat. `resumeList`, for the
 * main chat while resuming: every other chat holding a step, `{ chat, session (the app's id for it), cliSession, step,
 * checkpoint, branch, hasStarted }`.
 */
export function pauseAnswer({ pause, items, lanes = [], prefix = '', chat, role }) {
  const state = pause?.state ?? 'running'
  const since = pause?.since ?? null
  // While resuming a checkpoint counts from when the pause began; a resume with no pause before it has none.
  const pausedAt = state === 'resuming' ? pause?.pausedSince ?? null : since
  const withMark = checkpoint => (checkpoint === null ? null : { ...checkpoint, isSincePause: isSince(checkpoint, pausedAt) })
  const holders = holdersOf(items, prefix)
  const holds = holders.filter(holder => plain(holder.chat, prefix) === plain(chat, prefix))
    .map(holder => ({ id: holder.id, checkpoint: withMark(holder.checkpoint), branch: holder.branch, history: holder.history }))
  const laneOf = name => lanes.find(lane => plain(lane.name, prefix) === plain(name, prefix))
  const resumeList = state !== 'resuming' || role !== 'main' ? [] : holders
    .filter(holder => plain(holder.chat, prefix) !== plain(chat, prefix) && laneOf(holder.chat) !== undefined)
    .map(holder => {
      const lane = laneOf(holder.chat)
      return { chat: lane.name, session: lane.appSession ?? null, cliSession: lane.session ?? null, step: holder.id, checkpoint: withMark(holder.checkpoint), branch: holder.branch, hasStarted: hasStarted(lane, since) }
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

/**
 * The review of Pause 2: after "Open <main>" the main chat's process runs while the board still resumes, and the main
 * chat has done nothing since Resume all (no turn since, none running), and the board typed no "resume" into it since:
 * the main chat the board types "resume" into now, once (the bridge is there then); else null.
 */
export function resumeRetypeTo(state) {
  const pause = state?.pause ?? null
  const main = pause?.main ?? null
  if (pause?.state !== 'resuming' || pause.isResumed === true || main === null || main.isRunning !== true) return null
  if (Number.isFinite(pause.typedAt) || main.hasActed === true || (pause.waiting ?? []).length === 0) return null
  return main.name
}

/**
 * The review of Pause 2: how long a line in the outbox was held by a pause (`pause` the pause.json record) between
 * when it was sent and `now`: it does not grow late while the board holds it. From the pause's start (pausing: its
 * since; resuming and running: `pausedSince`) to its end (running: its since; else now).
 */
export function heldMs(message, now, pause) {
  if (pause === null || pause === undefined || !Number.isFinite(message?.at)) return 0
  const start = pause.state === 'pausing' ? pause.since : pause.pausedSince ?? null
  const end = pause.state === 'running' ? pause.since : now
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.min(end, now) - Math.max(start, message.at))
}
