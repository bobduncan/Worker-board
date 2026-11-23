// F42 (2026-11-23, X213 and X214): the PC slept 47 h with the board's process alive, in the middle of a state rebuild. `cached` handed
// that answer, built before the sleep, to the first callers after the wake: the Supervisor's pass read "now" after the wake with the off
// time of before it, and filed two steps as 47 h without a checkpoint. A read whose answer was built before such a jump is read again.

import { GAP_MS, gapsOf } from './history.mjs'

/** The board's off stretches as they stand now, from the history and the last look: never those of a state read before a sleep. */
export const gapsNow = (store, now) => gapsOf(store.lines(), now, store.aliveAt?.() ?? null)

/**
 * The newest answer a `cached` read kept, or null (the caller reads) when it came more than a jump ago. By `lastAt`, not `readAt`: a
 * reset sets `readAt` to none, and every health call after one would wait for a whole read again (B736).
 */
export const keptSinceJump = (read, now, jumpMs = GAP_MS) => (now - read.lastAt() > jumpMs ? null : read.last() ?? null)

/**
 * `read(built)` once, and once more when the clock jumped since its answer was built. `read` calls `built(at)` with the time its answer
 * counts from, and uses what it returns. A jump is what the board counts as being off (`GAP_MS`): a shorter one leaves no gap to miss.
 * Never a third read: the second answer stands, also if the PC slept again.
 */
export async function readAfterSleep(read, { now = Date.now, jumpMs = GAP_MS } = {}) {
  let builtAt = null
  const built = at => {
    builtAt = at
    return at
  }
  const answer = await read(built)
  return Number.isFinite(builtAt) && now() - builtAt > jumpMs ? read(built) : answer
}
