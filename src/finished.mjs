// B155: when a step of the backlog was finished, and by whom. The backlog file holds no time for a tick, so the
// board finds one where it can, in this order: a line under the step that says it was approved, done or closed with
// a time (`line`); a worker's report to the main chat that names the step in its first line (`report`); the moment
// the board itself first saw the step ticked, kept in its data folder (`seen`); a line under the step with only the
// day (`day`). The person, 2026-10-14: "i want a chronological list of backlog items that were recently finish desc,
// so latest items first. this will allow to to verify what the last 20 items were that were picked up and are done."

import { peerMessage } from './transcript.mjs'

/** A line that says a step was finished, with the date, and the time when it gives one. */
const FINISHED = /\b(?:approved|done|closed|ticked)\b[^\n]{0,80}?\bon (\d{4})-(\d{2})-(\d{2})(?: at (\d{1,2}):(\d{2}))?/i

/**
 * The moments the lines under a step say it was finished: `{ at, isDay, by }`, with `isDay` when only the day is
 * given (then `at` is that day's start) and `by` "you", a chat's name without the prefix, or null. Dates are this
 * machine's clock, as the person and the chats write them.
 */
export function finishedMarks(lines, prefix = '') {
  const marks = []
  for (const line of lines) {
    const found = line.match(FINISHED)
    if (found === null) continue
    const [, year, month, day, hour, minute] = found
    const isDay = hour === undefined
    const at = new Date(Number(year), Number(month) - 1, Number(day), isDay ? 0 : Number(hour), isDay ? 0 : Number(minute)).getTime()
    const after = line.slice(found.index + found[0].length)
    const named = /\bby you\b/i.test(line) ? 'you' : after.match(/\bby ([^:,.;()"]+)/)?.[1]?.trim() ?? null
    const by = named === null ? null : named.startsWith(prefix) ? named.slice(prefix.length).trim() : named
    marks.push({ at, isDay, by })
  }
  return marks
}

/**
 * The steps the workers' reports to the main chat are about: the first step their first line names ("Report from
 * Game - Board: B142 is merged ..."), from the main chat's transcript: each step id with the last report about it,
 * `{ at, by }`.
 * A note or a question names no finished step.
 */
export function reportsOf(entries, prefix = '') {
  const reports = new Map()
  for (const entry of entries) {
    const message = peerMessage(entry)
    if (message === null || !Number.isFinite(entry.at)) continue
    const first = message.body.trim().split('\n')[0]
    const sender = first.match(/^Report from ([^:]+):/)?.[1]?.trim()
    if (sender === undefined) continue
    const by = sender.startsWith(prefix) ? sender.slice(prefix.length).trim() : sender
    // The step a report is about is the first it names; a later one in that line is named in passing ("as the yellow
    // note (B142)"). Of several reports on one step, the last counts: the last of its parts.
    const id = first.match(/\bB\d+\b/)?.[0]
    if (id === undefined) continue
    const before = reports.get(id)
    if (before === undefined || entry.at >= before.at) reports.set(id, { at: entry.at, by })
  }
  return reports
}

/** The ids of the ticked steps of a parsed backlog. */
export const doneIdsOf = backlog => backlog.activities.flatMap(activity => activity.steps).filter(step => step.isDone && step.id !== null).map(step => step.id)

/**
 * When the board first saw each step ticked, by id: `{ at, isFirstLook }`. `done` are the ids ticked now. What was
 * ticked at the board's very first look (`before` is null) was ticked before it: that time says nothing. The same
 * object comes back when nothing is new, so nothing has to be written.
 */
export function seenTicks(before, done, now) {
  if (before === null) return Object.fromEntries(done.map(id => [id, { at: now, isFirstLook: true }]))
  const added = done.filter(id => before[id] === undefined)
  if (added.length === 0) return before
  return { ...before, ...Object.fromEntries(added.map(id => [id, { at: now, isFirstLook: false }])) }
}

/**
 * The finished steps, newest first, at most `limit`: `{ key, id, title, at, how, by }`. `key` is the one the
 * Backlog tab knows the step by; `how` says where the time comes from (`line`, `report`, `seen`, `day`); `by` is who
 * finished it, as far as anything says, else the worker the step names. A step nothing gives a time for is left out.
 */
export function finishedList(backlog, { reports = new Map(), seen = {}, prefix = '', limit = 20 } = {}) {
  const found = []
  backlog.activities.forEach((activity, place) => activity.steps.forEach((step, index) => {
    if (!step.isDone) return
    const marks = finishedMarks(step.notes, prefix)
    const latest = kind => marks.filter(mark => mark.isDay === kind).reduce((a, b) => (a === null || b.at > a.at ? b : a), null)
    const line = latest(false)
    const day = latest(true)
    const report = step.id === null ? undefined : reports.get(step.id)
    const look = step.id === null ? undefined : seen?.[step.id]
    const when = line !== null ? { at: line.at, how: 'line', by: line.by }
      : report !== undefined ? { at: report.at, how: 'report', by: report.by }
        : look !== undefined && !look.isFirstLook ? { at: look.at, how: 'seen', by: null }
          : day !== null ? { at: day.at, how: 'day', by: day.by }
            : null
    if (when === null) return
    found.push({ key: step.id ?? `${place}:${index}`, id: step.id, title: step.title, at: when.at, how: when.how, by: when.by ?? report?.by ?? step.worker ?? null })
  }))
  return found.sort((a, b) => b.at - a.at).slice(0, limit)
}
