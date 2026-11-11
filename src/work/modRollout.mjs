// B570: a new Workers mod reaches the chats between their steps, without the person restarting anything. The person,
// 2026-10-24 (I95): "it happens too often a mod needs to upgrade and i dont want to restart all the chats manually. it's
// very disruptive, is there a way chats get signalled and they auto update mods between steps?" A chat takes a new mod
// only when its process starts anew; an idle chat is restarted alone by archiving and unarchiving it in the app (its
// process ends, its next word starts it on the installed mod, nothing is spent until then). A chat cannot do that to
// itself, so the board asks: the main chat for every chat, the partner for the main chat. Only an idle chat is asked
// for (its turn ended, nothing in the background, no step in progress). T8.5 step 6: not a worker any more: a worker on
// the hand-over sequence restarts by its envelope (`restart`, handover.mjs), and nothing holds a worker's line here. PURE.

import { FIRST_SAYING, isOlder, versionOf } from '../oldMods.mjs'

const MIN = 60_000
/** The word for the same chat and version goes again after this long, when the chat still runs the older mod. */
export const RESTART_AGAIN_MS = 30 * MIN
/** At most this many words per chat and installed version; after them the person is shown it (oldMods.mjs). */
export const RESTART_TRIES = 3
/** The outbox command of the word. */
export const RESTART_COMMAND = 'mod-restart'
/** The Workers mod release 0.32.0 (chat 1's review): the word that has a chat still archived after its restart for the mod unarchived. */
export const UNARCHIVE_COMMAND = 'mod-unarchive'
/** A chat archived this long after the restart word went (the archive done, the unarchive not: a restart of the board or of the restarter in between) gets the word. */
export const UNARCHIVE_AFTER_MS = 5 * MIN
/** The word goes again after this long while the chat is still archived. */
export const UNARCHIVE_AGAIN_MS = 30 * MIN
/** A restart word older than this is no longer the cause of an archive. */
const RESTART_WORD_KEPT_MS = 24 * 60 * MIN
/** A chat the board showed as a lane within this long, archived now right after a restart word to another chat, went with that archive. */
export const RECENT_LANE_MS = 60 * MIN

const HOLDS = ['taken', 'in progress', 'waiting on you']
const LOST = ['expired', 'failed', 'dropped']
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const clockOf = ms => { const at = new Date(ms); return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` }
const valueOf = (item, key) => {
  const found = item?.head?.get(key)
  return found === undefined || found === '' || found === '-' ? null : found
}

/**
 * The word that asks `to` (the restarter: the main chat, the partner for the main chat) to unarchive `chat`, which stayed archived
 * after its restart for the mod (the account-switch lesson: an archived real chat must always come back). One message of the outbox.
 */
export function unarchiveWords({ to, chat, session, why }) {
  const id = typeof session === 'string' && /^[\w-]{1,80}$/.test(session) ? [`Session: ${session}`] : []
  return { to, ask: null, step: null, title: null, version: null, verdict: null, command: UNARCHIVE_COMMAND, about: chat, text: ['unarchive chat', `Chat: ${chat}`, ...id, `Why: ${why}`].join('\n') }
}

/**
 * The chats still archived in the app a while after the board's restart word for them (`archived`: the app's archived chats of the
 * project, `{ name, session }` each, the name without the prefix): a word to the restarter for each, `[{ to, chat, session, why }]`,
 * once per UNARCHIVE_AGAIN_MS while it stays archived; none for a chat with no restart word of the last day (the person archived it),
 * none for the first UNARCHIVE_AFTER_MS after the restart word (the restarter is at it). The outbox is the memory across the board's
 * restarts (its words are kept a day): nothing else needs a file.
 */
export function archivedAfterRestart({ archived = [], sent = [], now, main = null, partner = null, prefix = '', recent = [] }) {
  const words = []
  // A restart word that reached its restarter (typed, delivered, done): one still waiting or taken did not make the archive.
  const restarts = sent.filter(message => message.command === RESTART_COMMAND && now - message.at < RESTART_WORD_KEPT_MS && !LOST.includes(message.state) && message.state !== 'waiting' && message.state !== 'taken')
  for (const chat of archived) {
    if (typeof chat?.name !== 'string' || chat.name.trim() === '') continue
    // Its own restart word; else (the review: archiving the main chat archives the chats it started) any restart word of the last hour,
    // when the board showed this chat as a lane within the hour (`recent`): it went with its restarter's archive.
    const own = restarts.filter(message => plain(message.about, prefix) === plain(chat.name, prefix)).at(-1)
    const withMain = own === undefined && main !== null && recent.some(name => plain(name, prefix) === plain(chat.name, prefix)) ? restarts.filter(message => now - message.at < RECENT_LANE_MS && plain(message.about, prefix) === plain(main, prefix)).at(-1) : undefined
    const restart = own ?? withMain
    if (restart === undefined || now - restart.at < UNARCHIVE_AFTER_MS) continue
    const asked = sent.filter(message => message.command === UNARCHIVE_COMMAND && plain(message.about, prefix) === plain(chat.name, prefix) && message.at >= restart.at)
    const last = asked.at(-1)
    // The review: at most RESTART_TRIES words per restart (a chat the person archived on purpose is not asked for all day).
    if ((last !== undefined && now - last.at < UNARCHIVE_AGAIN_MS) || asked.length >= RESTART_TRIES) continue
    const to = main !== null && plain(chat.name, prefix) === plain(main, prefix) ? partner : main
    if (to === null || to === undefined || plain(to, prefix) === plain(chat.name, prefix)) continue
    const minutes = Math.floor((now - restart.at) / MIN)
    words.push({ to, chat: chat.name, session: chat.session ?? null, why: `${chat.name} is still archived ${minutes} min after its restart for the mod (asked at ${clockOf(restart.at)}): unarchive it, archive nothing` })
  }
  return words
}

/**
 * The word that asks `to` (the main chat, or the partner for the main chat) to restart `chat` (its app session
 * `session` when the board knows it) so it takes the Workers mod `installed` instead of `runs`. One message of the outbox.
 */
export function restartWords({ to, chat, session, runs, installed, why }) {
  const id = typeof session === 'string' && /^[\w-]{1,80}$/.test(session) ? [`Session: ${session}`] : []
  return {
    to, ask: null, step: null, title: null, version: installed, verdict: null, command: RESTART_COMMAND, about: chat, runs,
    text: ['restart for mod', `Chat: ${chat}`, ...id, `From: ${runs}`, `To: ${installed}`, `Why: ${why}`].join('\n'),
  }
}

/**
 * The chats to bring onto the installed Workers mod, and how. `mods` is `{ installed, chats }` (the version each chat's
 * mod said lately, by name; null: older than FIRST_SAYING). `chats` are the board's chats by role (oldMods.mjs
 * chatsByRole: `name`, `role`, `state`, `isRunning`, `session`, `idleSince`), `items` the store's items, `sent` the outbox, `main` and `partner` the names of the chats that restart (null:
 * none on the board).
 *
 * A chat on an older mod that is idle (free, its process running, no step taken or in progress) gets a word to its
 * restarter: the partner for the main chat, the main chat for every other. Again after RESTART_AGAIN_MS while it still
 * runs the older mod, RESTART_TRIES times at most. A chat that holds a step "restarts after its step".
 * T8.5 step 6: a worker (role 'worker') gets no word here: one on the hand-over sequence restarts by its envelope, and one
 * on a mod older than the sequence's (handover.mjs HANDOVER_MOD) is handed nothing until its chat is restarted by hand
 * (`status` 'by-hand', its lane says so).
 *
 * `{ words: [restartWords input], runs: Map<chat, { runs, installed, status, text }> }`, `status` 'after-step', 'asked',
 * 'due', 'tried', 'by-hand' or 'none' (nobody to restart it).
 */
export function rolloutPlan({ mods, chats = [], items = new Map(), sent = [], now, main = null, partner = null, prefix = '' }) {
  const words = []
  const runs = new Map()
  const installed = versionOf(mods?.installed)
  if (installed === null) return { words, runs }
  const said = mods?.chats ?? {}
  const steps = [...items.values()].filter(item => (valueOf(item, 'Kind') ?? 'step') === 'step')
  const owned = (item, name) => plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix)
  const seen = new Set()
  for (const chat of chats) {
    if (typeof chat?.name !== 'string' || seen.has(chat.name) || !Object.hasOwn(said, chat.name)) continue
    seen.add(chat.name)
    const version = said[chat.name]
    const isOld = version === null ? !isOlder(installed, versionOf(FIRST_SAYING)) : versionOf(version) !== null && isOlder(versionOf(version), installed)
    if (!isOld) continue
    const was = version === null ? `older than ${FIRST_SAYING}` : version
    const by = chat.role === 'main' ? partner : main
    const holding = steps.find(item => owned(item, chat.name) && HOLDS.includes(valueOf(item, 'State')))
    const info = { runs: was, installed: mods.installed }
    if (holding !== undefined) {
      runs.set(chat.name, { ...info, status: 'after-step', text: `Workers mod ${was}: restarts after ${valueOf(holding, 'Id')}` })
      continue
    }
    if (chat.role === 'worker') {
      runs.set(chat.name, { ...info, status: 'by-hand', text: `Workers mod ${was}: gets no task until its chat is restarted on ${mods.installed}` })
      continue
    }
    const isIdle = chat.state === 'free' && chat.isRunning === true
    if (!isIdle) {
      runs.set(chat.name, { ...info, status: 'after-step', text: `Workers mod ${was}: restarts once it is free` })
      continue
    }
    if (by === null || plain(by, prefix) === plain(chat.name, prefix)) {
      runs.set(chat.name, { ...info, status: 'none', text: `Workers mod ${was}: no ${chat.role === 'main' ? 'partner' : 'main chat'} on the board to restart it` })
      continue
    }
    const mine = sent.filter(message => message.command === RESTART_COMMAND && plain(message.about, prefix) === plain(chat.name, prefix) && message.version === mods.installed)
    const last = mine.at(-1)
    const isDue = last === undefined || (now - last.at >= RESTART_AGAIN_MS && mine.length < RESTART_TRIES)
    const why = `${chat.name} is idle and runs Workers mod ${was}; ${mods.installed} is installed`
    if (isDue) words.push({ to: by, chat: chat.name, session: chat.session ?? null, runs: was, installed: mods.installed, why })
    const status = isDue ? 'due' : mine.length >= RESTART_TRIES && now - last.at >= RESTART_AGAIN_MS ? 'tried' : 'asked'
    runs.set(chat.name, {
      ...info, status,
      text: status === 'due' ? `Workers mod ${was}: ${by} is asked to restart it`
        : status === 'asked' ? `Workers mod ${was}: ${by} was asked to restart it at ${clockOf(last.at)}`
          : `Workers mod ${was}: asked ${mine.length} times, still not restarted`,
    })
  }
  return { words, runs }
}
