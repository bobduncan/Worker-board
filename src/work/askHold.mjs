/**
 * Rule 15 (the person, 2026-11-09: "when we redesign/discuss things, the signals on the board aint updated with the new
 * information"): words the person said in any chat hold the open asks they may change. A held ask has `Route: asker`: it stands on
 * no list of the person's, asks the partner and the main chat nothing, and blocks nobody, until the asking chat re-asks it,
 * withdraws it or says it still stands. Nobody answers in 60 minutes of the board's running time: the ask goes back to
 * its old route (heldAsksDue). Pure: the work API (api.mjs) and the server's pass call these.
 */
import { sinceMs, valueOf } from './item.mjs'

export const HOLD_ROUTE = 'asker'
/** How long the asking chat has, in minutes of the board's running time (not wall time: the board off is not the chat's fault). */
export const HOLD_MINUTES = 60

const HELD_LINE = /^held from (\w+): your words at (\d\d:\d\d) may change this \((.*)\)$/
const HELD_HISTORY = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s.*? held: the person's words at /

/** Whether the ask is held (open, Route asker). */
export const isHeld = item => valueOf(item, 'Kind') === 'ask' && valueOf(item, 'State') === 'open' && valueOf(item, 'Route') === HOLD_ROUTE

/** The Route-section line a hold writes: the route it came from, the minute of the words, the chat that said them. */
export const holdLine = (route, minute, chat) => `held from ${route ?? 'person'}: your words at ${minute} may change this (${chat})`

/** The History words of a hold. */
export const holdHistory = (minute, goal) => `held: the person's words at ${minute} on ${goal} may change this`

/** The route and minute of the ask's newest hold line, or null for none. */
export function heldFrom(item) {
  const found = (item?.sections?.get('Route') ?? []).map(one => String(one).trim().match(HELD_LINE)).filter(Boolean).at(-1)
  return found === undefined ? null : { route: found[1], minute: found[2], chat: found[3] }
}

/** When (ms, to the minute) the ask was held last, from its History; NaN for none. */
export function heldAtMs(item) {
  const line = (item?.sections?.get('History') ?? []).map(String).findLast(one => HELD_HISTORY.test(one))
  return line === undefined ? Number.NaN : sinceMs(line.match(HELD_HISTORY)[1])
}

/** Whether a note's words say the ask still stands ("still stands: <why>"). */
export const saysStillStands = text => /^still stands\b/i.test(String(text ?? '').trim())

/**
 * The held asks whose chat did nothing for HOLD_MINUTES of running time: `[{ id, chat, since, route }]`, `since` the minute of the
 * words. `runningMs(from)` is the board's running time since `from` (handoverBoard `offMsOf` leaves the off time out).
 */
export function heldAsksDue({ items, now, runningMs }) {
  const due = []
  for (const item of items.values()) {
    if (!isHeld(item)) continue
    const at = heldAtMs(item)
    if (!Number.isFinite(at) || !(runningMs(at) >= HOLD_MINUTES * 60_000)) continue
    const held = heldFrom(item)
    due.push({ id: valueOf(item, 'Id'), chat: valueOf(item, 'Owner'), since: held?.minute ?? '', route: held?.route ?? 'person' })
  }
  return due.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
}
