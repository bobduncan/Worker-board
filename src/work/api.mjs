// B297: the actions of the `work` tool and of the board's page on the work store (spec 2026-10-17, section 5). Every
// action is one request; the server validates it against the flow (flow.json) and writes the file, with one History
// line per change. Only the server writes the store: the chats call the tool (POST /api/bridge/work), the page calls
// POST /api/work, and the server's own writers call `workApi` with `as: 'server'` or `as: 'person'`.
//
// While the store is a shadow of the backlog (truth.json says "shadow"), nothing changes it but the shadow: every
// action that changes something is refused, and only `next` and `list` answer.

import { minutesOf } from '../backlog.mjs'
import { acceptRefine, answerRefine } from '../tick.mjs'
import { stepLine, stepNotes } from './adapter.mjs'
import { mayMove } from './flow.mjs'
import { ASK_KINDS, HEAD_KEYS, serializeItem, validateHead, valueOf } from './item.mjs'
import { lineFields } from './line.mjs'
import { REFINED_MARK, migrateBacklog, stamp } from './migrate.mjs'
import { appendHistory, nextId, putBack, readActivitiesText, readItemFile, readStore, removeItem, writeActivities, writeItem } from './store.mjs'
import { writeView } from './view.mjs'

export const NOT_TRUTH = 'The store is not the truth yet: the cutover has not run'
/**
 * B297, review 1: whether the board lists the store's asks and lets the person answer them (Needs your attention, built
 * in B299). Until it does, a blocking ask would strand its step, so the cutover is refused. B299 sets it true.
 */
export const BOARD_ANSWERS_ASKS = false
const READS = new Set(['next', 'list'])
const CHANGES = new Set(['take', 'step', 'ask', 'withdraw', 'answered-in-chat', 'read', 'note', 'report', 'block', 'unblock', 'new', 'queue', 'close', 'drop', 'refine', 'refined', 'answer', 'tick', 'delete', 'refine-answer', 'refine-accept', 'check', 'instruction', 'turn-ended'])
/** B298: what never shows on the backlog view: it is not written anew for these. */
const OFF_VIEW = new Set(['instruction', 'turn-ended', 'close', 'read', 'answered-in-chat'])
/** What only the person does, on the board's page; and what only the server does. */
const PERSON = new Set(['answer', 'read', 'tick', 'delete', 'refine-answer', 'refine-accept'])
const SERVER = new Set(['check'])
/** Who may do what the flow does not decide (the default flow's table, spec section 5). */
const ROLES = {
  block: ['main', 'worker', 'person'],
  unblock: ['main', 'worker', 'person'],
  new: ['main', 'worker', 'advisor', 'person'],
  refine: ['advisor', 'main'],
}
/** The order of a chat's own steps in `next`: what it works on first. */
const MINE = ['in progress', 'waiting on you', 'taken', 'review', 'queued']
const HELD = ['taken', 'in progress', 'waiting on you', 'review']
const STEP_ID = /^B\d+$/
const ANY_ID = /^(?:[A-Z]\d+|L-[0-9a-f]{8})$/
const ONLY_IDS = /^B\d+(?:(?:\s*,\s*|\s+and\s+)B\d+)*$/
const TEXT_CHARS = 4000
const LINE_CHARS = 300

const refuse = (status, why) => ({ ok: false, status, why })

/** One line of words: no line ends, at most `max` characters; '' for none. */
const line = (value, max = LINE_CHARS) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')
/** Lines of words, blank ones left out, each at most `max` characters. */
const lines = (value, max = TEXT_CHARS) => {
  const all = Array.isArray(value) ? value.filter(one => typeof one === 'string') : typeof value === 'string' ? value.split('\n') : []
  return all.map(one => one.replace(/\s+$/, '').slice(0, max)).filter(one => one.trim() !== '')
}
const idsIn = value => (value ?? '').match(/\bB\d+\b/g) ?? []
/** A chat's name as the list writes it, without the title's prefix, for comparing. */
const plain = (name, prefix = '') => {
  let words = String(name ?? '').trim()
  if (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase())) words = words.slice(prefix.length)
  return words.trim().toLowerCase()
}
const at = now => stamp(now).replace(' ', ' at ')
/** B298: the time to the second, for an instruction's Since: a turn that starts a moment later can tell it. */
const toSecond = now => `${stamp(now)}:${String(new Date(now).getSeconds()).padStart(2, '0')}`
/** B298: a Since as a time; the start of its minute (or second) as written. NaN when it is none. */
export function sinceMs(value) {
  const found = String(value ?? '').match(/^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d)(?::(\d\d))?)?$/)
  if (found === null) return Number.NaN
  const [, y, m, d, h = 0, min = 0, sec = 0] = found
  return new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(sec)).getTime()
}

/** One request after the other per store folder: two takes of one step never interleave. */
const turns = new Map()
function serial(dir, run) {
  const turn = (turns.get(dir) ?? Promise.resolve()).then(run, run)
  turns.set(dir, turn.catch(() => {}))
  return turn
}

/**
 * One action on the store. `body = { action, chat, ...fields }`; `ctx = { dir, fs, now, as, roleOf, freeChats,
 * overlaps, prefix, viewFile, boardUrl }`: `as` is 'person' (the page) or 'server' (the board itself), else the chat
 * of `body.chat` asks, in the role `roleOf(chat)` gives ('main', 'worker', 'advisor', or null: no chat of the list).
 * `freeChats` the chats free now, `overlaps(item)` the id of a taken step whose Touches overlap, `viewFile` the
 * backlog file the view is written to after a change (none: not written).
 * Answers `{ ok: true, result: { text, id, changed, ... } }` or `{ ok: false, status, why }`.
 */
export function workApi(body, ctx) {
  return serial(ctx.dir, () => act(body, ctx))
}

async function act(body, ctx) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'Not a request.')
  const action = body.action
  if (!READS.has(action) && !CHANGES.has(action)) return refuse(400, `No action "${String(action).slice(0, 40)}": ${[...READS, ...CHANGES].join(', ')}.`)
  let who
  let role
  if (ctx.as === 'person' || ctx.as === 'server') {
    who = ctx.as
    role = ctx.as
  } else {
    who = line(body.chat, 80)
    if (who === '') return refuse(400, 'Name the chat.')
    role = ctx.roleOf?.(who) ?? null
    if (role === null) return refuse(403, `${who} is no chat of the list.`)
  }
  if (PERSON.has(action) && role !== 'person') return refuse(403, 'Only the person does that, on the board.')
  if (SERVER.has(action) && role !== 'server') return refuse(403, 'Only the board does that.')
  if (ROLES[action] !== undefined && !ROLES[action].includes(role)) return refuse(403, `Only ${ROLES[action].join(' or ')} ${action === 'new' ? 'makes a step' : `may ${action}`}.`)

  const store = await readStore(ctx.dir, ctx.fs)
  if (!store.exists) return refuse(409, `No work store in ${ctx.dir}.`)
  if (CHANGES.has(action) && store.truth !== 'store') return refuse(409, NOT_TRUTH)
  const now = ctx.now ?? Date.now()
  const w = { ...ctx, store, now, who, role, action }
  if (action === 'next') return next(body, w)
  if (action === 'list') return list(w)
  const done = await CHANGE[action](body, w)
  if (!done.ok || done.result.changed === false || !ctx.viewFile || OFF_VIEW.has(action)) return done
  // The view follows every change: whatever still reads backlog.md reads what the store says.
  const view = await writeView({ dir: ctx.dir, ...(await readStore(ctx.dir, ctx.fs)) }, ctx.viewFile, ctx.fs, { now })
  return { ok: true, result: { ...done.result, view: view.ok ? 'written' : view.why } }
}

// ---- reading ----

const kindOf = item => valueOf(item, 'Kind') ?? 'step'
const stateOf = item => valueOf(item, 'State')
const isOwner = (item, chat, prefix) => valueOf(item, 'Owner') !== null && plain(valueOf(item, 'Owner'), prefix) === plain(chat, prefix)
const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true })

/** One item in one line: id, state, what it waits for, title. */
function oneLine(item, items) {
  const open = idsIn(valueOf(item, 'Blocked by')).filter(id => !['done', 'dropped'].includes(stateOf(items.get(id) ?? { head: new Map() })))
  const waits = [open.length > 0 ? `after ${open.join(', ')}` : null, valueOf(item, 'Waits for') === null ? null : `after ${valueOf(item, 'Waits for')}`].filter(Boolean)
  const missed = Number(valueOf(item, 'Missed') ?? 0)
  const turns = missed > 0 ? `, missed ${missed} turn${missed === 1 ? '' : 's'}` : ''
  return `- ${valueOf(item, 'Id')} ${stateOf(item)}${turns}${waits.length > 0 ? ` (${waits.join('; ')})` : ''}: ${valueOf(item, 'Title') ?? valueOf(item, 'Text') ?? ''}`
}

/** `next`: the chat's open instructions, then its steps by state, each in one line; the first in full. */
function next(body, w) {
  const chat = w.role === 'person' || w.role === 'server' ? line(body.chat, 80) : w.who
  if (chat === '') return refuse(400, 'Name the chat.')
  const items = [...w.store.items.values()]
  const told = items.filter(item => kindOf(item) === 'instruction' && stateOf(item) === 'open' && plain(valueOf(item, 'Chat'), w.prefix) === plain(chat, w.prefix))
    .sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
  const mine = items.filter(item => kindOf(item) === 'step' && MINE.includes(stateOf(item)) && isOwner(item, chat, w.prefix))
    .sort((a, b) => MINE.indexOf(stateOf(a)) - MINE.indexOf(stateOf(b)) || byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
  const all = [...told, ...mine]
  const open = openOf(chat, w)
  if (all.length === 0) return { ok: true, result: { text: `Nothing is yours, ${chat}: no instruction is open and no step is taken, in progress or queued for you.`, items: [], open, changed: false } }
  const text = `Yours, ${chat}:\n${all.map(item => oneLine(item, w.store.items)).join('\n')}\n\n${serializeItem(all[0])}`
  return { ok: true, result: { text, items: all.map(item => valueOf(item, 'Id')), id: valueOf(all[0], 'Id'), open, changed: false } }
}

/** `list`: every item in one line, and as fields for the page. */
function list(w) {
  const items = [...w.store.items.values()].sort((a, b) => byId(valueOf(a, 'Id') ?? '', valueOf(b, 'Id') ?? ''))
  const rows = items.map(item => ({
    id: valueOf(item, 'Id'), kind: kindOf(item), state: stateOf(item), owner: valueOf(item, 'Owner'),
    title: valueOf(item, 'Title') ?? valueOf(item, 'Text'), since: valueOf(item, 'Since'),
  }))
  const text = rows.map(row => [row.id, row.kind, row.state, row.owner ?? '-', row.title ?? ''].join(' · ')).join('\n')
  return { ok: true, result: { text, items: rows, changed: false } }
}

// ---- writing ----

/** The item `id` as its file holds it now, or a refusal: not there, or its head is broken (fixed by hand first). */
async function load(id, w, { kind = null } = {}) {
  if (typeof id !== 'string' || !ANY_ID.test(id)) return refuse(400, 'Name the item by its id (B12, Q3, ...).')
  const file = await readItemFile(w.dir, id, w.fs)
  if (file === null) return refuse(404, `${id}: no such item in the store.`)
  const problem = file.item.problem ?? validateHead(file.item.head) ?? (valueOf(file.item, 'Id') === id ? null : `its Id is ${valueOf(file.item, 'Id')}`)
  if (problem !== null) return refuse(409, `${id}: its file is broken (${problem}); fix it by hand first.`)
  if (kind !== null && !kind.includes(kindOf(file.item))) return refuse(409, `${id} is ${kindOf(file.item) === 'ask' ? 'an ask' : `a ${kindOf(file.item)}`}, not ${kind.map(one => `a ${one}`).join(' or ')}.`)
  return { ok: true, item: file.item, text: file.text }
}

/** Writes the item while its file still holds `text` (null: a new one). */
async function save(item, text, w) {
  const done = await writeItem(w.dir, item, w.fs, { expected: text })
  return done.ok ? { ok: true } : refuse(409, `${valueOf(item, 'Id')}: ${done.why}; try again.`)
}

const copy = item => ({ ...item, head: new Map(item.head), sections: new Map(item.sections) })
const put = (item, key, value) => {
  if (value === null || value === undefined || value === '') item.head.delete(key)
  else item.head.set(key, value)
  return item
}
/** The head in the order its kind writes it. */
const ordered = item => {
  const order = HEAD_KEYS[kindOf(item)] ?? HEAD_KEYS.step
  return { ...item, head: new Map([...item.head].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))) }
}
const said = (item, w, what) => appendHistory(item, w.who, what, w.now)
/** Lines added under the step, as the backlog shows them. */
const underStep = (item, added) => {
  const next = copy(item)
  next.sections.set('Context', [...(item.sections.get('Context') ?? []), ...added.map(one => `  ${one.trim()}`)])
  return next
}

/** The flow's context for the guards: the store's items with the ones changed here, who is free. */
function flowCtx(w, changed = [], free = []) {
  const items = new Map(w.store.items)
  for (const item of changed) items.set(valueOf(item, 'Id'), item)
  const freeNames = [...(w.freeChats ?? []), ...free]
  // The flow's guard compares the Owner as written: a free chat counts under every way of writing its name.
  const freeChats = new Set(freeNames)
  for (const item of items.values()) {
    const owner = valueOf(item, 'Owner')
    if (owner !== null && freeNames.some(name => plain(name, w.prefix) === plain(owner, w.prefix))) freeChats.add(owner)
  }
  return { store: { items }, freeChats, now: w.now, overlaps: w.overlaps ?? (() => null) }
}

/** Moves the item by the flow, as `role`; the History says from where to where. */
function move(item, to, role, w, ctx = flowCtx(w, [item]), why = '') {
  const allowed = mayMove(w.store.flow, item, to, role, ctx)
  if (!allowed.ok) return refuse(409, allowed.why)
  const from = stateOf(item)
  const moved = put(copy(item), 'State', to)
  put(moved, 'Since', stamp(w.now))
  return { ok: true, item: appendHistory(moved, role === 'server' ? 'server' : w.who, `${from} → ${to}${why}`, w.now) }
}

const changed = (item, text = serializeItem(item), more = {}) => ({ ok: true, result: { id: valueOf(item, 'Id'), text, changed: true, ...more } })

/** Takes a step: queued for this chat (the board moves it to taken), or taken; then in progress, and the branch. */
async function take(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  let item = found.item
  const id = valueOf(item, 'Id')
  const state = stateOf(item)
  const owner = valueOf(item, 'Owner')
  if (HELD.includes(state) && owner !== null && !isOwner(item, w.who, w.prefix)) return refuse(409, `${id}: ${owner} holds it (${state}).`)
  if (state === 'in progress' && isOwner(item, w.who, w.prefix)) return { ok: true, result: { id, text: serializeItem(item), title: valueOf(item, 'Title'), changed: false } }
  // Review 2: a step the backlog showed in progress without naming its worker is the first taker's.
  if (state === 'in progress' && owner === null) {
    const claimed = ordered(said(put(copy(item), 'Owner', w.who), w, 'claimed (in progress)'))
    const done = await save(claimed, found.text, w)
    return done.ok ? changed(claimed, undefined, { title: valueOf(claimed, 'Title') }) : done
  }
  if (state === 'queued') {
    if (owner === null || !isOwner(item, w.who, w.prefix)) return refuse(409, `${id} is queued for ${owner ?? 'nobody'}, not for ${w.who}.`)
    // No reconciler moves it yet (increment 5): the chat that takes it is free for it.
    const taken = move(item, 'taken', 'server', w, flowCtx(w, [item], [w.who]), ` (for ${w.who})`)
    if (!taken.ok) return taken
    item = taken.item
  }
  const started = move(item, 'in progress', w.role, w)
  if (!started.ok) return started
  item = started.item
  const branch = line(body.branch, 120)
  if (branch !== '') {
    if (!/^[\w./-]+$/.test(branch)) return refuse(400, 'A branch is a name such as b12-the-strip.')
    put(item, 'Branch', branch)
  }
  const done = await save(ordered(item), found.text, w)
  return done.ok ? changed(ordered(item), undefined, { title: valueOf(item, 'Title') }) : done
}

/** A step of the chat's plan on the step it holds: one History line (the mod writes the card). */
async function step(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  if (!isOwner(found.item, w.who, w.prefix) || !['in progress', 'waiting on you'].includes(stateOf(found.item))) return refuse(409, `${id} is not in progress for ${w.who}: take it first.`)
  const names = Array.isArray(body.names) ? body.names.map(one => line(one, 60)).filter(Boolean) : []
  const total = names.length > 0 ? names.length : Number.isInteger(Number(body.steps)) && Number(body.steps) > 0 ? Number(body.steps) : null
  const number = body.step === undefined ? null : Number(body.step)
  if (number !== null && !(Number.isInteger(number) && number >= 1)) return refuse(400, '"step" is the number of the step you are on now.')
  const minutes = body.minutes === undefined ? null : Number(body.minutes)
  const name = number !== null ? names[number - 1] ?? line(body.name, 60) : line(body.name, 60)
  const words = [number === null ? 'a new plan' : `step ${number}${total === null ? '' : `/${total}`}`, name === '' || name === undefined ? null : name, Number.isFinite(minutes) && minutes > 0 ? `about ${Math.round(minutes)} min left` : null].filter(Boolean).join(', ')
  const item = said(found.item, w, words)
  const done = await save(item, found.text, w)
  return done.ok ? changed(item, `${id}: ${words}.`) : done
}

/** B299: a picture's name in a few words: its file's name without the folder and the extension. */
const pictureName = path => String(path).split('/').at(-1).replace(/\.[A-Za-z0-9]+$/, '').replace(/[-_]+/g, ' ').trim()
/** B299: where a play link starts the game, in a few words: its settings, else its branch. */
const playWhere = play => {
  const [branch, ...settings] = String(play).split('&')
  return settings.length > 0 ? settings.join(', ').replaceAll('=', ' ') : branch
}

/**
 * The "For you" block an ask puts in the chat's answer, so chat and board say the same. B299: in the project's form:
 * one numbered item, "**Answer:**" (decide, look) or "**Do:**" (provide, do), the options with the advice ("A or B; I
 * advise B"), the ask's id, kind and step, and under it one link per picture and per play, opening the board
 * (`<boardUrl>/#picture=<path>`, `<boardUrl>/#play=<branch>&<settings>`); without the board's address, the plain path.
 */
export function forYouBlock({ id, of = null, kind, blocking = false, title, options = [], advice = '', pictures = [], play = '' }, boardUrl = '') {
  const verb = ['provide', 'do'].includes(kind) ? 'Do' : 'Answer'
  const choice = options.length === 0 ? (advice === '' ? '' : ` I advise ${advice}.`) : ` ${options.join(' or ')}${advice === '' ? '' : `; I advise ${advice}`}`
  const where = of === null ? `${id}, ${kind}` : `${id}, ${kind}${blocking ? ', blocks ' : ' on '}${of}`
  const link = (label, words, hash, plain) => (boardUrl === '' ? `${label}: ${plain}` : `[${label}: ${words}](${boardUrl}/#${hash})`)
  const extra = [
    ...pictures.map(path => `>    ${link('See the picture', pictureName(path), `picture=${path}`, path)}`),
    ...(play === '' ? [] : [`>    ${link('Play it', playWhere(play), `play=${play}`, play)}`]),
  ]
  return ['> **For you**', `> 1. **${verb}:** ${title}${choice} (${where})`, ...extra].join('\n')
}

/**
 * A question to the person under a step: a new ask `Q<n>`; a blocking one moves the step to waiting on you. B299: an
 * ask may stand alone (`of` left out: a question the app's form asked while no step is the chat's); `advice` names the
 * option the chat advises; `via: "form"` says the app's question form asked it (the mod files those).
 */
async function ask(body, w) {
  const isAlone = body.of === undefined || body.of === null || body.of === ''
  const of = isAlone ? { ok: true, item: null, text: null } : await load(body.of, w, { kind: ['step'] })
  if (!of.ok) return of
  const holder = isAlone ? null : valueOf(of.item, 'Owner')
  if (holder !== null && !['main', 'person'].includes(w.role) && !isOwner(of.item, w.who, w.prefix)) {
    return refuse(409, `${valueOf(of.item, 'Id')} is ${holder}'s: only ${holder}, the main chat or the person asks under it.`)
  }
  const kind = body.kind ?? 'decide'
  if (!ASK_KINDS.includes(kind)) return refuse(400, `"kind" is ${ASK_KINDS.join(', ')}.`)
  const blocking = body.blocking === true || body.blocking === 'yes'
  const text = lines(body.text)
  if (text.length === 0) return refuse(400, 'Say what you ask in "text".')
  const options = lines(body.options, LINE_CHARS).slice(0, 8)
  const pictures = (Array.isArray(body.pictures) ? body.pictures : typeof body.pictures === 'string' ? body.pictures.split(',') : []).map(one => line(one, 200)).filter(Boolean).slice(0, 8)
  const play = line(body.play, 300)
  const advice = line(body.advice, 120)
  const via = body.via === 'form' && w.role !== 'person' ? 'form' : null
  const made = await makeAsk(w, { of: of.item, kind, blocking, text, options, advice, pictures, play, via })
  if (!made.ok) return made
  const { question, id, title } = made
  const stepId = isAlone ? null : valueOf(of.item, 'Id')
  const block = forYouBlock({ id, of: stepId, kind, blocking, title, options, advice, pictures, play }, w.boardUrl ?? '')
  if (isAlone) return changed(question, block)
  let item = said(underStep(of.item, [`Asked ${id} (${kind}${blocking ? ', blocking' : ''}): ${title}`]), w, `asked ${id}`)
  let moved = ''
  if (blocking && stateOf(item) === 'in progress') {
    const waits = move(item, 'waiting on you', w.role, w, flowCtx(w, [item, question]))
    if (waits.ok) item = waits.item
    else moved = ` (${stepId} stays ${stateOf(item)}: ${waits.why})`
  }
  const done = await save(item, of.text, w)
  if (!done.ok) return done
  return changed(question, `${block}${moved}`)
}

/** B299: writes a new ask `Q<n>` (under the step `of`, an item, or alone): `{ ok, question, id, title }`. */
async function makeAsk(w, { of = null, kind, blocking = false, text, options = [], advice = '', pictures = [], play = '', via = null }) {
  const id = await nextId(w.dir, 'Q', w.fs)
  const title = line(text[0], 200)
  let question = ordered({
    head: new Map([['Id', id], ['Kind', 'ask'], ['Title', title], ['State', 'open'], ['Owner', w.role === 'person' ? '-' : w.who], ['Activity', of === null ? '-' : valueOf(of, 'Activity') ?? '-'],
      ['Since', stamp(w.now)], ['Pictures', pictures.length === 0 ? '-' : pictures.join(', ')], ['Asks', kind], ['Blocking', blocking ? 'yes' : 'no'], ['Of', of === null ? '-' : valueOf(of, 'Id')],
      ['Options', options.length === 0 ? '-' : options.join(' | ')], ['Advice', advice === '' ? '-' : advice], ['Via', via ?? '-']].filter(([, value]) => value !== '-')),
    sections: new Map([['Text', text], ...(play === '' ? [] : [['Play', [play]]])]),
    problem: null,
  })
  question = said(question, w, `asked (${kind}${blocking ? ', blocking' : ''}${via === 'form' ? ', with the app\'s question form' : via === 'refine' ? ', refining' : ''})`)
  const wrote = await save(question, null, w)
  return wrote.ok ? { ok: true, question, id, title } : wrote
}

/**
 * B299: the person answered in the chat a question the app's form asked (`via: form`): the mod records the answer, so
 * the board no longer shows it as open. Only the chat that asked.
 */
async function answeredInChat(body, w) {
  const found = await load(body.id, w, { kind: ['ask'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  if (valueOf(found.item, 'Via') !== 'form') return refuse(409, `${id} was not asked with the app's question form: the person answers it on the board.`)
  if (!isOwner(found.item, w.who, w.prefix)) return refuse(409, `${id} is ${valueOf(found.item, 'Owner') ?? 'nobody'}'s.`)
  if (stateOf(found.item) !== 'open') return { ok: true, result: { id, text: `${id} is ${stateOf(found.item)} already.`, changed: false } }
  const text = lines(body.text)
  const item = said(put(put(copy(found.item), 'State', 'answered'), 'Since', stamp(w.now)), w, 'answered in its chat')
  if (text.length > 0) item.sections.set('Answer', text)
  const done = await save(item, found.text, w)
  return done.ok ? changed(item) : done
}

/** Information, never a question: a note `N<n>` to the person or to the main chat. */
async function note(body, w) {
  const to = body.to === 'main' ? 'main' : body.to === 'you' || body.to === undefined ? 'you' : null
  if (to === null) return refuse(400, '"to" is you or main.')
  const text = lines(body.text)
  if (text.length === 0) return refuse(400, 'Say it in "text".')
  if (body.of !== undefined) {
    const of = await load(body.of, w)
    if (!of.ok) return of
  }
  const made = await makeNote(w, to, text, body.of === undefined ? null : body.of)
  return made.ok ? changed(made.item, `${valueOf(made.item, 'Id')}: noted for ${to === 'you' ? 'the person' : 'the main chat'}.`) : made
}

async function makeNote(w, to, text, of) {
  const id = await nextId(w.dir, 'N', w.fs)
  const item = said({
    head: new Map([['Id', id], ['Kind', 'note'], ['From', w.who], ['To', to], ['State', 'unread'], ['Since', stamp(w.now)], ['Text', line(text.join(' '), LINE_CHARS)]]),
    sections: new Map([['Text', text], ...(of === null ? [] : [['About', [of]]])]),
    problem: null,
  }, w, 'noted')
  const done = await save(item, null, w)
  return done.ok ? { ok: true, item } : done
}

/** The chat reports its step: in progress → review; the board's check is pending; the main chat gets a note. */
async function report(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  if (!isOwner(found.item, w.who, w.prefix)) return refuse(409, `${id} is ${valueOf(found.item, 'Owner') ?? 'nobody'}'s, not ${w.who}'s.`)
  const result = line(body.result, 1000)
  if (result === '') return refuse(400, 'Name the result in "result": what the person gets now.')
  const merged = line(body.merged, 60)
  if (stateOf(found.item) === 'waiting on you') {
    const open = openAsksOf(w, id)
    return refuse(409, `${id} waits on ${open.join(', ') || 'an ask'}: withdraw it (work withdraw ${open[0] ?? 'Q<n>'}) or wait for the answer.`)
  }
  const moved = move(found.item, 'review', w.role, w)
  if (!moved.ok) return moved
  const item = appendHistory(underStep(moved.item, [`Reported by ${w.who} on ${at(w.now)}: ${result}${merged === '' ? '' : ` (merged ${merged})`}`]), 'server', 'check pending', w.now)
  const done = await save(item, found.text, w)
  if (!done.ok) return done
  await makeNote(w, 'main', [`${id} reported by ${w.who}: ${line(result, 200)}`], id)
  return changed(item, undefined, { check: { id, branch: valueOf(item, 'Branch'), result } })
}

/** The open asks under a step, by id. */
const openAsksOf = (w, id) => [...w.store.items.values()]
  .filter(one => kindOf(one) === 'ask' && valueOf(one, 'Of') === id && stateOf(one) === 'open').map(one => valueOf(one, 'Id')).sort(byId)

/**
 * Review 1: the chat that asked takes its ask back (it found the answer, or the question went): the ask is withdrawn,
 * and a step that waited only on its asks goes on (the flow's move by the server). The step is written first.
 */
async function withdraw(body, w) {
  const found = await load(body.id, w, { kind: ['ask'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  if (stateOf(found.item) !== 'open') return refuse(409, `${id} is not open.`)
  const asker = valueOf(found.item, 'Owner')
  if (w.role !== 'person' && (asker === null || plain(asker, w.prefix) !== plain(w.who, w.prefix))) return refuse(409, `${id} is ${asker ?? 'the person'}'s to withdraw.`)
  const why = line(body.why, 300)
  const item = said(put(put(copy(found.item), 'State', 'withdrawn'), 'Since', stamp(w.now)), w, `withdrawn${why === '' ? '' : `: ${why}`}`)
  const of = valueOf(found.item, 'Of')
  return answerStep(w, item, found.text, of, step => {
    let mine = said(underStep(step, [`${id} withdrawn by ${w.who} on ${at(w.now)}${why === '' ? '' : `: ${why}`}`]), w, `${id} withdrawn`)
    if (stateOf(mine) === 'waiting on you') {
      const goesOn = move(mine, 'in progress', 'server', w, flowCtx(w, [item, mine]), ` (${id} withdrawn)`)
      if (goesOn.ok) mine = goesOn.item
    }
    return mine
  })
}

/**
 * Review 6: an ask that is answered or withdrawn, and its step: the step is written first, then the ask; when the
 * ask cannot be written the step is put back, and the answer is 500 with both as they were.
 */
async function answerStep(w, item, text, of, change) {
  let step = null
  if (of !== null) {
    step = await load(of, w, { kind: ['step'] })
    if (!step.ok) return step
    const mine = change(step.item)
    const done = await save(mine, step.text, w)
    if (!done.ok) return refuse(500, `${of} could not be written (${done.why}); nothing changed.`)
    step = { ...step, written: serializeItem(mine) }
  }
  const done = await save(item, text, w)
  if (!done.ok) {
    if (step !== null) await putBack(w.dir, of, step.text, w.fs, { expected: step.written })
    return refuse(500, `${valueOf(item, 'Id')} could not be written (${done.why}); nothing changed.`)
  }
  return changed(item)
}

/** The board's own check after a report, in History; when it passed the flow may close the step. */
async function check(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const passed = body.passed === true
  const outcome = lines(body.lines, LINE_CHARS).join('; ')
  let item = appendHistory(found.item, 'server', `check ${passed ? 'passed' : 'failed'}${outcome === '' ? '' : `: ${outcome}`}`, w.now)
  if (passed && stateOf(item) === 'review') {
    const closed = move(item, 'done', 'server', w, flowCtx(w, [item]))
    if (closed.ok) item = closed.item
  }
  const done = await save(item, found.text, w)
  return done.ok ? changed(item) : done
}

/** Blocked by: one more step, or one less. */
async function blockOn(body, w, isBlock) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const on = typeof body.on === 'string' ? body.on.trim() : ''
  if (!STEP_ID.test(on)) return refuse(400, 'Name the step it waits on in "on" (B12).')
  if (isBlock && !w.store.items.has(on)) return refuse(404, `${on}: no such item in the store.`)
  const id = valueOf(found.item, 'Id')
  if (on === id) return refuse(400, `${id} cannot wait on itself.`)
  const before = idsIn(valueOf(found.item, 'Blocked by'))
  const after = isBlock ? [...new Set([...before, on])] : before.filter(one => one !== on)
  if (after.length === before.length && after.every((one, index) => one === before[index])) return { ok: true, result: { id, text: serializeItem(found.item), changed: false } }
  const item = said(put(copy(found.item), 'Blocked by', after.join(' and ')), w, `${isBlock ? 'blocked by' : 'no longer blocked by'} ${on}`)
  const done = await save(ordered(item), found.text, w)
  return done.ok ? changed(ordered(item)) : done
}

/** A new step `B<n>` in state new, at the end of its activity. */
async function make(body, w) {
  if ((body.kind ?? 'step') !== 'step') return refuse(400, 'Only a step is made with "new"; an ask with "ask", a note with "note".')
  const title = line(body.title, 200)
  if (title === '') return refuse(400, 'Give the step a title.')
  const names = w.store.activities.map(one => one.name)
  const wanted = line(body.activity, 120).toLowerCase()
  const index = w.store.activities.findIndex(one => one.name.toLowerCase() === wanted)
  if (index < 0) return refuse(400, `Name its activity in "activity": ${names.join(', ')}.`)
  const goal = line(body.goal, 20)
  if (goal !== '' && !/^G\d+$/.test(goal)) return refuse(400, 'A goal is named by its id (G17).')
  const read = lineFields(title)
  if (read.title !== title || read.isYou || read.owner !== null || read.branch !== null || read.asks !== null || read.id !== null) {
    return refuse(400, 'The title would not read back as written: leave out an id at its start, "Verify:" and the like, brackets at its end and @you.')
  }
  const activitiesText = await readActivitiesText(w.dir, w.fs)
  const id = await nextId(w.dir, 'B', w.fs)
  const item = said(ordered({
    head: new Map([['Id', id], ['Kind', 'step'], ['Title', title], ['State', 'new'], ['Activity', names[index]], ...(goal === '' ? [] : [['Goal', goal]]), ['Since', stamp(w.now)]]),
    sections: new Map(lines(body.text).length === 0 ? [] : [['Context', lines(body.text).map(one => `  ${one.trim()}`)]]),
    problem: null,
  }), w, 'made')
  const wrote = await save(item, null, w)
  if (!wrote.ok) return wrote
  const activities = w.store.activities.map((one, place) => (place === index ? { ...one, steps: [...(one.steps ?? []), id] } : one))
  const listed = await writeActivities(w.dir, { preamble: w.store.preamble, activities }, w.fs, { expected: activitiesText })
  if (!listed.ok) {
    await removeItem(w.dir, id, w.fs)
    return refuse(409, `activities.json: ${listed.why}; try again.`)
  }
  return changed(item)
}

/** Main queues a refined step for a chat: Owner, Blocked by or Waits for, Estimate. */
async function queue(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const owner = line(body.for, 80)
  if (owner === '') return refuse(400, 'Name the chat it is for in "for".')
  const after = line(body.after, 200).replace(/^after\s+/i, '')
  if (after.includes(';')) return refuse(400, '"after" holds no ";".')
  const about = line(body.about, 40).replace(/^about\s+/i, '')
  if (about !== '' && minutesOf(`about ${about}`) === null) return refuse(400, '"about" is a time such as "1 h" or "40 min".')
  const moved = move(found.item, 'queued', w.role, w)
  if (!moved.ok) return moved
  const item = moved.item
  put(item, 'Owner', owner)
  put(item, 'Blocked by', ONLY_IDS.test(after) ? after : null)
  put(item, 'Waits for', after !== '' && !ONLY_IDS.test(after) ? after : null)
  put(item, 'Estimate', about)
  item.head.delete('Queue note')
  const words = [`for ${owner}`, after === '' ? null : `after ${after}`, about === '' ? null : `about ${about}`].filter(Boolean).join('; ')
  const next = ordered(said(item, w, `queued ${words}`))
  const done = await save(next, found.text, w)
  return done.ok ? changed(next) : done
}

/** An instruction is closed, and what came of it is said. */
async function close(body, w) {
  const found = await load(body.id, w, { kind: ['instruction'] })
  if (!found.ok) return found
  const as = line(body.as, 300)
  if (as === '') return refuse(400, 'Say what came of it in "as" ("made step B300").')
  if (stateOf(found.item) === 'closed') return refuse(409, `${valueOf(found.item, 'Id')} is closed already.`)
  const item = said(put(put(copy(found.item), 'State', 'closed'), 'Closed as', as), w, `closed: ${as}`)
  const done = await save(ordered(item), found.text, w)
  return done.ok ? changed(ordered(item), undefined, { open: openOf(valueOf(item, 'Chat'), w, [item]) }) : done
}

/** B298: a chat's open instructions, oldest first: `[{ id, turns, text }]`; `fresh` are items changed just now. */
function openOf(chat, w, fresh = []) {
  const items = new Map(w.store.items)
  for (const one of fresh) items.set(valueOf(one, 'Id'), one)
  return [...items.values()]
    .filter(one => kindOf(one) === 'instruction' && stateOf(one) === 'open' && plain(valueOf(one, 'Chat'), w.prefix) === plain(chat, w.prefix))
    .sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
    .map(one => ({ id: valueOf(one, 'Id'), turns: Number(valueOf(one, 'Missed') ?? 0), text: valueOf(one, 'Text') ?? '' }))
}

/** The chat an action is about: the chat that asks, or the one the person or the board names. */
const chatOf = (body, w) => (w.role === 'person' || w.role === 'server' ? line(body.chat, 80) : w.who)

/**
 * B298: the person's words to a chat, filed the moment they arrive: an instruction `I<n>`, open until the chat closes
 * it. The Workers mod files what the person types in the chat's own box (Via: chat); the board files a line typed on
 * it (Via: board), as the person.
 */
async function instruction(body, w) {
  const chat = chatOf(body, w)
  if (chat === '') return refuse(400, 'Name the chat.')
  if (w.who !== chat && (w.roleOf?.(chat) ?? null) === null) return refuse(404, `${chat} is no chat of the list.`)
  const text = lines(body.text)
  if (text.length === 0) return refuse(400, 'Say it in "text".')
  const id = await nextId(w.dir, 'I', w.fs)
  const item = said({
    head: new Map([['Id', id], ['Kind', 'instruction'], ['Chat', chat], ['State', 'open'], ['Since', toSecond(w.now)], ['Via', w.role === 'person' ? 'board' : 'chat'], ['Text', line(text.join(' '), LINE_CHARS)]]),
    sections: new Map([['Text', text]]),
    problem: null,
  }, w, 'filed')
  const done = await save(item, null, w)
  if (!done.ok) return done
  return changed(item, `Recorded as ${id}; close it with work close ${id} --as "what came of it" once it is done.`, { open: openOf(chat, w, [item]) })
}

/**
 * B298: a turn of the chat ended (the Workers mod says so, with `since`, when that turn started): every instruction of
 * the chat filed before then and still open is missed once more (`Missed`, a History line). Nothing is closed.
 */
async function turnEnded(body, w) {
  const chat = chatOf(body, w)
  if (chat === '') return refuse(400, 'Name the chat.')
  const since = Number(body.since)
  if (body.since === undefined || body.since === null || !Number.isFinite(since)) return refuse(400, '"since" is when the turn started.')
  const due = [...w.store.items.values()].filter(one => kindOf(one) === 'instruction' && stateOf(one) === 'open'
    && plain(valueOf(one, 'Chat'), w.prefix) === plain(chat, w.prefix) && sinceMs(valueOf(one, 'Since')) <= since)
    .sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
  const missed = []
  const fresh = []
  for (const one of due) {
    const found = await load(valueOf(one, 'Id'), w, { kind: ['instruction'] })
    if (!found.ok || stateOf(found.item) !== 'open') continue
    const count = Number(valueOf(found.item, 'Missed') ?? 0) + 1
    const item = ordered(appendHistory(put(copy(found.item), 'Missed', String(count)), 'server', `missed: a turn of ${chat} ended without closing it`, w.now))
    const done = await save(item, found.text, w)
    if (!done.ok) continue
    missed.push(valueOf(item, 'Id'))
    fresh.push(item)
  }
  const open = openOf(chat, w, fresh)
  const text = missed.length === 0 ? 'No instruction was left open.' : `Left open: ${missed.join(', ')}. Close each with work close <id> --as "what came of it", or say why it stays open.`
  return { ok: true, result: { text, missed, open, changed: missed.length > 0 } }
}

/** A step is dropped, and why. */
async function drop(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const why = line(body.why, 300)
  if (why === '') return refuse(400, 'Say why in "why".')
  const moved = move(found.item, 'dropped', w.role, w)
  if (!moved.ok) return moved
  const item = underStep(moved.item, [`Dropped by ${w.who} on ${at(w.now)}: ${why}`])
  const done = await save(item, found.text, w)
  return done.ok ? changed(item) : done
}

/** The round number of a refine block's head, 0 when there is none. */
const roundOf = item => Number((item.sections.get('Refined') ?? [''])[0].match(/\bround\s+(\d+)/i)?.[1] ?? ((item.sections.get('Refined') ?? []).length > 0 ? 1 : 0))
/** The Context with the mark where the refine block stands: where it stood, else at the end. */
const withMark = item => {
  const context = item.sections.get('Context') ?? []
  return context.some(one => one.trim() === REFINED_MARK.trim()) ? context : [...context, REFINED_MARK]
}

/** The Advisor's refine: the block in today's form (round, summary, picture, goal, size, questions); Refined: open. */
async function refine(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const summary = line(body.summary, 600)
  if (summary === '') return refuse(400, 'Give the summary in "summary".')
  const picture = line(body.picture, 200)
  const goal = line(body.goal, 20)
  if (goal !== '' && !/^G\d+$/.test(goal)) return refuse(400, 'A goal is named by its id (G17).')
  const size = line(body.size, 40).replace(/^about\s+/i, '')
  const questions = lines(body.questions, 600).map(one => one.replace(/^[-*]\s+/, '').trim())
  const round = roundOf(found.item) + 1
  const block = [
    `Refined (round ${round}, by ${w.who}, ${stamp(w.now)}):`,
    `Summary: ${summary}`,
    ...(picture === '' ? [] : [`Picture: ${picture}`]),
    ...(goal === '' ? [] : [`Part of: ${goal}`]),
    ...(size === '' ? [] : [`Size: about ${size}`]),
    ...(questions.length === 0 ? [] : ['Questions:', ...questions.map(one => `- ${one}`)]),
  ].map(one => `  ${one}`)
  const item = copy(found.item)
  item.sections.set('Summary', [summary])
  if (picture === '') item.sections.delete('Picture')
  else item.sections.set('Picture', [picture])
  item.sections.delete('What we build')
  item.sections.set('Refined', block)
  item.sections.set('Context', withMark(found.item))
  put(item, 'Refined', 'open')
  if (goal !== '') put(item, 'Goal', goal)
  const next = ordered(said(item, w, `refined, round ${round}`))
  const done = await save(next, found.text, w)
  if (!done.ok) return done
  // B299: each question is an ask of kind decide under the step, so it stands under Needs your attention; the open
  // ones of an earlier round are withdrawn, replaced by this round.
  const stepId = valueOf(next, 'Id')
  for (const old of refineAsksOf(w, stepId)) await settleAsk(w, old, 'withdrawn', null, `replaced by round ${round}`)
  const asked = []
  for (const question of questions) {
    const made = await makeAsk(w, { of: next, kind: 'decide', text: [question], via: 'refine' })
    if (made.ok) asked.push(made.id)
  }
  return changed(next, undefined, { asks: asked })
}

/** B299: the open asks of a step's refine (`Via: refine`), oldest first. */
function refineAsksOf(w, stepId) {
  return [...w.store.items.values()]
    .filter(one => kindOf(one) === 'ask' && valueOf(one, 'Of') === stepId && valueOf(one, 'Via') === 'refine' && stateOf(one) === 'open')
    .sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
}

/** B299: an ask of a refine answered (with the person's words) or withdrawn, as its file holds it now. */
async function settleAsk(w, ask, state, text, why) {
  const found = await load(valueOf(ask, 'Id'), w, { kind: ['ask'] })
  if (!found.ok || stateOf(found.item) !== 'open') return
  const item = put(put(copy(found.item), 'State', state), 'Since', stamp(w.now))
  if (text !== null) item.sections.set('Answer', [text])
  await save(said(item, w, why), found.text, w)
}

/** B299: the questions of a refine block as written, without the answers written after them. */
function blockQuestions(item) {
  const out = []
  let isIn = false
  for (const one of item.sections.get('Refined') ?? []) {
    const named = one.trim().match(/^([A-Z][A-Za-z /]{1,28}):/)
    if (named !== null) isIn = named[1] === 'Questions'
    else if (isIn && /^\s*[-*]\s+/.test(one)) out.push(line(one.trim().replace(/^[-*]\s+/, '').replace(/\s+Answer:\s.*$/, ''), 200))
  }
  return out
}

/** The Advisor folded every answer in: the block says "ready", What we build is written, and the step is refined. */
async function refined(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  const block = found.item.sections.get('Refined') ?? []
  if (block.length === 0) return refuse(409, `${id} has no refine block yet: refine it first.`)
  // B299: a refine is ready only once the person answered its questions.
  const waiting = refineAsksOf(w, id)
  if (waiting.length > 0) return refuse(409, `${id}: ${waiting.map(one => `${valueOf(one, 'Id')} ("${valueOf(one, 'Title')}")`).join(', ')} ${waiting.length === 1 ? 'is' : 'are'} still open: the person answers first.`)
  const what = lines(body.what, 300).map(one => `- ${one.replace(/^[-*]\s+/, '').trim()}`)
  if (what.length === 0) return refuse(400, 'Say what we build in "what", one line per part.')
  const head = block[0].match(/^(\s*)Refined\s*(?:\(([^)]*)\))?\s*:\s*$/)
  if (head === null) return refuse(409, `${id}: its refine block does not start with "Refined (...):"; fix it by hand first.`)
  const inside = (head[2] ?? '').split(';').map(one => one.trim()).filter(one => one !== '' && !/^ready$/i.test(one))
  const indent = head[1] || '  '
  // The ready form (roles/advisor.md): the questions, their answers and the feedback are folded in and go; What we
  // build stands last, once.
  const kept = []
  let isDropped = false
  for (const one of block.slice(1)) {
    const named = one.trim().match(/^([A-Z][A-Za-z /]{1,28}):/)
    if (named !== null) isDropped = ['Questions', 'Feedback', 'What we build', 'Problem', 'Goal'].includes(named[1])
    if (!isDropped) kept.push(one)
  }
  const item = copy(found.item)
  item.sections.set('Refined', [`${indent}Refined (${[...inside, 'ready'].join('; ')}):`, ...kept, `${indent}What we build:`, ...what.map(one => `${indent}${one}`)])
  item.sections.set('What we build', what)
  item.sections.set('Context', withMark(found.item))
  put(item, 'Refined', 'ready')
  let next = said(ordered(item), w, 'refined is ready')
  if (stateOf(next) === 'new') {
    const moved = move(next, 'refined', w.role, w)
    if (!moved.ok) return moved
    next = moved.item
  }
  const done = await save(next, found.text, w)
  return done.ok ? changed(next) : done
}

/** The person answers an ask; a step that waited only on its asks goes on (the flow's move by the server). */
async function answer(body, w) {
  const found = await load(body.id, w, { kind: ['ask'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  if (stateOf(found.item) !== 'open') return refuse(409, `${id} is ${stateOf(found.item)} already.`)
  // B299: a question asked with the app's own form is answered there, in its chat.
  if (valueOf(found.item, 'Via') === 'form') return refuse(409, `${id} was asked with the app's question form: answer it in ${valueOf(found.item, 'Owner') ?? 'its'}'s chat.`)
  // B299: a look is approved or rejected, a do is done; the person's words follow the verdict.
  const verdict = { approve: 'Approved', reject: 'Rejected', done: 'Done' }[body.verdict] ?? null
  const words = lines(body.text)
  if (body.verdict === 'reject' && words.length === 0) return refuse(400, 'Say why you reject it.')
  const text = verdict === null ? words : [`${verdict}.${words.length === 0 ? '' : ` ${words[0].trim()}`}`, ...words.slice(1)]
  if (text.length === 0) return refuse(400, 'Give the answer in "text".')
  const short = line(text.join(' '), 200)
  const of = valueOf(found.item, 'Of')
  let item = put(copy(found.item), 'State', 'answered')
  put(item, 'Since', stamp(w.now))
  item.sections.set('Answer', text)
  // An ask that stands on the backlog itself (an @you step) shows the answer under its line.
  if (of === null && !/^Q\d+$/.test(id)) item = underStep(item, [`Answered by you on the worker board on ${at(w.now)}: ${short}`])
  item = said(item, w, `answered: ${short}`)
  const done = await answerStep(w, item, found.text, of, step => {
    let mine = said(underStep(step, [`${id} answered by you on ${at(w.now)}: ${short}`]), w, `${id} answered`)
    if (stateOf(mine) === 'waiting on you') {
      const goesOn = move(mine, 'in progress', 'server', w, flowCtx(w, [item, mine]), ` (${id} answered)`)
      if (goesOn.ok) mine = goesOn.item
    }
    return mine
  })
  // B299: the chat that asked is woken with the answer (the server sends it); an ask the person made wakes nobody.
  const owner = valueOf(found.item, 'Owner')
  const wake = owner === null || !/^Q\d+$/.test(id) ? null : { to: owner, id, title: valueOf(found.item, 'Title') ?? '', text: text.join('\n') }
  return done.ok ? { ok: true, result: { ...done.result, wake } } : done
}

/** B299: the person read a note under Information: it is read, and leaves the list. */
async function read(body, w) {
  const found = await load(body.id, w, { kind: ['note'] })
  if (!found.ok) return found
  if (stateOf(found.item) === 'read') return { ok: true, result: { id: valueOf(found.item, 'Id'), text: 'Read already.', changed: false } }
  const item = said(put(put(copy(found.item), 'State', 'read'), 'Since', stamp(w.now)), w, 'read')
  const done = await save(item, found.text, w)
  return done.ok ? changed(item) : done
}

/**
 * The person closes a step on the Backlog tab, or approves or marks done what only they could do: it stands ticked,
 * with their line under it (`line`). A step is done (review 5: dropped only through `drop`), as the flow lets the
 * person; an ask is answered.
 */
async function tick(body, w) {
  const found = await load(body.id, w, { kind: ['step', 'ask'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  const under = line(body.line, 600)
  let item
  if (kindOf(found.item) === 'ask') {
    if (stateOf(found.item) !== 'open') return refuse(409, `${id} is ticked already.`)
    item = said(put(put(copy(found.item), 'State', 'answered'), 'Since', stamp(w.now)), w, 'answered on the board')
  } else {
    if (['done', 'dropped'].includes(stateOf(found.item))) return refuse(409, `${id} is ticked already.`)
    const moved = move(found.item, 'done', 'person', w)
    if (!moved.ok) return moved
    item = moved.item
  }
  if (under !== '') item = underStep(item, [under])
  const done = await save(item, found.text, w)
  return done.ok ? changed(item) : done
}

/** The person deletes a step on the Backlog tab: its file goes and its activity no longer lists it; its id stays given. */
async function remove(body, w) {
  const found = await load(body.id, w, { kind: ['step', 'ask'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  const activitiesText = await readActivitiesText(w.dir, w.fs)
  const activities = w.store.activities.map(one => ({ ...one, steps: (one.steps ?? []).filter(step => step !== id), loose: (one.loose ?? []).map(loose => (loose.after === id ? { ...loose, after: one.steps[one.steps.indexOf(id) - 1] ?? null } : loose)) }))
  const listed = await writeActivities(w.dir, { preamble: w.store.preamble, activities }, w.fs, { expected: activitiesText })
  if (!listed.ok) return refuse(409, `activities.json: ${listed.why}; try again.`)
  const gone = await removeItem(w.dir, id, w.fs, { expected: found.text })
  if (!gone.ok) return refuse(409, `${gone.why}; try again.`)
  return { ok: true, result: { id, text: `${id} is deleted.`, changed: true } }
}

/**
 * The person's answers to a step's refine questions and their feedback, or their "accepted": written into its refine
 * block as the backlog's own writers write it (tick.mjs), then read back into the item.
 */
async function refineText(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  const text = `## -\n${stepLine(found.item)}\n${stepNotes(found.item).join('\n')}\n`
  const written = w.action === 'refine-accept'
    ? acceptRefine(text, id, stamp(w.now))
    : answerRefine(text, id, Array.isArray(body.answers) ? body.answers : [], line(body.feedback, 1000))
  if (!written.ok) return refuse(409, { none: `${id} has not been refined yet.`, question: 'The questions changed in the meantime: open the step again.' }[written.why] ?? `${id}: ${written.why}.`)
  const back = migrateBacklog(written.text, { now: w.now }).items.get(id)
  if (back === undefined) return refuse(409, `${id}: its refine block could not be read back.`)
  const item = copy(found.item)
  for (const name of ['Summary', 'Picture', 'What we build', 'Refined']) {
    if (back.sections.has(name)) item.sections.set(name, back.sections.get(name))
    else item.sections.delete(name)
  }
  put(item, 'Refined', valueOf(back, 'Refined'))
  const next = said(item, w, w.action === 'refine-accept' ? 'accepted the refine' : 'answered the refine questions')
  const done = await save(next, found.text, w)
  if (!done.ok) return done
  // B299: the refine's asks follow: each question answered here is answered; accepting answers the rest.
  const questions = blockQuestions(found.item)
  const answers = Array.isArray(body.answers) ? body.answers : []
  for (const ask of refineAsksOf(w, id)) {
    if (w.action === 'refine-accept') await settleAsk(w, ask, 'answered', 'Accepted as refined.', 'accepted as refined')
    else {
      const index = questions.indexOf(valueOf(ask, 'Title'))
      const given = answers.find(one => one !== null && typeof one === 'object' && one.index === index)?.answer
      if (index >= 0 && typeof given === 'string' && given.trim() !== '') await settleAsk(w, ask, 'answered', line(given, 1000), `answered in the step's window: ${line(given, 200)}`)
    }
  }
  return changed(next)
}

const CHANGE = {
  take, step, ask, withdraw, note, report, check, new: make, queue, close, drop, refine, refined, answer, tick, instruction,
  'turn-ended': turnEnded,
  'answered-in-chat': answeredInChat,
  read,
  block: (body, w) => blockOn(body, w, true),
  unblock: (body, w) => blockOn(body, w, false),
  delete: remove,
  'refine-answer': refineText,
  'refine-accept': refineText,
}

/** The paths a step's "Touches:" lines name (under Context or a Touches section), each as written. */
function touchesOf(item) {
  const lines = [...(item.sections.get('Context') ?? []), ...(item.sections.get('Touches') ?? []).map(one => `Touches: ${one}`)]
  return lines.flatMap(one => one.trim().match(/^Touches:\s*(.*)$/)?.[1].split(/[,;]\s*|\s+and\s+/) ?? [])
    .map(one => one.replace(/^[-*]\s+/, '').replace(/[`.]+$/g, '').replace(/^`/, '').trim()).filter(Boolean)
}

/**
 * The flow's `overlaps` for the server: the id of a taken or in-progress step whose Touches name a path the item's
 * Touches name too (a folder covers what is in it), or null.
 */
export function overlapsIn(items) {
  return item => {
    const mine = touchesOf(item)
    if (mine.length === 0) return null
    const covers = (a, b) => a === b || b.startsWith(`${a.replace(/\/$/, '')}/`) || a.startsWith(`${b.replace(/\/$/, '')}/`)
    for (const other of items.values()) {
      if (other === item || valueOf(other, 'Id') === valueOf(item, 'Id') || !['taken', 'in progress', 'waiting on you'].includes(stateOf(other))) continue
      if (touchesOf(other).some(path => mine.some(own => covers(own, path)))) return valueOf(other, 'Id')
    }
    return null
  }
}
