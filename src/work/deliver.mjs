// B300: the server's part of the reconciler (spec 2026-10-17, sections 6 hook 3 and 7). At every refresh the board makes the moves the reconciler names (through the work API, as the server) and sends each
// chat its line ("work: B286 is yours; run work next") into the outbox, where the Workers mod takes it. A line goes
// once per key: the step, its owner and when it was queued for that owner ("B286 Units 2026-10-17 11:00"), so a step
// queued anew is delivered anew. The keys stand in the store's folder (`delivered.json`), written once the line is in
// the outbox; one send at a time per store, so the chat's pull and the refresh never send it twice. A line that
// expired untaken goes once more. A waiting line whose step is no longer that chat's is withdrawn.

import { resolve } from 'node:path'

import { wakeFor, workWords } from '../say.mjs'
import { isLate } from '../store.mjs'
import { stamp } from './migrate.mjs'
import { sinceMs } from './item.mjs'
import { readDeliveredFile, readStore, writeDelivered } from './store.mjs'
import { isHolding } from './pause.mjs'
import { PARTNER_AGAIN_MS, partnerAskWords } from './partnerAnswers.mjs'

export { partnerAskWords }

/** The key under which a step's line to its chat is sent once: the step, the chat, and when it was queued for it. */
export const deliveryKey = (id, chat, since = '') => [id, chat, since].filter(Boolean).join(' ')

/** Focus 4: the key under which the main chat is woken for these notes, once. */
export const noteKey = (ids, chat) => `notes ${ids.join(',')} ${chat}`
/** Focus 4: the main chat's one line for its notes. */
export const noteWords = ids => `work: ${ids.length === 1 ? 'note' : 'notes'} ${ids.join(', ')} for you; run work next`

/** Partner answers (2026-10-19): the key under which the partner is woken for an ask routed to it, once. */
export const partnerAskKey = (id, chat, again = false) => `partner-ask ${id} ${chat}${again ? ' again' : ''}`

/** One send at a time per store folder, in this process (the board is the store's only writer). */
const turns = new Map()
function oneAtATime(dir, run) {
  const key = resolve(dir)
  const turn = (turns.get(key) ?? Promise.resolve()).then(run, run)
  turns.set(key, turn.catch(() => {}))
  return turn
}

/** Whether a message went untaken: it waited too long, or the chat could not type it. */
const isUntaken = (message, now, keep) => message !== undefined && ((message.state === 'waiting' && isLate(message, now, keep)) || message.state === 'expired' || message.state === 'failed')

/**
 * Sends `words` (a message's parts, say.mjs) once per `key`; once more when the first expired untaken (`keep`, the
 * outbox's times). Checked and recorded in one turn per store: the line is put into the outbox first (a chat that is not
 * running makes the board ask the main chat to start it, say.mjs `wakeFor`), the key is written after. The message, or
 * null when it is not sent (sent before, or the outbox could not take it).
 */
export function sendOnce({ dir, key, words, outbox, state, now, maxChars, newId, fs, keep }) {
  return oneAtATime(dir, async () => {
    const { record, text } = await readDeliveredFile(dir, fs)
    const before = record.sent[key] ?? (record.keys.includes(key) ? { message: null, wake: null, again: 0 } : null)
    if (before !== null) {
      const sent = outbox.outbox().find(message => message.id === before.message)
      if ((before.again ?? 0) >= 1 || keep === undefined || !isUntaken(sent, now, keep)) return null
    }
    const message = { id: newId(), at: now, ...words, state: 'waiting' }
    const start = wakeFor(message, state, outbox.outbox(), now, maxChars)
    const wake = start === null ? null : { id: newId(), at: now, ...start, state: 'waiting' }
    try {
      await outbox.say(wake === null ? message : { ...message, wake: wake.id })
      if (wake !== null) await outbox.say(wake)
    } catch {
      return null
    }
    const keys = record.keys.includes(key) ? record.keys : [...record.keys, key]
    const sent = { ...record.sent, [key]: { message: message.id, wake: wake?.id ?? null, again: before === null ? 0 : (before.again ?? 0) + 1 } }
    await writeDelivered(dir, { ...record, keys, sent }, fs, { expected: text })
    return message
  })
}

/** Whether a line may go to `chat` now: a chat on the board (not a leftover) that is free, not busy nor held by the limit. */
export function mayWake(state, chat) {
  // The review of Pause 2: while the person pauses nothing starts a turn (2026-10-19: pausing only; while resuming
  // as when running).
  if (isHolding(state?.pause)) return false
  const lane = (state?.chats ?? []).find(one => one.name === chat && !one.isLeftover)
  return lane !== undefined && lane.state === 'free'
}

/**
 * A chat's pull (the work API's answer `result`: `{ text, id, since, wake }`) carried out: the line goes into the outbox
 * once, under the delivery's key, and the answer says it; nothing for a chat that may not be woken now (`mayWake`) or
 * when the line went before.
 */
export async function pullFor({ dir, result, state, outbox, now, maxChars, newId, fs, keep }) {
  const wake = result?.wake ?? null
  const none = { ...result, text: '', wake: null }
  if (wake === null || dir === null || !mayWake(state, wake.to)) return wake === null ? result : none
  const sent = await sendOnce({ dir, key: deliveryKey(wake.id, wake.to, result.since), words: workWords(wake.to, wake.id), outbox, state, now, maxChars, newId, fs, keep })
  return sent === null ? none : result
}

const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const value = (item, key) => {
  const found = item?.head.get(key)
  return found === undefined || found === '' || found === '-' ? null : found
}

/**
 * The waiting lines whose step is no longer that chat's (another owner, done, dropped, gone; a check's line once the step
 * left review) are withdrawn, and the start they asked of the main chat when it still waits and nothing else waits for
 * that chat.
 */
async function withdrawStale({ dir, outbox, prefix, fs }) {
  const waiting = outbox.outbox().filter(message => message.command === 'work' && message.state === 'waiting')
  if (waiting.length === 0) return []
  const items = (await readStore(dir, fs)).items
  const gone = []
  for (const message of waiting) {
    const item = items.get(message.about)
    const state = value(item, 'State')
    // Focus 4: a notes line holds while one of its notes is not read by the main chat.
    if (message.kind === 'note') {
      if ((message.notes ?? [message.about]).some(id => items.get(id) !== undefined && value(items.get(id), 'Main read') === null)) continue
    } else if (message.kind === 'partner-ask') {
      // Partner answers (2026-10-19): the partner's line holds while its ask still waits for its answer.
      if (state === 'open' && value(item, 'Route') === 'partner') continue
    } else {
      const isOwners = item !== undefined && value(item, 'Owner') !== null && plain(value(item, 'Owner'), prefix) === plain(message.to, prefix)
      const holds = message.kind === 'check' ? state === 'review' : !['done', 'dropped'].includes(state)
      if (isOwners && holds) continue
    }
    await outbox.update(message.id, { state: 'dropped' })
    gone.push(message)
  }
  for (const message of gone) {
    const start = outbox.outbox().find(one => one.id === message.wake && one.state === 'waiting')
    const others = outbox.outbox().some(one => one.to === message.to && one.state === 'waiting' && one.id !== message.id)
    if (start !== undefined && !others) await outbox.update(start.id, { state: 'dropped' })
  }
  return gone
}

/**
 * Focus 4, the review: the main chat's one line for the notes it has not read (`plan.notes`): none while such a line to
 * it still waits or was taken, none for the notes filed before this board first did this (`notesFrom` in
 * delivered.json, written at the first refresh), and once per set of notes.
 */
async function noteLine({ dir, plan, outbox, now, fs }) {
  const { record, text } = await readDeliveredFile(dir, fs)
  if (record.notesFrom === null) {
    await writeDelivered(dir, { ...record, notesFrom: stamp(now) }, fs, { expected: text }).catch(() => null)
    return []
  }
  const from = sinceMs(record.notesFrom)
  const notes = (plan.notes ?? []).filter(one => !(sinceMs(one.since) < from))
  if (notes.length === 0) return []
  const chat = notes[0].chat
  if (outbox.outbox().some(one => one.kind === 'note' && one.to === chat && (one.state === 'waiting' || one.state === 'taken'))) return []
  const ids = notes.map(one => one.id)
  return [{ key: noteKey(ids, chat), words: { ...workWords(chat, ids[0], noteWords(ids)), kind: 'note', notes: ids } }]
}

/**
 * One refresh: `state.reconciled` (state.mjs; null while the store cannot be read) carried out. `apply(body)` is the work
 * API as the server. `{ moved, sent, withdrawn }`: the ids moved, the messages sent and withdrawn.
 */
export async function deliverWork({ state, dir, outbox, apply, now, maxChars, newId, fs, keep }) {
  const done = { moved: [], sent: [], withdrawn: [] }
  const plan = state?.reconciled ?? null
  if (plan === null || dir === null) return done
  for (const move of plan.moves ?? []) {
    const moved = await apply({ action: 'advance', id: move.id, to: move.to }).catch(() => null)
    if (moved?.ok === true) done.moved.push(move.id)
  }
  // Partner answers (2026-10-19): what the partner did not answer in time (or cannot) goes to the person, also while
  // the person pauses: it only shows them the ask.
  for (const one of plan.escalations ?? []) {
    const handed = await apply({ action: 'escalate', id: one.id, why: one.why }).catch(() => null)
    if (handed?.ok === true) done.moved.push(one.id)
  }
  done.withdrawn = await withdrawStale({ dir, outbox, prefix: state.chatPrefix ?? '', fs })
  // The review of Pause 2: while the person pauses (2026-10-19: pausing only) no line goes out that starts a turn: no
  // step delivered, no check's word, no note-wake to the main chat. They go at Resume all, as when running.
  if (isHolding(state?.pause)) return done
  const lines = [
    ...(plan.deliveries ?? []).map(one => ({ key: deliveryKey(one.id, one.chat, one.since), words: workWords(one.chat, one.id) })),
    ...(plan.says ?? []).map(one => ({ key: one.key, words: { ...workWords(one.chat, one.id, one.say), kind: 'check' } })),
    ...(await noteLine({ dir, plan, outbox, now, fs })),
    // Partner answers: the partner is woken once per ask routed to it, while it is free (the reconciler). B392: once
    // more when it is still open ten minutes on, but never beside a line about it that still waits to be taken, nor
    // within ten minutes of the last one (a partner busy until then was just woken).
    ...(plan.partnerAsks ?? [])
      .filter(one => one.again !== true || !outbox.outbox().some(message => message.kind === 'partner-ask' && message.about === one.id
        && (message.state === 'waiting' || now - (message.at ?? 0) < PARTNER_AGAIN_MS)))
      .map(one => ({ key: partnerAskKey(one.id, one.chat, one.again === true), words: { ...workWords(one.chat, one.id, partnerAskWords(one.id)), kind: 'partner-ask' } })),
  ]
  for (const one of lines) {
    const sent = await sendOnce({ dir, key: one.key, words: one.words, outbox, state, now, maxChars, newId, fs, keep })
    if (sent !== null) done.sent.push(sent)
  }
  return done
}
