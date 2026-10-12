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

/**
 * What was typed, as the dock and the bridge see it now. A message that waited longer than `keepMs` is `expired`:
 * it is never delivered, so nothing typed long ago turns up in a chat when delivery starts working. Expired
 * messages stay listed for `shownMs` so the person sees what did not arrive.
 */
export function outboxNow(messages, now, keepMs, shownMs = 12 * 60 * 60_000) {
  return messages
    .map(message => (message.state === 'waiting' && now - message.at > keepMs ? { ...message, state: 'expired' } : message))
    .filter(message => message.state === 'waiting' || (message.state === 'expired' && now - message.at < shownMs))
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
      await write.outbox(message)
    },
  }
}

const nothing = async () => {}

/** A store that keeps everything in memory: the demo and the tests. */
export function memoryStore(lines = []) {
  return storeOver([...lines], [], null, { history: nothing, alive: nothing, outbox: nothing })
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
    outbox: message => appendFile(files.outbox, jsonLines([message])),
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
