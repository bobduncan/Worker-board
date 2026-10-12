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
  /** The hour the Today timeline starts at. */
  dayStartHour: 6,
  /** The longest message the chat box accepts. */
  maxMessageChars: 2000,
}

const PATHS = ['project', 'gameRepo', 'appSessions', 'transcripts']

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
  for (const key of Object.keys(DEFAULTS)) {
    if (PATHS.includes(key)) continue
    if (Number.isFinite(raw[key]) && raw[key] > 0) config[key] = raw[key]
  }
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
