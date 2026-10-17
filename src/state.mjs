// Puts the sources together into the one object the page asks for. Everything here is a pure function of the
// texts that were read: a source that is missing or broken gives "unknown" or an empty list, never an error.

import { join } from 'node:path'

import { boardChats, parseAppChat, parseList } from './appChats.mjs'
import { parseAsk } from './asks.mjs'
import { allWords, closedForYou, forYou, inProgress, noteSections, overview, parseBacklog, queue, refinedAt, refinedKey, refineStateOf } from './backlog.mjs'
import { pathKey } from './games.mjs'
import { parseHandover } from './handover.mjs'
import { hourEnd, hourStart, taskFacts, today } from './history.mjs'
import { finishedList, reportsOf } from './finished.mjs'
import { goalCounts, parseGoals } from './goals.mjs'
import { limitStop, limitsOf, parseUsageHistory, pauseNote, usageReadings } from './limits.mjs'
import { mentionedPaths } from './pictures.mjs'
import { milestoneFromGoals } from './milestone.mjs'
import { approvalRoute } from './tick.mjs'
import { parsePlanLine } from './planLines.mjs'
import { splitPicture } from './talkPicture.mjs'
import { isClockLine } from './rounds.mjs'
import { taskTimesOf } from './taskTimes.mjs'
import { backgroundRunning, conversation, doingNow, lastFinish, lastReport, parseTail, saysDone, taskOrigin, taskStart, turnEnded, turnStart, turnState, unanswered, waitingFor } from './transcript.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const ASKED = 'Asked you a question in its chat.'
/** A chat's own file that says it works is renewed twice a minute. Older than this, its process is gone. */
const CUT_OFF_MS = 150_000
/** A running chat's mod asks the board every few seconds. Not heard from for this long, its process is not running. */
const SEEN_MS = 30_000
/** B161: the mark under a line typed on the board (bridge.mjs, `messageText`), and how many lines of the talk are kept. */
const TYPED_MARK = /\n?\(typed on the worker board, \d{1,2}:\d{2}\)\s*$/
const TALK_MESSAGES = 40
/** B161: the first lines of what the board types into the main chat for itself (say.mjs, design.mjs): not the person's talk. */
const BOARD_WORDS = /^(?:spawn workers|remove worker|prepare restart|resume|start "|backlog step from the Design tab|queue step from the Design tab|queue step from the backlog|advisor recommendation|refine step|step refined)\b/
/** How long a window of the 5-hour limit lasts. */
const FIVE_HOURS = 5 * HOUR
/** B124: an ask for workers that arrived stays open this long while the workers have not all come. */
const SPAWN_OPEN_MS = 15 * MIN
/** B143: an ask to remove a worker that arrived stays open this long while the worker is still in the list. */
const REMOVE_OPEN_MS = 15 * MIN
/** B181: an ask to queue a step that arrived stays open this long while the step still names no worker. */
const QUEUE_OPEN_MS = HOUR
/** B233: an ask to refine a step that arrived stays open this long while the step lacks that round. */
const REFINE_OPEN_MS = 30 * MIN
/** B152: a removed worker's lane stays this long after its card said it left, saying so. */
const REMOVED_SHOW_MS = 2 * MIN

/**
 * B152: when a chat's card said that it left the list of chats: the time the card was written, null when the board
 * cannot tell, undefined when the card does not say so (or there is none).
 */
function leftAt(raw, id) {
  let card = null
  try {
    card = JSON.parse(textOr(raw.planLineTexts?.[id], ''))
  } catch {
    return undefined
  }
  if (card === null || typeof card !== 'object' || card.left !== true) return undefined
  const at = raw.planLineAt?.[id]
  return Number.isFinite(at) ? at : null
}

/**
 * True when the app was closed in the middle of a chat's turn. The transcript still shows the turn as open, but the
 * chat's own file, which its process keeps (`plan`), says otherwise: it was set to waiting after this turn began
 * (the process ended, or started again), or it says working and is no longer renewed. A file that was not written
 * around this turn says nothing: that chat's process keeps none.
 */
export function isCutOff({ turn, plan, lastWriteAt, turnStartedAt, now }) {
  if (turn !== 'running' && turn !== 'asking') return false
  if (plan === null || plan.at === null || plan.state === null) return false
  // Waiting, said after the turn began. A transcript that moved on well after that is a turn that lives: one
  // opened by a slash command or a background notice has no opening of its own to measure from.
  if (plan.state === 'waiting') return plan.at > (turnStartedAt ?? lastWriteAt ?? Infinity) && (lastWriteAt === null || lastWriteAt <= plan.at + MIN)
  return Number.isFinite(lastWriteAt) && plan.at >= lastWriteAt - MIN && now - plan.at > CUT_OFF_MS
}

/**
 * The state shown for a chat. The transcript decides whether it is busy; the app's summary of the last turn only
 * tells an ended turn that waits for the person from one that is free.
 */
export function chatState({ turn, category, needsAction }) {
  if (turn === 'running') return 'working'
  if (turn === 'asking') return 'waiting'
  if (turn !== 'ended') return 'unknown'
  return category === 'blocked' || (typeof needsAction === 'string' && needsAction.trim() !== '') ? 'waiting' : 'free'
}

/**
 * B262: the turn as the board takes it (`turn`), and for a turn that has ended since when and from where the board
 * knows it (`idle`: `{ since, from, isSilent }`, `from` `app` or `transcript`; null for a turn that runs). The app
 * writes its summary of a turn when the turn ends and clears it when the next one starts: a current summary says
 * the turn has ended, whatever the transcript's last entry is. Without it the transcript decides; a turn whose last
 * entry is a tool's answer (`end.how` `silent`) that wrote nothing for longer than the quiet limit ended without a
 * closing message, unless its card says it was cut off (`isCut`, see `isCutOff`). A question asked in the chat stays
 * a question.
 */
export function settleTurn({ turn, end, isAppEnded, isCut = false, writtenAt, now, quietLimitMs }) {
  const isSilent = end?.how === 'silent'
  if (turn === 'running' && isAppEnded) return { turn: 'ended', idle: { since: end?.at ?? writtenAt, from: 'app', isSilent } }
  if (turn === 'running' && isSilent && !isCut && writtenAt !== null && now - writtenAt > quietLimitMs) {
    return { turn: 'ended', idle: { since: end.at, from: 'transcript', isSilent } }
  }
  if (turn === 'ended') return { turn, idle: { since: end?.at ?? null, from: isAppEnded ? 'app' : 'transcript', isSilent: false } }
  return { turn, idle: null }
}

/**
 * B262: a hand-over still open, or null when the chat reported after it and its turn has ended since: a turn the
 * board took as ended (the app's word, a long quiet) has no closing entry that marks the task finished.
 */
function reportedOrOpen(handOver, turn, scan, main) {
  if (handOver === null || turn !== 'ended') return handOver
  return (lastReport(scan, main) ?? -Infinity) >= handOver.at ? null : handOver
}

const textOr = (value, fallback) => (typeof value === 'string' ? value : fallback)

/**
 * Why a chat whose turn has ended is not free, or null when it is: its task is not reported yet, background work
 * it started still runs, or the backlog step it works on still names its branch. The board then shows it as
 * working, between two turns.
 */
export function heldBy({ plan, handOver, background, step, isCompleted = false, isDone = false }) {
  // A card holds the chat unless the app's own summary calls the ended turn completed: a chat that reported and
  // forgot to clear its card is done. One that asked another chat in the middle of its task still waits. B148: a
  // chat whose last answer ends with "+ Done:   yes" is done, whatever its card says or what it left running in
  // the background (a server it started); what others hold for it, a hand-over or a step's branch, still holds.
  if (plan?.task != null && !plan.task.isReported && !isDone && (!isCompleted || plan.task.asked === true)) {
    return { why: 'task', text: plan.task.asked === true ? 'Its turn has ended; it asked another chat and waits for the answer.' : 'Its turn has ended; its task is not reported yet.' }
  }
  if (handOver !== null) return { why: 'task', text: 'Its turn has ended; the task handed to it is not reported yet.' }
  if (background > 0 && !isDone) return { why: 'background', text: 'Its turn has ended; background work it started is still running.' }
  if (step !== null) return { why: 'branch', text: `Its turn has ended; its branch ${step.branch} is still open.` }
  return null
}

/**
 * The task a chat is on, as the chat recorded it: the topic, the steps and the time of its plan line (`source:
 * 'plan'`). A busy chat that has recorded nothing shows the backlog step it works on (`source: 'step'`): the one
 * that names its branch, else the first open one the hand-over names by id. With neither, the task is there but
 * has no words (`source: 'unrecorded'`, `text: ''`). The words of a prompt or of a hand-over are never used: what
 * a person or a chat typed stays in the chat. `step` is the step that names the chat's branch, `stepById` finds
 * an open step by its id; a step gives the task its id and, for a chat with no estimate of its own, its time.
 * A chat that recorded its task is on a step too (`stepId`): the one that names its branch, else the open one
 * of its own (or of nobody) that its record names by id, else the one handed to it.
 */
function taskOf({ chat, plan, scan, state, before, lines, main, prefix, now, step = null, stepById = () => null }) {
  // `scan` holds the entries that can start or end a task: the tail, after a longer look back when there is one.
  const handOver = chat.isMain || scan === null ? null : taskStart(scan, main)
  const opening = scan === null ? null : turnStart(scan, { prefix })
  const bare = { step: null, steps: null, names: null, leftMs: null, estimateAt: null, stepLeftMs: null, stepEstimateAt: null, source: 'unrecorded', by: null }
  // A handed-over task stands while the chat works on it or waits for the person; a free chat has finished it.
  const isBusy = state === 'working' || state === 'waiting'
  let task = null
  // The step a chat is on: the one that names its branch, else the one its own record names, else the one
  // handed to it.
  const firstOpen = (ids, whose = null) => ids.map(id => stepById(id, whose)).find(found => found !== null) ?? null
  let onStep = step
  if (plan?.task != null && !plan.task.isReported) {
    const { text, step: at, steps, names, leftMs } = plan.task
    // The time for the step it is on, and when it said so: like the task's own time, it counts down from there.
    const stepLeftMs = plan.task.stepLeftMs ?? null
    task = { text, step: at, steps, names, leftMs, estimateAt: leftMs === null ? null : plan.at, stepLeftMs, stepEstimateAt: stepLeftMs === null ? null : plan.at, source: 'plan', by: null }
    // Its record may name other steps too ("after B93"): only a step of its own, or of nobody, counts.
    onStep ??= firstOpen(text.match(/\bB\d+\b/g) ?? [], chat.name) ?? firstOpen(handOver?.steps ?? [])
  } else if (isBusy) {
    // The hand-over may be further back than the board looks: the history remembers that there was one, until
    // the chat has reported.
    const finishedAt = scan === null ? null : lastFinish(scan, main)
    const isRemembered = handOver === null && !chat.isMain && (before?.source === 'handover' || before?.source === 'unrecorded' || before?.source === 'step')
      && (finishedAt === null || finishedAt <= (before.startedAt ?? before.at))
    onStep ??= firstOpen(handOver?.steps ?? [])
    if (onStep !== null) task = { text: [onStep.id, onStep.title].filter(Boolean).join(' '), ...bare, source: 'step' }
    else if (handOver !== null || isRemembered || state === 'working') task = { text: '', ...bare }
  }
  if (task === null) return null

  // A task without words has no name the history could know it by.
  const facts = task.text === '' ? null : taskFacts(lines, chat.name, task.text, now)
  // When the task was first known: when the board first saw it, or when the chat says it named it.
  const firstSeenAt = Math.min(facts?.firstSeenAt ?? now, plan?.task?.since ?? Infinity)
  // What could have started it, not later than that: the hand-over, and for a task the chat named itself also
  // the last time the person opened a turn. The latest of them is the start.
  // A task the chat did not record starts with its hand-over, else with what opened its turn. When the entries
  // cannot be sure of that opening (it may be a remark in the middle of a longer turn), the start the history
  // recorded while the chat kept working stands.
  const kept = before?.state === 'working' && before.source !== 'plan' && Number.isFinite(before.startedAt) ? before.startedAt : null
  const openedAt = opening === null ? null : opening.isOpen && opening.isSure ? opening.at : kept ?? opening.at
  // A task the chat named starts no earlier than where the one before it ended: its last message to the main
  // chat (it reported and went on in the same turn), or the moment it named this one while the board still
  // showed another task it had named. A long turn holds several tasks, and each counts its own time.
  const reportedAt = scan === null || chat.isMain ? null : lastReport(scan, main)
  const isNext = facts === null && before?.source === 'plan' && typeof before.task === 'string' && before.task !== ''
    && before.task !== task.text && (before.state === 'working' || before.state === 'waiting')
  const starts = (task.source === 'plan' ? [handOver?.at, opening?.at, reportedAt, isNext ? firstSeenAt : null] : [handOver === null ? openedAt : handOver.at])
    .filter(at => Number.isFinite(at) && at <= firstSeenAt)
  const startedAt = facts?.startedAt ?? Math.min(firstSeenAt, starts.length === 0 ? Infinity : Math.max(...starts))
  const first = facts?.firstEstimate ?? (task.leftMs === null ? null : { at: task.estimateAt ?? now, leftMs: task.leftMs })
  // Time before the board first saw the task counts as worked; after that, only what it saw as working.
  const workedMs = facts === null
    ? (state === 'working' ? now - startedAt : 0)
    : Math.max(0, facts.firstSeenAt - startedAt) + facts.workedMs
  return {
    ...task,
    startedAt,
    // The whole task as first estimated: the time already spent when the estimate was given, plus what it said was left.
    firstEstimateMs: first === null ? null : Math.max(0, first.at - startedAt) + first.leftMs,
    waitedMs: facts?.waitedMs ?? 0,
    workedMs,
    // The backlog step the chat works on, and the time the step's note gives it ("about 1 h"), when it has one.
    stepId: onStep?.id ?? null,
    stepMinutes: onStep?.minutes ?? null,
    // The time the hand-over gave it ("about 45 minutes"), for a task whose step names none.
    handMinutes: handOver?.minutes ?? null,
  }
}


/**
 * When a working chat expects to be done: when it gave its estimate, plus what it said was left (`isOwn`, `from:
 * 'own'`). A chat that gave none gets the time of its backlog step ("about 1 h", `from: 'step'`), else the time
 * its hand-over gave (`from: 'handover'`), counted from the task's start: an estimate that is not its own. Null
 * when none of the three is there.
 */
function etaOf(task, state, now) {
  if (state !== 'working' || task === null) return null
  const isOwn = task.leftMs !== null && task.estimateAt !== null
  const minutes = task.stepMinutes ?? task.handMinutes
  if (!isOwn && (minutes === null || !Number.isFinite(task.startedAt))) return null
  const at = isOwn ? task.estimateAt + task.leftMs : task.startedAt + minutes * MIN
  // B185: over its estimate (`isOverdue`, shown as a fault) only when over twice it and by at least 10 minutes, the
  // person's yes against false alarms; a little over is only that (`isOver`).
  const spanMs = Number.isFinite(task.startedAt) ? at - task.startedAt : 0
  const isOverdue = now - at >= 10 * MIN && (spanMs <= 0 || now - task.startedAt > 2 * spanMs)
  return { at, leftMs: Math.max(0, at - now), isOverdue, isOver: at < now, isOwn, from: isOwn ? 'own' : task.stepMinutes !== null ? 'step' : 'handover' }
}

/**
 * B149: what a chat that waits last said (`waitingFor`), with its parts in the agreed form (`handover`, null when it
 * has none) and the main chat's hand-over that gave it its task, as it arrived (`given`, B151's `taskOrigin`): the
 * newest one up to two minutes after the task's start, else the newest one. What the person typed to a chat that
 * waits is never shown (B100), so a task the person gave it is told by its own "Task:" line only.
 */
function finishedWith(waits, scan, main, task) {
  if (waits === null) return null
  const until = task !== null && Number.isFinite(task.startedAt) ? task.startedAt + 2 * MIN : Infinity
  const origin = scan === null ? null : taskOrigin(scan, main, until)
  return { ...waits, handover: parseHandover(waits.words), given: origin?.by === 'main' ? origin : null }
}

function card(chat, raw, { now, config, last, lines, main, prefix, stepOf = () => null, stepById = () => null }) {
  // `session` is the id the chat's own process knows itself by: the bridge serves only that one under this name.
  // `appSession` is the id the app knows the chat by: the main chat starts a chat that is not running with it.
  const base = { name: chat.name, isMain: chat.isMain, isLeftover: chat.isLeftover, session: chat.cliSessionId ?? null, appSession: chat.appSessionId ?? null, removedAt: chat.removedAt ?? null }
  const none = { quietMs: null, isQuiet: false, isAsking: false, doingNow: null, between: null, needsYou: null, statusDetail: null, waitingSince: null, waitsFor: null, task: null, cutOffAt: null, eta: null, isWithoutTime: false, suspended: null, usage: [], lastTask: null, givenTask: null, reports: null, compaction: null, unanswered: null, idle: null }
  if (chat.isLeftover) return { ...base, state: 'unknown', ...none, lastActivityAt: chat.lastActivityAt }

  const tail = raw.tails?.[chat.cliSessionId] ?? null
  const entries = tail === null || typeof tail.text !== 'string' ? null : parseTail(tail.text, tail.isCut === true)
  const summary = chat.summary?.isCurrent === true ? chat.summary : null
  const lastWriteAt = Number.isFinite(tail?.modifiedAt) ? tail.modifiedAt : null
  const plan = parsePlanLine(textOr(raw.planLineTexts?.[chat.cliSessionId], ''))
  const turnStartedAt = entries === null ? null : turnStart(entries, { prefix })?.at ?? null
  // B262: the app's summary of the last turn, when it has one, says the turn has ended; else the transcript decides.
  const said = entries === null ? null : turnState(entries)
  const { turn, idle } = entries === null ? { turn: null, idle: null } : settleTurn({
    turn: said, end: turnEnded(entries), isAppEnded: summary !== null, writtenAt: lastWriteAt, now, quietLimitMs: config.quietMinutes * MIN,
    isCut: isCutOff({ turn: said, plan, lastWriteAt, turnStartedAt, now }),
  })
  // The longer look back is a few minutes old, so the tail follows it: the newest hand-over or report wins.
  const scan = typeof tail?.earlier === 'string' && entries !== null ? [...parseTail(tail.earlier, false), ...entries] : entries
  const step = stepOf(chat.name)
  const wasCutOff = isCutOff({ turn, plan, lastWriteAt, turnStartedAt, now })
  // An ended turn is not a free chat while something of its work is open: it is between two turns.
  const ended = chatState({ turn, category: summary?.category, needsAction: summary?.needsAction })
  // B148: its last answer ends with "+ Done:   yes": it has finished, and a card it forgot to clear holds nothing.
  const isDone = turn === 'ended' && entries !== null && saysDone(entries)
  const held = wasCutOff || ended !== 'free' ? null : heldBy({
    plan, step,
    isCompleted: summary?.category === 'completed',
    isDone,
    handOver: chat.isMain || scan === null ? null : reportedOrOpen(taskStart(scan, main), turn, scan, main),
    background: entries === null ? 0 : backgroundRunning(entries),
  })
  // B113: held by a limit of the plan. The app stopped it there, or the worker told the main chat that it paused
  // and its turn has ended. Until when is settled once the limits are known (`heldUntil`).
  const stop = entries === null ? null : limitStop(entries)
  const note = stop !== null || entries === null || chat.isMain || turn !== 'ended' ? null : pauseNote(entries, main.mainTitle)
  const paused = stop !== null ? { by: 'app', limit: stop.limit, since: stop.at, named: stop.resetsAt }
    : note !== null ? { by: 'note', limit: 'fiveHour', since: note.at, named: note.until } : null
  const state = paused !== null ? 'suspended' : wasCutOff ? 'interrupted' : held === null ? ended : 'working'
  // No sign of life is about a turn that runs: between two turns a chat writes nothing.
  const quietMs = state === 'working' && held === null && lastWriteAt !== null ? Math.max(0, now - lastWriteAt) : null

  let needsYou = null
  if (state === 'waiting') needsYou = turn === 'asking' ? ASKED : summary?.needsAction?.trim() || summary?.detail?.trim() || null

  // A chat that was cut off, or is held by a limit, keeps the task it was on.
  // B148: a chat that has finished (its last answer says "Done: yes", or it is free by the app's own summary) is
  // not on the task its card still names: that card was left behind, and the lane names it only as finished.
  const isLeftBehind = plan?.task != null && !plan.task.isReported && (isDone || state === 'free')
  const task = taskOf({ chat, plan: isLeftBehind ? { ...plan, task: null } : plan, state: wasCutOff || paused !== null ? 'working' : state, before: last.get(chat.name), lines, main, prefix, now, scan, step, stepById })
  const eta = etaOf(task, state, now)
  // B151: the message that gave it the task it is on, as it arrived, for the window a click on its lane opens; with
  // the backlog step it is on, else the first open one that message names.
  const isOnTask = task !== null && (state === 'working' || state === 'suspended' || state === 'interrupted')
  const given = !isOnTask || scan === null ? null : taskOrigin(scan, main, Number.isFinite(task.startedAt) ? task.startedAt + 2 * MIN : Infinity)
  const givenStep = given === null ? null
    : (task.stepId === null ? null : stepById(task.stepId)) ?? (given.text.split('\n')[0].match(/\bB\d+\b/g) ?? []).map(id => stepById(id)).find(one => one !== null) ?? null
  return {
    ...base,
    state,
    quietMs,
    isQuiet: quietMs !== null && quietMs > config.quietMinutes * MIN,
    // It asked with the app's own question form: that can only be answered in its chat.
    isAsking: turn === 'asking',
    doingNow: state === 'working' && held === null ? doingNow(entries) : null,
    // Why it counts as working although its turn has ended, in words; null for a turn that runs.
    between: state === 'working' && held !== null ? held.text : null,
    needsYou,
    statusDetail: turn === 'ended' ? summary?.detail?.trim() || null : null,
    // The turn's last entry: when it ended, or when it asked.
    waitingSince: state === 'waiting' ? entries.findLast(entry => entry.type === 'assistant' && !entry.isSidechain)?.at ?? null : null,
    // B100: what it last said, for the window of what it waits for: its own words, never what was typed to it.
    // B149: with the parts of it when it finished a task with something left for the person, and the message that
    // gave it that task.
    waitsFor: state === 'waiting' ? finishedWith(waitingFor(entries), scan, main, task) : null,
    task,
    // When a chat that was cut off last wrote.
    cutOffAt: wasCutOff ? lastWriteAt : null,
    eta,
    // A worker that works and has no time from anywhere: a fault to fix, and shown as one. The main chat hands
    // out work and answers the person; it has no task to time.
    isWithoutTime: state === 'working' && !chat.isMain && eta === null,
    lastActivityAt: Math.max(chat.lastActivityAt ?? 0, tail?.modifiedAt ?? 0) || null,
    // The task a free chat's card still named: finished, not current work.
    lastTask: isLeftBehind && state === 'free' ? { text: plan.task.text } : null,
    // B235: whether the Workers mod compacted the chat after its last report, or why not.
    compaction: plan?.compaction ?? null,
    // B247: the step a running turn waits on without an answer; the app may wait for the person's approval of it.
    unanswered: quietMs === null || entries === null ? null : unanswered(entries),
    // B262: since when its turn has ended, and whether the app or its transcript says so.
    idle,
    givenTask: given === null ? null : { ...given, step: givenStep === null ? null : { id: givenStep.id, title: givenStep.title } },
    suspended: paused,
    // What this chat itself looked up of the limits: in its tail, and further back (`tail.usage`).
    usage: entries === null ? [] : usageReadings([...(typeof tail.usage === 'string' ? parseTail(tail.usage, false) : []), ...entries]),
    // B155: the steps the workers' reports to the main chat name, read from the main chat's own transcript.
    reports: chat.isMain && scan !== null ? reportsOf(scan, prefix) : null,
  }
}

/**
 * B113: a chat held by a limit, with the time it can go on: `{ by, limit, since, until, isBack }`. `until` is the
 * time the app's stop or the worker's note named, else when that limit resets as far as the board knows; null
 * when nothing says. `isBack` says that time has passed: the limit is back and the chat has not gone on, because
 * nothing starts it by itself.
 */
function heldUntil(paused, limits, now) {
  if (paused === null) return null
  const { named, ...held } = paused
  if (named !== null) return { ...held, until: named, isBack: named <= now }
  const limit = limits[held.limit]
  if (limit === null) return { ...held, until: null, isBack: false }
  if (limit.resetAt !== null && limit.resetAt > held.since) return { ...held, until: limit.resetAt, isBack: true }
  if (limit.resetsAt === null) return { ...held, until: null, isBack: false }
  // A window of five hours that began after the pause: the limit came back in between.
  if (held.limit === 'fiveHour' && limit.resetsAt - FIVE_HOURS > held.since) return { ...held, until: null, isBack: true }
  return { ...held, until: limit.resetsAt, isBack: false }
}

/**
 * B124: the newest ask for workers and how it fares: how many of the workers it asked for have come (chats made
 * after it), and whether it is still open: on its way, or arrived and not all come yet, for 15 minutes at most.
 */
function spawnAsk(message, workerChats, now) {
  if (message === undefined) return null
  const count = Number.isInteger(message.count) && message.count > 0 ? message.count : 1
  const arrived = workerChats.filter(chat => Number.isFinite(chat.createdAt) && chat.createdAt > message.at).length
  const isOnItsWay = message.state === 'waiting' || message.state === 'taken'
  const isOpen = isOnItsWay || (message.state === 'delivered' && arrived < count && now - (message.deliveredAt ?? message.at) < SPAWN_OPEN_MS)
  return { at: message.at, count, why: message.why === 'button' ? 'button' : 'alone', state: message.state, arrived, isOpen }
}

/**
 * B143: the newest ask to remove a worker and how it fares. It is open while it is on its way, and after it arrived
 * for 15 minutes at most while the worker is still in the list: a worker that is gone has no lane to show it.
 */
function removalAsk(message, now, openMs = REMOVE_OPEN_MS) {
  if (message === undefined) return null
  const isOnItsWay = message.state === 'waiting' || message.state === 'taken'
  const isOpen = isOnItsWay || (message.state === 'delivered' && now - (message.deliveredAt ?? message.at) < openMs)
  return { at: message.at, state: message.state, isOpen }
}

/**
 * B181: the newest ask to hand out a step of the backlog, for a step nobody has. Open while it is on its way, and
 * after it arrived for an hour at most: the main chat writes the step's "(for ...)" note, and a queued step asks
 * nothing more. After that hour, or when it did not arrive, the step can be asked again.
 */
const queueAsk = (step, sent, now) => {
  if (step.status !== 'open' || step.id === null) return null
  const message = sent.findLast(one => one.command === 'queue' && one.about === step.id)
  // B285: an ask held on the board until the step is refined stays open.
  if (message?.state === 'held') return { at: message.at, state: 'held', isOpen: true }
  return removalAsk(message, now, QUEUE_OPEN_MS)
}

/**
 * B233: the newest ask to the Advisor to refine a step, open while it is on its way and after it arrived until the
 * step's refine block shows the round it asked for, for half an hour at most.
 */
function refineAsk(step, sent, now) {
  if (step.id === null) return null
  const message = sent.findLast(one => one.command === 'refine' && one.about === step.id)
  const ask = removalAsk(message, now, REFINE_OPEN_MS)
  if (ask === null) return null
  const round = Number.isInteger(message.round) ? message.round : 1
  // B285: the newer form's head names no round: a block that changed since the ask (`before`, its key then) answers it
  // too; an ask from before that key, a block written since it (to the minute).
  const written = refinedAt(step.refined)
  const isWritten = (step.refined?.round ?? 0) >= round || (message.before !== undefined
    ? refinedKey(step.refined) !== message.before
    : written !== null && written >= Math.floor(message.at / MIN) * MIN)
  return { ...ask, round, isOpen: ask.isOpen && !isWritten }
}

/**
 * B275: the turns the board itself starts in the Advisor's chat. What such a turn asks has its own place: a round of
 * the board's clock its suggestions on the backlog, a refine the step's window, an answer to a recommendation the way
 * to the next milestone.
 */
const BOARD_TURNS = /^(?:round from the board's clock: \w+|refine step|advisor recommendation: (?:yes|no))$/i

/**
 * B275: the Advisor as a chat that waits for the person, for the list of what waits for them; null when it waits for
 * nothing there. It waits when it asked with the app's question form (answered in its chat only, whichever turn
 * asked), or when the app says it waits, as a worker; and also when its turn has ended with a "For you" block in its
 * last answer, which the app does not always count. The turns the board started are passed over: a question the
 * Advisor asked before a round or a refine still waits, until the person or another chat starts a turn after it.
 * `card` is the Advisor's card, `tail` the end of its transcript with the longer look back (`earlier`).
 */
function advisorWaiting(card, tail, prefix) {
  if (tail === null || typeof tail.text !== 'string') return null
  if (card.isAsking) return { ...card, isAdvisor: true }
  // Its turn has ended: it waits, it is free, or it is held between two turns by a hand-over it has not reported on.
  if (card.state !== 'waiting' && card.state !== 'free' && card.between === null) return null
  const recent = parseTail(tail.text, tail.isCut === true)
  // The longer look back, before the tail: a long turn's start may lie further back than the tail reaches.
  const since = recent[0]?.at ?? Infinity
  let entries = [...(typeof tail.earlier === 'string' ? parseTail(tail.earlier, false).filter(entry => entry.at < since) : []), ...recent]
  let opening = turnStart(entries, { prefix })
  const isOwn = opening === null || !BOARD_TURNS.test(opening.title)
  while (opening !== null && BOARD_TURNS.test(opening.title)) {
    const start = entries.findLastIndex(entry => entry.at === opening.at && entry.type !== 'assistant')
    if (start === -1) return null
    entries = entries.slice(0, start)
    opening = turnStart(entries, { prefix })
  }
  if (isOwn && card.state === 'waiting') return { ...card, isAdvisor: true }
  const waits = waitingFor(entries)
  const handover = waits === null ? null : parseHandover(waits.words)
  if (handover === null || handover.items.length === 0) return null
  // The app's line of what it needs is about the turn that ended last, which may be one the board started.
  return { ...card, state: 'waiting', isAdvisor: true, needsYou: isOwn ? card.needsYou : null, waitingSince: waits.at, waitsFor: { ...waits, handover, given: null } }
}

/** How long the card of a chat's question stays after its answer was typed in. The page hides it sooner. */
const ANSWER_KEPT_MS = 10 * MIN

/** B100: a chat's task as its card names it, for the window of what it waits for: the topic, the step, since when. */
const cardOf = task => (task === null ? null : {
  text: task.text, step: task.step, steps: task.steps, name: task.names?.[(task.step ?? 0) - 1] ?? null, startedAt: task.startedAt, stepId: task.stepId ?? null,
})

const asAnswer = message => (message === undefined ? null : {
  at: message.at, verdict: message.verdict ?? null, text: message.text ?? '', state: message.state,
  // When its chat took it, and when it was typed there.
  takenAt: message.takenAt ?? null, deliveredAt: message.deliveredAt ?? null,
})

/**
 * What the person answered to a request, as far as the outbox knows: the last message about it. An answer stands
 * for the request as it was then (`version`): one given to a step that has changed since is `earlier`, and the
 * step asks again.
 */
function answerOf(outbox, id, version = null) {
  const isCurrent = sent => version === null || (sent.version ?? null) === null || sent.version === version
  return {
    answer: asAnswer(outbox.findLast(sent => sent.ask === id && isCurrent(sent))),
    earlier: asAnswer(outbox.findLast(sent => sent.ask === id && !isCurrent(sent) && sent.state === 'delivered')),
  }
}

/**
 * What waits for the person, newest first: the asks the chats filed, a chat that waits without having filed one,
 * and a chat whose turn runs but shows no sign of life. `canAnswer` says the board's own form can answer it.
 * A chat that waits brings what its window shows (B100): its task as its card names it (`task`) and what it
 * last said (`waits`). Once answered on the board, its card stays while the answer is on its way and a little
 * after it was typed in, although the chat no longer waits: the person sees that it arrived.
 * B275: the Advisor (`advisor`, its card) asks as a worker does when it waits (`advisorWaits`, see `advisorWaiting`),
 * and is answered straight in its chat.
 */
function needsOf(asks, lanes, outbox, gameOf, now, base = 'main', { advisor = null, advisorWaits = null } = {}) {
  const live = lanes.filter(lane => !lane.isLeftover)
  const names = new Set(live.map(lane => lane.name))
  // Work to verify is looked at in the game: on the branch the ask names, else on main.
  // An answer is about the ask as it was filed: one filed anew, also under the same name, asks again.
  const items = asks.map(ask => ({
    ...ask,
    version: hashOf(`${ask.title}\n${ask.text}\n${ask.at}`),
    game: gameOf(ask.run?.branch ?? (ask.kind === 'verify' ? base : null)),
    canAnswer: names.has(ask.from),
  }))
  const asked = new Set(asks.map(ask => ask.from))
  const blank = { options: [], pictures: [], run: null, game: null, checks: [], tried: [] }
  for (const lane of advisorWaits === null ? live : [...live, advisorWaits]) {
    if (lane.state === 'waiting' && !asked.has(lane.name)) {
      // B149: a worker that finished its task and left something for the person says so in the title.
      const form = lane.waitsFor?.handover ?? null
      const isFinished = form !== null && (form.items.length > 0 || form.task !== null || form.did !== null)
      items.push({
        // One id per time it started waiting, so an answer to an earlier question never sticks to a later one.
        id: `chat:${lane.name}:${lane.waitingSince ?? 0}`,
        from: lane.name,
        kind: 'input',
        // B169: the main chat asks the person as part of its talk with them, not as a finished task.
        // B275: so does the Advisor; what it asks first is its card's line when the app names nothing.
        title: lane.isAsking ? 'Asked you a question in its chat'
          : lane.isMain || lane.isAdvisor ? `${lane.name} needs your answer`
            : isFinished ? `Finished: ${(form.task ?? 'its task').split('\n')[0].slice(0, 120)}` : 'Needs your decision',
        text: lane.isAsking ? 'It used the app\'s question form, which can only be answered there.'
          : lane.needsYou ?? (lane.isAdvisor ? form?.items[0]?.ask ?? null : null) ?? 'It waits for you.',
        at: lane.waitingSince,
        ...blank,
        version: null,
        canAnswer: !lane.isAsking,
        task: cardOf(lane.task),
        waits: lane.waitsFor,
        isMain: lane.isMain === true,
        isAdvisor: lane.isAdvisor === true,
      })
    }
    if (lane.isQuiet) {
      items.push({
        id: `quiet:${lane.name}`,
        from: lane.name,
        kind: 'intervene',
        title: `No sign of life for ${Math.round(lane.quietMs / MIN)} min`,
        text: lane.unanswered === null
          ? 'Its turn is running, but it has written nothing. It may be a long build, or the app was closed in the middle of the turn. Look at its chat.'
          // B247: it waits on one step that never got its answer.
          : `Its step "${lane.unanswered.doing}" has had no answer for ${Math.round((now - lane.unanswered.since) / MIN)} min. The app may wait for your approval of it in its chat, or the tool hangs. Look at its chat.`,
        at: lane.lastActivityAt,
        ...blank,
        version: null,
        canAnswer: false,
      })
    }
  }
  // Answered here, and the chat has moved on or will: the card of that question, with nothing left to answer.
  const isKept = sent => sent.state === 'waiting' || sent.state === 'taken'
    || (sent.state === 'delivered' && now - (sent.deliveredAt ?? sent.at) < ANSWER_KEPT_MS)
  for (const lane of advisor === null ? live : [...live, advisor]) {
    const sent = outbox.findLast(one => one.to === lane.name && typeof one.ask === 'string' && one.ask.startsWith(`chat:${lane.name}:`))
    if (sent === undefined || !isKept(sent) || items.some(item => item.id === sent.ask)) continue
    items.push({
      id: sent.ask,
      from: lane.name,
      kind: 'input',
      title: 'Waited for you',
      text: '',
      at: Number(sent.ask.slice(`chat:${lane.name}:`.length)) || sent.at,
      ...blank,
      version: null,
      canAnswer: false,
      task: cardOf(lane.task),
      waits: null,
      isAdvisor: advisor !== null && lane === advisor,
    })
  }
  return items
    .map(item => ({ ...item, ...answerOf(outbox, item.id, item.version) }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

/** A name for a backlog step that stays the same as long as its words do: an answer is kept under it. */
function hashOf(words) {
  let hash = 5381
  for (const letter of words) hash = ((hash * 33) ^ letter.codePointAt(0)) >>> 0
  return hash.toString(16)
}
const stepId = words => `backlog:${hashOf(words)}`

/** What a chat is expected to work on after now: the rest of its task, then its queue, as far as times are given. */
function aheadOf(lane, now) {
  if (lane.eta === null || lane.eta.isOver) return []
  const spans = [{ from: now, to: lane.eta.at, title: lane.task.text === '' ? 'Task not recorded yet' : lane.task.text, isQueued: false }]
  let at = lane.eta.at
  for (const step of lane.queue) {
    if (step.minutes === null || at - now > 8 * 60 * MIN) break
    spans.push({ from: at, to: at + step.minutes * MIN, title: step.title, isQueued: true })
    at += step.minutes * MIN
  }
  return spans
}

/**
 * The `/api/state` object. `raw` holds the texts as they were read (see sources.mjs), `lines` the history, and
 * `outbox` what was sent from the page and is not delivered yet (see store.mjs, `outboxNow`), and `runs` the
 * games the board started and that still run (see games.mjs).
 */
/**
 * B131, B137: what the board looks for and where, for each thing it did not find: the list of chats, a chat of the
 * project, the backlog. Empty when nothing is missing. The paths come from the settings.
 */
export function lookingFor({ list, prefix, config, chats, hasBacklog }) {
  const listFile = join(config.project, '.claude', 'chats', 'list.json')
  const lines = []
  if (config.project === '') lines.push('The settings name no "project": the board looks for everything in that folder.')
  else if (list.problem === 'missing') lines.push(`No list of chats: the board looks for ${listFile}. Copy examples/list.json there and set "prefix" (how the project's chat titles start) and "main" (the main chat's name).`)
  else if (list.problem === 'broken') lines.push(`The list of chats ${listFile} is not valid JSON.`)
  else if (list.problem === 'incomplete') lines.push(`The list of chats ${listFile} needs a "prefix" and a "main".`)
  else if (chats === 0) lines.push(`No chat of this project yet: the board shows the open chats in ${config.project} whose titles start with "${prefix}".`)
  if (config.project !== '' && !hasBacklog) lines.push(`No backlog yet: the board reads ${join(config.project, ...config.backlog.split('/'))}.`)
  return lines
}

export function buildState(raw, { lines = [], outbox = [], runs = [], board = null, seen = null, finishedSeen = {}, taskTimes = [], now, config }) {
  const sent = Array.isArray(outbox) ? outbox : []
  const started = Array.isArray(runs) ? runs : []
  const list = parseList(textOr(raw.listText, ''))
  // The start of the project's chat titles, for reading their words; '' while the list of chats is not right.
  const prefix = list.prefix ?? ''
  const apps = (Array.isArray(raw.appChatTexts) ? raw.appChatTexts : [])
    .map(text => parseAppChat(textOr(text, '')))
    .filter(chat => chat !== null)
  // B152: a chat whose card says it left the list of chats ("left": true) gets no lane, also while its chat stays
  // open in the app (one with Remote Control on cannot be closed). For two minutes after the card said so, its lane
  // stays and says it was removed; a card the board cannot date goes at once. A chat that joins again writes a new
  // card and shows again. The rest of the list is made without it, so a new chat of its name is no leftover.
  const removedAt = new Map(apps.map(chat => [chat.cliSessionId, leftAt(raw, chat.cliSessionId)]).filter(([, at]) => at !== undefined))
  const isGone = chat => removedAt.has(chat.cliSessionId) && !(removedAt.get(chat.cliSessionId) > now - REMOVED_SHOW_MS)
  const found = boardChats(apps.filter(chat => !isGone(chat)), { project: config.project, ...list })
    .map(chat => ({ ...chat, removedAt: removedAt.get(chat.cliSessionId) ?? null }))
  const main = found.find(chat => chat.isMain)
  // What the history last said about each chat, also from before the board was last off.
  const last = new Map(lines.filter(line => line.gap !== true).map(line => [line.chat, line]))
  const context = {
    now, config, last, lines, prefix,
    // How a message from the main chat is known: by its title, or by the app's id for it.
    main: { mainTitle: list.main === null ? null : `${prefix}${list.main}`, mainSession: main?.appSessionId ?? null },
  }
  // The advisor is talked with on its own tab. Every other chat is a lane, however many there are.
  const isAdvisor = chat => !chat.isLeftover && !chat.isMain && chat.name === config.advisor
  const advisorChat = found.find(isAdvisor)
  const names = found.filter(chat => !isAdvisor(chat) && !chat.isLeftover).map(chat => chat.name)

  const backlog = parseBacklog(textOr(raw.backlogText, ''), { prefix, names })
  // B255, B260: the goal map, read once for the Goals part and for the way to the next milestone.
  const goalMap = typeof raw.goalsText === 'string' ? parseGoals(raw.goalsText) : null
  const folders = Array.isArray(raw.folders) ? raw.folders : null
  // The step a worker is on: the open one that names its own branch and this worker; of several, the one whose
  // branch a working folder holds.
  const underWay = inProgress(backlog)
  const stepOf = name => {
    const mine = underWay.filter(step => step.worker === name)
    return mine.find(step => (folders ?? []).some(folder => folder.branch === step.branch)) ?? mine[0] ?? null
  }
  // An open step by its id, for a hand-over or a chat's own record that names one (not a step for the person).
  // With `whose`, only a step of that worker or of nobody.
  const openSteps = backlog.activities.flatMap(activity => activity.steps).filter(one => !one.isDone && !one.isYou && one.id !== null)
  const stepById = (id, whose = null) => {
    const one = openSteps.find(found => found.id === id && (whose === null || found.worker === null || found.worker === whose))
    return one === undefined ? null : { id: one.id, title: one.title, minutes: one.minutes, branch: one.ownBranch }
  }
  const read = found.filter(chat => !isAdvisor(chat)).map(chat => card(chat, raw, { ...context, stepOf, stepById }))
  const advisorCard = advisorChat === undefined ? null : card(advisorChat, raw, context)

  // B113: the plan's limits, from what is on this machine: the app's own file, what any chat looked up, and a
  // chat the app stopped. Reading them asks no chat and costs nothing.
  const everyone = advisorCard === null ? read : [...read, advisorCard]
  const limits = limitsOf({
    sample: parseUsageHistory(raw.usageText ?? null),
    readings: everyone.flatMap(one => one.usage),
    stops: everyone.filter(one => one.suspended?.by === 'app').map(one => ({ at: one.suspended.since, limit: one.suspended.limit, resetsAt: one.suspended.named })),
    now,
    warnAt: config.limitWarnPercent,
  })
  const cards = read.map(({ usage, reports, ...lane }) => ({ ...lane, suspended: heldUntil(lane.suspended, limits, now) }))

  const counts = { working: 0, waiting: 0, free: 0, unknown: 0, interrupted: 0, suspended: 0 }
  for (const lane of cards) if (!lane.isLeftover) counts[lane.state] += 1

  // The steps the workers are on right now, also the ones that name no branch (a check, a comparison, a merge):
  // they are in progress, not next in a queue.
  const onNow = new Set(cards.filter(lane => !lane.isLeftover && (lane.task?.stepId ?? null) !== null).map(lane => lane.task.stepId))
  const queued = queue(backlog, { underWay: onNow })
  // A folder belongs to the worker an open step names together with the folder's branch.
  const ownerOf = new Map(backlog.activities.flatMap(activity => activity.steps)
    .filter(step => !step.isDone && step.branch !== null && step.worker !== null)
    .map(step => [step.branch, step.worker]))

  /**
   * The game to look at for a branch: the working folder that holds the branch, and the address when the board
   * has started it. Null without a branch, or when git did not answer.
   */
  function gameOf(branch) {
    if (branch === null || folders === null) return null
    const folder = folders.find(one => one.branch === branch) ?? null
    const run = folder === null ? null : started.find(one => pathKey(one.path) === pathKey(folder.path)) ?? null
    return { branch, folder: folder?.name ?? null, path: folder?.path ?? null, url: run?.url ?? null, since: run?.startedAt ?? null }
  }

  // The pictures in the folders a step's words point to.
  const pictureLists = raw.pictureLists !== null && typeof raw.pictureLists === 'object' ? raw.pictureLists : {}
  const picturesOf = words => mentionedPaths(words, config.pictureRoots)
    .flatMap(path => (Array.isArray(pictureLists[path]) ? pictureLists[path] : []))
    .slice(0, 6)

  // Without such a step, a folder named after a worker ("features" for Features) is that worker's.
  const firstWord = name => name.toLowerCase().split(/[^a-z0-9]+/)[0]
  const owner = folder => (folder.branch === config.baseBranch ? null : ownerOf.get(folder.branch) ?? names.find(name => firstWord(name) === folder.name.toLowerCase()) ?? null)

  /**
   * B113: why a queued step is not started, the first of these that holds: a limit of the plan is full, its
   * worker is held by the limit, its condition is not met (an open step it names by id, else the condition's own
   * words: the board cannot tell whether those are met), or what its worker is doing. `lane` is null for a step
   * that names no worker on the board.
   */
  const withId = backlog.activities.flatMap(activity => activity.steps).filter(one => one.id !== null)
  const openIds = new Set(withId.filter(one => !one.isDone).map(one => one.id))
  const knownIds = new Set(withId.map(one => one.id))
  function whyNot(step, lane) {
    for (const limit of ['fiveHour', 'week']) if (limits[limit]?.level === 'full') return { reason: 'limit', limit, until: limits[limit].resetsAt }
    if (lane?.state === 'suspended') return { reason: 'suspended', worker: lane.name, until: lane.suspended.until, isBack: lane.suspended.isBack }
    if (step.after !== null) {
      const ids = [...new Set(step.after.match(/\bB\d+\b/g) ?? [])]
      const open = ids.filter(id => openIds.has(id))
      if (open.length > 0) return { reason: 'after', steps: open }
      if (ids.length === 0 || ids.some(id => !knownIds.has(id))) return { reason: 'after', words: step.after }
    }
    if (lane === null) return { reason: 'nobody' }
    if (lane.state === 'working') return { reason: 'busy', worker: lane.name, leftMs: lane.eta === null || lane.eta.isOver ? null : lane.eta.leftMs }
    if (lane.state === 'waiting') return { reason: 'you', worker: lane.name }
    if (lane.state === 'interrupted') return { reason: 'cut', worker: lane.name }
    if (lane.state === 'free') return { reason: 'handout', main: context.main.mainTitle, isOwn: lane.isMain }
    return { reason: 'unknown', worker: lane.name }
  }

  const lanes = cards.map(lane => {
    const mine = lane.isLeftover ? [] : queued.filter(step => step.worker === lane.name)
    const withQueue = { ...lane, queue: mine.map(step => ({ id: step.id, title: step.title, text: step.text, minutes: step.minutes, after: step.after, branch: step.branch, notes: step.notes, pictures: picturesOf(allWords(step)), why: whyNot(step, lane) })) }
    return {
      ...withQueue,
      folders: lane.isLeftover ? [] : (folders ?? []).filter(folder => owner(folder) === lane.name),
      ahead: lane.isLeftover ? [] : aheadOf(withQueue, now),
    }
  })
  const live = lanes.filter(lane => !lane.isLeftover)

  const asks = (Array.isArray(raw.askTexts) ? raw.askTexts : []).map(text => parseAsk(textOr(text, ''))).filter(ask => ask !== null)
  const titles = new Map(apps.filter(chat => chat.sessionId !== null).map(chat => [chat.sessionId, chat.title]))
  // The timeline: a little of what was, and what is ahead as far as it is planned (a day at most).
  const from = hourStart(now - config.hoursBack * HOUR)

  let advisor = null
  // B275: the Advisor when it waits for the person, for their list of what waits for them.
  let advisorWaits = null
  if (advisorChat !== undefined) {
    const { state, doingNow: doing, session, appSession } = advisorCard
    const tail = raw.tails?.[advisorChat.cliSessionId] ?? null
    advisorWaits = advisorWaiting(advisorCard, tail, prefix)
    advisor = {
      name: advisorChat.name,
      session,
      appSession,
      state,
      doingNow: doing,
      messages: tail === null || typeof tail.text !== 'string'
        ? []
        : conversation(parseTail(tail.text, tail.isCut === true), { self: advisorChat.name, prefix, titles })
          // B173: a round the board's clock typed is the clock's, not the person's.
          .filter(message => !(message.from === 'you' && isClockLine(message.text))),
      // Typed on the board to the advisor and not in its chat yet.
      pending: sent.filter(message => message.to === advisorChat.name && (message.ask ?? null) === null && (message.command ?? null) === null),
    }
  }

  // B161: the person's talk with the main chat on the Overview's right side: what they typed to it, in its chat or on
  // the board, and its answers, with their times. The workers' reports, and what the board typed for itself (its
  // words to the main chat, an answer to a card), are left out; a line typed on the board shows without the board's
  // mark under it.
  let mainTalk = null
  if (main !== undefined && !main.isLeftover) {
    const lane = cards.find(one => one.isMain) ?? null
    const tail = raw.tails?.[main.cliSessionId] ?? null
    const said = tail === null || typeof tail.text !== 'string' ? [] : conversation(parseTail(tail.text, tail.isCut === true), { self: main.name, prefix, titles, limit: 400 })
    const isPersons = one => one.via !== 'board' || (TYPED_MARK.test(one.text) && !BOARD_WORDS.test(one.text))
    mainTalk = {
      name: main.name,
      state: lane?.state ?? 'unknown',
      doingNow: lane?.doingNow ?? null,
      messages: said
        .filter(one => one.from === 'chat' || (one.from === 'you' && isPersons(one)))
        // B167: a picture pasted with a line is shown from the "Picture:" line the board typed under its words.
        .map(one => (one.via === 'board' ? { ...one, ...splitPicture(one.text.replace(TYPED_MARK, '').trim(), config.pictureRoots[0]) } : one))
        .filter(one => one.text !== '' || (one.picture ?? null) !== null)
        .slice(-TALK_MESSAGES),
      // Typed here and not in its chat yet: the person's own lines, not the board's words to it.
      pending: sent.filter(message => message.to === main.name && (message.ask ?? null) === null && (message.command ?? null) === null),
    }
  }

  /**
   * A step for the person as a card like the requests of the chats. A step says what it asks of the person
   * ("Verify:", "Decide:", "Provide:", "Do:"); the answer goes to the worker it names, else to the main chat,
   * which keeps the backlog.
   */
  function stepCard(step, isClosed) {
    const to = step.worker !== null && names.includes(step.worker) ? step.worker : main?.name ?? null
    // Kept under the step's own id; a step from before the ids is kept under its words.
    const id = step.id === null ? stepId(`${step.activity}\n${step.text}`) : `backlog:${step.id}`
    // The step as it reads now, with the lines under it: an answer is about this version of it.
    const version = hashOf(`${step.text}\n${JSON.stringify(step.notes)}`)
    const { answer, earlier } = isClosed ? { answer: null, earlier: null } : answerOf(sent, id, version)
    return {
      id,
      version,
      isClosed,
      step: step.id,
      from: to,
      kind: step.asks === 'verify' || step.asks === 'do' ? step.asks : 'input',
      asks: step.asks,
      title: step.title,
      text: '',
      at: null,
      activity: step.activity,
      options: [],
      pictures: picturesOf(allWords(step)),
      // For the details of the step: its own words, its notes and the branch it names.
      words: step.text,
      notes: step.notes,
      branch: step.branch,
      run: null,
      // What to verify is in the branch the step names, else in main. A step with an address of its own is
      // about something else than the game.
      game: step.asks === 'verify' && !/https?:\/\//.test(step.text) ? gameOf(step.branch ?? config.baseBranch) : null,
      // B110: where an approval goes: the board ticks a step whose work is merged (`tick`); one whose branch is
      // still there, or of which the board cannot tell, goes to its worker (`worker`). The same for "Done" on a
      // step only the person could do. Null for what is neither.
      approval: (step.asks === 'verify' || step.asks === 'do') && !isClosed ? approvalRoute(step.branch, Array.isArray(raw.branches) ? raw.branches : null, config.baseBranch) : null,
      checks: [],
      tried: [],
      // A closed step takes no answer.
      canAnswer: to !== null && !isClosed,
      answer,
      earlier,
    }
  }

  const until = Math.max(now, ...live.flatMap(lane => lane.ahead.map(span => span.to)))

  // A restart of the app: who was cut off, what the main chat wrote down before it, and the last word the person
  // gave the main chat about it ("prepare restart", then "resume"). `board` says when this board started and
  // since when it had been off.
  const word = sent.findLast(message => message.command === 'prepare restart' || message.command === 'resume')

  /**
   * Whether a chat's process runs: its mod asked the board lately (`seen.shown`, by the chat's name). After a restart
   * of the app a chat does not run until it is opened or messaged through the app, and until then nothing reaches
   * it by its name. Null where that cannot be told: no chat can ask this board, or the board has only just
   * started and not every chat has asked yet.
   */
  // B212, B213: no Workers mod has asked this board since it started (null on a board that does not deliver).
  const isBridgeMissing = seen === null || typeof seen !== 'object' || !Number.isFinite(board?.startedAt) ? null
    : Object.keys(seen.shown ?? {}).length === 0 && Object.keys(seen.other ?? {}).length === 0 && now - board.startedAt >= SEEN_MS
  function runningOf(name) {
    // B213: without a mod nobody asks, so the board cannot tell whether a chat runs: unknown, never "not running".
    if (isBridgeMissing === true) return null
    if (seen === null || typeof seen !== 'object' || !Number.isFinite(board?.startedAt) || now - board.startedAt < SEEN_MS) return null
    const isFresh = at => Number.isFinite(at) && now - at < SEEN_MS
    if (isFresh(seen.shown?.[name])) return true
    // Somebody asks under this name from another session than the one the board shows: it cannot tell.
    return isFresh(seen.other?.[name]) ? null : false
  }
  const restart = {
    main: main === undefined ? null : main.name,
    interrupted: live.filter(lane => lane.state === 'interrupted').map(lane => lane.name),
    notRunning: live.filter(lane => runningOf(lane.name) === false).map(lane => lane.name),
    // The chats the main chat was lately asked to start, each with how that word fared.
    starting: [...new Map(sent
      .filter(message => message.command === 'start' && typeof message.about === 'string' && now - message.at < 10 * MIN)
      .map(message => [message.about, { chat: message.about, at: message.at, state: message.state }])).values()],
    prepared: Number.isFinite(raw.restartNote?.at) ? { at: raw.restartNote.at } : null,
    preparing: word?.command === 'prepare restart' ? { at: word.at, state: word.state, working: live.filter(lane => lane.state === 'working').map(lane => lane.name) } : null,
    resuming: word?.command === 'resume' && now - word.at < 15 * MIN ? { at: word.at, state: word.state } : null,
    off: Number.isFinite(board?.offSince) && Number.isFinite(board?.startedAt) && now - board.startedAt < HOUR ? { from: board.offSince, to: board.startedAt } : null,
  }

  return {
    readAt: now,
    refreshSeconds: config.refreshSeconds,
    estimateOldMs: config.estimateOldMinutes * MIN,
    maxMessageChars: config.maxMessageChars,
    counts,
    // B155: the steps finished last, newest first, with when (and from where the board knows it) and who.
    finished: finishedList(backlog, { reports: read.find(one => one.isMain)?.reports ?? new Map(), seen: finishedSeen ?? {}, prefix }),
    // B185: how long finished tasks really took, per area and lately, and per step its estimate and working time.
    taskTimes: taskTimesOf(taskTimes),
    // B113: the 5-hour limit and the week, each with how old its figure is; a window nothing is known of is null.
    limits,
    chats: lanes.map(lane => ({
      ...lane,
      isRunning: lane.isLeftover ? null : runningOf(lane.name),
      // B143: the newest ask to remove this worker; the main chat and a leftover have none.
      removal: lane.isLeftover || lane.isMain ? null : removalAsk(sent.findLast(message => message.command === 'remove' && message.about === lane.name), now),
    })),
    // Queued steps that name no worker on the board.
    unassigned: queued.filter(step => step.worker === null || !names.includes(step.worker)).map(step => ({ ...step, why: whyNot(step, null) })),
    // B83: the newest ask to stop each worker's task, and to move or unqueue each queued step, open while on its way
    // and for a while after it arrived, so the page asks once.
    changeAsks: {
      stop: Object.fromEntries(lanes.filter(lane => !lane.isLeftover && !lane.isMain).map(lane => [lane.name, removalAsk(sent.findLast(message => message.command === 'stop' && message.about === lane.name), now)]).filter(([, ask]) => ask !== null)),
      steps: Object.fromEntries(lanes.flatMap(lane => lane.queue ?? []).filter(step => typeof step.id === 'string').map(step => [step.id, removalAsk(sent.findLast(message => (message.command === 'move' || message.command === 'unqueue') && message.about === step.id), now)]).filter(([, ask]) => ask !== null)),
    },
    forYou: needsOf(asks, lanes, sent, gameOf, now, config.baseBranch, { advisor: advisorCard, advisorWaits }),
    // The whole backlog by activity, for the Coordinate tab. A step for the person opens its card (`needId`).
    backlog: overview(backlog, { underWay: onNow }).map(activity => ({
      ...activity,
      steps: activity.steps.map(step => {
        // B233: whether the Advisor was asked to refine it and has not written that round yet.
        const asked = refineAsk(step, sent, now)
        return {
          ...step,
          pictures: picturesOf(allWords(step)),
          needId: step.status !== 'you' ? null : step.id === null ? stepId(`${activity.name}\n${step.text}`) : `backlog:${step.id}`,
          // B181: whether the main chat was asked to hand it out, for a step nobody has.
          queueAsk: queueAsk(step, sent, now),
          refineAsk: asked,
          // B285, B286: where its refine stands.
          refineState: refineStateOf({ refined: step.refined, refineAsk: asked }),
        }
      }),
    })),
    // The open steps in the backlog that end in @you.
    backlogForYou: forYou(backlog).map(step => stepCard(step, false)),
    // The ticked ones: closed. The page shows them only when the person asks for them.
    backlogClosed: closedForYou(backlog).map(step => stepCard(step, true)),
    // The game as it is on main, which the person can always open; with when main last changed.
    mainGame: (() => {
      const game = gameOf(config.baseBranch)
      const folder = game === null || game.path === null ? null : folders.find(one => one.branch === config.baseBranch)
      return folder === null ? null : { ...game, lastCommitAt: folder.lastCommitAt ?? null, commit: folder.lastCommit ?? null }
    })(),
    // Folders no worker is named for, and whether git answered at all.
    otherFolders: (folders ?? []).filter(folder => folder.branch !== config.baseBranch && owner(folder) === null),
    // B194: the branch the project's work is merged into.
    baseBranch: config.baseBranch,
    hasFolders: folders !== null,
    day: { from, to: now, until, end: hourEnd(Math.min(Math.max(until, now + config.hoursAhead * HOUR), now + 24 * HOUR)) },
    // What the history kept from before the board stopped showing a prompt's words is not shown either.
    today: today(lines.map(line => (line.source === 'prompt' || line.source === 'handover' ? { ...line, task: null } : line)), { from, to: now, names })
      .map((lane, index) => ({ ...lane, ahead: live[index].ahead })),
    restart,
    // B124: the main chat (null when the list has none), the name and folder a new project makes it with, how many
    // workers there are, and the newest ask for workers.
    workers: (() => {
      // B152: a worker that was removed is no worker any more, also while its lane still says so.
      const workerChats = found.filter(chat => !chat.isLeftover && !chat.isMain && !isAdvisor(chat) && chat.removedAt === null)
      return {
        main: main === undefined ? null : main.name,
        mainTitle: context.main.mainTitle,
        project: config.project,
        // B131, B137: what an empty board looks for and where, when it finds it missing.
        lookFor: lookingFor({ list, prefix, config, chats: found.filter(chat => !chat.isLeftover).length, hasBacklog: typeof raw.backlogText === 'string' }),
        // B213: no Workers mod takes the board's words: the page says what that means.
        withoutMod: isBridgeMissing === true,
        count: workerChats.length,
        ask: spawnAsk(sent.findLast(message => message.command === 'spawn'), workerChats, now),
      }
    })(),
    advisor: advisor === null ? null : { ...advisor, isRunning: runningOf(advisor.name) },
    // B212: no Workers mod has asked this board for its words since it started: what is sent is copied for the person
    // to paste instead (null on a board that does not deliver). `chatPrefix` makes a chat's name its title.
    bridge: isBridgeMissing === null ? null : { isMissing: isBridgeMissing },
    chatPrefix: prefix,
    // B161: the talk with the main chat; null without a main chat.
    mainTalk: mainTalk === null ? null : { ...mainTalk, isRunning: runningOf(mainTalk.name) },
    // B173: the game plan (config.gamePlan in the game's repository), and the Advisor's open suggestions: the open
    // steps of the backlog's group for them, with their "Why:", "Cost:" and "Unblocks:" lines.
    advice: typeof raw.adviceText === 'string' && raw.adviceText.trim() !== '' ? raw.adviceText : null,
    gamePlan: config.gamePlan,
    // B193: the project's own picture folder, where the board keeps the pictures it is given.
    pictures: config.pictureRoots[0],
    suggestions: backlog.activities
      .filter(activity => activity.name.trim().toLowerCase() === config.advisorSuggestions.toLowerCase())
      .flatMap(activity => activity.steps.filter(step => !step.isDone))
      .map(step => ({ id: step.id, title: step.title, notes: noteSections(step.notes) })),
    // When the advice was written: the page says how old it is.
    adviceAt: Number.isFinite(raw.adviceAt) ? raw.adviceAt : null,
    // B195: the way to the next milestone, counted against the backlog as it stands; with the person's answer to the
    // Advisor's recommendation once given (one that did not arrive does not count). Since B260 it is read from the
    // goal map (src/milestone.mjs milestoneFromGoals). Null without a goal map or a milestone of the plan in it.
    milestone: (() => {
      const way = goalMap === null ? null : milestoneFromGoals(goalMap, backlog)
      if (way === null) return null
      const rec = way.recommendation
      if (rec === null) return way
      const said = sent.findLast(message => message.command === 'recommend' && message.about === rec.id && message.state !== 'failed' && message.state !== 'expired')
      return { ...way, recommendation: { ...rec, answer: said === undefined ? null : { answer: said.answer, at: said.at, state: said.state } } }
    })(),
    // B255: the goal map (config.goals in the project, spec 2026-10-15), each node with its counters against the
    // backlog as it stands, and the problems the file has. Null without a file; `goalsFile` says where it is looked for.
    goals: (() => {
      if (goalMap === null) return null
      const counts = goalCounts(goalMap, backlog)
      return { file: config.goals, roots: goalMap.roots, problems: goalMap.problems, nodes: goalMap.nodes.map(one => ({ ...one, counts: counts.get(one.id) ?? null })) }
    })(),
    goalsFile: config.goals,
  }
}
