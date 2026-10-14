// The paths that differ per machine, from config.json next to the server.

import { readFile } from 'node:fs/promises'

const DEFAULTS = {
  project: '',
  gameRepo: '',
  appSessions: '',
  transcripts: '',
  port: 4310,
  refreshSeconds: 30,
  /** A running turn that wrote nothing for this long is shown as quiet. */
  quietMinutes: 10,
  /** An estimate older than this is shown as old. */
  estimateOldMinutes: 15,
  /** How far the timeline looks back from now, and at least how far ahead: the person plans with what comes. */
  hoursBack: 2,
  hoursAhead: 6,
  /** The longest message the chat box accepts. */
  maxMessageChars: 2000,
  /** A typed message that was not delivered within this time is never delivered. */
  messageKeepMinutes: 10,
  /** An answer to a request waits this long for its chat to take it: the chat may be busy, or not open. */
  answerKeepHours: 48,
  /** The chat that advises and is talked with on its own tab. It has no lane. */
  advisor: 'Advisor',
  /** The folders of the project whose pictures the board may show. */
  pictureRoots: ['art-inbox'],
  /** A game the board starts for a branch takes this port, plus the place of its folder in git's list. */
  gamePort: 5300,
  /** Such a game ends this long after its last tab was closed, or when nobody opened it in time. */
  gameIdleSeconds: 30,
  gameOpenSeconds: 120,
  /** B113: the file the app keeps its usage samples in, and the percentage from which a limit's bar warns. */
  usageHistory: '%APPDATA%\\Claude\\plan-usage-history.json',
  limitWarnPercent: 80,
  /**
   * B173: what one project sets for the Advisor (its job is the board's `roles/advisor.md`). The backlog, in the
   * project; the game plan, the Advisor's decisions and the documents it reads first, in the game's repository; the
   * backlog group its suggestions stand in; and its rounds: the morning one at this time ("" leaves it out, and so
   * does a 5-hour limit above `morningSkipPercent`), the weekly one right after the weekly limit resets.
   */
  backlog: '.claude/backlog.md',
  gamePlan: 'docs/game-plan.md',
  advisorDecisions: 'docs/advisor/decisions.md',
  advisorReadFirst: [],
  advisorSuggestions: 'Advisor suggestions',
  morningRound: '09:00',
  weeklyRound: true,
  morningSkipPercent: 80,
}

/** A path inside a folder, written with "/": no way out of it, never absolute. */
const INSIDE = /^(?!.*(?:^|\/)\.\.(?:\/|$))[\w.-]+(?:\/[\w .-]+)*$/

const PATHS = ['project', 'gameRepo', 'appSessions', 'transcripts']
const NUMBERS = ['port', 'refreshSeconds', 'quietMinutes', 'estimateOldMinutes', 'hoursBack', 'hoursAhead', 'maxMessageChars', 'messageKeepMinutes', 'answerKeepHours', 'gamePort', 'gameIdleSeconds', 'gameOpenSeconds', 'limitWarnPercent', 'morningSkipPercent']

/** Fills `%NAME%` from the environment. Windows names have no fixed case, so the look-up ignores it. */
export function expandEnv(text, env) {
  const byUpper = new Map(Object.entries(env).map(([name, value]) => [name.toUpperCase(), value]))
  return text.replace(/%([^%\\/]+)%/g, (whole, name) => byUpper.get(name.toUpperCase()) ?? whole)
}

export function parseConfig(text, env) {
  let raw = {}
  try {
    const parsed = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed
  } catch {
    // Not JSON: the defaults stand, and the page shows every source as unknown.
  }
  const config = { ...DEFAULTS }
  for (const key of PATHS) {
    if (typeof raw[key] === 'string') config[key] = expandEnv(raw[key], env)
  }
  // This one has a place by default: the app's own folder.
  config.usageHistory = expandEnv(typeof raw.usageHistory === 'string' ? raw.usageHistory : DEFAULTS.usageHistory, env)
  for (const key of NUMBERS) {
    if (Number.isFinite(raw[key]) && raw[key] > 0) config[key] = raw[key]
  }
  // The Workers mod types at most 3000 characters, and an answer also carries the name of its request.
  config.maxMessageChars = Math.min(config.maxMessageChars, 2500)
  if (typeof raw.advisor === 'string' && raw.advisor.trim() !== '') config.advisor = raw.advisor.trim()
  // A shown folder is one plain folder name in the project: never a path that could lead out of it.
  if (Array.isArray(raw.pictureRoots)) config.pictureRoots = raw.pictureRoots.filter(root => typeof root === 'string' && /^[\w-][\w.-]*$/.test(root))
  // B173: the Advisor's paths stay inside the project or the game's repository.
  for (const key of ['backlog', 'gamePlan', 'advisorDecisions']) {
    if (typeof raw[key] === 'string' && INSIDE.test(raw[key].trim())) config[key] = raw[key].trim()
  }
  if (Array.isArray(raw.advisorReadFirst)) config.advisorReadFirst = raw.advisorReadFirst.filter(path => typeof path === 'string' && INSIDE.test(path))
  if (typeof raw.advisorSuggestions === 'string' && raw.advisorSuggestions.trim() !== '') config.advisorSuggestions = raw.advisorSuggestions.trim()
  if (typeof raw.morningRound === 'string' && /^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(raw.morningRound.trim())) config.morningRound = raw.morningRound.trim()
  if (typeof raw.weeklyRound === 'boolean') config.weeklyRound = raw.weeklyRound
  config.morningSkipPercent = Math.min(config.morningSkipPercent, 100)
  return config
}

export async function loadConfig(file, env = process.env) {
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch {
    // No config file: the defaults stand.
  }
  return parseConfig(text, env)
}
