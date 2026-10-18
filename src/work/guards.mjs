// B296: the guards a flow may name in `when`, and the actions it may name in `then` (spec 2026-10-17, section 4).
// A new guard is a new name here, a few lines each. `ctx = { store: { items }, freeChats: Set, now, overlaps }`;
// `overlaps(item)` is the server's: the id of a taken step whose Touches overlap this one's, or null.

import { valueOf } from './item.mjs'
import { gitCheckPassed, needsResultCheck, resultCheckOf } from './resultCheck.mjs'
import { openAsksOf, refineAsksOf } from './stepAsks.mjs'

const idsIn = value => (value ?? '').match(/\b[A-Z]\d+\b/g) ?? []
const asksOf = (item, ctx) => [...(ctx.store?.items?.values() ?? [])]
  .filter(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'Of') === valueOf(item, 'Id'))
const isOpen = ask => valueOf(ask, 'State') === 'open'
/** B305: what a step's `Blocked by` names no longer holds it: a step done or dropped, an ask answered or withdrawn. */
export const CLEARED = ['done', 'dropped', 'answered', 'withdrawn']
/** B306: the steps and asks a step's `Waits for` names (B<n>, Q<n>); its other words are only what they wait for. */
export const waitIds = item => (valueOf(item, 'Waits for') ?? '').match(/\b[BQ]\d+\b/g) ?? []
/** B306: the words of a `Waits for` that names no id: they hold the step until the main chat or the person clears them. */
export const waitWords = item => (waitIds(item).length === 0 ? valueOf(item, 'Waits for') : null)
/**
 * The ids the step's `Blocked by` and (B306) `Waits for` name that still hold it (one the store does not hold counts
 * as open).
 */
export const blockersOpen = (item, ctx) => [...new Set([...idsIn(valueOf(item, 'Blocked by')), ...waitIds(item)])].filter(id => {
  const other = ctx.store?.items?.get(id)
  return other === undefined || !CLEARED.includes(valueOf(other, 'State'))
})
/** B306: nothing holds the step: no id it is blocked by or waits for is open, and no words wait to be cleared. */
const isFree = (item, ctx) => blockersOpen(item, ctx).length === 0 && waitWords(item) === null

export const GUARDS = {
  'refined is ready': item => valueOf(item, 'Refined') === 'ready',
  // B303: the main chat (or the person) asked to queue it before its refine: the board queues it once it is refined.
  // B309: and once no ask under it is open, nor answered and not yet folded in by the Advisor.
  'a queue was asked before its refine': (item, ctx) => valueOf(item, 'Queue when refined') !== null
    && openAsksOf(ctx.store?.items, valueOf(item, 'Id'), item).length === 0 && refineAsksOf(ctx.store?.items, item).length === 0,
  'Touches overlaps no taken step': (item, ctx) => (ctx.overlaps?.(item) ?? null) === null,
  // B305: the worker's own take needs only what it is blocked by resolved; Owner free is the board's delivery.
  // B306: "Blocked by" here means what the step waits for too: the ids `Waits for` names, and words not yet cleared.
  'Blocked by all done': (item, ctx) => isFree(item, ctx),
  'Blocked by all done and Owner free': (item, ctx) => {
    const owner = valueOf(item, 'Owner')
    return isFree(item, ctx) && owner !== null && (ctx.freeChats?.has(owner) ?? false)
  },
  'an ask with Blocking yes is open': (item, ctx) => asksOf(item, ctx).some(ask => isOpen(ask) && valueOf(ask, 'Blocking') === 'yes'),
  'its asks are answered': (item, ctx) => !asksOf(item, ctx).some(isOpen),
  // B356: "the check" is the board's own, and for a step with agreed points or a Standard line also the result check
  // by a helper that did not build it (resultCheck.mjs).
  'the check passed and no ask of kind look is open': (item, ctx) => gitCheckPassed(item) && (!needsResultCheck(item) || resultCheckOf(item) === 'passed')
    && !asksOf(item, ctx).some(ask => isOpen(ask) && valueOf(ask, 'Asks') === 'look'),
}

/** The actions a move's `then` may name; the server carries them out (increment 2 and later). */
export const ACTIONS = ['wake Owner', 'notify Main', 'check: base equals remote, branch gone, result named']

/** The paths a step's "Touches:" lines name (under Context or a Touches section), each as written. */
function touchesOf(item) {
  const lines = [...(item.sections.get('Context') ?? []), ...(item.sections.get('Touches') ?? []).map(one => `Touches: ${one}`)]
  return lines.flatMap(one => one.trim().match(/^Touches:\s*(.*)$/)?.[1].split(/[,;]\s*|\s+and\s+/) ?? [])
    .map(one => one.replace(/^[-*]\s+/, '').replace(/[`.]+$/g, '').replace(/^`/, '').trim()).filter(Boolean)
}

/**
 * The flow's `overlaps` for the server: the id of a taken or in-progress step whose Touches name a path the item's
 * Touches name too (a folder covers what is in it), or null.
 */
export function overlapsIn(items) {
  return item => {
    const mine = touchesOf(item)
    if (mine.length === 0) return null
    const covers = (a, b) => a === b || b.startsWith(`${a.replace(/\/$/, '')}/`) || a.startsWith(`${b.replace(/\/$/, '')}/`)
    for (const other of items.values()) {
      if (other === item || valueOf(other, 'Id') === valueOf(item, 'Id') || !['taken', 'in progress', 'waiting on you'].includes(valueOf(other, 'State'))) continue
      if (touchesOf(other).some(path => mine.some(own => covers(own, path)))) return valueOf(other, 'Id')
    }
    return null
  }
}
