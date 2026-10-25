// The paths that differ per machine, from config.json next to the server.

import { constants } from 'node:fs'
import { access, copyFile, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { EFFORTS, MODELS, modelIds } from './work/effort.mjs'
import { parseRoutingPolicy } from './work/routing/policy.mjs'
import { ASSET_KINDS, DEFAULT_PROVIDERS, PROVIDERS } from './providers/index.mjs'

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

/**
 * The supervisor (spec 2026-10-24): the thresholds of its watch rules, in minutes, and how many times the same repair
 * may come in a day before it is reported (src/supervisor/rules/watch.mjs). config.json's `supervisor` sets any of them.
 */
export const SUPERVISOR_DEFAULTS = Object.freeze({
  /** A worker "unknown" for longer than this. */
  unknownMinutes: 10,
  /** A worker "suspended" for this long after its limit is back (its reset passed, or the usage shows room). */
  suspendedMinutes: 10,
  /** Redesign Part 2: a ready task waits while a worker is free, for longer than this (the rule ready-while-free). */
  idleMinutes: 10,
  /** A step in progress whose worker has not run for longer than this. */
  notRunningMinutes: 30,
  /** An opus step that waits for its worker to run on Opus for longer than this. */
  opusWaitMinutes: 15,
  /** A word to a chat not delivered for longer than this. */
  undeliveredMinutes: 10,
  /** The same repair this many times or more in a day. */
  repairsPerDay: 3,
  /** B543: a step in review with no result check filed for longer than this. */
  reviewMinutes: 60,
  /** B572: a step in progress longer than this with no checkpoint within it. */
  checkpointMinutes: 120,
  /** B572: a step in progress whose last checkpoint's next action is to report, written longer ago than this. */
  reportMinutes: 30,
  /** B576: a worker that runs another model or effort than its step wants this long after the take, not switched. */
  switchMinutes: 10,
  /** B547: a worker not cleared this long after it reported a step. */
  notClearedMinutes: 10,
  /** B601: a limit whose newest reading is older than this, while the chats stand still or work (the rule old-limit-reading). */
  oldReadingMinutes: 30,
  /** B632 (the fix of X55, X56): an old reading raises its incident only when it is still older than this, after the supervisor chat looked the limits up once past `oldReadingMinutes`. */
  oldReadingIncidentMinutes: 60,
})

export const DEFAULTS = {
  routing: parseRoutingPolicy(),
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
  /**
   * Redesign Part 1: a chat whose Workers mod reports its turn state and has sent no report for this long is shown
   * as unknown (off when the app archived it). The mod reports every 5 seconds: at least 5.
   */
  unknownAfterSeconds: 30,
  /** The review of chat-reports (principle 2): a chat whose reports stay silent this long is "Not running". */
  offAfterMinutes: 5,
  /**
   * Redesign Part 2 (2026-10-25): a worker given a task and not taking it within this many minutes gets it taken back,
   * and shows stuck when it sat idle (principle 2). At least 1.
   */
  takeWithinMinutes: 2,
  /**
   * Redesign Part 2: a task that waits on one a worker finished is kept for that worker this many minutes. 0 (the
   * review of 2026-10-25): a preference only, it goes to that worker when it is idle at the give, else to anyone.
   */
  followUpMinutes: 0,
  /**
   * Redesign Part 2, the review: a give whose line has not gone this many minutes after it (held for the worker's model,
   * a clear, a mod restart, or its chat went off) goes back on the list, not stuck. At least takeWithinMinutes.
   */
  heldGiveMinutes: 20,
  // Redesign Part 2: `maxWorkers`, how many workers the board has the main chat run at most, has no default: without
  // it the board asks for no worker. Any number (the person: "weither its 2 workers or 10").
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
  /**
   * B359: whether a rebuild the goal guard's evaluation calls for goes ahead without the person's yes. Off at first
   * (the person, Q130: "the first rebuilds come to you, you flip it on once you trust them").
   */
  approveRebuilds: false,
  /**
   * B360: where the recaps of finished work reach the person: "now" (each in Needs your attention as it comes) or
   * "daily" (gathered under the partner's daily note on the Focus page). The board's settings panel sets it (B361).
   */
  botherMe: 'now',
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
  // Plan (2026-10-19): the product plan, the eight answers P1 to P8 (roles/partner.md, "The plan interview"), in the
  // game's repository; the Plan part on the Focus page reads it.
  productPlan: 'docs/product-plan.md',
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
  /**
   * B354: the project's kinds of work, each `{ kind, done, reference, look? }`: its name, its definition of done and its
   * reference folder, paths inside the project written with /; `look: true` (B451) marks a kind whose result the player
   * sees: a step that names it never gets "none" as its standard. A refined step that names a kind carries its Standard
   * line (src/work/standard.mjs). The board knows no kind of its own.
   */
  kinds: [],
  /**
   * Model per step (the token-saving plan, step 2): the app's model id of both model families a step may name, as the
   * app's model picker lists them, `{ "sonnet": "claude-...", "opus": "claude-..." }`. None by default: without both the
   * board has the main chat set a worker's effort only (B468), and says so on top (`modelsProblem`) when they are
   * given otherwise.
   */
  models: {},
  modelsProblem: null,
  /** Model per step: what a worker runs at between steps, a family of `models` and an effort level of the app's. */
  usualModel: 'sonnet',
  usualEffort: 'medium',
  /** The supervisor's thresholds (SUPERVISOR_DEFAULTS). */
  supervisor: SUPERVISOR_DEFAULTS,
  /**
   * The supervisor's Part 2: how often, in minutes, the board wakes the supervisor's chat for a sweep while work runs
   * (0: no sweep by the clock, only on Check now). Lower it to save tokens.
   */
  supervisorSweepMinutes: 10,
  /**
   * T9.3 part 1 (spec 2026-10-25): who provides each kind of asset, `{ provider, folder? }` per kind (src/providers). The
   * setting `providers` is an object from kind to a provider's name, or to `{ provider, folder? }`; `readProviders`.
   */
  providers: DEFAULT_PROVIDERS,
}

/** B354: one kind of work of the settings, its paths inside the project. */
const isKind = one => one !== null && typeof one === 'object' && !Array.isArray(one)
  && typeof one.kind === 'string' && /^[A-Za-z][A-Za-z0-9 -]{0,39}$/.test(one.kind.trim())
  && (one.look === undefined || typeof one.look === 'boolean')
  && ['done', 'reference'].every(key => typeof one[key] === 'string' && INSIDE.test(one[key].trim()) && !one[key].trim().split('/').includes('.'))
const kindOf = one => ({ kind: one.kind.trim().replace(/\s+/g, ' '), done: one.done.trim(), reference: one.reference.trim(), ...(one.look === true ? { look: true } : {}) })
/** B354: the kinds as a list, each once (by name, any case). */
const isKinds = value => Array.isArray(value) && value.every(isKind) && new Set(value.map(one => kindOf(one).kind.toLowerCase())).size === value.length

/** A setting's value as a short piece of text for a line that says what is wrong with it. */
const shown = value => (JSON.stringify(value) ?? String(value)).slice(0, 60)

/**
 * T9.3 part 1: the settings' `providers`, an object from asset kind to a provider's name, or to `{ provider, folder? }`
 * (`folder`: only for a provider that has a library folder, a path inside the project written with /; its own default
 * when not given). `providers`: `{ provider, folder? }` for every kind, a kind the setting does not name, or names
 * wrongly, at its default; `problem`: the first thing wrong as one line, or null.
 */
function readProviders(value) {
  const providers = { ...DEFAULT_PROVIDERS }
  if (value === undefined) return { providers, problem: null }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { providers, problem: `"providers" must be an object from asset kind to provider, such as { "visual": "codex" }, not ${shown(value)}` }
  }
  let problem = null
  for (const [kind, given] of Object.entries(value)) {
    const at = `"providers.${kind}"`
    const refuse = line => { problem ??= line }
    if (!ASSET_KINDS.includes(kind)) {
      refuse(`${at} is no asset kind; the kinds are ${ASSET_KINDS.join(', ')}`)
      continue
    }
    const entry = typeof given === 'string' ? { provider: given } : given
    const isEntry = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    const name = isEntry && typeof entry.provider === 'string' ? entry.provider.trim() : undefined
    const provider = name === undefined ? undefined : PROVIDERS[name]
    if (provider === undefined) {
      refuse(`${at} must name a provider the board knows (${Object.keys(PROVIDERS).join(', ')}), not ${shown(isEntry ? entry.provider : given)}`)
      continue
    }
    if (!provider.kinds.includes(kind)) {
      refuse(`${at} is set to "${name}", which serves ${provider.kinds.join(', ')}, not ${kind}`)
      continue
    }
    if (provider.folder === undefined) {
      if (entry.folder !== undefined) refuse(`${at} sets a folder, but "${name}" has none`)
      else providers[kind] = { provider: name }
      continue
    }
    const folder = entry.folder === undefined ? provider.folder : entry.folder
    if (!(typeof folder === 'string' && INSIDE.test(folder.trim()) && !folder.trim().split('/').includes('.'))) {
      refuse(`"providers.${kind}.folder" must be a path inside the project, written with /, not ${shown(folder)}`)
      continue
    }
    providers[kind] = { provider: name, folder: folder.trim() }
  }
  return { providers, problem }
}

/** Focus 1: the Focus tab's parts, in the order of its bar (public/board.js ADVISOR_PANES). */
const ADVISOR_PARTS = ['focus', 'way', 'goals', 'brainstorm', 'plan', 'suggestions', 'refine', 'chat']
const isAdvisorParts = value => Array.isArray(value) && value.every(one => ADVISOR_PARTS.includes(one))

/** B311: the levels of "CPU for the chats". */
const CPU_LEVELS = ['off', 'gentle', 'strong']
/** B360: the settings of botherMe. */
const BOTHER = ['now', 'daily']

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

const MAP_KEYS = ['goals', 'brainstorms', 'goalsHistory']

/** A path as it really is (junctions and links followed), also one not there yet: its nearest folder that is, then the rest. */
async function realOf(path) {
  try {
    return await realpath(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(await realOf(parent), basename(path))
  }
}
/** Whether `path` is `folder` or inside it, by real paths, letters' case aside on Windows. */
const within = (path, folder) => {
  const to = relative(folder.toLowerCase(), path.toLowerCase())
  return to === '' || (!to.startsWith('..') && !isAbsolute(to))
}

/**
 * Focus 2, the review's findings: `isOwnMap` by real paths. The copy's `goals`, `brainstorms` and `goalsHistory` are
 * each a whole path outside the project also when junctions are followed, and none is (or lies inside, or holds) the
 * live board's own: the map the main checkout's config.json names (`main`: its folder), when it can be read.
 */
export async function ownMapNow(config, { main = null } = {}) {
  if (!isOwnMap(config)) return false
  const project = await realOf(config.project)
  const mine = await Promise.all(MAP_KEYS.map(key => realOf(config[key])))
  if (mine.some(path => within(path, project))) return false
  if (main === null) return true
  let live
  try {
    live = parseConfig(await readFile(join(main, 'config.json'), 'utf8'), process.env)
  } catch {
    return true
  }
  if (typeof live.project !== 'string' || live.project === '') return true
  const theirs = await Promise.all(MAP_KEYS.map(key => realOf(projectFile(live, key))))
  return !mine.some(path => theirs.some(other => within(path, other) || within(other, path)))
}

const PATHS = ['project', 'gameRepo', 'appSessions', 'transcripts']
// The paths inside the project or the game's repository, written with /.
const PROJECT_PATHS = ['backlog', 'gamePlan', 'productPlan', 'advisorDecisions', 'designKinds']
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
  if (Number.isFinite(raw.unknownAfterSeconds) && raw.unknownAfterSeconds >= 5) config.unknownAfterSeconds = raw.unknownAfterSeconds
  if (Number.isFinite(raw.offAfterMinutes) && raw.offAfterMinutes >= 1) config.offAfterMinutes = raw.offAfterMinutes
  // Redesign Part 2: the hand-out's settings; one that is not right is left at its default (maxWorkers: absent).
  if (Number.isInteger(raw.maxWorkers) && raw.maxWorkers >= 1) config.maxWorkers = raw.maxWorkers
  if (Number.isFinite(raw.takeWithinMinutes) && raw.takeWithinMinutes >= 1) config.takeWithinMinutes = raw.takeWithinMinutes
  if (Number.isFinite(raw.followUpMinutes) && raw.followUpMinutes >= 0) config.followUpMinutes = raw.followUpMinutes
  if (Number.isFinite(raw.heldGiveMinutes) && raw.heldGiveMinutes >= 1) config.heldGiveMinutes = raw.heldGiveMinutes
  // 2026-10-25: true hands out tasks beyond the fixes, the focus goal's and the pinned ones too (oldest first).
  if (typeof raw.handOutBeyondFocus === 'boolean') config.handOutBeyondFocus = raw.handOutBeyondFocus
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
  if (typeof raw.approveRebuilds === 'boolean') config.approveRebuilds = raw.approveRebuilds
  if (typeof raw.botherMe === 'string' && BOTHER.includes(raw.botherMe.trim())) config.botherMe = raw.botherMe.trim()
  if (Array.isArray(raw.runGame) && raw.runGame.every(word => typeof word === 'string' && word !== '')) config.runGame = [...raw.runGame]
  config.morningSkipPercent = Math.min(config.morningSkipPercent, 100)
  if (isAdvisorParts(raw.advisorParts) && raw.advisorParts.length > 0) config.advisorParts = [...new Set(raw.advisorParts)]
  if (typeof raw.cpuLimit === 'string' && CPU_LEVELS.includes(raw.cpuLimit.trim().toLowerCase())) config.cpuLimit = raw.cpuLimit.trim().toLowerCase()
  // B354: the kinds that are right, each once.
  if (Array.isArray(raw.kinds)) {
    const seen = new Set()
    config.kinds = raw.kinds.filter(isKind).map(kindOf).filter(one => !seen.has(one.kind.toLowerCase()) && seen.add(one.kind.toLowerCase()))
  }
  // Model per step: the model ids of the app's picker (both, or the effort alone with a warning on top), and the
  // workers' usual setting between steps.
  const ids = modelIds(raw.models)
  config.models = ids.models
  config.modelsProblem = ids.problem
  if (typeof raw.usualModel === 'string' && MODELS.includes(raw.usualModel.trim().toLowerCase())) config.usualModel = raw.usualModel.trim().toLowerCase()
  if (typeof raw.usualEffort === 'string' && EFFORTS.includes(raw.usualEffort.trim().toLowerCase())) config.usualEffort = raw.usualEffort.trim().toLowerCase()
  config.routing = parseRoutingPolicy(raw.routing)
  config.providers = readProviders(raw.providers).providers
  // The supervisor: each threshold given as a number above 0 replaces its default; others are left alone.
  const given = raw.supervisor !== null && typeof raw.supervisor === 'object' && !Array.isArray(raw.supervisor) ? raw.supervisor : {}
  config.supervisor = Object.freeze(Object.fromEntries(Object.entries(SUPERVISOR_DEFAULTS)
    .map(([key, value]) => [key, Number.isFinite(given[key]) && given[key] > 0 ? given[key] : value])))
  // Part 2: a number of minutes, 0 or more (0: no sweep by the clock).
  if (Number.isFinite(raw.supervisorSweepMinutes) && raw.supervisorSweepMinutes >= 0) config.supervisorSweepMinutes = raw.supervisorSweepMinutes
  // Gap 4: the local time the supervisor's section counts from; absent unless set right ("" is none).
  if (countFromMs(raw.supervisorCountFrom) !== null) config.supervisorCountFrom = raw.supervisorCountFrom.trim()
  return config
}

/**
 * Gap 4, the person (2026-10-25): "i want the number to be 0 since the redesign so it's clear what it finds". The
 * setting `supervisorCountFrom`, "YYYY-MM-DD HH:MM" in local time, as milliseconds; null for anything else (a date that
 * does not exist, too).
 */
export function countFromMs(text) {
  const hit = typeof text === 'string' ? text.trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/) : null
  if (hit === null) return null
  const [year, month, day, hour, minute] = hit.slice(1).map(Number)
  const at = new Date(year, month - 1, day, hour, minute)
  return at.getFullYear() === year && at.getMonth() === month - 1 && at.getDate() === day && at.getHours() === hour && at.getMinutes() === minute ? at.getTime() : null
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
  if (has('usualModel') && !(typeof raw.usualModel === 'string' && MODELS.includes(raw.usualModel.trim().toLowerCase()))) return wrong('usualModel', MODELS.map(one => `"${one}"`).join(' or '))
  if (has('usualEffort') && !(typeof raw.usualEffort === 'string' && EFFORTS.includes(raw.usualEffort.trim().toLowerCase()))) return wrong('usualEffort', `one of ${EFFORTS.map(one => `"${one}"`).join(', ')}`)
  if (has('supervisorSweepMinutes') && !(Number.isFinite(raw.supervisorSweepMinutes) && raw.supervisorSweepMinutes >= 0)) return wrong('supervisorSweepMinutes', 'a number of minutes, 0 or more (0: no sweep by the clock)')
  if (has('supervisorCountFrom') && !(raw.supervisorCountFrom === '' || countFromMs(raw.supervisorCountFrom) !== null)) return wrong('supervisorCountFrom', 'a local time like "2026-10-25 14:00", or "" for none')
  if (has('supervisor')) {
    const given = raw.supervisor
    if (given === null || typeof given !== 'object' || Array.isArray(given)) return wrong('supervisor', `an object of numbers above 0: ${Object.keys(SUPERVISOR_DEFAULTS).join(', ')}`)
    for (const key of Object.keys(SUPERVISOR_DEFAULTS)) {
      if (Object.hasOwn(given, key) && !(Number.isFinite(given[key]) && given[key] > 0)) return `"supervisor.${key}" must be a number above 0, not ${JSON.stringify(given[key]).slice(0, 60)}`
    }
  }
  if (has('providers')) {
    const { problem } = readProviders(raw.providers)
    if (problem !== null) return problem
  }
  if (has('kinds') && !isKinds(raw.kinds)) return wrong('kinds', 'a list of { "kind", "done", "reference", "look"? }: a kind\'s name, its definition of done and its reference folder, paths inside the project written with /, "look": true for a kind the player sees, each kind once')
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
