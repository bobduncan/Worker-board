// Stop and rethink a topic (docs/stop-and-rethink.md, T13.2.1). The person says a topic of a goal is wrong: the board holds its
// open steps with a `Waits for` line, stops the workers on them, and the partner rethinks the topic. This file is the PURE part:
// the words of the hold and how the other readers of `Waits for` skip them (rethinkTopic.mjs: which steps a topic holds). No I/O.

import { valueOf } from './item.mjs'

/** The hold's words in a step's `Waits for`: `the rethink of G60 "side stairs" (2026-11-07 10:55)`. */
const HOLD = String.raw`the rethink of G\d+ "[^"]*" \(\d{4}-\d\d-\d\d \d\d:\d\d\)`
const holdPattern = (goal = String.raw`G\d+`) => new RegExp(HOLD.replace(String.raw`G\d+`, goal), 'g')

/** The exact words the board writes for a hold (a `"` in the title becomes `'`, so the words can be found again). */
export const rethinkLine = (goal, title, minute) => `the rethink of ${goal} "${String(title).replace(/"/g, '\'').replace(/\s+/g, ' ').trim()}" (${minute})`

/** The hold words of a `Waits for` value, each once, or an empty list. */
export const rethinkHolds = value => String(value ?? '').match(holdPattern()) ?? []
/** A step's hold words joined, or null when it has none: the rethink holds the step whatever else its `Waits for` names. */
export const rethinkWords = item => {
  const found = rethinkHolds(valueOf(item, 'Waits for'))
  return found.length === 0 ? null : found.join('; ')
}
/** Whether a held why of the ready list ("waits for: the rethink of G60 ...") is a rethink hold: the person's own hold. */
export const isRethinkHold = why => /the rethink of G\d+ "/.test(String(why ?? ''))
/** A `Waits for` value without its rethink holds: what the readers of ids look at (a title may hold "B1068"). */
export const withoutRethink = value => String(value ?? '').replace(holdPattern(), ' ').replace(/\s+/g, ' ').trim()
/** A step's `Waits for` for the readers that look for step ids in it: the hold words left out. */
export const plainWaits = item => withoutRethink(valueOf(item, 'Waits for'))

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
