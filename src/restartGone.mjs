// F19 (chat 2's design of 2026-11-14, .claude/plans/2026-11-14-f19-restart-gone-link.md, chat 1's review D1-D9 folded in): a chat whose
// board link is gone (F9's `modGone`: the CLI unloaded its Workers mod) is restarted by itself. While the app refuses the board's code
// sends (F17), only a model turn may archive, unarchive or send: the scheduled courier does it. wakes-due lists a restart entry beside the
// carry words; the courier archives the chat, unarchives the chats the archive took with it (a starter's, D3), then the chat, and sends
// the wake. Only an idle target (its transcript: an ended turn, nothing in the background, quiet RESTART_QUIET_MS), at most once per
// spell (the unload's time), never while the person pauses, a limit counts full, a stop holds its words or the lane is suspended.
//
// The one try per spell is the wake record's (`restartTries`, keyed by chat and spell, pruned with the spells, saved with the record),
// never an outbox view's (D5). PURE: the server wires it (server.mjs `restartPass`, the take in wakes-due, wakes-sent, the page).

import { isAppId } from './hands.mjs'
import { MOD_GONE_WHY } from './modGone.mjs'
import { stoppedOf } from './stopped.mjs'
import { COURIER, COURIER_WAIT_MS, carryPaused } from './wakeCarry.mjs'

/** The word's command (its own: F17's `isCarryWord` and `carryCloses` never see it; work/modRollout.mjs's 'mod-restart' is another). */
export const CHAT_RESTART = 'chat-restart'
/** The transcript has been quiet this long before a restart (the person may have started a turn; a draft in the input box is not seen). */
export const RESTART_QUIET_MS = 10 * 60_000
/** A refused archive (D2: the app refuses a chat with live background work) spends no try; the next word no sooner than this after it. */
export const RESTART_REFUSED_MS = 30 * 60_000
/** Sent, and no report this long after `sentAt`: a restart did not bring it back. */
export const RESTART_VERDICT_MS = 10 * 60_000
/** Taken, and no wakes-sent this long after the take: failed (the courier's run window). */
export const RESTART_TAKEN_MS = 15 * 60_000
/** The spells of one chat whose tries the record keeps (as wake.mjs `WAKE_SPELLS_KEPT`). */
export const RESTART_SPELLS_KEPT = 6

/** The page's words (section 6). */
export const RESTARTING_WHY = 'its board link was gone: the courier restarts it'
export const restartsAtWhy = at => `restarts by itself at ${hourMinute(at)}`
/** The closes' whys (section 3, 4). */
export const LINK_BACK_WHY = 'its link is back'
export const NOT_BACK_WHY = 'a restart did not bring it back'
export const UNSAID_WHY = 'the courier did not say what became of it'
export const NO_COURIER_WHY = 'the courier did not come'
export const HELD_WHY = 'held back'
export const REFUSED_WHY = 'the app refused the archive'
export const STUCK_WHY = 'it stayed archived'
/** The Overview's line for a chat a restart left archived. */
export const archivedLine = chat => `${chat} is archived: unarchive it`

const isTime = value => Number.isFinite(value)
const hourMinute = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

/** The wake the restarted chat reads, fixed (section 2). */
export const restartWakeText = at => `The worker board restarted this chat: its Workers mod was unloaded at ${hourMinute(at)}. Go on where you were; if nothing waits for you, end this turn.`

/** Whether a word is a restart word. */
export const isRestartWord = message => message?.command === CHAT_RESTART
const isOpenWord = message => isRestartWord(message) && (message.state === 'waiting' || message.state === 'taken')

// ---- The try record (in the wake record: `record.restartTries`, Map<chat, try[]>) ----

const triesOf = (record, chat) => record?.restartTries?.get?.(chat) ?? []

/** Keeps the tries of the newest RESTART_SPELLS_KEPT spells of a chat (pruned with the spells, as wake.mjs `newSpell` keeps its). */
function pruned(tries) {
  const spells = [...new Set(tries.map(one => one.spell))].slice(-RESTART_SPELLS_KEPT)
  return tries.filter(one => spells.includes(one.spell))
}

/** The courier took a restart word: the spell's try (D5: a word counts toward its spell only once taken). True when noted. */
export function noteRestartTaken(record, { chat, spell, word, now }) {
  if (typeof chat !== 'string' || chat === '' || !isTime(spell) || typeof word !== 'string' || !isTime(now)) return false
  if (!(record.restartTries instanceof Map)) record.restartTries = new Map()
  if (triesOf(record, chat).some(one => one.word === word)) return false
  record.restartTries.set(chat, pruned([...triesOf(record, chat), { spell, word, takenAt: now, sentAt: null, verdict: null, verdictAt: null, why: null }]))
  return true
}

/** The courier said it sent the wake (after the archive and the unarchive): its verdict comes RESTART_VERDICT_MS after it. */
export function noteRestartSent(record, chat, word, now) {
  const one = triesOf(record, chat).find(entry => entry.word === word)
  if (one === undefined || one.verdict !== null || isTime(one.sentAt)) return false
  one.sentAt = now
  return true
}

/** A try's verdict: 'back' (its link came back), 'failed', 'stuck' (it stayed archived) or 'refused' (no try spent, D2). */
export function noteRestartVerdict(record, chat, word, verdict, why, now) {
  const one = triesOf(record, chat).find(entry => entry.word === word)
  if (one === undefined || one.verdict !== null || !['back', 'failed', 'stuck', 'refused'].includes(verdict)) return false
  Object.assign(one, { verdict, verdictAt: now, why: why ?? null })
  return true
}

/** The spell's try is spent: a try the courier took that was not refused (an open one counts). */
export const restartSpent = (record, chat, spell) => triesOf(record, chat).some(one => one.spell === spell && one.verdict !== 'refused')
/** The spell's newest try, or null. */
const newestTry = (record, chat, spell) => triesOf(record, chat).findLast(one => one.spell === spell) ?? null
/** Until when a refused archive holds the next word off (D2), or null. */
export function refusedUntil(record, chat, spell) {
  const refused = triesOf(record, chat).filter(one => one.spell === spell && one.verdict === 'refused' && isTime(one.verdictAt))
  return refused.length === 0 ? null : Math.max(...refused.map(one => one.verdictAt)) + RESTART_REFUSED_MS
}

/** The record's tries as the file holds them: `{ "<chat>": [try, ...] }`, or null for none. */
export function textOfRestartTries(record) {
  const tries = record?.restartTries instanceof Map ? [...record.restartTries].filter(([, list]) => list.length > 0) : []
  return tries.length === 0 ? null : Object.fromEntries(tries)
}

/** The tries a parsed file holds (left out what is no try), as the record's Map. */
export function restartTriesOfFile(value) {
  const out = new Map()
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [chat, list] of Object.entries(value)) {
    if (chat === '' || !Array.isArray(list)) continue
    const kept = list.filter(one => one !== null && typeof one === 'object' && isTime(one.spell) && typeof one.word === 'string' && isTime(one.takenAt)
      && (one.sentAt === null || isTime(one.sentAt)) && (one.verdict === null || ['back', 'failed', 'stuck', 'refused'].includes(one.verdict)) && (one.verdictAt === null || isTime(one.verdictAt)))
      .map(one => ({ spell: one.spell, word: one.word, takenAt: one.takenAt, sentAt: one.sentAt, verdict: one.verdict, verdictAt: one.verdictAt, why: typeof one.why === 'string' ? one.why.slice(0, 200) : null }))
    if (kept.length > 0) out.set(chat, pruned(kept))
  }
  return out
}

// ---- When a chat qualifies (section 1) ----

/** The starters (Main, the Advisor): archiving one archives the finished chats it started (D3). */
export const startersOf = state => [state?.restart?.main ?? (state?.chats ?? []).find(lane => lane.isMain === true && lane.isLeftover !== true)?.name, state?.advisor?.name]
  .filter(name => typeof name === 'string' && name !== '')

/** Idle by its transcript (D1): its turn ended, nothing in the background, quiet RESTART_QUIET_MS. */
export const isQuietIdle = (lane, now) => lane?.transcriptTurn === 'ended' && lane.background === 0 && isTime(lane.transcriptAt) && isTime(now) && now - lane.transcriptAt >= RESTART_QUIET_MS
/** The quiet clock's end of a lane whose turn ended with nothing in the background, or null (busy, asking, background, unknown). */
const quietEndOf = lane => (lane?.transcriptTurn === 'ended' && lane.background === 0 && isTime(lane.transcriptAt) ? lane.transcriptAt + RESTART_QUIET_MS : null)

/** Whether either limit counts full (limits.mjs `limitsOf` level 'full'). */
export const isLimitFull = limits => limits?.week?.level === 'full' || limits?.fiveHour?.level === 'full'

/** The hold on a restart (D4), in words, or null: the person pauses, a full limit, a suspended lane, a stop that holds its words. */
export function restartHoldOf(lane, { pause = null, limits = null, outbox = [] } = {}) {
  if (carryPaused(pause)) return 'you pause the chats'
  if (isLimitFull(limits)) return 'a limit counts full'
  if ((lane?.suspended ?? null) !== null) return 'it is suspended'
  if (stoppedOf(outbox, lane) !== null) return 'a stop holds its words'
  return null
}

/**
 * The board lanes a starter's restart unarchives after the archive (D3): the app ids of the board's lanes the app does not list archived
 * (`archived`, a Set of app ids), never leftovers, never the target; only a starter carries a list, any other target an empty one.
 * `lanes` the board's lanes (say.mjs `boardLanes`: no side chat 0-4 is one).
 */
export function alsoUnarchiveOf(lanes, target, { starters = [], archived = new Set() } = {}) {
  if (!starters.includes(target)) return []
  return [...new Set((lanes ?? []).filter(lane => lane?.isLeftover !== true && lane.name !== target && isAppId(lane.appSession) && !archived.has(lane.appSession)).map(lane => lane.appSession))]
}

/**
 * How a lane's restart stands (sections 1 and 6), or null (no gone link, a leftover):
 * - `{ kind: 'restarting' }`: a word the courier took (or a try without its verdict);
 * - `{ kind: 'failed', why }`: the spell's try is spent and did not bring it back (or it stayed archived);
 * - `{ kind: 'refused', why, until }`: the app refused the archive; no word before `until`;
 * - `{ kind: 'no', why }`: F19 will not act (no courier, no app id, a hold, a busy, asking or background chat, a starter's chats not idle);
 * - `{ kind: 'quiet', at }`: it waits only on the quiet clock, which ends at `at`;
 * - `{ kind: 'ready', at }`: it qualifies now (`at` the quiet clock's end).
 * `ctx`: `{ lanes, starters, pause, limits, outbox, record, now, courierAlive }`.
 */
export function restartStandOf(lane, { lanes = [], starters = [], pause = null, limits = null, outbox = [], record = null, now, courierAlive = false }) {
  if (lane === null || lane === undefined || lane.isLeftover === true || !isTime(lane.modGone?.at)) return null
  const spell = lane.modGone.at
  if ((outbox ?? []).some(one => isOpenWord(one) && one.state === 'taken' && one.about === lane.name && one.spell === spell)) return { kind: 'restarting' }
  const last = newestTry(record, lane.name, spell)
  if (last !== null && last.verdict === null) return { kind: 'restarting' }
  if (restartSpent(record, lane.name, spell)) return { kind: 'failed', why: last?.why ?? NOT_BACK_WHY }
  const until = refusedUntil(record, lane.name, spell)
  if (until !== null && isTime(now) && now < until) return { kind: 'refused', why: REFUSED_WHY, until }
  if (courierAlive !== true) return { kind: 'no', why: MOD_GONE_WHY, reason: 'no courier' }
  if (!isAppId(lane.appSession)) return { kind: 'no', why: MOD_GONE_WHY, reason: 'no app id' }
  const hold = restartHoldOf(lane, { pause, limits, outbox })
  if (hold !== null) return { kind: 'no', why: MOD_GONE_WHY, reason: hold }
  const own = quietEndOf(lane)
  if (own === null) return { kind: 'no', why: MOD_GONE_WHY, reason: 'not idle' }
  // D3 with D1: a starter's archive takes the chats it started along: every lane on its list is idle the same way.
  const listed = new Set(alsoUnarchiveOf(lanes, lane.name, { starters }))
  const others = (lanes ?? []).filter(one => one?.isLeftover !== true && one.name !== lane.name && listed.has(one.appSession)).map(quietEndOf)
  if (others.includes(null)) return { kind: 'no', why: MOD_GONE_WHY, reason: 'its chats are not idle' }
  const at = Math.max(own, ...others)
  return isTime(now) && now >= at ? { kind: 'ready', at } : { kind: 'quiet', at }
}

/**
 * The chats a restart word is due for now (section 1): their stand is `ready` and no restart word of theirs is open (waiting or taken).
 * `[{ chat, session, spell }]`. `ctx` as `restartStandOf`.
 */
export function restartNeeds(ctx) {
  const open = new Set((ctx.outbox ?? []).filter(isOpenWord).map(one => one.about))
  return (ctx.lanes ?? []).filter(lane => lane?.isLeftover !== true && !open.has(lane.name) && restartStandOf(lane, ctx)?.kind === 'ready')
    .map(lane => ({ chat: lane.name, session: lane.appSession, spell: lane.modGone.at }))
}

/** What the courier does with the word, in words (the outbox keeps only a word with a `text`: store.mjs `foldOutbox`). */
export const restartText = chat => `Restart ${chat} for the worker board: archive it, unarchive it (and the chats its archive took along), then send it the wake.`

/** The word (section 2): for the courier's model (`forModel`: no hand takes it); its list is set at the take (D3). */
export const restartWord = ({ id, at, need }) => ({
  id, at, to: COURIER, command: CHAT_RESTART, forModel: true, about: need.chat, session: need.session, spell: need.spell, alsoUnarchive: [],
  wakeText: restartWakeText(need.spell), text: restartText(need.chat), state: 'waiting',
})

/** The courier's entries: the restart (archive, unarchive, send) and the unarchive-only one (section 5). */
export const restartEntry = (word, alsoUnarchive) => ({ id: word.id, chat: word.about, session: word.session, text: word.wakeText, restart: true, alsoUnarchive })
export const unarchiveEntry = word => ({ id: word.id, chat: word.about, session: word.session, unarchive: true, alsoUnarchive: Array.isArray(word.alsoUnarchive) ? word.alsoUnarchive : [] })

/** A restart word the courier may take now: waiting, its chat on the board, its spell the gone link's now, and ready (re-checked). */
export function restartTakeable(word, ctx) {
  if (!isRestartWord(word) || word.state !== 'waiting') return false
  const lane = (ctx.lanes ?? []).find(one => one.name === word.about && one.isLeftover !== true)
  return lane !== undefined && lane.modGone?.at === word.spell && restartStandOf(lane, ctx)?.kind === 'ready'
}

/** Whether a removal of the chat is open (a remove word waiting or taken). */
const removalOpen = (outbox, chat) => (outbox ?? []).some(one => one?.command === 'remove' && one.about === chat && ['waiting', 'taken'].includes(one.state))

/**
 * What becomes of the open restart words (section 4), `[{ id, state, why, verdict, failed?, unarchive? }]`; `verdict` the try's (null: no
 * try spent). `lanes` the board's lanes; `isHeld(lane)` the pause, a full limit or a suspension (the courier's take re-checks the rest):
 * - any open word, once its chat's link is back (its lane on the board with no gone link, or another spell's): "its link is back";
 * - sent, no report RESTART_VERDICT_MS after `sentAt`: failed, "a restart did not bring it back";
 * - taken, no wakes-sent after RESTART_TAKEN_MS: failed; with `unarchive` when the board saw the chat archived in that window, it is
 *   still off the board and no removal is open (section 5);
 * - waiting during a hold: "held back"; waiting COURIER_WAIT_MS untaken: "the courier did not come" (no try spent).
 * A chat that is off the board (archived mid-run) gets no "link is back".
 */
export function restartCloses({ outbox, lanes, now, isHeld = () => false }) {
  const out = []
  for (const word of (outbox ?? []).filter(isOpenWord)) {
    const lane = (lanes ?? []).find(one => one.name === word.about && one.isLeftover !== true)
    if (lane !== undefined && lane.modGone?.at !== word.spell) {
      out.push({ id: word.id, state: isTime(word.sentAt) ? 'delivered' : 'dropped', why: LINK_BACK_WHY, verdict: word.state === 'taken' ? 'back' : null })
    } else if (word.state === 'taken' && isTime(word.sentAt)) {
      if (now - word.sentAt >= RESTART_VERDICT_MS) out.push({ id: word.id, state: 'dropped', why: NOT_BACK_WHY, verdict: 'failed', failed: true })
    } else if (word.state === 'taken') {
      if (isTime(word.takenAt) && now - word.takenAt >= RESTART_TAKEN_MS) {
        const seen = isTime(word.archivedAt) && word.archivedAt >= word.takenAt && word.archivedAt - word.takenAt <= RESTART_TAKEN_MS
        out.push({ id: word.id, state: 'dropped', why: UNSAID_WHY, verdict: 'failed', failed: true, unarchive: seen && lane === undefined && !removalOpen(outbox, word.about) })
      }
    } else if (isHeld(lane ?? null)) {
      out.push({ id: word.id, state: 'dropped', why: HELD_WHY, verdict: null })
    } else if (isTime(word.at) && now - word.at >= COURIER_WAIT_MS) {
      out.push({ id: word.id, state: 'dropped', why: NO_COURIER_WHY, verdict: null })
    }
  }
  return out
}

/**
 * Whether the app lists a chat archived now: the newest account folder that holds its file marks it so (appChats.mjs
 * `readAccountFolders`: `[{ at, chats: Map<app id, chat> }]`). Unknown is not archived.
 */
export function isArchivedIn(appSession, folders) {
  const holding = (folders ?? []).filter(folder => folder?.chats?.get?.(appSession) !== undefined).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  return holding.length > 0 && holding[0].chats.get(appSession).isArchived === true
}

/**
 * The page's restart words of a Link gone lane (section 6): `{ status, why, quiet }`, `status` 'Restarting' or 'Link gone' (the
 * caller's names), or null for a lane without a gone link. `quiet` the quiet colour; else the attention colour.
 */
export function restartRowOf(stand) {
  if (stand === null || stand === undefined) return null
  if (stand.kind === 'restarting') return { restarting: true, why: RESTARTING_WHY, quiet: true }
  if (stand.kind === 'ready' || stand.kind === 'quiet') return { restarting: false, why: restartsAtWhy(stand.at), quiet: true }
  return { restarting: false, why: stand.why ?? MOD_GONE_WHY, quiet: false }
}

/**
 * The chats a restart left archived (section 3's stuck, section 5's "otherwise, or still archived after it"): the newest restart word of
 * each chat closed failed in `shownMs` (`failed`; stuck, or its run window ended without a word) whose chat is not on the board now
 * (the app lists it archived). The Overview names each (`archivedLine`).
 */
export function restartArchivedOf(outbox, lanes, now, shownMs = 12 * 60 * 60_000) {
  const onBoard = new Set((lanes ?? []).filter(lane => lane?.isLeftover !== true).map(lane => lane.name))
  const newest = new Map()
  for (const word of (outbox ?? []).filter(isRestartWord)) {
    const at = word.closedAt ?? word.at
    if ((newest.get(word.about)?.at ?? -Infinity) <= at) newest.set(word.about, { word, at })
  }
  return [...newest.values()].filter(({ word, at }) => word.failed === true && [STUCK_WHY, UNSAID_WHY].includes(word.why) && !onBoard.has(word.about) && isTime(at) && now - at < shownMs)
    .map(({ word }) => word.about)
}
