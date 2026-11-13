// The Workers mod release 0.32.0, the rollout's guard rebuilt as a JOURNAL (chat 1's decision after its second verifier,
// 2026-11-13): an archived real chat must always come back (the account-switch lesson). The board restarts a chat for a
// new mod by having its restarter archive and unarchive it; a restart cut off in between (the app's update, a board
// restart, the restarter's process ending) leaves the chat archived and invisible, and archiving the main chat takes the
// chats it started along. Inference from snapshots, live mod calls and wall-clock windows kept producing holes, so:
//
// - When a restart word first shows in the outbox, the journal takes a RECORD: the word's id and every chat of the
//   project open at that moment, by session (the main chat, every worker, the side chats: whatever that archive can take).
// - Each refresh, for every record whose word reached its restarter: a session still archived, never seen open since the
//   word reached, gets its restarter an `unarchive chat` word, UNARCHIVE_TRIES times at most, UNARCHIVE_AGAIN_MS apart,
//   after UNARCHIVE_AFTER_MS of grace; the tries are counted ON the record (the words' ids), no wall clock.
// - A session leaves the record once it is seen open again (the restart finished, or the person unarchived it), when its
//   app file is gone, when the board or the person removed it (a `remove` word about it after the word reached, or its
//   card says left), or when its tries are spent and the last one waited its turn (given up: the person archived it).
// - A record whose word was lost (failed, dropped, expired: no archive happened) goes; one whose every session left goes.
//   The journal is data/rollout.json: it survives the board's restarts and gaps, and nothing in it counts the clock.
// PURE: `journalNext` takes the journal and the facts and gives back the next journal and the words to send.

import { UNARCHIVE_AFTER_MS, UNARCHIVE_AGAIN_MS, UNARCHIVE_COMMAND, RESTART_COMMAND, RESTART_TRIES } from './modRollout.mjs'
import { isInside } from '../appChats.mjs'

/** At most this many unarchive words per session and restart, counted on the record. */
export const UNARCHIVE_TRIES = RESTART_TRIES
const LOST = ['expired', 'failed', 'dropped']
const DONE = ['open', 'gone', 'removed', 'given up']

export const emptyJournal = () => ({ records: [] })

/** The journal as its file holds it, or null for anything else. */
export function journalOfFile(value) {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.records)) return null
  const records = value.records.filter(one => one !== null && typeof one === 'object' && typeof one.word === 'string' && Array.isArray(one.chats)).map(one => ({
    word: one.word,
    about: typeof one.about === 'string' ? one.about : '',
    at: Number.isFinite(one.at) ? one.at : 0,
    chats: one.chats.filter(chat => chat !== null && typeof chat === 'object' && typeof chat.session === 'string').map(chat => ({
      name: typeof chat.name === 'string' ? chat.name : '',
      session: chat.session,
      state: typeof chat.state === 'string' ? chat.state : 'listed',
      asks: Array.isArray(chat.asks) ? chat.asks.filter(id => typeof id === 'string') : [],
      lastAskAt: Number.isFinite(chat.lastAskAt) ? chat.lastAskAt : null,
    })),
  }))
  return { records }
}

export const journalText = journal => JSON.stringify({ records: journal.records }, null, 1)

const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim()
}
const reachedAt = message => (Number.isFinite(message.deliveredAt) ? message.deliveredAt : Number.isFinite(message.settledAt) ? message.settledAt : message.at)
const isReached = message => !LOST.includes(message.state) && message.state !== 'waiting' && message.state !== 'taken' && message.state !== 'held'
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

/**
 * The journal brought up to date with the outbox (`sent`: every word, outboxNow's view), the app's chats (`apps`, open and
 * archived), the project and the prefix, now, and the restarters (`main`, `partner`: names from the LIST of chats, the main
 * chat archived or not; `left`: the names whose card says they left the list). Answers `{ journal, words }`: the next journal
 * and the unarchive words due now, `[{ to, chat, session, why, record }]` (modRollout.mjs `unarchiveWords` input).
 */
export function journalNext(journal, { sent = [], apps = [], project = '', prefix = '', now, main = null, partner = null, left = [] }) {
  const words = []
  const byWord = new Map(sent.map(message => [message.id, message]))
  const records = journal.records.map(record => ({ ...record, chats: record.chats.map(chat => ({ ...chat, asks: [...chat.asks] })) }))
  // New restart words take a record: the chats open at this moment, whatever the restarter's archive can take along.
  for (const message of sent) {
    if (message.command !== RESTART_COMMAND || LOST.includes(message.state) || records.some(record => record.word === message.id)) continue
    const open = openChatsOf(apps, { project, prefix })
    if (open.length === 0) continue
    // `listed`: not judged yet; `open` once seen open after the word reached (the restart finished), the other states below.
    records.push({ word: message.id, about: plain(message.about, prefix), at: message.at, chats: open.map(chat => ({ name: chat.name, session: chat.session, state: 'listed', asks: [], lastAskAt: null })) })
  }
  const next = []
  for (const record of records) {
    const message = byWord.get(record.word)
    // A word lost before it reached its restarter made no archive; one the outbox no longer knows with nothing pending is done with.
    if (message !== undefined && LOST.includes(message.state) && !record.chats.some(chat => chat.asks.length > 0)) continue
    const reached = message !== undefined && isReached(message) ? reachedAt(message) : record.chats.some(chat => chat.asks.length > 0) ? record.at : null
    if (reached === null) {
      if (message === undefined) continue
      next.push(record)
      continue
    }
    const removes = sent.filter(one => one.command === 'remove' && one.at >= reached)
    for (const chat of record.chats) {
      if (DONE.includes(chat.state)) continue
      // The tries this record's words made for this session, by their ids (the outbox may forget them; the record does not).
      for (const ask of sent.filter(one => one.command === UNARCHIVE_COMMAND && one.record === record.word && one.session === chat.session)) {
        if (!chat.asks.includes(ask.id)) {
          chat.asks.push(ask.id)
          chat.lastAskAt = Math.max(chat.lastAskAt ?? 0, ask.at)
        }
      }
      const file = apps.find(one => one?.sessionId === chat.session)
      if (file === undefined) {
        chat.state = 'gone'
        continue
      }
      if (file.isArchived !== true) {
        chat.state = 'open'
        continue
      }
      if (removes.some(one => plain(one.about, prefix).toLowerCase() === chat.name.toLowerCase()) || left.some(name => plain(name, prefix).toLowerCase() === chat.name.toLowerCase())) {
        chat.state = 'removed'
        continue
      }
      chat.state = 'archived'
      if (chat.asks.length >= UNARCHIVE_TRIES) {
        if (chat.lastAskAt !== null && now - chat.lastAskAt >= UNARCHIVE_AGAIN_MS) chat.state = 'given up'
        continue
      }
      if (now - reached < UNARCHIVE_AFTER_MS || (chat.lastAskAt !== null && now - chat.lastAskAt < UNARCHIVE_AGAIN_MS)) continue
      const isMain = main !== null && chat.name.toLowerCase() === plain(main, prefix).toLowerCase()
      const to = isMain ? partner : main
      if (to === null || to === undefined || plain(to, prefix).toLowerCase() === chat.name.toLowerCase()) continue
      words.push({ to, chat: chat.name, session: chat.session, record: record.word, why: `${chat.name} is still archived ${Math.floor((now - reached) / MIN)} min after its restart for the mod (asked at ${clockOf(reached)}): unarchive it, archive nothing` })
    }
    if (record.chats.some(chat => !DONE.includes(chat.state))) next.push(record)
  }
  return { journal: { records: next }, words }
}

/** The open sessions among the app's chats (for the outbox's sweep: an unarchive word whose chat is open again is moot). */
export const openSessionsOf = apps => apps.filter(chat => chat?.isArchived !== true && typeof chat?.sessionId === 'string').map(chat => chat.sessionId)
