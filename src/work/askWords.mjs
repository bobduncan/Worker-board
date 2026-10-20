// B317, Warnings (2026-10-19): whether an item of a chat's "For you" block asks what an ask of the store asks. The
// board files the block's missing items by it (api.mjs, `askForYou`), and the warning "<chat> wrote questions in its
// chat but filed no ask" stays away by it while such an ask stands open (state.mjs, `unfiledAsk`). B452: an ask's
// title (the question itself, at most 12 words) and its context, as the work tool takes them and the board shows them.
// PURE.

import { valueOf } from './item.mjs'

/** B317: an ask's words for comparing: no links, marks of markdown, the work tool's "(Q4, decide, ...)", case or end marks. */
export const askKey = value => String(value ?? '').replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, '$1').replace(/\((Q\d+),[^)]*\)\s*$/, '').replace(/[*_`~]/g, '')
  .replace(/\s+/g, ' ').trim().slice(0, 200).toLowerCase().replace(/[\s.?!:;,]+$/, '')

/** B317: two asks' words are the same question: equal, or one the start of the other (a title is cut, advice added). */
export const sameAsk = (a, b) => a === b || (a.length >= 12 && b.startsWith(a)) || (b.length >= 12 && a.startsWith(b))

/** B362: the ask ids (`Q12`) that words name anywhere, each as a word of its own. */
export const askIdsIn = words => [...String(words ?? '').matchAll(/(?<![\w-])(Q\d{1,6})(?![\w-])/g)].map(([, id]) => id)

/** The words an ask asks, for `askKey`: the first line of its Text, else its Title. */
export const askWordsOf = item => (item.sections?.get('Text') ?? []).find(words => words.trim() !== '') ?? valueOf(item, 'Title') ?? ''

/** B452: the most words an ask's title takes: the question itself, short enough to stand as a header. */
export const TITLE_WORDS = 12
/** B452: the most characters an ask's title takes, whatever its words. */
const TITLE_CHARS = 120
/** B452: the longest question an ask's long first line may give as its title (the board's window took as much). */
const QUESTION_CHARS = 280

const wordsIn = text => String(text ?? '').trim().split(/\s+/).filter(Boolean).length

/** B452: why words are too long for an ask's title, or null when they fit. */
export function titleProblem(title) {
  const words = wordsIn(title)
  if (words <= TITLE_WORDS && String(title).length <= TITLE_CHARS) return null
  const size = words > TITLE_WORDS ? `${words} words` : `${String(title).length} characters`
  return `The title is ${size}: make it the question itself, in at most ${TITLE_WORDS} words, and put why you ask, what you found and what each choice means in "text", its context (two to four plain sentences).`
}

/**
 * B452: words as sentences. One ends at a full stop or "!" before a capital, a digit, a quote or a bracket, or at a
 * question mark before a space; an abbreviation ("e.g. Yew") ends none.
 */
function sentencesOf(text) {
  const sentences = []
  let from = 0
  for (const found of text.matchAll(/[.!](?=\s+[A-Z0-9"“(])|\?(?=\s)/g)) {
    if (found[0] !== '?' && /\b(?:e\.g|i\.e|etc|vs|cf)$/i.test(text.slice(0, found.index))) continue
    sentences.push(text.slice(from, found.index + 1).trim())
    from = found.index + 1
  }
  sentences.push(text.slice(from).trim())
  return sentences.filter(one => one !== '')
}

/**
 * B452: an ask's lines (its Text) as its title and its context. An ask made with a title holds it as its first line
 * and its context after it. A first line too long for a title (an ask from before B452, or one the mod filed from the
 * app's form or a "For you" block) is split: its first question that ends within 280 characters, else its first
 * sentence, is the title; the rest of its words stand as the context, in their order, before the other lines.
 */
export function askTitleOf(lines) {
  const [first = '', ...more] = lines.map(one => String(one).replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (titleProblem(first) === null) return { title: first, context: more }
  const sentences = sentencesOf(first)
  const at = Math.max(0, sentences.findIndex(one => one.endsWith('?') && one.length <= QUESTION_CHARS))
  const rest = sentences.filter((_, index) => index !== at).join(' ')
  return { title: sentences[at] ?? first, context: rest === '' ? more : [rest, ...more] }
}
