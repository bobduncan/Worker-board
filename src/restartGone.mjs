// F19 (chat 2's design of 2026-11-14, .claude/plans/2026-11-14-f19-restart-gone-link.md, chat 1's review D1-D9 and D3' folded in): a chat
// whose board link is gone (F9's `modGone`: the CLI unloaded its Workers mod) is restarted by itself. While the app refuses the board's code
// sends (F17), only a model turn may archive, unarchive or send: the scheduled courier does it, once its prompt says it can (wakes-due with
// `{"restarts":true}`: the handshake). wakes-due lists a restart entry beside the carry words; the courier archives the chat, unarchives the
// chats the archive took with it (its children as the app's files name them, D3'), then the chat, and sends the wake. Only an idle target
// (its transcript: an ended turn, nothing in the background, quiet RESTART_QUIET_MS; its children the same), at most once per spell (the
// unload's time), never while the person pauses, a limit counts full, a stop holds its words, the lane is suspended, being removed or
// stopped by the person, or its Remote Control is on.
//
// The one try per spell is the wake record's (`restartTries`, keyed by chat and spell, pruned with the spells, saved with the record) and the
// raw outbox's (a word the courier took), never an outbox view's (D5). PURE: the server wires it (server.mjs `restartPass`, the take in
// wakes-due, wakes-sent, the page).

import { isAppId, isTaskStopWord } from './hands.mjs'
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
/** The courier's run comes every 10 minutes (tools/wake-courier.md's schedule). */
export const COURIER_EVERY_MS = 10 * 60_000
/** The unarchive-only entry is listed only this long after its word closed (the fix round, item 7); after it the Overview names the chat. */
export const UNARCHIVE_LIST_MS = 30 * 60_000
/** At most this many refused archives per spell, and this many restarts of a chat per RESTART_DAY_MS (the fix round, group D). */
export const REFUSED_MOST = 3
export const RESTARTS_MOST = 3
export const RESTART_DAY_MS = 24 * 60 * 60_000
/** The spells of one chat whose tries the record keeps (as wake.mjs `WAKE_SPELLS_KEPT`). */
export const RESTART_SPELLS_KEPT = 6

const isTime = value => Number.isFinite(value)
const hourMinute = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

/** The page's words (section 6). */
export const RESTARTING_WHY = 'its board link was gone: the courier restarts it'
/** The fix round, item 11: when the restart comes, about: the quiet clock's end or the courier's next run, the later. */
export const restartsAtWhy = at => `restarts by itself at the courier's next run (about ${hourMinute(at)})`
/** The closes' whys (section 3, 4). */
export const LINK_BACK_WHY = 'its link is back'
export const NOT_BACK_WHY = 'a restart did not bring it back'
export const UNSAID_WHY = 'the courier did not say what became of it'
export const NO_COURIER_WHY = 'the courier did not come'
export const HELD_WHY = 'held back'
export const REFUSED_WHY = 'the app refused the archive'
export const STUCK_WHY = 'it stayed archived'
export const REMOTE_WHY = 'Remote Control is on'
export const unseenChildWhy = title => `it started ${title}, which the board cannot see`
/** The Overview's line for a chat a restart left archived. */
export const archivedLine = chat => `${chat} is archived: unarchive it`

/** The wake the restarted chat reads, fixed (section 2). */
export const restartWakeText = at => `The worker board restarted this chat: its Workers mod was unloaded at ${hourMinute(at)}. Go on where you were; if nothing waits for you, end this turn.`
/** What the courier does with the word, in words (the outbox keeps only a word with a `text`: store.mjs `foldOutbox`). */
export const restartText = chat => `Restart ${chat} for the worker board: archive it, unarchive it (and the chats its archive took along), then send it the wake.`

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

/** The record's try of a word; the fix round, item 5: added from the word (its take) when the record lacks it (a crash, a loop takeover). */
function tryOf(record, word) {
  const found = triesOf(record, word?.about).find(entry => entry.word === word?.id)
  if (found !== undefined) return found
  if (!noteRestartTaken(record, { chat: word?.about, spell: word?.spell, word: word?.id, now: word?.takenAt })) return null
  return triesOf(record, word.about).find(entry => entry.word === word.id) ?? null
}

/** The courier said it sent the wake (after the archive and the unarchive): its verdict comes RESTART_VERDICT_MS after it. */
export function noteRestartSent(record, word, now) {
  const one = tryOf(record, word)
  if (one === null || one.verdict !== null || isTime(one.sentAt)) return false
  one.sentAt = now
  return true
}

/** A try's verdict: 'back' (its link came back), 'failed', 'stuck' (it stayed archived) or 'refused' (no try spent, D2). */
export function noteRestartVerdict(record, word, verdict, why, now) {
  if (!['back', 'failed', 'stuck', 'refused'].includes(verdict)) return false
  const one = tryOf(record, word)
  if (one === null || one.verdict !== null) return false
  Object.assign(one, { verdict, verdictAt: now, why: why ?? null })
  return true
}

/** A word the courier took, of `chat`'s `spell`, not closed refused: the raw outbox's own proof of a spent try (the fix round, item 5). */
const isTakenWord = (one, chat, spell) => isRestartWord(one) && one.about === chat && one.spell === spell && isTime(one.takenAt) && !(one.state === 'dropped' && one.why === REFUSED_WHY)

/** The spell's try is spent: a try the courier took that was not refused (an open one counts), in the record or in the raw outbox. */
export const restartSpent = (record, chat, spell, outbox = []) => triesOf(record, chat).some(one => one.spell === spell && one.verdict !== 'refused')
  || (outbox ?? []).some(one => isTakenWord(one, chat, spell))
/** The spell's newest try, or null. */
const newestTry = (record, chat, spell) => triesOf(record, chat).findLast(one => one.spell === spell) ?? null
/**
 * The verifier's N5: the tries of a chat in the record and in the raw outbox (a stale record after a loop takeover), one per word:
 * `[{ word, spell, takenAt, verdict, verdictAt }]`.
 */
function allTries(record, chat, outbox = []) {
  const out = new Map(triesOf(record, chat).map(one => [one.word, one]))
  for (const one of (outbox ?? []).filter(word => isRestartWord(word) && word.about === chat && isTime(word.takenAt))) {
    if (out.has(one.id)) continue
    const refused = one.state === 'dropped' && one.why === REFUSED_WHY
    out.set(one.id, { word: one.id, spell: one.spell, takenAt: one.takenAt, verdict: refused ? 'refused' : null, verdictAt: refused ? one.closedAt ?? null : null })
  }
  return [...out.values()]
}
/** Until when a refused archive holds the next word off (D2), or null. */
export function refusedUntil(record, chat, spell, outbox = []) {
  const refused = allTries(record, chat, outbox).filter(one => one.spell === spell && one.verdict === 'refused' && isTime(one.verdictAt))
  return refused.length === 0 ? null : Math.max(...refused.map(one => one.verdictAt)) + RESTART_REFUSED_MS
}
const refusedCount = (record, chat, spell, outbox = []) => allTries(record, chat, outbox).filter(one => one.spell === spell && one.verdict === 'refused').length
/** The restarts of a chat the courier took within RESTART_DAY_MS (any spell, refused ones not counted). */
const restartsToday = (record, chat, now, outbox = []) => allTries(record, chat, outbox).filter(one => one.verdict !== 'refused' && isTime(one.takenAt) && now - one.takenAt < RESTART_DAY_MS).length

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

/** Idle by its transcript (D1): its turn ended, nothing in the background, quiet RESTART_QUIET_MS. */
export const isQuietIdle = (lane, now) => lane?.transcriptTurn === 'ended' && lane.background === 0 && isTime(lane.transcriptAt) && isTime(now) && now - lane.transcriptAt >= RESTART_QUIET_MS
/** The quiet clock's end of a lane whose turn ended with nothing in the background, or null (busy, asking, background, unknown). */
const quietEndOf = lane => (lane?.transcriptTurn === 'ended' && lane.background === 0 && isTime(lane.transcriptAt) ? lane.transcriptAt + RESTART_QUIET_MS : null)

/** Whether either limit counts full (limits.mjs `limitsOf` level 'full'). */
export const isLimitFull = limits => limits?.week?.level === 'full' || limits?.fiveHour?.level === 'full'

/** Whether a removal of the chat is open (a remove word waiting or taken). */
const removalOpen = (outbox, chat) => (outbox ?? []).some(one => one?.command === 'remove' && one.about === chat && ['waiting', 'taken'].includes(one.state))
/** Whether the person's stop or remove by code waits for the chat (hands.mjs `isTaskStopWord`, B1071). */
const taskStopWaits = (outbox, chat) => (outbox ?? []).some(one => isTaskStopWord(one) && one.about === chat && one.state === 'waiting')

/**
 * The hold on a restart (D4, the fix round's item 3), in words, or null: the person pauses, a full limit, a suspended lane, a lane being
 * removed (`removedAt`, an open removal, an open remove word), a task stop waiting for it, a stop that holds its words. `chat` the word's
 * chat when its lane is off the board.
 */
export function restartHoldOf(lane, { chat = lane?.name, pause = null, limits = null, outbox = [] } = {}) {
  if (carryPaused(pause)) return 'you pause the chats'
  if (isLimitFull(limits)) return 'a limit counts full'
  if ((lane?.suspended ?? null) !== null) return 'it is suspended'
  if (isTime(lane?.removedAt) || lane?.removal?.isOpen === true || removalOpen(outbox, chat)) return 'it is being removed'
  if (taskStopWaits(outbox, chat)) return 'you stopped it'
  if (lane !== null && lane !== undefined && stoppedOf(outbox, lane) !== null) return 'a stop holds its words'
  return null
}

/**
 * D3' (chat 1, 2026-11-14): the chats a target's archive takes along are its children as the app's files name them: the app chats not
 * archived whose `spawnedFrom` is the target's app id, never a leftover, never the target. `children` the state's `appChildren`
 * (`[{ id, parent, title, isArchived }]`, leftovers left out). `[{ id, title }]`.
 */
export const childrenOf = (lane, children = []) => (children ?? []).filter(one => isAppId(lane?.appSession) && one?.parent === lane.appSession && one.isArchived !== true && one.id !== lane.appSession)
/** The app ids the courier unarchives after the target's archive (D3'): its children's. */
export const alsoUnarchiveOf = (lane, children = []) => [...new Set(childrenOf(lane, children).map(one => one.id))]

/**
 * How a lane's restart stands (sections 1 and 6), or null (no gone link, a leftover):
 * - `{ kind: 'restarting' }`: a word the courier took (or a try whose word is still open);
 * - `{ kind: 'failed', why }`: the spell's try is spent and did not bring it back (or it stayed archived);
 * - `{ kind: 'refused', why, until }`: the app refused the archive; no word before `until`;
 * - `{ kind: 'no', why, reason }`: F19 will not act (no courier, no app id, Remote Control, a hold, a busy, asking or background chat, a
 *   child not idle or not on the board, the caps);
 * - `{ kind: 'quiet', at }`: it waits only on the quiet clock, which ends at `at`;
 * - `{ kind: 'ready', at }`: it qualifies now (`at` the quiet clock's end).
 * `ctx`: `{ lanes, children, pause, limits, outbox, record, now, courierAlive }`.
 */
export function restartStandOf(lane, { lanes = [], children = [], pause = null, limits = null, outbox = [], record = null, now, courierAlive = false }) {
  if (lane === null || lane === undefined || lane.isLeftover === true || !isTime(lane.modGone?.at)) return null
  const spell = lane.modGone.at
  const open = (outbox ?? []).filter(one => isOpenWord(one) && one.about === lane.name && one.spell === spell)
  if (open.some(one => one.state === 'taken')) return { kind: 'restarting' }
  const last = newestTry(record, lane.name, spell)
  // The fix round, item 5: an open try reads Restarting only while its word is open; else it failed (its word was closed without a verdict).
  if (last !== null && last.verdict === null && (outbox ?? []).some(one => one.id === last.word && isOpenWord(one))) return { kind: 'restarting' }
  if (restartSpent(record, lane.name, spell, outbox)) return { kind: 'failed', why: last?.why ?? NOT_BACK_WHY }
  if (refusedCount(record, lane.name, spell, outbox) >= REFUSED_MOST) return { kind: 'no', why: MOD_GONE_WHY, reason: `the app refused the archive ${REFUSED_MOST} times` }
  const until = refusedUntil(record, lane.name, spell, outbox)
  if (until !== null && isTime(now) && now < until) return { kind: 'refused', why: REFUSED_WHY, until }
  if (courierAlive !== true) return { kind: 'no', why: MOD_GONE_WHY, reason: 'no courier' }
  if (!isAppId(lane.appSession)) return { kind: 'no', why: MOD_GONE_WHY, reason: 'no app id' }
  if (lane.remoteControl === true) return { kind: 'no', why: MOD_GONE_WHY, reason: REMOTE_WHY }
  if (isTime(now) && restartsToday(record, lane.name, now, outbox) >= RESTARTS_MOST) return { kind: 'no', why: MOD_GONE_WHY, reason: `restarted ${RESTARTS_MOST} times in a day` }
  const hold = restartHoldOf(lane, { pause, limits, outbox })
  if (hold !== null) return { kind: 'no', why: MOD_GONE_WHY, reason: hold, hold: true }
  const own = quietEndOf(lane)
  if (own === null) return { kind: 'no', why: MOD_GONE_WHY, reason: 'not idle' }
  // D3' with D1: the target's archive takes its children along: every child is a board lane and idle the same way.
  const ends = [own]
  for (const child of childrenOf(lane, children)) {
    const board = (lanes ?? []).find(one => one?.isLeftover !== true && one.appSession === child.id)
    if (board === undefined) return { kind: 'no', why: MOD_GONE_WHY, reason: unseenChildWhy(child.title) }
    // The verifier's F1: the archive would take along a child the person drives from the phone, removes or stopped.
    if (board.remoteControl === true) return { kind: 'no', why: MOD_GONE_WHY, reason: `${board.name}: ${REMOTE_WHY}` }
    const childHold = restartHoldOf(board, { outbox })
    if (childHold !== null) return { kind: 'no', why: MOD_GONE_WHY, reason: `${board.name}: ${childHold}` }
    const end = quietEndOf(board)
    if (end === null) return { kind: 'no', why: MOD_GONE_WHY, reason: 'its chats are not idle' }
    ends.push(end)
  }
  const at = Math.max(...ends)
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

/** The word (section 2): for the courier's model (`forModel`: no hand takes it); its list is set at the take (D3'). */
export const restartWord = ({ id, at, need }) => ({
  id, at, to: COURIER, command: CHAT_RESTART, forModel: true, about: need.chat, session: need.session, spell: need.spell, alsoUnarchive: [],
  wakeText: restartWakeText(need.spell), text: restartText(need.chat), state: 'waiting',
})

/** The courier's entries: the restart (archive, unarchive, send) and the unarchive-only one (section 5). */
export const restartEntry = (word, alsoUnarchive) => ({ id: word.id, chat: word.about, session: word.session, text: word.wakeText, restart: true, alsoUnarchive })
export const unarchiveEntry = (word, alsoUnarchive) => ({ id: word.id, chat: word.about, session: word.session, unarchive: true, alsoUnarchive })

/**
 * A restart word the courier may take now: waiting, its chat on the board on the word's session, its spell the gone link's now, and ready
 * (re-checked); never beside an open carry word for the chat, nor while a restart word of one of its children is taken (group D).
 */
export function restartTakeable(word, ctx) {
  if (!isRestartWord(word) || word.state !== 'waiting') return false
  const lane = (ctx.lanes ?? []).find(one => one.name === word.about && one.isLeftover !== true)
  if (lane === undefined || lane.modGone?.at !== word.spell || lane.appSession !== word.session) return false
  const outbox = ctx.outbox ?? []
  if (outbox.some(one => one?.command === 'wake-carry' && one.about === word.about && ['waiting', 'taken'].includes(one.state))) return false
  const kids = new Set(alsoUnarchiveOf(lane, ctx.children))
  const kidNames = new Set((ctx.lanes ?? []).filter(one => kids.has(one.appSession)).map(one => one.name))
  if (outbox.some(one => isRestartWord(one) && one.state === 'taken' && kidNames.has(one.about))) return false
  return restartStandOf(lane, ctx)?.kind === 'ready'
}

/** Section 5 (the fix round, item 3): a removal of the chat began after the take (a remove word made after it, in any state). */
const removedSince = (outbox, chat, at) => (outbox ?? []).some(one => one?.command === 'remove' && one.about === chat && isTime(one.at) && one.at >= at)

/**
 * What the app's files show archived now among a taken word's chats (the fix round, item 6): the target, when `isArchived(word.session)`,
 * and each of the take's `alsoUnarchive` ids (`alsoChats` their names). `[{ id, chat }]`; nothing without a read of the files.
 */
export function archivedOfWord(word, isArchived = null) {
  if (typeof isArchived !== 'function') return []
  const names = word?.alsoChats ?? {}
  return [{ id: word.session, chat: word.about }, ...(word.alsoUnarchive ?? []).map(id => ({ id, chat: typeof names[id] === 'string' ? names[id] : id }))]
    .filter(one => isAppId(one.id) && isArchived(one.id) === true)
}

/**
 * What becomes of the open restart words (section 4), `[{ id, state, why, verdict, failed?, unarchive?, archived? }]`; `verdict` the try's
 * (null: no try spent). `lanes` the board's lanes; `appStartedAt` the app's last start; `isArchived(appId)` the app's files (or null):
 * - any open word, once its chat's link is back: its lane on the board and a report heard after the unload, or the app started after it
 *   (the fix round, item 4: never from a gone link that reads null alone): "its link is back";
 * - sent, no report RESTART_VERDICT_MS after `sentAt`: failed, "a restart did not bring it back";
 * - taken, no wakes-sent after RESTART_TAKEN_MS: failed; with `unarchive` when the board saw the chat archived in that window, it is
 *   still off the board and no removal began since the take (section 5);
 * - waiting during a hold (`restartHoldOf`): "held back"; waiting COURIER_WAIT_MS untaken: "the courier did not come" (no try spent).
 * A taken word's close carries `archived`: what the app's files show archived of it now (`archivedOfWord`).
 */
export function restartCloses({ outbox, lanes, now, pause = null, limits = null, appStartedAt = null, isArchived = null }) {
  const out = []
  for (const word of (outbox ?? []).filter(isOpenWord)) {
    const lane = (lanes ?? []).find(one => one.name === word.about && one.isLeftover !== true)
    const archived = word.state === 'taken' ? { archived: archivedOfWord(word, isArchived) } : {}
    // The verifier's FF1: the side lanes (the Advisor, its helper, the Supervisor, the Product owner) carry their report as `ownReport`.
    const report = lane?.report ?? lane?.ownReport ?? null
    const heard = isTime(report?.heardAt) ? report.heardAt : report?.at
    if (lane !== undefined && ((isTime(heard) && heard > word.spell) || (isTime(appStartedAt) && appStartedAt > word.spell))) {
      out.push({ id: word.id, state: isTime(word.sentAt) ? 'delivered' : 'dropped', why: LINK_BACK_WHY, verdict: word.state === 'taken' ? 'back' : null, ...archived })
    } else if (word.state === 'taken' && isTime(word.sentAt)) {
      if (now - word.sentAt >= RESTART_VERDICT_MS) out.push({ id: word.id, state: 'dropped', why: NOT_BACK_WHY, verdict: 'failed', failed: true, ...archived })
    } else if (word.state === 'taken') {
      if (isTime(word.takenAt) && now - word.takenAt >= RESTART_TAKEN_MS) {
        const seen = isTime(word.archivedAt) && word.archivedAt >= word.takenAt && word.archivedAt - word.takenAt <= RESTART_TAKEN_MS
        out.push({ id: word.id, state: 'dropped', why: UNSAID_WHY, verdict: 'failed', failed: true, unarchive: seen && lane === undefined && !removedSince(outbox, word.about, word.takenAt), ...archived })
      }
    } else if (restartHoldOf(lane ?? null, { chat: word.about, pause, limits, outbox }) !== null) {
      out.push({ id: word.id, state: 'dropped', why: HELD_WHY, verdict: null })
    } else if (isTime(word.at) && now - word.at >= COURIER_WAIT_MS) {
      out.push({ id: word.id, state: 'dropped', why: NO_COURIER_WHY, verdict: null })
    }
  }
  return out
}

/**
 * Section 5 at the listing (the fix round, item 7): the unarchive-only entry of a word whose flag is due, or why it is not listed (then the
 * flag clears, the Overview line stays): over UNARCHIVE_LIST_MS since its close, a removal began since the take, or nothing of it is
 * archived now. `{ entry }` or `{ clear: why }`. Its list: the take's list that the app's files show archived now.
 */
export function unarchiveListing(word, { now, outbox = [], lanes = [], isArchived = null }) {
  if (!isTime(word?.closedAt) || now - word.closedAt > UNARCHIVE_LIST_MS) return { clear: 'listed too late' }
  const lane = (lanes ?? []).find(one => one.name === word.about && one.isLeftover !== true)
  if (removedSince(outbox, word.about, word.takenAt) || restartHoldOf(lane ?? null, { chat: word.about, outbox }) === 'it is being removed') return { clear: 'its chat is being removed' }
  // The verifier's N1: a failed read of the app's files says nothing: the flag stays due for the next run.
  if (typeof isArchived !== 'function') return { wait: 'the app\'s files could not be read' }
  if (isArchived(word.session) !== true) return { clear: 'it is no longer archived' }
  return { entry: unarchiveEntry(word, (word.alsoUnarchive ?? []).filter(id => isArchived(id) === true)) }
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
 * The page's restart words of a Link gone lane (section 6): `{ restarting, why, quiet }`, or null for a lane without a gone link. `quiet` the
 * quiet colour; else the attention colour. The fix round: the time is the courier's next run when it is later than the quiet clock's end
 * (item 11); a failed try shows F9's way out, its why only in the log (item 13).
 */
export function restartRowOf(stand, { courierAt = null } = {}) {
  if (stand === null || stand === undefined) return null
  if (stand.kind === 'restarting') return { restarting: true, why: RESTARTING_WHY, quiet: true }
  if (stand.kind === 'ready' || stand.kind === 'quiet') return { restarting: false, why: restartsAtWhy(Math.max(stand.at, isTime(courierAt) ? courierAt + COURIER_EVERY_MS : -Infinity)), quiet: true }
  if (stand.kind === 'failed') return { restarting: false, why: MOD_GONE_WHY, quiet: false }
  // The verifier's N6: a refused archive says when the courier tries again.
  if (stand.kind === 'refused') return { restarting: false, why: `${REFUSED_WHY} · tries again about ${hourMinute(Math.max(stand.until, isTime(courierAt) ? courierAt + COURIER_EVERY_MS : -Infinity))}`, quiet: false }
  // The verifier's N8: a chat being removed gets no restart advice.
  if (stand.hold === true && stand.reason === 'it is being removed') return { restarting: false, why: 'it is being removed', quiet: false }
  // Group D: a hold says why the courier does not restart it now ("not by itself while you pause the chats").
  if (stand.hold === true) return { restarting: false, why: `${MOD_GONE_WHY} (not by itself while ${stand.reason})`, quiet: false }
  return { restarting: false, why: stand.why ?? MOD_GONE_WHY, quiet: false }
}

/**
 * The chats a restart left archived (section 3's stuck, section 5, the fix round's item 6): the chats each restart word closed in `shownMs`
 * found archived in the app's files at its close (`archived`, kept on the word), still off the board now. The Overview names each
 * (`archivedLine`).
 */
export function restartArchivedOf(outbox, lanes, now, shownMs = 12 * 60 * 60_000) {
  const onBoard = new Set((lanes ?? []).filter(lane => lane?.isLeftover !== true).map(lane => lane.name))
  const names = new Set()
  for (const word of (outbox ?? []).filter(one => isRestartWord(one) && !isOpenWord(one) && Array.isArray(one.archived))) {
    const at = word.closedAt ?? word.at
    if (!isTime(at) || now - at >= shownMs) continue
    for (const one of word.archived) if (typeof one?.chat === 'string' && !onBoard.has(one.chat)) names.add(one.chat)
  }
  return [...names]
}
