// P1 of the one wait system (chat 1's plan 2026-11-09, the person's "Yes, build now"): a worker that waits on purpose is not
// stuck. The B1081 case: Worker 4 wrote at 11:18 "wait for its go" in its checkpoint, went idle at 11:19, got "go on" lines at
// 11:24 and 11:30 and was given back at 11:46, while it did the right thing: it waited for chat 1's go to land. A wait is a
// record, never a guess: the step's head field `Waits on: <who> · <what> · <YYYY-MM-DD HH:MM>`, written by the holder with
// `work block id=<step> on="chat 1" why="its go to land"`, cleared with `work unblock` (the holder, the main chat or the
// person), by a report, a take and a give-back. Its lane is parked (state.mjs: `suspended { by: 'parked', kind: 'chat' }`), so
// no "go on" line and no give-back for `waitOnMinutes` (90) of the board's running time; past it one Late on the person's list,
// and still no give-back. Separate from `Waits for` (B306: rethink holds, main/person-only) and from `Blocked by` (steps).

import { isHeld } from './askHold.mjs'
import { sinceMs, valueOf } from './item.mjs'
import { stamp } from './migrate.mjs'

/** The limit of a chat wait, in minutes of the board's running time; past it the person sees a Late (config `waitOnMinutes`). */
export const WAIT_ON_MINUTES = 90
const MIN = 60_000
const SEP = ' · '
/** The field: who · what · when. The who is the list's bare name (never with the prefix, which may hold " · " itself). */
const LINE = /^(.+?) · (.+) · (\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/
/** An id of the store: a step, an ask, an incident, an instruction (any case). */
const AN_ID = /^[bqxi]\d+$/i
/** The person, in any of their names. */
const THE_PERSON = /^(?:you|the person|the user|me|person|user)$/i
/** A side chat the board does not list: "chat 0" to "chat 4" (the person's numbering). */
const SIDE_CHAT = /^chat [0-4]$/i
/** How a wait is told: what the holder waits for, in a few words. */
const WHAT_CHARS = 80

const two = n => String(n).padStart(2, '0')
/** `YYYY-MM-DD HH:MM` → ms (local time), or NaN. */
export const waitSinceMs = text => {
  const hit = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(text ?? ''))
  return hit === null ? Number.NaN : new Date(Number(hit[1]), Number(hit[2]) - 1, Number(hit[3]), Number(hit[4]), Number(hit[5])).getTime()
}
export const hourMinute = ms => `${two(new Date(ms).getHours())}:${two(new Date(ms).getMinutes())}`

/** The step's standing wait on a chat: `{ who, what, since (ms), at (the field's time), line }`, or null. */
export function waitsOnOf(item) {
  const words = valueOf(item, 'Waits on')
  if (words === null || words === undefined || words === '-') return null
  const hit = LINE.exec(String(words).trim())
  if (hit === null) return null
  const since = waitSinceMs(hit[3])
  return Number.isFinite(since) ? { who: hit[1].trim(), what: hit[2].trim(), since, at: hit[3], line: String(words).trim() } : null
}

/** The field's line for a wait on `who` for `what`, written `now`. */
export const waitsOnLine = (who, what, now) => `${who}${SEP}${what}${SEP}${stamp(now).slice(0, 16)}`

/**
 * The who as the record keeps it: the list's name when `who` names a chat of the list (with or without the prefix, any case), else the
 * word itself without the prefix (a side chat "chat 1"). The prefix ("Garden · ") may hold the field's own separator.
 */
export function waitWhoOf(who, { names = [], prefix = '' } = {}) {
  const word = String(who ?? '').trim()
  const plain = name => String(name ?? '').replace(prefix, '').trim().toLowerCase()
  const listed = names.find(name => plain(name) === plain(word))
  return listed === undefined ? (prefix !== '' && word.toLowerCase().startsWith(prefix.toLowerCase()) ? word.slice(prefix.length).trim() : word) : String(listed).replace(prefix, '').trim()
}

/** What the holder waits for, from the call's `why`, in a few words; "its answer" when none. */
export const waitWhatOf = why => {
  const words = String(why ?? '').replace(/\s+/g, ' ').trim().slice(0, WHAT_CHARS).replace(/ · /g, ', ')
  return words === '' ? 'its answer' : words
}

/**
 * Why `who` is no chat to wait on, or null when it is one: a board chat by its name (`names`, with or without the prefix) or a side
 * chat "chat 0" to "chat 4". An id (a wait on a fix is `on=B<n>`), the person (a wait on them is a blocking ask) and the holder's own
 * name are refused with the way to say it.
 */
export function waitWhoProblem(who, { self = '', names = [], prefix = '' } = {}) {
  const word = String(who ?? '').trim()
  if (word === '') return 'name who you wait on in "on": a chat of the board, or "chat 1" (a side chat)'
  if (AN_ID.test(word) || THE_PERSON.test(word)) return 'a wait on the person is a blocking ask; a wait on a fix is on=B<n>'
  const plain = name => String(name ?? '').replace(prefix, '').trim().toLowerCase()
  if (plain(word) === plain(self)) return `${self} cannot wait on itself: name the chat whose answer you wait for`
  if (SIDE_CHAT.test(word)) return null
  if (names.length > 0 && !names.some(name => plain(name) === plain(word))) return `${word} is no chat of the board: name one of the list (${names.join(', ')}) or a side chat ("chat 1")`
  return null
}

/** The reminder a checkpoint's answer carries while a wait stands (the forgotten record). */
export const waitReminder = (wait, id) => (wait === null ? '' : ` You still wait on ${wait.who} since ${hourMinute(wait.since)} (${wait.what}): work unblock ${id} once it gave its answer.`)

/** The lane's suspension for a standing wait (the parked shape, kind chat): every reader treats it as on purpose. */
export const waitSuspension = wait => (wait === null ? null : { by: 'parked', kind: 'chat', on: [wait.who], what: wait.what, since: wait.since, limit: null, named: null })

/** Whether a lane's suspension is a chat wait (state.mjs `card`, `waitSuspension`). */
export const isChatWait = held => held?.by === 'parked' && held.kind === 'chat'

/** The states in which a step is at work (stepStatus.mjs `AT_WORK`): only such a step can wait for the goal's recap. */
const RECAP_AT_WORK = ['taken', 'in progress', 'waiting on you']
/** "your recap of G60 (Q715)": what a step waits for while its open asks all wait for the goal's recap. */
const recapWhat = (goal, ids) => `your recap of ${goal ?? 'the goal'} (${ids.join(', ')})`
/** The words of a step that waits for the goal's recap (the person's "1 yes", 2026-11-11, the live B1094 and Q715): quiet, never a stopped worker. */
export const recapWaitWords = (goal, ids) => `waits for ${recapWhat(goal, ids)}`
/**
 * A step at work whose every open ask (none held for the person's words) is routed to the goal's recap (Route recap, a kept look
 * or an ask Autopilot waits on the recap for): `{ goal, ids, what, words, link, since }`, or null. Its holder waits for the recap, not
 * for the person; an ordinary open ask to the person makes the step wait for the person as before. `link` the goal's place (the
 * recap's goal on the Goals part), else the step's window; `since` the newest of those asks. `asks` the step's asks (open or not).
 */
export function keptRecapWaitOf(step, asks) {
  if (!RECAP_AT_WORK.includes(valueOf(step, 'State'))) return null
  const open = (asks ?? []).filter(ask => valueOf(ask, 'Kind') === 'ask' && valueOf(ask, 'State') === 'open' && !isHeld(ask))
  if (open.length === 0 || !open.every(ask => valueOf(ask, 'Route') === 'recap')) return null
  const goal = [valueOf(step, 'Goal'), ...open.map(ask => valueOf(ask, 'Goal'))].find(one => /^G\d+$/.test(one ?? '')) ?? null
  const ids = open.map(ask => valueOf(ask, 'Id'))
  const times = open.map(ask => sinceMs(valueOf(ask, 'Since'))).filter(Number.isFinite)
  return { goal, ids, what: recapWhat(goal, ids), words: recapWaitWords(goal, ids), link: goal === null ? `#details=${valueOf(step, 'Id')}` : `#advice/goals/${goal}`, since: times.length === 0 ? null : Math.max(...times) }
}

/**
 * The lead's ruling of 2026-11-11: a lane whose step waits for the person's recap is parked (P1's shape, kind recap), never
 * working: the chat does nothing while it waits. Every reader of parked treats it as on purpose (no holder timers, no limit words).
 */
export const recapSuspension = wait => (wait === null || wait === undefined ? null
  : { by: 'parked', kind: 'recap', on: ['the person'], what: wait.what, since: Number.isFinite(wait.since) ? wait.since : null, limit: null, named: null, link: wait.link ?? null })

/** Whether a lane's suspension waits for the person's recap (`recapSuspension`). */
export const isRecapWait = held => held?.by === 'parked' && held.kind === 'recap'

/** "waits for your recap of G60 (Q715)": the words every reader uses for a recap wait (no "since": the pill's own time says it). */
export const recapSuspensionWords = held => `waits for ${typeof held?.what === 'string' && held.what !== '' ? held.what : 'your recap'}`

/** "waits for chat 1 (its go to land) since 11:24": the words every reader uses for a chat wait. */
export function chatWaitWords(held) {
  const who = Array.isArray(held?.on) && typeof held.on[0] === 'string' ? held.on[0] : 'a chat'
  const what = typeof held?.what === 'string' && held.what !== '' ? ` (${held.what})` : ''
  const since = Number.isFinite(held?.since) ? ` since ${hourMinute(held.since)}` : ''
  return `waits for ${who}${what}${since}`
}

/**
 * The Late past the limit: `{ chat, id, who, what, since, minutes, text }` for a step whose recorded wait (`wait`, `waitsOnOf`) has
 * run `limitMs` of the board's running time (`runningMs(from)`: the board's time since `from` without its off spells and the person's
 * pauses), else null. Read from the step's record, not the lane: a lane that reads unknown or off for a while is late all the same.
 * The person's action is in the card's text (state.mjs `needsOf`).
 */
export function lateWaitOf({ chat, wait, stepId = null, runningMs, limitMs = WAIT_ON_MINUTES * MIN }) {
  if (wait === null || wait === undefined || !Number.isFinite(wait.since) || typeof runningMs !== 'function') return null
  const ran = runningMs(wait.since)
  if (!(ran >= limitMs)) return null
  const minutes = Math.floor(ran / MIN)
  return { chat, id: stepId, who: wait.who, what: wait.what, since: wait.since, minutes, text: `${chat} ${chatWaitWords(waitSuspension(wait))} (${minutes} min)` }
}
