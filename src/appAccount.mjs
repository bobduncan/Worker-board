// B1273 (F36a, 2026-11-19, the person: "I want to be able to switch accounts often"): which Claude account the desktop app is
// on now, which account the board's chats live in, and the hold while the two differ.
//
// The signal (never a guess): the app writes the account it is signed in with to its own `config.json` as
// `lastKnownAccountUuid` (the reimport-chats skill picks its target the same way). On 2026-11-19 the file's time matched the
// person's switch back (19:11:57 the other account's folder last written, 19:12:04 config.json). The app keeps one chat list
// per account: `<app folder>\claude-code-sessions\<account>\<organisation>\local_*.json`.
//
// The board's account: config.json's `appAccount` when set; else the one the board recorded (`data/app-account.json`); else,
// the first time, the account whose folder holds the main chat's real file (no launch stub, not archived) with the newest
// activity, recorded from then on. While the app is on another account the board holds (work/pause.mjs `awayOver`: no
// hand-out, no wake, no incident, no ask), and for RETURN_SETTLE_MS after it came back (the app reads its list first: a wake
// sent into the switch failed with "not in the app's list" on 2026-11-05). While away, a real file of a board chat that only
// the app's account holds is copied into the board's account (`toImport`): new files only, never one written over, never an
// archived state changed, never a launch stub; the app reads that account's list when the person switches back.

import { basename, dirname, join } from 'node:path'
import { readFile as readFileNow, writeFile as writeFileNow, mkdir as mkdirNow } from 'node:fs/promises'

import { isInside, parseAppChat } from './appChats.mjs'

/** An account's id as the app names its folders and `lastKnownAccountUuid`. */
export const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** After the app came back to the board's account, the board holds this long more: the app reads its list first. */
export const RETURN_SETTLE_MS = 60_000
/**
 * B1283 (F37, the person, 2026-11-20: "make this button a needs my attention thing instead ... put it in the attention so i can
 * decide myself"): the one ask filed in Needs your attention per switch away, once the away has lasted the settle (a quick flip
 * back files nothing): A moves the board to the app's account (a deliberate move), B keeps the hold with no new ask until the
 * next switch away. It closes by itself when the app comes back home.
 */
export const ASK_OPTIONS = ['A Run the board on this account', 'B Keep waiting until I switch back']
/** The ask's title: the question itself in at most 12 words (askWords.mjs `titleProblem`). */
export const askTitleOf = app => `The Claude app is on account ${String(app).slice(0, 8)}: run the board there?`
export const askTextOf = (app, board) => [
  `The board's chats live in the Claude account ${String(board).slice(0, 8)}; the app is on ${String(app).slice(0, 8)} now, so the board holds: no hand-out, no wake, nothing asked of the chats.`,
  'A: the board runs on this account from now on (its chats are found and woken here). B: the board keeps waiting; it goes on by itself when you switch back.',
]
export const askClosedWhy = board => `the Claude app came back to ${String(board).slice(0, 8)}; nothing to decide`
/** The one line the page shows while the app is away (calm: nothing for the person to do but switch back). */
export const AWAY_LINE = 'The Claude app is on another account: the board\'s chats wait; switch back and they go on.'

const isId = value => typeof value === 'string' && ACCOUNT_ID.test(value)

/** The account the app is signed in with, from its config.json's text: the id, or null (no file, no JSON, no such key). */
export function appAccountOf(configText) {
  try {
    const id = JSON.parse(String(configText ?? '').replace(/^﻿/, ''))?.lastKnownAccountUuid
    return isId(id) ? id.toLowerCase() : null
  } catch {
    return null
  }
}

/** The app's config.json for the board's `appSessions` (`<app folder>\claude-code-sessions`): its path, or null. */
export const appConfigFileOf = appSessions => (typeof appSessions === 'string' && appSessions !== '' && basename(appSessions) === 'claude-code-sessions' ? join(dirname(appSessions), 'config.json') : null)

/**
 * The board's account: `setting` (config.json's `appAccount`), else `recorded` (data/app-account.json), else the account whose
 * folder holds the main chat's real file with the newest activity (`folders` as appChats.mjs `readAccountFolders` reads them;
 * the main chat: title `prefix + main`, its folder inside `chatHome`, no launch stub, not archived). `{ account, by }`, `by`
 * 'setting' | 'record' | 'main chat'; `{ account: null, by: null }` when none can be told.
 */
export function boardAccountOf({ setting = null, recorded = null, folders = [], chatHome = '', prefix = null, main = null }) {
  if (isId(setting)) return { account: setting.toLowerCase(), by: 'setting' }
  if (isId(recorded)) return { account: recorded.toLowerCase(), by: 'record' }
  if (typeof prefix !== 'string' || typeof main !== 'string' || chatHome === '') return { account: null, by: null }
  let best = null
  for (const folder of folders ?? []) {
    if (!isId(folder.account)) continue
    for (const chat of folder.chats?.values?.() ?? []) {
      if (chat.title !== `${prefix}${main}` || chat.isStub === true || chat.isArchived === true || !isInside(chat.cwd, chatHome)) continue
      const at = Number.isFinite(chat.lastActivityAt) ? chat.lastActivityAt : 0
      if (best === null || at > best.at) best = { account: folder.account.toLowerCase(), at }
    }
  }
  return best === null ? { account: null, by: null } : { account: best.account, by: 'main chat' }
}

/**
 * The account picture after a read: `{ app, board, away, since, backAt }`. `away` while the app's account is known and is not
 * the board's, and for RETURN_SETTLE_MS after it came back (`backAt`); `since` when the away began (kept across reads). An
 * unknown app account (no config.json, no key) or an unknown board account holds nothing: the board goes on as before.
 */
export function accountPicture({ app = null, board = null, before = null, now, settleMs = RETURN_SETTLE_MS }) {
  const isOther = isId(app) && isId(board) && app.toLowerCase() !== board.toLowerCase()
  if (isOther) return { app, board, away: true, since: before?.away === true && Number.isFinite(before.since) ? before.since : now, backAt: null }
  if (before?.away === true && isId(app) && isId(board)) {
    const backAt = Number.isFinite(before.backAt) ? before.backAt : now
    if (now - backAt < settleMs) return { app, board, away: true, since: before.since, backAt }
  }
  return { app, board, away: false, since: null, backAt: null }
}

/**
 * While away: the board chats' real files that only the app's account holds, to copy into the board's account
 * (`[{ id, title, from, toDir }]`). A board chat: title starting with `prefix`, its folder inside `chatHome`, no launch stub,
 * not archived. Left out: an app id any folder of the board's account lists, and a chat whose transcript (`cliSessionId`) a
 * real, open file there holds already. `toDir` is the board account's organisation folder that holds most chat files.
 * `dir` is `appSessions`.
 */
export function toImport({ folders = [], dir, app, board, chatHome, prefix }) {
  if (!isId(app) || !isId(board) || app.toLowerCase() === board.toLowerCase() || typeof prefix !== 'string' || prefix === '') return []
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
  const home = (folders ?? []).filter(folder => same(folder.account, board))
  if (home.length === 0) return []
  const target = [...home].sort((a, b) => b.ids.length - a.ids.length)[0]
  const homeIds = new Set(home.flatMap(folder => folder.ids))
  const homeTranscripts = new Set(home.flatMap(folder => [...folder.chats.values()].filter(chat => chat.isStub !== true && chat.isArchived !== true).map(chat => chat.cliSessionId)))
  const out = []
  for (const folder of (folders ?? []).filter(one => same(one.account, app))) {
    for (const [id, chat] of folder.chats) {
      if (homeIds.has(id) || homeTranscripts.has(chat.cliSessionId)) continue
      if (chat.isStub === true || chat.isArchived === true || !chat.title.startsWith(prefix) || !isInside(chat.cwd, chatHome)) continue
      out.push({ id, title: chat.title, from: join(dir, folder.account, folder.org, `${id}.json`), toDir: join(dir, target.account, target.org) })
    }
  }
  return out
}

/**
 * The board's watch on the app's account. `read()` (each state read; at most every `everyMs`) reads the app's config.json
 * and, once, the board's account; `now()` answers the last picture. `folders()` reads every account folder (appChats.mjs
 * `readAccountFolders`), `list()` the list of chats ({ prefix, main }). `record` is data/app-account.json. While away,
 * `importMissing()` copies the board chats' files of `toImport` (new files only: flag 'wx'), at most every `importEveryMs`.
 */
export function accountWatch({ appSessions, setting = null, record, chatHome, folders, list, ask = null, clock = Date.now, fs = { readFile: readFileNow, writeFile: writeFileNow, mkdir: mkdirNow }, log = () => {}, everyMs = 5000, importEveryMs = 60_000, settleMs = RETURN_SETTLE_MS }) {
  let picture = null
  let board = null
  // B1283: the record's ask (`{ id, app }`, open or answered) and the account declined with B, kept in the record across restarts.
  let recorded = null
  let asked = undefined
  let declined = undefined
  const loadRecord = async () => {
    if (recorded !== null) return recorded
    recorded = await fs.readFile(record, 'utf8').then(text => JSON.parse(text) ?? {}, () => ({}))
    if (recorded === null || typeof recorded !== 'object') recorded = {}
    asked = recorded.ask !== null && typeof recorded.ask === 'object' && typeof recorded.ask.id === 'string' ? { id: recorded.ask.id, app: recorded.ask.app ?? null } : null
    declined = isId(recorded.declined) ? recorded.declined.toLowerCase() : null
    return recorded
  }
  const saveRecord = async more => {
    recorded = { ...(await loadRecord()), ...more }
    for (const key of Object.keys(recorded)) if (recorded[key] === null || recorded[key] === undefined) delete recorded[key]
    await fs.mkdir(dirname(record), { recursive: true }).catch(() => {})
    await fs.writeFile(record, `${JSON.stringify(recorded, null, 2)}\n`).catch(() => {})
  }
  let readAt = -Infinity
  let importedAt = -Infinity
  let reading = null
  let triedAt = -Infinity
  const boardNow = async () => {
    if (board !== null) return board
    // Not found: looked for again a minute later at the soonest (every account folder is read for it).
    if (clock() - triedAt < importEveryMs) return null
    triedAt = clock()
    const known = (await loadRecord()).account ?? null
    const found = isId(setting) || isId(known) ? boardAccountOf({ setting, recorded: known }) : boardAccountOf({ folders: await folders(), chatHome, ...(await list()) })
    if (found.account !== null && found.by === 'main chat') {
      await saveRecord({ account: found.account, by: found.by, at: clock() })
      log(`The board's chats live in the Claude account ${found.account.slice(0, 8)} (found by the main chat; recorded).`)
    }
    if (found.account !== null) board = found.account
    return board
  }
  const readNow = async () => {
    const file = appConfigFileOf(appSessions())
    const read = file === null ? null : appAccountOf(await fs.readFile(file, 'utf8').catch(() => null))
    const before = picture
    // The review: a read that finds no account while away (a file cut short, gone a moment) keeps the last one known: no lift at once.
    const app = read ?? (before?.away === true ? before.app : null)
    // No app account known: nothing to compare, so the board's account is not looked for (no folder read).
    picture = accountPicture({ app, board: app === null ? board : await boardNow(), before, now: clock(), settleMs })
    if (picture.away && before?.away !== true) log(`The Claude app is on another account (${String(app).slice(0, 8)}): the board holds until it is back on ${String(picture.board).slice(0, 8)}.`)
    if (!picture.away && before?.away === true) log('The Claude app is back on the board\'s account: the board goes on.')
    await tendAsk()
    picture = { ...picture, ask: asked?.id ?? null }
    readAt = clock()
    return picture
  }
  /** The deliberate move: the app's account becomes the board's, recorded as the person's; the hold ends without the settle. */
  const takeNow = async app => {
    await saveRecord({ account: app, by: 'person', at: clock(), ask: null, declined: null })
    asked = null
    declined = null
    board = app
    picture = { app, board: app, away: false, since: null, backAt: null, ask: null }
    log(`The board runs on the Claude account ${app.slice(0, 8)} from now on (the person's choice).`)
  }
  /**
   * B1283: the one ask per switch away. Away past the settle (a quick flip back files nothing), no ask of this episode and no B for
   * this account yet: filed. Open: its answer is read; A takes the account, B declines it until the next switch away. Back home (or on
   * the account taken): an open ask is closed with its one line, and a B is forgotten. Nothing without an `ask` adapter.
   */
  const tendAsk = async () => {
    if (ask === null) return
    await loadRecord()
    if (picture.away && picture.backAt === null) {
      if (asked !== null) {
        const state = await ask.stateOf(asked.id).catch(() => null)
        if (state === null || !['open', 'answered'].includes(state.state)) { asked = null; await saveRecord({ ask: null }); return }
        if (state.state === 'answered') {
          const letter = String(state.answer?.[0] ?? '').trim().charAt(0).toUpperCase()
          if (letter === 'A') { await takeNow(picture.app); return }
          declined = picture.app
          asked = null
          await saveRecord({ ask: null, declined })
          log('The person keeps the board waiting (B): no new ask until the next switch away.')
        }
        return
      }
      if (declined === picture.app || clock() - picture.since < settleMs) return
      const id = await ask.file({ title: askTitleOf(picture.app), text: askTextOf(picture.app, picture.board), options: ASK_OPTIONS, advice: 'B' }).catch(() => null)
      if (typeof id !== 'string') return
      asked = { id, app: picture.app }
      await saveRecord({ ask: asked })
      log(`Asked you on the board (${id}): run the board on ${picture.app.slice(0, 8)}, or keep waiting.`)
      return
    }
    if (!picture.away) {
      if (asked !== null) {
        const state = await ask.stateOf(asked.id).catch(() => null)
        if (state?.state === 'open') await ask.close(asked.id, askClosedWhy(picture.board)).catch(() => {})
        asked = null
      }
      if (asked === null && (declined !== null || recorded?.ask)) { declined = null; await saveRecord({ ask: null, declined: null }) }
    }
  }
  return {
    now: () => picture,
    read: async () => {
      if (clock() - readAt < everyMs && picture !== null) return picture
      reading ??= readNow().finally(() => { reading = null })
      return reading
    },
    /** The deliberate move by code (the ask's A does it): the app's account becomes the board's. `{ ok, result }` or why not. */
    take: async () => {
      await readNow()
      const app = picture?.app ?? null
      if (!isId(app)) return { ok: false, status: 409, why: 'The Claude app\'s account cannot be read just now: try again in a moment.' }
      await takeNow(app)
      readAt = clock()
      return { ok: true, result: { account: app } }
    },
    importMissing: async () => {
      if (picture?.away !== true || picture.app === picture.board || clock() - importedAt < importEveryMs) return []
      importedAt = clock()
      const listed = await list()
      const plan = toImport({ folders: await folders(), dir: appSessions(), app: picture.app, board: picture.board, chatHome, prefix: listed?.prefix ?? null })
      const done = []
      for (const one of plan) {
        const text = await fs.readFile(one.from, 'utf8').catch(() => null)
        // The review: only a whole chat file is copied (one the app is writing just now is read again at the next pass).
        if (text === null || parseAppChat(text) === null) continue
        const wrote = await fs.writeFile(join(one.toDir, `${one.id}.json`), text, { flag: 'wx' }).then(() => true, () => false)
        if (wrote) { done.push(one); log(`Copied the chat "${one.title}" (${one.id}) into the board's Claude account: the app lists it when you switch back.`) }
      }
      return done
    },
  }
}
