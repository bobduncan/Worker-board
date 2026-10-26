// B569 (I92, the person, 2026-10-24: the information cards are "not readable": too much text, written as if they know
// what went on, and the picture always shows "3 points pass"). Every report opens with "Context:" (what was wrong or
// missing, for someone who forgot) and "Change:" (what the person gets now), both in plain words, then "Details:" and
// the technical rest for the check. The board's check used to refuse a report without them (see 2026-10-25 below); the
// recap card shows them, a Before | After picture for a visible change, and one quiet Checked line. A recap made before B569 is read in
// the same form from its step's record.
//
// 2026-10-25 (the person: "check the work, not the wording"; the supervisor's X45, X50, X57, X67: 28 of 37 refused
// reports were refused for their wording only): the board no longer sends a worker back for these words. A report whose
// Context or Change is missing, too long, or holds file names, code words, hashes, ids or placeholders passes with a
// warning (`partsWarnings`, shown in the worker's `work next`), and the board builds the card's words itself
// (`recapParts`): a sentence with a technical word is dropped whole, and the step's summary or title (never the
// Details) stands in where a part is missing or nothing plain is left.

import { valueOf } from './item.mjs'
import { checkedOf, resultCheckOf } from './resultCheck.mjs'

export const CONTEXT_CHARS = 300
export const CHANGE_CHARS = 500
/** How much of a report's result the board keeps (api.mjs `report`); the rest is cut, with a warning. */
export const RESULT_CHARS = 2000
/** A recap from before B569, read from its record: its words cut shorter. */
const OLD_CONTEXT_CHARS = 200
const OLD_CHANGE_CHARS = 280
/** The hint that ends the warnings for a report's words, so the next report opens as the card needs. */
const NEXT_TIME = `next time open the result with "Context: <what was wrong, in plain words, at most ${CONTEXT_CHARS} characters> Change: <what the person gets now, at most ${CHANGE_CHARS}> Details: <the rest>"`

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
const PATH = /(?<![\w@])(?:[A-Za-z]:[\\/]?|\/)?[\w.-]+(?:[\\/][\w.-]+){2,}/g
const CODE = [/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g, /\b[A-Za-z0-9]+_[A-Za-z0-9_]+\b/g, /\b[\w.]+\(\)/g, /`[^`]+`/g]
/** X57 (B633): plain words joined by slashes ("yes/how/cost") are no path: one needs a drive or a leading slash, a dot, a digit, a hyphen, an underscore, a backslash or a known folder first. */
const FOLDERS = new Set(['src', 'test', 'tests', 'docs', 'public', 'tools', 'roles', 'data', 'mods', 'examples', 'fixtures', 'design', 'node_modules', '.claude', '.git', 'content', 'render', 'core', 'battle', 'hud', 'menu', 'art', 'units', 'maps', 'sound', 'sounds', 'music', 'previews', 'fonts'])
const isPath = word => word.includes('\\') || /^(?:[A-Za-z]:|\/)/.test(word) || /\w\.\w|[\d_-]/.test(word) || FOLDERS.has(word.split(/[\\/]/)[0].toLowerCase())
const HASH = /\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g
const found = (text, patterns) => [...new Set(patterns.flatMap(pattern => [...String(text).matchAll(pattern)].map(one => one[0])))]

/** The words of `text` the person should not need: file names (and paths), code words, commit hashes. */
export function technicalWords(text) {
  const paths = found(text, [PATH]).filter(isPath)
  return { files: [...new Set([...found(text, [FILE]), ...paths])], code: found(text, CODE), hashes: found(text, [HASH]) }
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

/** The technical and insider words of `words` as one phrase ("file names (a.js), ids (B12)"); '' when they read well. */
function plainNamed(words) {
  const { files, code, hashes } = technicalWords(words)
  const { ids, placeholders } = insiderWords(words)
  const list = (what, all) => (all.length > 0 ? `${what} (${all.slice(0, 3).join(', ')})` : '')
  return [list('file names', files), list('code words', code), list('commit hashes', hashes), list('ids', ids), list('placeholders', placeholders)].filter(Boolean).join(', ')
}

/** Why the words of one part of a card are not plain (B569, B591), each fault one line; none when they read well. */
export function plainFaults(name, words) {
  const named = plainNamed(words)
  return named === '' ? [] : [`the ${name} holds ${named}: say it in plain words, for someone who forgot, and put those after "Details:"`]
}

/**
 * What is off in a report's words for the recap card, each a warning line (never a refusal: the board builds the card's
 * words itself, `recapParts`); none when they read well. The last line, once, says how the next report opens.
 */
export function partsWarnings(result) {
  const { context, change } = reportParts(result)
  const warnings = []
  if (context === '') warnings.push("the result names no Context: the card's Context is made from the step's summary")
  if (change === '') warnings.push("the result names no Change: the card's Change is made from the report")
  for (const [name, words, most] of [['Context', context, CONTEXT_CHARS], ['Change', change, CHANGE_CHARS]]) {
    if (words.length > most) warnings.push(`the ${name} is ${words.length} characters: the card shortens it to ${most}`)
    const named = plainNamed(words)
    if (named !== '') warnings.push(`the ${name} holds ${named}: the card leaves those words out`)
  }
  return warnings.length === 0 ? [] : [...warnings, NEXT_TIME]
}

/**
 * The refusals for wording the board made before 2026-10-25, as a History line wrote them. The supervisor's rule
 * report-check-twice counts a failed check only when it refused for a fact (`isWordingOnly`), so these old lines no
 * longer count. The long plain-words rule stands before the short limits one: it ends with the same words.
 */
const WORDING_REFUSALS = [
  /the result names no (?:Context|Change): [^;]*/g,
  /the Context and the Change are in plain words, for someone who forgot: no file names, code words, ids, commit hashes or placeholders; those go after "Details:"; the Context is at most 300 characters and the Change at most 500/g,
  /the (?:Context|Change) is \d+ characters: at most \d+, the rest goes after "Details:"/g,
  /the (?:Context|Change) holds .*?: say it in plain words, for someone who forgot, and put those after "Details:"/g,
  /the Context is at most 300 characters and the Change at most 500/g,
  /the change touches tests \(.*?\) but the result names no mutant: add ".*?" and report again/g,
]

/** Whether a failed check's reason (the History line's words after "check failed:") holds refusals for wording only. */
export function isWordingOnly(detail) {
  let rest = String(detail ?? '')
  let matched = false
  for (const pattern of WORDING_REFUSALS) {
    const without = rest.replace(pattern, '')
    matched = matched || without !== rest
    rest = without
  }
  return matched && rest.replace(/(?:^|;)\s*work (?:in [^;]+|outside git)\s*(?=;|$)/g, '').replace(/[;\s]/g, '') === ''
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
  // Plainness is judged before the capital letter: "lampPost" and a hash are code words only as they were written.
  const sentences = words.split(/(?<=[.!?;])\s+/).map(one => one.trim().replace(/;$/, '.')).filter(one => one !== '' && isPlain(one)).map(one => one.replace(/^[a-z]/, first => first.toUpperCase()))
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

/** `text` cut at a word to at most `most` characters, with "…" where it was cut. */
function cutWords(text, most) {
  if (text.length <= most) return text
  const head = text.slice(0, most - 1)
  const whole = /\s/.test(text[most - 1]) ? head : head.replace(/\s+\S*$/, '')
  return `${(whole === '' ? head : whole).trimEnd()}…`
}

/** `words` with each item id of `items` (a Map of the store) turned into that item's title in quotes, when the title reads plain. */
function withTitles(words, items) {
  if (!(items instanceof Map)) return words
  return words.replace(ITEM_ID, id => {
    const item = items.get(id)
    const title = item === undefined ? '' : headingOf(valueOf(item, 'Title') ?? '', id)
    return title !== '' && plainNamed(title) === '' ? `"${title}"` : id
  })
}

/**
 * The plain sentences of a worker's `words` for the card, at most `max` characters. Simple over clever (the re-check of
 * 2026-10-25: taking a file name or code word out of a sentence left broken ones, "Lamps stay off set to true."): a
 * sentence that holds a file name, code word, hash, id or placeholder is dropped whole. '' for none left.
 */
function plainOnly(words, most) {
  const kept = words.split(/(?<=[.!?])\s+/).map(one => one.trim()).filter(one => one !== '' && plainNamed(one) === '')
    .map(one => one.replace(/^\p{Ll}/u, first => first.toUpperCase()))
  let out = ''
  for (const sentence of kept) {
    const next = out === '' ? sentence : `${out} ${sentence}`
    if (next.length > most) break
    out = next
  }
  return out === '' && kept.length > 0 ? cutWords(kept[0], most) : out
}

/**
 * One part of a card from the words a worker wrote: as written when it reads plain (cut at a word to `most`); else with
 * item ids turned into their titles (an id whose title reads plain keeps its sentence whole) and each sentence that
 * still holds a technical word dropped (`plainOnly`). '' for none left.
 */
function tidyPart(words, most, items) {
  if (words === '') return ''
  const named = withTitles(words, items)
  return plainNamed(named) === '' ? cutWords(named, most) : plainOnly(named, most)
}

/**
 * The recap's parts for a step: its last report's Context and Change, tidied by the board (sentences with technical words
 * dropped, ids turned into the titles of the `items` it is given, too long cut). Where a part is missing or
 * nothing plain is left of it: the Context comes from the step's summary; the Change from the report's own prose when
 * the report has no Context or Change at all (before B569), else from the summary, else the step's title. Never from the
 * Details, which are for the check. And its Checked count.
 */
export function recapParts(step, items = null) {
  const result = lastResultOf(step)
  const parts = reportParts(result)
  // Words made from an old record are kept shorter than a worker may write: what was meant to be read is the card.
  let context = tidyPart(parts.context, CONTEXT_CHARS, items)
  let isContextFromSummary = false
  if (context === '') {
    context = plainSentences(summaryOf(step), OLD_CONTEXT_CHARS)
    isContextFromSummary = context !== ''
  }
  let change = tidyPart(parts.change, CHANGE_CHARS, items)
  // A report with a Context or a Change names its own parts: what is left of it is the Details. One without them is prose.
  if (change === '' && !/\b(?:Context|Change):/i.test(result)) change = plainSentences(parts.rest, OLD_CHANGE_CHARS)
  if (change === '') {
    change = plainSentences(summaryOf(step), OLD_CHANGE_CHARS)
    // The summary said once: as the Change.
    if (change !== '' && isContextFromSummary) context = ''
  }
  if (change === '') {
    const title = headingOf(valueOf(step, 'Title') ?? '', valueOf(step, 'Id') ?? '')
    change = plainNamed(title) === '' ? title : ''
  }
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
