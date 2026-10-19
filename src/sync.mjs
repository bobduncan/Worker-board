// B438: "Out of sync?" The person, 2026-10-19 (I43): "I want an help/alert button, where i believe the board and the
// worker is out of sync, i press the new button and somebody goes to investigate it and fix it." A button in each
// worker's menu, and one in the Workers panel's head, types `check sync <name>` (or `check sync board`) into the main
// chat with what the board shows (say.mjs, `syncWords`). The main chat compares it with the store, the chat itself and
// the limits, fixes what it can, and answers with a note to the person that starts `Sync check of <name>:` (roles/main.md,
// "Check sync"); the board shows that answer in the worker's row (or under the panel's head for the board).

const MIN = 60_000

/** What the page sends for the whole board instead of a worker's name. */
export const SYNC_BOARD = 'board'
/** After it arrived, a check stays open this long without an answer: the page asks once in that time. */
export const SYNC_OPEN_MS = 30 * MIN
/** The main chat's answer (or a check that got none) stands in the row this long, then the row is clear again. */
export const SYNC_SHOWN_MS = 60 * MIN

/** The first words of the main chat's answer: a note to the person (`work note`, to you). */
export const syncHead = about => `Sync check of ${about === SYNC_BOARD ? 'the board' : about}:`

/** A note's number ("N12" is 12); 0 for none. */
const numberOf = id => Number(String(id ?? '').match(/^N(\d+)$/)?.[1] ?? 0)

/** The answers to the checks of `about` among the notes (work/lists.mjs `informationOf`: `{ id, text, since }`). */
const answersOf = (notes, about) => (notes ?? []).filter(one => String(one.text ?? '').startsWith(syncHead(about)))

/**
 * B438, the review: the number of the newest answer to a check of `about` (0 for none). It is kept on the ask, so an
 * answer written in the same minute as a new ask (the store keeps minutes) does not answer it.
 */
export const lastSyncAnswer = (notes, about) => Math.max(0, ...answersOf(notes, about).map(one => numberOf(one.id)))

/**
 * The newest sync check of each name in `abouts` (the workers, and `board`), with the main chat's answer:
 * `{ [about]: { at, state, isOpen, answer: { at, text } | null } }`. `sent` is the board's messages, `notes` the
 * information list. The answer is the newest note that starts with `syncHead(about)`, newer than the one there was when
 * the check was asked (`seen`) and written since the minute of the ask. A check is open while it is on its way, and
 * after it arrived (or was copied, for the person to paste) until it is answered, half an hour at most; it is left out
 * an hour after its answer, or after it arrived (or was asked) when none came.
 */
export function syncChecks(sent, notes, abouts, now) {
  const checks = {}
  for (const about of abouts) {
    const message = (sent ?? []).findLast(one => one.command === 'sync' && one.about === about)
    if (message === undefined) continue
    const from = Math.floor(message.at / MIN) * MIN
    const seen = Number.isFinite(message.seen) ? message.seen : 0
    const reply = answersOf(notes, about).filter(one => Number.isFinite(one.since) && one.since >= from && numberOf(one.id) > seen)
      .reduce((newest, one) => (newest === null || one.since > newest.since || (one.since === newest.since && numberOf(one.id) > numberOf(newest.id)) ? one : newest), null)
    const head = syncHead(about)
    const answer = reply === null ? null : { at: reply.since, text: reply.text.slice(head.length).trim() }
    const isOnItsWay = message.state === 'waiting' || message.state === 'taken'
    const hasArrived = message.state === 'delivered' || message.state === 'copied'
    const arrivedAt = message.deliveredAt ?? message.at
    const isOpen = answer === null && (isOnItsWay || (hasArrived && now - arrivedAt < SYNC_OPEN_MS))
    const last = answer?.at ?? arrivedAt
    if (!isOpen && now - last >= SYNC_SHOWN_MS) continue
    checks[about] = { at: message.at, state: message.state, isOpen, answer }
  }
  return checks
}
