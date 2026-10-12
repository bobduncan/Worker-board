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
    summary,
  }
}

/** `<project>\.claude\chats\list.json`: which chats are the game's, and which one is the main chat. */
export function parseList(fileText) {
  const fallback = { prefix: 'Game - ', main: 'Main' }
  try {
    const raw = JSON.parse(fileText)
    return { prefix: text(raw?.prefix) ?? fallback.prefix, main: text(raw?.main) ?? fallback.main }
  } catch {
    return fallback
  }
}

const folderKey = path => path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

function isInside(cwd, project) {
  if (cwd === null || project === '') return false
  const inner = folderKey(cwd)
  const outer = folderKey(project)
  return inner === outer || inner.startsWith(`${outer}\\`)
}

const newestFirst = (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
const oldestMade = (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)

/**
 * The chats that belong on the board: open, in the project, titled with the prefix. The main chat comes first, the
 * workers in the order they were made, and leftovers (a fork, an older chat of the same name) greyed at the end.
 */
export function boardChats(appChats, { project, prefix, main }) {
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

/** Reads `<dir>\*\*\local_*.json`. A file that cannot be read or does not fit is left out. */
export async function readAppChats(dir) {
  const texts = []
  for (const outer of await list(dir)) {
    if (!outer.isDirectory()) continue
    for (const inner of await list(join(dir, outer.name))) {
      if (!inner.isDirectory()) continue
      const folder = join(dir, outer.name, inner.name)
      for (const file of await list(folder)) {
        if (!file.isFile() || !/^local_.*\.json$/.test(file.name)) continue
        // A file that cannot be read is being rewritten by the app; the next read has it. One cut short is no JSON.
        const head = await readHead(join(folder, file.name), CHAT_FILE_BYTES)
        if (head !== null && head.isWhole) texts.push(head.text)
      }
    }
  }
  return texts
}
