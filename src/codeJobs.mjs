// B767 (the person, 2026-10-28: "is this clear for new users of the worker board for new pc's?", then "Yes, build it"):
// the setup check. Which of the main chat's routine jobs run by code on this PC (B753 wake, start and resume; B755 model
// and effort; B766 restarts and new workers; B768 the limits), and why not where one does not. The truth is what the running chats'
// Workers mod reports with each claim of the hands (its `can`, from the app's own verdict); the settings files and the
// stored start-worker task's folder say what is missing. Allow writes the missing tool rules into the project's own
// `.claude/settings.local.json`, on the person's click (a chat may not change its own permissions: the app refuses it).

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { startTaskIds } from './hands.mjs'

/** The jobs, in the order the page lists them, each with the app tools its code needs allowed with no question. */
export const CODE_JOBS = [
  { key: 'wake', title: 'Wake, start and resume chats', tools: [] },
  { key: 'set', title: 'Model and effort per step', tools: ['mcp__ccd_session_mgmt__set_session_model', 'mcp__ccd_session_mgmt__set_session_effort'] },
  { key: 'restart', title: 'Restart a worker for a new mod', tools: ['mcp__ccd_session_mgmt__archive_session', 'mcp__ccd_session_mgmt__unarchive_session', 'mcp__ccd_session_mgmt__list_sessions'] },
  { key: 'spawn', title: 'Start a new worker', tools: ['mcp__scheduled-tasks__update_scheduled_task', 'mcp__scheduled-tasks__run_scheduled_task'] },
  // B768: the plan's limits, looked up when the board's newest reading is ten minutes old.
  { key: 'usage', title: 'Read your usage limits', tools: ['mcp__ccd_session_mgmt__get_usage'] },
]
/** A chat's claim of the hands counts this long: they come every 20 s while it runs. */
export const CLAIM_MS = 2 * 60_000

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)

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
 * What the page shows: `{ rows: [{ key, title, byCode, why }], missing, needsTask, checked }`. `claims` the chats'
 * claims by name (`{ can, at }`), `allowed` the allow rules found (`allowedIn`), `tasks` the stored start-worker tasks
 * found, `spawnFail` the last new worker that failed (`{ at, why }`, or null). A job runs by code when a chat that claimed
 * in the last CLAIM_MS may do it (a new worker also needs a stored task and no failure since). `missing` the tools to
 * allow for the jobs that do not; `checked` the newest claim's chat and time.
 */
export function codeJobsView({ claims = new Map(), allowed = new Set(), tasks = [], spawnFail = null, now }) {
  const recent = [...claims].filter(([, claim]) => Number.isFinite(claim?.at) && now - claim.at < CLAIM_MS)
  const newest = recent.reduce((best, one) => (best === null || one[1].at > best[1].at ? one : best), null)
  const missing = []
  const rows = CODE_JOBS.map(job => {
    if (job.key === 'wake') return { key: job.key, title: job.title, byCode: recent.length > 0, why: recent.length > 0 ? null : 'no chat with the Workers mod runs now' }
    const lacking = job.tools.filter(tool => !allowed.has(tool))
    const may = recent.some(([, claim]) => Array.isArray(claim.can) && claim.can.includes(job.key))
    let why = null
    if (job.key === 'spawn' && tasks.length === 0) why = 'no stored start-worker task on this PC'
    else if (job.key === 'spawn' && spawnFail !== null && may) why = `the last try failed: ${spawnFail.why}`
    else if (may) why = null
    else if (lacking.length > 0) why = 'not allowed yet'
    else if (recent.length === 0) why = 'no chat with the Workers mod runs now'
    else why = 'the running chats have an older Workers mod; their next restart brings the new one'
    if (why !== null) missing.push(...lacking)
    return { key: job.key, title: job.title, byCode: why === null, why }
  })
  return { rows, missing: [...new Set(missing)], needsTask: tasks.length === 0, checked: newest === null ? null : { chat: newest[0], at: newest[1].at } }
}

/**
 * The line the person pastes into any chat of the project, in a turn they type, to make the stored start-worker task
 * (only a chat can make it, and its Auto mode is saved with the task only from a turn the person typed).
 */
export function taskWords({ folder, prefix, board }) {
  const [, plain] = startTaskIds(folder)
  const text = join(board, 'mods', 'folder-branches', 'start-worker-task.md')
  return `Make the worker board's stored start-worker task: call mcp__scheduled-tasks__create_scheduled_task with no schedule, taskId "${plain}" (when the app says that id is taken, the one it names), notifyOnCompletion false, title "${prefix}Worker 1", description "Starts one worker chat of the worker board", and as prompt the text under "The task's text" in ${text}. Then say in one line that it is made.`
}

const FILES = { readFile, writeFile, mkdir, stat }

/** What the setup check reads from this PC: `{ allowed, tasks }`, the allow rules and the stored tasks' ids found. */
export async function readCodeJobs({ project, folder, home = homedir(), fs = FILES }) {
  const read = path => fs.readFile(path, 'utf8').catch(() => '')
  const texts = await Promise.all([join(home, '.claude', 'settings.json'), join(project, '.claude', 'settings.json'), join(project, '.claude', 'settings.local.json')].map(read))
  const ids = startTaskIds(folder)
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
