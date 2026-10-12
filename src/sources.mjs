// Reads the real files into texts, in the shape `buildState` takes. Everything outside this folder is read-only
// for the board, and a file that is missing or cannot be read comes back as null: the page shows it as unknown.

import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { boardChats, parseAppChat, parseList, readAppChats } from './appChats.mjs'
import { readAsks } from './asks.mjs'
import { allWords, forYou, parseBacklog, queue } from './backlog.mjs'
import { readHead } from './files.mjs'
import { listPictures, mentionedPaths } from './pictures.mjs'
import { readDeep, readTail } from './transcript.mjs'

/** A transcript's name comes from a file another program wrote; only a plain id may become part of a path. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const TEXT_BYTES = 512 * 1024
/** The longer look back is a large read, so its answer is kept for a while per transcript. */
const EARLIER_MS = 5 * 60_000
const PICTURES_MS = 60_000
const MOST_FOLDERS = 40
/** B113: the app adds a sample to the end of its usage file; the end of a file that grew large is enough. */
const USAGE_BYTES = 64 * 1024

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

const earlier = oneAtATime(readDeep, EARLIER_MS)
const picturesIn = new Map()

/** The pictures in the folders the backlog's steps for the person and its queued steps point to, per mentioned path. */
async function pictureLists(config, backlogText, now) {
  const backlog = parseBacklog(backlogText ?? '')
  const steps = [...forYou(backlog), ...queue(backlog)]
  const paths = [...new Set(steps.flatMap(step => mentionedPaths(allWords(step), config.pictureRoots)))].slice(0, MOST_FOLDERS)
  const lists = {}
  await Promise.all(paths.map(async path => {
    const key = `${config.project}|${path}`
    const before = picturesIn.get(key)
    if (before === undefined || now - before.at >= PICTURES_MS) {
      picturesIn.set(key, { at: now, files: listPictures(config.project, config.pictureRoots, path) })
    }
    lists[path] = await picturesIn.get(key).files
  }))
  return lists
}

/** `readFolders()` answers the working folders (see folders.mjs). */
export async function readSources(config, readFolders, now = Date.now(), readBranches = async () => null) {
  const claude = join(config.project, '.claude')
  const [listText, appChatTexts, backlogText, adviceText, folders, askTexts] = await Promise.all([
    readText(join(claude, 'chats', 'list.json')),
    readAppChats(config.appSessions),
    readText(join(claude, 'backlog.md')),
    readText(join(claude, 'advice.md')),
    readFolders().catch(() => null),
    readAsks(join(claude, 'asks')),
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
    // A task may have started further back than the tail reaches, and so may a chat's look at the limits (B113).
    if (tail !== null) {
      const deep = await earlier(file, now).catch(() => null)
      tail.earlier = deep?.tasks ?? null
      tail.usage = deep?.usage ?? null
    }
    tails[cliSessionId] = tail
    planLineTexts[cliSessionId] = await readText(join(claude, 'chats', `${cliSessionId}.json`))
  }))

  return {
    listText, appChatTexts, planLineTexts, tails, backlogText, adviceText, folders, askTexts,
    pictureLists: await pictureLists(config, backlogText, now),
    // B113: the file the app keeps for its own usage card. The board only reads it.
    usageText: (await readTail(config.usageHistory, USAGE_BYTES))?.text ?? null,
    // The main chat's note of who was on what before a restart: only whether it is there, and since when.
    restartNote: await stat(join(claude, 'restart.md')).then(file => ({ at: file.mtimeMs }), () => null),
    // B110: the branches that are still there, to tell merged work from work whose branch is open.
    branches: await readBranches().catch(() => null),
    // When the advisor last wrote its advice.
    adviceAt: await stat(join(claude, 'advice.md')).then(file => file.mtimeMs, () => null),
  }
}
