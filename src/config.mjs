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
  /** The chat that advises and is talked with on its own tab. It has no lane. */
  advisor: 'Advisor',
  /** The folders of the project whose pictures the board may show. */
  pictureRoots: ['art-inbox'],
  /** A game the board starts for a branch takes this port, plus the place of its folder in git's list. */
  gamePort: 5300,
  /** Such a game ends this long after its last tab was closed, or when nobody opened it in time. */
  gameIdleSeconds: 30,
  gameOpenSeconds: 120,
}

const PATHS = ['project', 'gameRepo', 'appSessions', 'transcripts']
const NUMBERS = ['port', 'refreshSeconds', 'quietMinutes', 'estimateOldMinutes', 'hoursBack', 'hoursAhead', 'maxMessageChars', 'messageKeepMinutes', 'gamePort', 'gameIdleSeconds', 'gameOpenSeconds']

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
  for (const key of NUMBERS) {
    if (Number.isFinite(raw[key]) && raw[key] > 0) config[key] = raw[key]
  }
  if (typeof raw.advisor === 'string' && raw.advisor.trim() !== '') config.advisor = raw.advisor.trim()
  // A shown folder is one plain folder name in the project: never a path that could lead out of it.
  if (Array.isArray(raw.pictureRoots)) config.pictureRoots = raw.pictureRoots.filter(root => typeof root === 'string' && /^[\w-][\w.-]*$/.test(root))
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
