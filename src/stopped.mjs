// B577 (X3 came back at 21:47 on 2026-10-24, after its fix B532): four words to Worker 5 (work B522 twice, work B567
// twice, 21:41-21:42) failed with "a hook dropped it: the session was stopped and nobody has sent input since". The
// main chat had stopped that worker's turn at about 21:40, deleted the chat at 21:46 and made a new Worker 5; the board
// spent its tries within minutes on a chat being replaced and never handed the words to the new one. Now a word the app
// drops because its chat was stopped spends no try: it waits (as a new word, store.mjs settle), held while that very
// session stays stopped, and the main chat is asked once to wake it (say.mjs `wake`). A turn begun after the stop, or
// another session under the name (a chat replaced, or cleared), lets the words go.

/** The Workers mod's why for a word the app dropped because the chat's session was stopped (its turn cut by a stop). */
export const isStoppedWhy = why => typeof why === 'string' && /\bsession was stopped\b/i.test(why)

/**
 * Whether a stopped word still waits for its chat to get input: its chat on the board (`lane`, the board's lane) is the
 * session that was stopped and has begun no turn since. A word that never met a stop, false; a lane the board does not
 * show, true (it takes nothing then).
 */
export function isStillStopped(message, lane) {
  if (!Number.isFinite(message?.stoppedAt)) return false
  if (lane === undefined || lane === null) return true
  const session = message.stoppedSession ?? null
  if (session !== null && (lane.session ?? null) !== null && lane.session !== session) return false
  return !(Number.isFinite(lane.turnAt) && lane.turnAt > message.stoppedAt)
}

/**
 * A chat's stop as the board reads it from its waiting words: `{ since, words }` (the first stop its waiting words
 * met, and how many wait for it), or null when no waiting word of it is held by a stop. `outbox` the words, `lane` the
 * chat's lane.
 */
export function stoppedOf(outbox, lane) {
  if (lane === undefined || lane === null || lane.isLeftover) return null
  const mine = (outbox ?? []).filter(message => message.to === lane.name && message.state === 'waiting')
  const held = mine.filter(message => isStillStopped(message, lane))
  if (held.length === 0) return null
  return { since: Math.min(...held.map(message => message.stoppedAt)), words: mine.length }
}
