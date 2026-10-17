// B298, B299: what the board shows from the work store once it is the truth (spec 2026-10-17, section 8): the person's
// instructions per chat (Open instructions). Built from the items' fields alone, never from a chat's words.

import { sinceMs } from './api.mjs'
import { valueOf } from './item.mjs'

const DAY = 24 * 60 * 60_000
const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })

/** The store's items when it is the truth and could be read; else none. */
export const truthItems = work => (work?.ok === true && work.truth === 'store' && work.items instanceof Map ? [...work.items.values()] : [])

/**
 * B298: the instructions for Open instructions: `[{ id, chat, text, since, via, turns, isMissed, closedAs }]`, the open
 * ones first (missed ones on top, oldest first), then the closed ones filed within the last day, newest first.
 */
export function instructionsOf(work, now) {
  const all = truthItems(work).filter(item => valueOf(item, 'Kind') === 'instruction').map(item => {
    const turns = Number(valueOf(item, 'Missed') ?? 0) || 0
    const isOpen = valueOf(item, 'State') === 'open'
    const since = sinceMs(valueOf(item, 'Since'))
    return {
      id: valueOf(item, 'Id'), chat: valueOf(item, 'Chat'), text: valueOf(item, 'Text') ?? '', since: Number.isFinite(since) ? since : null,
      via: valueOf(item, 'Via') ?? 'chat', turns, isOpen, isMissed: isOpen && turns > 0, closedAs: isOpen ? null : valueOf(item, 'Closed as'),
    }
  })
  const open = all.filter(one => one.isOpen).sort((a, b) => Number(b.isMissed) - Number(a.isMissed) || byId(a, b))
  const closed = all.filter(one => !one.isOpen && one.since !== null && now - one.since < DAY).sort((a, b) => b.since - a.since || byId(b, a))
  return [...open, ...closed].map(({ isOpen, ...one }) => one)
}
