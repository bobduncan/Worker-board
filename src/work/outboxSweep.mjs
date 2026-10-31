// B532: the outbox holds only words that still matter. At every refresh (and before a chat takes its words) each word
// that waits is judged: still needed, or closed with its reason in outbox.jsonl (`dropped` for a word that no longer
// matters, `expired` for one that waited longer than it is kept), so nothing waits for ever in silence and the page
// says what became of it. A person's answer (an ask set) is never closed here: it waits for its chat however old (B548),
// also one that is off on purpose. A word the chat took and could not type is retried (store.mjs retryFailed) before the judging.
// B571: a word that failed and is not tried again (it failed before B532 kept its time, its tries ran out, the mod
// refused it) is judged too: once its purpose is gone it is closed `dropped` with its why, so the health summary and
// rule 8 stop naming it; one that still matters stays failed, for the person to see.

import { shownChats } from '../bridge.mjs'
import { heldTooLong, isMootSpawn, mootWhy } from '../hands.mjs'
import { RESUME_STEP, isStopWord, waitsLong } from '../say.mjs'
import { isLate, keepMs } from '../store.mjs'
import { stoppedOf } from '../stopped.mjs'
import { familyOf, sameModel } from './effort.mjs'
import { stamp } from './migrate.mjs'
import { OLD_CHECK_WHY } from './qaTask.mjs'
import { readStore } from './store.mjs'
import { workLineWhy } from './workLines.mjs'

const firstLine = text => String(text ?? '').split('\n')[0]
const span = ms => (ms >= 2 * 3_600_000 ? `${Math.round(ms / 3_600_000)} hours` : `${Math.round(ms / 60_000)} min`)

/** The words that stand for the same thing: same chat, command, step, plan item or round. A newer one replaces the older. */
const kindOf = message => [message.to, message.command ?? '', message.kind ?? '', message.about ?? '', message.command === 'round' ? firstLine(message.text) : ''].join('\u0001')

const value = (item, key) => {
  const found = item?.head.get(key)
  return found === undefined || found === '' || found === '-' ? null : found
}

/** What became of an alive newer word to count as a replacement: it reached the chat or still waits for it. */
const isStanding = message => ['waiting', 'taken', 'delivered', 'copied'].includes(message.state)

/**
 * The reason a waiting word no longer matters, or null. `ctx`: `all` (every word of the outbox), `items` (the work store's
 * items by id, null when the board has no store), `runs` (chat name to whether it runs), `goals` (the goal map's nodes),
 * `now`, `keep`, `closing` (what this sweep closes already), `lanes` (the board's chats, with the effort and model each runs at),
 * `onBoard` (B880: the names of the chats on the board now, the partner, helper, supervisor and Product owner among them).
 */
export function whyClosed(message, ctx) {
  // A person's answer waits for its chat, also one that is off on purpose.
  if ((message.ask ?? null) !== null) return null
  const { all, items, now, keep } = ctx
  // A work line is the work store's: judged by its step (workLines.mjs), waiting or failed; withdrawStale (deliver.mjs)
  // closes it, with the start it asked. B589: this answer is the health summary's and rule 8's, which until then named
  // a failed one whose step was done (X3). Without a store the board cannot judge it: it matters.
  if (message.command === 'work') {
    const why = items instanceof Map ? workLineWhy(message, items, { prefix: ctx.prefix ?? '', now }) : null
    return why === null ? null : { state: 'dropped', why }
  }
  // B812 (X109): a stop word waits for its worker's next idle moment however long its turn runs, while it holds a step.
  if (isStopWord(message.command)) return stopWordWhy(message, ctx)
  // T8.5: an envelope with a task matters while that task is still given to its worker (the decision takes it back and
  // closes the envelope itself; this catches a task the person moved meanwhile). One without a task waits until late.
  if (message.command === 'handover') {
    const item = typeof message.step === 'string' && items instanceof Map ? items.get(message.step) : undefined
    if (item !== undefined && !(value(item, 'State') === 'queued' && plainName(value(item, 'Owner'), ctx.prefix ?? '') === plainName(message.to, ctx.prefix ?? ''))) {
      return { state: 'dropped', why: `${message.step} is no longer given to ${message.to}` }
    }
    return isLate(message, now, keep) ? expired(message, keep) : null
  }
  // B813 (X2): the word that sets a worker's model and effort no longer matters once a newer one for that worker stands,
  // or the worker runs at its setting already; waiting or failed.
  if (message.command === 'worker-effort') {
    const newer = all.find(one => one.id !== message.id && one.at > message.at && isStanding(one) && kindOf(one) === kindOf(message))
    if (newer !== undefined) return { state: 'dropped', why: `superseded by a newer word for ${message.about}'s setting (${stamp(newer.at)})` }
    const lane = (ctx.lanes ?? []).find(one => one.name === message.about && !one.isLeftover)
    if (lane !== undefined && lane.effort === message.effort && ((message.model ?? null) === null || sameModel(lane.model, message.model))) {
      return { state: 'dropped', why: `${message.about} runs at ${(message.model ?? null) === null ? '' : `${familyOf(message.model)} · `}${message.effort} already` }
    }
  }
  // B880 (X2): a start word for a chat that is on the board now (the Product owner's routine) is moot, waiting or failed.
  if (isMootSpawn(message, ctx.onBoard)) return { state: 'dropped', why: mootWhy(message) }
  // A word that is stale in minutes (a pause's resume, a line typed in a talk) is only closed once it is late.
  if (!waitsLong(message.command)) return isLate(message, now, keep) ? expired(message, keep) : null
  // B571: the goal guard's word: not needed once the goal is done or was evaluated after the word was sent (B359),
  // named by the first evaluation after it ("G15 was evaluated (2026-10-24 16:06)"), before any newer word of its kind.
  if (message.command === 'evaluate') {
    const goal = (ctx.goals ?? []).find(one => one.id === message.about)
    const after = [...(goal?.evaluatedAt ?? [])].sort().find(at => at >= stamp(message.at)) ?? null
    if (goal?.state === 'done') return { state: 'dropped', why: `${message.about} is done` }
    if (after !== null) return { state: 'dropped', why: `${message.about} was evaluated (${after})` }
  }
  const newer = all.find(one => one.id !== message.id && one.at > message.at && isStanding(one) && kindOf(one) === kindOf(message))
  if (newer !== undefined) return { state: 'dropped', why: `superseded by a newer word of the same kind (${stamp(newer.at)})` }
  const item = items?.get(message.about)
  const state = value(item, 'State')
  if (items !== null && message.command === 'refine') {
    // A step is refined while it is new; a later round (B387: three in a row) also while it waits refined.
    const holds = state === 'new' || (state === 'refined' && (message.round ?? 1) > 1)
    if (!holds) return { state: 'dropped', why: item === undefined ? 'the step is gone' : `the step is ${state} now, not new` }
  } else if (message.command === 'result-check') {
    // T9.1.1: the result check is a Quality Assurance task now, and the Advisor can no longer file a step check: an old word of the
    // board's is closed whatever the state of its step (also without a store to judge it by).
    return { state: 'dropped', why: OLD_CHECK_WHY }
  } else if (message.command === 'start') {
    // The main chat's word to open a closed chat: not needed once that chat runs, nor when nothing waits for it any more.
    if (ctx.runs.get(message.about) === true) return { state: 'dropped', why: `${message.about} runs now` }
    // T9.4 (review of 2026-10-25): a start word waits for the chat that carries it. One that is known not to run can never carry it, so
    // it is closed and the board asks another chat that runs (say.mjs wakesDue). The main chat's waits for it however: it is the board's order to it.
    if (message.to !== ctx.main && ctx.off?.has(message.to) === true) return { state: 'dropped', why: `${message.to} does not run, so it cannot carry the start of ${message.about}` }
    // B590: a ready task waits for it too: one pinned to it, or, for a start the hand-out made, one kept for nobody.
    // T9.4: a start word to the main chat (the hand-out's, a worker to start) waits for it too, so the word that has a chat that runs
    // start the main chat is not dropped for want of anything waiting for it; a start to any other chat still holds nothing.
    const waits = all.some(one => one.to === message.about && one.id !== message.id && one.state === 'waiting' && (one.command !== 'start' || one.to === ctx.main) && !ctx.closing.has(one.id))
      || readyFor(message, ctx)
    if (!waits) return { state: 'dropped', why: `nothing waits for ${message.about} any more` }
  } else if (message.command === RESUME_STEP) {
    // 2026-10-26: the board's word that has a worker go on with its step after a crash (say.mjs `resumesDue`). Its purpose is
    // to have the chat started: done once the chat runs again, and gone when the chat no longer holds the step in the store.
    if (ctx.runs.get(message.to) === true) return { state: 'dropped', why: `${message.to} runs again` }
    if (items !== null) {
      if (item === undefined) return { state: 'dropped', why: 'the step is gone' }
      if (!['taken', 'in progress'].includes(state)) return { state: 'dropped', why: `the step is ${state} now` }
      if (plainName(value(item, 'Owner'), ctx.prefix ?? '') !== plainName(message.to, ctx.prefix ?? '')) return { state: 'dropped', why: `${message.to} no longer holds ${message.about}` }
    }
  } else if (message.command === 'wake' && ctx.stopped instanceof Map) {
    // B577: the main chat's word to wake a stopped chat: not needed once that chat began a turn, or another session
    // stands under its name (a chat replaced), or nothing waits for it any more.
    if ((ctx.stopped.get(message.about) ?? null) === null) return { state: 'dropped', why: `${message.about} is no longer stopped` }
  }
  return isLate(message, now, keep) ? expired(message, keep) : null
}

/**
 * B812 (X109: the week's stop word to Worker 4, which held B494, expired after the 10 min keep while its turn ran on): the
 * reason a stop word no longer matters, or null while it does. It matters until its limit resets, and while its worker holds
 * a step not yet reported (taken or in progress as its Owner, or handed back by a failed check: say.mjs `holdsOpenStep`).
 * Without a store the board cannot tell what the worker holds: the word waits until the reset (its window, when no reset is known).
 */
function stopWordWhy(message, ctx) {
  const resets = message.command === 'week-stop' ? message.weekResets : message.fiveHourResets
  const limit = message.command === 'week-stop' ? 'the weekly limit' : 'the 5-hour limit'
  if (Number.isFinite(resets) && ctx.now >= resets) return { state: 'dropped', why: `${limit} reset at ${stamp(resets)}` }
  // A reset the board did not know: the word lasts the limit's window at most, so it never waits for ever.
  if (!Number.isFinite(resets) && ctx.now - message.at >= (message.command === 'week-stop' ? 7 * 24 : 5) * 3_600_000) return { state: 'dropped', why: `${limit} has reset since the word was sent` }
  if (!(ctx.items instanceof Map) || (ctx.handedBack ?? []).includes(message.to)) return null
  const name = plainName(message.to, ctx.prefix ?? '')
  const holds = [...ctx.items.values()].some(item => ['taken', 'in progress'].includes(value(item, 'State')) && plainName(value(item, 'Owner'), ctx.prefix ?? '') === name)
  return holds ? null : { state: 'dropped', why: `${message.to} holds no step not yet reported, so there is no work to stop` }
}

/** A chat's name for comparing: without the list's prefix, in lower case. */
const plainName = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}

/**
 * B590: whether a start word's reason holds on the ready list (`ctx.ready`, state.readyList.ready): a ready task pinned
 * to its chat, or, for a start the hand-out made (handOut.mjs `workerStart`; its word carries `reported`), one kept for
 * nobody.
 */
const readyFor = (message, ctx) => {
  const name = plainName(message.about, ctx.prefix ?? '')
  return (ctx.ready ?? []).some(one => (typeof one.pinned === 'string' && plainName(one.pinned, ctx.prefix ?? '') === name)
    || (Number.isFinite(message.reported) && (one.keptFor ?? null) === null))
}

/** B571: a word that failed and is not tried again: no newer word stands for it. */
export const isFailedForGood = message => message?.state === 'failed' && message.retriedAs === undefined

const expired = (message, keep) => ({ state: 'expired', why: `waited longer than ${span(keepMs(message, keep))}` })

/**
 * One sweep: retries the words that failed, then closes what no longer matters. The words closed, as
 * `{ id, state, why }` (a replay on a copy of the outbox passes `dry: true`: nothing is written then). `to`, when given,
 * judges only the words to that chat (a chat's take: the store is read only when something waits for it).
 */
export async function sweepOutbox({ dir, outbox, state, now, keep, fs, dry = false, to = null }) {
  // Without the outbox's keep (a caller that delivers work lines only) nothing is judged.
  if ((keep ?? null) === null) return []
  if (!dry) await giveBackHeld(outbox, now)
  if (!dry) await outbox.retryFailed(now, keep)
  // B577: at a refresh, the words that failed for a chat's old session go to the session the board shows under its name now.
  if (!dry && to === null && typeof outbox.revive === 'function') await outbox.revive(sessionsOf(state), now, keep)
  // B571: with the failed words that are not tried again, judged as the waiting ones; only a word whose purpose is gone
  // is closed among those (an old failed word is not "expired": it never waited).
  // B589: not the work lines: withdrawStale (deliver.mjs) closes them by the same judge, with the start they asked.
  const waiting = outbox.outbox().filter(message => (message.state === 'waiting' || isFailedForGood(message)) && message.command !== 'work' && (to === null || message.to === to))
  if (waiting.length === 0) return []
  const items = (dir ?? null) === null ? null : (await readStore(dir, fs)).items
  const runs = new Map((state?.chats ?? []).filter(chat => !chat.isLeftover).map(chat => [chat.name, chat.isRunning === true]))
  // T9.4: the chats known not to run (not those the board cannot tell about), the partner, its helper and the supervisor's among them.
  const off = new Set(shownChats(state ?? {}).filter(chat => chat.isRunning === false).map(chat => chat.name))
  const all = outbox.outbox()
  const closing = new Map()
  const ctx = { all, items, runs, goals: state?.goals?.nodes ?? [], now, keep, closing, stopped: stoppedChats(all, state), prefix: state?.chatPrefix ?? '', ready: state?.readyList?.ready ?? [], main: state?.restart?.main ?? null, off, handedBack: state?.reconciled?.handedBack ?? [], lanes: state?.chats ?? [], onBoard: new Set(shownChats(state ?? {}).map(chat => chat.name)) }
  // The starts last: they depend on what the other words become.
  const ordered = [...waiting.filter(message => message.command !== 'start'), ...waiting.filter(message => message.command === 'start')]
  for (const message of ordered) {
    const closed = whyClosed(message, ctx)
    if (closed !== null && (message.state === 'waiting' || closed.state === 'dropped')) closing.set(message.id, { id: message.id, ...closed })
  }
  if (!dry) for (const one of closing.values()) await outbox.close(one.id, one.state, one.why, now)
  return [...closing.values()]
}

/**
 * B880 (X2): the words a hand has held for HAND_HOLD_MS without a word of them go back to waiting, each in its hand's name (its
 * late answer still counts: store.mjs `deliveredLate`), with a line in the board's log. How many went back.
 */
export async function giveBackHeld(outbox, now, log = line => console.log(line)) {
  let given = 0
  for (const id of heldTooLong(outbox.outbox(), now)) {
    // Judged again right before it goes back, with no wait between: a word another sweep gave back meanwhile, and a hand
    // took anew, is that hand's now.
    const message = outbox.outbox().find(one => one.id === id)
    if (message === undefined || heldTooLong([message], now).length === 0) continue
    const { takenBy, takenAt } = message
    // B891: in doubt: its call may have acted.
    if ((await outbox.back([id], takenBy, now, [id])) === 0) continue
    given += 1
    const since = new Date(takenAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    log(`B880: gave back the word ${id} (${message.command ?? 'answer'}${message.about ? ` ${message.about}` : ''}) that ${takenBy}'s hand held since ${since} without a word of it.`)
  }
  return given
}

/** B577: the session the board shows under each chat's name. */
const sessionsOf = state => new Map(shownChats(state ?? {}).filter(chat => typeof chat.session === 'string' && chat.session !== '').map(chat => [chat.name, chat.session]))

/** B577: per chat the board shows, its stop (src/stopped.mjs `stoppedOf`): `{ since, words }`, or null. */
export const stoppedChats = (outbox, state) => new Map(shownChats(state ?? {}).map(chat => [chat.name, stoppedOf(outbox, chat)]))

/**
 * B548: a chat's take: the sweep of that chat's words first (a failed sweep is said and the take goes on), so a chat is
 * never handed a word whose purpose is gone, then what still waits for it (store.mjs `take`).
 */
export async function takeFor({ dir, outbox, state, now, keep, chat, only, fs }) {
  await sweepOutbox({ dir, outbox, state, now, keep, fs, to: chat }).catch(error => console.error(`The outbox sweep failed: ${error.message}`))
  // B577: a chat whose session was stopped takes nothing until it gets input (the app would drop every word): its words
  // wait, and the main chat is asked to wake it (say.mjs `wakesStopped`).
  const lane = shownChats(state ?? {}).find(one => one.name === chat)
  if (stoppedOf(outbox.outbox(), lane) !== null) return []
  return outbox.take(chat, now, keep, only)
}
