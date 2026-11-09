// Reactive board, brief P4a (the person, 2026-11-09: "it tries to react directly to the CHAT instead of code just
// submitting an item in a queue and then waiting for the chat to pick it up"): ONE CLICK IS ONE SERVER ACTION.
//
// Before, the page wrote the person's input (a thread, an ask, a refine answer) with one call and then typed the word to
// the chat with a second call to /api/say; when the second failed, half an action stayed and the person was told to go to
// another part and answer again. Now the page makes ONE call with a click id: the board stores the input and queues the
// word in one action (`oneClick`), the click's record carries the word's id or `not sent: <why>, HH:MM`, a second call
// with the same click id gives the first result and queues no second word, and a "not sent" click is retried by its id
// (`retryClick`): the input is not written twice, only the word is queued again.
//
// Nothing here delivers, wakes or reads a lane: the word is queued by the caller's `say` (the board's own `sayNow`, as
// every word of the page); this file keeps only the click's record (data/clicks.jsonl, merged by click id) and its log
// line in data/actions.jsonl.

import { readFile } from 'node:fs/promises'

import { appendLines } from './write.mjs'

/** A click id: made by the page, kept for that click's retries. */
export const CLICK_ID = /^[A-Za-z0-9_-]{8,64}$/

/** The names the actions log keeps for the person's stop and go of everything: a click of these routes never writes them. */
export const NEVER_VIA = ['pause-all', 'resume-all']

/** The click id of a body: the id, null when there is none, `false` when it is no id. */
export const clickIdOf = body => {
  const click = body?.click
  if (click === undefined || click === null) return null
  return typeof click === 'string' && CLICK_ID.test(click) ? click : false
}

/** HH:MM of a time in ms (the board's own clock, local). */
export const hhmm = at => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const KEEP = 500

/**
 * The records of the clicks, by click id: `{ click, via, key, route, at, say, writeResult, word, notSent, notSentAt }`.
 * `word` is the id of the queued word; `notSent` the reason it was not queued (`notSentAt` the minute, HH:MM); `say` the
 * body the retry types again; `key` what the click's card is about (a thread path, a goal, a step); `route` the
 * page's route a retry goes to. Kept in `file` (one JSON line each, the last line of a click wins); `file` null keeps
 * them in memory only (a board that writes nothing).
 */
export function clickLedger({ file = null, append = appendLines, read = path => readFile(path, 'utf8') } = {}) {
  const records = new Map()
  const inflight = new Map()
  let loaded = file === null
  const load = async () => {
    if (loaded) return
    loaded = true
    let text = ''
    try {
      text = await read(file)
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error(`The clicks record could not be read (${error?.code ?? error?.message ?? 'unknown'}).`)
    }
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === '') continue
      try {
        const one = JSON.parse(line)
        if (typeof one?.click === 'string') records.set(one.click, one)
      } catch {
        // A torn line is skipped.
      }
    }
    while (records.size > KEEP) records.delete(records.keys().next().value)
  }
  return {
    load,
    get: async click => {
      await load()
      return records.get(click) ?? null
    },
    put: async record => {
      await load()
      records.delete(record.click)
      records.set(record.click, record)
      while (records.size > KEEP) records.delete(records.keys().next().value)
      if (file !== null) {
        try {
          await append(file, `${JSON.stringify(record)}\n`)
        } catch (error) {
          console.error(`The clicks record could not be written (${error?.code ?? error?.message ?? 'unknown'}).`)
        }
      }
    },
    /** The clicks whose word was not queued, newest last: `{ click, via, key, route, why, at }` for the cards' Retry. */
    unsent: async () => {
      await load()
      return [...records.values()].filter(one => typeof one.notSent === 'string').map(one => ({ click: one.click, via: one.via, key: one.key ?? null, route: one.route ?? null, why: one.notSent, at: one.notSentAt ?? null }))
    },
    /** Only one call of a click runs at a time: a double click waits for the first. */
    once: (click, run) => {
      const running = inflight.get(click)
      if (running !== undefined) return running
      const made = run().finally(() => inflight.delete(click))
      inflight.set(click, made)
      return made
    },
  }
}

/** What a failed `say` is told as, one plain line. */
const whyOf = said => String(said?.why ?? said?.message ?? 'the word could not be queued').replace(/\s+/g, ' ').trim().slice(0, 300)

/**
 * ONE ACTION: the person's input and its word. `write()` stores the input, answering `{ ok, result }` or a refusal (then
 * nothing is recorded: the click id is free for another try); `sayBody(result)` is the body of the word (made from what
 * was written; its `to` may be null: `say(body, toRole)` finds the chat then, so a word whose chat was not on the board is
 * queued by the retry once it is); `say(body, toRole)` queues it (the board's `sayNow`), answering `{ ok, message, result? }` or a refusal, and may
 * throw. `log(entry)` writes the click's one line to the actions log.
 *
 *  - a click id seen with its word: the first result again, nothing written, nothing queued (`again: true`);
 *  - a click id seen with `notSent`: the retry: the input stands and is not written again, the word is queued once more;
 *  - a new click id: the input is written, the word queued, the record kept either way.
 *
 * Answers `{ ok: true, result }`: `result` is the write's result with `click`, and `said` (the word's id) or `notSent`
 * and `notSentAt`; a refused write answers its refusal.
 */
export function oneClick({ ledger, click, via, action = null, key = null, route = null, toRole = 'talk', now, write, sayBody, say, log = null }) {
  if (NEVER_VIA.includes(via)) throw new Error(`A click never logs as ${via}.`)
  return ledger.once(click, async () => {
    const before = await ledger.get(click)
    if (before !== null && typeof before.word === 'string') return { ok: true, result: { ...(before.writeResult ?? {}), click, said: before.word, again: true, ...(before.paste === undefined ? {} : { paste: before.paste }) } }
    let writeResult = before?.writeResult ?? null
    let body = before?.say ?? null
    if (before === null) {
      const done = await write()
      if (!done.ok) return done
      writeResult = done.result ?? {}
      body = await sayBody(writeResult)
    }
    const at = now()
    const keyOf = typeof key === 'function' ? key(writeResult) : key
    let said
    try {
      said = body === null ? { ok: false, why: 'there is no word for it' } : await say(body, before?.toRole ?? toRole)
    } catch (error) {
      said = { ok: false, why: error?.message ?? 'the queue failed' }
    }
    const id = said.ok ? said.message?.id ?? said.result?.said ?? null : null
    const record = { click, via, key: keyOf, route, toRole: before?.toRole ?? toRole, at, say: body, writeResult, ...(said.ok ? { word: id ?? 'queued', ...(said.message?.paste === undefined ? {} : { paste: said.message.paste }) } : { notSent: whyOf(said), notSentAt: hhmm(at) }) }
    await ledger.put(record)
    if (before === null && log !== null) await log({ via, action: action ?? via, id: keyOf, click })
    return { ok: true, result: { ...writeResult, click, ...(said.ok ? { said: record.word, ...(record.paste === undefined ? {} : { paste: record.paste }) } : { notSent: record.notSent, notSentAt: record.notSentAt }) } }
  })
}

/**
 * The retry of a "not sent" click, by its id: the same action without its write (`write` answers the stored result). A
 * click id that is not known, or whose word went already, answers what it holds.
 */
export async function retryClick({ ledger, click, now, say, log = null }) {
  const before = await ledger.get(click)
  if (before === null) return { ok: false, status: 404, why: 'That click is not on the board any more: do it again.' }
  return oneClick({ ledger, click, via: before.via, key: before.key, route: before.route, toRole: before.toRole ?? 'talk', now, write: async () => ({ ok: true, result: before.writeResult ?? {} }), sayBody: () => before.say, say, log })
}

/** The commands of the board's words a brainstorm click types again ("type it again"). */
const BRAINSTORM_AGAIN = ['brainstorm', 'brainstorm-answer', 'brainstorm-wrap', 'brainstorm-understood', 'brainstorm-not-quite']

/**
 * What one click of a brainstorm is: `{ via, key, word }` for the body of POST /api/brainstorm that carries a click id, or
 * null for a command that sends no word (discard, close, create). `word(result, to)` is the body of the word the click
 * types, `to` the talk partner. The commands and the words are the ones the page typed itself before.
 */
export function brainstormClickOf(body) {
  const path = typeof body?.path === 'string' ? body.path : null
  const viaTalk = body?.via === 'talk-send'
  switch (body?.command) {
    case 'answer': case 'skip': case 'back':
      return { via: viaTalk ? 'talk-send' : 'brainstorm-answer', key: path, word: (_, to) => ({ to, command: 'brainstorm-answer', thread: path, n: body.n }) }
    case 'wrap':
      return { via: 'brainstorm-wrap', key: path, word: (_, to) => ({ to, command: 'brainstorm-wrap', thread: path }) }
    case 'understood':
      return body.yes === true
        ? { via: 'brainstorm-understood', key: path, word: (_, to) => ({ to, command: 'brainstorm-understood', thread: path }) }
        : { via: 'brainstorm-not-quite', key: path, word: (_, to) => ({ to, command: 'brainstorm-not-quite', thread: path }) }
    case 'start':
      return { via: body.kind === 'change' ? 'change-goal-start' : 'brainstorm-start', key: null, word: (result, to) => ({ to, command: 'brainstorm', thread: result.path }) }
    case 'change':
      return { via: 'brainstorm-change', key: path, noWrite: true, word: (_, to) => ({ to, command: 'brainstorm-change', thread: path, text: body.text }) }
    case 'again':
      return BRAINSTORM_AGAIN.includes(body.word?.command)
        ? { via: 'brainstorm-again', key: path, noWrite: true, word: (_, to) => ({ to, command: body.word.command, thread: path, ...(Number.isInteger(body.word.n) ? { n: body.word.n } : {}) }) }
        : null
    default:
      return null
  }
}
