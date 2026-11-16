// F33 (B1256; chat 1's brief, the person's "Yes, build F33", 2026-11-16): a landing ends its step's wait for the landing and tells
// the owner to report. The live case: Worker 1 recorded "waits on chat 1 · its go to land" on B1236 at 10:29; chat 1 landed its
// branch b1236-x202-fix at 10:42 (4ba4f404, tools/land.ps1) but sent no word, so Worker 1 sat 112 minutes and the person saw an amber
// "Waits late" (B1207 the same way, 40 hours). The board already read a landed line as the holder's progress (holderTimers.mjs), but
// never ended the wait on it nor told the owner.
//
// This module is pure: (a step, the landed lines of data/landings.jsonl) → the landing that ends its wait, or null. The work API's
// server action `landed-waits` applies it (src/work/api.mjs): it clears the `Waits on` field with one History line and words the
// owner once. Once per landing by construction: the clear removes the wait, and a wait recorded later is newer than the line.

import { valueOf } from './item.mjs'
import { plainName } from './names.mjs'
import { hourMinute, waitsOnOf } from './waitsOn.mjs'

/** The states in which a step is still its owner's to report or report again. */
export const LANDED_WAIT_STATES = ['taken', 'in progress', 'review']
/**
 * A wait's words that name the landing ("its go to land", "its review and go to land", "its landing of <branch> <hash>"), not a review
 * alone ("its review", "its answer").
 */
export const LANDING_WHAT = /\bgo to land\b|\bto land\b|\blanding\b/i
/** The kind of the word to the owner (src/work/workLines.mjs keeps it while the step is not yet reported). */
export const LANDED_KIND = 'landed'
/** Landings that undo one (src/landing.mjs RESULTS). */
const UNDONE = new Set(['rolled-back', 'rollback-failed'])

const lower = text => String(text ?? '').trim().toLowerCase()
/** The step's branch: its Branch field (not "none"), else null. */
const branchOf = step => {
  const branch = valueOf(step, 'Branch')
  return branch === null || branch === undefined || ['', '-', 'none'].includes(lower(branch)) ? null : String(branch).trim()
}
/** Whether a landed line's branch is the step's: its Branch, or (none named) a branch named after the step ("b1236-..."). */
const isStepsBranch = (line, step) => {
  const branch = branchOf(step)
  if (branch !== null) return lower(line.branch) === lower(branch)
  const id = lower(valueOf(step, 'Id'))
  return id !== '' && lower(line.branch).startsWith(`${id}-`)
}
export const hash8 = head => String(head ?? '').slice(0, 8)

/**
 * The landing that ends `step`'s recorded wait, `{ id, owner, wait, line }`, or null. All of these are needed: the step open
 * (LANDED_WAIT_STATES); a recorded chat wait whose words name the landing (LANDING_WHAT); a line for the step's own branch whose result
 * is `landed`, at or after the wait began (the wait's minute); and no later line for that branch that undid it (rolled back). A refused
 * line, another branch, a wait for something else, or a line older than the wait: null.
 */
export function landedWaitOf(step, lines) {
  if (step === null || step === undefined || !LANDED_WAIT_STATES.includes(valueOf(step, 'State'))) return null
  const wait = waitsOnOf(step)
  if (wait === null || !LANDING_WHAT.test(wait.what)) return null
  const mine = (Array.isArray(lines) ? lines : []).filter(line => line !== null && typeof line === 'object' && typeof line.branch === 'string'
    && Number.isFinite(line.at) && line.at >= wait.since && isStepsBranch(line, step))
  const landed = mine.filter(line => line.result === 'landed').sort((a, b) => b.at - a.at)[0] ?? null
  if (landed === null) return null
  if (mine.some(line => UNDONE.has(line.result) && line.at >= landed.at)) return null
  return { id: valueOf(step, 'Id'), owner: valueOf(step, 'Owner'), wait, line: landed }
}

/** The step's History line for the clear: "landed 4ba4f404 by <chat> at 10:42: no longer waits on chat 1 (its go to land, since ...)". */
export const landedHistoryLine = (line, wait) => `landed ${hash8(line.head)} by ${line.by ?? 'unknown'} at ${hourMinute(line.at)}: no longer waits on ${wait.who} (${wait.what}, since ${wait.at})`

/** What became of the branch on the remote, in the word's words. */
const branchWords = remote => (remote === 'removed' ? 'its branch is gone from origin'
  : typeof remote === 'string' && remote.startsWith('kept') ? `its branch is ${remote}` : 'see the landing line for its branch')
/** "both boards", "the board", or nothing: how many boards came back on it. */
const boardWords = count => (count >= 2 ? ', both boards' : count === 1 ? ', the board' : '')

/** The one word to the owner: "B1236 landed (4ba4f404, both boards): report it (merged 4ba4f404); its branch is gone from origin". */
export const landedWord = (id, line) => `${id} landed (${hash8(line.head)}${boardWords(line.boards)}): report it (merged ${hash8(line.head)}); ${branchWords(line.remote)}`

/** Whether the owner landed it itself (then no word: it knows). */
export const landedByOwner = (owner, by, prefix = '') => owner !== null && owner !== undefined && by !== null && by !== undefined && plainName(owner, prefix) === plainName(by, prefix)
