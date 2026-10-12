// Checks what the page sends before it is kept for delivery. What passes here will be typed into a chat as the
// person's own words, so it must be addressed to a chat on the board and, when it answers a request, fit that
// request: a verdict for work to verify, "done" for something only the person can do, words for a question.

const refuse = (status, why) => ({ ok: false, status, why })

/**
 * `body` is what the page posted; `state` is the board's state (its lanes, its advisor, its For you list).
 * Answers `{ ok: true, message }` with the parts to keep, or `{ ok: false, status, why }`.
 */
export function checkSay(body, state, maxChars) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'Not a message.')
  if (body.text !== undefined && typeof body.text !== 'string') return refuse(400, 'No text.')
  const text = (body.text ?? '').trim()
  if (text.length > maxChars) return refuse(413, `At most ${maxChars} characters.`)

  const names = (state.chats ?? []).filter(chat => !chat.isLeftover).map(chat => chat.name)
  if (state.advisor?.name) names.push(state.advisor.name)
  if (typeof body.to !== 'string' || !names.includes(body.to)) return refuse(400, 'No such chat on the board.')

  if (body.command !== undefined && body.command !== null) {
    // The two words for a restart of the app. The main chat does the rest: it asks the workers to stop at a safe
    // point and writes down who was on what, or brings them back. The words are the board's, never the page's.
    if (body.command !== 'prepare restart' && body.command !== 'resume' && body.command !== 'start') return refuse(400, 'No such command.')
    if (body.to !== state.restart?.main) return refuse(400, 'Only the main chat prepares, resumes and starts.')
    if (text !== '' || (body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
    // A name comes from a chat's title: it is kept to one short plain line.
    const plain = names => (names ?? []).map(name => String(name).replace(/\s+/g, ' ').trim().slice(0, 80))
    const blank = { to: body.to, ask: null, step: null, title: null, version: null, verdict: null }
    if (body.command === 'start') {
      // A chat that is not running takes nothing from the board. The main chat can start any chat through the
      // app, by the id the app knows it by; a chat that runs, or that the board cannot tell about, is left alone.
      const target = [...(state.chats ?? []).filter(chat => !chat.isLeftover), ...(state.advisor ? [state.advisor] : [])].find(chat => chat.name === body.chat)
      if (target === undefined || target.name === body.to || target.isRunning !== false) return refuse(409, 'That chat runs, or is not on the board.')
      const id = typeof target.appSession === 'string' && /^[\w-]{1,80}$/.test(target.appSession) ? ` Its session id: ${target.appSession}.` : ''
      const words = `start "${plain([target.name])[0].replace(/["\u201c\u201d]/g, '')}"\nIts chat is not running, and what the user answered or typed on the worker board waits for it. Start it by its session id, with one line that says the board holds something for it.${id}`
      return { ok: true, message: { ...blank, command: 'start', about: target.name, text: words } }
    }
    const cut = plain(state.restart?.interrupted)
    // A chat that is not running cannot be reached by its name: the main chat has to start it. Itself it knows.
    const down = plain((state.restart?.notRunning ?? []).filter(name => name !== body.to))
    const words = body.command !== 'resume' ? body.command : [
      'resume',
      cut.length > 0 ? `Cut off in the middle of a turn, as the worker board reads it: ${cut.join(', ')}.` : null,
      down.length > 0 ? `Not running, as the worker board reads it: ${down.join(', ')}.` : null,
    ].filter(line => line !== null).join('\n')
    return { ok: true, message: { ...blank, command: body.command, text: words } }
  }

  if (body.ask === undefined || body.ask === null) {
    if (body.verdict !== undefined && body.verdict !== null) return refuse(400, 'A verdict needs the request it is about.')
    if (text === '') return refuse(400, 'No text.')
    return { ok: true, message: { to: body.to, ask: null, step: null, title: null, verdict: null, text } }
  }

  const item = [...(state.forYou ?? []), ...(state.backlogForYou ?? [])].find(need => need.id === body.ask && need.from === body.to)
  if (item === undefined || !item.canAnswer) return refuse(409, 'That request is no longer open.')
  // The request as it stood when it was answered: a step that changes later asks again.
  const about = { to: body.to, ask: item.id, step: item.step ?? null, title: item.title, version: item.version ?? null }
  if (item.kind === 'do') {
    // Something only the person can do: all there is to say is that it is done.
    if (body.verdict !== 'done') return refuse(400, 'Say that it is done.')
    return { ok: true, message: { ...about, verdict: 'done', text } }
  }
  if (item.kind === 'verify') {
    if (body.verdict !== 'approve' && body.verdict !== 'reject') return refuse(400, 'Approve or reject.')
    if (body.verdict === 'reject' && text === '') return refuse(400, 'Say why you reject it.')
    return { ok: true, message: { ...about, verdict: body.verdict, text } }
  }
  if (body.verdict !== undefined && body.verdict !== null) return refuse(400, 'Only work to verify is approved or rejected.')
  if (text === '') return refuse(400, 'This needs your words.')
  return { ok: true, message: { ...about, verdict: null, text } }
}

/** The main chat is asked to start a chat at most this often. */
const WAKE_AGAIN_MS = 2 * 60_000
const WAKE_PENDING_MS = 10 * 60_000

/**
 * What the board adds when something was sent to a chat that is not running: the word to the main chat to start
 * it, so nothing waits for a closed chat without a word. Null when nothing is to be asked: the chat runs, the
 * main chat itself does not, or it was asked a moment ago. `outbox` is what was sent before.
 */
export function wakeFor(message, state, outbox, now, maxChars) {
  const main = state.restart?.main ?? null
  if (main === null || message.to === main || (message.command ?? null) !== null) return null
  if ((state.chats ?? []).find(chat => chat.name === main)?.isRunning === false) return null
  // Not again within two minutes; and while an earlier word still waits for the main chat, not for ten.
  const isOnItsWay = sent => (sent.state === 'waiting' || sent.state === 'taken') && now - sent.at < WAKE_PENDING_MS
  if (outbox.some(sent => sent.command === 'start' && sent.about === message.to && (now - sent.at < WAKE_AGAIN_MS || isOnItsWay(sent)))) return null
  const checked = checkSay({ to: main, command: 'start', chat: message.to }, state, maxChars)
  return checked.ok ? checked.message : null
}
