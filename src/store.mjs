// Own data, all inside `data/`: history.jsonl (what changed per chat), outbox.jsonl (what was typed in the chat
// box) and alive.json (when the board last ran, so the time it was off shows as unknown). The first two can hold
// words from a chat; they stay in this folder and are never printed.

import { randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { changes, lastByChat, parseHistory } from './history.mjs'
import { waitsLong } from './say.mjs'
import { isStoppedWhy } from './stopped.mjs'
import { heldMs } from './work/pause.mjs'
import { appendLines, writeAtomic } from './write.mjs'

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
/** B570: a restart word for a new Workers mod stays known a day, so its three tries are counted (work/modRollout.mjs). */
const MOD_WORD_KEPT_MS = 24 * 60 * 60_000
/** A typed line the mod took and never said it typed is shown as on its way for this long. */
const TAKEN_SHOWN_MS = 10 * 60_000

/**
 * True when a message waited too long to be delivered. A person's answer never: it waits for its chat however old. A
 * plain word (a line typed to a chat, a resume) and a word the chat's work stands on wait `answerMs`; a word that
 * steers a chat now (stop, clear, a model, a sweep) is kept for minutes (`messageMs`), so no old order turns up in a
 * chat. A word older than `messageMs` goes with its age (`take`), so the chat reads it as late.
 */
// A step asked of the main chat from the Design tab waits as long as an answer does: the main chat may be closed.
// B285: so does the word that a step the main chat queued is refined: it waits until the main chat takes it.
// B300: and the work store's line that a step is a chat's: it is sent once, never again (src/work/deliver.mjs).
// The review of Pause 2: the time the person's pause held it (`keep.pause`, pause.json's record) does not count.
// B532: so does every word the chat's work stands on (a refine, a check, a round, a plan word, a start of a closed chat): the
// board used to drop them after ten minutes, in silence, when the chat was busy or closed; now they wait until their
// purpose is gone (src/work/outboxSweep.mjs closes them with a reason) or answerMs passed.
// The supervisor (2026-10-24): and an incident's word to the partner, which waits for a partner that does not run.
// B548 (the result check of B532): a person's answer reached its chat only within answerMs (Q300's, 3 days old, never
// did), and a plain word (a line typed to a chat, a resume) expired after messageMs; now an answer waits however old,
// and a plain word as long as an answer used to.
const isPlain = message => (message.command ?? null) === null || message.command === 'resume'
export const keepMs = (message, keep) => (isAnswer(message) ? Infinity
  : isPlain(message) || ['step', 'refined', 'work', 'incident'].includes(message.command) || waitsLong(message.command) ? keep.answerMs : keep.messageMs)
export const isLate = (message, now, keep) => now - message.at - heldMs(message, now, keep.pause ?? null) > keepMs(message, keep)

/**
 * What was sent from the page, as the board sees it now. A message that waited too long is `expired` and never
 * delivered; it stays listed for `shownMs` so the person sees what did not arrive. A delivered answer stays
 * known, because it closes its request; a delivered line shows in its chat and is listed no longer.
 */
export function outboxNow(messages, now, keep, shownMs = 12 * 60 * 60_000) {
  const known = messages.map(message => (message.state === 'waiting' && isLate(message, now, keep) ? { ...message, state: 'expired' } : message))
  // B352, review: the newest word that set the partner's mode stays known: the partner runs on it until the next one,
  // however long it is idle (src/partnerEffort.mjs).
  const effortWord = known.findLast(message => message.command === 'partner-effort' && message.state !== 'expired' && message.state !== 'failed')
  // B468: so does the newest word that set a worker's effort, per worker: it carries the worker's usual level.
  const workerWords = new Set(new Map(known.filter(message => message.command === 'worker-effort').map(message => [message.about, message])).values())
  return known
    .filter(message => message === effortWord || workerWords.has(message)
      || message.state === 'waiting'
      // B285: a queue ask held on the board until its step is refined stays known as long as it is held.
      || message.state === 'held'
      // What did not arrive is shown for a while.
      || ((message.state === 'expired' || message.state === 'failed') && now - message.at < shownMs)
      // B532: a word the board closed (superseded, no longer needed) is shown with its reason for a while.
      || ((message.state === 'dropped' || message.state === 'expired') && typeof message.why === 'string' && now - (message.closedAt ?? message.at) < shownMs)
      // An answer that was taken or typed keeps its request closed.
      || ((message.state === 'taken' || message.state === 'delivered') && isAnswer(message))
      // B195: so does an answer to the Advisor's recommendation: it closes the recommendation.
      || ((message.state === 'taken' || message.state === 'delivered') && message.command === 'recommend')
      // A word to a chat stays known for a while: the board says how it fared.
      || (typeof message.command === 'string' && now - message.at < COMMAND_KNOWN_MS)
      || (message.command === 'mod-restart' && now - message.at < MOD_WORD_KEPT_MS)
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
    /** B529: when the board last ran, as another board process on the folder wrote it (read again, not written). */
    aliveRead(at) {
      if (Number.isFinite(at)) aliveAt = at
    },
    async say(message) {
      messages.push(message)
      await write.outbox([message])
    },
    /**
     * Hands out what waits for one chat, for the mod to type there. Every message is marked taken at once, before
     * anything is awaited, so two takes never hand out the same one; and it is written down before it is handed
     * out, so it is never typed twice. A take that cannot be written down hands out nothing. The review of Pause 2:
     * `only`, when given, says which may go now (while the person pauses, the board's own "resume"); the rest wait.
     */
    async take(to, now, keep, only = () => true) {
      const taken = messages.filter(message => message.to === to && message.state === 'waiting' && !isLate(message, now, keep) && only(message))
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
      // B532: a word that waited longer than a typed line is kept goes with its age, so the chat reads it as late.
      // B577: so does a word that waited for a stopped chat, or that failed for the session a new one replaced.
      const isAged = message => now - message.at > keep.messageMs || ((Number.isFinite(message.stoppedAt) || message.revivedFor !== undefined) && now > message.at)
      return taken.map(message => ({ ...message, ...(isAged(message) ? { lateMs: now - message.at } : {}) }))
    },
    /**
     * B532: closes a waiting word with its reason (`state` dropped: no longer needed; expired: waited too long), written
     * down with the time, so the outbox holds only words that still matter and the page says what became of the rest.
     */
    async close(id, state, why, now) {
      const message = messages.find(one => one.id === id)
      if (message === undefined || message.state !== 'waiting') return false
      Object.assign(message, { state, why, closedAt: now })
      await write.outbox([{ id, state, why, closedAt: now }])
      return true
    },
    /**
     * B532: a word the chat could not type (failed) goes again after `afterMs`, up to `tries` times in all, while it is
     * not late; then it stays failed. It goes as a new word with its own id (`retryOf` the failed one, which names it in
     * `retriedAs`): the Workers mod types an id once per process. Not again: a word the mod refused for good (`final`, too
     * long or empty), a work line (src/work/deliver.mjs sends its own), and a word that failed before `failedAt` was kept.
     */
    async retryFailed(now, keep, { afterMs = 60_000, tries = 3, newId = () => randomBytes(8).toString('hex') } = {}) {
      const again = messages.filter(message => message.state === 'failed' && Number.isFinite(message.failedAt) && message.final !== true
        && message.command !== 'work' && message.retriedAs === undefined && (message.tries ?? 1) < tries
        && now - message.failedAt >= afterMs && !isLate(message, now, keep))
      const sent = []
      for (const message of again) {
        const { takenAt, failedAt, why, retriedAs, failedSession, stoppedAt, stoppedSession, ...rest } = message
        const copy = { ...rest, id: newId(), state: 'waiting', retryOf: message.id }
        message.retriedAs = copy.id
        messages.push(copy)
        sent.push(copy)
      }
      if (sent.length > 0) await write.outbox([...again.map(message => ({ id: message.id, retriedAs: message.retriedAs })), ...sent])
      return sent.map(message => message.id)
    },
    /** B285: changes a message the board holds (a held queue ask let go or dropped), written down like the others. */
    async update(id, fields) {
      const message = messages.find(one => one.id === id)
      if (message === undefined) return false
      Object.assign(message, fields)
      await write.outbox([{ id, ...fields }])
      return true
    },
    /**
     * What the mod says became of the messages a chat took: typed into the chat, or not. B532: `why` (id to words) says
     * why one was not typed, `refused` the ids it refused for good (too long, no text): those are never tried again.
     * B577: `session` is the chat's session that took them (`failedSession` on a word that failed). A word the app
     * dropped because that session was stopped spends no try: it goes again at once as a new word (the mod types an id
     * once per process), which waits while that session stays stopped (src/stopped.mjs).
     */
    async settle(to, { typed = [], failed = [], why = {}, refused = [], session = null }, now, { newId = () => randomBytes(8).toString('hex') } = {}) {
      const changed = []
      const again = []
      for (const message of messages) {
        if (message.to !== to || message.state !== 'taken') continue
        if (typed.includes(message.id)) changed.push(Object.assign(message, { state: 'delivered', deliveredAt: now }))
        else if (failed.includes(message.id) && !refused.includes(message.id) && isStoppedWhy(why[message.id])) {
          const { takenAt, failedAt, why: _why, retriedAs, failedSession, stoppedAt, stoppedSession, ...rest } = message
          const copy = { ...rest, id: newId(), state: 'waiting', retryOf: message.id, stoppedAt: now, ...(session === null ? {} : { stoppedSession: session }) }
          // Not "failed": nothing failed for good, and the word that stands for it waits.
          changed.push(Object.assign(message, { state: 'stopped', failedAt: now, tries: message.tries ?? 0, why: why[message.id], retriedAs: copy.id }))
          again.push(copy)
        } else if (failed.includes(message.id) || refused.includes(message.id)) {
          changed.push(Object.assign(message, { state: 'failed', failedAt: now, tries: (message.tries ?? 0) + 1,
            ...(typeof why[message.id] === 'string' ? { why: why[message.id] } : {}), ...(refused.includes(message.id) ? { final: true } : {}),
            ...(session === null ? {} : { failedSession: session }) }))
        }
      }
      messages.push(...again)
      if (changed.length > 0) {
        await write.outbox([...changed.map(({ id, state, deliveredAt, failedAt, tries, why: reason, final, failedSession, retriedAs }) => ({ id, state,
          ...(deliveredAt === undefined ? {} : { deliveredAt }), ...(failedAt === undefined ? {} : { failedAt, tries }),
          ...(reason === undefined ? {} : { why: reason }), ...(final === undefined ? {} : { final }),
          ...(failedSession === undefined ? {} : { failedSession }), ...(state === 'stopped' ? { retriedAs } : {}) })), ...again])
      }
      return changed.length
    },
    /**
     * B577: a chat replaced under the same name (the old session gone, a new one on the board under that name; a chat
     * cleared is one too): the words that failed for its old session in the last `dayMs` and were not tried again go to
     * the new one as new words, each with its age (`take`). `sessions` maps a chat's name to the session the board shows
     * for it. What no longer matters among them the outbox sweep closes, as any waiting word. The ids sent.
     */
    async revive(sessions, now, keep, { dayMs = 24 * 60 * 60_000, newId = () => randomBytes(8).toString('hex') } = {}) {
      const again = messages.filter(message => message.state === 'failed' && message.final !== true && message.retriedAs === undefined
        && typeof message.failedSession === 'string' && typeof sessions.get(message.to) === 'string' && sessions.get(message.to) !== message.failedSession
        && Number.isFinite(message.failedAt) && now - message.failedAt < dayMs && !isLate(message, now, keep))
      const sent = []
      for (const message of again) {
        const { takenAt, failedAt, why, retriedAs, failedSession, stoppedAt, stoppedSession, ...rest } = message
        const copy = { ...rest, id: newId(), state: 'waiting', retryOf: message.id, revivedFor: sessions.get(message.to) }
        message.retriedAs = copy.id
        messages.push(copy)
        sent.push(copy)
      }
      if (sent.length > 0) await write.outbox([...again.map(message => ({ id: message.id, retriedAs: message.retriedAs })), ...sent])
      return sent.map(message => message.id)
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
    // B406: a record starts on a line of its own, also after a line torn by a power cut; alive.json is never torn.
    history: added => appendLines(files.history, jsonLines(added)),
    alive: at => writeAtomic(files.alive, JSON.stringify({ at })),
    outbox: changed => appendLines(files.outbox, jsonLines(changed)),
  })
  const gap = startGap(lines, aliveAt, now)
  if (gap !== null) await store.record([gap])
  return {
    ...store,
    /**
     * B488: reads the files again into the memory the store holds, in place. Of two board processes on one folder only
     * one writes (the one that runs the loops): the other reads what it wrote, and the one that takes over starts
     * from it, so it neither hands out a word twice nor writes an old state over a newer one.
     */
    async reload() {
      lines.splice(0, lines.length, ...parseHistory(await read(files.history)))
      store.outbox().splice(0, store.outbox().length, ...foldOutbox(await read(files.outbox)))
      // B529: and when it last ran, so the first look of the one that takes over sees no gap the other did not have
      try {
        store.aliveRead(JSON.parse(await read(files.alive)).at)
      } catch {
        // none written yet, or broken: the time read before stands
      }
    },
  }
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

/**
 * The person's "Dismiss" on the restart banner's copied word: kept on the word in the outbox (`dismissedAt`), so the
 * banner leaves that word alone from then on. Refused for a word that is not waiting to be pasted.
 */
export async function dismissCopied(store, id, now) {
  const message = store.outbox().find(one => one.id === id)
  if (message === undefined || message.state !== 'copied') return { ok: false, status: 409, why: 'That word is not waiting to be pasted any more.' }
  await store.update(id, { dismissedAt: now })
  return { ok: true, message: { id, dismissedAt: now } }
}
