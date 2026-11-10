// No landing asks (chat 1's brief, the person's "Yes, build it", 2026-11-09): B1079 went live at 11:14 without chat 1's go or the
// person's yes, because Worker 5 asked Q701 "Put B1079's fix live on the board now?", Autopilot took its advice and the worker landed
// on that; B1071 ran the same way (Q686 to Q690). The rule stays: a step lands only on chat 1's go, after the person's own yes, which
// chat 1 asks for. So a chat never asks the person or Autopilot to land: the work API refuses such an ask (`ask`, 409, LANDING_ASK_WHY)
// and, in depth, Autopilot never answers one that was filed anyway (`autopilotRoute`: to the person). One matcher for both spots.

import { valueOf } from './item.mjs'

/** The refusal's words, and the route's why. */
export const LANDING_ASK_WHY = 'A landing goes on chat 1\'s go, after the person\'s yes, which chat 1 asks for. Do not ask the person or Autopilot: tell chat 1 (board dev) through a note to main (\'For chat 1: <step> ready to land, <branch> <hash>, gate <line>\'), record the wait: work block id=<step> on="chat 1" why="its go to land" (never only in a checkpoint), and land with tools/land.ps1 only on its go.'
export const LANDING_ROUTE_WHY = 'a landing goes on chat 1\'s go, after the person\'s own yes: never Autopilot\'s'

/**
 * The landing itself, said as a verb: "land it", "to land", "B1071 land once", "lands it", "go live", "put ... live", "merge main",
 * "merge ... to main". Never "landing" (a flight of stairs has one) and never the noun "land" (a tile, the ground): those words of the
 * game are left alone.
 */
const LANDS = /\b(?:to|may|can|could|should|shall|will|would|I|we|you|it|they|not|and|or|then)\s+land\b|\bland(?:s|ed)\b|\bland\s+(?:it|this|that|the|B\d+|now|once|when|after|before|on|to)\b|\bgo(?:es|ing)?\s+live\b|\bput(?:s|ting)?\b[^.?!|]*\blive\b|\bmerge[sd]?\b[^.?!|]*\bmain\b|\bmain\b[^.?!|]*\bmerged?\b/i
/** What is landed: the board's own words, in the same sentence, so "it lands on lava" is no landing ask. */
const OF_THE_BOARD = /\bB\d+\b|\bfix(?:es)?\b|\bbranch(?:es)?\b|\bmain\b|\bboards?\b|\bchat 1\b|\bthe go\b|\bland\.ps1\b|\blive\b|\bchanges?\b|\bthe work\b/i
/** A plain statement of the rule ("it lands on chat 1's go", in an ask's context) asks nothing; a question or an order with it does. */
const STATES_THE_RULE = /\b(?:chat 1's|the lead's|lead's) go\b/i
const ORDERS = /^\s*(?:please\s+)?(?:land|put|merge|give|may|can|could|should|will|would|do)\b/i
/** A landing named as a moment ("once B900 lands", "when chat 1 lands it"): the clause says when, not what is asked. */
const WHEN_IT_LANDS = /\b(?:once|when|after|before|until|while|if)\b[^,.?!|]*?\bland(?:s|ed)\b[^,.?!|]*/gi
/** A verdict on a result (an accept, an approval, a send back, a mark done): its landing word is a fact of the step ("lands inside the mod 0.30.0"), unless it asks to land in so many words. */
const VERDICT = /\baccept(?:s|ed|ing)?\b|\bapprove(?:s|d)?\b|\bsen[dt]\b[^.?!|]*\bback\b|\bmark\b[^.?!|]*\bdone\b/i
const STATES_IT_LANDS = /\bland(?:s|ed)\b/gi
/** An update of a mod ("Update the Workers mod to 0.30 so this goes live?") is the person's own hands (roles/worker.md "Not yours"), no landing. */
const MOD_UPDATE = /\b(?:update|change|upgrade|install|reinstall)\b[^.?!|]*\bmods?\b/i

const SENTENCES = /[^.?!|]+[.?!|]?/g
/** A dot inside a number ("Workers 0.31.0") ends no sentence: hidden while the sentences are cut, put back in the one returned. */
const DOT = '\u0000'
const hideDots = words => words.replace(/(\d)\.(?=\d)/g, `$1${DOT}`)
const showDots = words => words.replaceAll(DOT, '.')

/**
 * Whether an ask's words (its title, text and options) ask to land, merge to main, go live or put a step's work live: the sentence
 * that does, or null. Each sentence (also each option, split at `|`) is judged on its own: it names the landing as a verb (LANDS) and
 * what the board lands (OF_THE_BOARD); not a clause that says when ("once B900 lands"), not a verdict's fact ("lands inside the mod"),
 * and not a mere statement of the rule ("it lands on chat 1's go").
 */
export function landingAskOf(words) {
  const sentences = (hideDots(String(words ?? '').replace(/\s+/g, ' ')).match(SENTENCES) ?? []).map(showDots)
  for (const sentence of sentences) {
    const asked = (VERDICT.test(sentence) ? sentence.replace(STATES_IT_LANDS, ' ') : sentence).replace(WHEN_IT_LANDS, ' ')
    if (!LANDS.test(asked) || !OF_THE_BOARD.test(sentence) || MOD_UPDATE.test(sentence)) continue
    if (STATES_THE_RULE.test(sentence) && !sentence.includes('?') && !ORDERS.test(sentence)) continue
    return sentence.trim()
  }
  return null
}

/** The same, for a filed ask (its Title, Text and Options). */
export const landingAskOfItem = item => landingAskOf([valueOf(item, 'Title') ?? '', ...(item?.sections?.get('Text') ?? []), valueOf(item, 'Options') ?? ''].join(' '))
