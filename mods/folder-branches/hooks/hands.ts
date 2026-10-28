// B753: the board's hands in code. The board keeps each start, wake and resume as a job; the Workers mod of any running
// board chat claims them (`HANDS_PATH`), sends each with the app's own send-message tool, by code, with no model turn, and
// says what it sent (`HANDS_DONE_PATH`). Proven on the work login, 2026-10-28: the app's guard skips the mod's prompt and
// turn hooks, but its timers and tool calls run. The pure part; register.tsx runs it on a timer.
//
// B755 (the person, 2026-10-28: "Add the permission so code may set model and effort, and build B755"): a chat whose app
// lets its code set another chat's model and effort (the allow rule for the two tools below, which `$.tool.check` reads)
// says so at its claim and gets those jobs too. The values are checked here once more: an effort the app names, a model id
// of the app's ("claude-..."), never Fable.

export const HANDS_PATH = '/api/bridge/hands'
export const HANDS_DONE_PATH = '/api/bridge/hands-done'
/** How often a chat asks the board for jobs. */
export const HANDS_MS = 20_000
/** The app's tool that sends a line to another of the person's sessions, and starts it when it does not run. */
export const SEND_TOOL = 'mcp__ccd_session_mgmt__send_message'
/** B755: the app's tools that set another session's model and effort, from its next turn on. */
export const MODEL_TOOL = 'mcp__ccd_session_mgmt__set_session_model'
export const EFFORT_TOOL = 'mcp__ccd_session_mgmt__set_session_effort'
/** B755: how long a chat's answer to "may my code set model and effort?" holds before it asks the app again. */
export const CAN_SET_MS = 10 * 60_000
/** The levels the app names. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export type HandSet = { model: string | null; effort: string }
export type HandJob = { id: string; to: string; chat: string; text: string } | { id: string; to: string; chat: string; set: HandSet }
export type HandResult = { id: string; ok: boolean; why?: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''
const MODEL_ID = /^claude-[\w.:-]{1,73}(?:\[[\w.-]{1,20}\])?$/

/** B755: a job's values, read safely: an effort the app names and a model id of the app's or none; never Fable. */
function setOf(raw: unknown): HandSet | null {
  if (!isRecord(raw) || typeof raw.effort !== 'string' || !EFFORTS.includes(raw.effort)) return null
  const model = raw.model ?? null
  if (model !== null && (typeof model !== 'string' || !MODEL_ID.test(model) || /fable/i.test(model))) return null
  return { model, effort: raw.effort }
}

/** The board's answer to a claim, read safely: the jobs with an app id (local_...) and a line or values, none else. */
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
    if (!isRecord(one) || !isText(one.id) || !isText(one.to) || !/^local_[\w-]{1,80}$/.test(one.to)) continue
    const head = { id: one.id, to: one.to, chat: isText(one.chat) ? one.chat : '' }
    if (isText(one.text)) parsed.push({ ...head, text: one.text.slice(0, 2000) })
    else if (one.set !== undefined) {
      const set = setOf(one.set)
      if (set !== null) parsed.push({ ...head, set })
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

/** B755: whether the app's verdicts for both set tools allow a call by code with no question (`$.tool.check`'s). */
export const canSetFrom = (verdicts: unknown[]): boolean => verdicts.length === 2 && verdicts.every(one => isRecord(one) && one.decision === 'allow')
