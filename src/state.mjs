// Puts the sources together into the one object the page asks for. Everything here is a pure function of the
// texts that were read: a source that is missing or broken gives "unknown" or an empty list, never an error.

import { boardChats, parseAppChat, parseList } from './appChats.mjs'
import { parseAsk } from './asks.mjs'
import { forYou, parseBacklog, queue } from './backlog.mjs'
import { dayStart, taskFacts, today } from './history.mjs'
import { mentionedPaths } from './pictures.mjs'
import { parsePlanLine } from './planLines.mjs'
import { conversation, doingNow, lastFinish, parseTail, taskStart, turnStart, turnState } from './transcript.mjs'

const MIN = 60_000
const ASKED = 'Asked you a question in its chat.'

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
 * The task a chat is on. Its own plan line first; else the task the main chat handed to it; else, for a chat that
 * works without having named a task, what started its turn (`source: 'prompt'`, with who asked in `by`).
 */
function taskOf({ chat, plan, scan, state, before, lines, main, prefix, now }) {
  // `scan` holds the entries that can start or end a task: the tail, after a longer look back when there is one.
  const handOver = chat.isMain || scan === null ? null : taskStart(scan, main)
  const opening = scan === null ? null : turnStart(scan, { prefix })
  const bare = { step: null, steps: null, leftMs: null, estimateAt: null, source: 'handover', by: null }
  // A handed-over task stands while the chat works on it or waits for the person; a free chat has finished it.
  const isBusy = state === 'working' || state === 'waiting'
  let task = null
  if (plan?.task != null && !plan.task.isReported) {
    const { text, step, steps, leftMs } = plan.task
    task = { text, step, steps, leftMs, estimateAt: leftMs === null ? null : plan.at, source: 'plan', by: null }
  } else if (handOver !== null && isBusy) {
    task = { text: handOver.title, ...bare }
  } else if (handOver === null && isBusy && !chat.isMain && before?.source === 'handover' && typeof before.task === 'string') {
    // The hand-over is further back than the board looks: the history remembers it, until the chat has reported.
    const finishedAt = scan === null ? null : lastFinish(scan, main)
    if (finishedAt === null || finishedAt <= (before.startedAt ?? before.at)) task = { text: before.task, ...bare }
  }
  if (task === null && state === 'working') {
    const current = opening !== null && opening.isOpen && opening.title !== '' ? opening : null
    // An opening the entries cannot be sure of gives way to the one the history recorded while the chat kept working.
    const remembered = before?.source === 'prompt' && before.state === 'working' && typeof before.task === 'string' ? before : null
    if (current !== null && (current.isSure || remembered === null)) task = { text: current.title, ...bare, source: 'prompt', by: current.by }
    else if (remembered !== null) task = { text: remembered.task, ...bare, source: 'prompt', by: remembered.by ?? null }
  }
  if (task === null) return null

  const facts = taskFacts(lines, chat.name, task.text, now)
  // When the task was first known: when the board first saw it, or when the chat says it named it.
  const firstSeenAt = Math.min(facts?.firstSeenAt ?? now, plan?.task?.since ?? Infinity)
  // What could have started it, not later than that: the hand-over, and for a task the chat named itself also
  // the last time the person opened a turn. The latest of them is the start.
  const starts = [task.source === 'prompt' ? null : handOver?.at, task.source === 'handover' ? null : opening?.at]
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
  }
}


/** When a working chat expects to be done: when it gave its estimate, plus what it said was left. */
function etaOf(task, state, now) {
  if (state !== 'working' || task === null || task.leftMs === null || task.estimateAt === null) return null
  const at = task.estimateAt + task.leftMs
  return { at, leftMs: Math.max(0, at - now), isOverdue: at < now }
}

function card(chat, raw, { now, config, last, lines, main, prefix }) {
  const base = { name: chat.name, isMain: chat.isMain, isLeftover: chat.isLeftover }
  const none = { quietMs: null, isQuiet: false, isAsking: false, doingNow: null, needsYou: null, statusDetail: null, waitingSince: null, task: null, eta: null }
  if (chat.isLeftover) return { ...base, state: 'unknown', ...none, lastActivityAt: chat.lastActivityAt }

  const tail = raw.tails?.[chat.cliSessionId] ?? null
  const entries = tail === null || typeof tail.text !== 'string' ? null : parseTail(tail.text, tail.isCut === true)
  const turn = entries === null ? null : turnState(entries)
  const summary = chat.summary?.isCurrent === true ? chat.summary : null
  const state = chatState({ turn, category: summary?.category, needsAction: summary?.needsAction })
  const plan = parsePlanLine(textOr(raw.planLineTexts?.[chat.cliSessionId], ''))
  const quietMs = state === 'working' && Number.isFinite(tail?.modifiedAt) ? Math.max(0, now - tail.modifiedAt) : null

  let needsYou = null
  if (state === 'waiting') needsYou = turn === 'asking' ? ASKED : summary?.needsAction?.trim() || summary?.detail?.trim() || null

  const task = taskOf({
    chat, plan, state, before: last.get(chat.name), lines, main, prefix, now,
    // The longer look back is a few minutes old, so the tail follows it: the newest hand-over or report wins.
    scan: typeof tail?.earlier === 'string' && entries !== null ? [...parseTail(tail.earlier, false), ...entries] : entries,
  })
  return {
    ...base,
    state,
    quietMs,
    isQuiet: quietMs !== null && quietMs > config.quietMinutes * MIN,
    // It asked with the app's own question form: that can only be answered in its chat.
    isAsking: turn === 'asking',
    doingNow: state === 'working' ? doingNow(entries) : null,
    needsYou,
    statusDetail: turn === 'ended' ? summary?.detail?.trim() || null : null,
    // The turn's last entry: when it ended, or when it asked.
    waitingSince: state === 'waiting' ? entries.findLast(entry => entry.type === 'assistant' && !entry.isSidechain)?.at ?? null : null,
    task,
    eta: etaOf(task, state, now),
    lastActivityAt: Math.max(chat.lastActivityAt ?? 0, tail?.modifiedAt ?? 0) || null,
  }
}

/** What the person answered to a request, as far as the outbox knows: the last message about it. */
function answerOf(outbox, id) {
  const message = outbox.findLast(sent => sent.ask === id)
  return message === undefined ? null : { at: message.at, verdict: message.verdict ?? null, text: message.text ?? '', state: message.state }
}

/**
 * What waits for the person, newest first: the asks the chats filed, a chat that waits without having filed one,
 * and a chat whose turn runs but shows no sign of life. `canAnswer` says the board's own form can answer it.
 */
function needsOf(asks, lanes, outbox) {
  const live = lanes.filter(lane => !lane.isLeftover)
  const names = new Set(live.map(lane => lane.name))
  const items = asks.map(ask => ({ ...ask, canAnswer: names.has(ask.from) }))
  const asked = new Set(asks.map(ask => ask.from))
  const blank = { options: [], pictures: [], run: null, checks: [], tried: [] }
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
        canAnswer: !lane.isAsking,
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
        canAnswer: false,
      })
    }
  }
  return items
    .map(item => ({ ...item, answer: answerOf(outbox, item.id) }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

/** A name for a backlog step that stays the same as long as its words do: an answer is kept under it. */
function stepId(words) {
  let hash = 5381
  for (const letter of words) hash = ((hash * 33) ^ letter.codePointAt(0)) >>> 0
  return `backlog:${hash.toString(16)}`
}

/** What a chat is expected to work on after now: the rest of its task, then its queue, as far as times are given. */
function aheadOf(lane, now) {
  if (lane.eta === null || lane.eta.isOverdue) return []
  const spans = [{ from: now, to: lane.eta.at, title: lane.task.text, isQueued: false }]
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
 * `outbox` what was sent from the page and is not delivered yet (see store.mjs, `outboxNow`).
 */
export function buildState(raw, { lines = [], outbox = [], now, config }) {
  const sent = Array.isArray(outbox) ? outbox : []
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
  const cards = found.filter(chat => !isAdvisor(chat)).map(chat => card(chat, raw, context))
  const names = cards.filter(lane => !lane.isLeftover).map(lane => lane.name)

  const counts = { working: 0, waiting: 0, free: 0, unknown: 0 }
  for (const lane of cards) if (!lane.isLeftover) counts[lane.state] += 1

  const backlog = parseBacklog(textOr(raw.backlogText, ''), { prefix: list.prefix, names })
  const queued = queue(backlog)
  // A folder belongs to the worker an open step names together with the folder's branch.
  const ownerOf = new Map(backlog.activities.flatMap(activity => activity.steps)
    .filter(step => !step.isDone && step.branch !== null && step.worker !== null)
    .map(step => [step.branch, step.worker]))
  const folders = Array.isArray(raw.folders) ? raw.folders : null

  // Without such a step, a folder named after a worker ("features" for Features) is that worker's.
  const firstWord = name => name.toLowerCase().split(/[^a-z0-9]+/)[0]
  const owner = folder => (folder.branch === 'main' ? null : ownerOf.get(folder.branch) ?? names.find(name => firstWord(name) === folder.name.toLowerCase()) ?? null)

  const lanes = cards.map(lane => {
    const mine = lane.isLeftover ? [] : queued.filter(step => step.worker === lane.name)
    const withQueue = { ...lane, queue: mine.map(({ title, text, minutes, after, branch }) => ({ title, text, minutes, after, branch })) }
    return {
      ...withQueue,
      folders: lane.isLeftover ? [] : (folders ?? []).filter(folder => owner(folder) === lane.name),
      ahead: lane.isLeftover ? [] : aheadOf(withQueue, now),
    }
  })
  const live = lanes.filter(lane => !lane.isLeftover)

  const asks = (Array.isArray(raw.askTexts) ? raw.askTexts : []).map(text => parseAsk(textOr(text, ''))).filter(ask => ask !== null)
  const pictureLists = raw.pictureLists !== null && typeof raw.pictureLists === 'object' ? raw.pictureLists : {}
  const titles = new Map(apps.filter(chat => chat.sessionId !== null).map(chat => [chat.sessionId, chat.title]))
  const from = dayStart(now, config.dayStartHour)

  let advisor = null
  if (advisorChat !== undefined) {
    const { state, doingNow: doing } = card(advisorChat, raw, context)
    const tail = raw.tails?.[advisorChat.cliSessionId] ?? null
    advisor = {
      name: advisorChat.name,
      state,
      doingNow: doing,
      messages: tail === null || typeof tail.text !== 'string'
        ? []
        : conversation(parseTail(tail.text, tail.isCut === true), { self: advisorChat.name, prefix: list.prefix, titles }),
      // Typed on the board to the advisor and not in its chat yet.
      pending: sent.filter(message => message.to === advisorChat.name && (message.ask ?? null) === null),
    }
  }

  return {
    readAt: now,
    refreshSeconds: config.refreshSeconds,
    estimateOldMs: config.estimateOldMinutes * MIN,
    maxMessageChars: config.maxMessageChars,
    counts,
    chats: lanes,
    // Queued steps that name no worker on the board.
    unassigned: queued.filter(step => step.worker === null || !names.includes(step.worker)),
    forYou: needsOf(asks, lanes, sent),
    // The steps in the backlog that end in @you, as cards like the ones above. A step says what it asks of the
    // person ("Verify:", "Decide:", "Provide:", "Do:"); the answer goes to the worker it names, else to the main
    // chat, which keeps the backlog.
    backlogForYou: forYou(backlog).map(step => {
      const to = step.worker !== null && names.includes(step.worker) ? step.worker : main?.name ?? null
      const id = stepId(`${step.activity}\n${step.text}`)
      return {
        id,
        from: to,
        kind: step.asks === 'verify' || step.asks === 'do' ? step.asks : 'input',
        asks: step.asks,
        title: step.title,
        text: '',
        at: null,
        activity: step.activity,
        options: [],
        pictures: mentionedPaths(step.text, config.pictureRoots)
          .flatMap(path => (Array.isArray(pictureLists[path]) ? pictureLists[path] : []))
          .slice(0, 6),
        run: null,
        checks: [],
        tried: [],
        canAnswer: to !== null,
        answer: answerOf(sent, id),
      }
    }),
    // Folders no worker is named for, and whether git answered at all.
    otherFolders: (folders ?? []).filter(folder => folder.branch !== 'main' && owner(folder) === null),
    hasFolders: folders !== null,
    day: { from, to: now, until: Math.max(now, ...live.flatMap(lane => lane.ahead.map(span => span.to))) },
    today: today(lines, { from, to: now, names }).map((lane, index) => ({ ...lane, ahead: live[index].ahead })),
    advisor,
    advice: typeof raw.adviceText === 'string' && raw.adviceText.trim() !== '' ? raw.adviceText : null,
  }
}
