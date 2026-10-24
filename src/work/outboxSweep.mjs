// B532: the outbox holds only words that still matter. At every refresh (and before a chat takes its words) each word
// that waits is judged: still needed, or closed with its reason in outbox.jsonl (`dropped` for a word that no longer
// matters, `expired` for one that waited longer than it is kept), so nothing waits for ever in silence and the page
// says what became of it. A person's answer (an ask set) is never closed here: it waits for its chat, also one that is off
// on purpose. A word the chat took and could not type is retried (store.mjs retryFailed) before the judging.

import { waitsLong } from '../say.mjs'
import { isLate } from '../store.mjs'
import { readStore } from './store.mjs'

const firstLine = text => String(text ?? '').split('\n')[0]
const hours = ms => Math.round(ms / 3_600_000)

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
 * items by id), `runs` (chat name to whether it runs), `now`, `keep`.
 */
export function whyClosed(message, ctx) {
  // A work line is the work store's: withdrawStale (deliver.mjs) judges it by its step.
  if ((message.ask ?? null) !== null || message.command === 'work' || !waitsLong(message.command)) return null
  const { all, items, now, keep } = ctx
  const newer = all.find(one => one.id !== message.id && one.at > message.at && isStanding(one) && kindOf(one) === kindOf(message))
  if (newer !== undefined) return { state: 'dropped', why: 'superseded by a newer word of the same kind' }
  const item = items.get(message.about)
  const state = value(item, 'State')
  if (message.command === 'refine') {
    // A step is refined while it is new; a later round (B387: three in a row) also while it waits refined.
    const holds = state === 'new' || (state === 'refined' && (message.round ?? 1) > 1)
    if (!holds) return { state: 'dropped', why: item === undefined ? 'the step is gone' : `the step is ${state} now, not new` }
  } else if (message.command === 'result-check') {
    if (state !== 'review') return { state: 'dropped', why: item === undefined ? 'the step is gone' : `the step is ${state} now, not in review` }
  } else if (message.command === 'start') {
    // The main chat's word to open a closed chat: not needed once that chat runs, nor when nothing waits for it any more.
    if (ctx.runs.get(message.about) === true) return { state: 'dropped', why: `${message.about} runs now` }
    const waits = all.some(one => one.to === message.about && one.id !== message.id && one.state === 'waiting' && one.command !== 'start' && !ctx.closing.has(one.id))
    if (!waits) return { state: 'dropped', why: `nothing waits for ${message.about} any more` }
  }
  if (isLate(message, now, keep)) return { state: 'expired', why: `waited longer than ${hours(keep.answerMs ?? keep.messageMs)} hours` }
  return null
}

/**
 * One sweep: retries the words that failed, then closes what no longer matters. The words closed, as
 * `{ id, state, why }` (a replay on a copy of the outbox passes `dry: true`: nothing is written then).
 */
export async function sweepOutbox({ dir, outbox, state, now, keep, fs, dry = false }) {
  if (!dry) await outbox.retryFailed(now, keep)
  const waiting = outbox.outbox().filter(message => message.state === 'waiting')
  if (waiting.length === 0) return []
  const items = dir === null ? new Map() : (await readStore(dir, fs)).items
  const runs = new Map((state?.chats ?? []).filter(chat => !chat.isLeftover).map(chat => [chat.name, chat.isRunning === true]))
  const all = outbox.outbox()
  const closing = new Map()
  const ctx = { all, items, runs, now, keep, closing }
  // The starts last: they depend on what the other words become.
  const ordered = [...waiting.filter(message => message.command !== 'start'), ...waiting.filter(message => message.command === 'start')]
  for (const message of ordered) {
    const closed = whyClosed(message, ctx)
    if (closed !== null) closing.set(message.id, { id: message.id, ...closed })
  }
  if (!dry) for (const one of closing.values()) await outbox.close(one.id, one.state, one.why, now)
  return [...closing.values()]
}
