// Source 3: a chat's transcript, one JSON object per line. The files are large, so only the tail is read. What is
// read here is private: it goes to the page and nowhere else, never to the console or a log.

import { open } from 'node:fs/promises'

const TAIL_BYTES = 1024 * 1024
/** Tools that stop a turn until the person answers in the chat. */
const ASKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const TITLE_CHARS = 120

/** The last bytes of a file, whether its first line is cut, and when the file last changed. */
async function readPiece(path, maxBytes) {
  let file
  try {
    file = await open(path, 'r')
    const { size, mtimeMs } = await file.stat()
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    await file.read(buffer, 0, length, size - length)
    return { buffer, isCut: size > length, modifiedAt: mtimeMs }
  } catch {
    return null
  } finally {
    await file?.close().catch(() => {})
  }
}

/** The last piece of a file: its text, whether its first line is cut, and when the file last changed. */
export async function readTail(path, maxBytes = TAIL_BYTES) {
  const piece = await readPiece(path, maxBytes)
  return piece === null ? null : { text: piece.buffer.toString('utf8'), isCut: piece.isCut, modifiedAt: piece.modifiedAt }
}

/**
 * What a line must hold to matter for a task: a message from another chat, a message sent to one, something the
 * person typed, or the end of a turn.
 */
const TASK_MARKS = [
  'cross-session-message', '"SendMessage"', '"kind":"human"', '"kind":"plugin"', '"stop_reason":"end_turn"',
  '[Request interrupted', '"subtype":"compact_boundary"',
]
const DEEP_BYTES = 24 * 1024 * 1024
const NEWLINE = 10

/**
 * The lines of a large piece of transcript that hold one of the marks, in the file's order. The marks are looked
 * for in the bytes, so only the few lines found are ever turned into text.
 */
export function markedIn(buffer, isCut, marks = TASK_MARKS) {
  const from = isCut ? buffer.indexOf(NEWLINE) + 1 : 0
  if (isCut && from === 0) return ''
  const starts = new Set()
  for (const mark of marks) {
    let at = buffer.indexOf(mark, from)
    while (at !== -1) {
      starts.add(buffer.lastIndexOf(NEWLINE, at) + 1)
      const end = buffer.indexOf(NEWLINE, at)
      at = end === -1 ? -1 : buffer.indexOf(mark, end + 1)
    }
  }
  return [...starts].sort((a, b) => a - b).map(start => {
    const end = buffer.indexOf(NEWLINE, start)
    return buffer.toString('utf8', start, end === -1 ? buffer.length : end)
  }).join('\n')
}

/**
 * A longer look back than the tail, for a task that started long ago: only the lines that can say when a task
 * started or was reported, so the rest of a large file is never parsed.
 */
export async function readMarked(path, maxBytes = DEEP_BYTES) {
  const piece = await readPiece(path, maxBytes)
  return piece === null ? null : markedIn(piece.buffer, piece.isCut)
}

/**
 * B113: what a line holds where a chat looked the plan's limits up: the app's tool answers with the plan's
 * windows, and a transcript keeps that answer as text inside a line, its quotes escaped.
 */
const USAGE_MARKS = ['\\"windows\\": [', '\\"windows\\":[']

/**
 * Both longer looks back in one read of the file: the lines for a task (`tasks`, as `readMarked` gives them) and
 * the lines where the chat looked its limits up (`usage`). Null when the file cannot be read.
 */
export async function readDeep(path, maxBytes = DEEP_BYTES) {
  const piece = await readPiece(path, maxBytes)
  return piece === null ? null : { tasks: markedIn(piece.buffer, piece.isCut), usage: markedIn(piece.buffer, piece.isCut, USAGE_MARKS) }
}

function blocksOf(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.filter(block => block !== null && typeof block === 'object')
}

const count = value => (Number.isFinite(value) && value > 0 ? value : 0)
/** B468: an answer's tokens as the app writes them: `{ input, cacheWrite, cacheRead, output }`, or null without any. */
function usageOf(usage, strict = false) {
  if (usage === null || typeof usage !== 'object') return null
  const read = strict ? value => Number.isFinite(value) && value >= 0 ? value : null : count
  return { input: read(usage.input_tokens), cacheWrite: read(usage.cache_creation_input_tokens), cacheRead: read(usage.cache_read_input_tokens), output: read(usage.output_tokens) }
}

/**
 * The user and assistant entries of a tail, in the file's order, the messages of other chats that arrived in the
 * middle of a turn (`type: 'queued'`), and B262 the app's marks of a compaction (`type: 'compaction'`, with its
 * `trigger`: `manual` for a /compact, `auto` when the app compacted by itself). Lines that do not parse are skipped.
 */
export function parseTail(text, isCut, strictUsage = false) {
  const lines = text.split('\n')
  if (isCut) lines.shift()
  const entries = []
  for (const raw of lines) {
    if (raw.trim() === '') continue
    let entry
    try {
      entry = JSON.parse(raw)
    } catch {
      continue
    }
    if (entry === null || typeof entry !== 'object') continue
    const at = Date.parse(entry.timestamp)
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      const trigger = entry.compactMetadata?.trigger
      entries.push({
        type: 'compaction', at: Number.isNaN(at) ? null : at, isMeta: true, isSidechain: entry.isSidechain === true,
        isCompactSummary: false, origin: null, stopReason: null, trigger: typeof trigger === 'string' ? trigger : null, blocks: [],
      })
      continue
    }
    if (entry.type === 'attachment') {
      // A message from another chat that arrives while a turn runs is no user entry: the app keeps it with the
      // turn, as a queued command. It opens no turn and ends none, but it can hand over a task (`queued`).
      // B310: so does the report of a helper or command sent to the background that arrives while a turn runs.
      const held = entry.attachment
      if (held === null || typeof held !== 'object' || held.type !== 'queued_command' || typeof held.prompt !== 'string') continue
      if (held.origin === null || typeof held.origin !== 'object' || !['peer', 'task-notification'].includes(held.origin.kind)) continue
      entries.push({
        type: 'queued', at: Number.isNaN(at) ? null : at, isMeta: true, isSidechain: entry.isSidechain === true,
        isCompactSummary: false, origin: held.origin, stopReason: null, blocks: blocksOf(held.prompt),
      })
      continue
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    const message = entry.message
    if (message === null || typeof message !== 'object') continue
    entries.push({
      type: entry.type,
      at: Number.isNaN(at) ? null : at,
      isMeta: entry.isMeta === true,
      isSidechain: entry.isSidechain === true,
      isCompactSummary: entry.isCompactSummary === true,
      origin: entry.origin !== null && typeof entry.origin === 'object' ? entry.origin : null,
      stopReason: typeof message.stop_reason === 'string' ? message.stop_reason : null,
      // What the app says went wrong where it wrote the entry itself: `rate_limit` when the chat ran into a limit.
      error: typeof entry.error === 'string' ? entry.error : null,
      // B352: what an answer ran on: its model, and the effort the app writes beside it.
      model: entry.type === 'assistant' && typeof message.model === 'string' ? message.model : null,
      effort: entry.type === 'assistant' && typeof entry.effort === 'string' ? entry.effort : null,
      // B468: what an answer cost, and its message's id: the app writes a message's tokens on each of its lines.
      messageId: entry.type === 'assistant' && typeof message.id === 'string' ? message.id : null,
      usage: entry.type === 'assistant' ? usageOf(message.usage, strictUsage) : null,
      blocks: blocksOf(message.content),
    })
  }
  return entries
}

export const textOf = entry =>
  entry.blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')

export const hasToolResult = entry => entry.blocks.some(block => block.type === 'tool_result')

const lastToolUse = entry => entry.blocks.findLast(block => block.type === 'tool_use') ?? null

/** What a slash command leaves in the transcript. It starts no turn. */
export const isCommandText = value => /^\s*<(local-command-[a-z]+|command-name|command-message)>/.test(value)

/** B247: what a slash command leaves, with a compaction's summary: it opens no turn, also when a mod ran it. */
export const isCommandEntry = entry => entry.isCompactSummary || isCommandText(textOf(entry))

/**
 * The last entry that says something about the turn: what it says (`turn`), when it was written (`at`), and how a
 * turn that ended there ended (`how`: `answer`, `stopped`, `compaction`), or `result` for a tool's answer.
 */
function lastWord(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.isSidechain || entry.type === 'queued') continue
    const word = (turn, how = null) => ({ turn, at: entry.at, how })
    // B262: a compaction ends the turn before it. A /compact runs only between two turns (the Workers mod's after
    // a report); when the app compacts in the middle of a turn, the turn goes on at once after it. After a /compact
    // the app writes an older stretch of the chat again just before its mark: what stands before it is not now.
    if (entry.type === 'compaction') return word('ended', 'compaction')
    if (entry.type === 'assistant') {
      if (entry.stopReason !== null && entry.stopReason !== 'tool_use') return word('ended', 'answer')
      const call = lastToolUse(entry)
      return word(call !== null && ASKING_TOOLS.has(call.name) ? 'asking' : 'running')
    }
    if (hasToolResult(entry)) return word('running', 'result')
    const value = textOf(entry)
    if (value.startsWith('[Request interrupted')) return word('ended', 'stopped')
    if (entry.isCompactSummary) return word('ended', 'compaction')
    // B247: a slash command opens no turn, also one a mod ran (the Workers mod's /compact after a report).
    if (isCommandText(value)) continue
    // Typed by the person, sent by another chat, or raised by the app: each starts a turn.
    if (entry.origin !== null) return word('running')
    if (entry.isMeta) continue
    return word('running')
  }
  return { turn: 'unknown', at: null, how: null }
}

/**
 * Whether a turn is running, judged from the last entry that says something about it: `running`, `asking` (it
 * waits for an answer in its own chat), `ended`, or `unknown` when the tail has nothing to go by.
 */
export const turnState = entries => lastWord(entries).turn

/**
 * B262: how the last turn ended, as far as the transcript tells: `{ at, how }` with `how` `answer` (its closing
 * answer), `stopped` (the person stopped it), `compaction`, or `silent`: its last entry is a tool's answer, every
 * call has its answer, and nothing came after. A silent turn may still go on (the chat thinks), or have ended
 * without a closing message: the app's own word, or a long quiet, tells which. Null for a turn that runs.
 */
export function turnEnded(entries) {
  const { turn, at, how } = lastWord(entries)
  if (turn === 'ended') return { at, how }
  return how === 'result' && unanswered(entries) === null ? { at, how: 'silent' } : null
}

/** The words of a tool's result, whether it came as text or as blocks. */
export const resultText = block => (typeof block.content === 'string'
  ? block.content
  : blocksOf(block.content).map(part => (typeof part.text === 'string' ? part.text : '')).join('\n'))

/** What the app answers when work is sent to the background: a subagent, or a command. */
const SENT_TO_BACKGROUND = /^(Async agent launched|Command running in background)/

/**
 * How many pieces of background work these entries show as started and not yet reported back: a chat ends its
 * turn while a subagent or a command runs, and the app starts it again when that reports. Counted from what the
 * app itself writes; nothing of the chat's own words is read. B310: a report ends the call it names (its
 * `<tool-use-id>`), also one that arrived in the middle of a turn (a queued entry); a report that names a call not
 * seen here (sent off before the tail began) ends nothing, one that names none ends the oldest.
 */
export function backgroundRunning(entries) {
  const running = []
  for (const entry of entries) {
    if (entry.isSidechain || (entry.type !== 'user' && entry.type !== 'queued')) continue
    for (const block of entry.blocks) {
      if (entry.type === 'user' && block.type === 'tool_result' && SENT_TO_BACKGROUND.test(resultText(block).trimStart())) running.push(block.tool_use_id ?? null)
      else if (block.type === 'text' && typeof block.text === 'string' && block.text.includes('<task-notification>')) {
        const named = block.text.match(/<tool-use-id>\s*([^<\s]+)\s*<\/tool-use-id>/)?.[1] ?? null
        const at = named === null ? 0 : running.indexOf(named)
        if (at >= 0 && running.length > 0) running.splice(at, 1)
      }
    }
  }
  return running.length
}

const baseName = path => String(path).split(/[\\/]/).filter(part => part !== '').pop() ?? ''

/** What a kind of tool call is, in plain words: the first whose pattern fits the tool's name. */
const DOING = [
  [/^(Read|NotebookRead)$/, 'Reading'],
  [/^(Edit|Write|NotebookEdit|MultiEdit)$/, 'Editing'],
  [/^(Grep|Glob|LS)$/, 'Searching the files'],
  [/^(Bash|PowerShell|BashOutput)$/, 'Running a command'],
  [/^(Agent|Task|Workflow)$/, 'Working with a helper'],
  [/^SendMessage$/, 'Writing to another chat'],
  [/^(AskUserQuestion|ExitPlanMode)$/, 'Asking you a question'],
  [/^WebSearch$/, 'Searching the web'],
  [/^WebFetch$/, 'Reading a web page'],
  [/^(Skill|ToolSearch)$/, 'Looking up how to do it'],
  [/^(TodoWrite|TaskCreate|TaskUpdate)$/, 'Updating its to-do list'],
  [/^mcp__(Claude_Browser|claude-in-chrome)__/, 'Working in the browser'],
  [/^mcp__folder-branches__/, 'Recording its task'],
  [/^mcp__backlog__/, 'Updating the backlog'],
  [/^mcp__terminal__/, 'Working in the terminal'],
  [/^mcp__visualize__/, 'Drawing a picture'],
]

/**
 * What the chat is doing right now: what its last tool call says it is for (its description, or the summary a
 * browser action carries), else what that kind of call is in plain words. Never the tool's own name.
 */
export function doingNow(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.type !== 'assistant' || entry.isSidechain) continue
    const call = lastToolUse(entry)
    if (call !== null) return doingOf(call)
  }
  return null
}

/** What one tool call is for, in plain words (see `doingNow`). */
function doingOf(call) {
  const input = call.input !== null && typeof call.input === 'object' ? call.input : {}
  for (const said of [input.description, input.action_summary]) if (typeof said === 'string' && said.trim() !== '') return said.trim()
  const plain = DOING.find(([pattern]) => typeof call.name === 'string' && pattern.test(call.name))?.[1] ?? 'Using a tool'
  if (plain !== 'Reading' && plain !== 'Editing') return plain
  return `${plain} ${typeof input.file_path === 'string' && baseName(input.file_path) !== '' ? baseName(input.file_path) : 'a file'}`
}

/**
 * B247: the oldest tool call of the running turn that has had no answer yet: what it is for (`doing`, as
 * `doingNow` says it) and when it was made (`since`). A chat that waits there writes nothing: the app may wait for
 * the person's approval of that call in the chat, or the tool hangs. Null when every call got its answer, or the
 * turn has ended.
 */
export function unanswered(entries) {
  const open = new Map()
  for (const entry of entries) {
    if (entry.isSidechain || entry.type === 'queued') continue
    // B262: what stands before a compaction is over.
    if (entry.type === 'compaction') open.clear()
    if (entry.type === 'assistant') {
      if (entry.stopReason !== null && entry.stopReason !== 'tool_use') open.clear()
      for (const block of entry.blocks) if (block.type === 'tool_use' && typeof block.id === 'string') open.set(block.id, { call: block, at: entry.at })
      continue
    }
    for (const block of entry.blocks) if (block.type === 'tool_result') open.delete(block.tool_use_id)
  }
  const [first] = open.values()
  return first === undefined ? null : { doing: doingOf(first.call), since: first.at }
}

const WORDS_CHARS = 6000
const QUESTIONS = 6
const short = (value, chars) => (typeof value === 'string' ? value.trim().slice(0, chars) : '')

/**
 * B100: what a chat that waits for the person last said, in its own words: the answer that ended its turn
 * (`words`, the end of it when it is long: the question stands there), or, when it asked with the app's question
 * form, its questions with the options it offers (`questions`), or the plan it asks to have approved (`plan`).
 * Null when the last thing it did is neither. Nothing a person or another chat typed is in it.
 */
export function waitingFor(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.type !== 'assistant' || entry.isSidechain) continue
    const call = lastToolUse(entry)
    const said = textOf(entry).trim()
    const words = said.length > WORDS_CHARS ? `…${said.slice(-WORDS_CHARS)}` : said
    if (call !== null && ASKING_TOOLS.has(call.name)) {
      const input = call.input !== null && typeof call.input === 'object' ? call.input : {}
      const questions = (Array.isArray(input.questions) ? input.questions : [])
        .filter(one => one !== null && typeof one === 'object' && short(one.question, 1) !== '')
        .slice(0, QUESTIONS)
        .map(one => ({
          question: short(one.question, 600),
          options: (Array.isArray(one.options) ? one.options : []).map(option => short(option?.label, 200)).filter(label => label !== '').slice(0, QUESTIONS),
        }))
      return { at: entry.at, words, questions, plan: short(input.plan, WORDS_CHARS) || null }
    }
    if (entry.stopReason === null || entry.stopReason === 'tool_use') return null
    return { at: entry.at, words, questions: [], plan: null }
  }
  return null
}

const CLOSING = '```diff\n'

/**
 * B148: whether the answer that ended the chat's last turn says its work is done. Every chat ends an answer to the
 * person with a closing block (the project's CLAUDE.md, part 3) whose last line is "+ Done:   yes", or
 * "- Done:   no, ..." or "- Done:   partly, ...". Only that block at the very end of the answer counts; a turn
 * that runs, or an answer of the app's own (a stop at the limit), says nothing.
 */
export function saysDone(entries) {
  return isDoneAnswer(entries.findLast(entry => entry.type === 'assistant' && !entry.isSidechain))
}

/**
 * B281: whether the chat finished a task between two moments (both left out): an answer that ended a turn closed with
 * "+ Done:   yes". The person's words after it are a new task, not feedback. B301: a message to another chat ends
 * nothing; a step of the store ends with the chat's `work report`.
 */
export function finishedBetween(entries, from, to) {
  return entries.some(entry => !entry.isSidechain && Number.isFinite(entry.at) && entry.at > from && entry.at < to
    && entry.type === 'assistant' && isDoneAnswer(entry))
}

/** An answer that ended a turn with the closing block's last line "+ Done:   yes". */
function isDoneAnswer(last) {
  return /^\+\s*Done:\s*yes\b/i.test(closingDone(last) ?? '')
}

/** B292: whether the chat's last answer closed with "- Done:   partly" or "- Done:   no": its task is left open. */
export function saysUnfinished(entries) {
  return /^-\s*Done:\s*(?:partly|no)\b/i.test(closingDone(entries.findLast(entry => entry.type === 'assistant' && !entry.isSidechain)) ?? '')
}

/** The last line of the closing block an answer that ended a turn ends with ("+ Done:   yes"), or null. */
function closingDone(last) {
  if (last === undefined || !endsTurn(last) || (last.error ?? null) !== null) return null
  const words = textOf(last).replace(/\r\n/g, '\n').trimEnd()
  const at = words.lastIndexOf(CLOSING)
  if (at === -1 || !words.endsWith('\n```')) return null
  const block = words.slice(at + CLOSING.length, -'\n```'.length)
  if (block.includes('```')) return null
  const lines = block.split('\n').map(line => line.trim()).filter(line => line !== '')
  return lines.at(-1) ?? null
}

/** The inside of the tag a message from another chat is wrapped in, with who it says it is from. */
function crossSession(value) {
  const found = value.match(/<cross-session-message\b([^>]*)>([\s\S]*?)(?:<\/cross-session-message>|$)/)
  if (found === null) return null
  return { from: found[1].match(/\bfrom="([^"]*)"/)?.[1] ?? null, body: found[2].trim() }
}

/** A message another chat sent, or null. A helper's own report back (a subagent) is not one. */
export function peerMessage(entry) {
  if ((entry.type !== 'user' && entry.type !== 'queued') || entry.isSidechain) return null
  const origin = entry.origin
  if (origin !== null && origin.kind !== 'peer') return null
  if (origin !== null && (origin.handback === true || origin.senderTaskId !== undefined)) return null
  const tagged = crossSession(textOf(entry))
  if (tagged === null) return null
  return {
    from: (typeof origin?.name === 'string' ? origin.name : null) ?? tagged.from,
    body: typeof origin?.body === 'string' ? origin.body.trim() : tagged.body,
  }
}

/** A short title from the first line of a message: its first sentence. */
function titleOf(body) {
  const plain = body.split('\n').map(part => part.trim()).find(part => part !== '') ?? ''
  const sentence = plain.match(/^(.+?)[.!?](\s|$)/)?.[1] ?? plain
  const short = sentence.length > TITLE_CHARS ? `${sentence.slice(0, TITLE_CHARS - 1).trimEnd()}…` : sentence
  return short.charAt(0).toUpperCase() + short.slice(1)
}

/**
 * An entry after which no turn is running: the answer that ends it, the app's mark that the person stopped it, or
 * B262 a /compact (it runs only between two turns; the app's own compaction in the middle of a turn ends nothing).
 */
export const endsTurn = entry =>
  entry.type === 'compaction' ? entry.trigger !== 'auto'
    : entry.type === 'assistant'
      ? entry.stopReason !== null && entry.stopReason !== 'tool_use'
      : !hasToolResult(entry) && textOf(entry).startsWith('[Request interrupted')

const ORIGIN_CHARS = 6000

/**
 * B151: what the person typed (also through the board) that gave a chat the task it is on, as it arrived: the newest
 * such words at or before `until`, when the task started as far as the board knows. `{ by: 'you', at, text }`, the
 * text kept to its first 6000 characters; null when the entries hold none. Only for the window the person opens on a
 * working lane: the lane itself names the task as the chat's card does (B82). B301: another chat's message gives no
 * task; a step comes from the work store.
 */
export function taskOrigin(entries, until = Infinity) {
  let found = null
  const keep = (by, entry, text) => {
    if (found === null || entry.at >= found.at) found = { by, at: entry.at, text }
  }
  for (const entry of entries) {
    if (entry.isSidechain || !Number.isFinite(entry.at) || entry.at > until) continue
    if (peerMessage(entry) !== null) continue
    if (entry.type !== 'user' || hasToolResult(entry)) continue
    const origin = entry.origin
    const isTyped = origin === null
      ? !entry.isMeta && !entry.isCompactSummary && !isCommandText(textOf(entry))
      : origin.kind === 'human' || (origin.kind === 'plugin' && origin.asUser === true)
    const words = isTyped ? typedText(entry) : ''
    if (words !== '') keep('you', entry, words)
  }
  if (found === null) return null
  return { ...found, text: found.text.length > ORIGIN_CHARS ? `${found.text.slice(0, ORIGIN_CHARS)}…` : found.text }
}

/**
 * The last thing that opened a turn: the first thing typed by the person, or sent by another chat, since the turn
 * before ended. `isOpen` says no turn has ended since, so it is what the running turn is about. `isSure` is false
 * when the entries do not reach back to the end of the turn before: the entry may then be a remark made in the
 * middle of a longer turn.
 */
export function turnStart(entries, { prefix = '' } = {}) {
  let opening = null
  let isOpen = false
  let hasEnd = false
  for (const entry of entries) {
    // What arrived in the middle of a turn opened none.
    if (entry.isSidechain || entry.type === 'queued') continue
    if (endsTurn(entry)) {
      isOpen = false
      hasEnd = true
      continue
    }
    if (entry.type === 'assistant' || isOpen || hasToolResult(entry) || isCommandEntry(entry)) continue
    const peer = peerMessage(entry)
    if (peer !== null) {
      const from = typeof peer.from === 'string' && !peer.from.startsWith('local_') ? peer.from : 'Another chat'
      opening = { at: entry.at, by: from.startsWith(prefix) ? from.slice(prefix.length) : from, title: titleOf(peer.body), isSure: hasEnd }
      isOpen = true
      continue
    }
    const origin = entry.origin
    const isTyped = origin === null
      ? !entry.isMeta && !entry.isCompactSummary && !isCommandText(textOf(entry))
      : origin.kind === 'human' || (origin.kind === 'plugin' && origin.asUser === true)
    const value = isTyped ? typedText(entry) : ''
    if (value === '') {
      // A turn the chat's own work started (a helper reporting back, a background task that finished) goes on
      // with what the turn before was about.
      if (origin !== null && origin.kind !== 'human' && opening !== null) isOpen = true
      continue
    }
    // A message that starts with a picture is named after its words.
    const words = value.split('\n').filter(line => line.trim() !== '[picture]').join('\n').trim()
    // B281: with the words themselves, for a window that shows the person's feedback the chat is on.
    opening = { at: entry.at, by: 'you', title: words === '' ? 'A picture' : titleOf(words), words, isSure: hasEnd }
    isOpen = true
  }
  return opening === null ? null : { ...opening, isOpen }
}

function typedText(entry) {
  const parts = []
  for (const block of entry.blocks) {
    if (block.type === 'image') parts.push('[picture]')
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    const value = block.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
    // The app's own mark of a stopped turn is not something the person said.
    if (value !== '' && !value.startsWith('[Request interrupted')) parts.push(value)
  }
  return parts.join('\n')
}

/**
 * A chat as the board shows it to talk with: what the person typed (`from: 'you'`), the answer that ended each
 * turn (`from: 'chat'`, under the chat's name `self`), and messages from other chats (`from: 'report'`). Tool
 * calls, their results, slash commands and the app's own notes are left out.
 */
export function conversation(entries, { self = 'Main', prefix = '', titles = new Map(), limit = 30 } = {}) {
  const messages = []
  const add = (entry, from, who, value, via = null) => {
    if (value.trim() !== '') messages.push({ at: entry.at, from, who, via, text: value.trim() })
  }
  const short = title => (title.startsWith(prefix) ? title.slice(prefix.length) : title)

  for (const entry of entries) {
    if (entry.isSidechain || entry.type === 'queued') continue
    if (entry.type === 'assistant') {
      if (entry.stopReason !== null && entry.stopReason !== 'tool_use') add(entry, 'chat', self, textOf(entry))
      continue
    }
    if (hasToolResult(entry)) continue
    const origin = entry.origin
    const peer = peerMessage(entry)
    if (peer !== null) {
      const title = titles.get(peer.from) ?? peer.from
      add(entry, 'report', typeof title === 'string' && !title.startsWith('local_') ? short(title) : 'Another chat', peer.body)
    } else if (origin?.kind === 'human') {
      add(entry, 'you', 'You', typedText(entry))
    } else if (origin?.kind === 'plugin' && origin.asUser === true) {
      add(entry, 'you', 'You', typedText(entry), 'board')
    } else if (origin === null && !entry.isMeta && !entry.isCompactSummary && !isCommandText(textOf(entry))) {
      add(entry, 'you', 'You', typedText(entry))
    }
  }
  return messages.slice(-limit)
}
