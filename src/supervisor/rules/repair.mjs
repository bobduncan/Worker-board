// B465: the board's own list of the ways work got stuck, each with its fix. The person, 2026-10-21 (I50): "i want a
// structural fix for preventing this it gets stuck, of the out of sync button verifies this as well". Every way the
// person found by hand that day is a check here: a step blocked by one in review, a queued step its free owner did not
// take, a step owned by a chat no longer in the list, a yes to dropping a step in its refine, a worker paused for the
// limit after its time, a chat asking under an old name, the partner's helper not running while work waits for it, and
// an ask routed to the partner left unanswered. What it cannot fix goes to the main chat as one note, never twice for
// the same thing (loop.mjs). A new way of getting stuck is added here, with its test, not fixed by hand (roles/main.md).
//
// The supervisor (spec 2026-10-24): each check is a repair rule, `{ id, kind: 'repair', says, check(view, ctx) }`, moved
// here from src/work/sync.mjs's `findStuck` without changing what it finds or does. `check` reads the view (the store's
// items, the board's chats, the partner and its helper, the outbox, the limits, the pause, the names refused lately,
// the leftover worktrees) and answers its findings: `{ rule, check, key, subject, text, evidence, fix }`. `rule` and
// `check` are the rule's id; `fix` is the repair the loop carries out (loop.mjs `applySync`). `ctx` holds the runner's
// watch: `seen` (since when it has seen what only counts once it lasts) and `observed` (what it sees now). PURE.
//
// Worktree clean-up (the person, 2026-10-24: "cleanup leftover working tree's please. ensure this is part of the
// cleanup step."): the rule `worktrees` lists the leftover worktrees of the repositories the board knows and the empty
// folders they left in the project folder (src/work/worktrees.mjs `findLeftovers`, looked at by the loop through its
// port `leftovers`, in the view as `leftovers`). The safe ones the board removes itself (Cleaned, port `clean`); the
// rest it only lists, with the reason (Left), and tells no chat of them.

import { earlierOfCard, shortAnswer } from '../../work/autopilot.mjs'
import { askFiledMs, sinceMs, valueOf } from '../../work/item.mjs'
import { stamp } from '../../work/migrate.mjs'
import { overlapIn, waitIds } from '../../work/guards.mjs'
import { PARTNER_AGAIN_MS, isPartnerAskWord, isRoutedToPartner, partnerAskWords } from '../../work/partnerAnswers.mjs'
import { afterPause, isHolding } from '../../work/pause.mjs'
import { refineWaitOf } from '../../work/refineWait.mjs'
import { isQaTask, notDueWhy, openQaTaskOf } from '../../work/qaTask.mjs'
import { UNCHECKED_MS, gitCheckPassed, needsResultCheck, resultCheckAtMs, resultCheckOf, reviewWaitOf } from '../../work/resultCheck.mjs'
import { asksOfStep } from '../../work/stepAsks.mjs'
import { heldReason } from '../../work/parked.mjs'
import { goOnLine, goneWords } from '../../work/holderTimers.mjs'
import { advisorStillWaitText, advisorWaitText } from '../../stepStatus.mjs'

const MIN = 60_000
const HOUR = 60 * MIN

/** A chat the list no longer shows this long: what it holds goes to the main chat, a pin to it is taken off. */
export const OWNER_GONE_MS = 30 * MIN
/** A wake of the board's own that changed nothing in this time goes to the main chat. */
export const AGAIN_MS = 10 * MIN
/** A refusal of an old name this recent says the chat still asks under it. */
export const REFUSED_MS = 10 * MIN
/** Refusals of an old name over this long say the chat's mod does not follow the shown name by itself. */
export const REFUSED_LASTS_MS = 2 * MIN
/** B449: a fix dropped with nothing planned for its step this long (the rule fix-dropped); T9.1.1: and how long a checker is given to file its ask point (resultCheck.mjs). */
export { UNCHECKED_MS }
/**
 * T9.4 (the person, 2026-10-26: "ask again every 30 min, after 3 tries to me"): a refine or an incident the Advisor took
 * and has not done is asked again every ASK_AGAIN_MS, ASKS_AGAIN times; after that the person is told, once.
 */
export const ASK_AGAIN_MS = 30 * MIN
export const ASKS_AGAIN = 3
/** The rules whose wakes are bounded by design (three, then the person): the watch rule repair-repeats counts none of them. */
export const BOUNDED_RULES = new Set(['refine-again', 'incident-again'])
/** The lines to the partner about refines and result checks the helper may be waited on for, this far back. */
const HELPER_LOOK_MS = 6 * 60 * MIN
/** B546: a refine or check the running partner has said or done nothing about this long waits for the helper. */
export const PARTNER_QUIET_MS = 10 * MIN
/** B567: a step in progress this long while its worker's card names another step, with nothing naming why, is named. */
export const HELD_ELSEWHERE_MS = 60 * MIN

/** The states in which a step is its Owner's work now. */
const HOLDS = ['taken', 'in progress', 'waiting on you']
const CLOSED = ['done', 'dropped']

const kindOf = item => valueOf(item, 'Kind') ?? 'step'
const stateOf = item => valueOf(item, 'State')
const idOf = item => valueOf(item, 'Id')
const byId = (a, b) => idOf(a).localeCompare(idOf(b), 'en', { numeric: true })
const idsIn = value => (value ?? '').match(/\bB\d+\b/g) ?? []
/** A chat's name without the list's prefix, for comparing. */
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const pad = n => String(n).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const minutes = ms => Math.max(1, Math.round(ms / MIN))
/** A wait in hours and minutes: "3 h 53 min" ("45 min" under an hour). */
const hoursOf = ms => {
  const all = Math.floor(ms / MIN)
  return all < 60 ? `${all} min` : `${Math.floor(all / 60)} h ${all % 60} min`
}
const answerOf = ask => (ask.sections?.get('Answer') ?? []).join(' ').trim()

/**
 * B482: a step in review that no longer holds what waits on it: the board's check passed, and so did its result check
 * when it needs one (a pending, missing or failed one holds it, as a fix may follow).
 */
// (A failed result check holds it until the step is checked again, also when its fix is done: the fix's own report
// asks the check anew.)
const isMergedAndChecked = item => stateOf(item) === 'review' && gitCheckPassed(item) && (!needsResultCheck(item) || resultCheckOf(item) === 'passed')

/** A finding of a repair rule: today's `{ check, key, text, fix }`, with the rule, its subject and its evidence. */
const finding = (check, key, subject, text, fix) => ({ rule: check, check, key, subject, text, evidence: text, fix })

/**
 * What every rule reads of the view, worked out once per view: the store's steps, the chats of the list, and the
 * board's own wake for a finding (`wakeOr`: woken a moment ago, it waits for that; longer ago and still stuck, `late`).
 */
const FACTS = new WeakMap()
function factsOf(view) {
  if (FACTS.has(view)) return FACTS.get(view)
  const { items = new Map(), lanes = [], prefix = '', now, outbox = [], limits = {}, pause = null } = view
  const all = [...items.values()]
  const steps = all.filter(item => kindOf(item) === 'step' && typeof idOf(item) === 'string').sort(byId)
  const live = lanes.filter(lane => !lane.isLeftover)
  const facts = {
    all, steps, live,
    workers: live.filter(lane => lane.isMain !== true),
    laneOf: name => live.find(lane => plain(lane.name, prefix) === plain(name, prefix)),
    isHeld: isHolding(pause),
    holds: name => steps.some(item => HOLDS.includes(stateOf(item)) && plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix)),
    isFull: ['fiveHour', 'week'].some(limit => limits?.[limit]?.level === 'full'),
    wakeOr: (key, wake, late) => {
      const at = outbox.findLast(message => message.syncKey === key)?.at ?? null
      if (at === null) return wake
      return now - at < AGAIN_MS ? { do: 'woken', at } : late
    },
  }
  FACTS.set(view, facts)
  return facts
}

/**
 * A step blocked by one in review whose board check passed (its work is merged; only its result check is open), or by
 * one the store lacks. The review: in review with a check pending or failed is not merged: it holds.
 * B542 (X7, X10: B522 still blocked by B509 hours after it was done, B506 in progress still waiting for B503): a
 * blocker done or dropped is unblocked too, queued or in progress, and so is a `Waits for` whose every step is.
 */
function blocked(view) {
  const { items = new Map() } = view
  const { steps } = factsOf(view)
  const found = []
  for (const item of steps.filter(one => !CLOSED.includes(stateOf(one)) && stateOf(one) !== 'review')) {
    const id = idOf(item)
    for (const on of idsIn(valueOf(item, 'Blocked by'))) {
      const other = items.get(on)
      if (other === undefined) {
        const text = `${id} is blocked by ${on}, which the store does not hold`
        found.push(finding('blocked', `blocked ${id} ${on}`, id, text, { do: 'main', text: `${text}: unblock it or make ${on}` }))
      } else if (CLOSED.includes(stateOf(other))) {
        found.push(finding('blocked', `blocked ${id} ${on}`, id, `${id} waited on ${on}, which is ${stateOf(other)}`, { do: 'unblock', id, on }))
      } else if (isMergedAndChecked(other)) {
        found.push(finding('blocked', `blocked ${id} ${on}`, id, `${id} waited on ${on}, which is in review`, { do: 'unblock', id, on }))
      }
    }
    // B542: a `Waits for` that names only steps done or dropped no longer holds: the board clears it.
    const waits = waitIds(item)
    if (waits.length > 0 && waits.every(one => /^B\d+$/.test(one) && CLOSED.includes(stateOf(items.get(one) ?? { head: new Map() })))) {
      const on = waits[0]
      found.push(finding('blocked', `blocked ${id} waits ${on}`, id, `${id} waited for ${waits.join(', ')}, ${waits.length === 1 ? `which is ${stateOf(items.get(on))}` : 'all done or dropped'}`, { do: 'unblock', id, on }))
      continue
    }
    // A `Waits for` is the main chat's or the person's to clear: the board says so.
    for (const on of waits.filter(one => /^B\d+$/.test(one))) {
      const other = items.get(on)
      if (other !== undefined && !isMergedAndChecked(other)) continue
      const what = other === undefined ? 'which the store does not hold' : 'in review'
      const text = `${id} waits for ${on} (${what}) in its Waits for words`
      found.push(finding('blocked', `blocked ${id} ${on}`, id, text, { do: 'main', text: `${text}: clear it (work unblock ${id})` }))
    }
  }
  return found
}

/**
 * A step a chat no longer in the list holds (taken, in progress, waiting on you) goes back on the list, its checkpoint,
 * branch and plan kept (signals change 3: `{ do: 'give-back', id, chat, why }`, the work API's give-back path; before it,
 * the main chat's to hand on). Redesign Part 2: a step given to such a chat (queued) the board takes back itself (T8.5 step 6:
 * work/handOut.mjs `strandedGives`), and a task pinned to such a chat is unpinned (`{ do: 'unpin', id }`), so it waits
 * for no chat that is gone. The review: only once the chat has been missing for OWNER_GONE_MS by the runner's own watch
 * (a chat file the app rewrites is skipped for one read, an account switch drops chats for a while), and never while
 * the person pauses.
 */
function ownerGone(view, { seen = new Map(), observed = [] } = {}) {
  const { partner = null, helper = null, prefix = '', now } = view
  const { steps, workers, laneOf, isHeld } = factsOf(view)
  const found = []
  if (!(workers.length > 0 && !isHeld)) return found
  const known = name => laneOf(name) !== undefined || [partner, helper].some(card => card !== null && plain(card.name, prefix) === plain(name, prefix))
  const isGone = name => {
    if (known(name)) return false
    const watch = `missing ${plain(name, prefix)}`
    if (!observed.includes(watch)) observed.push(watch)
    return now - (seen.get(watch) ?? now) >= OWNER_GONE_MS
  }
  for (const item of steps.filter(one => HOLDS.includes(stateOf(one)) && valueOf(one, 'Owner') !== null)) {
    const id = idOf(item)
    const owner = valueOf(item, 'Owner')
    if (!isGone(owner)) continue
    const text = `${id} is ${stateOf(item)} for ${owner}, no longer in the list`
    // Signals change 3, the second half: a gone owner has no lane, so the hand-over's timers never run for it: the board
    // gives its step back at once by the same path (api.mjs `giveBackHeld`, beside handOut.mjs `strandedGives`, which
    // takes back the queued ones), waiting on you too; its asks stay open for the person. No note to the main chat.
    found.push(finding('owner-gone', `owner-gone ${id} ${owner}`, id, text, { do: 'give-back', id, chat: owner, why: goneWords(owner) }))
  }
  for (const item of steps.filter(one => ['new', 'refined'].includes(stateOf(one)) && valueOf(one, 'Pinned') !== null)) {
    const id = idOf(item)
    const pinned = valueOf(item, 'Pinned')
    if (!isGone(pinned)) continue
    found.push(finding('owner-gone', `owner-gone ${id} pinned ${pinned}`, id, `${id} is pinned to ${pinned}, no longer in the list`, { do: 'unpin', id }))
  }
  return found
}

/** A yes to dropping a step in its refine: the partner cannot drop, the main chat does. */
function refineDrop(view) {
  const { items = new Map(), partner = null, helper = null, prefix = '' } = view
  const { steps } = factsOf(view)
  const found = []
  for (const item of steps.filter(one => !CLOSED.includes(stateOf(one)))) {
    const id = idOf(item)
    for (const ask of asksOfStep(items, id)) {
      if (stateOf(ask) !== 'answered' || !/^\s*drop\b/i.test(valueOf(ask, 'Title') ?? '')) continue
      const owner = valueOf(ask, 'Owner')
      const isPartners = valueOf(ask, 'Via') === 'refine' || [partner, helper].some(card => card !== null && plain(card.name, prefix) === plain(owner, prefix))
      if (!isPartners || !/^\s*(?:yes|y|ja|drop)\b/i.test(answerOf(ask))) continue
      const askId = idOf(ask)
      found.push(finding('refine-drop', `refine-drop ${id} ${askId}`, id, `${id}: the person's yes to dropping it (${askId})`,
        { do: 'send', text: `${id}: the person answered yes to dropping it (${askId}): drop it (work drop ${id})` }))
    }
  }
  return found
}

/** A worker paused for the limit whose time has passed: nothing starts it by itself. Never while a limit is full. */
function limitBack(view) {
  const { prefix = '' } = view
  const { steps, workers, isHeld, isFull, wakeOr } = factsOf(view)
  const found = []
  if (isHeld || isFull) return found
  for (const lane of workers.filter(one => one.state === 'suspended' && one.suspended?.isBack === true)) {
    const held = steps.find(item => HOLDS.includes(stateOf(item)) && plain(valueOf(item, 'Owner'), prefix) === plain(lane.name, prefix))
    if (held === undefined) continue
    const id = idOf(held)
    const until = Number.isFinite(lane.suspended.until) ? ` until ${clockOf(lane.suspended.until)}` : ''
    const key = `limit-back ${lane.name} ${lane.suspended.since ?? ''}`.trim()
    // Signals change 3: the same "go on" words as the hand-over's line to a stopped holder (its branch, commit and next).
    const fix = wakeOr(key, { do: 'wake', chat: lane.name, id, text: `work: the limit is back: ${goOnLine(held)}; run work next` },
      { do: 'main', text: `${lane.name} did not go on with ${id} after the limit came back: start it` })
    found.push(finding('limit-back', key, lane.name, `${lane.name}: paused for the limit${until}, the limit is back`, fix))
  }
  return found
}

/** A chat that asks under an old name: the board cannot reach it (its words go by name), the main chat can. */
function oldName(view) {
  const { partner = null, helper = null, prefix = '', now, refused = [] } = view
  const { live } = factsOf(view)
  const found = []
  const cards = [...live, ...[partner, helper].filter(card => card !== null)]
  const told = new Set()
  // The review: the Workers mod since B463 joins under the shown name at its next take, so one refusal is no case;
  // refusals over two minutes are (a mod from before that).
  for (const one of refused.filter(at => now - at.at < REFUSED_MS && at.at - (at.first ?? at.at) >= REFUSED_LASTS_MS)) {
    const shown = cards.find(card => typeof card.session === 'string' && card.session === one.session)
    if (shown === undefined || plain(shown.name, prefix) === plain(one.name, prefix)) continue
    const key = `old-name ${one.name} ${shown.name}`
    if (told.has(key)) continue
    told.add(key)
    const text = `${shown.name} asks under its old name ${one.name}`
    found.push(finding('old-name', key, shown.name, text, { do: 'send', text: `${text}: ask it to join as "${shown.name}" (chat join)` }))
  }
  return found
}

/** B546: when the partner last said or did something about a step: a History line in its name, or a line of its own naming the step. */
function partnerTouchMs(item, partner, prefix) {
  const id = idOf(item)
  const acts = (item.sections?.get('History') ?? []).map(line => line.match(/^-\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+([^:]+):/))
    .filter(match => match !== null && plain(match[2], prefix) === plain(partner.name, prefix)).map(match => sinceMs(match[1]))
  const said = (partner.messages ?? []).filter(message => message.from === 'chat' && new RegExp(`\\b${id}\\b`).test(message.text ?? '')).map(message => message.at)
  return Math.max(-Infinity, ...[...acts, ...said].filter(Number.isFinite))
}

/**
 * The partner's helper not running while refines or result checks wait for the partner: woken (the main chat starts
 * it); still not running a while later, the partner is told to do them itself, and the main chat to start it.
 * B546 (X11: woken three times in a day while the partner ran and handed the work out itself): a running partner
 * decides who does its refines and checks, so one waits for the helper only once the partner has said or done nothing
 * about it for PARTNER_QUIET_MS since the board's line, or at once when the partner does not run. A helper that stopped
 * running because the app started anew (its transcript quiet since before the app's start, `appStartedAt`) is woken
 * as before, but the finding says so (`cause: 'restart'`), and the watch rule repair-repeats does not count it.
 */
function helperIdle(view, { seen = new Map(), observed = [] } = {}) {
  const { items = new Map(), partner = null, helper = null, prefix = '', now, outbox = [], appStartedAt = null } = view
  const { isHeld, wakeOr } = factsOf(view)
  const found = []
  if (!(helper !== null && (helper.isRunning === false || helper.state === 'off') && !isHeld)) return found
  const isPartnerOff = partner !== null && (partner.isRunning === false || partner.state === 'off')
  const recent = outbox.filter(message => now - message.at < HELPER_LOOK_MS && (partner === null || plain(message.to, prefix) === plain(partner.name, prefix)))
  const waits = new Set()
  for (const message of recent) {
    const item = items.get(message.about)
    if (item === undefined) continue
    // The review: a refine block that is "open" waits for the person's answers, not for the partner.
    const isOpen = (message.command === 'refine' && !CLOSED.includes(stateOf(item)) && valueOf(item, 'Refined') === null)
      || (message.command === 'result-check' && stateOf(item) === 'review' && resultCheckOf(item) === null)
    if (!isOpen) continue
    // B546: the running partner holds it while it said or did something about it, or got the line, lately.
    const isQuiet = partner === null || isPartnerOff || now - Math.max(message.at, partnerTouchMs(item, partner, prefix)) >= PARTNER_QUIET_MS
    if (isQuiet) waits.add(idOf(item))
  }
  // A line about it the partner got lately holds it, also when an older one about it would not.
  for (const message of recent.filter(one => partner !== null && !isPartnerOff && now - one.at < PARTNER_QUIET_MS)) waits.delete(message.about)
  const ids = [...waits].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  if (ids.length > 0) {
    // The review: one key per time it stops running (since the runner first saw it so), not per set of waiting ids,
    // so the main chat is told once for it and the helper woken once.
    const watch = `helper off ${plain(helper.name, prefix)}`
    observed.push(watch)
    const key = `helper ${helper.name} ${stamp(seen.get(watch) ?? now)}`
    const text = `${helper.name} is not running: ${ids.length} refines and checks wait`
    const late = partner === null
      ? { do: 'main', text: `${text} (${ids.join(', ')}), and it did not start when woken: start it` }
      : { do: 'hand', chat: partner.name, id: ids[0], text: `work: ${helper.name} is not running: do the waiting refines and result checks yourself (${ids.join(', ')}); run work next` }
    // B546: what to do, not "ask it which are yours": the partner hands them out by message, so the helper waits for it.
    const words = partner === null
      ? `work: the board woke you: ${ids.length} refines and result checks wait (${ids.join(', ')}); run work next`
      : `work: the board woke you: ${ids.length} refines and result checks wait for ${partner.name} (${ids.join(', ')}); ${partner.name} hands you yours by message: wait for it, do not ask back`
    const fix = wakeOr(key, { do: 'wake', chat: helper.name, id: ids[0], text: words }, late)
    const writtenAt = helper.writtenAt ?? null
    const isRestart = Number.isFinite(appStartedAt) && Number.isFinite(writtenAt) && writtenAt < appStartedAt
    found.push({ ...finding('helper', key, helper.name, text, fix), ...(isRestart ? { cause: 'restart' } : {}) })
  }
  return found
}

/** The states in which a ready task's Touches hold it back from the hand-out: given or under way (work/handOut.mjs `match`). */
const GIVEN_OR_UNDER_WAY = ['queued', 'taken', 'in progress', 'waiting on you']
/** B728: a closed worker the board asked the main chat to start this long ago, still closed, with a ready task waiting. */
export const CLOSED_WAKE_MS = AGAIN_MS

/**
 * B722/B728 (the person, 2026-10-26: "i added it to the queu, why is it not picked up by worker 5?"): a ready task
 * waits and no running worker is free, but a worker's chat is closed (its lane is "off", or free by its card and known
 * not to run). The one path that wakes it is the hand-out's own start (`workerStart`, a start word to the main chat,
 * once per start window, never while the person pauses or a limit is full); this rule starts nothing. It only files
 * what that path cannot: the closed worker closed longest (lanes with an off time first, then by name) was asked to
 * start CLOSED_WAKE_MS ago and still does not run: "B<n> waits; Worker <n> is closed and does not wake", for the main
 * chat, once. A worker paused for the limit (`suspended`) is `limit-back`'s, one holding a step `holder-not-running`'s.
 */
function closedWorker(view) {
  const { items = new Map(), prefix = '', now, outbox = [], ready = [] } = view
  const { workers, steps, isHeld, isFull } = factsOf(view)
  if (isHeld || isFull || ready.length === 0) return []
  const holds = lane => steps.some(item => ['queued', 'taken', 'in progress'].includes(stateOf(item)) && plain(valueOf(item, 'Owner'), prefix) === plain(lane.name, prefix))
  if (workers.some(lane => lane.isRunning === true && lane.state === 'free' && !holds(lane))) return []
  const closed = workers.filter(lane => (lane.state === 'off' || lane.state === 'free') && lane.isRunning === false && !holds(lane))
    .sort((a, b) => Number.isFinite(a.offSince) === Number.isFinite(b.offSince) ? (a.offSince ?? 0) - (b.offSince ?? 0) || a.name.localeCompare(b.name) : Number.isFinite(a.offSince) ? -1 : 1)
  for (const one of ready) {
    const item = items.get(one.id)
    if (item === undefined || overlapIn(items, item, GIVEN_OR_UNDER_WAY) !== null) continue
    const lane = one.keptFor == null ? closed[0] : closed.find(each => plain(each.name, prefix) === plain(one.keptFor, prefix))
    if (lane === undefined) continue
    const asked = outbox.findLast(word => word.command === 'start' && plain(word.about, prefix) === plain(lane.name, prefix) && Number.isFinite(word.at))
    if (asked === undefined || now - asked.at < CLOSED_WAKE_MS) return []
    const text = `${one.id} waits; ${lane.name} is closed and does not wake`
    return [finding('closed-worker', `closed-worker ${lane.name} ${one.id}`, lane.name, text, { do: 'main', text: `${text}: start it` })]
  }
  return []
}

/**
 * An ask routed to the partner, open ten minutes with no line about it lately (the partner was busy when the
 * reconciler would have woken it): it is woken now, busy or not; its line waits for the end of its turn.
 */
function partnerAsk(view) {
  const { partner = null, now, outbox = [] } = view
  const { all, isHeld } = factsOf(view)
  const found = []
  if (!(partner !== null && !isHeld)) return found
  for (const ask of all.filter(isRoutedToPartner).sort(byId)) {
    const id = idOf(ask)
    const filed = askFiledMs(ask)
    if (!(now - filed >= PARTNER_AGAIN_MS)) continue
    const lately = outbox.some(message => message.about === id && isPartnerAskWord(message)
      && (message.state === 'waiting' || message.state === 'taken' || now - message.at < PARTNER_AGAIN_MS))
    if (lately) continue
    const key = `partner-ask ${id} ${Math.floor((now - filed) / PARTNER_AGAIN_MS)}`
    // The person's "B" (2026-11-02): an ask routed on their earlier answer names it in the word, as the reconciler's does.
    const earlier = earlierOfCard(ask, all)
    found.push(finding('partner-ask', key, id, `${id} routed to ${partner.name}, unanswered for ${minutes(now - filed)} min`, { do: 'wake', chat: partner.name, id, text: partnerAskWords(id, earlier === null ? null : { id: earlier.id, answer: shortAnswer(earlier.answer) }) }))
  }
  return found
}

/**
 * B449 (G11's re-check: reports that sat unchecked, and checks that waited on an answer already given), T9.1.1 (the person,
 * 2026-10-27: "feels like the current advisor is a bottleneck ... maybe we can create a queue system similar to the workers"):
 * a step in review that waits for its result check (resultCheck.mjs `reviewWaitOf`, kind check: never filed, or again after its
 * fix was done or its ask point answered, or its checker never filed the ask point it owed, UNCHECKED_MS after its check) and has
 * no open Quality Assurance task: the board makes one at once. B1103 (X163): at most once after a check that waited with no ask
 * filed or named: when the check of a task made for that waits so again (kind 'unasked'), no task is made; the step reads "its
 * checker filed no ask point" and the partner gets one word (once per wait, the outbox keeps its key) to file the ask or name the
 * open one that carries it (the work API's `qa-task`, no word to the partner, no 30 minutes of
 * waiting: the maker is idempotent, so the check path and this rule in one minute make one). A board with no partner chat has no
 * step that waits for a check, and makes none. Clearing needs no partner: an open QA task whose step is no longer in review (done,
 * dropped, gone) is dropped, with why, so no worker checks a closed step; so is one nobody took (refined or given) whose step
 * waits for something else than a check (the person's answer, an open fix); and one a worker holds (taken or in progress) whose
 * step has a result check line newer than the take, the check filed but the task not closed (the board's close failed): ended
 * (`qa-end`, done as the worker's own filing ends it). While the person pauses it makes and ends and drops nothing.
 */
function unchecked(view) {
  const { partner = null, now } = view
  const { all, steps, isHeld } = factsOf(view)
  const found = []
  if (isHeld) return found
  const byId = new Map(all.map(one => [idOf(one), one]))
  if (partner !== null) {
    for (const item of steps.filter(one => stateOf(one) === 'review' && !isQaTask(one))) {
      const id = idOf(item)
      // B565 (X19): also a step whose check failed and whose fix is done: it waits for its check again.
      const wait = reviewWaitOf(item, byId, null, now)
      // B1103 (X163): a check task made because its checker filed no ask point, whose check again waited with none filed or named:
      // no third task. The partner gets one word per wait to file the ask or name the open one that carries it.
      if (wait?.kind === 'unasked') {
        const key = `unasked ${id} ${stamp(wait.since)}`
        if (!(view.outbox ?? []).some(message => message.syncKey === key)) found.push(finding('unchecked', key, id, `${id} ${wait.text} twice: no new QA task; ${partner.name} is asked to file or name it`, { do: 'wake', chat: partner.name, id, text: unaskedWords(id, wait) }))
        continue
      }
      if (wait?.kind !== 'check' || openQaTaskOf(byId, id) !== null) continue
      found.push(finding('unchecked', `unchecked ${id} ${stamp(wait.since)}`, id, `${id} waits for its check with no QA task: the board makes one`, { do: 'qa', id }))
    }
  }
  for (const task of steps.filter(one => isQaTask(one) && !CLOSED.includes(stateOf(one)))) {
    const id = idOf(task)
    const checks = valueOf(task, 'Checks')
    const step = byId.get(checks)
    // The check was filed after the worker took the task, and the task is still open: ended, not dropped (the step may be done now).
    const filedAt = step === undefined ? Number.NaN : resultCheckAtMs(step)
    if (['taken', 'in progress'].includes(stateOf(task)) && filedAt > sinceMs(valueOf(task, 'Since'))) {
      found.push(finding('unchecked', `qa-end ${id} ${checks} ${stamp(filedAt)}`, id, `${id} checks ${checks}, whose check was filed at ${clockOf(filedAt)}, but the task is still ${stateOf(task)}: its QA task is ended`, { do: 'qa-end', id }))
      continue
    }
    if (step !== undefined && stateOf(step) === 'review') {
      // Nobody took it, and the check it would make is not due (the person's answer, an open fix): the ready list holds it; here it goes.
      const notDue = ['refined', 'queued'].includes(stateOf(task)) ? notDueWhy(step, byId, now) : null
      if (notDue === null) continue
      found.push(finding('unchecked', `qa-drop ${id} ${checks} not due`, id, `${id} checks ${checks}, but ${checks} ${notDue}: its QA task is dropped`, { do: 'qa-drop', id, why: `${checks} ${notDue}` }))
      continue
    }
    const why = step === undefined ? `${checks} is not in the store` : `${checks} is ${stateOf(step)}`
    found.push(finding('unchecked', `qa-drop ${id} ${checks} ${step === undefined ? 'gone' : stateOf(step)}`, id, `${id} checks ${checks}, but ${why}: its QA task is dropped`, { do: 'qa-drop', id, why }))
  }
  return found
}

/**
 * B1103: the one word to the partner for a step whose checks twice waited for the person with no ask filed or named (resultCheck.mjs
 * `reviewWaitOf` kind 'unasked'): file the ask under the step, or name the open ask that already asks it; never ask the person twice.
 */
const unaskedWords = (id, wait) => `${id}'s result check waits for the person on ${wait.points === 1 ? '1 ask point' : `${wait.points} ask points`}, but its checkers filed no ask and named none, twice: the board makes no more Quality Assurance tasks for it. When an open ask (of ${id} or its goal) already asks the person, name it: work note of ${id} "its ask points are carried by Q<n>". Otherwise file the ask: work ask of ${id}, kind look, with its check's evidence. Never ask the person twice.`

/** One plain line of a title for a note: whitespace folded, quotes out, at most `max` characters. */
const titleLine = (value, max = 100) => String(value ?? '').replace(/["“”]/g, "'").replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * T9.4: the follow-up shared by the rules `refine-again` and `incident-again`, stateless, by periods of ASK_AGAIN_MS since
 * the item began to wait (`since`; the time the person paused does not count, pause.mjs `afterPause`). From period 1 the
 * Advisor is woken again, once per period (the key names the period and where the wait began, so a new wait, or one
 * counted from a pause's end, is asked anew; a period whose word is sent already stays quiet, and so does one while an
 * earlier word of the rule still waits for the Advisor's chat), until ASKS_AGAIN words of this wait reached it (taken, typed,
 * or copied for the person to paste). Then, from period ASKS_AGAIN + 1, one note to the person for this wait (`do:
 * 'person'`); the store is the memory, so a note filed before a restart counts. The words are counted from the outbox, so
 * a board that was off, or a PC asleep, for hours asks three times before it tells the person "after 3 asks". `wake(k)` the
 * words of the kth ask again, `person` `{ starts, lines }`: the note's first words (how an earlier one is told from other
 * notes about the item) and its lines. The caller sees to no partner and no pause.
 */
function askedAgain(view, { rule, id, since, wake, person }) {
  const { partner, now, outbox = [], items = new Map() } = view
  const from = afterPause(view.pause, since)
  const n = Math.floor((now - from) / ASK_AGAIN_MS)
  if (!(n >= 1)) return []
  const base = `${rule} ${id}`
  const words = outbox.filter(message => message.about === id && String(message.syncKey ?? '').startsWith(`${base} `) && message.at >= since)
  const reached = words.filter(message => ['taken', 'delivered', 'copied'].includes(message.state))
  const made = reached.length
  if (made < ASKS_AGAIN) {
    const key = `${base} ${n} ${stamp(from)}`
    if (words.some(message => message.syncKey === key || message.state === 'waiting')) return []
    const text = advisorWaitText(id, `for ${minutes(now - from)} min: asked again (${made + 1} of ${ASKS_AGAIN})`)
    return [finding(rule, key, id, text, { do: 'wake', chat: partner.name, id, text: wake(made + 1) })]
  }
  // The third ask has its period too, whenever it went.
  if (n <= ASKS_AGAIN || now - Math.max(...reached.map(message => message.at)) < ASK_AGAIN_MS) return []
  const first = Math.floor(since / MIN) * MIN
  const isTold = [...items.values()].some(item => valueOf(item, 'Kind') === 'note' && valueOf(item, 'Via') === 'supervisor'
    && (item.sections?.get('About') ?? [])[0]?.trim() === id && String(valueOf(item, 'Text') ?? '').startsWith(person.starts) && sinceMs(valueOf(item, 'Since')) >= first)
  if (isTold) return []
  const text = advisorStillWaitText(id, `after ${ASKS_AGAIN} asks: told to you`)
  return [finding(rule, `${base} person ${stamp(since)}`, id, text, { do: 'person', id, text: person.lines })]
}

/**
 * T9.4: a step that is still new, whose refine the Advisor took (the board's word arrived) and has not written: asked again
 * every 30 minutes, three times, then the person is told (refineWait.mjs: not a fix, whose refine has its own follow-up;
 * not a block that waits for the person's answers, nor one the board stopped on). The words are the first word's.
 */
function refineAgain(view) {
  const { partner = null, items = new Map(), outbox = [] } = view
  const { steps, isHeld } = factsOf(view)
  if (!(partner !== null && !isHeld)) return []
  return steps.filter(one => stateOf(one) === 'new').flatMap(item => {
    const id = idOf(item)
    const wait = refineWaitOf(items, item, outbox)
    if (wait === null) return []
    const title = titleLine(valueOf(item, 'Title') ?? id)
    return askedAgain(view, {
      rule: 'refine-again', id, since: wait.since,
      wake: n => [wait.word.text, `Asked again (${n} of ${ASKS_AGAIN}): no refine block was written for ${id} yet; refine it now (roles/partner.md, "Refine a step").`].join('\n'),
      person: {
        starts: `The Advisor has not refined ${id} `,
        lines: [`The Advisor has not refined ${id} "${title}" after ${ASKS_AGAIN} asks over 2 hours: refine it on the Backlog, or drop it.`],
      },
    })
  })
}

/**
 * T9.4, signals change 6 (B915, the lead's Addendum 4): an incident with the Supervisor (its judge word arrived,
 * `incident-told`) that gets no close and no fix step for INCIDENT_NOTE_MS (2 h, the person's pause not counted) is told to
 * the person once. The board no longer asks again at 30, 60 and 90 minutes: a judgment turn costs about a sweep (~170k
 * tokens), and an incident that went by itself closes itself (gone.mjs) anyway. The store is the memory (the note, Via
 * supervisor, about the incident since it got that state), so a restart does not tell it twice.
 */
export const INCIDENT_NOTE_MS = 2 * HOUR
function incidentAgain(view) {
  const { now, items = new Map() } = view
  const { all, isHeld } = factsOf(view)
  if (isHeld) return []
  return all.filter(one => kindOf(one) === 'incident' && stateOf(one) === 'with the supervisor' && valueOf(one, 'Fix') === null).sort(byId).flatMap(item => {
    const id = idOf(item)
    const since = sinceMs(valueOf(item, 'Since'))
    if (!Number.isFinite(since) || now - afterPause(view.pause, since) < INCIDENT_NOTE_MS) return []
    const starts = `Incident ${id} "`
    const first = Math.floor(since / MIN) * MIN
    const isTold = [...items.values()].some(one => valueOf(one, 'Kind') === 'note' && valueOf(one, 'Via') === 'supervisor'
      && (one.sections?.get('About') ?? [])[0]?.trim() === id && String(valueOf(one, 'Text') ?? '').startsWith(starts) && sinceMs(valueOf(one, 'Since')) >= first)
    if (isTold) return []
    const title = titleLine(valueOf(item, 'Title') ?? id)
    const text = `${id} with the Supervisor for over 2 hours without a close or a fix: told to you`
    return [finding('incident-again', `incident-again ${id} person ${stamp(since)}`, id, text,
      { do: 'person', id, text: [`${starts}${title}" has been with the Supervisor for over 2 hours without a close or a fix: look at it under Supervisor.`] })]
  })
}

/**
 * Worktree clean-up: the findings of the check `worktrees` from what worktrees.mjs `findLeftovers` found: one the board
 * may remove (`{ do: 'clean', leftover }`) or one it only lists (`{ do: 'list' }`), each with its path and what it is.
 */
export function leftoverFindings(found) {
  const plainPath = path => String(path).replace(/\\/g, '/')
  return found.map(one => finding('worktrees', `worktree ${plainPath(one.path)}`, plainPath(one.path),
    one.clean === true ? `${plainPath(one.path)}: ${one.what}` : `${plainPath(one.path)} (${one.what}): ${one.why}`,
    one.clean === true ? { do: 'clean', leftover: one } : { do: 'list' }))
}

/**
 * The view's `leftovers`: what the loop's look found (`{ found }`), why it failed (`{ error }`), or undefined when the
 * board has no such look. A look that fails is one row (Left), not the end of the run.
 */
function worktrees(view) {
  const leftovers = view.leftovers
  if (leftovers === undefined || leftovers === null) return []
  if (typeof leftovers.error === 'string') {
    return [finding('worktrees', 'worktrees not read', 'worktrees', `leftover worktrees: not looked at (${leftovers.error})`, { do: 'list' })]
  }
  return leftoverFindings(leftovers.found ?? [])
}

/**
 * B567 (X23: B522 sat in progress 2 h, its checkpoint "report B522", while its worker did other steps): a step in
 * progress over HELD_ELSEWHERE_MS whose owner's card names another step, with nothing that names why it waits (an open
 * ask, a park, an open blocker: parked.mjs `heldReason`), is named to the main chat, once per step an hour: the watch
 * counts from the first time it was seen so and lasts while it stays so. Never while the person pauses, nor for a worker
 * paused for the limit.
 */
function heldElsewhere(view, { seen = new Map(), observed = [] } = {}) {
  const { items = new Map(), prefix = '', now } = view
  const { steps, laneOf, isHeld } = factsOf(view)
  const found = []
  if (isHeld) return found
  for (const item of steps.filter(one => stateOf(one) === 'in progress')) {
    const id = idOf(item)
    const lane = laneOf(valueOf(item, 'Owner'))
    const on = lane?.task?.stepId ?? null
    if (lane === undefined || lane.isMain === true || lane.state === 'suspended' || on === null || on === id) continue
    if (!(now - sinceMs(valueOf(item, 'Since')) > HELD_ELSEWHERE_MS) || heldReason(item, items) !== null) continue
    const watch = `held-elsewhere ${id} ${plain(lane.name, prefix)}`
    if (!observed.includes(watch)) observed.push(watch)
    const key = `held-elsewhere ${id} ${Math.floor((now - (seen.get(watch) ?? now)) / HOUR)}`
    const text = `${id} in progress ${hoursOf(now - sinceMs(valueOf(item, 'Since')))} for ${lane.name}, whose card says ${on}: nothing names why it waits`
    found.push(finding('held-elsewhere', key, id, text, { do: 'send', text: `${text}; have ${lane.name} report it, ask under it or hand it on` }))
  }
  return found
}

/** B598: the board's own check lines in a step's History: `[stamp, outcome, words]`. */
const BOARD_CHECK = /^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d)\s+server: check (passed|failed|pending)\b(?: with warnings)?(?::\s*(.*))?$/
const BASE_FAULT = /^(\S+) of (.+?) is not the same as origin\/(\S+?)(?::|$)/

/**
 * B598 (X45: B595's report failed the board's check four times on "main of worker-board is not the same as
 * origin/main" while another chat's edits held the person's folder back; it caught up after the worker stopped
 * reporting, and nothing checked again): a step in review whose last board check failed only on its base branch against
 * the remote's is checked again once the two are equal (the view's `bases`, check.mjs `basesNow`), without a new
 * report; once per failed check (its key names the check's minute).
 */
function baseEqual(view) {
  const { bases = [] } = view
  const { steps } = factsOf(view)
  if (!Array.isArray(bases) || bases.length === 0) return []
  const found = []
  for (const item of steps.filter(one => stateOf(one) === 'review')) {
    const last = (item.sections?.get('History') ?? []).map(one => BOARD_CHECK.exec(String(one).trim())).filter(Boolean).at(-1)
    if (last === undefined || last[2] !== 'failed') continue
    const faults = String(last[3] ?? '').split('; ').map(one => one.trim()).filter(one => one !== '' && !one.startsWith('work in '))
    const differs = faults.map(one => BASE_FAULT.exec(one))
    if (faults.length === 0 || differs.some(one => one === null || one[1] !== one[3])) continue
    const repos = differs.map(one => bases.find(base => base.name === one[2] && base.base === one[1]))
    if (repos.some(repo => repo?.equal !== true)) continue
    const id = idOf(item)
    const said = repos.map(repo => `${repo.base} of ${repo.name} equals origin/${repo.base} now`).join(', ')
    found.push(finding('base-equal', `base-equal ${id} ${last[1]}`, id, `${id}: its check failed only on ${differs.map(one => `${one[1]} of ${one[2]}`).join(', ')} against origin, and ${said}`, { do: 'recheck', id, why: said }))
  }
  return found
}

const NOT_MERGED_FAULT = /^not merged: Your work for \S+ is on branch (\S+) \(\d+ commits?\) but not on (\S+?):/

/**
 * B962 (X137: B944's report failed the board's check twice on "not merged" while its branch was kept on purpose; its commit
 * reached main that night, and nothing checked again until the worker reported 33 hours later): a step in review whose last
 * board check failed only on work on a branch not merged is checked again, without a new report, once that branch is merged
 * into its base or gone (the view's `bases`, check.mjs `basesNow`: `unmerged` the branches the base lacks). Once per failed
 * check (its key names the check's minute). A branch still unmerged, git silent, or another fault in the same check: nothing.
 */
function mergedNow(view) {
  const { bases = [] } = view
  const { steps } = factsOf(view)
  if (!Array.isArray(bases) || bases.length === 0) return []
  const found = []
  for (const item of steps.filter(one => stateOf(one) === 'review')) {
    const last = (item.sections?.get('History') ?? []).map(one => BOARD_CHECK.exec(String(one).trim())).filter(Boolean).at(-1)
    if (last === undefined || last[2] !== 'failed') continue
    const faults = String(last[3] ?? '').split('; ').map(one => one.trim()).filter(one => one !== '' && !one.startsWith('work in '))
    const unmerged = faults.map(one => NOT_MERGED_FAULT.exec(one))
    if (faults.length === 0 || unmerged.some(one => one === null)) continue
    // Every repository must have answered, and none may still lack the branch's commits.
    if (bases.some(repo => !Array.isArray(repo.unmerged)) || unmerged.some(one => bases.some(repo => repo.base === one[2] && repo.unmerged.includes(one[1])))) continue
    const id = idOf(item)
    const said = `${unmerged.map(one => one[1]).join(', ')} is on ${[...new Set(unmerged.map(one => one[2]))].join(', ')} now`
    found.push(finding('merged-now', `merged-now ${id} ${last[1]}`, id, `${id}: its check failed only on work not merged, and ${said}`, { do: 'recheck', id, why: said }))
  }
  return found
}

/** P2 (T2.11): the faults of a failed check that the rule faults-gone can test, as the check words them (check.mjs `branchFacts`, worktrees.mjs `worktreeLine`). */
const LOCAL_FAULT = /^the branch (\S+) is still there$/
const REMOTE_FAULT = /^the branch (\S+) is still on (\S+) of (\S+)$/
const TREE_FAULT = /^the worktree (.+?) is still (?:on \S+|there):/
/** P2: the History lines that end a failed check's case: a report, a person's "Check again" (the check after them is theirs). */
const REPORTED_LINE = / → review\b|: reported again\b|: check asked again\b/
/** P2: the board's own re-run by this rule (api.mjs `recheckBase` with `again`), and the minutes after a board start in which it looks at nothing. */
const AGAIN_RUN = /\bserver: check run again by the board\b/
export const FAULTS_GONE_START_MS = 5 * MIN
const slashedPath = path => String(path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * P2 (T2.11, the person: "i dont want to wait for a week"): a step in review whose last board check failed only on faults the
 * board can test, and every one of them is gone now, is checked again without a new report: the branch left locally (gone from
 * every repository), a worktree left (no repository lists it), a branch left on origin with commits of its own (gone from
 * origin, or now on origin's base). The view's `branches` (check.mjs `faultsNow`). Once per failed check (its key names the
 * check's minute; the re-run's own line ends the case). Not while the step's check runs (`live.checking`, or its last line is
 * "check pending"), nor after a report that came after the failed check; not in the first minutes after a board start nor while a
 * landing runs (`skips`: the landing's sweep and the person's pushes are under way). A git that did not answer, a fault it
 * cannot test (a folder, a base off its remote, work not merged) or one still standing: nothing. A check that fails again is
 * written as "check run again by the board: failed: ..." (api.mjs `check`): the report-check-twice rule and the hand-over's
 * "back to you" word read only the board's own check lines, so neither counts it.
 */
function faultsGone(view) {
  const { branches = [], live = {} } = view
  const { steps } = factsOf(view)
  if (!Array.isArray(branches) || branches.length === 0) return []
  const found = []
  for (const item of steps.filter(one => stateOf(one) === 'review')) {
    const id = idOf(item)
    if ((live.checking ?? []).includes(id)) continue
    const history = (item.sections?.get('History') ?? []).map(one => String(one).trim())
    const checks = history.map((line, index) => ({ index, hit: BOARD_CHECK.exec(line) })).filter(one => one.hit !== null)
    const last = checks.at(-1)
    if (last === undefined || last.hit[2] !== 'failed') continue
    const after = history.slice(last.index + 1)
    if (after.some(line => REPORTED_LINE.test(line) || AGAIN_RUN.test(line))) continue
    const faults = String(last.hit[3] ?? '').split('; ').map(one => one.trim().replace(/^back:\s*/, '')).filter(one => one !== '' && !one.startsWith('work in '))
    if (faults.length === 0) continue
    const said = []
    let isGone = true
    for (const fault of faults) {
      const local = LOCAL_FAULT.exec(fault)
      const remote = REMOTE_FAULT.exec(fault)
      const tree = TREE_FAULT.exec(fault)
      if (local !== null) {
        if (branches.some(repo => !Array.isArray(repo.heads)) || branches.some(repo => repo.heads.includes(local[1]))) isGone = false
        else said.push(`the branch ${local[1]} is gone`)
      } else if (remote !== null) {
        const repo = branches.find(one => one.name === remote[3])
        const ref = `${remote[2]}/${remote[1]}`
        if (repo === undefined || !Array.isArray(repo.remotes)) isGone = false
        else if (!repo.remotes.includes(ref)) said.push(`${ref} is gone`)
        else if (Array.isArray(repo.remoteUnmerged) && !repo.remoteUnmerged.includes(ref)) said.push(`${ref} is on ${repo.base} now`)
        else isGone = false
      } else if (tree !== null) {
        if (branches.some(repo => !Array.isArray(repo.worktrees)) || branches.some(repo => repo.worktrees.some(path => slashedPath(path) === slashedPath(tree[1])))) isGone = false
        else said.push(`the worktree ${tree[1].split(/[\\/]/).pop()} is gone`)
      } else isGone = false
      if (!isGone) break
    }
    if (!isGone) continue
    const why = said.join(', ')
    found.push(finding('faults-gone', `faults-gone ${id} ${last.hit[1]}`, id, `${id}: its check failed only on what is gone now, and ${why}`, { do: 'recheck', id, why, again: true }))
  }
  return found
}

/** P2: why faults-gone looks at nothing now (the loop shows the reason), or null: a landing runs, or the board started minutes ago. */
function faultsGoneSkips(view) {
  const { live = {}, now } = view
  if (live.landing === true) return 'a landing runs'
  if (Number.isFinite(live.startedAt) && now - live.startedAt < FAULTS_GONE_START_MS) return 'the board started minutes ago'
  return null
}

/**
 * Every repair rule of the board's self-check, in the order the answer shows them. B590: `countsBy: 'key'` marks a rule
 * whose key names a pair (the step and what it waited on), so repair-repeats counts it by that key; without it a repair
 * counts by its rule and subject.
 */
/**
 * P7 (one status per step, chat 1's plan 2026-11-09): the focus goal has unstarted steps, the hand-out's ready list is empty and
 * a worker has been free for 10 of the board's running minutes: the state's own signal (`view.noWork`, state.mjs `noWork`,
 * src/stepStatus.mjs `noneReadyOf`, the one the Overview draws), never worked out here. One note to the main chat per cause
 * ("focus goal G60 has work, none can be handed out: B1096 held (<the hand-out's why>)"), and at most ONE word to the partner per
 * signal, listing the causes; never to the person. The review: the causes someone has are left out by the signal itself (a word
 * to the Advisor in flight, a refine waiting for answers, stopped or in the gate's line, a rebuild hold, a blocker at work); a key
 * is the step, its kind and a stable class (src/stepStatus.mjs `causeClassOf`: the blocker ids, not their state; not the refine's
 * stage) with the stamp of the free spell (`freeSince`), so a move of the blocker is no new note, and the same hold next week is.
 * Nothing while a limit is full (the hand-out gives nothing then: as closed-worker) or the person pauses.
 */
function noneReady(view) {
  const signal = view.noWork ?? null
  const { isHeld, isFull } = factsOf(view)
  if (signal === null || isHeld || isFull || !Array.isArray(signal.causes) || signal.causes.length === 0) return []
  const episode = stamp(signal.freeSince)
  const free = `(${signal.worker} free for ${signal.minutes} min)`
  const notes = signal.causes.map(cause => {
    const text = `focus goal ${signal.goal} has work, none can be handed out: ${cause.words} ${free}`
    return finding('none-ready', `none-ready ${signal.goal} ${cause.key} ${episode} main`, cause.id, text, { do: 'send', text: `${text}: see ${cause.id} (${cause.link})` })
  })
  const partner = view.partner?.name ?? null
  const partnerKey = `none-ready ${signal.goal} partner ${episode}`
  if (partner === null || (view.outbox ?? []).some(message => message.syncKey === partnerKey)) return notes
  const first = signal.causes[0]
  const list = signal.causes.map(cause => cause.words).join('; ')
  const words = `focus goal ${signal.goal} has work, none can be handed out ${free}: ${list}. Settle what holds them with the main chat (a standard's foundation, the user's pick); the board's refine gate sends every refine itself.`
  return [...notes, finding('none-ready', partnerKey, first.id, `${signal.text} ${free}`, { do: 'wake', chat: partner, id: first.id, text: words })]
}

export const REPAIR_RULES = [
  { id: 'blocked', kind: 'repair', says: 'a step blocked by one done, dropped or in review, or by one the store does not hold', check: blocked, countsBy: 'key' },
  { id: 'owner-gone', kind: 'repair', says: 'a step held by, or pinned to, a chat no longer in the list', check: ownerGone },
  { id: 'refine-drop', kind: 'repair', says: 'a yes to dropping a step in its refine, which only the main chat carries out', check: refineDrop },
  { id: 'limit-back', kind: 'repair', says: 'a worker paused for the limit after its time', check: limitBack },
  { id: 'old-name', kind: 'repair', says: 'a chat that asks under an old name', check: oldName },
  { id: 'helper', kind: 'repair', says: 'the partner\'s helper not running while refines or result checks wait', check: helperIdle },
  { id: 'closed-worker', kind: 'repair', says: 'a ready task waits with no running worker free while a worker chat is closed', check: closedWorker },
  { id: 'partner-ask', kind: 'repair', says: 'an ask routed to the partner left unanswered', check: partnerAsk },
  { id: 'unchecked', kind: 'repair', says: 'a step that waits for its result check with no QA task: the board makes one; a QA task nobody took whose step left review or waits for something else: dropped; one whose check was filed: ended', check: unchecked },
  { id: 'refine-again', kind: 'repair', says: 'a refine the Advisor took and did not write, asked again every 30 minutes, three times, then told to the person', check: refineAgain },
  { id: 'incident-again', kind: 'repair', says: 'an incident with the Supervisor that gets no close and no fix step for over 2 hours, told to the person once', check: incidentAgain },
  { id: 'held-elsewhere', kind: 'repair', says: 'a step in progress over an hour while its worker is on another step, with nothing naming why', check: heldElsewhere },
  { id: 'base-equal', kind: 'repair', says: 'a step in review whose check failed only on its base branch against the remote\'s, now equal', check: baseEqual },
  { id: 'merged-now', kind: 'repair', says: 'a step in review whose check failed only on work not merged, its branch now merged or gone', check: mergedNow },
  { id: 'faults-gone', kind: 'repair', says: 'a step in review whose check failed only on a branch or worktree left, now gone, or a branch on origin now merged', check: faultsGone, skips: faultsGoneSkips },
  { id: 'none-ready', kind: 'repair', says: 'the focus goal has work, none can be handed out, and a worker is free for 10 running minutes: told to the main chat once per cause and to the partner once per free spell', check: noneReady, countsBy: 'key' },
  { id: 'worktrees', kind: 'repair', says: 'a leftover worktree, or an empty folder one left in the project folder', check: worktrees },
]

/**
 * B590 (X37): rules that are gone (the queue rules, redesign Part 2) whose repairs still stand in the day's log, with how
 * they count. review-wait's key named the step and the one in review it waited behind; focus-ready's carried an hour.
 */
export const RETIRED_RULES = [
  { id: 'review-wait', countsBy: 'key' },
  { id: 'focus-ready' },
  // Signals change 6 (B915, Addendum 4): one watcher per condition. The repair fix-dropped (a note to the main chat) watched the
  // same dropped fix as the watch rule dropped-fix (an incident): 31 Oct 12:54 B821's dropped fix B854 gave X116 and the note
  // N1259 to Main. The watch rule stays and files it once; the repair is retired (its repairs of the day still count by rule).
  { id: 'fix-dropped' },
]

/** The rules repair-repeats counts by their key, from both tables. */
export const COUNTS_BY_KEY = new Set([...REPAIR_RULES, ...RETIRED_RULES].filter(rule => rule.countsBy === 'key').map(rule => rule.id))

/** Every check of the list, in the order the answer shows them (B465's names: `key` is the rule's id). */
export const CHECKS = REPAIR_RULES.map(rule => ({ key: rule.id, words: rule.says }))

/**
 * What is stuck now: `[{ check, key, text, fix, ... }]`, in the order of `CHECKS`, from every repair rule but the
 * worktrees' (the loop looks at those). `key` names the finding (one note to the main chat per key, ever; the board's
 * wake for it carries it as `syncKey`); `text` says what stands; `fix` what to do: `{ do: 'unblock', id, on }`,
 * `{ do: 'unpin', id }`, `{ do: 'give-back', id, chat, why }` (signals change 3: a gone owner's step back on the list), `{ do: 'recheck', id, why }` (B598: the board's check run again; P2: with `again: true` its failure is written as "check run again by the board: failed"), `{ do: 'qa', id }`, `{ do: 'qa-drop', id, why }` and `{ do: 'qa-end', id }` (T9.1.1: the board makes a step's Quality Assurance task, drops one whose step left review or is not due, or ends one whose check was filed), `{ do: 'person', id, text }` (T9.4: a note to the
 * person about `id`, its lines in `text`), `{ do: 'wake', chat, id, text }` (a line typed to the chat), `{ do: 'woken', at }` (woken
 * a moment ago: it waits for that), `{ do: 'send', text }` (a note to the main chat is the fix), `{ do: 'hand', chat, id,
 * text }` (the helper's work to the partner, and the main chat told), or `{ do: 'main', text }` (the board cannot fix
 * it: the main chat is told).
 * The input: `items` (the store), `lanes` (the board's chats, state.mjs), `partner` and `helper` (their cards, or null),
 * `outbox` (the board's messages), `limits` (state.mjs), `pause` (the store's), `refused` (`[{ name, session, first,
 * at }]`, the names the board refused a chat under), `prefix`, `now`, `appStartedAt` (when the app last started, or
 * null), `focus` (the focus goal's id, or null), `bases` (B598: check.mjs `basesNow`, or none), `branches` (P2: check.mjs `faultsNow`) and `live` (P2: `{ landing, startedAt, checking }`). The review: `seen` (a Map) holds since when the
 * runner has seen what only counts once it has lasted (an owner missing from the list, the helper not running); what
 * is seen now is added to `observed` (an array), so the runner keeps it and forgets the rest.
 */
export function findStuck({ items = new Map(), lanes = [], partner = null, helper = null, prefix = '', now, outbox = [], limits = {}, pause = null, refused = [], appStartedAt = null, focus = null, bases = [], branches = [], live = {}, ready = [], recaps = [], seen = new Map(), observed = [] }) {
  const view = { items, lanes, partner, helper, prefix, now, outbox, limits, pause, refused, appStartedAt, focus, bases, branches, live, ready, recaps }
  return REPAIR_RULES.filter(rule => rule.id !== 'worktrees').flatMap(rule => rule.check(view, { seen, observed }))
}
