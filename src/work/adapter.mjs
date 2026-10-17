// B296: the work store → the backlog's shape, so `state.mjs` and the page read the store in the form they know (spec
// 2026-10-17, section 3). The store is written as the backlog's text in today's form and read by the same
// `parseBacklog`; the same text, marked as generated, is backlog.md, the store's view (view.mjs). B301: the backlog file
// itself is never read.

import { parseBacklog } from '../backlog.mjs'
import { valueOf } from './item.mjs'
import { stepRest } from './line.mjs'
import { REFINED_MARK, STORE_SEPARATOR, stepItem } from './migrate.mjs'

const indented = line => (/^\s/.test(line) ? line : `  ${line}`)

/** A step's indented lines from its item: Context in order, the refine block where it stood. */
export function stepNotes(item) {
  const context = item.sections.get('Context') ?? []
  const refined = item.sections.get('Refined') ?? []
  const lines = context.includes(REFINED_MARK) ? context.flatMap(line => (line === REFINED_MARK ? refined : [line])) : [...refined, ...context]
  return lines.filter(line => line.trim() !== '').map(indented)
}

/** B297: the states that stand ticked on the backlog: a step done or dropped, an ask answered. */
const TICKED = ['done', 'answered', 'dropped']
/** A step's line on the backlog, ticked when its item is done (a step `done` or `dropped`, an ask `answered`). */
export function stepLine(item) {
  return `- [${TICKED.includes(valueOf(item, 'State')) ? 'x' : ' '}] ${stepRest(item)}`
}

/** Keys the line and its lines give back by themselves, or that the view does not carry. */
const NOT_MARKED = new Set(['Id', 'Since', 'Queue note', 'Line', 'Activity'])
const none = value => (value === undefined || value === '' || value === '-' ? null : value)

/**
 * B297: the line under a step with what its line and lines cannot say, as the store holds it ("  [store] State: taken
 * · Goal: G17", '-' for none), or null when they say it all. The migration reads it back (migrate.mjs, STORE_LINE).
 * A store migrated from the backlog never needs one: what it holds came from the lines.
 */
export function storeLine(item, activity = null) {
  const read = stepItem({ id: valueOf(item, 'Id') ?? 'L0', isDone: TICKED.includes(valueOf(item, 'State')), rest: stepRest(item), raw: stepNotes(item), activity, now: 0 })
  const keys = [...new Set([...item.head.keys(), ...read.head.keys()])].filter(key => !NOT_MARKED.has(key))
  const differ = keys.filter(key => none(item.head.get(key)) !== none(read.head.get(key)))
  if (differ.length === 0) return null
  return `  [store] ${differ.map(key => `${key}: ${(none(item.head.get(key)) ?? '-').replaceAll(STORE_SEPARATOR, ' - ')}`).join(STORE_SEPARATOR)}`
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
      if (item !== undefined) {
        const mark = storeLine(item, activity.name)
        lines.push(stepLine(item), ...(mark === null ? [] : [mark]), ...stepNotes(item))
      }
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

// B299: an ask the store gave its own id (`Q<n>`) never stands on a backlog line, also one under no step.
const onBacklog = item => valueOf(item, 'Kind') === 'step' || (valueOf(item, 'Kind') === 'ask' && valueOf(item, 'Of') === null && !/^Q\d+$/.test(valueOf(item, 'Id') ?? ''))

/** What does not fit between the items and the activities: an id listed but not held, an item no activity lists. */
export function storeProblems(items, activities) {
  const listed = new Set(activities.flatMap(activity => activity.steps ?? []))
  return [
    ...[...listed].filter(id => !items.has(id)).map(id => `${id}: an activity lists it, but the store has no file for it`),
    // An ask under a step (`Of:`) stands on no backlog line of its own.
    ...[...items.keys()].filter(id => !listed.has(id) && onBacklog(items.get(id))).map(id => `${id}: in the store, but no longer on the backlog`),
  ]
}
