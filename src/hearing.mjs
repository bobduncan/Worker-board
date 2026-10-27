// B736 (X73, X87, X89 on 2026-10-27: from 21:12 to 21:21 the board heard no chat while every chat worked, so every lane
// read unknown, then off, and working-not-running opened for chats that were fine; work calls were answered minutes
// late): when the board itself heard no chat at all, and which work calls it answered after the Workers mod had given up.
// A stretch in which no chat was heard is the board's, never a chat's: the lanes keep what they were (state.mjs) and the
// age rules do not count it (rules/watch.mjs `deafMs`). PURE.

const DAY = 24 * 60 * 60_000

/** How long the lanes keep their last report while the board hears no chat: past it they are read as before, and the rule board-deaf says so. */
export const DEAF_KEEP_MS = 10 * 60_000

/** The Workers mod's own time limit for a work call (its WORK_CALL_MS): an answer later than this came after the chat gave up. */
export const LATE_CALL_MS = 10_000

/** The time a Workers mod sent a work call, from its request id (`<session>-<ms>-<count>`), or null. */
export function sentAtOf(request) {
  const found = /-(\d{12,14})-\d+$/.exec(typeof request === 'string' ? request : '')
  return found === null ? null : Number(found[1])
}

/**
 * The board's log of hearing: `heard(at)` at every report a chat's mod brings (a take, a report), `answered(request, at)`
 * after every work call, and `view(now)`: `{ deaf: [{ from, to }], open: { from } | null, lateCalls: [{ at, ms }] }`.
 * A stretch is deaf when no chat was heard for longer than `quietMs` (the chats report every 5 seconds): from the board's
 * start to the first report, or between two reports; `open` while it lasts. Kept for a day, in memory only.
 */
export function hearingLog({ startedAt, quietMs, keepMs = DAY, lateMs = LATE_CALL_MS }) {
  let last = null
  const deaf = []
  const late = []
  const forget = now => {
    while (deaf.length > 0 && now - deaf[0].to > keepMs) deaf.shift()
    while (late.length > 0 && now - late[0].at > keepMs) late.shift()
  }
  return {
    heard(at) {
      if (!Number.isFinite(at)) return
      const from = last ?? startedAt
      if (Number.isFinite(from) && at - from > quietMs) deaf.push({ from, to: at })
      last = Math.max(last ?? -Infinity, at)
      forget(at)
    },
    answered(request, at) {
      const sent = sentAtOf(request)
      if (sent === null || !Number.isFinite(at) || at - sent <= lateMs) return
      late.push({ at, ms: at - sent })
      if (late.length > 200) late.shift()
    },
    view(now) {
      forget(now)
      const from = last ?? startedAt
      const open = Number.isFinite(from) && now - from > quietMs ? { from } : null
      return { deaf: deaf.map(one => ({ ...one })), open, lateCalls: late.map(one => ({ ...one })) }
    },
  }
}

/**
 * The stretches the board heard no chat although chats ran (`view` of `hearingLog`, `ranSince(at)`: whether a chat's
 * conversation was written after `at`), as `[{ from, to }]` with the open one up to `now`. A stretch the Claude app
 * started in (`appStartedAt`) was the chats' own stop, not the board's; an open one in which no conversation was
 * written is every chat closed, which is no fault of the board either.
 */
export function deafSpans(hearing, { now, appStartedAt = null, ranSince = () => true }) {
  if (hearing === null || typeof hearing !== 'object') return []
  const isAppStart = span => Number.isFinite(appStartedAt) && appStartedAt > span.from && appStartedAt <= span.to
  const spans = (Array.isArray(hearing.deaf) ? hearing.deaf : []).filter(one => Number.isFinite(one?.from) && Number.isFinite(one?.to) && !isAppStart(one))
  const open = Number.isFinite(hearing.open?.from) ? { from: hearing.open.from, to: now } : null
  return open !== null && !isAppStart(open) && ranSince(open.from) ? [...spans, open] : spans
}
