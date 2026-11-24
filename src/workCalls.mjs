// The work calls' day record (board-fast-answer, B1030 way A, 2026-11-11): how long each chat's work call took, by day and by
// action, so the faster board is proved by its own numbers and not by the stall log's guess (data/stalls.json counts a call only
// past 2 s, and keeps 50). The server notes every call once answered (`callStall`'s begin and end exist already) with the number
// of whole state rebuilds that started during it; the record keeps the newest `DAYS_KEPT` days in `data/work-calls.json`, and
// `today()` gives one figure for the Supervisor's health line: "work calls today: 412 (median 0.3 s, slowest 1.8 s, 0 over 5 s)". The
// rebuilds are those that STARTED while a call ran (the page's or a loop's too), not only those the call waited for.
// B1139 (X93, one clock): a call is timed from the chat's send (its request id's time, `callFrom`), as the chat waits from then,
// no longer from its handler's begin, which left the wait before the handler unmeasured; a repeated request id counts once.
// PURE but for the clock and the file, which are handed in.

import { readFile } from 'node:fs/promises'

import { writeUnflushed } from './write.mjs'

/** A work call answered after this long counts as "over" (the person's target: none in a day of normal use). */
export const OVER_MS = 5000
/** How many days the record keeps. */
export const DAYS_KEPT = 7
/** How many single times a day keeps per action (the newest); the counts go on beyond it. */
export const MOST_TIMES = 2000
/** B1139: how many request ids the record keeps to know a repeat (a few minutes of calls). */
export const MOST_NOTED = 500
/** How long after a note the file is written (many calls in a second are one write). */
export const SAVE_MS = 2000

const two = n => String(n).padStart(2, '0')
/** The day of a time, local: "2026-11-11". */
export const dayOf = ms => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}
const finite = value => Number.isFinite(value)
/** The value under which `share` of the sorted `times` lie (0.5 the median, 0.95 the p95); null for none. */
export const percentile = (times, share) => {
  if (!Array.isArray(times) || times.length === 0) return null
  const sorted = [...times].filter(finite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * share) - 1))]
}
const seconds = ms => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`

/** An empty bucket of one action (or of a day as a whole). */
const bucket = () => ({ count: 0, over: 0, rebuilds: 0, max: 0, times: [] })
const noteIn = (one, ms, rebuilds) => {
  one.count += 1
  if (ms >= OVER_MS) one.over += 1
  if (finite(rebuilds) && rebuilds > 0) one.rebuilds += rebuilds
  if (ms > one.max) one.max = ms
  one.times.push(Math.round(ms))
  if (one.times.length > MOST_TIMES) one.times.splice(0, one.times.length - MOST_TIMES)
}
/** B1139: takes back one call noted in `one` (a repeat of its request id is noted in its place). */
const unnoteIn = (one, ms, rebuilds) => {
  const at = one.times.lastIndexOf(Math.round(ms))
  if (at === -1) return
  one.times.splice(at, 1)
  one.count = Math.max(0, one.count - 1)
  if (ms >= OVER_MS) one.over = Math.max(0, one.over - 1)
  if (finite(rebuilds) && rebuilds > 0) one.rebuilds = Math.max(0, one.rebuilds - rebuilds)
  if (ms >= one.max) one.max = one.times.length === 0 ? 0 : Math.max(...one.times)
}

/** B1139: a call whose send lies further back than this spans a sleep of the PC: it is timed from its handler's begin. */
export const SEND_KEEP_MS = 10 * 60_000

/**
 * B1139 (X93, one clock): when a work call's time starts: the chat's send (`sent`, the request id's time, hearing.mjs `sentAtOf`),
 * as the chat waits from then; not before the board began (`startedAt`: the wait for a restart is the landing's, not a slow
 * board); the handler's begin (`begun`) when there is no send time, it lies after the begin (another clock), or the answer
 * came over SEND_KEEP_MS after it (a sleep of the PC). PURE.
 */
export function callFrom({ sent, begun, answered, startedAt = null }) {
  if (!finite(sent) || !finite(begun) || sent > begun) return begun
  if (finite(answered) && answered - sent > SEND_KEEP_MS) return begun
  return finite(startedAt) && sent < startedAt ? Math.min(begun, startedAt) : sent
}

/** The figures of a bucket: `{ count, median, p95, max, over, rebuilds }` (ms; null medians for none). */
export const figuresOf = one => (one === null || one === undefined ? { count: 0, median: null, p95: null, max: null, over: 0, rebuilds: 0 }
  : { count: one.count, median: percentile(one.times, 0.5), p95: percentile(one.times, 0.95), max: one.count === 0 ? null : one.max, over: one.over, rebuilds: one.rebuilds })

/** "work calls today: 412 (median 0.3 s, slowest 1.8 s, 0 over 5 s)", or "work calls today: none yet". */
export function workCallsWords(figures) {
  if (figures === null || figures === undefined || figures.count === 0) return 'work calls today: none yet'
  return `work calls today: ${figures.count} (median ${seconds(figures.median)}, slowest ${seconds(figures.max)}, ${figures.over} over ${OVER_MS / 1000} s${figures.rebuilds > 0 ? `, ${figures.rebuilds} rebuild${figures.rebuilds === 1 ? '' : 's'} started during calls` : ''})`
}

/**
 * The record. `note({ action, chat, ms, rebuilds, at })` counts one answered call; `today(now)` the figures of the day, with
 * `byAction`; `days()` every day kept, newest first, each `{ day, ...figures, byAction }`; `load()` reads the file once at the
 * start; `saved()` the last write's promise (the tests'). `file` null keeps the record in memory only.
 */
export function workCallRecord({ file = null, now = Date.now, fs = { readFile }, saveMs = SAVE_MS, daysKept = DAYS_KEPT } = {}) {
  /** By day: `{ all: bucket, actions: { [action]: bucket } }`. */
  let days = {}
  /** B1139: the calls noted by their request id (the newest MOST_NOTED, in memory): a repeat takes its earlier note's place. */
  const noted = new Map()
  let timer = null
  let saving = Promise.resolve()

  const trim = () => {
    const kept = Object.keys(days).sort().slice(-daysKept)
    days = Object.fromEntries(kept.map(day => [day, days[day]]))
  }
  const save = () => {
    if (file === null) return saving
    saving = writeUnflushed(file, `${JSON.stringify({ days }, null, 1)}\n`).catch(() => {})
    return saving
  }
  const saveSoon = () => {
    if (file === null || timer !== null) return
    timer = setTimeout(() => {
      timer = null
      void save()
    }, saveMs)
    timer.unref?.()
  }
  const dayFigures = (day, kept) => ({ day, ...figuresOf(kept.all), byAction: Object.fromEntries(Object.entries(kept.actions).map(([action, one]) => [action, figuresOf(one)])) })

  return {
    async load() {
      if (file === null) return
      try {
        const kept = JSON.parse(await fs.readFile(file, 'utf8'))
        days = kept !== null && typeof kept === 'object' && kept.days !== null && typeof kept.days === 'object' ? kept.days : {}
        for (const one of Object.values(days)) {
          if (one.all === undefined || one.all === null) one.all = bucket()
          if (one.actions === undefined || one.actions === null) one.actions = {}
        }
        trim()
      } catch {
        days = {}
      }
    },
    note({ action = 'call', chat = null, ms, rebuilds = 0, at = now(), request = null } = {}) {
      if (!finite(ms) || ms < 0) return
      const name = String(action ?? 'call').slice(0, 30)
      // B1139: a repeated request id is one call (the mod asks again when an answer is slow; a read runs again): the earlier note
      // goes, the slower of the two stays, so the call counts once, by the time its chat waited.
      const id = typeof request === 'string' && request !== '' ? request.slice(0, 100) : null
      const earlier = id === null ? undefined : noted.get(id)
      if (earlier !== undefined) {
        noted.delete(id)
        const was = days[earlier.day]
        if (was !== undefined) {
          unnoteIn(was.all, earlier.ms, earlier.rebuilds)
          if (was.actions[earlier.name] !== undefined) unnoteIn(was.actions[earlier.name], earlier.ms, earlier.rebuilds)
        }
        if (earlier.ms > ms) {
          ms = earlier.ms
          at = earlier.at
        }
        rebuilds = Math.max(finite(rebuilds) ? rebuilds : 0, earlier.rebuilds)
      }
      const day = dayOf(finite(at) ? at : now())
      const kept = days[day] ?? (days[day] = { all: bucket(), actions: {} })
      noteIn(kept.all, ms, rebuilds)
      noteIn(kept.actions[name] ?? (kept.actions[name] = bucket()), ms, rebuilds)
      if (id !== null) {
        noted.set(id, { day, name, ms, rebuilds: finite(rebuilds) ? rebuilds : 0, at })
        if (noted.size > MOST_NOTED) noted.delete(noted.keys().next().value)
      }
      void chat
      trim()
      saveSoon()
    },
    today(at = now()) {
      const day = dayOf(at)
      return dayFigures(day, days[day] ?? { all: bucket(), actions: {} })
    },
    days() {
      return Object.keys(days).sort().reverse().map(day => dayFigures(day, days[day]))
    },
    /** Writes now (the board's stop), and answers the write. */
    flush() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      return save()
    },
    saved: () => saving,
  }
}
