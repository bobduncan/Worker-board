// Partner answers (the person, 2026-10-19): "detail questions go to your partner first; the partner answers them,
// taking the worker's advice, and lists each answer in its daily note with an Undo; questions only you can answer
// still come to you; work keeps moving and you keep the last word". The person chose this over a blanket
// auto-approve, which this project will not build.
//
// The setting lives in the store's folder (`partner-answers.json`, `{ on, since }`), switched on the Focus page; it is
// on unless the person switched it off (they gave it priority). While it is on, an ask filed with the work tool by a
// worker or the main chat (not the partner, not the app's question form) of kind decide or look that carries options
// or advice gets `Route: partner`: it stands not under Needs your attention, the board wakes the partner for it, and
// the partner answers it (`partner-answer`) or hands it to the person (`escalate`, `Route: person`). The person's Undo
// opens it again for them.

import { valueOf } from './item.mjs'

export const PARTNER_FILE = 'partner-answers.json'
/** How long the partner may be free with a routed ask before the board hands it to the person by itself. */
export const PARTNER_ANSWER_MS = 30 * 60_000
/** B392: a routed ask open this long wakes the partner once more, so none sits unseen. */
export const PARTNER_AGAIN_MS = 10 * 60_000

/** `partner-answers.json` read: `{ on, since? }`; missing or unreadable is on (the person's choice of 2026-10-19). */
export function parsePartnerAnswers(text) {
  if (typeof text !== 'string') return { on: true }
  try {
    const raw = JSON.parse(text)
    if (typeof raw?.on !== 'boolean') return { on: true }
    return Number.isFinite(raw.since) ? { on: raw.on, since: raw.since } : { on: raw.on }
  } catch {
    return { on: true }
  }
}

/** Whether a new ask goes to the partner first: the setting on, asked by a worker or the main chat with the work tool, a decide or look with options or advice. */
export function routesToPartner({ setting, role, kind, options = [], advice = '', via = null }) {
  if (setting?.on === false) return false
  if (!['worker', 'main'].includes(role) || via !== null) return false
  return ['decide', 'look'].includes(kind) && (options.length > 0 || advice !== '')
}

/** Whether the ask waits for the partner's answer now. */
export const isRoutedToPartner = item => valueOf(item, 'Kind') === 'ask' && valueOf(item, 'State') === 'open' && valueOf(item, 'Route') === 'partner'
/**
 * B392 (the person, 2026-10-19: "it says worker 6 is waiting for me but i dont see it"): the ids of the step's open
 * blocking asks when every one of them waits for the partner's answer, else null. Such a step waits for the partner,
 * not for the person; it is the person's once the partner hands an ask on (Route: person). `items` any iterable.
 */
export function partnerWaitOf(stepId, items) {
  const open = [...(items ?? [])].filter(item => valueOf(item, 'Kind') === 'ask' && valueOf(item, 'State') === 'open' && valueOf(item, 'Of') === stepId && valueOf(item, 'Blocking') === 'yes')
  return open.length > 0 && open.every(isRoutedToPartner) ? open.map(item => valueOf(item, 'Id')) : null
}

/** Whether the partner answered the ask (and the person has not taken it back). */
export const isPartnerAnswered = item => valueOf(item, 'Kind') === 'ask' && valueOf(item, 'State') === 'answered' && valueOf(item, 'Answered by') === 'partner'

/** The words the board wakes the partner with, once per routed ask. */
export const partnerAskWords = id => `work: ${id} is yours to answer for the person; run work next`
/** The one line the asking chat gets when the person takes the partner's answer back. */
export const takenBackWords = id => `The person took back the partner's answer on ${id}; wait for their answer.`

/**
 * The review's findings: the line an answer stands under in the partner's note is kept on the ask (`## Note line`), with
 * the note's id (`Daily note`): the board finds the ask of a line by these fields, never by the line's words.
 */
export const NOTE_LINE = 'Note line'
/** How long the person may take a partner's answer back: its card keeps the Undo for 7 days. */
export const TAKE_BACK_MS = 7 * 24 * 60 * 60_000
