// The asset wait (the one wait system, chat 1's brief of 2026-11-11 under the person's "Yes, build now"; the person's choice of
// 2026-11-11: "A, Working"): a worker that asked the board for pictures (the work tool's `asset`, src/assets.mjs) and ends its turns
// while the provider draws them is not stuck, and its task is not stopped: Codex works on it. The live case of 2026-11-11 10:43:
// Worker 5 held B1124 and waited for Codex's A224-A227; between its turns the lane read Stopped (interrupted), the holder timers would
// have typed "go on" after 5 min and given the step back after 20 while Codex was still drawing, and the person asked "why has
// worker 5 stopped?". The wait is a record already: the holder's open requests for its held step (request.json: who, of, state
// waiting or running). Nothing is written for it: this module only reads those records.
//
// - An auto provider's open requests (Codex) are the task's WORK: the lane reads Working with the line "Codex draws 4 pictures for
//   it · 2 of 4 done · since 10:43" and one tick per picture, "death ✓ · attack ✓ · hit … · walk north …" (`assetWorkOf`), linked to
//   the step. Never "Worker 5 is on it": the chat runs no turn, Codex does the work (state.mjs `card`, chatReport.mjs `laneFromReport`
//   why 'asset', as a wait for the partner is).
// - A person provider's open request (mode person: the person drops the file) is the person's: the lane is parked, P1's shape with kind
//   asset, "waits for your file (A230)" (`assetSuspension`). A pick request (mode pick) is the chat's own job (it names the sound with
//   `work asset ... picked`), so it is no wait at all: the timers run as for any stopped holder.
// - Either way the holder timers stay off (holderTimers.mjs), Resume all leaves the holder (pause.mjs `isResumed`), and the wait ends
//   by itself when the last request is ready or failed; a failed one shows its failure on the lane ("A227 failed: ..."); the minutes
//   the provider spent count as the holder's progress (`assetProgressAt`), so the step is not given back the moment the wait ends.
// - A failure on the provider's usage limit with a known reset (src/work/providerLimit.mjs) keeps the request waiting: the lane reads
//   "Working · Codex is at its usage limit until 13:23; then it draws 5 pictures for it"; the Late counts from the reset.
// - Past the provider's time limit for a job (`jobMs`, the Design tab's seconds) a request turns one Late on the person's list,
//   "Codex has not delivered hit since 10:43", never a give-back (`lateAssetsOf`). Not in it: the queue's own logic
//   (src/assetQueue.mjs), the providers, the wake.

import { PROVIDERS } from '../providers/index.mjs'
import { sinceMs, valueOf } from './item.mjs'
import { hourMinute } from './waitsOn.mjs'
import { waitsForLimit } from './providerLimit.mjs'

/** A background-only lane (no turn since) whose asset requests are all final reads "no news" past this much of the board's running time. */
export const NO_NEWS_MS = 30 * 60_000
/** And needs a look past this much. */
export const NO_NEWS_ATTENTION_MS = 60 * 60_000

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
/** A round: requests asked within this long of one another belong to it (A224-A227 came within a minute; a redo an hour later is its own). */
export const ROUND_GAP_MS = 5 * 60_000
/** The modes whose open request the holder waits for: an auto provider draws, a person drops the file; a pick is the chat's own job. */
const WAITED_MODES = ['auto', 'person']
/** Words beside an id in a checkpoint that are no picture's name: states, connectives, verbs of waiting. */
const NOT_A_NAME = new Set(['and', 'to', 'the', 'a', 'an', 'for', 'from', 'with', 'of', 'on', 'in', 'is', 'are', 'was', 'were', 'it', 'its', 'them', 'then', 'that', 'this',
  'ready', 'running', 'waiting', 'failed', 'done', 'asked', 'open', 'wait', 'waits', 'came', 'back', 'comes', 'come', 'made', 'make', 'makes', 'redo', 'again', 'now', 'next', 'picture', 'pictures', 'sheet', 'sheets', 'version'])
/** The marks of a picture in the ticks line. */
const MARKS = Object.freeze({ ready: '✓', failed: '✗', running: '…', waiting: '…' })

const plain = (name, prefix = '') => String(name ?? '').replace(prefix, '').trim().toLowerCase()
const numberOf = id => Number(String(id).slice(1))
const finite = value => Number.isFinite(value)
const isRecord = one => one !== null && typeof one === 'object' && typeof one.id === 'string'
const isOpen = one => OPEN_ASSET_STATES.includes(one.state)
/** Whether the holder waits for this request: open, and of a mode that is not the chat's own job. */
const isWaited = one => isOpen(one) && WAITED_MODES.includes(one.mode ?? 'auto')
const byId = (a, b) => numberOf(a.id) - numberOf(b.id)

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

/** The requests of `chat` for the step `id`, oldest id first (who as request.json keeps it, with or without the prefix); none without a chat. */
export function requestsOfStep(assets, id, chat, prefix = '') {
  if (typeof chat !== 'string' || chat.trim() === '' || typeof id !== 'string') return []
  return (Array.isArray(assets) ? assets : []).filter(one => isRecord(one) && one.of === id && plain(one.who, prefix) === plain(chat, prefix)).sort(byId)
}

/**
 * The name of a picture, for the ticks and the Late: the words the holder gave it beside its id in the step's Checkpoint or Plan
 * ("A224 death, A225 attack, A226 hit, A227 walk north" → "death", "walk north"), else the capitalised words of the request's text
 * ("the Knight's DEATH animation" → "death"), else its id.
 */
export function pieceNameOf(record, step) {
  const id = record.id
  const fields = ['Checkpoint', 'Plan'].map(key => valueOf(step, key)).filter(value => typeof value === 'string')
  for (const text of fields) {
    // The list form "A224 death, A225 attack": the id (not a range's start, not another id's start), then one to three lower-case words up
    // to a comma, a stop, a separator or the end; words that are no name ("ready", "and wait for them") are cut, and nothing is left of them.
    const hit = new RegExp(`(?:^|[\\s,;:(])${id}(?![\\d-])[\\s:·]*([a-z]+(?: [a-z]+){0,2})(?=[\\s,;·.)]|$)`).exec(text)
    if (hit === null) continue
    const words = hit[1].split(' ')
    while (words.length > 0 && NOT_A_NAME.has(words[0])) words.shift()
    const stop = words.findIndex(word => NOT_A_NAME.has(word))
    const kept = stop === -1 ? words : words.slice(0, stop)
    if (kept.length > 0) return kept.join(' ')
  }
  const caps = /\b([A-Z]{3,}(?: [A-Z]{3,})*)\b/.exec(String(record.text ?? '').replace(/#[0-9A-F]{6}/g, ''))
  return caps === null ? id : caps[1].toLowerCase()
}

/**
 * The round the holder waits for: its open auto requests for the step with the ones of the same batch that ended already: walking back
 * from the oldest open one, a request belongs to the round while it was asked within `ROUND_GAP_MS` of the next (A224-A227 came within
 * a minute; round 1, delivered at 10:58, is not the round of a redo asked at 10:55 when the gap before it is over five minutes). Oldest id
 * first. None while nothing is open.
 */
function roundOf(step, assets, { chat, prefix = '' }) {
  const mine = requestsOfStep(assets, valueOf(step, 'Id'), chat, prefix).filter(one => (one.mode ?? 'auto') === 'auto')
  const open = mine.filter(isOpen)
  if (open.length === 0) return []
  const oldest = Math.min(...open.map(one => one.times?.asked).filter(finite), Infinity)
  if (!finite(oldest)) return mine.filter(isOpen)
  const byAsked = mine.filter(one => finite(one.times?.asked)).sort((a, b) => a.times.asked - b.times.asked)
  let from = oldest
  for (let i = byAsked.findIndex(one => one.times.asked >= oldest) - 1; i >= 0 && from - byAsked[i].times.asked <= ROUND_GAP_MS; i--) from = byAsked[i].times.asked
  return mine.filter(one => isOpen(one) || !finite(one.times?.asked) || one.times.asked >= from)
}

/**
 * The holder's open requests for the step it holds that it waits for (an auto provider's or a person's; a pick is its own job): `{ ids,
 * open, provider, mode, who, since, link }`, or null. `mode` is auto while any auto request is open (the provider draws: the lane works),
 * else person (the lane is parked for the person's file). Only a step at work waits (the holder's own name, `chat`, is needed: a step
 * without an owner waits for nobody). The timers and Resume all read this; the lane reads `assetWorkOf` or `assetSuspension`.
 */
export function assetWaitOf(step, assets, { chat = null, prefix = '' } = {}) {
  if (step === null || step === undefined || !AT_WORK.includes(valueOf(step, 'State'))) return null
  const who = chat ?? valueOf(step, 'Owner')
  const all = requestsOfStep(assets, valueOf(step, 'Id'), who, prefix).filter(isWaited)
  if (all.length === 0) return null
  const auto = all.filter(one => (one.mode ?? 'auto') === 'auto')
  const open = auto.length > 0 ? auto : all
  const provider = open[0].provider ?? null
  const times = open.map(one => one.times?.asked).filter(finite)
  const since = times.length === 0 ? sinceMs(valueOf(step, 'Since')) : Math.min(...times)
  return { ids: open.map(one => one.id), open, provider, mode: auto.length > 0 ? 'auto' : 'person', who: providerTitle(provider), since: finite(since) ? since : null, link: `#details=${valueOf(step, 'Id')}` }
}

/**
 * An auto provider's work on the step (the person's "A, Working"): the round's pictures with their marks and the words every reader
 * uses, or null (nothing open, or the open requests are the person's or a pick's). `{ who, provider, ids, pieces: [{ id, name, state,
 * mark }], total, done, failed, since, link, words: "Codex draws 4 pictures for it · 2 of 4 done · since 10:43", ticks: "death ✓ ·
 * attack ✓ · hit … · walk north …", between: the lane's between-turns text }`.
 */
export function assetWorkOf(step, assets, { chat = null, prefix = '', now = Date.now() } = {}) {
  const wait = assetWaitOf(step, assets, { chat, prefix })
  if (wait === null || wait.mode !== 'auto') return null
  const round = roundOf(step, assets, { chat: chat ?? valueOf(step, 'Owner'), prefix })
  const pieces = round.map(one => ({ id: one.id, name: pieceNameOf(one, step), state: one.state, mark: MARKS[one.state] ?? '…' }))
  const done = pieces.filter(one => one.state === 'ready').length
  const failed = pieces.filter(one => one.state === 'failed').length
  const total = pieces.length
  const times = round.map(one => one.times?.asked).filter(finite)
  const since = times.length === 0 ? wait.since : Math.min(...times)
  const count = total === 1 ? '1 picture' : `${total} pictures`
  const progress = `${done} of ${total} done${failed > 0 ? `, ${failed} failed` : ''}`
  // The asset-limit wait (2026-11-11, B1125): the provider is at its usage limit; the board runs the requests again at the reset.
  const limited = round.filter(one => waitsForLimit(one, now)).map(one => one.limit.until)
  const until = limited.length === 0 ? null : Math.max(...limited)
  const left = pieces.filter(one => one.state === 'waiting' || one.state === 'running').length
  const words = until !== null
    ? `${wait.who} is at its usage limit until ${hourMinute(until)}; then it draws ${left === 1 ? '1 picture' : `${left} pictures`} for it${done > 0 || failed > 0 ? ` (${progress})` : ''}`
    : `${wait.who} draws ${count} for it · ${progress}${finite(since) ? ` · since ${hourMinute(since)}` : ''}`
  return {
    who: wait.who, provider: wait.provider, ids: round.map(one => one.id), pieces, total, done, failed, since: finite(since) ? since : null, link: wait.link, words, limitUntil: until,
    ticks: pieces.map(one => `${one.name} ${one.mark}`).join(' · '),
    between: `Its turn has ended; ${wait.who} draws its pictures (${assetIdsWords(round.map(one => one.id))}).`,
  }
}

/** The lane's suspension for a wait on the person's own file (a person provider, mode person): P1's parked shape, kind asset. */
export const assetSuspension = wait => (wait === null || wait === undefined || wait.mode === 'auto' ? null
  : { by: 'parked', kind: 'asset', on: ['you'], what: `your file (${assetIdsWords(wait.ids)})`, since: finite(wait.since) ? wait.since : null, limit: null, named: null, link: wait.link ?? null, ids: wait.ids })

/** Whether a lane's suspension is a wait for the person's file (`assetSuspension`). */
export const isAssetWait = held => held?.by === 'parked' && held.kind === 'asset'

/** "waits for your file (A230) since 10:43": the words every reader uses for a parked asset wait. */
export function assetWaitWords(held) {
  const what = typeof held?.what === 'string' && held.what !== '' ? held.what : 'your file'
  return `waits for ${what}${finite(held?.since) ? ` since ${hourMinute(held.since)}` : ''}`
}

/**
 * The provider's work as the holder's progress (holderTimers.mjs): the newest time a request of the holder for the step was asked,
 * started or ended, or null. The minutes Codex drew are no stopped spell of the worker: without this the step would be given back
 * the moment the last picture came, before the woken chat could report busy (the review of 2026-11-11, finding 1).
 */
export function assetProgressAt(step, assets, { chat = null, prefix = '' } = {}) {
  if (step === null || step === undefined) return null
  const mine = requestsOfStep(assets, valueOf(step, 'Id'), chat ?? valueOf(step, 'Owner'), prefix).filter(one => WAITED_MODES.includes(one.mode ?? 'auto'))
  const times = mine.flatMap(one => [one.times?.asked, one.times?.started, one.times?.ended]).filter(finite)
  return times.length === 0 ? null : Math.max(...times)
}

/**
 * The failure the lane shows instead of a silent Stopped: the newest request of `chat` for the step that failed within `shownMs`
 * while none of the step's requests is open any more: `{ id, name, why, at, text ("A227 failed: Codex took longer ...") }`, or null.
 * The holder's own progress after it ends it (`progressAt`: its checkpoint, a state change, a turn begun).
 */
export function assetFailureOf(step, assets, { chat = null, prefix = '', now = Date.now(), shownMs = FAILED_SHOWN_MS, progressAt = null } = {}) {
  if (step === null || step === undefined || !AT_WORK.includes(valueOf(step, 'State'))) return null
  const mine = requestsOfStep(assets, valueOf(step, 'Id'), chat ?? valueOf(step, 'Owner'), prefix).filter(one => WAITED_MODES.includes(one.mode ?? 'auto'))
  if (mine.some(isOpen)) return null
  const failed = mine.filter(one => one.state === 'failed' && finite(one.times?.ended)).sort((a, b) => b.times.ended - a.times.ended)[0]
  if (failed === undefined || now - failed.times.ended > shownMs) return null
  if (finite(progressAt) && progressAt > failed.times.ended) return null
  const why = String(failed.why ?? '').replace(/\s+/g, ' ').trim()
  return { id: failed.id, name: pieceNameOf(failed, step), why, at: failed.times.ended, text: `${failed.id} failed${why === '' ? '' : `: ${why}`}` }
}

/**
 * The asset-stop rerun (2026-11-11, the live A245): a lane whose turn ended with background work running (`heldBy` background, the
 * mod's report) and that has run no turn since `since`, while its steps' asset requests are all final (a word about the last one
 * never came, or the chat missed it): `{ since, minutes, attention }` once `runningMs(since)` is past `NO_NEWS_MS`, attention past
 * `NO_NEWS_ATTENTION_MS`; else null. The lane then reads "background task since 13:50, no news" instead of a bare "Working ·
 * background" for hours. Nothing without a request (an ordinary background task), nothing while a request is open (the asset work).
 */
export function backgroundNoNewsOf({ lane, steps = [], assets = [], runningMs, prefix = '' }) {
  if (lane?.state !== 'working' || lane.heldBy !== 'background' || !finite(lane.report?.since) || typeof runningMs !== 'function') return null
  const mine = steps.flatMap(step => requestsOfStep(assets, valueOf(step, 'Id'), lane.name, prefix))
  if (mine.length === 0 || mine.some(isOpen)) return null
  const ran = runningMs(lane.report.since)
  if (!(ran >= NO_NEWS_MS)) return null
  return { since: lane.report.since, minutes: Math.floor(ran / 60_000), attention: ran >= NO_NEWS_ATTENTION_MS, words: `background task since ${hourMinute(lane.report.since)}, no news` }
}

/**
 * The Lates of an auto provider's work: a running request past the provider's time limit for a job (`jobMs`, plus a minute of grace)
 * since it started, or a waiting one past it while nothing of its provider runs (a stuck queue), counted from the newest end of that
 * provider's jobs (the hand-off between two jobs is no wait: the review's finding 4). A person's or a pick's request is the person's,
 * never late here. One per request, the oldest first, each `{ chat, id (the step), who, what, since, minutes, asset, name, kind:
 * 'asset', text ("Codex has not delivered hit since 10:43") }`, in the shape of P1's Late. Never a give-back: the step stays with its holder.
 */
export function lateAssetsOf({ chat, step, assets, now = Date.now(), jobMs = DEFAULT_JOB_MS, prefix = '' }) {
  const wait = assetWaitOf(step, assets, { chat, prefix })
  if (wait === null) return []
  const limit = (finite(jobMs) && jobMs > 0 ? jobMs : DEFAULT_JOB_MS) + LATE_GRACE_MS
  const all = (Array.isArray(assets) ? assets : []).filter(isRecord)
  const running = new Set(all.filter(one => one.state === 'running').map(one => one.provider))
  const endedOf = provider => Math.max(-Infinity, ...all.filter(one => one.provider === provider && finite(one.times?.ended)).map(one => one.times.ended))
  return wait.open.filter(one => (one.mode ?? 'auto') === 'auto').map(one => {
    // The asset-limit wait: a request waiting for the provider's reset is late only past the reset and the job's own limit.
    const from = one.state === 'running' ? (finite(one.times?.started) ? one.times.started : one.times?.asked)
      : finite(one.limit?.until) && one.limit.until > now ? one.limit.until
      : running.has(one.provider) ? null : Math.max(...[one.times?.asked, endedOf(one.provider), finite(one.limit?.until) ? one.limit.until : null].filter(finite), -Infinity)
    if (!finite(from) || now - from < limit) return null
    const minutes = Math.floor((now - from) / 60_000)
    const name = pieceNameOf(one, step)
    return { chat, id: valueOf(step, 'Id'), who: wait.who, what: `${wait.who}: ${assetIdsWords(wait.ids)}`, since: from, minutes, asset: one.id, name, kind: 'asset', text: `${wait.who} has not delivered ${name} since ${hourMinute(from)}` }
  }).filter(one => one !== null).sort((a, b) => a.since - b.since)
}
