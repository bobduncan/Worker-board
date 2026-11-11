// The parts of the chat list that need no engine: a chat's file, what a chat writes into it as it works, and what a
// chat is shown as.
import type { AfterStep, BoardHeld, BoardReading, BoardRole, BoardStatus, ChatFile, ChatList, ChatRole, ChatRow, ChatTask } from '../types'

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
  const { name, role, state, task, at, mod, compacted, compactNote, cleared, clearNote, clearing, taskNote } = chat
  const kept = { mod, compacted, compactNote, cleared, clearNote, clearing, taskNote }
  const notes = Object.fromEntries(Object.entries(kept).filter(([, value]) => value !== undefined))
  return `${JSON.stringify({ name, role, state, task, at, ...notes }, null, 2)}\n`
}

/**
 * Clear after each step: what the file of a session that a /clear ended holds: the session its chat goes on under.
 * It describes no chat (no name); the board follows it to the chat's new card and transcript.
 */
export function movedText(to: string, at: number): string {
  return `${JSON.stringify({ movedTo: to, at })}\n`
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

/** Clear after each step: a clear the card names (done, or on its way): when, the step, the log. */
function clearOf(value: unknown): { at: number; step: string | null; log: string | null } | null {
  if (value === null || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  if (typeof c.at !== 'number' || !Number.isFinite(c.at)) return null
  return { at: c.at, step: typeof c.step === 'string' && /^[A-Z]\d{1,6}$/.test(c.step) ? c.step : null, log: typeof c.log === 'string' && c.log !== '' ? c.log.slice(0, 300) : null }
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
  const cleared = clearOf(c.cleared)
  const clearing = clearOf(c.clearing)

  return {
    name: c.name.trim(),
    role: c.role === 'main' ? 'main' : 'worker',
    state: c.state === 'working' || c.state === 'asking' ? c.state : 'waiting',
    task: parseTask(c.task),
    at: typeof c.at === 'number' && Number.isFinite(c.at) ? c.at : 0,
    ...(typeof c.mod === 'string' && VERSION.test(c.mod) ? { mod: c.mod } : {}),
    ...(isCompacted(c.compacted) ? { compacted: { at: c.compacted.at, before: c.compacted.before, after: c.compacted.after } } : {}),
    ...(isNote(c.compactNote) ? { compactNote: { at: c.compactNote.at, why: c.compactNote.why.slice(0, 200) } } : {}),
    ...(cleared === null ? {} : { cleared }),
    ...(isNote(c.clearNote) ? { clearNote: { at: c.clearNote.at, why: c.clearNote.why.slice(0, 200) } } : {}),
    ...(clearing === null ? {} : { clearing }),
    ...(isNote(c.taskNote) ? { taskNote: { at: c.taskNote.at, why: c.taskNote.why.slice(0, 200) } } : {}),
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
    // Clear after each step: "compact" unless the list says "clear" or "off", so every other project stays as it was.
    afterStep: l.afterStep === 'clear' || l.afterStep === 'off' ? l.afterStep : 'compact',
    // The main chat and the partners are compacted at rest unless the list says "compactAtRest": false.
    compactAtRest: l.compactAtRest !== false,
    // The supervisor (spec 2026-10-24): the chat cleared after every turn, also when the board does not answer in time.
    ...(typeof l.supervisor === 'string' && l.supervisor.trim() !== '' ? { supervisor: l.supervisor.trim() } : {}),
    // 0.28.0: the Product owner's chat, so it is never taken for a worker when the board's answer names no role.
    ...(typeof l.owner === 'string' && l.owner.trim() !== '' ? { owner: l.owner.trim() } : {}),
  }
}

/**
 * 0.28.0: the Product owner as far as this chat knows it without the board's word: the list names it ("owner"), or the board
 * named it earlier (`lastRole`). Never the main chat. The Product owner is compacted at rest and never cleared; without this
 * a turn's end that carried no role (an older board) let it fall through to a worker's clear.
 */
export function isOwnerChat(list: ChatList | null, chat: { name: string; role: ChatRole } | null, lastRole: BoardRole | null = null): boolean {
  if (lastRole === 'owner') return true
  return list?.owner !== undefined && chat !== null && chat.role !== 'main' && chat.name.toLowerCase() === list.owner.toLowerCase()
}

/** 0.28.0: the role the board's answer names, else 'owner' where this chat is known to be the Product owner, else null. */
export function roleOrOwner(answer: unknown, list: ChatList | null, chat: { name: string; role: ChatRole } | null, lastRole: BoardRole | null = null): BoardRole | null {
  return roleFrom(answer) ?? (isOwnerChat(list, chat, lastRole) ? 'owner' : null)
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
  // 0.32.0: the note of a task the board took away goes with the next task.
  const { taskNote: _gone, ...rest } = chat
  return { chat: { ...rest, task } }
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

/** B301: the chat after the board took its `work report`: its task is reported, and its card clears when the turn ends. */
export function withSend(chat: ChatFile): ChatFile {
  return chat.task === null ? chat : { ...chat, task: { ...chat.task, isReported: true } }
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

/** B738: the board's word for a chat that does not run. */
export const NOT_RUNNING = 'Not running'

/**
 * What a chat is shown as: its mark and the rest of its line. `isYours` says the person is the one it waits for. B738:
 * `off` names the chats the board shows as not running (its one verdict, the page's word): one of them with nothing
 * waiting on the person reads "Not running", never "free"; a task it holds still reads as its own line says.
 */
export function status(chat: ChatFile, all: readonly ChatFile[], now: number, off: readonly string[] = []): { mark: string; text: string; isYours: boolean } {
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
  const isOff = off.includes(chat.name)
  if (chat.role === 'main') {
    if (isOff) return { mark: '○', text: NOT_RUNNING, isYours: false }
    const busy = all.filter(other => other.role === 'worker' && isBusy(other, now)).length
    const text = busy === 0 ? 'free' : `waiting for ${busy} ${busy === 1 ? 'worker' : 'workers'}`

    return { mark: '◆', text, isYours: false }
  }
  // A worker that stopped in the middle of its task after a message to another chat waits for that chat.
  if (chat.task?.asked === true) return { mark: '◌', text: `waits for another chat · ${taskText(chat.task, null)}`, isYours: false }
  // A worker that stopped with its task still open waits for the person: a question, or work to look at.
  if (chat.task !== null) return yours()

  return { mark: '○', text: isOff ? NOT_RUNNING : 'free', isYours: false }
}

/** 2c: the board's statuses count as fresh this long after they arrived (the pane falls back to its own reading after). */
export const STATUS_FRESH_MS = 120000
/** 2c: an age is shown on a status only over this, as the board's page does (public/board.js AGE_SHOWN_MS). */
export const AGE_SHOWN_MS = 10000

/** 2c: what decides whether the pane draws the board's statuses, its own reading, or its own reading marked. */
export type ReadingFacts = {
  now: number
  /** When this process began to look (its first read of the list): a fresh chat is not marked before 120 s. */
  bootAt: number
  /** When statuses last arrived; null before. */
  statusesAt: number | null
  /** When the board last answered a take WITHOUT statuses (an older board); null before. */
  answeredAt: number | null
  /** Whether this chat is in the list, and whether its project has a board (the board's file was read). */
  isMember: boolean
  isBoardKnown: boolean
}

/**
 * 2c: which line the pane draws. "board": statuses arrived within 120 s. "plain": today's line with no mark: a chat that takes
 * from no board (outside the list, or no board file), a process younger than 120 s, a board that answers without statuses (an
 * older board). "unreached": none arrived for over 120 s (counted from the process's start when none ever did) and no board
 * answered either: today's line, marked "(board not reached)". While a clear runs no take is made: nothing new arrives, which
 * is fine within 120 s.
 */
export function boardReading(f: ReadingFacts): BoardReading {
  if (f.statusesAt !== null && f.now - f.statusesAt <= STATUS_FRESH_MS) return 'board'
  if (!f.isMember || !f.isBoardKnown) return 'plain'
  if (f.now - Math.max(f.bootAt, f.statusesAt ?? -Infinity) <= STATUS_FRESH_MS) return 'plain'
  if (f.answeredAt !== null && f.now - f.answeredAt <= STATUS_FRESH_MS) return 'plain'
  return 'unreached'
}

/**
 * 2c: the mark of a chat by the board's status: ● at work (◆ for the main chat), ◐ the person's turn, ◌ moving on without the
 * person (the board is checking, handing or restarting it, or it is held, paused or stopped), ○ at rest or not running (◆ for a
 * main chat at rest).
 */
export function statusMark(status: string, role: ChatRole): { mark: string; isYours: boolean } {
  if (status === 'Waiting for you') return { mark: '◐', isYours: true }
  if (status === 'Working') return { mark: role === 'main' ? '◆' : '●', isYours: false }
  if (['Checking', 'Handing', 'Offered', 'Held', 'Did not answer', 'Paused', 'Restarting', 'Stopped'].includes(status)) return { mark: '◌', isYours: false }
  if (role === 'main' && (status === 'Free' || status === 'Asleep')) return { mark: '◆', isYours: false }
  return { mark: '○', isYours: false }
}

const pad = (n: number): string => String(n).padStart(2, '0')
/** 2c: a length of time as the board's page words it: "25 s" under a minute, then "3 min", "1 h 05". */
function ageSpan(ms: number): string {
  if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))} s`
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours >= 48) return `${Math.round(hours / 24)} days`
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${pad(minutes % 60)}`
}

/**
 * 2c: the board's status as its page words it (public/board.js statusLabel): the status, its why (not for Unknown and
 * Asleep, which carry theirs in the label), and how old the information is when over 10 s ("Working · 25 s ago"); Unknown
 * always says "no report for N" (or "no report yet"), Asleep since when. The age is counted from `reportAt` on this clock.
 */
export function statusLabel(entry: BoardStatus, now: number): string {
  const age = entry.reportAt === null ? null : Math.max(0, now - entry.reportAt)
  if (entry.status === 'Unknown') return age !== null ? `Unknown · no report for ${ageSpan(age)}` : 'Unknown · no report yet'
  if (entry.status === 'Asleep') return entry.since !== null ? `Asleep · since ${pad(new Date(entry.since).getHours())}:${pad(new Date(entry.since).getMinutes())}` : 'Asleep'
  const parts = [entry.status]
  if (entry.why !== null) parts.push(entry.why)
  if (age !== null && age > AGE_SHOWN_MS) parts.push(`${ageSpan(age)} ago`)
  return parts.join(' · ')
}

/** 2c: today's task text for a chat where its own line gives one: the task with its step and time, or the main chat's wait for workers. */
export function taskPart(chat: ChatFile, all: readonly ChatFile[], now: number): string | null {
  if (isRunning(chat, now)) {
    if (chat.task === null) return null
    const left = chat.state === 'asking' || chat.task.left === null ? null : Math.max(0, chat.task.left - (now - chat.at))
    return taskText(chat.task, left)
  }
  if (chat.role === 'main') {
    const busy = all.filter(other => other.role === 'worker' && isBusy(other, now)).length
    return busy === 0 ? null : `waiting for ${busy} ${busy === 1 ? 'worker' : 'workers'}`
  }
  return chat.task === null ? null : taskText(chat.task, null)
}

/** 7c (0.30.0): a held step as the pane's task part: "B855 The walk · 1 h 56 of its 2 h", the time left out when the board gives none. */
export function heldText(held: BoardHeld): string {
  const named = held.title === '' ? held.id : `${held.id} ${held.title}`
  return held.time === null ? named : `${named} · ${held.time}`
}

/** 2c: the board facts the pane's lines need; `ChatsView` has them. */
export type BoardFacts = { statuses?: readonly BoardStatus[]; reading?: BoardReading }

/** 2c: one line of the pane: its mark, the words, whether the person is the one it waits for, whether to draw it bold, whether it is marked. */
export type PaneLine = { mark: string; text: string; isYours: boolean; isBold: boolean; notReached: boolean }

/**
 * 2c (0.28.0): the pane's line for a chat. With fresh board statuses (`reading` "board") and one for this chat: its mark and
 * isYours follow the board's status, the words are the status (· why · age) and then today's task text where there is one,
 * bold for a status that needs attention (the board's tone), plain for the rest. Otherwise today's own reading (`status`), marked
 * "(board not reached)" only when `reading` is "unreached".
 */
export function lineOf(chat: ChatFile, all: readonly ChatFile[], now: number, off: readonly string[] = [], board: BoardFacts = {}): PaneLine {
  const reading = board.reading ?? 'plain'
  const known = board.statuses?.find(one => one.name.toLowerCase() === chat.name.toLowerCase())
  const entry = reading === 'board' ? known : undefined
  if (entry === undefined) {
    const own = status(chat, all, now, off)
    return { ...own, isBold: own.isYours, notReached: reading === 'unreached' }
  }
  const { mark, isYours } = statusMark(entry.status, chat.role)
  // 7c (0.30.0): the step the board knows the chat holds, with the row's time, in place of the card's task text; an entry without a
  // held step (an older board, none held) keeps the card's words (0.32.0, chat 1's verifier: a role chat's own plan, a worker's typed
  // request; a stale step task is the chat's own mod's to clear, `clearStaleCard`).
  const task = entry.held === undefined || entry.held === null ? taskPart(chat, all, now) : heldText(entry.held)
  return { mark, text: task === null ? statusLabel(entry, now) : `${statusLabel(entry, now)}  ${task}`, isYours, isBold: entry.tone === 'attention', notReached: false }
}

/** B570: a version as the mod writes it, "0.17.0". */
const VERSION = /^\d{1,4}(?:\.\d{1,4}){0,3}$/
const numbers = (version: string): number[] => version.split('.').map(Number)
/** B570: whether version `a` is older than `b`, compared as numbers. */
export function isOlderMod(a: string, b: string): boolean {
  const [x, y] = [numbers(a), numbers(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0)
  return false
}

/**
 * B570: what the list says of a chat's Workers mod while the chats run different ones (a new one rolls out): its version
 * and, for one older than the newest, that the board has it restarted after its step (a busy chat) or when it asks (an
 * idle one). Null while every chat that says one runs the same, and for a chat whose card names none.
 */
export function modNote(chat: ChatFile, all: readonly ChatFile[], now: number): string | null {
  if (chat.mod === undefined) return null
  const said = all.map(one => one.mod).filter((one): one is string => one !== undefined)
  if (said.every(one => !isOlderMod(one, chat.mod as string) && !isOlderMod(chat.mod as string, one))) return null
  const newest = said.reduce((a, b) => (isOlderMod(a, b) ? b : a), chat.mod)
  if (!isOlderMod(chat.mod, newest)) return `mod ${chat.mod}`
  return `mod ${chat.mod} · restarts ${isBusy(chat, now) || chat.task !== null ? 'after its step' : 'when the board asks'}`
}

/** A chat as one line of text. */
export function chatLine(chat: ChatFile, all: readonly ChatFile[], now: number, off: readonly string[] = [], board: BoardFacts = {}): string {
  const { mark, text, notReached } = lineOf(chat, all, now, off, board)
  const mod = modNote(chat, all, now)
  return `${mark} ${chat.name}  ${text}${notReached ? '  (board not reached)' : ''}${mod === null || !mod.includes('restarts') ? '' : `  (${mod})`}`
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
export function chatsSummary(rows: readonly ChatRow[], now: number, off: readonly string[] = [], board: BoardFacts = {}): string {
  if (rows.length === 0) return 'No chat is in the list yet.'
  return orderChats(rows).map(row => chatLine(row, rows, now, off, board)).join('\n')
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
      + `you record the next request. The board hands every step to a free worker itself; `
      + 'no message carries a task. When the turn in which a worker reported a step ends, the worker is cleared or compacted '
      + 'by itself, as the list of chats says; a large main chat is compacted while it rests.'
  }
  return `${shared}Your card clears by itself when you report your step with ${work} action "report" and your turn `
    + 'ends; no message to another chat clears it or ends a step. When you worked on no step, call "done" together with '
    + 'your last tool call. After the turn in which you reported a step your conversation may be cleared, so before you '
    + `report, everything your next step needs stands in the store: checkpoints (${work} step), the report, and asks.`
}

/**
 * Why a chat is NOT compacted when the turn in which it reported its task has ended, in a few words; null when it
 * is to be compacted. Only a worker at rest: its task reported and cleared, larger than `above` tokens, and (B301) no
 * next step the board named in its answer to the report (the chat would have to read the same files again). B227: a
 * question its answer leaves with the person no longer keeps it, since nearly every report asks one: the compaction
 * keeps open questions word for word (`compactKeep`). The engine allows a compaction only between turns,
 * so this is the moment before the next task.
 */
export function compactWhy(chat: ChatFile, at: { tokens: number | null; above: number; moreFollows: boolean; role?: BoardRole | null; afterStep?: AfterStep }): string | null {
  // Clear after each step: the main chat and the partners are compacted at rest above the threshold (never cleared).
  const role = at.role ?? chat.role
  if (at.above <= 0) return 'switched off in the list of chats'
  if (role === 'worker') {
    if (at.afterStep === 'off') return 'switched off in the list of chats'
    if (chat.task !== null && !chat.task.isReported) return 'its last task is not reported yet'
    if (at.moreFollows) return 'more of the same work follows'
  }
  if (at.tokens === null) return 'its size is not known'

  return at.tokens > at.above ? null : 'it is small enough'
}

/** Clear after each step: the role the board's answer to a turn's end names; null when it names none. */
export function roleFrom(answer: unknown): BoardRole | null {
  const role = typeof answer === 'object' && answer !== null ? (answer as { role?: unknown }).role : undefined
  return role === 'main' || role === 'worker' || role === 'advisor' || role === 'owner' || role === 'helper' || role === 'supervisor' ? role : null
}

/**
 * Clear after each step: true when a chat's last answer asks the person something the board did not file as an ask: a
 * question ("Answer:" in a quote block) when the board took no turn's end, when no "For you" block at its end holds it
 * (`items`, the block's questions as the mod read them), or when the board says it could not file some (`unfiled`).
 */
export function unfiledAsk(answer: string, ended: Record<string, unknown> | null, items: number): boolean {
  if (!asksPerson(answer)) return false
  if (ended === null || items === 0) return true
  return typeof ended.unfiled === 'number' && ended.unfiled > 0
}

/** Clear after each step: the facts that decide whether a worker is cleared after the turn in which it reported. */
export type ClearFacts = { role: BoardRole | null; isReported: boolean; isPaused: boolean; isUnfiled: boolean; busy: string | null }

/**
 * Clear after each step: why a worker is NOT cleared after the turn in which it reported its step (it is compacted
 * instead), in a few words; null when it is cleared. Only a worker the board names so, with its step reported, while
 * the person does not pause, with no question left unfiled and nothing of it still running.
 */
export function clearWhy(f: ClearFacts): string | null {
  if (f.role === null) return 'the board did not say this chat is a worker'
  if (f.role === 'supervisor') return 'the supervisor\'s chat is cleared after every turn of its own, without a log'
  if (f.role !== 'worker') return `the ${f.role === 'main' ? 'main chat' : f.role === 'advisor' ? 'partner' : f.role === 'owner' ? 'Product owner' : 'partner\'s helper'} is never cleared`
  if (!f.isReported) return 'its step is not reported'
  if (f.isPaused) return 'the person pauses the chats'
  if (f.isUnfiled) return 'its last answer asks the person something the board did not file as an ask'
  return f.busy
}

/**
 * True when a chat's last answer leaves a question with the person: an item "Answer:" in a quote block, the form the
 * person's projects give what is theirs. The work it is about is then not finished, whatever was reported.
 */
export function asksPerson(answer: string): boolean {
  return /^\s*>.*\bAnswer:/im.test(answer)
}

/**
 * What a compaction is told to keep, for the chat of that name and role: a worker after its reported step; the main
 * chat and the partners (the Advisor and its helper) at rest, each with what its role needs next.
 */
export function compactKeep(name: string, main: string, role: BoardRole = 'worker'): string {
  if (role === 'main') return keepMain(name)
  if (role === 'advisor' || role === 'helper') return keepPartner(name, main, role)
  if (role === 'owner') return keepOwner(name, main)
  return `This chat is "${name}", a worker in a project where the main chat "${main}" queues the steps in the worker board's store and the board delivers them. `
    + 'Its step is reported (work report) and the next one comes later, so keep what the next step needs and drop the step by step of finished ones. Keep, in this order: '
    + `(1) who this chat is: its name ${name}, its role, and that it reports to ${main}; `
    + '(2) the rules it works by: the working agreement, how answers to the person are written, and the rules of the backlog (ids, the kinds Verify, Decide, Provide and Do, the lines under a step); '
    + '(3) every step the store holds for it that it has not reported yet, by its id and title (work next lists them), and the person\'s words on it; '
    + '(4) what the person decided or asked for that is not built yet, in their own words, with the date; '
    + '(5) every question or action it put to the person that is still open, word for word and with its number, so that an answer like "1 yes, 2 no" can still be read; '
    + '(6) its open work: branches, folders, servers it started, and what its last report named as still open; '
    + '(7) one line for each task it finished: what it was, where the work is (folder, branch, commit) and how it was checked; '
    + '(8) what it learned the hard way about this machine, the tools and the other chats.'
}

/** What the main chat's compaction at rest keeps: the project's state of work as the person and the workers left it. */
function keepMain(name: string): string {
  return `This chat is "${name}", the main chat of a project: it writes the steps into the worker board's store (work new), carries out the board's words and tells the person what came of them; the board hands the steps out and wakes the workers. `
    + 'It is compacted while it rests, so keep what its next request needs and drop the step by step of finished work. Keep, in this order: '
    + `(1) who this chat is: its name ${name}, that it is the main chat, and that its job is in .claude/main-briefing.md and the board's roles/main.md; `
    + '(2) the rules it works by: the working agreement, how answers to the person are written, and the rules of the work store (ids, queue, report, asks, notes); '
    + '(3) every worker by name and what it holds, waits for or has queued, by step id; '
    + '(4) what the person decided or asked for that is not done yet, in their own words, with the date, and the instructions still open (I<n>); '
    + '(5) every question or action it put to the person that is still open, word for word and with its number, so that an answer like "1 yes, 2 no" can still be read; '
    + '(6) what it promised the person or a worker to do next; '
    + '(7) what it learned the hard way about this machine, the tools and the other chats.'
}

/** What the Product owner's compaction at rest keeps: its talks, the focus goal and what the person asked for. */
function keepOwner(name: string, main: string): string {
  return `This chat is "${name}", the person's Product owner on the worker board: it takes the person's talks first (brainstorms, "Change this goal", the Focus page's talk) and brings the person a goal when it starts and when it is ready; its job is in the board's roles/product-owner.md; "${main}" is the main chat. `
    + 'It is compacted while it rests, so keep what its next request needs and drop the step by step of finished work. Keep, in this order: '
    + `(1) who this chat is: its name ${name} and its role, and where its job is written; `
    + '(2) the rules it works by: the working agreement, how answers to the person are written, and the work tool\'s actions it uses; '
    + '(3) every talk still running, by its thread file and goal id: what was asked, the last Understood, and the proposal as it stands; '
    + '(4) the focus goal: its id, its goal definition and its work blocks as agreed; '
    + '(5) what the person decided or asked for that is not built yet, in their own words, with the date; '
    + '(6) every question it put to the person that is still open, word for word and with its number; '
    + '(7) what it learned the hard way about this machine, the tools and the other chats.'
}

/** What the partner's (the Advisor's) or its helper's compaction at rest keeps. */
function keepPartner(name: string, main: string, role: 'advisor' | 'helper'): string {
  const who = role === 'advisor'
    ? 'the person\'s partner on the worker board (the Advisor): it keeps the focus goal\'s goal definition and how, refines steps, answers the asks routed to it and checks results; its job is in the board\'s roles/partner.md'
    : 'the helper of the person\'s partner (the Advisor): it acts only on the tasks the Advisor sends it, one at a time, with their ids'
  return `This chat is "${name}", ${who}; "${main}" is the main chat that queues the steps. `
    + 'It is compacted while it rests, so keep what its next request needs and drop the step by step of finished work. Keep, in this order: '
    + `(1) who this chat is: its name ${name} and its role, and where its job is written; `
    + '(2) the rules it works by: the working agreement, how answers to the person are written, and the work tool\'s actions it uses; '
    + (role === 'advisor'
      ? '(3) the focus goal: its id, its goal definition and how as agreed or drafted, and what is decided on it; '
        + '(4) every step it is refining or checking, every ask routed to it and every task it sent its helper, by id; '
      : '(3) the task the Advisor sent it now, with its ids, and what it sent back so far; '
        + '(4) the ids of the steps, asks and goals its tasks name; ')
    + '(5) what the person decided or asked for that is not built yet, in their own words, with the date; '
    + '(6) every question it put to the person that is still open, word for word and with its number; '
    + '(7) what it learned the hard way about this machine, the tools and the other chats.'
}

/**
 * Clear after each step: what the conversation that starts after a /clear is told first: who the chat is, where its
 * rules are, that its earlier conversation was cleared (and where it is kept), the person's instructions still open
 * (as work next lists them, so its first turn can close them), and to run work next.
 */
export function clearedStart(at: { name: string; title: string; role: ChatRole; main: string; step: string | null; log: string | null; open: readonly OpenInstruction[] }, tool: string): string {
  const work = tool.replace(/chat$/, 'work')
  const kept = at.log === null ? '' : ` It is kept word for word in ${at.log}: read from it only when you need something it holds.`
  const after = at.step === null ? '' : ` by the Workers mod after your step ${at.step} was reported`
  const briefing = at.role === 'main' ? '.claude/main-briefing.md' : '.claude/worker-briefing.md'
  const lines = [
    `This chat is "${at.title}", ${at.role === 'main' ? 'the main chat' : 'a worker'} in the person's list of chats, listed as "${at.name}"; "${at.main}" is the main chat. `
      + `Your earlier conversation was cleared${after}, so this conversation starts empty.${kept} `
      + `Your rules are in CLAUDE.md and ${briefing}: read them before your first step. `
      + `Everything for your next step stands in the worker board's store: run ${work} with action "next" now, and go on from what it lists.`,
  ]
  if (at.open.length > 0) {
    const each = at.open.map(one => `${one.id}${one.turns > 0 ? ` (missed ${one.turns} turn${one.turns === 1 ? '' : 's'})` : ''}${typeof one.text === 'string' && one.text !== '' ? `: "${one.text.replace(/\s+/g, ' ').slice(0, 300)}"` : ''}`)
    lines.push(`The person's instructions to you that are still open, as work next lists them: ${each.join('; ')}. Close each with ${work} action "close", "id" and "as" (what came of it), once it is done.`)
  }
  return lines.join('\n')
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

/** B298: an instruction of the person's that is still open, as the worker board answers it: its id, the turns it missed, its words. */
export type OpenInstruction = { id: string; turns: number; text?: string }

/**
 * B298: where the person's own typing comes from: this chat's box (`composer`), Remote Control on a phone or the web
 * (`bridge`), and the desktop app, whose chats run on the SDK (`sdk`). A line the board typed comes as `plugin`.
 */
const TYPED_BY_PERSON: readonly string[] = ['composer', 'bridge', 'sdk']
/** B298: a line the board typed, also pasted by hand: its id at its end, or the board's mark. */
const FROM_BOARD = /\[I\d+\]\s*$|\((?:typed|answered) on the worker board\b/

/**
 * B1: the app's own notes, which it hands a chat as a prompt of the person's (a chat it started ended a turn, a card was
 * started, a message from another chat): each a block of its tag, closed by it.
 */
const APP_BLOCK = /<(system-reminder|side-sessions-event|cross-session-message|task-notification|ci-monitor-event)\b[^>]*>[\s\S]*?<\/\1\s*>/g

/** B1: a prompt's words without the app's own blocks: the person's words alone, empty when it held only the app's notes. */
export function personsWords(text: string): string {
  return text.replace(APP_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * B298: whether a prompt is filed on the worker board as the person's instruction: only what they typed themselves,
 * never what the board or another chat brought in (a board line carries its id already, also when pasted by hand),
 * and never a slash command. B1: the app's own blocks are no words of the person's.
 */
export function isFiled(text: unknown, origin: { kind?: string } | undefined): boolean {
  if (!TYPED_BY_PERSON.includes(origin?.kind ?? '') || typeof text !== 'string') return false
  const words = personsWords(text)
  return words !== '' && !words.startsWith('/') && !FROM_BOARD.test(words)
}

/** B298: the open instructions as the board's answer gives them (`open`); null when the answer has none. */
export function openFrom(answer: unknown): OpenInstruction[] | null {
  if (typeof answer !== 'object' || answer === null || !Array.isArray((answer as { open?: unknown }).open)) return null
  return ((answer as { open: unknown[] }).open)
    .filter((one): one is { id: string; turns?: unknown; text?: unknown } => typeof one === 'object' && one !== null && typeof (one as { id?: unknown }).id === 'string')
    .map(one => ({ id: one.id, turns: typeof one.turns === 'number' && one.turns > 0 ? Math.floor(one.turns) : 0, ...(typeof one.text === 'string' && one.text !== '' ? { text: one.text } : {}) }))
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

/** B299: one question of the app's question form, as the worker board files it: its words and its options. */
export type FormQuestion = { text: string; options: string[] }

/** B299: the questions an AskUserQuestion call asks (`questions: [{ question, options: [{ label }] }]`), at most four. */
export function formQuestions(input: unknown): FormQuestion[] {
  const list = typeof input === 'object' && input !== null ? (input as { questions?: unknown }).questions : undefined
  if (!Array.isArray(list)) return []
  return list.slice(0, 4).flatMap(one => {
    const text = typeof one === 'object' && one !== null ? (one as { question?: unknown }).question : undefined
    if (typeof text !== 'string' || text.trim() === '') return []
    const raw = (one as { options?: unknown }).options
    const options = Array.isArray(raw) ? raw.map(option => (typeof option === 'object' && option !== null ? (option as { label?: unknown }).label : option)).filter((label): label is string => typeof label === 'string' && label.trim() !== '') : []
    return [{ text: text.trim(), options }]
  })
}

/**
 * B299: what the person gave in the app's form for a question, from the tool's result: their choice (`answers` by
 * question), else their own words (`response`); '' for neither.
 */
export function formAnswer(result: unknown, question: string): string {
  const read = typeof result === 'object' && result !== null ? result as { answers?: unknown; response?: unknown } : {}
  const given = typeof read.answers === 'object' && read.answers !== null ? (read.answers as Record<string, unknown>)[question] : undefined
  if (Array.isArray(given) && given.some(one => typeof one === 'string')) return given.filter(one => typeof one === 'string').join(', ')
  if (typeof given === 'string' && given.trim() !== '') return given
  return typeof read.response === 'string' ? read.response.trim() : ''
}

/** B299: the step a chat's card names first ("B12 Give the golem ..."), for an ask under it; null when none. */
export function cardStep(chat: ChatFile | null): string | null {
  return chat?.task?.text.match(/\bB\d+\b/)?.[0] ?? null
}
