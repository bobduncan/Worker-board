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
  /** The last time the mod compacted this chat before a new task: when, and its size in tokens before and after. */
  compacted?: { at: number; before: number; after: number }
  /** B227: why the last report was not followed by a compaction, and when; gone once one is. */
  compactNote?: { at: number; why: string }
}

/** A chat of the list with the id of its session. */
export type ChatRow = ChatFile & { id: string }

/** Which chats of a project join its list by themselves: `.claude/chats/list.json`. */
export type ChatList = {
  /** A chat whose title starts with this joins under the rest of its title ("My Project - Worker 1" is "Worker 1"). */
  prefix: string
  /** The name of the main chat, the one that hands the work out. */
  main: string
  /** A worker larger than this many tokens is compacted before a task of the main chat starts; 0 for never. */
  compactAbove?: number
}

/** The chats as last read. */
export type ChatsView = {
  /** The session that draws this pane; null before it is known. */
  me: string | null
  /** When the list was read, in milliseconds. */
  now: number
  rows: ChatRow[]
}

declare module 'claude-code' {
  interface PluginState {
    'folder-branches': {
      view: FoldersView
      /** The ids of the folders whose local branches are shown. */
      expanded: string[]
      chats: ChatsView
    }
  }
}
