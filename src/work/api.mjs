// B297: the actions of the `work` tool and of the board's page on the work store (spec 2026-10-17, section 5). Every
// action is one request; the server validates it against the flow (flow.json) and writes the file, with one History
// line per change. Only the server writes the store: the chats call the tool (POST /api/bridge/work), the page calls
// POST /api/work, and the server's own writers call `workApi` with `as: 'server'` or `as: 'person'`.
//
// B301: the store is required. A store folder that is not there or cannot be read is refused with 503 and the one line
// the board shows on top for it (read.mjs, `storeFault`); nothing is read from or written to the backlog file instead.

import { minutesOf } from '../backlog.mjs'
import { workWords } from '../say.mjs'
import { stepLine, stepNotes } from './adapter.mjs'
import { mayMove } from './flow.mjs'
import { blockersOpen, CLEARED, overlapsIn, waitIds, waitWords } from './guards.mjs'
import { ASK_KINDS, HEAD_KEYS, fixFirst, isFix, serializeItem, sinceMs, validateHead, valueOf } from './item.mjs'
import { lineFields } from './line.mjs'
import { REFINED_MARK, migrateBacklog, stamp } from './migrate.mjs'
import { storeFault, touchesLines } from './read.mjs'
import { acceptRefine, answerRefine } from './refineText.mjs'
import { DECIDED, GOAL_ID, NEEDS, UNDONE, decidedOf, isDailyNote, undoneOf } from './dailyNote.mjs'
import { HOW_MARK, openAsksOf as openAsksUnder, refineAsksOf as asksCounted } from './stepAsks.mjs'
import { fixTitle, needsResultCheck, parsePoints, resultCheckOf } from './resultCheck.mjs'
import { kindsNamed, parseStandard, standardOf, standardWanted } from './standard.mjs'
import { appendHistory, nextId, putBack, readActivitiesText, readItemFile, readStore, removeItem, writeActivities, writeItem } from './store.mjs'
import { openNaming, renamedItem } from './names.mjs'
import { readNamesFile, readPauseFile, writeNames, writePause } from './store.mjs'
import { HELD, checkpointLine, isHolding, pauseAnswer } from './pause.mjs'
import { writeView } from './view.mjs'

// B300: kept here for those who import them from the API.
export { overlapsIn, sinceMs }

const READS = new Set(['next', 'list', 'pause-state'])
const CHANGES = new Set(['take', 'step', 'ask', 'withdraw', 'answered-in-chat', 'read', 'note', 'report', 'block', 'unblock', 'new', 'queue', 'close', 'drop', 'refine', 'refined', 'answer', 'tick', 'delete', 'refine-answer', 'refine-accept', 'check', 'checked', 'instruction', 'turn-ended', 'pull', 'advance', 'requeue', 'unqueue', 'recheck', 'undo', 'rename', 'pause-all', 'resume-all', 'resumed', 'end-resume'])
/**
 * Focus 2: the partner's drafts of the focus goal's vibe and how. They change the goal map, not the store: the board's
 * `goalDraft` (src/focus.mjs) writes them; only the chat the list names the partner (role advisor) sends them.
 */
const GOAL_MAP = new Set(['vibe-draft', 'how-draft'])
/** B298: what never shows on the backlog view: it is not written anew for these. */
const OFF_VIEW = new Set(['instruction', 'turn-ended', 'close', 'read', 'pull', 'undo', 'pause-all', 'resume-all', 'resumed', 'end-resume'])
/** What only the person does, on the board's page; and what only the server does. */
const PERSON = new Set(['answer', 'read', 'tick', 'delete', 'refine-answer', 'refine-accept', 'recheck', 'undo', 'pause-all', 'resume-all', 'end-resume'])
const SERVER = new Set(['check', 'advance', 'resumed'])
/** Who may do what the flow does not decide (the default flow's table, spec section 5). */
const ROLES = {
  block: ['main', 'worker', 'person'],
  unblock: ['main', 'worker', 'person'],
  new: ['main', 'worker', 'advisor', 'person'],
  refine: ['advisor', 'main'],
  // B356: the result check, by a helper the partner runs.
  checked: ['advisor'],
  'vibe-draft': ['advisor'],
  'how-draft': ['advisor'],
  requeue: ['main', 'person'],
  unqueue: ['main', 'person'],
  rename: ['main', 'person', 'server'],
}
/** The order of a chat's own steps in `next`: what it works on first. */
const MINE = ['in progress', 'waiting on you', 'taken', 'review', 'queued']
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
/**
 * Focus 4: a chat's name as the list writes it: without the list's prefix, matched to a known chat (`chats`, the
 * list's names) in any case. `{ ok, name }`, or a refusal naming the known ones; without a list (`chats` not given)
 * the name without the prefix. `mayBeGone`: an old name (a rename's `from`) need not be known.
 */
export function chatName(value, { chats, prefix = '' }, { mayBeGone = false } = {}) {
  let words = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase())) words = words.slice(prefix.length).trim()
  if (!Array.isArray(chats) || chats.length === 0) return { ok: true, name: words }
  const known = chats.find(name => plain(name, prefix) === words.toLowerCase())
  if (known !== undefined) return { ok: true, name: known }
  if (mayBeGone) return { ok: true, name: words }
  // The review of Focus 4: a name the list does not know yet is taken (the main chat queues for a worker before it
  // joins), with a warning line naming the known ones, so a mistyped name is seen at once.
  return { ok: true, name: words, warning: `${words} is no chat of the list yet (it knows ${chats.map(name => name.replace(prefix, '').trim()).join(', ')}): the step waits until a chat of that name joins; check the name if none is about to.` }
}

/** The answer with the warning line on top, when there is one. */
const warned = (done, warning) => (warning === undefined || !done.ok ? done : { ...done, result: { ...done.result, text: `${warning}\n${done.result.text ?? ''}`, warning } })
const at = now => stamp(now).replace(' ', ' at ')
/** B298: the time to the second, for an instruction's Since: a turn that starts a moment later can tell it. */
const toSecond = now => `${stamp(now)}:${String(new Date(now).getSeconds()).padStart(2, '0')}`
/** Review of B298: when an instruction was filed, to the millisecond (`Filed`), else as its Since says. */
const filedMs = item => (/^\d+$/.test(valueOf(item, 'Filed') ?? '') ? Number(valueOf(item, 'Filed')) : sinceMs(valueOf(item, 'Since')))

/** One request after the other per store folder: two takes of one step never interleave. */
const turns = new Map()
function serial(dir, run) {
  const turn = (turns.get(dir) ?? Promise.resolve()).then(run, run)
  turns.set(dir, turn.catch(() => {}))
  return turn
}

/**
 * One action on the store. `body = { action, chat, ...fields }`; `ctx = { dir, fs, now, as, roleOf, freeChats,
 * overlaps, prefix, viewFile, boardUrl, hasGoal }` (Focus 3: `hasGoal(id)`, whether the goal map holds that goal): `as` is 'person' (the page) or 'server' (the board itself), else the chat
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
  if (!READS.has(action) && !CHANGES.has(action) && !GOAL_MAP.has(action)) return refuse(400, `No action "${String(action).slice(0, 40)}": ${[...READS, ...CHANGES, ...GOAL_MAP].join(', ')}.`)
  let who
  let role
  if (ctx.as === 'person' || ctx.as === 'server') {
    who = ctx.as
    role = ctx.as
  } else {
    who = line(body.chat, 80)
    if (who === '') return refuse(400, 'Name the chat.')
    // Focus 4: the chat's whole title is the chat of the list.
    if ((ctx.roleOf?.(who) ?? null) === null) {
      const named = chatName(who, ctx)
      if (named.ok) who = named.name
    }
    role = ctx.roleOf?.(who) ?? null
    if (role === null) return refuse(403, `${who} is no chat of the list.`)
  }
  if (PERSON.has(action) && role !== 'person') return refuse(403, 'Only the person does that, on the board.')
  if (SERVER.has(action) && role !== 'server') return refuse(403, 'Only the board does that.')
  if (ROLES[action] !== undefined && !ROLES[action].includes(role)) return refuse(403, `Only ${ROLES[action].join(' or ')} ${action === 'new' ? 'makes a step' : `may ${action}`}.`)
  if (GOAL_MAP.has(action)) return goalDraft(body, ctx)

  let store
  try {
    store = { ok: true, dir: ctx.dir, ...(await readStore(ctx.dir, ctx.fs)) }
  } catch (error) {
    store = { ok: false, dir: ctx.dir, code: error?.code ?? error?.message ?? 'unknown' }
  }
  // B301: no store, or one that cannot be read: the board's line for it, never a fallback.
  const fault = storeFault(store, { backlog: ctx.backlogFile ?? null })
  if (fault !== null) return refuse(503, fault)
  const now = ctx.now ?? Date.now()
  const w = { ...ctx, store, now, who, role, action }
  if (action === 'next') return next(body, w)
  if (action === 'list') return list(w)
  if (action === 'pause-state') return { ok: true, result: pauseStateOf(w) }
  const done = await CHANGE[action](body, w)
  // B317: a turn's end that filed the asks of the chat's "For you" block shows them on the view, as an ask does.
  const isOffView = OFF_VIEW.has(action) && !(done.ok && done.result.asked?.length > 0)
  if (!done.ok || done.result.changed === false || !ctx.viewFile || isOffView) return done
  // The view follows every change: whatever still reads backlog.md reads what the store says.
  const view = await writeView({ dir: ctx.dir, ...(await readStore(ctx.dir, ctx.fs)) }, ctx.viewFile, ctx.fs, { now })
  return { ok: true, result: { ...done.result, view: view.ok ? 'written' : view.why } }
}

/**
 * Focus 2: a draft of the partner's, handed to the board's goal map (`ctx.goalDraft`, src/focus.mjs `focusMove`): the
 * goal (`goal`), the vibe's `lines` and `picture`, or the how's `parts` ("<title> · <size> · steps B<n>"),
 * `partnerDecides` and `youDecide`. Answers the board's refusal, or one line; the store is not changed.
 */
async function goalDraft(body, ctx) {
  if (typeof ctx.goalDraft !== 'function') return refuse(409, 'This board keeps no goal map: nothing was kept.')
  const goal = line(body.goal, 20)
  if (!/^G\d+$/.test(goal)) return refuse(400, 'Name the focus goal: goal G<n>.')
  const isVibe = body.action === 'vibe-draft'
  const draft = isVibe
    ? { command: 'vibe-draft', id: goal, lines: body.lines, ...(body.picture === undefined ? {} : { picture: body.picture }) }
    : { command: 'how-draft', id: goal, parts: body.parts, ...(body.partnerDecides === undefined ? {} : { partnerDecides: body.partnerDecides }), ...(body.youDecide === undefined ? {} : { youDecide: body.youDecide }) }
  const done = await ctx.goalDraft(draft)
  if (!done.ok) return done
  return { ok: true, result: { text: `The board keeps the ${isVibe ? 'vibe' : 'how'} of ${goal}: the Focus page shows it.`, changed: false } }
}

// ---- reading ----

const kindOf = item => valueOf(item, 'Kind') ?? 'step'
const stateOf = item => valueOf(item, 'State')
const isOwner = (item, chat, prefix) => valueOf(item, 'Owner') !== null && plain(valueOf(item, 'Owner'), prefix) === plain(chat, prefix)
const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true })

/** One item in one line: id, state, what it waits for, title. */
function oneLine(item, items) {
  const isOpen = id => !CLEARED.includes(stateOf(items.get(id) ?? { head: new Map() }))
  const open = idsIn(valueOf(item, 'Blocked by')).filter(isOpen)
  // B306: what `Waits for` says holds the step: words until the main chat clears them, ids until each is resolved.
  const words = waitWords(item)
  const waitOpen = waitIds(item).filter(isOpen)
  const waiting = words !== null ? `waiting: ${words}, until the main chat clears it`
    : waitOpen.length > 0 ? `waiting: ${valueOf(item, 'Waits for')}; ${waitOpen.map(id => `${id} is ${stateOf(items.get(id) ?? { head: new Map() }) ?? 'not in the store'}`).join(', ')}` : null
  const waits = [open.length > 0 ? `after ${open.join(', ')}` : null, waiting].filter(Boolean)
  const missed = Number(valueOf(item, 'Missed') ?? 0)
  const turns = missed > 0 ? `, missed ${missed} turn${missed === 1 ? '' : 's'}` : ''
  const fix = isFix(item) ? ', board fix' : ''
  return `- ${valueOf(item, 'Id')} ${stateOf(item)}${fix}${turns}${waits.length > 0 ? ` (${waits.join('; ')})` : ''}: ${valueOf(item, 'Title') ?? valueOf(item, 'Text') ?? ''}`
}

/** `next`: the chat's open instructions, then its steps by state, each in one line; the first in full. */
async function next(body, w) {
  const chat = w.role === 'person' || w.role === 'server' ? line(body.chat, 80) : w.who
  if (chat === '') return refuse(400, 'Name the chat.')
  // Focus 4: the main chat's unread notes come first, and are read once shown (the board woke it for them).
  const notes = w.role === 'main' && w.onlyShows !== true ? await readNotes(chat, w) : { text: '', ids: [] }
  const found = steady(body, w, chat)
  if (!found.ok || notes.ids.length === 0) return found
  return { ok: true, result: { ...found.result, text: `${notes.text}\n\n${found.result.text}`, notes: notes.ids, changed: true } }
}

/**
 * Focus 4: the notes to the main chat it has not read, each in one line, marked read by it (`Main read`; the person's
 * read on the board is the note's State, kept apart); `{ text, ids }`.
 */
async function readNotes(chat, w) {
  const unread = [...w.store.items.values()].filter(item => kindOf(item) === 'note' && valueOf(item, 'Main read') === null && plain(valueOf(item, 'To'), w.prefix) === 'main')
    .sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
  const ids = []
  const shown = []
  for (const item of unread) {
    const found = await load(valueOf(item, 'Id'), w, { kind: ['note'] })
    if (!found.ok) continue
    const words = found.item.sections.get('Text') ?? []
    shown.push(`- ${valueOf(item, 'Id')} from ${valueOf(item, 'From') ?? 'the board'}: ${words.length > 0 ? words.join(' ') : valueOf(item, 'Text') ?? ''}`)
    const done = await save(said(put(copy(found.item), 'Main read', stamp(w.now)), w, 'read by the main chat (work next)'), found.text, w)
    if (done.ok) ids.push(valueOf(item, 'Id'))
  }
  return { text: shown.length === 0 ? '' : `Notes for you, ${chat}:\n${shown.join('\n')}`, ids }
}

/** `next` without the notes: the chat's open instructions, then its steps by state. */
function steady(body, w, chat) {
  const items = [...w.store.items.values()]
  const told = items.filter(item => kindOf(item) === 'instruction' && stateOf(item) === 'open' && plain(valueOf(item, 'Chat'), w.prefix) === plain(chat, w.prefix))
    .sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
  const mine = items.filter(item => kindOf(item) === 'step' && MINE.includes(stateOf(item)) && isOwner(item, chat, w.prefix))
    // Fix first: within a state, a board fix before the others (it jumps the queue, it stops no work under way).
    .sort((a, b) => MINE.indexOf(stateOf(a)) - MINE.indexOf(stateOf(b)) || fixFirst(a, b) || byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
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
  if (done.ok) return { ok: true }
  // B301: a file that changed since it was read is a conflict (409); one that cannot be written is the board's fault (500).
  return refuse(/could not be written/.test(done.why) ? 500 : 409, `${valueOf(item, 'Id')}: ${done.why}; try again.`)
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
  const context = item.sections.get('Context') ?? []
  const lines = added.map(one => `  ${one.trim()}`)
  // B293: above the refine block's mark, so a line added later is never read as part of the block.
  const mark = context.findIndex(one => one.trim() === REFINED_MARK.trim())
  next.sections.set('Context', mark < 0 ? [...context, ...lines] : [...context.slice(0, mark), ...lines, ...context.slice(mark)])
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
  // Focus 4: an Owner written as the chat's whole title is repaired to the list's name when its chat takes it.
  if (valueOf(item, 'Owner') !== null && valueOf(item, 'Owner') !== w.who && isOwner(item, w.who, w.prefix)) item = put(copy(item), 'Owner', w.who)
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
    // B305: the chat takes its own queued step once what blocks it is resolved (the flow's move by the worker), also
    // while it still holds another. A flow.json without that move: the board's move, the chat taking it counted free.
    const byChat = (w.store.flow.step?.moves ?? []).some(one => one.from === 'queued' && one.to === 'taken' && (Array.isArray(one.by) ? one.by : [one.by]).includes(w.role))
    const taken = byChat ? move(item, 'taken', w.role, w) : move(item, 'taken', 'server', w, flowCtx(w, [item], [w.who]), ` (for ${w.who})`)
    // B306: words it waits for that nobody cleared yet hold it whatever else holds.
    if (!taken.ok && waitWords(item) !== null) return refuse(taken.status, `${id} waits for: ${waitWords(item)}; the main chat clears it with work unblock ${id}`)
    if (!taken.ok) {
      const open = blockersOpen(item, flowCtx(w, [item])).map(one => `${one} is ${stateOf(w.store.items.get(one) ?? { head: new Map() }) ?? 'not in the store'}`)
      return open.length === 0 ? taken : refuse(taken.status, `${taken.why}: ${open.join(', ')}`)
    }
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

/**
 * A step of the chat's plan on the step it holds: one History line (the mod writes the card). Pause and resume (spec
 * 2026-10-18): with `commit` (a hash, or none) and `next` (the next action, one line) it is the step's checkpoint,
 * `Checkpoint: <commit> · <next> · <date time>` in its head and one History line; a taken step takes one too.
 */
async function step(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  const isCheckpoint = body.commit !== undefined || body.next !== undefined
  const isPlan = ['step', 'steps', 'names', 'name', 'minutes'].some(key => body[key] !== undefined) || !isCheckpoint
  // A checkpoint stands on every step a chat holds (pause.mjs `HELD`), as the pause counts them.
  const states = isPlan ? ['in progress', 'waiting on you'] : HELD
  if (!isOwner(found.item, w.who, w.prefix) || !states.includes(stateOf(found.item))) return refuse(409, `${id} is not in progress for ${w.who}: take it first.`)
  const checkpoint = isCheckpoint ? checkpointOfBody(body) : null
  if (checkpoint !== null && !checkpoint.ok) return checkpoint
  if (!isPlan) {
    const item = ordered(said(put(copy(found.item), 'Checkpoint', checkpointLine({ ...checkpoint, now: w.now })), w, `checkpoint ${checkpoint.commit} · ${checkpoint.next}`))
    const done = await save(item, found.text, w)
    return done.ok ? changed(item, `${id}: checkpoint ${checkpoint.commit} · ${checkpoint.next}.`) : done
  }
  const names = Array.isArray(body.names) ? body.names.map(one => line(one, 60)).filter(Boolean) : []
  const total = names.length > 0 ? names.length : Number.isInteger(Number(body.steps)) && Number(body.steps) > 0 ? Number(body.steps) : null
  const number = body.step === undefined ? null : Number(body.step)
  if (number !== null && !(Number.isInteger(number) && number >= 1)) return refuse(400, '"step" is the number of the step you are on now.')
  const minutes = body.minutes === undefined ? null : Number(body.minutes)
  const name = number !== null ? names[number - 1] ?? line(body.name, 60) : line(body.name, 60)
  const words = [number === null ? 'a new plan' : `step ${number}${total === null ? '' : `/${total}`}`, name === '' || name === undefined ? null : name, Number.isFinite(minutes) && minutes > 0 ? `about ${Math.round(minutes)} min left` : null].filter(Boolean).join(', ')
  const planned = said(found.item, w, words)
  const item = checkpoint === null ? planned : ordered(said(put(copy(planned), 'Checkpoint', checkpointLine({ ...checkpoint, now: w.now })), w, `checkpoint ${checkpoint.commit} · ${checkpoint.next}`))
  const done = await save(item, found.text, w)
  return done.ok ? changed(item, `${id}: ${words}.${checkpoint === null ? '' : ` Checkpoint ${checkpoint.commit} · ${checkpoint.next}.`}`) : done
}

/** A checkpoint's fields from work step: `{ ok, commit, next }` (commit "none" when not given), or a refusal. */
function checkpointOfBody(body) {
  const commit = line(body.commit ?? '', 60)
  const next = line(body.next ?? '', LINE_CHARS)
  if (commit !== '' && commit.toLowerCase() !== 'none' && !/^[0-9a-f]{4,40}$/i.test(commit)) return refuse(400, '"commit" is the commit hash, or none.')
  if (next === '') return refuse(400, '"next" is the next action, in one line.')
  return { ok: true, commit: commit === '' ? 'none' : commit.toLowerCase() === 'none' ? 'none' : commit, next }
}

/** Pause and resume (spec 2026-10-18): the pause state for the asking chat (pause.mjs `pauseAnswer`), with a line of words. */
function pauseStateOf(w) {
  const answer = pauseAnswer({ pause: w.store.pause ?? null, items: w.store.items, lanes: w.lanes ?? [], prefix: w.prefix ?? '', chat: w.who, role: w.role })
  const when = Number.isFinite(answer.since) ? ` since ${stamp(answer.since).slice(11)}` : ''
  return { text: `The board's pause state: ${answer.state}${when}.`, ...answer }
}

/** The person's Pause all and Resume all, and the board's own "running" once every holder is back: pause.json. */
async function pauseWrite(body, w) {
  const now = await readPauseFile(w.dir, w.fs)
  // The review of part 1: the person's End resume sets running too, for a chat that will never start.
  const to = { 'pause-all': 'pausing', 'resume-all': 'resuming', resumed: 'running', 'end-resume': 'running' }[w.action]
  // Pausing again keeps the first time; only a resume becomes running.
  if ((to === 'pausing' && now.record?.state === 'pausing') || (to === 'running' && now.record?.state !== 'resuming')) {
    return { ok: true, result: { text: `The pause state stays ${now.record?.state ?? 'running'}.`, pause: now.record, changed: false } }
  }
  // A resume keeps when the pause began, and so does the running after it (the review of Pause 2: the outbox's
  // lines are not late for the time the pause held them).
  const pausedSince = to === 'resuming' && now.record?.state === 'pausing' ? now.record.since : to === 'running' ? now.record?.pausedSince : null
  const record = { state: to, since: w.now, by: w.role, ...(Number.isFinite(pausedSince) ? { pausedSince } : {}) }
  const done = await writePause(w.dir, record, w.fs, { expected: now.text })
  if (!done.ok) return refuse(/could not be written/.test(done.why) ? 500 : 409, `${done.why}; try again.`)
  return { ok: true, result: { text: `The pause state is ${to} since ${stamp(w.now).slice(11)}.`, pause: record, changed: true } }
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
  // Focus 3: an ask of a goal (the partner's question on the focus) stands under no step; its Of names the goal.
  const goal = typeof body.of === 'string' && GOAL_ID.test(body.of) ? body.of : null
  // The review: only the partner asks of a goal, and only of one in the goal map (`hasGoal`, from the board).
  if (goal !== null && w.role !== 'advisor') return refuse(403, 'Only the partner asks of a goal; ask under a step.')
  if (goal !== null && w.hasGoal?.(goal) !== true) return refuse(409, `${goal} is not in the goal map.`)
  const isAlone = goal !== null || body.of === undefined || body.of === null || body.of === ''
  const of = isAlone ? { ok: true, item: null, text: null } : await load(body.of, w, { kind: ['step'] })
  if (!of.ok) return of
  const holder = isAlone ? null : valueOf(of.item, 'Owner')
  if (holder !== null && !['main', 'advisor', 'person'].includes(w.role) && !isOwner(of.item, w.who, w.prefix)) {
    return refuse(409, `${valueOf(of.item, 'Id')} is ${holder}'s: only ${holder}, the main chat, the partner or the person asks under it.`)
  }
  const kind = body.kind ?? 'decide'
  if (!ASK_KINDS.includes(kind)) return refuse(400, `"kind" is ${ASK_KINDS.join(', ')}.`)
  // Focus 3, the review: a blocking ask holds a step only when the chat that holds it asks; the partner's or the main
  // chat's ask under a worker's step is not blocking for it, so the step never waits on an ask its owner cannot close.
  const isHolder = holder !== null && isOwner(of.item, w.who, w.prefix)
  const blocking = (body.blocking === true || body.blocking === 'yes') && (isAlone || holder === null || isHolder)
  const text = lines(body.text)
  if (text.length === 0) return refuse(400, 'Say what you ask in "text".')
  const options = lines(body.options, LINE_CHARS).slice(0, 8)
  const pictures = (Array.isArray(body.pictures) ? body.pictures : typeof body.pictures === 'string' ? body.pictures.split(',') : []).map(one => line(one, 200)).filter(Boolean).slice(0, 8)
  const play = line(body.play, 300)
  const advice = line(body.advice, 120)
  const via = ['form', 'chat'].includes(body.via) && w.role !== 'person' ? body.via : null
  const made = await makeAsk(w, { of: of.item, kind, blocking, text, options, advice, pictures, play, via, goal })
  if (!made.ok) return made
  const { question, id, title } = made
  const stepId = isAlone ? null : valueOf(of.item, 'Id')
  const block = forYouBlock({ id, of: stepId ?? goal, kind, blocking, title, options, advice, pictures, play }, w.boardUrl ?? '')
  if (isAlone) return changed(question, block)
  let item = said(underStep(of.item, [`Asked ${id} (${kind}${blocking ? ', blocking' : ''}): ${title}`]), w, `asked ${id}`)
  let moved = ''
  if (blocking && isHolder && stateOf(item) === 'in progress') {
    const waits = move(item, 'waiting on you', w.role, w, flowCtx(w, [item, question]))
    if (waits.ok) item = waits.item
    else moved = ` (${stepId} stays ${stateOf(item)}: ${waits.why})`
  }
  const done = await save(item, of.text, w)
  if (!done.ok) return done
  return changed(question, `${block}${moved}`)
}

/** B299: writes a new ask `Q<n>` (under the step `of`, an item, or alone): `{ ok, question, id, title }`. */
async function makeAsk(w, { of = null, kind, blocking = false, text, options = [], advice = '', pictures = [], play = '', via = null, goal = null }) {
  const id = await nextId(w.dir, 'Q', w.fs)
  const title = line(text[0], 200)
  let question = ordered({
    head: new Map([['Id', id], ['Kind', 'ask'], ['Title', title], ['State', 'open'], ['Owner', w.role === 'person' ? '-' : w.who], ['Activity', of === null ? '-' : valueOf(of, 'Activity') ?? '-'],
      ['Since', stamp(w.now)], ['Pictures', pictures.length === 0 ? '-' : pictures.join(', ')], ['Asks', kind], ['Blocking', blocking ? 'yes' : 'no'], ['Of', of === null ? goal ?? '-' : valueOf(of, 'Id')],
      ['Options', options.length === 0 ? '-' : options.join(' | ')], ['Advice', advice === '' ? '-' : advice], ['Via', via ?? '-']].filter(([, value]) => value !== '-')),
    sections: new Map([['Text', text], ...(play === '' ? [] : [['Play', [play]]])]),
    problem: null,
  })
  question = said(question, w, `asked (${kind}${blocking ? ', blocking' : ''}${via === 'form' ? ', with the app\'s question form' : via === 'refine' ? ', refining' : via === 'chat' ? ', from its "For you" block' : ''})`)
  const wrote = await save(question, null, w)
  return wrote.ok ? { ok: true, question, id, title } : wrote
}

/**
 * B299: the person answered one of the chat's asks in the chat itself (the app's question form, or its "For you" block
 * answered in words): the chat that asked closes it with their words (`text`), so the board no longer shows it open,
 * and a step that waited only on its asks goes on. Review: any ask of its own, not only the form's. B305: an ask with
 * no asking chat (one carried over from the old backlog) is closed by the main chat or the Advisor, in whose chat the
 * person answered it, with the person's words.
 */
async function answeredInChat(body, w) {
  const found = await load(body.id, w, { kind: ['ask'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  const isOrphan = valueOf(found.item, 'Owner') === null
  if (isOrphan && !['main', 'advisor'].includes(w.role)) return refuse(409, `${id} has no asking chat: only the main chat or the Advisor closes it, in whose chat the person answered it.`)
  if (!isOrphan && !isOwner(found.item, w.who, w.prefix)) return refuse(409, `${id} is ${valueOf(found.item, 'Owner')}'s: only the chat that asked closes it.`)
  if (stateOf(found.item) !== 'open') return { ok: true, result: { id, text: `${id} is ${stateOf(found.item)} already.`, changed: false } }
  const text = lines(body.text)
  if (isOrphan && text.length === 0) return refuse(400, `Give the person's words in "text" (with the date): ${id} has no asking chat.`)
  const short = line(text.join(' '), 200)
  let item = put(put(copy(found.item), 'State', 'answered'), 'Since', stamp(w.now))
  if (text.length > 0) item.sections.set('Answer', text)
  // B305: an ask that stands on the backlog itself (an @you step) shows the answer under its line, as the board's answer does.
  if (isOrphan && valueOf(found.item, 'Of') === null && !/^Qd+$/.test(id)) item = underStep(item, [`Answered in ${w.who}'s chat by the person on ${at(w.now)}: ${short}`])
  item = said(item, w, isOrphan ? `answered in its chat by the person: ${short}` : `answered in the chat${short === '' ? '' : `: ${short}`}`)
  const of = valueOf(found.item, 'Of')
  const done = await answerStep(w, item, found.text, of, step => {
    let mine = said(underStep(step, [`${id} answered in ${w.who}'s chat${isOrphan ? ' by the person' : ''} on ${at(w.now)}${short === '' ? '' : `: ${short}`}`]), w, `${id} answered`)
    if (stateOf(mine) === 'waiting on you') {
      const goesOn = move(mine, 'in progress', 'server', w, flowCtx(w, [item, mine]), ` (${id} answered)`)
      if (goesOn.ok) mine = goesOn.item
    }
    return mine
  })
  return done.ok ? { ok: true, result: { ...done.result, text: `${id} answered in the chat.` } } : done
}

/** Information, never a question: a note `N<n>` to the person or to the main chat. */
async function note(body, w) {
  if (typeof body.of === 'string' && GOAL_ID.test(body.of)) return dailyNoteMade(body, w)
  // Focus 4: the main chat by its name (with or without the prefix) is main.
  const named = typeof body.to === 'string' ? chatName(body.to, w, { mayBeGone: true }).name : null
  const isMain = body.to === 'main' || (named !== null && named !== '' && w.roleOf?.(named) === 'main')
  const to = isMain ? 'main' : body.to === 'you' || body.to === undefined ? 'you' : null
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

/**
 * Focus 3 (spec 2026-10-18, section 5): the partner's daily note on a goal (`of` G<n>): to the person, `decided` (one
 * line each, what it settled for them) and `needs` (the ids of its asks), `text` if any. Only the partner (the role
 * advisor) writes one.
 */
async function dailyNoteMade(body, w) {
  if (w.role !== 'advisor') return refuse(403, 'Only the partner writes the note of a goal (its daily note).')
  if ((body.to ?? 'you') !== 'you') return refuse(400, 'The note of a goal is to you, the person.')
  if (w.hasGoal?.(body.of) !== true) return refuse(409, `${body.of} is not in the goal map.`)
  const decided = lines(body.decided, LINE_CHARS).map(one => line(one)).filter(Boolean).slice(0, 12)
  const needs = [...new Set((Array.isArray(body.needs) ? body.needs : typeof body.needs === 'string' ? body.needs.split(',') : []).map(one => line(String(one), 20)).filter(Boolean))]
  const text = lines(body.text)
  if (decided.length === 0 && needs.length === 0 && text.length === 0) return refuse(400, 'Say what you decided for the person in "decided", or which asks need them in "needs".')
  for (const id of needs) {
    if (!/^Q\d+$/.test(id) || kindOf(w.store.items.get(id) ?? { head: new Map([['Kind', 'none']]) }) !== 'ask') return refuse(409, `${id} is no ask in the store: name your asks under "needs" by their ids (Q12).`)
  }
  const id = await nextId(w.dir, 'N', w.fs)
  const head = text.length > 0 ? line(text.join(' '))
    : `Today's note on ${body.of}: ${decided.length} decided for you, ${needs.length} need${needs.length === 1 ? 's' : ''} you`
  const item = said({
    head: new Map([['Id', id], ['Kind', 'note'], ['From', w.who], ['To', 'you'], ['Of', body.of], ['State', 'unread'], ['Since', stamp(w.now)], ['Text', head]]),
    sections: new Map([...(text.length === 0 ? [] : [['Text', text]]), [DECIDED, decided.map(one => `- ${one}`)], [NEEDS, needs.map(one => `- ${one}`)]]),
    problem: null,
  }, w, 'noted (the daily note)')
  const done = await save(item, null, w)
  return done.ok ? changed(item, `${id}: today's note on ${body.of} for the person.`) : done
}

/**
 * Focus 3: the person's Undo of a line the partner decided for them (`line`, in the daily note `id`): the line stands
 * under "Undo asked" with its time, once; the server then types `undo: <line>` to the partner. A second Undo of the
 * same line changes nothing and types nothing (Review Focus 4).
 */
async function undo(body, w) {
  const found = await load(body.id, w, { kind: ['note'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  if (!isDailyNote(found.item)) return refuse(409, `${id} is no daily note of a goal: nothing in it can be undone.`)
  const wanted = line(body.line)
  if (!decidedOf(found.item).includes(wanted)) return refuse(409, `${id} decided no such thing: "${wanted.slice(0, 80)}".`)
  const undo = { of: valueOf(found.item, 'Of'), from: valueOf(found.item, 'From'), line: wanted }
  if (undoneOf(found.item).includes(wanted)) return { ok: true, result: { id, text: 'Undo was asked already.', changed: false, asked: true } }
  // The review: `check` only says whether it may be asked; the board types the word first, then marks it.
  if (body.check === true) return { ok: true, result: { id, text: 'Undo may be asked.', changed: false, asked: false, undo } }
  const item = copy(found.item)
  item.sections.set(UNDONE, [...(found.item.sections.get(UNDONE) ?? []), `- ${wanted} (${stamp(w.now)})`])
  const next = said(item, w, `undo asked: ${line(wanted, 200)}`)
  const done = await save(next, found.text, w)
  return done.ok ? changed(next, undefined, { undo }) : done
}

async function makeNote(w, to, text, of, via = null) {
  const id = await nextId(w.dir, 'N', w.fs)
  const item = said({
    head: new Map([['Id', id], ['Kind', 'note'], ['From', w.who], ['To', to], ...(via === null ? [] : [['Via', via]]), ['State', 'unread'], ['Since', stamp(w.now)], ['Text', line(text.join(' '), LINE_CHARS)]]),
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
  // B304: a report from review runs the board's check again (the flow's move review → review), say after a fix.
  const isAgain = stateOf(found.item) === 'review'
  let moved
  if (isAgain) {
    const allowed = mayMove(w.store.flow, found.item, 'review', w.role, flowCtx(w, [found.item]))
    moved = allowed.ok ? { ok: true, item: said(found.item, w, 'reported again') } : refuse(409, allowed.why)
  } else moved = move(found.item, 'review', w.role, w)
  if (!moved.ok) return moved
  const item = appendHistory(underStep(moved.item, [`Reported ${isAgain ? 'again ' : ''}by ${w.who} on ${at(w.now)}: ${result}${merged === '' ? '' : ` (merged ${merged})`}`]), 'server', 'check pending', w.now)
  const done = await save(item, found.text, w)
  if (!done.ok) return done
  // Focus 4, the review: the board's own note of a report (Via: report) wakes nobody: the worker tells the main chat.
  await makeNote(w, 'main', [`${id} reported ${isAgain ? 'again ' : ''}by ${w.who}: ${line(result, 200)}`], id, 'report')
  // B301: the chat's next step, when the store holds one for it (queued or taken): the Workers mod keeps the chat's
  // context for it instead of compacting it after this report.
  const more = [...w.store.items.values()].filter(one => kindOf(one) === 'step' && valueOf(one, 'Id') !== id && isOwner(one, w.who, w.prefix) && ['queued', 'taken'].includes(stateOf(one)))
    .map(one => valueOf(one, 'Id')).sort(byId)[0] ?? null
  return changed(item, undefined, { check: { id, branch: valueOf(item, 'Branch'), result, merged: merged === '' ? lastReport(found.item).merged : merged, touches: touchesLines(item) }, more })
}

const REPORTED = /^Reported (?:again )?by .+? on \d{4}-\d\d-\d\d at \d\d:\d\d: (.*?)(?: \(merged ([^()\s]+)\))?$/
/** B304: what the step's reports said: the last result, and the last merged commit named ('' for none). */
function lastReport(item) {
  const reports = (item.sections.get('Context') ?? []).map(one => one.trim().match(REPORTED)).filter(Boolean)
  return { result: reports.at(-1)?.[1] ?? '', merged: reports.findLast(one => one[2] !== undefined)?.[2] ?? '' }
}

/** B304: the person's "Check again" on a step in review: the board runs its check anew with what was reported. */
async function recheck(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  if (stateOf(found.item) !== 'review') return refuse(409, `${id} is ${stateOf(found.item)}: only a step in review is checked again.`)
  const item = appendHistory(said(found.item, w, 'check asked again'), 'server', 'check pending', w.now)
  const done = await save(item, found.text, w)
  if (!done.ok) return done
  return changed(item, undefined, { check: { id, branch: valueOf(item, 'Branch'), ...lastReport(item), touches: touchesLines(item) } })
}

/** The open asks under a step, by id. */
const openAsksOf = (w, id) => [...w.store.items.values()]
  .filter(one => kindOf(one) === 'ask' && valueOf(one, 'Of') === id && stateOf(one) === 'open').map(one => valueOf(one, 'Id')).sort(byId)

/**
 * Review 1: the chat that asked takes its ask back (it found the answer, or the question went): the ask is withdrawn,
 * and a step that waited only on its asks goes on (the flow's move by the server). The step is written first. B305:
 * an ask with no asking chat (carried over from the old backlog) is the main chat's to withdraw, with a why.
 */
async function withdraw(body, w) {
  const found = await load(body.id, w, { kind: ['ask'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  if (stateOf(found.item) !== 'open') return refuse(409, `${id} is not open.`)
  const asker = valueOf(found.item, 'Owner')
  const why = line(body.why, 300)
  if (asker === null && w.role !== 'person') {
    if (w.role !== 'main') return refuse(409, `${id} has no asking chat: only the main chat withdraws it.`)
    if (why === '') return refuse(400, `Say why in "why": ${id} has no asking chat.`)
  } else if (w.role !== 'person' && plain(asker, w.prefix) !== plain(w.who, w.prefix)) return refuse(409, `${id} is ${asker}'s to withdraw.`)
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
  // Focus 3: an ask of a goal has no step to follow.
  if (of !== null && !GOAL_ID.test(of)) {
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
  if (!done.ok) return done
  if (stateOf(item) === 'done') await closeFixed(item, w)
  // B356: the board's check passed and the step waits for its result check, none asked yet: the server asks the partner.
  const isWaiting = passed && stateOf(item) === 'review' && needsResultCheck(item) && resultCheckOf(item) === null
  return changed(item, undefined, isWaiting ? { resultCheck: { id: valueOf(item, 'Id'), title: valueOf(item, 'Title'), owner: valueOf(item, 'Owner') } } : {})
}

/**
 * B356: the result check of a step in review, filed by the partner (a helper that did not build it checked it):
 * `evidence` (the evidence picture's path, or "none (<why>)"), `points` (every agreed point, "pass: ...", "fail: ..."
 * or "ask: ..."), `score` at will ("82 of 75"). Kept under "## Checked". All pass: the step is done once the board's
 * own check passed too. A failed point makes a fix step for the same worker (fixStep) and counts an attempt; a point
 * only the person can judge (ask) makes none: the partner asks them, and the step waits in review.
 */
async function checked(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  if (stateOf(found.item) !== 'review') return refuse(409, `${id} is ${stateOf(found.item)}: only a step in review is checked.`)
  const evidence = line(body.evidence, 300)
  if (evidence === '') return refuse(400, 'Name the evidence picture in "evidence", by its path, or "none (<why>)".')
  const read = parsePoints(body.points)
  if (!read.ok) return refuse(400, read.why)
  const score = line(body.score, 60)
  const { points } = read
  const failed = points.filter(one => one.verdict === 'fail')
  const judged = points.filter(one => one.verdict === 'ask')
  const summary = `${points.filter(one => one.verdict === 'pass').length} of ${points.length} points pass${score === '' ? '' : `, score ${score}`}`
  let item = copy(found.item)
  item.sections.set('Checked', [`Evidence: ${evidence}`, ...(score === '' ? [] : [`Score: ${score}`]), ...points.map(one => `- ${one.verdict}: ${one.text}`)])
  let fix = null
  if (failed.length > 0) {
    const made = await fixStep(found.item, failed, w)
    if (!made.ok) return made
    fix = made.id
    item = put(item, 'Attempts', String(Number(valueOf(found.item, 'Attempts') ?? 0) + 1))
  }
  const owner = valueOf(found.item, 'Owner') ?? 'its worker'
  const words = failed.length > 0
    ? `result check failed: ${summary}; fix ${fix} for ${owner}${judged.length === 0 ? '' : `; ${judged.length} for you to judge`}`
    : judged.length > 0 ? `result check waits for you: ${summary}; ${judged.length} for you to judge` : `result check passed: ${summary}`
  item = said(ordered(item), w, words)
  if (failed.length === 0 && judged.length === 0) {
    const closed = move(item, 'done', 'server', w, flowCtx(w, [item]))
    if (closed.ok) item = closed.item
  }
  const done = await save(item, found.text, w)
  if (!done.ok) return done
  if (stateOf(item) === 'done') await closeFixed(item, w)
  return changed(item, undefined, fix === null ? {} : { fix })
}

/**
 * B356: the fix step a failed result check makes: "Fix: <the failed points>", refined from them at once (ready, "from
 * the result check of B<id>"), with the step's activity, goal and standard, queued for the same worker. Answers
 * `{ ok, id }`.
 */
async function fixStep(origin, failed, w) {
  const originId = valueOf(origin, 'Id')
  const owner = valueOf(origin, 'Owner')
  const activity = valueOf(origin, 'Activity')
  const goal = valueOf(origin, 'Goal')
  const standard = standardOf(origin)
  const what = failed.map(one => `- ${one.text}`)
  const summary = `Fix what the result check of ${originId} found: ${failed.map(one => one.text).join('; ')}`.slice(0, 600)
  const block = [
    `Refined (${stamp(w.now)}; ready; from the result check of ${originId} by ${w.who}):`,
    `Summary: ${summary}`,
    ...(goal === null ? [] : [`Part of: ${goal}`]),
    ...(standard === null ? [] : [`Standard: ${standard}`]),
    'What we build:',
    ...what,
  ].map(one => `  ${one}`)
  const activitiesText = await readActivitiesText(w.dir, w.fs)
  const id = await nextId(w.dir, 'B', w.fs)
  let item = said(ordered({
    head: new Map([['Id', id], ['Kind', 'step'], ['Title', fixTitle(failed)], ...(isFix(origin) ? [['Priority', 'fix']] : []), ['State', 'queued'], ...(owner === null ? [] : [['Owner', owner]]),
      ...(activity === null ? [] : [['Activity', activity]]), ...(goal === null ? [] : [['Goal', goal]]), ['Since', stamp(w.now)], ['Fix of', originId], ['Refined', 'ready']]),
    sections: new Map([
      ['Context', [`  Fix of ${originId}: the result check by ${w.who} failed on ${failed.length === 1 ? 'one point' : `${failed.length} points`}.`, REFINED_MARK]],
      ['Summary', [summary]],
      ...(standard === null ? [] : [['Standard', [standard]]]),
      ['What we build', what],
      ['Refined', block],
    ]),
    problem: null,
  }), w, `made by the result check of ${originId}`)
  item = appendHistory(item, 'server', `queued for ${owner ?? 'nobody'} (a fix of ${originId})`, w.now)
  const wrote = await save(item, null, w)
  if (!wrote.ok) return wrote
  const index = w.store.activities.findIndex(one => one.name === activity)
  if (index >= 0) {
    const activities = w.store.activities.map((one, place) => (place === index ? { ...one, steps: [...(one.steps ?? []), id] } : one))
    const listed = await writeActivities(w.dir, { preamble: w.store.preamble, activities }, w.fs, { expected: activitiesText })
    if (!listed.ok) {
      await removeItem(w.dir, id, w.fs)
      return refuse(409, `activities.json: ${listed.why}; try again.`)
    }
  }
  return { ok: true, id }
}

/**
 * B356: a fix step that is done closes the step it fixes, once no other fix of it is open: "result check passed: its
 * fix B<n> is done", then done by the flow (its own check passed before). Up the chain, a fix of a fix too.
 */
async function closeFixed(item, w) {
  let fixed = item
  for (let depth = 0; depth < 10; depth += 1) {
    const originId = valueOf(fixed, 'Fix of')
    if (originId === null) return
    const found = await load(originId, w, { kind: ['step'] })
    if (!found.ok || stateOf(found.item) !== 'review') return
    // Read anew: the fix that was just written is done in the files, not yet in the store this call read.
    const items = (await readStore(w.dir, w.fs)).items
    if ([...items.values()].some(one => valueOf(one, 'Fix of') === originId && !['done', 'dropped'].includes(stateOf(one)))) return
    let origin = appendHistory(found.item, 'server', `result check passed: its fix ${valueOf(fixed, 'Id')} is done`, w.now)
    const closed = move(origin, 'done', 'server', w, flowCtx(w, [origin]))
    if (closed.ok) origin = closed.item
    const done = await save(origin, found.text, w)
    if (!done.ok || stateOf(origin) !== 'done') return
    fixed = origin
  }
}

/** Blocked by: one more step, or one less. B306: unblock without "on" clears what the step waits for (`Waits for`). */
async function blockOn(body, w, isBlock) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const on = typeof body.on === 'string' ? body.on.trim() : ''
  if (!isBlock && on === '') return clearWaits(found, w)
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

/** B306: the main chat or the person clears a step's `Waits for`: it no longer holds the step; the History says what it was. */
async function clearWaits(found, w) {
  const id = valueOf(found.item, 'Id')
  if (!['main', 'person'].includes(w.role)) return refuse(403, `Only the main chat or the person clears what ${id} waits for.`)
  const words = valueOf(found.item, 'Waits for')
  if (words === null) return { ok: true, result: { id, text: `${id} waits for nothing: nothing to clear.`, changed: false } }
  const item = said(put(copy(found.item), 'Waits for', null), w, `no longer waits for: ${words}`)
  const done = await save(ordered(item), found.text, w)
  return done.ok ? changed(ordered(item)) : done
}

/**
 * A new step `B<n>` in state new, at the end of its activity. Focus 2 (the review): the partner's step from a how the
 * person agreed (`goal`, `summary`, `what`, and `picture`, `size` at will) is made refined at once, its block ready
 * and marked "from the how of G<n> by <partner>", so the board's refine gate sends no second round for it.
 */
async function make(call, w) {
  const body = withStandard(call)
  if ((body.kind ?? 'step') !== 'step') return refuse(400, 'Only a step is made with "new"; an ask with "ask", a note with "note".')
  const title = line(body.title, 200)
  if (title === '') return refuse(400, 'Give the step a title.')
  const names = w.store.activities.map(one => one.name)
  const wanted = line(body.activity, 120).toLowerCase()
  const index = w.store.activities.findIndex(one => one.name.toLowerCase() === wanted)
  if (index < 0) return refuse(400, `Name its activity in "activity": ${names.join(', ')}.`)
  const goal = line(body.goal, 20)
  if (goal !== '' && !/^G\d+$/.test(goal)) return refuse(400, 'A goal is named by its id (G17).')
  // B354: a standard given is kept on the step; a step made ready at once names it when it makes a thing of a kind.
  const standard = body.standard === undefined ? null : parseStandard(body.standard, w.kinds)
  if (standard !== null && !standard.ok) return refuse(400, standard.why)
  const fromHow = body.what === undefined ? null : howBlock(body, goal, w, standard?.line ?? null)
  if (fromHow !== null && !fromHow.ok) return fromHow
  const named = fromHow === null || standard !== null ? [] : kindsNamed(`${title}\n${lines(body.text).join('\n')}`, w.kinds)
  if (named.length > 0) return refuse(409, standardWanted('This step', named))
  const read = lineFields(title)
  if (read.title !== title || read.isYou || read.owner !== null || read.branch !== null || read.asks !== null || read.id !== null) {
    return refuse(400, 'The title would not read back as written: leave out an id at its start, "Verify:" and the like, brackets at its end and @you.')
  }
  const priority = priorityOf(body, w)
  if (!priority.ok) return priority
  const activitiesText = await readActivitiesText(w.dir, w.fs)
  const id = await nextId(w.dir, 'B', w.fs)
  let item = said(ordered({
    head: new Map([['Id', id], ['Kind', 'step'], ['Title', title], ['State', 'new'], ['Activity', names[index]], ...(goal === '' ? [] : [['Goal', goal]]), ['Since', stamp(w.now)]]),
    sections: new Map(lines(body.text).length === 0 ? [] : [['Context', lines(body.text).map(one => `  ${one.trim()}`)]]),
    problem: null,
  }), w, 'made')
  if (priority.fix) item = ordered(markedFix(item, w))
  if (standard !== null) item.sections.set('Standard', [standard.line])
  if (fromHow !== null) {
    const ready = copy(item)
    for (const [name, value] of fromHow.sections) ready.sections.set(name, value)
    ready.sections.set('Context', withMark(item))
    put(ready, 'Refined', 'ready')
    const moved = move(ordered(said(ready, w, `refined is ready (from the how of ${goal})`)), 'refined', w.role, w)
    if (!moved.ok) return moved
    item = ordered(moved.item)
  }
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

/**
 * B354: the call with its standard read: `standard` as given, else a line of `what` that starts with "Standard:" (a
 * chat whose work tool has no field "standard" yet writes it there), taken out of `what`.
 */
function withStandard(body) {
  if (body.standard !== undefined || body.what === undefined) return body
  const all = lines(body.what, 300)
  const at = all.findIndex(one => /^(?:[-*]\s+)?Standard:\s*\S/i.test(one.trim()))
  if (at < 0) return body
  return { ...body, standard: all[at].trim().replace(/^(?:[-*]\s+)?Standard:\s*/i, ''), what: all.filter((one, index) => index !== at) }
}

/** Fix first: who marks a step as a fix for the worker board (`priority: 'fix'` on new and queue). */
const FIX_ROLES = ['main', 'advisor', 'person']

/** Fix first: the call's `priority`: `{ ok, fix }`, or a refusal (another value; a chat that may not mark it). */
function priorityOf(body, w) {
  const value = line(body.priority, 20).toLowerCase()
  if (value === '') return { ok: true, fix: false }
  if (value !== 'fix') return refuse(400, '"priority" is fix, or left out.')
  if (!FIX_ROLES.includes(w.role)) return refuse(403, 'Only the main chat, the partner or the person marks a step as a board fix.')
  return { ok: true, fix: true }
}

/** Fix first: the step marked as a board fix, with its History line; as it was when it is one already. */
const markedFix = (item, w) => (isFix(item) ? item : said(put(item, 'Priority', 'fix'), w, 'marked a board fix'))

/** Main queues a refined step for a chat: Owner, Blocked by or Waits for, Estimate. */
async function queue(body, w) {
  return warned(await queueStep(body, w), body.for === undefined ? undefined : chatName(line(body.for, 80), w).warning)
}

async function queueStep(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  if (line(body.for, 80) === '') return refuse(400, 'Name the chat it is for in "for".')
  if (line(body.for, 80).includes(';')) return refuse(400, '"for" holds no ";".')
  // Focus 4: the chat as the list names it.
  const named = chatName(line(body.for, 80), w)
  if (!named.ok) return named
  const owner = named.name
  const after = line(body.after, 200).replace(/^after\s+/i, '')
  if (after.includes(';')) return refuse(400, '"after" holds no ";".')
  const about = line(body.about, 40).replace(/^about\s+/i, '')
  if (about !== '' && minutesOf(`about ${about}`) === null) return refuse(400, '"about" is a time such as "1 h" or "40 min".')
  const words = [`for ${owner}`, after === '' ? null : `after ${after}`, about === '' ? null : `about ${about}`].filter(Boolean).join('; ')
  const priority = priorityOf(body, w)
  if (!priority.ok) return priority
  const fixed = item => (priority.fix ? markedFix(item, w) : item)
  // Fix first: a step queued already for that chat is only marked as a board fix; it keeps its place in the flow.
  if (priority.fix && stateOf(found.item) === 'queued') {
    const id = valueOf(found.item, 'Id')
    const was = valueOf(found.item, 'Owner')
    if (was === null || plain(was, w.prefix) !== plain(owner, w.prefix)) return refuse(409, `${id} is queued for ${was ?? 'no chat'}: give it to ${owner} with requeue first, then mark it.`)
    if (isFix(found.item)) return { ok: true, result: { id, text: `${id} is a board fix already.`, changed: false } }
    const next = ordered(fixed(copy(found.item)))
    const done = await save(next, found.text, w)
    return done.ok ? changed(next) : done
  }
  const moved = move(found.item, 'queued', w.role, w)
  // B309: a refined step with asks under it that count as its refine questions (open, or answered and not folded in
  // yet) is not refined for the queue: the wish is kept, and the board queues it once the Advisor folded them in.
  const pending = asksCounted(w.store.items, found.item)
  if (moved.ok && pending.length > 0) {
    const id = valueOf(found.item, 'Id')
    const open = pending.filter(one => one.answer === null).map(one => one.id)
    const why = open.length > 0
      ? `waits for ${open.join(', ')}: the person answers, the Advisor folds it in`
      : `waits for the Advisor to fold in the answers to ${pending.map(one => one.id).join(', ')}`
    const next = ordered(fixed(said(put(copy(found.item), 'Queue when refined', words), w, `${QUEUE_ASKED}: ${words}`)))
    const done = await save(next, found.text, w)
    return done.ok ? changed(next, `${id} ${why}, then the board queues it for ${owner} by itself.`, { queueWhenRefined: words }) : done
  }
  if (!moved.ok) {
    if (!queuesOnceRefined(found.item, words, w)) return moved
    // B303: not refined yet: the wish is kept on the step; the refine gate sends it to the Advisor, and once it is
    // refined the board queues it by itself (`queueAsked`).
    const id = valueOf(found.item, 'Id')
    const next = ordered(fixed(said(put(copy(found.item), 'Queue when refined', words), w, `${QUEUE_ASKED}: ${words}`)))
    const done = await save(next, found.text, w)
    return done.ok ? changed(next, `${id} is not refined yet: the Advisor refines it first, then the board queues it for ${owner} by itself.`, { queueWhenRefined: words }) : done
  }
  const next = ordered(fixed(said(queuedAs(moved.item, { owner, after, about }), w, `queued ${words}`)))
  const done = await save(next, found.text, w)
  return done.ok ? changed(next) : done
}

/** Owner, Blocked by or Waits for, Estimate of a step queued now; the backlog's queue note and a kept wish go. */
function queuedAs(item, { owner, after, about }) {
  put(item, 'Owner', owner)
  put(item, 'Blocked by', ONLY_IDS.test(after) ? after : null)
  put(item, 'Waits for', after !== '' && !ONLY_IDS.test(after) ? after : null)
  put(item, 'Estimate', about)
  item.head.delete('Queue note')
  item.head.delete('Queue when refined')
  return item
}

/** B303: the History words of a queue asked before the step's refine; the board's own queue names who asked by them. */
const QUEUE_ASKED = 'queue asked before its refine'

/**
 * B303: whether a queue the flow refuses now is refused only because the step is not refined yet: it is new, the one
 * who asks could queue it once it is refined, and the flow lets the board queue it then with this wish kept.
 */
function queuesOnceRefined(item, words, w) {
  if (stateOf(item) !== 'new') return false
  const refined = put(put(copy(item), 'State', 'refined'), 'Queue when refined', words)
  const ctx = flowCtx(w, [refined])
  // B309: as once its refine is ready: the asks under it answered and folded in.
  for (const ask of openAsksUnder(ctx.store.items, valueOf(item, 'Id'), item)) ctx.store.items.delete(valueOf(ask, 'Id'))
  return mayMove(w.store.flow, refined, 'queued', w.role, ctx).ok && mayMove(w.store.flow, refined, 'queued', 'server', ctx).ok
}

/**
 * B303: a refined step whose queue was asked before its refine: the board queues it by itself, as the server, with
 * what was asked, and the wish goes. `item` as it is about to be written; it is answered as it was when the flow does
 * not let the board queue it (the reconciler names the move again later).
 */
function queueAsked(item, w) {
  const wish = valueOf(item, 'Queue when refined')
  if (wish === null || stateOf(item) !== 'refined') return item
  // B309: it waits for the asks under it too, and for the round that folds their answers in.
  if (openAsksUnder(w.store.items, valueOf(item, 'Id'), item).length > 0 || asksCounted(w.store.items, item).length > 0) return item
  const moved = move(item, 'queued', 'server', w, flowCtx(w, [item]))
  if (!moved.ok) return item
  const part = name => wish.split(';').map(one => one.trim()).find(one => one.startsWith(`${name} `))?.slice(name.length + 1).trim() ?? ''
  const asker = (item.sections.get('History') ?? []).findLast(one => one.includes(`: ${QUEUE_ASKED}`))?.match(/^- \S+ \S+ (.+?): /)?.[1] ?? null
  const by = asker === null ? '' : ` (asked by ${asker === 'person' ? 'you' : asker} before its refine)`
  return ordered(appendHistory(queuedAs(moved.item, { owner: part('for'), after: part('after'), about: part('about') }), 'server', `queued ${wish}${by}`, w.now))
}

/**
 * B301, the review: Main or the person gives a queued step to another chat (the page's "Move to"): its Owner changes,
 * it stays queued, and its Since is now, so the board delivers it anew to the new chat. Only a queued step.
 */
async function requeue(body, w) {
  return warned(await requeueStep(body, w), body.for === undefined ? undefined : chatName(line(body.for, 80), w).warning)
}

async function requeueStep(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  if (line(body.for, 80) === '') return refuse(400, 'Name the chat it goes to in "for".')
  const named = chatName(line(body.for, 80), w)
  if (!named.ok) return named
  const owner = named.name
  const state = stateOf(found.item)
  if (state !== 'queued') return refuse(409, `${id} is ${state}, not queued: only a queued step moves to another chat.`)
  const was = valueOf(found.item, 'Owner')
  if (was !== null && plain(was, w.prefix) === plain(owner, w.prefix)) return refuse(409, `${id} is queued for ${was} already.`)
  const item = put(put(copy(found.item), 'Owner', owner), 'Since', stamp(w.now))
  const next = ordered(said(item, w, `requeued for ${owner}${was === null ? '' : ` (was ${was})`}`))
  const done = await save(next, found.text, w)
  return done.ok ? changed(next) : done
}

/**
 * B301, the review: Main or the person takes a queued step out of its queue (the page's "Take out of the queue"): back
 * to refined when its refine is ready, else to new (flow.json), without a chat; it stays on the backlog.
 */
async function unqueue(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const was = valueOf(found.item, 'Owner')
  const to = valueOf(found.item, 'Refined') === 'ready' ? 'refined' : 'new'
  const moved = move(found.item, to, w.role, w, flowCtx(w, [found.item]), ` (unqueued${was === null ? '' : `; was for ${was}`})`)
  if (!moved.ok) return moved
  const next = ordered(put(moved.item, 'Owner', null))
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
    head: new Map([['Id', id], ['Kind', 'instruction'], ['Chat', chat], ['State', 'open'], ['Since', toSecond(w.now)], ['Filed', String(w.now)], ['Via', w.role === 'person' ? 'board' : 'chat'], ['Text', line(text.join(' '), LINE_CHARS)]]),
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
    && plain(valueOf(one, 'Chat'), w.prefix) === plain(chat, w.prefix) && filedMs(one) <= since)
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
  // B317: the items of the "For you" block the chat's answer ended with, that it filed no ask for: filed now.
  const asked = body.forYou === undefined || w.role === 'person' || w.role === 'server' ? undefined : await askForYou(body.forYou, since, w)
  const filedLine = asked === undefined || asked.length === 0 ? '' : ` Filed from your "For you" block: ${asked.join(', ')}; close one the person answers in the chat with work answered-in-chat.`
  const text = `${missed.length === 0 ? 'No instruction was left open.' : `Left open: ${missed.join(', ')}. Close each with work close <id> --as "what came of it", or say why it stays open.`}${filedLine}`
  // The review of B300: with `pull`, the same call answers the chat's pull (one call at a turn's end).
  const pulled = body.pull === true ? (({ changed: _, ...rest }) => rest)(pull(body, { ...w, who: chat }).result) : undefined
  // Pause and resume (spec 2026-10-18): the same call answers the pause state, so the mod needs no call of its own.
  const { text: _words, ...pause } = pauseStateOf({ ...w, who: chat })
  return { ok: true, result: { text, missed, open, changed: missed.length > 0 || (asked?.length ?? 0) > 0, ...(asked === undefined ? {} : { asked }), ...(pulled === undefined ? {} : { pull: pulled }), pause } }
}

const MINUTE = 60_000
const ASK_REF = /^Q\d+$/
/** B317: an ask's words for comparing: no links, marks of markdown, the work tool's "(Q4, decide, ...)", case or end marks. */
const askKey = value => line(String(value ?? '').replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, '$1').replace(/\((Q\d+),[^)]*\)\s*$/, '').replace(/[*_`~]/g, ''), 200)
  .toLowerCase().replace(/[\s.?!:;,]+$/, '')
/** B317: two asks' words are the same question: equal, or one the start of the other (a title is cut, advice added). */
const sameAsk = (a, b) => a === b || (a.length >= 12 && b.startsWith(a)) || (b.length >= 12 && a.startsWith(b))
/**
 * B362: whether an item's lines name an open ask of the chat's own by its id, anywhere in them, as a word of its own.
 * The review: only its own, so a new question that names another chat's ask for context is still filed.
 */
const namesOpenAsk = (text, w) => text.some(words => [...words.matchAll(/(?<![\w-])(Q\d{1,6})(?![\w-])/g)].some(([, id]) => {
  const named = w.store.items.get(id)
  return named !== undefined && kindOf(named) === 'ask' && stateOf(named) === 'open' && isOwner(named, w.who, w.prefix)
}))
/** B317: when an ask was filed: its first History line (to the minute), else its Since. */
const askedMs = item => sinceMs((item.sections.get('History') ?? [])[0]?.match(/^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s/)?.[1] ?? valueOf(item, 'Since'))

/**
 * B317: the items of the "For you" block a chat's answer ended with (the Workers mod reads them, hooks/foryou.ts:
 * `{ kind, text, options, advice, pictures, play, ref }`), filed as asks of that chat `Via: chat`, not blocking,
 * under the one step it holds in progress (none, or more than one: the ask stands alone, as the form's do). An item
 * is left out when it names an ask of the store (`ref`, the work tool's "(Q4, ...)"), or asks what an ask of the chat
 * filed since the turn began (`since`), or one still open, asks already. The ids filed, in order.
 */
async function askForYou(value, since, w) {
  const items = (Array.isArray(value) ? value : []).filter(one => one !== null && typeof one === 'object' && !Array.isArray(one)).slice(0, 9)
  const all = [...w.store.items.values()]
  const turn = Math.floor(since / MINUTE) * MINUTE
  const known = all.filter(one => kindOf(one) === 'ask' && isOwner(one, w.who, w.prefix) && (stateOf(one) === 'open' || askedMs(one) >= turn))
    .map(one => askKey((one.sections.get('Text') ?? []).find(words => words.trim() !== '') ?? valueOf(one, 'Title')))
  const held = all.filter(one => kindOf(one) === 'step' && stateOf(one) === 'in progress' && isOwner(one, w.who, w.prefix))
  const of = held.length === 1 ? valueOf(held[0], 'Id') : null
  const asked = []
  for (const one of items) {
    if (typeof one.ref === 'string' && ASK_REF.test(one.ref) && w.store.items.has(one.ref)) continue
    const kind = one.kind ?? 'decide'
    const text = lines(one.text)
    if (!ASK_KINDS.includes(kind) || text.length === 0) continue
    // B362: an item in the chat's own words that names an open ask of its own by its id ("(Q128, under B356)",
    // "Q128: ...") asks that question again: nothing new.
    if (namesOpenAsk(text, w)) continue
    const key = askKey(text[0])
    if (key === '' || known.some(other => sameAsk(other, key))) continue
    const fields = { kind, text, options: one.options, advice: one.advice, pictures: one.pictures, play: one.play, via: 'chat', blocking: false }
    // Under the step when the board takes it there, else on its own.
    let made = of === null ? await ask(fields, w) : await ask({ ...fields, of }, w)
    if (!made.ok && of !== null) made = await ask(fields, w)
    if (!made.ok) continue
    asked.push(made.result.id)
    known.push(key)
  }
  return asked
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

/**
 * Focus 2: the ready refine block of a step made from an agreed how, by its sections; refused when it cannot be one.
 * B354: with its Standard line (`standard`) after the size.
 */
function howBlock(body, goal, w, standard = null) {
  if (w.role !== 'advisor') return refuse(403, 'Only the partner makes a step refined at once, from the how the person agreed.')
  if (goal === '') return refuse(400, 'A step from the agreed how names its goal in "goal" (G17).')
  const summary = line(body.summary, 600)
  if (summary === '') return refuse(400, 'Give the summary in "summary".')
  const what = lines(body.what, 300).map(one => `- ${one.replace(/^[-*]\s+/, '').trim()}`)
  if (what.length === 0) return refuse(400, 'Say what we build in "what", one line per part.')
  const picture = line(body.picture, 200)
  const size = line(body.size, 40).replace(/^about\s+/i, '')
  const block = [
    `Refined (${stamp(w.now)}; ready; ${HOW_MARK} ${goal} by ${w.who}):`,
    `Summary: ${summary}`,
    ...(picture === '' ? [] : [`Picture: ${picture}`]),
    `Part of: ${goal}`,
    ...(size === '' ? [] : [`Size: about ${size}`]),
    ...(standard === null ? [] : [`Standard: ${standard}`]),
    'What we build:',
    ...what,
  ].map(one => `  ${one}`)
  return { ok: true, sections: [['Summary', [summary]], ...(picture === '' ? [] : [['Picture', [picture]]]), ['What we build', what], ['Refined', block]] }
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
  // B354: the standard given, else the one the step had.
  const given = body.standard === undefined ? null : parseStandard(body.standard, w.kinds)
  if (given !== null && !given.ok) return refuse(400, given.why)
  const standard = given?.line ?? standardOf(found.item)
  const round = roundOf(found.item) + 1
  const block = [
    `Refined (round ${round}, by ${w.who}, ${stamp(w.now)}):`,
    `Summary: ${summary}`,
    ...(picture === '' ? [] : [`Picture: ${picture}`]),
    ...(goal === '' ? [] : [`Part of: ${goal}`]),
    ...(size === '' ? [] : [`Size: about ${size}`]),
    ...(standard === null ? [] : [`Standard: ${standard}`]),
    ...(questions.length === 0 ? [] : ['Questions:', ...questions.map(one => `- ${one}`)]),
  ].map(one => `  ${one}`)
  const item = copy(found.item)
  if (standard !== null) item.sections.set('Standard', [standard])
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
    // The review: kept with the answer written behind it, if any; questionIndex reads the question off its start, so a
    // question that holds " Answer: " itself is never cut.
    else if (isIn && /^\s*[-*]\s+/.test(one)) out.push(line(one.trim().replace(/^[-*]\s+/, ''), TEXT_CHARS))
  }
  return out
}

/** The whole words of an ask's question (its Text). */
const askWords = ask => line((ask.sections.get('Text') ?? [])[0] ?? '', TEXT_CHARS)

/**
 * Focus 3: the place of an ask's question among a refine block's questions (blockQuestions), or -1. By its whole words
 * (the ask's Text), with or without an answer behind it, else by its title: a title is cut at 200 characters, and a cut
 * at a space once matched no question. The review: equal questions match by their place: the newest asks of the step's
 * refine with these words (`w`'s store), in id order, are the block's equal questions in order.
 */
function questionIndex(questions, ask, w) {
  const whole = askWords(ask)
  const title = line(valueOf(ask, 'Title') ?? '', 200)
  const isIt = question => whole !== '' && (question === whole || question.startsWith(`${whole} Answer: `))
  let found = questions.flatMap((question, index) => (isIt(question) ? [index] : []))
  if (found.length === 0) found = questions.flatMap((question, index) => (title !== '' && question.slice(0, 200).trim() === title ? [index] : []))
  if (found.length <= 1) return found[0] ?? -1
  const twins = [...w.store.items.values()]
    .filter(one => kindOf(one) === 'ask' && valueOf(one, 'Of') === valueOf(ask, 'Of') && valueOf(one, 'Via') === 'refine' && stateOf(one) !== 'withdrawn' && askWords(one) === whole)
    .map(one => valueOf(one, 'Id')).sort(byId).slice(-found.length)
  const at = twins.indexOf(valueOf(ask, 'Id'))
  return at >= 0 ? found[at] : found[0]
}

/** The Advisor folded every answer in: the block says "ready", What we build is written, and the step is refined. */
async function refined(call, w) {
  const body = withStandard(call)
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const id = valueOf(found.item, 'Id')
  const block = found.item.sections.get('Refined') ?? []
  if (block.length === 0) return refuse(409, `${id} has no refine block yet: refine it first.`)
  // B299: a refine is ready only once the person answered its questions. B309: every ask under the step counts, also
  // one its worker filed.
  const waiting = openAsksUnder(w.store.items, id, found.item)
  if (waiting.length > 0) return refuse(409, `${id}: ${waiting.map(one => `${valueOf(one, 'Id')} ("${valueOf(one, 'Title')}")`).join(', ')} ${waiting.length === 1 ? 'is' : 'are'} still open: the person answers first.`)
  const what = lines(body.what, 300).map(one => `- ${one.replace(/^[-*]\s+/, '').trim()}`)
  if (what.length === 0) return refuse(400, 'Say what we build in "what", one line per part.')
  // B354: a step that names a kind of work of the settings is ready only with its standard (given now, or before).
  const given = body.standard === undefined ? null : parseStandard(body.standard, w.kinds)
  if (given !== null && !given.ok) return refuse(400, given.why)
  const standard = given?.line ?? standardOf(found.item)
  const named = standard === null ? kindsNamed(`${valueOf(found.item, 'Title') ?? ''}\n${(found.item.sections.get('Context') ?? []).join('\n')}`, w.kinds) : []
  if (named.length > 0) return refuse(409, standardWanted(id, named))
  const head = block[0].match(/^(\s*)Refined\s*(?:\(([^)]*)\))?\s*:\s*$/)
  if (head === null) return refuse(409, `${id}: its refine block does not start with "Refined (...):"; fix it by hand first.`)
  const inside = (head[2] ?? '').split(';').map(one => one.trim()).filter(one => one !== '' && !/^ready$/i.test(one))
  const indent = head[1] || '  '
  // The ready form (roles/partner.md): the questions, their answers and the feedback are folded in and go; What we
  // build stands last, once.
  const kept = []
  let isDropped = false
  for (const one of block.slice(1)) {
    const named = one.trim().match(/^([A-Z][A-Za-z /]{1,28}):/)
    // B354: the Standard line is written anew after the rest, before What we build.
    if (named !== null) isDropped = ['Questions', 'Feedback', 'What we build', 'Problem', 'Goal', 'Standard'].includes(named[1])
    if (!isDropped) kept.push(one)
  }
  const item = copy(found.item)
  const standardLine = standard === null ? [] : [`${indent}Standard: ${standard}`]
  if (standard !== null) item.sections.set('Standard', [standard])
  item.sections.set('Refined', [`${indent}Refined (${[...inside, 'ready'].join('; ')}):`, ...kept, ...standardLine, `${indent}What we build:`, ...what.map(one => `${indent}${one}`)])
  item.sections.set('What we build', what)
  item.sections.set('Context', withMark(found.item))
  put(item, 'Refined', 'ready')
  let next = said(ordered(item), w, 'refined is ready')
  if (stateOf(next) === 'new') {
    const moved = move(next, 'refined', w.role, w)
    if (!moved.ok) return moved
    next = moved.item
  }
  next = queueAsked(next, w)
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
  const isRefine = valueOf(found.item, 'Via') === 'refine'
  // Focus 3, the review: the owner of the step this answer frees.
  let freed = null
  const done = await answerStep(w, item, found.text, of, step => {
    let mine = said(underStep(step, [`${id} answered by you on ${at(w.now)}: ${short}`]), w, `${id} answered`)
    // B293: a refine question answered here is answered in the step's refine block too, as in the step's window.
    if (isRefine) mine = withRefineAnswer(mine, found.item, short, w)
    if (stateOf(mine) === 'waiting on you') {
      const goesOn = move(mine, 'in progress', 'server', w, flowCtx(w, [item, mine]), ` (${id} answered)`)
      if (goesOn.ok) {
        mine = goesOn.item
        freed = valueOf(mine, 'Owner')
      }
    }
    return mine
  })
  // B299: the chat that asked is woken with the answer (the server sends it); an ask the person made wakes nobody.
  const owner = valueOf(found.item, 'Owner')
  const told = { id, title: valueOf(found.item, 'Title') ?? '', text: text.join('\n') }
  const wake =owner === null || !/^Q\d+$/.test(id) ? null : { to: owner, ...told }
  // Focus 3, the review: the step goes on, so its owner is woken too (the flow's "wake Owner") when another chat asked.
  const wakeOwner = freed !== null && (owner === null || plain(freed, w.prefix) !== plain(owner, w.prefix)) ? { to: freed, ...told } : null
  return done.ok ? { ok: true, result: { ...done.result, wake, wakeOwner } } : done
}

/**
 * B293: the step with the person's answer to the question of the refine ask `ask` (Focus 3: questionIndex) written into its refine block (" Answer:
 * ..." behind the question, refineText.mjs), read back as refineText does; the step as it was when the question is
 * no longer in the block.
 */
function withRefineAnswer(step, ask, words, w) {
  const index = questionIndex(blockQuestions(step), ask, w)
  if (index < 0) return step
  const id = valueOf(step, 'Id')
  const written = answerRefine(`## -\n${stepLine(step)}\n${stepNotes(step).join('\n')}\n`, id, [{ index, answer: words }], '')
  const back = written.ok ? migrateBacklog(written.text, { now: w.now }).items.get(id) : undefined
  if (back === undefined || !back.sections.has('Refined')) return step
  const next = copy(step)
  next.sections.set('Refined', back.sections.get('Refined'))
  put(next, 'Refined', valueOf(back, 'Refined'))
  return next
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
 * block (refineText.mjs) on the step's lines as the store holds them, then read back into the item.
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
  // B303: a step refined by now whose queue was asked before: the board queues it.
  const next = queueAsked(said(item, w, w.action === 'refine-accept' ? 'accepted the refine' : 'answered the refine questions'), w)
  const done = await save(next, found.text, w)
  if (!done.ok) return done
  // B299: the refine's asks follow: each question answered here is answered; accepting answers the rest.
  const questions = blockQuestions(found.item)
  const answers = Array.isArray(body.answers) ? body.answers : []
  for (const ask of refineAsksOf(w, id)) {
    if (w.action === 'refine-accept') await settleAsk(w, ask, 'answered', 'Accepted as refined.', 'accepted as refined')
    else {
      const index = questionIndex(questions, ask, w)
      const given = answers.find(one => one !== null && typeof one === 'object' && one.index === index)?.answer
      if (index >= 0 && typeof given === 'string' && given.trim() !== '') await settleAsk(w, ask, 'answered', line(given, 1000), `answered in the step's window: ${line(given, 200)}`)
    }
  }
  return changed(next)
}

/**
 * B300: a chat that holds no step asks for its next one at the end of a turn (the Workers mod): the line that wakes it
 * (`work: B286 is yours; run work next`, with `wake`) when a step queued for it may be taken now, else nothing. It
 * changes nothing: the server sends the line once (src/work/deliver.mjs), and the chat's own take moves the step.
 */
function pull(body, w) {
  // The review of Pause 2: while the person pauses (until running) no step is handed out.
  if (isHolding(w.store.pause)) return { ok: true, result: { text: '', id: null, since: null, wake: null, changed: false } }
  const steps = [...w.store.items.values()].filter(item => kindOf(item) === 'step' && isOwner(item, w.who, w.prefix))
  const held = steps.find(item => ['taken', 'in progress', 'waiting on you'].includes(stateOf(item)))
  if (held !== undefined) return { ok: true, result: { text: '', id: valueOf(held, 'Id'), since: null, wake: null, changed: false } }
  for (const item of steps.filter(one => stateOf(one) === 'queued').sort((a, b) => fixFirst(a, b) || byId(valueOf(a, 'Id'), valueOf(b, 'Id')))) {
    if (!mayMove(w.store.flow, item, 'taken', 'server', flowCtx(w, [item], [w.who])).ok) continue
    const id = valueOf(item, 'Id')
    // When it was queued for this chat: a step queued anew is delivered anew (work/deliver.mjs, deliveryKey).
    return { ok: true, result: { text: workWords(w.who, id).text, id, since: valueOf(item, 'Since'), wake: { to: w.who, id }, changed: false } }
  }
  return { ok: true, result: { text: '', id: null, since: null, wake: null, changed: false } }
}

/** B300: the board moves a step as the flow lets the server (the reconciler's moves). */
async function advance(body, w) {
  const found = await load(body.id, w, { kind: ['step'] })
  if (!found.ok) return found
  const to = line(body.to, 40)
  // B303: the queue asked before the refine, with what was asked (the flow's move by the server).
  if (to === 'queued' && stateOf(found.item) === 'refined' && valueOf(found.item, 'Queue when refined') !== null) {
    const next = queueAsked(found.item, w)
    if (stateOf(next) !== 'queued') return refuse(409, mayMove(w.store.flow, found.item, 'queued', 'server', flowCtx(w, [found.item])).why ?? `${valueOf(found.item, 'Id')}: not queued.`)
    const done = await save(next, found.text, w)
    return done.ok ? changed(next) : done
  }
  const moved = move(found.item, to, 'server', w)
  if (!moved.ok) return moved
  const done = await save(ordered(moved.item), found.text, w)
  return done.ok ? changed(ordered(moved.item)) : done
}

/**
 * B313: a chat goes on under a new name: every open item naming `from` (a step not done or dropped, an open ask, an open
 * instruction, an unread note, a queue asked before the refine) names `to`, one History line each. The board does it
 * when it sees a session renamed (`same`: "(same chat)", src/work/rename.mjs); the main chat and the person for a rename
 * the board could not see (a chat replaced by a new one). Theirs also clears the board's held line for `from`.
 */
async function rename(body, w) {
  if (line(body.from, 80) === '' || line(body.to, 80) === '') return refuse(400, 'Name the old name in "from" and the new one in "to".')
  // Focus 4: both without the list's prefix; the new one as the list names it, when it does.
  const from = chatName(line(body.from, 80), w, { mayBeGone: true }).name
  const to = chatName(line(body.to, 80), w, { mayBeGone: true }).name
  if (plain(from, w.prefix) === plain(to, w.prefix)) return refuse(400, `${from} and ${to} are one name.`)
  const same = body.same === true && w.role === 'server' ? ' (same chat)' : ''
  const moved = []
  const failed = []
  for (const id of openNaming(w.store.items, from, w.prefix)) {
    const found = await load(id, w)
    const next = found.ok ? renamedItem(found.item, from, to, w.prefix) : null
    if (!found.ok) failed.push(found.why)
    if (next === null) continue
    const done = await save(said(next, w, `${from} renamed to ${to}${same}`), found.text, w)
    if (done.ok) moved.push(id)
    else failed.push(done.why)
  }
  if (w.role !== 'server') {
    const names = await readNamesFile(w.dir, w.fs)
    const held = names.record.held.filter(one => plain(one.from, w.prefix) !== plain(from, w.prefix))
    if (held.length !== names.record.held.length) await writeNames(w.dir, { ...names.record, held }, w.fs, { expected: names.text })
  }
  const unknown = w.role === 'main' && (w.roleOf?.(to) ?? null) === null ? ` ${to} is no chat of the list yet.` : ''
  const text = moved.length + failed.length === 0 ? `Nothing open names ${from}.`
    : `${from} renamed to ${to}: ${moved.length === 0 ? 'nothing' : moved.join(', ')} moved.${failed.length === 0 ? '' : ` Not moved: ${failed.join(' ')}`}${unknown}`
  return { ok: true, result: { text, moved, failed, changed: moved.length > 0 } }
}

const CHANGE = {
  take, step, ask, withdraw, note, report, check, checked, recheck, new: make, queue, requeue, unqueue, close, drop, refine, refined, answer, tick, instruction, pull, advance,
  'turn-ended': turnEnded,
  'answered-in-chat': answeredInChat,
  read,
  block: (body, w) => blockOn(body, w, true),
  unblock: (body, w) => blockOn(body, w, false),
  delete: remove,
  'refine-answer': refineText,
  'refine-accept': refineText,
  undo,
  rename,
  'pause-all': pauseWrite,
  'resume-all': pauseWrite,
  resumed: pauseWrite,
  'end-resume': pauseWrite,
}
