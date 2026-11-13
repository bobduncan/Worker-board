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
    // H2 (2026-11-05): a launch stub. The board's launch (`claude --desktop --resume`) made local_8f2378dd for Worker 2: an
    // adopted transcript (`fromCliTranscript` or `adoptedFromOtherSurface`) with no completed turn and no answer yet is a
    // copy of the CLI session, never the chat the title belongs to (the real one had 147 turns).
    isStub: (raw.fromCliTranscript === true || raw.adoptedFromOtherSurface === true) && !(number(raw.completedTurns) > 0) && text(raw.lastAssistantUuid) === null,
    // B468: the effort the chat runs at, as the app sets it (from its next turn on).
    effort: text(raw.effort),
    model: text(raw.model),
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
  // The supervisor (spec 2026-10-24): the chat whose sweeps look the board over ("supervisor": its name), no lane either.
  const supervisor = named(raw?.supervisor)?.trim() ?? null
  // The Product owner (2026-10-31, roles/product-owner.md): the chat that takes the person's talks ("owner": its name), no
  // lane either; while the list names none, the talks stay with the partner (src/talkPartner.mjs).
  const owner = named(raw?.owner)?.trim() ?? null
  // B547: "afterStep": "clear": the Workers mod clears a worker after each reported step, and the board keeps the account.
  const afterStep = raw?.afterStep === 'clear' ? 'clear' : null
  return { prefix, main, problem: prefix === null || main === null ? 'incomplete' : null, ...(helper === null ? {} : { helper }), ...(supervisor === null ? {} : { supervisor }), ...(owner === null ? {} : { owner }), ...(afterStep === null ? {} : { afterStep }) }
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
    cwd: chat.cwd,
    createdAt: chat.createdAt,
    lastActivityAt: chat.lastActivityAt,
    completedTurns: chat.completedTurns,
    isStub: chat.isStub === true,
    // The id the app's file holds (state.mjs gives the card's moved id as `cliSessionId`; the app can resume this one).
    ...(typeof chat.rawCliSessionId === 'string' ? { rawCliSessionId: chat.rawCliSessionId } : {}),
    effort: chat.effort ?? null,
    model: chat.model ?? null,
    summary: chat.summary,
  }))

  const names = new Set(named.map(chat => chat.name))
  const taken = new Set()
  const chats = named.map(chat => {
    const base = chat.name.match(/^(.*\S) \([^()]+\)$/)?.[1]
    const isCopy = base !== undefined && (base === main || names.has(base))
    // H2: a stub is a leftover and takes no name: the real chat of the title stays the title's chat, in any order.
    if (chat.isStub) return { ...chat, isMain: false, isLeftover: true }
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
 * B986: `files`, when given, gets the app id of every chat file in the folders read (`local_<id>`), also one that could not
 * be read whole: a chat whose file is there is not gone from the app's list (ownChat.mjs `ownChatOf`).
 * H1 (2026-11-05, the person's account switch): `elsewhere`, when given (a Map), gets the app id of every chat file in the
 * folders NOT read, with the account folder's name: a chat that is only there lives in the person's other Claude account.
 */
export async function readAppChats(dir, files = null, elsewhere = null) {
  const folders = await readAccountFolders(dir)
  // Two folders as recent as each other cannot be told apart: both are read.
  const newest = Math.max(0, ...folders.map(folder => folder.at))
  const read = folders.filter(folder => folder.at === newest)
  if (files instanceof Set) for (const folder of read) for (const id of folder.ids) files.add(id)
  if (elsewhere instanceof Map) {
    const seen = new Set(read.flatMap(folder => folder.ids))
    for (const folder of folders) if (!read.includes(folder)) for (const id of folder.ids) if (!seen.has(id)) elsewhere.set(id, folder.account)
  }
  return read.flatMap(folder => folder.texts)
}

/**
 * Start-up check, task 1 (2026-11-05): every `<dir>/<account>/<organisation>` folder of the app's chats, not only the newest:
 * `[{ account, org, at, ids, texts, chats }]`, `ids` the app id of every chat file, `texts` the whole ones, `chats` a Map from
 * app id to the parsed chat (`parseAppChat`) of each whole file. `at` is the newest activity in it (0 for none).
 */
export async function readAccountFolders(dir) {
  const folders = []
  for (const outer of await list(dir)) {
    if (!outer.isDirectory()) continue
    for (const inner of await list(join(dir, outer.name))) {
      if (!inner.isDirectory()) continue
      const folder = join(dir, outer.name, inner.name)
      const texts = []
      const ids = []
      const chats = new Map()
      for (const file of await list(folder)) {
        if (!file.isFile() || !/^local_.*\.json$/.test(file.name)) continue
        const id = file.name.slice(0, -'.json'.length)
        ids.push(id)
        // A file that cannot be read is being rewritten by the app; the next read has it. One cut short is no JSON.
        const head = await readHead(join(folder, file.name), CHAT_FILE_BYTES)
        if (head !== null && head.isWhole) {
          texts.push(head.text)
          const chat = parseAppChat(head.text)
          if (chat !== null) chats.set(id, chat)
        }
      }
      if (texts.length > 0 || ids.length > 0) folders.push({ account: outer.name, org: inner.name, texts, ids, chats, at: texts.length === 0 ? 0 : Math.max(...texts.map(activeAt)) })
    }
  }
  return folders
}

/**
 * Where a chat's file is, among all the account folders (`readAccountFolders`): 'here' (a real, open file in the folder of the
 * account in use: the one with the newest activity, as the board has always read; the app does not mark it), 'elsewhere' (such
 * a file only in another account's folder), 'unknown' (listed but not readable whole just now) or 'nowhere'. A launch stub (H2, `isStub`) and an archived file are no chat's file.
 * `appSession` the app id (`local_<id>`).
 */
export function listedWhere(appSession, folders) {
  if (typeof appSession !== 'string') return 'nowhere'
  const newest = Math.max(0, ...(folders ?? []).map(folder => folder.at))
  const has = folder => {
    const chat = folder.chats.get(appSession)
    return chat !== undefined && chat.isArchived !== true && chat.isStub !== true
  }
  if ((folders ?? []).some(folder => folder.at === newest && has(folder))) return 'here'
  if ((folders ?? []).some(has)) return 'elsewhere'
  // Review 1 (4): a file the app is rewriting (listed, not read whole) is not known, never "no chat".
  return (folders ?? []).some(folder => folder.ids.includes(appSession) && !folder.chats.has(appSession)) ? 'unknown' : 'nowhere'
}
