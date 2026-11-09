// B298, B299: what the board shows from the work store (spec 2026-10-17, section 8): the person's instructions per chat
// (Open instructions), the asks (Needs your attention) and the notes (Information). Built from the items' fields
// alone, never from a chat's words.

import { sinceMs } from './api.mjs'
import { askKey, askPartsOf, askWordsOf } from './askWords.mjs'
import { repeatFactsOf } from './askRepeat.mjs'
import { askFiledMs, valueOf } from './item.mjs'
import { itemsOf } from './read.mjs'
import { NOTE_LINE, PARTNER_ANSWER_MS, TAKE_BACK_MS, isDecidedForYou, isRoutedToPartner, partnerAskStand } from './partnerAnswers.mjs'
import { TOOK_ADVICE, autopilotRoute, formHandsOf, routedAt, standsForPerson } from './autopilot.mjs'
import { isKeptLook } from './keptLook.mjs'
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
/**
 * The wait line (T22, the review of 2026-11-02, 1): an answered ask stays in the list while its word's line is not Done or
 * answered, up to this long (src/waitLine.mjs WAITS_KEPT_MS); the ten minutes count from that Done or answer, or from the
 * answer itself for an ask with no word to a chat (or one whose word is closed, copied to paste, or expired: no line).
 */
const KEEP_FOR_LINE_MS = 24 * 60 * 60_000
const NO_LINE = ['dropped', 'copied', 'expired', 'stopped']
/** How long an answered ask stays in the list, from when: `{ from, ms }`. */
function answeredKept(answer, since) {
  const end = [answer?.doneAt, answer?.answeredAt].find(Number.isFinite)
  if (answer === null || answer === undefined || !Number.isFinite(answer.at) || NO_LINE.includes(answer.state)) return { from: since, ms: KEEP_ANSWERED_MS }
  return end !== undefined ? { from: end, ms: KEEP_ANSWERED_MS } : { from: answer.at, ms: KEEP_FOR_LINE_MS }
}
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
  // Rule 15: an ask held for the person's words (Route asker) asks nobody and blocks nobody.
  const forYou = open.filter(item => valueOf(item, 'Via') !== 'refine' && !isRoutedToPartner(item) && valueOf(item, 'Route') !== 'asker')
    .sort((a, b) => Number(valueOf(a, 'Id').slice(1)) - Number(valueOf(b, 'Id').slice(1)))
  for (const item of open.filter(one => valueOf(one, 'Blocking') === 'yes' && isRoutedToPartner(one))) {
    const name = plainName(valueOf(item, 'Owner'), prefix)
    forPartner.set(name, [...(forPartner.get(name) ?? []), valueOf(item, 'Id')])
  }
  return {
    blocking: new Set(open.filter(item => valueOf(item, 'Blocking') === 'yes' && !isRoutedToPartner(item) && valueOf(item, 'Route') !== 'asker').map(item => plainName(valueOf(item, 'Owner'), prefix))),
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
export function storeNeeds(work, { now, names = [], prefix = '', answerOf = () => ({ answer: null, earlier: null }), autopilot = false, roleOf = () => null, focusGoal = null, focusHasDemo = false, recapSteps = [] }) {
  const items = new Map(itemsOf(work).map(item => [valueOf(item, 'Id'), item]))
  const nameOf = owner => names.find(name => plainName(name, prefix) === plainName(owner, prefix)) ?? owner
  return asksOfStore(work).flatMap(item => {
    const state = valueOf(item, 'State')
    const since = sinceMs(valueOf(item, 'Since'))
    // Autopilot (2026-10-31): an answer decided for the person (the partner's, the board's taken advice, the main chat's).
    const byPartner = isDecidedForYou(item)
    // Autopilot: an open ask routed away from the person (partner, advice, recap, main) stands nowhere here; while Autopilot is
    // on, neither one the board routes away at its next refresh (autopilot.mjs `standsForPerson`).
    if (state === 'open' && !standsForPerson(item, { autopilot, now, items, roleOf, focusGoal, focusHasDemo, recapSteps, prefix })) return []
    const id = valueOf(item, 'Id')
    const owner = valueOf(item, 'Owner')
    // The review of 2026-11-02 (7): the answer's word to the chat that asked.
    const known = answerOf(`work:${id}`, owner === null ? null : nameOf(owner))
    // The review's findings: a partner's answer keeps its card (and its Undo) for 7 days. T22: the person's while its line waits.
    const kept = byPartner ? { from: since, ms: TAKE_BACK_MS } : answeredKept(known.answer, since)
    if (state !== 'open' && !(state === 'answered' && Number.isFinite(kept.from) && now - kept.from < kept.ms)) return []
    const asks = valueOf(item, 'Asks') ?? 'decide'
    const of = valueOf(item, 'Of')
    const step = of === null ? undefined : items.get(of)
    const advice = valueOf(item, 'Advice')
    const via = valueOf(item, 'Via')
    const blocking = valueOf(item, 'Blocking') === 'yes'
    // B452: the title the card and the window lead with, and the context under it (an old ask's long line split).
    const { title, context } = askPartsOf(item)
    // Answered with nobody to wake (or before the board kept it): the answer as the store holds it.
    const stored = { at: since, verdict: null, text: (item.sections.get('Answer') ?? []).join(' '), state: 'delivered', takenAt: null, deliveredAt: since }
    const why = byPartner ? (item.sections.get('Why') ?? []).join(' ').trim() || null : null
    // Partner answers: the partner's answer as the store holds it, with where its word to the chat is.
    // Autopilot noise (the person's "Yes, clear them", 2026-11-04): a decided answer carries its word's id so that its wait line stays
    // reachable from the ask's own window, but it is never a slim "Answered" card of Needs your attention: only the person's own
    // answer (no `Answered by`, or `person`) stands there while its line waits (the page's `slim`).
    const answer = byPartner ? { ...stored, ...(known.answer === null ? {} : { id: known.answer.id ?? null, state: known.answer.state, takenAt: known.answer.takenAt ?? null, deliveredAt: known.answer.deliveredAt ?? since }), by: valueOf(item, 'Answered by'), why }
      : (a => (a !== null && valueOf(item, 'Answered by') === 'recap' ? { ...a, by: 'recap' } : a))(known.answer ?? (state === 'open' ? null : stored))
    const routeNote = (item.sections.get('Route') ?? []).join(' ').trim()
    // Autopilot v2 (the person's "B", 2026-11-02): an open ask only the person's hands can do (and nobody handed on) is no card but
    // a part of the one quiet line "Needs your hands" (`hands`: what of the hands it needs, autopilot.mjs PERSONS_HANDS).
    const hands = autopilot && state === 'open' ? autopilotRoute(item, { roleOf, items, focusGoal, focusHasDemo, recapSteps, prefix, again: true }).hands ?? null : null
    // T20.1 (the live Q629 and Q632): the app's form stands in that line too, with its own words ("Worker 5's chat waits on a popup: change directory").
    const handsWords = hands === null ? null : formHandsOf(item, owner === null ? null : nameOf(owner))?.words ?? null
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
      route: valueOf(item, 'Route'), routeNote: routeNote === '' ? null : routeNote, canTakeBack: byPartner, hands, handsWords,
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
export function withPartnerOf(work, { names = [], prefix = '', outbox = [], task = null, isWorking = true } = {}) {
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
      stand: partnerAskStand({ id, filed: at, outbox, task, isWorking }),
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
  return asksOfStore(work).filter(item => isDecidedForYou(item) && (shownNote === null || valueOf(item, 'Daily note') !== shownNote)).flatMap(item => {
    const at = sinceMs(valueOf(item, 'Since'))
    if (!Number.isFinite(at) || now - at >= TAKE_BACK_MS) return []
    const id = valueOf(item, 'Id')
    const line = (item.sections.get(NOTE_LINE) ?? [])[0] ?? `${id}: ${valueOf(item, 'Title') ?? ''} → ${(item.sections.get('Answer') ?? []).join(' ')}`
    return [{ ask: id, line, from: valueOf(item, 'Owner') === null ? null : nameOf(valueOf(item, 'Owner')), at, by: valueOf(item, 'Answered by') }]
  }).sort((a, b) => b.at - a.at || b.ask.localeCompare(a.ask, 'en', { numeric: true }))
}

const PLAY_OF = item => (item?.sections?.get('Play') ?? []).map(one => one.trim()).find(one => one !== '') ?? null
const ASK_LINK = /#details=(Q\d+)/g
/** The play setting of an ask (`## Play`: "main&arena=ring"), else of the first ask its words link that has one; null for none. */
function playOfAsk(item, items) {
  const own = PLAY_OF(item)
  if (own !== null) return own
  const words = `${valueOf(item, 'Title') ?? ''} ${(item.sections.get('Text') ?? []).join(' ')}`
  for (const found of words.matchAll(ASK_LINK)) {
    const linked = items.get(found[1])
    const play = linked === undefined || valueOf(linked, 'Id') === valueOf(item, 'Id') ? null : PLAY_OF(linked)
    if (play !== null) return play
  }
  return null
}

/** The title of an ask as a line says it: no trailing "(advice: yes)" and no final stop. */
const plainTitle = title => String(title ?? '').replace(/\s*\(advice: [^)]*\)\.?$/, '').replace(/\.$/, '').trim()

/**
 * B993 (the person, 2026-11-04: "I do not know what Q600 is about when i only look at the recap/demo"): the line that says what an ask is
 * about on its own: for each ask its words link, "About Q600: <its title> (<its step>)"; with no linked ask, "About <its step>: <the
 * step's title>"; "" when it names neither.
 */
function aboutOf(item, items, step) {
  const own = valueOf(item, 'Id')
  const words = `${valueOf(item, 'Title') ?? ''} ${(item.sections.get('Text') ?? []).join(' ')}`
  const linked = [...new Set([...words.matchAll(ASK_LINK)].map(found => found[1]))].filter(id => id !== own && items.has(id))
  if (linked.length > 0) {
    return linked.map(id => {
      const of = valueOf(items.get(id), 'Of')
      return `About ${id}: ${plainTitle(askPartsOf(items.get(id)).title)}${of === null ? '' : ` (${of})`}`
    }).join(' · ')
  }
  const of = valueOf(item, 'Of')
  return of === null ? '' : `About ${of}${step === undefined ? '' : `: ${plainTitle(valueOf(step, 'Title'))}`}`
}

/**
 * B993: any ask of the store by its id, whatever its state (an answered one has no card among the asks for you), as the plain card its
 * window shows: `{ id, route: 'ref', state, from, title, of, ofTitle, text, advice, options, pictures, play, at }`, or null for an id
 * the store does not hold. An answer stands in the text, after the question.
 */
export function askCardOf(work, id, { names = [], prefix = '' } = {}) {
  const items = new Map(itemsOf(work).map(item => [valueOf(item, 'Id'), item]))
  const item = items.get(String(id))
  if (item === undefined || valueOf(item, 'Kind') !== 'ask') return null
  const nameOf = nameFinder(names, prefix)
  const of = valueOf(item, 'Of')
  const step = of === null ? undefined : items.get(of)
  const advice = valueOf(item, 'Advice')
  const answer = (item.sections.get('Answer') ?? []).join('\n').trim()
  const at = askFiledMs(item)
  return {
    id: valueOf(item, 'Id'), route: 'ref', state: valueOf(item, 'State'), from: valueOf(item, 'Owner') === null ? null : nameOf(valueOf(item, 'Owner')),
    title: plainTitle(askPartsOf(item).title), of, ofTitle: step === undefined ? null : valueOf(step, 'Title'),
    text: [...askPartsOf(item).context, ...(answer === '' ? [] : [`The answer: ${answer.slice(0, 600)}`])].join('\n'), advice,
    options: (valueOf(item, 'Options') ?? '').split(' | ').filter(one => one.trim() !== '').map(label => ({ label, isRecommended: isAdvised(label, advice) })),
    pictures: (valueOf(item, 'Pictures') ?? '').split(',').map(one => one.trim()).filter(Boolean),
    play: PLAY_OF(item), at: Number.isFinite(at) ? at : null,
  }
}

/**
 * Autopilot (2026-10-31): the open asks the board routed to the main chat or to a goal's recap, for the window a click on
 * one opens (they stand in no list of Needs your attention) and the Focus page's "For your recap": `[{ id, route, from,
 * title, of, ofTitle, goal, text, advice, options, pictures, play, at, toYouAt, isKept }]`, oldest first. `isKept`: a look the partner handed over
 * that Autopilot keeps for the goal's recap (src/work/keptLook.mjs; the person's "A", 2026-11-02). `toYouAt`: when one routed to the
 * main chat comes to the person (the partner's 30 minutes from its route), else null.
 */
export function routedAwayOf(work, { names = [], prefix = '', limitMs = PARTNER_ANSWER_MS } = {}) {
  const nameOf = nameFinder(names, prefix)
  const items = new Map(itemsOf(work).map(item => [valueOf(item, 'Id'), item]))
  return asksOfStore(work).filter(item => valueOf(item, 'State') === 'open' && ['main', 'recap'].includes(valueOf(item, 'Route'))).map(item => {
    const id = valueOf(item, 'Id')
    const route = valueOf(item, 'Route')
    const of = valueOf(item, 'Of')
    const step = of === null ? undefined : items.get(of)
    const advice = valueOf(item, 'Advice')
    const at = askFiledMs(item)
    const routed = routedAt(item, route)
    return {
      id, route, asks: valueOf(item, 'Asks') ?? 'decide', isKept: isKeptLook(item), from: valueOf(item, 'Owner') === null ? null : nameOf(valueOf(item, 'Owner')), title: askPartsOf(item).title, of,
      ofTitle: step === undefined ? null : valueOf(step, 'Title'), goal: step === undefined ? null : valueOf(step, 'Goal'),
      text: askPartsOf(item).context.join('\n'), advice,
      options: (valueOf(item, 'Options') ?? '').split(' | ').filter(one => one.trim() !== '').map(label => ({ label, isRecommended: isAdvised(label, advice) })),
      pictures: (valueOf(item, 'Pictures') ?? '').split(',').map(one => one.trim()).filter(Boolean),
      // The review of 2026-11-04: the ask's own `## Play` (a map to open the game on), else the one of the ask its words link
      // (`#details=Q<n>`: Q616 "reopen the Q600 play link" carries Q600's), else null.
      play: playOfAsk(item, items),
      about: aboutOf(item, items, step),
      at: Number.isFinite(at) ? at : null, toYouAt: route === 'main' && Number.isFinite(routed) ? routed + limitMs : null,
    }
  }).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

/**
 * Autopilot (2026-10-31): how many asks were decided for the person today (the partner's answers, the board's taken advice,
 * the main chat's actions, and refine questions the board answered with their advice), for the quiet line on top of Needs
 * your attention. Taken back ones do not count.
 */
export function decidedTodayOf(work, now) {
  const today = new Date(now).toDateString()
  const isToday = ms => Number.isFinite(ms) && new Date(ms).toDateString() === today
  return asksOfStore(work).filter(item => {
    if (isDecidedForYou(item)) return isToday(sinceMs(valueOf(item, 'Since')))
    if (valueOf(item, 'Via') !== 'refine' || valueOf(item, 'State') !== 'answered') return false
    const last = (item.sections.get('History') ?? []).at(-1) ?? ''
    return last.includes(TOOK_ADVICE) && isToday(sinceMs(last.match(/^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d)/)?.[1]))
  }).length
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
