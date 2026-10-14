// Source 2: the line a chat writes about its own plan, `<project>\.claude\chats\<cliSessionId>.json`. It gives the
// task's name (a topic of a few words), its steps and estimate when it is there. It never decides whether a chat
// is busy: the transcript does.
//   task: { text, step, steps, names, left, stepLeft, since, isReported }
// `step` is the number of the step the chat is on, from 1; `steps` how many there are; `names` what they are
// called, one short string per step in order (B81; older lines have none).

const number = value => (Number.isFinite(value) ? value : null)

const NAME_CHARS = 80
const MAX_NAMES = 30

/** The steps' names as a list of short strings, or null when the line has none. */
function namesOf(value) {
  if (!Array.isArray(value)) return null
  const names = value.filter(name => typeof name === 'string' && name.trim() !== '').map(name => name.trim().slice(0, NAME_CHARS)).slice(0, MAX_NAMES)
  return names.length === 0 ? null : names
}

/**
 * B210: the file name of a card a chat wrote itself, without the Workers mod: its name in the list of chats in small
 * letters, every other run of characters a "-" ("Worker 1" is `worker-1`), in `<project>\.claude\chats\own\`.
 */
export const ownCardKey = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * B210: a card a chat wrote itself, made into the mod's card: the same fields, where `minutes` and `stepMinutes` may
 * stand for `left` and `stepLeft` (milliseconds), and the file's time (`fileAt`) for `at` when it has none: the time
 * counts down from when the card was written. Its text as the board reads a card, or null when it is no card.
 */
export function ownCard(fileText, fileAt) {
  let raw
  try {
    raw = JSON.parse(fileText)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const task = raw.task !== null && typeof raw.task === 'object' && !Array.isArray(raw.task) ? { ...raw.task } : raw.task
  if (task !== null && typeof task === 'object') {
    if (!Number.isFinite(task.left) && Number.isFinite(task.minutes)) task.left = Math.round(task.minutes * 60_000)
    if (!Number.isFinite(task.stepLeft) && Number.isFinite(task.stepMinutes)) task.stepLeft = Math.round(task.stepMinutes * 60_000)
    if (!Number.isFinite(task.steps) && Array.isArray(task.names)) task.steps = task.names.length
  }
  // The mod's own word on whether its process runs is not the chat's to give.
  const { state: _state, ...rest } = raw
  return JSON.stringify({ ...rest, task, at: Number.isFinite(raw.at) ? raw.at : Number.isFinite(fileAt) ? fileAt : null })
}

export function parsePlanLine(fileText) {
  let raw
  try {
    raw = JSON.parse(fileText)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null

  const task = raw.task
  const hasTask = task !== null && typeof task === 'object' && typeof task.text === 'string' && task.text.trim() !== ''
  return {
    name: typeof raw.name === 'string' ? raw.name : null,
    role: typeof raw.role === 'string' ? raw.role : null,
    state: typeof raw.state === 'string' ? raw.state : null,
    at: number(raw.at),
    task: hasTask
      ? {
          text: task.text.trim(),
          step: number(task.step),
          steps: number(task.steps),
          names: namesOf(task.names),
          leftMs: number(task.left),
          // B108: the working time the chat still expects for the step it is on, true when the line was written.
          // Absent when it gave none (B107 has the chats give it).
          stepLeftMs: number(task.stepLeft),
          // When the chat named the task. Older plan lines do not have it.
          since: number(task.since),
          isReported: task.isReported === true,
          // The chat sent another chat a note or a question in the middle of its task, and waits for the answer.
          asked: task.asked === true,
        }
      : null,
  }
}
