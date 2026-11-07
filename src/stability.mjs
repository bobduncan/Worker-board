// Stability numbers (2026-11-05, plan .claude/plans/2026-11-05-stability-numbers-plan.md, task 2): the per-minute record of
// idle-with-work, data/ready-minutes.jsonl. One line a minute while the board owns the loops: `{ at, free: [{ chat, could }] }`,
// each `could` the ready steps a free worker lane could take at that moment. It READS the board's state and writes one file;
// it changes nothing in how steps are handed out.

import { open, readFile } from 'node:fs/promises'

import { modelOf } from './work/effort.mjs'
import { match } from './work/handOut.mjs'
import { BAN_WHY_MARK } from './work/handover.mjs'
import { sinceMs, valueOf } from './work/item.mjs'
import { absentAs, appendLines, writeUnflushed } from './write.mjs'

/** The minute lines are kept this long; older ones go at the first write of a day. */
export const MINUTES_KEEP_MS = 31 * 24 * 60 * 60_000

const isWorkerLane = lane => lane?.isMain !== true && lane?.isLeftover !== true

/** Whether the lane's hand-over says a ban stands for steps of `family` ("free; gets no sonnet steps: its set failed at ..."). */
const isBanned = (lane, family) => {
  const why = lane.handover?.why
  return typeof why === 'string' && why.includes(BAN_WHY_MARK) && why.includes(`gets no ${family} steps`)
}

/**
 * The minute's line: for each worker lane that is free in the hand-over's own words (so not paused, not held by a limit), the
 * ready steps it could take: the ready entries `match` gives to that lane (a kept step only to its worker, a Quality
 * Assurance step never to a builder of the step, Touches that overlap a step under way skipped), less the steps whose model
 * family the lane is banned from. Lanes with nothing to take are left out: an empty minute is `{ at, free: [] }`. PURE.
 */
export function minuteOf(state, items, prefix = '', at = Date.now()) {
  const ready = state?.readyList?.ready ?? []
  const free = []
  for (const lane of state?.chats ?? []) {
    if (!isWorkerLane(lane) || lane.handover?.state !== 'free') continue
    const open = ready.filter(one => items.has(one.id) && !isBanned(lane, modelOf(items.get(one.id)).family))
    // match() hands out one step per idle lane, so the question is asked for each entry alone: could it go to this lane?
    const could = open.filter(one => match({ ready: [one], idle: [lane], items, prefix }).length > 0).map(one => one.id)
    if (could.length > 0) free.push({ chat: lane.name, could })
  }
  return { at, free }
}

/** The day of `ms` on this machine's clock: `2026-11-05`. */
export const dayOf = ms => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** `text` less the lines older than the keep time (a line that is not JSON is dropped too). */
export function prunedMinutes(text, now) {
  const kept = text.split('\n').filter(line => {
    try {
      return JSON.parse(line).at >= now - MINUTES_KEEP_MS
    } catch {
      return false
    }
  })
  return kept.length === 0 ? '' : `${kept.join('\n')}\n`
}

/**
 * The writer: `keep(state, items, prefix)` appends the minute's line to `file`. At the first write of a day (and of a board's
 * run) it first drops the lines older than 31 days. A file that cannot be written is said on the console; the loop goes on.
 */
export function minuteKeeper({ file, clock = Date.now }) {
  let prunedOn = null
  return async function keep(state, items, prefix = '') {
    const at = clock()
    try {
      if (prunedOn !== dayOf(at)) {
        const text = await readFile(file, 'utf8').catch(absentAs(''))
        const pruned = prunedMinutes(text, at)
        if (pruned !== text) await writeUnflushed(file, pruned)
        prunedOn = dayOf(at)
      }
      await appendLines(file, `${JSON.stringify(minuteOf(state, items, prefix, at))}\n`)
    } catch (error) {
      console.error(`The ready-minutes record could not be written (${error?.code ?? error?.message ?? 'unknown'}).`)
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Task 3 (2026-11-05): the day line. Three numbers a day (idle-with-work minutes, interventions, alarms) in data/stability.jsonl,
// from the records the board already keeps. Days are the person's local days (as `dayOf`, as the store's stamps). The pure
// functions are what the tests pin; `recordStability` is the one writer.

const MINUTE = 60_000
/** A wake attempt or a message to a chat this close before a change (and a few seconds after) explains the change. */
export const EXPLAIN_MS = 5 * MINUTE
/** The board's `resume` command names the chats that are not running; Main starts them over the next minutes. */
export const RESUME_EXPLAINS_MS = 10 * MINUTE
/** Run starts this close together are one moment (an app restart starts every chat within a minute or two). */
export const MOMENT_MS = 2 * MINUTE
/** A landing (or a board start) this close to a moment explains it. */
export const LANDING_EXPLAINS_MS = 5 * MINUTE
/** Two woke-outside findings for one chat this close are one. */
export const SAME_WAKE_MS = 10 * MINUTE
/** The finish line: `STABLE_DAYS` days in a row with no intervention and under `STABLE_IDLE_MINUTES` of idle-with-work. */
export const STABLE_DAYS = 3
export const STABLE_IDLE_MINUTES = 10

const SLACK_MS = 10_000

/** The start of the local day `day` (`2026-11-05`), and of the next one (DST safe). */
export const dayStartOf = day => sinceMs(day)
export const nextDayStartOf = day => {
  const start = new Date(sinceMs(day))
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime()
}

/** The chats the board wakes: the keys of wakes.json (`*` is a launch of the whole app, which starts every chat). */
const wakesOf = wakes => wakes?.wakes ?? wakes ?? {}
const reportsOf = reports => reports?.reports ?? reports ?? {}
const attemptsOf = (wakes, chat) => {
  const out = []
  for (const key of [chat, '*']) for (const spell of wakesOf(wakes)[key] ?? []) for (const attempt of spell.attempts ?? []) if (Number.isFinite(attempt.at)) out.push(attempt)
  return out
}
const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Every moment an outbox record touched its chat: when it was put (`at`), taken, handed to a hand, typed and entered, each stage
 * (a clear of the board's hand-over) and when it was delivered or settled. The board's own messages and clears are delivered, and
 * start a new run, later than `at`, so a record reaches a chat at ANY of these times.
 */
export const timesOf = record => [
  record.at, record.takenAt, record.handTakenAt, record.deliveredAt, record.settledAt, record.outcome?.typedAt, record.outcome?.enteredAt,
  ...(Array.isArray(record.stages) ? record.stages.map(stage => stage?.at) : []),
].filter(Number.isFinite)

/**
 * Whether the board (or a chat through the board) reached `chat` shortly before `at`: a wake attempt of its own or of the whole
 * app (`*`), a message of the outbox that did not get dropped (any of its times in the window, see `timesOf`), or a `resume`
 * command that names it. PURE.
 */
export function isReached({ chat, at, wakes, outbox }) {
  if (attemptsOf(wakes, chat).some(attempt => attempt.at >= at - EXPLAIN_MS && attempt.at <= at + SLACK_MS)) return true
  const inWindow = (record, before) => timesOf(record).some(time => time >= at - before && time <= at + SLACK_MS)
  return (outbox ?? []).some(record => {
    if (!Number.isFinite(record.at) || record.state === 'dropped') return false
    if (record.to === chat) return inWindow(record, EXPLAIN_MS)
    return record.command === 'resume' && inWindow(record, RESUME_EXPLAINS_MS)
      && new RegExp(`(^|[^A-Za-z0-9])${escaped(chat)}(?![0-9])`).test(String(record.text ?? ''))
  })
}

/** The run starts the records know for the chats the board wakes: the report's current `run` and every attempt's `runBefore`. */
function runStartsOf({ reports, wakes }) {
  const found = new Map()
  const add = (chat, run) => {
    if (!Number.isFinite(run) || run <= 0) return
    found.set(chat, [...(found.get(chat) ?? []), run])
  }
  for (const [chat, spells] of Object.entries(wakesOf(wakes))) {
    if (chat === '*') continue
    for (const spell of spells) for (const attempt of spell.attempts ?? []) add(chat, attempt.runBefore)
    add(chat, reportsOf(reports)[chat]?.run)
  }
  return new Map([...found].map(([chat, runs]) => [chat, [...new Set(runs)].sort((a, b) => a - b)]))
}

const stampText = at => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
const landingMs = landing => (Number.isFinite(landing.at) ? landing.at : Date.parse(landing.at))
const nearLanding = (landings, at) => (landings ?? []).some(landing => Math.abs(landingMs(landing) - at) <= LANDING_EXPLAINS_MS)

/**
 * The person's hands on the board in `day`, and what the records cannot tell apart. PURE. Inputs: `actions` (data/actions.jsonl),
 * `lastStop` (state.board.lastStop), `kept` and `keptUnsure` (the day line's earlier interventions and unsure findings, of EVERY
 * kind: the board shows a stop for 15 minutes and the reports hold only the newest run of a chat, so a finding drawn from those
 * stays once made), `lanes` (the chats the board tracks as lanes, beside those the history names), `landings`, `reports`
 * (reports.json), `history` (parsed history.jsonl lines), `wakes` (wakes.json), `outbox` (outbox records, merged by id), `asks`
 * (the store's Q items), `live` (the chats a restart of the app would start again). Answers `{ interventions, unsure }`, each
 * `{ at, kind, what }` (unsure: also `why`), oldest first. A finding is made only when a record proves it: the rest is unsure.
 */
export function interventionsOf({ actions = [], lastStop = null, kept = [], keptUnsure = [], lanes = [], landings = [], reports = {}, history = [], wakes = {}, outbox = [], asks = [], day, live = null }) {
  const from = dayStartOf(day)
  const to = nextDayStartOf(day)
  const inDay = at => Number.isFinite(at) && at >= from && at < to
  const found = []
  const unsure = []

  // resume-all: the person's own Pause all, ended by the person, is no intervention; a resume with none before it is.
  let ownPause = false
  for (const action of [...actions].filter(one => one.by === 'person').sort((a, b) => a.at - b.at)) {
    if (action.action === 'pause-all') ownPause = true
    else if (action.action === 'resume-all') {
      if (!ownPause && inDay(action.at)) found.push({ at: action.at, kind: 'resume-all', what: 'Resume all, ending a pause that was not yours' })
      ownPause = false
    }
  }

  // rollback: a landing the board took back.
  for (const landing of landings) {
    const at = landingMs(landing)
    if (inDay(at) && String(landing.result ?? '').startsWith('rolled back')) found.push({ at, kind: 'rollback', what: `${landing.branch ?? 'a branch'} was rolled back (${landing.result})` })
  }

  // restart-by-hand: the board started by hand with no landing around its start.
  if (lastStop !== null && inDay(lastStop.to) && !nearLanding(landings, lastStop.to)) {
    if (lastStop.start === 'hand') found.push({ at: lastStop.to, kind: 'restart-by-hand', what: 'The board was started by hand, with no landing around it' })
    else if (lastStop.start !== 'keeper') unsure.push({ at: lastStop.to, kind: 'restart-by-hand', what: 'The board started with no landing around it', why: 'the stop record does not say how it was started (hand or keeper)' })
  }

  // app-restart and woke-outside: a chat that started a run (or came back from off) with nobody reaching it first.
  const unexplained = []
  // The chats the history tracks (lanes). A chat it does not know (the Advisor, the Supervisor) leaves only its run start behind.
  const tracked = new Set([...lanes, ...history.map(line => line.chat).filter(chat => typeof chat === 'string')])
  const runs = runStartsOf({ reports, wakes })
  for (const [chat, starts] of runs) {
    for (const run of starts) if (inDay(run) && !isReached({ chat, at: run, wakes, outbox })) unexplained.push({ at: run, chat, source: 'run' })
  }
  const last = new Map()
  for (const line of [...history].sort((a, b) => a.at - b.at)) {
    if (line.gap === true) {
      last.clear()
      continue
    }
    if (typeof line.chat !== 'string') continue
    const before = last.get(line.chat)?.state
    last.set(line.chat, line)
    if (before === undefined || before === line.state || !inDay(line.at) || !['working', 'free'].includes(line.state)) continue
    if (isReached({ chat: line.chat, at: line.at, wakes, outbox })) continue
    if (before === 'off') unexplained.push({ at: line.at, chat: line.chat, source: 'history' })
    else if (before === 'interrupted' && line.state === 'working') {
      unsure.push({ at: line.at, kind: 'woke-outside', what: `${line.chat} went from interrupted to working with no wake or message in the 5 minutes before`, why: 'someone typed into it, or it went on by itself: the records do not tell the two apart' })
    }
  }
  unexplained.sort((a, b) => a.at - b.at)

  // A moment: unexplained starts of several chats within 2 minutes. Every chat the app would start again = the app was restarted.
  const restarts = kept.filter(one => one.kind === 'app-restart' && inDay(one.at))
  const liveNames = new Set(live ?? [...runs.keys()].filter(chat => reportsOf(reports)[chat]?.state !== 'ended'))
  let momentEnd = -Infinity
  for (const start of unexplained) {
    if (start.at <= momentEnd) continue
    const moment = unexplained.filter(one => one.at >= start.at && one.at <= start.at + MOMENT_MS)
    momentEnd = start.at + MOMENT_MS
    const chats = new Set(moment.map(one => one.chat))
    if (chats.size < 2 || nearLanding(landings, start.at)) continue
    if (liveNames.size > 0 && [...liveNames].every(chat => chats.has(chat))) {
      restarts.push({ at: start.at, kind: 'app-restart', what: `Every chat started a new run within 2 minutes (${[...chats].join(', ')}) and nothing of the board explains it` })
    }
  }
  const restartAt = restarts.map(one => one.at)
  const inRestart = at => restartAt.some(start => at >= start - SLACK_MS && at <= start + MOMENT_MS + SLACK_MS)
  found.push(...restarts)
  // What an earlier pass of the day found stays (any kind), unless an app restart now explains it as one of its chats' starts.
  for (const one of kept) if (inDay(one.at) && one.kind !== 'app-restart' && !(one.kind === 'woke-outside' && inRestart(one.at))) found.push(one)
  for (const one of keptUnsure) if (inDay(one.at) && !(one.kind === 'woke-outside' && inRestart(one.at))) unsure.push(one)

  const lastWake = new Map()
  for (const one of unexplained) {
    if (inRestart(one.at)) continue
    if (nearLanding(landings, one.at)) continue
    if (one.at - (lastWake.get(one.chat) ?? -Infinity) <= SAME_WAKE_MS) continue
    lastWake.set(one.chat, one.at)
    if (one.source === 'run' && tracked.size > 0 && !tracked.has(one.chat)) {
      // No lane history for this chat: the records show a run began and nothing of the board reached it, not whether someone woke it
      // for the board's words or opened it to talk (the person's own chat with the Advisor), nor whether it began with the app.
      unsure.push({ at: one.at, kind: 'woke-outside', what: `${one.chat} began a run at ${stampText(one.at)} with no board wake or message before it`, why: 'the history does not track this chat: the records do not tell a wake for the board from the person opening it to talk' })
      continue
    }
    found.push({ at: one.at, kind: 'woke-outside', what: `${one.chat} was started at ${stampText(one.at)} with no board wake or message before it${one.source === 'run' ? ' (its run began then)' : ' (it came back from off)'}` })
  }

  // open-its-chat: the board asked the person to open a chat, and the person answered.
  for (const ask of asks) {
    const text = [ask.head?.get('Title'), ...(ask.sections?.get('Text') ?? [])].join(' ')
    if (!/open its chat/i.test(text)) continue
    for (const entry of ask.sections?.get('History') ?? []) {
      const answered = entry.match(/^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+person: answered/)
      const at = answered === null ? Number.NaN : sinceMs(answered[1])
      if (inDay(at)) found.push({ at, kind: 'open-its-chat', what: `${ask.head.get('Id')} asked you to open a chat, and you answered` })
    }
  }

  const unique = list => {
    const seen = new Set()
    return list.sort((a, b) => a.at - b.at).filter(one => {
      const key = one.kind === 'app-restart' ? `app-restart|${one.at}` : `${one.kind}|${one.at}|${one.what}`
      return seen.has(key) ? false : seen.add(key)
    })
  }
  const interventions = unique(found)
  // A finding the records later proved is no longer unsure.
  return { interventions, unsure: unique(unsure).filter(one => !interventions.some(found => found.kind === one.kind && found.at === one.at)) }
}

/** Whether an incident was not a fault: closed with "No fault" or "obsolete" in its history, or gone by itself. */
const isFalse = item => {
  const state = valueOf(item, 'State')
  if (state === 'gone') return true
  return state === 'closed' && (item.sections?.get('History') ?? []).some(line => /closed: (No fault|obsolete)/i.test(line))
}

/**
 * The incidents raised in `day` (their `First seen`, else their `Since`: an incident that was fixed or went gone later is
 * the alarm of the day it was raised, never counted twice): `{ real, false, ids }`. PURE.
 */
export function alarmsOf(incidents, day) {
  const mine = [...incidents].filter(item => {
    if (valueOf(item, 'Kind') !== 'incident') return false
    return String(valueOf(item, 'First seen') ?? valueOf(item, 'Since') ?? '').slice(0, 10) === day
  })
  const falses = mine.filter(isFalse)
  return { real: mine.length - falses.length, false: falses.length, ids: mine.map(item => valueOf(item, 'Id')).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))) }
}

/** The day's idle-with-work minutes: the distinct whole minutes of the day in which some free lane had a ready step to take. */
export function idleMinutesOf(minutes, day) {
  const from = dayStartOf(day)
  const to = nextDayStartOf(day)
  const counted = new Set()
  for (const line of minutes) {
    if (!Number.isFinite(line?.at) || line.at < from || line.at >= to) continue
    if ((line.free ?? []).some(lane => (lane.could ?? []).length > 0)) counted.add(Math.floor(line.at / MINUTE))
  }
  return counted.size
}

/** The day's line. PURE. `estimated` is the backfill's: true where the minute record did not exist. */
export function dayLineOf({ day, minutes = [], interventions = [], unsure = [], alarms, now, estimated = false, closed = false }) {
  return { day, idleWithWorkMinutes: idleMinutesOf(minutes, day), idleEstimated: estimated, interventions, unsure, alarms: alarms ?? { real: 0, false: 0, ids: [] }, writtenAt: now, closed }
}

const dayBefore = day => {
  const start = new Date(sinceMs(day))
  return dayOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1).getTime())
}

/**
 * The finish line over the day lines: `stableDays`, the days in a row (ending yesterday, or today if its line is closed) with no
 * intervention and under 10 minutes of idle-with-work; `isStable` from 3. A day with no line breaks the row. PURE.
 */
export function finishOf(lines) {
  const sorted = [...lines].sort((a, b) => (a.day < b.day ? 1 : -1))
  if (sorted.length > 0 && sorted[0].closed !== true) sorted.shift()
  let stableDays = 0
  let expect = null
  for (const line of sorted) {
    if (expect !== null && line.day !== expect) break
    if ((line.interventions ?? []).length > 0 || !(line.idleWithWorkMinutes < STABLE_IDLE_MINUTES)) break
    stableDays += 1
    expect = dayBefore(line.day)
  }
  return { stableDays, isStable: stableDays >= STABLE_DAYS }
}

// -- reading: today's part of each record, from the end, asynchronously ----------------------------------------------------

/**
 * The lines of a JSONL `file` from the end back to the first line older than `since` (by `atOf`), oldest first. Lines that do
 * not parse are skipped. Reads 64 KB at a time, at most `maxBytes`. A file that is not there gives [].
 */
export async function tailLines(file, since, { atOf = line => line.at, chunk = 64 * 1024, maxBytes = 16 * 1024 * 1024 } = {}) {
  const handle = await open(file, 'r').catch(absentAs(null))
  if (handle === null) return []
  try {
    const { size } = await handle.stat()
    let position = size
    let rest = Buffer.alloc(0)
    let parsed = []
    let readBytes = 0
    while (position > 0 && readBytes < maxBytes) {
      const length = Math.min(chunk, position)
      position -= length
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, position)
      readBytes += length
      const joined = Buffer.concat([buffer, rest])
      const newline = position > 0 ? joined.indexOf(0x0a) : -1
      let complete = joined
      if (position > 0) {
        // The first piece may be the end of a line that starts in the next chunk back: held until that chunk is read.
        rest = newline === -1 ? joined : joined.subarray(0, newline)
        complete = newline === -1 ? Buffer.alloc(0) : joined.subarray(newline + 1)
      }
      const batch = []
      for (const text of complete.toString('utf8').split('\n')) {
        if (text.trim() === '') continue
        try {
          batch.push(JSON.parse(text))
        } catch {
          // A torn or padded line is skipped.
        }
      }
      parsed = [...batch, ...parsed]
      const firstAt = parsed.map(atOf).find(Number.isFinite)
      if (Number.isFinite(firstAt) && firstAt < since) break
    }
    return parsed
  } finally {
    await handle.close()
  }
}

const readLines = async file => {
  const text = await readFile(file, 'utf8').catch(absentAs(''))
  const out = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // Skipped.
    }
  }
  return out
}
const readJson = async (file, fallback) => JSON.parse(await readFile(file, 'utf8').catch(absentAs(JSON.stringify(fallback)))) ?? fallback

/** The outbox keeps a record as several lines (its first, then each change of state): merged by id. */
export function mergedOutbox(lines) {
  const byId = new Map()
  for (const line of lines) if (typeof line?.id === 'string') byId.set(line.id, { ...(byId.get(line.id) ?? {}), ...line })
  return [...byId.values()].filter(record => Number.isFinite(record.at))
}

/** The 14 closed lines the state shows, newest last. */
export const SHOWN_DAYS = 14

/** The names of the files the writer reads and writes, in the board's data folder. */
export const filesOf = dir => ({
  actions: `${dir}/actions.jsonl`, minutes: `${dir}/ready-minutes.jsonl`, landings: `${dir}/landings.jsonl`, wakes: `${dir}/wakes.json`,
  reports: `${dir}/reports.json`, history: `${dir}/history.jsonl`, outbox: `${dir}/outbox.jsonl`, stability: `${dir}/stability.jsonl`,
})

/** What the state field shows: today's line, the last 14 closed lines and the finish line. */
export function viewOf(lines, now) {
  const day = dayOf(now)
  const today = lines.find(line => line.day === day) ?? null
  return { today, days: lines.filter(line => line.closed === true && line.day !== day).slice(-SHOWN_DAYS), ...finishOf(lines.filter(line => line.day <= day)) }
}

/**
 * The writer: reads today's part of the records, makes today's line and writes data/stability.jsonl whole and atomically. At the
 * first pass of a new day the previous day's line gets `closed: true`, once; a closed line is never rewritten. `items` is the
 * work store's items (the X and Q files). Returns `{ today, days, stableDays, isStable }` for the state field, or null when it
 * failed (said on the console; the loop goes on).
 */
export async function recordStability(state, { dir, items = new Map(), clock = Date.now, files = filesOf(dir) } = {}) {
  try {
    const now = clock()
    const day = dayOf(now)
    const from = dayStartOf(day)
    const [stored, actions, minutes, landings, wakes, reports, history, outbox] = await Promise.all([
      readLines(files.stability), readLines(files.actions), tailLines(files.minutes, from), readLines(files.landings),
      readJson(files.wakes, { wakes: {} }), readJson(files.reports, { reports: {} }),
      tailLines(files.history, from - 2 * 60 * MINUTE), tailLines(files.outbox, from - 20 * MINUTE),
    ])
    const lines = stored.filter(line => typeof line?.day === 'string')
    // The first pass of a new day closes the lines before it, once. A closed line is kept as it is.
    const closed = lines.map(line => (line.day < day && line.closed !== true ? { ...line, closed: true } : line))
    const before = closed.find(line => line.day === day)
    if (before?.closed === true) return viewOf(closed, now)
    const all = [...items.values()]
    const live = Object.entries(reports.reports ?? {}).filter(([chat, report]) => report?.state !== 'ended' && Object.hasOwn(wakes.wakes ?? {}, chat)).map(([chat]) => chat)
    const { interventions, unsure } = interventionsOf({
      actions, lastStop: state?.board?.lastStop ?? null, kept: before?.interventions ?? [], keptUnsure: before?.unsure ?? [],
      lanes: (state?.chats ?? []).map(lane => lane?.name).filter(name => typeof name === 'string'), landings, reports, history, wakes,
      outbox: mergedOutbox(outbox), asks: all.filter(item => valueOf(item, 'Kind') === 'ask'), day, live,
    })
    const today = dayLineOf({ day, minutes, interventions, unsure, alarms: alarmsOf(all.filter(item => valueOf(item, 'Kind') === 'incident'), day), now })
    const next = [...closed.filter(line => line.day !== day), today].sort((a, b) => (a.day < b.day ? -1 : 1))
    await writeUnflushed(files.stability, `${next.map(line => JSON.stringify(line)).join('\n')}\n`)
    return viewOf(next, now)
  } catch (error) {
    console.error(`The stability record could not be written (${error?.code ?? error?.message ?? 'unknown'}).`)
    return null
  }
}

/** The loop's writer: `keep(state, items)` records the day and holds what the state builder reads (`keep.latest()`). */
export function stabilityKeeper({ dir, clock = Date.now, files }) {
  let latest = null
  const keep = async (state, items = new Map()) => {
    latest = (await recordStability(state, { dir, items, clock, files })) ?? latest
    return latest
  }
  keep.latest = () => latest
  return keep
}
