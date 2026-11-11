// The work calls' day record (board-fast-answer, B1030 way A, 2026-11-11): how long each chat's work call took, by day and by
// action, so the faster board is proved by its own numbers and not by the stall log's guess (data/stalls.json counts a call only
// past 2 s, and keeps 50). The server notes every call once answered (`callStall`'s begin and end exist already) with the number
// of whole state rebuilds that started during it; the record keeps the newest `DAYS_KEPT` days in `data/work-calls.json`, and
// `today()` gives one figure for the Supervisor's health line: "work calls today: 412 (median 0.3 s, slowest 1.8 s, 0 over 5 s)".
// PURE but for the clock and the file, which are handed in.

import { readFile } from 'node:fs/promises'

import { writeUnflushed } from './write.mjs'

/** A work call answered after this long counts as "over" (the person's target: none in a day of normal use). */
export const OVER_MS = 5000
/** How many days the record keeps. */
export const DAYS_KEPT = 7
/** How many single times a day keeps per action (the newest); the counts go on beyond it. */
export const MOST_TIMES = 2000
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

/** The figures of a bucket: `{ count, median, p95, max, over, rebuilds }` (ms; null medians for none). */
export const figuresOf = one => (one === null || one === undefined ? { count: 0, median: null, p95: null, max: null, over: 0, rebuilds: 0 }
  : { count: one.count, median: percentile(one.times, 0.5), p95: percentile(one.times, 0.95), max: one.count === 0 ? null : one.max, over: one.over, rebuilds: one.rebuilds })

/** "work calls today: 412 (median 0.3 s, slowest 1.8 s, 0 over 5 s)", or "work calls today: none yet". */
export function workCallsWords(figures) {
  if (figures === null || figures === undefined || figures.count === 0) return 'work calls today: none yet'
  return `work calls today: ${figures.count} (median ${seconds(figures.median)}, slowest ${seconds(figures.max)}, ${figures.over} over ${OVER_MS / 1000} s${figures.rebuilds > 0 ? `, ${figures.rebuilds} rebuild${figures.rebuilds === 1 ? '' : 's'} inside calls` : ''})`
}

/**
 * The record. `note({ action, chat, ms, rebuilds, at })` counts one answered call; `today(now)` the figures of the day, with
 * `byAction`; `days()` every day kept, newest first, each `{ day, ...figures, byAction }`; `load()` reads the file once at the
 * start; `saved()` the last write's promise (the tests'). `file` null keeps the record in memory only.
 */
export function workCallRecord({ file = null, now = Date.now, fs = { readFile }, saveMs = SAVE_MS, daysKept = DAYS_KEPT } = {}) {
  /** By day: `{ all: bucket, actions: { [action]: bucket } }`. */
  let days = {}
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
    note({ action = 'call', chat = null, ms, rebuilds = 0, at = now() } = {}) {
      if (!finite(ms) || ms < 0) return
      const day = dayOf(finite(at) ? at : now())
      const kept = days[day] ?? (days[day] = { all: bucket(), actions: {} })
      const name = String(action ?? 'call').slice(0, 30)
      noteIn(kept.all, ms, rebuilds)
      noteIn(kept.actions[name] ?? (kept.actions[name] = bucket()), ms, rebuilds)
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
