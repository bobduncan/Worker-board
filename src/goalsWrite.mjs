// B256: every change to goals.md as text → text, by id, every other line untouched (spec 2026-10-15, sections 1 and
// 3), and `editGoals`, which writes one change to the file: read anew right before, written beside and put in place
// (`rewrite`), with a copy of the file before the first change of a day and an undo of the last twenty.
// A goal's block is its line and every following line indented deeper; its own lines are the block's lines that are
// not inside a child's block.
import { access, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'

import { FOCUS_LINE, GOAL_LINE, LAST_LINE, doneBulletOf, hasDoneWhen, nextAskId, nextGoalId, parseGoals } from './goals.mjs'
import { besideOf, moveInPlace, writeAtomic, writeNew } from './write.mjs'

const files = { readFile, writeFile, rename, rm, mkdir, access, open }

/**
 * B221: a file with one change made to it (`change`: the text before, as latin1, to `{ ok, text }` or `{ ok: false,
 * why }`), read anew right before, written beside and put in its place in one move, and started again from the file
 * when somebody else wrote it in between. The bytes are handled one to one (latin1), so every byte the change does not
 * touch stays what it was. Answers `{ ok: true }`, or `{ ok: false, why }`: the change's why, `gone` or `write`.
 */
export async function rewrite(file, change, fs) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let before
    try {
      before = (await fs.readFile(file)).toString('latin1')
    } catch {
      return { ok: false, why: 'gone' }
    }
    const ticked = change(before)
    if (!ticked.ok) return ticked
    // B406: flushed beside, and put in place tried again while Windows holds the file.
    const beside = besideOf(file)
    try {
      await writeNew(beside, Buffer.from(ticked.text, 'latin1'), fs)
      if ((await fs.readFile(file)).toString('latin1') !== before) {
        await fs.rm(beside, { force: true })
        continue
      }
      await moveInPlace(beside, file, fs)
      return { ok: true }
    } catch {
      await fs.rm(beside, { force: true }).catch(() => {})
      return { ok: false, why: 'write' }
    }
  }
  return { ok: false, why: 'write' }
}

const refuse = why => ({ ok: false, why })
const STATE_MARK = { open: ' ', now: '~', done: 'x' }
const LINKS = ['Enables', 'Also part of']
const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** The file's lines without their ends, the end it uses, whether it ends with one, and its byte-order mark. */
function split(text) {
  const bom = text.startsWith('﻿') ? '﻿' : ''
  const body = text.slice(bom.length)
  const newline = body.includes('\r\n') ? '\r\n' : '\n'
  if (body === '') return { lines: [], newline, trailing: true, bom }
  const lines = body.split(/\r?\n/)
  const trailing = lines.at(-1) === ''
  if (trailing) lines.pop()
  return { lines, newline, trailing, bom }
}
const join = ({ lines, newline, trailing, bom }) => bom + lines.join(newline) + (trailing && lines.length > 0 ? newline : '')

const indentOf = line => line.match(/^ */)[0].length
const goalId = line => line.match(GOAL_LINE)?.[3] ?? null

/** Where the block of the goal on line `start` ends (exclusive): every following line indented deeper. */
function blockEnd(lines, start) {
  const depth = indentOf(lines[start])
  let end = start + 1
  while (end < lines.length && (lines[end].trim() === '' ? end + 1 < lines.length && indentOf(lines[end + 1]) > depth : indentOf(lines[end]) > depth)) end += 1
  return end
}

/** The goal's line, its block's end and its indentation; refused when the id is gone or used twice. */
function blockOf(lines, id) {
  const starts = lines.flatMap((line, index) => (goalId(line) === id ? [index] : []))
  if (starts.length === 0) return refuse('gone')
  if (starts.length > 1) return refuse('twice')
  const start = starts[0]
  return { ok: true, start, end: blockEnd(lines, start), depth: indentOf(lines[start]) }
}

/** The indices of the goal's own lines: in its block, not inside a child's. */
function ownLines(lines, found) {
  const own = []
  for (let at = found.start + 1; at < found.end;) {
    if (GOAL_LINE.test(lines[at]) && indentOf(lines[at]) > found.depth) at = blockEnd(lines, at)
    else {
      if (lines[at].trim() !== '') own.push(at)
      at += 1
    }
  }
  return own
}

/** Right after the goal's own lines at its top, before its first child: where a new line of its own goes. */
function ownLinesEnd(lines, found) {
  let at = found.start + 1
  while (at < found.end && !GOAL_LINE.test(lines[at])) at += 1
  return at
}

/** The id of the goal whose block holds line `start` one level up, or null at the top. */
function homeOf(lines, start) {
  const depth = indentOf(lines[start])
  for (let at = start - 1; at >= 0; at -= 1) if (GOAL_LINE.test(lines[at]) && indentOf(lines[at]) < depth) return goalId(lines[at])
  return null
}

const reindent = (block, from, to) => block.map(line => (line.trim() === '' ? line : ' '.repeat(Math.max(0, indentOf(line) - from + to)) + line.trimStart()))

/** The goals one level inside a block (or at the top for `found` null), as line indices. */
function childStarts(lines, found) {
  const [from, to, depth] = found === null ? [0, lines.length, -1] : [found.start + 1, found.end, found.depth]
  const starts = []
  for (let at = from; at < to;) {
    if (GOAL_LINE.test(lines[at]) && indentOf(lines[at]) > depth) {
      starts.push(at)
      at = blockEnd(lines, at)
    } else at += 1
  }
  return starts
}

export function renameGoal(text, id, title) {
  const named = oneLine(title, 120)
  if (named === '') return refuse('form')
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  file.lines[found.start] = file.lines[found.start].replace(GOAL_LINE, (all, pad, mark, goal) => `${pad}- [${mark}] ${goal} ${named}`)
  return { ok: true, text: join(file) }
}

export function setGoalState(text, id, state) {
  if (typeof state !== 'string' || !Object.hasOwn(STATE_MARK, state)) return refuse('form')
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  file.lines[found.start] = file.lines[found.start].replace(/^( *)- \[[ ~xX]\]/, `$1- [${STATE_MARK[state]}]`)
  return { ok: true, text: join(file) }
}

/** `Done when:`, `Why:`, `Steps:`: replaced where it stands, else added first under the goal; '' removes it. */
export function setGoalLine(text, id, name, value) {
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const line = `${' '.repeat(found.depth + 2)}${name}: ${value}`
  const at = ownLines(file.lines, found).find(index => file.lines[index].trimStart().startsWith(`${name}:`))
  if (at !== undefined) {
    if (value === '') file.lines.splice(at, 1)
    else file.lines[at] = line
  } else if (value !== '') file.lines.splice(found.start + 1, 0, line)
  return { ok: true, text: join(file) }
}

function appendOwnLine(text, id, line) {
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  file.lines.splice(ownLinesEnd(file.lines, found), 0, `${' '.repeat(found.depth + 2)}${line}`)
  return { ok: true, text: join(file) }
}

/** B358: one more line of the goal's own (a re-check's outcome, an overturn), after its own lines. */
export function addGoalLine(text, id, line) {
  const words = oneLine(line, 1200)
  return words === '' ? refuse('form') : appendOwnLine(text, id, words)
}

/** B383: a goal's Missing line taken out, by its words (the first of its own lines that reads so); `gone` without it. */
export function removeGoalMissing(text, id, line) {
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const words = String(line ?? '').replace(/\s+/g, ' ').trim()
  const at = ownLines(file.lines, found).find(index => file.lines[index].trim().replace(/\s+/g, ' ') === `Missing: ${words}`)
  if (at === undefined || words === '') return refuse('missing')
  file.lines.splice(at, 1)
  return { ok: true, text: join(file) }
}

/**
 * B680: `Part dropped: <part title> · <date time> · <why>` under the goal, for a part the person stops. The part must be one of
 * the goal's `Part:` lines and the why must say something; a part dropped already changes nothing.
 */
export function dropPart(text, id, part, why, at) {
  const title = oneLine(part, 160).replaceAll(' · ', ', ')
  const words = oneLine(why, 300)
  if (title === '' || words === '') return refuse('form')
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const own = ownLines(file.lines, found).map(index => file.lines[index].trim())
  if (!own.some(line => line.startsWith('Part:') && line.slice('Part:'.length).split(' · ')[0].trim() === title)) return refuse('part')
  if (own.some(line => line.startsWith('Part dropped:') && line.slice('Part dropped:'.length).split(' · ')[0].trim() === title)) return { ok: true, text }
  return appendOwnLine(text, id, `Part dropped: ${title} · ${at} · ${words}`)
}

/**
 * B692: a part's drop taken back, in any order and after a restart: only that goal's `Part dropped: <title> ·` line goes;
 * refused when no such line stands.
 */
export function undropPart(text, id, part) {
  const title = oneLine(part, 160).replaceAll(' · ', ', ')
  if (title === '') return refuse('form')
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const at = ownLines(file.lines, found).find(index => {
    const line = file.lines[index].trim()
    return line.startsWith('Part dropped:') && line.slice('Part dropped:'.length).split(' · ')[0].trim() === title
  })
  if (at === undefined) return refuse('undrop')
  file.lines.splice(at, 1)
  return { ok: true, text: join(file) }
}

export function addGoalNote(text, id, note) {
  const words = oneLine(note, 300)
  return words === '' ? refuse('form') : appendOwnLine(text, id, `Note: ${words}`)
}

/** B258: the lines of an ask, as src/goals.mjs reads them: the ask, its answer, its page, its read mark. */
const ASK_HEAD = /^Ask \(A\d+, [^)]+\):/
const ANSWER_HEAD = /^Answer \([^,]+, [^)]+\):/
const ASK_PART = /^(?:Ask \(A\d+, [^)]+\):|Answer \([^,]+, [^)]+\):|More:|Read:)/

/**
 * B258: an ask to the Advisor under the goal: `Ask (A<n>, <at>): <the question, as one line>`, after the goal's last
 * ask and its lines (also when those stand after its goals inside, as the map reads them), else after its own lines.
 */
export function addGoalAsk(text, id, { askId, at, question }) {
  const words = oneLine(question, 2000)
  if (words === '') return refuse('form')
  const line = `Ask (${askId}, ${at}): ${words}`
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const asks = ownLines(file.lines, found).filter(index => ASK_PART.test(file.lines[index].trim()))
  if (asks.length === 0) return appendOwnLine(text, id, line)
  file.lines.splice(asks.at(-1) + 1, 0, `${' '.repeat(found.depth + 2)}${line}`)
  return { ok: true, text: join(file) }
}

/**
 * B258: `Read: <at>` after the ask's answer (its last Answer or More line): the person read it. The ask's lines are its
 * goal's own lines up to its next ask, as src/goals.mjs reads them, other lines (a note) in between too. Refused `none`
 * when the goal holds no such ask or the ask has no answer yet; an ask read already stays as it is.
 */
export function markAskRead(text, id, askId, at) {
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const own = ownLines(file.lines, found)
  const head = own.findIndex(index => file.lines[index].trim().startsWith(`Ask (${askId}, `))
  if (head < 0) return refuse('none')
  let last = null
  let isRead = false
  for (const index of own.slice(head + 1)) {
    const line = file.lines[index].trim()
    if (ASK_HEAD.test(line)) break
    if (ANSWER_HEAD.test(line) || (last !== null && line.startsWith('More:'))) last = index
    if (line.startsWith('Read:')) isRead = true
  }
  if (last === null) return refuse('none')
  if (isRead) return { ok: true, text }
  file.lines.splice(last + 1, 0, `${' '.repeat(found.depth + 2)}Read: ${at}`)
  return { ok: true, text: join(file) }
}

/** B259: what a brainstorm decided, under the goal it was about: `Note (brainstorm <date>): <the note>`, after its own lines. */
export function addBrainstormNote(text, id, date, note) {
  const words = oneLine(note, 600)
  return words === '' ? refuse('form') : appendOwnLine(text, id, `Note (brainstorm ${date}): ${words}`)
}

export const setGoalSteps = (text, id, ids) => setGoalLine(text, id, 'Steps', [...new Set(ids.filter(one => /^B\d+$/.test(one)))].join(', '))

/** "Change this goal" (2026-10-31): the lines a change of the goal writes, by their names. */
const CHANGE_LINE = /^(?:Objective|Not in it|Done when \d+):/
const bulletLine = (n, text, steps) => {
  const ids = [...new Set((steps ?? []).filter(one => /^B\d+$/.test(one)))]
  return `Done when ${n}: ${oneLine(text, 300)}${ids.length === 0 ? '' : ` · steps ${ids.join(', ')}`}`
}

/**
 * "Change this goal" (2026-10-31): the goal's new definition as a change brainstorm agreed it, `Objective: <one line>`,
 * `Done when <n>: <bullet> · steps B<n>, B<n>` per bullet (`bullets`: `{ n, text, steps }`, its steps left out while
 * none) and `Not in it: <one line>`, in place of the ones it had, where the first of them stood, else after its own
 * lines at its top. The old one-line `Done when:` stays as it is, and so does every other line.
 */
export function setGoalChange(text, id, { objective, bullets, notInIt }) {
  const aim = oneLine(objective, 300)
  const list = (Array.isArray(bullets) ? bullets : []).filter(one => Number.isInteger(one?.n) && one.n > 0 && oneLine(one.text, 300) !== '')
  if (aim === '' || list.length === 0) return refuse('form')
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const own = ownLines(file.lines, found).filter(index => CHANGE_LINE.test(file.lines[index].trimStart()))
  const at = own.length > 0 ? own[0] : ownLinesEnd(file.lines, found)
  for (const index of own.toReversed()) file.lines.splice(index, 1)
  const out = oneLine(notInIt, 300)
  const lines = [`Objective: ${aim}`, ...list.map(one => bulletLine(one.n, one.text, one.steps)), ...(out === '' ? [] : [`Not in it: ${out}`])]
  file.lines.splice(at, 0, ...lines.map(line => `${' '.repeat(found.depth + 2)}${line}`))
  return { ok: true, text: join(file) }
}

/**
 * "Change this goal": a step made for bullet `n` of the goal's Done when, added to that bullet's steps (once). A goal
 * without that bullet stays as it is.
 */
export function addDoneWhenStep(text, id, n, step) {
  if (!/^B\d+$/.test(String(step))) return refuse('form')
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const at = ownLines(file.lines, found).find(index => file.lines[index].trimStart().startsWith(`Done when ${n}:`))
  if (at === undefined) return { ok: true, text }
  const bullet = doneBulletOf(n, file.lines[at].trimStart().slice(`Done when ${n}:`.length))
  if (bullet.steps.includes(step)) return { ok: true, text }
  file.lines[at] = `${' '.repeat(found.depth + 2)}${bulletLine(n, bullet.text, [...bullet.steps, step])}`
  return { ok: true, text: join(file) }
}

/** "Change this goal": the person's words about the goal kept as a point under it, `Your words: <date time> · <words>`. */
export function addYourWords(text, id, at, words) {
  const said = oneLine(words, 2000)
  return said === '' ? refuse('form') : appendOwnLine(text, id, `Your words: ${oneLine(at, 40)} · ${said}`)
}

/** The sentence the rules at the top of the map get for the lines of a goal's change (`withChangeRules`). */
export const CHANGE_RULES = 'A goal changed with "Change this goal" also has "Objective: <one line>", "Done when <n>: <a bullet one can check> · steps B<n>, B<n>" (one per bullet; its old "Done when:" stays), "Not in it: <one line>", and "Your words: <date time> · <the person\'s words>" for each thing the person said about it.'

/**
 * "Change this goal": the rules paragraph at the top of the map (the margin lines from "Rules:" on, up to a blank line
 * or the first goal) names the change's lines: the sentence `CHANGE_RULES` added after it once, unless it names them
 * already. A map without a rules paragraph is left as it is.
 */
export function withChangeRules(text) {
  const file = split(text)
  const firstGoal = file.lines.findIndex(line => GOAL_LINE.test(line))
  const head = firstGoal < 0 ? file.lines.length : firstGoal
  const start = file.lines.slice(0, head).findIndex(line => line.startsWith('Rules:'))
  if (start < 0) return text
  let end = start + 1
  while (end < head && file.lines[end].trim() !== '' && !/^\s/.test(file.lines[end]) && !LAST_LINE.test(file.lines[end]) && !FOCUS_LINE.test(file.lines[end]) && !file.lines[end].startsWith('#')) end += 1
  const words = file.lines.slice(start, end).join(' ')
  if (words.includes(CHANGE_RULES) || (words.includes('"Objective:') && words.includes('"Your words:') && words.includes('"Not in it:') && words.includes('"Done when <n>:'))) return text
  file.lines.splice(end, 0, CHANGE_RULES)
  return join(file)
}

/** A link line's value of ids alone ("G1, G7"): rewritten as ids; one with words of its own keeps them. */
const ONLY_IDS = /^[\s,]*(?:G\d+[\s,]*)*$/
const idsIn = value => value.match(/\bG\d+\b/g) ?? []

/** The value with `target` added; words in it stay, the id goes at its end. */
function valueWith(value, target) {
  if (idsIn(value).includes(target)) return value.trim()
  return ONLY_IDS.test(value) ? [...idsIn(value), target].join(', ') : `${value.trim().replace(/,\s*$/, '')}, ${target}`
}

/** The value without `target`; words in it stay. '' when nothing is left. */
function valueWithout(value, target) {
  if (ONLY_IDS.test(value)) return idsIn(value).filter(one => one !== target).join(', ')
  return value.replace(new RegExp(`\\b${target}\\b\\s*,?\\s*`), '').replace(/^[\s,]+|[\s,]+$/g, '')
}
/**
 * `Enables: G7` or `Also part of: G5`, one line per name with the targets in it. A goal is no target of its own: not
 * itself, and for "Also part of" not its home nor a goal inside it.
 */
export function addGoalLink(text, id, name, target) {
  if (!LINKS.includes(name)) return refuse('form')
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const other = blockOf(file.lines, target)
  if (!other.ok || target === id) return refuse('target')
  if (name === 'Also part of' && (homeOf(file.lines, found.start) === target || (other.start > found.start && other.start < found.end))) return refuse('target')
  const at = ownLines(file.lines, found).find(index => file.lines[index].trimStart().startsWith(`${name}:`))
  if (at === undefined) return appendOwnLine(text, id, `${name}: ${target}`)
  file.lines[at] = `${' '.repeat(found.depth + 2)}${name}: ${valueWith(file.lines[at].slice(file.lines[at].indexOf(':') + 1), target)}`
  return { ok: true, text: join(file) }
}

export function removeGoalLink(text, id, name, target) {
  if (!LINKS.includes(name)) return refuse('form')
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const at = ownLines(file.lines, found).find(index => file.lines[index].trimStart().startsWith(`${name}:`))
  if (at === undefined) return { ok: true, text }
  const left = valueWithout(file.lines[at].slice(file.lines[at].indexOf(':') + 1), target)
  if (left === '') file.lines.splice(at, 1)
  else file.lines[at] = `${' '.repeat(found.depth + 2)}${name}: ${left}`
  return { ok: true, text: join(file) }
}

/** A new open goal: the last child of `parent`, right after the sibling `after` and its block, or last in the file. */
export function addGoal(text, { parent = null, after = null, title, id }) {
  const named = oneLine(title, 120)
  if (named === '') return refuse('form')
  const file = split(text)
  if (blockOf(file.lines, id).why !== 'gone') return refuse('twice')
  let at
  let depth
  if (after !== null) {
    const sibling = blockOf(file.lines, after)
    if (!sibling.ok) return sibling
    at = sibling.end
    depth = sibling.depth
  } else if (parent === null) {
    at = file.lines.length
    depth = 0
  } else {
    const found = blockOf(file.lines, parent)
    if (!found.ok) return found
    at = found.end
    depth = found.depth + 2
  }
  file.lines.splice(at, 0, `${' '.repeat(depth)}- [ ] ${id} ${named}`)
  return { ok: true, text: join(file) }
}

/** The goal's whole block, re-indented, as child number `index` of `parent` (null: the top); never into itself. */
export function moveGoal(text, id, { parent = null, index = 0 }) {
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const block = file.lines.slice(found.start, found.end)
  if (parent !== null && block.some(line => goalId(line) === parent)) return refuse('cycle')
  const rest = [...file.lines.slice(0, found.start), ...file.lines.slice(found.end)]
  const target = parent === null ? null : blockOf(rest, parent)
  if (target !== null && !target.ok) return target
  const children = childStarts(rest, target)
  const at = index >= 0 && index < children.length ? children[index] : target === null ? rest.length : target.end
  rest.splice(at, 0, ...reindent(block, found.depth, target === null ? 0 : target.depth + 2))
  return { ok: true, text: join({ ...file, lines: rest }) }
}

/** A new goal where the first of `ids` stood, with them inside it in their order; one inside another chosen stays put. */
export function groupGoals(text, chosen, { title, id }) {
  const tree = parseGoals(text)
  const isInsideChosen = one => {
    const seen = new Set()
    for (let up = tree.byId.get(one)?.parent ?? null; up !== null && !seen.has(up); up = tree.byId.get(up)?.parent ?? null) {
      if (chosen.includes(up)) return true
      seen.add(up)
    }
    return false
  }
  const ids = chosen.filter(one => !isInsideChosen(one))
  if (ids.length === 0) return refuse('form')
  const file = split(text)
  const first = blockOf(file.lines, ids[0])
  if (!first.ok) return first
  const parent = homeOf(file.lines, first.start)
  const goals = parseGoals(text)
  const order = parent === null ? goals.roots : goals.byId.get(parent)?.children ?? []
  const added = addGoal(text, { parent: null, after: null, title, id })
  if (!added.ok) return added
  let out = moveGoal(added.text, id, { parent, index: Math.max(0, order.indexOf(ids[0])) })
  ids.forEach((one, position) => {
    if (out.ok) out = moveGoal(out.text, one, { parent: id, index: position })
  })
  return out
}

/** `Enables:` and `Also part of:` lines that name the id, without it; a line left empty goes; every other line stays. */
function dropReferences(text, id) {
  const file = split(text)
  file.lines = file.lines.flatMap(line => {
    const named = line.match(/^( *)(Enables|Also part of):(.*)$/)
    if (named === null || !idsIn(named[3]).includes(id)) return [line]
    const left = valueWithout(named[3], id)
    return left === '' ? [] : [`${named[1]}${named[2]}: ${left}`]
  })
  return join(file)
}

/** Its children lifted one level into its place; its own lines, wherever they stand, and the references to it go. */
export function dissolveGoal(text, id) {
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const lifted = childStarts(file.lines, found).flatMap(start => reindent(file.lines.slice(start, blockEnd(file.lines, start)), indentOf(file.lines[start]), found.depth))
  file.lines.splice(found.start, found.end - found.start, ...lifted)
  return { ok: true, text: dropReferences(join(file), id) }
}

/** The goal and its lines out, and the references to it; a goal with goals inside is refused (dissolve it first). */
export function deleteGoal(text, id) {
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  if (childStarts(file.lines, found).length > 0) return refuse('children')
  file.lines.splice(found.start, found.end - found.start)
  return { ok: true, text: dropReferences(join(file), id) }
}

/**
 * Focus 1 (spec 2026-10-18, section 5): the focus goal as the head line `Focus: G<n>`, in place where it stands, else
 * right after the head's "Last" lines, else under the file's first heading, else on top; null takes it out. A goal
 * that is not in the map is refused `gone`.
 */
export function setFocus(text, id) {
  const file = split(text)
  const firstGoal = file.lines.findIndex(line => GOAL_LINE.test(line))
  const head = firstGoal < 0 ? file.lines.length : firstGoal
  const at = file.lines.slice(0, head).findIndex(line => FOCUS_LINE.test(line))
  if (id === null) {
    if (at < 0) return { ok: true, text }
    file.lines.splice(at, 1)
    return { ok: true, text: join(file) }
  }
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const line = `Focus: ${id}`
  if (at >= 0) {
    file.lines[at] = line
    return { ok: true, text: join(file) }
  }
  const lastLines = file.lines.slice(0, head).flatMap((one, index) => (LAST_LINE.test(one) ? [index] : []))
  const heading = file.lines.slice(0, head).findIndex(one => one.startsWith('# '))
  file.lines.splice(lastLines.length > 0 ? lastLines.at(-1) + 1 : heading >= 0 ? heading + 1 : 0, 0, line)
  return { ok: true, text: join(file) }
}

/**
 * Focus 1: the goal's own lines whose name is one of `names` replaced by `lines` (without their indentation), where
 * the first of them stood, else after its own lines at its top; every other line stays.
 */
function replaceOwn(text, id, names, lines) {
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const isNamed = index => names.some(name => file.lines[index].trimStart().startsWith(`${name}:`))
  const own = ownLines(file.lines, found).filter(isNamed)
  const at = own.length > 0 ? own[0] : ownLinesEnd(file.lines, found)
  for (const index of own.toReversed()) file.lines.splice(index, 1)
  file.lines.splice(at, 0, ...lines.map(line => `${' '.repeat(found.depth + 2)}${line}`))
  return { ok: true, text: join(file) }
}

/** Focus 1: an agreed line (`Vibe agreed: <at>`) once, after the goal's last line of `after`, else after its own lines at its top. */
function agreeOnce(text, id, name, after, at) {
  const file = split(text)
  const found = blockOf(file.lines, id)
  if (!found.ok) return found
  const own = ownLines(file.lines, found)
  if (own.some(index => file.lines[index].trimStart().startsWith(`${name}:`))) return { ok: true, text }
  const last = own.filter(index => after.some(one => file.lines[index].trimStart().startsWith(`${one}:`))).at(-1)
  file.lines.splice(last === undefined ? ownLinesEnd(file.lines, found) : last + 1, 0, `${' '.repeat(found.depth + 2)}${name}: ${oneLine(at, 40)}`)
  return { ok: true, text: join(file) }
}

const VIBE = ['Vibe', 'Vibe picture']
const HOW = ['Part', 'Partner decides', 'You decide']
const words = (list, max) => (Array.isArray(list) ? list.map(one => oneLine(one, max)).filter(one => one !== '') : [])

/** Focus 1: the goal's vibe, `Vibe:` one line per point and `Vibe picture:` (null: none), in place of the ones it had. */
export function setVibe(text, id, lines, picture) {
  const shown = oneLine(picture, 300)
  return replaceOwn(text, id, VIBE, [...words(lines, 300).map(one => `Vibe: ${one}`), ...(shown === '' ? [] : [`Vibe picture: ${shown}`])])
}

/** Focus 1: `Part: <title> · <size> · steps B<n>, B<n>` per part, then `Partner decides:` and `You decide:` lines. */
export function setHow(text, id, how) {
  if (how === null || typeof how !== 'object' || !Array.isArray(how.parts)) return refuse('form')
  const parts = how.parts.flatMap(part => {
    const title = oneLine(part?.title, 160).replaceAll(' · ', ', ')
    if (title === '') return []
    const size = oneLine(part.size, 40).replaceAll(' · ', ', ')
    const steps = [...new Set((Array.isArray(part.steps) ? part.steps : []).filter(one => /^B\d+$/.test(one)))]
    return [`Part: ${[title, ...(size === '' ? [] : [size]), ...(steps.length === 0 ? [] : [`steps ${steps.join(', ')}`])].join(' · ')}`]
  })
  return replaceOwn(text, id, HOW, [...parts, ...words(how.partnerDecides, 300).map(one => `Partner decides: ${one}`), ...words(how.youDecide, 300).map(one => `You decide: ${one}`)])
}

/** Focus 1: `Vibe agreed: <at>`, once (a second agree keeps the first). */
export const agreeVibe = (text, id, at) => agreeOnce(text, id, 'Vibe agreed', VIBE, at)

/** Focus 1: `How agreed: <at>`, once, after the how's lines. */
export const agreeHow = (text, id, at) => agreeOnce(text, id, 'How agreed', HOW, at)

/** Focus 3: the goal's `How agreed` line taken away (the vibe is not there yet: the how is talked about again). */
export const reopenHow = (text, id) => replaceOwn(text, id, ['How agreed'], [])

const pad = value => String(value).padStart(2, '0')
/** This machine's day, as the copy is named. */
const dayOf = ms => `${new Date(ms).getFullYear()}-${pad(new Date(ms).getMonth() + 1)}-${pad(new Date(ms).getDate())}`
/** B258: this machine's minute, as an ask and its Read mark are dated ("2026-10-15 20:05"). */
const minuteOf = ms => `${dayOf(ms)} ${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`

/** The file as it is, kept as `<dir>/<yyyy-mm-dd>.md` once a day: before the board's first change of that day. */
export async function historyCopy(file, dir, date, fs = files) {
  const copy = `${dir.replace(/[\\/]+$/, '')}/${date}.md`
  if (await fs.access(copy).then(() => true, () => false)) return
  const bytes = await fs.readFile(file).catch(() => null)
  if (bytes === null) return
  await fs.mkdir(dir, { recursive: true }).catch(() => {})
  // B406: whole or not there, so a copy cut off is never taken for the day's: one that could not be written is made
  // at the next change, and the change goes ahead either way.
  await writeAtomic(copy, bytes, fs).catch(() => {})
}

const WHY = {
  gone: [404, 'That goal is no longer in the map.'],
  twice: [409, 'Two goals have that id: change the file by hand.'],
  target: [409, 'That goal cannot be linked there.'],
  cycle: [409, 'A goal cannot be moved into itself.'],
  children: [409, 'It has goals inside: dissolve it first.'],
  form: [400, 'Not a change the board knows.'],
  question: [400, 'Say what you want to know.'],
  none: [409, 'That ask is not under this goal, or has no answer to read yet.'],
  plan: [409, "That is the game plan's own line: change it through the plan."],
  // B383: a Missing line dismissed or made into a step meanwhile.
  missing: [409, 'That line is not missing any more: the map changed meanwhile.'],
  // B354: a goal is ticked against its Done when.
  doneWhen: [409, 'A goal gets its tick only with a Done when that says how you check it: write it with "Done when…", or ask your partner to.'],
  encoding: [409, 'The map is not UTF-8 text: change it by hand first.'],
  tabs: [409, 'The map has lines indented with tabs: make them two spaces per level by hand first.'],
  part: [409, 'That is not a part of this goal, or it has no reason: say why in one line.'],
  undrop: [409, 'That part is not dropped any more: nothing to take back.'],
  write: [500, 'The goal map could not be written.'],
}

/** What the game plan owns on a goal marked "From the game plan:" (spec section 1): its title, its Done when, and that it is there. */
const PLAN_OWNS = body => ['rename', 'delete', 'dissolve'].includes(body.command) || (body.command === 'line' && body.name === 'Done when')

/**
 * The changes made from each page (spec section 3: "the last twenty changes made in this page"), newest last: the
 * file, the page, its text before and after (as read, latin1). At most twenty per page.
 */
const undone = []
const UNDO_MOST = 20

const readText = (fs, file) => fs.readFile(file).then(bytes => bytes.toString('latin1'), () => null)
const isId = value => typeof value === 'string' && /^G\d+$/.test(value)
const isAskId = value => typeof value === 'string' && /^A\d+$/.test(value)
/** B258: an ask was typed into the Advisor's chat, and a read answer is read: no change the page's undo takes back. */
const isMessage = body => body.command === 'ask' || body.command === 'read' || (body.command === 'line' && body.name === 'Recheck asked')
const isParent = value => value === null || value === undefined || isId(value)
/** The page a change came from: its own word, so each page undoes its own changes. */
const pageOf = body => (typeof body.page === 'string' && /^[0-9a-z]{4,40}$/.test(body.page) ? body.page : '')

/**
 * B257: the head line that keeps an id from coming back ("Last id: G12", or "Last ask: A3" for an ask), raised to
 * `id` when it is lower: in place where it stands, else right under the file's first heading, else on top.
 */
export function raiseLastLine(text, id) {
  const [, letter, number] = id.match(/^([GA])(\d+)$/)
  const name = letter === 'G' ? 'id' : 'ask'
  const file = split(text)
  const at = file.lines.findIndex(line => (line.match(LAST_LINE)?.[1] ?? null) === name)
  if (at >= 0) {
    if (Number(file.lines[at].match(LAST_LINE)[2]) >= Number(number)) return text
    file.lines[at] = `Last ${name}: ${id}`
    return join(file)
  }
  const firstGoal = file.lines.findIndex(line => GOAL_LINE.test(line))
  const heading = file.lines.findIndex(line => line.startsWith('# '))
  file.lines.splice(heading >= 0 && (firstGoal < 0 || heading < firstGoal) ? heading + 1 : 0, 0, `Last ${name}: ${id}`)
  return join(file)
}
const withLastLine = (done, id) => (done.ok ? { ok: true, text: raiseLastLine(done.text, id) } : done)

/** The change a body asks for, on the file's text (UTF-8); `made` hears the id of a goal or an ask it makes. */
function changeFor(body, made, now) {
  const id = body.id
  switch (body.command) {
    case 'add': return text => {
      const next = nextGoalId(parseGoals(text))
      made(next)
      return isParent(body.parent) && isParent(body.after) ? withLastLine(addGoal(text, { parent: body.parent ?? null, after: body.after ?? null, title: oneLine(body.title, 120) || 'New goal', id: next }), next) : refuse('form')
    }
    case 'rename': return text => renameGoal(text, id, body.title)
    case 'state': return text => setGoalState(text, id, body.state)
    // B358: the person takes a goal's re-check back: its "Recheck asked" line goes (it is only ever removed here).
    case 'line': return text => (['Done when', 'Why'].includes(body.name) ? setGoalLine(text, id, body.name, oneLine(body.value, 300))
      : body.name === 'Recheck asked' && body.value === '' ? setGoalLine(text, id, body.name, '') : refuse('form'))
    case 'note': return text => addGoalNote(text, id, body.value)
    // B680: the person stops a part that reached nothing; it counts out of the whole.
    case 'part-drop': return text => dropPart(text, id, body.part, body.text, minuteOf(now))
    // B692: the person takes a part's drop back: that part's own line goes, whatever else changed since.
    case 'part-undrop': return text => undropPart(text, id, body.part)
    // B383: the Goals page's right panel: a Missing line dismissed.
    case 'missing-dismiss': return text => removeGoalMissing(text, id, body.line)
    case 'link': return text => addGoalLink(text, id, body.name, body.target)
    case 'unlink': return text => removeGoalLink(text, id, body.name, body.target)
    case 'steps': return text => (Array.isArray(body.ids) ? setGoalSteps(text, id, body.ids) : refuse('form'))
    case 'move': return text => (isParent(body.parent) && Number.isInteger(body.index) ? moveGoal(text, id, { parent: body.parent ?? null, index: body.index }) : refuse('form'))
    case 'group': return text => {
      if (!Array.isArray(body.ids) || body.ids.length === 0 || !body.ids.every(isId)) return refuse('form')
      const next = nextGoalId(parseGoals(text))
      made(next)
      return withLastLine(groupGoals(text, [...new Set(body.ids)], { title: oneLine(body.title, 120) || 'New goal', id: next }), next)
    }
    case 'dissolve': return text => dissolveGoal(text, id)
    case 'delete': return text => deleteGoal(text, id)
    // B258: an ask to the Advisor under the goal, with the next ask id, and the Read mark after its answer.
    case 'ask': return text => {
      if (oneLine(body.text, 2000) === '') return refuse('question')
      const next = nextAskId(parseGoals(text))
      made(next)
      return withLastLine(addGoalAsk(text, id, { askId: next, at: minuteOf(now), question: body.text }), next)
    }
    case 'read': return text => (isAskId(body.ask) ? markAskRead(text, id, body.ask, minuteOf(now)) : refuse('form'))
    default: return null
  }
}

/**
 * B259: one change to the goal map from elsewhere on the board (a brainstorm's Create): `change(text)` on the file's
 * UTF-8 text, to `{ ok, text }` or `{ ok: false, why }`. Read, checked and written as a change of the Goals part (a file
 * that is not UTF-8 or is indented with tabs is not changed), with the daily copy before; no undo. Answers what
 * `rewrite` answers, `why` also `encoding` or `tabs`.
 */
export async function changeGoalsFile(change, { file, historyDir, now, fs = files }) {
  await historyCopy(file, historyDir, dayOf(now), fs)
  return rewrite(file, latin => {
    const text = Buffer.from(latin, 'latin1').toString('utf8')
    if (Buffer.from(text, 'utf8').toString('latin1') !== latin) return refuse('encoding')
    if (/^ *\t/m.test(text)) return refuse('tabs')
    const done = change(text)
    return done.ok ? { ok: true, text: Buffer.from(done.text, 'utf8').toString('latin1') } : done
  }, fs)
}

/**
 * One change to the goal map from the page (`body.command`: add, rename, state, line, note, link, unlink, steps,
 * move, group, dissolve, delete, ask, read or undo, with the fields the functions above take). Only the board that delivers
 * writes (`canWrite`). The file is read anew right before the change and written beside, then put in place; a write
 * in between makes it read and change again, so the other side's text stays (Review Focus 2). Before the first change
 * of a day a copy goes to `historyDir`. Answers `{ ok: true, result: { id? } }` or `{ ok: false, status, why }`.
 */
export async function editGoals(body, { canWrite, file, historyDir, now, fs = files }) {
  if (canWrite !== true) return { ok: false, status: 403, why: 'This board only shows: change the goal map on the board that delivers.' }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, why: 'Not a change.' }
  if (body.command === 'undo') {
    const last = undone.findLast(one => one.file === file && one.page === pageOf(body))
    if (last === undefined) return { ok: false, status: 409, why: 'Nothing to undo.' }
    if (await readText(fs, file) !== last.after) return { ok: false, status: 409, why: 'The map changed since: nothing undone.' }
    const put = await rewrite(file, before => (before === last.after ? { ok: true, text: last.before } : refuse('changed')), fs)
    if (!put.ok) return { ok: false, status: 409, why: 'The map changed since: nothing undone.' }
    undone.splice(undone.lastIndexOf(last), 1)
    return { ok: true, result: {} }
  }
  const change = changeFor(body, made => { newId = made }, now)
  if (change === null) return { ok: false, status: 400, why: WHY.form[1] }
  if (!['add', 'group'].includes(body.command) && !isId(body.id)) return { ok: false, status: 400, why: 'Name the goal by its id (G12).' }
  let newId = null
  let before = null
  let after = null
  await historyCopy(file, historyDir, dayOf(now), fs)
  // The goal functions work on the file's UTF-8; the file is read and written as its bytes (latin1), as the ticks are.
  // A file that is not UTF-8, or indented with tabs, is not changed: its lines could not all come back as they were.
  const written = await rewrite(file, latin => {
    const text = Buffer.from(latin, 'latin1').toString('utf8')
    if (Buffer.from(text, 'utf8').toString('latin1') !== latin) return refuse('encoding')
    if (/^ *\t/m.test(text)) return refuse('tabs')
    const node = isId(body.id) ? parseGoals(text).byId.get(body.id) : undefined
    if (node?.fromPlan && PLAN_OWNS(body)) return refuse('plan')
    if (body.command === 'state' && body.state === 'done' && node !== undefined && node.state !== 'done' && !hasDoneWhen(node)) return refuse('doneWhen')
    const done = change(text)
    if (!done.ok) return done
    const next = Buffer.from(done.text, 'utf8').toString('latin1')
    // Nothing changed: no write, and nothing for undo.
    if (next === latin) return refuse('same')
    before = latin
    after = next
    return { ok: true, text: after }
  }, fs)
  if (!written.ok && written.why === 'same') return { ok: true, result: { unchanged: true } }
  if (!written.ok) {
    const [status, why] = WHY[written.why] ?? WHY.write
    return { ok: false, status, why }
  }
  if (isMessage(body)) return { ok: true, result: newId === null ? {} : { id: newId } }
  undone.push({ file, page: pageOf(body), before, after })
  const mine = undone.filter(one => one.file === file && one.page === pageOf(body))
  if (mine.length > UNDO_MOST) undone.splice(undone.indexOf(mine[0]), 1)
  return { ok: true, result: newId === null ? {} : { id: newId } }
}
