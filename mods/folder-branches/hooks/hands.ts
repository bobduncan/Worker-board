// B753: the board's hands in code. The board keeps each start, wake and resume as a job; the Workers mod of any running
// board chat claims them (`HANDS_PATH`), sends each with the app's own send-message tool, by code, with no model turn, and
// says what it sent (`HANDS_DONE_PATH`). Proven on the work login, 2026-10-28: the app's guard skips the mod's prompt and
// turn hooks, but its timers and tool calls run. The pure part; register.tsx runs it on a timer.

export const HANDS_PATH = '/api/bridge/hands'
export const HANDS_DONE_PATH = '/api/bridge/hands-done'
/** How often a chat asks the board for jobs. */
export const HANDS_MS = 20_000
/** The app's tool that sends a line to another of the person's sessions, and starts it when it does not run. */
export const SEND_TOOL = 'mcp__ccd_session_mgmt__send_message'

export type HandJob = { id: string; to: string; chat: string; text: string }
export type HandResult = { id: string; ok: boolean; why?: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** The board's answer to a claim, read safely: the jobs with an app id (local_...) and a line, none else. */
export function parseJobs(text: string | null): HandJob[] {
  if (text === null) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  const jobs = isRecord(raw) && Array.isArray(raw.jobs) ? raw.jobs : []
  return jobs.filter(isRecord)
    .filter(one => isText(one.id) && isText(one.to) && /^local_[\w-]{1,80}$/.test(one.to) && isText(one.text))
    .map(one => ({ id: one.id as string, to: one.to as string, chat: isText(one.chat) ? one.chat : '', text: (one.text as string).slice(0, 2000) }))
}

/**
 * What the app's tool answered, as a hand's result: sent when it says delivered or queued (the line waits behind the
 * chat's own turn); otherwise not, with its words as the why.
 */
export function sendResult(id: string, answer: unknown): HandResult {
  const text = isRecord(answer) && typeof answer.text === 'string' ? answer.text : typeof answer === 'string' ? answer : JSON.stringify(answer ?? null)
  const isError = isRecord(answer) && answer.isError === true
  if (!isError && /\(delivery: (?:delivered|queued)\b/.test(text)) return { id, ok: true }
  return { id, ok: false, why: text.slice(0, 300) || 'no answer' }
}
