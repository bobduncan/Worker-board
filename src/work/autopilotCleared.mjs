// What Autopilot cleared for the person when they switched it on (the person, 2026-11-02, on a 47-hour-old Do card "Open the
// recap and try it": "if autopilot is turned on, the outstanding, needing for attentions get reevaluated and possible resolved
// if autopilot would answer them"). The switch-on moves the asks the goal's recap asks already into the recap, and the Advisor
// then closes the obsolete ones (src/work/obsolete.mjs, `by: 'autopilot'`); both are kept in ONE record in the store's folder
// (`autopilot-cleared.json`, beside `obsolete-check.json`), so the page can say "Autopilot cleared N" with an Undo, and a
// restart of the board keeps it. PURE (the file's text and its changes); the work API writes it (api.mjs `autopilot`, `obsolete`,
// `autopilotUndo`).

export const CLEARED_FILE = 'autopilot-cleared.json'
/** The page shows the record, and its Undo, this long after the switch-on. */
export const SHOWN_MS = 24 * 60 * 60_000
/** How an item was cleared: closed (obsolete, by the Advisor) or moved into the goal's recap. */
export const HOWS = ['closed', 'recap']
const TITLE_CHARS = 140
const WHY_CHARS = 160

/** The line on an ask's card that the person took it back from Autopilot (it is theirs now, and never routed again). */
export const UNDO_ROUTE_LINE = 'The person took it back from Autopilot (Undo)'
/** The History line of a closed item the Undo opened again. */
export const REOPENED_WORDS = 'reopened: the person\'s Undo of Autopilot\'s clear'
/** The History line of an ask the Undo took out of the recap. */
export const UNDONE_WORDS = 'autopilot: undone, back to the person'
/** The History line of a blocking ask the Undo opened again as a plain ask. */
export const NON_BLOCKING_WORDS = 'reopened non-blocking: its step went on'
/** The words of an item the switch-on moved into the recap. */
export const MOVED_WORDS = 'moved into your recap'
/** The words of a look the partner handed over that a pass kept for the recap (the person's "A", 2026-11-02): every pass keeps these for the Undo. */
export const KEPT_WORDS = 'kept for your recap'

const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * One cleared item: `{ id, title, how, why }`, the title and the why in one line each. Since signals change 6 the check holds no
 * incident (the Supervisor judges them), so every cleared item is an ask.
 */
export const clearedItem = (id, title, how, why) => ({ id: String(id), title: oneLine(title, TITLE_CHARS), how, why: oneLine(why, WHY_CHARS) })

/** `autopilot-cleared.json` read: null for none; else `{ at, items: [{ id, title, how, why }], undoneAt }` (`undoneAt` null until the Undo). */
export function parseAutopilotCleared(text) {
  if (typeof text !== 'string') return null
  try {
    const raw = JSON.parse(text)
    if (!Number.isFinite(raw?.at) || !Array.isArray(raw.items)) return null
    return {
      at: raw.at,
      items: raw.items.filter(one => typeof one?.id === 'string' && HOWS.includes(one.how)).map(one => clearedItem(one.id, one.title, one.how, one.why)),
      undoneAt: Number.isFinite(raw.undoneAt) ? raw.undoneAt : null,
    }
  } catch {
    return null
  }
}

/** Whether the record is one the person can still undo: not undone, and from the last SHOWN_MS. */
export const isLiveCleared = (record, now) => record !== null && record.undoneAt === null && now - record.at < SHOWN_MS

const withoutDuplicates = items => items.filter((one, place) => items.findIndex(other => other.id === one.id && other.how === one.how) === place)

/**
 * The record after the switch-on: from `now`, holding the items of a record still live (the person switched Autopilot on
 * before and has not undone it) and the `added` ones.
 */
export function startedCleared(record, added, now) {
  const kept = isLiveCleared(record, now) ? record.items : []
  return { at: now, items: withoutDuplicates([...kept, ...added]), undoneAt: null }
}

/**
 * The record after the Advisor's closes: the live record with the `added` items, else a new one; from `now` either way (the
 * newest clear gets its full SHOWN_MS for the Undo).
 */
export function addedCleared(record, added, now) {
  const kept = isLiveCleared(record, now) ? record.items : []
  return { at: now, items: withoutDuplicates([...kept, ...added]), undoneAt: null }
}

/** The words of the Undo's answer: what was undone and what was left. */
export function undoWords(undone, skipped) {
  const left = skipped.length === 0 ? '' : ` Left as it is: ${skipped.map(one => `${one.id} (${one.why})`).join('; ')}.`
  return `${undone.length === 0 ? 'Nothing was undone.' : `Undone ${undone.length}: ${undone.join(', ')}.`}${left}`
}
