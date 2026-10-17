// B296: the backlog into the work store (spec 2026-10-17, section 9).
//
//   node tools/migrate-backlog.mjs --backlog <file> --work <folder> [--dry-run]
//
// Prints the counts (steps before and after, open, done, for the person), the problems, whether the store gives the
// same backlog back (parity), the steps in flight and the goal map's step ids the store lacks. The dry run writes
// nothing; the real run writes the store as a shadow of the backlog and refuses a folder that is not empty.
// `--cutover` (the store becomes the truth) comes with increment 2.

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { parseBacklog } from '../src/backlog.mjs'
import { storeAsBacklog } from '../src/work/adapter.mjs'
import { valueOf } from '../src/work/item.mjs'
import { isLegacyId } from '../src/work/line.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'

const IN_FLIGHT = ['queued', 'taken', 'in progress', 'waiting on you', 'review', 'open']
const argAfter = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

/** The run, with its words to `log`; answers the exit code. */
export async function run(args, log = console.log) {
  if (args.includes('--cutover')) {
    log('--cutover: not in this version (it comes with increment 2, when the store becomes the truth).')
    return 2
  }
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await run(process.argv.slice(2))
}
