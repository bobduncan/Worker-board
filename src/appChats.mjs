// Source 1: the desktop app's list of chats, one JSON file per chat. The files are the app's own and can change
// shape, so every field is checked and a file that does not fit is left out.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { readHead } from './files.mjs'

/** The app's chat files are about 200 KB. One far larger is not read. */
const CHAT_FILE_BYTES = 4 * 1024 * 1024

const text = value => (typeof value === 'string' ? value : null)
const number = value => (Number.isFinite(value) ? value : null)

/** The fields the board uses from one chat's file, or null when the text is not a chat. */
export function parseAppChat(fileText) {
  let raw
  try {
    raw = JSON.parse(fileText)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const title = text(raw.title)
  const cliSessionId = text(raw.cliSessionId)
  if (title === null || cliSessionId === null) return null

  const post = raw.postTurnSummary
  const summary = post !== null && typeof post === 'object'
    ? {
        category: text(post.status_category),
        detail: text(post.status_detail),
        needsAction: text(post.needs_action),
        // The app writes the summary a moment after a turn. One that names an older answer says nothing about now.
        isCurrent: text(post.summarizes_uuid) === null || text(raw.lastAssistantUuid) === null
          || post.summarizes_uuid === raw.lastAssistantUuid,
      }
    : null

  return {
    title,
    sessionId: text(raw.sessionId),
    cliSessionId,
    cwd: text(raw.cwd),
    isArchived: raw.isArchived === true,
    createdAt: number(raw.createdAt),
    lastActivityAt: number(raw.lastActivityAt),
    completedTurns: number(raw.completedTurns),
    // B468: the effort the chat runs at, as the app sets it (from its next turn on).
    effort: text(raw.effort),
    summary,
  }
}

/**
 * `<project>\.claude\chats\list.json`: which chats are the project's (their titles start with `prefix`), and which
 * one is the main chat. B131: nothing is guessed. Without the file, or with one that is no JSON or names no prefix or
 * main chat, `problem` says so ('missing', 'broken', 'incomplete') and the board shows no chats until it is right.
 */
export function parseList(fileText) {
  if (typeof fileText !== 'string' || fileText.trim() === '') return { prefix: null, main: null, problem: 'missing' }
  let raw
  try {
    raw = JSON.parse(fileText.replace(/^\uFEFF/, ''))
  } catch {
    return { prefix: null, main: null, problem: 'broken' }
  }
  const named = value => (typeof value === 'string' && value.trim() !== '' ? value : null)
  const [prefix, main] = [named(raw?.prefix), named(raw?.main)]
  // B424: the partner's helper ("helper": its name), shown under the Advisor and never given a queue.
  const helper = named(raw?.helper)?.trim() ?? null
  return { prefix, main, problem: prefix === null || main === null ? 'incomplete' : null, ...(helper === null ? {} : { helper }) }
}

/**
 * A folder's path to compare: on Windows with "\" and in small letters, as the system treats them; on a Mac and Linux
 * with "/" and its own letters (B214).
 */
export const folderKey = (path, platform = process.platform) => (platform === 'win32'
  ? path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  : path.replace(/\/+$/, ''))

export function isInside(cwd, project, platform = process.platform) {
  if (cwd === null || project === '') return false
  const [inner, outer] = [folderKey(cwd, platform), folderKey(project, platform)]
  return inner === outer || inner.startsWith(`${outer}${platform === 'win32' ? '\\' : '/'}`)
}

const newestFirst = (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
const oldestMade = (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)

/**
 * The chats that belong on the board: open, in the project, titled with the prefix. The main chat comes first, the
 * workers in the order they were made, and leftovers (a fork, an older chat of the same name) greyed at the end.
 */
export function boardChats(appChats, { project, prefix, main }) {
  // B131: without a prefix from the list of chats no chat is the project's.
  if (prefix === null || prefix === undefined) return []
  const mine = appChats
    .filter(chat => !chat.isArchived && isInside(chat.cwd, project) && chat.title.startsWith(prefix))
    .sort(newestFirst)

  // An app file can outlive its chat's new title; the newest file for a transcript is the true one.
  const byTranscript = new Map()
  for (const chat of mine) if (!byTranscript.has(chat.cliSessionId)) byTranscript.set(chat.cliSessionId, chat)

  const named = [...byTranscript.values()].map(chat => ({
    name: chat.title.slice(prefix.length).trim(),
    title: chat.title,
    cliSessionId: chat.cliSessionId,
    appSessionId: chat.sessionId,
    createdAt: chat.createdAt,
    lastActivityAt: chat.lastActivityAt,
    completedTurns: chat.completedTurns,
    effort: chat.effort ?? null,
    summary: chat.summary,
  }))

  const names = new Set(named.map(chat => chat.name))
  const taken = new Set()
  const chats = named.map(chat => {
    const base = chat.name.match(/^(.*\S) \([^()]+\)$/)?.[1]
    const isCopy = base !== undefined && (base === main || names.has(base))
    const isLeftover = isCopy || taken.has(chat.name)
    taken.add(chat.name)
    return { ...chat, isMain: !isLeftover && chat.name === main, isLeftover }
  })

  const rank = chat => (chat.isMain ? 0 : chat.isLeftover ? 2 : 1)
  return chats.sort((a, b) => rank(a) - rank(b) || oldestMade(a, b) || a.name.localeCompare(b.name))
}

async function list(dir) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** When a chat file's chat was last active, or 0. */
function activeAt(text) {
  try {
    const at = JSON.parse(text)?.lastActivityAt
    return Number.isFinite(at) ? at : 0
  } catch {
    return 0
  }
}

/**
 * Reads `<dir>\<account>\<organisation>\local_*.json`. A file that cannot be read or does not fit is left out.
 * B314: the app keeps one such folder per account it was signed in with, and shows only the chats of the account in
 * use; an older account's folder keeps its chats as they were (on 2026-10-18 an open chat of four days before,
 * named as one of today's: a second lane of that name). Only the folder with the most recently active chat is read.
 */
export async function readAppChats(dir) {
  const folders = []
  for (const outer of await list(dir)) {
    if (!outer.isDirectory()) continue
    for (const inner of await list(join(dir, outer.name))) {
      if (!inner.isDirectory()) continue
      const folder = join(dir, outer.name, inner.name)
      const texts = []
      for (const file of await list(folder)) {
        if (!file.isFile() || !/^local_.*\.json$/.test(file.name)) continue
        // A file that cannot be read is being rewritten by the app; the next read has it. One cut short is no JSON.
        const head = await readHead(join(folder, file.name), CHAT_FILE_BYTES)
        if (head !== null && head.isWhole) texts.push(head.text)
      }
      if (texts.length > 0) folders.push({ texts, at: Math.max(...texts.map(activeAt)) })
    }
  }
  // Two folders as recent as each other cannot be told apart: both are read.
  const newest = Math.max(0, ...folders.map(folder => folder.at))
  return folders.filter(folder => folder.at === newest).flatMap(folder => folder.texts)
}
