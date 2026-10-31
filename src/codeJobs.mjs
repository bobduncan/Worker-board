// B767 (the person, 2026-10-28: "is this clear for new users of the worker board for new pc's?", then "Yes, build it"):
// the setup check. Which of the main chat's routine jobs run by code on this PC (B753 wake, start and resume; B755 model
// and effort; B766 restarts and new workers; B768 the limits), and why not where one does not. The truth is what the running chats'
// Workers mod reports with each claim of the hands (its `can`, from the app's own verdict); the settings files and the
// stored start-worker task's folder say what is missing. Allow writes the missing tool rules into the project's own
// `.claude/settings.local.json`, on the person's click (a chat may not change its own permissions: the app refuses it).
// T14 (2026-10-30): the wake row needs the send-message tool allowed too wherever the chats run in Auto mode.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { maySend, startTaskIds, workerTaskIds } from './hands.mjs'

/** The jobs, in the order the page lists them, each with the app tools its code needs allowed with no question. */
export const CODE_JOBS = [
  // T14: a chat in Auto mode may send by code only once an allow rule names the send-message tool (`maySend`).
  { key: 'wake', title: 'Wake, start and resume chats', tools: ['mcp__ccd_session_mgmt__send_message'] },
  { key: 'set', title: 'Model and effort per step', tools: ['mcp__ccd_session_mgmt__set_session_model', 'mcp__ccd_session_mgmt__set_session_effort'] },
  { key: 'restart', title: 'Restart a worker for a new mod, archive replaced chats', tools: ['mcp__ccd_session_mgmt__archive_session', 'mcp__ccd_session_mgmt__unarchive_session', 'mcp__ccd_session_mgmt__list_sessions'] },
  { key: 'spawn', title: 'Start a new worker', tools: ['mcp__scheduled-tasks__update_scheduled_task', 'mcp__scheduled-tasks__run_scheduled_task'] },
  // B768: the plan's limits, looked up when the board's newest reading is ten minutes old. The app allows its own usage
  // tool with no rule of the person's (seen 2026-10-28: no settings file names it), so nothing is missing for it.
  { key: 'usage', title: 'Read your usage limits', tools: [] },
  // The person, 2026-10-30 (a worker asked approval to start the game: "ensure its a generic permission also in the setup
  // guide"): your own preview of the game (the app's built-in browser, from the project's .claude/launch.json) starts
  // with no popup only once these are allowed. B814: the workers do not use it; each starts its test server as a
  // plain background command on a port of its own. `settingsOnly`: the settings files alone say whether it is (no
  // chat's claim reports it).
  { key: 'preview', title: 'Start your own game preview with no popup', tools: ['mcp__Claude_Browser__preview_start', 'mcp__Claude_Browser__preview_stop', 'mcp__Claude_Browser__preview_list', 'mcp__Claude_Browser__preview_logs'], settingsOnly: true },
]
/** A chat's claim of the hands counts this long: they come every 20 s while it runs. */
export const CLAIM_MS = 2 * 60_000
/** T14: why the wake row is not by itself while chats run but none may send (the page shows "needs your OK"). */
export const SEND_WHY = 'chats in Auto mode may not send messages until the project allows mcp__ccd_session_mgmt__send_message'
/** T14: the same once the rule is there: the running chats' mods ask the app again within 10 min (the mod's CAN_SET_MS). */
export const SEND_SOON = 'allowed: the running chats see it within ten minutes'

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)

/** T12: the worker slots that have a routine of their own: 1 to `maxWorkers` (5 when it is no whole number from 1). */
const slotsOf = maxWorkers => Array.from({ length: Number.isInteger(maxWorkers) && maxWorkers >= 1 ? maxWorkers : 5 }, (_, at) => at + 1)

/**
 * T12 (the person, 2026-10-28: every worker its own routine): the worker slots, 1 to `maxWorkers`, that still need a routine
 * of their own, from the stored tasks' ids (`tasks`) of the project's `folder`. A PC that has the shared start-worker task
 * and no routine of a worker's own goes on with it (the fallback): none is missing. A PC with none stored needs all; one
 * with some routines needs the others, whatever the shared task covers.
 */
export function missingRoutines({ tasks = [], folder = '', maxWorkers }) {
  const slots = slotsOf(maxWorkers)
  const lacking = slots.filter(n => !workerTaskIds(folder, n).some(id => tasks.includes(id)))
  return lacking.length === slots.length && tasks.length > 0 ? [] : lacking
}

/** The allow rules of the settings files' texts (user, project, project-local), as one set; a text that is no JSON gives none. */
export function allowedIn(texts) {
  const allowed = new Set()
  for (const text of texts) {
    let read
    try {
      read = JSON.parse(text ?? '')
    } catch {
      continue
    }
    const allow = isRecord(read) && isRecord(read.permissions) && Array.isArray(read.permissions.allow) ? read.permissions.allow : []
    for (const rule of allow) if (typeof rule === 'string') allowed.add(rule)
  }
  return allowed
}

/**
 * The settings text with `tools` added to its allow rules, the rest kept: `{ ok, text, added }`. An empty or missing
 * file starts as `{}`; one that is no JSON object is left alone (`ok` false, with why).
 */
export function withAllowRules(text, tools) {
  let read = {}
  if (typeof text === 'string' && text.trim() !== '') {
    try {
      read = JSON.parse(text)
    } catch {
      return { ok: false, why: 'the project\'s settings.local.json is no JSON: fix it first' }
    }
    if (!isRecord(read)) return { ok: false, why: 'the project\'s settings.local.json is no JSON object: fix it first' }
  }
  const permissions = isRecord(read.permissions) ? read.permissions : {}
  const allow = Array.isArray(permissions.allow) ? [...permissions.allow] : []
  const added = tools.filter(tool => !allow.includes(tool))
  if (added.length === 0) return { ok: true, text, added }
  return { ok: true, text: `${JSON.stringify({ ...read, permissions: { ...permissions, allow: [...allow, ...added] } }, null, 2)}\n`, added }
}

/**
 * What the page shows: `{ rows: [{ key, title, byCode, why }], missing, needsTask, missingRoutines, checked }`. `claims` the
 * chats' claims by name (`{ can, at }`), `allowed` the allow rules found (`allowedIn`), `tasks` the stored start-worker
 * tasks found (T12: the shared one and a worker's own routines, of `folder`, one per worker up to `maxWorkers`),
 * `spawnFail` the last new worker that failed (`{ at, why }`, or null). A job runs by code when a chat that claimed in the
 * last CLAIM_MS may do it (a new worker also needs a stored task and no failure since; T12: and a routine for every
 * worker slot, which else the row names: "needs routines for Worker 4, 5", `missingRoutines` the slots, also what the
 * pasted line makes; `needsTask` is true while one is missing). `missing` the tools to allow for the jobs that do not;
 * `checked` the newest claim's chat and time. T14: the wake row by itself only while a chat that may send claimed
 * (`maySend`, the claims' `{ can, mod }`); else, while chats run, SEND_WHY (the send-message tool missing) or SEND_SOON.
 */
export function codeJobsView({ claims = new Map(), allowed = new Set(), tasks = [], spawnFail = null, folder = '', maxWorkers, now }) {
  const recent = [...claims].filter(([, claim]) => Number.isFinite(claim?.at) && now - claim.at < CLAIM_MS)
  const newest = recent.reduce((best, one) => (best === null || one[1].at > best[1].at ? one : best), null)
  const missing = []
  const absent = missingRoutines({ tasks, folder, maxWorkers })
  // Some routines stored, not all: the shared task would still start the others, but each worker is to have its own.
  const fewRoutines = tasks.length > 0 && absent.length > 0 ? `needs routines for Worker ${absent.join(', ')}` : null
  const rows = CODE_JOBS.map(job => {
    const lacking = job.tools.filter(tool => !allowed.has(tool))
    // T14: by itself only while a chat that may send runs (`maySend`); while only chats that may not run (Auto mode
    // without the rule), the send-message tool is what Allow adds.
    if (job.key === 'wake') {
      let why = null
      if (recent.length === 0) why = 'no chat with the Workers mod runs now'
      else if (!recent.some(([, claim]) => maySend(claim))) why = lacking.length > 0 ? SEND_WHY : SEND_SOON
      if (why === SEND_WHY) missing.push(...lacking)
      return { key: job.key, title: job.title, byCode: why === null, why }
    }
    if (job.settingsOnly === true) {
      if (lacking.length > 0) missing.push(...lacking)
      return { key: job.key, title: job.title, byCode: lacking.length === 0, why: lacking.length === 0 ? null : 'not allowed yet' }
    }
    const may = recent.some(([, claim]) => Array.isArray(claim.can) && claim.can.includes(job.key))
    let why = null
    if (job.key === 'spawn' && tasks.length === 0) why = 'no stored start-worker task on this PC'
    else if (job.key === 'spawn' && spawnFail !== null && may) why = `the last try failed: ${spawnFail.why}`
    else if (may) why = job.key === 'spawn' ? fewRoutines : null
    else if (lacking.length > 0) why = 'not allowed yet'
    else if (recent.length === 0) why = 'no chat with the Workers mod runs now'
    else why = 'the running chats have an older Workers mod; their next restart brings the new one'
    if (why !== null && why !== fewRoutines) missing.push(...lacking)
    return { key: job.key, title: job.title, byCode: why === null, why }
  })
  return { rows, missing: [...new Set(missing)], needsTask: absent.length > 0, missingRoutines: absent, checked: newest === null ? null : { chat: newest[0], at: newest[1].at } }
}

/**
 * The line the person pastes into any chat of the project, in a turn they type, to make the stored routine of each worker
 * in `slots` (T12: Worker N's own, `<folder>-worker-N`, titled "<prefix>Worker N"; only a chat can make it, and its Auto
 * mode is saved with the routine only from a turn the person typed). The page cuts the closing sentence off where the line
 * goes into the main chat's first words.
 */
export function taskWords({ folder, prefix, board, slots = [1] }) {
  const text = join(board, 'mods', 'workers', 'start-worker-task.md')
  const each = slots.map(n => `taskId "${workerTaskIds(folder, n)[0]}", title "${prefix}Worker ${n}", description "Starts ${prefix}Worker ${n} of the worker board"`)
  return `Make the worker board's stored routines, one for each worker: call mcp__scheduled-tasks__create_scheduled_task once for each of these, ${each.join('; ')}, each with no schedule, notifyOnCompletion false (when the app says a taskId is taken, use the one it names) and as prompt the text under "The task's text" in ${text}. Then say in one line that they are made.`
}

const FILES = { readFile, writeFile, mkdir, stat }

/**
 * What the setup check reads from this PC: `{ allowed, tasks }`, the allow rules and the stored tasks' ids found (T12: the
 * shared task's and each worker's own routine, one per slot up to `maxWorkers`).
 */
export async function readCodeJobs({ project, folder, maxWorkers, home = homedir(), fs = FILES }) {
  const read = path => fs.readFile(path, 'utf8').catch(() => '')
  const texts = await Promise.all([join(home, '.claude', 'settings.json'), join(project, '.claude', 'settings.json'), join(project, '.claude', 'settings.local.json')].map(read))
  const ids = [...startTaskIds(folder), ...slotsOf(maxWorkers).flatMap(n => workerTaskIds(folder, n))]
  const there = await Promise.all(ids.map(id => fs.stat(join(home, '.claude', 'scheduled-tasks', id, 'SKILL.md')).then(found => found.isFile(), () => false)))
  return { allowed: allowedIn(texts), tasks: ids.filter((id, at) => there[at]) }
}

/** Allow: adds `tools` to the project's `.claude/settings.local.json`, made when missing: `{ ok, added }` or why not. */
export async function allowCodeJobs({ project, tools, fs = FILES }) {
  const file = join(project, '.claude', 'settings.local.json')
  const text = await fs.readFile(file, 'utf8').catch(error => (error?.code === 'ENOENT' ? '' : null))
  if (text === null) return { ok: false, why: 'the project\'s settings.local.json cannot be read' }
  const next = withAllowRules(text, tools)
  if (!next.ok || next.added.length === 0) return next
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, next.text, 'utf8')
  return { ok: true, added: next.added }
}
