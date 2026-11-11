// Drop asks go to the person (chat 1's brief "drop-asks-to-person", 2026-11-11). The live case: Q733 "Drop B1011, B978 and B934
// now?" (a decide with no options or pictures) was routed to its advice, Autopilot took "yes" within a second, the person never saw
// it and the main chat dropped three steps on it. A drop cannot be undone. The person's two standing words:
// - "no attention for store bookkeeping": the main chat drops a step that is superseded or was built elsewhere itself, with a why,
//   and asks nobody (roles/main.md; the drop's answer says so);
// - a drop of real planned work is the person's call: an ask whose title, text or options ask to drop or remove a step or a goal
//   is routed to the person and never answered by Autopilot (`autopilotRoute`, on its first pass and on every pass after).
// One matcher, sentence by sentence as src/work/landingAsk.mjs reads: "drop" or "remove" as a verb on a step or goal id (or on
// "this step", "the goal", ...), never "drop" in the game's words ("drops of lava", "the drop zone", "a drop shadow").

import { valueOf } from './item.mjs'

/** The route's why. */
export const DROP_ROUTE_WHY = 'a drop of a step or goal is the person\'s call: never Autopilot\'s'
/** What the main chat's own drop answers (the person: "no attention for store bookkeeping"). */
export const BOOKKEEPING_DROP_WORDS = 'Dropped. A step that is superseded or was built elsewhere is store bookkeeping: drop it yourself with a why, ask nobody. A drop of planned work is the person\'s call: ask them (the board never lets Autopilot answer it).'

/** The verb, as an ask or an order says it: never a past "dropped" (a fact), never the noun ("a drop of", "the drop zone"). */
const VERB = String.raw`\b(?:drop(?:ping)?|remov(?:e|ing))\b`
/** Words that may stand between the verb and what it drops: "drop the step B12", "remove both goals G3 and G4", "drop all three". */
const BETWEEN = String.raw`(?:\s+(?:the|this|that|these|those|both|all|three|two|four|its|their|step|steps|goal|goals|task|tasks|now|also|then|too|of))*`
/** What is dropped: a step or goal id, or "this step", "the goals", "it" (an ask under a step: "Drop it?"). */
const OBJECT = String.raw`\s+(?:[BG]\d+\b|(?:it|them)\b(?=\s*(?:[?.!|]|$|\s+(?:now|too|instead|from the (?:backlog|board|plan)))))`
const OF_STEP = String.raw`\s+(?:the|this|that|these|those|both)\s+(?:steps?|goals?|tasks?)\b`
const DROPS = new RegExp(`${VERB}(?:${BETWEEN}${OBJECT}|${OF_STEP})`, 'i')

const SENTENCES = /[^.?!|]+[.?!|]?/g
const DOT = '\u0000'
const hideDots = words => words.replace(/(\d)\.(?=\d)/g, `$1${DOT}`)
const showDots = words => words.replaceAll(DOT, '.')

/**
 * Whether an ask's words (its title, text and options) ask to drop or remove a step or a goal: the sentence that does, or null.
 * Each sentence (also each option, split at `|`) is judged on its own.
 */
export function dropAskOf(words) {
  const sentences = (hideDots(String(words ?? '').replace(/\s+/g, ' ')).match(SENTENCES) ?? []).map(showDots)
  for (const sentence of sentences) if (DROPS.test(sentence)) return sentence.trim()
  return null
}

/** The same, for a filed ask (its Title, Text and Options). */
export const dropAskOfItem = item => dropAskOf([valueOf(item, 'Title') ?? '', ...(item?.sections?.get('Text') ?? []), valueOf(item, 'Options') ?? ''].join(' '))
