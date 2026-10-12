// Puts the sources together into the one object the page asks for. Everything here is a pure function of the
// texts that were read: a source that is missing or broken gives "unknown" or an empty list, never an error.

import { boardChats, parseAppChat, parseList } from './appChats.mjs'
import { parseAsk } from './asks.mjs'
import { allWords, closedForYou, forYou, parseBacklog, queue } from './backlog.mjs'
import { pathKey } from './games.mjs'
import { hourEnd, hourStart, taskFacts, today } from './history.mjs'
import { mentionedPaths } from './pictures.mjs'
import { parsePlanLine } from './planLines.mjs'
import { conversation, doingNow, lastFinish, parseTail, taskStart, turnStart, turnState } from './transcript.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const ASKED = 'Asked you a question in its chat.'
/** A chat's own file that says it works is renewed twice a minute. Older than this, its process is gone. */
const CUT_OFF_MS = 150_000

/**
 * True when the app was closed in the middle of a chat's turn. The transcript still shows the turn as open, but the
 * chat's own file, which its process keeps (`plan`), says otherwise: it was set to waiting after this turn began
 * (the process ended, or started again), or it says working and is no longer renewed. A file that was not written
 * around this turn says nothing: that chat's process keeps none.
 */
export function isCutOff({ turn, plan, lastWriteAt, turnStartedAt, now }) {
  if (turn !== 'running' && turn !== 'asking') return false
  if (plan === null || plan.at === null || plan.state === null) return false
  if (plan.state === 'waiting') return plan.at > (turnStartedAt ?? lastWriteAt ?? Infinity)
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
  // `session` is the id the chat's own process knows itself by: the bridge serves only that one under this name.
  const base = { name: chat.name, isMain: chat.isMain, isLeftover: chat.isLeftover, session: chat.cliSessionId ?? null }
  const none = { quietMs: null, isQuiet: false, isAsking: false, doingNow: null, needsYou: null, statusDetail: null, waitingSince: null, task: null, cutOffAt: null, eta: null }
  if (chat.isLeftover) return { ...base, state: 'unknown', ...none, lastActivityAt: chat.lastActivityAt }

  const tail = raw.tails?.[chat.cliSessionId] ?? null
  const entries = tail === null || typeof tail.text !== 'string' ? null : parseTail(tail.text, tail.isCut === true)
  const turn = entries === null ? null : turnState(entries)
  const summary = chat.summary?.isCurrent === true ? chat.summary : null
  const plan = parsePlanLine(textOr(raw.planLineTexts?.[chat.cliSessionId], ''))
  const lastWriteAt = Number.isFinite(tail?.modifiedAt) ? tail.modifiedAt : null
  const wasCutOff = isCutOff({ turn, plan, lastWriteAt, turnStartedAt: entries === null ? null : turnStart(entries, { prefix })?.at ?? null, now })
  const state = wasCutOff ? 'interrupted' : chatState({ turn, category: summary?.category, needsAction: summary?.needsAction })
  const quietMs = state === 'working' && Number.isFinite(tail?.modifiedAt) ? Math.max(0, now - tail.modifiedAt) : null

  let needsYou = null
  if (state === 'waiting') needsYou = turn === 'asking' ? ASKED : summary?.needsAction?.trim() || summary?.detail?.trim() || null

  const task = taskOf({
    // A chat that was cut off keeps the task it was on.
    chat, plan, state: wasCutOff ? 'working' : state, before: last.get(chat.name), lines, main, prefix, now,
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
    // When a chat that was cut off last wrote.
    cutOffAt: wasCutOff ? lastWriteAt : null,
    eta: etaOf(task, state, now),
    lastActivityAt: Math.max(chat.lastActivityAt ?? 0, tail?.modifiedAt ?? 0) || null,
  }
}

const asAnswer = message => (message === undefined ? null : { at: message.at, verdict: message.verdict ?? null, text: message.text ?? '', state: message.state })

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
 */
function needsOf(asks, lanes, outbox, gameOf) {
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
 * `outbox` what was sent from the page and is not delivered yet (see store.mjs, `outboxNow`), and `runs` the
 * games the board started and that still run (see games.mjs).
 */
export function buildState(raw, { lines = [], outbox = [], runs = [], board = null, now, config }) {
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
  const cards = found.filter(chat => !isAdvisor(chat)).map(chat => card(chat, raw, context))
  const names = cards.filter(lane => !lane.isLeftover).map(lane => lane.name)

  const counts = { working: 0, waiting: 0, free: 0, unknown: 0, interrupted: 0 }
  for (const lane of cards) if (!lane.isLeftover) counts[lane.state] += 1

  const backlog = parseBacklog(textOr(raw.backlogText, ''), { prefix: list.prefix, names })
  const queued = queue(backlog)
  // A folder belongs to the worker an open step names together with the folder's branch.
  const ownerOf = new Map(backlog.activities.flatMap(activity => activity.steps)
    .filter(step => !step.isDone && step.branch !== null && step.worker !== null)
    .map(step => [step.branch, step.worker]))
  const folders = Array.isArray(raw.folders) ? raw.folders : null

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
    const { state, doingNow: doing, session } = card(advisorChat, raw, context)
    const tail = raw.tails?.[advisorChat.cliSessionId] ?? null
    advisor = {
      name: advisorChat.name,
      session,
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
  const restart = {
    main: main === undefined ? null : main.name,
    interrupted: live.filter(lane => lane.state === 'interrupted').map(lane => lane.name),
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
    chats: lanes,
    // Queued steps that name no worker on the board.
    unassigned: queued.filter(step => step.worker === null || !names.includes(step.worker)),
    forYou: needsOf(asks, lanes, sent, gameOf),
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
    today: today(lines, { from, to: now, names }).map((lane, index) => ({ ...lane, ahead: live[index].ahead })),
    restart,
    advisor,
    advice: typeof raw.adviceText === 'string' && raw.adviceText.trim() !== '' ? raw.adviceText : null,
  }
}
