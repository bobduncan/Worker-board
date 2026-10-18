// The paths that differ per machine, from config.json next to the server.

import { constants } from 'node:fs'
import { access, copyFile, readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

/**
 * B300: the work store's reconciler (src/work/reconcile.mjs). A step held by a chat that is not running is flagged after
 * the grace time; a blocking ask that waited longer than the ask time stands first under Needs your attention.
 */
export const GRACE_MS = 10 * 60_000
export const ASK_MS = 60 * 60_000
/**
 * B308: a worker that holds a step, has ended its turn with nothing running and filed no ask, for longer than this, is
 * a hint under Needs your attention: it may wait for the person.
 */
export const IDLE_HOLD_MS = 5 * 60_000

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
   * B173: what one project sets for the Advisor (its job is the board's `roles/partner.md`). The backlog, in the
   * project; the game plan, the Advisor's decisions and the documents it reads first, in the game's repository; the
   * backlog group its suggestions stand in; and its rounds: the morning one at this time ("" leaves it out, and so
   * does a 5-hour limit above `morningSkipPercent`), the weekly one right after the weekly limit resets.
   */
  backlog: '.claude/backlog.md',
  // B255: the goal map and, later, its brainstorms, the asks' long answers and its daily copy (spec 2026-10-15), all
  // in the project folder.
  goals: '.claude/goals.md',
  brainstorms: '.claude/brainstorms',
  goalAsks: '.claude/goal-asks',
  goalsHistory: '.claude/goals.history',
  /**
   * B296: the work store, one file per item (spec 2026-10-17): a path inside the project, or a whole path of its own
   * (a copy of the board tried beside the person's keeps its store apart that way). B301: the one source of the work;
   * a project gets it with tools/migrate-backlog.mjs (--make-store from a backlog, --init for an empty one).
   */
  work: '.claude/work',
  // The way to the next milestone is part of the goal map since B260 (the setting milestoneMap is gone).
  gamePlan: 'docs/game-plan.md',
  advisorDecisions: 'docs/advisor/decisions.md',
  advisorReadFirst: [],
  advisorSuggestions: 'Advisor suggestions',
  morningRound: '09:00',
  weeklyRound: true,
  morningSkipPercent: 80,
  /**
   * Focus 1 (spec 2026-10-18, section 4): the parts the Focus tab's bar shows, by name, in the bar's own order. The
   * others (way: Next milestone, plan: Game plan, suggestions, refine, chat) are hidden, not deleted: name them here.
   */
  advisorParts: ['focus', 'goals', 'brainstorm'],
  /** B311: the chats' CPU until the person picks one on the board (data/cpu.json): "off", "gentle" or "strong". */
  cpuLimit: 'off',
}

/** Focus 1: the Focus tab's parts, in the order of its bar (public/board.js ADVISOR_PANES). */
const ADVISOR_PARTS = ['focus', 'way', 'goals', 'brainstorm', 'plan', 'suggestions', 'refine', 'chat']
const isAdvisorParts = value => Array.isArray(value) && value.every(one => ADVISOR_PARTS.includes(one))

/** B311: the levels of "CPU for the chats". */
const CPU_LEVELS = ['off', 'gentle', 'strong']

/** A branch's name as git allows it, plainly: letters, digits, "_", ".", "/" and "-", and no "..". */
const BRANCH = /^(?!.*\.\.)[\w][\w./-]{0,120}$/

/** A path inside a folder, written with "/": no way out of it, never absolute. */
const INSIDE = /^(?!.*(?:^|\/)\.\.(?:\/|$))[\w.-]+(?:\/[\w .-]+)*$/

/** B296: the store's folder: inside the project, written with /, or a whole path. */
const isWorkPath = value => typeof value === 'string' && (INSIDE.test(value.trim()) || isAbsolute(value.trim()))

/** B296: the work store's folder, as a whole path. */
export function workFolder(config) {
  return isAbsolute(config.work) ? config.work : join(config.project, ...config.work.split('/'))
}

/**
 * Focus 1: the goal map's paths (`goals`, `brainstorms`, `goalAsks`, `goalsHistory`) as whole paths: inside the project,
 * or a whole path of their own, so a copy of the board tried beside the person's reads its own map, as its work store.
 */
export function projectFile(config, key) {
  const value = config[key]
  return isAbsolute(value) ? value : join(config.project, ...value.split('/'))
}

/** B296: whether the store's folder is a whole path outside the project: a copy's own, which it may write. */
export function isOwnWork(config) {
  if (!isAbsolute(config.work)) return false
  const path = relative(config.project, config.work)
  return path.startsWith('..') || isAbsolute(path)
}

/**
 * Focus 2 (the review of Focus 1): whether the goal map's files (`goals`, `brainstorms`, `goalsHistory`) are each a
 * whole path outside the project: a copy's own map, which a copy of the board may write, as its own work store.
 */
export function isOwnMap(config) {
  return ['goals', 'brainstorms', 'goalsHistory'].every(key => {
    if (typeof config[key] !== 'string' || !isAbsolute(config[key])) return false
    const path = relative(config.project, config[key])
    return path.startsWith('..') || isAbsolute(path)
  })
}

const PATHS = ['project', 'gameRepo', 'appSessions', 'transcripts']
// The paths inside the project or the game's repository, written with /.
const PROJECT_PATHS = ['backlog', 'gamePlan', 'advisorDecisions', 'designKinds']
// Focus 1: the goal map's paths, inside the project or a whole path of their own (a copy's).
const MAP_PATHS = ['goals', 'brainstorms', 'goalAsks', 'goalsHistory']
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
  for (const key of PROJECT_PATHS) {
    if (typeof raw[key] === 'string' && INSIDE.test(raw[key].trim())) config[key] = raw[key].trim()
  }
  for (const key of MAP_PATHS) if (isWorkPath(raw[key])) config[key] = raw[key].trim()
  if (isWorkPath(raw.work)) config.work = raw.work.trim()
  if (Array.isArray(raw.advisorReadFirst)) config.advisorReadFirst = raw.advisorReadFirst.filter(path => typeof path === 'string' && INSIDE.test(path))
  if (typeof raw.advisorSuggestions === 'string' && raw.advisorSuggestions.trim() !== '') config.advisorSuggestions = raw.advisorSuggestions.trim()
  if (typeof raw.morningRound === 'string' && /^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(raw.morningRound.trim())) config.morningRound = raw.morningRound.trim()
  if (typeof raw.weeklyRound === 'boolean') config.weeklyRound = raw.weeklyRound
  if (Array.isArray(raw.runGame) && raw.runGame.every(word => typeof word === 'string' && word !== '')) config.runGame = [...raw.runGame]
  config.morningSkipPercent = Math.min(config.morningSkipPercent, 100)
  if (isAdvisorParts(raw.advisorParts) && raw.advisorParts.length > 0) config.advisorParts = [...new Set(raw.advisorParts)]
  if (typeof raw.cpuLimit === 'string' && CPU_LEVELS.includes(raw.cpuLimit.trim().toLowerCase())) config.cpuLimit = raw.cpuLimit.trim().toLowerCase()
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
  for (const key of PROJECT_PATHS) if (has(key) && !(typeof raw[key] === 'string' && INSIDE.test(raw[key].trim()))) return wrong(key, 'a path inside its folder, written with /')
  if (has('pictureRoots') && !(Array.isArray(raw.pictureRoots) && raw.pictureRoots.length > 0 && raw.pictureRoots.every(one => typeof one === 'string' && /^[\w-][\w.-]*$/.test(one)))) return wrong('pictureRoots', 'a list of one or more plain folder names')
  if (has('advisorReadFirst') && !(Array.isArray(raw.advisorReadFirst) && raw.advisorReadFirst.every(one => typeof one === 'string' && INSIDE.test(one)))) return wrong('advisorReadFirst', 'a list of paths inside the game, written with /')
  for (const key of MAP_PATHS) if (has(key) && !isWorkPath(raw[key])) return wrong(key, 'a path inside its folder written with /, or a whole path of its own')
  if (has('work') && !isWorkPath(raw.work)) return wrong('work', 'a path inside the project written with /, or a whole path of its own')
  if (has('morningRound') &&!(typeof raw.morningRound === 'string' && /^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(raw.morningRound.trim()))) return wrong('morningRound', 'a time like "09:00", or "" for none')
  if (has('weeklyRound') && typeof raw.weeklyRound !== 'boolean') return wrong('weeklyRound', 'true or false')
  if (has('runGame') && !(Array.isArray(raw.runGame) && raw.runGame.every(word => typeof word === 'string' && word !== ''))) return wrong('runGame', 'a list of words, the program first')
  if (has('advisorParts') && !(isAdvisorParts(raw.advisorParts) && raw.advisorParts.length > 0)) return wrong('advisorParts', `a list of one or more of the Focus tab's parts: ${ADVISOR_PARTS.join(', ')}`)
  if (has('cpuLimit') && !(typeof raw.cpuLimit === 'string' && CPU_LEVELS.includes(raw.cpuLimit.trim().toLowerCase()))) return wrong('cpuLimit', '"off", "gentle" or "strong"')
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
 *
 * B273: on 2026-10-17 the Store app moved its folder to `%LOCALAPPDATA%\Claude-Data\<id>`; the folder it left keeps
 * only a marker, `.user-data-left.<id>`. A marker is followed before the folder that holds it, and every folder in
 * Claude-Data is looked at after the usual places.
 */
export async function appFolder(env, platform = process.platform, { list = readdir, there = isFolder } = {}) {
  const byUpper = new Map(Object.entries(env).map(([name, value]) => [name.toUpperCase(), value]))
  const [roaming, local, home] = ['APPDATA', 'LOCALAPPDATA', 'HOME'].map(name => byUpper.get(name) ?? '')
  const places = []
  if (platform === 'win32') {
    const usual = []
    if (roaming !== '') usual.push(join(roaming, 'Claude'))
    if (local !== '') {
      const packages = await list(join(local, 'Packages')).catch(() => [])
      for (const name of packages.filter(one => /^Claude_/i.test(one))) usual.push(join(local, 'Packages', name, 'LocalCache', 'Roaming', 'Claude'))
    }
    const moved = local === '' ? null : join(local, 'Claude-Data')
    for (const place of usual) {
      if (moved !== null) {
        const markers = (await list(place).catch(() => [])).map(name => String(name).match(/^\.user-data-left\.([\w-][\w.-]*)$/)?.[1] ?? null)
        for (const id of markers.filter(one => one !== null && !one.includes('..'))) places.push(join(moved, id))
      }
      places.push(place)
    }
    if (moved !== null) for (const name of await list(moved).catch(() => [])) places.push(join(moved, String(name)))
  } else if (home !== '') places.push(platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude') : join(home, '.config', 'Claude'))
  for (const place of new Set(places)) if (await there(join(place, 'claude-code-sessions'))) return place
  return null
}

/**
 * B273: whether a folder (`isFolder` true) or any file is still there for following the app: only "not there"
 * counts as gone, so a drive that answers late or a refused look never moves the board away from a good folder.
 */
const isNotThere = error => error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
const stillFolder = path => stat(path).then(info => info.isDirectory(), error => !isNotThere(error))
const exists = path => stat(path).then(() => true, error => !isNotThere(error))
/** B273: how long the board waits before it searches again for an app folder it did not find. */
const SEARCH_AGAIN_MS = 60_000

/**
 * B273: when the list of chats the board reads is gone, it searches for the app's folder again and follows it: the
 * list of chats, and the usage file when that is gone too (a usage file of the person's own that is still there
 * stays). `config.appMoved` says from where to where and when, for the page; `to` is null when nothing was found,
 * and then it looks again a minute later. True when it followed.
 */
export async function followApp(config, env = process.env, platform = process.platform, { there = stillFolder, exists: has = exists, find = appFolder, now = Date.now() } = {}) {
  if (config.appSessions !== '' && await there(config.appSessions)) {
    // Back where it was: a note that it was found nowhere is no longer true.
    if (config.appMoved?.to === null) delete config.appMoved
    return false
  }
  if (typeof config.appSearchedAt === 'number' && now - config.appSearchedAt < SEARCH_AGAIN_MS) return false
  config.appSearchedAt = now
  const found = await find(env, platform)
  const sessions = found === null ? null : join(found, 'claude-code-sessions')
  if (sessions === config.appSessions) return false
  if (sessions === null) {
    if (config.appSessions !== '' && config.appMoved?.to !== null) config.appMoved = { from: config.appSessions, to: null, at: now }
    return false
  }
  const from = config.appSessions
  config.appSessions = sessions
  if (!(await has(config.usageHistory))) config.usageHistory = join(found, 'plan-usage-history.json')
  config.appFolder = found
  if (from !== '') config.appMoved = { from, to: found, at: now }
  return true
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
  // B273: a setting that points at a folder that is gone: the search, as when the app moves while the board runs.
  if (isSet('appSessions')) await followApp(config, env, platform)
  return config
}
