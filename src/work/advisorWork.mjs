// The Advisor's waiting work, for the person to see where each item is (2026-10-26: "is the advisor currently working on
// them or not. is it in its queue?"): the refines and the questions it answers for the person first, each with where it
// stands (`workStand`: in its queue since HH:MM, or the Advisor is on it), and the one item it is on now, named by the board's
// word that it took. From facts only: the board's words to the Advisor with their outbox states, the store's items, the
// Advisor's current task. Where the board cannot tell, it says queued (the item is open and waits), never "on it".
// T9.1.1 (the person, 2026-10-27): the result checks are no longer the Advisor's: each is a Quality Assurance task a worker does
// (qaTask.mjs); where one stands is read from the task (state.mjs, the step's `reviewStand`), not from here.

import { valueOf } from './item.mjs'
import { isPartnerAskWord, workStand } from './partnerAnswers.mjs'
// T9.4: and the sync check's words that ask again about a refine or an incident (repair rules refine-again, incident-again).
const isRefineWord = message => message?.command === 'refine' || String(message?.syncKey ?? '').startsWith('refine-again ')
const isIncidentWord = message => message?.command === 'incident' || String(message?.syncKey ?? '').startsWith('incident-again ')
/** What a word of the board to the Advisor is about, by the kind of item in `waiting` (`question`, `refine`) or `incident`; null for any other word. */
const kindOfWord = message => (isPartnerAskWord(message) ? 'question' : isRefineWord(message) ? 'refine' : isIncidentWord(message) ? 'incident' : null)
const isTaken = message => message.state === 'taken' || message.state === 'delivered'
const takenAt = message => message.takenAt ?? message.deliveredAt ?? message.at
const isOpenIncident = item => item !== undefined && valueOf(item, 'Kind') === 'incident' && !['fixed', 'closed'].includes(valueOf(item, 'State'))

/**
 * `{ waiting, on }`:
 * - `waiting`: `[{ kind, id, title, who, stand }]`, what waits for the Advisor, the items it is on first, then by when they
 *   began to wait. `kind` 'question' (from `questions`, the state's `withPartner`, each with its own stand), 'refine' (from
 *   `refines`, `[{ id, title, word }]`: the steps whose refine the board asked and the Advisor has not written, with that word).
 *   No result checks (T9.1.1): those are Quality Assurance tasks.
 * - `on`: `{ kind, id, title, since }` for the newest board word to the Advisor that it took (taken or typed) whose item is
 *   still open (an incident not fixed or closed; a refine or question in `waiting`); null when there is none.
 * `items` the store's items by id (an incident's state), `outbox` the board's words,
 * `task` the Advisor's current task while it works (null otherwise), `isWorking` whether it works.
 */
export function advisorWorkOf({ items = new Map(), outbox = [], task = null, isWorking = true, questions = [], refines = [] }) {
  const waiting = questions.map(one => ({ kind: 'question', id: one.id, title: one.title ?? '', who: one.from ?? null, stand: one.stand }))
  for (const one of refines) waiting.push({ kind: 'refine', id: one.id, title: one.title ?? '', who: null, stand: workStand({ id: one.id, words: [one.word], task, queuedSince: one.word?.at, isWorking }) })
  waiting.sort((a, b) => Number(b.stand.kind === 'working') - Number(a.stand.kind === 'working')
    || (a.stand.since ?? Infinity) - (b.stand.since ?? Infinity) || a.id.localeCompare(b.id, 'en', { numeric: true }))

  const open = new Map(waiting.map(one => [`${one.kind}:${one.id}`, one]))
  const candidates = outbox.filter(message => isTaken(message) && kindOfWord(message) !== null).flatMap(message => {
    const kind = kindOfWord(message)
    const item = kind === 'incident' ? (isOpenIncident(items.get(message.about)) ? { id: message.about, title: valueOf(items.get(message.about), 'Title') ?? '' } : undefined) : open.get(`${kind}:${message.about}`)
    return item === undefined ? [] : [{ kind, id: item.id, title: item.title ?? '', since: takenAt(message) }]
  }).sort((a, b) => (b.since ?? 0) - (a.since ?? 0) || a.id.localeCompare(b.id, 'en', { numeric: true }))
  return { waiting, on: candidates[0] ?? null }
}

// ---- what is next for it ----
// The person, 2026-10-28, about the Advisor's card: "it's not clear what else will be picked up from the refinement. i see B774 is
// waiting for B774 which is also confusing. i cant click on the 5 waiting for it and get an expand of what those 5 are". The card's
// "Next for it (N)" opens the whole queue in pick-up order, one row each: the board's open words to it (the questions it answers
// first and the refines it was asked, as in `waiting`; incidents, goal evaluations and any other word), oldest first, then the steps
// the board will ask it to refine next (refineGate.mjs `refineQueue`, added by `withRefineQueue`). The item it is on stands in none.

const ITEM_ID = /^[BQIXG]\d+$/
/** The states of a store item that say a word about it is stale, by its kind (a step without a Kind is a step). */
const ENDED = { incident: ['fixed', 'closed'], step: ['done', 'dropped'], ask: ['answered', 'withdrawn'], instruction: ['closed'] }
const isEnded = item => item !== undefined && (ENDED[valueOf(item, 'Kind') ?? 'step'] ?? []).includes(valueOf(item, 'State'))
/** A word of the board's clock (a round, a re-check): no row, only counted. */
const isRoundWord = message => message.command === 'round' || message.command === 'recheck'
/** The longest a row's title is when it comes from a word's own text. */
const TITLE_CHARS = 100

/** The text of the word's first line without what the board put before it ("incident: X104 ", "evaluate G61 "), cut at TITLE_CHARS. */
function titleOfWord(message, id) {
  const first = String(message.text ?? '').split('\n')[0].replace(/\s+/g, ' ').trim()
  const line = [message.command, id].reduce((rest, head) => (typeof head === 'string' && rest.toLowerCase().startsWith(head.toLowerCase()) && /^(?![\w-])/.test(rest.slice(head.length))
    ? rest.slice(head.length).replace(/^[:\s]+/, '') : rest), first)
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1).trimEnd()}…` : line
}

/** `{ kind, id, title, who, stand }` rows of `list` without the item it is on (the same kind and id). */
export const leaveOut = (list, on) => (on === null || on === undefined ? list : list.filter(one => !(one.kind === on.kind && one.id === on.id)))

/**
 * The Advisor's whole queue, `[{ kind, id, title, who, stand }]` in pick-up order: the items of `waiting` (questions and refines,
 * as `advisorWorkOf` gives them) and the board's other open words to it (`words`: `waiting`, or taken lately, as state.mjs
 * `isOpenWord` says), by when each began to wait (or was taken), oldest first. A word's `kind` is what it is about (`incident`,
 * `evaluate`) or its command, else `message`; its `id` the item it is about when that looks like an item's id (B12, Q3, I4, X5,
 * G6), else null; its title the store item's, else the first line of its text. The same kind and id twice (a goal's evaluation
 * asked again) is one row; the item it is on (`on`) and what is stale (an incident fixed or closed, a step done or dropped, by the
 * store's State) are left out. Rounds of the clock have no row; the words of `waiting`'s own kinds are in `waiting`. `task` and
 * `isWorking` as for `advisorWorkOf` (a word's stand).
 */
export function advisorNextOf({ waiting = [], on = null, words = [], items = new Map(), task = null, isWorking = true }) {
  const rows = waiting.map(one => ({ kind: one.kind, id: one.id, title: one.title ?? '', who: one.who ?? null, stand: one.stand }))
  const groups = new Map()
  for (const message of words) {
    if (isRoundWord(message) || ['question', 'refine'].includes(kindOfWord(message))) continue
    const id = ITEM_ID.test(String(message.about ?? '')) ? message.about : null
    const kind = kindOfWord(message) ?? (message.command === 'evaluate' ? 'evaluate' : message.command ?? 'message')
    const key = id === null ? `${kind}#${groups.size}` : `${kind}:${id}`
    groups.set(key, { kind, id, words: [...(groups.get(key)?.words ?? []), message] })
  }
  for (const { kind, id, words: group } of groups.values()) {
    const first = group.reduce((one, other) => (other.at < one.at ? other : one))
    const item = id === null ? undefined : items.get(id)
    const title = (item === undefined ? null : valueOf(item, 'Title')) ?? titleOfWord(first, id)
    rows.push({ kind, id, title, who: null, stand: workStand({ id: id ?? '', words: group, task, queuedSince: first.at, isWorking }) })
  }
  const since = one => (Number.isFinite(one.stand?.since) ? one.stand.since : Infinity)
  return leaveOut(rows, on).filter(one => !isEnded(items.get(one.id)))
    .sort((a, b) => since(a) - since(b) || String(a.id ?? '').localeCompare(String(b.id ?? ''), 'en', { numeric: true }) || a.kind.localeCompare(b.kind))
}

/**
 * `next` and the steps the board asks the Advisor to refine after them (`queue`, refineGate.mjs `refineQueue`): a row each,
 * "next to refine", unless the id is in `next` already or is the item it is on (`on`).
 */
export function withRefineQueue(next, queue, on = null) {
  const seen = new Set(next.map(one => one.id).filter(Boolean))
  if (on !== null && on !== undefined) seen.add(on.id)
  const rows = []
  for (const { step, why } of queue) {
    if (seen.has(step.id)) continue
    seen.add(step.id)
    rows.push({ kind: 'refine', id: step.id, title: step.title ?? '', who: null, stand: { kind: 'next', since: null }, why })
  }
  return [...next, ...rows]
}
