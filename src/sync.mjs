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

/**
 * The newest sync check of each name in `abouts` (the workers, and `board`), with the main chat's answer:
 * `{ [about]: { at, state, isOpen, answer: { at, text } | null } }`. `sent` is the board's messages, `notes` the
 * information list (work/lists.mjs `informationOf`: `{ text, since }`). The answer is the newest note that starts with
 * `syncHead(about)`, written since the minute of the ask (the store keeps minutes). A check is open while it is on its
 * way, and after it arrived until it is answered, half an hour at most; it is left out an hour after its answer, or
 * after it arrived (or was asked) when none came.
 */
export function syncChecks(sent, notes, abouts, now) {
  const checks = {}
  for (const about of abouts) {
    const message = (sent ?? []).findLast(one => one.command === 'sync' && one.about === about)
    if (message === undefined) continue
    const from = Math.floor(message.at / MIN) * MIN
    const head = syncHead(about)
    const reply = (notes ?? []).filter(one => Number.isFinite(one.since) && one.since >= from && String(one.text ?? '').startsWith(head))
      .reduce((newest, one) => (newest === null || one.since > newest.since ? one : newest), null)
    const answer = reply === null ? null : { at: reply.since, text: reply.text.slice(head.length).trim() }
    const isOnItsWay = message.state === 'waiting' || message.state === 'taken'
    const isOpen = answer === null && (isOnItsWay || (message.state === 'delivered' && now - (message.deliveredAt ?? message.at) < SYNC_OPEN_MS))
    const last = answer?.at ?? message.deliveredAt ?? message.at
    if (!isOpen && now - last >= SYNC_SHOWN_MS) continue
    checks[about] = { at: message.at, state: message.state, isOpen, answer }
  }
  return checks
}
