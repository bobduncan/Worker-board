// A provider's usage limit (the asset-limit wait, chat 1's brief of 2026-11-11, the live B1125 case): Worker 1's five Codex requests
// A230-A234 failed at 12:31 with "You've hit your usage limit ... or try again at 1:23 PM." Each failure made the worker re-ask after
// the reset, its lane read Stopped meanwhile, the holder timers would have given the step back, and the next worker hit the same
// limit; the person asked "why did worker 1 stopped?". A failure on the provider's usage limit WITH a known reset time is no failure:
// the board's queue keeps the request waiting (src/assetQueue.mjs, the record's `limit: { until, why, at }`) and runs it by itself
// once the reset has passed, so no chat re-asks; the lane reads "Working · Codex is at its usage limit until 13:23; then it draws 5
// pictures for it" (work/assetWait.mjs). A limit without a reset time stays a failure as before.

/** The words a provider's failure carries when it hit its usage or rate limit. */
const LIMIT_WORDS = /\b(?:usage limit|rate limit|quota|too many requests|credits)\b/i
/** "try again at 1:23 PM", "try again at 13:23" (a clock time: minutes or AM/PM, never a bare number: "retry after 5 seconds" is no clock). */
const AT = /\b(?:try again|retry|resets?|available(?: again)?)\s+at\s+(\d{1,2})(?::(\d{2}))?(?!\d)\s*([ap]\.?m\.?)?(?![\w.]*\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\b)/i
/** "try again in 2 hours 30 minutes", "retry after 5 seconds": a span from now. */
const IN = /\b(?:try again|retry|resets?|available(?: again)?)\s+(?:in|after)\s+((?:\d+\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,]*(?:and\s+)?)+)/i
const UNIT_MS = { h: 3_600_000, hour: 3_600_000, hours: 3_600_000, hr: 3_600_000, hrs: 3_600_000, m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000, s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000 }
/** A reset further off than this is no reset the board waits for (a mistaken date, a next-month quota). */
const FARTHEST_MS = 24 * 3_600_000
/** The least the board waits: a reset named in the past minute (the queue ran again in the reset's own minute, or the provider's clock is a
 * little ahead) means a retry in a moment, never a day's wait; a span of seconds waits this long too. */
export const SOONEST_MS = 2 * 60_000
/** A clock time that passed longer ago than this is tomorrow's; a nearer one is the reset's own minute (`SOONEST_MS`). */
const JUST_PASSED_MS = 60 * 60_000
/** How often the board waits for one request's reset before the failure stands: a provider that says "try again in 10 minutes" at every
 * run (a model's own words, a limit that never lifts) would otherwise run, and pay, for ever. */
export const LIMIT_TRIES = 3

/** Whether a provider's failure is its usage limit (the words), reset time known or not. */
export const isLimitWhy = why => LIMIT_WORDS.test(String(why ?? ''))

/**
 * When the provider's limit resets, from its failure's words, in ms of the local clock: "at 1:23 PM" is today's 13:23, or
 * tomorrow's when that passed over an hour ago, and a retry in two minutes when it passed within the hour (the reset's own
 * minute); "in 2 hours 30 minutes" counts from `now`, never under two minutes. Null when the words name no limit or no time
 * (such a failure stays one), or a span longer than a day.
 */
export function limitResetOf(why, now = Date.now()) {
  const text = String(why ?? '').replace(/\s+/g, ' ')
  if (!isLimitWhy(text)) return null
  const at = AT.exec(text)
  if (at !== null) {
    let hour = Number(at[1])
    const minute = Number(at[2] ?? '0')
    // A bare number ("retry at 3", a cut-off "at 1:2") is no clock time: minutes or AM/PM are needed.
    if (at[2] === undefined && at[3] === undefined) return null
    const half = at[3] === undefined ? null : at[3].toLowerCase().startsWith('p')
    if (hour > 23 || minute > 59 || (half !== null && (hour < 1 || hour > 12))) return null
    if (half === true && hour < 12) hour += 12
    if (half === false && hour === 12) hour = 0
    const day = new Date(now)
    const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime()
    if (when > now) return when
    return now - when <= JUST_PASSED_MS ? now + SOONEST_MS : when + 24 * 3_600_000
  }
  const span = IN.exec(text)
  if (span !== null) {
    let ms = 0
    for (const part of span[1].matchAll(/(\d+)\s*([a-z]+)/gi)) ms += Number(part[1]) * (UNIT_MS[part[2].toLowerCase()] ?? 0)
    return ms > 0 && ms <= FARTHEST_MS ? now + Math.max(ms, SOONEST_MS) : null
  }
  return null
}

/** The record's `limit` for a failure at the provider's limit resetting at `until`: what is kept while the request waits; `tries` how often. */
export const limitOf = (why, until, at, tries = 1) => ({ until, why: String(why ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), at, tries })
/** The failure's words once the board waited `LIMIT_TRIES` times for a reset that lifted nothing. */
export const triedWhy = (why, tries) => `${String(why ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)} (the board waited for its reset ${tries} times)`

/** Whether a request waits for its provider's limit to reset (`limit.until` still ahead at `now`). */
export const waitsForLimit = (record, now = Date.now()) => record?.state === 'waiting' && Number.isFinite(record?.limit?.until) && record.limit.until > now
