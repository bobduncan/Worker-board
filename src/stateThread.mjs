// B1535 (X93, chat 1's way A, 2026-11-25): the state build in a thread of its own. A day of the call trace (11-24 18:02 to
// 11-25 21:18) had 121 work calls over 5 s, the board's own CPU as long as each call, and the board at 57% of a core all day;
// a profile on the live data named the cause: `buildState` ran 1.5 to 2.6 s in ONE synchronous block on the event loop, at every
// rebuild (the page's poll, every write's reset, every turn end's hand-over), and a full PC stretched that to the 14 s stalls of
// 19:50. Here the build runs in a worker thread (src/stateWorker.mjs): the loop pays only the copies of what goes in and out,
// and answers every other call meanwhile (from the kept state, folders.mjs `cached`); a read that needs a fresh state awaits the
// build without holding anyone. One build at a time is `cached`'s rule, unchanged; the thread also takes its builds in order.
// The fallback: when the thread throws, ends or gives no build within BUILD_LIMIT_MS, the builds it held are made in the loop as
// before and the next build starts a new thread; after MOST_FAILURES in a row, or at once when no thread can start or a state cannot
// be copied, every build is made in the loop. A spell of failures is said once (`failed`), its end once (`recovered`: a new thread
// built). An error of the build itself (buildState threw) is the read's error, as it was in the loop.

import { Worker } from 'node:worker_threads'

/** How long a build may take in the thread before the board gives the thread up (a build took 14 s on a full PC). */
export const BUILD_LIMIT_MS = 120_000

/**
 * B1535: a test's build that holds its thread (or the loop, after the fallback) this long, as a long build on a full PC does;
 * 0 (none) on a real board.
 */
export const BUILD_BLOCK_MS = Number(process.env.WORKER_BOARD_BUILD_BLOCK_MS) > 0 ? Number(process.env.WORKER_BOARD_BUILD_BLOCK_MS) : 0

/** Holds the thread it runs on for `ms` (the tests' long build). */
export function holdBuild(ms = BUILD_BLOCK_MS) {
  for (const end = Date.now() + ms; Date.now() < end;) { /* held, as a long build holds it */ }
}

/** Chat 1's lens 1: a thread that ended or timed out this many times in a row is given up for good (a new one is tried before). */
export const MOST_FAILURES = 3

/**
 * The builder: `build(raw, options)` answers a promise of the state, built in the thread, or in the loop by `inLoop` (the same
 * build, `buildState` and the tests' hold). A thread that ends, errs or times out is ended and its builds made in the loop; the next
 * build starts a new thread, until MOST_FAILURES in a row, a thread that cannot start, or a state that cannot be copied turn the
 * thread off for good (every build in the loop then). `failed(error)` is said once per spell of failures; `recovered()` once a new
 * thread builds again. `off()` why the thread is off for good (null while threads build), `lastWay()` where the newest build was
 * made ('thread' or 'loop'), `close()` ends the thread. Ports for the tests: `start(file)` makes the thread, the timers, `soon`.
 */
export function stateThread({
  inLoop, file = new URL('./stateWorker.mjs', import.meta.url), failed = () => {}, recovered = () => {}, limitMs = BUILD_LIMIT_MS,
  start = url => new Worker(url), setTimer = setTimeout, clearTimer = clearTimeout, soon = setImmediate,
} = {}) {
  let worker = null
  let off = null
  let seq = 0
  let failures = 0
  let said = false
  let way = null
  /** The builds sent to the thread and not answered: id → { raw, options, resolve, reject, timer }. */
  const pending = new Map()

  const say = (fn, ...args) => {
    try {
      fn(...args)
    } catch {
      // saying it is no reason to fail a build
    }
  }

  const inLoopFor = (one, raw, options) => {
    way = 'loop'
    try {
      one.resolve(inLoop(raw, options))
    } catch (error) {
      one.reject(error)
    }
  }

  /**
   * The thread is given up: ended, and every build it held is built in the loop. `forGood` (a start or a copy that cannot work), or
   * the MOST_FAILURES-th failure in a row, turns the thread off for every build after it. Said once per spell.
   */
  const giveUp = (why, forGood = false) => {
    const error = why instanceof Error ? why : new Error(String(why))
    failures += 1
    if (off === null && (forGood || failures >= MOST_FAILURES)) off = error
    if (!said) {
      said = true
      say(failed, error)
    }
    const was = worker
    worker = null
    if (was !== null) {
      was.removeAllListeners()
      was.on('error', () => {})
      void Promise.resolve().then(() => was.terminate()).catch(() => {})
    }
    for (const [id, one] of [...pending]) {
      pending.delete(id)
      clearTimer(one.timer)
      inLoopFor(one, one.raw, one.options)
    }
  }

  const thread = () => {
    if (worker !== null) return worker
    const made = start(file)
    made.unref?.()
    made.on('message', message => {
      const one = pending.get(message?.id)
      if (one === undefined) return
      if (message.copyFailed === true) return giveUp(new Error(`the state thread could not send its build back: ${message.error?.message ?? 'no reason'}`), true)
      pending.delete(message.id)
      clearTimer(one.timer)
      way = 'thread'
      // The thread answered: a spell of failures is over (said again should a new one come).
      failures = 0
      if (said) {
        said = false
        say(recovered)
      }
      if (message.error !== undefined && message.error !== null) {
        const error = new Error(String(message.error.message ?? 'the build failed'))
        if (typeof message.error.stack === 'string' && message.error.stack !== '') error.stack = message.error.stack
        one.reject(error)
      } else one.resolve(message.state)
    })
    made.on('error', error => giveUp(error))
    made.on('messageerror', error => giveUp(error))
    made.on('exit', code => {
      if (worker === made) giveUp(new Error(`the state thread ended (${code})`))
    })
    worker = made
    return made
  }

  return {
    build(raw, options) {
      return new Promise((resolve, reject) => {
        const one = { raw, options, resolve, reject, timer: null }
        if (off !== null) return inLoopFor(one, raw, options)
        let made
        try {
          made = thread()
        } catch (error) {
          giveUp(error, true)
          return inLoopFor(one, raw, options)
        }
        const id = ++seq
        pending.set(id, one)
        // Lens 1: an answer that waits at the PC's wake is taken first (the timer may fire before the thread's message is read).
        one.timer = setTimer(() => soon(() => {
          if (pending.has(id)) giveUp(new Error(`the state thread gave no build within ${Math.round(limitMs / 1000)} s`))
        }), limitMs)
        one.timer?.unref?.()
        try {
          made.postMessage({ id, raw, options })
        } catch (error) {
          // A value the copy cannot take (DataCloneError): this build and every one after it in the loop.
          giveUp(error, true)
        }
      })
    },
    off: () => off,
    lastWay: () => way,
    close() {
      const was = worker
      worker = null
      if (was !== null) {
        was.removeAllListeners()
        was.on('error', () => {})
        return was.terminate().then(() => undefined, () => undefined)
      }
      return Promise.resolve()
    },
  }
}
