// "Your words" (the person, 2026-10-30): "I like it to retain the feedback i gave it so when i tries to suggest new ways to
// accomplish what i want it can verify what i originally asked so it can determine if it was actually done or not." And:
// "ensure my answer/rejection/note has context of what i answered it to. so a simple 'yes' is not meaningless because it
// needs context." Every answer, rejection or note of the person's lands on its step as one numbered point under
// `## Your words`, with what it answered: the question, who asked it, its options, the advice, what was shown. A chat reads
// them before it asks, reports or suggests another way; the board refuses a question the person answered there already
// (api.mjs `ask`). PURE.

import { askKey, sameAsk } from './askWords.mjs'
import { ASKED_AGAIN, overlapOf } from './askRepeat.mjs'
import { valueOf } from './item.mjs'

/** The section of a step that holds the person's words. */
export const YOUR_WORDS = 'Your words'

/** The most characters of the person's words a point keeps (their words are never cut short in practice). */
const ANSWER_CHARS = 2000
/** The most characters of the question a point quotes. */
const QUESTION_CHARS = 400

const POINT = /^(\d+)\.\s+(\d{4}-\d\d-\d\d \d\d:\d\d)\s+·\s+(.*)$/
/** The person's words under a point; written indented, read also without (a hand edit). */
const YOU = /^\s*You:\s?(.*)$/

/** Words in one line: no line ends, runs of spaces as one. */
const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
/** A list given as an array or as one string with `split` between its parts. */
const listOf = (value, split) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(split) : []).map(one => oneLine(one, 200)).filter(Boolean)

/**
 * One point in plain text that stands on its own: its number, when (`at`, "YYYY-MM-DD HH:MM"), how the words came
 * (`how`: "answer to Q520", "note (on the board)", ...), then in brackets what they answered: who asked what (`ask`:
 * `{ by, question, advice }`), the options, what was shown, or what words without a question were about (`about`, a
 * refine's summary); under it the person's words (`answer`, lines or one string).
 *
 *   3. 2026-10-30 21:22 · answer to Q520 (Worker 1 asked: "Do you accept this look?"; options: yes / no; shown: pictures/b497/evidence.png)
 *      You: Rejected. It feels a bit square.
 */
export function wordsPoint({ n, at, how, ask = null, about = '', options = [], shown = [], answer }) {
  const question = oneLine(ask?.question, QUESTION_CHARS).replace(/"/g, '\'')
  const by = oneLine(ask?.by, 80)
  const advice = oneLine(ask?.advice, 120)
  const choices = listOf(options, '|')
  const seen = listOf(shown, ',')
  const topic = oneLine(about, QUESTION_CHARS).replace(/"/g, '\'')
  const context = [
    question === '' ? null : `${by === '' ? 'asked' : `${by} asked`}: "${question}"`,
    topic === '' ? null : `about: "${topic}"`,
    choices.length === 0 ? null : `options: ${choices.join(' / ')}`,
    advice === '' ? null : `advised: ${advice}`,
    seen.length === 0 ? null : `shown: ${seen.join(', ')}`,
  ].filter(Boolean)
  const words = (Array.isArray(answer) ? answer : String(answer ?? '').split('\n')).map(one => oneLine(one, ANSWER_CHARS)).filter(Boolean).join(' / ').slice(0, ANSWER_CHARS)
  return [`${n}. ${oneLine(at, 20)} · ${oneLine(how, 200)}${context.length === 0 ? '' : ` (${context.join('; ')})`}`, `   You: ${words}`].join('\n')
}

/**
 * The person's answer to an ask as the fields of a point (for `withYourWords`): the ask's question (its title), who
 * asked it (`by`, the chat's name as the board shows it), its options, its advice, the pictures and the play it showed.
 */
export function askPoint(ask, { at, how, by = null, answer }) {
  const play = (ask.sections?.get('Play') ?? []).map(one => one.trim()).filter(Boolean).map(one => `play ${one}`)
  return {
    at, how, answer,
    ask: { by: by ?? valueOf(ask, 'Owner') ?? '', question: valueOf(ask, 'Title') ?? (ask.sections?.get('Text') ?? [])[0] ?? '', advice: valueOf(ask, 'Advice') ?? '' },
    options: listOf(valueOf(ask, 'Options') ?? '', '|'),
    shown: [...listOf(valueOf(ask, 'Pictures') ?? '', ','), ...play],
  }
}

/** Where a point's line turns to its context: the brackets that open with who asked, the options, the advice, what was shown or what it was about. */
const CONTEXT = /^(?:[^;"(]* )?asked: "|^(?:options|advised|shown|about): /

/** A point's line after its time: how the words came, and the context in brackets at its end (none for a note). */
function splitHow(rest) {
  for (let at = rest.indexOf(' ('); at >= 0; at = rest.indexOf(' (', at + 1)) {
    if (rest.endsWith(')') && CONTEXT.test(rest.slice(at + 2))) return [rest.slice(0, at), rest.slice(at + 2, -1)]
  }
  return [rest, '']
}

/**
 * The points of a step's `## Your words`, oldest first: `{ n, at, how, ask, by, question, options, advice, shown, about,
 * answer }` (`ask` the ask's id the point answered, `question` the question it quotes; null for a note).
 */
export function yourWordsOf(item) {
  const points = []
  for (const line of item?.sections?.get(YOUR_WORDS) ?? []) {
    const head = POINT.exec(line)
    if (head !== null) {
      const [how, context] = splitHow(head[3])
      const asked = /^(?:([^;"(]*?) )?asked: "([^"]*)"/.exec(context)
      const part = name => new RegExp(`(?:^|; )${name}: ([^;]*)`).exec(context)?.[1]?.trim() ?? null
      const list = (value, split) => (value === null ? [] : value.split(split).map(one => one.trim()).filter(Boolean))
      points.push({
        n: Number(head[1]), at: head[2], how,
        ask: /\b(Q\d+)\b/.exec(how)?.[1] ?? null,
        by: asked?.[1]?.trim() || null,
        question: asked?.[2] ?? null,
        options: list(part('options'), ' / '),
        advice: part('advised'),
        shown: list(part('shown'), ', '),
        about: /(?:^|; )about: "([^"]*)"/.exec(context)?.[1] ?? null,
        answer: '',
      })
      continue
    }
    const last = points.at(-1)
    if (last === undefined || line.trim() === '') continue
    const you = YOU.exec(line)
    last.answer = you !== null ? you[1].trim() : `${last.answer} ${line.trim()}`.trim()
  }
  return points
}

/** The item with the point (the fields of `wordsPoint`, without `n`) added last: its number continues the section's. */
export function withYourWords(item, point) {
  const n = Math.max(0, ...yourWordsOf(item).map(one => one.n)) + 1
  const lines = [...(item.sections.get(YOUR_WORDS) ?? []), ...wordsPoint({ ...point, n }).split('\n')]
  // A section new to the step stands before its History, which stays last.
  const sections = new Map()
  const isNew = !item.sections.has(YOUR_WORDS)
  for (const [name, kept] of item.sections) {
    if (isNew && name === 'History') sections.set(YOUR_WORDS, lines)
    sections.set(name, name === YOUR_WORDS ? lines : kept)
  }
  if (!sections.has(YOUR_WORDS)) sections.set(YOUR_WORDS, lines)
  return { ...item, head: new Map(item.head), sections }
}

/**
 * The person's earlier answer on the step to the question `question` (the words of a new ask), or null: the newest point
 * whose question is the same (one the start of the other) or alike as `work ask` counts a near copy (`ASKED_AGAIN`).
 */
export function answeredBefore(item, question) {
  const asked = oneLine(question, 4000)
  if (asked === '') return null
  const isIt = one => one.question !== null && one.question !== '' && one.answer !== ''
    && (sameAsk(askKey(one.question), askKey(asked)) || overlapOf(one.question, asked) >= ASKED_AGAIN)
  return yourWordsOf(item).findLast(isIt) ?? null
}

/**
 * The Workers mod's own closes, never the person's words: the question form answered with nothing typed ("answered in the
 * chat"), a popup's ask closed once its call went on, a form closed unanswered.
 */
const AUTOMATIC = [/^answered in the chat$/i, /^(?:answered in the chat: )?the call went on$/i, /^the question form was closed without an answer$/i, /^a popup in its chat may wait for you\b/i]

/** Whether words are the person's own: not empty, and none of the Workers mod's automatic closes. */
export function isPersonsWords(text) {
  const words = (Array.isArray(text) ? text.join(' ') : String(text ?? '')).replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').trim()
  return words !== '' && !AUTOMATIC.some(one => one.test(words))
}

/** Whether an ask is the Workers mod's popup ask (a call that may wait on a popup): its close is never the person's words. */
export const isPopupAsk = ask => /^a popup in its chat may wait for you\b/i.test(oneLine(valueOf(ask, 'Title') ?? (ask.sections?.get('Text') ?? [])[0] ?? '', 200))

/** The line the ask call's answer ends with, on a step with Your words; '' for none. */
export function yourWordsLine(item) {
  const count = yourWordsOf(item).length
  return count === 0 ? '' : `The person's words on ${valueOf(item, 'Id')}: ${count} point${count === 1 ? '' : 's'}, see its "Your words".`
}
