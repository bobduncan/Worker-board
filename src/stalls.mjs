// B934 (X93 on 2026-11-02: after B917 the board answered fast, but stalled 6 to 13 s around the workers' hand-overs, and
// nothing named what it was doing then): the board's own stall log. A timer measures how late the event loop runs it; a
// delay over 2 s is a stall, and a work call answered after 2 s is one too (it waited on something while the loop ran).
// Each is written with the requests and the board's own jobs that ran during it (a chat log being written, a state rebuild,
// the supervisor's sweep, a hand-over, ...), to a small data file (`data/stalls.json`, the newest 50); the rule board-slow
// cites the newest. What runs is told with `track(kind, words, fn)` (or `begin` and its `end`). PURE but for the timer and
// the file, which are handed in.

import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { JUMP_MS, MOST_NAMED, SLEEP_MS, stallOf } from './stallWords.mjs'
import { writeUnflushed } from './write.mjs'

/** A delay of the event loop, or a work call's wait, longer than this is a stall. */
export const STALL_MS = 2000
/** How often the timer looks at the loop. */
export const TICK_MS = 500
/** How many stalls the file keeps (the newest). */
export const MOST_STALLS = 50
/** How long the words of one request or job may be. */
const MOST_WORDS = 100
/** How long a request or job that ended is kept, so a stall noticed after it ended still names it. */
const ENDED_KEEP_MS = 60_000

const wordsOf = words => String(words ?? '').replace(/\s+/g, ' ').trim().slice(0, MOST_WORDS) || 'unnamed'

/**
 * The log: `track(kind, words, fn)` runs `fn` as a request (`kind` 'request') or a job of the board ('job') and answers
 * its value; `begin(kind, words)` answers its `end()`. `tick(from, to, every)`: the timer ran at `from` and next at `to`,
 * `every` ms apart when the loop is free; a delay over `overMs` is a loop stall. `slowCall(words, from, to)`: a work call that took over `overMs` is a call stall.
 * Each stall names what ran between its `from` and `to`. `recent()` the stalls, oldest first; `saved()` the last write.
 * `file` null keeps them in memory only.
 * B1049: a stall is written as a sleep of the PC (`kind: 'sleep'`, naming no request or job) when it lasts over SLEEP_MS (10 min),
 * spans a clock jump (`tick`'s monotonic time and the wall time disagree by over JUMP_MS) or began before the board did
 * (`startedAt`): a sleep is kept and shown, never counted as a slow board.
 */
export function stallLog({ now = Date.now, overMs = STALL_MS, most = MOST_STALLS, file = null, fs = { readFile, mkdir }, startedAt = now() } = {}) {
  const open = new Map()
  const ended = []
  let stalls = []
  let seq = 0
  let saving = Promise.resolve()
  let loaded = null

  const load = () => {
    loaded ??= (async () => {
      if (file === null) return
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'))
        const read = (Array.isArray(raw?.stalls) ? raw.stalls : []).map(stallOf).filter(one => one !== null)
        stalls = [...read, ...stalls].slice(-most)
      } catch {
        // no file yet, or a torn one: the log starts empty
      }
    })()
    return loaded
  }

  const save = () => {
    if (file === null) return saving
    saving = saving.then(async () => {
      await load()
      try {
        await fs.mkdir(dirname(file), { recursive: true })
        await writeUnflushed(file, `${JSON.stringify({ stalls }, null, 1)}\n`)
      } catch {
        // kept in memory all the same
      }
    })
    return saving
  }

  /** One request or job begins: answers its `end()`; `end.as(words)` names it anew (a call's chat, once it is known). */
  function begin(kind, words) {
    const id = ++seq
    open.set(id, { kind, words: wordsOf(words), since: now() })
    const end = () => {
      const one = open.get(id)
      if (one === undefined) return
      open.delete(id)
      const at = now()
      ended.push({ ...one, end: at })
      while (ended.length > 0 && at - ended[0].end > ENDED_KEEP_MS) ended.shift()
      if (ended.length > 500) ended.shift()
    }
    end.as = later => {
      if (open.has(id)) open.get(id).words = wordsOf(later)
    }
    return end
  }

  async function track(kind, words, fn) {
    const end = begin(kind, words)
    try {
      return await fn()
    } finally {
      end()
    }
  }

  /** What ran between `from` and `to`: the open ones begun before `to`, and the ended ones that ended at `from` or later. */
  const during = (from, to, kind, but = null) => [...[...open.values()].filter(one => one.since <= to), ...ended.filter(one => one.end >= from && one.since <= to)]
    .filter(one => one.kind === kind && one !== but)
    .map(one => one.words)
    .filter((words, index, all) => all.indexOf(words) === index)
    .slice(0, MOST_NAMED)

  const keep = stall => {
    stalls.push(stall)
    if (stalls.length > most) stalls = stalls.slice(-most)
    void save()
    return stall
  }

  /**
   * The timer ran last at `from`, was due `every` ms later and ran at `to`: a delay over `overMs` is a stall of the loop,
   * with what ran from `from` to `to` (the block began after `from`).
   */
  function tick(from, to, every = 0, monoMs = null) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to - from - every <= overMs) return null
    const ms = to - from - every
    if (ms > SLEEP_MS || from < startedAt || (Number.isFinite(monoMs) && Math.abs(to - from - monoMs) > JUMP_MS)) return keep({ at: to, ms, kind: 'sleep', requests: [], jobs: [] })
    return keep({ at: to, ms: to - from - every, kind: 'loop', requests: during(from, to, 'request'), jobs: during(from, to, 'job') })
  }

  /** A work call (`words`) begun at `from` and answered at `to`: one over `overMs` is a stall, with what ran beside it. */
  function slowCall(words, from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to - from <= overMs) return null
    if (to - from > SLEEP_MS || from < startedAt) return keep({ at: to, ms: to - from, kind: 'sleep', requests: [], jobs: [] })
    const call = wordsOf(words)
    return keep({ at: to, ms: to - from, kind: 'call', call, requests: during(from, to, 'request').filter(one => one !== call), jobs: during(from, to, 'job') })
  }

  return {
    begin,
    track,
    tick,
    slowCall,
    load,
    recent: () => stalls.map(one => ({ ...one, requests: [...one.requests], jobs: [...one.jobs] })),
    saved: () => saving,
  }
}

/**
 * Starts the timer that measures the loop's delay: every `every` ms it notes when it ran; a run later than its due time
 * by over the log's limit is a stall (`log.tick`). Answers the stop. `setTimer`/`clearTimer` are the clock's (the tests').
 */
export function watchLoop(log, { every = TICK_MS, now = Date.now, mono = () => performance.now(), setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let last = now()
  let lastMono = mono()
  const timer = setTimer(() => {
    const at = now()
    const atMono = mono()
    log.tick(last, at, every, atMono - lastMono)
    last = at
    lastMono = atMono
  }, every)
  timer?.unref?.()
  return () => clearTimer(timer)
}
