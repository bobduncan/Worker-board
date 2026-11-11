// P5 (2026-11-09, chat 1's plan, the person's "Yes, build now"): every item on the person's lists re-checks itself. A thin runner over tests the
// board already has: on every reconcile pass it asks, of what the pass has read, "is this still true?", and what is not comes down with a record
// of why. Nothing here decides anything new; each check is an existing one, named below, and "as of HH:MM" is for a test that errored, never for
// an answer.
//
//   an open ask, of ANY Route    the start-up check's test (startupCheck.mjs `asksOf`): its step ended (done or dropped) AFTER the ask was filed;
//                                never what `stillTrueLeaves` names (the asks that wait for the goal's recap, a taken-back ask, popups, refine
//                                questions), and the title's B<n> names the step only for an ask routed to the person. Withdrawn through the work
//                                API's `asks-withdrawn` with `anyRoute`, the why "its step B<n> is <state> (still-true)".
//   a wake line                  wake.mjs `noticeOf` leaves out a chat that ran since its failed wake (`ranSince`); a line that was shown on the last
//                                pass and is not now gets its record here (the notice is the state's own, so no hysteresis).
//   a Supervisor's alarm note    its `Incidents: X1, X2` are all fixed, gone, closed or dropped: the work API's `notes-came-down` (which checks it
//                                again) marks it read, "came down: X1 fixed, X2 gone".
//
// Hysteresis (the board must not flap): a finding counts only when it was found on two passes in a row AND first found at least MIN_AGE_MS ago (a
// pass runs every few seconds, so two passes alone could be one moment). A write the work API refuses is not tried again for BACKOFF_MS (one log line).
// `memory` is the Map the caller keeps for the board process's life. `stillTrue` is pure apart from that memory; `stillTruePass` does the writes.

import { asksOf } from './startupCheck.mjs'
import { ranSince } from './wake.mjs'
import { noteCameDownWords, stillTrueLeaves } from './work/stillTrueRules.mjs'
import { valueOf } from './work/item.mjs'

/** How long a finding must have stood (first found) before it counts, besides being found on two passes in a row. */
export const MIN_AGE_MS = 20_000
/** How long a write the work API refused is left alone. */
export const BACKOFF_MS = 10 * 60_000
/** The memory's keys that are no finding (a '#' key). */
const PASS = '#pass'
const WAKE_LINES = '#wake-lines'
const BACKOFF = '#backoff '

/** The chats a wake notice's text names ("could not wake X: ..." / "could not wake X at 10:32; nothing waits for it now"). */
export function wakeChatsOf(notice) {
  const text = typeof notice?.text === 'string' ? notice.text : ''
  return [...text.matchAll(/could not wake (.+?)(?::| at \d\d:\d\d;)/g)].map(found => found[1])
}

/** The asks that are over: `[{ kind: 'ask', id, why }]`. */
function asksDown(items) {
  const down = []
  for (const ask of asksOf(items, { anyRoute: true })) {
    if (ask.stepState !== 'done' && ask.stepState !== 'dropped') continue
    // The start-up check's guard: the step must have ended AFTER the ask was put (an ask that names an old done step as context stays).
    if (!(Number.isFinite(ask.since) && Number.isFinite(ask.stepEndedAt) && ask.stepEndedAt > ask.since)) continue
    down.push({ kind: 'ask', id: ask.id, why: `its step ${ask.step} is ${ask.stepState} (still-true)` })
  }
  return down
}

/** The Supervisor's unread notes whose incidents are all over: `[{ kind: 'note', id, why }]` (`why` "came down: X1 fixed, X2 gone"). */
function notesDown(items) {
  const down = []
  for (const item of items?.values?.() ?? []) {
    const why = noteCameDownWords(item, items)
    if (why !== null) down.push({ kind: 'note', id: valueOf(item, 'Id'), why })
  }
  return down
}

/**
 * What stands that is not true any more, from what the reconcile already read: `facts` `{ state, items, wakes, reports, now }` (`state` the
 * state just read, whose `wakeNotice` is the notice now; `items` the store's items; `wakes` the wake facts (`{ record, ... }`, server.mjs `wakeFacts`); `reports` the kept reports by
 * chat; `now` ms). Answers `{ down, notice }`: `down` the items to bring down (`{ kind: 'ask' | 'note' | 'wake', id, why }`), only those that
 * passed the hysteresis; `notice` `{ chats, tone }`, the wake notice as it stands now. No side effect but `memory`.
 */
export function stillTrue(facts, memory = new Map()) {
  const now = facts.now
  const pass = (memory.get(PASS) ?? 0) + 1
  memory.set(PASS, pass)
  const found = new Map([...asksDown(facts.items), ...notesDown(facts.items)].map(one => [`${one.kind}:${one.id}`, one]))
  // A write the work API refused is left alone for BACKOFF_MS (set by `stillTruePass`); one that ran out is forgotten.
  for (const key of [...found.keys()]) {
    const until = memory.get(`${BACKOFF}${key}`)
    if (until === undefined) continue
    if (now < until) found.delete(key)
    else memory.delete(`${BACKOFF}${key}`)
  }
  const down = []
  for (const [key, one] of found) {
    const seen = memory.get(key)
    if (seen === undefined) {
      memory.set(key, { firstAt: now, pass })
      continue
    }
    // Found on the pass before AND first found long enough ago: it counts, and it is down (its memory goes with it).
    if (seen.pass === pass - 1 && now - seen.firstAt >= MIN_AGE_MS) {
      down.push(one)
      memory.delete(key)
    } else memory.set(key, { firstAt: seen.firstAt, pass })
  }
  // A finding not found this pass is no finding: it must stand on two passes in a row again.
  for (const key of [...memory.keys()]) if (!key.startsWith('#') && !found.has(key)) memory.delete(key)
  // The wake notice: a line shown on the last pass and gone now came down (the state's own `noticeOf` took it out: the chat ran since).
  const chats = wakeChatsOf(facts.state?.wakeNotice)
  const before = memory.get(WAKE_LINES)
  memory.set(WAKE_LINES, chats)
  for (const chat of before ?? []) {
    if (chats.includes(chat)) continue
    const record = facts.wakes?.record ?? null
    const spell = record?.wakes?.get(chat)?.at(-1)?.spell ?? null
    const report = facts.reports instanceof Map ? facts.reports.get(chat) : facts.reports?.[chat]
    const ran = record !== null && ranSince(record, chat, spell, report ?? null, now)
    down.push({ kind: 'wake', id: `wake ${chat}`, why: ran ? `${chat} ran since its failed wake` : `the failed wake of ${chat} no longer stands` })
  }
  return { down, notice: { chats, tone: facts.state?.wakeNotice?.tone ?? null } }
}

/**
 * One pass: `stillTrue`, then the writes. In its own try (a throw stops no delivery: one line to `log`, nothing else). ONE batched work call
 * for the asks that come down (`asks-withdrawn` with the list, `anyRoute`) and ONE for the notes (`notes-came-down`, the ids only: the work API
 * re-checks each and says why); every item that really came down gets a line in the history (`history(lines)`: `{ at, kind: 'came down', id,
 * why }`). What the work API refused (or a call that threw) is not tried again for BACKOFF_MS, with one log line per item. `apply(body)` the work
 * call as the board (`workAction(body, 'server')`). Answers the items that came down.
 */
export async function stillTruePass({ facts, memory, apply, log = () => {}, history = async () => {} }) {
  const came = []
  try {
    const { down } = stillTrue(facts, memory)
    const write = async list => {
      if (list.length === 0) return
      came.push(...list)
      await history(list.map(one => ({ at: facts.now, kind: 'came down', id: one.id, why: one.why })))
    }
    const refused = (list, why) => {
      for (const one of list) {
        memory.set(`${BACKOFF}${one.kind}:${one.id}`, facts.now + BACKOFF_MS)
        log(`still-true: ${one.id} not taken down (${why}); not tried again for ${BACKOFF_MS / 60_000} min`)
      }
    }
    const call = async (list, body, took) => {
      if (list.length === 0) return
      let done = null
      try {
        done = await apply(body)
      } catch (error) {
        refused(list, error?.message ?? String(error))
        return
      }
      const mine = took(done?.ok === true ? done.result ?? {} : {})
      await write(mine.filter(one => one.came))
      refused(mine.filter(one => !one.came), done?.ok === true ? 'the work API left it' : done?.why ?? 'refused')
    }
    const asks = down.filter(one => one.kind === 'ask')
    await call(asks, { action: 'asks-withdrawn', anyRoute: true, withdraw: asks.map(one => ({ id: one.id })) },
      result => asks.map(one => ({ ...one, came: (result.withdrawn ?? []).includes(one.id) })))
    const notes = down.filter(one => one.kind === 'note')
    await call(notes, { action: 'notes-came-down', notes: notes.map(one => one.id) },
      result => notes.map(one => ({ ...one, came: (result.read ?? []).includes(one.id), why: result.whys?.[one.id] ?? one.why })))
    await write(down.filter(one => one.kind === 'wake'))
  } catch (error) {
    log(`still-true: ${error?.message ?? error}`)
  }
  return came
}
