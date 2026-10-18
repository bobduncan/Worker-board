// Source 7: the plan's limits (B113). The board asks no chat and no service for them: it reads what is on this
// machine already. The percentages are in a file the app keeps for its own usage card. The time a limit resets is
// in a transcript: where a chat looked its limits up, and where the app stopped a chat at the limit. Everything
// here is a pure function of those texts.

import { endsTurn, hasToolResult, resultText, textOf } from './transcript.mjs'

const MIN = 60_000

/** One sample of the app's file: `{"t":<ms>,"org":"...","u":{"fh":<5-hour %>,"sd":<week %>}}`. */
const SAMPLE = /\{"t":(\d+),"org":"[^"]*","u":(\{[^{}]*\})\}/g

/**
 * The newest sample of the app's usage file: when it was taken and how full the 5-hour limit and the week were, in
 * percent. The samples are looked for one by one, so the end of a file that grew large is enough. Null when the
 * text holds none.
 */
export function parseUsageHistory(text) {
  if (typeof text !== 'string') return null
  let newest = null
  for (const found of text.matchAll(SAMPLE)) {
    let used
    try {
      used = JSON.parse(found[2])
    } catch {
      continue
    }
    const at = Number(found[1])
    if (!Number.isFinite(used.fh) || !Number.isFinite(used.sd)) continue
    if (newest === null || at > newest.at) newest = { at, fiveHour: used.fh, week: used.sd }
  }
  return newest
}

const windowOf = one => {
  if (one === undefined || !Number.isFinite(one.percentUsed)) return null
  const resetsAt = typeof one.resetsAt === 'string' ? Date.parse(one.resetsAt) : NaN
  // The app names a reset to the millisecond, a little before or after the minute it means.
  return { used: one.percentUsed, resetsAt: Number.isNaN(resetsAt) ? null : Math.round(resetsAt / MIN) * MIN }
}

/**
 * What the chats themselves looked up: every answer of the app's tool for the limits in these entries, in their
 * order, as `{ at, fiveHour, week }` with each window's `{ used, resetsAt }`. Only a tool's answer that is that
 * object counts: the same words in a search result, or typed, or said by a chat, are no reading.
 */
export function usageReadings(entries) {
  const readings = []
  for (const entry of entries) {
    if (entry.type !== 'user' || entry.isSidechain) continue
    for (const block of entry.blocks) {
      if (block.type !== 'tool_result') continue
      const words = resultText(block).trim()
      if (!words.startsWith('{') || !words.includes('"windows"')) continue
      let answer
      try {
        answer = JSON.parse(words)
      } catch {
        continue
      }
      const windows = Array.isArray(answer?.plan?.windows) ? answer.plan.windows.filter(one => one !== null && typeof one === 'object' && typeof one.label === 'string') : []
      const weekly = windows.filter(one => /^weekly/i.test(one.label))
      const fiveHour = windowOf(windows.find(one => /^5-hour/i.test(one.label)))
      // The week of all models is the one the plan stops at; a model's own week is beside it.
      const week = windowOf(weekly.find(one => /all models/i.test(one.label)) ?? weekly[0])
      if (fiveHour !== null || week !== null) readings.push({ at: entry.at, fiveHour, week })
    }
  }
  return readings
}

/** The next time this machine's clock shows `hour:minute` after `at`. */
function nextClock(at, hour, minute) {
  const from = new Date(at)
  const same = new Date(from.getFullYear(), from.getMonth(), from.getDate(), hour, minute).getTime()
  return same > at ? same : new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, hour, minute).getTime()
}

/** A clock time at the start of `words` ("1:40am", "11pm", "23:40") as the next such moment after `at`, or null. */
function clockAfter(at, words) {
  const found = words.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?(?![\w:])/i)
  if (found === null || !Number.isFinite(at)) return null
  const [hour, minute] = [Number(found[1]), Number(found[2] ?? 0)]
  if (minute > 59) return null
  if (found[3] !== undefined) return hour < 1 || hour > 12 ? null : nextClock(at, (hour % 12) + (found[3].toLowerCase() === 'pm' ? 12 : 0), minute)
  // Without am or pm only a full clock time is one: "until 5" could be anything.
  return found[2] === undefined || hour > 23 ? null : nextClock(at, hour, minute)
}

/** An entry that says nothing about whether a chat went on: a helper's, one that arrived mid-turn, a note of the app. */
const isAside = entry => entry.isSidechain || entry.type === 'queued' || entry.isCompactSummary
  || (entry.type === 'user' && entry.isMeta && entry.origin === null && !hasToolResult(entry))

/**
 * The app's stop at a limit, when that is the last thing in a chat: `{ at, limit, resetsAt }`, with `limit`
 * `fiveHour` or `week` and `resetsAt` the clock time the app's line names ("resets 1:40am"), null when it names
 * none the board can read. The app writes that line itself, in place of the chat's answer, and the turn ends
 * there; the chat does nothing until someone starts it again. Null when the chat went on, or was never stopped.
 */
export function limitStop(entries) {
  const last = entries.findLast(entry => !isAside(entry))
  if (last === undefined || last.type !== 'assistant' || last.error !== 'rate_limit') return null
  const words = textOf(last)
  const reset = words.match(/\bresets\s+(.*)$/im)
  return { at: last.at, limit: /\bweek/i.test(words) ? 'week' : 'fiveHour', resetsAt: reset === null ? null : clockAfter(last.at, reset[1]) }
}

export const PAUSED = /\bpaused\s+for\s+the\s+(?:[\w-]+\s+)?limit\b/i

/**
 * A worker's own pause for the limit: `{ at, until }` when its last word to the main chat says in its first line
 * "paused for the limit", with the clock time after "until" when it names one. The note stands until the worker
 * works again after the turn that sent it, or tells the main chat something else. Only that fixed phrase is
 * looked for; the note's words stay in the chat.
 */
export function pauseNote(entries, mainTitle) {
  // B291: the main chat by its title, or by the app's id for it, as a chat may address it.
  const mains = [mainTitle].flat().filter(Boolean)
  let note = null
  let hasEnded = false
  for (const entry of entries) {
    if (entry.type !== 'assistant' || entry.isSidechain) continue
    // An answer after the turn of the note ended: it works again.
    if (hasEnded) {
      note = null
      hasEnded = false
    }
    for (const block of entry.blocks) {
      if (block.type !== 'tool_use' || block.name !== 'SendMessage' || !mains.includes(block.input?.to)) continue
      const first = (typeof block.input.message === 'string' ? block.input.message : '').trim().split('\n')[0]
      const until = first.match(/\buntil\s+(.*)$/i)
      note = PAUSED.test(first) ? { at: entry.at, until: until === null ? null : clockAfter(entry.at, until[1]) } : null
    }
    if (note !== null && endsTurn(entry)) hasEnded = true
  }
  return note
}

/** B291: the first line of a worker's safe-point line to the main chat ("Note from <name>: Safe point: ..."). */
export const SAFE_POINT = /^(?:note\s+from\s+[^:]+:\s*)?safe\s+point:/i

/**
 * B291: what a stopped worker may still do without working again: a word to a chat, and its card on the board.
 * Anything else (a command, a file read or written, a helper) is work.
 */
const isCoordination = name => name === 'SendMessage' || /^mcp__folder-branches__/.test(name)

/**
 * B291: a worker stopped for a restart: `{ at }` when it sent the main chat (`mains`: its title and the app's id for
 * it) a word whose first line is its safe-point line, at or after `since` (when the person's "prepare restart"
 * stands; null: none stands). Whatever its transcript's tail shows (a turn cut off, the stop word answered, a reply
 * to the main chat's thanks), it has stopped, until it works again: a tool of its own work, after the line; or tells
 * the main chat something else.
 */
export function safePointNote(entries, mains, since) {
  if (!Number.isFinite(since)) return null
  const names = [mains].flat().filter(Boolean)
  let note = null
  for (const entry of entries) {
    if (entry.type !== 'assistant' || entry.isSidechain) continue
    for (const block of entry.blocks) {
      if (block.type !== 'tool_use') continue
      if (block.name === 'SendMessage' && names.includes(block.input?.to)) {
        const first = (typeof block.input.message === 'string' ? block.input.message : '').trim().split('\n')[0]
        note = SAFE_POINT.test(first) && entry.at >= since ? { at: entry.at } : null
      } else if (note !== null && !isCoordination(block.name)) note = null
    }
  }
  return note
}

/** One limit as the board shows it, or null when nothing is known of it. */
function limitOf(kind, { sample, readings, stops, now, warnAt }) {
  const mine = stops.filter(stop => stop.limit === kind)
  const figures = [
    ...(sample !== null && Number.isFinite(sample[kind]) ? [{ at: sample.at, used: sample[kind], resetsAt: null }] : []),
    ...readings.filter(reading => reading[kind] != null).map(reading => ({ at: reading.at, used: reading[kind].used, resetsAt: reading[kind].resetsAt ?? null })),
    // A chat the app stopped: the limit was full then.
    ...mine.map(stop => ({ at: stop.at, used: 100, resetsAt: stop.resetsAt ?? null })),
  ].filter(figure => Number.isFinite(figure.at) && Number.isFinite(figure.used))
  if (figures.length === 0) return null
  const newest = figures.reduce((a, b) => (b.at > a.at ? b : a))
  // The time it resets does not move while its window runs: the newest figure that names one knows it.
  const known = figures.filter(figure => Number.isFinite(figure.resetsAt)).reduce((a, b) => (a === null || b.at > a.at ? b : a), null)
  // That time has passed and nothing was read since: the limit is empty again, since then.
  if (known !== null && known.resetsAt <= now && newest.at < known.resetsAt) return { used: 0, at: known.resetsAt, resetsAt: null, resetAt: known.resetsAt, level: 'ok' }
  const isHeld = mine.some(stop => Number.isFinite(stop.resetsAt) && stop.resetsAt > now)
  return {
    used: newest.used,
    at: newest.at,
    resetsAt: known !== null && known.resetsAt > now ? known.resetsAt : null,
    resetAt: null,
    level: newest.used >= 100 || isHeld ? 'full' : newest.used >= warnAt ? 'warn' : 'ok',
  }
}

/**
 * The two limits of the plan as they stand at `now`: `fiveHour` and `week`, each `{ used, at, resetsAt, resetAt,
 * level }` or null. `used` is the newest figure anything gave (the app's file `sample`, the chats' `readings`, a
 * `stop` by the app, which means full) and `at` says when that was; `resetsAt` is when it resets, null when no
 * chat read it in this window; `resetAt` is set when the known reset has passed and nothing was read since.
 * `level` is `ok`, `warn` from `warnAt` percent, and `full` at 100 or while a stop's reset is still ahead.
 */
export function limitsOf({ sample = null, readings = [], stops = [], now, warnAt = 80 }) {
  const all = { sample, readings, stops, now, warnAt }
  return { fiveHour: limitOf('fiveHour', all), week: limitOf('week', all) }
}
