// B569 (I92, the person, 2026-10-24: the information cards are "not readable": too much text, written as if they know
// what went on, and the picture always shows "3 points pass"). Every report opens with "Context:" (what was wrong or
// missing, for someone who forgot) and "Change:" (what the person gets now), both in plain words, then "Details:" and
// the technical rest for the check. The board's check refuses a report without them (check.mjs); the recap card shows
// them, a Before | After picture for a visible change, and one quiet Checked line. A recap made before B569 is read in
// the same form from its step's record.

import { checkedOf, resultCheckOf } from './resultCheck.mjs'

export const CONTEXT_CHARS = 300
export const CHANGE_CHARS = 500
/** A recap from before B569, read from its record: its words cut shorter. */
const OLD_CONTEXT_CHARS = 200
const OLD_CHANGE_CHARS = 280
/** How a report opens, as the refusal says it. */
export const PARTS_LINE = 'Context: <1-3 short lines: what was wrong or missing, for someone who forgot> Change: <what the person gets now> Details: <the rest, for the check>'

/** What a refusal for a missing Context or Change adds, so the next report is not refused for its words too. */
export const PLAIN_RULE = 'the Context and the Change are in plain words, for someone who forgot: no file names, code words, ids, commit hashes or placeholders; those go after "Details:"'

/** Where the Change ends: the technical rest, named or a "Tests bite:" line. */
const REST = /\b(?:Details|Tests bite):/i

/** A report's words in their parts: `context`, `change` ('' when not named) and the `rest`. */
export function reportParts(result) {
  const text = String(result ?? '').replace(/\s+/g, ' ').trim()
  const context = /\bContext:/i.exec(text)
  const change = /\bChange:/i.exec(text)
  if (context === null && change === null) return { context: '', change: '', rest: text }
  const start = change ?? context
  const end = (() => {
    const found = REST.exec(text.slice(start.index + start[0].length))
    return found === null ? text.length : start.index + start[0].length + found.index
  })()
  const between = (from, to) => text.slice(from, to).trim()
  return {
    context: context === null || (change !== null && context.index > change.index) ? '' : between(context.index + context[0].length, change === null ? end : change.index),
    change: change === null ? '' : between(change.index + change[0].length, end),
    rest: [between(0, Math.min(context?.index ?? Infinity, change?.index ?? Infinity)), between(end, text.length)].filter(Boolean).join(' '),
  }
}

const FILE = /(?<![\w@])(?:[\w.-]+[\\/])*[\w-]+\.(?:m?js|cjs|ts|tsx|jsx|json|md|css|html?|png|jpe?g|webp|gif|svg|py|ps1|sh|txt|ya?ml|toml|csv|wav|mp3|ogg)\b/gi
const PATH = /(?<![\w@])[\w.-]+(?:[\\/][\w.-]+){2,}/g
const CODE = [/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g, /\b[A-Za-z0-9]+_[A-Za-z0-9_]+\b/g, /\b[\w.]+\(\)/g, /`[^`]+`/g]
const HASH = /\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g
const found = (text, patterns) => [...new Set(patterns.flatMap(pattern => [...String(text).matchAll(pattern)].map(one => one[0])))]

/** The words of `text` the person should not need: file names (and paths), code words, commit hashes. */
export function technicalWords(text) {
  return { files: found(text, [FILE, PATH]), code: found(text, CODE), hashes: found(text, [HASH]) }
}

const ITEM_ID = /\b[BGINQX]\d+\b/g
const PLACEHOLDER = /<[^<>\n]{1,40}>/g
/**
 * B591: the words of `text` only someone who followed the work knows: the board's item ids (B12, Q3, G15, X7, I92,
 * N700) and placeholders ("<n>", "<free worker>"). The agreed card (Q352) has none: it is read by someone who forgot.
 */
export function insiderWords(text) {
  return { ids: found(text, [ITEM_ID]), placeholders: found(text, [PLACEHOLDER]) }
}

/** Why the words of one part of a card are not plain (B569, B591), each fault one line; none when they read well. */
export function plainFaults(name, words) {
  const { files, code, hashes } = technicalWords(words)
  const { ids, placeholders } = insiderWords(words)
  const list = (what, all) => (all.length > 0 ? `${what} (${all.slice(0, 3).join(', ')})` : '')
  const named = [list('file names', files), list('code words', code), list('commit hashes', hashes), list('ids', ids), list('placeholders', placeholders)].filter(Boolean)
  return named.length === 0 ? [] : [`the ${name} holds ${named.join(', ')}: say it in plain words, for someone who forgot, and put those after "Details:"`]
}

/** Why a report's words are refused for the recap card (B569), each fault one line; none when they read well. */
export function partsFaults(result) {
  const { context, change } = reportParts(result)
  const faults = []
  if (context === '') faults.push(`the result names no Context: open it with "${PARTS_LINE}"`)
  if (change === '') faults.push(`the result names no Change: after the Context, "Change: <what the person gets now>", then "Details:" and the rest`)
  // X50 (B624): the refusal is where a worker reads the plain-words rule as it writes; said once, for both parts.
  if (context === '' || change === '') faults.push(PLAIN_RULE)
  for (const [name, words, most] of [['Context', context, CONTEXT_CHARS], ['Change', change, CHANGE_CHARS]]) {
    if (words.length > most) faults.push(`the ${name} is ${words.length} characters: at most ${most}, the rest goes after "Details:"`)
    faults.push(...plainFaults(name, words))
  }
  return faults
}

const REPORTED = /^Reported (?:again )?by .+? on \d{4}-\d\d-\d\d at \d\d:\d\d: (.*?)(?: \(merged [^()\s]+\))?$/
/** What the step's last report said ('' for none). */
export const lastResultOf = step => (step?.sections?.get('Context') ?? []).map(one => one.trim().match(REPORTED)).filter(Boolean).at(-1)?.[1] ?? ''

/** Words that belong to the check, not to the person: a sentence with one of these is left out of a card. */
const FOR_THE_CHECK = /\b(?:tests?|suite|gate|merged|typecheck|build|commit|worktree|branch|mutant|refactor|regex|function|endpoint)\b/i
/** B591: a time of day or a measured wait ("23:24", "3 h 43 min", "24-38 min") tells of one case, not of the change. */
const MEASURED = /\b\d{1,2}:\d\d\b|\b\d+(?:-\d+)?\s*(?:h|min)\b/
/** B591: a sentence cut from an old report can keep half a quote ('... outside git" failed.'). */
const halfQuoted = sentence => (sentence.match(/"/g) ?? []).length % 2 === 1
const isPlain = sentence => !FOR_THE_CHECK.test(sentence) && !MEASURED.test(sentence) && !halfQuoted(sentence) && plainFaults('', sentence).length === 0

/**
 * Plain sentences of `text`, at most `most` characters: asides in brackets and the "I92 (the person, ...):" lead left
 * out, each sentence with a file, code word, hash or check word dropped, cut at a sentence's end (a first sentence
 * longer than `most` at a word's, with "…").
 */
export function plainSentences(text, most) {
  let words = String(text ?? '').replace(/\s+/g, ' ').trim()
  while (/\([^()]*\)/.test(words)) words = words.replace(/\s*\([^()]*\)/g, '')
  words = words.replace(/^(?:[A-Z]\d+(?:,\s*[A-Z]\d+)*\s*)?:\s*/, '').replace(/\s+([.,;:])/g, '$1')
  // A clause after ";" counts as a sentence of its own, ended with a full stop.
  const sentences = words.split(/(?<=[.!?;])\s+/).map(one => one.trim().replace(/;$/, '.').replace(/^[a-z]/, first => first.toUpperCase())).filter(one => one !== '' && isPlain(one))
  let out = ''
  for (const sentence of sentences) {
    const next = out === '' ? sentence : `${out} ${sentence}`
    if (next.length > most) break
    out = next
  }
  if (out === '' && sentences.length > 0) {
    const cut = sentences[0].slice(0, most - 1)
    out = `${/\s/.test(sentences[0][most - 1] ?? ' ') ? cut.trimEnd() : cut.replace(/\s+\S*$/, '')}…`
  }
  return out.replace(/^./, first => first.toUpperCase())
}

/** The step's summary, as the refine wrote it ('' for none). */
const summaryOf = step => {
  const own = (step?.sections?.get('Summary') ?? []).join(' ').trim()
  if (own !== '') return own
  return (step?.sections?.get('Refined') ?? []).map(one => one.trim()).find(one => one.startsWith('Summary:'))?.slice('Summary:'.length).trim() ?? ''
}

/** "5 of 5": the points of the check that closed the step (a fix that closed it made every point pass); null for none. */
export function checkedCount(step) {
  const check = checkedOf(step)
  if (check === null || check.total === 0) return null
  return resultCheckOf(step) === 'passed' ? `${check.passed} of ${check.total}` : `${check.total} of ${check.total}`
}

/**
 * The recap's parts for a step: its last report's Context and Change, or for a report from before B569 plain words
 * from its record (the Context from its summary, the Change from its report), and its Checked count.
 */
export function recapParts(step) {
  const result = lastResultOf(step)
  const parts = reportParts(result)
  // Words made from an old record are kept shorter than a worker may write: what was meant to be read is the card.
  const context = parts.context !== '' ? parts.context.slice(0, CONTEXT_CHARS) : plainSentences(summaryOf(step), OLD_CONTEXT_CHARS)
  const change = parts.change !== '' ? parts.change.slice(0, CHANGE_CHARS) : plainSentences(parts.rest, OLD_CHANGE_CHARS)
  // An old summary that says just what the report said is no Context.
  return { context: context === change ? '' : context, change, checked: checkedCount(step) }
}

/** The card's title: the step's or goal's title from "B12 <title> is done", without an incident fix's lead. */
export function headingOf(title, about) {
  let words = String(title ?? '').trim()
  if (about && words.startsWith(`${about} `)) words = words.slice(about.length + 1)
  words = words.replace(/\s+is done$/, '').replace(/^Fix of [A-Z]\d+:\s*/, '')
  return words.replace(/^./, first => first.toUpperCase())
}

/** A Before | After picture (tools/evidence.mjs `--before`, `--after`): the only kind a recap from before B569 keeps. */
export const isBeforeAfter = path => /(?:^|[\\/])before-after\.png$/i.test(String(path ?? '').trim())

/** The parts of a goal's recap: its why as the Context, its Done when as the Change. */
export function goalParts({ why, doneWhen, checked }) {
  return {
    context: plainSentences(why, CONTEXT_CHARS),
    change: plainSentences(doneWhen, CHANGE_CHARS) || 'A helper re-checked it against its Done when and its vibe.',
    checked,
  }
}
