// Reads the real files into texts, in the shape `buildState` takes. Everything outside this folder is read-only
// for the board, and a file that is missing or cannot be read comes back as null: the page shows it as unknown.

import { lstat, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

import { boardChats, parseAppChat, parseList, readAppChats } from './appChats.mjs'
import { readAsks } from './asks.mjs'
import { allWords, forYou, queue } from './backlog.mjs'
import { projectFile } from './config.mjs'
import { readHead } from './files.mjs'
import { listPictures, mentionedPaths } from './pictures.mjs'
import { movedTo, ownCard, ownCardKey } from './planLines.mjs'
import { readDeep, readTail } from './transcript.mjs'
import { storeBacklog } from './work/read.mjs'

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

/** Clear after each step: the session a chat goes on under, following the cards that say it moved (a few at most). */
async function followMoves(claude, id) {
  let current = id
  for (let hop = 0; hop < 8; hop += 1) {
    const next = movedTo(await readText(join(claude, 'chats', `${current}.json`)))
    if (next === null || next === current || !SAFE_ID.test(next)) break
    current = next
  }
  return current
}

/** B259: a thread of a brainstorm is read up to this; the board keeps the newest this many. */
const THREAD_BYTES = 64 * 1024
const MOST_THREADS = 50

/**
 * B259: the brainstorms' threads in the folder `folder` (the setting, inside the project), newest first, at most 50:
 * `{ path, text, at }`, the path as the setting names it. A folder that is not there holds none.
 */
export async function readThreads(project, folder) {
  // Focus 1: a whole path of its own (a copy's), else in the project.
  const dir = isAbsolute(folder) ? folder : join(project, ...folder.split('/'))
  const names = (await readdir(dir).catch(() => [])).filter(name => /^[a-z0-9][a-z0-9-]*\.md$/.test(name))
  const found = await Promise.all(names.map(async name => ({ name, at: await stat(join(dir, name)).then(file => file.mtimeMs, () => null) })))
  const newest = found.filter(one => one.at !== null).sort((a, b) => b.at - a.at || b.name.localeCompare(a.name)).slice(0, MOST_THREADS)
  const read = await Promise.all(newest.map(async one => ({ path: `${folder}/${one.name}`, text: (await readHead(join(dir, one.name), THREAD_BYTES))?.text ?? null, at: one.at })))
  return read.filter(one => one.text !== null)
}

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

/** The pictures in the folders the store's steps for the person and its queued steps point to, per mentioned path. */
async function pictureLists(config, work, now) {
  const { backlog } = storeBacklog(work)
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

/**
 * B315: when the Claude app last started: the app holds a lock in its own folder (the one above its chat list) from
 * its start, written then (`lockfile` on Windows, `SingletonLock` elsewhere). Null when that cannot be told.
 */
export async function appStartedAt(appSessions) {
  if (typeof appSessions !== 'string' || appSessions === '') return null
  const folder = dirname(appSessions)
  for (const name of ['lockfile', 'SingletonLock']) {
    const at = await lstat(join(folder, name)).then(file => file.mtimeMs, () => null)
    if (Number.isFinite(at)) return at
  }
  return null
}

/**
 * `readFolders()` answers the working folders (see folders.mjs). B296, B301: `readWork()` answers the work store (see
 * work/read.mjs, `storeKeeper`); undefined where the board has none. The backlog file is not read: it is the store's view.
 */
export async function readSources(config, readFolders, now = Date.now(), readBranches = async () => null, readWork = async () => undefined) {
  const claude = join(config.project, '.claude')
  // B173: the Advice & Chat tab shows the game plan, which the Advisor keeps in the game's repository. The trial's gap 2
  // (2026-10-24): a fresh project has no game folder yet, so its plans stand in the project's own folder, where the
  // partner writes them then (roles/partner.md, "The plan interview").
  const home = config.gameRepo === '' ? config.project : config.gameRepo
  const plan = home === '' ? null : join(home, ...config.gamePlan.split('/'))
  // Plan (2026-10-19): the product plan beside it, for the Vision tab.
  const productPlan = home === '' ? null : join(home, ...config.productPlan.split('/'))
  const [listText, appChatTexts, adviceText, folders, askTexts, goalsText, work, threadTexts, productPlanText] = await Promise.all([
    readText(join(claude, 'chats', 'list.json')),
    readAppChats(config.appSessions),
    plan === null ? null : readText(plan),
    readFolders().catch(() => null),
    readAsks(join(claude, 'asks')),
    // B255: the goal map, beside the backlog; since B260 also the way to the next milestone.
    readText(projectFile(config, 'goals')),
    readWork(),
    // B259: the brainstorms' threads.
    readThreads(config.project, config.brainstorms),
    productPlan === null ? null : readText(productPlan),
  ])

  const found = boardChats(
    appChatTexts.map(parseAppChat).filter(chat => chat !== null),
    { project: config.project, ...parseList(listText ?? '') },
  ).filter(chat => !chat.isLeftover && SAFE_ID.test(chat.cliSessionId))
  // Clear after each step: a chat the Workers mod cleared goes on under a new session id, which its old card names
  // (`movedTo`). The app may still name the old one: the board follows the card, so the lane, its card and its
  // transcript are the chat's as it is now (`moved`, pairs of the old id and the new, for the state).
  const moved = []
  for (const chat of found) {
    const to = await followMoves(claude, chat.cliSessionId)
    if (to !== chat.cliSessionId) moved.push([chat.cliSessionId, to])
  }
  const movedTo = new Map(moved)
  const chats = found.map(chat => (movedTo.has(chat.cliSessionId) ? { ...chat, cliSessionId: movedTo.get(chat.cliSessionId) } : chat))

  const tails = {}
  const planLineTexts = {}
  // B152: when each card was last written: a card that says its chat left the list of chats says so since then.
  const planLineAt = {}
  await Promise.all(chats.map(async ({ cliSessionId, name }) => {
    const file = join(config.transcripts, `${cliSessionId}.jsonl`)
    const tail = await readTail(file)
    // A task may have started further back than the tail reaches, and so may a chat's look at the limits (B113).
    if (tail !== null) {
      const deep = await earlier(file, now).catch(() => null)
      tail.earlier = deep?.tasks ?? null
      tail.usage = deep?.usage ?? null
    }
    tails[cliSessionId] = tail
    const card = join(claude, 'chats', `${cliSessionId}.json`)
    planLineTexts[cliSessionId] = await readText(card)
    planLineAt[cliSessionId] = await stat(card).then(file => file.mtimeMs, () => null)
    // B210: a chat without the Workers mod writes its card itself, under its name; the mod's card goes first.
    if (planLineTexts[cliSessionId] === null && ownCardKey(name) !== '') {
      const own = join(claude, 'chats', 'own', `${ownCardKey(name)}.json`)
      const at = await stat(own).then(file => file.mtimeMs, () => null)
      const text = at === null ? null : await readText(own)
      planLineTexts[cliSessionId] = text === null ? null : ownCard(text, at)
      planLineAt[cliSessionId] = planLineTexts[cliSessionId] === null ? null : at
    }
  }))

  return {
    listText, appChatTexts, moved, planLineTexts, planLineAt, tails, adviceText, folders, askTexts, goalsText, threadTexts, productPlanText,
    pictureLists: await pictureLists(config, work, now),
    // B296, B301: the work store as it was read: the one source of the work.
    work,
    // B113: the file the app keeps for its own usage card. The board only reads it.
    usageText: (await readTail(config.usageHistory, USAGE_BYTES))?.text ?? null,
    // B315: when the app last started: a chat quiet since before then has not run since.
    appStartedAt: await appStartedAt(config.appSessions),
    // B110: the branches that are still there, to tell merged work from work whose branch is open.
    branches: await readBranches().catch(() => null),
    // When the game plan was last written.
    adviceAt: plan === null ? null : await stat(plan).then(file => file.mtimeMs, () => null),
    // Vision (2026-10-19): when the product plan was last written: a word to the partner about it is done once it changed.
    productPlanAt: productPlan === null ? null : await stat(productPlan).then(file => file.mtimeMs, () => null),
  }
}
