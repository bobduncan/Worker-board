// B547 (X13, X14): every reported step ends in a cleared chat. The Workers mod decides a worker's clear once, at the end
// of the turn that reported its step (list.json "afterStep": "clear"); on 2026-10-24 that moment failed three times and
// nothing tried again: Workers 4 and 1 (an older mod, 18:22 and 18:23) left no clear and no reason, Worker 2 (19:10) was
// refused the log while its background work ran. Each then took its next step on the old conversation. So the board,
// which sees both ends, keeps the account: a worker whose last report is newer than its last clear owes a clear. While
// it does, the board holds the line of its next step, refuses its take, and once the chat is idle names the clear to its
// Workers mod (bridge take, `clear`), which keeps the log and runs /clear; a mod older than CLEAR_MOD cannot, and the
// supervisor's rule not-cleared names it. PURE.

import { sinceMs, valueOf } from './work/item.mjs'

/** The Workers mod that runs a clear the board names in its answer to a take (`clear`). */
export const CLEAR_MOD = '0.17.0'
/** The mod's own clear at the end of the reporting turn goes first: the board names one only this long after the report. */
export const CLEAR_GRACE_MS = 2 * 60_000

/** A History line that reports a step: its move to review, or a report again. */
const REPORTED = / → review\b|: reported again\b/
/** "- 2026-10-24 18:21 Worker 4: in progress → review": when, and who wrote it. */
const LINE = /^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d) ([^:]{1,80}):/

const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}

/** Whether version `a` ("0.16.1") is `b` or newer; false for no version. */
export function modAtLeast(a, b = CLEAR_MOD) {
  if (typeof a !== 'string' || !/^\d+(?:\.\d+)*$/.test(a)) return false
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return true
}

/**
 * The chat's last report: the newest History line of any step written by that chat (`chat`, its name with or without
 * the titles' `prefix`) that moves it to review or reports it again. `{ id, at }`, at to the minute; null for none.
 */
export function lastReportOf(items, chat, prefix = '') {
  const me = plain(chat, prefix)
  let last = null
  for (const item of items instanceof Map ? items.values() : items ?? []) {
    if ((valueOf(item, 'Kind') ?? 'step') !== 'step') continue
    for (const line of item.sections?.get('History') ?? []) {
      if (!REPORTED.test(line)) continue
      const found = LINE.exec(line)
      if (found === null || plain(found[2], prefix) !== me) continue
      const at = sinceMs(found[1])
      if (Number.isFinite(at) && (last === null || at > last.at)) last = { id: valueOf(item, 'Id'), at }
    }
  }
  return last
}

/**
 * The steps the chat took after `at`: History lines of its own that move a step to taken (or straight to in progress),
 * newest first, as `{ id, at }`.
 */
export function takenSince(items, chat, at, prefix = '') {
  const me = plain(chat, prefix)
  const taken = []
  for (const item of items instanceof Map ? items.values() : items ?? []) {
    if ((valueOf(item, 'Kind') ?? 'step') !== 'step') continue
    for (const line of item.sections?.get('History') ?? []) {
      if (!/: queued → (?:taken|in progress)\b/.test(line)) continue
      const found = LINE.exec(line)
      const when = found === null ? Number.NaN : sinceMs(found[1])
      if (found !== null && plain(found[2], prefix) === me && when >= at) taken.push({ id: valueOf(item, 'Id'), at: when })
    }
  }
  return taken.sort((a, b) => b.at - a.at)
}

/**
 * The clear a worker owes (`lane`: the board's chat, state.mjs, with its card's `compaction`): its last report is newer
 * than its last clear, with "afterStep": "clear" in the list of chats. `{ step, reportedAt, clearedAt, why }`: the step
 * reported, when, the last clear (null for none), and the Workers mod's last word why it did not clear when that word
 * came after the report (else null). Null when nothing is owed: no clear after steps, no worker, no report, or a clear
 * since.
 */
export function clearOwed({ lane, items, prefix = '', afterStep = null }) {
  if (afterStep !== 'clear' || lane === null || lane === undefined || lane.isMain === true || lane.isLeftover === true) return null
  const report = lastReportOf(items, lane.name, prefix)
  if (report === null) return null
  const compaction = lane.compaction ?? null
  const cleared = compaction?.lastCleared ?? (compaction?.kind === 'cleared' ? { at: compaction.at, step: compaction.step ?? null } : null)
  const clearedAt = Number.isFinite(cleared?.at) ? cleared.at : null
  if (clearedAt !== null && clearedAt >= report.at) return null
  const note = compaction?.notCleared ?? null
  const why = note !== null && Number.isFinite(note.at) && note.at >= report.at && typeof note.why === 'string' ? note.why : null
  return { step: report.id, reportedAt: report.at, clearedAt, why }
}

/** Whether an outbox message is the board's line that a step is the chat's ("work: B286 is yours; run work next"). */
export const isStepLine = message => message?.command === 'work' && typeof message.about === 'string' && /^[A-Z]\d{1,6}$/.test(message.about) && /\bis yours; run work next$/.test(String(message.text ?? ''))

/**
 * What the bridge does for a chat at a take (`owed`: clearOwed's answer, or null): `hold` the lines of a next step while a
 * clear is owed; `clear` (the word to the Workers mod) once the grace after the report has passed, the chat is idle
 * (`isIdle`), nothing it started runs in the background (`background`) and the person does not pause; `why` the one
 * line the page shows for a held step. A mod older than CLEAR_MOD (`mod`) is held to nothing: it could not clear.
 */
export function clearAtTake({ owed, mod, now, isIdle, background = 0, isPaused = false }) {
  if (owed === null || owed === undefined || !modAtLeast(mod)) return { hold: false, clear: null, why: null }
  const waits = `not cleared after ${owed.step} yet`
  if (isPaused) return { hold: true, clear: null, why: `${waits}: the person pauses the chats` }
  if (background > 0) return { hold: true, clear: null, why: `${waits}: background work it started still runs` }
  if (!isIdle) return { hold: true, clear: null, why: `${waits}: its turn runs` }
  if (now - owed.reportedAt < CLEAR_GRACE_MS) return { hold: true, clear: null, why: `${waits}: its Workers mod clears it after the report` }
  return { hold: true, clear: { step: owed.step, reportedAt: owed.reportedAt }, why: `${waits}: its Workers mod clears it now` }
}

/**
 * The steps whose line waits for their worker's clear (`lanes`: the board's chats with `clearOwed` and `isRunning`,
 * `deliveries`: the reconciler's lines to free workers): a worker whose mod can clear. B587 (X36): not a worker whose
 * process ended (`isRunning` false, a restart for a new mod archived it): it cannot clear before a word starts it, so its
 * line goes at once with the board's `start` beside it; once it runs, its take is refused and its mod clears it first.
 */
export function clearHolds({ lanes = [], deliveries = [] }) {
  const holds = lanes.filter(lane => lane?.clearOwed?.canClear === true && lane.isRunning !== false)
  return new Set(holds.flatMap(lane => deliveries.filter(one => one.chat === lane.name).map(one => one.id)))
}

/** The words of a take refused while a clear is owed (the work tool's take, from a mod that can clear). */
export const takeRefusal = owed => `Not yet: this chat is cleared after ${owed.step} first, its conversation kept as a log. End your turn now; the Workers mod clears the chat and the fresh conversation takes the step.`
