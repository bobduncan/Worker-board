// T13 (the person, 2026-10-28: after a restart each chat keeps its status; "the goal is to not have 'Unknown' or
// unintentionally 'Not running'"): the chats' last reports (bridge.mjs `noteReport`) were in memory only, so a restarted
// board had none and read every lane Unknown for minutes, then Not running, although no chat had changed. They are kept in
// `data/reports.json` now: written a moment after a change (at most once a second, src/write.mjs `writeAtomic`), read once at
// the board's start. A file that does not parse is set aside like the other data files; an entry that is no report is left out.

import { REPORT_STATES } from './chatReport.mjs'
import { moveInPlace, readKept, stampOf, writeAtomic } from './write.mjs'

/** How long after a change the file is written: one write for every change within this time (a crash loses at most this much). */
export const REPORTS_SAVE_MS = 1000

const isTime = value => Number.isFinite(value)

/**
 * One saved report as `noteReport` keeps it (`{ state, since, background, run, seq, at, session, mod, busyAt }`), or null
 * when it is none: a state other than the four, a time that is no time or lies after `now` (a report cannot come from
 * the future), a wrong kind of any field. Nothing else the file holds is carried.
 */
export function savedEntry(value, now) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (!REPORT_STATES.includes(value.state) || !isTime(value.since) || !isTime(value.at) || value.at > now) return null
  if (typeof value.background !== 'boolean' || typeof value.session !== 'string') return null
  if (!(value.mod === null || typeof value.mod === 'string') || !(value.busyAt === null || isTime(value.busyAt))) return null
  if (!(value.seq === null || (Number.isSafeInteger(value.seq) && value.seq >= 0))) return null
  if (!(value.run === null || isTime(value.run) || (typeof value.run === 'string' && value.run.length <= 64))) return null
  const { state, since, background, run, seq, at, session, mod, busyAt } = value
  return { state, since, background, run, seq, at, session, mod, busyAt }
}

/** The reports as the file holds them: `{ "reports": { "<chat>": entry } }`. */
export const textOfReports = reports => `${JSON.stringify({ reports: Object.fromEntries(reports) })}\n`

/** The Map of the entries a parsed file holds, left out the ones that are no report; null when the file is not that shape. */
export function reportsOfFile(value, now) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value.reports === null || typeof value.reports !== 'object' || Array.isArray(value.reports)) return null
  const reports = new Map()
  for (const [name, one] of Object.entries(value.reports)) {
    const entry = name === '' ? null : savedEntry(one, now)
    if (entry !== null) reports.set(name, entry)
  }
  return reports
}

/**
 * The saved reports at the board's start: `{ reports, setAside, unread }`. No file is an empty Map. A file that is torn
 * (does not parse) or is no file of reports is moved aside as `<file>.broken-<time>` and the board starts without it
 * (`setAside` names it, as `readKept` does); one that could not be read or moved is `unread` (why): the next write replaces it.
 */
export async function readReports(file, now, fs = undefined) {
  const read = await readKept(file, now, fs)
  if (read.value === null) return { reports: new Map(), setAside: read.setAside, unread: read.unread }
  const reports = reportsOfFile(read.value, now)
  if (reports !== null) return { reports, setAside: null, unread: null }
  const aside = `${file}.broken-${stampOf(now)}`
  try {
    await moveInPlace(file, aside, fs)
    return { reports: new Map(), setAside: aside, unread: null }
  } catch (error) {
    return { reports: new Map(), setAside: null, unread: `not reports, and not kept aside: ${error?.code ?? error?.message}` }
  }
}

/**
 * The file's writer: `changed()` after every change of an entry of `reports` (the server's Map); one write follows within
 * `waitMs`, whatever number of changes came in between, and two writes never run at once. `flush()` writes at once what
 * is waiting (before the board stops itself); both are safe to call without a change. `onError(error)` hears a write
 * that failed (the next change tries again), `onSaved()` one that worked. `write`, `setTimer` and `clearTimer` are for tests.
 */
export function reportsSaver({ file, reports, waitMs = REPORTS_SAVE_MS, write = writeAtomic, onError = () => {}, onSaved = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null
  let isDirty = false
  let writing = Promise.resolve()
  const save = () => {
    timer = null
    isDirty = false
    const text = textOfReports(reports)
    writing = writing.then(() => write(file, text)).then(onSaved, onError).catch(() => {})
  }
  return {
    changed() {
      isDirty = true
      if (timer !== null) return
      timer = setTimer(save, waitMs)
      timer?.unref?.()
    },
    async flush() {
      if (timer !== null) clearTimer(timer)
      if (isDirty) save()
      await writing
    },
  }
}
