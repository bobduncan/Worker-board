// B547 (X13, X14): every reported step ends in a cleared chat. The Workers mod decides a worker's clear once, at the end
// of the turn that reported its step (list.json "afterStep": "clear"); on 2026-10-24 that moment failed three times and
// nothing tried again: Workers 4 and 1 (an older mod, 18:22 and 18:23) left no clear and no reason, Worker 2 (19:10) was
// refused the log while its background work ran. Each then took its next step on the old conversation. So the board,
// which sees both ends, keeps the account: a worker whose last report is newer than its last clear owes a clear. Since
// T8.5 step 6 that clear is the first field of the worker's hand-over envelope (handover.mjs `decide`): the line of its
// next step follows the clear in the same envelope, and a clear that cannot run holds the worker with its why (the
// supervisor's rule handover-held). B737 (X86, 2026-10-27): a report whose board check failed counts for none of this:
// the board hands the step back, its worker rightly stays in its turn to fix it (Worker 3 and B727, 21:02-21:28), so it
// owes no clear and is given no new step (handedBackOf) until it reports again and that check passes. PURE.

import { sinceMs, valueOf } from './work/item.mjs'

/** The Workers mod that can run a clear the board names (`canClear` of the state's `clearOwed`). */
export const CLEAR_MOD = '0.17.0'

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

/** The board's check of a report, in History ("- 2026-10-27 21:03 server: check failed: ..."); the result check is another line. */
const CHECKED = /^-\s+\S+ \S+ server: check (passed|failed)\b/

/**
 * Every report of the chat (`chat`, its name with or without the titles' `prefix`), oldest first: `{ id, at, failed,
 * dropped }`, one per History line of its own that moves a step to review or reports it again. B737 (X86): `failed` when
 * the board's check of that report failed (and no later check of the step passed).
 */
function reportsOf(items, chat, prefix = '') {
  const me = plain(chat, prefix)
  const reports = []
  for (const item of items instanceof Map ? items.values() : items ?? []) {
    if ((valueOf(item, 'Kind') ?? 'step') !== 'step') continue
    let current = null
    for (const line of item.sections?.get('History') ?? []) {
      if (REPORTED.test(line)) {
        const found = LINE.exec(line)
        const at = found === null ? Number.NaN : sinceMs(found[1])
        current = Number.isFinite(at) && plain(found[2], prefix) === me ? { id: valueOf(item, 'Id'), at, failed: false, dropped: valueOf(item, 'State') === 'dropped' } : null
        if (current !== null) reports.push(current)
      } else if (current !== null && CHECKED.test(line)) current.failed = CHECKED.exec(line)[1] === 'failed'
    }
  }
  return reports.sort((a, b) => a.at - b.at)
}

/**
 * The chat's last report: the newest History line of any step written by that chat that moves it to review or reports it
 * again, whose board check did not fail. B737 (X86): a report whose check failed is handed back to the worker (see
 * handedBackOf): it is no report that ends the turn, so it owes no clear. `{ id, at }`, at to the minute; null for none.
 */
export function lastReportOf(items, chat, prefix = '') {
  const last = lastPassedReport(items, chat, prefix)
  return last === null ? null : { id: last.id, at: last.at }
}

const lastPassedReport = (items, chat, prefix) => reportsOf(items, chat, prefix).filter(one => !one.failed).at(-1) ?? null

/**
 * B737 (X86): the report the board's check handed back: the chat's newest report, when its check failed and the chat has
 * not reported again (a later report, or a later check that passed, ends it). `{ id, at }`, else null; a dropped step
 * holds nothing. The worker stays in its turn to fix it, so it is given no new step until it reports that step again.
 */
export function handedBackOf(items, chat, prefix = '') {
  const last = reportsOf(items, chat, prefix).at(-1)
  return last === undefined || !last.failed || last.dropped ? null : { id: last.id, at: last.at }
}

/**
 * The clear a worker owes (`lane`: the board's chat, state.mjs, with its card's `compaction`): its last report is newer
 * than its last clear, with "afterStep": "clear" in the list of chats. `{ step, reportedAt, clearedAt, why, isDropped }`: the step
 * reported (`isDropped`: it was dropped since), when, the last clear (null for none), and the Workers mod's last word why it did not clear when that word
 * came after the report (else null). Null when nothing is owed: no clear after steps, no worker, no report, or a clear
 * since. B547 (X48, X49, X61-X64): or its conversation began since (`conversationAt`, its transcript's start): the card's
 * mark of a clear is written anew every few seconds while the chat works, and a crash of the PC left such cards
 * unreadable; the mod wrote them anew without the mark, and the board held the next step of a worker cleared before it.
 */
export function clearOwed({ lane, items, prefix = '', afterStep = null, conversationAt = null }) {
  if (afterStep !== 'clear' || lane === null || lane === undefined || lane.isMain === true || lane.isLeftover === true) return null
  const report = lastPassedReport(items, lane.name, prefix)
  if (report === null) return null
  const compaction = lane.compaction ?? null
  const cleared = compaction?.lastCleared ?? (compaction?.kind === 'cleared' ? { at: compaction.at, step: compaction.step ?? null } : null)
  const clearedAt = Number.isFinite(cleared?.at) ? cleared.at : null
  if (clearedAt !== null && clearedAt >= report.at) return null
  // A conversation that began at or after the report (to the minute, as the card's clear) is not that report's.
  if (Number.isFinite(conversationAt) && conversationAt >= report.at) return null
  const note = compaction?.notCleared ?? null
  const why = note !== null && Number.isFinite(note.at) && note.at >= report.at && typeof note.why === 'string' ? note.why : null
  return { step: report.id, reportedAt: report.at, clearedAt, why, ...(report.dropped === true ? { isDropped: true } : {}) }
}
