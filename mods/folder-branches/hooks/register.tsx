// folder-branches: two side panes. "Git": the folders directly inside the session's folder, each with the git branch
// checked out in it, or "no git"; a folder in git unfolds to its local branches; /git opens it and answers the list
// as text. "Workers": the chats of the project, one main chat that hands out work and the workers that do it, each
// with what it is doing now (its task, the step it is on, the time it expects; your turn; free); /workers opens it,
// and a tool keeps a chat's own line.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, Register, Timer } from 'claude-code'

import type { ChatFile, ChatRole, ChatRow, ChatsView, FolderRow, FoldersView } from '../types'
import { BOARD_FILE, BOARD_NOTE, LAUNCH_FILE, REQUEST_HEADER, TAKE_PATH, TYPED_PATH, WORK_ACTIONS, WORK_FIELDS, WORK_PATH, boardStarts, isPaused, parseBoard, parsePause, parseTaken, pauseContexts } from './board'
import type { Board, BoardStart, PauseState, PauseWhere } from './board'
import {
  BEAT_MS, CHATS_DIR, LEFT_MAX_SIZE, LEFT_TEXT, LIST_FILE, afterTurn, atTurnStart, cardGap, cardOld, chatNote, compactKeep, compactWhy, chatText, chatsSummary, fileName,
  cardStep, foldersAbove, formAnswer, formQuestions, hasLeft, instructionsLine, isAgentId, isFiled, nameFromTitle, openFrom, orderChats, parseChat, parseList, recordedLine, sessionOf, status, uniqueByName,
  withDone, withPlan, withSend, withState, withStep, workCard,
} from './chats'
import type { OpenInstruction, TaskChange } from './chats'
import { blockAsksLine, forYouItems } from './foryou'
import {
  SELF, UNKNOWN, branchList, branchName, detached, folderName, inFolder, isListed, ordered, summary,
} from './folders'

const PANE = 'folder-branches'
const WORKERS = 'workers'
const TOOL = 'mcp__folder-branches__chat'
/** B297: the tool a chat works the store's items with, on the worker board. */
const WORK = 'mcp__folder-branches__work'
/** How often the folders are read again, so a branch switched in a terminal shows in the pane: half a minute. */
const REFRESH_MS = 30000
/** How often the chat list is read again, so another chat's change shows in the pane. */
const CHATS_MS = 5000
/** How often a chat looks whether the project's boards answer, and how long it waits before it starts one again. */
const BOARDS_MS = 15000
const BOARD_RETRY_MS = 60000
/**
 * A turn may make this many batches of tool calls before a card without a time is spoken of, then it is said again
 * every so many batches, a few times at most in one turn: a word in time, not a nag.
 */
const REMIND_AFTER = 2
const REMIND_EVERY = 8
const REMIND_MOST = 3
/** How long one git question may take. */
const GIT_MS = 5000

const EMPTY: FoldersView = { root: null, rows: [], error: null }
const NO_CHATS: ChatsView = { me: null, now: 0, rows: [] }
const NONE: string[] = []

const viewAtom = atom({ plugin: 'folder-branches', key: 'view' } as const, EMPTY)
const expandedAtom = atom({ plugin: 'folder-branches', key: 'expanded' } as const, NONE)
const chatsAtom = atom({ plugin: 'folder-branches', key: 'chats' } as const, NO_CHATS)

// Lost on a reload, with the timers they name.
let watch: Timer | null = null
let chatWatch: Timer | null = null
let isReading = false
let isReadingChats = false
/** The folder that holds the project's chat files; null when the project has none. */
let chatsDir: string | null = null
/** True once the folder was looked for: a project without a list is not asked again at every turn. */
let hasLooked = false
/** When this session last wrote its own chat file. */
let lastBeat = 0
/** The changes to this session's own chat file, one after the other. */
let mine: Promise<unknown> = Promise.resolve()
/** True while a turn of this session's main conversation runs, as this process saw it start and end. */
let isInTurn = false
/** This session as the list names it, as last read or written; null while it is not in the list. */
let myself: { name: string; role: ChatRole } | null = null
/** The chat a /clear ended: the conversation that follows it is the same chat, under a new session id. */
let carried: { name: string; role: ChatRole } | null = null
/** When this process last looked at the boards, and when it last tried to start each. */
let lastBoardsLook = -Infinity
let isLookingAtBoards = false
const startTried = new Map<string, number>()
/** The batches of tool calls in this session's running turn, and how often its card was spoken of in it. */
let batches = 0
let reminders = 0
/** True once the chat recorded or renewed its card in this turn, or was asked about a card it left untouched. */
let isCardSeen = false
/** How long the line about a compaction stays up: the person may be looking at another chat when it happens. */
const TELL_MS = 20000
/** True once the chat sent another chat a note or a question in this turn: it then waits for that chat. */
let hasAsked = false
/** B301: true once the chat reported its step with the work tool in this turn (`work report`, taken by the board). */
let hasReported = false
/**
 * B301: true when the board answered that report with the chat's next step (it holds another step queued or taken):
 * more of the same work follows, so no compaction after it. Not kept over a restart of the app: the chat is then
 * compacted between the two after all, which costs it a second reading and nothing else.
 */
let moreFollows = false
/** True while the worker board is asked, so two ticks never take at once. */
let isTaking = false
/** The board's messages typed in this process: one the board hands out again is not typed again. */
const typedIds = new Set<string>()
/** B298: when this session's running turn started; null between turns. */
let turnStartedAt: number | null = null
/** B298: true once the board was told that this turn ended: a second end of the same turn tells it nothing. */
let isTurnEndTold = true
/** B317: the asks the board filed from the chat's last "For you" block, named beside its next prompt once. */
let blockAsks: string[] = []
/** Review of B298: true once the board named this chat's open instructions in this process. */
let isOpenKnown = false
/** B298: this chat's open instructions, as the board last answered them. */
let openInstructions: OpenInstruction[] = []
/** The ids and names of this session's own agents, as seen so far: a message to one of them is no report. */
const ownAgents = new Set<string>()
/**
 * Pause 2 (spec 2026-10-18-pause-resume-design.md): the person's pause as the board last answered it (its
 * `pause-state`, or turn-ended's `pause`), and when; null before the first reading. A reading is kept this long, so
 * a batch of tool calls asks the board at most once in that time.
 */
let pauseRead: { pause: PauseState | null; at: number } | null = null
const PAUSE_MS = 20000
/** Pause 2: the pause's lines this process gave its chat (`pauseContexts`), so each is given once. */
const pauseGiven = new Set<string>()
/** Pause 2: true until the first prompt of this process went in: a chat that holds a step learns its checkpoint then. */
let isFirstPrompt = true
/**
 * The review of Pause 2: the turns of this session's main conversation, counted, so the stop line is said at the first
 * batch of every turn while the person pauses; and whether the prompt that starts the next turn read the pause already
 * (the turn's start then keeps that reading instead of dropping it: one reading per turn's start).
 */
let turnNumber = 0
let isReadForTurn = false
/** B412: how many work calls this process made: the last part of each call's request id. */
let requestCount = 0
/** The review of Pause 2: where the mod's store keeps the resume a main chat was told of, so a new process says it no more. */
const resumeGivenKey = (session: string): string => `pause-resume-given:${session}`

function reason(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.length > 300 ? `${text.slice(0, 299)}…` : text
}

/** What git prints for a question about a folder; null when it fails or cannot be run. */
async function git($: EngineInterface, folder: string, args: readonly string[]): Promise<string | null> {
  try {
    const ran = await $.process.run(['git', '-C', folder, ...args], { timeoutMs: GIT_MS })
    return ran.exitCode === 0 ? ran.stdout : null
  } catch {
    return null
  }
}

/** True for a git checkout's own folder: it holds `.git` (a folder, or a worktree's file). */
async function hasGit($: EngineInterface, folder: string): Promise<boolean> {
  try {
    return await $.fs.exists(inFolder(folder, '.git'))
  } catch {
    return false
  }
}

/** True for a folder, and for a link that leads to one. */
async function isFolder($: EngineInterface, parent: string, entry: FsEntry): Promise<boolean> {
  if (entry.kind === 'dir') return true
  if (!entry.isLink) return false
  try {
    return (await $.fs.stat(inFolder(parent, entry.name))).kind === 'dir'
  } catch {
    return false
  }
}

/** The row of a git checkout: the branch checked out in it and its local branches. */
async function checkout($: EngineInterface, id: string, name: string, folder: string): Promise<FolderRow> {
  const current = await git($, folder, ['branch', '--show-current'])
  if (current === null) return { id, name, branch: UNKNOWN, branches: [] }
  const branch = branchName(current) ?? detached(await git($, folder, ['rev-parse', '--short', 'HEAD']))
  const listed = await git($, folder, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])

  return { id, name, branch, branches: listed === null ? [] : branchList(listed) }
}

/**
 * The folders directly inside the folder the session was opened in (a shell `cd` does not move it). When that
 * folder is itself a checkout it comes first, and the folders inside it that are no checkout of their own are left
 * out: they are part of it.
 */
async function readFolders($: EngineInterface): Promise<FoldersView> {
  const root = await $.session.root()
  let entries: FsEntry[]
  try {
    entries = await $.fs.list(root)
  } catch (err) {
    return { root, rows: [], error: reason(err) }
  }
  const rows: FolderRow[] = []
  const isCheckout = await hasGit($, root)
  if (isCheckout) rows.push(await checkout($, SELF, `${folderName(root)} (this folder)`, root))
  for (const entry of entries) {
    if (!isListed(entry.name) || !(await isFolder($, root, entry))) continue
    const folder = inFolder(root, entry.name)
    if (await hasGit($, folder)) rows.push(await checkout($, entry.name, entry.name, folder))
    else if (!isCheckout) rows.push({ id: entry.name, name: entry.name, branch: null, branches: [] })
  }

  return { root, rows: ordered(rows), error: null }
}

/** Reads the folders into the state the pane draws from; the state is written only when something changed. */
async function load($: EngineInterface): Promise<FoldersView> {
  const next = await readFolders($)
  const before = await read($, viewAtom)
  if (JSON.stringify(before) !== JSON.stringify(next)) await update($, viewAtom, () => next)
  return next
}

/** Reads the folders again for the pane (a turn's end, the timer): one reading at a time. */
async function refresh($: EngineInterface): Promise<void> {
  if (isReading) return
  isReading = true
  try {
    await load($)
  } catch {
    // a reading that failed leaves the pane as it was
  } finally {
    isReading = false
  }
}

/** Keeps the pane in step with the folders. */
function ensureWatch($: EngineInterface): void {
  if (watch !== null) return
  watch = $.clock.every(REFRESH_MS, () => {
    void refresh($)
  })
}

/**
 * The folder with the project's chat files: `.claude/chats` of the folder the session was opened in or, shared, of
 * the nearest folder above it that has one. Null when there is none; `again` looks once more for a project that had
 * none.
 */
async function findChatsDir($: EngineInterface, again = false): Promise<string | null> {
  if (chatsDir !== null || (hasLooked && !again)) return chatsDir
  hasLooked = true
  for (const folder of foldersAbove(await $.session.root())) {
    const dir = inFolder(folder, CHATS_DIR)
    try {
      if (await $.fs.exists(dir)) {
        chatsDir = dir
        return dir
      }
    } catch {
      // not a folder this session may ask about: look a folder up
    }
  }
  return null
}

/** One chat's file; null when it has none, or the file describes no chat. */
async function readChat($: EngineInterface, dir: string, id: string): Promise<ChatFile | null> {
  try {
    return parseChat(await $.fs.read(inFolder(dir, fileName(id))))
  } catch {
    return null
  }
}

/** Every file of the project's list that describes a chat, the ones a newer file took the name of included. */
async function readFiles($: EngineInterface): Promise<ChatRow[]> {
  const dir = await findChatsDir($)
  if (dir === null) return []
  let entries: FsEntry[]
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }
  const rows: ChatRow[] = []
  for (const entry of entries) {
    // The file of a chat that left is a few bytes: it is not opened again at every reading.
    const id = entry.kind === 'file' && entry.size > LEFT_MAX_SIZE ? sessionOf(entry.name) : null
    const chat = id === null ? null : await readChat($, dir, id)
    if (id !== null && chat !== null) rows.push({ ...chat, id })
  }

  return rows
}

/** The chats of the project's list, each name once, in the list's order. */
async function readChats($: EngineInterface): Promise<ChatRow[]> {
  return orderChats(uniqueByName(await readFiles($)))
}

/** What the pane shows of a reading: who is listed and each line's words, not the times the files were written. */
function shown(view: ChatsView): string {
  return JSON.stringify([view.me, view.rows.map(row => [row.id, row.name, status(row, view.rows, view.now)])])
}

/**
 * Reads the chat list into the state the pane draws from. The reading is kept only when a line's words changed, so
 * the pane is not drawn again each time a working chat writes its file.
 */
async function loadChats($: EngineInterface): Promise<ChatsView> {
  const rows = await readChats($)
  const next: ChatsView = { me: await $.session.id(), now: await $.clock.now(), rows }
  const before = await read($, chatsAtom)
  if (shown(before) !== shown(next)) await update($, chatsAtom, () => next)
  return next
}

/** Reads the chat list again for the pane: one reading at a time. */
async function refreshChats($: EngineInterface): Promise<void> {
  if (isReadingChats) return
  isReadingChats = true
  try {
    await loadChats($)
  } catch {
    // a reading that failed leaves the pane as it was
  } finally {
    isReadingChats = false
  }
}

/**
 * Reads this session's own chat file, changes it and writes it; null when this chat is not in the list. While a
 * turn runs the chat is first brought up to now (the time it worked comes off its estimate), so every write says
 * the turn is alive. `change` answers the chat to write, or null to leave the file as it is.
 */
async function applyMine(
  $: EngineInterface, change: (chat: ChatFile, now: number) => ChatFile | null,
): Promise<ChatFile | null> {
  const dir = await findChatsDir($)
  if (dir === null) return null
  const id = await $.session.id()
  const found = await readChat($, dir, id)
  myself = found === null ? null : { name: found.name, role: found.role }
  if (found === null) return null
  const now = await $.clock.now()
  const chat = isInTurn && found.state !== 'waiting' ? withState(found, found.state, now) : found
  const next = change(chat, now)
  if (next === null) return found
  await $.fs.write(inFolder(dir, fileName(id)), chatText(next))
  lastBeat = now
  return next
}

/** Changes this session's own chat file, one change after the other, so a timer's write and a tool's never cross. */
function changeMine(
  $: EngineInterface, change: (chat: ChatFile, now: number) => ChatFile | null,
): Promise<ChatFile | null> {
  const run = mine.then(() => applyMine($, change), () => applyMine($, change))
  mine = run.catch(() => undefined)
  return run
}

/** Says what this session is doing now, when it is in the list: a turn runs, it asks the person, or it waits. */
async function say($: EngineInterface, state: ChatFile['state'], ended?: string): Promise<void> {
  try {
    const written = await changeMine($, (chat, now) => withState(ended === undefined ? chat : afterTurn(chat, ended, { asked: hasAsked }), state, now))
    if (written !== null) await refreshChats($)
  } catch {
    // the list is a convenience: a turn never fails over it
  }
}

/** Asks the board, as this chat: its name and its session, with the key from the board's file. */
async function askBoard($: EngineInterface, board: Board, path: string, more: Record<string, unknown> = {}): Promise<string | null> {
  if (myself === null) return null
  const answer = await $.http.fetch(`${board.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Board-Key': board.key },
    body: JSON.stringify({ chat: myself.name, session: await $.session.id(), ...more }),
  })

  return answer.ok ? answer.text : null
}

/**
 * B297: one call of the work tool, sent to the worker board as this chat: `{ ok, text }`, the board's answer or one
 * line saying why there is none. It never throws.
 */
async function workOnBoard($: EngineInterface, fields: Record<string, unknown>, request: string | null = null): Promise<WorkAnswer> {
  if (myself === null || chatsDir === null) return { ok: false, text: 'This chat is not in the list of chats: the work tool is for the chats of the list.' }
  try {
    const project = chatsDir.slice(0, chatsDir.length - CHATS_DIR.length - 1)
    const board = parseBoard(await $.fs.read(inFolder(project, BOARD_FILE)).catch(() => ''))
    if (board === null) return { ok: false, text: 'The worker board is not running: nothing was recorded. Try again once it runs.' }
    // B412: the call's request id: the board gives a repeat of it the first answer, so a call is recorded once.
    const answer = await $.http.fetch(`${board.url}${WORK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Board-Key': board.key, ...(request === null ? {} : { [REQUEST_HEADER]: request }) },
      // Who asks is the mod's to say, never the chat's.
      body: JSON.stringify({ ...fields, chat: myself.name, session: await $.session.id() }),
    })
    if (!answer.ok) return { ok: false, text: answer.text.trim() || `The worker board refused it (${answer.status}).`, status: answer.status }

    return { ok: true, text: answer.text, status: answer.status }
  } catch (error) {
    // B412: a board that took no connection has recorded nothing; one whose answer was cut off may have.
    const isRefused = /ECONNREFUSED/.test(String((error as { message?: unknown } | undefined)?.message ?? error))
    return { ok: false, text: 'The worker board did not answer: nothing was recorded. Try again in a moment.', isCut: true, isRefused }
  }
}

/** B412: one answer of the board to a work call; `isCut` when none came (`isRefused`: it took no connection). */
type WorkAnswer = { ok: boolean; text: string; status?: number; isCut?: boolean; isRefused?: boolean }

/** B412: a new request id for one work call: this session, the time, and the count of this process. */
async function newRequest($: EngineInterface): Promise<string> {
  requestCount += 1
  return `${await $.session.id()}-${String(await $.clock.now())}-${String(requestCount)}`.replace(/[^\w.:-]/g, '_').slice(-100)
}

/** B412: how often, and how far apart, the work tool asks again with the same request id when no answer came. */
const AGAIN_TRIES = 3
const AGAIN_MS = 2000

/**
 * B412: a call of the chat's own work tool: on an answer that was cut off (the board started anew, or took long) it is
 * asked again with the same request id, which the board answers with the first answer, also while the board starts
 * anew. Still without one, it says that it is not known whether the call was recorded, instead of "nothing was
 * recorded", so the chat looks first.
 */
async function workTool($: EngineInterface, fields: Record<string, unknown>): Promise<WorkAnswer> {
  const request = await newRequest($)
  let answer = await workOnBoard($, fields, request)
  // A board that took no connection has recorded nothing: that is said at once. Only a cut answer is asked again.
  if (answer.isCut !== true || answer.isRefused === true) return answer
  for (let tries = 0; answer.isCut === true && tries < AGAIN_TRIES; tries += 1) {
    await $.clock.sleep(AGAIN_MS)
    answer = await workOnBoard($, fields, request)
  }
  if (answer.isCut !== true) return answer
  return { ...answer, text: `${NOT_KNOWN} Run work next (or work list) to see whether it is there before you try again.` }
}

/** B412: what the work tool says when the board's answer was cut off and asking again brought none. */
const NOT_KNOWN = 'The worker board did not answer in time: not known whether it was recorded.'

/**
 * B298: one call of the work tool made by the mod itself (an instruction filed, a turn ended): the board's answer as
 * fields, or null when there is none (no board, no work store, a refusal). Silent: nothing changes for the chat when
 * the board does not take it; the board says on its own page what is wrong.
 */
async function workQuietly($: EngineInterface, fields: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const call = await workLate($, fields)
  return call.read
}

/**
 * B412: a call of the mod's own as `workQuietly`, which also says whether the board refused it (`isRefused`) or took
 * longer than it may hold anything (`late`: the call itself, still running, which gives its fields once the board
 * answers). A call that was late is never filed a second time: the board may have recorded it.
 */
async function workLate($: EngineInterface, fields: Record<string, unknown>): Promise<{ read: Record<string, unknown> | null; isRefused: boolean; late: Promise<Record<string, unknown> | null> | null }> {
  try {
    if (myself === null) await withinTime($, changeMine($, () => null))
    // Review of B298: a board that hangs or starts anew holds the person's prompt a moment at most.
    const running = workOnBoard($, fields, await newRequest($))
    const answer = await withinTime($, running)
    if (answer === null) return { read: null, isRefused: false, late: running.then(late => fieldsOf(late), () => null) }
    return { read: fieldsOf(answer), isRefused: !answer.ok && answer.isCut !== true, late: null }
  } catch {
    return { read: null, isRefused: false, late: null }
  }
}

/** B412: the fields of the board's answer to a mod's own call, or null; the open instructions it names are kept. */
function fieldsOf(answer: WorkAnswer): Record<string, unknown> | null {
  try {
    if (!answer.ok) return null
    const read: unknown = JSON.parse(answer.text)
    if (typeof read !== 'object' || read === null || Array.isArray(read)) return null
    const open = openFrom(read)
    if (open !== null) {
      openInstructions = open
      isOpenKnown = true
    }
    return read as Record<string, unknown>
  } catch {
    return null
  }
}

/** Review of B298: how long the mod's own calls to the board may hold a prompt, a turn's end or a form. */
const BOARD_WAIT_MS = 1500

/** Review of B298: the answer of `run`, or null when it takes longer than the board may hold anything. */
async function withinTime<T>($: EngineInterface, run: Promise<T>): Promise<T | null> {
  return Promise.race([run, $.clock.sleep(BOARD_WAIT_MS).then(() => null, () => null)])
}

/** Pause 2: the pause state, read from the board unless the last reading is younger than `PAUSE_MS`. Never throws. */
async function pauseNow($: EngineInterface, isFresh = false): Promise<PauseState | null> {
  try {
    const now = await $.clock.now()
    if (!isFresh && pauseRead !== null && now - pauseRead.at < PAUSE_MS) return pauseRead.pause
    const read = await workQuietly($, { action: 'pause-state' })
    pauseRead = { pause: parsePause(read), at: now }
    return pauseRead.pause
  } catch {
    return null
  }
}

/**
 * Pause 2: the pause's lines for this chat where it is (`pauseContexts`), each once. At a prompt the board is asked
 * only at the first one of this process, while the last reading was a pause or a resume, or when the words speak of a
 * resume (the board's "resume", the main chat's "resume your step": then anew); else the last reading stands.
 */
async function pauseLines($: EngineInterface, where: PauseWhere, text = ''): Promise<string[]> {
  try {
    if (myself === null) await withinTime($, changeMine($, () => null))
    if (myself === null) return []
    const isFirst = where === 'prompt' && isFirstPrompt
    if (where === 'prompt') isFirstPrompt = false
    // Words of a resume come right after Resume all: they are read anew, whatever the last reading said.
    const isResume = where === 'prompt' && /\bresume\b/i.test(text)
    const isAsked = where !== 'prompt' || isFirst || isResume || pauseRead?.pause?.state !== 'running'
    const pause = isAsked ? await pauseNow($, isResume) : pauseRead?.pause ?? null
    if (where === 'prompt' && isAsked && !isInTurn) isReadForTurn = true
    // The review of Pause 2: the main chat is told whom to wake once per resume, also over a new process of its chat.
    const resumeKey = pause?.state === 'resuming' && myself.role === 'main' ? `resume:${String(pause.since ?? 0)}` : null
    const store = resumeKey === null ? null : resumeGivenKey(await $.session.id())
    if (store !== null && resumeKey !== null && !pauseGiven.has(resumeKey)) {
      const told = await withinTime($, $.store.get(store).catch(() => undefined))
      if (told === pause?.since) pauseGiven.add(resumeKey)
    }
    const hadResume = resumeKey !== null && pauseGiven.has(resumeKey)
    const lines = pauseContexts(pause, { role: myself.role, where, given: pauseGiven, isFirst, turn: turnNumber })
    if (store !== null && resumeKey !== null && !hadResume && pauseGiven.has(resumeKey)) await $.store.set(store, pause?.since ?? 0).catch(() => undefined)

    return lines
  } catch {
    return []
  }
}

/** B300: whether this chat is a worker whose card holds no task, or only one it reported: it is free for the next. */
async function holdsNothing($: EngineInterface): Promise<boolean> {
  try {
    if (myself?.role !== 'worker') return false
    const dir = await findChatsDir($)
    const mine = dir === null ? null : await readChat($, dir, await $.session.id())

    return mine !== null && (mine.task === null || mine.task.isReported)
  } catch {
    return false
  }
}

/** B299: files the questions of the app's question form on the board as asks: `[{ id, text }]` of those it took. */
async function fileForm($: EngineInterface, input: unknown): Promise<FiledForm[]> {
  const filed: FiledForm[] = []
  try {
    const questions = formQuestions(input)
    if (questions.length === 0) return filed
    const dir = await findChatsDir($)
    const of = dir === null ? null : cardStep(await readChat($, dir, await $.session.id()))
    for (const question of questions) {
      const ask = { action: 'ask', kind: 'decide', via: 'form', text: question.text, options: question.options }
      // Under the card's step when the board takes it there, else on its own. B412: only when the board refused it
      // under the step: one that answered late may have filed it, and its ask is closed once the late answer comes.
      let call = of === null ? null : await workLate($, { ...ask, of })
      if (call === null || call.isRefused) call = await workLate($, ask)
      const id = idOf(call.read)
      if (id !== null) filed.push({ id, text: question.text })
      else if (call.late !== null) filed.push({ id: call.late.then(idOf), text: question.text })
    }
  } catch {
    // the form is asked all the same
  }
  return filed
}

/** B412: an ask filed for a question of the form: its id, or the late answer that brings it. */
type FiledForm = { id: string | Promise<string | null>; text: string }

/** B412: the id of the ask a call filed, or null. */
const idOf = (read: Record<string, unknown> | null): string | null => (typeof read?.id === 'string' ? read.id : null)

/** Tells the board what became of the messages this chat took: typed here, or not. */
async function reportTyped($: EngineInterface, board: Board, typed: string[], failed: string[]): Promise<void> {
  try {
    await askBoard($, board, TYPED_PATH, { typed, failed })
  } catch {
    // the board shows the message as handed to this chat; the chat itself shows whether it arrived
  }
}

/**
 * Takes from the worker board what the person answered or typed there for this chat, and types it here as their
 * own words; the engine runs it once the chat is idle. The board marks a message taken when it hands it out, and
 * is told afterwards whether it was typed. Only a chat in the list asks, under its own name and session. Without
 * the board's file no board runs, and none is asked.
 */
async function takeFromBoard($: EngineInterface): Promise<void> {
  if (isTaking || myself === null || chatsDir === null) return
  isTaking = true
  try {
    // The project's folder is the one that holds `.claude/chats`.
    const project = chatsDir.slice(0, chatsDir.length - CHATS_DIR.length - 1)
    const board = parseBoard(await $.fs.read(inFolder(project, BOARD_FILE)))
    if (board === null) return
    const answer = await askBoard($, board, TAKE_PATH)
    if (answer === null) return
    const taken = parseTaken(answer)
    if (taken.refused.length > 0) void reportTyped($, board, [], taken.refused)
    for (const message of taken.messages) {
      if (typedIds.has(message.id)) continue
      typedIds.add(message.id)
      void $.prompt.submit({ text: message.text, asUser: true }).then(
        // A prompt a hook dropped did not enter the chat, though the call itself went well.
        entered => (entered.drop === undefined ? reportTyped($, board, [message.id], []) : reportTyped($, board, [], [message.id])),
        () => reportTyped($, board, [], [message.id]),
      )
    }
  } catch {
    // no board runs, or it did not answer: it is asked again at the next tick
  } finally {
    isTaking = false
  }
}

/**
 * Runs a board as a child of this chat's process, for as long as both live: the loop is the child's life. What it
 * prints is not kept.
 */
async function runBoard($: EngineInterface, board: BoardStart, cwd: string): Promise<void> {
  try {
    for await (const piece of $.process.spawn({ argv: board.argv, cwd })) void piece
  } catch {
    // it could not start, or another chat's copy has the port: it is looked at again
  }
}

/**
 * Keeps the project's boards running: the launch entries the list of chats names under "boards". After the app
 * was closed the boards are gone with it; the first chat of the project that opens starts them again. Only a chat
 * in the list does this, and a board that does not come up is tried once a minute, not at every look.
 */
async function keepBoards($: EngineInterface): Promise<void> {
  if (isLookingAtBoards || myself === null || chatsDir === null) return
  const now = await $.clock.now()
  if (now - lastBoardsLook < BOARDS_MS) return
  lastBoardsLook = now
  isLookingAtBoards = true
  try {
    const project = chatsDir.slice(0, chatsDir.length - CHATS_DIR.length - 1)
    const boards = boardStarts(await $.fs.read(inFolder(chatsDir, LIST_FILE)), await $.fs.read(inFolder(project, LAUNCH_FILE)))
    for (const board of boards) {
      let isUp = true
      try {
        await $.http.fetch(board.url)
      } catch {
        isUp = false
      }
      if (isUp || now - (startTried.get(board.name) ?? -Infinity) < BOARD_RETRY_MS) continue
      startTried.set(board.name, now)
      void runBoard($, board, project)
    }
  } catch {
    // no list, no launch entries: the project keeps no board
  } finally {
    isLookingAtBoards = false
  }
}

/** How large the conversation is, in tokens; null when the engine does not say. */
async function sizeNow($: EngineInterface): Promise<number | null> {
  const { context } = await $.session.usage()
  if (typeof context.tokens === 'number') return context.tokens
  return typeof context.percent === 'number' && typeof context.window === 'number' ? Math.round((context.percent / 100) * context.window) : null
}

/** One line for the person, for a while. Where none can be shown, nothing else fails for it. */
async function tell($: EngineInterface, text: string): Promise<void> {
  try {
    await $.ui.toast(text, { timeoutMs: TELL_MS })
  } catch {
    // nowhere to show it
  }
}

/**
 * B63: compacts this chat when the turn in which it reported its task has ended, if it is large and at rest (see
 * `compactWhy`). It says in one line what it did, and keeps the sizes in the chat's file for the board. A
 * compaction that is refused, or that cannot run, leaves the conversation as it is.
 */
async function compactAfter($: EngineInterface, at: { moreFollows: boolean }): Promise<void> {
  // B227: every way out says why on the chat's card, so the board and the main chat can see it; the unexpected ones
  // also in one line on the screen.
  const note = async (why: string, isExpected = false): Promise<void> => {
    if (!isExpected) await tell($, `Not compacted after this task: ${why}`)
    try {
      const now = await $.clock.now()
      await changeMine($, mine => ({ ...mine, compactNote: { at: now, why } }))
    } catch {
      // only the card does not learn of it
    }
  }
  const dir = await findChatsDir($)
  if (dir === null) return
  const list = parseList(await $.fs.read(inFolder(dir, LIST_FILE)).catch(() => ''))
  const chat = await readChat($, dir, await $.session.id())
  if (list === null || chat === null) return note('the list of chats or this chat\'s card could not be read')
  const before = await sizeNow($).catch(() => null)
  const why = compactWhy(chat, { ...at, tokens: before, above: list.compactAbove ?? 0 })
  if (why !== null) return note(why, /small enough|main chat|switched off/.test(why))
  let done: Awaited<ReturnType<EngineInterface['session']['compact']>>
  try {
    done = await $.session.compact({ instructions: compactKeep(`${list.prefix}${chat.name}`, `${list.prefix}${list.main}`) })
  } catch (err) {
    // B227: in the desktop app's chats (SDK sessions) the engine compacts only inside a turn, as /compact: the mod
    // runs that command, queued for when this chat is idle, and does not wait for it (this turn would wait on it).
    if (/headless|\/compact/i.test(reason(err))) return compactByCommand($, compactKeep(`${list.prefix}${chat.name}`, `${list.prefix}${list.main}`), before, note)
    return note(reason(err))
  }
  if (typeof done.skip === 'string') {
    if (/headless|\/compact/i.test(done.skip)) return compactByCommand($, compactKeep(`${list.prefix}${chat.name}`, `${list.prefix}${list.main}`), before, note)
    return note(done.skip)
  }
  // The engine's own count when it has one: the status line's figure is from the last request, before the compaction.
  const sizes = { before: done.tokensBefore ?? before, after: done.tokensAfter ?? 0 }
  const thousands = (tokens: number): string => `${Math.round(tokens / 1000)},000`
  await tell($, `Compacted after the reported task: ${thousands(sizes.before)} tokens before${sizes.after > 0 ? `, ${thousands(sizes.after)} after` : ''}.`)
  try {
    const now = await $.clock.now()
    await changeMine($, mine => ({ ...mine, compacted: { at: now, ...sizes }, compactNote: undefined }))
  } catch {
    // the conversation is compacted all the same; only the board does not learn of it
  }
}

/**
 * B227: the compaction as the person's /compact would run it, once this chat is idle: the card says it is on its way,
 * then the sizes, or why it did not run. `before` is the size when the report's turn ended.
 */
async function compactByCommand($: EngineInterface, instructions: string, before: number, note: (why: string) => Promise<void>): Promise<void> {
  try {
    const now = await $.clock.now()
    await changeMine($, mine => ({ ...mine, compactNote: { at: now, why: 'compacting with /compact once this chat is idle' } }))
  } catch {
    // the card only learns of it later
  }
  void $.command.run({ command: 'compact', args: instructions }).then(async () => {
    const after = await sizeNow($).catch(() => null)
    const thousands = (tokens: number): string => `${Math.round(tokens / 1000)},000`
    const isSmaller = after !== null && after < before
    await tell($, `Compacted after the reported task: ${thousands(before)} tokens before${isSmaller ? `, ${thousands(after)} after` : ''}.`)
    const at = await $.clock.now()
    await changeMine($, mine => ({ ...mine, compacted: { at, before, after: isSmaller ? after : 0 }, compactNote: undefined }))
  }, (err: unknown) => note(`/compact did not run: ${reason(err)}`)).catch(() => null)
}

/** Every few seconds: read the list for the pane and, while a turn of this session runs, write its file again. */
async function tick($: EngineInterface): Promise<void> {
  try {
    // Only a turn this process saw start keeps its file alive: a file left "working" by a closed app is not renewed.
    if (isInTurn && (await $.clock.now()) - lastBeat >= BEAT_MS) await changeMine($, chat => (chat.state === 'waiting' ? null : chat))
  } catch {
    // tried again at the next tick
  }
  await refreshChats($)
  await keepBoards($)
  await takeFromBoard($)
}

/** Keeps the pane in step with the chat list, once the project has one. */
function ensureChatWatch($: EngineInterface): void {
  if (chatWatch !== null || chatsDir === null) return
  chatWatch = $.clock.every(CHATS_MS, () => {
    void tick($)
  })
}

/** Writes a chat's file as one that left the list. */
async function writeLeft($: EngineInterface, path: string): Promise<void> {
  await $.fs.write(path, LEFT_TEXT)
}

/**
 * Writes this session into the list under a name, keeping its task; the first chat of a project starts the list.
 * An older file under the same name (a closed chat of the same title) is left alone: the list shows the one written
 * last, so two open chats of one title never put each other out.
 */
async function applyJoin($: EngineInterface, name: string, role: ChatRole, state: ChatFile['state']): Promise<void> {
  const dir = (await findChatsDir($, true)) ?? inFolder(await $.session.root(), CHATS_DIR)
  const id = await $.session.id()
  const before = await readChat($, dir, id)
  const at = await $.clock.now()
  const chat: ChatFile = before === null ? { name, role, state: 'waiting', task: null, at } : { ...before, name, role }
  await $.fs.write(inFolder(dir, fileName(id)), chatText(state === 'working' ? withState(chat, 'working', at) : chat))
  chatsDir = dir
  lastBeat = at
  myself = { name, role }
  ensureChatWatch($)
}

/** Puts this session in the list under a name, or renames it. */
async function join($: EngineInterface, name: string, role: ChatRole, state: ChatFile['state']): Promise<void> {
  const run = mine.then(() => applyJoin($, name, role, state), () => applyJoin($, name, role, state))
  mine = run.catch(() => undefined)
  await run
  await refreshChats($)
}

/**
 * A chat whose title says it is one of the project's joins the list by itself, and follows a new title: the
 * project's `.claude/chats/list.json` names the titles' shared beginning.
 */
async function joinByTitle($: EngineInterface, title: unknown): Promise<void> {
  try {
    if (typeof title !== 'string' || title.trim() === '') return
    const dir = await findChatsDir($, true)
    if (dir === null) return
    const list = parseList(await $.fs.read(inFolder(dir, LIST_FILE)))
    const named = list === null ? null : nameFromTitle(title.trim(), list)
    if (named === null) return
    let own = ''
    try {
      own = await $.fs.read(inFolder(dir, fileName(await $.session.id())))
    } catch {
      // it keeps no file yet
    }
    // A chat that was taken out stays out until it is asked to join again.
    if (hasLeft(own)) return
    const before = parseChat(own)
    if (before?.name !== named.name || before.role !== named.role) await join($, named.name, named.role, isInTurn ? 'working' : 'waiting')
  } catch {
    // no list.json, or the folder cannot be read: the chat joins when asked to
  }
}

/** Writes every file under a name as one that left; true when this session's own was among them. */
async function applyLeave($: EngineInterface, dir: string, name: string): Promise<boolean> {
  const id = await $.session.id()
  let isMine = false
  for (const row of await readFiles($)) {
    if (row.name.toLowerCase() !== name.toLowerCase()) continue
    await writeLeft($, inFolder(dir, fileName(row.id)))
    isMine = isMine || row.id === id
  }
  if (isMine) myself = null
  return isMine
}

/**
 * Takes a chat out of the list: this session's, or the one a name means (a chat that was closed for good). Its
 * file stays, and describes no chat.
 */
async function leave($: EngineInterface, name: string | undefined): Promise<string> {
  const dir = await findChatsDir($)
  if (dir === null) return 'This chat is not in the list.'
  const own = await readChat($, dir, await $.session.id())
  if (name === undefined && own === null) return 'This chat is not in the list.'
  const wanted = name ?? own?.name ?? ''
  const found = (await readChats($)).find(row => row.name.toLowerCase() === wanted.toLowerCase())
  if (found === undefined) return `No chat in the list is named "${wanted}".`
  const run = mine.then(() => applyLeave($, dir, wanted), () => applyLeave($, dir, wanted))
  mine = run.catch(() => undefined)
  await run
  await refreshChats($)

  return name === undefined ? 'This chat is out of the list.' : `"${found.name}" is out of the list.`
}

/** Changes this session's task line and answers the line as the list now shows it. */
async function setTask($: EngineInterface, change: (chat: ChatFile) => TaskChange): Promise<string> {
  let error: string | undefined
  const written = await changeMine($, chat => {
    const changed = change(chat)
    error = changed.error
    return changed.chat ?? null
  })
  if (written === null) return 'This chat is not in the list: nothing was recorded.'
  if (error !== undefined) return error
  const chats = await loadChats($)
  const me = chats.rows.find(row => row.id === chats.me)

  return me === undefined ? 'Recorded.' : `Recorded. The list shows: ${status(me, chats.rows, chats.now).text}`
}

/** A number the model gave, which may arrive as text; undefined when it gave none. */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined
}

/** Notes this session's agents, by id and by name, so a message to one is told from a message to another chat. */
async function noteAgents($: EngineInterface): Promise<void> {
  try {
    for (const agent of await $.agent.list()) {
      ownAgents.add(agent.id)
      if (agent.name !== undefined) ownAgents.add(agent.name)
      if (agent.teammateId !== undefined) ownAgents.add(agent.teammateId)
    }
  } catch {
    // the ones seen so far stand
  }
}

/** True when a message's recipient is one of this session's own agents: a subagent or a teammate, no other chat. */
async function isOwnAgent($: EngineInterface, to: string): Promise<boolean> {
  const name = to.replace(/\s\[[^\]]*\]$/, '').trim()
  await noteAgents($)

  return ownAgents.has(name) || isAgentId(name)
}

async function openPane($: EngineInterface): Promise<string> {
  try {
    const opened = await $.ui.open({ id: PANE, title: 'Git' })
    return opened.isPlaced ? 'The Git pane is open.' : `The Git pane is open but not drawn here (${opened.reason}).`
  } catch (err) {
    return `The Git pane could not be opened (${reason(err)}).`
  }
}

async function openWorkers($: EngineInterface): Promise<string> {
  try {
    const opened = await $.ui.open({ id: WORKERS, title: 'Workers' })
    return opened.isPlaced ? 'The Workers pane is open.' : `The Workers pane is open but not drawn here (${opened.reason}).`
  } catch (err) {
    return `The Workers pane could not be opened (${reason(err)}).`
  }
}

/** The tool a chat keeps its line with. */
const CHAT_TOOL = {
  name: 'chat',
  description: "The person's list of chats for this project (one main chat that hands out work, workers that "
    + 'do it), which the Workers pane and the worker board show them. A chat keeps its own card. "plan" records what '
    + 'this chat works on: "text" (the topic, two to five words), "names" (its steps by name, three to six, each a '
    + 'few words; or "steps", only how many there are), "minutes" (the working time still expected for the whole '
    + 'task, roughly) and "stepMinutes" (for the step it is on). "step" moves to the next step, or to the one in '
    + '"step"; with "minutes" and "stepMinutes" it also sets the times still expected. '
    + '"done" clears the card (a worker\'s clears by itself when it reports its step with the work tool and its turn ends). '
    + 'Call it together with another tool call, never alone. "list" reads the line of every chat. '
    + '"join" puts this chat in the list as "name" with "role" main or worker, and "leave" takes it out (with '
    + '"name", the chat of that name instead: one that was closed for good): only when the person or the main chat '
    + 'asks.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'plan', 'step', 'done', 'join', 'leave'] },
      text: { type: 'string', description: 'plan: the task in two to five words.' },
      names: { type: 'array', items: { type: 'string' }, description: 'plan: the steps by name, in order, each two to five words.' },
      steps: { type: 'integer', description: 'plan: how many steps the plan has, when they are not named.' },
      minutes: { type: 'number', description: 'plan, step: the working time still expected for the whole task, roughly.' },
      stepMinutes: { type: 'number', description: 'plan, step: the working time the step you are on (or move to) still takes, roughly.' },
      step: { type: 'integer', description: 'step: the step this chat is on now, when it is not simply the next.' },
      name: { type: 'string', description: 'join: the name this chat is listed under. leave: another chat to take out.' },
      role: { type: 'string', enum: ['main', 'worker'], description: 'join: worker when left out.' },
    },
    required: ['action'],
  },
}

/** B297: the tool a chat works its items with: the worker board's work store. */
const WORK_TOOL = {
  name: 'work',
  description: "The project's work items, kept by the person's worker board: one record per step, per ask for the "
    + 'person, per instruction and per note. The flow file says who moves an item and when; the board refuses a move '
    + 'the flow does not allow, with one line saying why. Work from the record it answers. "next": your open '
    + 'instructions and your steps, the first in full. "take" ("id", "branch"): start a step queued for you; it also '
    + 'names your card after the step. "step" ("id", "step", "names", "minutes", "stepMinutes"): the step of your plan '
    + "you are on, as the chat tool's \"plan\" and \"step\", which it writes to your card too; with \"commit\" (the hash, or none) "
    + 'and "next" (the next action, one line) it writes the step\'s checkpoint: write a checkpoint with every commit and when '
    + 'the person pauses, so the chat goes on from it after a restart. "ask" ("of" the step, "kind" '
    + 'decide, look, provide or do, "blocking", "text", "options", "advice", "pictures", "play"): something only the person can '
    + 'do; put the "For you" block it answers into your answer (a decide or look with options or advice may go to your partner first: then it says so, and you write none). "withdraw" ("id", "why"): take your own ask back when '
    + 'it is no longer needed (the main chat: also an ask with no asking chat, with a why); a step that waited on it goes '
    + 'on. "answered-in-chat" ("id", "text"): the person answered one of your asks here in the chat (the main chat and the '
    + 'Advisor: also an ask with no asking chat, one carried over from the old backlog): their words, with the date, so '
    + 'the board no longer shows it open. "note" ("to" you or main, "text", "of"): information, '
    + 'never a question; the partner\'s daily note on the focus goal is a note to you with "of" G<n>, "decided" and "needs". "report" ("id", "result", "merged"): your step is done (the only way to end it: no message does); the board checks it and tells the main '
    + 'chat. "block" and "unblock" ("id", "on"); "unblock" without "on" (the main chat): clears what the step "Waits for". "new" ("title", "activity", "goal", "text", "priority", "standard"): a new step. "queue" ("id", '
    + '"for", "after", "about", "priority"; "priority" fix: a fix for the worker board, first in its worker\'s queue), "requeue" ("id", "for": a queued step to another chat) and "unqueue" ("id": out of its '
    + 'queue): the main chat. "close" ("id", "as"): an instruction is done, and what came of it. "drop" '
    + '("id", "why"). "refine" ("id", "summary", "picture", "goal", "size", "standard", "questions") and "refined" ("id", "what", "standard"): '
    + 'the Advisor. "checked" ("id", "evidence", "points", "score"): the partner files the result check of a step in review, by a helper that did not build it. "vibe-draft" ("goal", "lines", "picture") and "how-draft" ("goal", "parts", "partnerDecides", "youDecide"): '
    + 'the partner (the Advisor) keeps its draft of the focus goal\'s vibe and how on the board; each call takes the place '
    + 'of the draft the goal had. "list": every item. "rename" ("from", "to"): the main chat: every open item naming the old '
    + 'name of a chat moves to its new name, for a rename the board could not follow itself (a chat replaced by a new one). '
    + '"partner-answer" ("id", "text", "why"): the partner answers an ask the board routed to it for the person ("text" its '
    + 'answer, normally the advice; "why" one line); the asking chat is woken as with the person\'s answer, and the answer '
    + 'stands in the partner\'s daily note with an Undo. "escalate" ("id", "why"): the partner hands a routed ask to the person.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: WORK_ACTIONS },
      id: { type: 'string', description: 'The item: B12 (a step), Q3 (an ask), I4 (an instruction).' },
      branch: { type: 'string', description: 'take: the branch you work the step on.' },
      step: { type: 'integer', description: 'step: the step of your plan you are on now.' },
      steps: { type: 'integer', description: 'step: how many steps your plan has, when they are not named.' },
      names: { type: 'array', items: { type: 'string' }, description: 'step: your steps by name, in order.' },
      minutes: { type: 'number', description: 'step: the working time still expected for the whole step, roughly.' },
      stepMinutes: { type: 'number', description: 'step: the working time the step of your plan you are on still takes.' },
      of: { type: 'string', description: 'ask, note: the step it belongs to; the partner: also the focus goal (G6).' },
      kind: { type: 'string', enum: ['decide', 'look', 'provide', 'do'], description: 'ask: what you ask of the person.' },
      blocking: { type: 'boolean', description: 'ask: true when your work waits for the answer.' },
      text: { type: 'string', description: 'ask, note, new: the words; partner-answer: your answer, normally the advice.' },
      options: { type: 'array', items: { type: 'string' }, description: 'ask: the options, each with its letter ("A thin").' },
      advice: { type: 'string', description: 'ask: the option you advise, in a few words ("B").' },
      pictures: { type: 'array', items: { type: 'string' }, description: 'ask: pictures to look at, as paths in the project.' },
      play: { type: 'string', description: "ask: where to play it, as the board's play link names it." },
      to: { type: 'string', description: "note: you (the person) or main (the main chat). rename: the chat's new name." },
      result: { type: 'string', description: 'report: what the person gets now, in a line.' },
      merged: { type: 'string', description: 'report: the commit it was merged with.' },
      on: { type: 'string', description: 'block, unblock: the step it waits on; unblock without it clears Waits for.' },
      title: { type: 'string', description: "new: the step's title." },
      activity: { type: 'string', description: 'new: the activity it belongs under.' },
      goal: { type: 'string', description: 'new, refine: the goal it serves (G17); vibe-draft, how-draft: the focus goal.' },
      for: { type: 'string', description: 'queue: the chat it is for.' },
      after: { type: 'string', description: 'queue: the steps it waits on, or what it waits for.' },
      about: { type: 'string', description: 'queue: how long it takes, roughly ("1 h").' },
      as: { type: 'string', description: 'close: what came of the instruction ("made step B300").' },
      why: { type: 'string', description: 'drop: why; partner-answer, escalate: why, in one line.' },
      summary: { type: 'string', description: 'refine, and new from an agreed how: the step in a few lines.' },
      picture: { type: 'string', description: 'refine: the picture of what it makes; vibe-draft: the vibe\'s picture.' },
      size: { type: 'string', description: 'refine, and new from an agreed how: how long it takes, roughly.' },
      standard: { type: 'string', description: 'refine, refined and new: what the step\'s result is checked against, "<kind> · <reference picture> · target <score>" (a kind of the project\'s settings), or "none (<why>)".' },
      evidence: { type: 'string', description: 'checked: the evidence picture\'s path in the project (the result beside its reference, the points ticked), or "none (<why>)".' },
      points: { type: 'array', items: { type: 'string' }, description: 'checked: every agreed point of the step, each "pass: <point>", "fail: <point>" or "ask: <point>" (a point only the person can judge).' },
      score: { type: 'string', description: 'checked: the score beside its target, "82 of 75", where the kind\'s definition of done has a rubric.' },
      questions: { type: 'array', items: { type: 'string' }, description: 'refine: the questions for the person.' },
      what: { type: 'array', items: { type: 'string' }, description: 'refined, and new from an agreed how (the partner: with goal and summary, the step is made refined): what we build, one part per line.' },
      lines: { type: 'array', items: { type: 'string' }, description: 'vibe-draft: three to five short lines of the vibe, one "Not in it: ..." among them.' },
      parts: { type: 'array', items: { type: 'string' }, description: 'how-draft: the parts, each "<title> · about <N> h", with " · steps B1, B2" once made.' },
      partnerDecides: { type: 'array', items: { type: 'string' }, description: 'how-draft: the details you settle yourself, one per line.' },
      youDecide: { type: 'array', items: { type: 'string' }, description: 'how-draft: what you bring to the person, one per line.' },
      decided: { type: 'array', items: { type: 'string' }, description: 'note of a goal (the daily note): what you decided for the person, one short line each.' },
      needs: { type: 'array', items: { type: 'string' }, description: 'note of a goal (the daily note): the ids of your open asks that need the person (Q12).' },
      from: { type: 'string', description: "rename: the chat's old name." },
      commit: { type: 'string', description: 'step: the checkpoint\'s commit, its hash, or none.' },
      next: { type: 'string', description: 'step: the checkpoint\'s next action, in one line.' },
      priority: { type: 'string', enum: ['fix'], description: 'new, queue: "fix" marks the step a fix for the worker board (the main chat, the partner): it goes first in its worker\'s queue.' },
    },
    required: ['action'],
  },
}

/**
 * Starts the chat list in this session: the tool, the first reading, the timer. True when chats are listed. It never
 * fails: the folders show whatever becomes of the list.
 */
async function startChats($: EngineInterface): Promise<boolean> {
  try {
    hasLooked = false
    lastBeat = 0
    const dir = await findChatsDir($)
    // In a project that keeps a list the chats use the tool at every task; elsewhere it waits behind tool search.
    await $.tool.register({ ...CHAT_TOOL, isDeferred: dir === null })
    await $.tool.register({ ...WORK_TOOL, isDeferred: dir === null })
    if (dir === null) return false
    // No turn of this process runs at its start: a file left "working" (the app was closed in the middle of a turn)
    // is set right, and the chat learns who it is in the list.
    await changeMine($, (chat, now) => (chat.state === 'waiting' ? null : withState(chat, 'waiting', now)))
    const chats = await loadChats($)
    ensureChatWatch($)

    return chats.rows.length > 0
  } catch {
    return false
  }
}

/** The word about a card without a time, at the right batch of tool calls; none most of the time. */
async function cardReminder($: EngineInterface): Promise<string[]> {
  try {
    if (reminders >= REMIND_MOST) return []
    batches += 1
    if (batches < REMIND_AFTER || (batches - REMIND_AFTER) % REMIND_EVERY !== 0) return []
    const dir = await findChatsDir($)
    const chat = dir === null ? null : await readChat($, dir, await $.session.id())
    const lacks = chat === null ? null : cardGap(chat, TOOL, await $.clock.now())
    // A card with a task that this request has not touched may be the one before: that is asked first, once.
    const old = chat === null || isCardSeen ? null : cardOld(chat, TOOL)
    const gap = old ?? lacks
    if (gap === null) return []
    if (old !== null) isCardSeen = true
    reminders += 1

    return [gap]
  } catch {
    return []
  }
}

/** The chats as lines of text, for the command's answer. */
async function chatLines($: EngineInterface): Promise<string> {
  try {
    if ((await findChatsDir($, true)) === null) return chatsSummary([], 0)
    const chats = await loadChats($)
    ensureChatWatch($)

    return chatsSummary(chats.rows, chats.now)
  } catch (err) {
    return `The list of chats could not be read (${reason(err)}).`
  }
}

/** The turn of this session's main conversation starts: the chat a /clear ended goes on under its new id. */
async function turnStarts($: EngineInterface): Promise<void> {
  isInTurn = true
  try {
    if (carried !== null) {
      const { name, role } = carried
      carried = null
      await join($, name, role, 'working')
    }
  } catch {
    // it joins again by its title, or when asked
  }
  await say($, 'working')
}

/** A /clear ends this conversation and the process goes on under a new session id: the chat moves with it. */
async function sessionCleared($: EngineInterface, id: string): Promise<void> {
  try {
    const dir = await findChatsDir($)
    const chat = dir === null ? null : await readChat($, dir, id)
    if (dir === null || chat === null) return
    await writeLeft($, inFolder(dir, fileName(id)))
    carried = { name: chat.name, role: chat.role }
    myself = null
  } catch {
    // the old file stays; a chat that joins under its name takes its place
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'git',
      description: "Open the Git pane: this folder's folders and the git branch each is on",
    })
    await $.command.register({
      name: 'workers',
      description: "Open the Workers pane: the project's chats, who is working on what, and whose turn it is",
    })
    const view = await load($)
    ensureWatch($)
    const hasChats = await startChats($)
    // Review of B298: a chat started anew learns once which of the person's instructions are still open.
    if (myself !== null) void workQuietly($, { action: 'next' })
    // Each pane opens unasked only where it has something to show: a branch, a chat.
    if (view.rows.some(row => row.branch !== null)) void openPane($)
    if (hasChats) void openWorkers($)

    return next(e)
  })

  // The app gives a chat's title to the classic hooks: a chat of the project joins the list under it.
  on('classic.SessionStart', async ($, e, next) => {
    await joinByTitle($, e.session_title)
    const result = await next(e)
    // Pause 2: a main chat that starts while the person resumes learns whom to wake; a chat holding a step, its checkpoint.
    const lines = e.agent_type === undefined ? await pauseLines($, 'start') : []

    return lines.length === 0 ? result : { ...result, additionalContext: [...(result.additionalContext ?? []), ...lines] }
  })

  on('prompt.submit', async ($, e, next) => {
    // B298: the person's words are filed on the worker board before the turn sees them, also while a turn runs (the app
    // holds them until then): nothing they say is lost. Beside the prompt, for the model only, its id and the person's
    // instructions still open (review: never in the system prompt, which stays the same words and stays cached).
    const context: string[] = []
    if (e.command === undefined) {
      // Pause 2: read beside the filing, so both hold the prompt 1.5 s at most together.
      const paused = pauseLines($, 'prompt', e.text)
      if (isFiled(e.text, e.origin)) {
        const filed = await workQuietly($, { action: 'instruction', text: e.text })
        const said = typeof filed?.id === 'string' ? recordedLine([filed.id], []) : null
        if (said !== null) context.push(said)
      } else if (!isOpenKnown && myself !== null) await workQuietly($, { action: 'next' })
      const open = instructionsLine(openInstructions)
      if (open !== null) context.push(open)
      const asked = blockAsksLine(blockAsks)
      blockAsks = []
      if (asked !== null) context.push(asked)
      context.push(...await paused)
    }

    return next(context.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...context] })
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await joinByTitle($, e.session_title)

    return next(e)
  })

  // A chat in the list learns here how the list is kept: the same words at every request, so the prompt stays cached.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (myself === null) return composed
    const me: ChatFile = { ...myself, state: 'waiting', task: null, at: 0 }

    return { ...composed, sections: [...composed.sections, { id: 'folder-branches:chat', text: `${chatNote(me, TOOL)}${BOARD_NOTE}`, scope: 'session' }] }
  })

  // A working chat without a time on its card is told so, with the results of a batch of tool calls it made
  // anyway: no step of its own, and nothing for a request that is answered without tools.
  // Pause 2: the same batch carries the person's pause: while pausing, the chat is told once to checkpoint and stop.
  on('classic.PostToolBatch', async ($, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined || !isInTurn || myself === null) return result
    const more = [...await pauseLines($, 'batch'), ...await cardReminder($)]

    return more.length === 0 ? result : { ...result, additionalContext: [...(result.additionalContext ?? []), ...more] }
  })

  on('turn.start', async ($, e, next) => {
    // A turn that starts while one runs is a subagent's inside the chat's own: it starts nothing again.
    if (!isInTurn) {
      batches = 0
      reminders = 0
      turnStartedAt = await $.clock.now()
      isTurnEndTold = false
      isCardSeen = false
      hasAsked = false
      hasReported = false
      // The review of Pause 2: each turn reads the pause anew at its first batch, unless its prompt just read it.
      turnNumber += 1
      if (!isReadForTurn) pauseRead = null
      isReadForTurn = false
      // A report from a turn that was cut short does not count for this one.
      await changeMine($, chat => atTurnStart(chat)).catch(() => null)
    }
    await turnStarts($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      if (e.agentId === undefined) {
        isInTurn = false
        await say($, 'waiting', e.reason)
        // B63: the step was reported in this turn (B301: `work report`) and the turn has ended: the moment a large chat
        // is compacted. Both words are used up here, so neither a second end of the same turn nor a later step finds them.
        const isReported = hasReported && e.reason === 'answer'
        const at = { moreFollows }
        hasReported = false
        moreFollows = false
        if (isReported) await compactAfter($, at).catch(err => tell($, `Not compacted after this task: ${reason(err)}`))
        // B298: a turn that answered has ended: the board marks the instructions filed before it and still open as missed.
        if (e.reason === 'answer' && !isTurnEndTold && turnStartedAt !== null) {
          isTurnEndTold = true
          const since = turnStartedAt
          const forYou = forYouItems(e.answer)
          // B300: a worker that holds nothing pulls with the same call, once per turn: when a step queued for it may be
          // taken now, the board puts its line ("work: B286 is yours; run work next") into the outbox once, and it is
          // typed here at once. All of it holds the turn's end 1.5 s at most; a board without a work store refuses, and
          // nothing changes for the chat (the board says so on its page). B317: an answer that ends with a "For you" block
          // hands its items over in the same call; the board files those the chat filed no ask for (Via: chat).
          await withinTime($, (async () => {
            // The review of Pause 2: while the person pauses (until running) a free worker takes nothing new.
            const pulls = !isPaused(pauseRead?.pause ?? null) && await holdsNothing($)
            const ended = await workQuietly($, { action: 'turn-ended', since, ...(pulls ? { pull: true } : {}), ...(forYou.length > 0 ? { forYou } : {}) })
            // Pause 2: the same answer carries the pause state: the next batch needs no call of its own.
            if (ended !== null) pauseRead = { pause: parsePause(ended.pause), at: await $.clock.now() }
            const filed = ended?.asked
            if (Array.isArray(filed)) blockAsks = filed.filter((id): id is string => typeof id === 'string')
            const line = (ended?.pull as { text?: unknown } | undefined)?.text
            if (typeof line === 'string' && line !== '') await takeFromBoard($)
          })())
        }
        turnStartedAt = null
      } else {
        // A subagent's turn ends inside the chat's own: the chat works on.
        ownAgents.add(e.agentId)
        await noteAgents($)
      }
      // The turn may have switched a branch or made a folder: the pane follows.
      await refresh($)
    }
  })

  // A question to the person holds the turn: the list says whose move it is.
  // B299: each question is filed on the worker board as an ask of kind decide (the app's form: answered in the chat
  // only), under the step the card names when the board takes it there, so the board shows it too; once the form is
  // answered, or closed without an answer, the board is told.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await say($, 'asking')
    const filed = await fileForm($, e)
    let result: unknown
    let isAnswered = false
    try {
      const out = await next(e)
      result = out
      isAnswered = true
      return out
    } finally {
      // An interrupted turn has ended by now: its file is not set back to working.
      if (isInTurn) await say($, 'working')
      // Review of B299: a form that returned is answered, also in the person's own words; one closed unanswered goes.
      for (const one of filed) {
        // B412: an ask whose filing answered late is closed once its answer is there; held a moment at most.
        const id = typeof one.id === 'string' ? one.id : await withinTime($, one.id)
        if (id === null) continue
        const answer = formAnswer((result as { result?: unknown } | undefined)?.result, one.text)
        await workQuietly($, isAnswered ? { action: 'answered-in-chat', id, text: answer === '' ? 'answered in the chat' : answer } : { action: 'withdraw', id, why: 'the question form was closed without an answer' })
      }
    }
  })

  // A message this chat's model sends another chat while it has a task: the card then says it waits for that chat.
  // B301: no message ends a task, whatever its words; a step ends with `work report` (below).
  on('session.send', async ($, e, next) => {
    const sent = await next(e)
    try {
      if (sent.isDelivered && e.origin.kind === 'model' && e.agentId === undefined && !(await isOwnAgent($, e.to))) hasAsked = true
    } catch {
      // the message went out
    }

    return sent
  })

  on('session.end', async ($, e, next) => {
    isInTurn = false
    if (e.reason === 'clear') await sessionCleared($, e.sessionId)
    else {
      watch?.cancel()
      watch = null
      chatWatch?.cancel()
      chatWatch = null
      await say($, 'waiting')
    }

    return next(e)
  })

  on('command.run', { command: 'git' }, async $ => {
    const view = await load($)
    ensureWatch($)
    const listed = view.error === null ? summary(view.rows) : `This folder could not be read (${view.error}).`

    return { text: `${listed}\n${await openPane($)}` }
  })

  on('command.run', { command: 'workers' }, async $ => ({ text: `${await chatLines($)}\n${await openWorkers($)}` }))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const action = input.action
    if (action !== 'list' && e.agentId !== undefined) {
      return { result: "Only the chat's main conversation keeps its line in the list: nothing was changed." }
    }
    if (action === 'plan' || action === 'step' || action === 'done') isCardSeen = true
    if (action === 'plan') {
      const text = typeof input.text === 'string' ? input.text : undefined
      const names = Array.isArray(input.names) ? input.names : undefined
      return { result: await setTask($, chat => withPlan(chat, { text, steps: numberOf(input.steps), names, minutes: numberOf(input.minutes), stepMinutes: numberOf(input.stepMinutes) })) }
    }
    if (action === 'step') {
      return { result: await setTask($, chat => withStep(chat, { step: numberOf(input.step), minutes: numberOf(input.minutes), stepMinutes: numberOf(input.stepMinutes) })) }
    }
    if (action === 'done') return { result: await setTask($, chat => ({ chat: withDone(chat) })) }
    if (action === 'join') {
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (name === '') return { result: 'Give the chat a name in "name".' }
      const role: ChatRole = input.role === 'main' ? 'main' : 'worker'
      // The tool runs inside a turn: this session is working.
      await join($, name, role, 'working')

      return { result: `This chat is in the list as "${name}" (${role === 'main' ? 'the main chat' : 'a worker'}).` }
    }
    if (action === 'leave') {
      return { result: await leave($, typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : undefined) }
    }
    const chats = await loadChats($)

    return { result: chatsSummary(chats.rows, chats.now) }
  })

  // B297: the work tool: each call goes to the worker board as this chat; take and step keep the card as the chat tool does.
  on('tool.call', { tool: WORK }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const action = typeof input.action === 'string' ? input.action : ''
    if (action !== 'next' && action !== 'list' && e.agentId !== undefined) {
      return { result: "Only the chat's main conversation changes the work: nothing was changed." }
    }
    const fields = Object.fromEntries(WORK_FIELDS.filter(key => input[key] !== undefined).map(key => [key, input[key]]))
    const answer = await workTool($, fields)
    if (!answer.ok) return { result: answer.text }
    let read: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(answer.text)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) read = parsed as Record<string, unknown>
    } catch {
      return { result: answer.text }
    }
    const text = typeof read.text === 'string' ? read.text : answer.text
    // B298: a close (or next) tells which of the person's instructions stay open.
    const open = openFrom(read)
    if (open !== null) openInstructions = open
    // B301: the board took the report: the step is done for this chat. Its card clears when the turn ends, and a large
    // chat is compacted then, unless the board names its next step (more of the same work follows).
    if (action === 'report') {
      hasReported = true
      moreFollows = typeof read.more === 'string' && read.more !== ''
      await changeMine($, chat => (chat.task === null || chat.task.isReported ? null : withSend(chat)))
      return { result: text }
    }
    if (action !== 'take' && action !== 'step') return { result: text }
    isCardSeen = true
    const card = {
      id: input.id, title: read.title, names: Array.isArray(input.names) ? input.names : undefined, steps: numberOf(input.steps),
      step: numberOf(input.step), minutes: numberOf(input.minutes), stepMinutes: numberOf(input.stepMinutes),
    }
    const recorded = await setTask($, chat => {
      const changed = workCard(chat, action, card)
      if ('error' in changed && typeof changed.error === 'string') return { error: changed.error }

      return { chat: 'chat' in changed && changed.chat !== undefined ? changed.chat : chat }
    })

    return { result: recorded.startsWith('Recorded') ? text : `${text}\n(The card: ${recorded})` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await read($, viewAtom)
    const expanded = await read($, expandedAtom)
    const { Box, Button, Text } = $.ui.resolve(e)

    /** A folder in git: one line with its branch; pressed, its local branches under it. */
    const inGit = (row: FolderRow, branch: string) => {
      const isShown = expanded.includes(row.id)

      return (
        <Box key={`row:${row.id}`} flexDirection="column">
          <Button
            key={`folder:${row.id}`}
            plain
            onPress={() => update($, expandedAtom, list =>
              list.includes(row.id) ? list.filter(id => id !== row.id) : [...list, row.id])}
          >
            {`${isShown ? '▾' : '▸'} `}
            <Text bold>{row.name}</Text>
            {` · ${branch}`}
          </Button>
          {isShown && (
            <Box flexDirection="column" marginLeft={4}>
              {row.branches.map(name => (
                <Text dimColor={name !== branch}>{`${name === branch ? '●' : '○'} ${name}`}</Text>
              ))}
              {row.branches.length === 0 && <Text dimColor>No local branches.</Text>}
            </Box>
          )}
        </Box>
      )
    }

    const folders = view.error !== null ? (
      <Box flexDirection="column">
        <Text>This folder could not be read.</Text>
        <Text dimColor>{view.error}</Text>
      </Box>
    ) : view.rows.length === 0 ? <Text dimColor>This folder holds no folders.</Text> : (
      <Box flexDirection="column">
        {view.rows.map(row => (row.branch === null ? (
          <Box key={`row:${row.id}`} marginLeft={2}>
            <Text>
              {row.name}
              <Text dimColor> · no git</Text>
            </Text>
          </Box>
        ) : inGit(row, row.branch)))}
      </Box>
    )

    return folders
  })

  on('ui.render', { component: 'Pane', requestId: WORKERS }, async ($, e) => {
    const chats = await read($, chatsAtom)
    const { Box, Text } = $.ui.resolve(e)
    if (chats.rows.length === 0) return <Text dimColor>No chat is in the list yet.</Text>

    // One line per chat, the one that waits for the person standing out.
    return (
      <Box flexDirection="column">
        {chats.rows.map(chat => {
          const { mark, text, isYours } = status(chat, chats.rows, chats.now)

          return (
            <Text key={`chat:${chat.id}`}>
              {`${mark} `}
              <Text bold={chat.id === chats.me}>{chat.name}</Text>
              {'  '}
              <Text bold={isYours} dimColor={text === 'free'}>{text}</Text>
            </Text>
          )
        })}
      </Box>
    )
  })
}
