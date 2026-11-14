// The Workers mod release 0.32.0, the rollout's guard rebuilt as a JOURNAL (chat 1's decision after its second verifier,
// 2026-11-13; its verifier of the journal, 2026-11-14: a state machine per session): an archived real chat must always come
// back (the account-switch lesson). The board restarts a chat for a new mod by having its restarter archive and unarchive it;
// a restart cut off in between (the app's update, a board restart, the restarter's process ending) leaves the chat archived
// and invisible, and archiving the main chat takes the chats it started along. Inference from snapshots, live mod calls and
// wall-clock windows kept producing holes, so:
//
// - When a restart word first shows in the outbox, the journal takes a RECORD: the word's id, its restarter, and every chat of
//   the project open at that moment, by session (the main chat, every worker, the side chats: whatever that archive can take).
//   While the word waits for its restarter the list is kept current: a session seen archived meanwhile (the person's, the
//   board's) leaves it, one opened meanwhile joins it; the moment the word reaches, the record keeps `reachedAt` and judges
//   from itself from then on, also once the outbox has forgotten the word.
// - Each session goes through its states: `listed` (open, not judged) -> `archived` (seen archived after the word reached) ->
//   `open` (seen open again after that: the restart finished, or the person unarchived it; done). A session still open and
//   never seen archived leaves only once the restarter's turn that carried the word has ended (its report after `reachedAt`
//   says idle or ended): a restarter cut off mid-turn never ends it, so what it archived gets its words. Also done: `gone`
//   (its app file missing from the folder, or unreadable on two looks in a row: one torn read is no verdict), `removed` (a
//   `remove` word about it since the restart word was made, or its card says left), `given up` (its tries spent and the last
//   one waited its turn: the person archived it on purpose).
// - A session `archived` gets its restarter an `unarchive chat` word after UNARCHIVE_AFTER_MS of grace, again UNARCHIVE_AGAIN_MS
//   after the last word that REACHED the restarter, UNARCHIVE_TRIES times in all per session, across records (a chat asked for
//   by two restarts is asked three times, not six); never while one of its words still waits. The asks are kept on the record
//   (ids, when, whether reached): the outbox may forget them, the record does not. No wall clock but the grace and the spacing.
// - A record whose word was lost before it reached (failed, dropped, expired: no archive happened) goes, as does one whose word
//   the outbox forgot before it reached; one whose every session left goes. The journal is data/rollout.json: it survives the
//   board's restarts and gaps.
// PURE: `journalNext` takes the journal and the facts and gives back the next journal and the words to send.

import { UNARCHIVE_AFTER_MS, UNARCHIVE_AGAIN_MS, UNARCHIVE_COMMAND, RESTART_COMMAND, RESTART_TRIES } from './modRollout.mjs'
import { isInside } from '../appChats.mjs'

/** At most this many unarchive words per session in all, counted on the records. */
export const UNARCHIVE_TRIES = RESTART_TRIES
/** An app file unreadable on this many looks in a row counts as gone. */
export const MISSING_LOOKS = 2
const LOST = ['expired', 'failed', 'dropped']
const PENDING = ['waiting', 'taken', 'held']
const DONE = ['open', 'gone', 'removed', 'given up']
const IDLE = ['idle', 'ended']

export const emptyJournal = () => ({ records: [] })

const askOf = one => (typeof one === 'string'
  ? { id: one, at: 0, reached: true }
  : one !== null && typeof one === 'object' && typeof one.id === 'string' ? { id: one.id, at: Number.isFinite(one.at) ? one.at : 0, reached: one.reached === true } : null)

/** The journal as its file holds it, or null for anything else. An older file's asks (ids alone) count as reached. */
export function journalOfFile(value) {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.records)) return null
  const records = value.records.filter(one => one !== null && typeof one === 'object' && typeof one.word === 'string' && Array.isArray(one.chats)).map(one => ({
    word: one.word,
    about: typeof one.about === 'string' ? one.about : '',
    to: typeof one.to === 'string' ? one.to : null,
    at: Number.isFinite(one.at) ? one.at : 0,
    reachedAt: Number.isFinite(one.reachedAt) ? one.reachedAt : null,
    chats: one.chats.filter(chat => chat !== null && typeof chat === 'object' && typeof chat.session === 'string').map(chat => ({
      name: typeof chat.name === 'string' ? chat.name : '',
      session: chat.session,
      state: typeof chat.state === 'string' ? chat.state : 'listed',
      asks: Array.isArray(chat.asks) ? chat.asks.map(askOf).filter(ask => ask !== null) : [],
      missing: Number.isInteger(chat.missing) ? chat.missing : 0,
    })),
  }))
  return { records }
}

export const journalText = journal => JSON.stringify({ records: journal.records }, null, 1)

const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim()
}
const same = (a, b, prefix) => plain(a, prefix).toLowerCase() === plain(b, prefix).toLowerCase()
const reachedAtOf = message => (Number.isFinite(message.deliveredAt) ? message.deliveredAt : Number.isFinite(message.settledAt) ? message.settledAt : message.at)
const isReached = message => !LOST.includes(message.state) && !PENDING.includes(message.state)
const pad = n => String(n).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const MIN = 60_000

/** The project's chats open in the app now (`apps`: parseAppChat's records): `{ name, session }` each, the name without the prefix. */
export function openChatsOf(apps, { project, prefix }) {
  if (typeof prefix !== 'string' || prefix === '') return []
  return apps
    .filter(chat => chat?.isArchived !== true && chat?.isStub !== true && typeof chat?.title === 'string' && chat.title.startsWith(prefix) && isInside(chat.cwd, project) && typeof chat.sessionId === 'string')
    .map(chat => ({ name: plain(chat.title, prefix), session: chat.sessionId }))
}

const listedChat = chat => ({ name: chat.name, session: chat.session, state: 'listed', asks: [], missing: 0 })

/**
 * The journal brought up to date with the outbox (`sent`: every word, outboxNow's view), the app's chats (`apps`, open and
 * archived; `appFiles`: the app ids of the files in the app's folder, read or not, null when not known), the project and the
 * prefix, now, the restarters (`main`, `partner`: names from the LIST of chats, the main chat archived or not; `left`: the names
 * whose card says they left the list), and `reportOf(name)`: a chat's latest report `{ state, since }` or null (the restarter's
 * turn ended: its report after the word reached says idle or ended). Answers `{ journal, words }`: the next journal and the
 * unarchive words due now, `[{ to, chat, session, why, record }]` (modRollout.mjs `unarchiveWords` input).
 */
export function journalNext(journal, { sent = [], apps = [], appFiles = null, project = '', prefix = '', now, main = null, partner = null, left = [], reportOf = () => null }) {
  const words = []
  const byWord = new Map(sent.map(message => [message.id, message]))
  const files = Array.isArray(appFiles) ? new Set(appFiles) : null
  const records = journal.records.map(record => ({ ...record, chats: record.chats.map(chat => ({ ...chat, asks: chat.asks.map(ask => ({ ...ask })) })) }))
  const open = openChatsOf(apps, { project, prefix })
  // New restart words take a record: the chats open at this moment, whatever the restarter's archive can take along.
  for (const message of sent) {
    if (message.command !== RESTART_COMMAND || LOST.includes(message.state) || records.some(record => record.word === message.id)) continue
    if (open.length === 0) continue
    records.push({ word: message.id, about: plain(message.about, prefix), to: typeof message.to === 'string' ? message.to : null, at: message.at, reachedAt: null, chats: open.map(listedChat) })
  }
  // The asks in the outbox, by record and session (the outbox may forget them; the records keep them).
  for (const ask of sent) {
    if (ask.command !== UNARCHIVE_COMMAND || typeof ask.record !== 'string' || typeof ask.session !== 'string') continue
    const chat = records.find(record => record.word === ask.record)?.chats.find(one => one.session === ask.session)
    if (chat === undefined) continue
    const kept = chat.asks.find(one => one.id === ask.id)
    if (kept === undefined) chat.asks.push({ id: ask.id, at: ask.at, reached: isReached(ask) })
    else kept.reached = kept.reached || isReached(ask)
  }
  const pendingIds = new Set(sent.filter(ask => ask.command === UNARCHIVE_COMMAND && PENDING.includes(ask.state)).map(ask => ask.id))
  // The tries per session across every record (chat 1's verifier, 3): a chat two restarts archived is asked three times in all.
  const asksOf = session => records.flatMap(record => record.chats.filter(chat => chat.session === session).flatMap(chat => chat.asks))
  const next = []
  const askedNow = new Set()
  for (const record of records) {
    const message = byWord.get(record.word)
    if (record.reachedAt === null) {
      // Not reached yet: lost (no archive happened) or forgotten before it reached: the record goes. Still waiting: the list is kept
      // current (chat 1's verifier, 2): a session archived meanwhile is no victim of this restart, one opened meanwhile may be.
      if (message === undefined || LOST.includes(message.state)) continue
      if (!isReached(message)) {
        const kept = record.chats.filter(chat => open.some(one => one.session === chat.session))
        for (const one of open) if (!kept.some(chat => chat.session === one.session)) kept.push(listedChat(one))
        next.push({ ...record, chats: kept })
        continue
      }
      record.reachedAt = reachedAtOf(message)
    }
    const reached = record.reachedAt
    // The restarter's turn that carried the word has ended: its report after the word reached says idle or ended.
    const restarter = record.to === null ? null : reportOf(record.to)
    const turnEnded = restarter !== null && restarter !== undefined && IDLE.includes(restarter.state) && Number.isFinite(restarter.since) && restarter.since >= reached
    // A removal counts from the word's making (the record lists the chats open then; the word's own time where the outbox still has it).
    const made = Math.min(record.at, Number.isFinite(message?.at) ? message.at : record.at)
    const removes = sent.filter(one => one.command === 'remove' && one.at >= made)
    for (const chat of record.chats) {
      if (DONE.includes(chat.state)) continue
      const file = apps.find(one => one?.sessionId === chat.session)
      if (file === undefined) {
        // Chat 1's verifier (5): one unreadable read is no verdict; missing from the folder, or missing on two looks in a row, is gone.
        chat.missing += 1
        if ((files !== null && !files.has(chat.session)) || chat.missing >= MISSING_LOOKS) chat.state = 'gone'
        continue
      }
      chat.missing = 0
      if (file.isArchived !== true) {
        // Seen open: done once it had been seen archived (the restart finished), or once the restarter's turn ended without archiving it.
        if (chat.state === 'archived' || turnEnded) chat.state = 'open'
        continue
      }
      if (removes.some(one => same(one.about, chat.name, prefix)) || left.some(name => same(name, chat.name, prefix))) {
        chat.state = 'removed'
        continue
      }
      chat.state = 'archived'
      const asks = asksOf(chat.session)
      const tries = asks.filter(ask => ask.reached)
      const lastReachedAt = tries.reduce((last, ask) => Math.max(last, ask.at), 0)
      if (tries.length >= UNARCHIVE_TRIES) {
        if (now - lastReachedAt >= UNARCHIVE_AGAIN_MS) chat.state = 'given up'
        continue
      }
      // Chat 1's verifier (4): no new word while one still waits for its restarter; the spacing counts from the last that reached.
      if (asks.some(ask => !ask.reached && pendingIds.has(ask.id))) continue
      if (now - reached < UNARCHIVE_AFTER_MS || (tries.length > 0 && now - lastReachedAt < UNARCHIVE_AGAIN_MS) || askedNow.has(chat.session)) continue
      const isMain = main !== null && same(chat.name, main, prefix)
      const to = isMain ? partner : main
      if (to === null || to === undefined || same(to, chat.name, prefix)) continue
      askedNow.add(chat.session)
      words.push({ to, chat: chat.name, session: chat.session, record: record.word, why: `${chat.name} is still archived ${Math.floor((now - reached) / MIN)} min after its restart for the mod (asked at ${clockOf(reached)}): unarchive it, archive nothing` })
    }
    if (record.chats.some(chat => !DONE.includes(chat.state))) next.push(record)
  }
  return { journal: { records: next }, words }
}

/** The open sessions among the app's chats (for the outbox's sweep: an unarchive word whose chat is open again is moot). */
export const openSessionsOf = apps => apps.filter(chat => chat?.isArchived !== true && typeof chat?.sessionId === 'string').map(chat => chat.sessionId)
