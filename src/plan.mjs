// Plan (brainstorm of 2026-10-19): the product plan, the answers every goal and step falls back to (roles/partner.md,
// "The plan interview"), read from the game's `docs/product-plan.md` (the setting `productPlan`) for the Vision tab.
// The partner writes the page; the board only reads it and types the person's confirm, change and answers to the
// partner. Under the page's title a line "Pitch: <one sentence>". One heading per answer, "## P<n> · <title>", and
// under it lines "- State: decided (from ..., <date>)", "- Answer: <one line>", "- Point: **<lead>** <words>" (two
// to four), "- Picture: <path> · <caption>", "- Known: ..." (an open one), "- Overturned (<date>): ...". The heading
// "## The log" holds the chats' walk-up lines: "- hit P3: ...", "- gap: ...", "- overturned P2: ...".

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

/** A sentence with its first letter a capital, as a question on its slide reads. */
const capital = text => (text === '' ? text : text[0].toUpperCase() + text.slice(1))

/** "<path> · the look we aim for": the path (in a picture folder of the settings) and its caption. */
function pictureOf(value) {
  const [path, ...caption] = String(value).split(' · ')
  return { path: path.trim(), caption: caption.join(' · ').trim() }
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
 * An option of the partner's ask as a card: "A A link for friends: free, unlisted; ask again after M2" is the key "A",
 * the head "A link for friends" and the points "free, unlisted" and "ask again after M2". Without a colon the whole
 * option is its head; without a letter of one or two characters first, the key is empty.
 */
export function optionCard(label) {
  const text = String(label).trim()
  const key = text.match(/^([A-Z0-9]{1,2})\s+(?=\S)/)?.[1] ?? ''
  const rest = key === '' ? text : text.slice(key.length).trim()
  const at = rest.indexOf(':')
  if (at < 0) return { key, head: rest, points: [] }
  return { key, head: rest.slice(0, at).trim(), points: rest.slice(at + 1).split(';').map(one => one.trim()).filter(Boolean) }
}

/**
 * The page's pitch, answers and log. `pitch`: the "Pitch:" line above the first answer, or ''. `answers`: one per
 * "## P<n>" heading, in the page's order: `id`, `title`, `state`, `detail` (the state line after its word), `from`,
 * `by`, `at`, `revisit`, `answer` (the Answer line and its indented continuation, one line), `points`, `pictures`
 * (`{ path, caption }`), `known` (the Known line of an open answer), `overturned` (its lines). `log`: the counts of
 * hits, gaps and overturned lines, and the lines. An empty or missing page gives no answers.
 */
export function parsePlan(text) {
  const answers = []
  const log = { hits: 0, gaps: 0, overturned: 0, lines: [] }
  let pitch = ''
  if (typeof text !== 'string') return { pitch, answers, log }
  let current = null
  let inLog = false
  let isTop = true
  let field = null
  for (const raw of text.split(/\r?\n/)) {
    const head = raw.match(HEAD)
    if (head !== null) {
      current = { id: head[1], title: head[2].trim(), state: 'open', detail: '', from: null, by: null, at: null, revisit: null, answer: '', points: [], pictures: [], known: '', overturned: [] }
      answers.push(current)
      inLog = false
      isTop = false
      field = null
      continue
    }
    if (/^##\s+/.test(raw)) {
      inLog = /^##\s+the log\b/i.test(raw)
      current = null
      isTop = false
      field = null
      continue
    }
    if (isTop) {
      const found = raw.match(/^Pitch:\s*(.+)$/)
      if (found !== null) pitch = found[1].trim()
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
      else if (key === 'point') current.points.push(value.trim())
      else if (key === 'picture') current.pictures.push(pictureOf(value))
      else if (key === 'known') { current.known = value.trim(); field = 'known' }
      else if (key === 'overturned') current.overturned.push(`${inside === undefined ? '' : `${inside}: `}${value.trim()}`)
      continue
    }
    // An indented continuation of the Answer or Known line.
    if (field !== null && /^\s+\S/.test(raw)) current[field] = `${current[field]} ${raw.trim()}`.trim()
  }
  return { pitch, answers, log }
}

/**
 * The Vision tab's state: the parsed page with, on each open answer, the partner's open ask for it (its title starts
 * with the answer's id, "P5: ..."), its options as cards. An ask's pictures go one per option when there are as many
 * as options, else above them all. `items` are the store's items (work/read.mjs); `path` is the page's path in the
 * game, for the link. Null without a page.
 */
export function planState(text, items, path) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const { pitch, answers, log } = parsePlan(text)
  const asks = (items ?? []).filter(item => valueOf(item, 'Kind') === 'ask' && valueOf(item, 'State') === 'open')
  const counts = { decided: 0, assumed: 0, open: 0 }
  for (const answer of answers) {
    counts[answer.state] += 1
    const ask = asks.find(item => new RegExp(`^${answer.id}\\b`).test(String(valueOf(item, 'Title') ?? '')))
    if (ask === undefined) { answer.ask = null; continue }
    const advice = valueOf(ask, 'Advice')
    const options = String(valueOf(ask, 'Options') ?? '').split(' | ').map(one => one.trim()).filter(Boolean)
    const pictures = String(valueOf(ask, 'Pictures') ?? '').split(',').map(one => one.trim()).filter(Boolean)
    const perOption = options.length > 0 && pictures.length === options.length
    answer.ask = {
      id: valueOf(ask, 'Id'),
      // The question: the title after its "P<n>:".
      question: capital(String(valueOf(ask, 'Title') ?? '').replace(new RegExp(`^${answer.id}\\s*[:·-]?\\s*`), '').trim()),
      // An ask's words stand in its Text section; its title is the head's.
      text: (ask.sections?.get('Text') ?? []).join(' ').replace(/\s+/g, ' ').trim(),
      advice: advice === null || advice === '' ? null : String(advice),
      options: options.map((label, index) => ({ label, ...optionCard(label), isAdvised: isAdvised(label, advice), picture: perOption ? pictures[index] : null })),
      pictures: perOption ? [] : pictures,
    }
  }
  return { path, pitch, answers, counts, log: { hits: log.hits, gaps: log.gaps, overturned: log.overturned } }
}
