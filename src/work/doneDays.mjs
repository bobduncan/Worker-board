// B579: the Backlog tab's Completed by day. Every step the work store moved to done, by the local day of that move, and
// a short recap of a day on top: a few points in plain words, where one point may cover several steps. The person,
// 2026-10-24: "i want an addition option to see what backlog items were done for that day, including a generated
// recap text, highover that tries to compactly describe the changes that were done. the goal here is easy overview."
// This file only decides (which steps, which day, when a recap is due, what the call is told and what its answer must
// be); src/dayRecap.mjs makes the call and keeps the recaps.

import { sinceMs, valueOf } from './item.mjs'

/** A day's recap is written again at most this often while its day is today. */
export const RECAP_EVERY_MS = 30 * 60_000
/** How many points a recap has at most, and at least (when the day has that many steps). */
export const MOST_POINTS = 6
export const FEWEST_POINTS = 3
/** The days Browse days lists. */
export const BROWSE_DAYS = 7

const two = n => String(n).padStart(2, '0')
/** The local day of a moment, as `YYYY-MM-DD`. */
export const dayOf = ms => {
  const at = new Date(ms)
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
}
export const isDay = value => /^\d{4}-\d\d-\d\d$/.test(String(value ?? '')) && Number.isFinite(sinceMs(value))
/** The day `count` days after `day` (before, when negative), across months and summer time. */
export const dayAfter = (day, count) => {
  const at = new Date(sinceMs(day))
  at.setDate(at.getDate() + count)
  return dayOf(at.getTime())
}

const MOVED_DONE = /^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d)\s+[^:]+:\s+(?:\S+ → done\b|ticked\b)/
const firstLine = lines => (lines ?? []).map(one => one.trim()).filter(one => one !== '').join(' ')

/**
 * The finished steps: `{ id, title, summary, goal, at, by, day }`, newest first. A step counts when it is done now and
 * its History has a move to done (or a tick); its time is the last such line. Dropped steps, and steps done before the
 * store kept a History of them, are not here. `by` is its Owner without the project's prefix.
 */
export function doneSteps(items, { prefix = '' } = {}) {
  const found = []
  for (const item of items) {
    if (valueOf(item, 'Kind') !== 'step' || valueOf(item, 'State') !== 'done') continue
    const moved = (item.sections.get('History') ?? []).findLast(line => MOVED_DONE.test(line))
    const at = moved === undefined ? Number.NaN : sinceMs(MOVED_DONE.exec(moved)[1])
    if (!Number.isFinite(at)) continue
    const owner = valueOf(item, 'Owner')
    found.push({
      id: valueOf(item, 'Id'), title: valueOf(item, 'Title') ?? '', summary: firstLine(item.sections.get('Summary')), goal: valueOf(item, 'Goal'), at,
      by: owner === null || owner === '-' ? null : owner.startsWith(prefix) ? owner.slice(prefix.length).trim() : owner, day: dayOf(at),
    })
  }
  return found.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id, 'en', { numeric: true }))
}

/** The steps finished on `day`, newest first. */
export const stepsOfDay = (steps, day) => steps.filter(step => step.day === day)

/** Browse days: the `count` days up to `today`, newest first, each with how many steps were finished on it. */
export function lastDays(steps, today, count = BROWSE_DAYS) {
  return Array.from({ length: count }, (_, back) => dayAfter(today, -back)).map(day => ({ day, count: stepsOfDay(steps, day).length }))
}

/** The ids a recap is about, in order, for comparing. */
const idsKey = ids => [...ids].sort().join(' ')

/**
 * Whether a day's recap is to be written (again) now. `kept` is what the board kept for the day: `{ points, isGenerated,
 * ids, newest, triedAt }` or null. Due: the day has steps and its recap is missing, was not generated (the fallback), or
 * is older than its newest step (a step finished since, or the steps changed). A day that is today is tried at most
 * every RECAP_EVERY_MS; a past day once per open while it is not generated.
 */
export function recapDue(kept, steps, { day, today, now }) {
  if (steps.length === 0) return false
  if (kept === null || kept === undefined) return true
  const isFresh = kept.isGenerated && kept.newest >= Math.max(...steps.map(step => step.at)) && idsKey(kept.ids ?? []) === idsKey(steps.map(step => step.id))
  if (isFresh) return false
  return day !== today || !Number.isFinite(kept.triedAt) || now - kept.triedAt >= RECAP_EVERY_MS
}

/**
 * What the call is told: the rules of the answer and the day's steps, each with only its id, title and summary (no
 * chat's words, no files, no History).
 */
export function recapPrompt(steps) {
  const most = Math.min(MOST_POINTS, steps.length)
  const fewest = Math.min(FEWEST_POINTS, steps.length)
  return [
    'You write a short recap of the work finished on one day, for the owner of a project who wants an easy overview.',
    `Group the items below into ${fewest === most ? most : `${fewest} to ${most}`} points. One point may cover several items that belong together.`,
    'Each point has a short title (at most 6 words) and one or two plain sentences (at most 30 words) on what changed for the owner.',
    'Plain words only: no file names, no ids, no code, no technical terms.',
    'Every item id goes into exactly one point.',
    'Answer with JSON only, no other text: {"points":[{"title":"...","text":"...","ids":["B1","B2"]}]}',
    '',
    'Items:',
    JSON.stringify(steps.map(step => ({ id: step.id, title: step.title, summary: step.summary }))),
  ].join('\n')
}

const cut = (words, most) => (words.length <= most ? words : `${words.slice(0, most - 1).trimEnd()}…`)

/**
 * The call's answer as recap points `[{ title, text, ids }]`, or null when it is not one: no JSON, fewer or more points
 * than allowed, a point without a title or ids, an id that is not the day's, or a step in no point or in two.
 */
export function readRecap(text, steps) {
  const found = String(text ?? '').match(/\{[\s\S]*\}/)
  if (found === null) return null
  let answer
  try {
    answer = JSON.parse(found[0])
  } catch {
    return null
  }
  const points = Array.isArray(answer?.points) ? answer.points : null
  if (points === null || points.length === 0 || points.length > Math.min(MOST_POINTS, steps.length) || points.length < Math.min(FEWEST_POINTS, steps.length)) return null
  const wanted = new Set(steps.map(step => step.id))
  const placed = new Set()
  const read = []
  for (const point of points) {
    const title = typeof point?.title === 'string' ? point.title.trim() : ''
    const ids = Array.isArray(point?.ids) ? point.ids.map(String) : []
    if (title === '' || ids.length === 0) return null
    for (const id of ids) {
      if (!wanted.has(id) || placed.has(id)) return null
      placed.add(id)
    }
    read.push({ title: cut(title, 60), text: cut(typeof point.text === 'string' ? point.text.trim() : '', 240), ids })
  }
  return placed.size === wanted.size ? read : null
}

const OTHER_WORK = 'Other work'

/**
 * The recap without a call: one point per goal (its title), the goals with most steps first, each with how many steps
 * and the first of their titles as its text. Steps of no known goal, and of the goals past the fifth when there are
 * more than MOST_POINTS, stand in one last point, "Other work".
 */
export function fallbackRecap(steps, goalTitles = new Map()) {
  const byGoal = new Map()
  for (const step of steps) {
    const key = step.goal !== null && goalTitles.has(step.goal) ? step.goal : null
    if (!byGoal.has(key)) byGoal.set(key, [])
    byGoal.get(key).push(step)
  }
  const goals = [...byGoal.entries()].filter(([goal]) => goal !== null).sort(([, one], [, other]) => other.length - one.length)
  const other = byGoal.get(null) ?? []
  const room = other.length > 0 || goals.length > MOST_POINTS ? MOST_POINTS - 1 : MOST_POINTS
  const kept = goals.slice(0, room)
  const rest = [...goals.slice(room).flatMap(([, list]) => list), ...other].sort((a, b) => b.at - a.at)
  const point = (title, list) => ({ title, text: cut(`${list.length} item${list.length === 1 ? '' : 's'}: ${list.map(step => step.title).join('; ')}`, 160), ids: list.map(step => step.id) })
  return [...kept.map(([goal, list]) => point(goalTitles.get(goal), list)), ...(rest.length === 0 ? [] : [point(OTHER_WORK, rest)])]
}

/** The point that holds the steps finished after the kept recap was written. */
export const NEWER_POINT = 'Finished since this recap'

/**
 * What the page shows of a day's recap: `{ points, isGenerated, why, at }`, or null for a day without steps. The kept
 * recap's points keep only the day's steps; steps it does not name yet stand in one more point (NEWER_POINT) until it
 * is written again. Without a kept recap: the fallback, not generated.
 */
export function shownRecap(kept, steps, goalTitles = new Map()) {
  if (steps.length === 0) return null
  if (kept === null || kept === undefined || !Array.isArray(kept.points)) return { points: fallbackRecap(steps, goalTitles), isGenerated: false, why: null, at: null }
  const ids = new Set(steps.map(step => step.id))
  const points = kept.points.map(point => ({ ...point, ids: point.ids.filter(id => ids.has(id)) })).filter(point => point.ids.length > 0)
  const named = new Set(points.flatMap(point => point.ids))
  const newer = steps.filter(step => !named.has(step.id))
  if (newer.length > 0) points.push({ title: NEWER_POINT, text: cut(newer.map(step => step.title).join('; '), 240), ids: newer.map(step => step.id) })
  return { points, isGenerated: kept.isGenerated === true, why: kept.isGenerated === true ? null : kept.why ?? null, at: kept.at ?? null }
}

/** The recap as plain text for the clipboard: the day, then each point with its text and its steps. */
export function recapText(day, points) {
  return [`Recap of ${day}`, ...points.map(point => `- ${point.title}${point.text === '' ? '' : `: ${point.text}`} (${point.ids.join(', ')})`)].join('\n')
}
