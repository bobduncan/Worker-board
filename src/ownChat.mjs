// B986 (X140, 2026-11-04): a lane's own chat, the one its reports name, never the chat its title happens to match. After
// the person's account switch at 10:56 the app's list held an old "Worker 4" of 28 Oct (local_800a5b00) and not the chat
// that held B968 (local_cce12d1f, its reports' session 0c8d674a). The lane is the list's chat by its title, so the main
// chat's wake message, the board's launch and the set word all went to the old chat, and nothing said the true one was
// gone. Now every wake goes by the lane's own chat: the chat whose session (or app id) its kept report names. When the
// list holds no such chat the lane's chat is "not in the app's list", and when the board shows another chat of that name
// the own chat could take nothing (the bridge serves the shown session only): either way the wake says "could not wake"
// at once, with no message, no launch and no two-minute wait (src/wake.mjs).
//
// PURE: the lane, its kept report (server.mjs `reports`, bridge.mjs `noteReport`), the app's chats as the state parsed
// them and the app ids whose files the read saw come in.

/** The why of a wake that cannot be tried: the lane's own chat is not in the app's list (wake.mjs `wakeOf`, the notice). */
export const NOT_LISTED_WHY = 'its chat is not in the app\'s list'
/** The why of a wake that cannot be tried: the own chat is listed, but the board shows an older chat of its name. */
export const NOT_SHOWN_WHY = 'another chat of its name is open in the app: archive the one that does not hold its work'

/**
 * H1 (2026-11-05, the person's account switch): the own chat's file is only in the folder of the person's OTHER Claude
 * account (the board reads one account's folder, the newest). The reimport skill brings it over; the app reads new files at
 * a start.
 */
export const OTHER_ACCOUNT_WHY = 'your chats are in your other Claude account: run /reimport-chats, then restart the app'
/** H1: the file is in the folder the board reads, yet the app answered "not found" (it reads new files only at a start). */
export const RESTART_WHY = 'restart the app so it reads the reimported chats'

/**
 * The app's answer to a message for a session it does not have (the hand-out's "Session local_82c0c4cd... not found" of
 * B984 at 11:31): the chat is not in the app's list, whatever the board's last read said. Only an answer that names a
 * session; "archived" is not one (X140 11:34:48: the launch after it worked).
 */
export const isNotListedAnswer = why => /\bsession\s+local_[\w-]+\S*\s+(?:was\s+|is\s+)?not\s+found\b|\bno\s+such\s+session\b/i.test(String(why ?? ''))

const isText = value => typeof value === 'string' && value !== ''

/**
 * The report kept under a lane's name, when it is still that lane's (the review of B986): not when the title's chat
 * (`chat`, with `createdAt`) was made after the report (a new chat that took a renamed chat's name), nor when the chat
 * it names is shown under another lane's name (`chats`, the board's chats that are no leftover: `{ name, cliSessionId,
 * appSessionId }`). Null otherwise.
 */
export function keptFor({ name, kept = null, chat = null, chats = [] }) {
  if (kept === null || kept === undefined || !isText(kept.session)) return null
  // H2: a launch stub (appChats.mjs `isStub`) is made by the board's own launch, after the report: it says nothing of whose chat it is.
  if (chat?.isStub !== true && Number.isFinite(chat?.createdAt) && Number.isFinite(kept.at) && chat.createdAt > kept.at) return null
  const app = isText(kept.app) ? kept.app : null
  const elsewhere = (chats ?? []).some(one => one?.isLeftover !== true && one.name !== name && (one.cliSessionId === kept.session || (app !== null && one.appSessionId === app)))
  return elsewhere ? null : kept
}

/**
 * The lane's own chat: `{ session, appSession, isListed, isShown, by }`.
 *
 * - No kept report (or none that is still the lane's, `keptFor`): the lane's chat by its title (`by` 'title').
 * - The kept report names the lane's chat (its session, or its app id after a clear or an import gave it a new session):
 *   that chat (`by` 'report').
 * - It names another open chat of the app's list (`apps`, any title): that one, `isShown` false: the board shows the
 *   title's chat under its name, so the own chat's takes are refused and no wake of it can be heard.
 * - It names none: `isListed` false and no ids, unless the read saw the file of its app id without a chat in it (the app
 *   rewrites the file: `isListed` null, not known on this read, with the report's ids, so the wake goes on as before).
 *
 * `lane` `{ session, appSession }` (the title's chat), `kept` the report `{ session, app }`, `apps` the parsed app chats
 * `{ sessionId, cliSessionId, isArchived }`, `appFiles` the app ids of the files read (null when not known).
 */
export function ownChatOf({ lane, kept = null, apps = [], appFiles = null, elsewhere = null }) {
  // G2: the id a launch resumes is the one the app's file holds (`rawCliSessionId`, state.mjs), not the end of the clear chain;
  // only when it differs from the session, so a file that is up to date adds nothing.
  const launchOf = (session, appSession) => {
    const chat = (apps ?? []).find(one => one?.isArchived !== true && ((appSession !== null && one.sessionId === appSession) || (session !== null && one.cliSessionId === session)))
    return isText(chat?.rawCliSessionId) && chat.rawCliSessionId !== session ? { launch: chat.rawCliSessionId } : {}
  }
  const title = { session: lane?.session ?? null, appSession: lane?.appSession ?? null, isListed: true, isShown: true, by: 'title' }
  if (kept === null || kept === undefined || !isText(kept.session)) return { ...title, ...launchOf(title.session, title.appSession) }
  const app = isText(kept.app) ? kept.app : null
  if (kept.session === title.session || (app !== null && app === title.appSession)) return { ...title, ...launchOf(title.session, title.appSession), by: 'report' }
  const other = (apps ?? []).find(chat => chat?.isArchived !== true && (chat.cliSessionId === kept.session || (app !== null && chat.sessionId === app)))
  if (other !== undefined) return { session: other.cliSessionId ?? null, appSession: other.sessionId ?? null, isListed: true, isShown: false, by: 'report', ...launchOf(other.cliSessionId ?? null, other.sessionId ?? null) }
  const isRewritten = app !== null && appFiles instanceof Set && appFiles.has(app) && !(apps ?? []).some(chat => chat?.sessionId === app)
  if (isRewritten) return { session: kept.session, appSession: app, isListed: null, isShown: true, by: 'report' }
  // H1: its file is in a folder the board does not read: the person's other Claude account (`elsewhere`, app id to account).
  const account = app !== null && elsewhere instanceof Map ? elsewhere.get(app) ?? null : null
  return { session: null, appSession: null, isListed: false, isShown: true, by: 'report', ...(account === null ? {} : { elsewhere: account }) }
}

/**
 * The ids a wake of `lane` goes by: its own chat's (`lane.own`, set by the state), else, for a lane the state gave none
 * (the partner, its helper, the supervisor's chat), its own fields. `{ session, appSession, isListed, why }`: `why` the
 * reason no wake can be tried (NOT_LISTED_WHY, NOT_SHOWN_WHY), else null.
 */
export function wakeIdsOf(lane) {
  const own = lane?.own ?? null
  if (own === null || typeof own !== 'object') return { session: lane?.session ?? null, appSession: lane?.appSession ?? null, isListed: true, why: null }
  const why = own.isListed === false ? (typeof own.elsewhere === 'string' ? OTHER_ACCOUNT_WHY : NOT_LISTED_WHY) : own.isShown === false ? NOT_SHOWN_WHY : null
  // G2: a launch resumes the id the app's file holds (`launch`), when it differs from the session the board follows.
  return { session: own.launch ?? own.session ?? null, appSession: own.appSession ?? null, isListed: own.isListed ?? true, why }
}

/** Why no wake of `lane` can be tried (NOT_LISTED_WHY, NOT_SHOWN_WHY), or null. */
export const cannotWakeWhy = lane => wakeIdsOf(lane).why
