// Source 2: the line a chat writes about its own plan, `<project>\.claude\chats\<cliSessionId>.json`. It gives the
// task's name, step and estimate when it is there. It never decides whether a chat is busy: the transcript does.

const number = value => (Number.isFinite(value) ? value : null)

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
          leftMs: number(task.left),
          // When the chat named the task. Older plan lines do not have it.
          since: number(task.since),
          isReported: task.isReported === true,
        }
      : null,
  }
}
