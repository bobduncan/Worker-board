// B589 (the fix of X3): the one judge of a work line (the work store's line to a chat, `command: 'work'`), waiting or
// failed for good: why its purpose is gone, or null while it still matters. withdrawStale (deliver.mjs) closes the lines
// it names; the outbox sweep's whyClosed (outboxSweep.mjs) gives the health summary and rule 8 the same answer. Until
// B589 only a waiting line was judged: one the chat could not type stayed failed, and was named, after its step was done.

import { openQaTaskOf } from './qaTask.mjs'

/** B465, the review: a line of the board's sync check holds at most this long; the check decides anew after it. */
export const SYNC_LINE_MS = 30 * 60_000

const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const value = (item, key) => {
  const found = item?.head.get(key)
  return found === undefined || found === '' || found === '-' ? null : found
}

/**
 * Why a work line no longer matters ("B567 is done", "B522 left review"), or null while it does. `items`: the work store's
 * items by id; `prefix`: the chats' titles' start; `now`.
 */
export function workLineWhy(message, items, { prefix = '', now = Date.now() } = {}) {
  const id = message.about
  const item = items.get(id)
  const state = value(item, 'State')
  const gone = `${id} is gone`
  // Focus 4: a notes line holds while one of its notes is not read by the main chat.
  if (message.kind === 'note') {
    return (message.notes ?? [id]).some(one => items.get(one) !== undefined && value(items.get(one), 'Main read') === null) ? null : 'its notes were read'
  }
  if (message.kind === 'sync') {
    // B465: the board's sync check woke a chat about something (a step, its helper's work, an ask, the limit). The
    // review: its line holds while what it is about is still open, for its owner's lines while the step is still that
    // chat's, and at most SYNC_LINE_MS: the check looks again every few minutes and decides anew.
    const isStep = value(item, 'Kind') === 'step'
    if (item === undefined) return gone
    // T9.4: the words that ask the Advisor again hold while its refine is still to write (the step new), or its incident still with it.
    const again = /^(refine|incident)-again /.exec(String(message.syncKey ?? ''))?.[1] ?? null
    if (again === 'refine' ? state !== 'new' : again === 'incident' ? state !== 'with the advisor' : isStep ? ['done', 'dropped'].includes(state) : state !== 'open') return `${id} is ${state}`
    // T9.1.1: the word that asked the Advisor for a result check again (the repair `unchecked`, gone now): not needed once the step
    // left review or has its Quality Assurance task, which a worker does.
    if (/^unchecked /.test(String(message.syncKey ?? ''))) {
      if (state !== 'review') return `${id} left review`
      const qa = openQaTaskOf(items, id)
      if (qa !== null) return `${id} has its QA task ${value(qa, 'Id')}`
    }
    const isOwnersLine = /^(?:not-taken|limit-back) /.test(String(message.syncKey ?? ''))
    if (isOwnersLine && (value(item, 'Owner') === null || plain(value(item, 'Owner'), prefix) !== plain(message.to, prefix))) return `${id} is no longer ${message.to}'s`
    return now - (message.at ?? 0) < SYNC_LINE_MS ? null : `the sync check decides anew after ${SYNC_LINE_MS / 60_000} min`
  }
  if (message.kind === 'board-queued') {
    // Incident fixes (2026-10-24): the main chat's information line about a fix the board queued holds while that step
    // is still open: it is the main chat's to know, whoever has the step by now.
    if (item === undefined) return gone
    return ['done', 'dropped'].includes(state) ? `${id} is ${state}` : null
  }
  if (message.kind === 'held-twice') {
    // The recheck: the word that a task's line was held twice holds while the task is still on the list (refined).
    if (item === undefined) return gone
    return state === 'refined' ? null : `${id} is ${state} now, not on the list`
  }
  if (message.kind === 'fix-held') {
    // The review: the word that a fix's standard holds it holds while the fix is still refined, not queued.
    if (item === undefined) return gone
    return state === 'refined' ? null : `${id} is ${state} now, not refined`
  }
  if (message.kind === 'partner-ask') {
    // Partner answers (2026-10-19): the partner's line holds while its ask still waits for its answer.
    if (item === undefined) return gone
    if (state !== 'open') return `${id} is ${state}`
    return value(item, 'Route') === 'partner' ? null : `${id} is no longer the partner's`
  }
  // A step's line to its owner, or (kind check) the word that its board check failed: the step still that chat's, and
  // open (a check's word: still in review).
  if (item === undefined) return gone
  const owner = value(item, 'Owner')
  if (owner === null || plain(owner, prefix) !== plain(message.to, prefix)) return owner === null ? `${id} has no owner now` : `${id} is ${owner}'s now`
  if (message.kind === 'check') return state === 'review' ? null : `${id} left review`
  return ['done', 'dropped'].includes(state) ? `${id} is ${state}` : null
}
