// 2026-11-07 (the person rejected G60's side stairs more than fifteen times; each new try saw only the last "no", so old flaws came
// back): every try of a recap row sees ALL the person's earlier words on that row. A fix used to copy its origin's `## Your words`
// once, when it was made; a step the partner made anew for a sent-back row started empty; the recap's own comments on a row never
// reached a try. Here the words are found again, whenever a chat reads the step: those of every step of its chain (the root, every
// fix under it, the steps the recap row names) and the recap's comments on the row. PURE: no I/O.

import { valueOf } from './item.mjs'
import { fixRootsOf, fixesOf } from './resultCheck.mjs'
import { yourWordsOf } from './yourWords.mjs'

/** The most steps the walk down the chain collects. */
const CHAIN_MAX = 200
/** The characters of a point's words that tell two entries apart. */
const SAME_CHARS = 120

const oneLine = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const numberOf = id => Number(String(id).slice(1))
/** Whether the item is a step of the work (not a Quality Assurance task: its `Checks` names the step it checks). */
const isWorkStep = item => item?.head !== undefined && valueOf(item, 'Kind') === 'step' && valueOf(item, 'Checks') === null

/** The feedback file of a recap: the `feedback.json` beside its demo file. */
const feedbackFileOf = path => String(path ?? '').replace(/[^/\\]*$/, '').replace(/\\/g, '/') + 'feedback.json'

/**
 * The person's words on the part the step `id` is a try of: `{ rows: [{ key, title, path }], words: [{ at, where, words, file }] }`
 * oldest first, or null when there are none. `items`: the store's items (Map id -> item); `recapRows`: `recapVerdictsOf` of the recaps.
 * The words: those under `## Your words` of every other step of the chain (the topmost step `id` is a fix of, every fix under
 * it, dropped ones too, and the steps of the recap rows `id` or a step above it belongs to), and the recap's comments on those
 * rows. The same words twice (a fix copied them) count once, and a point `id` carries itself is left out: it is shown with the step
 * (`includeOwn`: kept, for a reader that does not show the step itself, as the evaluation of a topic the person asked for).
 */
export function rowWordsOf(id, items, recapRows = [], { includeOwn = false } = {}) {
  const roots = fixRootsOf(id, items)
  const given = new Set([id, ...roots])
  const rows = (Array.isArray(recapRows) ? recapRows : []).filter(row => (row.steps ?? []).some(step => given.has(step)))
  const chain = new Set()
  const queue = [roots.at(-1) ?? id, ...rows.flatMap(row => row.steps ?? []), ...given]
  for (const start of queue) {
    if (chain.has(start) || !isWorkStep(items?.get(start))) continue
    chain.add(start)
  }
  for (const at of [...chain]) {
    const seen = [at]
    for (let next = 0; next < seen.length && chain.size < CHAIN_MAX; next += 1) {
      for (const fix of fixesOf(seen[next], items)) {
        const fixId = valueOf(fix, 'Id')
        if (seen.includes(fixId) || !isWorkStep(fix)) continue
        seen.push(fixId)
        chain.add(fixId)
      }
    }
  }
  const own = new Set(includeOwn ? [] : yourWordsOf(items?.get(id)).map(one => `${one.at}\n${oneLine(one.answer)}`))
  const found = []
  for (const step of [...chain].filter(one => includeOwn || one !== id).sort((a, b) => numberOf(a) - numberOf(b))) {
    for (const point of yourWordsOf(items.get(step))) {
      found.push({ at: point.at, where: `${step}, ${point.ask ?? 'a note'}`, words: point.answer, file: step })
    }
  }
  for (const row of rows) {
    for (const one of row.words ?? []) {
      found.push({ at: one.at, where: `recap round ${one.round}, row "${row.title}", ${one.verdict}`, words: one.comment, file: feedbackFileOf(row.path) })
    }
  }
  // The board also writes a recap Send as a note on the step the recap shows ("Sent back in the recap of G60, round 7: ..."): the
  // recap's own comment is the same words, so that note is left out when the comment stands in the list.
  const comments = found.filter(one => one.file.endsWith('feedback.json')).map(one => oneLine(one.words).slice(0, 60))
  const kept = new Map()
  for (const one of found) {
    const words = oneLine(one.words)
    if (words === '' || own.has(`${one.at}\n${words}`)) continue
    if (!one.file.endsWith('feedback.json') && /^Sent back in the recap of /i.test(words) && comments.some(comment => comment !== '' && words.includes(comment))) continue
    const key = `${one.at}\n${words.slice(0, SAME_CHARS)}`
    if (!kept.has(key)) kept.set(key, one)
  }
  const words = [...kept.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)))
  return words.length === 0 ? null : { rows: rows.map(row => ({ key: row.key, title: row.title, path: row.path })), words }
}

/** `a, b and c`. */
const joined = list => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`)

/**
 * The block `work next`, `take`, a Quality Assurance task and a refine show below the step: the header, then the person's words newest
 * first, as many lines as fit in `budget` characters (the header not counted; at least one), each cut at `chars`; the rest as one line
 * naming the files that hold them. '' for null.
 */
export function rowWordsText(found, { budget = 1500, chars = 300 } = {}) {
  if (found === null || found === undefined || (found.words ?? []).length === 0) return ''
  const named = found.rows.length === 0 ? 'its earlier tries' : found.rows.map(row => `recap row "${row.title}"`).join(', ')
  const newest = [...found.words].reverse()
  const lines = newest.map(one => {
    const words = oneLine(one.words)
    return `- ${one.at} · ${one.where}: "${words.length > chars ? `${words.slice(0, chars)}…` : words}"`
  })
  let used = 0
  let shown = 0
  for (const line of lines) {
    if (shown > 0 && used + line.length + 1 > budget) break
    used += line.length + 1
    shown += 1
  }
  const rest = newest.slice(shown)
  const files = [...new Set(rest.map(one => one.file))]
  // Step files first (they live in .claude/work/, named once), the recap's feedback files after them.
  const steps = files.filter(one => /^B\d+$/.test(one)).map((one, at) => `${at === 0 ? '.claude/work/' : ''}${one}.md`)
  const prefixed = [...steps, ...files.filter(one => !/^B\d+$/.test(one))]
  return [
    `The person's earlier words on this part (${named}; ${found.words.length} in all, newest first). Check every one, met or not met, before you ask the person, report or suggest a new way; never ask what they answered there:`,
    ...lines.slice(0, shown),
    ...(rest.length === 0 ? [] : [`(${rest.length} older words in ${joined(prefixed)})`]),
  ].join('\n')
}
