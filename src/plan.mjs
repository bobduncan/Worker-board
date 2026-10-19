// Plan (brainstorm of 2026-10-19, chunk B2): the product plan, the eight answers every goal and step falls back to
// (roles/partner.md, "The plan interview"), read from the game's `docs/product-plan.md` (the setting `productPlan`)
// for the Plan part on top of the Focus page. The partner writes the page; the board only reads it and types the
// person's confirm, change and answers to the partner. One heading per answer, "## P<n> · <title>", and under it
// lines "- State: decided (from ..., <date>)", "- Answer: ...", "- Known: ...", "- Overturned (<date>): ...". The
// heading "## The log" holds the chats' walk-up lines: "- hit P3: ...", "- gap: ...", "- overturned P2: ...".

import { valueOf } from './work/item.mjs'

const HEAD = /^##\s+(P\d+)\s*[·:-]\s*(.*)$/
const LINE = /^-\s+([A-Z][A-Za-z ]*?)(?:\s*\(([^)]*)\))?:\s*(.*)$/
const STATES = ['decided', 'assumed', 'open']

/** A state line's word: "decided", "assumed" or "open"; anything else reads as "open", never as decided. */
function stateOf(value) {
  const word = String(value ?? '').trim().split(/[\s(·]/)[0].toLowerCase()
  return STATES.includes(word) ? word : 'open'
}

/** "revisit after M1 is played" out of a state line, or null. */
function revisitOf(value) {
  const match = String(value ?? '').match(/revisit after\s+([^·]+)/i)
  return match === null ? null : match[1].trim()
}

/** "(from game-vision.md, 2026-10-10)" or "(you, 2026-10-19)" out of a state line: `from` a document, `by`, `at`. */
function sourceOf(value) {
  // A link "[game-vision.md](game-vision.md)" is its words first, so its own brackets do not end the source.
  const match = String(value ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').match(/\(([^)]*)\)/)
  if (match === null) return { from: null, by: null, at: null }
  const parts = match[1].split(',').map(one => one.trim()).filter(Boolean)
  const at = parts.find(one => /^\d{4}-\d{2}-\d{2}/.test(one)) ?? null
  const rest = parts.filter(one => one !== at)
  const from = rest.find(one => /^from\s+/i.test(one))?.replace(/^from\s+/i, '') ?? null
  const by = rest.find(one => !/^from\s+/i.test(one)) ?? null
  return { from, by, at }
}

/**
 * Whether an option is the advised one: the advice is the option itself, or names its letter first ("A, revisit after
 * M2" advises "A a link for friends").
 */
function isAdvised(label, advice) {
  if (advice === null || advice === '') return false
  if (label === advice || label.toLowerCase().startsWith(`${advice.toLowerCase()} `)) return true
  const key = String(advice).match(/^([A-Za-z0-9]+)\b/)?.[1]
  return key !== undefined && key.length <= 2 && label.toLowerCase().startsWith(`${key.toLowerCase()} `)
}

/**
 * The page's answers and log. `answers`: one per "## P<n>" heading, in the page's order: `id`, `title`, `state`,
 * `detail` (the state line after its word, for the page to show as it is), `from`, `by`, `at`, `revisit`, `answer`
 * (the Answer line and its indented continuation, one line), `known` (the Known line of an open answer), `overturned`
 * (its lines). `log`: the counts of hits, gaps and overturned lines, and the lines. An empty or missing page gives no
 * answers (`answers: []`), so the Plan part can say so.
 */
export function parsePlan(text) {
  const answers = []
  const log = { hits: 0, gaps: 0, overturned: 0, lines: [] }
  if (typeof text !== 'string') return { answers, log }
  let current = null
  let inLog = false
  let field = null
  for (const raw of text.split(/\r?\n/)) {
    const head = raw.match(HEAD)
    if (head !== null) {
      current = { id: head[1], title: head[2].trim(), state: 'open', detail: '', from: null, by: null, at: null, revisit: null, answer: '', known: '', overturned: [] }
      answers.push(current)
      inLog = false
      field = null
      continue
    }
    if (/^##\s+/.test(raw)) {
      inLog = /^##\s+the log\b/i.test(raw)
      current = null
      field = null
      continue
    }
    if (inLog) {
      const entry = raw.match(/^-\s+(hit|gap|overturned)\b\s*(P\d+)?:?\s*(.*)$/i)
      if (entry === null || entry[3].trim() === '' && entry[2] === undefined) continue
      const kind = entry[1].toLowerCase()
      if (kind === 'hit') log.hits += 1
      else if (kind === 'gap') log.gaps += 1
      else log.overturned += 1
      log.lines.push({ kind, id: entry[2] ?? null, text: entry[3].trim() })
      continue
    }
    if (current === null) continue
    const line = raw.match(LINE)
    if (line !== null) {
      const [, name, inside, value] = line
      const key = name.trim().toLowerCase()
      field = null
      if (key === 'state') {
        current.state = stateOf(value)
        current.detail = value.replace(/^\s*(decided|assumed|open)\s*/i, '').trim()
        Object.assign(current, sourceOf(value))
        current.revisit = revisitOf(value)
      } else if (key === 'answer') { current.answer = value.trim(); field = 'answer' }
      else if (key === 'known') { current.known = value.trim(); field = 'known' }
      else if (key === 'overturned') current.overturned.push(`${inside === undefined ? '' : `${inside}: `}${value.trim()}`)
      continue
    }
    // An indented continuation of the Answer or Known line.
    if (field !== null && /^\s+\S/.test(raw)) current[field] = `${current[field]} ${raw.trim()}`.trim()
  }
  return { answers, log }
}

/**
 * The Plan part's state: the parsed page with, on each open answer, the partner's open ask for it (its title starts
 * with the answer's id, "P5: ..."), so the part shows the ask's options as buttons. `items` are the store's items
 * (work/read.mjs); `path` is the page's path in the game, for the link. Null without a page.
 */
export function planState(text, items, path) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const { answers, log } = parsePlan(text)
  const asks = (items ?? []).filter(item => valueOf(item, 'Kind') === 'ask' && valueOf(item, 'State') === 'open')
  const counts = { decided: 0, assumed: 0, open: 0 }
  for (const answer of answers) {
    counts[answer.state] += 1
    const ask = asks.find(item => new RegExp(`^${answer.id}\\b`).test(String(valueOf(item, 'Title') ?? '')))
    if (ask === undefined) { answer.ask = null; continue }
    const advice = valueOf(ask, 'Advice')
    const options = String(valueOf(ask, 'Options') ?? '').split(' | ').map(one => one.trim()).filter(Boolean)
    answer.ask = {
      id: valueOf(ask, 'Id'),
      title: String(valueOf(ask, 'Title') ?? ''),
      // An ask's question stands in its Text section; its title is the head's.
      text: (ask.sections?.get('Text') ?? []).join(' ').replace(/\s+/g, ' ').trim(),
      advice: advice === null || advice === '' ? null : String(advice),
      options: options.map(label => ({ label, isAdvised: isAdvised(label, advice) })),
      pictures: String(valueOf(ask, 'Pictures') ?? '').split(',').map(one => one.trim()).filter(Boolean),
    }
  }
  return { path, answers, counts, log: { hits: log.hits, gaps: log.gaps, overturned: log.overturned } }
}
