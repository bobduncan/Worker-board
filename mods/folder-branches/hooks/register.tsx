// folder-branches: two side panes. "Git": the folders directly inside the session's folder, each with the git branch
// checked out in it, or "no git"; a folder in git unfolds to its local branches; /git opens it and answers the list
// as text. "Workers": the chats of the project, one main chat that hands out work and the workers that do it, each
// with what it is doing now (its task, the step it is on, the time it expects; your turn; free); /workers opens it,
// and a tool keeps a chat's own line.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, Register, Timer } from 'claude-code'

import type { BoardRole, ChatFile, ChatList, ChatRole, ChatRow, ChatsView, FolderRow, FoldersView } from '../types'
import { BOARD_FILE, BOARD_NOTE, LAUNCH_FILE, MOD_HEADER, MOD_VERSION, REQUEST_HEADER, TAKE_PATH, TYPED_PATH, WORK_ACTIONS, WORK_FIELDS, WORK_PATH, boardStarts, isPaused, parseBoard, parsePause, parseTaken, pauseContexts, shownName, typedWhy } from './board'
import type { Board, BoardStart, PauseState, PauseWhere } from './board'
import {
  BEAT_MS, CHATS_DIR, LEFT_MAX_SIZE, LEFT_TEXT, LIST_FILE, afterTurn, atTurnStart, cardGap, cardOld, chatNote, clearWhy, clearedStart, compactKeep, compactWhy, chatText, chatsSummary, fileName,
  cardStep, foldersAbove, formAnswer, formQuestions, hasLeft, instructionsLine, isAgentId, isFiled, movedText, nameFromTitle, openFrom, orderChats, parseChat, personsWords, parseList, recordedLine, roleFrom, sessionOf, status, uniqueByName,
  unfiledAsk, withDone, withPlan, withSend, withState, withStep, workCard,
} from './chats'
import type { OpenInstruction, TaskChange } from './chats'
import { blockAsksLine, forYouCount, forYouItems, leftOutLine } from './foryou'
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
/**
 * Clear after each step: the clear the mod decided after a reported step, from that moment until the conversation
 * after it has started: the session it clears (`from`), the card, the step, the log the board keeps (in the project,
 * and its full path), and what the chat had seen then (its prompts and turns), so a prompt that comes in before the
 * clear runs stops it.
 */
type Clearing = { from: string; chat: ChatFile; step: string | null; log: string | null; file: string | null; at: number; prompts: number; turn: number; ticket: number }
/** The chat a /clear ended, with its card: the conversation that follows it is the same chat, under a new session id. */
type Carried = { from: string; chat: ChatFile; clearing: Clearing | null }
let carried: Carried | null = null
let clearing: Clearing | null = null
/** Clear after each step: the step this turn reported (its id), for the log's name and the card's line. */
let reportedStep: string | null = null
/** Clear after each step: the prompts that entered this session's main conversation, counted (no slash command). */
let promptCount = 0
/** Clear after each step: the turn the main chat or a partner was last looked at for a compaction at rest. */
let restTurn = -1
/** Clear after each step: the start's words for a conversation after a clear whose start no hook heard, for its first prompt. */
let pendingStart: string[] = []
/**
 * Clear after each step: the /clear commands this process queued and its hook has not seen yet, oldest first, by
 * their ticket. A /clear of this mod runs only when it is the one of the clear still on its way.
 */
const queuedClears: number[] = []
let clearTickets = 0
/** Clear after each step: a /compact this process queued is on its way: no other is queued meanwhile. */
let compactQueued = false
/** Clear after each step: the clear's decision waits for the board's late answer: nothing is typed in meanwhile. */
let isDecidingClear = false
/** Clear after each step: the role the board last named for this chat, in its answer to a turn's end. */
let lastRole: BoardRole | null = null
/** Clear after each step: the move of the card after a clear, on its way: the tick and a prompt never move it twice. */
let movingAfterClear: Promise<void> | null = null
/** Clear after each step: a turn the engine runs for a /clear or /compact of the mod's, should it run one: no turn of the chat's. */
let isCommandTurn = false
/** The plugin's own name, as the engine gives it on what the plugin started (`origin.name`). */
const PLUGIN = 'folder-branches'
/** Clear after each step: the words a turn of a slash command begins with (a /clear or /compact the engine runs as a turn). */
const COMMAND_TURN = /^\s*(?:\/(?:clear|compact)\b|<command-(?:name|message)>\/?(?:clear|compact)\b)/
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
/** B480: the items of the last "For you" block the board left out as asked already, as it named them. */
let blockLeft: string[] = []
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
    headers: { 'Content-Type': 'application/json', 'X-Board-Key': board.key, [MOD_HEADER]: MOD_VERSION },
    body: JSON.stringify({ chat: myself.name, session: await $.session.id(), ...more }),
  })
  // B463: a chat renamed in the app learns its new name here, at the next take, whatever wakes it.
  if (answer.status === 409) await followShown($, answer.text)

  return answer.ok ? answer.text : null
}

/**
 * B463: a chat renamed in the app goes on under its old name until it learns the new one. The board's refusal of that
 * name says the name it shows the session under: the chat joins under it as by its title (so a chat that was taken out
 * stays out), once. True when this chat's name changed.
 */
async function followShown($: EngineInterface, refusal: string): Promise<boolean> {
  try {
    const shown = shownName(refusal)
    if (shown === null || myself === null || shown === myself.name || chatsDir === null) return false
    const list = parseList(await $.fs.read(inFolder(chatsDir, LIST_FILE)).catch(() => ''))
    if (list === null) return false
    const before = myself.name
    // The review of B463: a rename keeps what the card says (a question open to the person stays theirs).
    await joinByTitle($, `${list.prefix}${shown}`, 'waiting')
    return myself !== null && myself.name !== before
  } catch {
    return false
  }
}

/**
 * B297: one call of the work tool, sent to the worker board as this chat: `{ ok, text }`, the board's answer or one
 * line saying why there is none. It never throws. B463: refused under a name the board no longer shows this chat
 * under, it follows the board's name and asks once more, with the same request id.
 */
async function workOnBoard($: EngineInterface, fields: Record<string, unknown>, request: string | null = null, limitMs: number | null = WORK_CALL_MS): Promise<WorkAnswer> {
  const answer = await workOnce($, fields, request, limitMs)
  if (answer.status !== 409 || !(await followShown($, answer.text))) return answer

  return workOnce($, fields, request, limitMs)
}

/** B297: one call of the work tool as `workOnBoard`, asked once. */
async function workOnce($: EngineInterface, fields: Record<string, unknown>, request: string | null, limitMs: number | null): Promise<WorkAnswer> {
  if (myself === null || chatsDir === null) return { ok: false, text: 'This chat is not in the list of chats: the work tool is for the chats of the list.' }
  try {
    const project = chatsDir.slice(0, chatsDir.length - CHATS_DIR.length - 1)
    const board = parseBoard(await $.fs.read(inFolder(project, BOARD_FILE)).catch(() => ''))
    if (board === null) return { ok: false, text: 'The worker board is not running: nothing was recorded. Try again once it runs.' }
    // B412: the call's request id: the board gives a repeat of it the first answer, so a call is recorded once.
    const asked = $.http.fetch(`${board.url}${WORK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Board-Key': board.key, [MOD_HEADER]: MOD_VERSION, ...(request === null ? {} : { [REQUEST_HEADER]: request }) },
      // Who asks is the mod's to say, never the chat's.
      body: JSON.stringify({ ...fields, chat: myself.name, session: await $.session.id() }),
    })
    // B445: the engine's fetch has no time limit of its own: a board that holds the call is a time-out, said with its
    // seconds (a cut answer: B412 asks again with the same request id).
    let timer: { cancel: () => void } | null = null
    // The mod's own late calls (workLate) wait as long as the board takes (limitMs null): their answer closes a form's ask.
    const late = limitMs === null ? new Promise<null>(() => {}) : new Promise<null>(done => { timer = $.clock.after(limitMs, () => done(null)) })
    const answer = await Promise.race([asked, late]).finally(() => (timer as { cancel: () => void } | null)?.cancel())
    if (answer === null) {
      asked.catch(() => {})
      const why = `timed out after ${String((limitMs ?? WORK_CALL_MS) / 1000)} s`
      return { ok: false, text: `The worker board did not answer (${why}): nothing was recorded. Try again in a moment.`, isCut: true, isRefused: false, why }
    }
    // B445: the board's own words with the HTTP status beside them.
    if (!answer.ok) return { ok: false, text: answer.text.trim() === '' ? `The worker board refused it (HTTP ${String(answer.status)}).` : `${answer.text.trim()} (HTTP ${String(answer.status)})`, status: answer.status }

    return { ok: true, text: answer.text, status: answer.status }
  } catch (error) {
    // B412: a board that took no connection has recorded nothing; one whose answer was cut off may have.
    const isRefused = /ECONNREFUSED/.test(String((error as { message?: unknown } | undefined)?.message ?? error))
    // B440: the reason, so a board that is slow, gone or on another port can be told apart (one line, no stack).
    let why = ''
    try {
      const cause = error instanceof Error ? (error as Error & { cause?: { code?: unknown } }).cause?.code : undefined
      const text = String(error instanceof Error ? error.message : error)
      why = (typeof cause === 'string' ? `${text}, ${cause}` : text).split('\n')[0].trim().slice(0, 200)
    } catch {
      // A thrown value that cannot be turned into text: the line without a reason.
    }
    const reason = why === '' ? '' : ' (' + why + ')'
    return { ok: false, text: 'The worker board did not answer' + reason + ': nothing was recorded. Try again in a moment.', isCut: true, isRefused, why }
  }
}

/** B445: how long one work call may wait for the board's answer before it counts as timed out. */
const WORK_CALL_MS = 10_000

/** B412: one answer of the board to a work call; `isCut` when none came (`isRefused`: it took no connection). */
type WorkAnswer = { ok: boolean; text: string; status?: number; isCut?: boolean; isRefused?: boolean; why?: string }

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
  if (answer.ok) return answer
  // A refusal of the repeat does not say the first was not recorded: the board may have taken it before it was cut.
  if (answer.isCut !== true) return { ...answer, text: `${NOT_KNOWN} The board then said: ${answer.text} Run work next (or work list) to see whether it is there before you try again.` }
  const reason = answer.why === undefined || answer.why === '' ? '' : ` (${answer.why})`
  return { ...answer, text: `${NOT_KNOWN}${reason} Run work next (or work list) to see whether it is there before you try again.` }
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
async function workLate($: EngineInterface, fields: Record<string, unknown>, waitMs = BOARD_WAIT_MS): Promise<{ read: Record<string, unknown> | null; isRefused: boolean; late: Promise<Record<string, unknown> | null> | null; request: string | null }> {
  try {
    if (myself === null) await withinTime($, changeMine($, () => null))
    // Review of B298: a board that hangs or starts anew holds the person's prompt a moment at most.
    const request = await newRequest($)
    const running = workOnBoard($, fields, request, null)
    const answer = await withinTime($, running, waitMs)
    if (answer === null) return { read: null, isRefused: false, late: running.then(late => fieldsOf(late), () => null), request }
    return { read: fieldsOf(answer), isRefused: !answer.ok && answer.isCut !== true, late: null, request }
  } catch {
    return { read: null, isRefused: false, late: null, request: null }
  }
}

/**
 * Clear after each step: a turn's end the board did not answer in time (`late`, the call still on its way), to be asked
 * again with the same request id (B412: the board answers a repeat with its kept answer and records nothing twice).
 */
type EndedRetry = { fields: Record<string, unknown>; request: string; late: Promise<Record<string, unknown> | null> | null }

/**
 * Clear after each step: how long the clear's decision waits for a slow answer to the report's turn's end (the board
 * runs the report's check then), how long it waits for the first call, and how often it asks again in between.
 */
const LATE_ENDED_MS = 15_000
const LATE_FIRST_MS = 4_000
const LATE_AGAIN_MS = 3_000

/** Clear after each step: the board's answer to a turn's end that came late: the first call's, else a repeat's; null for none in 15 s. */
async function endedLate($: EngineInterface, retry: EndedRetry): Promise<Record<string, unknown> | null> {
  const start = await $.clock.now()
  const left = async (): Promise<number> => LATE_ENDED_MS - ((await $.clock.now()) - start)
  let read = retry.late === null ? null : await Promise.race([retry.late, $.clock.sleep(LATE_FIRST_MS).then(() => null, () => null)])
  while (read === null && (await left()) > 0) {
    read = fieldsOf(await workOnBoard($, retry.fields, retry.request, Math.max(500, Math.min(2 * LATE_AGAIN_MS, await left()))))
    if (read === null && (await left()) > 0) await $.clock.sleep(Math.min(LATE_AGAIN_MS, await left()))
  }
  return read
}

/** What a turn's end the board answered brings: the pause, the asks it filed of the block, the role; true when it put out a line for this chat. */
async function tookEnded($: EngineInterface, ended: Record<string, unknown>): Promise<boolean> {
  // Pause 2: the same answer carries the pause state: the next batch needs no call of its own.
  pauseRead = { pause: parsePause(ended.pause), at: await $.clock.now() }
  const filed = ended.asked
  if (Array.isArray(filed)) blockAsks = filed.filter((id): id is string => typeof id === 'string')
  const left = ended.left
  blockLeft = Array.isArray(left) ? left.filter((one): one is string => typeof one === 'string') : []
  lastRole = roleFrom(ended) ?? lastRole
  const line = (ended.pull as { text?: unknown } | undefined)?.text
  return typeof line === 'string' && line !== ''
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

/** B484: how long a turn's end that hands the board a "For you" block may be held: the board files its asks then, and the chat learns which. */
const ASKED_WAIT_MS = 6000

/**
 * B484: the board's answer to a turn's end that came after the turn was let go: what it filed and left out still reaches
 * this chat, unless the chat was cleared (or is being decided on) meanwhile: then the answer is dropped, and said once.
 */
async function takeLateEnded($: EngineInterface, late: Promise<Record<string, unknown> | null>, session: string): Promise<void> {
  try {
    const read = await late
    if (read === null) return
    const files = Array.isArray(read.asked) && read.asked.length > 0 || Array.isArray(read.left) && read.left.length > 0
    if (!files) return
    // The decision on a clear takes the answer itself (clearWhenAnswered).
    if (isDecidingClear) return
    if (clearing !== null || (await $.session.id()) !== session) {
      await tell($, 'The worker board answered after this chat was cleared: what it filed from the "For you" block is on the board, not in this chat.')
      return
    }
    await tookEnded($, read)
  } catch {
    // the chat learns it from the board's page
  }
}

/** Review of B298: the answer of `run`, or null when it takes longer than the board may hold anything. */
async function withinTime<T>($: EngineInterface, run: Promise<T>, waitMs = BOARD_WAIT_MS): Promise<T | null> {
  return Promise.race([run, $.clock.sleep(waitMs).then(() => null, () => null)])
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

/**
 * Tells the board what became of the messages this chat took: typed here, or not. B532: with `why` per id, and the ids
 * it `refused` for good (too long, no text), which the board does not try again; a failed one it does.
 */
async function reportTyped($: EngineInterface, board: Board, typed: string[], failed: string[], why: Record<string, string> = {}, refused: string[] = []): Promise<void> {
  try {
    await askBoard($, board, TYPED_PATH, { typed, failed, ...(refused.length > 0 ? { refused } : {}), ...(Object.keys(why).length > 0 ? { why } : {}) })
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
  // Clear after each step: nothing is typed in while a clear is on its way: it waits for the conversation after it.
  if (isTaking || myself === null || chatsDir === null || clearing !== null || isDecidingClear) return
  isTaking = true
  try {
    // The project's folder is the one that holds `.claude/chats`.
    const project = chatsDir.slice(0, chatsDir.length - CHATS_DIR.length - 1)
    const board = parseBoard(await $.fs.read(inFolder(project, BOARD_FILE)))
    if (board === null) return
    const answer = await askBoard($, board, TAKE_PATH)
    if (answer === null) return
    const taken = parseTaken(answer)
    if (taken.refused.length > 0) void reportTyped($, board, [], [], taken.why, taken.refused)
    for (const message of taken.messages) {
      if (typedIds.has(message.id)) continue
      typedIds.add(message.id)
      void $.prompt.submit({ text: message.text, asUser: true }).then(
        // A prompt a hook dropped did not enter the chat, though the call itself went well.
        entered => (entered.drop === undefined
          ? reportTyped($, board, [message.id], [])
          : reportTyped($, board, [], [message.id], { [message.id]: typedWhy(entered.drop, 'a hook dropped it') })),
        reason => reportTyped($, board, [], [message.id], { [message.id]: typedWhy(reason, 'the chat did not take it') }),
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
async function compactAfter($: EngineInterface, at: { moreFollows: boolean }, role: BoardRole | null = null): Promise<void> {
  // Clear after each step: a worker after its reported task; the main chat and the partners while they rest.
  const isWorker = role === null || role === 'worker'
  // B227: every way out says why on the chat's card, so the board and the main chat can see it; the unexpected ones
  // also in one line on the screen.
  const note = async (why: string, isExpected = false): Promise<void> => {
    if (!isExpected) await tell($, `Not compacted ${isWorker ? 'after this task' : 'while it rests'}: ${why}`)
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
  const why = compactWhy(chat, { ...at, tokens: before, above: list.compactAbove ?? 0, role, afterStep: list.afterStep })
  if (why !== null || before === null) return note(why ?? 'its size is not known', /small enough|main chat|switched off/.test(why ?? ''))
  const keep = compactKeep(`${list.prefix}${chat.name}`, `${list.prefix}${list.main}`, role ?? chat.role)
  const what = isWorker ? 'after the reported task' : 'while it rests'
  let done: Awaited<ReturnType<EngineInterface['session']['compact']>>
  try {
    done = await $.session.compact({ instructions: keep })
  } catch (err) {
    // B227: in the desktop app's chats (SDK sessions) the engine compacts only inside a turn, as /compact: the mod
    // runs that command, queued for when this chat is idle, and does not wait for it (this turn would wait on it).
    if (/headless|\/compact/i.test(reason(err))) return compactByCommand($, keep, before, note, what)
    return note(reason(err))
  }
  if (typeof done.skip === 'string') {
    if (/headless|\/compact/i.test(done.skip)) return compactByCommand($, keep, before, note, what)
    return note(done.skip)
  }
  // The engine's own count when it has one: the status line's figure is from the last request, before the compaction.
  const sizes = { before: done.tokensBefore ?? before, after: done.tokensAfter ?? 0 }
  const thousands = (tokens: number): string => `${Math.round(tokens / 1000)},000`
  await tell($, `Compacted ${what}: ${thousands(sizes.before)} tokens before${sizes.after > 0 ? `, ${thousands(sizes.after)} after` : ''}.`)
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
async function compactByCommand($: EngineInterface, instructions: string, before: number, note: (why: string) => Promise<void>, what = 'after the reported task'): Promise<void> {
  // Clear after each step: one /compact on its way at a time; with prompts waiting, each turn's end would queue another.
  if (compactQueued) return
  compactQueued = true
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
    await tell($, `Compacted ${what}: ${thousands(before)} tokens before${isSmaller ? `, ${thousands(after)} after` : ''}.`)
    const at = await $.clock.now()
    await changeMine($, mine => ({ ...mine, compacted: { at, before, after: isSmaller ? after : 0 }, compactNote: undefined }))
  }, (err: unknown) => note(`/compact did not run: ${reason(err)}`)).catch(() => null).finally(() => {
    compactQueued = false
  })
}

/** Clear after each step: how long the board may take to put the conversation's log in its journal before the clear. */
const SAVE_LOG_MS = 5000
/** Clear after each step: a card's mark of a clear on its way is followed this long (a reload between the two). */
const MARK_MS = 10 * 60_000
/** Clear after each step: a /clear that has neither run nor been stopped by now is let go, so nothing waits on it for ever. */
const CLEAR_WAIT_MS = 2 * 60_000

/**
 * Clear after each step, at every tick: a clear whose new conversation started without a start this process heard (a
 * new session id, no hook) moves the card now, its start's words kept for the first prompt; a clear that neither ran nor
 * was stopped within two minutes is let go, and the card says so.
 */
async function settleClear($: EngineInterface): Promise<void> {
  const decided = clearing
  if (decided === null) return
  try {
    if ((await $.session.id()) !== decided.from) {
      if (!isInTurn) await moveAfterClear($, undefined, true)
      return
    }
    if ((await $.clock.now()) - decided.at < CLEAR_WAIT_MS) return
    // Its /clear, should it still come, is refused: it is no clear on its way any more.
    await dropClear($, '/clear did not run within two minutes')
  } catch {
    // looked at again at the next tick
  }
}

/** Clear after each step: the clear decided on this session is dropped; its /clear, if it still comes, is refused. */
async function dropClear($: EngineInterface, why: string): Promise<void> {
  if (clearing === null) return
  clearing = null
  try {
    const now = await $.clock.now()
    await changeMine($, mine => ({ ...mine, clearing: undefined, clearNote: { at: now, why } }))
  } catch {
    // only the card does not learn of it
  }
}

/** Clear after each step: the clear a card's own mark stands for (written just before /clear), while it is fresh. */
function markOf(chat: ChatFile, from: string, now: number, within = MARK_MS): Clearing | null {
  const mark = chat.clearing
  if (mark === undefined || now - mark.at >= within) return null
  return { from, chat, step: mark.step, log: mark.log, file: null, at: mark.at, prompts: promptCount, turn: turnNumber, ticket: 0 }
}

/**
 * Clear after each step: a /clear this mod queued before it was loaded anew: the card's own mark is fresh, and nothing
 * came in since this process started. The clear it stands for, or null.
 */
async function pendingMark($: EngineInterface): Promise<Clearing | null> {
  if (isInTurn || promptCount !== 0 || turnNumber !== 0) return null
  const dir = await findChatsDir($)
  const id = await $.session.id()
  const chat = dir === null ? null : await readChat($, dir, id)
  return chat === null ? null : markOf(chat, id, await $.clock.now(), CLEAR_WAIT_MS)
}

/** Clear after each step: what of this chat still runs after its turn ended (a subagent of its own); null for nothing. */
async function busyWhy($: EngineInterface): Promise<string | null> {
  try {
    const running = (await $.agent.list()).filter(agent => agent.status === 'running' || agent.status === 'pending' || agent.status === 'waiting')
    return running.length === 0 ? null : `a subagent it started still runs (${String(running.length)})`
  } catch {
    return null
  }
}

/**
 * Clear after each step: what becomes of the chat when a turn of it has ended. A worker that reported its step in it is
 * cleared ("afterStep": "clear" in the list of chats) or compacted (the default); the main chat and the partners are
 * never cleared, and are compacted at rest above the list's threshold, once per turn. The supervisor's chat (the
 * board's role supervisor, or the list's "supervisor" when the board did not answer) is cleared after every turn,
 * without a log, so each sweep starts empty.
 */
async function whenTurnEnds($: EngineInterface, f: { isReported: boolean; moreFollows: boolean; step: string | null; answer: string; ended: Record<string, unknown> | null; asked: boolean; retry: EndedRetry | null }): Promise<void> {
  const dir = await findChatsDir($)
  if (dir === null) return
  const role = roleFrom(f.ended)
  const list = parseList(await $.fs.read(inFolder(dir, LIST_FILE)).catch(() => ''))
  const chat = await readChat($, dir, await $.session.id())
  if (role === 'supervisor' || (role === null && isSupervisorOf(list, chat))) return clearSupervisor($, chat)
  if ((role ?? chat?.role ?? 'worker') === 'worker') {
    if (!f.isReported) return
    if (list !== null && chat !== null && list.afterStep === 'clear') {
      // The board was slow to answer the report's turn's end (it checks the report then): the decision waits for its
      // answer without holding the turn's end.
      if (f.ended === null && f.retry !== null) {
        void clearWhenAnswered($, { list, chat, ...f, retry: f.retry }).catch(() => null)
        return
      }
      return clearAfter($, { list, chat, role, ...f })
    }
    return compactAfter($, { moreFollows: f.moreFollows }, role)
  }
  return restCompact($, list, role ?? chat?.role ?? null)
}

/** The main chat and the partners: compacted at rest, once per turn, one /compact at a time, unless the list says not. */
async function restCompact($: EngineInterface, list: ChatList | null, role: BoardRole | null): Promise<void> {
  if (restTurn === turnNumber) return
  restTurn = turnNumber
  // The list may switch it off ("compactAtRest": false); one /compact on its way is enough.
  if (list?.compactAtRest === false || compactQueued) return
  // At rest: nothing of it runs on.
  if ((await busyWhy($)) !== null) return
  return compactAfter($, { moreFollows: false }, role)
}

/**
 * Clear after each step: the decision on a reported step whose turn's end the board answered late. It waits up to 15 s
 * for the answer (the first call's, else a repeat with the same request id), nothing typed in meanwhile, and decides
 * then with every guard of that moment: a prompt or turn that came in meanwhile means no clear; a partner the answer
 * names is compacted at rest; no answer at all falls back as before (compacted, the card saying why).
 */
async function clearWhenAnswered($: EngineInterface, c: { list: ChatList; chat: ChatFile; isReported: boolean; moreFollows: boolean; step: string | null; answer: string; asked: boolean; retry: EndedRetry }): Promise<void> {
  const since = { prompts: promptCount, turn: turnNumber }
  isDecidingClear = true
  let ended: Record<string, unknown> | null = null
  let pulled = false
  try {
    ended = await endedLate($, c.retry)
    if (ended !== null) pulled = await tookEnded($, ended)
  } catch {
    // no answer: decided as without one
  } finally {
    isDecidingClear = false
  }
  try {
    const role = roleFrom(ended)
    if (role !== null && role !== 'worker') await restCompact($, c.list, role)
    else if (isInTurn || promptCount !== since.prompts || turnNumber !== since.turn) {
      const now = await $.clock.now()
      await changeMine($, mine => ({ ...mine, clearNote: { at: now, why: 'a new prompt came in before the clear' } }))
    } else await clearAfter($, { ...c, role, ended, since })
  } catch (err) {
    await tell($, `Not cleared after this task: ${reason(err)}`)
  }
  if (pulled && clearing === null && !isInTurn) await takeFromBoard($)
}

/**
 * Clear after each step: a worker whose turn reported its step is cleared: the board keeps its conversation as a log
 * first (`save-log`; no log, no clear), the card is marked, and /clear runs once the chat is idle. When it may not be
 * cleared (`clearWhy`: no worker as the board says, the person pauses, a question the board did not file, something
 * still running, or a prompt that came in meanwhile) it is compacted as before, and its card says why.
 */
async function clearAfter($: EngineInterface, c: { list: ChatList; chat: ChatFile; role: BoardRole | null; isReported: boolean; moreFollows: boolean; step: string | null; answer: string; ended: Record<string, unknown> | null; asked: boolean; since?: { prompts: number; turn: number } }): Promise<void> {
  const instead = async (why: string): Promise<void> => {
    try {
      const now = await $.clock.now()
      await changeMine($, mine => ({ ...mine, clearNote: { at: now, why }, clearing: undefined }))
    } catch {
      // only the card does not learn of it
    }
    await compactAfter($, { moreFollows: c.moreFollows }, 'worker')
  }
  // The items the board was handed; a block with more (past nine, or too long for the call) leaves some unfiled.
  const handed = forYouItems(c.answer)
  const isUnfiled = unfiledAsk(c.answer, c.ended, handed.filter(item => item.kind !== 'do').length) || forYouCount(c.answer) > handed.length
  // A message to another chat in this turn (a question to the main chat): its answer would come into a cleared conversation.
  const busy = isInTurn ? 'a turn is running' : c.asked ? 'it sent another chat a message in this turn and waits for its answer' : await busyWhy($)
  const why = clearWhy({ role: c.role, isReported: c.isReported, isPaused: pauseRead?.pause?.state === 'pausing', isUnfiled, busy })
  if (why !== null) return instead(why)
  const from = await $.session.id()
  // What the chat had seen when the decision began: at the turn's end, also when it waited for the board.
  const prompts = c.since?.prompts ?? promptCount
  const turn = c.since?.turn ?? turnNumber
  if (isInTurn || promptCount !== prompts || turnNumber !== turn) return instead('a new prompt came in before the clear')
  // The board writes the log, never the model; without the log there is no clear.
  const answer = await workOnBoard($, { action: 'save-log', stepId: c.step ?? '' }, await newRequest($), SAVE_LOG_MS)
  const saved = fieldsOf(answer)
  const log = typeof saved?.log === 'string' && saved.log !== '' ? saved.log : null
  const file = typeof saved?.file === 'string' && saved.file !== '' ? saved.file : null
  if (log === null || file === null) return instead(`its conversation could not be saved as a log (${answer.ok ? 'the board named no log' : answer.text.slice(0, 160)})`)
  if (isInTurn || promptCount !== prompts || turnNumber !== turn) return instead('a new prompt came in before the clear')
  const now = await $.clock.now()
  // The mark on the card, written just before /clear: the conversation after it finds its card by it (a reload between).
  const marked = await changeMine($, mine => ({ ...mine, clearing: { at: now, step: c.step, log }, clearNote: undefined }))
  if (marked === null) return instead('this chat\'s card could not be written')
  queueClear($, { from, chat: marked, step: c.step, log, file, at: now, prompts, turn }, instead)
  await tell($, `Clearing this chat after ${c.step ?? 'its step'}: its conversation is kept in ${file}.`)
}

/**
 * Clear after each step: the /clear of a clear decided now (`c`, its mark on the card written), queued for when this chat
 * is idle, as /compact is; the command's own hook looks once more before it runs, and runs only the /clear of the clear
 * still on its way (its ticket). One that does not run is said through `instead`.
 */
function queueClear($: EngineInterface, c: Omit<Clearing, 'ticket'>, instead: (why: string) => Promise<void>): void {
  clearTickets += 1
  const ticket = clearTickets
  clearing = { ...c, ticket }
  queuedClears.push(ticket)
  void $.command.run({ command: 'clear' }).then(() => undefined, async (err: unknown) => {
    const at = queuedClears.indexOf(ticket)
    if (at >= 0) queuedClears.splice(at, 1)
    if (clearing?.ticket !== ticket) return
    clearing = null
    await instead(`/clear did not run: ${reason(err)}`)
  }).catch(() => null)
}

/** The supervisor (spec 2026-10-24): true when the list of chats names this chat its supervisor ("supervisor"). */
function isSupervisorOf(list: ChatList | null, chat: { name: string; role: ChatRole } | null): boolean {
  // The review: never the main chat, whatever the list says.
  return list?.supervisor !== undefined && chat !== null && chat.role !== 'main' && chat.name.toLowerCase() === list.supervisor.toLowerCase()
}

/**
 * The supervisor (the review): whether this chat is the supervisor's, as the board last named its role, or as the list of
 * chats names it. Its answers file nothing for the person: their "For you" block is not handed to the board.
 */
async function isSupervisorNow($: EngineInterface): Promise<boolean> {
  if (lastRole === 'supervisor') return true
  if (lastRole !== null || chatsDir === null) return false
  try {
    return isSupervisorOf(parseList(await $.fs.read(inFolder(chatsDir, LIST_FILE)).catch(() => '')), myself)
  } catch {
    return false
  }
}

/**
 * The supervisor (spec 2026-10-24): its chat is cleared after every turn of its own, so each sweep starts empty and costs
 * little. No log is kept (nothing in a sweep is needed after it: what it found stands in the board's incidents), and
 * none of a worker's guards hold it but these: a turn or a subagent of it still running, or a prompt that came in
 * before the /clear ran (the command's own hook). Its turn's end reached the board before this. The card says why when
 * it is not cleared; the conversation after the clear is told nothing (the next sweep word says what to do).
 */
async function clearSupervisor($: EngineInterface, chat: ChatFile | null): Promise<void> {
  const note = async (why: string): Promise<void> => {
    try {
      const now = await $.clock.now()
      await changeMine($, mine => ({ ...mine, clearNote: { at: now, why }, clearing: undefined }))
    } catch {
      // only the card does not learn of it
    }
  }
  if (chat === null) return
  const busy = isInTurn ? 'a turn is running' : await busyWhy($)
  if (busy !== null) return note(busy)
  const from = await $.session.id()
  const now = await $.clock.now()
  const marked = await changeMine($, mine => ({ ...mine, clearing: { at: now, step: null, log: null }, clearNote: undefined }))
  if (marked === null) return note('this chat\'s card could not be written')
  queueClear($, { from, chat: marked, step: null, log: null, file: null, at: now, prompts: promptCount, turn: turnNumber }, note)
}

/**
 * Clear after each step: the chat a /clear ended goes on under this session's id: its card (name, role, task, notes)
 * moves here, with the line "cleared after <step>" when the mod cleared it, and the old file says where it went
 * (`movedTo`), so the board follows it while the app still names the old session.
 */
async function moveCard($: EngineInterface, moving: Carried, to: string): Promise<ChatFile | null> {
  const dir = chatsDir ?? await findChatsDir($, true)
  // No new session id: nothing moves (the old file would say it moved onto itself).
  if (dir === null || to === moving.from) return null
  const now = await $.clock.now()
  // A new process of the mod before the clear ran: the card's own mark says what the clear was.
  const done = moving.clearing ?? markOf(moving.chat, moving.from, now)
  const { clearing: _mark, ...card } = moving.chat
  const next: ChatFile = { ...card, state: 'waiting', at: now, ...(done === null ? {} : { cleared: { at: now, step: done.step, log: done.log }, clearNote: undefined }) }
  const run = mine.then(async () => {
    await $.fs.write(inFolder(dir, fileName(to)), chatText(next))
    await $.fs.write(inFolder(dir, fileName(moving.from)), movedText(to, now))
  })
  mine = run.catch(() => undefined)
  await run
  chatsDir = dir
  lastBeat = now
  myself = { name: next.name, role: next.role }
  ensureChatWatch($)
  await refreshChats($)
  return next
}

/** Clear after each step: the chat whose card holds the mark of a clear on its way, when this process lost its own word of it. */
async function markedClear($: EngineInterface, title: unknown): Promise<Carried | null> {
  if (typeof title !== 'string' || title.trim() === '') return null
  const dir = await findChatsDir($, true)
  if (dir === null) return null
  const list = parseList(await $.fs.read(inFolder(dir, LIST_FILE)).catch(() => ''))
  const named = list === null ? null : nameFromTitle(title.trim(), list)
  if (named === null) return null
  const now = await $.clock.now()
  const me = await $.session.id()
  const found = (await readFiles($))
    .filter(row => row.id !== me && row.name.toLowerCase() === named.name.toLowerCase() && row.clearing !== undefined && now - row.clearing.at < MARK_MS)
    .sort((a, b) => (b.clearing?.at ?? 0) - (a.clearing?.at ?? 0))[0]
  if (found === undefined) return null
  const { id, ...chat } = found
  return { from: id, chat, clearing: markOf(chat, id, now) }
}

/**
 * Clear after each step: the start of the conversation after a /clear (`isClear`, the start's own word, or the chat
 * the /clear ended): the card moves to the new session id, and the fresh conversation is told who it is, where its
 * rules and its old conversation are, the person's instructions still open, and to run work next. Neither the clear
 * nor this start is a turn: no turn's end is told for them, so no instruction counts as missed for them. Lines of
 * start context; none for any other start.
 */
async function startAfterClear($: EngineInterface, title: unknown, isClear: boolean): Promise<string[]> {
  await moveAfterClear($, title, isClear)
  return pendingStart.splice(0)
}

/** Clear after each step: the move after a clear, once: a second caller waits for the one on its way. */
function moveAfterClear($: EngineInterface, title: unknown, isClear: boolean): Promise<void> {
  movingAfterClear ??= afterClear($, title, isClear).finally(() => {
    movingAfterClear = null
  })
  return movingAfterClear
}

/** Clear after each step: moves the card after a clear and keeps the start's words in `pendingStart`. */
async function afterClear($: EngineInterface, title: unknown, isClear: boolean): Promise<void> {
  try {
    // The chat the /clear ended; when the start comes before that end, the clear this process decided; else (a reload
    // between) the mark the card holds.
    const decided = clearing
    const moving = carried ?? (!isClear ? null : decided !== null ? { from: decided.from, chat: decided.chat, clearing: decided } : await markedClear($, title))
    carried = null
    if (moving === null) return
    const to = await $.session.id()
    if (to === moving.from) return
    const done = moving.clearing ?? markOf(moving.chat, moving.from, await $.clock.now())
    const moved = await moveCard($, { ...moving, clearing: done }, to)
    clearing = null
    // A turn that started meanwhile keeps its own marks: its end is told as any turn's.
    if (!isInTurn) {
      turnStartedAt = null
      isTurnEndTold = true
    }
    // The start's words only after the mod's own clear of a worker, or a clear of a chat the board names a worker: a
    // partner or the main chat the person cleared themselves is told nothing of a worker's. Nor is the supervisor's
    // chat, which the mod clears without a log after each sweep: the next sweep word says what to do.
    if (moved === null || (done === null && lastRole !== 'worker') || lastRole === 'supervisor' || (done !== null && done.log === null)) return
    const list = parseList(await $.fs.read(inFolder(chatsDir ?? '', LIST_FILE)).catch(() => ''))
    // B298: the board names the open instructions, kept under the chat's name; the ones it named before the clear stand
    // in when it does not answer in time.
    const known = openInstructions
    const read = await workQuietly($, { action: 'next' })
    const open = openFrom(read) ?? known
    const project = chatsDir === null ? null : chatsDir.slice(0, chatsDir.length - CHATS_DIR.length - 1)
    const sep = project?.includes('\\') === true ? '\\' : '/'
    const log = done?.file ?? (done?.log !== null && done?.log !== undefined && project !== null ? inFolder(project, done.log.split('/').join(sep)) : null)
    const at = { name: moved.name, title: list === null ? moved.name : `${list.prefix}${moved.name}`, role: 'worker' as const, main: list === null ? 'the main chat' : `${list.prefix}${list.main}` }
    pendingStart = [clearedStart({ ...at, step: done?.step ?? null, log, open }, TOOL)]
  } catch {
    // the card moves at the next prompt or turn
  }
}

/** Every few seconds: read the list for the pane and, while a turn of this session runs, write its file again. */
async function tick($: EngineInterface): Promise<void> {
  try {
    // Only a turn this process saw start keeps its file alive: a file left "working" by a closed app is not renewed.
    if (isInTurn && (await $.clock.now()) - lastBeat >= BEAT_MS) await changeMine($, chat => (chat.state === 'waiting' ? null : chat))
  } catch {
    // tried again at the next tick
  }
  await settleClear($)
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
async function joinByTitle($: EngineInterface, title: unknown, state: ChatFile['state'] = isInTurn ? 'working' : 'waiting'): Promise<void> {
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
    if (before?.name !== named.name || before.role !== named.role) await join($, named.name, named.role, state)
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
    + 'chat. "block" and "unblock" ("id", "on"); "unblock" without "on" (the main chat): clears what the step "Waits for". "new" ("title", "activity", "goal", "text", "priority", "standard", "model", "effort"): a new step. "queue" ("id", '
    + '"for", "after", "about", "priority"; "priority" fix: a fix for the worker board, first in its worker\'s queue), "requeue" ("id", "for": a queued step to another chat) and "unqueue" ("id": out of its '
    + 'queue): the main chat. "close" ("id", "as"): an instruction is done, and what came of it. "drop" '
    + '("id", "why"). "refine" ("id", "summary", "picture", "goal", "size", "standard", "model", "effort", "questions") and "refined" ("id", "what", "standard", "model", "effort"): '
    + 'the Advisor. "checked" ("id", "evidence", "points", "score"): the partner files the result check of a step in review, by a helper that did not build it. "vibe-draft" ("goal", "lines", "picture") and "how-draft" ("goal", "parts", "partnerDecides", "youDecide"): '
    + 'the partner (the Advisor) keeps its draft of the focus goal\'s vibe and how on the board; each call takes the place '
    + 'of the draft the goal had. "list": every item. "rename" ("from", "to"): the main chat: every open item naming the old '
    + 'name of a chat moves to its new name, for a rename the board could not follow itself (a chat replaced by a new one). '
    + '"partner-answer" ("id", "text", "why"): the partner answers an ask the board routed to it for the person ("text" its '
    + 'answer, normally the advice; "why" one line); the asking chat is woken as with the person\'s answer, and the answer '
    + 'stands in the partner\'s daily note with an Undo. "escalate" ("id", "why"): the partner hands a routed ask to the person. '
    + '"health": the supervisor chat reads the board\'s health summary. "incident" ("title", "subject", "evidence", "rule", "key"): '
    + 'the supervisor chat files what looks wrong; the same "key" again only counts it. "incident-fix" ("id" X<n>, "fix" B<n>): '
    + 'the partner names the step that fixes an incident; the board marks it fixed once that step is done.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: WORK_ACTIONS },
      id: { type: 'string', description: 'The item: B12 (a step), Q3 (an ask), I4 (an instruction), X5 (an incident).' },
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
      title: { type: 'string', description: "new: the step's title. incident: what looks wrong, in one plain line." },
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
      model: { type: 'string', description: 'refine, refined and new: the model the worker runs the step on, "<sonnet or opus>: <why, in one line of at most 200 characters>"; opus only for architecture or design decisions, the board\'s core, unclear or repeated bugs, art direction or judging; a step without one runs on sonnet.' },
      effort: { type: 'string', description: 'refine, refined and new: the effort level the worker runs the step at, "<low, medium, high, xhigh or max>: <why, in one line of at most 200 characters>"; a step without one runs at medium.' },
      evidence: { type: 'string', description: 'checked: the evidence picture\'s path in the project (the result beside its reference, the points ticked), or "none (<why>)". incident: what you saw, in one line, with times and ids.' },
      subject: { type: 'string', description: 'incident: the chat or the step it is about ("Worker 2", "B482"), or "board".' },
      rule: { type: 'string', description: 'incident: the code rule that could catch it next time, in one line ("a worker working with no step for 30 min").' },
      key: { type: 'string', description: 'incident: what makes it the same finding next time, "<what> <subject>" ("working-without-step Worker 2"); the key of an incident the summary lists counts that one.' },
      fix: { type: 'string', description: 'incident-fix: the step that fixes the incident ("B490").' },
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
    // Clear after each step: the start of the conversation after a /clear moves the card; a turn moves it when no start did.
    const id = await $.session.id()
    if (carried !== null || movingAfterClear !== null || (clearing !== null && clearing.from !== id)) await moveAfterClear($, undefined, true)
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
    // Clear after each step: the card moves when the conversation after the clear starts (`moveCard`), with the mod's
    // own clear when it was one.
    carried = { from: id, chat, clearing: clearing?.from === id ? clearing : markOf(chat, id, await $.clock.now()) }
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
    // Clear after each step: after a /clear the chat goes on under the new session id with its card, and is told where
    // it stands (before the title joins it: it is the same chat, never a new one).
    const cleared = e.agent_type === undefined ? await startAfterClear($, e.session_title, e.source === 'clear') : []
    await joinByTitle($, e.session_title)
    const result = await next(e)
    // Pause 2: a main chat that starts while the person resumes learns whom to wake; a chat holding a step, its checkpoint.
    const lines = e.agent_type === undefined ? await pauseLines($, 'start') : []
    const more = [...cleared, ...lines]

    return more.length === 0 ? result : { ...result, additionalContext: [...(result.additionalContext ?? []), ...more] }
  })

  on('prompt.submit', async ($, e, next) => {
    // B298: the person's words are filed on the worker board before the turn sees them, also while a turn runs (the app
    // holds them until then): nothing they say is lost. Beside the prompt, for the model only, its id and the person's
    // instructions still open (review: never in the system prompt, which stays the same words and stays cached).
    const context: string[] = []
    if (e.command === undefined) {
      // Clear after each step: a prompt that comes in stops a clear that has not run yet; the first prompt after a clear
      // that no session start announced carries the start's words.
      promptCount += 1
      if (carried !== null || movingAfterClear !== null || (clearing !== null && (await $.session.id()) !== clearing.from)) await moveAfterClear($, undefined, true)
      if (pendingStart.length > 0) context.push(...pendingStart.splice(0))
      // Pause 2: read beside the filing, so both hold the prompt 1.5 s at most together.
      const paused = pauseLines($, 'prompt', e.text)
      if (isFiled(e.text, e.origin)) {
        const filed = await workQuietly($, { action: 'instruction', text: personsWords(e.text) })
        const said = typeof filed?.id === 'string' ? recordedLine([filed.id], []) : null
        if (said !== null) context.push(said)
      } else if (!isOpenKnown && myself !== null) await workQuietly($, { action: 'next' })
      const open = instructionsLine(openInstructions)
      if (open !== null) context.push(open)
      const asked = blockAsksLine(blockAsks)
      blockAsks = []
      if (asked !== null) context.push(asked)
      const left = leftOutLine(blockLeft)
      blockLeft = []
      if (left !== null) context.push(left)
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
    // Clear after each step: should the engine run the mod's /clear or /compact as a turn, it is no turn of the chat's.
    if (!isInTurn && e.agentId === undefined && COMMAND_TURN.test(e.text)) {
      isCommandTurn = true
      return next(e)
    }
    // A turn that starts while one runs is a subagent's inside the chat's own: it starts nothing again.
    if (!isInTurn) {
      // Clear after each step: a real turn on the session a clear was decided for: the clear is dropped, its /clear refused.
      if (clearing !== null && (await $.session.id()) === clearing.from) await dropClear($, 'a new turn started before the clear ran')
      batches = 0
      reminders = 0
      turnStartedAt = await $.clock.now()
      isTurnEndTold = false
      isCardSeen = false
      hasAsked = false
      hasReported = false
      reportedStep = null
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
      if (e.agentId === undefined && isCommandTurn) {
        // Clear after each step: the turn of a /clear or /compact of the mod's: nothing to tell, nothing to decide.
        isCommandTurn = false
      } else if (e.agentId === undefined) {
        isInTurn = false
        await say($, 'waiting', e.reason)
        // B63: the step was reported in this turn (B301: `work report`) and the turn has ended: the moment a worker is
        // cleared or compacted (below). Its words are used up here, so neither a second end of the same turn nor a later
        // step finds them.
        const isReported = hasReported && e.reason === 'answer'
        const at = { moreFollows, step: reportedStep }
        hasReported = false
        moreFollows = false
        reportedStep = null
        const told: { ended: Record<string, unknown> | null; pulled: boolean; retry: EndedRetry | null } = { ended: null, pulled: false, retry: null }
        // B298: a turn that answered has ended: the board marks the instructions filed before it and still open as missed.
        // Clear after each step: a clear on its way is no turn, nor is the start after it.
        if (e.reason === 'answer' && !isTurnEndTold && turnStartedAt !== null) {
          isTurnEndTold = true
          const since = turnStartedAt
          // The review: the supervisor's chat asks the person nothing: no "For you" block of its goes to the board.
          const forYou = await isSupervisorNow($) ? [] : forYouItems(e.answer)
          // B300: a worker that holds nothing pulls with the same call, once per turn: when a step queued for it may be
          // taken now, the board puts its line ("work: B286 is yours; run work next") into the outbox once, and it is
          // typed here at once. All of it holds the turn's end 1.5 s at most; a board without a work store refuses, and
          // nothing changes for the chat (the board says so on its page). B317: an answer that ends with a "For you" block
          // hands its items over in the same call; the board files those the chat filed no ask for (Via: chat).
          // The review of Pause 2: while the person pauses (until running) a free worker takes nothing new.
          const pulls = !isPaused(pauseRead?.pause ?? null) && await withinTime($, holdsNothing($)) === true
          const fields = { action: 'turn-ended', since, ...(pulls ? { pull: true } : {}), ...(forYou.length > 0 ? { forYou } : {}) }
          const call = await workLate($, fields, forYou.length > 0 ? ASKED_WAIT_MS : BOARD_WAIT_MS)
          if (call.read === null && call.late !== null && forYou.length > 0) void takeLateEnded($, call.late, await $.session.id())
          told.ended = call.read
          if (call.read !== null) told.pulled = await tookEnded($, call.read)
          // Clear after each step: a board slow to answer (it checks a report then) is asked again later, with the same
          // request id, for the clear's decision; a board that refused is not.
          else if (!call.isRefused && call.request !== null) told.retry = { fields, request: call.request, late: call.late }
        }
        turnStartedAt = null
        // Clear after each step: a worker that reported is cleared or compacted now, the main chat and the partners
        // compacted at rest; the line the board put out for a free worker is typed in after that, unless a clear is
        // on its way (then the conversation after it takes it).
        if (e.reason === 'answer' && clearing === null) {
          await whenTurnEnds($, { ...at, isReported, answer: e.answer, ended: told.ended, asked: hasAsked, retry: told.retry }).catch(err => tell($, `Not compacted after this task: ${reason(err)}`))
        }
        if (told.pulled) await takeFromBoard($)
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
        const answer = formAnswer((result as { result?: unknown } | undefined)?.result, one.text)
        const close = (id: string): Promise<unknown> => workQuietly($, isAnswered ? { action: 'answered-in-chat', id, text: answer === '' ? 'answered in the chat' : answer } : { action: 'withdraw', id, why: 'the question form was closed without an answer' })
        if (typeof one.id === 'string') {
          await close(one.id)
          continue
        }
        // B412: an ask whose filing answered late is closed once its answer is there: at once when it is there within a
        // moment, else when it comes, without holding the turn.
        const late = one.id
        const id = await withinTime($, late)
        if (id !== null) await close(id)
        else void late.then(lateId => (lateId === null ? null : close(lateId))).catch(() => null)
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

  // Clear after each step: the mod's /clear runs once the chat is idle; a prompt or turn that came in since it was
  // decided stops it, and the chat is left as it is (its new work has started).
  on('command.run', { command: 'clear' }, async ($, e, next) => {
    // The person's own /clear, or another plugin's, runs as it is.
    if (e.origin.kind !== 'plugin' || e.origin.name !== PLUGIN) return next(e)
    // This mod's: the oldest it queued. It runs only as the /clear of the clear still on its way, while nothing came in.
    const ticket = queuedClears.shift() ?? null
    const decided = clearing
    if (decided !== null && decided.ticket === ticket) {
      if (!isInTurn && promptCount === decided.prompts && turnNumber === decided.turn) return next(e)
      await dropClear($, 'a new prompt came in before the clear ran')
      return { text: 'Not cleared: a new prompt came in before the clear ran.' }
    }
    // Queued before the mod was loaded anew: its card's fresh mark, and nothing came in since.
    const marked = ticket === null && decided === null ? await pendingMark($) : null
    if (marked !== null) {
      clearing = marked
      return next(e)
    }
    return { text: 'Not cleared: this /clear of the Workers mod was let go before it ran.' }
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
    // Clear after each step: the log before a clear is the mod's own call, never the model's.
    if (action === 'save-log') return { result: 'save-log is the Workers mod\'s own call: nothing was done.' }
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
      reportedStep = typeof input.id === 'string' && /^[A-Z]\d{1,6}$/.test(input.id) ? input.id : null
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
