// B753: the board's hands in code. The board keeps each start, wake and resume as a job; the Workers mod of any running
// board chat claims them (`HANDS_PATH`), sends each with the app's own send-message tool, by code, with no model turn, and
// says what it sent (`HANDS_DONE_PATH`). Proven on the work login, 2026-10-28: the app's guard skips the mod's prompt and
// turn hooks, but its timers and tool calls run. The pure part; register.tsx runs it on a timer.
//
// B755 (the person, 2026-10-28: "Add the permission so code may set model and effort, and build B755"): a chat whose app
// lets its code set another chat's model and effort (the allow rule for the two tools below, which `$.tool.check` reads)
// says so at its claim and gets those jobs too. The values are checked here once more: an effort the app names, a model id
// of the app's ("claude-..."), never Fable.
//
// B766 (the person, 2026-10-28: "Yes, build it"): likewise a worker's restart for a new mod (close it and reopen it,
// with the board's other chats the close took along) and a new worker (the stored start-worker task renamed and run),
// each claimed only where the app allows its code those tools with no question.

export const HANDS_PATH = '/api/bridge/hands'
export const HANDS_DONE_PATH = '/api/bridge/hands-done'
/** How often a chat asks the board for jobs. */
export const HANDS_MS = 20_000
/** The app's tool that sends a line to another of the person's sessions, and starts it when it does not run. */
export const SEND_TOOL = 'mcp__ccd_session_mgmt__send_message'
/** B755: the app's tools that set another session's model and effort, from its next turn on. */
export const MODEL_TOOL = 'mcp__ccd_session_mgmt__set_session_model'
export const EFFORT_TOOL = 'mcp__ccd_session_mgmt__set_session_effort'
/** B766: the app's tools that close and reopen a session, and list the sessions (archived ones too). */
export const ARCHIVE_TOOL = 'mcp__ccd_session_mgmt__archive_session'
export const UNARCHIVE_TOOL = 'mcp__ccd_session_mgmt__unarchive_session'
export const LIST_TOOL = 'mcp__ccd_session_mgmt__list_sessions'
/** B766: the app's tools that rename a stored task and run it once now (it starts a new chat). */
export const TASK_UPDATE_TOOL = 'mcp__scheduled-tasks__update_scheduled_task'
export const TASK_RUN_TOOL = 'mcp__scheduled-tasks__run_scheduled_task'
/** What a chat may do by code, each with the tools the app must allow for it with no question. */
export const CAN_TOOLS: Record<string, string[]> = {
  set: [MODEL_TOOL, EFFORT_TOOL],
  restart: [ARCHIVE_TOOL, UNARCHIVE_TOOL, LIST_TOOL],
  spawn: [TASK_UPDATE_TOOL, TASK_RUN_TOOL],
}
/** B755: how long a chat's answer to "may my code set model and effort?" holds before it asks the app again. */
export const CAN_SET_MS = 10 * 60_000
/** The levels the app names. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export type HandSet = { model: string | null; effort: string }
export type HandJob = { id: string; to: string; chat: string; text: string } | { id: string; to: string; chat: string; set: HandSet }
  | { id: string; to: string; chat: string; restart: { keep: string[] } } | { id: string; chat: string; spawn: { title: string; tasks: string[] } }
export type HandResult = { id: string; ok: boolean; why?: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''
const MODEL_ID = /^claude-[\w.:-]{1,73}(?:\[[\w.-]{1,20}\])?$/
const APP_ID = /^local_[\w-]{1,80}$/

/** B755: a job's values, read safely: an effort the app names and a model id of the app's or none; never Fable. */
function setOf(raw: unknown): HandSet | null {
  if (!isRecord(raw) || typeof raw.effort !== 'string' || !EFFORTS.includes(raw.effort)) return null
  const model = raw.model ?? null
  if (model !== null && (typeof model !== 'string' || !MODEL_ID.test(model) || /fable/i.test(model))) return null
  return { model, effort: raw.effort }
}

/** B766: a new worker's job read safely: a title of plain words and the stored task's ids, three at most. */
function spawnOf(raw: unknown): { title: string; tasks: string[] } | null {
  if (!isRecord(raw) || typeof raw.title !== 'string' || !/^[\w .·:-]{1,60}$/.test(raw.title) || !Array.isArray(raw.tasks)) return null
  const tasks = raw.tasks.filter((one): one is string => typeof one === 'string' && /^[a-z0-9-]{1,80}$/.test(one)).slice(0, 3)
  return tasks.length === 0 ? null : { title: raw.title, tasks }
}

/**
 * The board's answer to a claim, read safely: the jobs with an app id (local_...) and a line, values or a restart (its
 * chats to reopen, app ids only), and the new workers (no app id yet); none else.
 */
export function parseJobs(text: string | null): HandJob[] {
  if (text === null) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  const jobs = isRecord(raw) && Array.isArray(raw.jobs) ? raw.jobs : []
  const parsed: HandJob[] = []
  for (const one of jobs) {
    if (!isRecord(one) || !isText(one.id)) continue
    if (one.spawn !== undefined) {
      const spawn = spawnOf(one.spawn)
      if (spawn !== null) parsed.push({ id: one.id, chat: spawn.title, spawn })
      continue
    }
    if (!isText(one.to) || !APP_ID.test(one.to)) continue
    const head = { id: one.id, to: one.to, chat: isText(one.chat) ? one.chat : '' }
    if (isText(one.text)) parsed.push({ ...head, text: one.text.slice(0, 2000) })
    else if (one.set !== undefined) {
      const set = setOf(one.set)
      if (set !== null) parsed.push({ ...head, set })
    } else if (isRecord(one.restart) && Array.isArray(one.restart.keep)) {
      parsed.push({ ...head, restart: { keep: one.restart.keep.filter((id): id is string => typeof id === 'string' && APP_ID.test(id)).slice(0, 50) } })
    }
  }
  return parsed
}

const answerText = (answer: unknown): string => isRecord(answer) && typeof answer.text === 'string' ? answer.text : typeof answer === 'string' ? answer : JSON.stringify(answer ?? null)

/**
 * What the app's tool answered, as a hand's result: sent when it says delivered or queued (the line waits behind the
 * chat's own turn); otherwise not, with its words as the why.
 */
export function sendResult(id: string, answer: unknown): HandResult {
  const text = answerText(answer)
  const isError = isRecord(answer) && answer.isError === true
  if (!isError && /\(delivery: (?:delivered|queued)\b/.test(text)) return { id, ok: true }
  return { id, ok: false, why: text.slice(0, 300) || 'no answer' }
}

/**
 * B755: what one of the app's set tools answered: set when it answered without an error, a refusal (`deny`) or words
 * of one (the model picker does not offer the id, the chat is not found); otherwise not, with its words as the why.
 */
export function setResult(id: string, answer: unknown): HandResult {
  if (isRecord(answer) && typeof answer.deny === 'string') return { id, ok: false, why: answer.deny.slice(0, 300) || 'refused' }
  const text = answerText(answer)
  const isError = isRecord(answer) && answer.isError === true
  if (!isError && isRecord(answer) && answer.result !== undefined && !/\b(?:not|refused|must|unknown|invalid|cannot|can't)\b/i.test(text)) return { id, ok: true }
  return { id, ok: false, why: text.slice(0, 300) || 'no answer' }
}

/** B766: what this chat may do by code (`CAN_TOOLS`'s keys), from the app's verdict for each tool, by its name. */
export const canFrom = (verdicts: Record<string, unknown>): string[] =>
  Object.keys(CAN_TOOLS).filter(what => CAN_TOOLS[what].every(tool => isRecord(verdicts[tool]) && verdicts[tool].decision === 'allow'))

/** B766: what a tool answered, as a hand's result: done unless it refused (`deny`) or said it failed (`isError`). */
export function plainResult(id: string, answer: unknown): HandResult {
  if (isRecord(answer) && typeof answer.deny === 'string') return { id, ok: false, why: answer.deny.slice(0, 300) || 'refused' }
  if (isRecord(answer) && answer.isError !== true && answer.result !== undefined) return { id, ok: true }
  return { id, ok: false, why: answerText(answer).slice(0, 300) || 'no answer' }
}

/** B766: the app ids of the archived sessions out of what the app's list tool answered (its JSON text). */
export function archivedOf(answer: unknown): Set<string> {
  let rows: unknown
  try {
    rows = JSON.parse(answerText(answer))
  } catch {
    return new Set()
  }
  if (!Array.isArray(rows)) return new Set()
  return new Set(rows.filter(isRecord).filter(row => row.isArchived === true && typeof row.sessionId === 'string').map(row => row.sessionId as string))
}
