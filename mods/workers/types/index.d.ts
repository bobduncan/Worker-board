/** One line of the pane: a folder, and what git says of it. */
export type FolderRow = {
  /** `.` for the session's own folder, else the folder's name. */
  id: string
  /** The name shown. */
  name: string
  /**
   * The branch checked out in it; "(none, at commit abc1234)" when none is; "(unknown)" when git gave no answer;
   * null when the folder is no git checkout.
   */
  branch: string | null
  /** Its local branches, as git lists them; empty when it is no checkout. */
  branches: string[]
}

/** The folders as last read. */
export type FoldersView = {
  /** The folder whose folders are listed: the one the session was opened in. Null before the first reading. */
  root: string | null
  /** The folders in git first, then the others; each group by name. */
  rows: FolderRow[]
  /** Why the folder could not be read; null when it was. */
  error: string | null
}

/** Whether a chat hands work out or does it. */
export type ChatRole = 'main' | 'worker'

/** The task a chat works on, as the chat itself records it. */
export type ChatTask = {
  /** The task in a few words. */
  text: string
  /** The step it is on, from 1; 0 while it has given no plan. */
  step: number
  /** How many steps its plan has; 0 while it has given no plan. */
  steps: number
  /** The working time it still expects to need, in milliseconds, when its file was last written; null when it gave none. */
  left: number | null
  /** True once it sent another chat a message during this task: its report. The task clears when that turn ends. */
  isReported: boolean
  /** Its steps by name, one per step in order, when it gave them; then `steps` is their count. */
  names?: string[]
  /** True after a turn in which it sent another chat a message in the middle of the task: it waits for that chat. */
  asked?: true
  /** The working time it still expects for the step it is on, in milliseconds, as `left` is for the whole task. */
  stepLeft?: number
}

/**
 * A chat in the shared list, as its file `.claude/chats/<session id>.json` holds it. Only the chat's own session
 * writes the file.
 */
export type ChatFile = {
  name: string
  role: ChatRole
  /** `working` while a turn runs, `asking` while a turn waits for the person's answer to a question, else `waiting`. */
  state: 'working' | 'asking' | 'waiting'
  /** What it works on; null when it has no task. */
  task: ChatTask | null
  /** When its session last wrote the file, in milliseconds. */
  at: number
  /** B570: the Workers mod version its process runs, as it last wrote its file; none from a mod older than 0.18.0. */
  mod?: string
  /** The last time the mod compacted this chat before a new task: when, and its size in tokens before and after. */
  compacted?: { at: number; before: number; after: number }
  /** B227: why the last report was not followed by a compaction, and when; gone once one is. */
  compactNote?: { at: number; why: string }
  /**
   * Clear after each step: the mod cleared this chat after its reported step: when, the step, and where the board
   * keeps the conversation before (`.claude/chat-logs/...txt`, in the project's folder).
   */
  cleared?: { at: number; step: string | null; log: string | null }
  /** Clear after each step: why the mod did not clear this chat after its last report, and compacted it instead. */
  clearNote?: { at: number; why: string }
  /** Clear after each step: the clear the mod is about to run (its mark, written just before /clear). */
  clearing?: { at: number; step: string | null; log: string | null }
}

/** A chat of the list with the id of its session. */
export type ChatRow = ChatFile & { id: string }

/** Which chats of a project join its list by themselves: `.claude/chats/list.json`. */
export type ChatList = {
  /** A chat whose title starts with this joins under the rest of its title ("My Project - Worker 1" is "Worker 1"). */
  prefix: string
  /** The name of the main chat, the one that hands the work out. */
  main: string
  /**
   * A chat larger than this many tokens is compacted: a worker after its reported step, the main chat and the partners
   * at rest; 0 for never.
   */
  compactAbove?: number
  /**
   * Clear after each step: what becomes of a worker after its reported step: "clear" (its conversation is kept as a
   * log and cleared), "compact" (above `compactAbove`, the default) or "off".
   */
  afterStep?: AfterStep
  /** Clear after each step: the main chat and the partners are compacted at rest; false stops that alone. */
  compactAtRest?: boolean
  /** The supervisor (spec 2026-10-24): the name of the chat whose sweeps look the board over; cleared after every turn. */
  supervisor?: string
  /**
   * 0.28.0: the name of the Product owner's chat. It is compacted at rest, never cleared and never a worker, also when the
   * board's answer to a turn's end names no role (an older board).
   */
  owner?: string
}

/** Clear after each step: what the mod does with a worker's conversation after its reported step. */
export type AfterStep = 'clear' | 'compact' | 'off'

/** The role the worker board gives a chat of its list. */
export type BoardRole = 'main' | 'worker' | 'advisor' | 'owner' | 'helper' | 'supervisor'

/** The chats as last read. */
export type ChatsView = {
  /** The session that draws this pane; null before it is known. */
  me: string | null
  /** When the list was read, in milliseconds. */
  now: number
  rows: ChatRow[]
  /** B738: the chats the board shows as not running, as its last answer named them; empty without a board. */
  off?: string[]
  /** 2c (0.28.0): the board's status of each chat as its last answer to a take gave them; none until one did. */
  statuses?: BoardStatus[]
  /** 2c: when `statuses` last arrived, in milliseconds; null before. */
  statusesAt?: number | null
  /** 2c: which line the pane draws: the board's status, today's own reading, or today's reading marked "(board not reached)". */
  reading?: BoardReading
}

/** 2c (0.28.0): one chat's status as the worker board's page draws it, as its answer to a take gives it. */
export type BoardStatus = {
  name: string
  status: string
  why: string | null
  /** Attention needs a look (drawn bold); quiet is information. */
  tone: 'quiet' | 'attention'
  since: number | null
  reportAt: number | null
}

/** 2c: `board`: the board's statuses are fresh; `plain`: today's line with no mark; `unreached`: today's line, marked. */
export type BoardReading = 'board' | 'plain' | 'unreached'

declare module 'claude-code' {
  interface PluginState {
    workers: {
      view: FoldersView
      /** The ids of the folders whose local branches are shown. */
      expanded: string[]
      chats: ChatsView
    }
  }
}
