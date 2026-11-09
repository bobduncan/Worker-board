// 2026-11-09 (reactive board, brief A): the person's decisions on the Vision tab are written into the product plan by
// the board at once, in the page's own line format (src/plan.mjs, header), with "(you, <date>)". The partner writes
// everything else. A change touches only the lines of the item named; every other byte stays, CRLF or LF as the file
// has it. The file is written the way the goals file is (goalsWrite.mjs `rewrite`: read anew right before, written
// beside, put in place, started again when somebody else wrote it in between).
import { dayOf, files, rewrite } from './goalsWrite.mjs'

// The file is handled as its bytes (latin1): a UTF-8 "·" reads "Â·" here and a lone latin1 "·" (one stands in the real
// plan) reads "·", so a heading is found either way, and every byte a change does not touch stays what it was.
const ANSWER_HEAD = /^##\s+(P\d+)\s*Â?[·:-]/
const FEATURE_HEAD = /^###\s+(F\d+)\s*Â?[·:-]/
const STANDARD_HEAD = /^###\s+(K\d+)\s*Â?[·:-]/
const MILESTONE_HEAD = /^###\s+(M\d+\+?)\s*Â?[·:-]/
const GOAL_HEAD = /^####\s+(S\d+)\s*Â?[·:-]/
const ANY_HEAD = /^#{1,6}\s/
// The same line shape plan.mjs reads: "- Key: value" or "- Key (inside): value".
const LINE = /^-\s+([A-Z][A-Za-z ]*?)(?:\s*\(([^)]*)\))?:\s*(.*)$/

const refuse = (status, text) => ({ ok: false, status, text })
const keyOf = line => line.match(LINE)?.[1].trim().toLowerCase() ?? null

/** The file as lines with the end each had, so a line changed keeps its neighbours' bytes. */
function split(text) {
  const bom = text.startsWith('ï»¿') ? 'ï»¿' : ''
  const pieces = text.slice(bom.length).split(/(\r\n|\n)/)
  const parts = []
  for (let at = 0; at < pieces.length; at += 2) parts.push({ text: pieces[at], sep: pieces[at + 1] ?? '' })
  return { bom, parts, newline: text.includes('\r\n') ? '\r\n' : '\n' }
}
const join = ({ bom, parts }) => bom + parts.map(part => part.text + part.sep).join('')

/** Where the block of a part of the plan stands: its heading, and the line its own lines end before. */
function blockOf(file, kind, id) {
  const heads = { answer: ANSWER_HEAD, feature: FEATURE_HEAD, standard: STANDARD_HEAD, milestone: MILESTONE_HEAD, goal: GOAL_HEAD }
  const where = { answer: 'answers', feature: 'features', standard: 'standards', milestone: 'preset', goal: 'preset' }[kind]
  let section = 'top'
  const starts = []
  file.parts.forEach((part, index) => {
    if (/^##\s+[^#]/.test(part.text)) {
      if (ANSWER_HEAD.test(part.text)) section = 'answers'
      else section = /^##\s+features\b/i.test(part.text) ? 'features' : /^##\s+goals preset\b/i.test(part.text) ? 'preset' : /^##\s+standards\b/i.test(part.text) ? 'standards' : 'other'
    }
    if (section === where && part.text.match(heads[kind])?.[1] === id) starts.push(index)
  })
  if (starts.length === 0) return refuse(404, `${id} is not in the plan.`)
  if (starts.length > 1) return refuse(409, `${id} stands twice in the plan: the partner has to tidy it first.`)
  let end = starts[0] + 1
  while (end < file.parts.length && !ANY_HEAD.test(file.parts[end].text)) end += 1
  return { ok: true, start: starts[0], end }
}

/** The value of the block's line with this key (the last one, as the page reads it), or null. */
function valueOf(file, block, key) {
  let found = null
  for (let at = block.start + 1; at < block.end; at += 1) if (keyOf(file.parts[at].text) === key) found = file.parts[at].text.match(LINE)[3].trim()
  return found
}

/**
 * The block's line with this key set to `line`: the last one replaced where it stands, else added right after the last
 * line with one of the keys of `after` (the first of them that is there), else right after the heading.
 */
function setLine(file, block, key, line, after = []) {
  let at = -1
  for (let index = block.start + 1; index < block.end; index += 1) if (keyOf(file.parts[index].text) === key) at = index
  if (at >= 0) {
    file.parts[at].text = line
    return
  }
  let place = block.start
  for (const name of after) {
    let last = -1
    for (let index = block.start + 1; index < block.end; index += 1) if (keyOf(file.parts[index].text) === name) last = index
    if (last >= 0) {
      place = last
      break
    }
  }
  const before = file.parts[place]
  const sep = before.sep === '' ? file.newline : before.sep
  const added = { text: line, sep: before.sep === '' ? '' : before.sep }
  before.sep = sep
  file.parts.splice(place + 1, 0, added)
}

const firstWord = value => String(value ?? '').trim().split(/[\s(·]/)[0].toLowerCase()

/** One decision applied to the file's lines, or a refusal. `date`: this machine's day. */
function apply(file, op, date) {
  const found = blockOf(file, op.kind, op.id)
  if (!found.ok) return found
  const you = `(you, ${date})`
  if (op.kind === 'answer') {
    if (op.what === 'settled') setLine(file, found, 'settled', `- Settled: ${you}`, ['state'])
    else {
      const state = firstWord(valueOf(file, found, 'state'))
      if (state === 'decided') return { ok: true }
      if (state !== 'assumed') return refuse(409, `${op.id} has no answer yet to confirm: get its options, or answer it in your own words.`)
      setLine(file, found, 'state', `- State: decided ${you}`)
    }
  } else if (op.kind === 'feature') {
    if (op.what === 'tradeoff') setLine(file, found, 'tradeoff', `- Tradeoff: ${op.choice} ${you}`, ['prepare', 'complex', 'mark'])
    else {
      // A milestone as the mark: the open end (M3+) is later, any other milestone is must; the milestone is its own line.
      const milestone = /^M\d+\+?$/.test(op.mark) ? op.mark : null
      const mark = milestone === null ? op.mark : milestone.endsWith('+') ? 'later' : 'must'
      setLine(file, found, 'mark', `- Mark: ${mark} ${you}`, ['complex'])
      if (milestone !== null) setLine(file, found, 'milestone', `- Milestone: ${milestone} ${you}`, ['mark'])
    }
  } else if (op.what === 'notnow') {
    setLine(file, found, 'state', `- State: not now ${you}`)
  } else {
    // A goal or a standard confirmed; one the partner wrote as agreed or confirmed already stays as it is.
    if (['confirmed', 'agreed'].includes(firstWord(valueOf(file, found, 'state')))) return { ok: true }
    setLine(file, found, 'state', `- State: confirmed ${you}`)
  }
  return { ok: true }
}

/** The file's text (its bytes as latin1) with every decision of `ops` made, or the first refusal; nothing is changed on a refusal. */
export function decideText(text, ops, date) {
  const file = split(text)
  for (const op of ops) {
    const done = apply(file, op, date)
    if (!done.ok) return done
  }
  return { ok: true, text: join(file) }
}

/**
 * The person's decisions written into the product plan file. `ops`: `{ kind: 'answer', id, what: 'decided'|'settled' }`,
 * `{ kind: 'feature', id, what: 'mark', mark }` or `{ kind: 'feature', id, what: 'tradeoff', choice }`, `{ kind: 'goal'
 * |'standard', id }` (confirmed) or `{ kind: 'goal'|'milestone', id, what: 'notnow' }`. All of them or none: an id that is
 * not in the plan refuses the whole move. `{ ok: true, changed }` or `{ ok: false, status, why }`.
 */
export async function writeDecisions(file, ops, now, fs = files) {
  if (typeof file !== 'string' || file === '') return { ok: false, status: 409, why: 'There is no product plan file to write the decision in.' }
  let changed = false
  const written = await rewrite(file, latin => {
    const done = decideText(latin, ops, dayOf(now))
    if (!done.ok) return done
    if (done.text === latin) return { ok: false, why: 'same' }
    changed = true
    return { ok: true, text: done.text }
  }, fs)
  if (written.ok || written.why === 'same') return { ok: true, changed }
  if (written.status !== undefined) return { ok: false, status: written.status, why: written.text }
  if (written.why === 'gone') return { ok: false, status: 409, why: 'The product plan file is not there: the decision was not written.' }
  return { ok: false, status: 409, why: 'The product plan file could not be written just now (somebody else is writing it): try again.' }
}
