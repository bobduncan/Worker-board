// B185: how long the steps the workers take really take, so the times the chats give follow that instead of a guess.
// The person, 2026-10-14, after a simple task showed 60 minutes: "i only want structural improvements to improve the
// accuracy". Each worker's transcript is read once from its start (the past), then only what was added since. B301: a
// task runs from the worker's own `work take B<id>` to its `work report B<id>` (the work tool's calls, not the words
// of a message), and only the time its turns run counts: waiting for the person, in a queue, or while the board was
// off does not. A task paused for the limit, or never reported, is left out. Nothing is kept by hand: the list updates
// itself, for the board and for the chats that give times (`listText`, in the board's data folder). B468: with each task
// its step's effort level, the effort its answers ran at, and the tokens they took, so the levels can be tuned later.

import { open } from 'node:fs/promises'

import { PAUSED } from './limits.mjs'
import { EFFORTS } from './work/effort.mjs'
import { endsTurn, hasToolResult, isCommandText, parseTail, textOf } from './transcript.mjs'

const MIN = 60_000
/** How many finished tasks the list keeps, and how many make an area's numbers worth going by. */
const KEPT = 400
const ENOUGH = 5
/** The tasks "lately": the last ones with an estimate. */
const LATELY = 10
const CHUNK = 8 * 1024 * 1024
/** Longer than this without a line in the middle of a turn is no work; background work counts up to an hour. */
const IDLE_MS = 30 * MIN
const BACKGROUND_MS = 60 * MIN

/** A transcript not read yet. */
export const freshScan = worker => ({ worker, offset: 0, turnAt: null, lastAt: null, endedAt: null, task: null })

/**
 * The area of a task, from its step's words: its "Touches:" line names the board's files or the game's, else its
 * words say art or the board. `board`, `art` or `game`.
 */
export function areaOf(body) {
  const touches = body.match(/^\s*Touches:(.*)$/im)?.[1] ?? ''
  if (/\.mjs\b|board\.(?:js|css)|index\.html|worker-board/i.test(touches)) return 'board'
  if (/\b(?:sprites?|portraits?|pixel art|animations?|walk cycles?)\b/i.test(body)) return 'art'
  if (/\.tsx?\b|vitest/i.test(touches)) return 'game'
  if (/\bworker board\b|\bthe board\b|\bboard's\b/i.test(body)) return 'board'
  return 'game'
}

/** Whether an entry opens a turn: typed by the person, sent by another chat, or raised by the app. */
function opensTurn(entry) {
  if (entry.type !== 'user' || hasToolResult(entry)) return false
  // B247: a slash command opens none, also one a mod ran (the Workers mod's /compact after a report).
  if (entry.isCompactSummary || isCommandText(textOf(entry))) return false
  if (entry.origin !== null) return true
  return !entry.isMeta && !entry.isCompactSummary && !isCommandText(textOf(entry))
}

/** B301: the work tool's calls in an entry, as `{ action, id }` (the Workers mod registers it as "<mod>__work"). */
const workCalls = entry => entry.blocks
  .filter(block => block.type === 'tool_use' && /(?:^|__)work$/.test(block.name ?? '') && typeof block.input?.action === 'string' && typeof block.input?.id === 'string')
  .map(block => ({ action: block.input.action, id: block.input.id.trim() }))

/** The words a chat sent with a tool, when it sent any. */
const sentFirstLines = entry => entry.blocks
  .filter(block => block.type === 'tool_use')
  .map(block => [block.input?.message, block.input?.content, block.input?.text].find(value => typeof value === 'string') ?? '')
  .map(words => words.trim().split('\n')[0] ?? '')

/** B468: no tokens yet. */
const noTokens = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 })
/** B468: all the tokens of a task's answers, what the app read from its cache among them. */
export const tokensOf = tokens => (tokens === null || tokens === undefined ? 0 : tokens.input + tokens.cacheWrite + tokens.cacheRead + tokens.output)
/** B468: the effort most of a task's answers ran at, or null. */
const mostOf = counts => Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

/**
 * Walks entries of one worker's transcript in order, on from where the last walk stopped (`scan`, changed in place),
 * and returns the tasks it saw finished: `{ step, steps, worker, area, estimateMin, startedAt, reportedAt, workMs,
 * effort, ranOn, tokens }`. `stepOf(id)` gives a step's `{ area, estimateMin, effort }` as the store holds it, or null.
 * B468: `effort` is the step's level, `ranOn` the effort most of its answers ran at, `tokens` theirs from its take to its
 * report, each message once.
 */
export function walk(entries, scan, stepOf = () => null) {
  const finished = []
  const countTo = until => {
    const task = scan.task
    if (task === null || scan.turnAt === null || !Number.isFinite(until)) return
    task.workMs += Math.max(0, until - Math.max(scan.turnAt, task.startedAt, task.countedTo ?? 0))
    task.countedTo = until
  }
  const finish = at => {
    const task = scan.task
    scan.task = null
    if (task === null || task.isPaused) return
    finished.push({ step: task.steps[0] ?? null, steps: task.steps, worker: scan.worker, area: task.area, estimateMin: task.estimateMin, startedAt: task.startedAt, reportedAt: at, workMs: task.workMs, effort: task.effort ?? null, ranOn: mostOf(task.ranOn), tokens: task.tokens ?? noTokens() })
  }
  for (const entry of entries) {
    if (entry.isSidechain || !Number.isFinite(entry.at)) continue
    // The app starts the chat again when work it sent to the background (a helper, a long command) is done: that
    // time was work on the task, although the turn had ended.
    const isBackground = opensTurn(entry) && entry.origin?.kind === 'task-notification' && scan.turnAt === null && scan.endedAt != null && entry.at - scan.endedAt <= BACKGROUND_MS
    if (isBackground) scan.turnAt = scan.endedAt
    else if (scan.turnAt !== null && scan.lastAt !== null && entry.at - scan.lastAt > IDLE_MS) {
      // Nothing written for half an hour in the middle of a turn (the PC asleep, the app closed before the turn's end
      // was written): that time is no work.
      countTo(scan.lastAt)
      if (scan.task !== null) scan.task.countedTo = entry.at
      if (opensTurn(entry)) scan.turnAt = entry.at
    }
    if (opensTurn(entry) && scan.turnAt === null) scan.turnAt = entry.at
    const calls = entry.type === 'assistant' ? workCalls(entry) : []
    for (const take of calls.filter(call => call.action === 'take')) {
      // A take of the step it is on goes on with the same task; a take of another starts a new one, and a task before it
      // that was never reported is left out.
      if (scan.task !== null && scan.task.steps.includes(take.id)) continue
      const step = stepOf(take.id)
      scan.task = { steps: [take.id], area: step?.area ?? 'game', estimateMin: step?.estimateMin ?? null, effort: step?.effort ?? null, startedAt: entry.at, workMs: 0, countedTo: null, isPaused: false, tokens: noTokens(), ranOn: {}, lastMessage: null, lastUsage: null }
      if (scan.turnAt === null) scan.turnAt = entry.at
    }
    // B468: a message's tokens once: the app writes them on each of its lines, so a line of the same message adds only
    // what it says more than the line before (the largest counts); and the effort a message ran at, once.
    if (scan.task !== null && entry.type === 'assistant' && entry.usage != null) {
      const task = scan.task
      const isSame = entry.messageId !== null && entry.messageId === task.lastMessage
      const before = isSame ? task.lastUsage ?? noTokens() : noTokens()
      task.tokens ??= noTokens()
      for (const key of Object.keys(task.tokens)) task.tokens[key] += Math.max(0, (entry.usage[key] ?? 0) - before[key])
      task.lastUsage = Object.fromEntries(Object.keys(before).map(key => [key, Math.max(before[key], entry.usage[key] ?? 0)]))
      if (!isSame && typeof entry.effort === 'string') task.ranOn = { ...task.ranOn, [entry.effort]: (task.ranOn?.[entry.effort] ?? 0) + 1 }
      task.lastMessage = entry.messageId
    }
    if (scan.task !== null && entry.type === 'assistant') {
      if (entry.error === 'rate_limit' || sentFirstLines(entry).some(first => PAUSED.test(first))) scan.task.isPaused = true
      // Only its report ends a task: a note or an ask in the middle of it does not, and the time until the person's
      // answer comes back is waiting, not work.
      if (calls.some(call => call.action === 'report' && scan.task.steps.includes(call.id))) {
        countTo(entry.at)
        finish(entry.at)
      }
    } else if (scan.task !== null && entry.error === 'rate_limit') scan.task.isPaused = true
    if (endsTurn(entry)) {
      countTo(entry.at)
      scan.turnAt = null
      scan.endedAt = entry.at
    }
    scan.lastAt = entry.at
  }
  return finished
}

/** The lines of a transcript worth reading here: the person's, the chats' and the app's, not the tools' answers. */
const isWorthReading = line => !line.includes('"tool_result"') && (line.includes('"assistant"') || line.includes('"user"') || line.includes('"queued_command"'))

/**
 * Reads what a transcript gained since `scan.offset` and walks it; a line still being written is left for the next
 * read. The tasks it finished, or none when the file is gone.
 */
export async function readOn(path, scan, stepOf) {
  let file
  try {
    file = await open(path, 'r')
  } catch {
    return []
  }
  const finished = []
  try {
    const { size } = await file.stat()
    if (size < scan.offset) Object.assign(scan, freshScan(scan.worker))
    while (scan.offset < size) {
      const length = Math.min(CHUNK, size - scan.offset)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await file.read(buffer, 0, length, scan.offset)
      const end = buffer.lastIndexOf(10, bytesRead - 1)
      // One line longer than a chunk is skipped whole.
      const upTo = end < 0 ? (bytesRead === CHUNK ? bytesRead : 0) : end + 1
      if (upTo === 0) break
      const text = buffer.subarray(0, upTo).toString('utf8').split('\n').filter(isWorthReading).join('\n')
      finished.push(...walk(parseTail(text, false), scan, stepOf))
      scan.offset += upTo
    }
  } finally {
    await file.close()
  }
  return finished
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** How far estimates were off, in words: "8x too high", "about right", "2x too low". */
export function offWords(ratio) {
  if (ratio === null) return null
  if (ratio >= 1.5) return `${ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10}x too high`
  if (ratio <= 1 / 1.5) return `${Math.round(10 / ratio) / 10}x too low`
  return 'about right'
}

/** A task's estimate against its working time: estimate / took, or null without an estimate. */
const ratioOf = task => (task.estimateMin === null || task.workMs <= 0 ? null : task.estimateMin / Math.max(1, task.workMs / MIN))

/**
 * What the board shows of the tasks: per area how many finished, their typical working time and how far their
 * estimates were off (`isEnough` from 5 tasks on); the same for the last 10 with an estimate (`lately`); and per
 * step the newest task's estimate and working time (`byStep`).
 */
export function taskTimesOf(kept) {
  // The tasks of one step are one: a later fix of the same step is part of what it took.
  const steps = new Map()
  const tasks = []
  for (const task of [...kept].sort((a, b) => a.startedAt - b.startedAt)) {
    const same = task.step === null ? undefined : steps.get(task.step)
    if (same === undefined) {
      const copy = { ...task }
      tasks.push(copy)
      if (task.step !== null) steps.set(task.step, copy)
    } else Object.assign(same, { workMs: same.workMs + task.workMs, reportedAt: Math.max(same.reportedAt, task.reportedAt), estimateMin: same.estimateMin ?? task.estimateMin, tokens: sumTokens(same.tokens, task.tokens) })
  }
  const areas = [...new Set(tasks.map(task => task.area))].map(area => {
    const mine = tasks.filter(task => task.area === area)
    const ratio = median(mine.map(ratioOf).filter(value => value !== null))
    return { area, count: mine.length, typicalMin: Math.max(1, Math.round(median(mine.map(task => task.workMs / MIN)))), off: offWords(ratio), isEnough: mine.length >= ENOUGH }
  }).sort((a, b) => b.count - a.count)
  const recent = tasks.filter(task => ratioOf(task) !== null).sort((a, b) => b.reportedAt - a.reportedAt).slice(0, LATELY)
  const ratio = median(recent.map(ratioOf))
  const byStep = {}
  for (const task of [...tasks].sort((a, b) => a.reportedAt - b.reportedAt)) {
    if (task.step !== null) byStep[task.step] = { estimateMin: task.estimateMin, workMin: Math.max(1, Math.round(task.workMs / MIN)), worker: task.worker, at: task.reportedAt }
  }
  // B468: per effort level, the tasks whose step had one when taken: how many, their typical time and tokens.
  const efforts = EFFORTS.map(level => {
    const mine = tasks.filter(task => task.effort === level)
    if (mine.length === 0) return null
    const measured = mine.filter(task => task.tokens != null)
    return {
      level, count: mine.length, typicalMin: Math.max(1, Math.round(median(mine.map(task => task.workMs / MIN)))),
      tokens: measured.length === 0 ? null : Math.round(median(measured.map(task => tokensOf(task.tokens)))),
      output: measured.length === 0 ? null : Math.round(median(measured.map(task => task.tokens.output))),
      ranOther: mine.filter(task => task.ranOn != null && task.ranOn !== level).length, isEnough: mine.length >= ENOUGH,
    }
  }).filter(one => one !== null)
  return { areas, lately: { count: recent.length, off: offWords(ratio), ratio }, byStep, efforts, count: tasks.length }
}

/** B468: two tasks' tokens together; a task measured before B468 has none. */
function sumTokens(a, b) {
  if (a == null || b == null) return a ?? b ?? null
  return { input: a.input + b.input, cacheWrite: a.cacheWrite + b.cacheWrite, cacheRead: a.cacheRead + b.cacheRead, output: a.output + b.output }
}

/** B468: tokens as the list writes them: "850", "12 k", "3.4 M". */
export function tokensText(tokens) {
  if (tokens === null || tokens === undefined) return '–'
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)} k`
  return `${Math.round(tokens / 100_000) / 10} M`
}

/** Minutes as the chats write them: "45 min", "1 h", "1 h 30 min". */
export function minutesText(minutes) {
  if (minutes === null) return '–'
  const whole = Math.round(minutes)
  if (whole < 60) return `${whole} min`
  return whole % 60 === 0 ? `${whole / 60} h` : `${Math.floor(whole / 60)} h ${whole % 60} min`
}

/** The list the chats read when they give a time, in the board's data folder; it is written anew each time. */
export function listText(tasks, now) {
  const times = taskTimesOf(tasks)
  const stamp = new Date(now)
  const two = n => String(n).padStart(2, '0')
  const lines = [
    '# How long tasks really take',
    '',
    `Written by the worker board on ${stamp.getFullYear()}-${two(stamp.getMonth() + 1)}-${two(stamp.getDate())} at ${two(stamp.getHours())}:${two(stamp.getMinutes())}; it updates itself, do not edit it.`,
    'Working time only: from the worker\'s take of a step to its report, without the time spent waiting for the person.',
    '',
    '| Area | Tasks | Typical time | Estimates were |',
    '| --- | --- | --- | --- |',
    ...times.areas.map(area => `| ${area.area} | ${area.count} | ${area.isEnough ? minutesText(area.typicalMin) : `${minutesText(area.typicalMin)} (too few tasks to go by)`} | ${area.off ?? '–'} |`),
    '',
    `Lately (the last ${times.lately.count} tasks with an estimate): estimates were ${times.lately.off ?? 'not measured yet'}.`,
    '',
    // B468: per effort level of the steps, so the levels can be tuned.
    ...(times.efforts.length === 0 ? [] : [
      '## Per effort level',
      '',
      'The step\'s effort when its worker took it; tokens are all its answers took, what the app read from its cache among them.',
      '',
      '| Effort | Tasks | Typical time | Typical tokens | Typical output tokens | Ran at another level |',
      '| --- | --- | --- | --- | --- | --- |',
      ...times.efforts.map(one => `| ${one.level} | ${one.count} | ${one.isEnough ? minutesText(one.typicalMin) : `${minutesText(one.typicalMin)} (too few tasks to go by)`} | ${tokensText(one.tokens)} | ${tokensText(one.output)} | ${one.ranOther} |`),
      '',
    ]),
    '## The last 20 tasks',
    '',
    '| Step | Worker | Area | Estimate | Took |',
    '| --- | --- | --- | --- | --- |',
    ...[...tasks].sort((a, b) => b.reportedAt - a.reportedAt).slice(0, 20)
      .map(task => `| ${task.step ?? '–'} | ${task.worker} | ${task.area} | ${minutesText(task.estimateMin)} | ${minutesText(Math.max(1, Math.round(task.workMs / MIN)))} |`),
    '',
  ]
  return lines.join('\n')
}

/** The tasks kept, with new ones added: one per worker and start, the newest 400. */
export function keptTasks(tasks, added) {
  const all = new Map(tasks.map(task => [`${task.worker}:${task.startedAt}`, task]))
  for (const task of added) all.set(`${task.worker}:${task.startedAt}`, task)
  return [...all.values()].sort((a, b) => a.reportedAt - b.reportedAt).slice(-KEPT)
}
