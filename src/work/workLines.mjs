// B589 (the fix of X3): the one judge of a work line (the work store's line to a chat, `command: 'work'`), waiting or
// failed for good: why its purpose is gone, or null while it still matters. withdrawStale (deliver.mjs) closes the lines
// it names; the outbox sweep's whyClosed (outboxSweep.mjs) gives the health summary and rule 8 the same answer. Until
// B589 only a waiting line was judged: one the chat could not type stayed failed, and was named, after its step was done.

import { OLD_CHECK_WHY } from './qaTask.mjs'

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
 * B949: the judge of an asset word ("asset A17 ready: <folder>", "asset A17 failed: <why>"), by the asset's own request, never
 * by the work store (which holds no A-ids: B589's step branch read every one as gone, and five of 18 words were dropped
 * 0.6 s after they were written). `assets`: the requests by id (src/assets.mjs `listAssets`), or undefined when the caller
 * has not read them: the word then holds, for the board cannot tell. A ready word is dropped when its request is gone or
 * failed; a failed word when its request is gone; either when the step it was asked for (the request's `of`) is done,
 * dropped or another chat's. A request still being made holds its word.
 */
function assetLineWhy(message, items, assets, prefix) {
  const id = message.about
  if (!(assets instanceof Map)) return null
  const request = assets.get(id)
  if (request === undefined) return `${id} is gone`
  const isFailedWord = /^asset \S+ failed:/.test(String(message.text ?? ''))
  if (request.state === 'failed' && !isFailedWord) return `${id} failed`
  const item = typeof request.of === 'string' ? items.get(request.of) : undefined
  if (item === undefined) return null
  const state = value(item, 'State')
  if (['done', 'dropped'].includes(state)) return `${request.of} is ${state}`
  const owner = value(item, 'Owner')
  return owner !== null && plain(owner, prefix) !== plain(message.to, prefix) ? `${request.of} is ${owner}'s now` : null
}

/**
 * B949: the asset words to send again, `[{ chat, id, key }]`. A ready word the sweep dropped as "<A-id> is gone" (the fault
 * of B949: it read the word by the work store) is written once more when its request is ready, its step is still that
 * chat's and in progress, and no later word to that chat names the asset (one by hand, or an earlier send again). The key
 * (`asset-again <A-id> <chat>`) is sent once, ever (deliver.mjs `sendOnce`).
 */
export function assetResends(all, items, assets, { prefix = '' } = {}) {
  if (!(assets instanceof Map)) return []
  const found = []
  for (const message of all) {
    if (message.command !== 'work' || message.kind !== 'asset' || message.state !== 'dropped' || message.why !== `${message.about} is gone`) continue
    if (!/^asset \S+ ready:/.test(String(message.text ?? ''))) continue
    const request = assets.get(message.about)
    const item = typeof request?.of === 'string' ? items.get(request.of) : undefined
    if (request?.state !== 'ready' || item === undefined || value(item, 'State') !== 'in progress') continue
    if (plain(value(item, 'Owner'), prefix) !== plain(message.to, prefix)) continue
    if (all.some(one => one.id !== message.id && one.to === message.to && (one.at ?? 0) >= (message.at ?? 0) && one.about === message.about && !(one.state === 'dropped' && one.kind === 'asset'))) continue
    if (found.some(one => one.id === message.about && one.chat === message.to)) continue
    found.push({ chat: message.to, id: message.about, key: `asset-again ${message.about} ${message.to}` })
  }
  return found
}

/**
 * Why a work line no longer matters ("B567 is done", "B522 left review"), or null while it does. `items`: the work store's
 * items by id; `prefix`: the chats' titles' start; `now`; `assets` (B949): the asset requests by id, for the asset words.
 */
export function workLineWhy(message, items, { prefix = '', now = Date.now(), assets } = {}) {
  const id = message.about
  // B949: an asset word is the asset's, not the work store's.
  if (message.kind === 'asset') return assetLineWhy(message, items, assets, prefix)
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
    // T9.1.1: the word that asked the Advisor for a result check again (the repair `unchecked`, gone now): closed whatever the step's
    // state, for the Advisor can no longer file a step check: a worker does, by its Quality Assurance task.
    if (/^unchecked /.test(String(message.syncKey ?? ''))) return OLD_CHECK_WHY
    const isStep = value(item, 'Kind') === 'step'
    if (item === undefined) return gone
    // T9.4: the words that ask the Advisor again hold while its refine is still to write (the step new), or its incident still with it.
    const again = /^(refine|incident)-again /.exec(String(message.syncKey ?? ''))?.[1] ?? null
    if (again === 'refine' ? state !== 'new' : again === 'incident' ? state !== 'with the supervisor' : isStep ? ['done', 'dropped'].includes(state) : state !== 'open') return `${id} is ${state}`
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
  if (message.kind === 'main-ask') {
    // Autopilot (2026-10-31): the main chat's word for an ask routed to it holds while the ask still waits for it.
    if (item === undefined) return gone
    if (state !== 'open') return `${id} is ${state}`
    return value(item, 'Route') === 'main' ? null : `${id} is no longer the main chat's`
  }
  if (message.kind === 'words') {
    // Rule 15: the word that the person's words hold an ask (re-ask or withdraw it, or say it still stands) matters only while the ask is
    // open and held: answered, withdrawn, re-asked (a re-ask withdraws it) or released, it is done, never "undelivered" for ever. The word
    // that the hold ran out (the ask is the person's again) holds while the ask is open: its chat may still withdraw or re-ask it.
    if (item === undefined) return gone
    if (state !== 'open') return `${id} is ${state}`
    const isRelease = /nobody re-checked it/.test(String(message.text ?? ''))
    return isRelease || value(item, 'Route') === 'asker' ? null : `${id} is no longer held`
  }
  // A step's line to its owner, or (kind check) the word that its board check failed: the step still that chat's, and
  // open (a check's word: still in review).
  if (item === undefined) return gone
  const owner = value(item, 'Owner')
  if (owner === null || plain(owner, prefix) !== plain(message.to, prefix)) return owner === null ? `${id} has no owner now` : `${id} is ${owner}'s now`
  if (message.kind === 'check') return state === 'review' ? null : `${id} left review`
  return ['done', 'dropped'].includes(state) ? `${id} is ${state}` : null
}
