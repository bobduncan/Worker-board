// Source 2: the line a chat writes about its own plan, `<project>\.claude\chats\<cliSessionId>.json`. It gives the
// task's name (a topic of a few words), its steps and estimate when it is there. It never decides whether a chat
// is busy: the transcript does.
//   task: { text, step, steps, names, left, since, isReported }
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
          // When the chat named the task. Older plan lines do not have it.
          since: number(task.since),
          isReported: task.isReported === true,
        }
      : null,
  }
}
