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
