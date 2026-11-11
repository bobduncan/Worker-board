// Signals change 2 (the lead's brief .claude/plans/2026-10-31-one-word-per-chat-brief.md, the person's yes of 2026-10-31
// 16:05): ONE status per chat, from one pure function, the same in every view. Today a chat can show "Free", "asleep"
// and "restarting" at once, reads Unknown for about a minute after a clear, and every view renames the statuses.
//
// DISPLAY ONLY (the design rule): `lane.state`, `isRunning`, `asleep`, `report` and `lane.handover` stay the decision
// inputs of the hand-out, the reconciler, the rules and the words of text the board types; this function reads them and writes
// nothing back, so no status feeds a decision (no loop: status Free <- hand-out <- state free); `state` is what the board decides on, `status` what the pill shows. PURE.
//
// The statuses and their precedence (the first that holds wins) are the brief's table, with the age: `age = now - report.at`
// (the mod refreshes `at` with every 5 s ping, so a live chat's age is seconds). Times are the board's own clock (`now`).

import { BAN_WHY_MARK, UNANSWERED_WHY } from './work/handover.mjs'
import { chatWaitWords, isChatWait, isRecapWait, recapSuspensionWords } from './work/waitsOn.mjs'
import { assetWaitWords, isAssetWait } from './work/assetWait.mjs'

const MIN = 60_000

/** The statuses, in the order the head counts and the legends show them. */
export const STATUSES = Object.freeze({
  WORKING: 'Working', WAITING: 'Waiting for you', CHECKING: 'Checking', HANDING: 'Handing', OFFERED: 'Offered', HELD: 'Held',
  NO_ANSWER: 'Did not answer', PAUSED: 'Paused', RESTARTING: 'Restarting', STOPPED: 'Stopped', FREE: 'Free', ASLEEP: 'Asleep',
  NOT_RUNNING: 'Not running', UNKNOWN: 'Unknown',
})

/** The status list, as the page reads it (a drawn status is always one of these). */
export const STATUS_LIST = Object.freeze(Object.values(STATUSES))

/**
 * Per status: `key` (its name in the head counts and its css class), `tone` (`quiet`: information; `attention`: needs a look,
 * the person's colour rule: attention only for what needs attention; `late`: quiet at first, attention once its age is over
 * `UNKNOWN_ATTENTION_MS`), `busy` (counted among the busy chats: only a chat that really works).
 */
export const STATUS_FACTS = Object.freeze({
  [STATUSES.WORKING]: { key: 'working', tone: 'quiet', busy: true },
  [STATUSES.WAITING]: { key: 'waiting', tone: 'attention', busy: false },
  [STATUSES.CHECKING]: { key: 'checking', tone: 'quiet', busy: false },
  [STATUSES.HANDING]: { key: 'handing', tone: 'quiet', busy: false },
  [STATUSES.OFFERED]: { key: 'offered', tone: 'quiet', busy: false },
  [STATUSES.HELD]: { key: 'held', tone: 'attention', busy: false },
  [STATUSES.NO_ANSWER]: { key: 'noanswer', tone: 'attention', busy: false },
  [STATUSES.PAUSED]: { key: 'paused', tone: 'quiet', busy: false },
  [STATUSES.RESTARTING]: { key: 'restarting', tone: 'quiet', busy: false },
  [STATUSES.STOPPED]: { key: 'stopped', tone: 'quiet', busy: false },
  [STATUSES.FREE]: { key: 'free', tone: 'quiet', busy: false },
  [STATUSES.ASLEEP]: { key: 'asleep', tone: 'quiet', busy: false },
  [STATUSES.NOT_RUNNING]: { key: 'off', tone: 'attention', busy: false },
  [STATUSES.UNKNOWN]: { key: 'unknown', tone: 'late', busy: false },
})

/** The head count's keys, in the statuses order (the head's counts are one number per status). */
export const COUNT_KEYS = Object.freeze(STATUS_LIST.map(status => STATUS_FACTS[status].key))

/** An Unknown status is quiet under this age, and needs a look after it (the brief: "quiet under 2 min, attention after"). */
export const UNKNOWN_ATTENTION_MS = 2 * MIN
/** A new conversation (a clear) reads Restarting this long at most, counted from the moved card's `cleared.at`. */
export const RESTART_SHOWN_MS = 2 * MIN
/** An age is shown on the pill only over this (the brief: "Working · 25 s ago"). */
export const AGE_SHOWN_MS = 10_000

/** The old state names (history.jsonl's `state`, a lane without a status) as the new statuses: for the day bars and old lanes. */
export const STATUS_OF_STATE = Object.freeze({
  free: STATUSES.FREE, working: STATUSES.WORKING, waiting: STATUSES.WAITING, interrupted: STATUSES.STOPPED, suspended: STATUSES.PAUSED, off: STATUSES.NOT_RUNNING, unknown: STATUSES.UNKNOWN,
})

const LIMIT_NAMES = { fiveHour: 'session limit', week: 'weekly limit' }
const hourMinute = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
/**
 * A lane's "since" time as the page writes it (board.js `sinceClock`): the clock for today, "yesterday 23:54" for yesterday,
 * "8 Nov 23:54" for an older day, by the local day of `now`.
 */
export function sinceClock(ms, now) {
  const day = new Date(ms)
  const today = new Date(now)
  const back = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(day.getFullYear(), day.getMonth(), day.getDate())) / 86_400_000)
  if (back <= 0) return hourMinute(ms)
  if (back === 1) return `yesterday ${hourMinute(ms)}`
  return `${day.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][day.getMonth()]} ${hourMinute(ms)}`
}
const hourMinuteSecond = ms => `${hourMinute(ms)}:${String(new Date(ms).getSeconds()).padStart(2, '0')}`
const finite = value => Number.isFinite(value)

/** Why a suspended lane is paused, in a few words: the limit (and until when), or the steps it is parked behind. */
function pausedWhy(held) {
  // P1 (2026-11-09): a wait on a chat, recorded by the holder: "waits for chat 1 (its go to land) since 11:24".
  if (isChatWait(held)) return chatWaitWords(held)
  // The lead's ruling of 2026-11-11 (B1094 and Q715): a wait for the person's recap: "waits for your recap of G60 (Q715)".
  if (isRecapWait(held)) return recapSuspensionWords(held)
  // The asset wait (2026-11-11, the B1124 case): "waits for Codex: A224-A227 since 10:43".
  if (isAssetWait(held)) return assetWaitWords(held)
  if (held?.by === 'parked') return `until ${(held.on ?? []).join(' and ')}`
  const limit = LIMIT_NAMES[held?.limit] ?? 'session limit'
  const who = held?.by === 'app' ? 'stopped by the app at the' : 'paused for the'
  return `${who} ${limit}${finite(held?.until) ? `, until ${hourMinute(held.until)}` : ''}`
}

/**
 * The chat's one status. Input (all read, none written):
 * - `lane`: the lane as the board builds it: `state`, `isRunning`, `asleep`, `asleepSince`, `report` (`{ state, since, at }` or
 *   null), `suspended`, `offWhy`, `offSince`, `heldBy`, `waitsForPartner`, `cutOffAt`;
 * - `handover`: `{ state, why, step }` of a worker on the hand-over (work/handover.mjs `decide`), else null: rows 3 to 6 and
 *   the Free of such a worker are the hand-over's; with null (the escape hatch, the main chat, the partner...) they do not apply;
 * - `modRun`: the Workers-mod rollout's entry for the chat (`status`), or null; `clearedAt`: when its card says it was cleared
 *   (null: never); `isPersonPause`: the person pauses all chats now; `isUnsaved`: it holds a step with no checkpoint since;
 *   the lazy clear: `clearing`, the stage of the clear still on its way in its envelope in flight (`{ stage, at }`,
 *   work/handover.mjs `clearingOf`), or null;
 * - `now`, `unknownAfterMs`: the board's clock and the report's age limit.
 * Output `{ status, why, since, reportAt, age }`: `why` a few plain words (or null), `since` when the state began (apart from
 * the age), `reportAt` the report's time, `age` how old the information is (`now - reportAt`; for an Unknown chat that has
 * not reported since its clear, counted from the clear; null where nothing is known).
 */
export function statusOf({ lane, handover = null, modRun = null, clearedAt = null, isPersonPause = false, isUnsaved = false, clearing = null, now, unknownAfterMs = 30_000 }) {
  const report = lane.report ?? null
  const reportAt = finite(report?.at) ? report.at : null
  const out = (status, why = null, since = null, age = reportAt === null ? null : Math.max(0, now - reportAt)) => ({ status, why, since: finite(since) ? since : null, reportAt, age })
  const state = lane.state
  const asleep = lane.asleep === true
  const isFreshBusy = report?.state === 'busy' && reportAt !== null && now - reportAt <= unknownAfterMs
  const hand = handover?.state ?? null
  // B1051 (X153): a free worker the board gives no step of a model (its set failed) says so; the page reads this why.
  const banWhy = typeof handover?.why === 'string' && handover.why.includes(BAN_WHY_MARK) ? handover.why : null
  const partner = (lane.waitsForPartner ?? []).length > 0 || lane.heldBy === 'partner'

  // 1. Working: a fresh report says busy (also background work after a reported step, and a wait for the partner). A fresh busy
  // report beats a pause note read from a lagging transcript; only the app's own stop line and the person's pause hold it.
  if (!asleep) {
    // The asset wait (the person's "A, Working"): the provider's line, "Codex draws 4 pictures for it · 2 of 4 done · since 10:43".
    // The asset-stop rerun (2026-11-11, A245): a background-only lane whose asset requests are all final for over 30 running minutes says so, attention after 60.
    if (state === 'working' && lane.heldBy === 'background' && typeof lane.backgroundNoNews?.words === 'string') return { ...out(STATUSES.WORKING, lane.backgroundNoNews.words, lane.backgroundNoNews.since), attention: lane.backgroundNoNews.attention === true }
    if (state === 'working') return out(STATUSES.WORKING, lane.heldBy === 'asset' && typeof lane.assetWork?.words === 'string' ? lane.assetWork.words : partner ? 'waits for the partner' : lane.heldBy === 'background' ? 'background' : null, report?.since)
    if (state === 'suspended' && lane.suspended?.by === 'note' && isFreshBusy) return out(STATUSES.WORKING, null, report.since)
  }
  // 2. Waiting for you: a fresh report says asking, or a blocking ask is open.
  if (state === 'waiting') return out(STATUSES.WAITING, null, report?.since)
  // 3 to 6, a worker on the hand-over: its report's check runs, a task is being handed or offered, the hand-over is held, or it
  // did not answer.
  if (hand === 'checking') return out(STATUSES.CHECKING, handover.step ?? null)
  // The lazy clear (R3, D6): while its clear is on its way, the pill's why says the clear's stage and its time (the pill set
  // stays change 2's).
  if (hand === 'handing') return out(STATUSES.HANDING, clearing !== null ? `clearing… ${clearing.stage} ${hourMinuteSecond(clearing.at)}` : handover.step ?? null)
  if (hand === 'offered') return out(STATUSES.OFFERED, handover.step ?? null)
  if (hand === 'held') return out(STATUSES.HELD, handover.why ?? null)
  if (hand === 'unknown' && typeof handover.why === 'string' && handover.why.startsWith(UNANSWERED_WHY)) return out(STATUSES.NO_ANSWER, handover.step ?? null)
  // 7. Paused: the app's stop line, a standing pause note, a parked step; the hand-over's suspended (the person's pause, a full
  // limit); the person's pause once the chat has stopped. One cut off with no checkpoint since the pause is unexpected: it stays Stopped.
  const isUnexpected = isPersonPause && isUnsaved && state === 'interrupted' && !asleep
  if (state === 'suspended') return out(STATUSES.PAUSED, pausedWhy(lane.suspended), lane.suspended?.since)
  if (hand === 'suspended' && !isUnexpected) return out(STATUSES.PAUSED, handover.why ?? null)
  if (isPersonPause && !isUnexpected && (state === 'free' || state === 'interrupted')) return out(STATUSES.PAUSED, 'you paused the chats')
  // 8. Restarting: the hand-over's restart, a Workers-mod rollout asked of the chat, or a new conversation (a clear) that has not
  // reported yet, for two minutes after the clear.
  if (hand === 'restarting' || (modRun !== null && (modRun.status === 'asked' || modRun.status === 'due'))) return out(STATUSES.RESTARTING, 'the new Workers mod')
  const isNewConversation = finite(clearedAt) && now - clearedAt <= RESTART_SHOWN_MS && !(reportAt !== null && reportAt >= clearedAt)
  if (isNewConversation) return out(STATUSES.RESTARTING, 'a new conversation', clearedAt)
  // Rule 15: a step held with an ask held for the person's words: its chat re-checks that ask; quiet, not a stopped worker.
  if (state === 'interrupted' && typeof lane.heldAsk === 'string' && !asleep) return out(STATUSES.PAUSED, `waits for its re-check of ${lane.heldAsk}`, report?.since)
  // 9. Stopped: idle or ended while holding a step.
  if (state === 'interrupted') {
    // The asset wait (2026-11-11): its step's last asset request failed while it waited: the failure, never a silent Stopped.
    if (typeof lane.assetFailed === 'string' && lane.assetFailed !== '') return out(STATUSES.STOPPED, `${lane.assetFailed}${finite(handover?.asked) ? `; asked to go on at ${hourMinute(handover.asked)}` : ''}`, asleep ? lane.asleepSince : report?.since)
    // Signals change 3: the hand-over asked it to go on (its "go on" line of this stopped spell).
    if (finite(handover?.asked)) return out(STATUSES.STOPPED, `asked to go on at ${hourMinute(handover.asked)}`, asleep ? lane.asleepSince : report?.since)
    if (asleep) return out(STATUSES.STOPPED, 'resumes by itself', lane.asleepSince)
    if (report?.state === 'idle') return out(STATUSES.STOPPED, `task open since ${sinceClock(report.since, now)}`, report.since)
    return out(STATUSES.STOPPED, finite(lane.cutOffAt) ? `cut off at ${hourMinute(lane.cutOffAt)}` : 'cut off by a restart', lane.cutOffAt)
  }
  // 11. Asleep: the process ended while the chat is idle (a message wakes it). Before Free: an asleep chat is not "free to run".
  // The asset wait: a chat asleep while the provider draws is Working for that (the task's state); the provider's word wakes it.
  if (asleep && state === 'working' && lane.heldBy === 'asset' && typeof lane.assetWork?.words === 'string') return out(STATUSES.WORKING, lane.assetWork.words, lane.asleepSince)
  if (asleep && (state === 'free' || state === 'working')) return out(STATUSES.ASLEEP, state === 'working' ? 'waits for the partner' : banWhy, lane.asleepSince)
  // 10. Free: the hand-out would take it now. A worker on the hand-over: its hand-over FREE; a worker on the timers, the main chat,
  // the partner, the supervisor, the product owner: idle and nothing held (`state` free).
  if (state === 'free' && lane.isRunning !== false && (handover === null || hand === 'free')) return out(STATUSES.FREE, banWhy)
  // 12. Not running: the process is gone and will not wake by itself (a wake failed, the session ended with no app session, silent,
  // unreported).
  if (state === 'off' || (lane.isRunning === false && !asleep)) return out(STATUSES.NOT_RUNNING, lane.offWhy ?? 'its chat is closed', lane.offSince)
  // 13. Unknown: no report to go by. Its age counts from the last report, else from the clear that began the conversation.
  const age = reportAt !== null ? Math.max(0, now - reportAt) : finite(clearedAt) ? Math.max(0, now - clearedAt) : null
  return out(STATUSES.UNKNOWN, hand === 'unknown' ? handover.why ?? null : null, null, age)
}

/** Whether a status is counted among the busy chats (only Working). */
export const isBusyStatus = status => STATUS_FACTS[status]?.busy === true

/** The tone of a status at an age: `quiet` or `attention` (an Unknown one turns to attention after `UNKNOWN_ATTENTION_MS`). */
export function toneOf(status, age = null) {
  const tone = STATUS_FACTS[status]?.tone ?? 'quiet'
  return tone === 'late' ? (finite(age) && age > UNKNOWN_ATTENTION_MS ? 'attention' : 'quiet') : tone
}

/** The head's counts: one number per status (every key present), over the chats that carry a status (a leftover has none). */
export function countsOf(chats) {
  const counts = Object.fromEntries(COUNT_KEYS.map(key => [key, 0]))
  for (const chat of chats) if (typeof chat?.status === 'string' && STATUS_FACTS[chat.status] !== undefined) counts[STATUS_FACTS[chat.status].key] += 1
  return counts
}

/** The most chats the take answer's `statuses` names, and the longest why it carries (the mod keeps the same caps). */
export const STATUSES_MOST = 50
export const STATUS_WHY_CHARS = 120
const NAME_CHARS = 80

/**
 * Signals change 2c: the take answer's `statuses`, for the Workers pane in the Claude app. One entry per chat of the set the
 * work API's roles map uses (server.mjs `workCtx`): the non-leftover chats of `state.chats`, then the Advisor, its helper, the
 * Supervisor and the Product owner, each `{ name, status, why, tone, since, reportAt }` straight from what the page draws
 * (`status`, `why`, `since`, `reportAt` as the state carries them, `tone` from `toneOf`). `age` is NOT sent: the pane works it
 * out from `reportAt` with the page's `AGE_SHOWN_MS` rule, so pane and pill agree. Capped at `STATUSES_MOST` entries. Display
 * only: nothing reads it back. Signals 7c (Workers mod 0.30.0): and `held`, the step the lane holds by the store with the row's
 * time words at `now` (`heldEntry`), or null; the pane draws it in place of the card's task words.
 */
export function statusesOf(state, now = null) {
  const chats = (state?.chats ?? []).filter(chat => chat?.isLeftover !== true)
  const sides = [state?.advisor, state?.advisorHelper, state?.supervisorChat, state?.productOwner].filter(chat => chat !== null && chat !== undefined)
  const seen = new Set()
  const out = []
  for (const chat of [...chats, ...sides]) {
    if (typeof chat.name !== 'string' || chat.name === '' || seen.has(chat.name) || typeof chat.status !== 'string') continue
    seen.add(chat.name)
    out.push({
      name: chat.name.slice(0, NAME_CHARS),
      status: chat.status,
      why: typeof chat.why === 'string' ? chat.why.slice(0, STATUS_WHY_CHARS) : null,
      tone: toneOf(chat.status, chat.age ?? null),
      since: finite(chat.since) ? chat.since : null,
      reportAt: finite(chat.reportAt) ? chat.reportAt : null,
      held: heldEntry(chat.held, now),
    })
    if (out.length >= STATUSES_MOST) break
  }
  return out
}

/** 7c: the longest title of a held step the take sends (the Workers mod refuses a longer one). */
export const HELD_TITLE_CHARS = 60

/**
 * Signals 7c (Workers mod 0.30.0): the held step of a status entry, for the pane's line: `{ id, title (cut to 60), time }`, the
 * time in the row's words (`heldTimeText`), or null for a chat that holds none (the main chat, a free worker, a side chat).
 */
export function heldEntry(held, now) {
  if (held === null || held === undefined || typeof held.id !== 'string' || held.id === '') return null
  const title = typeof held.title === 'string' ? held.title.replace(/\s+/g, ' ').trim() : ''
  return { id: held.id, title: title.length > HELD_TITLE_CHARS ? `${title.slice(0, HELD_TITLE_CHARS - 1)}…` : title, time: heldTimeText(held, now) }
}

const pad2 = value => String(value).padStart(2, '0')
/** A length of time as the page's `span` (public/board.js, times part) words it: "40 min", "1 h 50". */
function spanText(ms) {
  const minutes = Math.round(ms / MIN)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours >= 48) return `${Math.round(hours / 24)} days`
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${pad2(minutes % 60)}`
}

/**
 * Signals 7c: a held step's time as the worker's row says it (public/board.js `heldTime`, its main and its "of" words): "1 h 56
 * of its 2 h" (left of its size), "12 min over its 2 h", "– of its 2 h" (no take recorded), "No time" (no size). Null without
 * a held step or a clock. Mirrors the page (test/chatStatus.state.test.mjs runs the page's own heldTime beside it).
 */
export function heldTimeText(held, now) {
  if (held === null || held === undefined || !finite(now)) return null
  const eta = held.eta ?? null
  // eta-remaining (2026-11-11): its latest estimate minus the working time since (state.mjs `heldEstimateOf`), as the page words it.
  if (eta === null || !finite(eta.at)) return finite(held.size) ? `– · its size ${spanText(held.size * MIN)}` : 'No time'
  const said = finite(eta.saidAt) ? ` · ${eta.from === 'own' ? 're-estimated' : 'estimated'} ${hourMinute(eta.saidAt)}` : ''
  const left = eta.at - now
  return left > 0 ? `${left < MIN / 2 ? 'under a minute left' : `about ${spanText(left)} left`}${said}` : `past its estimate since ${hourMinute(eta.at)}${eta.asked === true ? ' · new estimate asked' : ''}`
}

/**
 * The tail of a take: the hand-out first (`hand()` gives the envelope or null), then `readState.reset()` when one went out, and
 * only then the statuses, so a worker just handed an envelope sees its new status (the state is cached for 2 s, so the reset
 * is what makes this read fresh; no extra build otherwise). `{ envelope, statuses }`.
 */
export async function handedWithStatuses({ hand, readState, now = null }) {
  const envelope = await hand()
  if (envelope !== null) readState.reset()
  return { envelope, statuses: statusesOf(await readState(), now) }
}
