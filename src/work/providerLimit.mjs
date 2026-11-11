// A provider's usage limit (the asset-limit wait, chat 1's brief of 2026-11-11, the live B1125 case): Worker 1's five Codex requests
// A230-A234 failed at 12:31 with "You've hit your usage limit ... or try again at 1:23 PM." Each failure made the worker re-ask after
// the reset, its lane read Stopped meanwhile, the holder timers would have given the step back, and the next worker hit the same
// limit; the person asked "why did worker 1 stopped?". A failure on the provider's usage limit WITH a known reset time is no failure:
// the board's queue keeps the request waiting (src/assetQueue.mjs, the record's `limit: { until, why, at }`) and runs it by itself
// once the reset has passed, so no chat re-asks; the lane reads "Working · Codex is at its usage limit until 13:23; then it draws 5
// pictures for it" (work/assetWait.mjs). A limit without a reset time stays a failure as before.

/** The words a provider's failure carries when it hit its usage or rate limit. */
const LIMIT_WORDS = /\b(?:usage limit|rate limit|quota|too many requests|credits)\b/i
/** "try again at 1:23 PM", "try again at 13:23", "try again in 2 hours 30 minutes", "resets at 1:23 PM". */
const AT = /\b(?:try again|retry|resets?|available(?: again)?)\s+(?:at|after)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i
const IN = /\b(?:try again|retry|resets?|available(?: again)?)\s+in\s+((?:\d+\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,]*(?:and\s+)?)+)/i
const UNIT_MS = { h: 3_600_000, hour: 3_600_000, hours: 3_600_000, hr: 3_600_000, hrs: 3_600_000, m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000, s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000 }
/** A reset further off than this is no reset the board waits for (a mistaken date, a next-month quota). */
const FARTHEST_MS = 24 * 3_600_000

/** Whether a provider's failure is its usage limit (the words), reset time known or not. */
export const isLimitWhy = why => LIMIT_WORDS.test(String(why ?? ''))

/**
 * When the provider's limit resets, from its failure's words, in ms of the local clock: "at 1:23 PM" is today's 13:23, or
 * tomorrow's when that has passed already; "in 2 hours 30 minutes" counts from `now`. Null when the words name no limit or
 * no time (such a failure stays one), or a time further off than a day.
 */
export function limitResetOf(why, now = Date.now()) {
  const text = String(why ?? '').replace(/\s+/g, ' ')
  if (!isLimitWhy(text)) return null
  const at = AT.exec(text)
  if (at !== null) {
    let hour = Number(at[1])
    const minute = Number(at[2] ?? '0')
    const half = at[3] === undefined ? null : at[3].toLowerCase().startsWith('p')
    if (hour > 23 || minute > 59 || (half !== null && (hour < 1 || hour > 12))) return null
    if (half === true && hour < 12) hour += 12
    if (half === false && hour === 12) hour = 0
    const day = new Date(now)
    let when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime()
    if (when <= now) when += 24 * 3_600_000
    return when - now > FARTHEST_MS ? null : when
  }
  const span = IN.exec(text)
  if (span !== null) {
    let ms = 0
    for (const part of span[1].matchAll(/(\d+)\s*([a-z]+)/gi)) ms += Number(part[1]) * (UNIT_MS[part[2].toLowerCase()] ?? 0)
    return ms > 0 && ms <= FARTHEST_MS ? now + ms : null
  }
  return null
}

/** The record's `limit` for a failure at the provider's limit resetting at `until`: what is kept while the request waits. */
export const limitOf = (why, until, at) => ({ until, why: String(why ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), at })

/** Whether a request waits for its provider's limit to reset (`limit.until` still ahead at `now`). */
export const waitsForLimit = (record, now = Date.now()) => record?.state === 'waiting' && Number.isFinite(record?.limit?.until) && record.limit.until > now
