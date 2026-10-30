// A popup in a chat that waits for the person (the person, 2026-10-28: "worker 1 had a popup in claude code but it was not
// visible until looked, it was not visible in the worker board. how can we prevent this in the future?"; Worker 1 waited
// 16 min on the app's popup for its game preview). A tool call of the chat's own that the permission check put to a
// decider (an ask) and is still waiting after POPUP_SHOWN_MS shows a popup to the person; any other call still running
// after STUCK_SHOWN_MS may wait on a popup of the app (one the permission check never sees), unless it is a kind that
// runs long by itself. Either is filed on the worker board as an ask in the chat's name and the chat reports itself
// asking, as the app's question form does; once the call goes on, the ask is closed and the chat busy again.

/** An ask the permission check made, still unanswered after this long: a popup waits for the person. */
export const POPUP_SHOWN_MS = 15_000
/** Any other call still running after this long may wait on a popup of the app. */
export const STUCK_SHOWN_MS = 60_000

/**
 * The calls that run long by themselves (a shell, a subagent, a wait): only an ask of the permission check shows them,
 * never their time. The question form has its own hook (it files its questions itself).
 */
const LONG_RUNS = new Set(['Bash', 'PowerShell', 'Agent', 'Task', 'TaskOutput', 'TaskStop', 'Monitor', 'Workflow', 'Skill', 'ScheduleWakeup', 'mcp__ccd_session_mgmt__send_message'])
const OWN_FORMS = new Set(['AskUserQuestion'])

/** Whether a call of this tool is watched at all (the question form files itself). */
export const isWatched = (tool: string): boolean => !OWN_FORMS.has(tool)

/** Whether a call of this tool may be shown for its time alone (not one that runs long by itself). */
export const isShownForTime = (tool: string): boolean => isWatched(tool) && !LONG_RUNS.has(tool)

/** A tool as the person reads it: `mcp__Claude_Browser__preview_start` is "Claude_Browser preview_start". */
export function toolName(tool: string): string {
  const parts = tool.split('__')
  return parts.length >= 3 && parts[0] === 'mcp' ? `${parts[1]} ${parts.slice(2).join('__')}` : tool
}

/** What the call does, in at most `max` characters: a shell's command, a file's path, else its arguments. */
export function callGist(input: unknown, max = 90): string {
  const fields = (input ?? {}) as Record<string, unknown>
  const said = ['command', 'file_path', 'path', 'url', 'name', 'pattern'].map(key => fields[key]).find(value => typeof value === 'string' && value.trim() !== '') as string | undefined
  const shown = said ?? Object.entries(fields).filter(([key]) => !['tool', 'tool_use_id', 'agentId', 'consent', 'requestMeta'].includes(key)).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(', ')
  const flat = shown.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * The ask's words: for a call the permission check asked about, that its popup waits for the person's OK; for one that
 * only runs long, that a popup may wait. The person answers in the chat: the board names the chat beside the ask.
 */
export function popupText(tool: string, input: unknown, isAsked: boolean): string {
  const gist = callGist(input)
  const what = gist === '' ? toolName(tool) : `${toolName(tool)}: ${gist}`
  return isAsked
    ? `Its popup waits for your OK to run ${what}. Open its chat and answer the popup.`
    : `Its ${what} has run over a minute: a popup in its chat may wait for you. Open its chat and look.`
}
