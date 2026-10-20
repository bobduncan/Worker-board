// The bridge: how what the person answered or typed on the board reaches a chat. The Workers mod runs in every
// chat of the project; it finds the board through `<project>\.claude\board.json`, takes what waits for its own
// chat (`POST /api/bridge/take`), types it there as the person's own words, and says what it typed
// (`POST /api/bridge/typed`). Taking marks a message taken before it is handed out, so nothing is ever typed
// twice. Nothing can be sent through the bridge: sending needs the board's own page.

import { pictureLine } from './talkPicture.mjs'

const refuse = (status, why) => ({ ok: false, status, why })

/**
 * What the mod asks: the messages for the chat it runs in. It gives the chat's name and its session's id, and it
 * is served only when the board shows that very session under that name: of two chats with one title, or an old
 * and a new one, only the one on the board takes. `state` is the board's state.
 */
export function checkTake(body, state) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'Not a request.')
  const chat = typeof body.chat === 'string' ? body.chat.trim() : ''
  const session = typeof body.session === 'string' ? body.session.trim() : ''
  if (chat === '' || chat.length > 80 || session === '' || session.length > 120) return refuse(400, 'Name the chat and its session.')
  // B424: the partner's helper takes its words as the Advisor does.
  const shown = [...(state.chats ?? []).filter(one => !one.isLeftover), ...(state.advisor ? [state.advisor] : []), ...(state.advisorHelper ? [state.advisorHelper] : [])].find(one => one.name === chat)
  if (shown === undefined || (shown.session ?? null) !== session) return refuse(409, notShown(state, session))
  return { ok: true, chat }
}

/**
 * B463: the refusal of a name the board does not show a session under. A chat renamed in the app goes on under its old
 * name until it learns the new one, so the refusal says the name the board shows that session under, when it shows it
 * (the Workers mod joins under it and asks again, once). The name comes from a chat's title: one line, no quotes.
 */
function notShown(state, session) {
  const why = 'Not the chat the board shows under that name.'
  const mine = (state.chats ?? []).find(one => !one.isLeftover && (one.session ?? null) === session)
  const name = String(mine?.name ?? '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return name === '' ? why : `${why} The board shows this session as "${name}".`
}

const ids = value => (Array.isArray(value) ? value : []).filter(id => typeof id === 'string' && id !== '').slice(0, 100)

/** What the mod reports after a take: the messages it typed into its chat, and the ones it could not type. */
export function checkTyped(body, state) {
  const checked = checkTake(body, state)
  return checked.ok ? { ...checked, typed: ids(body.typed), failed: ids(body.failed) } : checked
}

/** The file that tells the mod where the board is. It holds no words of a chat. */
export const bridgeNote = ({ port, key, at }) => JSON.stringify({ url: `http://127.0.0.1:${port}`, key, startedAt: at })

/**
 * The words that are typed into the chat for a message. An answer says which request it is about and what the
 * person decided, with the one thing the chat is to do with it; a line typed to the advisor arrives as it is.
 * Every one is marked as coming from the board, with the time it was given (`clock(at)`, as "16:02"). B167: a
 * picture pasted with a line is named under its words by its full path (`where(path)`), so the chat can open it.
 */
export function messageText(message, clock, where = path => path) {
  const words = (message.text ?? '').trim()
  // B173: a round of the board's clock is the clock's word, never the person's: it carries no mark of theirs.
  // B300: so is the work store's line that a step is the chat's ("work: B286 is yours; run work next").
  if (message.command === 'round' || message.command === 'work') return words
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
