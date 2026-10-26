// B298, B299: what the board shows from the work store (spec 2026-10-17, section 8): the person's instructions per chat
// (Open instructions), the asks (Needs your attention) and the notes (Information). Built from the items' fields
// alone, never from a chat's words.

import { sinceMs } from './api.mjs'
import { askKey, askPartsOf, askWordsOf } from './askWords.mjs'
import { repeatFactsOf } from './askRepeat.mjs'
import { askFiledMs, valueOf } from './item.mjs'
import { itemsOf } from './read.mjs'
import { NOTE_LINE, TAKE_BACK_MS, isPartnerAnswered, isRoutedToPartner, partnerAskStand } from './partnerAnswers.mjs'
import { isRecap } from './recap.mjs'

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
/** A chat's name on the board for a store's owner (written with or without the list's prefix); the owner as written when none fits. */
export const nameFinder = (names, prefix = '') => owner => names.find(name => plainName(name, prefix) === plainName(owner, prefix)) ?? owner
const textOf = item => (item.sections.get('Text') ?? []).filter(one => one.trim() !== '')
const asksOfStore = work => itemsOf(work).filter(item => valueOf(item, 'Kind') === 'ask' && /^Q\d+$/.test(valueOf(item, 'Id') ?? ''))

/**
 * B299: who waits for the person by the store: the chats (by plain name, lower case) with an open blocking ask, and
 * those with an open ask of the app's question form. B301: `filed`, per chat when it last filed an ask of its own
 * (Warnings, 2026-10-19: `askFiledMs`, to the millisecond; an older ask at the end of its minute): a chat that wrote
 * questions in its chat after that filed none. Warnings: `open`, per chat its open asks of its own (`{ id, key, words, of }`,
 * the key its words as `askKey` compares them; B474: words and of as `forYouRepeat` compares them), for the items of a "For you" block that ask one of them. Empty when the
 * store cannot be read: no chat waits by a chat's words instead.
 */
export function storeWaits(work, prefix = '') {
  const own = asksOfStore(work).filter(item => valueOf(item, 'Owner') !== null)
  const open = own.filter(item => valueOf(item, 'State') === 'open')
  const filed = new Map()
  for (const item of own) {
    const name = plainName(valueOf(item, 'Owner'), prefix)
    const at = askFiledMs(item)
    if (Number.isFinite(at)) filed.set(name, Math.max(filed.get(name) ?? -Infinity, at))
  }
  const openOf = new Map()
  for (const item of open) {
    const name = plainName(valueOf(item, 'Owner'), prefix)
    openOf.set(name, [...(openOf.get(name) ?? []), { ...repeatFactsOf(item), key: askKey(askWordsOf(item)) }])
  }
  // Partner answers, the review's findings: a blocking ask routed to the partner holds its chat for the partner, not for
  // the person (`partner`: per chat the ids of such asks).
  const forPartner = new Map()
  const forYou = open.filter(item => valueOf(item, 'Via') !== 'refine' && !isRoutedToPartner(item))
    .sort((a, b) => Number(valueOf(a, 'Id').slice(1)) - Number(valueOf(b, 'Id').slice(1)))
  for (const item of open.filter(one => valueOf(one, 'Blocking') === 'yes' && isRoutedToPartner(one))) {
    const name = plainName(valueOf(item, 'Owner'), prefix)
    forPartner.set(name, [...(forPartner.get(name) ?? []), valueOf(item, 'Id')])
  }
  return {
    blocking: new Set(open.filter(item => valueOf(item, 'Blocking') === 'yes' && !isRoutedToPartner(item)).map(item => plainName(valueOf(item, 'Owner'), prefix))),
    partner: forPartner,
    form: new Set(open.filter(item => valueOf(item, 'Via') === 'form').map(item => plainName(valueOf(item, 'Owner'), prefix))),
    // B280: the chats with an open ask of their own for the person, blocking or not; a refine question is the refine's.
    // B464: one routed to the partner first is not the person's (it stands under no Needs your attention).
    asking: new Set(forYou.map(item => plainName(valueOf(item, 'Owner'), prefix))),
    // B464: per chat its asks that ask the person now, `{ id, title }`, oldest first, for its row to name them.
    asks: forYou.reduce((byChat, item) => {
      const name = plainName(valueOf(item, 'Owner'), prefix)
      return byChat.set(name, [...(byChat.get(name) ?? []), { id: valueOf(item, 'Id'), title: askPartsOf(item).title }])
    }, new Map()),
    filed,
    open: openOf,
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
 * the answer sent for it. Partner answers (2026-10-19): an ask routed to the partner is not the person's (not listed);
 * one the partner answered stays among the closed cards for a day, its answer `by: 'partner'` with its `why`, and may
 * be taken back (`canTakeBack`); `route` and `routeNote` say whether it came to the person by the partner and why.
 */
export function storeNeeds(work, { now, names = [], prefix = '', answerOf = () => ({ answer: null, earlier: null }) }) {
  const items = new Map(itemsOf(work).map(item => [valueOf(item, 'Id'), item]))
  const nameOf = owner => names.find(name => plainName(name, prefix) === plainName(owner, prefix)) ?? owner
  return asksOfStore(work).flatMap(item => {
    const state = valueOf(item, 'State')
    const since = sinceMs(valueOf(item, 'Since'))
    const byPartner = isPartnerAnswered(item)
    if (isRoutedToPartner(item)) return []
    // The review's findings: a partner's answer keeps its card (and its Undo) for 7 days.
    if (state !== 'open' && !(state === 'answered' && Number.isFinite(since) && now - since < (byPartner ? TAKE_BACK_MS : KEEP_ANSWERED_MS))) return []
    const id = valueOf(item, 'Id')
    const asks = valueOf(item, 'Asks') ?? 'decide'
    const owner = valueOf(item, 'Owner')
    const of = valueOf(item, 'Of')
    const step = of === null ? undefined : items.get(of)
    const advice = valueOf(item, 'Advice')
    const via = valueOf(item, 'Via')
    const blocking = valueOf(item, 'Blocking') === 'yes'
    // B452: the title the card and the window lead with, and the context under it (an old ask's long line split).
    const { title, context } = askPartsOf(item)
    const known = answerOf(`work:${id}`)
    // Answered with nobody to wake (or before the board kept it): the answer as the store holds it.
    const stored = { at: since, verdict: null, text: (item.sections.get('Answer') ?? []).join(' '), state: 'delivered', takenAt: null, deliveredAt: since }
    const why = byPartner ? (item.sections.get('Why') ?? []).join(' ').trim() || null : null
    // Partner answers: the partner's answer as the store holds it, with where its word to the chat is.
    const answer = byPartner ? { ...stored, ...(known.answer === null ? {} : { state: known.answer.state, takenAt: known.answer.takenAt ?? null, deliveredAt: known.answer.deliveredAt ?? since }), by: 'partner', why }
      : known.answer ?? (state === 'open' ? null : stored)
    const routeNote = (item.sections.get('Route') ?? []).join(' ').trim()
    return [{
      id: `work:${id}`, workId: id, from: owner === null ? null : nameOf(owner), kind: asks === 'look' ? 'verify' : asks === 'do' ? 'do' : 'input', asks,
      title, text: context.join('\n'), at: Number.isFinite(since) ? since : null,
      // B269: what the calm window shows as the question; B452: the ask's title, whole (the Title field may be cut).
      question: title,
      options: (valueOf(item, 'Options') ?? '').split(' | ').filter(one => one.trim() !== '').map(label => ({ label, picture: null, isRecommended: isAdvised(label, advice) })),
      advice, pictures: (valueOf(item, 'Pictures') ?? '').split(',').map(one => one.trim()).filter(Boolean),
      play: (item.sections.get('Play') ?? [])[0] ?? null, run: null, game: null, checks: [], tried: [], version: null,
      of, ofTitle: step === undefined ? null : valueOf(step, 'Title'), blocking,
      blocks: blocking && of !== null ? [{ step: of, owner: step === undefined ? null : valueOf(step, 'Owner') }] : [],
      via, isForm: via === 'form', isRefine: via === 'refine',
      // The board answers it through the store (POST /api/work, answer); a question of the app's form only in its chat.
      canAnswer: state === 'open' && via !== 'form', isClosed: false, answer, earlier: known.earlier ?? null,
      route: valueOf(item, 'Route'), routeNote: routeNote === '' ? null : routeNote, canTakeBack: byPartner,
    }]
  })
}

/**
 * Partner answers, the review's findings: the asks with the partner now (routed to it, open), for the small "With your
 * partner" line under Needs your attention and the Advisor's line: `[{ id, from, title, of, at, ... }]`, oldest first.
 * The person, 2026-10-26: "I want to see where the questions are": each carries its `stand` (`partnerAskStand`: queued or
 * on it, since when, and when it comes to the person), from the board's words for the partner (`outbox`) and the
 * partner's current task (`task`, null unless it is at work); and what its window shows: the context (`text`), the
 * options, the advice and the title of its step.
 */
export function withPartnerOf(work, { names = [], prefix = '', outbox = [], task = null } = {}) {
  const nameOf = nameFinder(names, prefix)
  const items = new Map(itemsOf(work).map(item => [valueOf(item, 'Id'), item]))
  return asksOfStore(work).filter(isRoutedToPartner).map(item => {
    const at = askFiledMs(item)
    const id = valueOf(item, 'Id')
    const of = valueOf(item, 'Of')
    const step = of === null ? undefined : items.get(of)
    const advice = valueOf(item, 'Advice')
    return {
      id, from: valueOf(item, 'Owner') === null ? null : nameOf(valueOf(item, 'Owner')), title: valueOf(item, 'Title') ?? '', of, at: Number.isFinite(at) ? at : null,
      ofTitle: step === undefined ? null : valueOf(step, 'Title'), text: askPartsOf(item).context.join('\n'), advice,
      options: (valueOf(item, 'Options') ?? '').split(' | ').filter(one => one.trim() !== '').map(label => ({ label, isRecommended: isAdvised(label, advice) })),
      stand: partnerAskStand({ id, filed: at, outbox, task }),
    }
  }).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

/**
 * Partner answers, the review's findings: the partner's answers of the last 7 days that the Focus page's note does not
 * show (`shownNote`, its id; null: none shows), for "Decided for you" under Needs your attention, each with its Undo:
 * `[{ ask, line, from, at }]`, newest first. So no Undo is lost while its answer is less than 7 days old.
 */
export function partnerDecidedOf(work, { now, shownNote = null, names = [], prefix = '' }) {
  const nameOf = owner => names.find(name => plainName(name, prefix) === plainName(owner, prefix)) ?? owner
  return asksOfStore(work).filter(item => isPartnerAnswered(item) && (shownNote === null || valueOf(item, 'Daily note') !== shownNote)).flatMap(item => {
    const at = sinceMs(valueOf(item, 'Since'))
    if (!Number.isFinite(at) || now - at >= TAKE_BACK_MS) return []
    const id = valueOf(item, 'Id')
    const line = (item.sections.get(NOTE_LINE) ?? [])[0] ?? `${id}: ${valueOf(item, 'Title') ?? ''} → ${(item.sections.get('Answer') ?? []).join(' ')}`
    return [{ ask: id, line, from: valueOf(item, 'Owner') === null ? null : nameOf(valueOf(item, 'Owner')), at }]
  }).sort((a, b) => b.at - a.at || b.ask.localeCompare(a.ask, 'en', { numeric: true }))
}

/**
 * B299: the Information list: notes and reports, one line each, newest first; the read ones of the last day after the
 * unread. Nothing here waits for the person. B360: a recap has its own card in Needs your attention (recap.mjs), not a line.
 */
export function informationOf(work, now) {
  return itemsOf(work).filter(item => valueOf(item, 'Kind') === 'note' && !isRecap(item)).map(item => {
    const since = sinceMs(valueOf(item, 'Since'))
    const words = textOf(item)
    return {
      id: valueOf(item, 'Id'), from: valueOf(item, 'From'), to: valueOf(item, 'To'), text: words.length > 0 ? words.join(' ') : valueOf(item, 'Text') ?? '',
      about: (item.sections.get('About') ?? [])[0] ?? null, since: Number.isFinite(since) ? since : null, isRead: valueOf(item, 'State') === 'read',
      // The supervisor: a note of the board's about an incident (Via supervisor) is a line under Needs your attention too.
      via: valueOf(item, 'Via'),
    }
  }).filter(one => !one.isRead || (one.since !== null && now - one.since < DAY))
    .sort((a, b) => Number(a.isRead) - Number(b.isRead) || (b.since ?? 0) - (a.since ?? 0) || b.id.localeCompare(a.id, 'en', { numeric: true }))
}
