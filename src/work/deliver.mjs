// B300: the server's part of the reconciler (spec 2026-10-17, sections 6 hook 3 and 7). Once the store is the truth, at
// every refresh the board makes the moves the reconciler names (through the work API, as the server) and sends each
// chat its line ("work: B286 is yours; run work next") into the outbox, where the Workers mod takes it. A line goes
// once per key ("B286 Units": that step to that chat), never twice, also not after the board started anew: the keys
// stand in the store's folder (`delivered.json`), written down before the line is sent.

import { wakeFor, workWords } from '../say.mjs'
import { addDelivered } from './store.mjs'

/**
 * Sends `words` (a message's parts, say.mjs) once per `key`: written down first, then put into the outbox; a chat that
 * is not running makes the board ask the main chat to start it (say.mjs, wakeFor). The message, or null when it was
 * sent before or could not be written down.
 */
export async function sendOnce({ dir, key, words, outbox, state, now, maxChars, newId, fs }) {
  const noted = await addDelivered(dir, key, fs)
  if (!noted.ok || !noted.added) return null
  const message = { id: newId(), at: now, ...words, state: 'waiting' }
  await outbox.say(message)
  const wake = wakeFor(message, state, outbox.outbox(), now, maxChars)
  if (wake !== null) await outbox.say({ id: newId(), at: now, ...wake, state: 'waiting' })
  return message
}

/** The key under which a step's line to its chat is sent once. */
export const deliveryKey = (id, chat) => `${id} ${chat}`

/**
 * One refresh: `state.reconciled` (state.mjs; null while the store is a shadow) carried out. `apply(body)` is the work
 * API as the server. `{ moved, sent }`: the ids moved and the messages sent.
 */
export async function deliverWork({ state, dir, outbox, apply, now, maxChars, newId, fs }) {
  const done = { moved: [], sent: [] }
  const plan = state?.reconciled ?? null
  if (plan === null || dir === null) return done
  for (const move of plan.moves ?? []) {
    const moved = await apply({ action: 'advance', id: move.id, to: move.to }).catch(() => null)
    if (moved?.ok === true) done.moved.push(move.id)
  }
  const lines = [
    ...(plan.deliveries ?? []).map(one => ({ key: deliveryKey(one.id, one.chat), words: workWords(one.chat, one.id) })),
    ...(plan.says ?? []).map(one => ({ key: one.key, words: workWords(one.chat, one.id, one.say) })),
  ]
  for (const one of lines) {
    const sent = await sendOnce({ dir, key: one.key, words: one.words, outbox, state, now, maxChars, newId, fs })
    if (sent !== null) done.sent.push(sent)
  }
  return done
}
