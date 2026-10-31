// One question per task (the person, 2026-10-31: "why did i get asked the same question twice"; Q550 and Q551 were one
// decision about B674, asked by the chat that built it and by the chat that checked it). Where an ask of a chat stands when
// it names no step (`stepOfAsk`), and the open ask of the person a new one joins instead of a second card (`joinTarget`).
// PURE: the items and the held steps come in; nothing is read or written here.

import { askTokens, overlapOf } from './askRepeat.mjs'
import { isQaTask } from './qaTask.mjs'
import { valueOf } from './item.mjs'
import { isRoutedToPartner } from './partnerAnswers.mjs'

const STEP_ID = /(?<![\w-])B\d{1,6}(?![\w-])/g
const GOAL_ID = /(?<![\w-])G\d{1,6}(?![\w-])/g
/** The fewest meaningful title words an ask shares with a step to name it by words alone. */
const FEWEST_TITLE_WORDS = 2

/** The step a held item stands for: a Quality Assurance task stands for the step it checks (when the store holds it). */
export function standsFor(item, items) {
  const checks = isQaTask(item) ? valueOf(item, 'Checks') : null
  return checks !== null && valueOf(items.get(checks) ?? { head: new Map() }, 'Kind') === 'step' ? checks : valueOf(item, 'Id')
}

/**
 * The step an ask names no step for stands under, or null. `mine`: the steps the chat holds (taken, in progress, waiting on
 * you or in review); `words`: the ask's title and text; `cardStep`: the step the chat's card names at that moment. In this
 * order: (a) a held step whose id the words name (a Quality Assurance task by its own id or the checked step's), when only
 * one does; (b) a held step the words name by its goal id or by two of its title's words, when only one does; (c) the
 * card's step, when the chat holds it; (d) the chat's one step in progress, else its one held step.
 */
export function stepOfAsk({ items, mine, words, cardStep = null }) {
  if (mine.length === 0) return null
  const held = []
  for (const item of mine) {
    const id = standsFor(item, items)
    const one = held.find(other => other.id === id)
    if (one === undefined) held.push({ id, ids: new Set([valueOf(item, 'Id'), id]), working: valueOf(item, 'State') === 'in progress' })
    else {
      one.ids.add(valueOf(item, 'Id'))
      one.working ||= valueOf(item, 'State') === 'in progress'
    }
  }
  const text = Array.isArray(words) ? words.join(' ') : String(words ?? '')
  const named = new Set(text.match(STEP_ID) ?? [])
  const byId = held.filter(one => [...one.ids].some(id => named.has(id)))
  if (byId.length === 1) return byId[0].id
  if (byId.length === 0) {
    const goals = new Set(text.match(GOAL_ID) ?? [])
    const asked = askTokens(text)
    const byWords = held.filter(one => {
      const step = items.get(one.id)
      if (step === undefined) return false
      if (goals.size > 0 && goals.has(valueOf(step, 'Goal') ?? '')) return true
      let shared = 0
      for (const word of askTokens(valueOf(step, 'Title') ?? '')) if (asked.has(word)) shared += 1
      return shared >= FEWEST_TITLE_WORDS
    })
    if (byWords.length === 1) return byWords[0].id
  }
  const onCard = cardStep === null ? undefined : held.find(one => one.ids.has(cardStep))
  if (onCard !== undefined) return onCard.id
  const working = held.filter(one => one.working)
  if (working.length === 1) return working[0].id
  return held.length === 1 ? held[0].id : null
}

/**
 * The open ask of the person under a step that a new ask from another chat joins: the oldest open one of another chat that
 * is the person's (not the partner's first, not the app's question form, which stands in a chat), or undefined.
 * `kind` of the new ask: a do (an action to tick) joins only a do; `anyKind` lifts that (the quality check's line).
 */
export function joinTarget(items, stepId, { who, kind, anyKind = false, isMine }) {
  const open = [...items.values()].filter(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'State') === 'open' && valueOf(one, 'Of') === stepId
    && !isRoutedToPartner(one) && valueOf(one, 'Via') !== 'form' && !isMine(one, who))
  const fits = open.filter(one => anyKind || (valueOf(one, 'Asks') === 'do') === (kind === 'do'))
  return fits.sort((a, b) => String(valueOf(a, 'Id')).localeCompare(String(valueOf(b, 'Id')), 'en', { numeric: true }))[0]
}

/** Whether two questions are one: the second is no news to the person once the first stands. */
export const isAlike = (a, b, at) => overlapOf(a, b) >= at
