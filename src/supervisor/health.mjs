// The supervisor's health summary (spec 2026-10-24, "The AI sweep"): what the supervisor chat reads with `work health`
// before it judges whether anything looks wrong for how the board should work. One plain text of at most HEALTH_CHARS
// characters, from the supervisor's one read-only view (view.mjs): each chat's state and for how long, its model and
// effort beside its step's, its last report and its last clear and why; each open step's state, age and owner; the
// queues; the repairs and incidents of the last day; the words not delivered; the limits and the pause. When it must cut,
// the newest and oddest lines stay, and so do the steps every chat holds. PURE.

import { chatEffort, effortOf, modelOf } from '../work/effort.mjs'
import { sinceMs, valueOf } from '../work/item.mjs'
import { checkpointOf, isHolding } from '../work/pause.mjs'
import { isFailedForGood } from '../work/outboxSweep.mjs'
import { openQaTaskOf, qaStandOf } from '../work/qaTask.mjs'
import { reviewWaitOf } from '../work/resultCheck.mjs'
import { ACTIVE, heldReason, openAskIds, workingOnOther } from '../work/parked.mjs'
import { readingAgeMinutes } from '../limits.mjs'
import { boardOffMs, checkpointLate, familyOf, reviewLateOf, switchOf, undeliveredWords, wordMatters } from './rules/watch.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** The longest summary `work health` answers. */
export const HEALTH_CHARS = 8000
/** The longest line of it; a chat's line may be longer. */
const LINE_CHARS = 240
const CHAT_CHARS = 400
/** A step that stands this long in a state of work counts as odd. */
const LONG_MS = { taken: 30 * MIN, 'in progress': 3 * HOUR, 'waiting on you': 6 * HOUR, review: HOUR, queued: 2 * HOUR }
/** The states of a step that are under way: queued for a chat, held by it, or waiting for its check. */
const UNDER_WAY = ['queued', 'taken', 'in progress', 'waiting on you', 'review']
const HELD = ['taken', 'in progress', 'waiting on you', 'review']
const ODD_STATES = ['unknown', 'off', 'interrupted', 'suspended']
const REPORTED = / → review\b|: reported again\b/

const pad = n => String(n).padStart(2, '0')
const clockOf = ms => (Number.isFinite(ms) ? `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}` : 'not known')
/**
 * B542 (X10: "18:13 round to Advisor: waiting for 9 d" read as an age that did not fit its time; the word was of 15
 * October): a time of today as its clock, one of another day with its date before it.
 */
const dayClockOf = (ms, now) => {
  if (!Number.isFinite(ms)) return 'not known'
  const day = new Date(ms)
  return day.toDateString() === new Date(now).toDateString() ? clockOf(ms) : `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())} ${clockOf(ms)}`
}
/** A span in words: "45 min", "2 h 10 min", "3 d". */
function lasting(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'not known'
  if (ms < HOUR) return `${Math.floor(ms / MIN)} min`
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)} h${Math.floor((ms % HOUR) / MIN) > 0 ? ` ${Math.floor((ms % HOUR) / MIN)} min` : ''}`
  return `${Math.floor(ms / DAY)} d`
}
/** One line of words, no line ends, at most `max` characters. */
const oneLine = (value, max = LINE_CHARS) => {
  const words = String(value ?? '').replace(/\s+/g, ' ').trim()
  return words.length <= max ? words : `${words.slice(0, max - 1)}…`
}
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const byId = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })

const kindOf = item => valueOf(item, 'Kind') ?? 'step'
const stepsOf = view => [...view.items.values()].filter(item => kindOf(item) === 'step' && typeof valueOf(item, 'Id') === 'string')
/** When a History line was written: "- 2026-10-24 09:00 who: what". */
const historyAt = line => sinceMs(String(line).replace(/^-\s+/, '').slice(0, 16))

/** A line of the summary: its words, how much it must stay (0 always, 1 before the rest, 2 the rest), odd or not, and when. */
const lineOf = (text, { tier = 2, odd = false, at = -Infinity, max = LINE_CHARS } = {}) => ({ text: `- ${oneLine(text, max)}`, tier, odd, at: Number.isFinite(at) ? at : -Infinity })

/** Each chat: the main chat and the workers, then the partner and its helper. */
function chatLines(view, now) {
  const chats = [
    ...view.lanes.filter(lane => !lane.isLeftover).map(lane => ({ lane, role: lane.isMain ? 'main' : 'worker' })),
    ...(view.partner === null ? [] : [{ lane: view.partner, role: 'partner' }]),
    ...(view.helper === null ? [] : [{ lane: view.helper, role: "partner's helper" }]),
  ]
  const steps = stepsOf(view)
  return chats.map(({ lane, role }) => {
    const mine = steps.filter(item => plain(valueOf(item, 'Owner'), view.prefix) === plain(lane.name, view.prefix))
    const since = view.since.get(lane.name)
    const state = `${lane.state ?? 'not known'}${Number.isFinite(since) ? ` since ${dayClockOf(since, now)} (${lasting(now - since)})` : ''}`
    // T13 part 3: an asleep chat (its process ended while its last report stands) is woken by the board's message, no fault.
    const running = lane.isRunning === false ? (lane.asleep === true ? `, asleep${Number.isFinite(lane.asleepSince) ? ` since ${dayClockOf(lane.asleepSince, now)}` : ''} (the board's message wakes it)` : ', its chat does not run') : ''
    // B544: the level, never the partner's mode object ("[object Object]", X9).
    const runs = `runs ${familyOf(lane.model) ?? 'a model not known'} · ${chatEffort(lane) ?? 'effort not known'}`
    // The step it is on: its card's, else the one the store holds for it.
    const onId = lane.task?.stepId ?? mine.find(item => HELD.slice(0, 3).includes(valueOf(item, 'State')))?.head.get('Id') ?? null
    const on = onId === null ? null : view.items.get(onId) ?? null
    // B576 (X26): how the switch to the step's setting stands; a mismatch is odd only once it lasts after the take.
    const switching = on === null ? null : switchOf(lane, on, view)
    const wants = on === null ? '' : `; its step ${onId} wants ${modelOf(on).family} · ${effortOf(on).level}${switchWords(switching, now)}`
    // X76 (B708): a step the board has just handed over (queued for it) is its step before it takes it: working on it is no odd one.
    const handed = onId === null ? mine.find(item => valueOf(item, 'State') === 'queued')?.head.get('Id') ?? null : null
    const onWords = onId === null ? `; on no step${handed === null ? '' : `; ${handed} handed to it`}` : `; on ${onId}${on === null ? '' : ` "${oneLine(valueOf(on, 'Title'), 60)}" (${valueOf(on, 'State')})`}`
    const reports = mine.flatMap(item => (item.sections?.get('History') ?? []).filter(line => REPORTED.test(line)).map(line => ({ id: valueOf(item, 'Id'), at: historyAt(line) })))
      .filter(one => Number.isFinite(one.at)).sort((a, b) => b.at - a.at)
    const report = reports.length === 0 ? '; no report known' : `; last report ${reports[0].id} at ${dayClockOf(reports[0].at, now)}`
    // X51 to X53: a worker stopped on purpose says so (and is no odd one); one parked for other steps is no limit stop.
    const purpose = onPurposeOf(lane, on, view)
    const suspended = purpose !== null ? ` (on purpose: ${purpose})`
      : lane.state === 'suspended' && lane.suspended !== null && typeof lane.suspended === 'object'
        ? ` (for ${lane.suspended.limit ?? 'a limit'}${Number.isFinite(lane.suspended.until) ? ` until ${dayClockOf(lane.suspended.until, now)}` : ''}${lane.suspended.isBack === true ? ', the limit is back' : ''})` : ''
    // The review of chat-reports: a worker that waits for the partner's answer between two turns is no odd one.
    const waitsForPartner = Array.isArray(lane.waitsForPartner) && lane.waitsForPartner.length > 0
    // X46: a chat that is off or unknown, does not run and holds no step is closed, which is normal.
    const isClosed = (lane.state === 'off' || lane.state === 'unknown') && lane.isRunning !== true && onId === null
    const odd = (purpose === null && !isClosed && lane.asleep !== true && (ODD_STATES.includes(lane.state) || (lane.isRunning === false && onId !== null)))
      || (lane.state === 'working' && onId === null && handed === null && role === 'worker' && !waitsForPartner) || (role === 'worker' && switching?.late === true)
    return lineOf(`${lane.name} (${role}): ${state}${suspended}${running}; ${runs}${wants}${onWords}${report}; ${clearWords(lane.compaction, now)}`, { tier: 0, odd, at: since, max: CHAT_CHARS })
  })
}

/**
 * X51, X52, X53 (false alarms: Workers 3 and 4 "interrupted" on B611 and B613 while both waited for B623; three workers
 * "suspended for a limit" with room in the limits): why a worker that stands interrupted or suspended does so on purpose,
 * or null. Its lane says it is parked (`suspended.by` 'parked', the lane's "Suspended on purpose": the steps it waits
 * for), or, interrupted, the step it holds (`held`) waits for another open step (`waitsOf`) or for the person's answer
 * (the step waiting on you, or an ask under it open). A stop for a limit (the app's, a note's) is not on purpose: the
 * limits judge it. What the person parked without a fact in the store shows only in the step's checkpoint line.
 */
function onPurposeOf(lane, held, view) {
  if (lane.state === 'suspended') {
    if (lane.suspended?.by !== 'parked') return null
    const on = Array.isArray(lane.suspended.on) ? lane.suspended.on.filter(id => typeof id === 'string') : []
    return on.length === 0 ? 'parked' : `waits for ${on.join(' and ')}`
  }
  if (lane.state !== 'interrupted' || held === null) return null
  const id = valueOf(held, 'Id')
  const waits = waitsOf(held, view.items)
  if (waits.length > 0) return `its step ${id} waits for ${waits.join('; ')}`
  if (valueOf(held, 'State') === 'waiting on you' || openAskIds(view.items, id).length > 0) return `its step ${id} waits for your answer`
  return null
}

/** B576: the switch beside "wants": "(switched)", "(switch asked HH:MM)", and once it lasts how long after the take. */
function switchWords(switching, now) {
  if (switching === null || (!switching.mismatch && switching.state !== 'switched')) return ''
  if (switching.state === 'switched') return ' (switched)'
  const asked = switching.state === 'asked' ? `switch asked ${dayClockOf(switching.askedAt, now)}` : ''
  if (!switching.late) return asked === '' ? '' : ` (${asked})`
  return ` (${asked === '' ? 'no switch asked' : `${asked}, not read back`}, ${lasting(switching.since)} after the take)`
}

/** The Workers mod's last word on a clear or a compaction of the chat, with why it did not clear. */
function clearWords(compaction, now) {
  if (compaction === null || compaction === undefined) return 'no clear known'
  if (compaction.kind === 'cleared') return `cleared at ${dayClockOf(compaction.at, now)}${compaction.step ? ` after ${compaction.step}` : ''}`
  // B547: the mod's newest word is why it did not clear; the clear before it, when there was one.
  if (compaction.kind === 'not-cleared') return `not cleared at ${dayClockOf(compaction.at, now)}: ${compaction.why}${compaction.lastCleared ? `; last cleared at ${dayClockOf(compaction.lastCleared.at, now)}${compaction.lastCleared.step ? ` after ${compaction.lastCleared.step}` : ''}` : ''}`
  const not = compaction.notCleared ? `not cleared at ${dayClockOf(compaction.notCleared.at, now)}: ${compaction.notCleared.why}; ` : ''
  if (compaction.kind === 'compacted') return `${not}compacted at ${dayClockOf(compaction.at, now)}`
  return `${not}compaction skipped at ${dayClockOf(compaction.at, now)}: ${compaction.why ?? 'no reason given'}`
}

/**
 * B542 (X10: "B506 in progress 20 min (waits for B503)", B503 long done): what still holds a step: the steps its
 * `Blocked by` names that are not done or dropped (one in review as "the check of B<n>"), and its `Waits for` words
 * while they name no step or one such step.
 */
function waitsOf(item, items) {
  const stateOfId = id => valueOf(items.get(id) ?? { head: new Map() }, 'State')
  const holds = id => !['done', 'dropped'].includes(stateOfId(id))
  const named = id => (stateOfId(id) === 'review' ? `the check of ${id}` : id)
  const blockers = (valueOf(item, 'Blocked by') ?? '').match(/\bB\d+\b/g) ?? []
  const words = valueOf(item, 'Waits for')
  const ids = (words ?? '').match(/\bB\d+\b/g) ?? []
  return [
    blockers.filter(holds).map(named).join(' and '),
    words !== null && words !== '-' && (ids.length === 0 || ids.some(holds)) ? words : '',
  ].filter(one => one !== '')
}

const stateIn = (items, id) => valueOf(items.get(id) ?? { head: new Map() }, 'State')
const ageOf = (item, now) => now - sinceMs(valueOf(item, 'Since'))
const ENDED = ['done', 'dropped']

/**
 * B561 (X15: B531 queued 4 h 35 min, Blocked by B522 in progress 1 h 23 min on the same worker, read as stuck): what a
 * queued step waits for as planned: the steps its `Blocked by` names and those its `Waits for` names that are in the
 * store and not done or dropped (`open`), and which of them are stalled themselves (`stalled`: past their state's
 * limit and not waiting as planned in turn; a loop of waits counts as stalled). Null when it waits for no open step.
 */
function plannedWait(item, view, now, seen = new Set()) {
  if (valueOf(item, 'State') !== 'queued') return null
  const named = field => (valueOf(item, field) ?? '').match(/\bB\d+\b/g) ?? []
  const open = [...new Set([...named('Blocked by'), ...named('Waits for')])].filter(id => view.items.has(id) && !ENDED.includes(stateIn(view.items, id)))
  if (open.length === 0) return null
  const chain = new Set([...seen, valueOf(item, 'Id')])
  return { open, stalled: open.filter(id => chain.has(id) || isLate(view.items.get(id), view, now, chain)) }
}

/**
 * B563 (X19: B510 waiting for the person's answer and B532 for its queued fix B548 read as unchecked for their age):
 * whether a step in review is odd by what it waits for (resultCheck.mjs `reviewWaitOf`, as the review-stuck rule reads
 * it): the person's answer, never; its open fix, when that fix is odd itself (a loop of fixes counts as odd); its check,
 * past `reviewMinutes`; its dropped fix, always, unless the step is blocked by an open step that is not stalled itself
 * (B630: then it waits as planned). Null when it waits for none of these: its age decides.
 */
function reviewLate(item, view, now, seen) {
  const wait = reviewWaitOf(item, view.items, view.held, now, view.recaps)
  if (wait === null) return null
  // B664 (X8 a third time: a "!" on review where the rules stayed quiet, the gap of B660 and B662): the person's answer,
  // a check, a dropped fix and a fix the ready list holds are judged as the watch rules judge them (watch.mjs
  // `reviewLateOf`), with the supervisor's memory of when it first saw each (`view.seen`).
  const judged = reviewLateOf({ ...view, now }, item, wait, key => view.seen?.get(key))
  if (judged !== null) return judged.late
  if (wait.kind === 'fix') {
    const chain = new Set([...seen, valueOf(item, 'Id')])
    const fix = view.items.get(wait.fix)
    return chain.has(wait.fix) || isLate(fix, view, now, chain) || ownerGone(fix, view)
  }
  if (wait.kind === 'blocked') {
    // B630 (X54): its dropped fix waits on open steps; odd only when one of them is stalled itself.
    const chain = new Set([...seen, valueOf(item, 'Id')])
    return wait.blockers.some(blocker => chain.has(blocker) || isLate(view.items.get(blocker), view, now, chain))
  }
  return true
}

/** A step owned by a chat the board does not show. */
const ownerGone = (item, view) => {
  const owner = valueOf(item, 'Owner')
  return owner !== null && !view.lanes.some(lane => !lane.isLeftover && plain(lane.name, view.prefix) === plain(owner, view.prefix))
}

/** A step past its state's limit (LONG_MS), unless it waits as planned (B561, B563) or stays with its busy builder. */
function isLate(item, view, now, seen = new Set()) {
  const review = reviewLate(item, view, now, seen)
  if (review !== null) return review
  const age = ageOf(item, now)
  if (!(Number.isFinite(age) && age > (LONG_MS[valueOf(item, 'State')] ?? Infinity))) return false
  if (staysWith(item, view) !== null && builderHolds(item, view)) return false
  const wait = plannedWait(item, view, now, seen)
  return wait === null || wait.stalled.length > 0
}

/**
 * B560 (X17: B558 queued behind its busy builder read as a step that should move): a result check's fix waits for the
 * worker that built the step it fixes, as the flow queues it and the queued-behind rule keeps it. The step it fixes, or
 * null when it is no such fix.
 */
function staysWith(item, view) {
  const owner = valueOf(item, 'Owner')
  const fixOf = valueOf(item, 'Fix of') ?? ''
  const builder = /^B\d+$/.test(fixOf) ? valueOf(view.items.get(fixOf) ?? { head: new Map() }, 'Owner') : null
  return valueOf(item, 'State') === 'queued' && owner !== null && builder !== null && plain(builder, view.prefix) === plain(owner, view.prefix) ? fixOf : null
}

/** B561: the step's owner holds another step (taken, in progress or waiting on you), on its card or in the store. */
function builderHolds(item, view) {
  const owner = plain(valueOf(item, 'Owner'), view.prefix)
  const id = valueOf(item, 'Id')
  const card = view.lanes.find(lane => !lane.isLeftover && plain(lane.name, view.prefix) === owner)?.task?.stepId ?? null
  return (card !== null && card !== id) || stepsOf(view).some(other => valueOf(other, 'Id') !== id && plain(valueOf(other, 'Owner'), view.prefix) === owner && HELD.slice(0, 3).includes(valueOf(other, 'State')))
}

/**
 * B567 (X21, X23): a step its owner holds (taken, in progress or waiting on you) while the owner is on another step: its
 * card's step when that is another, else another step it holds taken or in progress. `{ on, why }` (`why` parked.mjs
 * `heldReason`, null when nothing names it), or null.
 */
function parkedOf(item, view) {
  if (!HELD.slice(0, 3).includes(valueOf(item, 'State')) || valueOf(item, 'Owner') === null) return null
  const id = valueOf(item, 'Id')
  const owner = plain(valueOf(item, 'Owner'), view.prefix)
  const card = view.lanes.find(lane => !lane.isLeftover && plain(lane.name, view.prefix) === owner)?.task?.stepId ?? null
  if (card === id) return null
  // Without a card: the newest step it holds taken or in progress is the one it is on, unless that is this one.
  const other = workingOnOther(view.items, item, view.prefix)
  const isOlder = other !== null && (!ACTIVE.includes(valueOf(item, 'State')) || !(sinceMs(valueOf(item, 'Since')) > sinceMs(valueOf(view.items.get(other), 'Since'))))
  const on = card ?? (isOlder ? other : null)
  return on === null ? null : { on, why: heldReason(item, view.items) }
}

/** Each step under way: its state, for how long, its owner; the backlog's new and refined steps counted in one line. */
function stepLines(view, now) {
  const chats = new Set(view.lanes.filter(lane => !lane.isLeftover).map(lane => plain(lane.name, view.prefix)))
  const lines = []
  const backlog = { new: 0, refined: 0 }
  const review = { steps: 0, chains: 0, held: 0, late: 0 }
  for (const item of stepsOf(view)) {
    const state = valueOf(item, 'State')
    if (state === 'new' || state === 'refined') {
      backlog[state] += 1
      continue
    }
    if (!UNDER_WAY.includes(state)) continue
    const id = valueOf(item, 'Id')
    // B656 (X8 again: 16 steps in review read as 16 stalls, most of them links of a few chains of fixes): a step in review
    // that is the open fix its own step in review waits for is a link of that chain; the chain's first step speaks for it.
    if (state === 'review') {
      review.steps += 1
      if (isChainLink(item, view)) continue
      review.chains += 1
    }
    const owner = valueOf(item, 'Owner')
    const since = sinceMs(valueOf(item, 'Since'))
    // B727 (X84: a 20 h sleep read as 'B726 in progress 20 h 52 min'): a step's and its checkpoint's age count the board's running time (boardOffMs, the stale-checkpoint rule's own count) and name the off time inside.
    const off = boardOffMs(view, since)
    const age = now - since - off
    const fix = valueOf(item, 'Priority') === 'fix' ? ', board fix' : ''
    const isChats = owner !== null && chats.has(plain(owner, view.prefix))
    const fixOf = staysWith(item, view)
    const stays = fixOf === null ? '' : ` (stays with ${owner}: fix of ${fixOf})`
    // B561: a step that waits for open steps names each with its state and age; a stalled one says so.
    const wait = plannedWait(item, view, now)
    const blockerWords = blocker => `${stateIn(view.items, blocker) === 'review' ? `the check of ${blocker}` : blocker} (${stateIn(view.items, blocker)} ${lasting(ageOf(view.items.get(blocker), now))}${wait.stalled.includes(blocker) ? ', stalled' : ''})`
    const blocked = waitsOf(item, view.items)
    const ended = state === 'queued' ? ((valueOf(item, 'Blocked by') ?? '').match(/\bB\d+\b/g) ?? []).filter(blocker => ENDED.includes(stateIn(view.items, blocker))) : []
    // B563: a step in review names what it waits for, its open fix with that fix's state and owner; B656: its chain's
    // newest link and why that one waits.
    const reviewWait = reviewWaitOf(item, view.items, view.held, now, view.recaps)
    if (reviewWait?.kind === 'fix' && reviewWait.held !== null) {
      review.held += 1
      // B664 (X8 a third time: the line had a "!" for a hold the rules were quiet on): odd only for a hold the rules call late.
      if (isLate(item, view, now)) review.late += 1
    }
    const fixWords = reviewWait?.kind === 'fix' ? chainWords(id, reviewWait, view)
      : reviewWait?.kind === 'check' ? checkAskedWords(view, id, reviewWait.since, now) : ''
    const waits = reviewWait !== null ? ` (${reviewWait.text}${fixWords})`
      : wait !== null ? ` (waits${wait.stalled.length === 0 ? ' as planned' : ''} for ${wait.open.map(blockerWords).join(' and ')})`
      : blocked.length > 0 ? ` (waits for ${blocked.join('; ')})`
        : ended.length > 0 ? ` (still blocked by ${ended.map(blocker => `${blocker}, ${stateIn(view.items, blocker)}`).join(' and ')})` : ''
    // B572 (X24): a step in progress shows its last checkpoint, its age, commit and next action; a stale one is odd
    const checkpoint = state === 'in progress' ? checkpointOf(item) : null
    const checkpointWords = state !== 'in progress' ? ''
      : checkpoint === null ? ' [no checkpoint]'
        : ` [last checkpoint ${Number.isFinite(checkpoint.at) ? `${lasting(now - checkpoint.at - boardOffMs(view, checkpoint.at))} ago` : 'at a time not known'} (${checkpoint.commit ?? 'none'}): ${oneLine(checkpoint.next, 60)}]`
    // The steps every chat holds stay whatever is cut; a chat's queue before the rest.
    const tier = isChats && HELD.includes(state) ? 0 : isChats ? 1 : 2
    // B567: a step its worker holds while it is on another says so, with why it waits; none named is odd.
    const parked = parkedOf(item, view)
    const odd = isLate(item, view, now) || (owner !== null && !isChats) || checkpointLate(item, { ...view, now }) !== null || (parked !== null && parked.why === null)
    const parkedWords = parked === null ? '' : ` (parked: ${owner} is on ${parked.on}; ${parked.why ?? 'nothing names why it waits'})`
    lines.push(lineOf(`${id} ${state} for ${lasting(age)}${off > 0 ? ` (PC off ${lasting(off)})` : ''}${stays}, ${owner === null ? 'no owner' : owner}${fix}${waits}${parkedWords}${checkpointWords}: ${oneLine(valueOf(item, 'Title'), 80)}`, { tier, odd, at: since }))
  }
  if (review.steps > 0) lines.push(lineOf(`in review: ${review.steps} ${review.steps === 1 ? 'step' : 'steps'} in ${review.chains} ${review.chains === 1 ? 'chain' : 'chains'} of fixes${review.held > 0 ? `, ${review.held} behind a fix the ready list holds` : ''}`, { tier: 1, odd: review.late > 0 }))
  if (backlog.new + backlog.refined > 0) lines.push(lineOf(`backlog, not queued: ${backlog.new} new, ${backlog.refined} refined${refinedWords(view)}`, { tier: 1 }))
  return lines
}

/** B656: a step in review that is the open fix its own step, in review too, waits for: a link of that one's chain. */
function isChainLink(item, view) {
  const of = valueOf(item, 'Fix of')
  const parent = of === null ? undefined : view.items.get(of)
  return parent !== undefined && valueOf(parent, 'State') === 'review' && reviewWaitOf(parent, view.items, null, view.now, view.recaps)?.fix === valueOf(item, 'Id')
}

/**
 * B656: the words after a chain's wait in its line: the open fix's state and owner; with links in review, how many steps
 * the chain holds in review and its newest link, with that one's state, owner and what it waits for itself.
 */
function chainWords(id, wait, view) {
  const links = wait.chain.filter(link => stateIn(view.items, link) === 'review')
  const owner = link => valueOf(view.items.get(link), 'Owner') ?? 'no owner'
  if (links.length === 0 && wait.end === wait.fix) return ` (${stateIn(view.items, wait.fix)}, ${owner(wait.fix)})`
  // 2026-10-31 (B689): the wait's own words say what the newest link waits for (`wait.last`) once they can: not twice.
  const newest = typeof wait.last?.text === 'string' ? null
    : stateIn(view.items, wait.end) === 'review' ? reviewWaitOf(view.items.get(wait.end), view.items, view.held, view.now, view.recaps)?.text ?? null : null
  return `; one chain, ${links.length + 1} in review: ${[id, ...links].join(' → ')}; newest link ${wait.end} ${stateIn(view.items, wait.end)}, ${owner(wait.end)}${newest === null ? '' : `, ${newest}`}`
}

/**
 * Gap 3: the refined steps split as the board's ready list sees them: ready to hand out (a fix, the focus goal's, a
 * pinned one), outside the focus goal (they wait for the person's pin or a focus switch by design), held otherwise
 * (a blocker, an ask, a standard); "" without a list.
 */
function refinedWords(view) {
  if (view.held === null || view.held === undefined) return ''
  const outside = view.held.filter(one => String(one.why ?? '').startsWith('outside the focus goal')).length
  const parts = [
    view.ready.length > 0 ? `${view.ready.length} ready to hand out` : null,
    outside > 0 ? `${outside} outside the focus goal, waiting for the person by design` : null,
    view.held.length - outside > 0 ? `${view.held.length - outside} held otherwise` : null,
  ].filter(Boolean)
  return parts.length === 0 ? '' : ` (${parts.join('; ')})`
}

/**
 * B585 (X33: a check under way read as stuck), T9.1.1 (the check is a Quality Assurance task): when the check of a step in
 * review was asked, and where its QA task stands: ", check asked 22:04, QA task B730 queued since 22:04 (given to Worker 2)",
 * ", check asked 22:04, QA task B730 with Worker 3 since 22:10", or ", check asked 22:04, no QA task yet".
 */
function checkAskedWords(view, id, since, now) {
  const qa = openQaTaskOf(view.items, id)
  const stand = qa === null ? null : qaStandOf(qa)
  const where = stand === null ? 'no QA task yet'
    : stand.kind === 'working' ? `QA task ${stand.qa} with ${stand.who ?? 'a worker'} since ${dayClockOf(stand.since, now)}`
      : `QA task ${stand.qa} queued since ${dayClockOf(stand.since, now)}${stand.who === null ? '' : ` (given to ${stand.who})`}`
  return `, check asked ${dayClockOf(since, now)}, ${where}`
}

/** Each chat's queue as the board shows it, in its order, with why the first step waits. */
function queueLines(view) {
  return view.lanes.filter(lane => !lane.isLeftover && Array.isArray(lane.queue) && lane.queue.length > 0).map(lane => {
    const ids = lane.queue.map(step => step?.id ?? `"${oneLine(step?.title, 30)}"`)
    const why = lane.queue[0]?.why?.reason ?? null
    return lineOf(`${lane.name}: ${ids.join(', ')}${why === null ? '' : ` (the first waits: ${why})`}`, { tier: 1, odd: lane.queue.length >= 3 && IDLE_STATES.includes(lane.state) })
  })
}
const IDLE_STATES = ['free', 'unknown', 'off']

/** The repairs the board made in the last day, and its incidents (not fixed, or fixed in the last day), with their keys. */
function dayLines(view, now) {
  const repairs = view.repairs.filter(one => now - one.at < DAY).map(one => lineOf(`${dayClockOf(one.at, now)} repair ${one.rule} on ${one.subject ?? 'the board'} (${one.key})`, { at: one.at }))
  const incidents = [...view.items.values()].filter(item => kindOf(item) === 'incident').flatMap(item => {
    const state = valueOf(item, 'State')
    const last = sinceMs(valueOf(item, 'Last seen'))
    // B685: a closed incident (the partner found no fault left) is not listed at all.
    if (state === 'closed' || (state === 'fixed' && !(now - last < DAY))) return []
    const fix = valueOf(item, 'Fix')
    const evidence = valueOf(item, 'Evidence')
    return [lineOf(`${valueOf(item, 'Id')} ${state === 'fix' && fix ? `fix ${fix}` : state}, from ${valueOf(item, 'Source') ?? 'not known'}, seen ${valueOf(item, 'Count') ?? '1'} times, first ${dayClockOf(sinceMs(valueOf(item, 'First seen')), now)}, last ${dayClockOf(last, now)}: ${valueOf(item, 'Title') ?? ''} [key: ${valueOf(item, 'Key') ?? ''}]${evidence === null ? '' : ` (evidence: ${oneLine(evidence, 80)})`}`,
      { tier: 1, odd: state === 'open' || state === 'came back', at: last })]
  })
  return [...incidents, ...repairs]
}

/** The words to a chat that wait, or expired or failed in the last day. */
function wordLines(view, now) {
  // B571: one judgement with rule 8 (watch.mjs undeliveredWords): a word the outbox sweep would drop is not listed, nor
  // a failed one tried again (the word that stands for it is), and a line is marked "!" only when rule 8 names its word.
  const at = { ...view, now }
  const matters = wordMatters(at)
  const named = new Set(undeliveredWords(at).map(message => message.id))
  // The review: not the supervisor's own sweep words (a sweep word that waits would make every summary look new).
  return view.outbox.filter(message => typeof message?.to === 'string' && Number.isFinite(message.at) && message.command !== 'sweep')
    .filter(message => message.state === 'waiting' || message.state === 'held' || ((message.state === 'expired' || isFailedForGood(message)) && now - message.at < DAY))
    .filter(message => message.state === 'held' || matters(message))
    .map(message => lineOf(`${dayClockOf(message.at, now)} ${message.command ?? 'answer'}${message.about ? ` ${message.about}` : ''} to ${message.to}: ${message.state} for ${lasting(now - message.at)}`,
      { tier: 1, odd: named.has(message.id), at: message.at }))
}

/** The limits of the plan and the person's pause. */
function limitLines(view, now) {
  // B601: a reading older than `oldReadingMinutes` says how old it is.
  const age = value => ((readingAgeMinutes(value, now) ?? 0) > view.settings.oldReadingMinutes ? ` (old: ${readingAgeMinutes(value, now)} min)` : '')
  const limit = (name, value) => (value === null || value === undefined ? `${name}: not known`
    : `${name}: ${Math.round(value.used)}% used (${value.level}), read at ${dayClockOf(value.at, now)}${age(value)}${Number.isFinite(value.resetsAt) ? `, resets at ${dayClockOf(value.resetsAt, now)}` : ''}`)
  const pause = view.pause === null || view.pause === undefined ? 'pause: none known'
    : `pause: ${view.pause.state ?? 'not known'}${Number.isFinite(view.pause.since) ? ` since ${dayClockOf(view.pause.since, now)}` : ''}`
  return [
    lineOf(`${limit('5-hour limit', view.limits?.fiveHour)}; ${limit('weekly limit', view.limits?.week)}`, { tier: 0, odd: ['fiveHour', 'week'].some(key => view.limits?.[key]?.level === 'full') }),
    lineOf(pause, { tier: 0, odd: isHolding(view.pause) }),
  ]
}

/**
 * The summary the supervisor chat reads (`work health`), from the view (view.mjs `buildView`) at `now`: a head, then the
 * sections Chats, Steps under way, Queues, Incidents and repairs of the last day, Words not delivered, Limits and pause.
 * At most HEALTH_CHARS characters: when the whole does not fit, the lines that must stay come first (every chat, the
 * steps the chats hold, the limits), then the oddest and newest of the rest; a section says how many lines it left out.
 */
export function healthSummary(view, now = view.now) {
  const sections = [
    { title: 'Chats (state and since; model and effort beside the step\'s; last report; last clear and why)', lines: chatLines(view, now) },
    { title: 'Steps under way (state, for how long, owner)', lines: stepLines(view, now) },
    { title: 'Queues', lines: queueLines(view) },
    { title: 'Incidents and repairs of the last day', lines: dayLines(view, now) },
    { title: 'Words not delivered', lines: wordLines(view, now) },
    { title: 'Limits and pause', lines: limitLines(view, now) },
  ]
  const head = `The board's health at ${clockOf(now)}, for the supervisor's sweep. Odd lines are marked with "!".`
  const rank = (a, b) => a.tier - b.tier || Number(b.odd) - Number(a.odd) || b.at - a.at
  const all = sections.flatMap((section, at) => section.lines.map(line => ({ ...line, section: at, text: line.odd ? `${line.text.slice(0, 2)}! ${line.text.slice(2)}` : line.text })))
  // Room for the head, the sections' titles and a "left out" line for each.
  let room = HEALTH_CHARS - head.length - sections.reduce((sum, section) => sum + section.title.length + 60, 0)
  const kept = new Set()
  for (const line of [...all].sort(rank)) {
    if (line.text.length + 1 > room) continue
    kept.add(line)
    room -= line.text.length + 1
  }
  const parts = [head]
  sections.forEach((section, at) => {
    const mine = all.filter(line => line.section === at)
    const shown = mine.filter(line => kept.has(line)).sort((a, b) => Number(b.odd) - Number(a.odd) || b.at - a.at)
    const left = mine.length - shown.length
    parts.push('', `${section.title}:`, ...(mine.length === 0 ? ['- none'] : shown.map(line => line.text)), ...(left > 0 ? [`- (${left} more left out: the oldest and least odd)`] : []))
  })
  const text = parts.join('\n')
  return text.length <= HEALTH_CHARS ? text : `${text.slice(0, HEALTH_CHARS - 1)}…`
}

/**
 * A summary line with its times and counts masked ("#"): clock times, spans such as "12 min" or "1 h 5 min", how often an
 * incident was seen and the limits' percent. The same situation reads the same at 12 minutes and at 13.
 */
export const withoutTimes = text => String(text).replace(/\b\d{1,2}:\d{2}\b|\b\d+ (?:min|h|d)\b(?: \d+ min\b)?|seen \d+ times|\d+% used/g, '#')

/**
 * The odd lines of a summary (`healthSummary`'s "- ! ..." lines) without their times and counts, each once, in their
 * order: what the sweep compares to say whether anything odd is new since the last one. A line that only grew a minute
 * is the same line; a state, a step or a chat that changed is another.
 */
export function oddLinesOf(summary) {
  const lines = [...String(summary ?? '').matchAll(/^- ! (.+)$/gm)].map(one => withoutTimes(one[1]).trim())
  return [...new Set(lines)]
}
