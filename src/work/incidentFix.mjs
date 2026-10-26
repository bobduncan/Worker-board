// Incident fixes: which incidents a step fixes. Until the redesign's Part 2 (2026-10-25) the board queued a ready
// incident fix itself for a worker (2026-10-24, the person's choice B); now the board hands out every task from one
// ready list (work/handOut.mjs), where a fix (Priority fix) simply stands first. What stays here is pure: the incidents
// a fix step's title names (`incidentsNamedBy`, the supervisor's cards group by it) and those it fixes
// (`incidentsFixedBy`).

import { valueOf } from './item.mjs'

const byId = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
const stateOf = item => valueOf(item, 'State')
const idOf = item => valueOf(item, 'Id')

/** "Fix of X4: ...", "Fix of X4, X5", "Fix of X4-X6": the incidents a fix step's title names. */
const FIX_OF = /^Fix of\s+((?:X\d+(?:\s*[-–—]\s*X?\d+)?(?:\s*(?:,|&|\+|\band\b)\s*)?)+)/
/** A range in a title reaches at most this far, so a stray "X1-X99999" names one. */
const RANGE_MOST = 50

/**
 * The incidents a step's title names as the ones it fixes: "Fix of X4: ..." gives X4; a list ("X4, X5") or a range
 * ("X4-X6") gives each. Empty for a title that says nothing of the kind. (The supervisor's cards group by it too.)
 */
export function incidentsNamedBy(title) {
  const found = String(title ?? '').match(FIX_OF)
  if (found === null) return []
  const ids = []
  for (const part of found[1].matchAll(/X(\d+)(?:\s*[-–—]\s*X?(\d+))?/g)) {
    const from = Number(part[1])
    const to = part[2] === undefined ? from : Number(part[2])
    if (to > from && to - from < RANGE_MOST) for (let n = from; n <= to; n += 1) ids.push(`X${n}`)
    else ids.push(`X${from}`)
  }
  return ids
}

/**
 * The incidents the step fixes, not fixed yet: those whose `Fix` names it, then those its title names ("Fix of X<n>")
 * that the store holds with no Fix, or with this step as its Fix (the review: an incident whose Fix is another step is
 * that step's). Empty for a step no incident waits on.
 */
export function incidentsFixedBy(items, step) {
  const id = idOf(step)
  const isOpen = item => item !== undefined && valueOf(item, 'Kind') === 'incident' && !['fixed', 'closed'].includes(stateOf(item))
  const byFix = [...(items?.values() ?? [])].filter(item => isOpen(item) && valueOf(item, 'Fix') === id).map(idOf)
  const byTitle = incidentsNamedBy(valueOf(step, 'Title'))
    .filter(one => isOpen(items?.get(one)) && [null, id].includes(valueOf(items.get(one), 'Fix')))
  return [...new Set([...byFix.sort(byId), ...byTitle])]
}
