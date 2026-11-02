// B934 (X93): a stall of the board as its stall log (stalls.mjs) keeps it, and the words the rule board-slow cites it
// with. PURE.

/** How many requests and jobs one stall names. */
export const MOST_NAMED = 8

/** A stall as the file and the view keep it, or null for one that is not whole. */
export function stallOf(one) {
  if (one === null || typeof one !== 'object' || !Number.isFinite(one.at) || !Number.isFinite(one.ms) || !['loop', 'call'].includes(one.kind)) return null
  const names = list => (Array.isArray(list) ? list.filter(words => typeof words === 'string' && words !== '').slice(0, MOST_NAMED) : [])
  return { at: one.at, ms: one.ms, kind: one.kind, ...(typeof one.call === 'string' ? { call: one.call } : {}), requests: names(one.requests), jobs: names(one.jobs) }
}

/** The rule board-slow's words for one stall: `16:40 12.6 s the loop blocked (requests: work save-log by Worker 5; jobs: chat log Worker 5)`. */
export function stallWords(stall, clockOf) {
  const what = [
    stall.kind === 'call' ? `call ${stall.call}` : null,
    stall.requests.length > 0 ? `requests: ${stall.requests.join(', ')}` : null,
    stall.jobs.length > 0 ? `jobs: ${stall.jobs.join(', ')}` : null,
  ].filter(Boolean)
  return `${clockOf(stall.at)} ${(stall.ms / 1000).toFixed(1)} s ${stall.kind === 'loop' ? 'the loop blocked' : 'a call waited'}${what.length === 0 ? ', nothing named' : ` (${what.join('; ')})`}`
}
