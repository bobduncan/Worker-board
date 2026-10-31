// B296: the work store on disk (spec 2026-10-17, section 3): one folder, the setting `work`, with one `<id>.md` per
// item, `activities.json` (the activities in order, with their steps, notes and loose lines, and the head of the
// backlog file), `last-ids.json` (the highest id given per letter: it only grows) and, when the person wants another
// order, `flow.json`. B301: the store is the one source of the work; nothing falls back to the backlog file.
// Every write is read anew right before, written beside and put in place, as goalsWrite.mjs does: never blind.
// B741: the item files are kept parsed in memory per folder; a read lists the folder with stats and reads anew only the
// files that are new, changed (time, change time, size or file id differs, older too) or gone. The small files
// (activities.json, flow.json, last-ids.json, pause.json, names.json, partner-answers.json, view.json) are read every time.
// B867: one folder read per call: within `oneRead` (a work call) the first read lists the folder with stats; every later
// read of that call (its view, recap, the close of fixes, a new id) takes that listing and reads anew only the item files
// the call itself wrote or removed.

import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { absentAs, again, besideOf, moveInPlace, removeFile, writeNew } from '../write.mjs'
import { storeProblems } from './adapter.mjs'
import { DEFAULT_FLOW, parseFlow } from './flow.mjs'
import { parseItem, serializeItem, validateHead, valueOf } from './item.mjs'
import { isLegacyId } from './line.mjs'
import { heldLine } from './names.mjs'
import { stamp } from './migrate.mjs'
import { PAUSE_FILE, parsePause } from './pause.mjs'
import { PARTNER_FILE, parsePartnerAnswers } from './partnerAnswers.mjs'
import { OBSOLETE_FILE, parseObsolete } from './obsolete.mjs'

const files = { readFile, writeFile, rename, rm, mkdir, readdir, open, stat }
const ITEM_FILE = /^([A-Z]\d+|L-[0-9a-f]{8})\.md$/
const CLAIM_FILE = /^([A-Z]\d+)\.claim$/
const NUMBERED = /^[A-Z]\d+$/
const MIGRATED = /server: migrated from the backlog$/

// B467: `fallback` only for a file that is not there. One Windows holds is tried again; one that stays held, or cannot
// be read, fails the read: a step is never lost from the store, nor delivered.json read as empty (every line again).
const readOr = (fs, file, fallback) => again(() => fs.readFile(file, 'utf8')).catch(absentAs(fallback))

/**
 * Writes `text` to `file` beside and puts it in place, when the file still holds `expected` (a string, or null for
 * "not there"; undefined writes whatever is there). `{ ok, changed }`, or `{ ok: false, why }`.
 */
async function putInPlace(file, text, fs, expected) {
  const before = await readOr(fs, file, null)
  if (expected !== undefined && before !== expected) return { ok: false, why: `${file.split(/[\\/]/).at(-1)} changed in the meantime` }
  if (before === text) return { ok: true, changed: false }
  // B406: flushed beside, and put in place tried again while Windows holds the file.
  const beside = besideOf(file)
  try {
    await writeNew(beside, text, fs)
    if (await readOr(fs, file, null) !== before) {
      await fs.rm(beside, { force: true })
      return { ok: false, why: `${file.split(/[\\/]/).at(-1)} changed in the meantime` }
    }
    await moveInPlace(beside, file, fs)
    forget(fs, file)
    return { ok: true, changed: true }
  } catch (error) {
    await fs.rm(beside, { force: true }).catch(() => {})
    return { ok: false, why: `${file.split(/[\\/]/).at(-1)} could not be written: ${error.code ?? error.message}` }
  }
}

/**
 * B741: per fs and folder, the item files parsed last: `name → { mark, name, item, id, problem }`, where `mark` is the
 * file's stats at the read. A store read by an fs without `stat` (a test's) parses every file, as before.
 */
const kept = new WeakMap()
/** B741: how many item files each folder's reads parsed, for the tests and the timing (`parsedCount(dir)`). */
const parsed = new Map()
export const parsedCount = dir => parsed.get(resolve(dir)) ?? 0

const keptOf = (fs, dir) => {
  if (!kept.has(fs)) kept.set(fs, new Map())
  const byDir = kept.get(fs)
  const key = resolve(dir)
  if (!byDir.has(key)) byDir.set(key, new Map())
  return byDir.get(key)
}

/** B741: the board's own write of an item file: its parsed copy goes, so the next read reads the file anew. */
function forget(fs, file) {
  const name = file.split(/[\\/]/).at(-1)
  if (!ITEM_FILE.test(name)) return
  kept.get(fs)?.get(resolve(file, '..'))?.delete(name)
  // B867: and the call that wrote it reads it anew on its next read.
  callOf(fs, resolve(file, '..'))?.touched.add(name)
}

/**
 * B867: the work call running now: `{ key, fs, names, touched, closed }`, `names` the folder's listing of its first read
 * (null before it), `touched` the item files it wrote or removed since.
 */
const calls = new AsyncLocalStorage()
const callOf = (fs, dir) => {
  const call = calls.getStore()
  return call !== undefined && !call.closed && call.fs === fs && call.key === resolve(dir) ? call : null
}
/** B867: the call's listing with the files it wrote since; null before its first read. */
const namesOf = call => (call === null || call.names === null ? null : [...new Set([...call.names, ...call.touched])])

/**
 * B867: `work()` as one call on the store in `dir`: its first read lists the folder with stats, every later read takes
 * that listing and reads anew only the item files the call wrote or removed. A call within a call is part of it; once
 * `work` settled, a read is a whole read again.
 */
export function oneRead(dir, fs, work) {
  const use = fs ?? files
  if (callOf(use, dir) !== null) return work()
  const call = { key: resolve(dir), fs: use, names: null, touched: new Set(), closed: false }
  return calls.run(call, async () => {
    try {
      return await work()
    } finally {
      call.closed = true
    }
  })
}

// Changed is any difference, an older time too (a file put back by a restore or a copy).
const markOf = stats => `${stats.mtimeMs}|${stats.ctimeMs}|${stats.size}|${stats.ino}`
const copyItem = item => ({ ...item, head: new Map(item.head), sections: new Map([...item.sections].map(([name, lines]) => [name, [...lines]])) })

function parsedFile(name, text) {
  const item = parseItem(text)
  const id = valueOf(item, 'Id') ?? name.match(ITEM_FILE)[1]
  const problem = item.problem ?? validateHead(item.head) ?? (id !== name.match(ITEM_FILE)[1] ? `its Id is ${id}, its file ${name}` : null)
  return { name, item, id, problem }
}

/**
 * B741: the item files of `dir` in id order, each `{ name, item, id, problem }`: a file kept from an earlier read while
 * its stats are the same, else read and parsed anew; a file that is gone leaves the kept ones.
 */
async function itemFiles(dir, names, fs, { fromCall = false } = {}) {
  const listed = names.filter(one => ITEM_FILE.test(one)).sort(byId.compare)
  const key = resolve(dir)
  const readOne = async name => {
    const text = await readOr(fs, join(dir, name), null)
    if (text === null) return null
    parsed.set(key, (parsed.get(key) ?? 0) + 1)
    return parsedFile(name, text)
  }
  if (typeof fs.stat !== 'function') return (await inBatches(listed, readOne)).filter(Boolean)
  const known = keptOf(fs, dir)
  // B867: a later read of one call: the kept copies stand without stats; a file the call wrote or removed was forgotten,
  // so it is read anew (or is gone).
  if (fromCall) return (await inBatches(listed, name => known.get(name) ?? readOne(name))).filter(Boolean)
  const there = new Set(listed)
  for (const name of [...known.keys()]) if (!there.has(name)) known.delete(name)
  const marks = await inBatches(listed, name => fs.stat(join(dir, name)).then(markOf, error => (error?.code === 'ENOENT' ? null : '')))
  const found = await inBatches(listed, async (name, at) => {
    const mark = marks[at]
    if (mark === null) {
      known.delete(name)
      return null
    }
    const was = known.get(name)
    if (mark !== '' && was?.mark === mark) return was
    const read = await readOne(name)
    if (read === null) known.delete(name)
    // A file whose stats could not be read is read every time.
    else if (mark !== '') known.set(name, { ...read, mark })
    return read
  })
  return found.filter(Boolean)
}

// The order readStore always listed them in (localeCompare 'en', numeric), made once.
const byId = new Intl.Collator('en', { numeric: true })

/** `work(value, at)` for each of `values`, 64 at a time; the answers in their order. */
async function inBatches(values, work) {
  const out = []
  for (let at = 0; at < values.length; at += 64) out.push(...await Promise.all(values.slice(at, at + 64).map((value, i) => work(value, at + i))))
  return out
}

/**
 * The store in `dir`: `{ exists, items, activities, preamble, lastIds, flow, problems }`. A file whose head is broken
 * is still listed as it is, and named in `problems` (`{ file, line }`) by file and line; so is a flow.json or
 * activities.json the board cannot read (the default flow stands then). B301: a folder that is not there is `exists:
 * false`; one that cannot be read (not a folder, no access) throws, so the board says so instead of showing nothing.
 */
export async function readStore(dir, fs = files) {
  const problems = []
  const call = callOf(fs, dir)
  let names = namesOf(call)
  const fromCall = names !== null
  if (!fromCall) {
    try {
      names = await fs.readdir(dir)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      return { exists: false, items: new Map(), activities: [], preamble: [], lastIds: {}, flow: DEFAULT_FLOW, problems }
    }
    if (call !== null) call.names = names
  }
  const items = new Map()
  for (const { name, item, id, problem } of await itemFiles(dir, names, fs, { fromCall })) {
    if (problem !== null) problems.push({ file: name, line: `${name}: ${problem}` })
    if (items.has(id)) problems.push({ file: name, line: `${name}: the id ${id} stands twice` })
    else items.set(id, copyItem(item))
  }
  let listed = { preamble: [], activities: [] }
  const activitiesText = await readOr(fs, join(dir, 'activities.json'), null)
  // B301: without activities.json no step stands under an activity, and the board would show none.
  if (activitiesText === null) problems.push({ file: 'activities.json', line: 'activities.json is missing, so no step is listed' })
  else {
    try {
      const raw = JSON.parse(activitiesText)
      listed = { preamble: Array.isArray(raw.preamble) ? raw.preamble : [], activities: Array.isArray(raw.activities) ? raw.activities : [] }
    } catch (error) {
      problems.push({ file: 'activities.json', line: `activities.json is no JSON: ${error.message}` })
    }
  }
  let lastIds = {}
  try {
    lastIds = JSON.parse(await readOr(fs, join(dir, 'last-ids.json'), '{}')) ?? {}
  } catch {
    problems.push({ file: 'last-ids.json', line: 'last-ids.json is no JSON' })
  }
  const flowText = await readOr(fs, join(dir, 'flow.json'), null)
  const read = flowText === null ? { flow: DEFAULT_FLOW, problem: null } : parseFlow(flowText)
  if (read.problem !== null) problems.push({ file: 'flow.json', line: read.problem })
  // B297, review 4: the hand-edited view the board kept last, while it is there.
  let viewKept = null
  try {
    const kept = JSON.parse(await readOr(fs, join(dir, 'view.json'), '{}'))?.kept?.file
    if (typeof kept === 'string' && await readOr(fs, kept, null) !== null) viewKept = kept
  } catch {
    viewKept = null
  }
  // B313: a rename the board saw but did not carry out, while open items still name the old name.
  for (const held of (await readNamesFile(dir, fs)).record.held) {
    const said = heldLine(held, items)
    if (said !== null) problems.push({ file: NAMES, line: said })
  }
  // Pause and resume (spec 2026-10-18): the person's pause.json, null while there is none (or it cannot be read).
  const pause = parsePause(await readOr(fs, join(dir, PAUSE_FILE), null))
  // Partner answers (2026-10-19): whether the partner answers detail questions first; on unless switched off.
  const partnerAnswers = parsePartnerAnswers(await readOr(fs, join(dir, PARTNER_FILE), null))
  return { exists: true, items, ...listed, lastIds, flow: read.flow, problems, viewKept, pause, partnerAnswers }
}

/** Writes one item to `<dir>/<Id>.md`; with `expected` (the file's text the change was made from) only while it holds that. */
export async function writeItem(dir, item, fs = files, { expected } = {}) {
  await fs.mkdir(dir, { recursive: true })
  return putInPlace(join(dir, `${valueOf(item, 'Id')}.md`), serializeItem(item), fs, expected)
}

const highestOf = (ids, letter) => Math.max(0, ...ids.map(id => id.match(new RegExp(`^${letter}(\\d+)$`))?.[1]).filter(Boolean).map(Number))

/**
 * B296 review: the highest id per letter last-ids.json gives, read value by value, so a file that broke halfway still
 * gives what it holds and no id comes back.
 */
export function readLastIds(text) {
  const last = {}
  for (const found of String(text ?? '').matchAll(/"([A-Z])"\s*:\s*(\d+)/g)) last[found[1]] = Math.max(last[found[1]] ?? 0, Number(found[2]))
  return last
}

/** The two lists of ids together, each letter at the higher of the two. */
const higher = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(letter => [letter, Math.max(a[letter] ?? 0, b[letter] ?? 0)]))

/** One turn per folder in this process, so two asks for an id never read last-ids.json at the same moment. */
const turns = new Map()

/**
 * The next id of a letter ("B" → "B296"): above last-ids.json, every item file and every id being given right now,
 * never one that was given. Within this process one at a time per folder; across processes the id is claimed by
 * creating `<id>.claim` (only one can), and last-ids.json is written before the claim goes.
 */
export function nextId(dir, letter, fs = files) {
  const key = resolve(dir)
  const turn = (turns.get(key) ?? Promise.resolve()).then(() => claimId(dir, letter, fs))
  turns.set(key, turn.catch(() => {}))
  return turn
}

async function claimId(dir, letter, fs) {
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, 'last-ids.json')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // B867: within a call its listing first; a claim another process holds (the wx below fails) lists the folder anew.
    const names = (attempt === 0 ? namesOf(callOf(fs, dir)) : null) ?? await fs.readdir(dir)
    const last = readLastIds(await readOr(fs, file, null))
    const onDisk = names.map(name => name.match(ITEM_FILE)?.[1] ?? name.match(CLAIM_FILE)?.[1]).filter(Boolean)
    const next = Math.max(last[letter] ?? 0, highestOf(onDisk, letter)) + 1
    const claim = join(dir, `${letter}${next}.claim`)
    try {
      await fs.writeFile(claim, '', { flag: 'wx' })
    } catch (error) {
      if (error.code === 'EEXIST') continue
      throw error
    }
    try {
      // Another process may have given it since the read above: it writes last-ids.json before its claim goes.
      const before = await readOr(fs, file, null)
      const now = readLastIds(before)
      if ((now[letter] ?? 0) >= next) continue
      const done = await putInPlace(file, `${JSON.stringify(higher(now, { [letter]: next }))}\n`, fs, before)
      if (done.ok) return `${letter}${next}`
    } finally {
      await fs.rm(claim, { force: true }).catch(() => {})
    }
  }
  throw new Error('last-ids.json could not be written')
}

/** The item with one more History line: `- <date time> <who>: <what>`. */
export function appendHistory(item, who, what, now) {
  const sections = new Map(item.sections)
  sections.set('History', [...(sections.get('History') ?? []), `- ${stamp(now)} ${who}: ${what}`])
  return { ...item, head: new Map(item.head), sections }
}

/**
 * A freshly migrated item over the file that is there: while its state stays, the file's Since and History stay
 * (lines the migration adds that the file lacks are added); a state that changed gets Since now and a History line.
 */
function carried(item, before, now) {
  if (before === null) return item
  const old = parseItem(before)
  // Only ever within one step: a file that holds another step (or another line, for a step without an id) is not
  // carried over.
  if (valueOf(old, 'Id') !== valueOf(item, 'Id') || (isLegacyId(valueOf(item, 'Id')) && old.head.get('Title') !== item.head.get('Title'))) return item
  const head = new Map(item.head)
  const oldState = valueOf(old, 'State')
  const state = valueOf(item, 'State')
  const history = [...(old.sections.get('History') ?? [])]
  for (const line of item.sections.get('History') ?? []) if (!MIGRATED.test(line) && !history.includes(line)) history.push(line)
  if (oldState === state && old.head.has('Since')) head.set('Since', old.head.get('Since'))
  else if (oldState !== null) history.push(`- ${valueOf(item, 'Since') ?? stamp(now)} server: ${oldState} → ${state} (the backlog says so)`)
  if (!history.some(line => MIGRATED.test(line))) history.unshift(...(item.sections.get('History') ?? []).filter(line => MIGRATED.test(line)))
  const sections = new Map(item.sections)
  sections.set('History', history)
  return { ...item, head, sections }
}

/**
 * The whole write of a migrated backlog (`{ items, activities, preamble }` of migrateBacklog): only the files
 * whose text changed; an item file whose step left the backlog stays and is named in `problems`, except a step
 * without an id, whose file goes (it only held a copy of its line). Raises last-ids.json, never lowering it,
 * to the highest id per letter. `{ written, problems }`.
 */
export async function writeStore(dir, { items, activities, preamble = [] }, fs = files, { now = Date.now() } = {}) {
  await fs.mkdir(dir, { recursive: true })
  const written = []
  const problems = []
  for (const [id, item] of items) {
    const file = join(dir, `${id}.md`)
    const before = await readOr(fs, file, null)
    const next = carried(item, before, now)
    const done = await putInPlace(file, serializeItem(next), fs, before)
    if (!done.ok) problems.push(`${id}: ${done.why}`)
    else if (done.changed) written.push(id)
  }
  const listed = await putInPlace(join(dir, 'activities.json'), `${JSON.stringify({ preamble, activities }, null, 1)}\n`, fs)
  // B406: a list that could not be written is said, like an item's file.
  if (!listed.ok) problems.push(`activities.json: ${listed.why}`)
  else if (listed.changed) written.push('activities.json')
  // A step without an id whose line left the backlog: its file only ever held a copy of that line, so it goes. A file
  // with an id given by the backlog or the store is never removed.
  for (const name of await fs.readdir(dir)) {
    const id = name.match(ITEM_FILE)?.[1]
    if (id !== undefined && isLegacyId(id) && !items.has(id)) await removeFile(join(dir, name), fs, { force: true })
  }
  const onDisk = (await fs.readdir(dir)).map(name => name.match(ITEM_FILE)?.[1]).filter(Boolean)
  // last-ids.json only grows: the higher of what it holds (value by value) and the files.
  const lastText = await readOr(fs, join(dir, 'last-ids.json'), null)
  const numbered = onDisk.filter(id => NUMBERED.test(id))
  const raised = higher(readLastIds(lastText), Object.fromEntries([...new Set(numbered.map(id => id[0]))].map(letter => [letter, highestOf(numbered, letter)])))
  const lastDone = await putInPlace(join(dir, 'last-ids.json'), `${JSON.stringify(raised)}\n`, fs, lastText)
  if (lastDone.changed) written.push('last-ids.json')
  const held = new Map(onDisk.map(id => [id, items.get(id) ?? { head: new Map([['Kind', 'step']]) }]))
  problems.push(...storeProblems(held, activities).filter(line => /no longer on the backlog$/.test(line)))
  return { written, problems }
}

/**
 * B300: what the board sent the chats (`<dir>/delivered.json`): `keys`, one per line sent ("B286 Units <queued since>"),
 * and per key `sent[key] = { message, wake, again }`: the outbox message, the start it asked of the main chat, and how
 * often it went once more after it expired untaken. Only grows.
 */
const DELIVERED = 'delivered.json'

/** B300: the record of what was sent: `{ keys, sent }` (empty when there is none or it cannot be read). */
export async function readDelivered(dir, fs = files) {
  return parseDelivered(await readOr(fs, join(dir, DELIVERED), null)).record
}

function parseDelivered(text) {
  try {
    const raw = JSON.parse(text ?? '{}') ?? {}
    const keys = Array.isArray(raw.keys) ? raw.keys.filter(key => typeof key === 'string') : []
    const sent = raw.sent !== null && typeof raw.sent === 'object' && !Array.isArray(raw.sent) ? raw.sent : {}
    // Focus 4, the review: when this board first woke the main chat for notes; older notes count as woken.
    const notesFrom = typeof raw.notesFrom === 'string' ? raw.notesFrom : null
    return { record: { keys, sent, notesFrom }, text }
  } catch {
    return { record: { keys: [], sent: {}, notesFrom: null }, text }
  }
}

/** B300: the record as its file holds it now, with the text it was read from (for `writeDelivered`'s `expected`). */
export async function readDeliveredFile(dir, fs = files) {
  return parseDelivered(await readOr(fs, join(dir, DELIVERED), null))
}

/** B300: writes the record, only while the file still holds `expected` (the text it was read from). */
export async function writeDelivered(dir, record, fs = files, { expected } = {}) {
  await fs.mkdir(dir, { recursive: true })
  return putInPlace(join(dir, DELIVERED), `${JSON.stringify(record, null, 1)}\n`, fs, expected)
}

/** B297: an item's file as it is now: `{ text, item }`, or null when there is none. */
export async function readItemFile(dir, id, fs = files) {
  const text = await readOr(fs, join(dir, `${id}.md`), null)
  return text === null ? null : { text, item: parseItem(text) }
}

/** B297: activities.json's text as it is now, or null. */
export const readActivitiesText = (dir, fs = files) => readOr(fs, join(dir, 'activities.json'), null)

/** B297: the activities and the head of the backlog, as writeStore writes them; with `expected` only while the file holds it. */
export async function writeActivities(dir, { preamble = [], activities }, fs = files, { expected } = {}) {
  return putInPlace(join(dir, 'activities.json'), `${JSON.stringify({ preamble, activities }, null, 1)}\n`, fs, expected)
}

/** B297: takes an item's file away, only while it holds `expected`. Its id is never given again (last-ids.json). */
export async function removeItem(dir, id, fs = files, { expected } = {}) {
  const file = join(dir, `${id}.md`)
  if (expected !== undefined && await readOr(fs, file, null) !== expected) return { ok: false, why: `${id}.md changed in the meantime` }
  try {
    await removeFile(file, fs)
    forget(fs, file)
    return { ok: true, changed: true }
  } catch (error) {
    return { ok: false, why: `${id}.md could not be removed: ${error.code ?? error.message}` }
  }
}

/** B297, review 6: puts an item's file back as it was (`text`), only while it holds what was written (`expected`). */
export async function putBack(dir, id, text, fs = files, { expected } = {}) {
  return putInPlace(join(dir, `${id}.md`), text, fs, expected)
}

/**
 * B313: the last name the board saw per chat session (`<dir>/names.json`): `sessions[<session id>] = <name>`, so a rename
 * is seen also across a restart, and `held`: the renames it saw but did not carry out (`{ from, to, why, prefix, at }`),
 * shown on top while open items name the old name.
 */
const NAMES = 'names.json'

function parseNames(text) {
  try {
    const raw = JSON.parse(text ?? '{}') ?? {}
    const sessions = raw.sessions !== null && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions)
      ? Object.fromEntries(Object.entries(raw.sessions).filter(([, name]) => typeof name === 'string')) : {}
    const held = Array.isArray(raw.held) ? raw.held.filter(one => typeof one?.from === 'string' && typeof one?.to === 'string' && typeof one?.why === 'string') : []
    return { record: { sessions, held }, text }
  } catch {
    return { record: { sessions: {}, held: [] }, text }
  }
}

/** B313: names.json as it is now, with the text it was read from (for `writeNames`'s `expected`). */
export async function readNamesFile(dir, fs = files) {
  return parseNames(await readOr(fs, join(dir, NAMES), null))
}

/** B313: writes names.json, only while the file still holds `expected` (the text it was read from). */
export async function writeNames(dir, record, fs = files, { expected } = {}) {
  await fs.mkdir(dir, { recursive: true })
  return putInPlace(join(dir, NAMES), `${JSON.stringify(record, null, 1)}
`, fs, expected)
}

/** Pause and resume (spec 2026-10-18): `<dir>/pause.json` as it is now (`record`, null for none) with its text. */
export async function readPauseFile(dir, fs = files) {
  const text = await readOr(fs, join(dir, PAUSE_FILE), null)
  return { record: parsePause(text), text }
}

/** Writes pause.json (`{ state, since, by }`), only while the file still holds `expected` (the text it was read from). */
export async function writePause(dir, record, fs = files, { expected } = {}) {
  await fs.mkdir(dir, { recursive: true })
  return putInPlace(join(dir, PAUSE_FILE), `${JSON.stringify(record)}
`, fs, expected)
}

/** Partner answers (2026-10-19): `<dir>/partner-answers.json` as it is now (`record`, `{ on }` when there is none) with its text. */
export async function readPartnerAnswersFile(dir, fs = files) {
  const text = await readOr(fs, join(dir, PARTNER_FILE), null)
  return { record: parsePartnerAnswers(text), text }
}

/** Writes partner-answers.json (`{ on, since }`), only while the file still holds `expected` (the text it was read from). */
export async function writePartnerAnswers(dir, record, fs = files, { expected } = {}) {
  await fs.mkdir(dir, { recursive: true })
  return putInPlace(join(dir, PARTNER_FILE), `${JSON.stringify(record)}
`, fs, expected)
}

/** B775: `<dir>/obsolete-check.json` as it is now (`record`, null for none) with its text. */
export async function readObsoleteFile(dir, fs = files) {
  const text = await readOr(fs, join(dir, OBSOLETE_FILE), null)
  return { record: parseObsolete(text), text }
}

/** B775: writes obsolete-check.json, only while the file still holds `expected` (the text it was read from; null: none yet). */
export async function writeObsoleteFile(dir, record, fs = files, { expected } = {}) {
  await fs.mkdir(dir, { recursive: true })
  return putInPlace(join(dir, OBSOLETE_FILE), `${JSON.stringify(record)}
`, fs, expected)
}
