// The guard (the user, 2026-10-21: "yes", to the board holding it): no second thing of a kind is built before its
// standard is confirmed and its foundation exists. A step whose Standard line names a kind that the product plan has a
// standard for goes into a queue only once that standard is confirmed and its foundation is built; the foundation's
// own steps go first (their Standard line ends in " · foundation"). PURE.

import { valueOf } from './item.mjs'
import { standardOf } from './standard.mjs'

/** The last part of a foundation step's Standard line: "<kind> · <reference picture> · target <score> · foundation". */
export const FOUNDATION_PART = 'foundation'

const partsOf = line => String(line).split(/\s*·\s*/).map(part => part.trim())
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

/** Whether a Standard line marks the step as its kind's foundation. */
export const isFoundationLine = line => partsOf(line).slice(3).some(part => same(part, FOUNDATION_PART))

/**
 * Why the step may not go into a queue now, in one line, or null when nothing holds it. `standards` are the product
 * plan's (plan.mjs: `kind`, `state`, `foundation`, `foundationBuilt`, `id`, `title`). A step without a Standard line,
 * with "none (...)", or of a kind no standard names is never held.
 */
export function standardHold(item, standards) {
  const line = standardOf(item)
  if (line === null || /^none\b/i.test(line)) return null
  const kind = partsOf(line)[0] ?? ''
  if (kind === '') return null
  const of = (Array.isArray(standards) ? standards : []).filter(one => typeof one?.kind === 'string' && one.kind.trim() !== '' && same(one.kind, kind))
  if (of.length === 0) return null
  const id = valueOf(item, 'Id') ?? 'This step'
  const open = of.find(one => one.state !== 'confirmed')
  if (open !== undefined) {
    return `${id} is a ${kind} step, and the ${kind} standard (${open.id} ${open.title}) is not confirmed yet: it goes into a queue once it is confirmed on the Vision tab, step Standards.`
  }
  const unbuilt = of.find(one => String(one.foundation ?? '').trim() !== '' && one.foundationBuilt !== true)
  if (unbuilt !== undefined && !isFoundationLine(line)) {
    return `${id} is a ${kind} step, and the foundation of the ${kind} standard (${unbuilt.id} ${unbuilt.title}) is not built yet: only the foundation's own steps (Standard line ending in " · ${FOUNDATION_PART}") go into a queue first.`
  }
  return null
}
