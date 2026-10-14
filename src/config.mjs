// The paths that differ per machine, from config.json next to the server.

import { constants } from 'node:fs'
import { access, copyFile, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const DEFAULTS = {
  /** B129: the project's name, the page's title; by default the project folder's name. */
  name: '',
  project: '',
  /** B194: the branch the project's work is merged into: its game, the one the Run game button starts. */
  baseBranch: 'main',
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
  /**
   * The folders of the project whose pictures the board may show. B193: the first is the project's own picture
   * folder, where the board keeps the pictures it is given (those pasted into Talk to Main).
   */
  pictureRoots: ['pictures'],
  /** A game the board starts for a branch takes this port, plus the place of its folder in git's list. */
  gamePort: 5300,
  /** Such a game ends this long after its last tab was closed, or when nobody opened it in time. */
  gameIdleSeconds: 30,
  /**
   * B197: the command that starts a working folder's game, as a list of words; none by default. `{folder}`, `{port}`,
   * `{idle}`, `{grace}`, `{cache}`, `{node}` (this Node) and `{board}` (the board's folder) are filled in. It prints
   * `ready <port>` once the game is served, and ends by itself when nobody looks; `run-game.mjs` (Vite) is the example.
   */
  runGame: [],
  /** B133: the project's file of the Design tab's kinds of idea and reference pictures (examples/design.json shows one). */
  designKinds: '.claude/design.json',
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
  // B195: the Advisor's map of the way to the next milestone, in the game's repository (JSON, see roles/advisor.md).
  milestoneMap: 'docs/advisor/milestone-map.json',
  advisorDecisions: 'docs/advisor/decisions.md',
  advisorReadFirst: [],
  advisorSuggestions: 'Advisor suggestions',
  morningRound: '09:00',
  weeklyRound: true,
  morningSkipPercent: 80,
}

/** A branch's name as git allows it, plainly: letters, digits, "_", ".", "/" and "-", and no "..". */
const BRANCH = /^(?!.*\.\.)[\w][\w./-]{0,120}$/

/** A path inside a folder, written with "/": no way out of it, never absolute. */
const INSIDE = /^(?!.*(?:^|\/)\.\.(?:\/|$))[\w.-]+(?:\/[\w .-]+)*$/

const PATHS = ['project', 'gameRepo', 'appSessions', 'transcripts']
const NUMBERS = ['port', 'refreshSeconds', 'quietMinutes', 'estimateOldMinutes', 'hoursBack', 'hoursAhead', 'maxMessageChars', 'messageKeepMinutes', 'answerKeepHours', 'gamePort', 'gameIdleSeconds', 'gameOpenSeconds', 'limitWarnPercent', 'morningSkipPercent']

/**
 * B134: where the app keeps the transcripts of a project's chats: the user's `.claude\projects`, in a folder named
 * after the project's path with every character that is no letter or digit as "-" (`C:\Work\my-project` is
 * `C--Work-my-project`, `/Users/sam/game` is `-Users-sam-game`). '' when the user's home is not known.
 */
export function transcriptsOf(project, env) {
  const byUpper = new Map(Object.entries(env).map(([name, value]) => [name.toUpperCase(), value]))
  const home = byUpper.get('USERPROFILE') ?? byUpper.get('HOME') ?? ''
  return home === '' ? '' : join(home, '.claude', 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'))
}

/** Fills `%NAME%` from the environment. Windows names have no fixed case, so the look-up ignores it. */
export function expandEnv(text, env) {
  const byUpper = new Map(Object.entries(env).map(([name, value]) => [name.toUpperCase(), value]))
  return text.replace(/%([^%\\/]+)%/g, (whole, name) => byUpper.get(name.toUpperCase()) ?? whole)
}

export function parseConfig(text, env) {
  let raw = {}
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed
  } catch {
    // Not JSON: the defaults stand, and the page shows every source as unknown.
  }
  const config = { ...DEFAULTS }
  for (const key of PATHS) {
    if (typeof raw[key] === 'string') config[key] = expandEnv(raw[key], env)
  }
  // B134: the app keeps a project's transcripts in the user's .claude\projects, in a folder named after the project's
  // path; a setting of its own still wins.
  if (config.transcripts === '' && config.project !== '') config.transcripts = transcriptsOf(config.project, env)
  // This one has a place by default: the app's own folder.
  config.usageHistory = expandEnv(typeof raw.usageHistory === 'string' ? raw.usageHistory : DEFAULTS.usageHistory, env)
  for (const key of NUMBERS) {
    if (Number.isFinite(raw[key]) && raw[key] > 0) config[key] = raw[key]
  }
  // The Workers mod types at most 3000 characters, and an answer also carries the name of its request.
  config.maxMessageChars = Math.min(config.maxMessageChars, 2500)
  if (typeof raw.advisor === 'string' && raw.advisor.trim() !== '') config.advisor = raw.advisor.trim()
  if (typeof raw.baseBranch === 'string' && BRANCH.test(raw.baseBranch.trim())) config.baseBranch = raw.baseBranch.trim()
  config.name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : config.project.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  // A shown folder is one plain folder name in the project: never a path that could lead out of it.
  if (Array.isArray(raw.pictureRoots)) config.pictureRoots = raw.pictureRoots.filter(root => typeof root === 'string' && /^[\w-][\w.-]*$/.test(root))
  // B173: the Advisor's paths stay inside the project or the game's repository.
  for (const key of ['backlog', 'gamePlan', 'milestoneMap', 'advisorDecisions', 'designKinds']) {
    if (typeof raw[key] === 'string' && INSIDE.test(raw[key].trim())) config[key] = raw[key].trim()
  }
  if (Array.isArray(raw.advisorReadFirst)) config.advisorReadFirst = raw.advisorReadFirst.filter(path => typeof path === 'string' && INSIDE.test(path))
  if (typeof raw.advisorSuggestions === 'string' && raw.advisorSuggestions.trim() !== '') config.advisorSuggestions = raw.advisorSuggestions.trim()
  if (typeof raw.morningRound === 'string' && /^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(raw.morningRound.trim())) config.morningRound = raw.morningRound.trim()
  if (typeof raw.weeklyRound === 'boolean') config.weeklyRound = raw.weeklyRound
  if (Array.isArray(raw.runGame) && raw.runGame.every(word => typeof word === 'string' && word !== '')) config.runGame = [...raw.runGame]
  config.morningSkipPercent = Math.min(config.morningSkipPercent, 100)
  return config
}

/** The place of a JSON error's position in the text: " at line 3, column 14", or "". */
function whereIn(text, error) {
  const at = Number(error.message.match(/position (\d+)/)?.[1])
  if (!Number.isFinite(at)) return ''
  const before = text.slice(0, at).split('\n')
  return ` at line ${before.length}, column ${before.at(-1).length + 1}`
}

/**
 * B128: what is wrong with a settings file's text, as one line, or null. A file that is no JSON, or a setting of the
 * wrong kind, is named: the board stops on it instead of quietly running on its defaults. Settings it does not know
 * are left alone.
 */
export function configProblem(fileText) {
  const text = fileText.replace(/^\uFEFF/, '')
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return `it is not valid JSON${whereIn(text, error)}: ${error.message.replace(/ in JSON at position \d+.*$/, '')}`
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return 'it must hold one object, { ... }'
  const has = key => Object.hasOwn(raw, key)
  const wrong = (key, wants) => `"${key}" must be ${wants}, not ${JSON.stringify(raw[key]).slice(0, 60)}`
  for (const key of [...PATHS, 'name', 'usageHistory', 'advisor', 'advisorSuggestions']) if (has(key) && typeof raw[key] !== 'string') return wrong(key, 'text')
  for (const key of NUMBERS) if (has(key) && !(Number.isFinite(raw[key]) && raw[key] > 0)) return wrong(key, 'a number above 0')
  if (has('port') && !(Number.isInteger(raw.port) && raw.port <= 65535)) return wrong('port', 'a whole number from 1 to 65535')
  for (const key of ['backlog', 'gamePlan', 'milestoneMap', 'advisorDecisions', 'designKinds']) if (has(key) && !(typeof raw[key] === 'string' && INSIDE.test(raw[key].trim()))) return wrong(key, 'a path inside its folder, written with /')
  if (has('pictureRoots') && !(Array.isArray(raw.pictureRoots) && raw.pictureRoots.length > 0 && raw.pictureRoots.every(one => typeof one === 'string' && /^[\w-][\w.-]*$/.test(one)))) return wrong('pictureRoots', 'a list of one or more plain folder names')
  if (has('advisorReadFirst') && !(Array.isArray(raw.advisorReadFirst) && raw.advisorReadFirst.every(one => typeof one === 'string' && INSIDE.test(one)))) return wrong('advisorReadFirst', 'a list of paths inside the game, written with /')
  if (has('morningRound') && !(typeof raw.morningRound === 'string' && /^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(raw.morningRound.trim()))) return wrong('morningRound', 'a time like "09:00", or "" for none')
  if (has('weeklyRound') && typeof raw.weeklyRound !== 'boolean') return wrong('weeklyRound', 'true or false')
  if (has('runGame') && !(Array.isArray(raw.runGame) && raw.runGame.every(word => typeof word === 'string' && word !== ''))) return wrong('runGame', 'a list of words, the program first')
  if (has('baseBranch') && !(typeof raw.baseBranch === 'string' && BRANCH.test(raw.baseBranch.trim()))) return wrong('baseBranch', 'a branch name such as "main"')
  return null
}

/**
 * B127: the settings file at a board's first start. A copy of the board carries no PC's settings: without `file`,
 * the board makes it from `template` (examples/config.json), never over a file that is there, and says which paths to
 * fill in. Answers that line, or null when the file was there.
 */
export async function firstStart(file, template) {
  try {
    await access(file)
    return null
  } catch {
    // Not there yet: made below.
  }
  try {
    await copyFile(template, file, constants.COPYFILE_EXCL)
  } catch (error) {
    if (error.code === 'EEXIST') return null
    throw error
  }
  return `The worker board made its settings file ${file} from ${template}. Fill in "project" (your project's folder), `
    + '"name" (its name) and, once there is one, "gameRepo" (the folder of its code); the board finds the app\'s folders '
    + 'and the chats\' transcripts by itself. Then start the board again.'
}

const isFolder = path => stat(path).then(info => info.isDirectory(), () => false)

/**
 * B135: the Claude app's own folder, where it keeps its list of chats (`claude-code-sessions`) and its usage file
 * (`plan-usage-history.json`): the first place the app uses on this system that holds the list of chats, or null.
 * Windows: `%APPDATA%\Claude`, which the Microsoft Store app shows only to programs it starts itself; a board started
 * elsewhere finds the Store app's real folder, `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude`. A Mac:
 * `~/Library/Application Support/Claude`. Linux: `~/.config/Claude`.
 */
export async function appFolder(env, platform = process.platform, { list = readdir, there = isFolder } = {}) {
  const byUpper = new Map(Object.entries(env).map(([name, value]) => [name.toUpperCase(), value]))
  const [roaming, local, home] = ['APPDATA', 'LOCALAPPDATA', 'HOME'].map(name => byUpper.get(name) ?? '')
  const places = []
  if (platform === 'win32') {
    if (roaming !== '') places.push(join(roaming, 'Claude'))
    if (local !== '') {
      const packages = await list(join(local, 'Packages')).catch(() => [])
      for (const name of packages.filter(one => /^Claude_/i.test(one))) places.push(join(local, 'Packages', name, 'LocalCache', 'Roaming', 'Claude'))
    }
  } else if (home !== '') places.push(platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude') : join(home, '.config', 'Claude'))
  for (const place of places) if (await there(join(place, 'claude-code-sessions'))) return place
  return null
}

/** A settings file the board cannot run on: its message is the one line the board says before it stops. */
export class BrokenConfig extends Error {}

/** The settings in `file`. A broken file throws `BrokenConfig`; a missing one leaves the defaults (B127 takes that). */
export async function loadConfig(file, env = process.env, platform = process.platform) {
  let text = null
  try {
    text = await readFile(file, 'utf8')
  } catch {
    // No config file: the defaults stand.
  }
  const problem = text === null ? null : configProblem(text)
  if (problem !== null) throw new BrokenConfig(`The worker board's settings file ${file} is broken: ${problem}. Fix it and start the board again.`)
  const config = parseConfig(text ?? '', env)
  // B135: the app's list of chats and its usage file, where the app keeps them on this system, when not set.
  let raw = {}
  try {
    raw = JSON.parse((text ?? '{}').replace(/^\uFEFF/, '')) ?? {}
  } catch {
    // A file that is no JSON was refused above.
  }
  const isSet = key => typeof raw[key] === 'string' && raw[key].trim() !== ''
  if (!isSet('appSessions') || !isSet('usageHistory')) {
    const found = await appFolder(env, platform)
    if (found !== null) {
      if (!isSet('appSessions')) config.appSessions = join(found, 'claude-code-sessions')
      if (!isSet('usageHistory')) config.usageHistory = join(found, 'plan-usage-history.json')
      config.appFolder = found
    }
  }
  return config
}
