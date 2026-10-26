// The Advisor's waiting work, for the person to see where each item is (2026-10-26: "is the advisor currently working on
// them or not. is it in its queue?"): the result checks, the refines and the questions it answers for the person first,
// each with where it stands (`workStand`: in its queue since HH:MM, or the Advisor is on it), and the one item it is on
// now, named by the board's word that it took. From facts only: the board's words to the Advisor with their outbox
// states, the store's items, the Advisor's current task. Where the board cannot tell, it says queued (the item is open and
// waits), never "on it".

import { valueOf } from './item.mjs'
import { isPartnerAskWord, workStand } from './partnerAnswers.mjs'
import { reviewWaitOf } from './resultCheck.mjs'

/** The board's word that asks for a step's result check, or the sync check's `unchecked` word for the same ask. */
export const isCheckWord = message => message?.command === 'result-check' || String(message?.syncKey ?? '').startsWith('unchecked ')
const isRefineWord = message => message?.command === 'refine'
const isIncidentWord = message => message?.command === 'incident'
/** What a word of the board to the Advisor is about, by the kind of item in `waiting` (`question`, `check`, `refine`) or `incident`; null for any other word. */
const kindOfWord = message => (isPartnerAskWord(message) ? 'question' : isCheckWord(message) ? 'check' : isRefineWord(message) ? 'refine' : isIncidentWord(message) ? 'incident' : null)
const isTaken = message => message.state === 'taken' || message.state === 'delivered'
const takenAt = message => message.takenAt ?? message.deliveredAt ?? message.at
const isOpenIncident = item => item !== undefined && valueOf(item, 'Kind') === 'incident' && !['fixed', 'closed'].includes(valueOf(item, 'State'))

/**
 * `{ waiting, on }`:
 * - `waiting`: `[{ kind, id, title, who, stand }]`, what waits for the Advisor, the items it is on first, then by when they
 *   began to wait. `kind` 'question' (from `questions`, the state's `withPartner`, each with its own stand), 'check' (a step
 *   in the store in review that waits for its result check; `who` its builder), 'refine' (from `refines`, `[{ id, title,
 *   word }]`: the steps whose refine the board asked and the Advisor has not written, with that word).
 * - `on`: `{ kind, id, title, since }` for the newest board word to the Advisor that it took (taken or typed) whose item is
 *   still open (an incident not fixed or closed; a check, refine or question in `waiting`); null when there is none.
 * `items` the store's items by id, `held` the ready list's held steps (for `reviewWaitOf`), `outbox` the board's words,
 * `task` the Advisor's current task while it works (null otherwise), `titleOf(id)` a step's title, `nameOf(owner)` a chat's name.
 */
export function advisorWorkOf({ items = new Map(), held = null, outbox = [], task = null, questions = [], refines = [], titleOf = () => null, nameOf = name => name }) {
  const waiting = questions.map(one => ({ kind: 'question', id: one.id, title: one.title ?? '', who: one.from ?? null, stand: one.stand }))
  for (const item of items.values()) {
    if (valueOf(item, 'Kind') !== 'step' || valueOf(item, 'State') !== 'review') continue
    const wait = reviewWaitOf(item, items, held)
    if (wait?.kind !== 'check') continue
    const id = valueOf(item, 'Id')
    // Only the words of this wait: a word of an earlier round (before the board's check passed, or before the fix was done) is not.
    const from = Number.isFinite(wait.since) ? wait.since : -Infinity
    const words = outbox.filter(message => isCheckWord(message) && message.about === id && (message.at ?? 0) >= from)
    const waits = words.filter(message => message.state === 'waiting').map(message => message.at).filter(Number.isFinite)
    const owner = valueOf(item, 'Owner')
    waiting.push({
      kind: 'check', id, title: titleOf(id) ?? valueOf(item, 'Title') ?? '', who: owner === null ? null : nameOf(owner),
      stand: workStand({ id, words, task, queuedSince: waits.length > 0 ? Math.min(...waits) : wait.since }),
    })
  }
  for (const one of refines) waiting.push({ kind: 'refine', id: one.id, title: one.title ?? '', who: null, stand: workStand({ id: one.id, words: [one.word], task, queuedSince: one.word?.at }) })
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
