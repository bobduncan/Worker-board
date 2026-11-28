// The lag recorder's numbers for the weekly retrospective (chat 1's brief, 2026-11-27): the row "lag spikes per hour while work ran",
// this week beside last week, and the spikes' culprits. Reads data/perf/lag.jsonl.
//
//   node tools/lag-summary.mjs [--to YYYY-MM-DD] [--file <lag.jsonl>] [--json]
// A week is the seven days before --to (default: now).

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { culpritsOf, linesOf, spikesPerHour } from '../src/lag.mjs'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** The summary of two weeks ending at `to` (ms): `{ thisWeek, lastWeek, culprits, row }`; `row` is the retrospective's table row. */
export function summaryOf(text, to) {
  const thisLines = linesOf(text, { from: to - WEEK_MS, to })
  const lastLines = linesOf(text, { from: to - 2 * WEEK_MS, to: to - WEEK_MS })
  const thisWeek = spikesPerHour(thisLines)
  const lastWeek = spikesPerHour(lastLines)
  const cell = week => (week.perHour === null ? 'not measured' : `${week.perHour} (${week.spikes} in ${Math.round(week.workMinutes / 6) / 10} h)`)
  const mark = thisWeek.perHour === null || lastWeek.perHour === null || thisWeek.perHour === lastWeek.perHour ? '' : thisWeek.perHour < lastWeek.perHour ? ' [+]' : ' [-]'
  return {
    thisWeek,
    lastWeek,
    culprits: culpritsOf(thisLines).slice(0, 5),
    row: `| lag spikes per hour while work ran | ${cell(thisWeek)}${mark} | ${cell(lastWeek)} |`,
  }
}

function argOf(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const file = argOf(argv, '--file') ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'perf', 'lag.jsonl')
  const toWord = argOf(argv, '--to')
  const to = toWord ? Date.parse(`${toWord}T23:59:59.999`) + 1 : Date.now()
  let text = ''
  try { text = await readFile(file, 'utf8') } catch (error) { if (error?.code !== 'ENOENT') throw error }
  const summary = summaryOf(text, to)
  if (argv.includes('--json')) console.log(JSON.stringify(summary))
  else {
    console.log(summary.row)
    for (const one of summary.culprits) console.log(`- ${one.spikes} spike${one.spikes === 1 ? '' : 's'}: ${one.name} (${one.kind})`)
  }
}
