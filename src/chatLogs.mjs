// Clear after each step (2026-10-23): a worker's conversation is kept on disk when the Workers mod clears it after a
// reported step. The person: "disk space is not a concern. token usage is". So the board writes the log, never the
// model: an exact copy of the transcript (`.jsonl`) and a readable text beside it (`.txt`), each message with its
// time and speaker, all text, every tool call with its full input and every tool result in full, in
// `<project>\.claude\chat-logs\<chat>\<YYYY-MM-DD HHmm> <step>.txt`.
//
// Transcripts grow to hundreds of MB: they are copied by the system and read line by line, never whole. The old
// transcript stays on disk after a /clear, so the copy may finish after the clear; a small journal
// (`data/chat-logs.json`) names each log not finished yet, and the board finishes it after a restart. Once copied,
// nothing here needs Claude Code to keep the old transcript.

import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'

import { writeAtomic } from './write.mjs'

/** Where the logs go, in the project's folder. */
export const LOGS_FOLDER = '.claude/chat-logs'
const SESSION_ID = /^[A-Za-z0-9_-]{1,120}$/
const STEP_ID = /^[A-Z]\d{1,6}$/
/** A log not finished after this many tries is given up (its transcript gone, a disk that refuses). */
const MOST_TRIES = 3
/** The journal names at most this many logs: more is a fault elsewhere, never a reason to grow without end. */
const MOST_JOBS = 200

const two = value => String(value).padStart(2, '0')

/** A chat's name as a folder name: only letters, digits and `@+ .-` stay (the board's file viewer opens those). */
export const logFolderName = chat => String(chat ?? '').replace(/[^\w@+ .-]+/g, '-').replace(/^[. -]+|[. -]+$/g, '').slice(0, 80) || 'chat'

/** A log's name without its ending: the local date and time to the minute, and the step: `2026-10-23 1405 B482`. */
export function logBase(ms, step) {
  const at = new Date(ms)
  const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}${two(at.getMinutes())}`
  return `${stamp} ${typeof step === 'string' && STEP_ID.test(step) ? step : 'no step'}`
}

/** A time as the log writes it, in the PC's own time: `2026-10-23 14:05:12`. */
export function logTime(ms) {
  if (!Number.isFinite(ms)) return 'time not known'
  const at = new Date(ms)
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
}

const blocksOf = content => (typeof content === 'string' ? [{ type: 'text', text: content }]
  : Array.isArray(content) ? content.filter(block => block !== null && typeof block === 'object') : [])

/** A picture in a message, named instead of its data: the raw copy beside the log holds the data. */
function pictureText(block) {
  const data = typeof block.source?.data === 'string' ? block.source.data.length : 0
  return `[a picture${typeof block.source?.media_type === 'string' ? `, ${block.source.media_type}` : ''}${data > 0 ? `, ${Math.round((data * 3) / 4 / 1024)} KB` : ''}: in the .jsonl beside this log]`
}

/** What a tool answered, in full: its text, a picture named. */
function resultText(content) {
  if (typeof content === 'string') return content
  return blocksOf(content).map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text
    : block.type === 'image' ? pictureText(block) : JSON.stringify(block, null, 2))).join('\n')
}

/** The words of a message from another chat, and who it names as its sender. */
function crossSession(text) {
  const found = text.match(/<cross-session-message\b([^>]*)>([\s\S]*?)(?:<\/cross-session-message>|$)/)
  if (found === null) return null
  return { from: found[1].match(/\bname="([^"]*)"/)?.[1] ?? found[1].match(/\bfrom="([^"]*)"/)?.[1] ?? null, body: found[2].trim() }
}

/** A slash command's line, as the person would have typed it: `/compact <its words>`. */
function commandLine(text) {
  const name = text.match(/<command-name>([^<]*)<\/command-name>/)?.[1]?.trim()
  if (name === undefined) return null
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? ''
  return `${name.startsWith('/') ? name : `/${name}`}${args === '' ? '' : ` ${args}`}`
}

/** Who wrote a message that is no tool result and no answer of the chat, and its words. */
function userSpeaker(entry, text) {
  const origin = entry.origin !== null && typeof entry.origin === 'object' ? entry.origin : null
  if (entry.isCompactSummary === true) return { who: 'Summary of the conversation before (compaction)', text }
  const peer = crossSession(text)
  if (peer !== null || origin?.kind === 'peer') {
    const name = (typeof origin?.name === 'string' ? origin.name : null) ?? peer?.from ?? 'another chat'
    return { who: `Message from ${name}`, text: typeof origin?.body === 'string' ? origin.body : peer?.body ?? text }
  }
  if (origin?.kind === 'task-notification' || text.trimStart().startsWith('<task-notification>')) return { who: 'Background notice', text }
  if (text.trimStart().startsWith('<agent-message')) return { who: 'A subagent\'s report', text }
  const command = commandLine(text)
  if (command !== null) return { who: 'Slash command', text: command }
  const output = text.match(/^\s*<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>\s*$/)?.[1]
  if (output !== undefined) return { who: 'Command output', text: output.trim() }
  if (/^\s*<local-command-caveat>/.test(text)) return null
  if (origin?.kind === 'plugin' && origin.asUser === true) {
    return { who: /\((?:typed|answered) on the worker board\b/.test(text) ? 'The person, on the worker board' : 'The worker board', text }
  }
  if (entry.isMeta === true) return { who: 'App note', text }
  if (origin === null || origin.kind === 'human') return { who: 'The person', text }
  if (origin.kind === 'plugin') return { who: typeof origin.name === 'string' ? `Mod ${origin.name}` : 'A mod', text }
  return { who: `${String(origin.kind)}`, text }
}

/** One message as the log writes it: its time, its speaker, then its words. */
const said = (at, who, text) => `[${logTime(at)}] ${who}:\n${String(text).replace(/\s+$/, '')}\n\n`

/**
 * One line of a transcript as the log writes it ('' for a line of the app's own bookkeeping). `ctx`: `chat`, the
 * name the chat's answers go under, and `tools`, the names of the tool calls so far by their id (filled here).
 */
export function entryText(line, ctx) {
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    return `[a line of the transcript that could not be read: ${line.length} characters; the last line may have been cut off while it was written]\n\n`
  }
  if (entry === null || typeof entry !== 'object') return ''
  const at = Date.parse(entry.timestamp)
  const side = entry.isSidechain === true ? '(subagent) ' : ''
  if (entry.type === 'system') {
    if (entry.subtype === 'compact_boundary') return `[${logTime(at)}] --- the conversation was compacted here (${entry.compactMetadata?.trigger ?? 'how not known'}) ---\n\n`
    return typeof entry.content === 'string' && entry.content.trim() !== '' && entry.subtype !== 'stop_hook_summary' ? said(at, 'App', entry.content) : ''
  }
  if (entry.type === 'summary' && typeof entry.summary === 'string') return said(at, 'Summary', entry.summary)
  if (entry.type === 'attachment') {
    const held = entry.attachment
    if (held?.type === 'queued_command' && typeof held.prompt === 'string') {
      const speaker = userSpeaker({ origin: held.origin ?? null, isMeta: false }, held.prompt)
      return speaker === null ? '' : said(at, `${side}${speaker.who} (arrived during the turn)`, speaker.text)
    }
    if (held?.type === 'hook_additional_context' && Array.isArray(held.content)) {
      const words = held.content.filter(one => typeof one === 'string' && one.trim() !== '').join('\n\n')
      return words === '' ? '' : said(at, `${side}Context from a hook`, words)
    }
    return ''
  }
  if (entry.type !== 'user' && entry.type !== 'assistant') return ''
  const blocks = blocksOf(entry.message?.content)
  const parts = []
  if (entry.type === 'assistant') {
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') parts.push(said(at, `${side}${ctx.chat}`, block.text))
      else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim() !== '') parts.push(said(at, `${side}${ctx.chat} (thinking)`, block.thinking))
      else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        const name = typeof block.name === 'string' ? block.name : 'a tool'
        if (typeof block.id === 'string') ctx.tools.set(block.id, name)
        parts.push(said(at, `${side}${ctx.chat} calls ${name}`, JSON.stringify(block.input ?? {}, null, 2)))
      } else if (block.type !== 'text' && block.type !== 'thinking' && block.type !== 'redacted_thinking') {
        parts.push(said(at, `${side}${ctx.chat} (${String(block.type)})`, JSON.stringify(block, null, 2)))
      }
    }
    return parts.join('')
  }
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      const name = ctx.tools.get(block.tool_use_id) ?? 'a tool'
      parts.push(said(at, `${side}Result of ${name}${block.is_error === true ? ' (an error)' : ''}`, resultText(block.content)))
    } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      const speaker = userSpeaker(entry, block.text)
      if (speaker !== null) parts.push(said(at, `${side}${speaker.who}`, speaker.text))
    } else if (block.type === 'image') parts.push(said(at, `${side}${userSpeaker(entry, '')?.who ?? 'The person'}`, pictureText(block)))
  }
  return parts.join('')
}

/**
 * Writes the text log of a transcript, read line by line: to `<txt>.part`, put in place once whole. `about`:
 * `chat`, `session`, `step`, `at` (when the clear was asked).
 */
export async function writeTextLog(jsonl, txt, about) {
  const part = `${txt}.part`
  const ctx = { chat: about.chat, tools: new Map() }
  const head = `The conversation of ${about.chat} (session ${about.session}), saved ${logTime(about.at)} when it was cleared after ${typeof about.step === 'string' && STEP_ID.test(about.step) ? `its reported step ${about.step}` : 'a step'}.\n`
    + 'Every message with its time and speaker, every tool call with its input and every tool result in full. '
    + `The exact transcript is beside it: ${txt.replace(/\.txt$/, '.jsonl').split(/[\\/]/).at(-1)}.\n\n`
  const lines = createInterface({ input: createReadStream(jsonl, { encoding: 'utf8' }), crlfDelay: Infinity })
  await pipeline(async function* () {
    yield head
    for await (const line of lines) {
      if (line.trim() === '') continue
      const text = entryText(line, ctx)
      if (text !== '') yield text
    }
  }, createWriteStream(part, { encoding: 'utf8' }))
  await rename(part, txt)
}

const exists = path => stat(path).then(() => true, () => false)

/** A job of the journal as it was read: only one with every field it needs is kept. */
const isJob = job => job !== null && typeof job === 'object' && ['copy', 'text'].includes(job.state)
  && ['id', 'chat', 'session', 'source', 'jsonl', 'txt', 'log'].every(key => typeof job[key] === 'string' && job[key] !== '') && Number.isFinite(job.at)

/**
 * The board's keeper of the chat logs. `file` is the journal, `project` the project's folder, `transcripts` the
 * folder of the app's transcripts. `save({ chat, session, step })` puts a log in the journal and starts it (the copy
 * runs on after the answer); `resume()` starts every log the journal names (at the board's start); `idle()` waits
 * until the logs started are written; `failed` hears a log given up.
 */
export function chatLogKeeper({ file, project, transcripts, clock = Date.now, failed = () => {} }) {
  let jobs = null
  let queue = Promise.resolve()
  let journal = Promise.resolve()

  const load = async () => {
    if (jobs !== null) return jobs
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'))
      jobs = (Array.isArray(raw?.jobs) ? raw.jobs : []).filter(isJob)
    } catch {
      // No journal yet, or a torn one: nothing is unfinished that it can name.
      jobs ??= []
    }
    return jobs
  }
  /** The journal as it is now, written one write after the other. */
  const keep = () => {
    const text = `${JSON.stringify({ jobs: jobs ?? [] }, null, 2)}\n`
    const write = journal.catch(() => {}).then(async () => {
      await mkdir(dirname(file), { recursive: true })
      await writeAtomic(file, text)
    })
    journal = write.catch(() => {})
    return write
  }

  async function work(job) {
    try {
      if (job.state === 'copy') {
        await mkdir(dirname(job.jsonl), { recursive: true })
        // The system copies the file: the board never holds it.
        await copyFile(job.source, `${job.jsonl}.part`)
        await rename(`${job.jsonl}.part`, job.jsonl)
        job.state = 'text'
        await keep()
      }
      // From here on only the copy is read: the app may delete the old transcript.
      await writeTextLog(job.jsonl, job.txt, job)
      jobs = (jobs ?? []).filter(one => one !== job)
      await keep()
    } catch (error) {
      job.tries = (job.tries ?? 0) + 1
      job.why = String(error?.code ?? error?.message ?? error).slice(0, 200)
      // A transcript that is gone before it was copied cannot be copied later.
      const isGone = job.state === 'copy' && !(await exists(job.source))
      if (isGone || job.tries >= MOST_TRIES) {
        jobs = (jobs ?? []).filter(one => one !== job)
        failed(job, error)
      }
      await keep().catch(() => {})
      await rm(`${job.jsonl}.part`, { force: true }).catch(() => {})
      await rm(`${job.txt}.part`, { force: true }).catch(() => {})
    }
  }
  const run = job => {
    queue = queue.then(() => work(job), () => work(job))
    return queue
  }

  /** A free name for a new log of `chat`: `<base>`, else `<base>-2`, ... */
  async function freeName(folder, base) {
    const known = new Set((jobs ?? []).map(one => one.txt))
    for (let n = 1; n < 100; n += 1) {
      const name = n === 1 ? base : `${base}-${n}`
      const txt = join(folder, `${name}.txt`)
      if (!known.has(txt) && !(await exists(txt)) && !(await exists(join(folder, `${name}.jsonl`)))) return name
    }
    return `${base}-${clock()}`
  }

  /**
   * One log to keep: `{ ok, result: { text, log, file, jsonl } }`, `log` the path in the project as the board's file
   * viewer opens it, `file` and `jsonl` the full paths; or `{ ok: false, status, why }`. The answer comes once the
   * journal names it: the copy goes on after it.
   */
  async function save({ chat, session, step }) {
    if (typeof chat !== 'string' || chat.trim() === '') return { ok: false, status: 400, why: 'Name the chat.' }
    if (typeof session !== 'string' || !SESSION_ID.test(session)) return { ok: false, status: 400, why: 'Name the session.' }
    if (typeof project !== 'string' || project === '' || typeof transcripts !== 'string' || transcripts === '') return { ok: false, status: 503, why: 'This board keeps no chat logs: it knows no project or transcripts folder.' }
    const source = join(transcripts, `${session}.jsonl`)
    if (!(await exists(source))) return { ok: false, status: 404, why: `No transcript of this session (${session}): nothing to keep.` }
    await load()
    if (jobs.length >= MOST_JOBS) return { ok: false, status: 503, why: 'Too many chat logs wait to be written: none is taken now.' }
    const at = clock()
    const folderName = logFolderName(chat)
    const folder = join(project, ...LOGS_FOLDER.split('/'), folderName)
    const name = await freeName(folder, logBase(at, step))
    const job = {
      id: `${session}-${at}`, chat: chat.trim(), session, step: typeof step === 'string' && STEP_ID.test(step) ? step : null, at, state: 'copy', source,
      jsonl: join(folder, `${name}.jsonl`), txt: join(folder, `${name}.txt`), log: `${LOGS_FOLDER}/${folderName}/${name}.txt`,
    }
    jobs.push(job)
    try {
      await keep()
    } catch (error) {
      jobs = jobs.filter(one => one !== job)
      return { ok: false, status: 500, why: `The journal of the chat logs could not be written (${String(error?.code ?? error?.message ?? error).slice(0, 80)}).` }
    }
    void run(job)
    return { ok: true, result: { text: `Saving the conversation to ${job.txt}.`, log: job.log, file: job.txt, jsonl: job.jsonl } }
  }

  /** Starts every log the journal names: the board was stopped before they were written. */
  async function resume() {
    for (const job of [...await load()]) void run(job)
    return queue
  }

  return { save, resume, idle: async () => { await queue; await journal }, pending: async () => (await load()).map(job => ({ ...job })) }
}
