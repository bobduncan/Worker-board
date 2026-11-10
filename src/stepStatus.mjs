// P7 of the one wait system (chat 1's plan 2026-11-09, the person's "1 yes" of 2026-11-10 ~21:30): one status per step. The
// person saw three wrong signals ("something is not right"): the hand-out knew B1096 was held (its standard K6 Screens had no
// foundation), while the Goals/Focus part said "B1096 · waiting for a worker"; the Advisor card said "Your answers on B1030 wait
// for the Advisor" with nothing sent. Cause: every view worked a step's status out itself. Here is the one reading, and every
// view that shows a step's status takes it (the Focus parts' rework words, the Goals step rows, the Advisor card, the worker rows'
// task column, the details window, the backlog, the Supervisor's incident cards). It READS the hand-out's own answer (the ready
// list's `ready` and `held`, src/work/handOut.mjs `readyList`, with its hold reasons: outside the focus, a standard without its
// foundation, blocked by, waits for), the review's own (src/work/resultCheck.mjs `reviewWaitOf`), the Advisor's own (src/work/
// refineWait.mjs `refineWaitOf`) and P1's chat wait (src/work/waitsOn.mjs `waitsOnOf`); it adds no rule of its own. The guard test
// (test/stepStatus.test.mjs) lets only this file write the status phrases below. PURE.

import { refineStateOf } from './backlog.mjs'
import { valueOf, sinceMs } from './work/item.mjs'
import { isPartnerAskWord } from './work/partnerAnswers.mjs'
import { boardCheckPending, reportCheckFailedOf, reviewWaitOf } from './work/resultCheck.mjs'
import { isBlockWritten, refinedOfItem, refineWaitOf } from './work/refineWait.mjs'
import { idleWorkers } from './work/handOut.mjs'
import { waitsOnOf } from './work/waitsOn.mjs'
import { afterPause, isHolding } from './work/pause.mjs'

const MIN = 60_000

/** The phrases only this file writes (the guard test greps the source tree for them). */
export const WAITING_FOR_A_WORKER = 'waiting for a worker'
export const WAITS_FOR_THE_ADVISOR = 'waits for the Advisor'
export const NOBODY_ON_IT = 'Waiting, nobody on it now'
export const NOTHING_SENT = 'refine open: nothing sent to the Advisor'
export const NOT_ASKED = 'waits for its refine: nothing sent to the Advisor yet'
export const STATUS_PHRASES = Object.freeze(['waiting for a worker', 'wait for the Advisor', 'waits for the Advisor', 'nobody on it'])

/**
 * How long a refine word of the board counts as open after it was taken or delivered with no block written, as the state's
 * refine ask reads it (state.mjs `refineAsk`, REFINE_OPEN_MS, B868): past it the word is the Advisor's own list's
 * (`refineWaitOf`), or nobody's.
 */
const WORD_OPEN_MS = 30 * MIN

const bare = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length).trim() : words
}
const isRefineWord = message => message?.command === 'refine' || String(message?.syncKey ?? '').startsWith('refine-again ')

/**
 * The board's open word to the Advisor about step `id` (a refine, the person's answers sent with it, a refine asked again, a
 * question routed to the partner), or null: one the pause holds or that waits for its chat; one taken or delivered less than
 * WORD_OPEN_MS ago whose block is not written since; or the refine the Advisor's own list holds (`refineWaitOf`: arrived, not
 * written, not stopped).
 */
export function advisorWordOf(item, { items = new Map(), outbox = [], now = null, byAbout = null } = {}) {
  const id = valueOf(item, 'Id')
  // `byAbout` (stepStatusesOf's index of the outbox by `about`) holds the same words: every rule read here looks only at words about this step.
  const about = byAbout instanceof Map ? byAbout.get(id) ?? [] : (Array.isArray(outbox) ? outbox : []).filter(one => one?.about === id)
  const words = about.filter(one => isRefineWord(one) || isPartnerAskWord(one))
  if (words.length === 0) return null
  const listed = refineWaitOf(items, item, about)
  if (listed !== null) return listed.word
  const refined = refinedOfItem(items, item)
  const fresh = at => Number.isFinite(now) && Number.isFinite(at) && now - at < WORD_OPEN_MS
  return words.findLast(one => one.state === 'held' || one.state === 'waiting'
    || (one.state === 'taken' && fresh(one.takenAt ?? one.at))
    || (one.state === 'delivered' && fresh(one.deliveredAt ?? one.at) && !(isRefineWord(one) && isBlockWritten(refined, one)))) ?? null
}

const status = (kind, label, words, tone, extra = {}) => ({ id: null, kind, label, words, tone, who: null, why: null, since: null, link: null, ...extra })

/**
 * The one status of a step: `{ kind, label, words, tone, who, why, since, link }`, or null for an item that is no step.
 * `kind`: done, dropped, review, you, waits-on, working, given, held, ready, refined, refine. `label` the short badge
 * ("Held"), `words` the line after its id ("held: <the hand-out's why>"), `tone` the badge's colour key, `who` the chat on it or
 * waited for, `why` the record's own words, `since` (ms) when it began, `link` its window (`#details=B<n>`). A refine says
 * `toAdvisor` (a word to the Advisor about it is open in the outbox, `advisorWordOf`) and `held` (that word waits for Resume all).
 * `ctx`: `items` (the store's items by id), `held` and `ready` (the ready list's, state.mjs `readyList`; null without one),
 * `outbox` (the board's words), `now`, `workerOf(id)` (the worker whose card shows it, or null), `openChecks` (the steps a
 * Quality Assurance task is open on), `recaps` (recaps.mjs `recapWaitsOf`) and `prefix` (the chats' titles' start).
 */
export function stepStatusOf(step, ctx = {}) {
  if (step === null || step === undefined || (valueOf(step, 'Kind') ?? 'step') !== 'step') return null
  const { items = new Map(), held = null, ready = null, outbox = [], now = null, workerOf = () => null, openChecks = new Set(), recaps = null, prefix = '', byAbout = null } = ctx
  const id = valueOf(step, 'Id')
  const state = valueOf(step, 'State')
  const link = typeof id === 'string' ? `#details=${id}` : null
  const since = sinceMs(valueOf(step, 'Since'))
  const base = { id, link, since: Number.isFinite(since) ? since : null }
  const owner = valueOf(step, 'Owner') === null ? null : bare(valueOf(step, 'Owner'), prefix)
  switch (state) {
    case 'done': return status('done', 'Done', 'done', 'done', base)
    case 'dropped': return status('dropped', 'Dropped', 'dropped', 'quiet', base)
    case 'review': {
      const wait = reviewWaitOf(step, items, held, now, recaps)
      const checking = openChecks.has(id) || boardCheckPending(step) || reportCheckFailedOf(step) !== null || wait?.kind === 'check'
      return status('review', 'In review', checking ? 'being checked' : wait?.text ?? 'in review', 'review', { ...base, why: wait?.text ?? null, since: wait?.since ?? base.since, who: owner })
    }
    case 'waiting on you': return status('you', 'Needs you', 'waits on you', 'you', { ...base, who: owner })
    case 'taken':
    case 'in progress': {
      const wait = waitsOnOf(step)
      if (wait !== null) return status('waits-on', 'Waits', `waits for ${wait.who}: ${wait.what}`, 'working', { ...base, who: wait.who, why: wait.what, since: wait.since })
      const who = workerOf(id) ?? owner
      return status('working', 'Working', `${who ?? 'a worker'} is on it`, 'working', { ...base, who })
    }
    case 'queued': return status('given', 'Queued', owner === null ? 'given to a worker' : `given to ${owner}`, 'queued', { ...base, who: owner })
    case 'refined': {
      // The hand-out's own answer, never a guess: held with its why, or on its list.
      const hold = Array.isArray(held) ? held.find(one => one.id === id) : undefined
      if (hold !== undefined) return status('held', 'Held', `held: ${hold.why}`, 'held', { ...base, why: hold.why, choice: hold.choice === true })
      if (Array.isArray(ready) && ready.some(one => one.id === id)) return status('ready', 'Ready', WAITING_FOR_A_WORKER, 'ready', base)
      return status('refined', 'Ready', 'refined', 'ready', base)
    }
    case 'new': {
      // The Advisor card's line goes with it (`line`, `advisorLineOf`): "wait for the Advisor" only while a word to it is open.
      const withLine = one => ({ ...one, line: advisorLineOf(id, one) })
      const word = advisorWordOf(step, { items, outbox, now, byAbout })
      if (word !== null) {
        const isHeld = word.state === 'held'
        return withLine(status('refine', 'New', isHeld ? 'its word to the Advisor waits for Resume all' : WAITS_FOR_THE_ADVISOR, 'new', { ...base, toAdvisor: !isHeld, held: isHeld, since: word.at ?? base.since }))
      }
      const where = refineStateOf({ refined: refinedOfItem(items, step) })
      if (where === 'answers') return withLine(status('refine', 'New', 'its refine waits for your answers', 'new', { ...base, toAdvisor: false, held: false }))
      return withLine(status('refine', 'New', where === 'none' ? NOT_ASKED : NOTHING_SENT, 'new', { ...base, toAdvisor: false, held: false }))
    }
    default: return status(state ?? 'unknown', state ?? 'Unknown', state ?? 'unknown', 'quiet', base)
  }
}

/** Every step's status by id, `{ [id]: status }`, for the state (the page reads it and works out none itself). */
export function stepStatusesOf(items, ctx = {}) {
  const out = {}
  // The outbox by `about`, once (the live one holds thousands of words, the store a thousand steps).
  const byAbout = new Map()
  for (const one of Array.isArray(ctx.outbox) ? ctx.outbox : []) {
    if (typeof one?.about !== 'string') continue
    if (!byAbout.has(one.about)) byAbout.set(one.about, [])
    byAbout.get(one.about).push(one)
  }
  const shared = { ...ctx, items, byAbout }
  for (const [id, item] of items ?? new Map()) {
    const one = stepStatusOf(item, shared)
    if (one !== null) out[id] = one
  }
  return out
}

/** The words after an id on the Focus page's "Being reworked: B981 · <this>" (src/recapRound.mjs `reworkOf`). */
export const reworkWordsOf = (id, one) => `${id} · ${one?.words ?? 'unknown'}`

/**
 * The chip of a Focus block that waits (state.mjs `focusState`, state `waiting`): the first held step's hand-out reason
 * ("Held: B1096 · <why>"), else NOBODY_ON_IT.
 */
export function blockWaitWords(statuses) {
  const held = (statuses ?? []).find(one => one?.kind === 'held')
  return held === undefined ? NOBODY_ON_IT : `Held: ${held.id} · ${held.why}`
}

/** The Advisor card's line for a step whose refine answers are in (board.js `advisorRefine`): its status, never a guess. */
export const advisorLineOf = (id, one) => (one?.kind === 'refine' && one.toAdvisor === true ? `Your answers on ${id} wait for the Advisor` : `${id}: ${one?.words ?? NOTHING_SENT}`)

/** The words a supervisor rule writes of a refine the Advisor took and did not write (src/supervisor/rules/repair.mjs, refine-again). */
export const advisorWaitText = (id, rest) => `${id} ${WAITS_FOR_THE_ADVISOR} ${rest}`
export const advisorStillWaitText = (id, rest) => `${id} still ${WAITS_FOR_THE_ADVISOR} ${rest}`

// ---- the signal: the focus goal has work, none can be handed out ----

/** How long a worker is free, in the board's running minutes, before the signal goes to Main and the partner. */
export const FREE_SIGNAL_MINUTES = 10
const UNSTARTED = ['new', 'refined']

/** The goal and the goals under it in the goal map's nodes (`children`). */
function focusGoalsOf(focus, nodes) {
  const byId = new Map((nodes ?? []).map(one => [one.id, one]))
  const found = [focus]
  for (let at = 0; at < found.length && found.length < 200; at += 1) for (const child of byId.get(found[at])?.children ?? []) if (!found.includes(child)) found.push(child)
  return new Set(found)
}

/** The time the board was off (`gaps`, `[{ from, to }]`) between `from` and `now`, in ms. */
const offBetween = (gaps, from, now) => (gaps ?? []).reduce((sum, gap) => sum + Math.max(0, Math.min(gap.to, now) - Math.max(gap.from, from)), 0)

/**
 * The signal of P7 (never to the person): the focus goal has unstarted steps (new or refined), the hand-out's ready list is empty,
 * and a worker has been free (the hand-out's own `idleWorkers`) for FREE_SIGNAL_MINUTES of the board's running time (after the
 * person's pause, `afterPause`, and the board's off spells, `gaps`). `{ goal, worker, freeSince, minutes, causes: [{ key, id,
 * kind, words, text, link }], text, link }`, one cause per unstarted step with its status ("B1096 held: <why>"), or null.
 * A lane is free since its Workers mod's own report says so (`report.since`): the rule and the Overview count the same minutes.
 */
export function noneReadyOf({ items = new Map(), focus = null, goals = [], ready = null, held = null, lanes = [], pause = null, gaps = [], now, prefix = '', ...ctx }) {
  if (typeof focus !== 'string' || !Array.isArray(ready) || ready.length > 0 || !Number.isFinite(now) || isHolding(pause)) return null
  const inFocus = focusGoalsOf(focus, goals)
  const unstarted = [...items.values()].filter(item => (valueOf(item, 'Kind') ?? 'step') === 'step' && UNSTARTED.includes(valueOf(item, 'State')) && inFocus.has(valueOf(item, 'Goal')))
  if (unstarted.length === 0) return null
  const free = idleWorkers(lanes, { items, prefix }).map(lane => {
    const from = lane.report?.since ?? null
    if (!Number.isFinite(from)) return null
    const start = afterPause(pause, from)
    return { name: lane.name, from, runningMs: now - start - offBetween(gaps, start, now) }
  }).filter(one => one !== null && one.runningMs >= FREE_SIGNAL_MINUTES * MIN).sort((a, b) => b.runningMs - a.runningMs)
  if (free.length === 0) return null
  const byNumber = (a, b) => String(valueOf(a, 'Id')).localeCompare(String(valueOf(b, 'Id')), 'en', { numeric: true })
  const causes = unstarted.sort(byNumber).map(item => {
    const id = valueOf(item, 'Id')
    const one = stepStatusOf(item, { ...ctx, items, ready, held, now, prefix })
    const words = one.kind === 'held' ? `${id} held (${one.why})` : `${id} ${one.words}`
    return { key: `${id} ${one.kind} ${one.why ?? one.words}`, id, kind: one.kind, words, text: `focus goal ${focus} has work, none can be handed out: ${words}`, link: one.link }
  })
  const worker = free[0]
  return { goal: focus, worker: worker.name, freeSince: worker.from, minutes: Math.floor(worker.runningMs / MIN), causes, text: causes[0].text, link: causes[0].link }
}
