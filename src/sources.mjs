// Reads the real files into texts, in the shape `buildState` takes. Everything outside this folder is read-only
// for the board, and a file that is missing or cannot be read comes back as null: the page shows it as unknown.

import { join } from 'node:path'

import { boardChats, parseAppChat, parseList, readAppChats } from './appChats.mjs'
import { readHead } from './files.mjs'
import { readMarked, readTail } from './transcript.mjs'

/** A transcript's name comes from a file another program wrote; only a plain id may become part of a path. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const TEXT_BYTES = 512 * 1024
/** The longer look back is a large read, so its answer is kept for a while per transcript. */
const EARLIER_MS = 5 * 60_000

const readText = async file => (await readHead(file, TEXT_BYTES))?.text ?? null

/**
 * Keeps each file's answer for `ttlMs` and lets one read run at a time, so the chats' look-backs (24 MB each)
 * never sit in memory together. `(file, now)` answers a promise of what `read(file)` gave.
 */
export function oneAtATime(read, ttlMs) {
  const kept = new Map()
  let turn = Promise.resolve()
  return (file, now) => {
    const before = kept.get(file)
    if (before !== undefined && now - before.at < ttlMs) return before.answer
    const answer = turn.then(() => read(file))
    turn = answer.catch(() => {})
    // Kept as a promise at once, so two reads of the board at the same moment share the one look back.
    kept.set(file, { at: now, answer })
    return answer
  }
}

const earlier = oneAtATime(readMarked, EARLIER_MS)

/** `readFolders()` answers the working folders (see folders.mjs). */
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
  await Promise.all(chats.map(async ({ cliSessionId }) => {
    const file = join(config.transcripts, `${cliSessionId}.jsonl`)
    const tail = await readTail(file)
    // A task may have started further back than the tail reaches.
    if (tail !== null) tail.earlier = await earlier(file, now).catch(() => null)
    tails[cliSessionId] = tail
    planLineTexts[cliSessionId] = await readText(join(claude, 'chats', `${cliSessionId}.json`))
  }))

  return { listText, appChatTexts, planLineTexts, tails, backlogText, adviceText, folders }
}
