// A popup in a chat that waits for the person (the person, 2026-10-28: "worker 1 had a popup in claude code but it was not
// visible until looked, it was not visible in the worker board. how can we prevent this in the future?"; Worker 1 waited
// 16 min on the app's popup for its game preview). A call of the chat's own still running after STUCK_SHOWN_MS may wait
// on a popup, unless it is a kind that runs long by itself: it is filed on the worker board as an ask in the chat's name
// and the chat reports itself asking, as the app's question form does; once the call goes on, or its turn ends, the ask
// is withdrawn and the chat busy again. 2026-10-30 (the person: "i got a popup for all workers. i checked each but they
// didnt need an approve"): an ask of the permission check is no sign of a popup: in auto mode the mode settles it, often
// slowly and with none, so it shows nothing by itself.

/** A call still running after this long may wait on a popup. */
export const STUCK_SHOWN_MS = 60_000

/**
 * The calls that run long by themselves (a shell, a subagent, a wait) and the question form, which files its questions
 * itself: never shown for their time.
 */
const NOT_SHOWN = new Set(['AskUserQuestion', 'Bash', 'PowerShell', 'Agent', 'Task', 'TaskOutput', 'TaskStop', 'Monitor', 'Workflow', 'Skill', 'ScheduleWakeup', 'mcp__ccd_session_mgmt__send_message'])

/** Whether a call of this tool may be shown for its time (not one that runs long by itself). */
export const isShownForTime = (tool: string): boolean => !NOT_SHOWN.has(tool)

/** What a call of the tool does, in plain words (the person, 2026-10-30: the card showed the whole raw command). */
const PLAIN: Record<string, string> = {
  Bash: 'run a command', PowerShell: 'run a command', Edit: 'change a file', Write: 'write a file', NotebookEdit: 'change a notebook',
  Read: 'read a file', Glob: 'look for files', Grep: 'search the files', WebFetch: 'open a web page', WebSearch: 'search the web',
  ExitPlanMode: 'start on its plan', mcp__Claude_Browser__preview_start: 'start a preview in its browser',
  mcp__Claude_Browser__navigate: 'open a page in its browser',
}
export function plainAction(tool: string): string {
  if (PLAIN[tool] !== undefined) return PLAIN[tool]
  const parts = tool.split('__')
  return parts.length >= 3 && parts[0] === 'mcp' ? `use ${parts[1].replace(/_/g, ' ')} (${parts.slice(2).join(' ').replace(/_/g, ' ')})` : `use ${tool}`
}

/**
 * The call's detail in a few words: a command's first words (up to its first `&&`, `;`, `|` or redirect), a file's
 * name, a preview's name or a page's address; at most 40 characters; empty when there is none.
 */
export function shortDetail(input: unknown, max = 40): string {
  const fields = (input ?? {}) as Record<string, unknown>
  const text = (key: string): string => (typeof fields[key] === 'string' ? (fields[key] as string).trim() : '')
  const command = text('command').split(/&&|\|\||;|\||\s\d?>|\n/)[0].replace(/\s+/g, ' ').trim()
  const path = text('file_path') || text('notebook_path') || text('path')
  const said = command !== '' ? command.split(' ').slice(0, 4).join(' ') : path !== '' ? path.split(/[\\/]/).pop() ?? '' : text('name') || text('url') || text('pattern')
  return said.length > max ? `${said.slice(0, max - 1)}…` : said
}

/**
 * The ask's words, short and plain (its first sentence is the card's title): a popup may wait. The person answers in
 * the chat: the board names the chat beside the ask.
 */
export function popupText(tool: string, input: unknown): string {
  const detail = shortDetail(input)
  return `A popup in its chat may wait for you: it has tried to ${plainAction(tool)}${detail === '' ? '' : ` (${detail})`} for over a minute. Open its chat and look.`
}
