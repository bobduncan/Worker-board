// The asset wait (the one wait system, chat 1's brief of 2026-11-11 under the person's "Yes, build now"): a worker that asked the
// board for pictures (the work tool's `asset`, src/assets.mjs) and ends its turns while the provider draws them waits on purpose.
// The live case of 2026-11-11 10:43: Worker 5 held B1124 and waited for Codex's A224-A227; between its turns the lane read Stopped
// (interrupted), the holder timers would have typed "go on" after 5 min and given the step back after 20 while Codex was still
// drawing, and the person asked "why has worker 5 stopped?". The wait is a record already: the open requests of the holder for its
// held step (request.json: who, of, state waiting or running). Nothing is written for it: this module only reads those records.
// Its lane is parked, P1's shape (waitsOn.mjs `waitSuspension`), kind 'asset': quiet "Paused · waits for Codex: A224-A227 since
// 10:43", no "go on" line and no give-back (holderTimers.mjs), Resume all leaves it (pause.mjs `isResumed`). It ends by itself
// when the last request is ready or failed; a failed one shows its failure on the lane ("A224 failed: ...") instead of a silent
// Stopped. Past the provider's own time limit for a job (`jobMs`) the wait turns one Late on the person's list, "Codex has not
// delivered A224 since 10:43", never a give-back. Not in it: the queue's own logic (src/assetQueue.mjs), the providers, the wake.

import { PROVIDERS } from '../providers/index.mjs'
import { sinceMs, valueOf } from './item.mjs'
import { hourMinute } from './waitsOn.mjs'

/** The states of a request the holder still waits for (src/assets.mjs `ASSET_STATES`): not yet ready or failed. */
export const OPEN_ASSET_STATES = Object.freeze(['waiting', 'running'])
/** The states a step is at work in: only such a step's holder waits for its requests. */
const AT_WORK = ['taken', 'in progress']
/** How long a failed request's failure stays on the lane once nothing of the step is open any more. */
export const FAILED_SHOWN_MS = 30 * 60_000
/** The grace past the provider's time limit before a request is late: the queue ends a job at that limit, so a late one is stuck. */
export const LATE_GRACE_MS = 60_000
/** The provider's time limit for one job when the board names none (src/providers/codex.mjs `PICTURE_SECONDS`). */
export const DEFAULT_JOB_MS = 240_000

const plain = (name, prefix = '') => String(name ?? '').replace(prefix, '').trim().toLowerCase()
const numberOf = id => Number(String(id).slice(1))
const finite = value => Number.isFinite(value)

/** The provider's title as the Settings tab shows it ("Codex"), else its name. */
export const providerTitle = name => PROVIDERS[name]?.card?.title ?? (typeof name === 'string' && name !== '' ? name : 'the provider')

/** "A224-A227" for ids in a row, else "A224, A226" (at most four named, then "+n"). */
export function assetIdsWords(ids) {
  const sorted = [...new Set(ids)].sort((a, b) => numberOf(a) - numberOf(b))
  if (sorted.length === 0) return ''
  const inARow = sorted.every((id, i) => i === 0 || numberOf(id) === numberOf(sorted[i - 1]) + 1)
  if (inARow && sorted.length > 1) return `${sorted[0]}-${sorted.at(-1)}`
  return sorted.length <= 4 ? sorted.join(', ') : `${sorted.slice(0, 4).join(', ')} +${sorted.length - 4}`
}

/** The requests of `chat` for the step `id` (who and of as request.json keeps them; the who with or without the prefix). */
export const requestsOfStep = (assets, id, chat, prefix = '') => (Array.isArray(assets) ? assets : [])
  .filter(one => one !== null && typeof one === 'object' && one.of === id && (chat === null || chat === undefined || plain(one.who, prefix) === plain(chat, prefix)))

/**
 * The holder's standing wait for its requests: the open requests (waiting or running) of `chat` for the step it holds, or null.
 * `{ ids, provider, who ("Codex"), what ("Codex: A224-A227"), since (the oldest's asked time), link (the step's window) }`.
 * Only a step at work waits; a step that waits on a chat (`Waits on`) keeps that wait (the record the holder wrote wins).
 */
export function assetWaitOf(step, assets, { chat = null, prefix = '' } = {}) {
  if (step === null || step === undefined || !AT_WORK.includes(valueOf(step, 'State'))) return null
  const id = valueOf(step, 'Id')
  const open = requestsOfStep(assets, id, chat ?? valueOf(step, 'Owner'), prefix).filter(one => OPEN_ASSET_STATES.includes(one.state))
  if (open.length === 0) return null
  const provider = open[0].provider ?? null
  const who = providerTitle(provider)
  const ids = open.map(one => one.id)
  const times = open.map(one => one.times?.asked).filter(finite)
  const since = times.length === 0 ? sinceMs(valueOf(step, 'Since')) : Math.min(...times)
  return { ids, provider, who, what: `${who}: ${assetIdsWords(ids)}`, since: finite(since) ? since : null, link: `#details=${id}` }
}

/** The lane's suspension for an asset wait: P1's parked shape, kind asset, so every reader treats it as on purpose. */
export const assetSuspension = wait => (wait === null || wait === undefined ? null
  : { by: 'parked', kind: 'asset', on: [wait.who], what: wait.what, since: finite(wait.since) ? wait.since : null, limit: null, named: null, link: wait.link ?? null, ids: wait.ids })

/** Whether a lane's suspension is an asset wait (`assetSuspension`). */
export const isAssetWait = held => held?.by === 'parked' && held.kind === 'asset'

/** "waits for Codex: A224-A227 since 10:43": the words every reader uses for an asset wait. */
export function assetWaitWords(held) {
  const what = typeof held?.what === 'string' && held.what !== '' ? held.what : `${Array.isArray(held?.on) && typeof held.on[0] === 'string' ? held.on[0] : 'the provider'}: its pictures`
  return `waits for ${what}${finite(held?.since) ? ` since ${hourMinute(held.since)}` : ''}`
}

/**
 * The failure the lane shows instead of a silent Stopped: the newest request of `chat` for the step that failed within
 * `shownMs` while none of the step's requests is open any more: `{ id, why, at, text ("A224 failed: Codex took longer ...") }`,
 * or null. The holder's own progress after it (its checkpoint, a state change) ends it: the step's Since or Checkpoint after the failure.
 */
export function assetFailureOf(step, assets, { chat = null, prefix = '', now = Date.now(), shownMs = FAILED_SHOWN_MS, progressAt = null } = {}) {
  if (step === null || step === undefined || !AT_WORK.includes(valueOf(step, 'State'))) return null
  const mine = requestsOfStep(assets, valueOf(step, 'Id'), chat ?? valueOf(step, 'Owner'), prefix)
  if (mine.some(one => OPEN_ASSET_STATES.includes(one.state))) return null
  const failed = mine.filter(one => one.state === 'failed' && finite(one.times?.ended)).sort((a, b) => b.times.ended - a.times.ended)[0]
  if (failed === undefined || now - failed.times.ended > shownMs) return null
  if (finite(progressAt) && progressAt > failed.times.ended) return null
  const why = String(failed.why ?? '').replace(/\s+/g, ' ').trim()
  return { id: failed.id, why, at: failed.times.ended, text: `${failed.id} failed${why === '' ? '' : `: ${why}`}` }
}

/**
 * The Lates of an asset wait: a running request past the provider's time limit for a job (`jobMs`, plus a minute of grace) since it
 * started, or a waiting one past it since it was asked while nothing of its provider runs (a stuck queue). One per request, the
 * oldest first, each `{ chat, id (the step), who, what, since, minutes, asset, text ("Codex has not delivered A224 since 10:43") }`,
 * in the shape of P1's Late (waitsOn.mjs `lateWaitOf`) with `kind: 'asset'`. Never a give-back: the step stays with its holder.
 */
export function lateAssetsOf({ chat, step, assets, now = Date.now(), jobMs = DEFAULT_JOB_MS, prefix = '' }) {
  const wait = assetWaitOf(step, assets, { chat, prefix })
  if (wait === null) return []
  const limit = (finite(jobMs) && jobMs > 0 ? jobMs : DEFAULT_JOB_MS) + LATE_GRACE_MS
  const all = Array.isArray(assets) ? assets : []
  const running = new Set(all.filter(one => one?.state === 'running').map(one => one.provider))
  const open = requestsOfStep(assets, valueOf(step, 'Id'), chat, prefix).filter(one => OPEN_ASSET_STATES.includes(one.state))
  return open.map(one => {
    const from = one.state === 'running' ? one.times?.started : running.has(one.provider) ? null : one.times?.asked
    if (!finite(from) || now - from < limit) return null
    const minutes = Math.floor((now - from) / 60_000)
    return { chat, id: valueOf(step, 'Id'), who: wait.who, what: wait.what, since: from, minutes, asset: one.id, kind: 'asset', text: `${wait.who} has not delivered ${one.id} since ${hourMinute(from)}` }
  }).filter(one => one !== null).sort((a, b) => a.since - b.since)
}
