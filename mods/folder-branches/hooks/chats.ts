// The parts of the chat list that need no engine: a chat's file, what a chat writes into it as it works, and what a
// chat is shown as.
import type { ChatFile, ChatList, ChatRole, ChatRow, ChatTask } from '../types'

/** Where the chats of a project keep their files: one `<session id>.json` each. */
export const CHATS_DIR = '.claude/chats'
/** The file in that folder that says which chats join by themselves. */
export const LIST_FILE = 'list.json'
/** A turn that has not written for this long is taken as ended (its session closed without saying so). */
export const STALE_MS = 120000
/** How often a running turn writes its file again, so it is not taken as ended. */
export const BEAT_MS = 30000

const MINUTE_MS = 60000
/** A worker larger than this many tokens is compacted before a new task, unless the project's list says otherwise. */
export const COMPACT_ABOVE = 250000
const MAX_STEPS = 20
/** A step's name is a few words: a longer one is cut. */
const MAX_NAME = 80
/** A day: a longer estimate is a slip of the pen. */
const MAX_MINUTES = 1440

/**
 * The folders a chat list is looked for in: the session's own first, then each folder above it, so the sessions
 * opened inside a project share one list. A network folder stands alone.
 */
export function foldersAbove(root: string): string[] {
  const own = root.replace(/[\\/]+$/, '')
  if (/^[\\/]{2}/.test(root)) return [own]
  const parts = own.split(/[\\/]+/)
  const sep = root.includes('\\') ? '\\' : '/'
  return parts.map((_part, i) => parts.slice(0, parts.length - i).join(sep))
}

/** The file a session keeps, by its id. */
export function fileName(id: string): string {
  return `${id.replace(/[^A-Za-z0-9_-]/g, '_')}.json`
}

/** The session a file of the list belongs to; null for any other file. */
export function sessionOf(name: string): string | null {
  return name.endsWith('.json') && name.length > 5 && name !== LIST_FILE ? name.slice(0, -5) : null
}

/** A chat's file as text. */
export function chatText(chat: ChatFile): string {
  const { name, role, state, task, at, compacted, compactNote } = chat
  return `${JSON.stringify({ name, role, state, task, at, ...(compacted === undefined ? {} : { compacted }), ...(compactNote === undefined ? {} : { compactNote }) }, null, 2)}\n`
}

/** What the file of a chat that left the list holds: it describes no chat, and the chat does not join by its title. */
export const LEFT_TEXT = '{ "left": true }\n'
/** A file of at most this many bytes is one that left: the file of a chat in the list is longer. */
export const LEFT_MAX_SIZE = 40

/** True for the file of a chat that left the list. */
export function hasLeft(text: string): boolean {
  try {
    const data: unknown = JSON.parse(text)
    return data !== null && typeof data === 'object' && (data as Record<string, unknown>).left === true
  } catch {
    return false
  }
}

/** A whole number a file holds, kept between two bounds; `fallback` for anything else. */
function wholeIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

/** The task a file holds; null when it holds none. A plain text is a task with no plan. */
function parseTask(raw: unknown): ChatTask | null {
  if (typeof raw === 'string') return raw.trim() === '' ? null : { text: raw.trim(), step: 0, steps: 0, left: null, isReported: false }
  if (raw === null || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  if (typeof t.text !== 'string' || t.text.trim() === '') return null
  const steps = wholeIn(t.steps, 0, MAX_STEPS, 0)
  const names = Array.isArray(t.names) ? t.names.filter((name): name is string => typeof name === 'string' && name.trim() !== '').map(name => name.trim().slice(0, MAX_NAME)) : []

  return {
    text: t.text.trim(),
    step: steps === 0 ? 0 : wholeIn(t.step, 1, steps, 1),
    steps,
    left: typeof t.left === 'number' && Number.isFinite(t.left) ? Math.max(0, t.left) : null,
    isReported: t.isReported === true,
    // The names stand only for the steps they were given for.
    ...(names.length > 0 && names.length === steps ? { names } : {}),
    ...(t.asked === true ? { asked: true as const } : {}),
    ...(steps > 0 && typeof t.stepLeft === 'number' && Number.isFinite(t.stepLeft) ? { stepLeft: Math.max(0, t.stepLeft) } : {}),
  }
}

/** B227: a note why the chat was not compacted after its last report. */
function isNote(value: unknown): value is { at: number; why: string } {
  if (value === null || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return typeof c.at === 'number' && Number.isFinite(c.at) && typeof c.why === 'string' && c.why !== ''
}

function isCompacted(value: unknown): value is { at: number; before: number; after: number } {
  if (value === null || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return [c.at, c.before, c.after].every(one => typeof one === 'number' && Number.isFinite(one))
}

/** The chat a file's text describes; null when it describes none. */
export function parseChat(text: string): ChatFile | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object') return null
  const c = data as Record<string, unknown>
  if (typeof c.name !== 'string' || c.name.trim() === '') return null

  return {
    name: c.name.trim(),
    role: c.role === 'main' ? 'main' : 'worker',
    state: c.state === 'working' || c.state === 'asking' ? c.state : 'waiting',
    task: parseTask(c.task),
    at: typeof c.at === 'number' && Number.isFinite(c.at) ? c.at : 0,
    ...(isCompacted(c.compacted) ? { compacted: { at: c.compacted.at, before: c.compacted.before, after: c.compacted.after } } : {}),
    ...(isNote(c.compactNote) ? { compactNote: { at: c.compactNote.at, why: c.compactNote.why.slice(0, 200) } } : {}),
  }
}

/** Which chats join the list by themselves, as `list.json` says it; null when it names no prefix. */
export function parseList(text: string): ChatList | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object') return null
  const l = data as Record<string, unknown>
  if (typeof l.prefix !== 'string' || l.prefix.trim() === '') return null

  return {
    prefix: l.prefix,
    main: typeof l.main === 'string' && l.main.trim() !== '' ? l.main.trim() : 'Main',
    compactAbove: typeof l.compactAbove === 'number' && Number.isFinite(l.compactAbove) && l.compactAbove >= 0 ? l.compactAbove : COMPACT_ABOVE,
  }
}

/** The name and role a chat's title gives it in the list; null for a chat that is none of the project's. */
export function nameFromTitle(title: string, list: ChatList): { name: string; role: ChatRole } | null {
  if (!title.toLowerCase().startsWith(list.prefix.toLowerCase())) return null
  const name = title.slice(list.prefix.length).trim()
  if (name === '') return null

  return { name, role: name.toLowerCase() === list.main.toLowerCase() ? 'main' : 'worker' }
}

/** True while a turn of the chat runs, as far as its file says. */
function isRunning(chat: ChatFile, now: number): boolean {
  return chat.state !== 'waiting' && now - chat.at < STALE_MS
}

/** True for a worker that has work: a task, or a turn that runs. */
function isBusy(chat: ChatFile, now: number): boolean {
  return chat.task !== null || isRunning(chat, now)
}

/** The chat with its state set at `now`. The time it worked since its file was last written comes off its estimate. */
export function withState(chat: ChatFile, state: ChatFile['state'], now: number): ChatFile {
  const worked = chat.state === 'working' ? Math.min(Math.max(0, now - chat.at), STALE_MS) : 0
  const timed = chat.task === null || chat.task.left === null
    ? chat.task : { ...chat.task, left: Math.max(0, chat.task.left - worked) }
  // The step's own time counts down with the work as the whole time does.
  const counted = timed === null || timed.stepLeft === undefined ? timed : { ...timed, stepLeft: Math.max(0, timed.stepLeft - worked) }
  // A chat that works again no longer waits for the chat it asked.
  const { asked: _asked, ...working } = counted ?? { asked: undefined }
  const task = counted !== null && state === 'working' && counted.asked === true ? working as ChatTask : counted

  return { ...chat, state, task, at: now }
}

/**
 * What a chat says of its task: its topic in a few words, its steps by name (or only how many there are), and the
 * minutes it expects.
 */
export type PlanInput = { text?: string; steps?: number; names?: readonly unknown[]; minutes?: number; stepMinutes?: number }

/** Why a time for the step is none; undefined when it is one, or none was given. */
function stepTimeError(minutes: number | undefined): string | undefined {
  return minutes === undefined || (minutes > 0 && minutes <= MAX_MINUTES) ? undefined : `"stepMinutes" is the working time the step you are on still takes, from 1 to ${MAX_MINUTES}.`
}
/** A change to a chat's task, or why it cannot be made. */
export type TaskChange = { chat: ChatFile; error?: undefined } | { chat?: undefined; error: string }

function isWhole(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max
}

/**
 * True for the id of an agent a session started itself (`a` and a run of hex digits, as the Agent tool names them):
 * a message to one is no message to another chat.
 */
export function isAgentId(to: string): boolean {
  return /^a[0-9a-f]{8,}(-[0-9a-f]+)*$/i.test(to)
}

/** Records the task, or more of its plan: another name starts a new task, the same or none keeps the step it is on. */
export function withPlan(chat: ChatFile, input: PlanInput): TaskChange {
  const text = input.text?.trim() ?? ''
  if (input.names !== undefined && (input.names.length < 1 || input.names.length > MAX_STEPS || !input.names.every(name => typeof name === 'string' && name.trim() !== ''))) {
    return { error: `"names" is the list of your steps, each a few words: from 1 to ${MAX_STEPS} of them.` }
  }
  const names = input.names?.map(name => String(name).trim().slice(0, MAX_NAME))
  if (input.steps !== undefined && !isWhole(input.steps, MAX_STEPS)) return { error: `"steps" is a whole number from 1 to ${MAX_STEPS}.` }
  if (input.minutes !== undefined && !(input.minutes > 0 && input.minutes <= MAX_MINUTES)) {
    return { error: `"minutes" is the working time still expected, from 1 to ${MAX_MINUTES}.` }
  }
  const stepError = stepTimeError(input.stepMinutes)
  if (stepError !== undefined) return { error: stepError }
  const before = chat.task
  const isNew = before === null || (text !== '' && text !== before.text)
  if (isNew && text === '') return { error: 'Name the task in "text", in two to five words.' }
  // Named steps give their own count. A count alone, or a new task, leaves the old names behind.
  const steps = names?.length ?? input.steps ?? (isNew ? 0 : before.steps)
  const kept = names ?? (isNew || (input.steps !== undefined && input.steps !== before.steps) ? undefined : before.names)
  const step = steps === 0 ? 0 : isNew ? 1 : Math.min(Math.max(before.step, 1), steps)
  const left = input.minutes !== undefined ? Math.round(input.minutes * MINUTE_MS) : isNew ? null : before.left

  // A task that was reported stays reported while its line is tidied; a new task starts unreported.
  // The step's own time: the one given now, else the one it had while the task and its step are the same.
  const stepLeft = steps === 0 ? undefined : input.stepMinutes !== undefined ? Math.round(input.stepMinutes * MINUTE_MS) : isNew || step !== before.step ? undefined : before.stepLeft
  const task = {
    text: isNew ? text : before.text, step, steps, left, isReported: isNew ? false : before.isReported,
    ...(kept === undefined ? {} : { names: kept }), ...(stepLeft === undefined ? {} : { stepLeft }),
  }
  return { chat: { ...chat, task } }
}

/** Moves the task to its next step, or to the one named; with minutes, the time it now expects. */
export function withStep(chat: ChatFile, input: { step?: number; minutes?: number; stepMinutes?: number }): TaskChange {
  const stepError = stepTimeError(input.stepMinutes)
  if (stepError !== undefined) return { error: stepError }
  const before = chat.task
  if (before === null || before.steps === 0) return { error: 'No plan is recorded: use action "plan" with "text", "steps" and "minutes" first.' }
  if (input.step !== undefined && !(Number.isInteger(input.step) && input.step >= 1)) return { error: '"step" is the number of the step you are on now.' }
  if (input.minutes !== undefined && !(input.minutes > 0 && input.minutes <= MAX_MINUTES)) {
    return { error: `"minutes" is the working time still expected, from 1 to ${MAX_MINUTES}.` }
  }
  const step = Math.min(input.step ?? before.step + 1, before.steps)
  const left = input.minutes !== undefined ? Math.round(input.minutes * MINUTE_MS) : before.left
  // Another step has its own time, or none until one is given.
  const { stepLeft: stepBefore, ...rest } = before
  const stepLeft = input.stepMinutes !== undefined ? Math.round(input.stepMinutes * MINUTE_MS) : step === before.step ? stepBefore : undefined

  return { chat: { ...chat, task: { ...rest, step, left, ...(stepLeft === undefined ? {} : { stepLeft }) } } }
}

/** The chat without a task. */
export function withDone(chat: ChatFile): ChatFile {
  return { ...chat, task: null }
}

/** The chat after it sent another chat a message: with a task open, that is its report. */
export function withSend(chat: ChatFile): ChatFile {
  return chat.task === null ? chat : { ...chat, task: { ...chat.task, isReported: true } }
}

/**
 * What a message a chat's model sends another chat is: its report, which ends its task, or a note. What goes to
 * another worker by its name (`others`) is never the report. Else by its first word when it has one of the three
 * ("Report", "Note", "Question"); else a message to the main chat by its name is the report, and one to anybody
 * else, or to an address that names nobody, is a note. `list` names the main chat.
 */
export function sentKind({ to, text, list, others = [] }: { to: string; text: string; list: ChatList | null; others?: readonly string[] }): 'report' | 'note' {
  const name = to.replace(/\s\[[^\]]*\]$/, '').trim().toLowerCase()
  const isNamed = (short: string): boolean => list !== null && (name === `${list.prefix}${short}`.toLowerCase() || name === short.toLowerCase())
  const isMain = list !== null && isNamed(list.main)
  if (!isMain && others.some(other => isNamed(other))) return 'note'
  // The first word, as a whole word, behind whatever marks stand before it ("**Question:**", "> Report").
  const first = /^[^a-z]{0,8}(report|note|question)\b/i.exec(text)?.[1]?.toLowerCase()
  if (first === 'report') return 'report'
  if (first !== undefined) return 'note'

  return isMain ? 'report' : 'note'
}

/**
 * The chat as a turn of its main conversation starts: a report from an earlier turn that was cut short no longer
 * counts, so only a report in this turn ends the task. Null when there is nothing to change.
 */
export function atTurnStart(chat: ChatFile): ChatFile | null {
  return chat.task?.isReported === true ? { ...chat, task: { ...chat.task, isReported: false } } : null
}

/**
 * The chat as its turn ends. A task it reported in this turn is finished, whatever step its card stands on. After a
 * note or a question to another chat (`asked`) the card stays, and says that the chat waits for that chat.
 */
export function afterTurn(chat: ChatFile, reason: string, sent: { asked?: boolean } = {}): ChatFile {
  if (chat.task === null || reason !== 'answer') return chat
  if (chat.task.isReported) return withDone(chat)

  return sent.asked === true ? { ...chat, task: { ...chat.task, asked: true } } : chat
}

/**
 * What a working chat's card lacks, in words for the chat: a task, a time, or a time that has not run out. Null
 * when the card has a topic and time left. The person's board shows a working chat without a time as a fault.
 */
export function cardGap(chat: ChatFile, tool: string, now: number): string | null {
  const how = `Send it together with your next tool call, not as a step of its own: call ${tool} with action`
  if (chat.task === null) {
    return `Your card is empty while you work, so the person's board shows this chat without a task and a time. ${how} "plan" `
      + 'and "text" (the topic), "names" (your steps) and "minutes" (the working time you expect).'
  }
  if (chat.task.left === null) {
    return `Your card has no time, so the person's board shows this chat as working without one. ${how} "plan" and `
      + `"minutes" (the working time you still expect)${chat.task.steps === 0 ? ', with "names" (your steps)' : ''}.`
  }
  // The time counts down while the chat works, also since its file was last written.
  const left = chat.task.left - (chat.state === 'working' ? Math.max(0, now - chat.at) : 0)
  if (left <= 0) return `The time on your card has run out. ${how} "plan" and the "minutes" you now expect.`
  if (chat.task.steps > 0 && chat.task.stepLeft === undefined) {
    return `The step you are on has no time on your card. ${how} "plan" and "stepMinutes" (the working time this step still takes).`
  }

  return null
}

/**
 * What a chat is told when a request has run for a while and its card was not touched in it: the card may be the
 * one of the request before. Null without a card.
 */
export function cardOld(chat: ChatFile, tool: string): string | null {
  if (chat.task === null) return null

  return `Your card still says "${chat.task.text}" from before this request. Together with your next tool call, not as a step `
    + `of its own, call ${tool} with action "plan": with "minutes" alone when this request is still that task, or with `
    + '"text", "names" and "minutes" when it is a new one.'
}

/** A stretch of time as a rough word: "~40 min", "~1.5 h", "over time" once none is left. */
export function timeText(ms: number): string {
  if (ms <= 0) return 'over time'
  const minutes = ms / MINUTE_MS
  if (minutes < 1) return '<1 min'
  if (minutes < 10) return `~${Math.ceil(minutes)} min`
  if (minutes < 90) return `~${Math.round(minutes / 5) * 5} min`

  return `~${Math.round(minutes / 30) / 2} h`
}

/** A task as the list words it: its name, the step it is on, and with `left` the time it still expects. */
function taskText(task: ChatTask, left: number | null): string {
  const plan = task.steps === 0 ? '' : ` · ${task.step} of ${task.steps}`
  return `${task.text}${plan}${left === null ? '' : ` · ${timeText(left)}`}`
}

/** What a chat is shown as: its mark and the rest of its line. `isYours` says the person is the one it waits for. */
export function status(chat: ChatFile, all: readonly ChatFile[], now: number): { mark: string; text: string; isYours: boolean } {
  const yours = (): { mark: string; text: string; isYours: boolean } => (
    { mark: '◐', text: chat.task === null ? 'your turn' : `your turn · ${taskText(chat.task, null)}`, isYours: true }
  )
  if (isRunning(chat, now) && chat.state === 'asking') return yours()
  if (isRunning(chat, now)) {
    const mark = chat.role === 'main' ? '◆' : '●'
    if (chat.task === null) return { mark, text: 'working', isYours: false }
    const left = chat.task.left === null ? null : Math.max(0, chat.task.left - (now - chat.at))

    return { mark, text: taskText(chat.task, left), isYours: false }
  }
  if (chat.role === 'main') {
    const busy = all.filter(other => other.role === 'worker' && isBusy(other, now)).length
    const text = busy === 0 ? 'free' : `waiting for ${busy} ${busy === 1 ? 'worker' : 'workers'}`

    return { mark: '◆', text, isYours: false }
  }
  // A worker that stopped in the middle of its task after a message to another chat waits for that chat.
  if (chat.task?.asked === true) return { mark: '◌', text: `waits for another chat · ${taskText(chat.task, null)}`, isYours: false }
  // A worker that stopped with its task still open waits for the person: a question, or work to look at.
  if (chat.task !== null) return yours()

  return { mark: '○', text: 'free', isYours: false }
}

/** A chat as one line of text. */
export function chatLine(chat: ChatFile, all: readonly ChatFile[], now: number): string {
  const { mark, text } = status(chat, all, now)
  return `${mark} ${chat.name}  ${text}`
}

/** The chats in the list's order: the main chat first, then the workers by name. */
export function orderChats<T extends ChatFile>(rows: readonly T[]): T[] {
  const lower = (chat: ChatFile): string => chat.name.toLowerCase()
  return [...rows].sort((a, b) =>
    (a.role === 'main' ? 0 : 1) - (b.role === 'main' ? 0 : 1) || (lower(a) < lower(b) ? -1 : lower(a) > lower(b) ? 1 : 0))
}

/**
 * The chats with each name once: where several files carry a name (a chat that went on under a new session id, a
 * closed chat of the same title), the one written last is the chat.
 */
export function uniqueByName<T extends ChatFile>(rows: readonly T[]): T[] {
  const newest = new Map<string, T>()
  for (const row of rows) {
    const key = row.name.toLowerCase()
    const known = newest.get(key)
    if (known === undefined || row.at > known.at) newest.set(key, row)
  }

  return rows.filter(row => newest.get(row.name.toLowerCase()) === row)
}

/** The whole list as text, for the tool's answer. */
export function chatsSummary(rows: readonly ChatRow[], now: number): string {
  if (rows.length === 0) return 'No chat is in the list yet.'
  return orderChats(rows).map(row => chatLine(row, rows, now)).join('\n')
}

/**
 * What a chat in the list is told about the list, as a section of its system prompt. It names the chat and its role
 * and nothing that changes while the chat works, so the prompt stays the same from turn to turn.
 */
export function chatNote(me: ChatFile, tool: string): string {
  // B297: the work items stand in the worker board's store; its tool is registered beside this one.
  const work = tool.replace(/chat$/, 'work')
  const shared = `This chat is "${me.name}" in the person's list of chats, which the Workers pane and their worker board show `
    + `them (${tool} with action "list" reads it): one main chat hands out the work and the worker chats do it. `
    + `${me.role === 'main' ? 'You are the main chat' : 'You are a worker'}. Every chat keeps a card of what it is doing, without `
    + 'being asked, in its main conversation (never from a subagent): the person reads the cards instead of the chats. '
    + `So at the start of every request, whether the main chat sent it or the person typed it, call ${tool} with action `
    + '"plan": "text" (the topic in two to five words), "names" (your steps by name, three to six of them, each two to '
    + 'five words), "minutes" (the working time you expect for the whole request, roughly; waiting for the person '
    + 'does not count) and "stepMinutes" (the time the first step takes). Each time you finish a step, call action '
    + '"step" with the "minutes" you now expect for the rest and "stepMinutes" for the step you start. Send these calls together with a '
    + 'tool call you make anyway, in the same step, never as a step of their own: a step of its own sends the whole '
    + 'conversation again. A request you answer without any tool call needs no card. The card is kept in a file, so it '
    + 'survives a compaction and a restart of the app; action "list" shows it to you again. '
    + `The work itself (steps, asks for the person, notes) stands in the worker board's store: ${work} with action "next" `
    + 'lists yours, and the flow file says who moves an item and when. '
  if (me.role === 'main') {
    return `${shared}Your card clears when you call "done" together with the last tool call of the request, or when `
      + 'you record the next request. Handing a task to a worker is not a report. A worker that has grown large is '
      + 'compacted by itself when the turn in which it reported a task ends. When the task after the one you hand over '
      + `continues the same work, open your message with "Task from ${me.name} (more follows):" and the worker is not `
      + 'compacted in between.'
  }
  return `${shared}Your card clears by itself when you report to the main chat with SendMessage and your turn ends: `
    + `start that message with "Report from ${me.name}:". A message to the main chat that is not your final report `
    + `starts with "Note from ${me.name}:" or "Question from ${me.name}:", and then the card stays; a message to `
    + 'another worker never clears it. When there is no report to send, call "done" together with your last tool call.'
}

/** Where the person's own words come from: typed here or on another device, or typed in for them by a mod. */
const PERSON_KINDS: readonly string[] = ['composer', 'bridge', 'sdk', 'plugin']

/**
 * A task the main chat hands over, as it arrives at a worker: a message of the main chat whose first line opens as
 * a task ("Task from ...", "Next task from ...", "Two tasks from ..."). `moreFollows` when that line says that the
 * task after this one continues the same work ("(more follows)"): the chat is then not compacted in between. Null
 * for anything else: a note, another worker's message, what the person types.
 */
export function handOver(text: string, origin: { kind?: string } | undefined, list: ChatList | null): { moreFollows: boolean } | null {
  // What the person types is never a hand-over, whatever it reads like, a pasted frame too: only what the app
  // brings in from elsewhere counts, in the frame it puts around another chat's message, with the main chat's name.
  if (list === null || origin?.kind === undefined || PERSON_KINDS.includes(origin.kind)) return null
  const tag = /<cross-session-message\b[^>]*\bname="([^"]*)"[^>]*>\s*([^\n]*)/.exec(text)
  if (tag === null) return null
  const [, name = '', first = ''] = tag
  if (name.trim().toLowerCase() !== `${list.prefix}${list.main}`.toLowerCase()) return null
  // "Task from", "Next task from", "Two tasks from", behind whatever marks stand before it ("**Task from").
  if (!/^[^a-z]{0,8}(?:\w+\s+){0,2}tasks?\s+from\b/i.test(first)) return null

  return { moreFollows: /\(more follows\)/i.test(first) }
}

/**
 * Why a chat is NOT compacted when the turn in which it reported its task has ended, in a few words; null when it
 * is to be compacted. Only a worker at rest: its task reported and cleared, larger than `above` tokens, and no word
 * from the main chat that more of the same work follows (the chat would have to read the same files again). B227: a
 * question its answer leaves with the person no longer keeps it, since nearly every report asks one: the compaction
 * keeps open questions word for word (`compactKeep`). The engine allows a compaction only between turns,
 * so this is the moment before the next task.
 */
export function compactWhy(chat: ChatFile, at: { tokens: number | null; above: number; moreFollows: boolean }): string | null {
  if (chat.role === 'main') return 'the main chat is not compacted this way'
  if (at.above <= 0) return 'switched off in the list of chats'
  if (chat.task !== null && !chat.task.isReported) return 'its last task is not reported yet'
  if (at.moreFollows) return 'more of the same work follows'
  if (at.tokens === null) return 'its size is not known'

  return at.tokens > at.above ? null : 'it is small enough'
}

/**
 * True when a chat's last answer leaves a question with the person: an item "Answer:" in a quote block, the form the
 * person's projects give what is theirs. The work it is about is then not finished, whatever was reported.
 */
export function asksPerson(answer: string): boolean {
  return /^\s*>.*\bAnswer:/im.test(answer)
}

/** What the compaction after a reported task is told to keep, for the chat of that name. */
export function compactKeep(name: string, main: string): string {
  return `This chat is "${name}", a worker in a project where the main chat "${main}" hands out the tasks and gets the reports. `
    + 'Its task is reported and the next one comes later, so keep what the next task needs and drop the step by step of finished ones. Keep, in this order: '
    + `(1) who this chat is: its name ${name}, its role, and that it reports to ${main}; `
    + '(2) the rules it works by: the working agreement, how answers to the person are written, and the rules of the backlog (ids, the kinds Verify, Decide, Provide and Do, the lines under a step); '
    + `(3) every task ${main} handed it that it has not reported yet, in the words of the hand-over; `
    + '(4) what the person decided or asked for that is not built yet, in their own words, with the date; '
    + '(5) every question or action it put to the person that is still open, word for word and with its number, so that an answer like "1 yes, 2 no" can still be read; '
    + '(6) its open work: branches, folders, servers it started, and what its last report named as still open; '
    + '(7) one line for each task it finished: what it was, where the work is (folder, branch, commit) and how it was checked; '
    + '(8) what it learned the hard way about this machine, the tools and the other chats.'
}

/** B297: what the work tool's call gives the card: the step's id and title, the plan's steps and times. */
export type WorkCardInput = { id?: unknown; title?: unknown; names?: readonly unknown[]; steps?: number; step?: number; minutes?: number; stepMinutes?: number }

/** B297: the card's topic for a step: its id and the first five words of its title. */
const topicOf = (id: unknown, title: unknown): string => [typeof id === 'string' ? id : '', typeof title === 'string' ? title.split(/\s+/).filter(Boolean).slice(0, 5).join(' ') : ''].filter(Boolean).join(' ')

/**
 * B297: the card after a call of the work tool the board took. `take` names the task after the step; `step` records the
 * plan when it gives the steps (`names` or `steps`), then the step it is on, as the chat tool's "plan" and "step" do.
 * Any other action leaves the card: `{}`.
 */
export function workCard(chat: ChatFile, action: string, input: WorkCardInput): TaskChange | Record<string, never> {
  if (action === 'take') return withPlan(chat, { text: topicOf(input.id, input.title), minutes: input.minutes, stepMinutes: input.stepMinutes })
  if (action !== 'step') return {}
  const isPlan = input.names !== undefined || input.steps !== undefined
  if (!isPlan) return withStep(chat, { step: input.step, minutes: input.minutes, stepMinutes: input.stepMinutes })
  const planned = withPlan(chat, { text: chat.task?.text ?? topicOf(input.id, ''), names: input.names, steps: input.steps, minutes: input.minutes, stepMinutes: input.stepMinutes })
  if (planned.chat === undefined || input.step === undefined) return planned
  return withStep(planned.chat, { step: input.step })
}

/** B298: an instruction of the person's that is still open, as the worker board answers it: its id and the turns it missed. */
export type OpenInstruction = { id: string; turns: number }

/**
 * B298: whether a prompt is filed on the worker board as the person's instruction: only what they typed in this chat's
 * own box (`composer`), never what the board or another chat brought in (it carries its id already, or is no word of
 * theirs), and never a slash command.
 */
export function isFiled(text: unknown, origin: { kind?: string } | undefined): boolean {
  return origin?.kind === 'composer' && typeof text === 'string' && text.trim() !== '' && !text.trimStart().startsWith('/')
}

/** B298: the open instructions as the board's answer gives them (`open`); null when the answer has none. */
export function openFrom(answer: unknown): OpenInstruction[] | null {
  if (typeof answer !== 'object' || answer === null || !Array.isArray((answer as { open?: unknown }).open)) return null
  return ((answer as { open: unknown[] }).open)
    .filter((one): one is { id: string; turns?: unknown } => typeof one === 'object' && one !== null && typeof (one as { id?: unknown }).id === 'string')
    .map(one => ({ id: one.id, turns: typeof one.turns === 'number' && one.turns > 0 ? Math.floor(one.turns) : 0 }))
}

const andList = (ids: readonly string[]): string => (ids.length <= 1 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`)

/** B298: the section of the composed prompt that names the open instructions: "Open instructions: I17 (new), I15 (2 turns)". */
export function instructionsLine(open: readonly OpenInstruction[]): string | null {
  if (open.length === 0) return null
  const each = open.map(one => `${one.id} (${one.turns === 0 ? 'new' : `${one.turns} turn${one.turns === 1 ? '' : 's'}`})`)
  return `Open instructions: ${each.join(', ')}. These are the person's words to you, filed on the worker board; close each with `
    + 'the work tool, "close" with "id" and "as" (what came of it), once it is done. A turn that ends with one still open marks it missed there.'
}

/**
 * B298: what the chat is told with the results of a batch of tool calls when the person's words were filed: "Recorded as
 * I17; close it with work close I17 --as ...", and the ones earlier turns left open. Null when there is nothing to say.
 */
export function recordedLine(filed: readonly string[], missed: readonly OpenInstruction[]): string | null {
  const parts: string[] = []
  if (filed.length === 1) parts.push(`Recorded as ${filed[0]}; close it with work close ${filed[0]} --as "what came of it" once it is done.`)
  if (filed.length > 1) parts.push(`Recorded as ${andList(filed)}; close each with work close <id> --as "what came of it" once it is done.`)
  const left = missed.filter(one => one.turns > 0 && !filed.includes(one.id))
  if (left.length > 0) parts.push(`Still open from earlier turns: ${left.map(one => `${one.id} (missed ${one.turns} turn${one.turns === 1 ? '' : 's'})`).join(', ')}.`)
  return parts.length === 0 ? null : parts.join(' ')
}
