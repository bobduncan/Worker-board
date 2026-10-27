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

/**
 * B640 (the fix of B632's check): the newest reading of each window among `readings`, as at most two readings, one
 * per window, in the form `usageReadings` gives. The supervisor chat looks the limits up and is then cleared, and the board
 * reads only the chat's new transcript: what it looked up is kept by the board, and these are the readings it keeps.
 */
export function newestPerWindow(readings) {
  const newest = key => (readings ?? []).filter(one => one?.[key] != null && Number.isFinite(one.at)).reduce((a, b) => (a === null || b.at >= a.at ? b : a), null)
  return ['fiveHour', 'week'].flatMap(key => {
    const found = newest(key)
    return found === null ? [] : [{ at: found.at, fiveHour: key === 'fiveHour' ? found.fiveHour : null, week: key === 'week' ? found.week : null }]
  })
}

/** B640: kept readings as their file holds them (`newestPerWindow`'s form), the figures that are none dropped; [] for anything else. */
export function keptReadingsOf(value) {
  const window = one => (one !== null && typeof one === 'object' && Number.isFinite(one.used) ? { used: one.used, resetsAt: Number.isFinite(one.resetsAt) ? one.resetsAt : null } : null)
  return newestPerWindow((Array.isArray(value) ? value : []).map(one => (one !== null && typeof one === 'object' && Number.isFinite(one.at) ? { at: one.at, fiveHour: window(one.fiveHour), week: window(one.week) } : null)))
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
 * B312: what a pause line says of its limit: which window (`week` when its first line pauses for the week's limit,
 * else `fiveHour`) and how full it was, in percent: the figure after that window's name in the note's words, else the
 * only figure the words hold; null when they name none the board can tie to it.
 */
function pauseLimit(words) {
  const first = words.trim().split('\n')[0]
  const limit = /\bpaused\s+for\s+the\s+week/i.test(first) ? 'week' : 'fiveHour'
  const name = limit === 'week' ? /\bweek\w*\b[^%\n;]*?(\d{1,3})\s*%/i : /\b(?:5|five)[\s-]*hours?\b[^%\n;]*?(\d{1,3})\s*%/i
  const named = words.match(name)
  const all = [...words.matchAll(/(\d{1,3})\s*%/g)]
  const percent = named !== null ? Number(named[1]) : all.length === 1 ? Number(all[0][1]) : null
  return { limit, percent: percent !== null && percent <= 100 ? percent : null }
}

const FIVE_HOURS = 5 * 60 * MIN
const WEEK = 7 * 24 * 60 * MIN
/** Below this percent a limit counts as back, when the pause named none. */
export const PAUSE_BACK_PERCENT = 50

/**
 * B312: whether a worker's own pause for the limit (`{ limit, since, percent }`, from its note) is over before the time
 * it named, by the limits as the board read them (`limitsOf`): a reading of that window taken after the pause began
 * shows the window reset since (the window it reads began after the pause's start) or its use below the percent the
 * note named (below PAUSE_BACK_PERCENT when it named none). Without a reading taken after the pause it stands; so it
 * does when the board only works out that a known reset has passed (`resetAt`): nothing was read since.
 */
export function pauseLifted(pause, limits) {
  const limit = limits?.[pause?.limit] ?? null
  if (limit === null || limit.resetAt != null || !Number.isFinite(limit.at) || !(limit.at > pause.since)) return false
  const span = pause.limit === 'week' ? WEEK : FIVE_HOURS
  if (Number.isFinite(limit.resetsAt) && limit.resetsAt - span > pause.since) return true
  return Number.isFinite(limit.used) && limit.used < (Number.isFinite(pause.percent) ? pause.percent : PAUSE_BACK_PERCENT)
}

/**
 * A worker's own pause for the limit: `{ at, until, limit, percent }` (B312: its window and how full, `pauseLimit`)
 * when its last word to the main chat says in its first line
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
      const words = typeof block.input.message === 'string' ? block.input.message : ''
      const first = words.trim().split('\n')[0]
      const until = first.match(/\buntil\s+(.*)$/i)
      note = PAUSED.test(first) ? { at: entry.at, until: until === null ? null : clockAfter(entry.at, until[1]), ...pauseLimit(words) } : null
    }
    if (note !== null && endsTurn(entry)) hasEnded = true
  }
  return note
}

/**
 * B310: what a paused worker may still do without working again: a word to a chat, and its card on the board.
 * Anything else (a command, a file read or written, a helper) is work.
 */
const isCoordination = name => name === 'SendMessage' || /^mcp__folder-branches__/.test(name)
  // B310: also the app's end of a turn (its recap and plan) and a look at the limits.
  || /^mcp__ccd_turn__/.test(name) || name === 'mcp__ccd_session_mgmt__get_usage'

/**
 * B310: a worker's pause for the limit filed as a work note to the main chat (`work note --to main`), as `pauseNote`
 * reads the message form. `notes` are the chat's notes to the main chat in the store, `{ at, text }` (`at` its Since,
 * to the minute). The newest decides: `{ at, isPaused: true, until, limit, percent }` when its first line is the pause
 * line, with the clock time after "until" (the next such time after the note) and (B312) the window and how full it
 * was (`pauseLimit`), else `{ at, isPaused: false }`: it told the main chat
 * something else. Null without notes, or when the pause no longer stands: after the note's minute the chat did work
 * of its own (`entries`: a tool that does not only coordinate) or sent the main chat
 * (`mains`: its title and the app's id for it) a message. Whether its turn has ended is the caller's.
 */
export function storePause(notes, entries, mains) {
  const newest = (notes ?? []).filter(one => Number.isFinite(one?.at)).reduce((a, b) => (a === null || b.at >= a.at ? b : a), null)
  if (newest === null) return null
  const first = String(newest.text ?? '').trim().split('\n')[0]
  if (!PAUSED.test(first)) return { at: newest.at, isPaused: false }
  const names = [mains].flat().filter(Boolean)
  // The note's time is written to the minute: what the chat did within that minute belongs to the turn that paused.
  const after = newest.at + MIN
  for (const entry of entries ?? []) {
    if (entry.type !== 'assistant' || entry.isSidechain || !(entry.at >= after)) continue
    for (const block of entry.blocks) {
      if (block.type !== 'tool_use') continue
      if (!isCoordination(block.name) || (block.name === 'SendMessage' && names.includes(block.input?.to))) return null
    }
  }
  const until = first.match(/\buntil\s+(.*)$/i)
  return { at: newest.at, isPaused: true, until: until === null ? null : clockAfter(newest.at, until[1]), ...pauseLimit(String(newest.text ?? '')) }
}

/** B742 (X96): the person's stop line for all work (2026-10-19: 98% of the week); the config's `weekStopAt` sets it. */
export const WEEK_STOP_AT = 98
/** The percent from which a limit counts as full: the 5-hour limit at 100, the week at the person's stop line (B742). */
const stopLevel = (kind, weekStopAt) => (kind === 'week' && Number.isFinite(weekStopAt) ? Math.min(100, weekStopAt) : 100)

/** One limit as the board shows it, or null when nothing is known of it. */
function limitOf(kind, { sample, readings, stops, now, warnAt, weekStopAt }) {
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
  if (known !== null && known.resetsAt <= now && newest.at < known.resetsAt) return { used: 0, at: known.resetsAt, resetsAt: null, resetAt: known.resetsAt, level: 'ok', stopAt: stopLevel(kind, weekStopAt) }
  const isHeld = mine.some(stop => Number.isFinite(stop.resetsAt) && stop.resetsAt > now)
  return {
    used: newest.used,
    at: newest.at,
    resetsAt: known !== null && known.resetsAt > now ? known.resetsAt : null,
    resetAt: null,
    level: newest.used >= stopLevel(kind, weekStopAt) || isHeld ? 'full' : newest.used >= warnAt ? 'warn' : 'ok',
    stopAt: stopLevel(kind, weekStopAt),
  }
}

/**
 * B601 (the fix of X47: both limits "read at 14:35" at 15:32): how old a limit's newest figure is, in whole minutes, or
 * null for a limit nothing is known of. The app writes its sample only while it is in use, so a quiet hour leaves the
 * newest figure an hour old; a limit that was read as reset counts from its reset (nothing was read since).
 */
export function readingAgeMinutes(limit, now) {
  return Number.isFinite(limit?.at) && Number.isFinite(now) ? Math.max(0, Math.floor((now - limit.at) / MIN)) : null
}

/**
 * The two limits of the plan as they stand at `now`: `fiveHour` and `week`, each `{ used, at, resetsAt, resetAt,
 * level }` or null. `used` is the newest figure anything gave (the app's file `sample`, the chats' `readings`, a
 * `stop` by the app, which means full) and `at` says when that was; `resetsAt` is when it resets, null when no
 * chat read it in this window; `resetAt` is set when the known reset has passed and nothing was read since.
 * `level` is `ok`, `warn` from `warnAt` percent, and `full` at 100 (the week: B742, from `weekStopAt`, the person's stop line, 98)
 * or while a stop's reset is still ahead; `stopAt` says from which percent it is full.
 */
export function limitsOf({ sample = null, readings = [], stops = [], now, warnAt = 80, weekStopAt = WEEK_STOP_AT }) {
  const all = { sample, readings, stops, now, warnAt, weekStopAt }
  return { fiveHour: limitOf('fiveHour', all), week: limitOf('week', all) }
}
