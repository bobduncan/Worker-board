// Source 2: the line a chat writes about its own plan, `<project>\.claude\chats\<cliSessionId>.json`. It gives the
// task's name (a topic of a few words), its steps and estimate when it is there. It never decides whether a chat
// is busy: the transcript does.
//   task: { text, step, steps, names, left, stepLeft, since, isReported }
// `step` is the number of the step the chat is on, from 1; `steps` how many there are; `names` what they are
// called, one short string per step in order (B81; older lines have none).

const number = value => (Number.isFinite(value) ? value : null)

const NAME_CHARS = 80
const MAX_NAMES = 30

/** The steps' names as a list of short strings, or null when the line has none. */
function namesOf(value) {
  if (!Array.isArray(value)) return null
  const names = value.filter(name => typeof name === 'string' && name.trim() !== '').map(name => name.trim().slice(0, NAME_CHARS)).slice(0, MAX_NAMES)
  return names.length === 0 ? null : names
}

/**
 * B210: the file name of a card a chat wrote itself, without the Workers mod: its name in the list of chats in small
 * letters, every other run of characters a "-" ("Worker 1" is `worker-1`), in `<project>\.claude\chats\own\`.
 */
export const ownCardKey = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * B210: a card a chat wrote itself, made into the mod's card: the same fields, where `minutes` and `stepMinutes` may
 * stand for `left` and `stepLeft` (milliseconds), and the file's time (`fileAt`) for `at` when it has none: the time
 * counts down from when the card was written. Its text as the board reads a card, or null when it is no card.
 */
export function ownCard(fileText, fileAt) {
  let raw
  try {
    raw = JSON.parse(fileText)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const task = raw.task !== null && typeof raw.task === 'object' && !Array.isArray(raw.task) ? { ...raw.task } : raw.task
  if (task !== null && typeof task === 'object') {
    if (!Number.isFinite(task.left) && Number.isFinite(task.minutes)) task.left = Math.round(task.minutes * 60_000)
    if (!Number.isFinite(task.stepLeft) && Number.isFinite(task.stepMinutes)) task.stepLeft = Math.round(task.stepMinutes * 60_000)
    if (!Number.isFinite(task.steps) && Array.isArray(task.names)) task.steps = task.names.length
  }
  // The mod's own word on whether its process runs is not the chat's to give.
  const { state: _state, ...rest } = raw
  return JSON.stringify({ ...rest, task, at: Number.isFinite(raw.at) ? raw.at : Number.isFinite(fileAt) ? fileAt : null })
}

/** A time as the mod writes it: milliseconds, or a date text. */
const timeOf = value => (Number.isFinite(value) ? value : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null)

/**
 * B235: the Workers mod's word after a worker's report: it compacted the chat (`compacted`: when, and its size before
 * and after, in tokens), or it says why it did not (`compactNote`: when, and why). Null when the card has none.
 */
function compactionOf(raw) {
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const noteOf = value => (isRecord(value) && timeOf(value.at) !== null && typeof value.why === 'string' && value.why.trim() !== ''
    ? { at: timeOf(value.at), why: value.why.replace(/\s+/g, ' ').trim().slice(0, 200) } : null)
  const done = isRecord(raw.compacted) && timeOf(raw.compacted.at) !== null
    ? { at: timeOf(raw.compacted.at), before: number(raw.compacted.before), after: number(raw.compacted.after) } : null
  const note = noteOf(raw.compactNote)
  // Clear after each step: the mod cleared the worker after its reported step (`cleared`: when, the step, its log in
  // the project's folder), or says why it did not and compacted instead (`clearNote`).
  const cleared = isRecord(raw.cleared) && timeOf(raw.cleared.at) !== null
    ? { at: timeOf(raw.cleared.at), step: typeof raw.cleared.step === 'string' && /^[A-Z]\d{1,6}$/.test(raw.cleared.step) ? raw.cleared.step : null, log: logPathOf(raw.cleared.log) } : null
  const clearNote = noteOf(raw.clearNote)
  const latest = Math.max(done?.at ?? -Infinity, note?.at ?? -Infinity)
  // B547: the last clear whatever came after it, so the board can tell a report newer than it (src/clearOwed.mjs).
  const last = cleared === null ? {} : { lastCleared: { at: cleared.at, step: cleared.step } }
  // B547: the mod's word why it did not clear, when it is the newest word: shown, not hidden behind an older clear.
  if (clearNote !== null && clearNote.at >= Math.max(latest, cleared?.at ?? -Infinity)) return { kind: 'not-cleared', ...clearNote, notCleared: clearNote, ...last }
  if (cleared !== null && cleared.at >= latest) return { kind: 'cleared', ...cleared, ...last }
  if (done === null && note === null) return null
  const notCleared = clearNote !== null && clearNote.at >= (cleared?.at ?? -Infinity) ? { notCleared: clearNote } : {}
  return note === null || (done !== null && done.at >= note.at) ? { kind: 'compacted', ...done, ...notCleared, ...last } : { kind: 'skipped', ...note, ...notCleared, ...last }
}

/** A chat log's place in the project's folder as the mod names it (`.claude/chat-logs/...txt`, with /); null for any other. */
function logPathOf(value) {
  if (typeof value !== 'string' || value.length > 300 || !value.startsWith('.claude/chat-logs/') || !value.endsWith('.txt')) return null
  return /^[\w@+ .-]+(?:\/[\w@+ .-]+)*$/.test(value) && !value.split('/').some(part => part === '.' || part === '..') ? value : null
}

/** Clear after each step: the session a card says its chat went on under after a /clear (`movedTo`); null for none. */
export function movedTo(fileText) {
  if (typeof fileText !== 'string' || !fileText.includes('movedTo')) return null
  try {
    const raw = JSON.parse(fileText)
    return typeof raw?.movedTo === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(raw.movedTo) ? raw.movedTo : null
  } catch {
    return null
  }
}

export function parsePlanLine(fileText) {
  let raw
  try {
    raw = JSON.parse(fileText)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null

  const task = raw.task
  const hasTask = task !== null && typeof task === 'object' && typeof task.text === 'string' && task.text.trim() !== ''
  return {
    name: typeof raw.name === 'string' ? raw.name : null,
    role: typeof raw.role === 'string' ? raw.role : null,
    state: typeof raw.state === 'string' ? raw.state : null,
    at: number(raw.at),
    compaction: compactionOf(raw),
    task: hasTask
      ? {
          text: task.text.trim(),
          step: number(task.step),
          steps: number(task.steps),
          names: namesOf(task.names),
          leftMs: number(task.left),
          // B108: the working time the chat still expects for the step it is on, true when the line was written.
          // Absent when it gave none (B107 has the chats give it).
          stepLeftMs: number(task.stepLeft),
          // When the chat named the task. Older plan lines do not have it.
          since: number(task.since),
          isReported: task.isReported === true,
          // The chat sent another chat a note or a question in the middle of its task, and waits for the answer.
          asked: task.asked === true,
        }
      : null,
  }
}
