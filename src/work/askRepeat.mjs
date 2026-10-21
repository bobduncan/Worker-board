// B474 (I57, 2026-10-21): "I still often get asked the same thing twice, via different need your attentions." Whether
// a question asks what an ask of the store already asks, in other words. The board leaves out such an item of a chat's
// "For you" block (api.mjs, `askForYou`), and refuses a chat's second `work ask` of a question it holds open (api.mjs,
// `ask`). The thresholds come from the store's asks of 2026-10-18 to 2026-10-21: every pair of one question asked
// twice there scored 0.5 or more against the ask filed in the same turn, and no two different questions of one chat
// scored above 0.57 (B474, tools/replay-asks.mjs). PURE.

import { askKey, sameAsk } from './askWords.mjs'
import { sinceMs, valueOf } from './item.mjs'
import { isRoutedToPartner } from './partnerAnswers.mjs'

/** Words that say little about what a question asks. */
const QUIET = new Set(('that this with what your from have they them then than when will would should does done each into only also '
  + 'just about there their which while been more most some such very shall make made show shows want like look looks intended '
  + 'advise advised approved').split(' '))
/** How many of a question's first meaningful words are compared: its question, not the context after it. */
const FIRST_WORDS = 25

/** The start of a word that its forms share ("teaches", "teaching"). */
const STEM = 5
/** The fewest meaningful words two questions share to be one: a short "Does it do what you intended?" is no match. */
const FEWEST_SHARED = 3

/**
 * A question's meaningful words, its first `FIRST_WORDS`: links as their words, four letters or more, no quiet words,
 * each as its first `STEM` letters.
 */
export function askTokens(words) {
  // The review: a long text is cut first; its first FIRST_WORDS come from its start anyway.
  const plain = String(words ?? '').slice(0, 1000).replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, '$1').toLowerCase()
  const meant = (plain.match(/[a-z0-9]+/g) ?? []).filter(one => one.length >= 4 && !QUIET.has(one)).slice(0, FIRST_WORDS)
  return new Set(meant.map(one => one.slice(0, STEM)))
}

/** How much of the shorter question's meaningful words the other holds, 0 to 1; 0 when they share fewer than three. */
export function overlapOf(a, b) {
  const [one, two] = [askTokens(a), askTokens(b)]
  if (one.size === 0 || two.size === 0) return 0
  let shared = 0
  for (const word of one) if (two.has(word)) shared += 1
  return shared < FEWEST_SHARED ? 0 : shared / Math.min(one.size, two.size)
}

/** Another question in other words: against an ask filed or withdrawn this turn, and against one still open. */
export const SAME_TURN = 0.5
export const STILL_OPEN = 0.6
/** The review: `work ask` refuses only a near copy (the P3 questions came word for word, Q160 and Q162 0.92 alike). */
export const ASKED_AGAIN = 0.7
/** Against an open ask of another chat under the step or goal the item names. */
export const NAMED_PLACE = 0.3

/** The words of an ask as compared: all its lines. */
export const askTextOf = item => (item.sections?.get('Text') ?? []).join(' ') || (valueOf(item, 'Title') ?? '')

/**
 * An ask as `forYouRepeat` and `openRepeat` compare it. The review: `routed`, an open ask that went to the partner
 * first, is not the person's: an item like it still reaches the person.
 */
export const repeatFactsOf = item => ({ id: valueOf(item, 'Id'), words: askTextOf(item), of: valueOf(item, 'Of'), routed: isRoutedToPartner(item) })

const CLOSED = /^- (\d{4}-\d\d-\d\d \d\d:\d\d) [^:]+: (?:answered|withdrawn)\b/
/** When an ask was answered or withdrawn (its first such line of History, to the minute), NaN while it is open. */
export function closedMsOf(item) {
  const found = (item.sections?.get('History') ?? []).map(line => CLOSED.exec(line)).find(Boolean)
  return found ? sinceMs(found[1]) : Number.NaN
}
/** Whether an ask was withdrawn. */
export const isWithdrawn = item => (item.sections?.get('History') ?? []).some(line => /^- \S+ \S+ [^:]+: withdrawn\b/.test(line))

const isSame = (a, b, at) => sameAsk(askKey(a), askKey(b)) || overlapOf(a, b) >= at

/** A do that sends the person to questions elsewhere: "Answer the Advisor's questions on B17", "Open B17 and reply". */
const POINTER = /^\W*(?:answer|reply|open|look at|go to)\b/i

/**
 * B474: why an item of a chat's "For you" block (`text`, its lines; `kind`) asks again what an ask already asks, or null.
 * `turn`: the chat's asks filed or withdrawn since its turn began; `own`: its asks still open; `others`: the open asks
 * of the other chats. Each is `{ id, words, of }`. The reason names the ask it repeats.
 */
export function forYouRepeat({ text, kind }, asks) {
  const [turn, own, others] = [asks.turn, asks.own, asks.others].map(some => (some ?? []).filter(one => one.routed !== true))
  const words = text.join(' ')
  // The item leads with an open ask's id ("Q202, which proposals become steps: ..."): a pointer to it.
  const lead = /^\W*(Q\d{1,6})\b/.exec(words)?.[1]
  const pointed = [...own, ...others].find(one => one.id === lead)
  if (pointed !== undefined) return `points to ${pointed.id}`
  const said = turn.find(one => isSame(words, one.words, SAME_TURN)) ?? own.find(one => isSame(words, one.words, STILL_OPEN))
    ?? others.find(one => isSame(words, one.words, STILL_OPEN))
  if (said !== undefined) return `asks what ${said.id} asks`
  // The item names a step or goal under which another chat's question stands open ("Answer the Advisor's questions on
  // B17"; "On the third height (B436), should ..."): a do that sends the person to answer or open it points to it (the
  // review: "restart the board so B17 takes effect" does not), a question that shares its words repeats it.
  const places = new Set([...words.matchAll(/(?<![\w-])([BG]\d{1,6})(?![\w-])/g)].map(([, id]) => id))
  const there = others.filter(one => one.of !== null && places.has(one.of))
  const under = kind === 'do' && POINTER.test(words) ? there[0] : there.find(one => overlapOf(words, one.words) >= NAMED_PLACE)
  if (under !== undefined) return `points to ${under.id} under ${under.of}`
  return null
}

/**
 * How long after its answer a chat's ask still stands for its question: the answer may not have reached the chat yet.
 * Short, since a chat that took the answer in may ask again in the same words after its change (Q190 answered at 14:35,
 * Q192 asked at 14:39 after the fix, 0.93 alike).
 */
export const JUST_ANSWERED_MS = 2 * 60_000

/**
 * B474: the ask of the same chat, under the same step or goal (or alone, as it), that a new `work ask` repeats, or
 * undefined. `asks`: the chat's asks open, or answered within `JUST_ANSWERED_MS` (Q160 and Q162 asked one question a
 * minute apart, and the person answered both), each `{ id, words, of }`.
 */
export const openRepeat = (words, of, asks) => asks.find(one => one.of === of && isSame(words, one.words, ASKED_AGAIN))

