// Puts the sources together into the one object the page asks for. Everything here is a pure function of the
// texts that were read: a source that is missing or broken gives "unknown" or an empty list, never an error.

import { boardChats, parseAppChat, parseList } from './appChats.mjs'
import { parseAsk } from './asks.mjs'
import { allWords, closedForYou, forYou, inProgress, overview, parseBacklog, queue } from './backlog.mjs'
import { pathKey } from './games.mjs'
import { hourEnd, hourStart, taskFacts, today } from './history.mjs'
import { mentionedPaths } from './pictures.mjs'
import { approvalRoute } from './tick.mjs'
import { parsePlanLine } from './planLines.mjs'
import { backgroundRunning, conversation, doingNow, lastFinish, lastReport, parseTail, taskStart, turnStart, turnState, waitingFor } from './transcript.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const ASKED = 'Asked you a question in its chat.'
/** A chat's own file that says it works is renewed twice a minute. Older than this, its process is gone. */
const CUT_OFF_MS = 150_000
/** A running chat's mod asks the board every few seconds. Not heard from for this long, its process is not running. */
const SEEN_MS = 30_000

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

const textOr = (value, fallback) => (typeof value === 'string' ? value : fallback)

/**
 * Why a chat whose turn has ended is not free, or null when it is: its task is not reported yet, background work
 * it started still runs, or the backlog step it works on still names its branch. The board then shows it as
 * working, between two turns.
 */
export function heldBy({ plan, handOver, background, step, isCompleted = false }) {
  // A card holds the chat unless the app's own summary calls the ended turn completed: a chat that reported and
  // forgot to clear its card is done. One that asked another chat in the middle of its task still waits.
  if (plan?.task != null && !plan.task.isReported && (!isCompleted || plan.task.asked === true)) {
    return { why: 'task', text: plan.task.asked === true ? 'Its turn has ended; it asked another chat and waits for the answer.' : 'Its turn has ended; its task is not reported yet.' }
  }
  if (handOver !== null) return { why: 'task', text: 'Its turn has ended; the task handed to it is not reported yet.' }
  if (background > 0) return { why: 'background', text: 'Its turn has ended; background work it started is still running.' }
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
  return { at, leftMs: Math.max(0, at - now), isOverdue: at < now, isOwn, from: isOwn ? 'own' : task.stepMinutes !== null ? 'step' : 'handover' }
}

function card(chat, raw, { now, config, last, lines, main, prefix, stepOf = () => null, stepById = () => null }) {
  // `session` is the id the chat's own process knows itself by: the bridge serves only that one under this name.
  // `appSession` is the id the app knows the chat by: the main chat starts a chat that is not running with it.
  const base = { name: chat.name, isMain: chat.isMain, isLeftover: chat.isLeftover, session: chat.cliSessionId ?? null, appSession: chat.appSessionId ?? null }
  const none = { quietMs: null, isQuiet: false, isAsking: false, doingNow: null, between: null, needsYou: null, statusDetail: null, waitingSince: null, waitsFor: null, task: null, cutOffAt: null, eta: null, isWithoutTime: false }
  if (chat.isLeftover) return { ...base, state: 'unknown', ...none, lastActivityAt: chat.lastActivityAt }

  const tail = raw.tails?.[chat.cliSessionId] ?? null
  const entries = tail === null || typeof tail.text !== 'string' ? null : parseTail(tail.text, tail.isCut === true)
  const turn = entries === null ? null : turnState(entries)
  const summary = chat.summary?.isCurrent === true ? chat.summary : null
  const plan = parsePlanLine(textOr(raw.planLineTexts?.[chat.cliSessionId], ''))
  // The longer look back is a few minutes old, so the tail follows it: the newest hand-over or report wins.
  const scan = typeof tail?.earlier === 'string' && entries !== null ? [...parseTail(tail.earlier, false), ...entries] : entries
  const step = stepOf(chat.name)
  const lastWriteAt = Number.isFinite(tail?.modifiedAt) ? tail.modifiedAt : null
  const wasCutOff = isCutOff({ turn, plan, lastWriteAt, turnStartedAt: entries === null ? null : turnStart(entries, { prefix })?.at ?? null, now })
  // An ended turn is not a free chat while something of its work is open: it is between two turns.
  const ended = chatState({ turn, category: summary?.category, needsAction: summary?.needsAction })
  const held = wasCutOff || ended !== 'free' ? null : heldBy({
    plan, step,
    isCompleted: summary?.category === 'completed',
    handOver: chat.isMain || scan === null ? null : taskStart(scan, main),
    background: entries === null ? 0 : backgroundRunning(entries),
  })
  const state = wasCutOff ? 'interrupted' : held === null ? ended : 'working'
  // No sign of life is about a turn that runs: between two turns a chat writes nothing.
  const quietMs = state === 'working' && held === null && lastWriteAt !== null ? Math.max(0, now - lastWriteAt) : null

  let needsYou = null
  if (state === 'waiting') needsYou = turn === 'asking' ? ASKED : summary?.needsAction?.trim() || summary?.detail?.trim() || null

  // A chat that was cut off keeps the task it was on.
  const task = taskOf({ chat, plan, state: wasCutOff ? 'working' : state, before: last.get(chat.name), lines, main, prefix, now, scan, step, stepById })
  const eta = etaOf(task, state, now)
  return {
    ...base,
    state,
    quietMs,
    isQuiet: quietMs !== null && quietMs > config.quietMinutes * MIN,
    // It asked with the app's own question form: that can only be answered in its chat.
    isAsking: turn === 'asking',
    doingNow: state === 'working' && held === null ? doingNow(entries) : null,
    // Why it counts as working although its turn has ended, in words; null for a turn that runs.
    between: held === null ? null : held.text,
    needsYou,
    statusDetail: turn === 'ended' ? summary?.detail?.trim() || null : null,
    // The turn's last entry: when it ended, or when it asked.
    waitingSince: state === 'waiting' ? entries.findLast(entry => entry.type === 'assistant' && !entry.isSidechain)?.at ?? null : null,
    // B100: what it last said, for the window of what it waits for: its own words, never what was typed to it.
    waitsFor: state === 'waiting' ? waitingFor(entries) : null,
    task,
    // When a chat that was cut off last wrote.
    cutOffAt: wasCutOff ? lastWriteAt : null,
    eta,
    // A worker that works and has no time from anywhere: a fault to fix, and shown as one. The main chat hands
    // out work and answers the person; it has no task to time.
    isWithoutTime: state === 'working' && !chat.isMain && eta === null,
    lastActivityAt: Math.max(chat.lastActivityAt ?? 0, tail?.modifiedAt ?? 0) || null,
  }
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
 */
function needsOf(asks, lanes, outbox, gameOf, now) {
  const live = lanes.filter(lane => !lane.isLeftover)
  const names = new Set(live.map(lane => lane.name))
  // Work to verify is looked at in the game: on the branch the ask names, else on main.
  // An answer is about the ask as it was filed: one filed anew, also under the same name, asks again.
  const items = asks.map(ask => ({
    ...ask,
    version: hashOf(`${ask.title}\n${ask.text}\n${ask.at}`),
    game: gameOf(ask.run?.branch ?? (ask.kind === 'verify' ? 'main' : null)),
    canAnswer: names.has(ask.from),
  }))
  const asked = new Set(asks.map(ask => ask.from))
  const blank = { options: [], pictures: [], run: null, game: null, checks: [], tried: [] }
  for (const lane of live) {
    if (lane.state === 'waiting' && !asked.has(lane.name)) {
      items.push({
        // One id per time it started waiting, so an answer to an earlier question never sticks to a later one.
        id: `chat:${lane.name}:${lane.waitingSince ?? 0}`,
        from: lane.name,
        kind: 'input',
        title: lane.isAsking ? 'Asked you a question in its chat' : 'Needs your decision',
        text: lane.isAsking ? 'It used the app\'s question form, which can only be answered there.' : lane.needsYou ?? 'It waits for you.',
        at: lane.waitingSince,
        ...blank,
        version: null,
        canAnswer: !lane.isAsking,
        task: cardOf(lane.task),
        waits: lane.waitsFor,
      })
    }
    if (lane.isQuiet) {
      items.push({
        id: `quiet:${lane.name}`,
        from: lane.name,
        kind: 'intervene',
        title: `No sign of life for ${Math.round(lane.quietMs / MIN)} min`,
        text: 'Its turn is running, but it has written nothing. It may be a long build, or the app was closed in the middle of the turn. Look at its chat.',
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
  for (const lane of live) {
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
  if (lane.eta === null || lane.eta.isOverdue) return []
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
export function buildState(raw, { lines = [], outbox = [], runs = [], board = null, seen = null, now, config }) {
  const sent = Array.isArray(outbox) ? outbox : []
  const started = Array.isArray(runs) ? runs : []
  const list = parseList(textOr(raw.listText, ''))
  const apps = (Array.isArray(raw.appChatTexts) ? raw.appChatTexts : [])
    .map(text => parseAppChat(textOr(text, '')))
    .filter(chat => chat !== null)
  const found = boardChats(apps, { project: config.project, ...list })
  const main = found.find(chat => chat.isMain)
  // What the history last said about each chat, also from before the board was last off.
  const last = new Map(lines.filter(line => line.gap !== true).map(line => [line.chat, line]))
  const context = {
    now, config, last, lines, prefix: list.prefix,
    // How a message from the main chat is known: by its title, or by the app's id for it.
    main: { mainTitle: `${list.prefix}${list.main}`, mainSession: main?.appSessionId ?? null },
  }
  // The advisor is talked with on its own tab. Every other chat is a lane, however many there are.
  const isAdvisor = chat => !chat.isLeftover && !chat.isMain && chat.name === config.advisor
  const advisorChat = found.find(isAdvisor)
  const names = found.filter(chat => !isAdvisor(chat) && !chat.isLeftover).map(chat => chat.name)

  const backlog = parseBacklog(textOr(raw.backlogText, ''), { prefix: list.prefix, names })
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
  const cards = found.filter(chat => !isAdvisor(chat)).map(chat => card(chat, raw, { ...context, stepOf, stepById }))

  const counts = { working: 0, waiting: 0, free: 0, unknown: 0, interrupted: 0 }
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
  const owner = folder => (folder.branch === 'main' ? null : ownerOf.get(folder.branch) ?? names.find(name => firstWord(name) === folder.name.toLowerCase()) ?? null)

  const lanes = cards.map(lane => {
    const mine = lane.isLeftover ? [] : queued.filter(step => step.worker === lane.name)
    const withQueue = { ...lane, queue: mine.map(step => ({ id: step.id, title: step.title, text: step.text, minutes: step.minutes, after: step.after, branch: step.branch, notes: step.notes, pictures: picturesOf(allWords(step)) })) }
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
  if (advisorChat !== undefined) {
    const { state, doingNow: doing, session, appSession } = card(advisorChat, raw, context)
    const tail = raw.tails?.[advisorChat.cliSessionId] ?? null
    advisor = {
      name: advisorChat.name,
      session,
      appSession,
      state,
      doingNow: doing,
      messages: tail === null || typeof tail.text !== 'string'
        ? []
        : conversation(parseTail(tail.text, tail.isCut === true), { self: advisorChat.name, prefix: list.prefix, titles }),
      // Typed on the board to the advisor and not in its chat yet.
      pending: sent.filter(message => message.to === advisorChat.name && (message.ask ?? null) === null),
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
      game: step.asks === 'verify' && !/https?:\/\//.test(step.text) ? gameOf(step.branch ?? 'main') : null,
      // B110: where an approval goes: the board ticks a step whose work is merged (`tick`); one whose branch is
      // still there, or of which the board cannot tell, goes to its worker (`worker`). Null for what is not approved.
      approval: step.asks === 'verify' && !isClosed ? approvalRoute(step.branch, Array.isArray(raw.branches) ? raw.branches : null) : null,
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
  function runningOf(name) {
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
    chats: lanes.map(lane => ({ ...lane, isRunning: lane.isLeftover ? null : runningOf(lane.name) })),
    // Queued steps that name no worker on the board.
    unassigned: queued.filter(step => step.worker === null || !names.includes(step.worker)),
    forYou: needsOf(asks, lanes, sent, gameOf, now),
    // The whole backlog by activity, for the Coordinate tab. A step for the person opens its card (`needId`).
    backlog: overview(backlog, { underWay: onNow }).map(activity => ({
      ...activity,
      steps: activity.steps.map(step => ({
        ...step,
        pictures: picturesOf(allWords(step)),
        needId: step.status !== 'you' ? null : step.id === null ? stepId(`${activity.name}\n${step.text}`) : `backlog:${step.id}`,
      })),
    })),
    // The open steps in the backlog that end in @you.
    backlogForYou: forYou(backlog).map(step => stepCard(step, false)),
    // The ticked ones: closed. The page shows them only when the person asks for them.
    backlogClosed: closedForYou(backlog).map(step => stepCard(step, true)),
    // The game as it is on main, which the person can always open; with when main last changed.
    mainGame: (() => {
      const game = gameOf('main')
      const folder = game === null || game.path === null ? null : folders.find(one => one.branch === 'main')
      return folder === null ? null : { ...game, lastCommitAt: folder.lastCommitAt ?? null, commit: folder.lastCommit ?? null }
    })(),
    // Folders no worker is named for, and whether git answered at all.
    otherFolders: (folders ?? []).filter(folder => folder.branch !== 'main' && owner(folder) === null),
    hasFolders: folders !== null,
    day: { from, to: now, until, end: hourEnd(Math.min(Math.max(until, now + config.hoursAhead * HOUR), now + 24 * HOUR)) },
    // What the history kept from before the board stopped showing a prompt's words is not shown either.
    today: today(lines.map(line => (line.source === 'prompt' || line.source === 'handover' ? { ...line, task: null } : line)), { from, to: now, names })
      .map((lane, index) => ({ ...lane, ahead: live[index].ahead })),
    restart,
    advisor: advisor === null ? null : { ...advisor, isRunning: runningOf(advisor.name) },
    advice: typeof raw.adviceText === 'string' && raw.adviceText.trim() !== '' ? raw.adviceText : null,
    // When the advice was written: the page says how old it is.
    adviceAt: Number.isFinite(raw.adviceAt) ? raw.adviceAt : null,
  }
}
