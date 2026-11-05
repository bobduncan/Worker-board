// B934 (X93): a stall of the board as its stall log (stalls.mjs) keeps it, and the words the rule board-slow cites it
// with. PURE.
// B1049 part 2 (2026-11-05): a stall that is a sleep of the PC (the live log held 8.5 h "the loop blocked" from the night)
// is `kind: 'sleep'`: kept and shown in plain words, never counted as a slow board.

/** How many requests and jobs one stall names. */
export const MOST_NAMED = 8
/** A stall longer than this is a sleep of the PC, never a slow board (also in an entry written before sleeps had a kind). */
export const SLEEP_MS = 10 * 60_000
/** The wall clock and the monotonic clock disagreeing by more than this over a stall is a clock jump: a sleep. */
export const JUMP_MS = 5000

/** Whether a stall is a sleep of the PC (its kind, or a `sleep: true` mark, or an old stall of the loop over SLEEP_MS: a call that waited long is a call, round 2). */
export const isSleep = stall => stall?.kind === 'sleep' || stall?.sleep === true || (stall?.kind === 'loop' && Number.isFinite(stall?.ms) && stall.ms > SLEEP_MS)

/** A stall as the file and the view keep it, or null for one that is not whole. */
export function stallOf(one) {
  if (one === null || typeof one !== 'object' || !Number.isFinite(one.at) || !Number.isFinite(one.ms) || !['loop', 'call', 'sleep'].includes(one.kind)) return null
  // A sleep names no request or job: none of them was slow.
  if (isSleep(one)) return { at: one.at, ms: one.ms, kind: 'sleep', requests: [], jobs: [] }
  const names = list => (Array.isArray(list) ? list.filter(words => typeof words === 'string' && words !== '').slice(0, MOST_NAMED) : [])
  return { at: one.at, ms: one.ms, kind: one.kind, ...(typeof one.call === 'string' ? { call: one.call } : {}), requests: names(one.requests), jobs: names(one.jobs) }
}

/** A length of time in plain words: `8.5 h`, `11 min`, `12.6 s`. */
const lasting = ms => (ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)} h` : ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 1000).toFixed(1)} s`)

/** The rule board-slow's words for one stall: `16:40 12.6 s the loop blocked (requests: work save-log by Worker 5; jobs: chat log Worker 5)`; a sleep: `08:15 8.5 h the PC slept (not a slow board)`. */
export function stallWords(stall, clockOf) {
  if (stall.kind === 'sleep') return `${clockOf(stall.at)} ${lasting(stall.ms)} the PC slept (not a slow board)`
  const what = [
    stall.kind === 'call' ? `call ${stall.call}` : null,
    stall.requests.length > 0 ? `requests: ${stall.requests.join(', ')}` : null,
    stall.jobs.length > 0 ? `jobs: ${stall.jobs.join(', ')}` : null,
  ].filter(Boolean)
  return `${clockOf(stall.at)} ${(stall.ms / 1000).toFixed(1)} s ${stall.kind === 'loop' ? 'the loop blocked' : 'a call waited'}${what.length === 0 ? ', nothing named' : ` (${what.join('; ')})`}`
}
