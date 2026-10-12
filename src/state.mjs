// Puts the sources together into the one object the page asks for. Everything here is a pure function of the
// texts that were read: a source that is missing or broken gives "unknown" or an empty list, never an error.

import { boardChats, parseAppChat, parseList } from './appChats.mjs'
import { forYou, openWork, parseBacklog, queue } from './backlog.mjs'
import { dayStart, taskFacts, today } from './history.mjs'
import { parsePlanLine } from './planLines.mjs'
import { doingNow, lastFinish, mainChat, parseTail, taskStart, turnStart, turnState } from './transcript.mjs'

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

function card(chat, raw, { now, config, last, lines, main, prefix }) {
  const base = { name: chat.name, isMain: chat.isMain, isLeftover: chat.isLeftover }
  if (chat.isLeftover) {
    return { ...base, state: 'unknown', quietMs: null, isQuiet: false, doingNow: null, needsYou: null, statusDetail: null, waitingSince: null, task: null, lastActivityAt: chat.lastActivityAt }
  }
  const tail = raw.tails?.[chat.cliSessionId] ?? null
  const entries = tail === null || typeof tail.text !== 'string' ? null : parseTail(tail.text, tail.isCut === true)
  const turn = entries === null ? null : turnState(entries)
  const summary = chat.summary?.isCurrent === true ? chat.summary : null
  const state = chatState({ turn, category: summary?.category, needsAction: summary?.needsAction })
  const plan = parsePlanLine(textOr(raw.planLineTexts?.[chat.cliSessionId], ''))
  const quietMs = state === 'working' && Number.isFinite(tail?.modifiedAt) ? Math.max(0, now - tail.modifiedAt) : null

  let needsYou = null
  if (state === 'waiting') needsYou = turn === 'asking' ? ASKED : summary?.needsAction?.trim() || summary?.detail?.trim() || null

  return {
    ...base,
    state,
    quietMs,
    isQuiet: quietMs !== null && quietMs > config.quietMinutes * MIN,
    doingNow: state === 'working' ? doingNow(entries) : null,
    needsYou,
    statusDetail: turn === 'ended' ? summary?.detail?.trim() || null : null,
    // The turn's last entry: when it ended, or when it asked.
    waitingSince: state === 'waiting' ? entries.findLast(entry => entry.type === 'assistant' && !entry.isSidechain)?.at ?? null : null,
    task: taskOf({
      chat, plan, state, before: last.get(chat.name), lines, main, prefix, now,
      // The longer look back is a few minutes old, so the tail follows it: the newest hand-over or report wins.
      scan: typeof tail?.earlier === 'string' && entries !== null ? [...parseTail(tail.earlier, false), ...entries] : entries,
    }),
    lastActivityAt: Math.max(chat.lastActivityAt ?? 0, tail?.modifiedAt ?? 0) || null,
  }
}

/**
 * The `/api/state` object. `raw` holds the texts as they were read (see sources.mjs), `lines` the history, and
 * `outbox` what was typed in the chat box.
 */
export function buildState(raw, { lines = [], outbox = [], now, config }) {
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
  const chats = found.map(chat => card(chat, raw, context))
  const live = chats.filter(chat => !chat.isLeftover)

  const counts = { working: 0, waiting: 0, free: 0, unknown: 0 }
  for (const chat of live) counts[chat.state] += 1

  const backlog = parseBacklog(textOr(raw.backlogText, ''), { prefix: list.prefix, names: live.map(chat => chat.name) })
  const asked = live
    .filter(chat => chat.state === 'waiting')
    .map(chat => ({ text: chat.needsYou ?? 'Waits for you.', activity: null, chat: chat.name, since: chat.waitingSince }))

  const mainTail = main === undefined ? null : raw.tails?.[main.cliSessionId] ?? null
  const titles = new Map(apps.filter(chat => chat.sessionId !== null).map(chat => [chat.sessionId, chat.title]))
  const from = dayStart(now, config.dayStartHour)

  return {
    readAt: now,
    refreshSeconds: config.refreshSeconds,
    estimateOldMs: config.estimateOldMinutes * MIN,
    maxMessageChars: config.maxMessageChars,
    counts,
    chats,
    forYou: [...asked, ...forYou(backlog).map(step => ({ ...step, chat: null, since: null }))],
    queue: queue(backlog),
    openWork: openWork(backlog),
    folders: Array.isArray(raw.folders) ? raw.folders : null,
    day: { from, to: now },
    today: today(lines, { from, to: now, names: live.map(chat => chat.name) }),
    mainChat: mainTail === null || typeof mainTail.text !== 'string'
      ? []
      : mainChat(parseTail(mainTail.text, mainTail.isCut === true), { prefix: list.prefix, titles }),
    outbox: Array.isArray(outbox) ? outbox : [],
    advice: typeof raw.adviceText === 'string' && raw.adviceText.trim() !== '' ? raw.adviceText : null,
  }
}
