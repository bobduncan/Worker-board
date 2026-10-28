// The bridge: how what the person answered or typed on the board reaches a chat. The Workers mod runs in every
// chat of the project; it finds the board through `<project>\.claude\board.json`, takes what waits for its own
// chat (`POST /api/bridge/take`), types it there as the person's own words, and says what it typed
// (`POST /api/bridge/typed`). Taking marks a message taken before it is handed out, so nothing is ever typed
// twice. Nothing can be sent through the bridge: sending needs the board's own page.

import { parseReport } from './chatReport.mjs'
import { pictureLine } from './talkPicture.mjs'

const refuse = (status, why) => ({ ok: false, status, why })

/**
 * The chats the board shows by name: the lanes (no leftover), the partner, its helper (B424) and the supervisor's chat
 * (spec 2026-10-24); each takes its own words and works with the work tool.
 */
export const shownChats = state => [
  ...(state.chats ?? []).filter(one => !one.isLeftover), ...(state.advisor ? [state.advisor] : []), ...(state.advisorHelper ? [state.advisorHelper] : []),
  ...(state.supervisorChat ? [state.supervisorChat] : []),
]

/**
 * What the mod asks: the messages for the chat it runs in. It gives the chat's name and its session's id, and it
 * is served only when the board shows that very session under that name: of two chats with one title, or an old
 * and a new one, only the one on the board takes. `state` is the board's state.
 */
/**
 * B566 (X22: Workers 1, 2 and 4 shown "its chat does not run" while they ran: the board knew a chat runs only by its
 * takes, 30 seconds apart at most): every accepted call of a chat to the bridge (a take, a work call, a typed report)
 * says its process runs. `seen` is the server's record (`shown`: by the name the board shows; null without a bridge).
 */
export function noteCall(seen, body, checked, now) {
  if (seen === null || seen === undefined || checked?.ok !== true) return
  const name = typeof checked.chat === 'string' ? checked.chat : typeof body?.chat === 'string' ? body.chat.trim().slice(0, 80) : null
  if (name !== null && name !== '') seen.shown[name] = now
}

/**
 * Redesign Part 1: a chat's own report of its turn state (busy, idle, asking), from `POST /api/bridge/report` or the
 * `report` its take carries. Kept by the name the board shows, and only for the session it shows under that name
 * (`checked`, the take's check): another session under the name (a renamed or replaced chat) never writes over it.
 * `reports` is the server's Map. True when a report was kept.
 */
export function noteReport(reports, body, checked, now) {
  if (reports === null || reports === undefined || checked?.ok !== true || typeof checked.chat !== 'string') return false
  const report = parseReport(body?.report, now)
  if (report === null) return false
  const session = typeof body?.session === 'string' ? body.session.trim() : ''
  const mod = typeof body?.mod === 'string' ? body.mod : null
  const kept = reports.get(checked.chat)
  const isSame = kept !== undefined && kept.session === session && kept.run !== null && kept.run === report.run
  // The review of chat-reports (principle 5): two reports can arrive out of order; one of a lower `seq` than the kept one
  // of the same session and process changes nothing but when the chat was last heard. A new session or process starts
  // fresh; no clock is compared.
  if (isSame && kept.seq !== null && report.seq !== null && report.seq < kept.seq) {
    reports.set(checked.chat, { ...kept, at: now, mod })
    return true
  }
  // When the board heard the chat's last turn start (busy after idle, ended or nothing; not after its question), kept
  // through the turn and its end: a step it moved to review or done since then is its last turn's (B148, state.mjs).
  const isSameSession = kept !== undefined && kept.session === session
  const isTurnStart = report.state === 'busy' && (!isSameSession || kept.state === 'idle' || kept.state === 'ended')
  const busyAt = isTurnStart ? now : isSameSession ? kept.busyAt ?? null : null
  reports.set(checked.chat, { ...report, at: now, session, mod, busyAt })
  return true
}

/** The report call's answer: refused as a take is (400, 409), 400 for no report, else the report is kept. */
export function answerReport(reports, body, checked, now) {
  if (!checked.ok) return checked
  return noteReport(reports, body, checked, now) ? { ok: true, result: { ok: true } } : refuse(400, 'Not a report: its state is busy, idle, asking or ended.')
}

/**
 * 2026-10-28 (the person: "'which chat you' are by session id even seems more robust"): the name the board shows a
 * session under, for `POST /api/bridge/whoami`; null when the session is no chat of the list. It reads the chats a take is
 * checked against (`shownChats`, the app's chat list with each chat's `cliSessionId`), so the answer is the name the
 * refusal of a take would give (`notShown`): a name that is empty or too long for the mod to take is no name.
 */
export function whoamiOf(state, session) {
  const id = typeof session === 'string' ? session.trim() : ''
  if (id === '' || id.length > 120) return null
  const name = shownChats(state).find(one => (one.session ?? null) === id)?.name
  const shown = typeof name === 'string' ? name.trim() : ''
  return shown === '' || shown.length > 80 ? null : shown
}

/** The session a whoami call names, trimmed; null when it names none (or one too long to be a session id). */
export function whoamiSession(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const session = typeof body.session === 'string' ? body.session.trim() : ''
  return session === '' || session.length > 120 ? null : session
}

/**
 * The whoami call's answer: `{ name, role, card }`. `name`: the name the board shows the session under (null for a session
 * of no chat of the list), `role` the one it gives that chat (main, worker, advisor, helper or supervisor, as the work
 * store does), `card` (`cardSession`, read from the project's files by the caller) the session the chat's card is filed
 * under when that is another than the asking one, else null. 400 for no session.
 */
export function answerWhoami(state, body, cardSession = null) {
  const session = whoamiSession(body)
  if (session === null) return refuse(400, body !== null && typeof body === 'object' && !Array.isArray(body) ? 'Name the session.' : 'Not a request.')
  const name = whoamiOf(state, session)
  return { ok: true, result: { name, role: name === null ? null : laneRole(state, name), card: name === null ? null : cardSession } }
}

/** The sessions the board shows under a name: a card filed under one of them is that chat's, never another chat's. */
export const shownSessions = state => new Set(shownChats(state).map(one => one.session).filter(session => typeof session === 'string' && session !== ''))

/**
 * 2026-10-28 (a worker cleared in a new process: its card stayed under the old session): the session the card of the chat
 * called `name` is filed under, when it is not `session`, the one that asks. `rows` are the files of `.claude/chats`
 * (`{ session, text }`, src/chatCards.mjs). Only a card counts: a file of a chat that left the list (`left`), or one that
 * says where its chat went on (`movedTo`) describes no chat; nor one filed under a session the board shows under a name
 * (`shown`: another chat's card). The newest by its own `at` when several of the name remain; null for none.
 */
export function cardSessionOf(rows, { name, session, shown = new Set() }) {
  const wanted = String(name ?? '').trim().toLowerCase()
  if (wanted === '') return null
  const found = []
  for (const row of rows) {
    if (row.session === session || shown.has(row.session)) continue
    let card
    try {
      card = JSON.parse(row.text)
    } catch {
      continue
    }
    if (card === null || typeof card !== 'object' || Array.isArray(card) || card.left === true || 'movedTo' in card) continue
    if (typeof card.name !== 'string' || card.name.trim().toLowerCase() !== wanted) continue
    found.push({ session: row.session, at: Number.isFinite(card.at) ? card.at : 0 })
  }
  found.sort((a, b) => b.at - a.at || (a.session < b.session ? -1 : 1))
  return found[0]?.session ?? null
}

/**
 * 2026-10-28: a whoami call says its mod runs, as every accepted call of the bridge does (`noteCall`). A session the board
 * shows under a name counts under it (`seen.shown`, also for the chat's own lane); one it shows under none has no name
 * to count under, so it counts in `seen.other` under a key no chat's name can be (`session <id>`): the board still knows
 * a mod runs (`isBridgeMissing`), and no lane reads it.
 */
export function noteWhoami(seen, session, name, now) {
  if (seen === null || seen === undefined) return
  if (typeof name === 'string' && name !== '') seen.shown[name] = now
  else seen.other[`session ${String(session).slice(0, 120)}`] = now
}

export function checkTake(body, state) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'Not a request.')
  const chat = typeof body.chat === 'string' ? body.chat.trim() : ''
  const session = typeof body.session === 'string' ? body.session.trim() : ''
  if (chat === '' || chat.length > 80 || session === '' || session.length > 120) return refuse(400, 'Name the chat and its session.')
  // B424: the partner's helper takes its words as the Advisor does.
  const shown = shownChats(state).find(one => one.name === chat)
  if (shown === undefined || (shown.session ?? null) !== session) return refuse(409, notShown(state, session))
  return { ok: true, chat }
}

/**
 * B463: the refusal of a name the board does not show a session under. A chat renamed in the app goes on under its old
 * name until it learns the new one, so the refusal says the name the board shows that session under, when it shows it
 * (the Workers mod joins under it and asks again, once). The name is written as a JSON string, so it stays exact.
 */
function notShown(state, session) {
  const why = 'Not the chat the board shows under that name.'
  const shown = shownChats(state)
  const mine = shown.find(one => (one.session ?? null) === session)
  const name = typeof mine?.name === 'string' ? mine.name.trim() : ''
  return name === '' || name.length > 80 ? why : `${why} The board shows this session as ${JSON.stringify(name)}.`
}

/**
 * Clear after each step: true for a session the board shows under no name (a chat the Workers mod just cleared goes
 * on under a new session id, which the board's state learns at its next reading). The board then reads anew once.
 */
export function isUnknownSession(body, state) {
  const session = typeof body?.session === 'string' ? body.session.trim() : ''
  const shown = shownChats(state)
  return session !== '' && !shown.some(one => (one.session ?? null) === session)
}

/** The role the board gives a chat of its list, as the work store does: main, worker, advisor, helper or supervisor; null for none. */
export function laneRole(state, name) {
  const roles = new Map((state.chats ?? []).filter(lane => !lane.isLeftover).map(lane => [lane.name, lane.isMain ? 'main' : 'worker']))
  if (state.advisor) roles.set(state.advisor.name, 'advisor')
  if (state.advisorHelper) roles.set(state.advisorHelper.name, 'helper')
  if (state.supervisorChat) roles.set(state.supervisorChat.name, 'supervisor')
  return roles.get(name) ?? null
}

const ROLE_WORDS = { main: 'the main chat', advisor: 'the partner', helper: "the partner's helper", supervisor: "the supervisor's chat" }

/**
 * Clear after each step: why the board does not keep the log of a chat the Workers mod wants to clear (and the mod
 * then does not clear it), or null: only a worker is cleared, and not while background work it started runs on
 * (`background`, what its transcript shows running), whose answer would come into a cleared conversation.
 */
export function clearRefusal(state, chat, background) {
  const role = laneRole(state, chat)
  if (role !== 'worker') return refuse(409, `${chat} is ${ROLE_WORDS[role] ?? 'no chat of the board'}: only a worker's conversation is cleared.`)
  if (background > 0) return refuse(409, 'Background work it started is still running: its answer would come into a cleared conversation.')
  return null
}

const ids = value => (Array.isArray(value) ? value : []).filter(id => typeof id === 'string' && id !== '').slice(0, 100)

/** B532: the most characters the Workers mod types as one word (its board.ts MOST_CHARS); a longer one it refuses. */
export const MOD_MOST_CHARS = 3000

/**
 * B532: what a take hands the mod: `messages` that fit, and the ids of those longer than the mod types (`refused`), each
 * with its why, so the board closes them failed for good at once instead of the mod refusing them unseen.
 */
export function fitsMod(handed, most = MOD_MOST_CHARS) {
  const over = handed.filter(one => one.text.trim().length > most)
  return {
    messages: handed.filter(one => !over.includes(one)),
    refused: over.map(one => one.id),
    why: Object.fromEntries(over.map(one => [one.id, `too long: ${one.text.trim().length} > ${most} characters`])),
  }
}

/** B532: why the mod could not type a word, per id of `of`: one plain line each, cut. */
const reasons = (value, of) => Object.fromEntries(of.filter(id => typeof value?.[id] === 'string' && value[id].trim() !== '')
  .map(id => [id, value[id].replace(/\s+/g, ' ').trim().slice(0, 200)]))

/**
 * What the mod reports after a take: the messages it typed into its chat, and the ones it could not type. B532: `why`
 * says why per id, `refused` names the ones it refused for good (too long, no text), which are not tried again.
 */
export function checkTyped(body, state) {
  const checked = checkTake(body, state)
  if (!checked.ok) return checked
  const failed = ids(body.failed)
  const refused = ids(body.refused)
  // B577: with the session that took them, so a word failed for a chat that was replaced goes to its new session.
  return { ...checked, typed: ids(body.typed), failed, refused, why: reasons(body.why, [...failed, ...refused]), session: body.session.trim() }
}

/** The file that tells the mod where the board is. It holds no words of a chat. */
// B753: `hands` says this board hands out start, wake and resume jobs to the chats' mods (src/hands.mjs); an older board
// does not, so no mod asks it.
export const bridgeNote = ({ port, key, at }) => JSON.stringify({ url: `http://127.0.0.1:${port}`, key, startedAt: at, hands: true })

/**
 * The words that are typed into the chat for a message. An answer says which request it is about and what the
 * person decided, with the one thing the chat is to do with it; a line typed to the advisor arrives as it is.
 * Every one is marked as coming from the board, with the time it was given (`clock(at)`, as "16:02"). B167: a
 * picture pasted with a line is named under its words by its full path (`where(path)`), so the chat can open it.
 */
export function messageText(message, clock, where = path => path) {
  const text = messageBody(message, clock, where)
  // B532: a word that waited for its chat (busy or closed) says how old it is, so the chat does not read it as new.
  return Number.isFinite(message.lateMs) && message.lateMs > 0 ? `${text}
(this word waited for you: sent ${ago(message.lateMs)} ago, at ${clock(message.at)})` : text
}

const ago = ms => (ms < 2 * 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 48 * 3_600_000 ? `${Math.round(ms / 3_600_000)} hours` : `${Math.round(ms / 86_400_000)} days`)

function messageBody(message, clock, where) {
  const words = (message.text ?? '').trim()
  // B173: a round of the board's clock is the clock's word, never the person's: it carries no mark of theirs.
  // B300: so is the work store's line that a step is the chat's ("work: B286 is yours; run work next").
  // The supervisor (spec 2026-10-24): so is its sweep word to the supervisor's chat. 2026-10-26: and the word that has a
  // worker go on with its step after a crash (say.mjs `resumesDue`): the board's, never the person's. B739: and the line that a
  // reported step's worker still has background work running (say.mjs `reportedBackgroundDue`). B742: and the line that the
  // week reached the person's stop line (say.mjs `weekStopDue`).
  if (message.command === 'round' || message.command === 'work' || message.command === 'sweep' || message.command === 'resume-step' || message.command === 'report-background' || message.command === 'week-stop') return words
  if ((message.ask ?? null) === null) {
    const picture = typeof message.picture === 'string' ? pictureLine(where(message.picture)) : null
    return `${[words, picture].filter(part => part !== null && part !== '').join('\n')}\n(typed on the worker board, ${clock(message.at)})`
  }

  const mark = `(answered on the worker board, ${clock(message.at)})`
  // A chat that simply waited asked in its own words: the answer needs no name.
  if (String(message.ask).startsWith('chat:')) return `${mark} ${words}`

  // The title comes from a file a chat wrote: it is kept to one short line without quotes, so it cannot pass
  // for more than the name of the request.
  const plain = value => String(value ?? '').replace(/["\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim()
  const title = `"${plain(message.title).slice(0, 200)}"`
  const step = plain(message.step).slice(0, 20)
  const what = step !== '' ? `${step} ${title}` : title
  const close = step !== '' ? 'Tick this step in the backlog.' : 'Close this request.'
  if (message.verdict === 'approve') return `${mark} ${what}: approved. ${words === '' ? '' : `Note: ${words}\n`}${close}`
  if (message.verdict === 'done') return `${mark} ${what}: done. ${words === '' ? '' : `Note: ${words}\n`}${close}`
  if (message.verdict === 'reject') {
    return `${mark} ${what}: rejected. Reason: ${words}\nPick this up: now if it belongs to what you are doing, else as a step in the queue.`
  }
  return `${mark} ${what}: ${words}`
}
