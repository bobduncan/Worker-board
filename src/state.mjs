// Puts the sources together into the one object the page asks for. Everything here is a pure function of the
// texts that were read: a source that is missing or broken gives "unknown" or an empty list, never an error.

import { join } from 'node:path'

import { boardChats, parseAppChat, parseList } from './appChats.mjs'
import { parseAsk } from './asks.mjs'
import { ASK_MS, GRACE_MS, IDLE_HOLD_MS } from './config.mjs'
import { allWords, closedForYou, minutesOf, forYou, noteSections, overview, queue, refinedAt, refinedKey, refineStateOf, withoutNotes } from './backlog.mjs'
import { pathKey } from './games.mjs'
import { asksAtEnd, parseHandover } from './handover.mjs'
import { hourEnd, hourStart, taskFacts, today } from './history.mjs'
import { finishedList } from './finished.mjs'
import { brainstormNeeds, brainstormsState } from './brainstorm.mjs'
import { focusStage, goalAskList, goalAskNeeds, goalCounts, parseGoals, unlinkedSteps } from './goals.mjs'
import { limitStop, limitsOf, parseUsageHistory, pauseLifted, pauseNote, storePause, usageReadings } from './limits.mjs'
import { mentionedPaths } from './pictures.mjs'
import { milestoneFromGoals } from './milestone.mjs'
import { partnerEffort } from './partnerEffort.mjs'
import { approvalRoute } from './tick.mjs'
import { parsePlanLine } from './planLines.mjs'
import { splitPicture } from './talkPicture.mjs'
import { isClockLine } from './rounds.mjs'
import { taskTimesOf } from './taskTimes.mjs'
import { isFix, sinceMs, valueOf } from './work/item.mjs'
import { planStarting, planState, withPlanWork } from './plan.mjs'
import { standardHold } from './work/standardHold.mjs'
import { askIdsIn, askKey, askPartsOf, sameAsk } from './work/askWords.mjs'
import { forYouRepeat } from './work/askRepeat.mjs'
import { dailyNote, isDailyNote } from './work/dailyNote.mjs'
import { SYNC_BOARD, syncChecks } from './sync.mjs'
import { informationOf, instructionsOf, notesToMain, partnerDecidedOf, storeNeeds, storeWaits, withPartnerOf } from './work/lists.mjs'
import { NOTE_LINE, isPartnerAnswered, stepWaitsForPartner } from './work/partnerAnswers.mjs'
import { recapsOf } from './work/recap.mjs'
import { isHolding, pauseFacts } from './work/pause.mjs'
import { reconcile } from './work/reconcile.mjs'
import { effortPlan, runSettings } from './work/effort.mjs'
import { enforcementReadiness } from './work/routing/capabilities.mjs'
import { routingHolds } from './work/routing/assignments.mjs'
import { refineStop } from './refineGate.mjs'
import { contextOfStep, flowOfStep, itemOfStep, itemsOf, reviewWaitOfStep, storeBacklog } from './work/read.mjs'
import { clearHolds, clearOwed, modAtLeast } from './clearOwed.mjs'
import { checkedOf, fixOutcomeOf } from './work/resultCheck.mjs'
import { guardOf } from './goalGuard.mjs'
import { standardOf } from './work/standard.mjs'
import { rolloutPlan } from './work/modRollout.mjs'
import { chatsByRole } from './oldMods.mjs'
import { stoppedOf } from './stopped.mjs'
import { backgroundRunning, conversation, doingNow, finishedBetween, saysUnfinished, parseTail, saysDone, taskOrigin, turnEnded, turnStart, turnState, unanswered, waitingFor } from './transcript.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
/** B288: a round being typed counts as running this long at most; after it arrived, its turn shows within this. */
const ROUND_TYPING_MS = 10 * MIN
const ROUND_SHOWS_MS = 2 * MIN
const ASKED = 'Asked you a question in its chat.'
/** A chat's own file that says it works is renewed twice a minute. Older than this, its process is gone. */
const CUT_OFF_MS = 150_000
/** A running chat's mod asks the board every few seconds. Not heard from for this long, its process is not running. */
const SEEN_MS = 30_000
/** B566: a chat whose conversation was written this lately runs (its process writes it). */
const WRITTEN_RUNS_MS = 60_000
/** B161: the mark under a line typed on the board (bridge.mjs, `messageText`), and how many lines of the talk are kept. */
const TYPED_MARK = /\n?\(typed on the worker board, \d{1,2}:\d{2}\)\s*$/
const TALK_MESSAGES = 40
/** B281: the mark before an answer given on the board (bridge.mjs, `messageText`): the board's, not the person's words. */
const ANSWERED_MARK = /^\(answered on the worker board, \d{1,2}:\d{2}\)\s*/
/** B281: what the board adds to an answer given on it (bridge.mjs, `messageText`): a picture's place, and what to do with a verdict. */
const BOARD_LINES = /^(?:Picture: |Pick this up: )/
const BOARD_CLOSE = /\s*(?:Tick this step in the backlog\.|Close this request\.)$/
/** B281: how much of the person's feedback a task window gets: one line. */
const FEEDBACK_CHARS = 300
/** B161: the first lines of what the board types into the main chat for itself (say.mjs, design.mjs): not the person's talk. */
const BOARD_WORDS = /^(?:restart for mod|spawn workers|remove worker|prepare restart|resume|start "|backlog step from the Design tab|queue step from the Design tab|queue step from the backlog|advisor recommendation|refine step|check step|step refined|ask from the goal map|partner effort|set model and effort|set effort|backlog step from the goal map|check sync)\b/
/** B300: the reconciler's flags a lane shows; an old ask stands under Needs your attention, a broken file on top. */
const LANE_FLAGS = ['stuck', 'not taken', 'check failed', 'card', 'waits']
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

const textOr = (value, fallback) => (typeof value === 'string' ? value : fallback)

/**
 * B315: a lane that counts as working only by what is left of it (its card, its step, or a turn the transcript shows
 * open) while its process does not run: the app was quit and opened again, and no chat runs until it is opened or a
 * message reaches it. Stale when its transcript has been quiet since before the app's last start (`appStartedAt`,
 * known as long as its process has not answered the board: `isRunning` not true), or for longer than the grace time
 * while its process is known not to run (`isRunning` false). Such a lane is "Not running", never "Working".
 */
export function isStaleWork({ state, isRunning, writtenAt, appStartedAt, now, graceMs = GRACE_MS }) {
  if (state !== 'working' || isRunning === true || !Number.isFinite(writtenAt)) return false
  if (Number.isFinite(appStartedAt) && writtenAt < appStartedAt) return true
  return isRunning === false && now - writtenAt > graceMs
}

/** B315: a stale lane as the board shows it: "Not running", its task and step kept, nothing of a turn or a time. */
const offLane = (lane, since) => ({
  ...lane, state: 'off', offSince: since, eta: null, isWithoutTime: false, doingNow: null, between: null, quietMs: null, isQuiet: false, unanswered: null, resting: null,
  // Partner answers, the review's findings: a chat that does not run waits for nobody; its lane says "Not running".
  waitsForPartner: null,
})

/**
 * B315: whether the main chat has taken words that were only copied for the person to paste: the person's words in
 * its transcript, since they were copied, begin with their first line.
 */
function isTakenBy(entries, message, prefix) {
  if (entries === null) return null
  const first = String(message.pasteText ?? message.text ?? '').split('\n')[0].trim()
  if (first === '') return null
  const said = conversation(entries, { prefix, limit: 400 }).find(one => one.from === 'you' && one.at >= message.at - MIN && one.text.trim().startsWith(first))
  return said === undefined ? null : said.at
}

/** How long a word only copied for the person to paste is kept on the restart banner at most. */
const COPIED_MS = 2 * HOUR

/**
 * Whether a word to the main chat that was only copied still matters, so the restart banner keeps saying to paste it.
 * It no longer does once the person dismissed it, after two hours, or once what it was for has happened: for
 * "resume", a turn of the main chat since the copy has the word "resume", whoever brought it (pasted, another chat,
 * the board); for any other line, a turn of the main chat since the copy contains its first line. `entries` null: the
 * main chat's transcript cannot be read. (Pause 2: no restart file any more.)
 */
function stillMatters(message, { entries, prefix, now }) {
  if (Number.isFinite(message.dismissedAt) || now - message.at >= COPIED_MS) return false
  const turns = entries === null ? [] : conversation(entries, { prefix, limit: 400 }).filter(one => one.from !== 'chat' && one.at >= message.at)
  const has = test => turns.some(one => test(one.text))
  if (message.command === 'resume') return !has(text => /\bresume\b/i.test(text))
  const first = String(message.pasteText ?? message.text ?? '').split('\n')[0].trim()
  return first === '' || !has(text => text.includes(first))
}

/**
 * Why a chat whose turn has ended is not free, or null when it is: its task is not reported yet, background work
 * it started still runs, or the store holds a step in progress for it. The board then shows it as working, between
 * two turns.
 */
export function heldBy({ plan, background, step, isCompleted = false, isDone = false, isUnfinished = false }) {
  // A card holds the chat unless the app's own summary calls the ended turn completed: a chat that reported and
  // forgot to clear its card is done. One that asked another chat in the middle of its task still waits. B148: a
  // chat whose last answer ends with "+ Done:   yes" is done, whatever its card says or what it left running in
  // the background (a server it started); a step the store holds in progress for it still holds.
  // B292: nor when the answer closed "Done: partly" or "no": the task is open.
  if (plan?.task != null && !plan.task.isReported && !isDone && (!isCompleted || plan.task.asked === true || isUnfinished)) {
    return { why: 'task', text: plan.task.asked === true ? 'Its turn has ended; it asked another chat and waits for the answer.' : 'Its turn has ended; its task is not reported yet.' }
  }
  if (background > 0 && !isDone) return { why: 'background', text: 'Its turn has ended; background work it started is still running.' }
  // B300: its step in progress in the store holds it, also one without a branch.
  if (step !== null) return { why: 'branch', text: step.branch === null || step.branch === undefined ? `Its turn has ended; its step ${step.id} is in progress.` : `Its turn has ended; its branch ${step.branch} is still open.` }
  return null
}

/**
 * B281: a note line that does not say what a step is: who has it or how far it is, the person's answers to a quick
 * check (choices, not the ask), or a head for files, tests or the requirements.
 */
const STEP_STATUS = /^(?:handed (?:to|over)|in progress|done on|approved|refined|picked up|paused|moved|split|kept|queued|held|parked|merge \d|back on|taken out|accepted|was:|your (?:answers?|choice|yes|no|approval)\b|not handed out\b|later\b)/i
/** B281: a head with words after it ("Plan: ...", "Problem: ...", "Touches: ..."): a part of a step's notes, not what it is. */
const NOTE_HEAD = /^(?!your words\b)[A-Z][A-Za-z /]{1,28}:\s/

/** B281: "Your words (board, 18:26, ...): the ask" without its lead: the words after the first colon outside brackets. */
function withoutLead(line) {
  if (!/^your words\b/i.test(line)) return line
  let depth = 0
  for (let at = 0; at < line.length; at++) {
    if (line[at] === '(') depth += 1
    else if (line[at] === ')') depth = Math.max(0, depth - 1)
    else if (line[at] === ':' && depth === 0) return line.slice(at + 1).trim() || line
  }
  return line
}

/**
 * B281: what a backlog step is, in a line: the first line of its notes that says so (see STEP_STATUS), a point's dash
 * left off, the person's own words without their lead. Null when its notes have none.
 */
function aboutLine(notes = []) {
  for (const note of notes) {
    const line = String(note).trim().replace(/^[-*]\s+/, '')
    // B425: never the store's own line under a step ("[store] Priority: fix · Goal: G15").
    if (line === '' || line.startsWith('[store]') || STEP_STATUS.test(line.replace(/^\(/, '')) || NOTE_HEAD.test(line) || /^[A-Z][A-Za-z /]{1,28}:$/.test(line)) continue
    return withoutLead(line)
  }
  return null
}

/** B425: a line of a step's context with a part named in it ("... Requirements: ..."): that part and all after it. */
const NAMED_PART = /\s(?:Requirements|Touches|Context|Was):\s.*$/

/**
 * B425: what a step is, from its context: its first lines, up to the first that names a part ("Requirements: ...");
 * within a line, up to a part it names. A line that says what happened to it ("Handed to ...", "Asked Q12 ...") is not
 * what it is.
 */
function aboutLines(context) {
  const lines = []
  for (const line of context) {
    if (NOTE_HEAD.test(line) || /^[A-Z][A-Za-z /]{1,28}:$/.test(line)) break
    if (line.startsWith('[store]') || STEP_STATUS.test(line.replace(/^\(/, '')) || /^(?:asked|reported|checked|q\d+)\b/i.test(line)) continue
    const words = withoutLead(line.replace(NAMED_PART, '').trim())
    if (words !== '') lines.push(words)
  }
  return lines
}

/**
 * B425: what the window of the worker on a step shows of it (the person, 2026-10-19, I40: "if backlog items were refined
 * I expect to see a picture and the refined story here"): its refined summary, picture and what we build; what it is
 * from its context (`about`), for a step without a refine block; its goal by name ("G29 Interesting level design");
 * and for the details its context, what it touches and the last BRIEF_HISTORY lines of its history (the step's own
 * window has them all). Null without the store's item.
 */
const BRIEF_HISTORY = 12

function stepBrief(work, id, goalMap, hasModels = true) {
  const item = itemOfStep(work, id)
  if (item === null) return null
  const goalId = String(item.goal ?? '').match(/\bG\d+\b/)?.[0] ?? null
  const node = goalId === null ? null : goalMap?.byId.get(goalId) ?? null
  const title = String(node?.title ?? '').trim()
  const context = contextOfStep(work, id)
  return {
    goal: goalId === null ? null : title === '' || title === goalId ? goalId : title.startsWith(`${goalId} `) ? title : `${goalId} ${title}`,
    summary: item.summary, picture: item.picture, what: item.what,
    // B468: the effort the worker runs at for it; model per step: and the model.
    effort: item.effort,
    // Model per step: shown only where the settings name the model ids, so the board shows no model it did not set.
    model: hasModels ? item.model : null,
    about: aboutLines(context), context, touches: item.touches, history: item.history.slice(-BRIEF_HISTORY),
  }
}

/**
 * B281: the person's feedback in one line: the board's marks around an answer or a line typed there left off, a
 * picture's place, and the lines joined with " · "; at most FEEDBACK_CHARS.
 */
function feedbackLine(words) {
  const lines = String(words ?? '').replace(TYPED_MARK, '').replace(ANSWERED_MARK, '').split('\n')
    .map(line => line.trim().replace(BOARD_CLOSE, '')).filter(line => line !== '' && line !== '[picture]' && !BOARD_LINES.test(line))
  const one = lines.join(' · ').replace(/\s+/g, ' ')
  return one.length > FEEDBACK_CHARS ? `${one.slice(0, FEEDBACK_CHARS - 1).trimEnd()}…` : one
}

/**
 * The task a chat is on, as the chat recorded it: the topic, the steps and the time of its plan line (`source:
 * 'plan'`). A busy chat that has recorded nothing shows the step the store holds for it (`source: 'step'`). With
 * neither, a working chat's task is there but has no words (`source: 'unrecorded'`, `text: ''`). The words of a
 * prompt or of another chat's message are never used: what a person or a chat typed stays in the chat (B301: no task
 * is read from a chat's words). `step` is the step the store holds in progress for the chat, `stepById` finds an
 * open step by its id; a step gives the task its id and, for a chat with no estimate of its own, its time. A chat that
 * recorded its task is on a step too (`stepId`): the store's, else the open one of its own (or of nobody) that its
 * record names by id.
 */
function taskOf({ chat, plan, scan, state, before, lines, prefix, now, step = null, stepById = () => null }) {
  // `scan` holds the entries that can start a task: the tail, after a longer look back when there is one.
  const opening = scan === null ? null : turnStart(scan, { prefix })
  const bare = { step: null, steps: null, names: null, leftMs: null, estimateAt: null, stepLeftMs: null, stepEstimateAt: null, source: 'unrecorded', by: null }
  // A task stands while the chat works on it or waits for the person; a free chat has finished it.
  const isBusy = state === 'working' || state === 'waiting'
  let task = null
  // The step a chat is on: the store's, else the one its own record names.
  const firstOpen = (ids, whose = null) => ids.map(id => stepById(id, whose)).find(found => found !== null) ?? null
  let onStep = step
  if (plan?.task != null && !plan.task.isReported) {
    const { text, step: at, steps, names, leftMs } = plan.task
    // The time for the step it is on, and when it said so: like the task's own time, it counts down from there.
    const stepLeftMs = plan.task.stepLeftMs ?? null
    task = { text, step: at, steps, names, leftMs, estimateAt: leftMs === null ? null : plan.at, stepLeftMs, stepEstimateAt: stepLeftMs === null ? null : plan.at, source: 'plan', by: null }
    // Its record may name other steps too ("after B93"): only a step of its own, or of nobody, counts.
    onStep ??= firstOpen(text.match(/\bB\d+\b/g) ?? [], chat.name)
  } else if (isBusy) {
    if (onStep !== null) task = { text: [onStep.id, onStep.title].filter(Boolean).join(' '), ...bare, source: 'step' }
    else if (state === 'working') task = { text: '', ...bare }
  }
  if (task === null) return null

  // A task without words has no name the history could know it by.
  const facts = task.text === '' ? null : taskFacts(lines, chat.name, task.text, now)
  // When the task was first known: when the board first saw it, or when the chat says it named it.
  const firstSeenAt = Math.min(facts?.firstSeenAt ?? now, plan?.task?.since ?? Infinity)
  // What could have started it, not later than that: the last time a turn was opened, and the moment the chat named
  // it. The latest of them is the start. A task the chat did not record starts with what opened its turn. When the
  // entries cannot be sure of that opening (it may be a remark in the middle of a longer turn), the start the history
  // recorded while the chat kept working stands.
  const kept = before?.state === 'working' && before.source !== 'plan' && Number.isFinite(before.startedAt) ? before.startedAt : null
  const openedAt = opening === null ? null : opening.isOpen && opening.isSure ? opening.at : kept ?? opening.at
  // A task the chat named starts no earlier than the moment it named this one while the board still showed another
  // task it had named. A long turn holds several tasks, and each counts its own time.
  const isNext = facts === null && before?.source === 'plan' && typeof before.task === 'string' && before.task !== ''
    && before.task !== task.text && (before.state === 'working' || before.state === 'waiting')
  const starts = (task.source === 'plan' ? [opening?.at, isNext ? firstSeenAt : null] : [openedAt])
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
    // The step the chat works on, and the time the store gives it (Estimate), when it has one.
    stepId: onStep?.id ?? null,
    stepMinutes: onStep?.minutes ?? null,
  }
}


/**
 * When a working chat expects to be done: when it gave its estimate, plus what it said was left (`isOwn`, `from:
 * 'own'`). A chat that gave none gets the time of its step (its Estimate, `from: 'step'`), counted from the task's
 * start: an estimate that is not its own. Null when neither is there.
 */
function etaOf(task, state, now) {
  if (state !== 'working' || task === null) return null
  const isOwn = task.leftMs !== null && task.estimateAt !== null
  const minutes = task.stepMinutes
  if (!isOwn && (minutes === null || !Number.isFinite(task.startedAt))) return null
  const at = isOwn ? task.estimateAt + task.leftMs : task.startedAt + minutes * MIN
  // B185: over its estimate (`isOverdue`, shown as a fault) only when over twice it and by at least 10 minutes, the
  // person's yes against false alarms; a little over is only that (`isOver`).
  const spanMs = Number.isFinite(task.startedAt) ? at - task.startedAt : 0
  const isOverdue = now - at >= 10 * MIN && (spanMs <= 0 || now - task.startedAt > 2 * spanMs)
  return { at, leftMs: Math.max(0, at - now), isOverdue, isOver: at < now, isOwn, from: isOwn ? 'own' : 'step' }
}

/**
 * B149: what a chat that waits last said (`waitingFor`), with its parts in the agreed form (`handover`, null when it
 * has none), for its window: information, never what waits for the person (B301: that is the store's asks). What the
 * person typed to a chat that waits is never shown (B100).
 */
function finishedWith(waits) {
  if (waits === null) return null
  return { ...waits, handover: parseHandover(waits.words) }
}

function card(chat, raw, { now, config, last, lines, main, prefix, stepOf = () => null, stepById = () => null, briefOf = () => null, waits, notes = new Map(), pauseOver = () => false, movedInto = new Map() }) {
  // `session` is the id the chat's own process knows itself by: the bridge serves only that one under this name.
  // `appSession` is the id the app knows the chat by: the main chat starts a chat that is not running with it.
  // B468: `effort` is what the app's file of the chat says it runs at, or null.
  const base = { name: chat.name, isMain: chat.isMain, isLeftover: chat.isLeftover, session: chat.cliSessionId ?? null, appSession: chat.appSessionId ?? null, effort: chat.effort ?? null, model: chat.model ?? null, removedAt: chat.removedAt ?? null }
  const none = { lastAnswer: null, quietMs: null, isQuiet: false, isAsking: false, doingNow: null, between: null, needsYou: null, statusDetail: null, waitingSince: null, waitsFor: null, task: null, cutOffAt: null, eta: null, isWithoutTime: false, suspended: null, usage: [], lastTask: null, givenTask: null, feedback: null, compaction: null, unanswered: null, idle: null, unfiled: null, resting: null, waitsForPartner: null }
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
  // The longer look back is a few minutes old, so the tail follows it.
  const scan = typeof tail?.earlier === 'string' && entries !== null ? [...parseTail(tail.earlier, false), ...entries] : entries
  const step = stepOf(chat.name, plan?.task?.isReported === false ? String(plan.task.text ?? '').match(/\bB\d+\b/g) ?? [] : [])
  const wasCutOff = isCutOff({ turn, plan, lastWriteAt, turnStartedAt, now })
  // An ended turn is not a free chat while something of its work is open: it is between two turns.
  // Clear after each step: a chat cleared into this session (its card says so, or the board followed its old card here)
  // whose new conversation holds no turn yet has ended its work: free, so its next step is delivered as to any free
  // worker. A transcript that cannot be read, of a chat no clear brought here, stays unknown.
  const isFreshAfterClear = (turn === null || turn === 'unknown') && (plan?.compaction?.kind === 'cleared' || movedInto.has(chat.cliSessionId))
  const appState = isFreshAfterClear ? 'free' : chatState({ turn, category: summary?.category, needsAction: summary?.needsAction })
  // B299, B301: no answer is read for questions: a chat waits for the person when it asked with the app's question form
  // or holds an open blocking ask in the store; else its ended turn is free (or held, below).
  const isBlocked = waits.blocking.has(chat.name.toLowerCase())
  const ended = appState === 'working' || appState === 'unknown' ? appState : turn === 'asking' || isBlocked ? 'waiting' : 'free'
  // B148: its last answer ends with "+ Done:   yes": it has finished, and a card it forgot to clear holds nothing.
  const isDone = turn === 'ended' && entries !== null && saysDone(entries)
  // B292: an answer that closed "- Done:   partly" or "no" has left its task open, whatever the app calls the turn.
  const isUnfinished = turn === 'ended' && entries !== null && saysUnfinished(entries)
  // B290: the app counts the main chat as waiting after every answer; that ended turn is free, and its own card does not
  // hold it either, as the main chat reports to nobody.
  const isMainIdle = chat.isMain && appState === 'waiting' && turn === 'ended'
  const background = entries === null ? 0 : backgroundRunning(entries)
  // Partner answers, the review's findings: a chat whose blocking ask waits for the partner's answer waits for the
  // partner, not for the person: held between two turns, its lane says so (`waitsForPartner`).
  const forPartner = waits.partner?.get(chat.name.toLowerCase()) ?? []
  const held = wasCutOff || ended !== 'free' ? null : forPartner.length > 0 ? { why: 'partner', text: `Its turn has ended; it waits for your partner's answer (${forPartner.join(', ')}).` } : heldBy({
    plan: isMainIdle ? null : plan, step,
    isCompleted: summary?.category === 'completed',
    isDone,
    isUnfinished,
    background,
  })
  // B113: held by a limit of the plan. The app stopped it there, or the worker told the main chat that it paused
  // and its turn has ended. Until when is settled once the limits are known (`heldUntil`).
  const stop = entries === null ? null : limitStop(entries)
  const mains = [main.mainTitle, main.mainSession].filter(Boolean)
  const canPause = stop === null && entries !== null && !chat.isMain && turn === 'ended'
  // B310: or it filed that line as a work note to the main chat; the newer of the two forms decides.
  const sent = canPause ? pauseNote(entries, mains) : null
  const filed = canPause ? storePause(notes.get(chat.name.toLowerCase()), scan ?? entries, mains) : null
  const word = [sent, filed].filter(Boolean).reduce((a, b) => (a === null || b.at > a.at ? b : a), null)
  // B312: a pause whose limit a newer reading shows back (`pauseOver`, settled once the limits are known) is over.
  const told = word === null || word.isPaused === false ? null : word
  const note = told !== null && pauseOver({ limit: told.limit ?? 'fiveHour', since: told.at, percent: told.percent ?? null }) ? null : told
  // The app's stop is over once the reset it named has passed, or (B312, `pauseOver`) a reading after it shows that
  // limit back under full: the chat is then what its turn says, free or between two turns, and is woken or handed work.
  const isStopOver = stop !== null && ((stop.resetsAt !== null && stop.resetsAt <= now) || pauseOver({ limit: stop.limit, since: stop.at, percent: 100 }))
  // Pause 2: a stop for a restart is the store's pause (pause.json and the checkpoints), no longer a "Safe point:" line.
  const paused = stop !== null && !isStopOver ? { by: 'app', limit: stop.limit, since: stop.at, named: stop.resetsAt }
    : stop === null && note !== null ? { by: 'note', limit: note.limit ?? 'fiveHour', since: note.at, named: note.until, percent: note.percent ?? null } : null
  const state = paused !== null ? 'suspended' : wasCutOff ? 'interrupted' : held === null ? ended : 'working'
  // No sign of life is about a turn that runs: between two turns a chat writes nothing.
  const quietMs = state === 'working' && held === null && lastWriteAt !== null ? Math.max(0, now - lastWriteAt) : null

  let needsYou = null
  if (state === 'waiting') needsYou = turn === 'asking' ? ASKED : summary?.needsAction?.trim() || summary?.detail?.trim() || null

  // A chat that was cut off, or is held by a limit, keeps the task it was on.
  // B148: a chat that has finished (its last answer says "Done: yes", or it is free by the app's own summary) is
  // not on the task its card still names: that card was left behind, and the lane names it only as finished.
  const isLeftBehind = plan?.task != null && !plan.task.isReported && (isDone || state === 'free')
  const task = taskOf({ chat, plan: isLeftBehind ? { ...plan, task: null } : plan, state: wasCutOff || paused !== null ? 'working' : state, before: last.get(chat.name), lines, prefix, now, scan, step, stepById })
  const eta = etaOf(task, state, now)
  // B151: the person's words that gave it the task it is on, as they arrived, for the window a click on its lane opens;
  // with the step it is on, else the first open one those words name. B301: another chat's message gives no task.
  const isOnTask = task !== null && (state === 'working' || state === 'suspended' || state === 'interrupted')
  const until = Number.isFinite(task?.startedAt) ? task.startedAt + 2 * MIN : Infinity
  // B281: the person's words that opened its turn (only a sure opening: words the tail cannot see the turn before of
  // may be a remark in the middle of a turn). They are feedback on the task given before them, unless the chat
  // finished that task in between (it said "Done: yes"): then they are the task. B301: a step the store holds for the
  // chat is its task, whatever was typed; the person's words that opened its turn are feedback on it.
  const opening = !isOnTask || scan === null ? null : turnStart(scan, { prefix })
  const words = opening?.by === 'you' && opening.isSure ? opening : null
  const isOnStep = isOnTask && step !== null && task.stepId === step.id
  let given = !isOnTask || scan === null || isOnStep ? null : taskOrigin(scan, until)
  if (words !== null && !isOnStep) {
    const before = taskOrigin(scan, words.at - 1)
    const isOn = before !== null && !finishedBetween(scan, before.at, words.at)
    // Its card named the task anew for the feedback, so its start is the feedback's: the task is the one before.
    if (isOn && (given === null || given.at >= words.at)) given = before
    // A task it finished: the words started a new one.
    if (!isOn && given !== null && given.at < words.at) given = taskOrigin(scan, words.at)
  }
  const givenStep = isOnStep ? stepById(step.id) ?? step : given === null ? null
    : (task.stepId === null ? null : stepById(task.stepId)) ?? (given.text.split('\n')[0].match(/\bB\d+\b/g) ?? []).map(id => stepById(id)).find(one => one !== null) ?? null
  // B281: the person's words after the task was given: the feedback it is on now.
  const after = isOnStep ? -Infinity : given?.at ?? task?.startedAt ?? Infinity
  const feedback = words !== null && words.at > after ? { at: words.at, text: feedbackLine(words.words ?? words.title) } : null
  return {
    ...base,
    state,
    // Model per step: the model its last answer ran on and when, as its transcript names it (the app's own lines carry
    // no model of Claude's, a helper's lines are not its own), or null.
    lastAnswer: lastAnswerModel(entries),
    quietMs,
    isQuiet: quietMs !== null && quietMs > config.quietMinutes * MIN,
    // It asked with the app's own question form: that can only be answered in its chat.
    isAsking: turn === 'asking',
    doingNow: state === 'working' && held === null ? doingNow(entries) : null,
    // Why it counts as working although its turn has ended, in words; null for a turn that runs.
    between: state === 'working' && held !== null ? held.text : null,
    // Partner answers, the review's findings: the asks of its own it waits on the partner for.
    waitsForPartner: state === 'working' && held?.why === 'partner' ? forPartner : null,
    needsYou,
    statusDetail: turn === 'ended' ? summary?.detail?.trim() || null : null,
    // The turn's last entry: when it ended, or when it asked.
    waitingSince: state === 'waiting' ? entries.findLast(entry => entry.type === 'assistant' && !entry.isSidechain)?.at ?? null : null,
    // B100: what it last said, for the window of what it waits for: its own words, never what was typed to it.
    // B149: with the parts of it when it finished a task with something left for the person, and the message that
    // gave it that task.
    waitsFor: state === 'waiting' ? finishedWith(waitingFor(entries)) : null,
    task,
    // When a chat that was cut off last wrote.
    cutOffAt: wasCutOff ? lastWriteAt : null,
    // Pause and resume (spec 2026-10-18): when its last turn began, so the board knows who started one after a resume.
    turnAt: turnStartedAt,
    // The review of part 1: why it counts as working between two turns (task, background, branch), and whether its
    // transcript shows a turn open (also behind a "suspended" that may be stale).
    heldBy: held?.why ?? null,
    isTurnOpen: turn === 'running' && !wasCutOff,
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
    // B151: the task as it was given: the person's words (`by: 'you'`), or (B301) the step the store holds for it (`by: 'step'`).
    // B425: with the step's brief for its window (`stepBrief`).
    givenTask: isOnStep ? { by: 'step', at: null, text: '', step: { id: givenStep.id, title: givenStep.title, about: givenStep.about ?? null, brief: briefOf(givenStep.id) } }
      : given === null ? null : { ...given, step: givenStep === null ? null : { id: givenStep.id, title: givenStep.title, about: givenStep.about ?? null, brief: briefOf(givenStep.id) } },
    feedback,
    suspended: paused,
    // What this chat itself looked up of the limits: in its tail, and further back (`tail.usage`).
    usage: entries === null ? [] : usageReadings([...(typeof tail.usage === 'string' ? parseTail(tail.usage, false) : []), ...entries]),
    // B301: its last answer asks the person in a "For you" block, and the store holds no ask of it since that turn
    // began: shown as a warning under Needs your attention, never read as a question.
    unfiled: unfiledAsk(entries, scan, turn, waits, chat.name, prefix),
    // B308: its turn has ended with nothing running (no command or subagent it left in the background, as `heldBy`
    // reads it: a "Done: yes" overrules one), it is not cut off or suspended: since when, and its last answer for the window. The reconciler
    // names a worker that holds a step so, without an open ask, as one that may wait for the person.
    resting: restingOf({ entries, turn, idle, isRunningOn: background > 0 && !isDone, isStopped: wasCutOff || paused !== null }),
  }
}

/** Model per step: the model of a chat's last answer and when, `{ model, at }`, as B352 reads the partner's; or null. */
function lastAnswerModel(entries) {
  const answer = (entries ?? []).findLast(entry => entry.type === 'assistant' && !entry.isSidechain && typeof entry.model === 'string' && entry.model.startsWith('claude-'))
  return answer === undefined || !Number.isFinite(answer.at) ? null : { model: answer.model, at: answer.at }
}

/**
 * B308: a chat whose turn has ended and runs nothing: `{ since, at, words }` (since when, from the board's reading of
 * the turn; its last answer and when), or null while it works, waits on the app's question form, was cut off, is
 * suspended, or has a command or subagent running in the background (`isRunningOn`).
 */
function restingOf({ entries, turn, idle, isRunningOn, isStopped }) {
  if (entries === null || turn !== 'ended' || isStopped || isRunningOn) return null
  const said = waitingFor(entries)
  const since = Number.isFinite(idle?.since) ? idle.since : said?.at
  return Number.isFinite(since) ? { since, at: said?.at ?? since, words: said?.words ?? '' } : null
}

/**
 * B301: a chat that wrote questions in its chat but filed no ask: its turn has ended with an answer whose last part is
 * a "For you" block (handover.mjs, `asksAtEnd`), and no ask of its own was filed since the turn that answer ends
 * began (an ask of an earlier turn, open or not, does not count). The turn's start is looked for in `scan` (the tail
 * and the longer look back); when it cannot be found the board warns all the same and says so (`isStartUnknown`).
 * `{ at, words, isStartUnknown }` (the answer, for the window), or null. A question asked with the app's own form is
 * filed by the Workers mod, so it is not this.
 * Warnings (2026-10-19): the turn is the one that wrote that answer: its start is the last opening at or before the
 * answer. A turn opened since (the person's answer to its ask, typed by the board) has not answered yet, and the app's
 * summary of the answer before keeps counting it as ended until it does: seen live at 08:24, when Q154, filed at 00:28
 * in the turn that wrote the block, counted as filed before the turn of 08:24 the answer to it had opened. An ask's
 * time is `askFiledMs` (to the millisecond; an older one at the end of its minute). And an open ask of its own that an
 * item of the block asks (its id named, as the work tool writes it, or the same words) keeps the warning away, from
 * whichever turn it is.
 */
function unfiledAsk(entries, scan, turn, waits, name, prefix) {
  if (entries === null || turn !== 'ended') return null
  const said = waitingFor(entries)
  if (said === null || !asksAtEnd(said.words)) return null
  if (blockAsksOpen(said.words, waits.open ?? new Map(), name.toLowerCase())) return null
  const opened = turnStart((scan ?? entries).filter(entry => !(entry.at > said.at)), { prefix })?.at ?? null
  if (opened === null) return { at: said.at, words: said.words, isStartUnknown: true }
  const filed = waits.filed.get(name.toLowerCase()) ?? -Infinity
  if (filed >= opened) return null
  return { at: said.at, words: said.words, isStartUnknown: false }
}

/**
 * Warnings (2026-10-19): whether an item of the "For you" block an answer ends with asks one of the open asks of the
 * chat `name` (`{ id, key, words, of }`, by chat in `open`): it names the ask's id as a word of its own, or asks the
 * same words (`sameAsk`). B474: or the board left it out as a question asked already, in other words or of another chat
 * (`forYouRepeat`), so the chat filed nothing for it and is not warned.
 */
function blockAsksOpen(words, open, name) {
  const own = open.get(name) ?? []
  const others = [...open].filter(([chat]) => chat !== name).flatMap(([, asks]) => asks)
  if (own.length === 0 && others.length === 0) return false
  const items = parseHandover(words)?.items ?? []
  return items.some(item => {
    const named = askIdsIn(item.text)
    const key = askKey(item.ask)
    return own.some(ask => named.includes(ask.id) || (key !== '' && ask.key !== '' && sameAsk(ask.key, key)))
      || forYouRepeat({ text: [item.text], kind: item.kind === 'do' ? 'do' : 'decide' }, { own, others }) !== null
  })
}

/**
 * B113: a chat held by a limit, with the time it can go on: `{ by, limit, since, until, isBack }`. `until` is the
 * time the app's stop or the worker's note named, else when that limit resets as far as the board knows; null
 * when nothing says. `isBack` says that time has passed: the limit is back and the chat has not gone on, because
 * nothing starts it by itself.
 */
function heldUntil(paused, limits, now) {
  if (paused === null) return null
  const { named, percent, ...held } = paused
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
export function refineAsk(step, sent, now) {
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
 * B280: what was sent to a chat and is not in its chat yet, by kind: refines, rounds (of the board's clock, or asked
 * for by the person), and the person's words (a line typed to it, an answer to its question, an answer to its
 * recommendation). One taken and never settled waits no more after ten minutes, as the outbox shows it (store.mjs).
 */
const TAKEN_SHOWN_MS = 10 * MIN
function queuedFor(sent, name, now) {
  const open = sent.filter(message => message.to === name
    && (message.state === 'waiting' || (message.state === 'taken' && now - (message.takenAt ?? message.at) < TAKEN_SHOWN_MS)))
  const refines = open.filter(message => message.command === 'refine').length
  const rounds = open.filter(message => message.command === 'round' || message.command === 'recheck').length
  return { refines, rounds, words: open.length - refines - rounds }
}

/** B100: a chat's task as its card names it, for the window of what it waits for: the topic, the step, since when. */
const cardOf = task => (task === null ? null : {
  text: task.text, step: task.step, steps: task.steps, name: task.names?.[(task.step ?? 0) - 1] ?? null, startedAt: task.startedAt, stepId: task.stepId ?? null,
})

const asAnswer = message => (message === undefined ? null : {
  at: message.at, verdict: message.verdict ?? null, text: message.text ?? '', state: message.state, ...(message.isHeld === true ? { isHeld: true } : {}),
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
 * last said (`waits`).
 * B275: the Advisor (`advisor`, its card) asks as a worker does when it waits (`advisorWaits`), answered in its chat.
 * B424: so does the partner's helper (`helper`, its card), which is no lane either.
 * B301: what waits for the person is the store's asks (`storeNeeds`); a chat's own card stands only for the app's
 * question form that the mod could not file, and a chat that wrote questions in its chat without filing an ask is a
 * warning (`unfiled`) with the way to its chat, never a question to answer here.
 */
function needsOf(asks, lanes, outbox, gameOf, now, base = 'main', { advisor = null, advisorWaits = null, helper = null, waits, idle = [] }) {
  const live = lanes.filter(lane => !lane.isLeftover)
  const helpers = helper === null ? [] : [helper]
  const names = new Set([...live, ...helpers].map(lane => lane.name))
  // The chats whose own question form and silence the cards below read: the lanes, the Advisor while it waits, the helper.
  const asking = [...live, ...(advisorWaits === null ? [] : [advisorWaits]), ...helpers]
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
  for (const lane of asking) {
    // B299: the store's asks are the cards; a chat's own card stays only for the app's question form that the mod could
    // not file.
    const isFiled = !lane.isAsking || waits.form.has(lane.name.toLowerCase())
    if (lane.state === 'waiting' && !asked.has(lane.name) && !isFiled) {
      items.push({
        // One id per time it started waiting, so an answer to an earlier question never sticks to a later one.
        id: `chat:${lane.name}:${lane.waitingSince ?? 0}`,
        from: lane.name,
        kind: 'input',
        title: 'Asked you a question in its chat',
        text: 'It used the app\'s question form, which can only be answered there.',
        at: lane.waitingSince,
        ...blank,
        version: null,
        canAnswer: false,
        task: cardOf(lane.task),
        waits: lane.waitsFor,
        isMain: lane.isMain === true,
        isAdvisor: lane.isAdvisor === true,
      })
    }
  }
  // B301: a chat that wrote questions in its chat but filed no ask: a warning, with the way to its chat.
  for (const lane of [...live, ...(advisor === null ? [] : [advisor]), ...helpers]) {
    if ((lane.unfiled ?? null) === null) continue
    const isAdvisor = advisor !== null && lane === advisor
    items.push({
      id: `unfiled:${lane.name}:${lane.unfiled.at ?? 0}`,
      from: lane.name,
      kind: 'unfiled',
      title: `${lane.name} wrote questions in its chat but filed no ask`,
      text: `Its last answer ends with a "For you" block, and the work store holds no ask of it since that turn began${lane.unfiled.isStartUnknown ? ' (the board could not tell when this turn began, so it warns all the same)' : ''}. The board does not read questions from a chat: answer them in its chat, or ask it to file them with work ask.`,
      at: lane.unfiled.at,
      ...blank,
      version: null,
      canAnswer: false,
      task: cardOf(lane.task),
      waits: { at: lane.unfiled.at, words: lane.unfiled.words, questions: [], plan: null, handover: parseHandover(lane.unfiled.words) },
      isMain: lane.isMain === true,
      isAdvisor,
      // Where its chat is on the board: Talk to Main, the Advisor's tab, or a worker's last answer in this card's window.
      talk: lane.isMain === true ? 'main' : isAdvisor ? 'advisor' : 'window',
    })
  }
  // B308: a worker that holds steps, has ended its turn with nothing running and asked nothing (the reconciler's `idle
  // hold`): a hint with the way to its answer. A chat that wrote questions without an ask has that warning instead.
  for (const flag of idle) {
    const lane = live.find(one => one.name === flag.chat)
    if (lane === undefined || lane.isMain === true || (lane.unfiled ?? null) !== null || (lane.resting ?? null) === null) continue
    items.push({
      id: `idle:${lane.name}:${lane.resting.since}`,
      from: lane.name,
      kind: 'idle',
      title: flag.text,
      text: `Its turn has ended and nothing of it runs, it holds ${flag.ids.length === 1 ? 'this step' : 'these steps'} in the work store, and no ask of it is open. It may wait for you without having filed a question: look at its last answer, and answer it in its chat, or ask it to file an ask with work ask or to report.`,
      at: lane.resting.at,
      ...blank,
      version: null,
      canAnswer: false,
      task: cardOf(lane.task),
      waits: { at: lane.resting.at, words: lane.resting.words, questions: [], plan: null, handover: parseHandover(lane.resting.words) },
      isMain: false,
      isAdvisor: false,
      talk: 'window',
    })
  }
  for (const lane of asking) {
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
  return items
    .map(item => ({ ...item, ...answerOf(outbox, item.id, item.version) }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

/**
 * Focus 4 (spec 2026-10-18, section 4): each card of Needs your attention says whether it is the partner's
 * (`isPartner`): asked by the chat the setting advisor names (`partner`), with or without the project's prefix. The
 * page shows those first, under "From your partner". No partner: none is. B424: `partner` may be a list, the partner and
 * its helper.
 */
export function markPartner(needs, partner, prefix = '') {
  const plain = name => String(name ?? '').replace(prefix, '').trim().toLowerCase()
  const owns = new Set((Array.isArray(partner) ? partner : [partner]).map(plain).filter(own => own !== ''))
  return needs.map(need => ({ ...need, isPartner: need.from !== null && need.from !== undefined && owns.has(plain(need.from)) }))
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
 * B301: when each step of the store went done, and who held it: `{ at, by }` by id, from the History line of its last
 * move to done (`- <date time> <who>: review → done`) and its Owner. For the list of the steps finished last.
 */
function doneTimes(work, prefix) {
  const times = new Map()
  for (const item of itemsOf(work)) {
    if (valueOf(item, 'Kind') !== 'step' || valueOf(item, 'State') !== 'done') continue
    const moved = (item.sections.get('History') ?? []).findLast(line => / → done\b/.test(line))?.match(/^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s/)?.[1]
    const at = moved === undefined ? NaN : sinceMs(moved)
    if (!Number.isFinite(at)) continue
    const owner = valueOf(item, 'Owner')
    times.set(valueOf(item, 'Id'), { at, by: owner === null ? null : owner.startsWith(prefix) ? owner.slice(prefix.length).trim() : owner })
  }
  return times
}

/**
 * The `/api/state` object. `raw` holds the texts as they were read (see sources.mjs), `lines` the history, and
 * `outbox` what was sent from the page and is not delivered yet (see store.mjs, `outboxNow`), and `runs` the
 * games the board started and that still run (see games.mjs).
 */
/**
 * B131, B137: what the board looks for and where, for each thing it did not find: the list of chats, a chat of the
 * project. Empty when nothing is missing. The paths come from the settings. B301: a missing work store is said on top
 * of the page (`store`), not here.
 */
export function lookingFor({ list, prefix, config, chats }) {
  const listFile = join(config.project, '.claude', 'chats', 'list.json')
  const lines = []
  if (config.project === '') lines.push('The settings name no "project": the board looks for everything in that folder.')
  else if (list.problem === 'missing') lines.push(`No list of chats: the board looks for ${listFile}. Copy examples/list.json there and set "prefix" (how the project's chat titles start) and "main" (the main chat's name).`)
  else if (list.problem === 'broken') lines.push(`The list of chats ${listFile} is not valid JSON.`)
  else if (list.problem === 'incomplete') lines.push(`The list of chats ${listFile} needs a "prefix" and a "main".`)
  else if (chats === 0) lines.push(`No chat of this project yet: the board shows the open chats in ${config.project} whose titles start with "${prefix}".`)
  return lines
}

/** Focus 1: the minutes a part's size names ("about 1 h", "30 min", "1.5 h", "2 h 30 min"); null when it names none. */
function sizeMinutes(size) {
  const hours = String(size ?? '').match(/(\d+(?:[.,]\d+)?)\s*h\b/)
  const minutes = String(size ?? '').match(/(\d+)\s*min\b/)
  if (hours === null && minutes === null) return null
  return Math.round((hours === null ? 0 : Number(hours[1].replace(',', '.')) * 60) + (minutes === null ? 0 : Number(minutes[1])))
}

const FINISHED = ['done', 'closed', 'dropped']
const UNDER_WAY = ['taken', 'in progress', 'waiting on you', 'review']
const NOT_HANDED = ['new', 'refined']

/**
 * Focus 4, seen live: the focus's parts whose steps were made but not handed out (`handout`, focusState) for longer than
 * the grace time: one hint under Needs your attention, with the way to the main chat (`main`, its name). None without
 * a focus or a main chat.
 */
export function handoutNeeds(focus, main, now) {
  if (focus === null || focus === undefined || main === null || main === undefined) return []
  const waiting = (focus.parts ?? []).filter(part => part.state === 'handout' && Number.isFinite(part.waitsSince) && now - part.waitsSince >= GRACE_MS)
  if (waiting.length === 0) return []
  const at = Math.max(...waiting.map(part => part.waitsSince))
  return [{
    id: `handout:${focus.id}:${at}`, from: main, kind: 'handout',
    title: `The steps of ${focus.id} wait for the main chat to hand them out`,
    text: `Your partner made the steps of ${waiting.map(part => part.title).join(', ')}, and none is queued yet. The main chat may not have read your partner's note: ask it to queue them.`,
    at, options: [], pictures: [], run: null, game: null, checks: [], tried: [], version: null, canAnswer: false, task: null, waits: null, isMain: true, isAdvisor: false, talk: 'main',
  }]
}

/**
 * Fix first: the board fix a focus part waits for, or null. A part's step queued (not itself a fix) whose owner works on
 * a board fix (taken, in progress, waiting on the person) or has one queued, which goes before it: that fix's id, the
 * one under way first, else the lowest.
 */
function fixAhead(known, steps, prefix) {
  const plain = name => String(name ?? '').replace(prefix, '').trim().toLowerCase()
  const own = new Set(known.map(one => one.head.get('Id')))
  const owners = new Set(known.filter(one => one.head.get('State') === 'queued' && !isFix(one) && (one.head.get('Owner') ?? '') !== '').map(one => plain(one.head.get('Owner'))))
  if (owners.size === 0) return null
  const fixes = [...steps.values()].filter(one => isFix(one) && !own.has(one.head.get('Id')) && owners.has(plain(one.head.get('Owner'))) && ['taken', 'in progress', 'waiting on you', 'queued'].includes(one.head.get('State')))
    .sort((a, b) => Number(a.head.get('State') === 'queued') - Number(b.head.get('State') === 'queued') || a.head.get('Id').localeCompare(b.head.get('Id'), 'en', { numeric: true }))
  return fixes[0]?.head.get('Id') ?? null
}

/**
 * Focus 1 (spec 2026-10-18, sections 4 and 5): the focus goal as the Focus page draws it, or null without a goal map,
 * without a focus, or with one that is no longer in the map (the page then asks to pick one). Its stage and lines from
 * goals.md; each part's progress from its steps in the store (`items`): all finished → done; one taken, in progress,
 * waiting on the person or in review → now, with that step's owner (without the chats' `prefix`); else next. The whole: the parts
 * done of all, and the minutes the sizes of the parts not done name. `thread`: the goal's brainstorm, the vibe and how
 * talk: a running thread about it first, else the one its Brainstorm line names.
 */
export function focusState(goalMap, items, threads, prefix, partner = null) {
  const node = goalMap?.focus ? goalMap.byId.get(goalMap.focus) ?? null : null
  if (node === null) return null
  const steps = new Map((items ?? []).filter(one => one.head.get('Kind') === 'step').map(one => [one.head.get('Id'), one]))
  const parts = node.parts.map(part => {
    const known = part.steps.map(id => steps.get(id)).filter(one => one !== undefined)
    const done = known.filter(one => FINISHED.includes(one.head.get('State'))).length
    const busy = known.find(one => UNDER_WAY.includes(one.head.get('State')))
    // Focus 4: steps made but none handed out yet (new or refined, none queued): the part waits for the main chat.
    // The review: a step the main chat queued before its refine ("Queue when refined") waits for its refine, not for it.
    const held = known.filter(one => NOT_HANDED.includes(one.head.get('State')))
    const unsent = held.filter(one => (one.head.get('Queue when refined') ?? '') === '')
    const isWaiting = busy === undefined && !known.some(one => one.head.get('State') === 'queued')
    const isHandout = isWaiting && unsent.length > 0
    const isRefining = isWaiting && !isHandout && held.length > 0
    const state = known.length > 0 && done === known.length ? 'done' : busy !== undefined ? 'now' : isHandout ? 'handout' : isRefining ? 'refining' : 'next'
    const owner = busy === undefined ? null : String(busy.head.get('Owner') ?? '').replace(prefix, '').trim() || null
    const since = unsent.map(one => sinceMs(one.head.get('Since'))).filter(Number.isFinite)
    const fix = state === 'next' ? fixAhead(known, steps, prefix) : null
    // B354: what the part's results are checked against: its steps' standards, each once; a "none (why)" is left out.
    const standards = [...new Set(known.map(standardOf).filter(one => one !== null && !/^none\b/i.test(one)))]
    // B356: the result checks of its steps: each step's ticks and its evidence picture.
    const checked = known.flatMap(one => {
      const check = checkedOf(one)
      if (check === null || check.total === 0) return []
      // B504: a failed check follows its fix steps to the last one: fixed, or what goes on
      const fix = check.passed < check.total ? fixOutcomeOf(one.head.get('Id'), steps) : null
      return [{ id: one.head.get('Id'), passed: check.passed, total: check.total, evidence: check.evidence, ...(fix === null ? {} : { fix }) }]
    })
    return { title: part.title, size: part.size, state, owner, done, total: known.length, standards, checked, ...(isHandout ? { waitsSince: since.length > 0 ? Math.max(...since) : null } : {}), ...(fix === null ? {} : { fixFirst: fix }) }
  })
  const left = parts.filter(part => part.state !== 'done').map(part => sizeMinutes(part.size)).filter(one => one !== null)
  // B343: the goal's steps one by one, for the simple Overview: its parts' in order, then its own ("Steps:"), each once;
  // a step the store does not hold, or one dropped, is not listed.
  const stepList = [...new Set([...node.parts.flatMap(part => part.steps), ...node.steps])]
    .map(id => steps.get(id)).filter(one => one !== undefined && one.head.get('State') !== 'dropped')
    .map(one => {
      const state = FINISHED.includes(one.head.get('State')) ? 'done' : UNDER_WAY.includes(one.head.get('State')) ? 'now' : 'next'
      const owner = String(one.head.get('Owner') ?? '').replace(prefix, '').trim() || null
      // B392: a step at work whose open blocking asks all wait for the partner says so.
      const waitsForPartner = stepWaitsForPartner(one, items ?? [])
      return { id: one.head.get('Id'), title: withoutNotes(one.head.get('Title') ?? ''), state, owner, ...(waitsForPartner === null ? {} : { waitsForPartner }) }
    })
  const own = (threads ?? []).filter(one => one.goal?.id === node.id)
  const thread = own.find(one => one.state === 'running') ?? (threads ?? []).find(one => one.path === node.brainstorm?.path) ?? own[0] ?? null
  return {
    id: node.id,
    title: node.title,
    stage: focusStage(node),
    // B354: the goal gets its tick against its Done when.
    doneWhen: node.doneWhen,
    // B358: its re-check before the tick: asked (the time), and the last outcome with the attempts so far.
    recheckAsked: node.recheckAsked ?? null,
    lastRecheck: node.rechecks?.at(-1) ?? null,
    attempts: (node.rechecks ?? []).filter(one => one.verdict === 'failed').length,
    // B359: the goal guard: its failed checks since Go, and whether the partner evaluates or a rebuild waits for the person.
    guard: guardOf(node, items, items),
    vibe: node.vibe,
    vibePicture: node.vibePicture,
    vibeAgreed: node.vibeAgreed,
    parts,
    steps: stepList,
    partnerDecides: node.partnerDecides,
    youDecide: node.youDecide,
    howAgreed: node.howAgreed,
    progress: { done: parts.filter(part => part.state === 'done').length, total: parts.length, minutesLeft: left.length === 0 ? null : left.reduce((sum, one) => sum + one, 0) },
    thread: thread?.path ?? null,
    ...focusRun(node, items ?? [], prefix, partner),
  }
}

/** Whether an option is the one advised: its text, or its letter ("B" of "B thick"). */
const isAdvisedOption = (option, advice) => advice !== null && (option === advice || option.toLowerCase().startsWith(`${advice.toLowerCase()} `))

/** B547: a clear owed, with whether the chat's Workers mod (its version, or null) can run a clear the board names. */
const withMod = (owed, version) => (owed === null ? null : { ...owed, canClear: modAtLeast(version ?? null) })

/**
 * Focus 3 (spec 2026-10-18, sections 3 to 5, the run): what the partner (the chat `partner` names, the setting
 * advisor) keeps for the person on the focus goal `node`. `note`: its newest daily note of the goal (dailyNote.mjs),
 * or null. `needs`: its open asks of the goal or of the goal's steps (its own and its parts'), those the note names
 * first, then by id; each with its options (the advised one marked) and its pictures.
 */
function focusRun(node, items, prefix, partner) {
  const plain = name => String(name ?? '').replace(prefix, '').trim().toLowerCase()
  const isPartner = item => partner !== null && plain(valueOf(item, 'From') ?? valueOf(item, 'Owner')) === plain(partner)
  const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true })
  const newest = items.filter(item => isDailyNote(item) && valueOf(item, 'Of') === node.id && valueOf(item, 'To') === 'you' && isPartner(item))
    .sort((a, b) => (sinceMs(valueOf(b, 'Since')) || 0) - (sinceMs(valueOf(a, 'Since')) || 0) || byId(valueOf(b, 'Id'), valueOf(a, 'Id')))[0]
  // Partner answers, the review's findings: a line that lists the partner's answer of an ask names that ask by the ask's
  // own fields (its Daily note and its Note line), and whether it was taken back.
  const listedBy = new Map(items.filter(item => valueOf(item, 'Kind') === 'ask' && newest !== undefined && valueOf(item, 'Daily note') === valueOf(newest, 'Id'))
    .map(item => [(item.sections.get(NOTE_LINE) ?? [])[0], item]))
  const note = newest === undefined ? null : (read => ({ ...read, decided: read.decided.map(one => {
    const ask = listedBy.get(one.text)
    return ask === undefined ? one : { ...one, ask: valueOf(ask, 'Id'), takenBack: !isPartnerAnswered(ask) }
  }) }))(dailyNote(newest))
  const ofs = new Set([node.id, ...node.steps, ...node.parts.flatMap(part => part.steps)])
  const named = note?.needs ?? []
  const rank = id => (named.includes(id) ? named.indexOf(id) : named.length)
  const needs = items.filter(item => valueOf(item, 'Kind') === 'ask' && valueOf(item, 'State') === 'open' && ofs.has(valueOf(item, 'Of')) && isPartner(item))
    .sort((a, b) => rank(valueOf(a, 'Id')) - rank(valueOf(b, 'Id')) || byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
    .map(item => {
      const advice = valueOf(item, 'Advice')
      return {
        id: valueOf(item, 'Id'),
        // B452: its title, and its context under it.
        ...((({ title, context }) => ({ title, context: context.join(' ') }))(askPartsOf(item))),
        asks: valueOf(item, 'Asks') ?? 'decide',
        options: (valueOf(item, 'Options') ?? '').split(' | ').map(one => one.trim()).filter(Boolean).map(label => ({ label, isAdvised: isAdvisedOption(label, advice) })),
        pictures: (valueOf(item, 'Pictures') ?? '').split(',').map(one => one.trim()).filter(Boolean),
      }
    })
  return { note, needs }
}

export function buildState(raw, { lines = [], outbox = [], runs = [], board = null, seen = null, finishedSeen = {}, taskTimes = [], mods = {}, modsLately = null, now, config }) {
  // The review of Pause 2: while the person pauses (2026-10-19: pausing only, no longer until running) what waits in
  // the outbox is held until the resume, but the board's own "resume" to the main chat; the page says so (`isHeld`).
  const isPaused = isHolding(raw.work?.pause)
  const sent = (Array.isArray(outbox) ? outbox : [])
    .map(message => (isPaused && message.state === 'waiting' && message.command !== 'resume' ? { ...message, isHeld: true } : message))
  const started = Array.isArray(runs) ? runs : []
  const list = parseList(textOr(raw.listText, ''))
  // The start of the project's chat titles, for reading their words; '' while the list of chats is not right.
  const prefix = list.prefix ?? ''
  // Clear after each step: a chat the Workers mod cleared is read under the session its card moved it to (sources.mjs).
  const moved = new Map((Array.isArray(raw.moved) ? raw.moved : []).filter(pair => Array.isArray(pair) && pair.length === 2 && pair.every(id => typeof id === 'string')))
  const apps = (Array.isArray(raw.appChatTexts) ? raw.appChatTexts : [])
    .map(text => parseAppChat(textOr(text, '')))
    .filter(chat => chat !== null)
    .map(chat => (moved.has(chat.cliSessionId) ? { ...chat, cliSessionId: moved.get(chat.cliSessionId) } : chat))
  const movedBack = new Map([...moved].map(([from, to]) => [to, from]))
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
  // B299: who waits for the person by the store's asks.
  const waits = storeWaits(raw.work, prefix)
  // B310: the notes each chat filed to the main chat: a pause for the limit may come that way.
  const notes = notesToMain(raw.work, { prefix, main: list.main ?? 'main' })
  const context = {
    now, config, last, lines, prefix, waits, notes, movedInto: movedBack,
    // How a message from the main chat is known: by its title, or by the app's id for it.
    main: { mainTitle: list.main === null ? null : `${prefix}${list.main}`, mainSession: main?.appSessionId ?? null },
  }
  // The advisor is talked with on its own tab. Every other chat is a lane, however many there are.
  const isAdvisor = chat => !chat.isLeftover && !chat.isMain && chat.name === config.advisor
  const advisorChat = found.find(isAdvisor)
  // B424: the partner's helper (the list's "helper"), shown under the Advisor: no lane, no queue, no worker.
  const isHelper = chat => !chat.isLeftover && !chat.isMain && !isAdvisor(chat) && typeof list.helper === 'string' && chat.name.toLowerCase() === list.helper.toLowerCase()
  const helperChat = found.find(isHelper)
  // The supervisor (spec 2026-10-24): the list's "supervisor", the chat whose sweeps look the board over. No lane, no
  // queue, no worker: the board wakes it for a sweep and shows how it stands in the supervisor's section.
  const isSupervisor = chat => !chat.isLeftover && !chat.isMain && !isAdvisor(chat) && !isHelper(chat) && typeof list.supervisor === 'string' && chat.name.toLowerCase() === list.supervisor.toLowerCase()
  const supervisorChat = found.find(isSupervisor)
  const names = found.filter(chat => !isAdvisor(chat) && !isHelper(chat) && !isSupervisor(chat) && !chat.isLeftover).map(chat => chat.name)

  // B296, B301: the backlog from the work store, the one source of the work. `store` is the line about it on the Backlog
  // tab and, when it cannot be read, on top of the page; `raw.work` is missing where the board has no store. Nothing is
  // drawn from the backlog file instead.
  const shown = storeBacklog(raw.work, { prefix, names }, { backlog: config.project === '' ? null : join(config.project, ...config.backlog.split('/')) })
  const backlog = shown.backlog
  const workOk = shown.store?.ok === true
  // B255, B260: the goal map, read once for the Goals part and for the way to the next milestone.
  const goalMap = typeof raw.goalsText === 'string' ? parseGoals(raw.goalsText) : null
  // B259: the brainstorms' threads (config.brainstorms in the project), newest first.
  const brainstorms = brainstormsState(raw.threadTexts ?? [], config.brainstorms)
  const folders = Array.isArray(raw.folders) ? raw.folders : null
  // An open step by its id, for a hand-over or a chat's own record that names one (not a step for the person).
  // With `whose`, only a step of that worker or of nobody.
  const openSteps = backlog.activities.flatMap(activity => activity.steps).filter(one => !one.isDone && !one.isYou && one.id !== null)
  const stepById = (id, whose = null) => {
    const one = openSteps.find(found => found.id === id && (whose === null || found.worker === null || found.worker === whose))
    return one === undefined ? null : { id: one.id, title: one.title, minutes: one.minutes, branch: one.ownBranch, about: aboutLine(one.notes) }
  }
  // B300: the step a chat is on is the one the store holds taken, in progress or waiting on the person for it, with or
  // without a branch.
  // B292: of the steps the store holds for it, the one its card names (`named`: the ids in the card's words), else the
  // one it took last: never one it was taken off while another stays open for it.
  const stepOfChat = (name, named = []) => {
    const mine = itemsOf(raw.work).filter(one => one.head.get('Kind') === 'step' && ['in progress', 'waiting on you', 'taken'].includes(one.head.get('State'))
      && String(one.head.get('Owner') ?? '').replace(prefix, '').trim().toLowerCase() === name.toLowerCase())
    const newest = mine.reduce((best, one) => (best === undefined || String(one.head.get('Since') ?? '') > String(best.head.get('Since') ?? '') ? one : best), undefined)
    // The first id the card names that is one of them: "B292 ... after B290" is on B292.
    const item = named.map(id => mine.find(one => one.head.get('Id') === id)).find(one => one !== undefined) ?? newest
    if (item === undefined) return null
    const id = item.head.get('Id')
    const branch = item.head.get('Branch')
    // B363: a step taken with branch none has its work outside git: no branch to show or play.
    return { id, title: withoutNotes(item.head.get('Title') ?? ''), minutes: minutesOf(`about ${item.head.get('Estimate') ?? ''}`), branch: branch === undefined || branch === '-' || branch === '' || branch.toLowerCase() === 'none' ? null : branch, about: null }
  }
  // B438, the review: every step the store holds for a chat and is not finished with, with its state, oldest first.
  const storeStepsOf = name => itemsOf(raw.work)
    .filter(one => one.head.get('Kind') === 'step' && ['taken', 'in progress', 'waiting on you', 'review'].includes(one.head.get('State'))
      && String(one.head.get('Owner') ?? '').replace(prefix, '').trim().toLowerCase() === name.toLowerCase())
    .map(one => ({ id: one.head.get('Id'), title: withoutNotes(one.head.get('Title') ?? ''), state: one.head.get('State'), since: one.head.get('Since') ?? '' }))
    .sort((a, b) => a.since.localeCompare(b.since))
    .map(({ since, ...one }) => one)
  // B425: the brief of the step a worker is on, built for that step only.
  const hasModels = Object.keys(runSettings(config).models).length > 0
  const briefOf = id => stepBrief(raw.work, id, goalMap, hasModels)
  const workerChats = found.filter(chat => !isAdvisor(chat) && !isHelper(chat) && !isSupervisor(chat))
  const firstRead = workerChats.map(chat => card(chat, raw, { ...context, stepOf: stepOfChat, stepById, briefOf }))
  const firstAdvisor = advisorChat === undefined ? null : card(advisorChat, raw, context)
  const firstHelper = helperChat === undefined ? null : card(helperChat, raw, context)
  const firstSupervisor = supervisorChat === undefined ? null : card(supervisorChat, raw, context)

  // B113: the plan's limits, from what is on this machine: the app's own file, what any chat looked up, and a
  // chat the app stopped. Reading them asks no chat and costs nothing. A pause by a note changes none of these.
  const everyone = [...firstRead, firstAdvisor, firstHelper, firstSupervisor].filter(one => one !== null)
  const limits = limitsOf({
    sample: parseUsageHistory(raw.usageText ?? null),
    readings: everyone.flatMap(one => one.usage),
    stops: everyone.filter(one => one.suspended?.by === 'app').map(one => ({ at: one.suspended.since, limit: one.suspended.limit, resetsAt: one.suspended.named })),
    now,
    warnAt: config.limitWarnPercent,
  })
  // B312: a worker's own pause for the limit ends early once a reading taken after it shows that limit back
  // (limits.mjs `pauseLifted`): its card is read again as if it had not paused, so it is free (or between two turns)
  // as any chat, for the hand-out and the "may wait for you" hint too.
  const pauseOver = pause => pauseLifted(pause, limits)
  // An app's stop is lifted by a reading after it that shows the limit back under full.
  const isLifted = lane => (lane?.suspended?.by === 'note' || lane?.suspended?.by === 'app') && pauseOver({ limit: lane.suspended.limit, since: lane.suspended.since, percent: lane.suspended.by === 'app' ? 100 : lane.suspended.percent })
  const read = firstRead.map((lane, at) => (isLifted(lane) ? card(workerChats[at], raw, { ...context, stepOf: stepOfChat, stepById, briefOf, pauseOver }) : lane))
  const advisorCard = isLifted(firstAdvisor) ? card(advisorChat, raw, { ...context, pauseOver }) : firstAdvisor
  const helperCard = isLifted(firstHelper) ? card(helperChat, raw, { ...context, pauseOver }) : firstHelper
  const supervisorCard = isLifted(firstSupervisor) ? card(supervisorChat, raw, { ...context, pauseOver }) : firstSupervisor
  // B299: a lane on a step of the store shows the step's title as the store holds it.
  // B292: without the note in brackets a migrated title kept.
  const titleOf = id => {
    const title = !workOk || typeof id !== 'string' ? null : raw.work.items.get(id)?.head.get('Title') ?? null
    return title === null ? null : withoutNotes(title)
  }
  /**
   * Whether a chat's process runs: its mod asked the board lately (`seen.shown`, by the chat's name: B566, any call of
   * the bridge it made, a take, a work call, a typed report), or its conversation was written in the last minute. After a restart
   * of the app a chat does not run until it is opened or messaged through the app, and until then nothing reaches
   * it by its name. Null where that cannot be told: no chat can ask this board, or the board has only just
   * started and not every chat has asked yet.
   */
  // B212, B213: no Workers mod has asked this board since it started (null on a board that does not deliver).
  const isBridgeMissing = seen === null || typeof seen !== 'object' || !Number.isFinite(board?.startedAt) ? null
    : Object.keys(seen.shown ?? {}).length === 0 && Object.keys(seen.other ?? {}).length === 0 && now - board.startedAt >= SEEN_MS
  // B566 (X22: three working chats shown "its chat does not run" while they ran): when each chat's conversation was last
  // written; a chat whose conversation was written in the last minute runs, whatever its takes say.
  const writtenOf = new Map(found.map(chat => [chat.name, raw.tails?.[chat.cliSessionId]?.modifiedAt ?? null]))
  function runningOf(name) {
    const written = writtenOf.get(name)
    // Not a write from before the app started (B315): its process of then wrote it.
    const isNewProcess = !Number.isFinite(raw.appStartedAt) || written >= raw.appStartedAt
    if (Number.isFinite(written) && isNewProcess && now - written >= 0 && now - written < WRITTEN_RUNS_MS) return true
    // B213: without a mod nobody asks, so the board cannot tell whether a chat runs: unknown, never "not running".
    if (isBridgeMissing === true) return null
    if (seen === null || typeof seen !== 'object' || !Number.isFinite(board?.startedAt) || now - board.startedAt < SEEN_MS) return null
    const isFresh = at => Number.isFinite(at) && now - at < SEEN_MS
    if (isFresh(seen.shown?.[name])) return true
    // Somebody asks under this name from another session than the one the board shows: it cannot tell.
    return isFresh(seen.other?.[name]) ? null : false
  }
  // B315: when the app last started (its lockfile, sources.mjs): a chat quiet since before then has not run since.
  const appStartedAt = Number.isFinite(raw.appStartedAt) ? raw.appStartedAt : null
  const cards = read.map(({ usage, ...lane }) => {
    const shown = {
      ...lane,
      suspended: heldUntil(lane.suspended, limits, now),
      task: lane.task === null || titleOf(lane.task.stepId) === null ? lane.task : { ...lane.task, title: titleOf(lane.task.stepId) },
    }
    // B315: a card left "working" by a quit app, its process not running: "Not running", never "Working".
    const writtenAt = raw.tails?.[lane.session]?.modifiedAt ?? null
    const isStale = !lane.isLeftover && isStaleWork({ state: shown.state, isRunning: runningOf(lane.name), writtenAt, appStartedAt, now })
    return isStale ? offLane(shown, writtenAt) : shown
  })

  // B424: the helper's card, read as a worker's: one left "working" by a quit app is "Not running".
  const helperLane = helperCard === null ? null : (() => {
    const { usage, ...lane } = helperCard
    const shown = { ...lane, suspended: heldUntil(lane.suspended, limits, now) }
    const writtenAt = raw.tails?.[lane.session]?.modifiedAt ?? null
    return isStaleWork({ state: shown.state, isRunning: runningOf(lane.name), writtenAt, appStartedAt, now }) ? offLane(shown, writtenAt) : shown
  })()

  // The supervisor's chat, read as the helper's: one left "working" by a quit app is "Not running".
  const supervisorLane = supervisorCard === null ? null : (() => {
    const { usage, ...lane } = supervisorCard
    const shown = { ...lane, suspended: heldUntil(lane.suspended, limits, now) }
    const writtenAt = raw.tails?.[lane.session]?.modifiedAt ?? null
    return isStaleWork({ state: shown.state, isRunning: runningOf(lane.name), writtenAt, appStartedAt, now }) ? offLane(shown, writtenAt) : shown
  })()

  const counts = { working: 0, waiting: 0, free: 0, unknown: 0, interrupted: 0, suspended: 0, off: 0 }
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
    if (lane?.state === 'suspended') return { reason: 'suspended', worker: lane.name, until: lane.suspended.until, isBack: lane.suspended.isBack, by: lane.suspended.by }
    if (step.after !== null) {
      const ids = [...new Set(step.after.match(/\bB\d+\b/g) ?? [])]
      const open = ids.filter(id => openIds.has(id))
      // B542: the ones in review wait only for their check, and the line says so.
      const checks = workOk ? open.filter(id => valueOf(raw.work.items.get(id) ?? { head: new Map() }, 'State') === 'review') : []
      if (open.length > 0) return { reason: 'after', steps: open, ...(checks.length > 0 ? { checks } : {}) }
      if (ids.length === 0 || ids.some(id => !knownIds.has(id))) return { reason: 'after', words: step.after }
    }
    if (lane === null) return { reason: 'nobody' }
    if (lane.state === 'working') return { reason: 'busy', worker: lane.name, leftMs: lane.eta === null || lane.eta.isOver ? null : lane.eta.leftMs }
    if (lane.state === 'waiting') return { reason: 'you', worker: lane.name }
    if (lane.state === 'interrupted') return { reason: 'cut', worker: lane.name }
    // B315: its process does not run: nothing reaches it until its chat is opened.
    if (lane.state === 'off') return { reason: 'off', worker: lane.name }
    if (lane.state === 'free') return { reason: 'handout', main: context.main.mainTitle, isOwn: lane.isMain }
    return { reason: 'unknown', worker: lane.name }
  }

  const lanes = cards.map(lane => {
    const mine = lane.isLeftover ? [] : queued.filter(step => step.worker === lane.name)
    const withQueue = { ...lane, queue: mine.map(step => ({ id: step.id, title: step.title, text: step.text, minutes: step.minutes, after: step.after, branch: step.branch, notes: step.notes, refined: step.refined ?? null, pictures: picturesOf(allWords(step)), why: whyNot(step, lane), ...(step.isFix === true ? { isFix: true } : {}) })) }
    return {
      ...withQueue,
      // B438, the review: the steps the store holds for it (taken, in progress, waiting on you, review), whatever its
      // card says, for the main chat's sync check.
      storeSteps: lane.isLeftover ? [] : storeStepsOf(lane.name),
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
    // Its transcript, read once: for its mode (B352) and whether a round runs (B288).
    const advisorEntries = tail === null || typeof tail.text !== 'string' ? null : parseTail(tail.text, tail.isCut === true)
    advisorWaits = advisorCard.state === 'waiting' ? { ...advisorCard, isAdvisor: true } : null
    advisor = {
      name: advisorChat.name,
      session,
      appSession,
      // The model chip: the model and the effort the app's file of its chat says it runs at (`effort` below is B352's mode).
      model: advisorCard.model ?? null,
      appEffort: advisorCard.effort ?? null,
      state,
      doingNow: doing,
      messages: advisorEntries === null
        ? []
        : conversation(advisorEntries, { self: advisorChat.name, prefix, titles })
          // B173: a round the board's clock typed is the clock's, not the person's.
          .filter(message => !(message.from === 'you' && isClockLine(message.text)))
          // B282: a line typed on the board shows its words and the picture pasted with it apart, as in Talk to Main.
          .map(one => (one.via === 'board' ? { ...one, ...splitPicture(one.text.replace(TYPED_MARK, '').trim(), config.pictureRoots[0]) } : one)),
      // Typed on the board to the advisor and not in its chat yet.
      pending: sent.filter(message => message.to === advisorChat.name && (message.ask ?? null) === null && (message.command ?? null) === null),
      // B280: its card on the Overview: its task as its own card names it, its time, why it is held between two
      // turns, since when it is idle, whether it asks the person something, and what waits for it.
      task: advisorCard.task,
      eta: advisorCard.eta,
      between: advisorCard.between,
      idle: advisorCard.idle,
      // Pause and resume (spec 2026-10-18): when its last turn began.
      turnAt: advisorCard.turnAt ?? null,
      heldBy: advisorCard.heldBy ?? null,
      isTurnOpen: advisorCard.isTurnOpen ?? false,
      // B301: it asks with the work store's asks; also when the app says it waits (its question form).
      asksYou: advisorWaits !== null || waits.asking.has(advisorChat.name.toLowerCase()),
      // B464: the asks it has open for the person, `{ id, title }`, for its row to name what it asks.
      asking: waits.asks?.get(advisorChat.name.toLowerCase()) ?? [],
      queued: queuedFor(sent, advisorChat.name, now),
      // B288: a round runs from when it is sent, by the clock or on the person's request: while it waits to be typed;
      // while it is being typed (ten minutes at most); for two minutes after it arrived, before its turn shows; and then
      // while the Advisor is at work on the turn that began with it (an hour at most). A turn begun later is another.
      // B352: the high effort mode last asked for it, what its last answer ran on, and whether that is the mode asked.
      effort: partnerEffort({ sent, partner: advisorChat.name, entries: advisorEntries }),
      roundRuns: (() => {
        const last = sent.findLast(message => message.to === advisorChat.name && (message.command === 'round' || message.command === 'recheck'))
        if (last === undefined) return false
        if (last.state === 'waiting') return true
        if (last.state === 'taken') return now - (last.takenAt ?? last.at) < ROUND_TYPING_MS
        if (last.state !== 'delivered') return false
        const arrived = last.deliveredAt ?? last.at
        if (now - arrived < ROUND_SHOWS_MS) return true
        const begun = advisorEntries === null ? null : turnStart(advisorEntries, { prefix })?.at ?? null
        return state === 'working' && now - arrived < HOUR && (begun === null || begun <= arrived + ROUND_SHOWS_MS)
      })(),
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

  // A restart of the app: who was cut off, who does not run, and a word to the main chat only copied. `board` says when
  // this board started and since when it had been off. Pause 2: how a pause stands is `pause` (pause.json), below.

  // B315: a word to the main chat that was only copied (no Workers mod took it: no chat ran) waits until the person
  // pasted it into the main chat. The newest such word not taken yet, unless a newer one of its kind went another way.
  const mainTail = main === undefined ? null : raw.tails?.[main.cliSessionId] ?? null
  const mainEntries = mainTail === null || typeof mainTail.text !== 'string' ? null : parseTail(mainTail.text, mainTail.isCut === true)
  const takenAt = message => (message?.state !== 'copied' ? null : isTakenBy(mainEntries, message, prefix))
  const toMain = main === undefined ? [] : sent.filter(message => message.to === main.name)
  const lastCopied = toMain.findLast(message => message.state === 'copied')
  // A copied word that no longer matters (see stillMatters) is left alone: dismissed, too old, or done another way.
  const matters = message => stillMatters(message, { entries: mainEntries, prefix, now })
  const isOpenCopy = lastCopied !== undefined && takenAt(lastCopied) === null && matters(lastCopied)
    && !toMain.some(message => message.at > lastCopied.at && message.state !== 'copied' && (message.command ?? null) === (lastCopied.command ?? null))
  // Pause and resume (spec 2026-10-18): the pause banner says how a pause stands, from pause.json.
  const pauseRecord = workOk ? raw.work.pause ?? null : null
  // B299: notes and reports for the person; B438: the main chat's answer to a sync check is one of them.
  const information = informationOf(raw.work, now)
  const restart = {
    main: main === undefined ? null : main.name,
    interrupted: live.filter(lane => lane.state === 'interrupted').map(lane => lane.name),
    // B315: with the lanes whose card was left "working" by a quit app (`off`).
    notRunning: live.filter(lane => lane.state === 'off' || runningOf(lane.name) === false).map(lane => lane.name),
    // The chats the main chat was lately asked to start, each with how that word fared.
    starting: [...new Map(sent
      .filter(message => message.command === 'start' && typeof message.about === 'string' && now - message.at < 10 * MIN)
      .map(message => [message.about, { chat: message.about, at: message.at, state: message.state }])).values()],
    // B315: the word to the main chat that was only copied and is not in its chat yet: what to paste, into which chat
    // (its title from the list of chats), the app's id for it, and whether it runs now.
    copied: !isOpenCopy ? null : {
      id: lastCopied.id, at: lastCopied.at, command: lastCopied.command ?? null, text: lastCopied.pasteText ?? lastCopied.text, chat: context.main.mainTitle ?? main.name,
      session: main.appSessionId ?? null, isMainRunning: runningOf(main.name),
    },
    off: Number.isFinite(board?.offSince) && Number.isFinite(board?.startedAt) && now - board.startedAt < HOUR ? { from: board.offSince, to: board.startedAt } : null,
  }

  const chats = lanes.map(lane => ({
    ...lane,
    isRunning: lane.isLeftover ? null : lane.state === 'off' ? false : runningOf(lane.name),
    // B143: the newest ask to remove this worker; the main chat and a leftover have none.
    removal: lane.isLeftover || lane.isMain ? null : removalAsk(sent.findLast(message => message.command === 'remove' && message.about === lane.name), now),
    // B547: the clear it owes (its last report newer than its last clear), and whether its Workers mod (`mods`, the
    // version its last call said) can run the clear the board names; null when it owes none.
    clearOwed: lane.isLeftover || lane.isMain || !workOk ? null : withMod(clearOwed({ lane, items: raw.work.items, prefix, afterStep: list.afterStep ?? null }), mods?.[lane.name]),
    // B577: its session was stopped and words wait for it (`{ since, words }`): the app drops them until it gets input.
    stopped: stoppedOf(sent, lane),
  }))
  // Pause and resume (spec 2026-10-18): what the pause banner says, from pause.json and the lanes' facts alone; with the
  // main chat (its title from the list, the app's id for it, whether it runs) for the link that opens it, and when the
  // board typed "resume" into it since the resume.
  const pause = pauseRecord === null ? null : {
    // The review of Pause 2: a line handed to a chat and not typed yet starts a turn: no Safe while one is on its way.
    ...pauseFacts({
      pause: pauseRecord, items: raw.work.items, lanes: [...chats.filter(lane => !lane.isLeftover), ...[advisorCard, helperLane].filter(one => one !== null)], prefix, now,
      pending: sent.filter(message => message.state === 'taken' && now - (message.takenAt ?? message.at) < TAKEN_SHOWN_MS),
      held: sent.filter(message => message.isHeld === true),
    }),
    // `hasActed`: the main chat ran a turn since the pause's last change, or runs one now (the review of Pause 2: once its
    // process runs while resuming and it has not, the board types "resume" into it).
    main: main === undefined ? null : {
      name: main.name, title: context.main.mainTitle ?? main.name, session: main.appSessionId ?? null, isRunning: runningOf(main.name),
      hasActed: (() => {
        const lane = chats.find(one => one.isMain)
        return lane !== undefined && ((lane.state === 'working' && (lane.between ?? null) === null) || (Number.isFinite(lane.turnAt) && Number.isFinite(pauseRecord.since) && lane.turnAt >= pauseRecord.since))
      })(),
    },
    typedAt: main === undefined || !Number.isFinite(pauseRecord.since) ? null
      : sent.findLast(message => message.to === main.name && message.command === 'resume' && Number.isFinite(message.at) && message.at >= pauseRecord.since)?.at ?? null,
  }
  // B300: the reconciler holds the store against the lanes (work/reconcile.mjs): the server carries out its moves and
  // lines (work/deliver.mjs), the page shows its flags. Null while the store cannot be read.
  // B301: when each step of the store went done, for the finished list and the board's own notes (finished.mjs).
  const doneAtOf = doneTimes(raw.work, prefix)
  // B356, the review: a board without a partner chat makes no result check, here too.
  // Partner answers (2026-10-19): the partner's card, for the asks routed to it (woken while free, handed on after 30 min).
  const partner = advisorChat === undefined || advisorCard === null ? null : { name: advisorChat.name, state: advisorCard.state, isRunning: runningOf(advisorChat.name), idle: advisorCard.idle ?? null }
  // Incident fixes, the review: the product plan's standards hold a fix the board would queue itself, as they hold a queue.
  const plan = planState(raw.productPlanText ?? null, itemsOf(raw.work), config.productPlan)
  const reconciled = !workOk ? null : reconcile({
    store: raw.work, flow: raw.work.flow, lanes: chats, now, times: { graceMs: GRACE_MS, askMs: ASK_MS, idleMs: IDLE_HOLD_MS }, prefix, hasPartner: advisorChat !== undefined, partner,
    standardHold: item => standardHold(item, plan?.standards ?? []),
  })
  // B547: the steps whose line waits for their worker's clear (a mod that can clear only: an older one would wait for ever).
  // B587: not for a worker whose process ended: its line and the start word go at once.
  const clearHeld = clearHolds({ lanes: chats, deliveries: reconciled?.deliveries ?? [] })
  // B468: what each worker runs at for its step, the words that have the main chat set it (none without the Workers mod),
  // and the steps whose line to their worker waits until it is set. Model per step: its model too, by the settings'
  // model ids, and the usual setting between steps from the settings.
  // The partner and its helper are skipped: their own setting (B352, set once) is never the board's to overwrite.
  const efforts = reconciled === null ? null : effortPlan({ items: raw.work.items, lanes: chats, deliveries: reconciled.deliveries, sent, now, main: isBridgeMissing === true ? null : main?.name ?? null, prefix, skip: [advisorChat?.name, helperChat?.name], ...runSettings(config) })
  if (efforts) for (const id of routingHolds(itemsOf(raw.work), config.routing)) efforts.held.add(id)
  // B570: a chat on an older Workers mod is restarted between its steps (work/modRollout.mjs): the words that ask its
  // restarter (the main chat; the partner for the main chat), and the line of an idle worker's next step held meanwhile.
  const side = (lane, name) => (lane === null || lane === undefined ? null : { ...lane, name, isRunning: lane.state === 'off' ? false : runningOf(name) })
  const rollout = efforts === null ? null : rolloutPlan({
    mods: modsLately, items: raw.work.items, deliveries: reconciled.deliveries, sent, now, prefix,
    chats: chatsByRole({ chats, advisor: side(advisorCard, advisorChat?.name), advisorHelper: side(helperLane, helperLane?.name), supervisorChat: side(supervisorLane, supervisorLane?.name) }),
    main: isBridgeMissing === true ? null : main?.name ?? null, partner: isBridgeMissing === true ? null : advisorChat?.name ?? null,
  })
  if (rollout !== null) for (const id of rollout.held) if (!efforts.held.has(id)) { efforts.held.add(id); efforts.holds.set(id, rollout.holds.get(id)) }
  const oldAsks = new Set((reconciled?.flags ?? []).filter(flag => flag.kind === 'old ask').map(flag => `work:${flag.id}`))
  const flagsOf = name => (reconciled?.flags ?? []).filter(flag => flag.chat === name && LANE_FLAGS.includes(flag.kind)).map(({ kind, id, text, button }) => ({ kind, id, text, button }))
  const focus = focusState(goalMap, itemsOf(raw.work), brainstorms.threads, prefix, advisorChat?.name ?? null)

  return {
    readAt: now,
    // Clear after each step: the sessions the chats went on from, while the app still names them (read on to their ends).
    movedFrom: found.filter(chat => !chat.isLeftover && movedBack.has(chat.cliSessionId)).map(chat => ({ session: movedBack.get(chat.cliSessionId), name: chat.name })),
    spendingSubjects: found.filter(chat => !chat.isLeftover).map(chat => ({ session: chat.cliSessionId, appSession: chat.appSessionId, name: chat.name, model: chat.model, effort: chat.effort, role: chat.isMain ? 'main' : isAdvisor(chat) ? 'advisor' : isHelper(chat) ? 'helper' : isSupervisor(chat) ? 'supervisor' : 'worker' })),
    routing: { mode: config.routing?.ok === false ? 'invalid' : config.routing?.policy?.mode ?? 'off', problem: config.routing?.why ?? null, readiness: enforcementReadiness(null) },
    refreshSeconds: config.refreshSeconds,
    estimateOldMs: config.estimateOldMinutes * MIN,
    maxMessageChars: config.maxMessageChars,
    counts,
    // B155: the steps finished last, newest first, with when (and from where the board knows it) and who. B301: the
    // store says when a step went done, not a chat's report.
    finished: finishedList(backlog, { stored: doneAtOf, seen: finishedSeen ?? {}, prefix }),
    // B185: how long finished tasks really took, per area and lately, and per step its estimate and working time.
    taskTimes: taskTimesOf(taskTimes),
    // B113: the 5-hour limit and the week, each with how old its figure is; a window nothing is known of is null.
    limits,
    // B300: each with the reconciler's flags on it.
    // B468: and with what it runs at for its step (`effortRun`, effort.mjs), or null; model per step: its model too.
    // An opus step that waits for its worker to run on Opus says so on the lane (`waitsFor`).
    chats: chats.map(lane => {
      const run = efforts?.runs.get(lane.name) ?? null
      const waits = run?.waitsFor == null ? [] : [{ kind: 'model', id: run.step, text: run.waitsFor.text, button: null }]
      return { ...lane, flags: [...flagsOf(lane.name), ...waits], effortRun: run, modRun: rollout?.runs.get(lane.name) ?? null }
    }),
    // B300: the reconciler's lines on top (a broken file, an id twice, a state the flow does not know), and what the
    // server carries out; empty and null while the store cannot be read.
    workFlags: [...(reconciled?.flags ?? []).filter(flag => flag.kind === 'broken').map(flag => flag.text),
      // Model per step: settings that name the model ids otherwise than both, each "claude-...": the effort alone.
      ...(typeof config.modelsProblem === 'string' ? [`Settings: ${config.modelsProblem}.`] : [])],
    reconciled: reconciled === null ? null : { moves: reconciled.moves, deliveries: reconciled.deliveries.filter(one => !efforts.held.has(one.id) && !clearHeld.has(one.id)), efforts: efforts.words, held: [...efforts.held, ...clearHeld], holds: Object.fromEntries(efforts.holds), says: reconciled.flags.filter(flag => typeof flag.say === 'string'), notes: reconciled.notes ?? [], partnerAsks: reconciled.partnerAsks ?? [], escalations: reconciled.escalations ?? [], autoQueues: reconciled.autoQueues ?? [], boardLines: reconciled.boardLines ?? [], heldFixes: reconciled.heldFixes ?? [], restarts: rollout?.words ?? [], restFree: reconciled.restFree ?? [] },
    // B570: what each chat on an older Workers mod waits for, by name (the partner, its helper, the supervisor too).
    modRuns: Object.fromEntries(rollout?.runs ?? []),
    // Partner answers (2026-10-19): whether the partner answers detail questions first (the Focus page's switch); null
    // without a store.
    partnerAnswers: !workOk ? null : raw.work.partnerAnswers ?? { on: true },
    // Queued steps that name no worker on the board.
    unassigned: queued.filter(step => step.worker === null || !names.includes(step.worker)).map(step => ({ ...step, why: whyNot(step, null) })),
    // B83: the newest ask to stop each worker's task, open while on its way and for a while after it arrived, so the
    // page asks once. (B301: a queued step is moved or taken out through the work API at once.)
    changeAsks: {
      stop: Object.fromEntries(lanes.filter(lane => !lane.isLeftover && !lane.isMain).map(lane => [lane.name, removalAsk(sent.findLast(message => message.command === 'stop' && message.about === lane.name), now)]).filter(([, ask]) => ask !== null)),
      // B438: the newest "Out of sync?" check of each worker and of the board, with the main chat's answer (a note).
      sync: syncChecks(sent, information, [...lanes.filter(lane => !lane.isLeftover && !lane.isMain).map(lane => lane.name), SYNC_BOARD], now, main === undefined ? null : main.name),
    },
    // Focus 4: the partner's cards marked, for the group "From your partner".
    forYou: markPartner([
      ...needsOf(asks, lanes, sent, gameOf, now, config.baseBranch, { advisor: advisorCard, advisorWaits, helper: helperLane, waits, idle: (reconciled?.flags ?? []).filter(flag => flag.kind === 'idle hold') }),
      // B299: the store's asks, answered through POST /api/work.
      // B300: a blocking ask that waited longer than the ask time stands first (`isOld`).
      ...storeNeeds(raw.work, { now, names: [...names, ...[advisorChat, helperChat].filter(one => one !== undefined).map(one => one.name)], prefix, answerOf: id => answerOf(sent, id) })
        .map(need => (oldAsks.has(need.id) ? { ...need, isOld: true } : need)),
      // Focus 4: the focus's steps made but not handed out, longer than the grace time: a hint, with the way to Main.
      ...handoutNeeds(focus, main === undefined ? null : main.name, now),
    ].sort((a, b) => Number(b.isOld === true) - Number(a.isOld === true) || (b.at ?? 0) - (a.at ?? 0)), [config.advisor ?? null, helperChat?.name ?? null], prefix),
    // B299: notes and reports for the person.
    information,
    // Partner answers, the review's findings: the asks with the partner now, and its answers of the last 7 days that the
    // Focus page's note does not show, each with its Undo.
    withPartner: !workOk ? [] : withPartnerOf(raw.work, { names: [...names, ...[advisorChat, helperChat].filter(one => one !== undefined).map(one => one.name)], prefix }),
    partnerDecided: !workOk ? [] : partnerDecidedOf(raw.work, { now, shownNote: focus?.note?.id ?? null, names, prefix }),
    // B360: the recaps of finished work, and where they show: "now" in Needs your attention, "daily" in the daily note.
    recaps: recapsOf(raw.work, now),
    recapsShow: config.botherMe ?? 'now',
    // B296, B301: the work store: its folder, how many items, its problems, and why it cannot be read (`why`).
    store: shown.store,
    // B298: the person's words per chat, filed as instructions (work/lists.mjs).
    instructions: instructionsOf(raw.work, now),
    // The whole backlog by activity, for the Coordinate tab. A step for the person opens its card (`needId`).
    backlog: overview(backlog, { underWay: onNow }).map(activity => ({
      ...activity,
      steps: activity.steps.map(step => {
        // B233: whether the Advisor was asked to refine it and has not written that round yet.
        const asked = refineAsk(step, sent, now)
        const read = itemOfStep(raw.work, step.key)
        // Model per step: its model only where the settings name the model ids.
        const item = read === null || hasModels ? read : { ...read, model: null }
        const where = refineStateOf({ refined: step.refined, refineAsk: asked })
        // B312: the board's own rounds reached their cap without a new answer since: it stopped on this step.
        const stop = step.id !== null && (where === 'none' || where === 'answered') ? refineStop({ ...step, item }, sent) : null
        return {
          ...step,
          pictures: picturesOf(allWords(step)),
          needId: step.status !== 'you' ? null : step.id === null ? stepId(`${activity.name}\n${step.text}`) : `backlog:${step.id}`,
          // B181: whether the main chat was asked to hand it out, for a step nobody has.
          queueAsk: queueAsk(step, sent, now),
          refineAsk: asked,
          // B285, B286: where its refine stands; B312: `stopped` when the board stopped on it (`refineStop`).
          refineState: stop === null ? where : 'stopped',
          refineStop: stop,
          // B301: when the store moved it to done, or null.
          doneAt: step.id === null ? null : doneAtOf.get(step.id)?.at ?? null,
          // B296: where it stands in the flow (flow.json), for the strip in its window.
          flow: flowOfStep(raw.work, step.key),
          // B543: what it waits for while in review ("waits for its fix B<n>"), or null.
          reviewWait: reviewWaitOfStep(raw.work, step.key),
          // B299: the step as the store holds it, for its window.
          item,
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
    pause,
    // B124: the main chat (null when the list has none), the name and folder a new project makes it with, how many
    // workers there are, and the newest ask for workers.
    workers: (() => {
      // B152: a worker that was removed is no worker any more, also while its lane still says so.
      const workerChats = found.filter(chat => !chat.isLeftover && !chat.isMain && !isAdvisor(chat) && !isHelper(chat) && !isSupervisor(chat) && chat.removedAt === null)
      return {
        main: main === undefined ? null : main.name,
        mainTitle: context.main.mainTitle,
        project: config.project,
        // B131, B137: what an empty board looks for and where, when it finds it missing.
        lookFor: lookingFor({ list, prefix, config, chats: found.filter(chat => !chat.isLeftover).length }),
        // B213: no Workers mod takes the board's words: the page says what that means.
        withoutMod: isBridgeMissing === true,
        count: workerChats.length,
        ask: spawnAsk(sent.findLast(message => message.command === 'spawn'), workerChats, now),
      }
    })(),
    advisor: advisor === null ? null : { ...advisor, isRunning: runningOf(advisor.name) },
    // B424: the partner's helper, on its own card under the Advisor's: how it stands, its task and its time.
    advisorHelper: helperLane === null ? null : {
      name: helperLane.name,
      session: helperLane.session,
      appSession: helperLane.appSession,
      // The model chip: what the app's file of its chat says it runs at.
      model: helperLane.model ?? null,
      effort: helperLane.effort ?? null,
      state: helperLane.state,
      doingNow: helperLane.doingNow,
      task: helperLane.task,
      eta: helperLane.eta,
      between: helperLane.between,
      idle: helperLane.idle,
      suspended: helperLane.suspended,
      asksYou: helperLane.state === 'waiting' || waits.asking.has(helperLane.name.toLowerCase()),
      isRunning: helperLane.state === 'off' ? false : runningOf(helperLane.name),
      // B546: when its transcript was last written, so the supervisor tells a helper the app's restart stopped.
      writtenAt: raw.tails?.[helperLane.session]?.modifiedAt ?? null,
    },
    // The supervisor (spec 2026-10-24): the chat that sweeps (the list's "supervisor"): how it stands, for its sweeps.
    supervisorChat: supervisorLane === null ? null : {
      name: supervisorLane.name,
      session: supervisorLane.session,
      appSession: supervisorLane.appSession,
      model: supervisorLane.model ?? null,
      effort: supervisorLane.effort ?? null,
      state: supervisorLane.state,
      // B570: since when it is idle, for a chat on an older Workers mod (oldMods.mjs).
      idle: supervisorLane.idle ?? null,
      compaction: supervisorLane.compaction ?? null,
      isRunning: supervisorLane.state === 'off' ? false : runningOf(supervisorLane.name),
    },
    // The supervisor: the name the list gives the chat that sweeps, also while no chat of that name is open.
    supervisorName: typeof list.supervisor === 'string' ? list.supervisor : null,
    // B212: no Workers mod has asked this board for its words since it started: what is sent is copied for the person
    // to paste instead (null on a board that does not deliver). `chatPrefix` makes a chat's name its title.
    bridge: isBridgeMissing === null ? null : { isMissing: isBridgeMissing },
    chatPrefix: prefix,
    // B547: "clear" when the list of chats has a worker cleared after each reported step (src/clearOwed.mjs), else null.
    afterStep: list.afterStep ?? null,
    // B546: when the Claude app last started (B315), or null: the supervisor's helper rule reads it.
    appStartedAt,
    // B161: the talk with the main chat; null without a main chat.
    mainTalk: mainTalk === null ? null : { ...mainTalk, isRunning: runningOf(mainTalk.name) },
    // B173: the game plan (config.gamePlan in the game's repository), and the Advisor's open suggestions: the open
    // steps of the backlog's group for them, with their "Why:", "Cost:" and "Unblocks:" lines.
    advice: typeof raw.adviceText === 'string' && raw.adviceText.trim() !== '' ? raw.adviceText : null,
    gamePlan: config.gamePlan,
    // Plan (2026-10-19): the product plan's eight answers with their state, and the partner's open ask on each open
    // one, for the Plan part on top of the Focus page; null without the page.
    plan: withPlanWork(plan, sent, raw.productPlanAt ?? null, now),
    // 2026-10-24: the empty Vision tab's wait for the partner after Start; null once the plan's page is there.
    planStart: plan === null ? planStarting(sent, now) : null,
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
      // B289: with the open steps no goal names.
      return { file: config.goals, roots: goalMap.roots, problems: goalMap.problems, nodes: goalMap.nodes.map(one => ({ ...one, counts: counts.get(one.id) ?? null })), unlinked: unlinkedSteps(goalMap, backlog, config.advisorSuggestions) }
    })(),
    goalsFile: config.goals,
    // B258: every ask under a goal of the map, and an answer the person has not read yet as a need under "Needs your
    // attention" (Done marks it read); the folder of the Advisor's long answers, where their More lines point.
    goalAsks: goalMap === null ? [] : goalAskList(goalMap),
    goalAskNeeds: goalMap === null ? [] : goalAskNeeds(goalMap),
    goalAsksFolder: config.goalAsks,
    // B259: the brainstorms, and what they wait for from the person: a question to answer, a proposal to create.
    brainstorms,
    brainstormNeeds: brainstormNeeds(brainstorms.threads),
    // Focus 1 (spec 2026-10-18): the focus goal for the Focus part, and the parts the tab's bar shows.
    // The review of Focus 3: the partner by the chat the board shows for it, the one the work API gives the role advisor.
    focus,
    advisorParts: config.advisorParts,
  }
}
