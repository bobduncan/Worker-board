// Reads the real files into texts, in the shape `buildState` takes. Everything outside this folder is read-only
// for the board, and a file that is missing or cannot be read comes back as null: the page shows it as unknown.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { boardChats, parseAppChat, parseList, readAppChats } from './appChats.mjs'
import { readTail } from './transcript.mjs'

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

export async function readSources(config, readFolders) {
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
  await Promise.all(chats.map(async ({ cliSessionId }) => {
    tails[cliSessionId] = await readTail(join(config.transcripts, `${cliSessionId}.jsonl`))
    planLineTexts[cliSessionId] = await readText(join(claude, 'chats', `${cliSessionId}.json`))
  }))

  return { listText, appChatTexts, planLineTexts, tails, backlogText, adviceText, folders }
}
