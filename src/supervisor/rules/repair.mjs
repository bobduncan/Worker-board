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

import { askFiledMs, sinceMs, valueOf } from '../../work/item.mjs'
import { stamp } from '../../work/migrate.mjs'
import { blockersOpen, waitIds, waitWords } from '../../work/guards.mjs'
import { PARTNER_AGAIN_MS, isRoutedToPartner, partnerAskWords } from '../../work/partnerAnswers.mjs'
import { isHolding } from '../../work/pause.mjs'
import { gitCheckPassed, needsResultCheck, resultCheckAtMs, resultCheckOf, reviewWaitOf } from '../../work/resultCheck.mjs'
import { asksOfStep } from '../../work/stepAsks.mjs'

const MIN = 60_000
const HOUR = 60 * MIN

/** A queued step its free owner was told of this long ago and did not take is woken again. */
export const NOT_TAKEN_MS = 10 * MIN
/** A step queued this long for a chat the list no longer shows goes to another (a chat about to join has this long). */
export const OWNER_GONE_MS = 30 * MIN
/** A wake of the board's own that changed nothing in this time goes to the main chat. */
export const AGAIN_MS = 10 * MIN
/** A refusal of an old name this recent says the chat still asks under it. */
export const REFUSED_MS = 10 * MIN
/** Refusals of an old name over this long say the chat's mod does not follow the shown name by itself. */
export const REFUSED_LASTS_MS = 2 * MIN
/** B449: a step in review with no result check filed (or one the person answered) this long wakes the partner again. */
export const UNCHECKED_MS = 30 * MIN
/** The lines to the partner about refines and result checks the helper may be waited on for, this far back. */
const HELPER_LOOK_MS = 6 * 60 * MIN
/** B546: a refine or check the running partner has said or done nothing about this long waits for the helper. */
export const PARTNER_QUIET_MS = 10 * MIN
/** B550: a step queued this long for a busy worker while another is free is named to the main chat, once an hour. */
export const QUEUED_BEHIND_MS = 60 * MIN
/** B542: a queued step its free owner waits on this long behind a step in review is named to the main chat. */
export const REVIEW_WAIT_MS = 60 * MIN

/** The states in which a step is its Owner's work now. */
const HOLDS = ['taken', 'in progress', 'waiting on you']
const CLOSED = ['done', 'dropped']
/** The states of a chat at work (or waiting on the person) without a step of its own taken. */
const BUSY = ['working', 'waiting', 'interrupted']

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

/** A queued step its free owner was told of a while ago and did not take: woken again, once; then the main chat. */
function notTaken(view) {
  const { prefix = '', now, outbox = [] } = view
  const { steps, laneOf, isHeld, holds, wakeOr } = factsOf(view)
  const found = []
  if (isHeld) return found
  const done = new Set()
  for (const item of steps.filter(one => stateOf(one) === 'queued')) {
    const id = idOf(item)
    const lane = laneOf(valueOf(item, 'Owner'))
    if (lane === undefined || lane.isMain === true || lane.state !== 'free' || holds(lane.name) || done.has(lane.name)) continue
    const queuedAt = sinceMs(valueOf(item, 'Since'))
    const told = outbox.findLast(message => message.command === 'work' && message.about === id && plain(message.to, prefix) === plain(lane.name, prefix)
      && message.syncKey === undefined && ['delivered', 'taken'].includes(message.state) && !(message.at < queuedAt - MIN))
    if (told === undefined || now - told.at < NOT_TAKEN_MS) continue
    done.add(lane.name)
    const key = `not-taken ${id} ${lane.name} ${valueOf(item, 'Since') ?? ''}`.trim()
    const text = `${lane.name}: its queued ${id} waited ${minutes(now - told.at)} min while it was free`
    const fix = wakeOr(key, { do: 'wake', chat: lane.name, id, text: `work: ${id} is yours; run work next (the board's check: it waited ${minutes(now - told.at)} min)` },
      { do: 'main', text: `${lane.name} did not take ${id} after the board woke it again: look why` })
    // The supervisor: about the chat that did not take it (the same chat woken again and again is a repair that repeats).
    found.push(finding('not-taken', key, lane.name, text, fix))
  }
  return found
}

/**
 * B550 (X15: B531 queued 3 h 53 min third behind a busy worker while two workers were free): a step queued over
 * QUEUED_BEHIND_MS for a worker that is busy, while another worker is free (holds nothing, has nothing of its own to
 * take, not paused for the limit), is named to the main chat: "Requeue B<n> to <free worker>: queued <age> behind
 * <busy worker>". The board does not requeue it itself: queueing is the main chat's (the flow file). The oldest waiting
 * step goes to the first free worker (running before not running, then free longest), one step per free worker; a
 * blocked step (Blocked by or Waits for open) is skipped. Once per step an hour: the watch counts from the first time
 * it was named, and lasts while the step stays queued for the same worker, also through a run without a free worker.
 */
function queuedBehind(view, { seen = new Map(), observed = [] } = {}) {
  const { items = new Map(), prefix = '', now } = view
  const { steps, workers, laneOf, isHeld, isFull, holds } = factsOf(view)
  const found = []
  if (isHeld || isFull) return found
  const ctx = { store: { items } }
  const isOpen = item => blockersOpen(item, ctx).length === 0 && waitWords(item) === null
  const queued = steps.filter(item => stateOf(item) === 'queued')
  const watchOf = item => `queued-behind ${idOf(item)} ${plain(valueOf(item, 'Owner'), prefix)} ${valueOf(item, 'Since') ?? ''}`.trim()
  // The watch of a step named before stands while it stays queued for the same worker.
  for (const item of queued) if (seen.has(watchOf(item)) && !observed.includes(watchOf(item))) observed.push(watchOf(item))
  const isBusy = lane => holds(lane.name) || BUSY.includes(lane.state)
  const waiting = queued.filter(item => {
    const lane = laneOf(valueOf(item, 'Owner'))
    return lane !== undefined && lane.isMain !== true && isBusy(lane) && isOpen(item) && now - sinceMs(valueOf(item, 'Since')) > QUEUED_BEHIND_MS
  }).sort((a, b) => sinceMs(valueOf(a, 'Since')) - sinceMs(valueOf(b, 'Since')) || byId(a, b))
  const ownsOpen = lane => queued.some(item => plain(valueOf(item, 'Owner'), prefix) === plain(lane.name, prefix) && isOpen(item))
  const freeSince = lane => lane.idle?.since ?? now
  const free = workers.filter(lane => lane.state === 'free' && !holds(lane.name) && !ownsOpen(lane))
    .sort((a, b) => Number(b.isRunning !== false) - Number(a.isRunning !== false) || freeSince(a) - freeSince(b))
  waiting.slice(0, free.length).forEach((item, index) => {
    const id = idOf(item)
    const to = free[index].name
    const watch = watchOf(item)
    if (!observed.includes(watch)) observed.push(watch)
    const named = seen.get(watch) ?? now
    const key = `queued-behind ${id} ${valueOf(item, 'Since') ?? ''} ${Math.floor((now - named) / HOUR)}`
    const text = `Requeue ${id} to ${to}: queued ${hoursOf(now - sinceMs(valueOf(item, 'Since')))} behind ${laneOf(valueOf(item, 'Owner')).name}`
    found.push(finding('queued-behind', key, id, text, { do: 'send', text }))
  })
  return found
}

/**
 * B542 (X7: B500 and B510 waited hours behind B502, in review with its check running, while their workers were free):
 * a step queued REVIEW_WAIT_MS with its owner free that a step in review still blocks (its check not passed, so
 * `blocked` leaves it): the main chat hears it once per pair, as a note naming both.
 */
function reviewWait(view) {
  const { items = new Map(), now } = view
  const { steps, laneOf, isHeld, holds } = factsOf(view)
  const found = []
  if (isHeld) return found
  for (const item of steps.filter(one => stateOf(one) === 'queued')) {
    const id = idOf(item)
    const lane = laneOf(valueOf(item, 'Owner'))
    if (lane === undefined || lane.isMain === true || lane.state !== 'free' || holds(lane.name)) continue
    const since = Math.max(sinceMs(valueOf(item, 'Since')), Number.isFinite(lane.idle?.since) ? lane.idle.since : -Infinity)
    if (!(now - since >= REVIEW_WAIT_MS)) continue
    for (const on of [...new Set([...idsIn(valueOf(item, 'Blocked by')), ...waitIds(item).filter(one => /^B\d+$/.test(one))])]) {
      const other = items.get(on)
      if (other === undefined || stateOf(other) !== 'review' || isMergedAndChecked(other)) continue
      const text = `${id} waits for the check of ${on}: queued ${minutes(now - since)} min while ${lane.name} is free`
      found.push(finding('review-wait', `review-wait ${id} ${on}`, id, text, { do: 'send', text: `${text}; ${on} is in review: see that it is checked, or give ${lane.name} other work` }))
    }
  }
  return found
}

/**
 * A step owned by a chat the list no longer shows: a queued one goes to a free worker; one it held is the main chat's.
 * The review: only once the owner has been missing for OWNER_GONE_MS by the runner's own watch (a chat file the app
 * rewrites is skipped for one read, an account switch drops chats for a while), and never while the person pauses.
 */
function ownerGone(view, { seen = new Map(), observed = [] } = {}) {
  const { partner = null, helper = null, prefix = '', now } = view
  const { steps, workers, laneOf, isHeld, holds } = factsOf(view)
  const found = []
  if (!(workers.length > 0 && !isHeld)) return found
  const known = name => laneOf(name) !== undefined || [partner, helper].some(card => card !== null && plain(card.name, prefix) === plain(name, prefix))
  const given = new Map()
  const queuedFor = name => steps.filter(item => stateOf(item) === 'queued' && plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix)).length + (given.get(name) ?? 0)
  for (const item of steps.filter(one => ['queued', ...HOLDS].includes(stateOf(one)) && valueOf(one, 'Owner') !== null)) {
    const id = idOf(item)
    const owner = valueOf(item, 'Owner')
    if (known(owner)) continue
    const watch = `missing ${plain(owner, prefix)}`
    if (!observed.includes(watch)) observed.push(watch)
    if (!(now - (seen.get(watch) ?? now) >= OWNER_GONE_MS)) continue
    const key = `owner-gone ${id} ${owner}`
    if (stateOf(item) !== 'queued') {
      const text = `${id} is ${stateOf(item)} for ${owner}, no longer in the list`
      found.push(finding('owner-gone', key, id, text, { do: 'main', text: `${text}: hand it on (its work may stand on a branch)` }))
      continue
    }
    const free = workers.filter(lane => lane.state === 'free' && !holds(lane.name))
      .sort((a, b) => Number(b.isRunning !== false) - Number(a.isRunning !== false) || queuedFor(a.name) - queuedFor(b.name))
    const text = `${id} was queued for ${owner}, no longer in the list`
    if (free.length === 0) {
      found.push(finding('owner-gone', key, id, text, { do: 'main', text: `${text}, and no worker is free: queue it for another` }))
      continue
    }
    given.set(free[0].name, (given.get(free[0].name) ?? 0) + 1)
    found.push(finding('owner-gone', key, id, text, { do: 'requeue', id, to: free[0].name }))
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
    const fix = wakeOr(key, { do: 'wake', chat: lane.name, id, text: `work: the limit is back: go on with ${id} from its checkpoint; run work next` },
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
    const lately = outbox.some(message => message.about === id && (message.kind === 'partner-ask' || String(message.syncKey ?? '').startsWith('partner-ask '))
      && (message.state === 'waiting' || message.state === 'taken' || now - message.at < PARTNER_AGAIN_MS))
    if (lately) continue
    const key = `partner-ask ${id} ${Math.floor((now - filed) / PARTNER_AGAIN_MS)}`
    found.push(finding('partner-ask', key, id, `${id} routed to ${partner.name}, unanswered for ${minutes(now - filed)} min`, { do: 'wake', chat: partner.name, id, text: partnerAskWords(id) }))
  }
  return found
}

/**
 * B449 (G11's re-check: reports that sat unchecked, and checks that waited on an answer already given): a step in
 * review whose board check passed and whose result check was never filed, or waits for the person with every ask
 * under it answered, for 30 minutes: the partner is woken with "check step B<id>", once per 30 minutes (a line to
 * it about the step still waiting, or sent within that time, counts as the wake).
 */
function unchecked(view) {
  const { partner = null, now, outbox = [] } = view
  const { all, steps, isHeld } = factsOf(view)
  const found = []
  if (!(partner !== null && !isHeld)) return found
  for (const item of steps.filter(one => stateOf(one) === 'review' && gitCheckPassed(one) && needsResultCheck(one))) {
    const id = idOf(item)
    const result = resultCheckOf(item)
    const open = all.some(one => kindOf(one) === 'ask' && valueOf(one, 'Of') === id && stateOf(one) === 'open')
    if (result === 'waits' ? open : result !== null) continue
    const since = result === 'waits' ? resultCheckAtMs(item) : sinceMs(valueOf(item, 'Since'))
    if (!(now - since >= UNCHECKED_MS)) continue
    const lately = outbox.some(message => message.about === id && (message.command === 'result-check' || String(message.syncKey ?? '').startsWith('unchecked '))
      && (message.state === 'waiting' || now - message.at < UNCHECKED_MS))
    if (lately) continue
    const key = `unchecked ${id} ${Math.floor((now - since) / UNCHECKED_MS)}`
    const text = `${id} in review ${minutes(now - since)} min with ${result === 'waits' ? 'its ask point answered and no check filed again' : 'no result check'}`
    found.push(finding('unchecked', key, id, text, { do: 'wake', chat: partner.name, id, text: `check step ${id}${result === 'waits' ? ' (its ask point is answered: file the result check again)' : ''}; see roles/partner.md, "The check"` }))
  }
  return found
}

/**
 * B543 (the fix of X8: a step sat in review for 3 days after its fix was dropped, as nothing closes it then): a step in
 * review whose check failed and whose fix was dropped, none other open or done, for 30 minutes: the main chat gets one
 * word, close it or have it checked again; once per step and fix (the loop tells the main chat of a key once).
 */
function fixDropped(view) {
  const { items = new Map(), now } = view
  const { steps, isHeld } = factsOf(view)
  if (isHeld) return []
  return steps.filter(one => stateOf(one) === 'review').flatMap(item => {
    const wait = reviewWaitOf(item, items)
    if (wait?.kind !== 'dropped' || !(now - wait.since >= UNCHECKED_MS)) return []
    const id = idOf(item)
    const text = `${id} waits in review, but ${wait.text}`
    return [finding('fix-dropped', `fix-dropped ${id} ${wait.fix ?? 'none'}`, id, text,
      { do: 'send', text: `${text}: close it (work drop ${id}, or the person marks it done) or have it checked again (work report ${id})` })]
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

/** Every repair rule of the board's self-check, in the order the answer shows them. */
export const REPAIR_RULES = [
  { id: 'blocked', kind: 'repair', says: 'a step blocked by one done, dropped or in review, or by one the store does not hold', check: blocked },
  { id: 'not-taken', kind: 'repair', says: 'a queued step its free owner was told of and did not take', check: notTaken },
  { id: 'queued-behind', kind: 'repair', says: 'a step queued over an hour behind a busy worker while another worker is free', check: queuedBehind },
  { id: 'review-wait', kind: 'repair', says: 'a queued step its free owner waits on for an hour behind a step in review', check: reviewWait },
  { id: 'owner-gone', kind: 'repair', says: 'a step owned by a chat no longer in the list', check: ownerGone },
  { id: 'refine-drop', kind: 'repair', says: 'a yes to dropping a step in its refine, which only the main chat carries out', check: refineDrop },
  { id: 'limit-back', kind: 'repair', says: 'a worker paused for the limit after its time', check: limitBack },
  { id: 'old-name', kind: 'repair', says: 'a chat that asks under an old name', check: oldName },
  { id: 'helper', kind: 'repair', says: 'the partner\'s helper not running while refines or result checks wait', check: helperIdle },
  { id: 'partner-ask', kind: 'repair', says: 'an ask routed to the partner left unanswered', check: partnerAsk },
  { id: 'unchecked', kind: 'repair', says: 'a reported step left without its result check, or with its ask point answered and no check filed again', check: unchecked },
  { id: 'fix-dropped', kind: 'repair', says: 'a step in review whose fix was dropped, which nothing closes', check: fixDropped },
  { id: 'worktrees', kind: 'repair', says: 'a leftover worktree, or an empty folder one left in the project folder', check: worktrees },
]

/** Every check of the list, in the order the answer shows them (B465's names: `key` is the rule's id). */
export const CHECKS = REPAIR_RULES.map(rule => ({ key: rule.id, words: rule.says }))

/**
 * What is stuck now: `[{ check, key, text, fix, ... }]`, in the order of `CHECKS`, from every repair rule but the
 * worktrees' (the loop looks at those). `key` names the finding (one note to the main chat per key, ever; the board's
 * wake for it carries it as `syncKey`); `text` says what stands; `fix` what to do: `{ do: 'unblock', id, on }`,
 * `{ do: 'requeue', id, to }`, `{ do: 'wake', chat, id, text }` (a line typed to the chat), `{ do: 'woken', at }` (woken
 * a moment ago: it waits for that), `{ do: 'send', text }` (a note to the main chat is the fix), `{ do: 'hand', chat, id,
 * text }` (the helper's work to the partner, and the main chat told), or `{ do: 'main', text }` (the board cannot fix
 * it: the main chat is told).
 * The input: `items` (the store), `lanes` (the board's chats, state.mjs), `partner` and `helper` (their cards, or null),
 * `outbox` (the board's messages), `limits` (state.mjs), `pause` (the store's), `refused` (`[{ name, session, first,
 * at }]`, the names the board refused a chat under), `prefix`, `now`, `appStartedAt` (when the app last started, or
 * null). The review: `seen` (a Map) holds since when the
 * runner has seen what only counts once it has lasted (an owner missing from the list, the helper not running); what
 * is seen now is added to `observed` (an array), so the runner keeps it and forgets the rest.
 */
export function findStuck({ items = new Map(), lanes = [], partner = null, helper = null, prefix = '', now, outbox = [], limits = {}, pause = null, refused = [], appStartedAt = null, seen = new Map(), observed = [] }) {
  const view = { items, lanes, partner, helper, prefix, now, outbox, limits, pause, refused, appStartedAt }
  return REPAIR_RULES.filter(rule => rule.id !== 'worktrees').flatMap(rule => rule.check(view, { seen, observed }))
}
