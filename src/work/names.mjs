// B313: where the store names a chat, and an item moved to a chat's new name. The store names chats by their short name:
// Owner on steps and asks, Chat on instructions, From and To on notes, "for <chat>" in a step's `Queue when
// refined`, and (T9.1.1) each chat in a Quality Assurance task's `Not by` (a list). Only open items follow a rename: a step not done or dropped, an open ask, an open instruction, an unread
// note. What was done under the old name keeps it.

import { valueOf } from './item.mjs'

/** A chat's name as the list writes it, without the title's prefix, for comparing ("Team - Units" is "units"). */
export const plainName = (name, prefix = '') => {
  let words = String(name ?? '').trim()
  if (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase())) words = words.slice(prefix.length)
  return words.trim().toLowerCase()
}

const kindOf = item => valueOf(item, 'Kind') ?? 'step'
const OPEN = {
  step: state => !['done', 'dropped'].includes(state),
  ask: state => state === 'open',
  instruction: state => state === 'open',
  note: state => state === 'unread',
}
// Redesign Part 2: a step's pin moves with its chat's name too.
const FIELDS = { step: ['Owner', 'Pinned'], ask: ['Owner'], instruction: ['Chat'], note: ['From', 'To'] }
/** A note's To may be a word rather than a chat: the person, or the main chat whatever its name. */
const TO_WORDS = new Set(['you', 'main'])
const KIND_ORDER = ['step', 'ask', 'instruction', 'note']
const QUEUE_FOR = /^for (.+)$/

const isOpen = item => OPEN[kindOf(item)]?.(valueOf(item, 'State')) === true
const names = (value, name, prefix) => value !== null && plainName(value, prefix) === plainName(name, prefix)

/** The item with every place that names `from` naming `to`, or null when it is not open or does not name it. */
export function renamedItem(item, from, to, prefix = '') {
  if (!isOpen(item)) return null
  const head = new Map(item.head)
  let isMoved = false
  for (const key of FIELDS[kindOf(item)] ?? []) {
    const value = valueOf(item, key)
    if (key === 'To' && TO_WORDS.has(String(value ?? '').toLowerCase())) continue
    if (!names(value, from, prefix)) continue
    head.set(key, to)
    isMoved = true
  }
  // T9.1.1: a Quality Assurance task's `Not by` is a list of chats (names joined with ", "): each one that is `from` follows.
  const notBy = kindOf(item) === 'step' ? valueOf(item, 'Not by') : null
  if (notBy !== null) {
    const parts = notBy.split(/\s*,\s*/)
    const moved = parts.map(part => (names(part, from, prefix) ? to : part))
    if (moved.some((part, at) => part !== parts[at])) {
      head.set('Not by', moved.join(', '))
      isMoved = true
    }
  }
  const queue = kindOf(item) === 'step' ? valueOf(item, 'Queue when refined') : null
  if (queue !== null) {
    const parts = queue.split(';').map(part => part.trim())
    const moved = parts.map(part => (names(part.match(QUEUE_FOR)?.[1] ?? null, from, prefix) ? `for ${to}` : part))
    if (moved.some((part, at) => part !== parts[at])) {
      head.set('Queue when refined', moved.join('; '))
      isMoved = true
    }
  }
  return isMoved ? { ...item, head, sections: new Map(item.sections) } : null
}

/** The ids of the open items that name `name`: steps, then asks, instructions and notes, each by id. */
export function openNaming(items, name, prefix = '') {
  return [...items.values()]
    .filter(item => renamedItem(item, name, '\u0000', prefix) !== null)
    .sort((a, b) => KIND_ORDER.indexOf(kindOf(a)) - KIND_ORDER.indexOf(kindOf(b)) || String(valueOf(a, 'Id')).localeCompare(String(valueOf(b, 'Id')), 'en', { numeric: true }))
    .map(item => valueOf(item, 'Id'))
}

/**
 * The line on top for a rename the board saw but did not carry out (`held` of names.json), while open items still name
 * the old name; null when none does.
 */
export function heldLine({ from, to, why, prefix = '' }, items) {
  const ids = openNaming(items, from, prefix)
  if (ids.length === 0) return null
  return `names.json: the board did not move the open items of ${from} (${ids.join(', ')}) to ${to}, as ${why}: the main chat moves them with work rename --from "${from}" --to "<its name now>".`
}
