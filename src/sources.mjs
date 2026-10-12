// Reads the real files into texts, in the shape `buildState` takes. Everything outside this folder is read-only
// for the board, and a file that is missing or cannot be read comes back as null: the page shows it as unknown.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { boardChats, parseAppChat, parseList, readAppChats } from './appChats.mjs'
import { readMarked, readTail } from './transcript.mjs'

/** A transcript's name comes from a file another program wrote; only a plain id may become part of a path. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const TEXT_CHARS = 512 * 1024

async function readText(file) {
  try {
    return (await readFile(file, 'utf8')).slice(0, TEXT_CHARS)
  } catch {
    return null
  }
}

/** The longer look back is a large read, so its answer is kept for a while per transcript. */
const EARLIER_MS = 5 * 60_000
const kept = new Map()

async function earlier(file, now) {
  const before = kept.get(file)
  if (before !== undefined && now - before.at < EARLIER_MS) return before.text
  const text = await readMarked(file)
  kept.set(file, { at: now, text })
  return text
}

export async function readSources(config, readFolders, now = Date.now()) {
  const claude = join(config.project, '.claude')
  const [listText, appChatTexts, backlogText, adviceText, folders] = await Promise.all([
    readText(join(claude, 'chats', 'list.json')),
    readAppChats(config.appSessions),
    readText(join(claude, 'backlog.md')),
    readText(join(claude, 'advice.md')),
    readFolders().catch(() => null),
  ])

  const chats = boardChats(
    appChatTexts.map(parseAppChat).filter(chat => chat !== null),
    { project: config.project, ...parseList(listText ?? '') },
  ).filter(chat => !chat.isLeftover && SAFE_ID.test(chat.cliSessionId))

  const tails = {}
  const planLineTexts = {}
  await Promise.all(chats.map(async ({ cliSessionId, isMain }) => {
    const file = join(config.transcripts, `${cliSessionId}.jsonl`)
    const tail = await readTail(file)
    // A worker's task may have been handed over further back than the tail reaches.
    if (tail !== null && !isMain) tail.earlier = await earlier(file, now)
    tails[cliSessionId] = tail
    planLineTexts[cliSessionId] = await readText(join(claude, 'chats', `${cliSessionId}.json`))
  }))

  return { listText, appChatTexts, planLineTexts, tails, backlogText, adviceText, folders }
}
