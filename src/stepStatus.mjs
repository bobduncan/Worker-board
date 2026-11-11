// P7 of the one wait system (chat 1's plan 2026-11-09, the person's "1 yes" of 2026-11-10 ~21:30): one status per step. The
// person saw three wrong signals ("something is not right"): the hand-out knew B1096 was held (its standard K6 Screens had no
// foundation), while the Goals/Focus part said "B1096 · waiting for a worker"; the Advisor card said "Your answers on B1030 wait
// for the Advisor" with nothing sent. Cause: every view worked a step's status out itself. Here is the one reading, and every
// view that shows a step's status takes it (the Focus parts' chips, steps and rework words, the recap popup, the Goals step rows,
// the Advisor card, the worker rows' task column, the details window, the backlog, the Supervisor's incident cards, the
// brainstorm's new tasks, the Bugs tab). It READS the hand-out's own answer (the ready list's `ready` and `held`,
// src/work/handOut.mjs `readyList`, with its hold reasons: outside the focus, a standard without its foundation, blocked by,
// waits for), the review's own (src/work/resultCheck.mjs `reviewWaitOf`), the refine gate's own (src/work/askOpen.mjs
// `refineAsk`, src/refineGate.mjs `refineStop`), the Advisor's own (src/work/refineWait.mjs `refineWaitOf`), the partner's
// (src/work/partnerAnswers.mjs `stepWaitsForPartner`) and P1's chat wait (src/work/waitsOn.mjs `waitsOnOf`); it adds no rule of
// its own. The guard test (test/stepStatus.test.mjs) lets only this file write the status phrases below. PURE.

import { refineStateOf } from './backlog.mjs'
import { sinceClock } from './chatStatus.mjs'
import { refineStop } from './refineGate.mjs'
import { refineAsk } from './work/askOpen.mjs'
import { valueOf, sinceMs } from './work/item.mjs'
import { isPartnerAskWord, isRoutedToPartner, stepWaitsForPartner } from './work/partnerAnswers.mjs'
import { boardCheckPending, reportCheckFailedOf, reviewWaitOf } from './work/resultCheck.mjs'
import { refinedOfItem, refineWaitOf } from './work/refineWait.mjs'
import { idleWorkers } from './work/handOut.mjs'
import { keptRecapWaitOf, recapWaitWords, waitsOnOf } from './work/waitsOn.mjs'
import { assetWaitOf } from './work/assetWait.mjs'
import { afterPause, isHolding } from './work/pause.mjs'
import { heldFrom, isHeld } from './work/askHold.mjs'

const MIN = 60_000

/** The phrases only this file writes (the guard test reads every string of the source tree for them). */
export const WAITING_FOR_A_WORKER = 'waiting for a worker'
export const WAITS_FOR_THE_ADVISOR = 'waits for the Advisor'
export const NOBODY_ON_IT = 'Waiting, nobody on it now'
/** A refine with no word of the board to the Advisor in flight (the review: B1030 had three words, all delivered on 4 Nov). */
export const NO_WORD = 'refine open: no word in flight'
export const NOT_ASKED = 'waits for its refine: nothing sent to the Advisor yet'
/** The Focus chip of a block whose refined step is on the hand-out's list. */
export const ON_THE_LIST = 'On the list for a worker'
export const STATUS_PHRASES = Object.freeze(['waiting for a worker', 'wait for the Advisor', 'waits for the Advisor', 'nobody on it', 'for a worker', 'being refined', 'is on it', 'on it', 'Refining', 'waits for your recap'])

const bare = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length).trim() : words
}
const isRefineAgain = message => String(message?.syncKey ?? '').startsWith('refine-again ')
const isRefineWord = message => message?.command === 'refine' || isRefineAgain(message)
/** The round a word asked for: its own, or the "Round: <n>" of a refine asked again (repair.mjs refine-again). */
const roundOf = message => (Number.isInteger(message.round) ? message.round : Number(/\bRound: (\d+)/.exec(String(message.text ?? ''))?.[1] ?? 1))
/** A word the pause holds: kept on the board (`held`), or waiting while the person pauses (state.mjs marks it `isHeld`). */
const isHeldWord = message => message.state === 'held' || (message.state === 'waiting' && message.isHeld === true)

/** The open asks of step `id`, from `ctx.asksOf` (stepStatusesOf's index) or the store. */
function asksOfStep(id, items, asksOf) {
  if (asksOf instanceof Map) return asksOf.get(id) ?? []
  return [...(items?.values?.() ?? [])].filter(item => valueOf(item, 'Kind') === 'ask' && valueOf(item, 'Of') === id)
}

/** The board's words about step `id`: its refines, its refines asked again, and the partner's words about its asks. */
function wordsAbout(id, { outbox = [], byAbout = null, asks = [] }) {
  const of = key => (byAbout instanceof Map ? byAbout.get(key) ?? [] : (Array.isArray(outbox) ? outbox : []).filter(one => one?.about === key))
  const own = of(id).filter(isRefineWord)
  const partner = asks.flatMap(ask => of(valueOf(ask, 'Id'))).filter(isPartnerAskWord)
  return [...own, ...partner].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
}

/**
 * The board's open word to the Advisor about step `item` (a refine, the person's answers sent with it, a refine asked again, a
 * question of it routed to the partner), or null: one the pause holds; the refine the Advisor's own list holds (`refineWaitOf`);
 * or one the refine gate counts open (`refineAsk`: on its way, or arrived less than its half hour ago with no block written since;
 * a word taken or waiting that long is stale). `outbox` in the one shape (store.mjs `outboxKnown`: what waited too long is expired).
 */
export function advisorWordOf(item, { items = new Map(), outbox = [], now = null, byAbout = null, asksOf = null } = {}) {
  const id = valueOf(item, 'Id')
  const asks = asksOfStep(id, items, asksOf)
  const words = wordsAbout(id, { outbox, byAbout, asks })
  if (words.length === 0) return null
  const held = words.findLast(isHeldWord)
  if (held !== undefined) return held
  const own = words.filter(isRefineWord)
  const listed = refineWaitOf(items, item, own)
  if (listed !== null) return listed.word
  if (!Number.isFinite(now)) return null
  // The refine gate's own reading: its refine words with the step's block, the others (asked again, a routed question) as words on their way.
  const refined = refinedOfItem(items, item)
  const asRefine = list => list.map(one => ({ ...one, command: 'refine', about: id, round: roundOf(one) }))
  const refines = own.filter(one => one.command === 'refine')
  if (refineAsk({ id, status: null, refined }, refines, now)?.isOpen === true) return refines.at(-1)
  const again = own.filter(isRefineAgain)
  if (refineAsk({ id, status: null, refined }, asRefine(again), now)?.isOpen === true) return again.at(-1)
  const partner = words.filter(isPartnerAskWord)
  if (refineAsk({ id, status: null, refined: null }, asRefine(partner), now)?.isOpen === true) return partner.at(-1)
  return null
}

const status = (kind, label, words, tone, extra = {}) => ({ id: null, kind, label, words, tone, who: null, why: null, since: null, link: null, ...extra })

/** A step whose open ask is held for the person's words (rule 15): "waits for Worker 3's re-check of Q711 (your words at 14:05)", linked to the ask. */
function heldAskStatus(asks, stepOwner, prefix, base) {
  const first = asks[0]
  const ids = asks.map(ask => valueOf(ask, 'Id'))
  const askerName = valueOf(first, 'Owner') ?? stepOwner
  const asker = askerName === null ? 'its asking chat' : bare(askerName, prefix)
  const minute = heldFrom(first)?.minute
  const words = `waits for ${asker}'s re-check of ${ids.join(', ')}${minute === undefined ? '' : ` (your words at ${minute})`}`
  return status('held-ask', 'Re-check', words, 'quiet', { ...base, who: asker, why: ids.join(', '), link: `#details=${ids[0]}` })
}

/** The states in which a step is at work, the only ones whose blocking asks can wait for the partner (partnerAnswers.mjs). */
const AT_WORK = ['taken', 'in progress', 'waiting on you']

// The recap wait (the person's "1 yes", 2026-11-11, the live B1094 and Q715) lives with P1's waits (work/waitsOn.mjs), so the
// resume's selection (work/pause.mjs) reads the same rule; said here as before.
export { keptRecapWaitOf, recapWaitWords }

/**
 * The one status of a step: `{ kind, label, words, tone, who, why, since, link }`, or null for an item that is no step.
 * `kind`: done, dropped, review, you, partner, waits-on, working, given, held, ready, refined, refine. `label` the short badge
 * ("Held"), `words` the line after its id ("held: <the hand-out's why>"), `tone` the badge's colour key, `who` the chat on it or
 * waited for, `why` the record's own words, `since` (ms) when it began, `link` its window (`#details=B<n>`). A refine says
 * `toAdvisor` (a word to the Advisor about it is in flight, `advisorWordOf`), `held` (that word waits for Resume all) and `where`
 * (asked, answers, partner, stopped, none, open). `ctx`: `items` (the store's items by id), `held` and `ready` (the ready list's,
 * state.mjs `readyList`; null without one), `outbox` (the board's words in the one shape, store.mjs `outboxKnown`), `now`,
 * `workerOf(id)` (the worker whose card shows it, or null), `openChecks` (the steps a Quality Assurance task is open on), `recaps`
 * (recaps.mjs `recapWaitsOf`) and `prefix` (the chats' titles' start).
 */
export function stepStatusOf(step, ctx = {}) {
  if (step === null || step === undefined || (valueOf(step, 'Kind') ?? 'step') !== 'step') return null
  const { items = new Map(), held = null, ready = null, outbox = [], now = null, workerOf = () => null, openChecks = new Set(), recaps = null, prefix = '', byAbout = null, asksOf = null, assets = [] } = ctx
  const id = valueOf(step, 'Id')
  const state = valueOf(step, 'State')
  const link = typeof id === 'string' ? `#details=${id}` : null
  const since = sinceMs(valueOf(step, 'Since'))
  const base = { id, link, since: Number.isFinite(since) ? since : null }
  const owner = valueOf(step, 'Owner') === null ? null : bare(valueOf(step, 'Owner'), prefix)
  // B392: a step at work whose open blocking asks all wait for the partner waits for the partner, not for the person.
  // Rule 15 (P6): an ask held for the person's words asks nobody and blocks nobody (askHold.mjs `isHeld`), so it is left out here too.
  const allAsks = AT_WORK.includes(state) ? asksOfStep(id, items, asksOf) : []
  const heldAsks = allAsks.filter(ask => valueOf(ask, 'State') === 'open' && isHeld(ask))
  const partnerWait = AT_WORK.includes(state) ? stepWaitsForPartner(step, allAsks.filter(ask => !isHeld(ask))) : null
  const recapWait = AT_WORK.includes(state) ? keptRecapWaitOf(step, allAsks) : null
  const forRecap = () => status('recap', 'Waits for your recap', recapWait.words, 'quiet', { ...base, who: owner, why: recapWait.ids.join(', '), link: recapWait.link })
  const forPartner = () => status('partner', 'Waits for your partner', `waits for your partner: ${partnerWait.join(', ')}`, 'partner', { ...base, who: owner, why: partnerWait.join(', ') })
  switch (state) {
    case 'done': return status('done', 'Done', 'done', 'done', base)
    case 'dropped': return status('dropped', 'Dropped', 'dropped', 'quiet', base)
    case 'review': {
      const wait = reviewWaitOf(step, items, held, now, recaps)
      // A failed report check says the review's own words ("waits for Worker 4 to report again: ..."), never "being checked".
      if (wait?.kind === 'report') return status('review', 'In review', wait.text, 'review', { ...base, why: wait.text, since: wait.since ?? base.since, who: owner })
      const checking = openChecks.has(id) || boardCheckPending(step) || reportCheckFailedOf(step) !== null || wait?.kind === 'check'
      return status('review', 'In review', checking ? 'being checked' : wait?.text ?? 'in review', 'review', { ...base, why: wait?.text ?? null, since: wait?.since ?? base.since, who: owner })
    }
    case 'waiting on you': {
      if (partnerWait !== null) return forPartner()
      if (recapWait !== null) return forRecap()
      // Every open blocking ask is held: the step waits for the asking chat's re-check, not for the person (quiet, never "you").
      const blocking = allAsks.some(ask => valueOf(ask, 'State') === 'open' && valueOf(ask, 'Blocking') === 'yes' && !isHeld(ask))
      if (heldAsks.length > 0 && !blocking) return heldAskStatus(heldAsks, owner, prefix, base)
      return status('you', 'Needs you', 'waits on you', 'you', { ...base, who: owner })
    }
    case 'taken':
    case 'in progress': {
      const wait = waitsOnOf(step)
      if (wait !== null) return status('waits-on', 'Waits', `waits for ${wait.who}: ${wait.what}`, 'working', { ...base, who: wait.who, why: wait.what, since: wait.since })
      // The asset wait (2026-11-11, the B1124 case): the holder's open asset requests for the step (work/assetWait.mjs): quiet, linked to the step.
      const assetWait = assetWaitOf(step, assets, { chat: owner, prefix })
      if (assetWait !== null) return status('asset', `Waits for ${assetWait.who}`, `waits for ${assetWait.what}`, 'quiet', { ...base, who: owner, why: assetWait.ids.join(', '), since: assetWait.since ?? base.since, link: assetWait.link })
      if (partnerWait !== null) return forPartner()
      if (recapWait !== null) return forRecap()
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
      // The Advisor card's line goes with it (`line`, `advisorLineOf`): "wait for the Advisor" only while a word to it is in flight.
      const withLine = one => ({ ...one, line: advisorLineOf(id, one) })
      const refine = (words, where, extra = {}) => withLine(status('refine', 'New', words, 'new', { ...base, toAdvisor: false, held: false, where, ...extra }))
      const word = advisorWordOf(step, { items, outbox, now, byAbout, asksOf })
      if (word !== null) {
        const isHeld = isHeldWord(word)
        // The Advisor card's "Refining B1030, round 3" (the word arrived: in its hand) or "B1030 to refine, on its way", from this word.
        const inHand = !isHeld && word.state === 'delivered'
        const round = roundOf(word)
        const refining = isHeld ? null : inHand ? `Refining ${id}${round > 1 ? `, round ${round}` : ''}` : `${id} to refine, on its way`
        return refine(isHeld ? 'its word to the Advisor waits for Resume all' : WAITS_FOR_THE_ADVISOR, 'asked', { toAdvisor: !isHeld, held: isHeld, since: word.at ?? base.since, inHand, refining })
      }
      const asks = asksOfStep(id, items, asksOf).filter(ask => valueOf(ask, 'State') === 'open')
      // A refine question routed to the partner (Route: partner) waits for the partner's answer, not for the person's.
      if (asks.length > 0 && asks.every(isRoutedToPartner)) {
        const ids = asks.map(ask => valueOf(ask, 'Id'))
        return withLine(status('partner', 'Waits for your partner', `waits for your partner: ${ids.join(', ')}`, 'partner', { ...base, why: ids.join(', '), toAdvisor: false, held: false, where: 'partner' }))
      }
      const where = refineStateOf({ refined: refinedOfItem(items, step) })
      if (where === 'answers') return refine('its refine waits for your answers', 'answers')
      const about = wordsAbout(id, { outbox, byAbout, asks: [] })
      // B312: the board's own rounds reached their cap without a new answer since: the refine gate stopped on it.
      const last = about.at(-1)
      const lastSent = last === undefined || !Number.isFinite(last.at) || !Number.isFinite(now) ? '' : ` (last sent ${sinceClock(last.at, now)})`
      const stop = refineStop({ id, item: { history: step.sections?.get('History') ?? [] } }, about.filter(one => one.command === 'refine'))
      if (stop !== null) return refine(`its refine stopped after ${stop.rounds} round${stop.rounds === 1 ? '' : 's'}: no word in flight${lastSent}`, 'stopped', { lastSent: last?.at ?? null })
      if (last === undefined && where === 'none') return refine(NOT_ASKED, 'none')
      return refine(`${NO_WORD}${lastSent}`, 'open', { lastSent: last?.at ?? null })
    }
    default: return status(state ?? 'unknown', state ?? 'Unknown', state ?? 'unknown', 'quiet', base)
  }
}

/** The states the state's `stepStatus` leaves out (the review: 1,079 of them made 98% of its 164 KB): a view reads their state. */
const LEFT_OUT = ['done', 'dropped']

/**
 * Every open step's status by id, `{ [id]: status }`, for the state (the page reads it and works out none itself). Done and
 * dropped steps are left out: every view that reads it falls back to the step's own state for an id it lacks.
 */
export function stepStatusesOf(items, ctx = {}) {
  const out = {}
  // The outbox by `about`, and the asks by the step they are of, once (the live outbox holds thousands of words, the store a
  // thousand steps).
  const byAbout = new Map()
  for (const one of Array.isArray(ctx.outbox) ? ctx.outbox : []) {
    if (typeof one?.about !== 'string') continue
    if (!byAbout.has(one.about)) byAbout.set(one.about, [])
    byAbout.get(one.about).push(one)
  }
  const asksOf = new Map()
  for (const item of items?.values?.() ?? []) {
    if (valueOf(item, 'Kind') !== 'ask' || typeof valueOf(item, 'Of') !== 'string') continue
    const of = valueOf(item, 'Of')
    if (!asksOf.has(of)) asksOf.set(of, [])
    asksOf.get(of).push(item)
  }
  const shared = { ...ctx, items, byAbout, asksOf }
  for (const [id, item] of items ?? new Map()) {
    if (LEFT_OUT.includes(valueOf(item, 'State'))) continue
    const one = stepStatusOf(item, shared)
    if (one !== null) out[id] = one
  }
  return out
}

/** The words after an id on the Focus page's "Being reworked: B981 · <this>" (src/recapRound.mjs `reworkOf`). */
export const reworkWordsOf = (id, one) => `${id} · ${one?.words ?? 'unknown'}`

/**
 * The chip of a Focus block (state.mjs `focusState`) by its state, from its steps' statuses: `waiting`, the first held step's
 * hand-out reason ("Held: B1096 · <why>"), else NOBODY_ON_IT; `ready`, ON_THE_LIST with the step the hand-out has on it;
 * `refining`, the first new step's status ("B1030 · refine open: no word in flight (last sent 4 Nov 23:20)"). Null otherwise.
 */
export function blockChipWords(state, statuses) {
  const list = (statuses ?? []).filter(one => one !== null && one !== undefined)
  if (state === 'waiting') {
    const held = list.find(one => one.kind === 'held')
    return held === undefined ? NOBODY_ON_IT : `Held: ${held.id} · ${held.why}`
  }
  if (state === 'ready') {
    const ready = list.find(one => one.kind === 'ready')
    return ready === undefined ? ON_THE_LIST : `${ON_THE_LIST}: ${ready.id}`
  }
  if (state === 'refining') {
    const refine = list.find(one => one.kind === 'refine' || (one.kind === 'partner' && one.where === 'partner'))
    return refine === undefined ? null : `Refining: ${refine.id} · ${refine.words}`
  }
  return null
}
/** The chip of a block that waits (kept for its callers): `blockChipWords('waiting', statuses)`. */
export const blockWaitWords = statuses => blockChipWords('waiting', statuses)

/**
 * The Refine part's group of a step (board.js `refineGroups`: none, asking, answers, answered, stopped, ready), from its one
 * status, so the part and the status never disagree (the review: the live B1030 read "refine stopped after 3 rounds" in its
 * status while the part listed it as answered, with no Send again): a refine with its word in flight or held is `asking`, one the
 * gate stopped on `stopped`, one waiting for the person's answers `answers`, one never asked `none`; a refine open with no word in
 * flight is where its block stands (`fallback`, the backlog row's reading from the same words), never asking or stopped then
 * (`plain`, the block's own stand without a word). Any other status: `fallback`.
 */
export function refineGroupOf(one, fallback, plain = 'answered') {
  if (one?.kind !== 'refine') return fallback
  if (one.where === 'asked') return 'asking'
  if (one.where === 'stopped' || one.where === 'answers' || one.where === 'none') return one.where
  return fallback === 'asking' || fallback === 'stopped' ? plain : fallback
}

/** The Advisor card's line for a step whose refine answers are in (board.js `advisorRefine`): its status, never a guess. */
export const advisorLineOf = (id, one) => (one?.kind === 'refine' && one.toAdvisor === true ? `Your answers on ${id} wait for the Advisor` : `${id}: ${one?.words ?? NO_WORD}`)

/** The words a supervisor rule writes of a refine the Advisor took and did not write (src/supervisor/rules/repair.mjs, refine-again). */
export const advisorWaitText = (id, rest) => `${id} ${WAITS_FOR_THE_ADVISOR} ${rest}`
export const advisorStillWaitText = (id, rest) => `${id} still ${WAITS_FOR_THE_ADVISOR} ${rest}`

/**
 * A step's status for a page that has no state entry for it (a done or dropped step, or a step the state does not hold yet):
 * its own state in words, never a status worked out.
 */
export const plainStatusOf = state => ({ kind: state ?? 'unknown', label: state ?? 'unknown', words: state ?? 'unknown', tone: 'quiet' })

// ---- the signal: the focus goal has work, none can be handed out ----

/** How long a worker is free, in the board's running minutes, before the signal goes to Main and the partner. */
export const FREE_SIGNAL_MINUTES = 10
const UNSTARTED = ['new', 'refined']
/** The states of a blocker that someone has (given, at work, in review): a step it blocks is that one's, not the signal's. */
const BLOCKER_AT_WORK = ['queued', 'taken', 'in progress', 'waiting on you', 'review']

/** The goal and the goals under it in the goal map's nodes (`children`). */
function focusGoalsOf(focus, nodes) {
  const byId = new Map((nodes ?? []).map(one => [one.id, one]))
  const found = [focus]
  for (let at = 0; at < found.length && found.length < 200; at += 1) for (const child of byId.get(found[at])?.children ?? []) if (!found.includes(child)) found.push(child)
  return new Set(found)
}

/** The time the board was off (`gaps`, `[{ from, to }]`) between `from` and `now`, in ms. */
const offBetween = (gaps, from, now) => (gaps ?? []).reduce((sum, gap) => sum + Math.max(0, Math.min(gap.to, now) - Math.max(gap.from, from)), 0)

/** The blockers a hand-out hold names ("blocked by B9000 (in progress), B9001 (review)"), by id. */
const blockersOf = why => [...new Set(String(why ?? '').match(/\bB\d+\b/g) ?? [])].sort()

/**
 * A cause's stable class, for the key the rule's note and word go by (the review: a key with the blocker's live state or the
 * refine's stage made a new note and a new wake at every move): `blocked B9000,B9001` (the blocker ids only), `waits-for`,
 * `answer`, `standard`, `routing`, `choice`, `held`; a refine `refine`; else the kind.
 */
export function causeClassOf(one) {
  if (one?.kind === 'refine') return 'refine'
  if (one?.kind !== 'held') return String(one?.kind ?? 'unknown')
  const why = String(one.why ?? '')
  if (/^blocked by\b/.test(why)) return `blocked ${blockersOf(why).join(',')}`
  if (/^waits for: /.test(why)) return 'waits-for'
  if (/^waits for the (?:answer|partner)\b/.test(why)) return 'answer'
  if (/\bstandard\b/.test(why)) return 'standard'
  if (/routing record/.test(why)) return 'routing'
  if (one.choice === true) return 'choice'
  return 'held'
}

/**
 * Why a cause is left out of the signal (someone already has it), or null: a word to the Advisor in flight or held, a refine
 * that waits for the person's answers or for the partner's, a refine the gate stopped on or has in its line (`skip`), a rebuild
 * hold (`skip`), a step held by a blocker that someone has.
 */
function leftOutWhy(one, { items, skip }) {
  if (skip instanceof Map && skip.has(one.id)) return skip.get(one.id)
  if (one.kind === 'refine' && (one.toAdvisor === true || one.held === true)) return 'a word to the Advisor is in flight'
  if (one.kind === 'refine' && one.where === 'answers') return 'its refine waits for the person\'s answers'
  if (one.kind === 'refine' && one.where === 'stopped') return 'the refine gate stopped on it'
  if (one.kind === 'partner') return 'it waits for the partner'
  if (one.kind === 'held' && /^blocked by\b/.test(one.why ?? '')) {
    const atWork = blockersOf(one.why).filter(id => BLOCKER_AT_WORK.includes(valueOf(items.get(id), 'State')))
    if (atWork.length > 0) return `its blocker ${atWork.join(', ')} is at work`
    // The coordinator's point of 2026-11-11 (the live B1123 to B1126): a blocker that itself waits for a step at work is someone's too.
    const deep = chainAtWork(blockersOf(one.why), items)
    if (deep !== null) return `its blocker chain reaches ${deep}, which is at work`
  }
  return null
}

/** How far a chain of "Blocked by" is followed. */
const CHAIN_DEPTH = 10
/** The first step at work (`BLOCKER_AT_WORK`) in the chain of "Blocked by" ids from `ids` through the store, or null; a depth cap and a seen set end a loop. */
function chainAtWork(ids, items) {
  const seen = new Set()
  let level = ids
  for (let depth = 0; depth < CHAIN_DEPTH && level.length > 0; depth += 1) {
    const next = []
    for (const id of level) {
      if (seen.has(id)) continue
      seen.add(id)
      const step = items.get(id)
      if (step === undefined) continue
      if (BLOCKER_AT_WORK.includes(valueOf(step, 'State'))) return id
      next.push(...blockersOf(valueOf(step, 'Blocked by')))
    }
    level = next
  }
  return null
}

/**
 * The signal of P7 (never to the person): the focus goal has unstarted steps (new or refined), the hand-out's ready list is empty,
 * and a worker has been free (the hand-out's own `idleWorkers`, with the reconciler's `restFree` and `stuck`) for
 * FREE_SIGNAL_MINUTES of the board's running time (after the person's pause, `afterPause`, and the board's off spells, `gaps`;
 * none while the person pauses or the board resumes). `{ goal, worker, freeSince, minutes, causes: [{ key, id, kind, words,
 * link }], left: [{ id, why }], text, link }`, or null. A cause is an unstarted step with its status ("B1096 held (<why>)") that
 * nobody has yet (`leftOutWhy`; `skip` the state's `{ id → why }` of the refine gate's line and the rebuild holds); with none left,
 * null. `statuses` the state's `stepStatus` (else each is read here). A lane is free since its Workers mod's own report says so
 * (`report.since`): the rule and the Overview count the same minutes, from the same signal (the state's `noWork`).
 * The review (keyed on free[0]'s since alone, the next free worker's since made a new key when the first got busy, and a report
 * gone idle → ended a new since: the partner was woken again): `seen` is the episode the state kept from its last read (state.mjs
 * `noWorkSeen`, `{ since, free }`): `episodeSince` (the stamp the rule's keys go by) stays its `since` while the signal stands,
 * else the longest-free worker's `freeSince`; and a worker free at the last read counts from its first free since there (`free`,
 * by name) whatever its report says since. `freeFrom` the free workers' since by name, for the state to keep.
 */
export function noneReadyOf({ items = new Map(), focus = null, goals = [], ready = null, held = null, lanes = [], pause = null, gaps = [], now, prefix = '', restFree = [], stuck = new Set(), statuses = null, skip = new Map(), seen = null, ...ctx }) {
  if (typeof focus !== 'string' || !Array.isArray(ready) || ready.length > 0 || !Number.isFinite(now) || isHolding(pause) || pause?.state === 'resuming') return null
  const inFocus = focusGoalsOf(focus, goals)
  const unstarted = [...items.values()].filter(item => (valueOf(item, 'Kind') ?? 'step') === 'step' && UNSTARTED.includes(valueOf(item, 'State')) && inFocus.has(valueOf(item, 'Goal')))
  if (unstarted.length === 0) return null
  const keptFree = seen?.free !== null && typeof seen?.free === 'object' ? seen.free : {}
  const freeFrom = {}
  const free = idleWorkers(lanes, { items, prefix, restFree, stuck: stuck instanceof Set ? stuck : new Set(stuck ?? []) }).map(lane => {
    const said = lane.report?.since ?? null
    if (!Number.isFinite(said)) return null
    const from = Number.isFinite(keptFree[lane.name]) ? Math.min(keptFree[lane.name], said) : said
    freeFrom[lane.name] = from
    const start = afterPause(pause, from)
    return { name: lane.name, from, runningMs: now - start - offBetween(gaps, start, now) }
  }).filter(one => one !== null && one.runningMs >= FREE_SIGNAL_MINUTES * MIN).sort((a, b) => b.runningMs - a.runningMs)
  if (free.length === 0) return null
  const byNumber = (a, b) => String(valueOf(a, 'Id')).localeCompare(String(valueOf(b, 'Id')), 'en', { numeric: true })
  const causes = []
  const left = []
  for (const item of unstarted.sort(byNumber)) {
    const id = valueOf(item, 'Id')
    const one = statuses?.[id] ?? stepStatusOf(item, { ...ctx, items, ready, held, now, prefix })
    const why = leftOutWhy({ ...one, id }, { items, skip })
    if (why !== null) {
      left.push({ id, why })
      continue
    }
    const words = one.kind === 'held' ? `${id} held (${one.why})` : `${id} ${one.words}`
    causes.push({ key: `${id} ${one.kind} ${causeClassOf(one)}`, id, kind: one.kind, words, link: one.link })
  }
  if (causes.length === 0) return null
  const worker = free[0]
  return {
    goal: focus, worker: worker.name, freeSince: worker.from, episodeSince: Number.isFinite(seen?.since) ? seen.since : worker.from, freeFrom, minutes: Math.floor(worker.runningMs / MIN), causes, left,
    text: `focus goal ${focus} has work, none can be handed out: ${causes.map(one => one.words).join('; ')}`, link: causes[0].link,
  }
}
