// Own data: what changed per chat over time. A line is written when a chat's state, task or step changes:
//   { at, chat, state, task, step, steps, leftMs, estimateAt, startedAt, source, by }
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
      estimateAt: task?.estimateAt ?? null,
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

/** The board watches once a minute. Longer than this without a look means it was off or the PC slept. */
export const GAP_MS = 3 * 60_000

/** The gap line to add when the board starts after having been off, or null. */
export function startGap(lines, aliveAt, now) {
  const last = lines.at(-1)
  if (last === undefined || last.gap === true) return null
  const at = Math.max(last.at, Number.isFinite(aliveAt) ? aliveAt : last.at)
  return now - at > GAP_MS ? { at, gap: true } : null
}

/**
 * B710 (X80): the stretches the board did not run, from the history's gap lines over all of it: a gap line marks the moment
 * from which the board was off, and the next line is when it ran again (`to` is `now` for a gap still open). `[{ from, to }]`.
 */
export function gapsOf(lines, now, aliveAt = null) {
  const gaps = []
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].gap !== true || !Number.isFinite(lines[i].at)) continue
    const to = Math.min(lines[i + 1]?.at ?? now, now)
    if (to > lines[i].at) gaps.push({ from: lines[i].at, to })
  }
  // B714 (X80 again): a read right after a wake runs before the tick writes the gap line, so the gap still open is read
  // from alive.json's age by `startGap`'s own rule: the board was off from then until now.
  const open = Number.isFinite(aliveAt) ? startGap(lines, aliveAt, now) : null
  if (open !== null) gaps.push({ from: open.at, to: now })
  return gaps
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
 * What the history knows about a chat's current task: when the board first saw it, the start it recorded then,
 * the first estimate, and how long the chat worked on it and waited for the person since. Time the board was off
 * counts as neither. Null when the task was never recorded.
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
  let workedMs = 0
  let startedAt = null
  let firstEstimate = null
  for (let i = 0; i < run.length; i += 1) {
    const line = run[i]
    if (line.gap === true) continue
    // The start the board worked out when it first saw the task stands: later looks see less of the past.
    if (startedAt === null && Number.isFinite(line.startedAt)) startedAt = line.startedAt
    if (firstEstimate === null && Number.isFinite(line.leftMs)) {
      // Dated by when the chat gave it, which can be well before the board recorded it.
      firstEstimate = { at: Number.isFinite(line.estimateAt) ? line.estimateAt : line.at, leftMs: line.leftMs }
    }
    // A span ends at the next line, which may be the gap where the board stopped watching.
    const lasted = Math.max(0, (run[i + 1]?.at ?? now) - line.at)
    if (line.state === 'waiting') waitedMs += lasted
    if (line.state === 'working') workedMs += lasted
  }
  return { firstSeenAt: run.find(line => line.gap !== true).at, startedAt, firstEstimate, waitedMs, workedMs }
}

/** The full hour at or before a time, on the local clock. */
export function hourStart(time) {
  const start = new Date(time)
  start.setMinutes(0, 0, 0)
  return start.getTime()
}

/** The full hour at or after a time, on the local clock. */
export function hourEnd(time) {
  const start = hourStart(time)
  return start === time ? time : start + 60 * 60_000
}
