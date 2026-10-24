// B300: the server's part of the reconciler (spec 2026-10-17, sections 6 hook 3 and 7). At every refresh the board makes the moves the reconciler names (through the work API, as the server) and sends each
// chat its line ("work: B286 is yours; run work next") into the outbox, where the Workers mod takes it. A line goes
// once per key: the step, its owner and when it was queued for that owner ("B286 Units 2026-10-17 11:00"), so a step
// queued anew is delivered anew. The keys stand in the store's folder (`delivered.json`), written once the line is in
// the outbox; one send at a time per store, so the chat's pull and the refresh never send it twice. A line that
// expired untaken goes once more. A waiting line whose step is no longer that chat's is withdrawn.

import { resolve } from 'node:path'

import { wakeFor, workWords } from '../say.mjs'
import { isLate } from '../store.mjs'
import { stamp } from './migrate.mjs'
import { sinceMs } from './item.mjs'
import { readDeliveredFile, readStore, writeDelivered } from './store.mjs'
import { isHolding } from './pause.mjs'
import { isFailedForGood, sweepOutbox } from './outboxSweep.mjs'
import { SYNC_LINE_MS, workLineWhy } from './workLines.mjs'
import { PARTNER_AGAIN_MS, partnerAskWords } from './partnerAnswers.mjs'
import { AGAIN_MS, effortWords, lastWord, sameTarget } from './effort.mjs'
import { RESTART_AGAIN_MS, RESTART_COMMAND, restartWords } from './modRollout.mjs'
import { boardLineKey } from './incidentFix.mjs'

export { partnerAskWords }

/** The key under which a step's line to its chat is sent once: the step, the chat, and when it was queued for it. */
export const deliveryKey = (id, chat, since = '') => [id, chat, since].filter(Boolean).join(' ')

/** Focus 4: the key under which the main chat is woken for these notes, once. */
export const noteKey = (ids, chat) => `notes ${ids.join(',')} ${chat}`
/** Focus 4: the main chat's one line for its notes; B564: once more with how long they wait unread (`waited`, minutes). */
export const noteWords = (ids, waited = null) => `work: ${ids.length === 1 ? 'note' : 'notes'} ${ids.join(', ')} for you${waited === null ? '' : `, unread ${waited} min`}; run work next`

/**
 * B564 (X20: a notes line the Workers mod took on 2026-10-19 and never said it typed held every notes line since, so
 * twelve notes to the main chat sat unread): a notes line taken this long ago without a word that it was typed counts
 * as arrived, as the page shows it (store.mjs TAKEN_SHOWN_MS); it no longer holds the next line.
 */
export const NOTE_TAKEN_MS = 10 * 60_000
/** B564: notes still unread this long after their line arrived: the line goes once more. */
export const NOTE_AGAIN_MS = 30 * 60_000

/** Partner answers (2026-10-19): the key under which the partner is woken for an ask routed to it, once. */
export const partnerAskKey = (id, chat, again = false) => `partner-ask ${id} ${chat}${again ? ' again' : ''}`

/** One send at a time per store folder, in this process (the board is the store's only writer). */
const turns = new Map()
function oneAtATime(dir, run) {
  const key = resolve(dir)
  const turn = (turns.get(key) ?? Promise.resolve()).then(run, run)
  turns.set(key, turn.catch(() => {}))
  return turn
}

/**
 * B577: the word that stands for a line now: the line itself, or the word it went again as (`retriedAs`: a chat that was
 * stopped, or replaced), followed to the last.
 */
function latestOf(all, id) {
  let message = all.find(one => one.id === id)
  for (let hops = 0; typeof message?.retriedAs === 'string' && hops < 20; hops += 1) {
    const next = all.find(one => one.id === message.retriedAs)
    if (next === undefined) break
    message = next
  }
  return message
}

/** Whether a message went untaken: it waited too long, or the chat could not type it. */
const isUntaken = (message, now, keep) => message !== undefined && ((message.state === 'waiting' && isLate(message, now, keep)) || message.state === 'expired' || message.state === 'failed')

/**
 * Sends `words` (a message's parts, say.mjs) once per `key`; once more when the first expired untaken (`keep`, the
 * outbox's times). Checked and recorded in one turn per store: the line is put into the outbox first (a chat that is not
 * running makes the board ask the main chat to start it, say.mjs `wakeFor`), the key is written after. The message, or
 * null when it is not sent (sent before, or the outbox could not take it).
 */
export function sendOnce({ dir, key, words, outbox, state, now, maxChars, newId, fs, keep }) {
  return oneAtATime(dir, async () => {
    const { record } = await readDeliveredFile(dir, fs)
    const pending = pendingOf(dir)
    const before = record.sent[key] ?? pending.get(key) ?? (record.keys.includes(key) ? { message: null, wake: null, again: 0 } : null)
    if (before !== null) {
      const sent = latestOf(outbox.outbox(), before.message)
      if ((before.again ?? 0) >= 1 || keep === undefined || !isUntaken(sent, now, keep)) return null
    }
    const message = { id: newId(), at: now, ...words, state: 'waiting' }
    const start = wakeFor(message, state, outbox.outbox(), now, maxChars)
    const wake = start === null ? null : { id: newId(), at: now, ...start, state: 'waiting' }
    try {
      await outbox.say(wake === null ? message : { ...message, wake: wake.id })
      if (wake !== null) await outbox.say(wake)
    } catch {
      return null
    }
    // B406: the key must be written, or the next refresh sends the line again: read anew and written again when the
    // file changed in between. One that still could not be written is held here, so the line is not sent again, and
    // written with the next record that can be.
    pending.set(key, { message: message.id, wake: wake?.id ?? null, again: before === null ? 0 : (before.again ?? 0) + 1 })
    const done = await changeDelivered(dir, fs, held => {
      const keys = [...held.keys]
      for (const one of pending.keys()) if (!keys.includes(one)) keys.push(one)
      return { ...held, keys, sent: { ...held.sent, ...Object.fromEntries(pending) } }
    })
    if (done.ok) pending.clear()
    return message
  })
}

/** B406: per store folder, the lines sent whose key could not be written yet (`key` to what `sent` records). */
const unrecorded = new Map()
function pendingOf(dir) {
  const at = resolve(dir)
  if (!unrecorded.has(at)) unrecorded.set(at, new Map())
  return unrecorded.get(at)
}

/**
 * B406: delivered.json's record as `change` makes it, read anew and written again (three tries in all) when the file
 * changed in between. `{ ok }`, or `{ ok: false, why }` when it could not be written.
 */
async function changeDelivered(dir, fs, change) {
  let done = { ok: false, why: 'delivered.json could not be written' }
  for (let attempt = 0; attempt < 3 && !done.ok; attempt += 1) {
    const { record, text } = await readDeliveredFile(dir, fs)
    done = await writeDelivered(dir, change(record), fs, { expected: text }).catch(error => ({ ok: false, why: error.message }))
  }
  return done
}

export { SYNC_LINE_MS }

/**
 * Whether a line may go to `chat` now: a chat on the board (not a leftover) that is free, not busy nor held by the limit,
 * or (B567) that rests while its steps wait on the person.
 */
export function mayWake(state, chat) {
  // The review of Pause 2: while the person pauses nothing starts a turn (2026-10-19: pausing only; while resuming
  // as when running).
  if (isHolding(state?.pause)) return false
  const lane = (state?.chats ?? []).find(one => one.name === chat && !one.isLeftover)
  // B567: or one that rests while every step it holds waits on the person (the reconciler's `restFree`).
  return lane !== undefined && (lane.state === 'free' || (state?.reconciled?.restFree ?? []).includes(chat))
}

/**
 * A chat's pull (the work API's answer `result`: `{ text, id, since, wake }`) carried out: the line goes into the outbox
 * once, under the delivery's key, and the answer says it; nothing for a chat that may not be woken now (`mayWake`) or
 * when the line went before.
 */
export async function pullFor({ dir, result, state, outbox, now, maxChars, newId, fs, keep }) {
  const wake = result?.wake ?? null
  const none = { ...result, text: '', wake: null }
  if (wake === null || dir === null || !mayWake(state, wake.to)) return wake === null ? result : none
  // B468: a step whose effort the worker's chat is not set to yet waits, as the reconciler's line does (effort.mjs).
  if ((state?.reconciled?.held ?? []).includes(wake.id)) return none
  const sent = await sendOnce({ dir, key: deliveryKey(wake.id, wake.to, result.since), words: workWords(wake.to, wake.id), outbox, state, now, maxChars, newId, fs, keep })
  return sent === null ? none : result
}

/**
 * The work lines whose step is no longer that chat's (another owner, done, dropped, gone; a check's line once the step
 * left review; workLines.mjs) are withdrawn with their why, and the start they asked of the main chat when it still
 * waits and nothing else waits for that chat. B589: a line that failed and is not tried again too (X3: the chat's
 * session was stopped as it took it); one whose step is still that chat's stays failed, for the person to see.
 */
async function withdrawStale({ dir, outbox, prefix, fs, now = Date.now() }) {
  const lines = outbox.outbox().filter(message => message.command === 'work' && (message.state === 'waiting' || isFailedForGood(message)))
  if (lines.length === 0) return []
  const items = (await readStore(dir, fs)).items
  const gone = []
  for (const message of lines) {
    const why = workLineWhy(message, items, { prefix, now })
    if (why === null) continue
    await outbox.update(message.id, { state: 'dropped', why, closedAt: now })
    gone.push(message)
  }
  for (const message of gone) {
    const start = outbox.outbox().find(one => one.id === message.wake && one.state === 'waiting')
    const others = outbox.outbox().some(one => one.to === message.to && one.state === 'waiting' && one.id !== message.id)
    if (start !== undefined && !others) await outbox.update(start.id, { state: 'dropped' })
  }
  return gone
}

/**
 * Focus 4, the review: the main chat's one line for the notes it has not read (`plan.notes`): none while such a line to
 * it still waits or was taken, none for the notes filed before this board first did this (`notesFrom` in
 * delivered.json, written at the first refresh), and once per set of notes.
 */
async function noteLine({ dir, plan, outbox, now, fs }) {
  const { record } = await readDeliveredFile(dir, fs)
  if (record.notesFrom === null) {
    // B406: not written, it is written at the next refresh; no line goes before it is.
    await changeDelivered(dir, fs, held => (held.notesFrom === null ? { ...held, notesFrom: stamp(now) } : held))
    return []
  }
  const from = sinceMs(record.notesFrom)
  const notes = (plan.notes ?? []).filter(one => !(sinceMs(one.since) < from))
  if (notes.length === 0) return []
  const chat = notes[0].chat
  const lines = outbox.outbox().filter(one => one.kind === 'note' && one.to === chat)
  // B564: a line taken long ago no longer holds: the mod took it and never said it typed it.
  if (lines.some(one => one.state === 'waiting' || (one.state === 'taken' && now - (one.takenAt ?? one.at) < NOTE_TAKEN_MS))) return []
  const ids = notes.map(one => one.id)
  const key = noteKey(ids, chat)
  // B564: the same notes still unread NOTE_AGAIN_MS after their line arrived: once more, with how long they wait.
  const last = lines.findLast(one => ['taken', 'delivered'].includes(one.state) && noteKey(one.notes ?? [one.about], chat) === key)
  const arrived = last === undefined ? null : (last.deliveredAt ?? last.takenAt ?? last.at)
  if (arrived !== null && now - arrived >= NOTE_AGAIN_MS) {
    const waited = Math.round((now - Math.min(...notes.map(one => sinceMs(one.since)).filter(Number.isFinite), arrived)) / 60_000)
    return [{ key: `${key} again`, words: { ...workWords(chat, ids[0], noteWords(ids, waited)), kind: 'note', notes: ids } }]
  }
  return [{ key, words: { ...workWords(chat, ids[0], noteWords(ids)), kind: 'note', notes: ids } }]
}

/**
 * One refresh: `state.reconciled` (state.mjs; null while the store cannot be read) carried out. `apply(body)` is the work
 * API as the server. `{ moved, sent, withdrawn }`: the ids moved, the messages sent and withdrawn.
 */
export async function deliverWork({ state, dir, outbox, apply, now, maxChars, newId, fs, keep }) {
  const done = { moved: [], sent: [], withdrawn: [], closed: [] }
  const plan = state?.reconciled ?? null
  if (plan === null || dir === null) return done
  for (const move of plan.moves ?? []) {
    const moved = await apply({ action: 'advance', id: move.id, to: move.to, ...(typeof move.ask === 'string' ? { ask: move.ask } : {}) }).catch(() => null)
    if (moved?.ok === true) done.moved.push(move.id)
  }
  // Incident fixes (2026-10-24): the board queues each ready incident fix for the worker the reconciler picked (the API
  // checks it anew: a step the main chat queued meanwhile is left alone), and the main chat gets its information line at
  // once (the reconciler's `boardLines` names it again later, under the same key, should it not go now).
  const placed = []
  for (const one of plan.autoQueues ?? []) {
    const queued = await apply({ action: 'advance', id: one.id, to: 'queued', for: one.chat, tier: one.tier }).catch(() => null)
    if (queued?.ok !== true) continue
    done.moved.push(one.id)
    const said = queued.result?.boardQueued ?? null
    if (said !== null && typeof one.main === 'string') placed.push({ key: boardLineKey(said.id, said.chat, said.since), words: { ...workWords(one.main, said.id, said.text), kind: 'board-queued' } })
  }
  // Partner answers (2026-10-19): what the partner did not answer in time (or cannot) goes to the person, also while
  // the person pauses: it only shows them the ask.
  for (const one of plan.escalations ?? []) {
    const handed = await apply({ action: 'escalate', id: one.id, why: one.why }).catch(() => null)
    if (handed?.ok === true) done.moved.push(one.id)
  }
  // B532: the words that no longer matter are closed with their reason, the ones that failed to be typed are retried.
  done.closed = await sweepOutbox({ dir, outbox, state, now, keep, fs })
  done.withdrawn = await withdrawStale({ dir, outbox, prefix: state.chatPrefix ?? '', fs, now })
  // The review of Pause 2: while the person pauses (2026-10-19: pausing only) no line goes out that starts a turn: no
  // step delivered, no check's word, no note-wake to the main chat. They go at Resume all, as when running.
  if (isHolding(state?.pause)) return done
  const lines = [
    ...(plan.deliveries ?? []).map(one => ({ key: deliveryKey(one.id, one.chat, one.since), words: workWords(one.chat, one.id) })),
    ...(plan.says ?? []).map(one => ({ key: one.key, words: { ...workWords(one.chat, one.id, one.say), kind: 'check' } })),
    ...(await noteLine({ dir, plan, outbox, now, fs })),
    // Partner answers: the partner is woken once per ask routed to it, while it is free (the reconciler). B392: once
    // more when it is still open ten minutes on, but never beside a line about it that still waits to be taken, nor
    // within ten minutes of the last one (a partner busy until then was just woken).
    ...(plan.partnerAsks ?? [])
      // B465, the review: the board's sync check's line about the ask counts too.
      .filter(one => one.again !== true || !outbox.outbox().some(message => (message.kind === 'partner-ask' || String(message.syncKey ?? '').startsWith('partner-ask ')) && message.about === one.id
        && (message.state === 'waiting' || now - (message.at ?? 0) < PARTNER_AGAIN_MS)))
      .map(one => ({ key: partnerAskKey(one.id, one.chat, one.again === true), words: { ...workWords(one.chat, one.id, partnerAskWords(one.id)), kind: 'partner-ask' } })),
    // Incident fixes: the main chat's one information line per placement of the board's, this refresh's first.
    ...placed,
    ...(plan.boardLines ?? []).map(one => ({ key: one.key, words: { ...workWords(one.chat, one.id, one.text), kind: 'board-queued' } })),
    // The review: a ready incident fix its standard holds, once to the main chat and once to the partner.
    ...(plan.heldFixes ?? []).flatMap(one => one.chats.map(chat => ({ key: `fix-held ${one.id} ${chat}`, words: { ...workWords(chat, one.id, one.text), kind: 'fix-held' } }))),
  ]
  for (const one of lines) {
    const sent = await sendOnce({ dir, key: one.key, words: one.words, outbox, state, now, maxChars, newId, fs, keep })
    if (sent !== null) done.sent.push(sent)
  }
  // B468: the words that have the main chat set a worker's effort (effort.mjs, `effortPlan`), and since model per step
  // its model with it: not when the newest word for the chat is one for the same setting of the last half hour, also
  // when two refreshes plan it before the state shows it.
  for (const one of plan.efforts ?? []) {
    const last = lastWord(outbox.outbox(), one.chat, state.chatPrefix ?? '')
    if ((last !== undefined && sameTarget(last, one.level, one.model ?? null) && now - last.at < AGAIN_MS) || one.to === null) continue
    const message = { id: newId(), at: now, ...effortWords(one), state: 'waiting' }
    try {
      await outbox.say(message)
      done.sent.push(message)
    } catch {
      // Planned again at the next refresh.
    }
  }
  // B570: the words that have a chat on an older Workers mod restarted (modRollout.mjs): not when a word for the same chat
  // and version went in the last half hour, also when two refreshes plan it before the state shows it. A word to a
  // partner that does not run makes the board ask the main chat to start it (say.mjs wakeFor).
  for (const one of plan.restarts ?? []) {
    const twin = outbox.outbox().findLast(message => message.command === RESTART_COMMAND && message.about === one.chat && message.version === one.installed)
    if (twin !== undefined && now - twin.at < RESTART_AGAIN_MS) continue
    const message = { id: newId(), at: now, ...restartWords(one), state: 'waiting' }
    const start = wakeFor(message, state, outbox.outbox(), now, maxChars)
    const wake = start === null ? null : { id: newId(), at: now, ...start, state: 'waiting' }
    try {
      await outbox.say(wake === null ? message : { ...message, wake: wake.id })
      if (wake !== null) await outbox.say(wake)
      done.sent.push(message)
    } catch {
      // Planned again at the next refresh.
    }
  }
  return done
}
