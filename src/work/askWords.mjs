// B317, Warnings (2026-10-19): whether an item of a chat's "For you" block asks what an ask of the store asks. The
// board files the block's missing items by it (api.mjs, `askForYou`), and the warning "<chat> wrote questions in its
// chat but filed no ask" stays away by it while such an ask stands open (state.mjs, `unfiledAsk`). PURE.

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
