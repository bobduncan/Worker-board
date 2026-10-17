// B296: the backlog into the work store (spec 2026-10-17, section 9).
//
//   node tools/migrate-backlog.mjs --backlog <file> --work <folder> [--dry-run]
//   node tools/migrate-backlog.mjs --backlog <file> --work <folder> --cutover [--dry-run] [--chats <folder>]
//
// Prints the counts (steps before and after, open, done, for the person), the problems, whether the store gives the
// same backlog back (parity), the steps in flight and the goal map's step ids the store lacks. The dry run writes
// nothing; the real run writes the store as a shadow of the backlog and refuses a folder that is not empty.
//
// B297, `--cutover`: the store becomes the truth. The final migration is written into the store (over the shadow
// that is there), the old file is kept beside it as backlog.before-store.md, truth.json says "store", and backlog.md is
// written anew as the store's generated view. First it proves that the store reads back as the backlog and that the
// view reads back as the same items, and refuses when either does not hold. It prints the steps in flight (id, state,
// owner, branch) and every chat card with a task (`<chats>/<session>.json`, the folder beside the backlog unless
// `--chats` names one) beside the store's state of the step it names, "<- check" where they disagree. With
// `--dry-run` it prints the same and writes nothing. It runs once: a store that is the truth already is refused.

import { copyFile, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { parseBacklog } from '../src/backlog.mjs'
import { BOARD_ANSWERS_ASKS } from '../src/work/api.mjs'
import { storeAsBacklog } from '../src/work/adapter.mjs'
import { valueOf } from '../src/work/item.mjs'
import { isLegacyId } from '../src/work/line.mjs'
import { migrateBacklog, stamp } from '../src/work/migrate.mjs'
import { readStore, readTruth, writeStore, writeTruth } from '../src/work/store.mjs'
import { backlogView, writeView } from '../src/work/view.mjs'

const IN_FLIGHT = ['queued', 'taken', 'in progress', 'waiting on you', 'review', 'open']
const argAfter = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

/** The run, with its words to `log`; answers the exit code. */
export async function run(args, log = console.log, checks = {}) {
  if (args.includes('--cutover')) return cutover(args, log, checks)
  const backlog = argAfter(args, '--backlog')
  const work = argAfter(args, '--work')
  if (backlog === undefined || work === undefined) {
    log('Usage: node tools/migrate-backlog.mjs --backlog <file> --work <folder> [--dry-run]')
    return 2
  }
  const text = await readFile(resolve(backlog), 'utf8').catch(() => null)
  if (text === null) {
    log(`No backlog at ${resolve(backlog)}.`)
    return 1
  }
  const isDry = args.includes('--dry-run')
  const folder = resolve(work)
  const there = await readdir(folder).catch(() => [])
  if (!isDry && there.length > 0) {
    log(`The folder ${folder} is not empty: the migration writes only into an empty folder.`)
    return 1
  }

  const migrated = migrateBacklog(text, { now: Date.now() })
  const before = text.split('\n').filter(line => /^- \[( |x|X)\]\s/.test(line)).length
  const { counts, items, problems } = migrated
  log(`Steps: ${before} on the backlog, ${counts.steps} in the store${before === counts.steps ? '' : ' (NOT the same)'}`)
  log(`Open: ${counts.open} · done: ${counts.done} · for you (open): ${counts.you}`)
  const kept = [...items.values()]
  log(`Kept as the backlog wrote them: ${kept.filter(item => item.head.has('Queue note')).length} queue notes, ${kept.filter(item => item.head.has('Line')).length} whole lines; ${kept.filter(item => isLegacyId(valueOf(item, 'Id'))).length} steps without an id (L-<hash>)`)
  log(`Problems: ${problems.length}`)
  for (const line of problems) log(`  ${line}`)
  const same = isDeepStrictEqual(storeAsBacklog(items, migrated.activities), parseBacklog(text))
  log(`Parity with the backlog: ${same ? 'yes, the store reads back as the same backlog' : 'NO, the store reads back differently'}`)

  const flying = kept.filter(item => IN_FLIGHT.includes(valueOf(item, 'State')))
  log(`In flight: ${flying.length}`)
  for (const item of flying) {
    const cells = [valueOf(item, 'Id'), valueOf(item, 'State'), valueOf(item, 'Owner') ?? '-', valueOf(item, 'Branch') ?? '-', valueOf(item, 'Blocked by') ?? valueOf(item, 'Waits for') ?? '-']
    log(`  ${cells.join(' | ')}`)
  }

  // The goal map beside the backlog names steps by id: each must be in the store.
  const goals = await readFile(join(dirname(resolve(backlog)), 'goals.md'), 'utf8').catch(() => null)
  if (goals !== null) {
    const named = [...new Set([...goals.matchAll(/^\s*Steps:\s*(.*)$/gm)].flatMap(found => found[1].match(/\bB\d+\b/g) ?? []))]
    const missing = named.filter(id => !items.has(id))
    log(`Goal map: ${named.length} step ids, ${missing.length === 0 ? 'every one in the store' : `not in the store: ${missing.join(', ')}`}`)
  }

  if (isDry) {
    log(`Dry run: would write ${items.size} item files, activities.json, last-ids.json and truth.json into ${folder}; nothing written.`)
    return same && before === counts.steps ? 0 : 1
  }
  const done = await writeStore(folder, migrated)
  log(`Written into ${folder}: ${done.written.length} files; the store is a shadow of the backlog.`)
  for (const line of done.problems) log(`  ${line}`)
  return same && before === counts.steps ? 0 : 1
}

/** What the view of a store can carry of an item: its head without Since, its sections without History. */
const carried = item => JSON.stringify({
  head: [...item.head].filter(([key]) => key !== 'Since'),
  sections: [...item.sections].filter(([name]) => name !== 'History'),
})
const HELD = ['taken', 'in progress', 'waiting on you', 'review']
const plain = (name, prefix) => {
  let words = String(name ?? '').trim()
  if (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase())) words = words.slice(prefix.length)
  return words.trim().toLowerCase()
}

/**
 * The chats' cards with a task, each beside the store's state of the step it names (an id in its text), or, when it
 * names none, the steps the store has that chat on. `{ lines, count, disagree }`.
 */
async function cards(folder, items) {
  const names = await readdir(folder).catch(() => null)
  if (names === null) return { lines: [`  No chat cards in ${folder}.`], count: 0, disagree: 0 }
  const list = await readFile(join(folder, 'list.json'), 'utf8').then(JSON.parse, () => ({}))
  const prefix = typeof list.prefix === 'string' ? list.prefix : ''
  const lines = []
  let disagree = 0
  let count = 0
  for (const name of names.filter(one => one.endsWith('.json') && one !== 'list.json').sort()) {
    const card = await readFile(join(folder, name), 'utf8').then(JSON.parse, () => null)
    if (card === null || card.left === true || typeof card.name !== 'string' || card.task === null || typeof card.task?.text !== 'string') continue
    count += 1
    const mine = [...items.values()].filter(item => valueOf(item, 'Kind') === 'step' && valueOf(item, 'Owner') !== null && plain(valueOf(item, 'Owner'), prefix) === plain(card.name, prefix))
    const held = mine.filter(item => HELD.includes(valueOf(item, 'State'))).map(item => `${valueOf(item, 'Id')} ${valueOf(item, 'State')}`)
    const queued = mine.filter(item => valueOf(item, 'State') === 'queued').map(item => valueOf(item, 'Id'))
    const named = card.task.text.match(/\bB\d+\b/)?.[0] ?? null
    let said
    let isOff
    if (named !== null) {
      const item = items.get(named)
      const owner = item === undefined ? null : valueOf(item, 'Owner')
      isOff = item === undefined || !HELD.includes(valueOf(item, 'State')) || (owner !== null && plain(owner, prefix) !== plain(card.name, prefix))
      said = item === undefined ? `${named} is not in the store` : `${named} ${valueOf(item, 'State')}${owner !== null && isOff ? ` (${owner}'s)` : ''}`
    } else {
      isOff = held.length === 0
      said = `names no step; ${card.name} holds in the store: ${held.length === 0 ? 'nothing in progress' : held.join(', ')}${queued.length === 0 ? '' : ` (queued: ${queued.join(', ')})`}`
    }
    if (isOff) disagree += 1
    const progress = card.task.steps > 0 ? ` (${card.task.step}/${card.task.steps})` : ''
    lines.push(`  ${card.name} | ${card.task.text}${progress} | ${said}${isOff ? ' <- check' : ''}`)
  }
  return { lines, count, disagree }
}

/**
 * B297, review 7: whether the board that runs (`board.json` in the folder `claude`) has the work route: this version
 * answers a call without a chat with 400 (or 401, 403, 409); an older one has no such route (404, 405).
 */
export async function boardRunsWork(claude) {
  const note = await readFile(join(claude, 'board.json'), 'utf8').then(JSON.parse, () => null)
  if (typeof note?.url !== 'string') return { ok: false, why: 'no board runs (no board.json beside the backlog): start the board with this version first.' }
  try {
    const answer = await fetch(new URL('/api/bridge/work', note.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Board-Key': String(note.key ?? '') },
      body: '{}',
      signal: AbortSignal.timeout(2000),
    })
    await answer.text().catch(() => '')
    if ([400, 401, 403, 409].includes(answer.status)) return { ok: true }
    return { ok: false, why: `the board at ${note.url} answers ${answer.status} to /api/bridge/work: it runs an older version. Start it anew with this version first.` }
  } catch {
    return { ok: false, why: `the board at ${note.url} does not answer: start it with this version first.` }
  }
}

/** B297: the cutover (see the head of this file). `checks` stand in for the running board's, in the tests. */
async function cutover(args, log, { asksOnBoard = BOARD_ANSWERS_ASKS, boardAnswers = boardRunsWork } = {}) {
  const backlog = argAfter(args, '--backlog')
  const work = argAfter(args, '--work')
  if (backlog === undefined || work === undefined) {
    log('Usage: node tools/migrate-backlog.mjs --backlog <file> --work <folder> --cutover [--dry-run] [--chats <folder>]')
    return 2
  }
  const file = resolve(backlog)
  const folder = resolve(work)
  const chats = resolve(argAfter(args, '--chats') ?? join(dirname(file), 'chats'))
  const isDry = args.includes('--dry-run')
  const truth = await readTruth(folder)
  if (truth.truth === 'store') {
    log(`The store in ${folder} is the truth already (since ${truth.since ?? 'an unknown time'}): the cutover ran.`)
    return 1
  }
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null) {
    log(`No backlog at ${file}.`)
    return 1
  }
  const now = Date.now()
  const migrated = migrateBacklog(text, { now })
  const { counts, items, activities, preamble, problems } = migrated
  const before = text.split('\n').filter(line => /^- \[( |x|X)\]\s/.test(line)).length
  log(`Steps: ${before} on the backlog, ${counts.steps} in the store${before === counts.steps ? '' : ' (NOT the same)'}`)
  log(`Open: ${counts.open} · done: ${counts.done} · for you (open): ${counts.you}`)
  log(`Problems: ${problems.length}`)
  for (const line of problems) log(`  ${line}`)
  const same = isDeepStrictEqual(storeAsBacklog(items, activities), parseBacklog(text))
  log(`Parity with the backlog: ${same ? 'yes, the store reads back as the same backlog' : 'NO, the store reads back differently'}`)
  const back = migrateBacklog(backlogView({ dir: folder, items, activities, preamble }), { now })
  const differ = [...items.keys()].filter(id => back.items.get(id) === undefined || carried(back.items.get(id)) !== carried(items.get(id)))
  const viewSame = differ.length === 0 && back.items.size === items.size && isDeepStrictEqual(back.activities, activities)
  log(`The view reads back as the same items: ${viewSame ? 'yes' : `NO (${differ.slice(0, 10).join(', ') || 'the activities'})`}`)

  const flying = [...items.values()].filter(item => IN_FLIGHT.includes(valueOf(item, 'State')))
  log(`In flight: ${flying.length}`)
  for (const item of flying) {
    const cells = [valueOf(item, 'Id'), valueOf(item, 'State'), valueOf(item, 'Owner') ?? '-', valueOf(item, 'Branch') ?? '-']
    // Review 2: the worker on a step that names nobody claims it.
    if (valueOf(item, 'Kind') === 'step' && valueOf(item, 'Owner') === null && valueOf(item, 'State') !== 'queued') cells.push('no owner: the worker on it runs work take')
    log(`  ${cells.join(' | ')}`)
  }
  const shown = await cards(chats, items)
  log(`Cards with a task: ${shown.count}${shown.disagree === 0 ? '' : ` (${shown.disagree} disagree with the store)`}`)
  for (const line of shown.lines) log(line)

  const blockers = []
  if (asksOnBoard !== true) blockers.push("the board cannot answer the store's asks yet (BOARD_ANSWERS_ASKS in src/work/api.mjs is false).")
  const board = await boardAnswers(dirname(file))
  if (!board.ok) blockers.push(board.why)
  const isSafe = same && viewSame && before === counts.steps
  if (isDry) {
    for (const line of blockers) log(`Would refuse: ${line}`)
    log('Dry run: nothing written.')
    return isSafe && blockers.length === 0 ? 0 : 1
  }
  for (const line of blockers) log(`Refused: ${line}`)
  if (!isSafe) log('Nothing written: the store must read back as the backlog, and its view as the same items.')
  if (!isSafe || blockers.length > 0) return 1
  const kept = join(dirname(file), 'backlog.before-store.md')
  const keptText = await readFile(kept, 'utf8').catch(() => null)
  if (keptText !== null && keptText !== text) {
    log(`${kept} is there already and holds another backlog: move it away first. Nothing written.`)
    return 1
  }
  const written = await writeStore(folder, migrated, undefined, { now })
  // Review 3: the store on disk must be the one that passed the checks; any write that failed, any file more or less,
  // and the store stays a shadow.
  const disk = await readStore(folder)
  const off = [
    ...written.problems,
    ...disk.problems.map(one => one.line),
    ...[...new Set([...items.keys(), ...disk.items.keys()])].filter(id => !items.has(id) || !disk.items.has(id) || carried(disk.items.get(id)) !== carried(items.get(id))).map(id => `${id}: on disk it is not what was checked`),
    ...(isDeepStrictEqual(disk.activities, activities) && isDeepStrictEqual(disk.preamble, preamble) ? [] : ['activities.json: on disk it is not what was checked']),
  ]
  if (off.length > 0) {
    for (const line of off.slice(0, 20)) log(`  ${line}`)
    log('The store stays a shadow: nothing else written.')
    return 1
  }
  // A chat that wrote the backlog in the meantime: its words would be lost under the view.
  if (await readFile(file, 'utf8').catch(() => null) !== text) {
    log('backlog.md changed during the cutover: the store stays a shadow; run the cutover again.')
    return 1
  }
  if (keptText === null) await copyFile(file, kept)
  await writeTruth(folder, { truth: 'store', since: stamp(now) })
  // The view of the store that passed the checks.
  const view = await writeView({ dir: folder, items, activities, preamble }, file, undefined, { now })
  if (!view.ok) {
    log(`${view.why} The store is the truth; the board writes the view at the next change.`)
    return 1
  }
  log(`Kept the old backlog as ${kept}.`)
  log('The store is the truth now; backlog.md is its view.')
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await run(process.argv.slice(2))
}
