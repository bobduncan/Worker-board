// B256: every change to goals.md as text → text, by id, every other line untouched (spec 2026-10-15, sections 1 and
// 3), and `editGoals`, which writes one change to the file: read anew right before, written beside and put in place
// (tick.mjs `rewrite`), with a copy of the file before the first change of a day and an undo of the last twenty.
// A goal's block is its line and every following line indented deeper; its own lines are the block's lines that are
// not inside a child's block.
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'

import { GOAL_LINE, LAST_LINE, nextGoalId, parseGoals } from './goals.mjs'
import { rewrite } from './tick.mjs'

const files = { readFile, writeFile, rename, rm, mkdir, access }
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

export function addGoalNote(text, id, note) {
  const words = oneLine(note, 300)
  return words === '' ? refuse('form') : appendOwnLine(text, id, `Note: ${words}`)
}

export const setGoalSteps = (text, id, ids) => setGoalLine(text, id, 'Steps', [...new Set(ids.filter(one => /^B\d+$/.test(one)))].join(', '))

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

const pad = value => String(value).padStart(2, '0')
/** This machine's day, as the copy is named. */
const dayOf = ms => `${new Date(ms).getFullYear()}-${pad(new Date(ms).getMonth() + 1)}-${pad(new Date(ms).getDate())}`

/** The file as it is, kept as `<dir>/<yyyy-mm-dd>.md` once a day: before the board's first change of that day. */
export async function historyCopy(file, dir, date, fs = files) {
  const copy = `${dir.replace(/[\\/]+$/, '')}/${date}.md`
  if (await fs.access(copy).then(() => true, () => false)) return
  const bytes = await fs.readFile(file).catch(() => null)
  if (bytes === null) return
  await fs.mkdir(dir, { recursive: true }).catch(() => {})
  await fs.writeFile(copy, bytes).catch(() => {})
}

const WHY = {
  gone: [404, 'That goal is no longer in the map.'],
  twice: [409, 'Two goals have that id: change the file by hand.'],
  target: [409, 'That goal cannot be linked there.'],
  cycle: [409, 'A goal cannot be moved into itself.'],
  children: [409, 'It has goals inside: dissolve it first.'],
  form: [400, 'Not a change the board knows.'],
  plan: [409, "That is the game plan's own line: change it through the plan."],
  encoding: [409, 'The map is not UTF-8 text: change it by hand first.'],
  tabs: [409, 'The map has lines indented with tabs: make them two spaces per level by hand first.'],
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

/** The change a body asks for, on the file's text (UTF-8); `made` hears the id of a goal it makes. */
function changeFor(body, made) {
  const id = body.id
  switch (body.command) {
    case 'add': return text => {
      const next = nextGoalId(parseGoals(text))
      made(next)
      return isParent(body.parent) && isParent(body.after) ? withLastLine(addGoal(text, { parent: body.parent ?? null, after: body.after ?? null, title: oneLine(body.title, 120) || 'New goal', id: next }), next) : refuse('form')
    }
    case 'rename': return text => renameGoal(text, id, body.title)
    case 'state': return text => setGoalState(text, id, body.state)
    case 'line': return text => (['Done when', 'Why'].includes(body.name) ? setGoalLine(text, id, body.name, oneLine(body.value, 300)) : refuse('form'))
    case 'note': return text => addGoalNote(text, id, body.value)
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
    default: return null
  }
}

/**
 * One change to the goal map from the page (`body.command`: add, rename, state, line, note, link, unlink, steps,
 * move, group, dissolve, delete or undo, with the fields the functions above take). Only the board that delivers
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
  const change = changeFor(body, made => { newId = made })
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
  undone.push({ file, page: pageOf(body), before, after })
  const mine = undone.filter(one => one.file === file && one.page === pageOf(body))
  if (mine.length > UNDO_MOST) undone.splice(undone.indexOf(mine[0]), 1)
  return { ok: true, result: newId === null ? {} : { id: newId } }
}
