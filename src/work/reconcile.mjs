// B300: the reconciler (spec 2026-10-17, section 7). Every refresh the server holds the store's files against the board's
// lanes, one rule per row of the spec's table, and answers what to do: the moves the flow lets the server make, the
// steps to deliver (a wake: the chat's own `take` moves queued → taken), and the flags the board shows. It moves
// nothing itself and never invents a move the flow does not allow; a file it cannot read is named, not moved.

import { GIVE_GUARD, flowHandsOut, mayMove, statesOf } from './flow.mjs'
import { blockersOpen, overlapsIn, waitWords } from './guards.mjs'
import { HAND_OUT_DEFAULTS, idleWorkers, oldQueued, readyList, strandedGives, workerStart } from './handOut.mjs'
import { NET_MS } from './handover.mjs'
import { handedBackOf } from '../clearOwed.mjs'
import { askFiledMs, fixFirst, sinceMs, valueOf } from './item.mjs'
import { PARTNER_AGAIN_MS, PARTNER_ANSWER_MS, isRoutedToPartner } from './partnerAnswers.mjs'
import { isHolding } from './pause.mjs'
import { REST_GUARD, REST_MS, flowRests, openAskIds, restsFree } from './parked.mjs'
import { NOT_MERGED, backWordsOf } from './resultCheck.mjs'

/** The states in which a step is its Owner's work now. */
const HOLDS = ['taken', 'in progress', 'waiting on you']
const MIN = 60_000
/** T8.5 step 6: the one line on top of a board whose setting `handover` is not "sequence" (the escape hatch). */
export const HANDOVER_OFF = 'the hand-over is off: set handover to sequence'

const kindOf = item => valueOf(item, 'Kind') ?? 'step'
const stateOf = item => valueOf(item, 'State')
const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true })
/** A chat's name without the title's prefix, for comparing. */
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
/** A chat's name as written, without the title's prefix. */
const plainFrom = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim()
}
const whose = name => (/s$/i.test(name) ? `${name}'` : `${name}'s`)
/**
 * Warnings (2026-10-19): when the person answered an ask: its Since (the store sets it with the move to answered), at
 * the end of that minute, as the answer may have come at any second of it.
 */
const askAnsweredMs = item => {
  const at = sinceMs(valueOf(item, 'Since'))
  return Number.isFinite(at) ? at + MIN - 1 : Number.NaN
}
const span = ms => {
  const minutes = Math.floor(ms / MIN)
  const hours = Math.floor(minutes / 60)
  return hours === 0 ? `${minutes} min` : `${hours} h${minutes % 60 === 0 ? '' : ` ${minutes % 60} min`}`
}

/**
 * `{ store, flow, lanes, now, times, prefix }` → `{ moves, deliveries, flags }`. `store` is readStore's answer (`items`,
 * `problems`), `flow` its flow, `lanes` the board's chats (`name`, `state`, `isMain`, `isRunning`, `isLeftover`,
 * `lastActivityAt`, `task`, `resting`), `times` `{ graceMs, askMs, idleMs }` (src/config.mjs). `moves`: `[{ id, to, why
 * }]`; `deliveries`: `[{ id, chat, why }]`, one per chat (the main chat only: a worker's line is its hand-over's); `notes` (Focus 4): `[{ id, chat, from, since }]`, the unread
 * notes to the main chat, which it is woken for (not while it is suspended); `flags`: `[{ kind, id, chat, text, button }]`, a lane's when
 * `chat` is set, else a line on top; an `idle hold` flag (B308) also
 * names all its chat's steps (`ids`) and is a hint under Needs your attention, not on the lane. Partner answers
 * (2026-10-19): `partner` is the partner's card (`name`, `state`, `isRunning`, `idle`; null: no partner chat on the
 * board); `partnerAsks`: `[{ id, chat, since }]`, the asks routed to it that it is woken for while it is free (never
 * while the person pauses); `escalations`: `[{ id, why }]`, those the board hands to the person: `times.partnerMs`
 * (30 min) since its filing passed, whatever the partner did (the review's findings), no partner chat is on the board,
 * or the setting is off.
 * Redesign Part 2 (2026-10-25): the board hands out all work (work/handOut.mjs). `ready`: `{ ready, held }`, the ready
 * list in its order and what holds the rest (`focus` the goal map's focus, `standardHold(item)` a why or null,
 * `routingHeld` the ids the routing holds); `start`: `{ start: chat }`, `{ spawn: 1 }` or null, the word to the main chat
 * for one more worker (`settings.maxWorkers`; B-max: left out 5, null none). No start while the person pauses or resumes,
 * or a limit is full (`limitsFull`); none either when the flow lets the board hand out nothing, or the hand-over is off
 * (a line on top says so).
 * T8.5 step 6: the give itself is the hand-over's one decision at a worker's turn end (handover.mjs `decide`,
 * handoverBoard.mjs `handoverPass`): this pass gives nothing, takes nothing back, delivers no line to a worker and tells
 * a worker nothing of a failed check. `settings.handover` other than "sequence" (the escape hatch "timers") hands out
 * nothing at all: a line on top says so (`HANDOVER_OFF`).
 * `retired`: `[{ id }]`, the tasks queued before the redesign, which go back on the list once (work/handOut.mjs `oldQueued`);
 * `stranded`: `[{ id, chat, why }]`, the given tasks no hand-over carries on, back on the list (handOut.mjs `strandedGives`).
 * `handOutHeld` says whether the hand-out holds now (a pause, a resume, a full limit).
 */
export function reconcile({ store, flow = store.flow, lanes = [], now, times, prefix = '', hasPartner = true, partner = null, standardHold = null, focus = null, focusGoals = [], routingHeld = new Set(), settings = {}, sent = [], limitsFull = false }) {
  const items = store.items ?? new Map()
  const broken = new Set((store.problems ?? []).map(problem => problem.file?.match(/^([A-Z]\d+|L-[0-9a-f]{8})\.md$/)?.[1]).filter(Boolean))
  const live = lanes.filter(lane => !lane.isLeftover)
  const laneOf = owner => (owner === null ? undefined : live.find(lane => plain(lane.name, prefix) === plain(owner, prefix)))
  const steps = [...items.values()].filter(item => kindOf(item) === 'step' && !broken.has(valueOf(item, 'Id'))).sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
  const known = item => statesOf(flow, kindOf(item)).includes(stateOf(item))
  const moves = []
  const deliveries = []
  const flags = []

  // A file whose head is broken, an id twice, a state the flow does not know: one line on top each, nothing moved.
  for (const problem of store.problems ?? []) flags.push({ kind: 'broken', id: null, chat: null, text: problem.line, button: null })
  for (const item of [...items.values()].filter(one => !known(one) && !broken.has(valueOf(one, 'Id')))) {
    flags.push({ kind: 'broken', id: valueOf(item, 'Id'), chat: null, text: `${valueOf(item, 'Id')}: its state "${stateOf(item)}" is not in flow.json; it is shown as it is, not moved`, button: null })
  }
  const ok = steps.filter(known)
  const overlaps = overlapsIn(items)

  // B567 (X21): a step in progress whose worker has rested REST_MS (its turn ended, nothing running, not suspended, its
  // chat running) while an ask under it is open, blocking or not, moves to waiting on you, "(rests for Q<n>)", as the
  // flow's server move REST_GUARD lets it; not while the person pauses. Its worker then counts free for its queued steps
  // (`restFree`): a worker whose every held step waits on the person (or is parked) and that rests.
  const resting = []
  if (flowRests(flow) && !isHolding(store.pause)) {
    for (const item of ok.filter(one => stateOf(one) === 'in progress')) {
      const id = valueOf(item, 'Id')
      const lane = laneOf(valueOf(item, 'Owner'))
      if (lane === undefined || lane.isMain === true || lane.state === 'suspended' || lane.isRunning === false || !Number.isFinite(lane.resting?.since)) continue
      const open = openAskIds(items, id)
      if (open.length === 0) continue
      const since = Math.max(lane.resting.since, Number.isFinite(sinceMs(valueOf(item, 'Since'))) ? sinceMs(valueOf(item, 'Since')) : -Infinity)
      if (now - since < (times?.restMs ?? REST_MS)) continue
      moves.push({ id, to: 'waiting on you', ask: open[0], why: `in progress → waiting on you (rests for ${open.join(', ')})` })
      resting.push(id)
    }
  }
  const restFree = live.filter(lane => restsFree(lane, ok, prefix, resting)).map(lane => lane.name)
  // B737 (X86): a worker whose newest report failed the board's check was handed the step back: it gets no new step
  // until it reports that step again and the check passes (src/clearOwed.mjs); it counts as no idle worker for a start.
  const handedBack = new Set(live.filter(lane => lane.isMain !== true && handedBackOf(items, lane.name, prefix) !== null).map(lane => lane.name))
  // T8.5 step 6: a worker is handed over by the board's one decision at its turn end (handover.mjs): no line of this pass
  // is a worker's. Only the main chat is still woken here for a step queued for it.
  const isMainLane = lane => lane !== undefined && lane.isMain === true

  // A step queued whose guards hold and whose Owner is free: the Owner is woken (its `take` moves it to taken).
  // B567: a worker that rests while its steps wait on the person holds none of them for this.
  const holding = new Set(ok.filter(item => HOLDS.includes(stateOf(item)) && valueOf(item, 'Owner') !== null && !restFree.includes(laneOf(valueOf(item, 'Owner'))?.name))
    .map(item => plain(valueOf(item, 'Owner'), prefix)))
  // Fix first: a board fix before the other steps queued for its owner (it never goes to another chat).
  for (const item of ok.filter(one => stateOf(one) === 'queued').sort(fixFirst)) {
    const owner = valueOf(item, 'Owner')
    const lane = laneOf(owner)
    if (!isMainLane(lane) || (lane.state !== 'free' && !restFree.includes(lane.name)) || holding.has(plain(owner, prefix)) || handedBack.has(lane.name) || deliveries.some(one => one.chat === lane.name)) continue
    const ctx = { store: { items }, freeChats: new Set([owner]), now, overlaps }
    if (!mayMove(flow, item, 'taken', 'server', ctx).ok) continue
    const id = valueOf(item, 'Id')
    const since = valueOf(item, 'Since')
    deliveries.push({ id, chat: lane.name, since, why: `deliver ${id} to ${lane.name}` })
  }

  // B306: a queued step whose only wait is words (`Waits for` with no id, nothing it is blocked by still open) while
  // its Owner has been free, holding nothing and given nothing, longer than the grace time: someone clears it or keeps it.
  for (const item of ok.filter(one => stateOf(one) === 'queued' && waitWords(one) !== null)) {
    const owner = valueOf(item, 'Owner')
    const lane = laneOf(owner)
    if (lane === undefined || lane.state !== 'free' || holding.has(plain(owner, prefix)) || deliveries.some(one => one.chat === lane.name)) continue
    if (blockersOpen(item, { store: { items } }).length > 0 || !Number.isFinite(lane.idle?.since)) continue
    const freeSince = Math.max(Number.isFinite(sinceMs(valueOf(item, 'Since'))) ? sinceMs(valueOf(item, 'Since')) : 0, lane.idle.since)
    if (now - freeSince < times.graceMs) continue
    const id = valueOf(item, 'Id')
    flags.push({ kind: 'waits', id, chat: lane.name, text: `${id} waits for '${waitWords(item)}': clear it or keep it`, button: null })
  }

  // A step taken or in progress whose Owner is not running and not held by the limit: flagged after the grace time.
  // T13 part 3: not an asleep Owner: it resumes by itself (its resume word); once that did not take, its lane is off.
  for (const item of ok.filter(one => ['taken', 'in progress'].includes(stateOf(one)))) {
    const lane = laneOf(valueOf(item, 'Owner'))
    if (lane === undefined || lane.isRunning !== false || lane.state === 'suspended' || lane.asleep === true) continue
    const since = Math.max(Number.isFinite(sinceMs(valueOf(item, 'Since'))) ? sinceMs(valueOf(item, 'Since')) : 0, Number.isFinite(lane.lastActivityAt) ? lane.lastActivityAt : 0)
    if (now - since < times.graceMs) continue
    const id = valueOf(item, 'Id')
    flags.push({ kind: 'stuck', id, chat: lane.name, text: `${id}: ${lane.name} holds it but is not running`, button: `Start ${lane.name}` })
  }

  // B308: a worker (never the main chat; the Advisor has no lane) that holds steps taken or in progress, whose turn has
  // ended with nothing running (`resting`, state.mjs), that is not suspended and holds no open ask, for longer than the
  // idle time: it may wait for the person without having said so where the board looks. One hint per chat, naming
  // all its steps; it goes when the chat runs again, files an ask or reports. Nothing of its words is read.
  // B315: never for a chat whose process is not running: its lane says "Not running", and the hint would contradict it.
  // Warnings (2026-10-19): any open ask keeps it away, blocking or not: the chat's own (under its step or alone), or
  // another chat's under a step it holds. And the person's answer to an ask of its own starts the idle time anew: the
  // answer is on its way to the chat, which goes on once it has it. Seen live at 08:24: the person answered Q153, the
  // only ask of Worker 2, and the hint stood at once, before the answer had reached it.
  const allAsks = [...items.values()].filter(item => kindOf(item) === 'ask')
  const asking = new Set(allAsks.filter(item => stateOf(item) === 'open' && valueOf(item, 'Owner') !== null).map(item => plain(valueOf(item, 'Owner'), prefix)))
  for (const lane of live) {
    if (lane.isMain === true || lane.state === 'suspended' || lane.isRunning === false || !Number.isFinite(lane.resting?.since) || asking.has(plain(lane.name, prefix))) continue
    const mine = ok.filter(item => ['taken', 'in progress'].includes(stateOf(item)) && laneOf(valueOf(item, 'Owner')) === lane)
    if (mine.length === 0) continue
    const ids = mine.map(item => valueOf(item, 'Id'))
    if (allAsks.some(item => stateOf(item) === 'open' && ids.includes(valueOf(item, 'Of')))) continue
    const answered = allAsks.filter(item => stateOf(item) === 'answered' && laneOf(valueOf(item, 'Owner')) === lane).map(askAnsweredMs)
    const since = Math.max(lane.resting.since, ...[...mine.map(item => sinceMs(valueOf(item, 'Since'))), ...answered].filter(Number.isFinite))
    if (now - since < times.idleMs) continue
    const named = ids.length === 1 ? ids[0] : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`
    flags.push({ kind: 'idle hold', id: ids[0], ids, chat: lane.name, text: `${lane.name} holds ${named} but is not working and asked you nothing: it may wait for you`, button: null })
  }

  // An ask open with Blocking yes for longer than the ask time: it stands first under Needs your attention; nothing is
  // sent again.
  // Partner answers (2026-10-19): not one routed to the partner: it is not the person's yet.
  const asks = [...items.values()].filter(item => kindOf(item) === 'ask' && stateOf(item) === 'open' && valueOf(item, 'Blocking') === 'yes' && valueOf(item, 'Route') !== 'partner')
  for (const item of asks.sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))) {
    const waited = now - sinceMs(valueOf(item, 'Since'))
    if (!(waited > times.askMs)) continue
    const owner = valueOf(item, 'Owner')
    flags.push({ kind: 'old ask', id: valueOf(item, 'Id'), chat: laneOf(owner)?.name ?? owner, text: `${valueOf(item, 'Id')} has waited for your answer for ${span(waited)}`, button: null })
  }

  // Focus 4: a note to the main chat it has not read wakes it (deliver.mjs), unless it is suspended for the limit. The
  // review: never for its own notes, nor for the board's note of a report (Via: report: the worker tells it itself).
  const notes = []
  const mainLane = live.find(lane => lane.isMain === true)
  if (mainLane !== undefined && mainLane.state !== 'suspended') {
    const mains = new Set(['main', plain(mainLane.name, prefix)])
    for (const item of [...items.values()].filter(one => kindOf(one) === 'note' && valueOf(one, 'Main read') === null && valueOf(one, 'Via') !== 'report' && mains.has(plain(valueOf(one, 'To'), prefix)) && !mains.has(plain(valueOf(one, 'From'), prefix))).sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))) {
      notes.push({ id: valueOf(item, 'Id'), chat: mainLane.name, from: valueOf(item, 'From') === null ? 'the board' : laneOf(valueOf(item, 'From'))?.name ?? plainFrom(valueOf(item, 'From'), prefix), since: valueOf(item, 'Since') })
    }
  }

  // An instruction open for more than one turn of its chat: the Open instructions list shows it with its age and chat
  // (B298, work/lists.mjs); nothing here.

  // A step in review whose check failed: flagged on its Owner's lane. T8.5 step 6: its worker is told by the hand-over's
  // "back to you" envelope at its first turn's end (handover.mjs `decide`, rule 3), not here.
  for (const item of ok.filter(one => stateOf(one) === 'review')) {
    const checks = (item.sections.get('History') ?? []).filter(line => /\bserver: check (?:passed|failed)\b/.test(line))
    const failed = checks.at(-1)?.match(/^- (\S+ \S+) server: check failed(?::\s*(.*))?$/)
    if (failed === undefined || failed === null) continue
    const id = valueOf(item, 'Id')
    const lane = laneOf(valueOf(item, 'Owner'))
    const chat = lane?.name ?? valueOf(item, 'Owner')
    const detail = failed[2]?.trim() || 'no reason given'
    // 2026-10-31 (B799): the work is on a branch that is not merged: the step is back with its worker, not a failure for the person.
    if (detail.startsWith(NOT_MERGED)) {
      flags.push({ kind: 'not merged', id, chat, text: `${id}: not merged yet: back with ${chat}`, button: null })
      continue
    }
    // T8 (what counts as finished): any other mismatch the worker can fix is back with it too: a quiet line, no Check again.
    const handed = backWordsOf(detail)
    if (handed !== null) {
      flags.push({ kind: 'back', id, chat, text: `${id}: back with ${chat}: ${handed.words.length > 120 ? `${handed.words.slice(0, 120).trim()}…` : handed.words}`, button: null })
      continue
    }
    flags.push({
      kind: 'check failed', id, chat, text: `${id}: the board's check failed: ${detail}`, button: null,
    })
  }

  // A card that names a step the store does not hold in progress for that chat.
  for (const lane of live) {
    const task = lane.task ?? null
    if (task === null || task.source !== 'plan') continue
    const id = task.stepId ?? String(task.text ?? '').match(/\bB\d+\b/)?.[0] ?? null
    if (id === null) continue
    const item = items.get(id)
    const owner = item === undefined ? null : valueOf(item, 'Owner')
    const isMine = owner !== null && plain(owner, prefix) === plain(lane.name, prefix)
    if (item !== undefined && kindOf(item) === 'step' && HOLDS.includes(stateOf(item)) && isMine) continue
    const what = item === undefined ? `the store has no ${id}` : `${id} is ${stateOf(item)}${owner !== null && !isMine ? ` for ${laneOf(owner)?.name ?? owner}` : ''}`
    flags.push({ kind: 'card', id, chat: lane.name, text: `${whose(lane.name)} card says ${id} but ${what}`, button: null })
  }

  // The flow's own moves by the server whose guard holds (the move to taken is the chat's take, delivered above).
  for (const item of ok) {
    const from = stateOf(item)
    const kind = kindOf(item)
    for (const move of flow[kind]?.moves ?? []) {
      const by = Array.isArray(move.by) ? move.by : [move.by]
      if (!by.includes('server') || move.to === 'taken' || move.to === from || (move.from !== from && move.from !== '*')) continue
      // Redesign Part 2: a move to or from queued is the hand-out's (it names its worker; work/handOut.mjs). B567: the
      // move of a step whose worker rests reads the lanes, above.
      if (move.to === 'queued' || move.from === 'queued' || move.when === REST_GUARD) continue
      // This move's own guard (mayMove holds when any of the server's moves to that state does: the review of the
      // incident fixes, where the queue of a fix was named under B303's move, without a worker).
      if (!mayMove({ ...flow, [kind]: { ...flow[kind], moves: [move] } }, item, move.to, 'server', { store: { items }, freeChats: new Set(), now, overlaps, hasPartner, prefix }).ok) continue
      // B567: a step moved to waiting on you in this refresh does not move on in it too.
      if (resting.includes(valueOf(item, 'Id'))) continue
      moves.push({ id: valueOf(item, 'Id'), to: move.to, why: `${from} → ${move.to}${move.when === undefined ? '' : ` (${move.when})`}` })
      break
    }
  }
  // Partner answers (2026-10-19): the asks routed to the partner. It is woken for each while it is free (its card free,
  // or its chat not running: the main chat is asked to start it), never while the person pauses. The review's
  // findings: 30 minutes after its filing an ask goes to the person, whatever the partner does (busy, cut off, paused),
  // so none waits without end; and every one at once when no partner chat is on the board or the setting is off.
  const partnerAsks = []
  const escalations = []
  const isOn = store.partnerAnswers?.on !== false
  const isHeld = isHolding(store.pause)
  const isFree = partner !== null && (partner.state === 'free' || partner.state === 'off' || partner.isRunning === false)
  const routed = [...items.values()].filter(item => isRoutedToPartner(item) && !broken.has(valueOf(item, 'Id'))).sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
  for (const item of routed) {
    const id = valueOf(item, 'Id')
    if (!isOn) escalations.push({ id, why: 'your partner\'s answers are switched off' })
    else if (partner === null) escalations.push({ id, why: 'no partner chat is on the board' })
    else {
      const filed = askFiledMs(item)
      const limit = times?.partnerMs ?? PARTNER_ANSWER_MS
      if (Number.isFinite(filed) && now - filed >= limit) escalations.push({ id, why: `the partner did not answer in ${Math.round(limit / MIN)} min` })
      // B392: open ten minutes, it wakes the partner once more (`again`), so none sits unseen.
      else if (!isHeld && isFree) partnerAsks.push({ id, chat: partner.name, since: valueOf(item, 'Since'), ...(Number.isFinite(filed) && now - filed >= (times?.partnerAgainMs ?? PARTNER_AGAIN_MS) ? { again: true } : {}) })
    }
  }
  // Redesign Part 2 (2026-10-25): the hand-out. One ready list, in the board's order; the give itself is the hand-over's one
  // decision at a worker's turn end (T8.5, handover.mjs), which hands each worker the list's first task it may take. Here
  // only one more worker is asked of the main chat, when ready tasks wait and no worker is free for them.
  const followUpMs = Math.max(0, Number.isFinite(settings.followUpMinutes) ? settings.followUpMinutes : HAND_OUT_DEFAULTS.followUpMinutes) * MIN
  const ready = readyList(items, { now, focus, focusGoals, followUpMs, standardHold, routingHeld, prefix, beyondFocus: settings.handOutBeyondFocus === true })
  const handOutHeld = ['pausing', 'resuming'].includes(store.pause?.state) || limitsFull === true
  const handsOut = flowHandsOut(flow)
  if (!handsOut) {
    flags.push({ kind: 'broken', id: null, chat: null, text: `flow.json lets the board hand out no task: add the move refined → queued by server when "${GIVE_GUARD}" (examples/work/flow.json)`, button: null })
  }
  // T8.5 step 6: the escape hatch. With the old path gone, a board whose setting `handover` is not "sequence" hands out
  // nothing new (no worker is on the sequence) and starts no worker; one line on top says so.
  const isHandoverOn = (settings.handover ?? 'sequence') === 'sequence'
  if (!isHandoverOn) flags.push({ kind: 'handover off', id: null, chat: null, text: HANDOVER_OFF, button: null })
  // At rollout (plan Question 2): the tasks queued before the redesign go back on the list first (`retired`), once.
  const retired = handsOut ? oldQueued(items) : []
  // T8.5 step 6: a task the board gave that no hand-over carries on (its worker is not on the sequence, or gone from the
  // list for the net's time) goes back on the list; not while the hand-out holds.
  const retiredIds = new Set(retired.map(one => one.id))
  const stranded = handOutHeld || !handsOut ? [] : strandedGives({ items, lanes: live, now, waitMs: NET_MS, prefix }).filter(one => !retiredIds.has(one.id))
  // A free worker counts as free for the start of one more worker (its task comes by the hand-over).
  const idle = idleWorkers(live, { items, prefix, restFree, stuck: handedBack })
  const start = !handsOut || !isHandoverOn ? null : workerStart({ ready: ready.ready, idle, lanes: live, maxWorkers: settings.maxWorkers, isHeld: handOutHeld, items, sent, now, prefix,
    // Gap 2: a pinned task's worker unknown this long counts as off.
    offAfterMs: Number.isFinite(settings.offAfterMinutes) ? settings.offAfterMinutes * MIN : Infinity })
  return { moves, deliveries, flags, notes, partnerAsks, escalations, restFree, handedBack: [...handedBack], ready, start, retired, stranded, handOutHeld }
}
