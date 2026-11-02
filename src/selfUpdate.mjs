// B454: the board loads its new version by itself. A new page is loaded by the page when it is idle (public/board.js);
// a new server is started anew by the board itself at a safe moment: no line being typed into a chat, no check or
// reconcile pass running, no chat log being written, no call of a chat being answered, and the quiet moment after a
// chat was cleared. If no safe moment comes within 10 minutes, the note on top stays as it was (B142): "Click to
// start it". The person, 2026-10-20 (Q259): nine questions in two days only asked to click that note.

/** How long the board waits for a safe moment before it leaves the note on top for the person's click. */
export const SELF_UPDATE_WAIT_MS = 10 * 60_000
/** How long after a chat's log was saved (it is cleared next, and its fresh conversation starts) the board stays up. */
export const AFTER_LOG_MS = 30_000
/** How long after a step was reported its worker's conversation may still be kept as a log and cleared (the board stays up). */
export const REPORTED_BLOCKS_MS = 2 * 60_000
/** A line taken longer ago than this and not confirmed typed is no turn being typed into any more (a chat that ended). */
export const TAKEN_BLOCKS_MS = 2 * 60_000

// Signals change 5 (2026-11-02, C of B913): the restart waits for the person. On 2026-11-01 the board restarted eight times
// for landings while the person typed. A restart no longer reloads the page (the keeper keeps its token), but the board still
// waits while the person is busy on the page: a key or click in the last minute, or a field with the focus, in a visible tab
// (the page's poll says so in a header, X-Board-Active). Never longer than PERSON_WAIT_MS from the first look at which only
// the person keeps it waiting: a page left with the focus in a field cannot hold a new version off for ever.

/** How long the board waits for the person alone before it starts its new version anyway. */
export const PERSON_WAIT_MS = 3 * 60_000
/** How long a page's word that the person is busy counts: the page asks every refresh (30 s), a hidden one once a minute. */
export const ACTIVE_KEPT_MS = 90_000
/** The blocker's words while the person is busy on the page. */
export const PERSON_BUSY = 'the person is busy on the page'

import { sinceMs, valueOf } from './work/item.mjs'

const list = names => {
  const unique = [...new Set(names)].filter(name => typeof name === 'string' && name !== '')
  return unique.length === 0 ? '' : unique.length === 1 ? unique[0] : `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`
}

/**
 * What keeps the board from starting anew now, as short phrases ("a check runs"); empty is a safe moment. Facts:
 * `outbox` (the board's lines: `{ to, state, takenAt }`), `checks` (running result checks), `isReconciling`, `logs`
 * (chat logs not written yet), `calls` (calls of the chats being answered now), `lastLogAt` (when a chat log was last
 * asked for), `isPaused` (Pause all stands or is resuming), `reported` (the chats whose step was reported a moment ago and
 * whose log is not kept yet: see `reportedNotLogged`).
 */
export function blockersOf({ now, outbox = [], checks = 0, isReconciling = false, logs = 0, calls = 0, lastLogAt = null, isPaused = false, reported = [], personActive = null }) {
  const blocked = []
  if (isPaused) blocked.push('Pause all stands')
  const typing = outbox.filter(one => one?.state === 'taken' && Number.isFinite(one.takenAt) && now - one.takenAt < TAKEN_BLOCKS_MS).map(one => one.to)
  if (typing.length > 0) blocked.push(`a line is typed into ${list(typing)}`)
  if (checks > 0) blocked.push(checks === 1 ? 'a check runs' : 'checks run')
  if (isReconciling) blocked.push('the board looks over the work')
  if (reported.length > 0) blocked.push(`${list(reported)} just reported a step`)
  if (logs > 0) blocked.push(logs === 1 ? 'a chat log is written' : 'chat logs are written')
  if (calls > 0) blocked.push('a chat\'s call is answered')
  if (Number.isFinite(lastLogAt) && now - lastLogAt < AFTER_LOG_MS) blocked.push('a chat is cleared')
  if (personActive !== null && personActive !== undefined) blocked.push(PERSON_BUSY)
  return blocked
}

/**
 * Signals change 5: a page's X-Board-Active header, `<page id> <ms>`: which page load says the person is busy on it, and for
 * how long already (a length of time, so the page's clock, which may be hours off, never counts). Null for anything else.
 */
export function readActive(header) {
  const found = /^([A-Za-z0-9-]{1,40}) (\d{1,10}|off)$/.exec(typeof header === 'string' ? header.trim() : '')
  if (found === null) return null
  // 2026-11-02 (the lead's check of change 5: a wait ran to the 3-minute cap although the person had left the field after
  // 20 s): the page's first poll after it stopped being busy says `<page> off`, so the board drops its word at once; the 90 s
  // of ACTIVE_KEPT_MS stay only for a tab that fell silent.
  return found[2] === 'off' ? { page: found[1], forMs: null, off: true } : { page: found[1], forMs: Number(found[2]), off: false }
}

/**
 * Signals change 5: what the pages said about the person, by page id (a tab, the app's pane, a headless shot may all ask).
 * `heard(header, now)` takes a poll's header; `personActive(now)` is `{ since }` (the board's clock) while any page said so
 * within `keptMs`, else null; a page that went quiet is forgotten.
 */
export function activePages({ keptMs = ACTIVE_KEPT_MS } = {}) {
  const pages = new Map()
  return {
    heard(header, now) {
      const told = readActive(header)
      if (told === null) return
      if (told.off) pages.delete(told.page)
      else pages.set(told.page, { at: now, since: now - told.forMs })
    },
    personActive(now) {
      let since = null
      for (const [page, one] of pages) {
        if (now - one.at > keptMs) pages.delete(page)
        else since = since === null ? one.since : Math.min(since, one.since)
      }
      return since === null ? null : { since }
    },
  }
}

/**
 * B512: the chats whose step moved to review less than REPORTED_BLOCKS_MS ago and whose conversation was not kept as a log
 * since (`loggedAt`: chat name to the time its log was asked for). Between a report's check passing and the log, a restart
 * would fail the log and the chat would be compacted, not cleared. `items` are the store's items.
 */
export function reportedNotLogged({ items = [], now, loggedAt = new Map() }) {
  const names = new Set()
  for (const item of items) {
    if (valueOf(item, 'Kind') !== 'step' || valueOf(item, 'State') !== 'review') continue
    const owner = valueOf(item, 'Owner')
    if (owner === null) continue
    const line = (item.sections?.get('History') ?? []).findLast(one => / → review\b|: reported again\b/.test(one))
    const stamp = /^- (\d{4}-\d\d-\d\d \d\d:\d\d)/.exec(line ?? '')
    const at = stamp === null ? Number.NaN : sinceMs(stamp[1])
    if (!Number.isFinite(at) || now - at >= REPORTED_BLOCKS_MS) continue
    const logged = [...loggedAt].some(([chat, when]) => (chat === owner || chat.endsWith(` ${owner}`)) && when >= at)
    if (!logged) names.add(owner)
  }
  return [...names]
}

/**
 * The board's look at its own new version, once per look. `look({ isNewer, canRestart, blockers })` answers `{ restart,
 * shown }`: `restart` when the server is newer, can start itself and nothing blocks; `shown` for the page, null when
 * nothing waits: `{ state: 'waiting' | 'late', since, line }`. `late` (the wait passed `waitMs`, or a start was refused)
 * leaves the note on top to the person. `refused(why)` is told when a start was refused (a settings file broken, a
 * version that does not load): the board does not try again for another `waitMs`.
 * Signals change 5: the person busy on the page (PERSON_BUSY) holds the start for `personWaitMs` from the first look at
 * which only the person holds it, then no longer; while only the person holds it the note is never `late` (the person is
 * there, and the start comes by itself within minutes).
 */
export function selfUpdater({ now = Date.now, waitMs = SELF_UPDATE_WAIT_MS, personWaitMs = PERSON_WAIT_MS } = {}) {
  let since = null
  let refusal = null
  let personFrom = null
  return {
    look({ isNewer, canRestart = true, blockers = [] }) {
      if (!isNewer || !canRestart) {
        since = null
        refusal = null
        personFrom = null
        return { restart: false, shown: null }
      }
      const at = now()
      since ??= at
      if (refusal !== null && at - refusal.at >= waitMs) refusal = null
      if (refusal !== null) return { restart: false, shown: { state: 'late', since, line: `The board could not start itself anew: ${refusal.why}` } }
      const isOnlyPerson = blockers.length > 0 && blockers.every(one => one === PERSON_BUSY)
      if (isOnlyPerson) personFrom ??= at
      if (isOnlyPerson && at - personFrom >= personWaitMs) blockers = []
      if (blockers.length === 0) return { restart: true, shown: { state: 'waiting', since, line: 'The board starts the new version now.' } }
      const state = !isOnlyPerson && at - since >= waitMs ? 'late' : 'waiting'
      return { restart: false, shown: { state, since, line: `The new version of the board starts by itself at a safe moment; waiting: ${list(blockers)}.` } }
    },
    refused(why) {
      refusal = { at: now(), why: String(why ?? 'it was refused').slice(0, 200) }
    },
  }
}
