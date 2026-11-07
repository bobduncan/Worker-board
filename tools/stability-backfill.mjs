// The stability numbers' backfill (2026-11-05, plan task 5): the closed day lines for the days before the records existed.
//
//   node tools/stability-backfill.mjs <board data folder> <work store folder> [--days 14] [--out <file>]
//
// It reads the records READ ONLY (history.jsonl, wakes.json, reports.json, landings.jsonl, outbox.jsonl, actions.jsonl, stability.jsonl in
// the data folder; the B, Q and X files of the store) and makes one line for each of the `--days` days before today, with
// `closed: true, backfilled: true`. By default it writes them into <data folder>/stability.jsonl: a line already there (a closed
// one above all) is never rewritten, the backfill only fills the days that have none. With `--out <file>` it writes the merged
// result to that file and leaves the data folder untouched. It always prints the lines (after the `#` notes).
//
// What each number is, and from which day it is complete (the notes are printed with the lines):
// - idleWithWorkMinutes is ESTIMATED (`idleEstimated: true`): a minute counts when some worker lane's last history state is `free`
//   and some step was `refined is ready` and not yet queued/taken (the step's History lines in the store; a minute's resolution).
//   No ban filter and no Touches/notBy/kept filter, so it is an over-estimate. A lane is a chat named "Worker <n>". The board off
//   (a history gap) counts nothing. Complete from the later of the first Worker line in history.jsonl and the first "refined is
//   ready" in the store.
// - interventions come from the same function the live loop uses (`interventionsOf`), fed the day's records. Per kind:
//   resume-all: the actions log only exists from the landing; before its first line the day gets an `unsure` resume-all (never
//   guessed). rollback: from the first line of landings.jsonl. woke-outside and app-restart: from the first wake attempt in
//   wakes.json (before it nothing tells a wake from a start by hand, so those days run without wakes/reports/history and get an
//   `unsure`). restart-by-hand: `lastStop` is board state, not a record, so it is not known before the live loop: every day gets an
//   `unsure`. open-its-chat: from the oldest ask in the store.
// - alarms come from the X files (First seen, else Since): complete from the oldest incident in the store.

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseHistory } from '../src/history.mjs'
import { alarmsOf, dayLineOf, dayOf, dayStartOf, interventionsOf, mergedOutbox, nextDayStartOf } from '../src/stability.mjs'
import { parseItem, sinceMs, valueOf } from '../src/work/item.mjs'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** The text of `file`, '' when it is not there. */
const textOf = async file => {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}
const jsonLines = text => {
  const out = []
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    try {
      out.push(JSON.parse(raw))
    } catch {
      // A torn or padded line is skipped.
    }
  }
  return out
}
const jsonOf = (text, fallback) => {
  try {
    return JSON.parse(text) ?? fallback
  } catch {
    return fallback
  }
}

const isWorker = chat => /^Worker \d+$/.test(chat)
const landingMs = landing => (Number.isFinite(landing.at) ? landing.at : Date.parse(landing.at))

/** The spells (ms) in which a step was ready, from its History lines: from "refined is ready" to the first "→ queued/taken/...". */
export function readySpellsOf(item) {
  const spells = []
  let from = null
  for (const line of item.sections?.get('History') ?? []) {
    const stamp = line.match(/^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s(.*)$/)
    if (stamp === null) continue
    const at = sinceMs(stamp[1])
    if (from === null && /refined is ready/.test(stamp[2])) from = at
    else if (from !== null && /(→|->) (queued|taken|in progress|review|done|dropped)\b|\bdropped\b/.test(stamp[2])) {
      spells.push([from, at])
      from = null
    }
  }
  if (from !== null) spells.push([from, Infinity])
  return spells
}

/** The estimate of a day's idle-with-work minutes: the minutes with a free Worker lane and a ready step. PURE. */
export function estimatedIdleOf({ day, history, spells }) {
  const from = dayStartOf(day)
  const to = nextDayStartOf(day)
  const here = spells.filter(([start, end]) => start < to && end > from)
  if (here.length === 0) return 0
  const lines = [...history].filter(line => line.gap === true || isWorker(line.chat)).sort((a, b) => a.at - b.at)
  const state = new Map()
  let next = 0
  let minutes = 0
  for (let minute = from; minute < to; minute += MINUTE) {
    // The lanes as they were at the start of the minute; a gap forgets them all (the board was not looking).
    while (next < lines.length && lines[next].at <= minute) {
      if (lines[next].gap === true) state.clear()
      else state.set(lines[next].chat, lines[next].state)
      next += 1
    }
    if (![...state.values()].includes('free')) continue
    if (here.some(([start, end]) => start <= minute && end > minute)) minutes += 1
  }
  return minutes
}

/** Existing lines win, whatever their kind: a line already there is never rewritten. The result is sorted by day. PURE. */
export function mergeLines(existing, fresh) {
  const have = new Set(existing.map(line => line.day))
  return [...existing, ...fresh.filter(line => !have.has(line.day))].sort((a, b) => (a.day < b.day ? -1 : 1))
}

const firstDay = times => {
  const known = times.filter(Number.isFinite)
  return known.length === 0 ? null : dayOf(Math.min(...known))
}

/** Reads the records and answers the lines and the notes. `today` is a day string (default: today). READ ONLY. */
export async function backfill({ dataDir, storeDir, days = 14, now = Date.now() }) {
  const today = dayOf(now)
  const [historyText, wakesText, reportsText, landingsText, outboxText, actionsText] = await Promise.all(
    ['history.jsonl', 'wakes.json', 'reports.json', 'landings.jsonl', 'outbox.jsonl', 'actions.jsonl'].map(name => textOf(join(dataDir, name))),
  )
  const history = parseHistory(historyText)
  const wakes = jsonOf(wakesText, { wakes: {} })
  const reports = jsonOf(reportsText, { reports: {} })
  const landings = jsonLines(landingsText)
  const outbox = mergedOutbox(jsonLines(outboxText))
  const actions = jsonLines(actionsText)

  const items = []
  for (const name of await readdir(storeDir)) {
    if (!/^[BQX]\d+\.md$/.test(name)) continue
    items.push(parseItem(await textOf(join(storeDir, name))))
  }
  const asks = items.filter(item => valueOf(item, 'Kind') === 'ask')
  const incidents = items.filter(item => valueOf(item, 'Kind') === 'incident')
  const spells = items.filter(item => valueOf(item, 'Kind') === 'step').flatMap(readySpellsOf)

  // From which day each number is known.
  const attempts = Object.values(wakes.wakes ?? wakes).flatMap(list => (Array.isArray(list) ? list : []).flatMap(spell => (spell.attempts ?? []).map(attempt => attempt.at)))
  const first = {
    idle: [firstDay([Math.min(...history.filter(line => isWorker(line.chat)).map(line => line.at))]), firstDay([Math.min(...spells.map(spell => spell[0]))])].filter(Boolean).sort().at(-1) ?? null,
    actions: firstDay([Math.min(...actions.map(action => action.at))]),
    landings: firstDay([Math.min(...landings.map(landingMs))]),
    // The first whole day: the day of the first attempt is only known from that moment.
    wakes: Number.isFinite(Math.min(...attempts)) ? dayOf(nextDayStartOf(dayOf(Math.min(...attempts)))) : null,
    asks: firstDay(asks.map(ask => sinceMs(String(valueOf(ask, 'Since') ?? '')))),
    incidents: firstDay(incidents.map(item => sinceMs(String(valueOf(item, 'First seen') ?? valueOf(item, 'Since') ?? '').slice(0, 16)))),
  }
  const firstActionAt = actions.length > 0 ? Math.min(...actions.map(action => action.at)) : null
  const firstWakeAt = attempts.length > 0 ? Math.min(...attempts) : null
  const stamp = at => new Date(at).toLocaleString('sv-SE').slice(0, 16)

  const lines = []
  const start = new Date(sinceMs(today))
  for (let back = days; back >= 1; back -= 1) {
    const day = dayOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() - back).getTime())
    const from = dayStartOf(day)
    const to = nextDayStartOf(day)
    const known = firstWakeAt !== null && firstWakeAt <= from
    const near = (list, key) => list.filter(one => one[key] >= from - 2 * HOUR && one[key] < to)
    const { interventions, unsure } = interventionsOf({
      actions, landings, asks, day,
      // Before the first wake attempt nothing tells a wake from a start by hand: those findings are left to the `unsure` below.
      lanes: known ? [...new Set(history.map(line => line.chat).filter(Boolean))] : [],
      history: known ? near(history, 'at') : [],
      wakes: known ? wakes : {},
      reports: known ? reports : {},
      outbox: known ? outbox.filter(record => record.at >= from - 20 * MINUTE && record.at < to) : [],
    })
    if (firstActionAt === null || firstActionAt > from) {
      unsure.push({ at: from, kind: 'resume-all', what: 'Resume all by hand is not known for this day', why: firstActionAt === null ? 'the actions log does not exist yet' : `not known before ${stamp(firstActionAt)}, the first line of the actions log` })
    }
    unsure.push({ at: from, kind: 'restart-by-hand', what: 'A board started by hand is not known for this day', why: 'the stop record (lastStop) is state of the running board, not a record: it is not known before the live loop' })
    if (!known) {
      unsure.push({ at: from, kind: 'woke-outside', what: 'Chats woken from outside and app restarts are not known for this day', why: `no wake attempt is recorded before ${firstWakeAt === null ? 'any' : stamp(firstWakeAt)}` })
    }
    const line = dayLineOf({ day, interventions, unsure, alarms: alarmsOf(incidents, day), now, estimated: true, closed: true })
    lines.push({ ...line, idleWithWorkMinutes: estimatedIdleOf({ day, history, spells }), backfilled: true })
  }

  const notes = [
    `idle-with-work (estimated, no ban/Touches filter): complete from ${first.idle ?? 'never (no records)'}`,
    `resume-all: not known before ${firstActionAt === null ? 'the actions log exists (it has no line yet)' : stamp(firstActionAt)}; those days carry an unsure`,
    `rollback: complete from ${first.landings ?? 'never (no landings)'}`,
    `restart-by-hand: not known before the live loop (lastStop is not a record); every day carries an unsure`,
    `app-restart and woke-outside: complete from ${first.wakes ?? 'never (no wake attempts)'}; earlier days carry an unsure`,
    `open-its-chat: complete from ${first.asks ?? 'never (no asks)'}`,
    `alarms: complete from ${first.incidents ?? 'never (no incidents)'}`,
  ]
  return { lines, notes, first }
}

async function main(argv) {
  const args = argv.slice(2)
  const option = name => {
    const at = args.indexOf(name)
    if (at === -1) return null
    const [value] = args.splice(at, 2).slice(1)
    return value ?? null
  }
  const days = Number(option('--days') ?? 14)
  const out = option('--out')
  const [dataDir, storeDir] = args
  if (!dataDir || !storeDir || !Number.isInteger(days) || days < 1) {
    console.error('Usage: node tools/stability-backfill.mjs <board data folder> <work store folder> [--days 14] [--out <file>]')
    return 2
  }
  const { lines, notes } = await backfill({ dataDir, storeDir, days })
  const target = out ?? join(dataDir, 'stability.jsonl')
  // The merge reads the target when it exists (with --out: the data folder's own file stays the base, so --out is "the result").
  const existing = jsonLines(await textOf(out !== null && (await textOf(out)) !== '' ? out : join(dataDir, 'stability.jsonl')))
  const merged = mergeLines(existing.filter(line => typeof line?.day === 'string'), lines)
  await writeFile(target, `${merged.map(line => JSON.stringify(line)).join('\n')}\n`)
  for (const note of notes) console.log(`# ${note}`)
  console.log(`# written to ${target} (${lines.filter(line => !existing.some(one => one.day === line.day)).length} new of ${lines.length} days)`)
  const shown = new Set(lines.map(line => line.day))
  for (const line of merged.filter(one => shown.has(one.day))) console.log(JSON.stringify(line))
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main(process.argv)
