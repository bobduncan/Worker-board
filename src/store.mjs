// Own data, all inside `data/`: history.jsonl (what changed per chat), outbox.jsonl (what was typed in the chat
// box) and alive.json (when the board last ran, so the time it was off shows as unknown). The first two can hold
// words from a chat; they stay in this folder and are never printed.

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { changes, lastByChat, parseHistory } from './history.mjs'

/** The board watches once a minute. Longer than this without a look means it was off or the PC slept. */
const GAP_MS = 3 * 60_000

/** outbox.jsonl is a log: a line with an id seen before changes that message (delivered, later on). */
export function foldOutbox(text) {
  const byId = new Map()
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    let line
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    if (line === null || typeof line !== 'object' || typeof line.id !== 'string') continue
    byId.set(line.id, { ...byId.get(line.id), ...line })
  }
  return [...byId.values()].filter(message => typeof message.text === 'string' && Number.isFinite(message.at))
}

const isAnswer = message => (message.ask ?? null) !== null
const COMMAND_KNOWN_MS = 2 * 60 * 60_000
/** A typed line the mod took and never said it typed is shown as on its way for this long. */
const TAKEN_SHOWN_MS = 10 * 60_000

/**
 * True when a message waited too long to be delivered. A line typed to a chat is kept for minutes (`messageMs`),
 * so nothing typed long ago turns up in a chat; an answer to a request waits for its chat much longer (`answerMs`).
 */
// A step asked of the main chat from the Design tab waits as long as an answer does: the main chat may be closed.
// B285: so does the word that a step the main chat queued is refined: it waits until the main chat takes it.
export const isLate = (message, now, keep) => now - message.at > (isAnswer(message) || message.command === 'step' || message.command === 'refined' ? keep.answerMs : keep.messageMs)

/**
 * What was sent from the page, as the board sees it now. A message that waited too long is `expired` and never
 * delivered; it stays listed for `shownMs` so the person sees what did not arrive. A delivered answer stays
 * known, because it closes its request; a delivered line shows in its chat and is listed no longer.
 */
export function outboxNow(messages, now, keep, shownMs = 12 * 60 * 60_000) {
  return messages
    .map(message => (message.state === 'waiting' && isLate(message, now, keep) ? { ...message, state: 'expired' } : message))
    .filter(message => message.state === 'waiting'
      // B285: a queue ask held on the board until its step is refined stays known as long as it is held.
      || message.state === 'held'
      // What did not arrive is shown for a while.
      || ((message.state === 'expired' || message.state === 'failed') && now - message.at < shownMs)
      // An answer that was taken or typed keeps its request closed.
      || ((message.state === 'taken' || message.state === 'delivered') && isAnswer(message))
      // B195: so does an answer to the Advisor's recommendation: it closes the recommendation.
      || ((message.state === 'taken' || message.state === 'delivered') && message.command === 'recommend')
      // A word for the restart stays known for a while: the board says how the preparing stands.
      || (typeof message.command === 'string' && now - message.at < COMMAND_KNOWN_MS)
      // B212: words copied for the person to paste, without a Workers mod: shown for a while, and an answer stays closed.
      || (message.state === 'copied' && (isAnswer(message) || now - message.at < shownMs))
      // A line that was taken shows as on its way until the chat has it.
      || (message.state === 'taken' && now - (message.takenAt ?? message.at) < TAKEN_SHOWN_MS))
}

/** The gap line to add when the board starts after having been off, or null. */
export function startGap(lines, aliveAt, now) {
  const last = lines.at(-1)
  if (last === undefined || last.gap === true) return null
  const at = Math.max(last.at, Number.isFinite(aliveAt) ? aliveAt : last.at)
  return now - at > GAP_MS ? { at, gap: true } : null
}

function storeOver(lines, messages, alive, write) {
  let aliveAt = alive
  return {
    lines: () => lines,
    outbox: () => messages,
    aliveAt: () => aliveAt,
    async record(added) {
      if (added.length === 0) return
      lines.push(...added)
      await write.history(added)
    },
    async alive(at) {
      aliveAt = at
      await write.alive(at)
    },
    async say(message) {
      messages.push(message)
      await write.outbox([message])
    },
    /**
     * Hands out what waits for one chat, for the mod to type there. Every message is marked taken at once, before
     * anything is awaited, so two takes never hand out the same one; and it is written down before it is handed
     * out, so it is never typed twice. A take that cannot be written down hands out nothing.
     */
    async take(to, now, keep) {
      const taken = messages.filter(message => message.to === to && message.state === 'waiting' && !isLate(message, now, keep))
      for (const message of taken) Object.assign(message, { state: 'taken', takenAt: now })
      try {
        if (taken.length > 0) await write.outbox(taken.map(message => ({ id: message.id, state: 'taken', takenAt: now })))
      } catch (error) {
        for (const message of taken) {
          message.state = 'waiting'
          delete message.takenAt
        }
        throw error
      }
      return taken.map(message => ({ ...message }))
    },
    /** B285: changes a message the board holds (a held queue ask let go or dropped), written down like the others. */
    async update(id, fields) {
      const message = messages.find(one => one.id === id)
      if (message === undefined) return false
      Object.assign(message, fields)
      await write.outbox([{ id, ...fields }])
      return true
    },
    /** What the mod says became of the messages a chat took: typed into the chat, or not. */
    async settle(to, { typed = [], failed = [] }, now) {
      const changed = []
      for (const message of messages) {
        if (message.to !== to || message.state !== 'taken') continue
        if (typed.includes(message.id)) changed.push(Object.assign(message, { state: 'delivered', deliveredAt: now }))
        else if (failed.includes(message.id)) changed.push(Object.assign(message, { state: 'failed' }))
      }
      if (changed.length > 0) await write.outbox(changed.map(({ id, state, deliveredAt }) => ({ id, state, ...(deliveredAt === undefined ? {} : { deliveredAt }) })))
      return changed.length
    },
  }
}

const nothing = async () => {}

/** A store that keeps everything in memory: the demo and the tests. `failWrites` lets a test make a write fail. */
export function memoryStore(lines = []) {
  let isFailing = false
  const store = storeOver([...lines], [], null, {
    history: nothing,
    alive: nothing,
    outbox: async () => {
      if (isFailing) throw new Error('The outbox could not be written.')
    },
  })
  return { ...store, failWrites: fails => { isFailing = fails } }
}

const jsonLines = values => `${values.map(value => JSON.stringify(value)).join('\n')}\n`

async function read(file) {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return ''
  }
}

/** The store over the files in `dir`. It marks the time the board was off as a gap. */
export async function fileStore(dir, now) {
  await mkdir(dir, { recursive: true })
  const files = { history: join(dir, 'history.jsonl'), outbox: join(dir, 'outbox.jsonl'), alive: join(dir, 'alive.json') }
  const lines = parseHistory(await read(files.history))
  let aliveAt = null
  try {
    aliveAt = JSON.parse(await read(files.alive)).at
  } catch {
    // Never ran before, or the file is broken: the last line of the history stands in.
  }
  const store = storeOver(lines, foldOutbox(await read(files.outbox)), Number.isFinite(aliveAt) ? aliveAt : null, {
    history: added => appendFile(files.history, jsonLines(added)),
    alive: at => writeFile(files.alive, JSON.stringify({ at })),
    outbox: changed => appendFile(files.outbox, jsonLines(changed)),
  })
  const gap = startGap(lines, aliveAt, now)
  if (gap !== null) await store.record([gap])
  return store
}

/** One look at the board: records what changed since the last one. `state` is the `/api/state` object. */
export async function tick(store, state, now) {
  const aliveAt = store.aliveAt()
  const last = store.lines().at(-1)
  // After a start the gap is written already (`startGap`); a sleep in the middle of a run is written here.
  if (aliveAt !== null && now - aliveAt > GAP_MS && last !== undefined && last.gap !== true) {
    await store.record([{ at: Math.max(aliveAt, last.at), gap: true }])
  }
  const chats = state.chats.filter(chat => !chat.isLeftover)
  await store.record(changes(lastByChat(store.lines()), chats, now))
  await store.alive(now)
}
