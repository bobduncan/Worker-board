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
const TASK_MARKS = ['cross-session-message', '"SendMessage"', '"kind":"human"', '"kind":"plugin"', '"stop_reason":"end_turn"']
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

function blocksOf(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.filter(block => block !== null && typeof block === 'object')
}

/** The user and assistant entries of a tail, in the file's order. Lines that do not parse are skipped. */
export function parseTail(text, isCut) {
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
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    const message = entry.message
    if (message === null || typeof message !== 'object') continue
    const at = Date.parse(entry.timestamp)
    entries.push({
      type: entry.type,
      at: Number.isNaN(at) ? null : at,
      isMeta: entry.isMeta === true,
      isSidechain: entry.isSidechain === true,
      isCompactSummary: entry.isCompactSummary === true,
      origin: entry.origin !== null && typeof entry.origin === 'object' ? entry.origin : null,
      stopReason: typeof message.stop_reason === 'string' ? message.stop_reason : null,
      blocks: blocksOf(message.content),
    })
  }
  return entries
}

const textOf = entry =>
  entry.blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')

const hasToolResult = entry => entry.blocks.some(block => block.type === 'tool_result')

const lastToolUse = entry => entry.blocks.findLast(block => block.type === 'tool_use') ?? null

/** What a slash command leaves in the transcript. It starts no turn. */
const isCommandText = value => /^\s*<(local-command-[a-z]+|command-name|command-message)>/.test(value)

/**
 * Whether a turn is running, judged from the last entry that says something about it: `running`, `asking` (it
 * waits for an answer in its own chat), `ended`, or `unknown` when the tail has nothing to go by.
 */
export function turnState(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.isSidechain) continue
    if (entry.type === 'assistant') {
      if (entry.stopReason !== null && entry.stopReason !== 'tool_use') return 'ended'
      const call = lastToolUse(entry)
      return call !== null && ASKING_TOOLS.has(call.name) ? 'asking' : 'running'
    }
    if (hasToolResult(entry)) return 'running'
    const value = textOf(entry)
    if (value.startsWith('[Request interrupted')) return 'ended'
    // Typed by the person, sent by another chat, or raised by the app: each starts a turn.
    if (entry.origin !== null) return 'running'
    if (entry.isMeta || entry.isCompactSummary || isCommandText(value)) continue
    return 'running'
  }
  return 'unknown'
}

const baseName = path => String(path).split(/[\\/]/).filter(part => part !== '').pop() ?? ''

/** What the chat is doing right now: what its last tool call says it is for, else the tool's name. */
export function doingNow(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.type !== 'assistant' || entry.isSidechain) continue
    const call = lastToolUse(entry)
    if (call === null) continue
    const input = call.input !== null && typeof call.input === 'object' ? call.input : {}
    if (typeof input.description === 'string' && input.description.trim() !== '') return input.description.trim()
    const name = typeof call.name === 'string' ? call.name.replace(/^mcp__/, '').replace(/__/g, ': ') : 'a tool'
    return typeof input.file_path === 'string' ? `${name} ${baseName(input.file_path)}` : name
  }
  return null
}

/** The inside of the tag a message from another chat is wrapped in, with who it says it is from. */
function crossSession(value) {
  const found = value.match(/<cross-session-message\b([^>]*)>([\s\S]*?)(?:<\/cross-session-message>|$)/)
  if (found === null) return null
  return { from: found[1].match(/\bfrom="([^"]*)"/)?.[1] ?? null, body: found[2].trim() }
}

/** A message another chat sent, or null. A helper's own report back (a subagent) is not one. */
function peerMessage(entry) {
  if (entry.type !== 'user' || entry.isSidechain) return null
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

function titleOf(body) {
  const first = body.split('\n').map(part => part.trim()).find(part => part !== '') ?? ''
  const plain = first.replace(/^Task from [^:]{1,60}:\s*/i, '')
  const sentence = plain.match(/^(.+?)[.!?](\s|$)/)?.[1] ?? plain
  const short = sentence.length > TITLE_CHARS ? `${sentence.slice(0, TITLE_CHARS - 1).trimEnd()}…` : sentence
  return short.charAt(0).toUpperCase() + short.slice(1)
}

const isReportTo = (entry, title) =>
  entry.type === 'assistant'
  && entry.blocks.some(block => block.type === 'tool_use' && block.name === 'SendMessage' && block.input?.to === title)

/**
 * When the current task started: the newest message from another chat, unless the chat has reported to the main
 * chat since (then that task is finished). Its first line gives a title when the chat's plan line has none.
 */
export function taskStart(entries, { mainTitle }) {
  let start = null
  for (const entry of entries) {
    const message = peerMessage(entry)
    if (message !== null) start = { at: entry.at, from: message.from, title: titleOf(message.body) }
    else if (start !== null && isReportTo(entry, mainTitle)) start = null
  }
  return start
}

/** When the chat last reported to the main chat, or null. */
export function lastReport(entries, { mainTitle }) {
  return entries.findLast(entry => isReportTo(entry, mainTitle))?.at ?? null
}

/**
 * What started the turn that is running, for a chat that named no task: the first thing typed by the person or
 * sent by another chat since the last turn ended. `isSure` is false when the tail does not reach back to the end
 * of the turn before, so the entry may be something said in the middle of a longer turn.
 */
export function turnStart(entries, { prefix = '' } = {}) {
  let opening = null
  let hasEnd = false
  for (const entry of entries) {
    if (entry.isSidechain) continue
    if (entry.type === 'assistant') {
      if (entry.stopReason !== null && entry.stopReason !== 'tool_use') {
        opening = null
        hasEnd = true
      }
      continue
    }
    if (opening !== null || hasToolResult(entry)) continue
    const peer = peerMessage(entry)
    if (peer !== null) {
      const from = typeof peer.from === 'string' && !peer.from.startsWith('local_') ? peer.from : 'Another chat'
      opening = { at: entry.at, by: from.startsWith(prefix) ? from.slice(prefix.length) : from, title: titleOf(peer.body), isSure: hasEnd }
      continue
    }
    const origin = entry.origin
    const isTyped = origin === null
      ? !entry.isMeta && !entry.isCompactSummary && !isCommandText(textOf(entry))
      : origin.kind === 'human' || (origin.kind === 'plugin' && origin.asUser === true)
    const value = isTyped ? typedText(entry) : ''
    if (value !== '') opening = { at: entry.at, by: 'you', title: titleOf(value), isSure: hasEnd }
  }
  return opening
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
 * The main chat as the dock shows it: what the person typed, the answer that ended each turn, and reports from
 * other chats. Tool calls, their results, slash commands and the app's own notes are left out.
 */
export function mainChat(entries, { prefix = '', titles = new Map(), limit = 30 } = {}) {
  const messages = []
  const add = (entry, from, who, value, via = null) => {
    if (value.trim() !== '') messages.push({ at: entry.at, from, who, via, text: value.trim() })
  }
  const short = title => (title.startsWith(prefix) ? title.slice(prefix.length) : title)

  for (const entry of entries) {
    if (entry.isSidechain) continue
    if (entry.type === 'assistant') {
      if (entry.stopReason !== null && entry.stopReason !== 'tool_use') add(entry, 'main', 'Main', textOf(entry))
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
