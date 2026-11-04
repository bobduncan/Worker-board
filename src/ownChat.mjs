// B986 (X140, 2026-11-04): a lane's own chat, the one its reports name, never the chat its title happens to match. After
// the person's account switch at 10:56 the app's list held an old "Worker 4" of 28 Oct (local_800a5b00) and not the chat
// that held B968 (local_cce12d1f, its reports' session 0c8d674a). The lane is the list's chat by its title, so the main
// chat's wake message, the board's launch and the set word all went to the old chat, and nothing said the true one was
// gone. Now every wake goes by the lane's own chat: the chat whose session (or app id) its kept report names, wherever it
// stands in the app's list. When the list holds no such chat the lane's chat is "not in the app's list": the wake says
// "could not wake" at once, with no message, no launch and no two-minute wait (src/wake.mjs).
//
// PURE: the lane, its kept report (server.mjs `reports`, bridge.mjs `noteReport`), the app's chats as the state parsed
// them and the app ids whose files the read saw come in.

/** The why of a wake that cannot be tried: the lane's own chat is not in the app's list (wake.mjs `wakeOf`, the notice). */
export const NOT_LISTED_WHY = 'its chat is not in the app\'s list'

/**
 * The app's answer to a message for a chat it does not have, or has archived (the hand-out's "Session local_82c0c4cd...
 * not found" of B984 at 11:31, the Advisor's "session local_cce12d1f is archived" of 11:34): the chat is not in the
 * app's list, whatever the board's last read said.
 */
export const isNotListedAnswer = why => /\bnot found\b|\bis archived\b|\bno such session\b/i.test(String(why ?? ''))

const isText = value => typeof value === 'string' && value !== ''

/**
 * The lane's own chat: `{ session, appSession, isListed, by }`.
 *
 * - No kept report, or one without a session: the lane's chat by its title (`by` 'title'): the board knows no other.
 * - The kept report names the lane's chat (its session, or its app id after a clear or an import gave it a new session):
 *   that chat (`by` 'report').
 * - It names another open chat of the app's list (`apps`, any title): that one.
 * - It names none: `isListed` false and no ids, unless the read saw the file of its app id without a chat in it (the app
 *   rewrites the file: `isListed` null, not known on this read, so no case for a chat listed again at the next read).
 *
 * `lane` `{ session, appSession }` (the title's chat), `kept` the report `{ session, app }`, `apps` the parsed app chats
 * `{ sessionId, cliSessionId, isArchived }`, `appFiles` the app ids of the files read (null when not known).
 */
export function ownChatOf({ lane, kept = null, apps = [], appFiles = null }) {
  const title = { session: lane?.session ?? null, appSession: lane?.appSession ?? null, isListed: true, by: 'title' }
  if (kept === null || kept === undefined || !isText(kept.session)) return title
  const app = isText(kept.app) ? kept.app : null
  if (kept.session === title.session || (app !== null && app === title.appSession)) return { ...title, by: 'report' }
  const other = (apps ?? []).find(chat => chat?.isArchived !== true && (chat.cliSessionId === kept.session || (app !== null && chat.sessionId === app)))
  if (other !== undefined) return { session: other.cliSessionId ?? null, appSession: other.sessionId ?? null, isListed: true, by: 'report' }
  const isRewritten = app !== null && appFiles instanceof Set && appFiles.has(app) && !(apps ?? []).some(chat => chat?.sessionId === app)
  return { session: null, appSession: null, isListed: isRewritten ? null : false, by: 'report' }
}

/**
 * The ids a wake of `lane` goes by: its own chat's (`lane.own`, set by the state), else, for a lane the state gave none
 * (the partner, its helper, the supervisor's chat), its own fields. `{ session, appSession, isListed }`.
 */
export function wakeIdsOf(lane) {
  const own = lane?.own ?? null
  if (own !== null && typeof own === 'object') return { session: own.session ?? null, appSession: own.appSession ?? null, isListed: own.isListed ?? true }
  return { session: lane?.session ?? null, appSession: lane?.appSession ?? null, isListed: true }
}
