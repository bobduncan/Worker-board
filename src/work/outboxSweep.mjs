// B532: the outbox holds only words that still matter. At every refresh (and before a chat takes its words) each word
// that waits is judged: still needed, or closed with its reason in outbox.jsonl (`dropped` for a word that no longer
// matters, `expired` for one that waited longer than it is kept), so nothing waits for ever in silence and the page
// says what became of it. A person's answer (an ask set) is never closed here: it waits for its chat however old (B548),
// also one that is off on purpose. A word the chat took and could not type is retried (store.mjs retryFailed) before the judging.
// B571: a word that failed and is not tried again (it failed before B532 kept its time, its tries ran out, the mod
// refused it) is judged too: once its purpose is gone it is closed `dropped` with its why, so the health summary and
// rule 8 stop naming it; one that still matters stays failed, for the person to see.

import { shownChats } from '../bridge.mjs'
import { waitsLong } from '../say.mjs'
import { isLate, keepMs } from '../store.mjs'
import { stoppedOf } from '../stopped.mjs'
import { stamp } from './migrate.mjs'
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
 * `now`, `keep`, `closing` (what this sweep closes already).
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
  } else if (items !== null && message.command === 'result-check') {
    if (state !== 'review') return { state: 'dropped', why: item === undefined ? 'the step is gone' : `the step is ${state} now, not in review` }
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
  } else if (message.command === 'wake' && ctx.stopped instanceof Map) {
    // B577: the main chat's word to wake a stopped chat: not needed once that chat began a turn, or another session
    // stands under its name (a chat replaced), or nothing waits for it any more.
    if ((ctx.stopped.get(message.about) ?? null) === null) return { state: 'dropped', why: `${message.about} is no longer stopped` }
  }
  return isLate(message, now, keep) ? expired(message, keep) : null
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
  const ctx = { all, items, runs, goals: state?.goals?.nodes ?? [], now, keep, closing, stopped: stoppedChats(all, state), prefix: state?.chatPrefix ?? '', ready: state?.readyList?.ready ?? [], main: state?.restart?.main ?? null, off }
  // The starts last: they depend on what the other words become.
  const ordered = [...waiting.filter(message => message.command !== 'start'), ...waiting.filter(message => message.command === 'start')]
  for (const message of ordered) {
    const closed = whyClosed(message, ctx)
    if (closed !== null && (message.state === 'waiting' || closed.state === 'dropped')) closing.set(message.id, { id: message.id, ...closed })
  }
  if (!dry) for (const one of closing.values()) await outbox.close(one.id, one.state, one.why, now)
  return [...closing.values()]
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
