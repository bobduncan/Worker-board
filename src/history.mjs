// Own data: what changed per chat over time. A line is written when a chat's state, task or step changes:
//   { at, chat, state, task, step, steps, leftMs, startedAt, source, by }
// and a gap line, { at, gap: true }, marks the moment from which the board was not running, so the time it was
// off is drawn as unknown and not as the state it last saw.

/** The lines of history.jsonl. Lines that do not parse are skipped. */
export function parseHistory(text) {
  const lines = []
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    let line
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    if (line === null || typeof line !== 'object' || !Number.isFinite(line.at)) continue
    if (line.gap === true || typeof line.chat === 'string') lines.push(line)
  }
  return lines
}

/** The last recorded line of each chat. A gap forgets them all: after it, every chat is recorded afresh. */
export function lastByChat(lines) {
  const last = new Map()
  for (const line of lines) {
    if (line.gap === true) last.clear()
    else last.set(line.chat, line)
  }
  return last
}

/** The lines to add for the chats as they are now. `chats` holds `{ name, state, task }`. */
export function changes(last, chats, now) {
  const lines = []
  for (const { name, state, task } of chats) {
    const line = {
      at: now,
      chat: name,
      state,
      task: task?.text ?? null,
      step: task?.step ?? null,
      steps: task?.steps ?? null,
      leftMs: task?.leftMs ?? null,
      startedAt: task?.startedAt ?? null,
      source: task?.source ?? null,
      by: task?.by ?? null,
    }
    const before = last.get(name)
    const isSame = before !== undefined
      && before.state === line.state
      && before.task === line.task
      && (before.step ?? null) === line.step
      // A first estimate is worth a line; a renewed one is read from the chat's plan line each time.
      && ((before.leftMs ?? null) === null) === (line.leftMs === null)
    if (!isSame) lines.push(line)
  }
  return lines
}

/** One lane per name: the spans of state between `from` and `to`. Time without a line stays empty. */
export function today(lines, { from, to, names }) {
  const lanes = new Map(names.map(name => [name, { spans: [], open: null }]))
  const close = (lane, at) => {
    const span = lane.open
    lane.open = null
    if (span === null) return
    const cut = { from: Math.max(span.from, from), to: Math.min(at, to), state: span.state, task: span.task }
    if (cut.to <= cut.from) return
    const previous = lane.spans.at(-1)
    if (previous !== undefined && previous.to === cut.from && previous.state === cut.state && previous.task === cut.task) previous.to = cut.to
    else lane.spans.push(cut)
  }
  for (const line of lines) {
    if (line.at >= to) break
    if (line.gap === true) {
      for (const lane of lanes.values()) close(lane, line.at)
      continue
    }
    const lane = lanes.get(line.chat)
    if (lane === undefined) continue
    close(lane, line.at)
    lane.open = { from: line.at, state: line.state, task: line.task ?? null }
  }
  return names.map(name => {
    const lane = lanes.get(name)
    close(lane, to)
    return { chat: name, spans: lane.spans }
  })
}

/**
 * What the history knows about a chat's current task: when the board first saw it, the hand-over time it recorded,
 * the first estimate, and how long the chat waited for the person. Null when the task was never recorded.
 */
export function taskFacts(lines, chat, taskText, now) {
  // The current run: the chat's lines back from the end for as long as they name this task.
  const mine = lines.filter(line => line.gap === true || line.chat === chat)
  let first = mine.length
  for (let i = mine.length - 1; i >= 0; i -= 1) {
    if (mine[i].gap === true) continue
    if (mine[i].task !== taskText) break
    first = i
  }
  const run = mine.slice(first)
  if (!run.some(line => line.gap !== true)) return null

  let waitedMs = 0
  let startedAt = null
  let firstEstimate = null
  for (let i = 0; i < run.length; i += 1) {
    const line = run[i]
    if (line.gap === true) continue
    if (Number.isFinite(line.startedAt)) startedAt = Math.min(startedAt ?? Infinity, line.startedAt)
    if (firstEstimate === null && Number.isFinite(line.leftMs)) firstEstimate = { at: line.at, leftMs: line.leftMs }
    // A span ends at the next line, which may be the gap where the board stopped watching.
    if (line.state === 'waiting') waitedMs += Math.max(0, (run[i + 1]?.at ?? now) - line.at)
  }
  return { firstSeenAt: run.find(line => line.gap !== true).at, startedAt, firstEstimate, waitedMs }
}

/** The start of the day the timeline shows: the last `hour` o'clock, local time, at or before `now`. */
export function dayStart(now, hour) {
  const start = new Date(now)
  start.setHours(hour, 0, 0, 0)
  if (start.getTime() > now) start.setDate(start.getDate() - 1)
  return start.getTime()
}
