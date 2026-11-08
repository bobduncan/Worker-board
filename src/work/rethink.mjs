// Stop and rethink a topic (docs/stop-and-rethink.md, T13.2.1). The person says a topic of a goal is wrong: the board holds its
// open steps with a `Waits for` line, stops the workers on them, and the partner rethinks the topic. This file is the PURE part:
// the words of the hold and how the other readers of `Waits for` skip them (rethinkTopic.mjs: which steps a topic holds). No I/O.

import { valueOf } from './item.mjs'

/** The hold's words in a step's `Waits for`: `the rethink of G60 "side stairs" (2026-11-07 10:55)`. */
const HOLD = String.raw`the rethink of G\d+ "[^"]*" \(\d{4}-\d\d-\d\d \d\d:\d\d\)`
const holdPattern = (goal = String.raw`G\d+`) => new RegExp(HOLD.replace(String.raw`G\d+`, goal), 'g')

/** The exact words the board writes for a hold (a `"` in the title becomes `'`, so the words can be found again). */
/** A topic's title for the hold words: no step or ask id in it (other readers of `Waits for` look for ids), no quote, one line. */
export const plainTitle = title => String(title).replace(/\b[BQ]\d+\b/g, '').replace(/"/g, "'").replace(/\s+/g, ' ').trim()
export const rethinkLine = (goal, title, minute) => `the rethink of ${goal} "${plainTitle(title)}" (${minute})`

/** The hold words of a `Waits for` value, each once, or an empty list. */
export const rethinkHolds = value => String(value ?? '').match(holdPattern()) ?? []
/** A step's hold words joined, or null when it has none: the rethink holds the step whatever else its `Waits for` names. */
export const rethinkWords = item => {
  const found = rethinkHolds(valueOf(item, 'Waits for'))
  return found.length === 0 ? null : found.join('; ')
}
/** Whether a held why of the ready list ("waits for: the rethink of G60 ...") is a rethink hold: the person's own hold. */
export const isRethinkHold = why => /the rethink of G\d+ "/.test(String(why ?? ''))

/** `Waits for` with the hold of `goal` taken out (the rest kept, its separators tidied); null when nothing else is left. */
export function withoutHoldOf(value, goal) {
  const left = String(value ?? '').replace(holdPattern(goal), '').replace(/\s*;\s*(?:;\s*)*/g, '; ').replace(/^[;\s]+|[;\s]+$/g, '').trim()
  return left === '' ? null : left
}

/** `Waits for` with the hold added: after what it names already, "; " between; the same goal's hold stays as it is. */
export function withHold(value, goal, line) {
  const had = String(value ?? '').trim()
  if (holdPattern(goal).test(had)) return had
  return had === '' ? line : `${had}; ${line}`
}

/** The steps of a store that hold a goal's rethink: `[{ id, item }]`. */
export const heldBy = (items, goal) => [...(items?.values() ?? [])].filter(item => valueOf(item, 'Kind') === 'step' && new RegExp(holdPattern(goal).source).test(valueOf(item, 'Waits for') ?? ''))

/** The states of a step that a rethink holds: not in review (its check runs on), not done or dropped. */
export const HOLDABLE = ['new', 'refined', 'queued', 'taken', 'in progress', 'waiting on you']
/** Of those, the states in which a worker holds the step: its worker is stopped. */
export const WITH_WORKER = ['taken', 'in progress', 'waiting on you']

/**
 * The goals whose rethink holds the tick frees: a goal in the map (`nodes`) that holds a rethink (`holdGoals`) and whose evaluation is
 * recorded as ended: it has no "Evaluation asked" line any more (endTrip took it away), or it is ticked. A goal the map does not hold
 * is never freed (a missing record is not an end), nor one whose rethink is being started now (`busy`).
 */
export const goalsToFree = (nodes, holdGoals, busy = new Set()) => [...holdGoals].filter(id => {
  const node = (nodes ?? []).find(one => one.id === id)
  return node !== undefined && !busy.has(id) && (node.state === 'done' || (node.evaluationAsked ?? null) === null)
})
