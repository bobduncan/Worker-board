// B173: the board's clock for the Advisor's rounds (its job: roles/partner.md since Focus 2). The morning round at the time the
// settings give, the weekly one right after the weekly limit resets (and not that day's morning one). A round missed
// while the board was off comes once at its next start; a morning round is left out while the 5-hour limit is above
// the settings' percentage. The clock's line is the clock's, never the person's word.

import { join } from 'node:path'

const HEAD = 'Round from the board\'s clock:'

/** Whether a text is a line the clock typed (the Advisor's talk leaves it out). */
export const isClockLine = text => String(text ?? '').trimStart().startsWith(HEAD)

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()

/** The day's morning round time for `now` ("09:00", local), or null when there is none. */
function morningOf(now, at) {
  if (typeof at !== 'string' || !/^\d{2}:\d{2}$/.test(at)) return null
  const day = new Date(now)
  day.setHours(Number(at.slice(0, 2)), Number(at.slice(3)), 0, 0)
  return day.getTime()
}

/**
 * What the clock does at `now`. `kept` is what it wrote down before (`{ morning, weekly, nextWeekly, skipped }`, the
 * times of the last rounds, the weekly reset it waits for, the last round it left out), or null at its very first
 * start: then it only writes down, so a new board does not start a round at once. `weekReset` is the weekly limit's
 * reset as the board reads it now, `fiveHour` the 5-hour limit's use in percent (null when unknown).
 * Answers `{ kept, round, skipped }`: what to write down, the round to type now ('morning', 'weekly' or null), and a
 * round left out now (`{ round, at, why }`) or null.
 */
export function roundsNow({ now, kept, morningRound = '09:00', weeklyRound = true, weekReset = null, fiveHour = null, skipPercent = 80 }) {
  if (kept === null || typeof kept !== 'object') {
    return { kept: { morning: now, weekly: now, nextWeekly: Number.isFinite(weekReset) && weekReset > now ? weekReset : null, skipped: null }, round: null, skipped: null }
  }
  const last = { morning: kept.morning ?? -Infinity, weekly: kept.weekly ?? -Infinity }
  // The reset it waits for stays until its round ran; then a reading of the next one takes its place.
  let next = Number.isFinite(kept.nextWeekly) ? kept.nextWeekly : null
  const isDone = next !== null && next <= now && last.weekly >= next
  if (Number.isFinite(weekReset) && (next === null || isDone || (next > now && weekReset !== next))) next = weekReset
  const morning = morningOf(now, morningRound)
  const isMorningDue = morning !== null && now >= morning && last.morning < morning
  const after = { ...kept, nextWeekly: next }

  if (weeklyRound && next !== null && next <= now && last.weekly < next) {
    // The deep round takes the day's short one with it.
    return { kept: { ...after, weekly: now, morning: isMorningDue ? now : kept.morning ?? null }, round: 'weekly', skipped: null }
  }
  if (!isMorningDue) return { kept: after, round: null, skipped: null }
  const why = weeklyRound && next !== null && sameDay(next, morning)
    ? 'the weekly round comes today'
    : Number.isFinite(fiveHour) && fiveHour > skipPercent ? `the 5-hour limit is at ${fiveHour}%` : null
  if (why !== null) {
    const skipped = { round: 'morning', at: now, why }
    return { kept: { ...after, morning: now, skipped }, round: null, skipped }
  }
  return { kept: { ...after, morning: now }, round: 'morning', skipped: null }
}

/** B288: the first line of a round the person asks for with the Advisor tab's button. */
export const RECHECK_HEAD = 're-check the goals'

/** Where the Advisor's job and the project's settings are, a line each, for a round. */
function settingLines({ board, config }) {
  const inGame = path => (config.gameRepo === '' ? path : join(config.gameRepo, ...path.split('/')))
  return [
    `Your job: ${join(board, 'roles', 'partner.md')}`,
    config.gameRepo === '' ? null : `The game's repository: ${config.gameRepo}`,
    `The game plan: ${inGame(config.gamePlan)}`,
    `Your decisions: ${inGame(config.advisorDecisions)}`,
    config.advisorReadFirst.length === 0 ? null : `Read first: ${config.advisorReadFirst.join(', ')}`,
    `The backlog: ${config.project === '' ? config.backlog : join(config.project, ...config.backlog.split('/'))} (your suggestions under "${config.advisorSuggestions}")`,
  ]
}

/**
 * B288: the words typed into the Advisor's chat when the person asks for a round now (the Advisor tab's "Re-check the
 * goals now"): their word, marked as typed on the board, never the clock's line.
 */
export function recheckText({ board, config }) {
  return [
    RECHECK_HEAD,
    'The user asks for a round now: bring the way to the next milestone and the goal map up to date, as in a morning round.',
    ...settingLines({ board, config }),
  ].filter(line => line !== null).join('\n')
}

const STAGES = { vibe: 'the vibe', how: 'the how', run: 'the run' }

/**
 * Focus 3 (spec 2026-10-18, section 3): the morning round's line about the focus (the state's `focus`): with one, the
 * partner writes today's note on it; without one (or with one done), it has the person pick one.
 */
function focusLine(focus) {
  if (focus === null || focus === undefined || STAGES[focus.stage] === undefined) return 'No focus: have the user pick one on the board\'s Focus page (your job, "The daily note").'
  return `Your focus: ${focus.id} ${focus.title} (${STAGES[focus.stage]}). Write today's note on it: work note, to you, of ${focus.id}, with decided and needs (your job, "The daily note").`
}

/**
 * The words typed into the Advisor's chat for a round: the clock's line, then where its job and this project's
 * settings are, so the same job description serves any game.
 */
export function roundText(round, { board, config, focus = null }) {
  return [
    `${HEAD} ${round}`,
    ...settingLines({ board, config }),
    round === 'morning' ? focusLine(focus) : null,
    'This line is the worker board\'s clock, not the user\'s word.',
  ].filter(line => line !== null).join('\n')
}
