// B296: the work store on disk (spec 2026-10-17, section 3): one folder, the setting `work`, with one `<id>.md` per
// item, `activities.json` (the activities in order, with their steps, notes and loose lines, and the head of the
// backlog file), `last-ids.json` (the highest id given per letter: it only grows), `truth.json` (whether the store is
// a shadow of the backlog or the truth) and, when the person wants another order, `flow.json`.
// Every write is read anew right before, written beside and put in place, as goalsWrite.mjs does: never blind.

import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { storeProblems } from './adapter.mjs'
import { DEFAULT_FLOW, parseFlow } from './flow.mjs'
import { parseItem, serializeItem, validateHead, valueOf } from './item.mjs'
import { isLegacyId } from './line.mjs'
import { stamp } from './migrate.mjs'

const files = { readFile, writeFile, rename, rm, mkdir, readdir }
const ITEM_FILE = /^([A-Z]\d+|L-[0-9a-f]{8})\.md$/
const CLAIM_FILE = /^([A-Z]\d+)\.claim$/
const NUMBERED = /^[A-Z]\d+$/
const MIGRATED = /server: migrated from the backlog$/

const readOr = (fs, file, fallback) => fs.readFile(file, 'utf8').then(text => text, () => fallback)

/**
 * Writes `text` to `file` beside and puts it in place, when the file still holds `expected` (a string, or null for
 * "not there"; undefined writes whatever is there). `{ ok, changed }`, or `{ ok: false, why }`.
 */
async function putInPlace(file, text, fs, expected) {
  const before = await readOr(fs, file, null)
  if (expected !== undefined && before !== expected) return { ok: false, why: `${file.split(/[\\/]/).at(-1)} changed in the meantime` }
  if (before === text) return { ok: true, changed: false }
  const beside = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await fs.writeFile(beside, text, { flag: 'wx' })
    if (await readOr(fs, file, null) !== before) {
      await fs.rm(beside, { force: true })
      return { ok: false, why: `${file.split(/[\\/]/).at(-1)} changed in the meantime` }
    }
    await fs.rename(beside, file)
    return { ok: true, changed: true }
  } catch (error) {
    await fs.rm(beside, { force: true }).catch(() => {})
    return { ok: false, why: `${file.split(/[\\/]/).at(-1)} could not be written: ${error.code ?? error.message}` }
  }
}

/**
 * The store in `dir`: `{ exists, items, activities, preamble, lastIds, truth, since, flow, problems }`. A file whose
 * head is broken is still listed as it is, and named in `problems` (`{ file, line }`) by file and line; so is a
 * flow.json or activities.json the board cannot read (the default flow stands then).
 */
export async function readStore(dir, fs = files) {
  const problems = []
  let names
  try {
    names = await fs.readdir(dir)
  } catch {
    return { exists: false, items: new Map(), activities: [], preamble: [], lastIds: {}, truth: 'shadow', since: null, flow: DEFAULT_FLOW, problems }
  }
  const items = new Map()
  for (const name of names.filter(one => ITEM_FILE.test(one)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const text = await readOr(fs, join(dir, name), null)
    if (text === null) continue
    const item = parseItem(text)
    const id = valueOf(item, 'Id') ?? name.match(ITEM_FILE)[1]
    const problem = item.problem ?? validateHead(item.head) ?? (id !== name.match(ITEM_FILE)[1] ? `its Id is ${id}, its file ${name}` : null)
    if (problem !== null) problems.push({ file: name, line: `${name}: ${problem}` })
    if (items.has(id)) problems.push({ file: name, line: `${name}: the id ${id} stands twice` })
    else items.set(id, item)
  }
  let listed = { preamble: [], activities: [] }
  const activitiesText = await readOr(fs, join(dir, 'activities.json'), null)
  if (activitiesText !== null) {
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
  const truth = await readTruth(dir, fs)
  // B297, review 4: the hand-edited view the board kept last, while it is there.
  let viewKept = null
  try {
    const kept = JSON.parse(await readOr(fs, join(dir, 'view.json'), '{}'))?.kept?.file
    if (typeof kept === 'string' && await readOr(fs, kept, null) !== null) viewKept = kept
  } catch {
    viewKept = null
  }
  return { exists: true, items, ...listed, lastIds, truth: truth.truth, since: truth.since, flow: read.flow, problems, viewKept }
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
    const names = await fs.readdir(dir)
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

/** Which is the truth: `{ truth: 'shadow' | 'store', since }`; a shadow when nothing says otherwise. */
export async function readTruth(dir, fs = files) {
  try {
    const raw = JSON.parse(await fs.readFile(join(dir, 'truth.json'), 'utf8'))
    return { truth: raw.truth === 'store' ? 'store' : 'shadow', since: typeof raw.since === 'string' ? raw.since : null }
  } catch {
    return { truth: 'shadow', since: null }
  }
}

export async function writeTruth(dir, { truth, since }, fs = files) {
  await fs.mkdir(dir, { recursive: true })
  return putInPlace(join(dir, 'truth.json'), `${JSON.stringify({ truth, since })}\n`, fs)
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
 * The shadow's whole write of a migrated backlog (`{ items, activities, preamble }` of migrateBacklog): only the files
 * whose text changed; an item file whose step left the backlog stays and is named in `problems`, except a step
 * without an id, whose file goes (it only held a copy of its line). Raises last-ids.json, never lowering it,
 * to the highest id per letter and writes truth.json as a shadow when it is not there. `{ written, problems }`.
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
  if (listed.changed) written.push('activities.json')
  // A step without an id whose line left the backlog: its file only ever held a copy of that line, so it goes. A file
  // with an id given by the backlog or the store is never removed.
  for (const name of await fs.readdir(dir)) {
    const id = name.match(ITEM_FILE)?.[1]
    if (id !== undefined && isLegacyId(id) && !items.has(id)) await fs.rm(join(dir, name), { force: true })
  }
  const onDisk = (await fs.readdir(dir)).map(name => name.match(ITEM_FILE)?.[1]).filter(Boolean)
  // last-ids.json only grows: the higher of what it holds (value by value) and the files.
  const lastText = await readOr(fs, join(dir, 'last-ids.json'), null)
  const numbered = onDisk.filter(id => NUMBERED.test(id))
  const raised = higher(readLastIds(lastText), Object.fromEntries([...new Set(numbered.map(id => id[0]))].map(letter => [letter, highestOf(numbered, letter)])))
  const lastDone = await putInPlace(join(dir, 'last-ids.json'), `${JSON.stringify(raised)}\n`, fs, lastText)
  if (lastDone.changed) written.push('last-ids.json')
  if (await readOr(fs, join(dir, 'truth.json'), null) === null) {
    await writeTruth(dir, { truth: 'shadow', since: stamp(now) }, fs)
    written.push('truth.json')
  }
  const held = new Map(onDisk.map(id => [id, items.get(id) ?? { head: new Map([['Kind', 'step']]) }]))
  problems.push(...storeProblems(held, activities).filter(line => /no longer on the backlog$/.test(line)))
  return { written, problems }
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
    await fs.rm(file)
    return { ok: true, changed: true }
  } catch (error) {
    return { ok: false, why: `${id}.md could not be removed: ${error.code ?? error.message}` }
  }
}

/** B297, review 6: puts an item's file back as it was (`text`), only while it holds what was written (`expected`). */
export async function putBack(dir, id, text, fs = files, { expected } = {}) {
  return putInPlace(join(dir, `${id}.md`), text, fs, expected)
}
