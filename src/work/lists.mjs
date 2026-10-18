// B298, B299: what the board shows from the work store (spec 2026-10-17, section 8): the person's instructions per chat
// (Open instructions), the asks (Needs your attention) and the notes (Information). Built from the items' fields
// alone, never from a chat's words.

import { sinceMs } from './api.mjs'
import { valueOf } from './item.mjs'
import { itemsOf } from './read.mjs'

const DAY = 24 * 60 * 60_000
const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })


/**
 * B298: the instructions for Open instructions: `[{ id, chat, text, since, via, turns, isMissed, closedAs }]`, the open
 * ones first (missed ones on top, oldest first), then the closed ones filed within the last day, newest first.
 */
export function instructionsOf(work, now) {
  const all = itemsOf(work).filter(item => valueOf(item, 'Kind') === 'instruction').map(item => {
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

const KEEP_ANSWERED_MS = 10 * 60_000
const plainName = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const textOf = item => (item.sections.get('Text') ?? []).filter(one => one.trim() !== '')
const asksOfStore = work => itemsOf(work).filter(item => valueOf(item, 'Kind') === 'ask' && /^Q\d+$/.test(valueOf(item, 'Id') ?? ''))

/**
 * B299: who waits for the person by the store: the chats (by plain name, lower case) with an open blocking ask, and
 * those with an open ask of the app's question form. B301: `filed`, per chat when it last filed an ask of its own
 * (its first History line, else its Since): a chat that wrote questions in its chat after
 * that filed none. Empty when the store cannot be read: no chat waits by a chat's words instead.
 */
export function storeWaits(work, prefix = '') {
  const own = asksOfStore(work).filter(item => valueOf(item, 'Owner') !== null)
  const open = own.filter(item => valueOf(item, 'State') === 'open')
  const filed = new Map()
  for (const item of own) {
    const name = plainName(valueOf(item, 'Owner'), prefix)
    const first = (item.sections.get('History') ?? [])[0]?.match(/^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s/)?.[1]
    const at = sinceMs(first ?? valueOf(item, 'Since'))
    if (Number.isFinite(at)) filed.set(name, Math.max(filed.get(name) ?? -Infinity, at))
  }
  return {
    blocking: new Set(open.filter(item => valueOf(item, 'Blocking') === 'yes').map(item => plainName(valueOf(item, 'Owner'), prefix))),
    form: new Set(open.filter(item => valueOf(item, 'Via') === 'form').map(item => plainName(valueOf(item, 'Owner'), prefix))),
    filed,
  }
}

/**
 * B310: the notes each chat filed to the main chat (`To` main, or the main chat's own name): per chat (plain name,
 * lower case) `[{ at, text }]`, `at` its Since (to the minute) and `text` its words as written under Text (else the
 * head's one line). A worker may send its pause line for the limit this way; state.mjs reads it (limits.mjs,
 * `storePause`). Empty when the store cannot be read.
 */
export function notesToMain(work, { prefix = '', main = 'main' } = {}) {
  const mains = new Set(['main', plainName(main, prefix)])
  const byChat = new Map()
  for (const item of itemsOf(work)) {
    if (valueOf(item, 'Kind') !== 'note' || !mains.has(plainName(valueOf(item, 'To'), prefix)) || valueOf(item, 'From') === null) continue
    const at = sinceMs(valueOf(item, 'Since'))
    if (!Number.isFinite(at)) continue
    const words = textOf(item)
    const name = plainName(valueOf(item, 'From'), prefix)
    byChat.set(name, [...(byChat.get(name) ?? []), { at, text: words.length > 0 ? words.join('\n') : valueOf(item, 'Text') ?? '' }])
  }
  return byChat
}

/** Whether an option is the one advised: its text, or its letter ("B" of "B thick"). */
const isAdvised = (option, advice) => advice !== null && (option === advice || option.toLowerCase().startsWith(`${advice.toLowerCase()} `))

/**
 * B299: the store's asks for Needs your attention, in the shape of the board's other cards: the open ones, and the ones
 * answered within ten minutes (their card says the answer is on its way, then closes). `kind` is the card's form (a
 * look is approved or rejected, a do is done, a decide or provide takes words); `asks` the ask's own kind; `blocks`
 * the step it holds up and who waits on it. `names` are the chats on the board, `answerOf(id)` what the outbox knows of
 * the answer sent for it.
 */
export function storeNeeds(work, { now, names = [], prefix = '', answerOf = () => ({ answer: null, earlier: null }) }) {
  const items = new Map(itemsOf(work).map(item => [valueOf(item, 'Id'), item]))
  const nameOf = owner => names.find(name => plainName(name, prefix) === plainName(owner, prefix)) ?? owner
  return asksOfStore(work).flatMap(item => {
    const state = valueOf(item, 'State')
    const since = sinceMs(valueOf(item, 'Since'))
    if (state !== 'open' && !(state === 'answered' && Number.isFinite(since) && now - since < KEEP_ANSWERED_MS)) return []
    const id = valueOf(item, 'Id')
    const asks = valueOf(item, 'Asks') ?? 'decide'
    const owner = valueOf(item, 'Owner')
    const of = valueOf(item, 'Of')
    const step = of === null ? undefined : items.get(of)
    const advice = valueOf(item, 'Advice')
    const via = valueOf(item, 'Via')
    const blocking = valueOf(item, 'Blocking') === 'yes'
    const [title = valueOf(item, 'Title') ?? '', ...rest] = textOf(item)
    const known = answerOf(`work:${id}`)
    // Answered with nobody to wake (or before the board kept it): the answer as the store holds it.
    const answer = known.answer ?? (state === 'open' ? null : { at: since, verdict: null, text: (item.sections.get('Answer') ?? []).join(' '), state: 'delivered', takenAt: null, deliveredAt: since })
    return [{
      id: `work:${id}`, workId: id, from: owner === null ? null : nameOf(owner), kind: asks === 'look' ? 'verify' : asks === 'do' ? 'do' : 'input', asks,
      title: valueOf(item, 'Title') ?? title, text: rest.join('\n'), at: Number.isFinite(since) ? since : null,
      // B269: its whole first line, which the calm window shows as the question (the Title may be cut).
      question: title,
      options: (valueOf(item, 'Options') ?? '').split(' | ').filter(one => one.trim() !== '').map(label => ({ label, picture: null, isRecommended: isAdvised(label, advice) })),
      advice, pictures: (valueOf(item, 'Pictures') ?? '').split(',').map(one => one.trim()).filter(Boolean),
      play: (item.sections.get('Play') ?? [])[0] ?? null, run: null, game: null, checks: [], tried: [], version: null,
      of, ofTitle: step === undefined ? null : valueOf(step, 'Title'), blocking,
      blocks: blocking && of !== null ? [{ step: of, owner: step === undefined ? null : valueOf(step, 'Owner') }] : [],
      via, isForm: via === 'form', isRefine: via === 'refine',
      // The board answers it through the store (POST /api/work, answer); a question of the app's form only in its chat.
      canAnswer: state === 'open' && via !== 'form', isClosed: false, answer, earlier: known.earlier ?? null,
    }]
  })
}

/**
 * B299: the Information list: notes and reports, one line each, newest first; the read ones of the last day after the
 * unread. Nothing here waits for the person.
 */
export function informationOf(work, now) {
  return itemsOf(work).filter(item => valueOf(item, 'Kind') === 'note').map(item => {
    const since = sinceMs(valueOf(item, 'Since'))
    const words = textOf(item)
    return {
      id: valueOf(item, 'Id'), from: valueOf(item, 'From'), to: valueOf(item, 'To'), text: words.length > 0 ? words.join(' ') : valueOf(item, 'Text') ?? '',
      about: (item.sections.get('About') ?? [])[0] ?? null, since: Number.isFinite(since) ? since : null, isRead: valueOf(item, 'State') === 'read',
    }
  }).filter(one => !one.isRead || (one.since !== null && now - one.since < DAY))
    .sort((a, b) => Number(a.isRead) - Number(b.isRead) || (b.since ?? 0) - (a.since ?? 0) || b.id.localeCompare(a.id, 'en', { numeric: true }))
}
