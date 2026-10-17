// B296: the work store on disk (spec 2026-10-17, section 3): one folder, the setting `work`, with one `<id>.md` per
// item, `activities.json` (the activities in order, with their steps, notes and loose lines, and the head of the
// backlog file), `last-ids.json` (the highest id given per letter: it only grows), `truth.json` (whether the store is
// a shadow of the backlog or the truth) and, when the person wants another order, `flow.json`.
// Every write is read anew right before, written beside and put in place, as goalsWrite.mjs does: never blind.

import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { storeProblems } from './adapter.mjs'
import { DEFAULT_FLOW, parseFlow } from './flow.mjs'
import { parseItem, serializeItem, validateHead, valueOf } from './item.mjs'
import { stamp } from './migrate.mjs'

const files = { readFile, writeFile, rename, rm, mkdir, readdir }
const ITEM_FILE = /^([A-Z]\d+)\.md$/
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
  return { exists: true, items, ...listed, lastIds, truth: truth.truth, since: truth.since, flow: read.flow, problems }
}

/** Writes one item to `<dir>/<Id>.md`; with `expected` (the file's text the change was made from) only while it holds that. */
export async function writeItem(dir, item, fs = files, { expected } = {}) {
  await fs.mkdir(dir, { recursive: true })
  return putInPlace(join(dir, `${valueOf(item, 'Id')}.md`), serializeItem(item), fs, expected)
}

const highestOf = (ids, letter) => Math.max(0, ...ids.map(id => id.match(new RegExp(`^${letter}(\\d+)$`))?.[1]).filter(Boolean).map(Number))

/** The next id of a letter ("B" → "B296"): above last-ids.json and above every file, never one that was given. */
export async function nextId(dir, letter, fs = files) {
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, 'last-ids.json')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await readOr(fs, file, null)
    let last = {}
    try {
      last = JSON.parse(before ?? '{}') ?? {}
    } catch {
      last = {}
    }
    const onDisk = (await fs.readdir(dir)).map(name => name.match(ITEM_FILE)?.[1]).filter(Boolean)
    const next = Math.max(Number(last[letter]) || 0, highestOf(onDisk, letter)) + 1
    const done = await putInPlace(file, `${JSON.stringify({ ...last, [letter]: next })}\n`, fs, before)
    if (done.ok) return `${letter}${next}`
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
 * whose text changed; an item file whose step left the backlog stays and is named in `problems`. Raises last-ids.json
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
  const onDisk = (await fs.readdir(dir)).map(name => name.match(ITEM_FILE)?.[1]).filter(Boolean)
  const lastText = await readOr(fs, join(dir, 'last-ids.json'), null)
  let last = {}
  try {
    last = JSON.parse(lastText ?? '{}') ?? {}
  } catch {
    last = {}
  }
  const raised = { ...last }
  for (const letter of new Set(onDisk.map(id => id[0]).filter(letter => letter !== 'L'))) raised[letter] = Math.max(Number(last[letter]) || 0, highestOf(onDisk, letter))
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
