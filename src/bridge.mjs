// The bridge: how what the person answered or typed on the board reaches a chat. The Workers mod runs in every
// chat of the project; it finds the board through `<project>\.claude\board.json`, takes what waits for its own
// chat (`POST /api/bridge/take`) and types it there as the person's own words. Taking marks a message delivered
// before it is handed out, so nothing is ever typed twice. Nothing can be sent through the bridge: sending needs
// the board's own page.

const refuse = (status, why) => ({ ok: false, status, why })

/** What the mod asks: the messages for the chat it runs in, by the chat's name on the board. */
export function checkTake(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'Not a request.')
  const chat = typeof body.chat === 'string' ? body.chat.trim() : ''
  if (chat === '' || chat.length > 80) return refuse(400, 'Name the chat.')
  return { ok: true, chat }
}

/** The file that tells the mod where the board is. It holds no words of a chat. */
export const bridgeNote = ({ port, key, at }) => JSON.stringify({ url: `http://127.0.0.1:${port}`, key, startedAt: at })

/**
 * The words that are typed into the chat for a message. An answer says which request it is about and what the
 * person decided, with the one thing the chat is to do with it; a line typed to the advisor arrives as it is.
 * Every one is marked as coming from the board, with the time it was given (`clock(at)`, as "16:02").
 */
export function messageText(message, clock) {
  const words = (message.text ?? '').trim()
  if ((message.ask ?? null) === null) return `${words}\n(typed on the worker board, ${clock(message.at)})`

  const mark = `(answered on the worker board, ${clock(message.at)})`
  // A chat that simply waited asked in its own words: the answer needs no name.
  if (String(message.ask).startsWith('chat:')) return `${mark} ${words}`

  const title = `"${message.title ?? ''}"`
  const what = typeof message.step === 'string' && message.step !== '' ? `${message.step} ${title}` : title
  const close = typeof message.step === 'string' && message.step !== '' ? 'Tick this step in the backlog.' : 'Close this request.'
  if (message.verdict === 'approve') return `${mark} ${what}: approved. ${words === '' ? '' : `Note: ${words}\n`}${close}`
  if (message.verdict === 'done') return `${mark} ${what}: done. ${words === '' ? '' : `Note: ${words}\n`}${close}`
  if (message.verdict === 'reject') {
    return `${mark} ${what}: rejected. Reason: ${words}\nPick this up: now if it belongs to what you are doing, else as a step in the queue.`
  }
  return `${mark} ${what}: ${words}`
}
