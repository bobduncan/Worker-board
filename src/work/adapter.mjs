// B296: the work store → today's backlog, so `state.mjs` and the page need no change while the store runs as a shadow
// (spec 2026-10-17, section 3). The store is written as the backlog's text in today's form and read by the same
// `parseBacklog`: what the page shows from the store is what it would show from the file.

import { parseBacklog } from '../backlog.mjs'
import { valueOf } from './item.mjs'
import { stepRest } from './line.mjs'
import { REFINED_MARK } from './migrate.mjs'

const indented = line => (/^\s/.test(line) ? line : `  ${line}`)

/** A step's indented lines from its item: Context in order, the refine block where it stood. */
export function stepNotes(item) {
  const context = item.sections.get('Context') ?? []
  const refined = item.sections.get('Refined') ?? []
  const lines = context.includes(REFINED_MARK) ? context.flatMap(line => (line === REFINED_MARK ? refined : [line])) : [...refined, ...context]
  return lines.filter(line => line.trim() !== '').map(indented)
}

/** A step's line on the backlog, ticked when its item is done (a step `done`, an ask `answered`). */
export function stepLine(item) {
  const isDone = ['done', 'answered'].includes(valueOf(item, 'State'))
  return `- [${isDone ? 'x' : ' '}] ${stepRest(item)}`
}

/**
 * The store as the backlog's text in today's form: the head of the file, then per activity its heading, its notes,
 * and its steps in order, each with its lines and the loose lines that followed it. An id an activity lists that the
 * store does not hold is left out (`storeProblems` names it).
 */
export function backlogText(items, activities, preamble = []) {
  const lines = [...preamble]
  for (const activity of activities) {
    if (lines.length > 0) lines.push('')
    lines.push(activity.heading ?? `## ${activity.name}${activity.isFocus ? ' #focus' : ''}`)
    lines.push(...(activity.notes ?? []))
    const loose = activity.loose ?? []
    for (const id of activity.steps ?? []) {
      const item = items.get(id)
      if (item !== undefined) lines.push(stepLine(item), ...stepNotes(item))
      lines.push(...loose.filter(one => one.after === id).map(one => one.line))
    }
    lines.push(...loose.filter(one => !(activity.steps ?? []).includes(one.after)).map(one => one.line))
  }
  return `${lines.join('\n')}\n`
}

/** The store in `parseBacklog`'s shape: the same `{ activities }` the backlog's text gives. */
export function storeAsBacklog(items, activities, { prefix = '', names = [] } = {}) {
  return parseBacklog(backlogText(items, activities), { prefix, names })
}

const onBacklog = item => valueOf(item, 'Kind') === 'step' || (valueOf(item, 'Kind') === 'ask' && valueOf(item, 'Of') === null)

/** What does not fit between the items and the activities: an id listed but not held, an item no activity lists. */
export function storeProblems(items, activities) {
  const listed = new Set(activities.flatMap(activity => activity.steps ?? []))
  return [
    ...[...listed].filter(id => !items.has(id)).map(id => `${id}: an activity lists it, but the store has no file for it`),
    // An ask under a step (`Of:`) stands on no backlog line of its own.
    ...[...items.keys()].filter(id => !listed.has(id) && onBacklog(items.get(id))).map(id => `${id}: in the store, but no longer on the backlog`),
  ]
}
