// Checks what the page sends before it is kept for delivery. What passes here will be typed into a chat as the
// person's own words, so it must be addressed to a chat on the board and, when it answers a request, fit that
// request: a verdict for work to verify, "done" for something only the person can do, words for a question.

import { isTalkPicture } from './talkPicture.mjs'

const refuse = (status, why) => ({ ok: false, status, why })

/** B124: why the board asks the main chat for workers, in the words it types. */
const SPAWN_WHY = { alone: 'no worker is in the list', button: 'asked with the button' }

/** B124: the word that asks the main chat for `count` workers. The main chat names, briefs and starts them. */
const spawnWords = (to, count, why) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'spawn', count, why,
  text: `spawn workers\nCount: ${count}\nWhy: ${SPAWN_WHY[why]}`,
})

const pad = value => String(value).padStart(2, '0')
const timeOfDay = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
/** A name or a title from a file a chat wrote: one short plain line without quotes. */
const plainLine = value => String(value ?? '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)

/**
 * B143: what a worker's lane says it is doing, in one line for the main chat ("working on B140 "Sheet", step 2 of
 * 4; 1 step queued for it: B141"), and whether it is free: free, and nothing queued for it. A worker the board
 * cannot read is not free either.
 */
export function workerState(lane) {
  const task = lane.task ?? null
  const what = task === null ? null : [task.stepId ?? null, task.text ? `"${plainLine(task.text)}"` : null].filter(Boolean).join(' ') || null
  const on = what === null ? '' : Number.isInteger(task.step) && Number.isInteger(task.steps) ? `${what}, step ${task.step} of ${task.steps}` : what
  const until = Number.isFinite(lane.suspended?.until) ? ` until ${timeOfDay(lane.suspended.until)}` : ''
  const words = {
    free: 'free',
    working: on === '' ? 'working' : `working on ${on}`,
    waiting: on === '' ? 'waiting for you' : `waiting for you, on ${on}`,
    suspended: `suspended for the limit${until}${on === '' ? '' : `, on ${on}`}`,
    interrupted: `cut off in the middle of its turn${on === '' ? '' : `, on ${on}`}`,
  }[lane.state] ?? 'unknown to the board'
  const queue = (lane.queue ?? []).map(step => step.id ?? `"${plainLine(step.title)}"`)
  const queued = queue.length === 0 ? '' : `; ${queue.length} ${queue.length === 1 ? 'step' : 'steps'} queued for it: ${queue.join(', ')}`
  return { words: `${words}${queued}`, isFree: lane.state === 'free' && queue.length === 0 }
}

/** B143: the word that asks the main chat to remove a worker: stop it at a safe point, take it out, hand its queue on. */
const removeWords = (to, name, state) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'remove', about: name,
  text: `remove worker\nName: ${name}\nState: ${state}\nWhy: removed with the button`,
})

/**
 * B181: the word that asks the main chat to hand out a step of the backlog that nobody has. The main chat picks the
 * worker or what the step waits for, and writes the step's "(for ...)" note; the board writes nothing into the
 * backlog. The title comes from the backlog: one plain line.
 */
const queueWords = (to, step) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'queue', about: step.id,
  text: `queue step from the backlog\nStep: ${step.id} ${String(step.title ?? '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)}`,
})

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
  // B167: a picture pasted into Talk to Main, which the board kept beforehand: one of its own names, to the main chat,
  // with a plain message.
  const picture = body.picture ?? null
  if (picture !== null) {
    if (!isTalkPicture(picture, state.pictures ?? 'pictures')) return refuse(400, 'That is no picture the board kept.')
    if (body.to !== state.restart?.main) return refuse(400, 'A picture goes to the main chat only.')
    if ((body.ask ?? null) !== null || (body.command ?? null) !== null) return refuse(400, 'A picture goes with a plain message only.')
  }

  if (body.command !== undefined && body.command !== null) {
    // The two words for a restart of the app. The main chat does the rest: it asks the workers to stop at a safe
    // point and writes down who was on what, or brings them back. The words are the board's, never the page's.
    if (!['prepare restart', 'resume', 'start', 'spawn', 'remove', 'queue'].includes(body.command)) return refuse(400, 'No such command.')
    if (body.to !== state.restart?.main) return refuse(400, 'Only the main chat prepares, resumes, starts and is asked for workers.')
    if (text !== '' || (body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
    // B181: a step of the backlog for the queue: one with an id that nobody has (not queued, not in progress, not
    // finished, not the person's), read from the board's own state; the page names the step's id only. One ask at a
    // time per step.
    if (body.command === 'queue') {
      const step = (state.backlog ?? []).flatMap(activity => activity.steps ?? []).find(one => typeof one.id === 'string' && one.id === body.step)
      if (step === undefined || step.status !== 'open') return refuse(409, 'That step is not open for the queue: it is queued, in progress, finished or yours.')
      if (step.queueAsk?.isOpen === true) return refuse(409, 'The main chat was already asked to queue this step.')
      return { ok: true, message: queueWords(body.to, step) }
    }
    // B124: the person asks for one more worker, or for three when there is none. One ask at a time.
    if (body.command === 'spawn') {
      if (state.workers?.ask?.isOpen === true) return refuse(409, 'An earlier ask for workers is still open.')
      return { ok: true, message: spawnWords(body.to, (state.workers?.count ?? 0) === 0 ? 3 : 1, 'button') }
    }
    // B143: the person removes a worker; the main chat is never removed this way. One ask at a time per worker,
    // and a worker that is not free only once the person confirmed the warning (`sure`). What it is doing is read
    // here, from the board's own state: the page names the worker only.
    if (body.command === 'remove') {
      const lane = (state.chats ?? []).find(chat => chat.name === body.chat && !chat.isLeftover && !chat.isMain)
      if (lane === undefined) return refuse(409, 'That is no worker on the board.')
      if (lane.removal?.isOpen === true) return refuse(409, 'An earlier ask to remove this worker is still open.')
      const now = workerState(lane)
      if (!now.isFree && body.sure !== true) return refuse(409, `This worker is not free (${now.words}): confirm the warning first.`)
      return { ok: true, message: removeWords(body.to, plainLine(lane.name), now.words) }
    }
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
    if (text === '' && picture === null) return refuse(400, 'No text.')
    return { ok: true, message: { to: body.to, ask: null, step: null, title: null, verdict: null, text, ...(picture === null ? {} : { picture }) } }
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

/**
 * B124: what the board asks by itself when the main chat is alone in the list: three workers. It asks once per
 * empty list: again only after a worker was there (the history, `lines`, holds one since that ask) and all went.
 * Only while the main chat's chat is open, so the word is taken and not lost; an ask that is still open, also
 * the person's, stands for it. `outbox` is everything sent, also long ago. Null when nothing is to be asked.
 */
export function spawnWhenAlone(state, outbox, lines) {
  const workers = state.workers ?? null
  const main = workers?.main ?? null
  if (main === null || workers.count > 0 || workers.ask?.isOpen === true) return null
  if ((state.chats ?? []).find(chat => chat.name === main)?.isRunning !== true) return null
  const asked = outbox.findLast(sent => sent.command === 'spawn' && sent.why === 'alone')
  if (asked !== undefined && !lines.some(line => line.gap !== true && line.chat !== main && line.at > asked.at)) return null
  return spawnWords(main, 3, 'alone')
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
