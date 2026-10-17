// Checks what the page sends before it is kept for delivery. What passes here will be typed into a chat as the
// person's own words, so it must be addressed to a chat on the board and, when it answers a request, fit that
// request: a verdict for work to verify, "done" for something only the person can do, words for a question.

import { isRefined } from './backlog.mjs'
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

/** B83: a step's id and title as the words name it: one plain line. */
const stepLine = step => `${step.id} ${String(step.title ?? '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)}`

/**
 * B83: the words that ask the main chat to stop a worker's task, to move a queued step to another worker, or to take
 * it out of its queue. The person, 2026-10-14: stop "A" (the worker reaches a safe point: work committed and pushed,
 * nothing new started) and "A" (the main chat makes the change: it writes the backlog and tells the worker).
 */
const stopWords = (to, name, task) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'stop', about: name,
  text: `stop task\nName: ${name}\nTask: ${task}\nWhy: stopped with the button`,
})
const moveWords = (to, step, from, target) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'move', about: step.id,
  text: `move step\nStep: ${stepLine(step)}\nFrom: ${from}\nTo: ${target}`,
})
const unqueueWords = (to, step, from) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'unqueue', about: step.id,
  text: `unqueue step\nStep: ${stepLine(step)}\nFrom: ${from}`,
})

/** B83: the worker whose queue holds the step with this id, and the step; null when no queue holds it. */
function queuedStep(state, id) {
  for (const lane of state.chats ?? []) {
    const step = (lane.queue ?? []).find(one => typeof one.id === 'string' && one.id === id)
    if (step !== undefined && !lane.isLeftover) return { lane, step }
  }
  return null
}

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
 * B233: the word that asks the Advisor to refine a step of the backlog: say the problem the step solves or its goal,
 * and ask what it needs to know, as the step's refine block (roles/advisor.md, "Refine a step"). `round` is the round
 * it writes; from round 2 on, the person's answers and feedback stand in the block already.
 */
export const refineWords = (to, step, round) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'refine', about: step.id, round,
  text: `refine step\nStep: ${stepLine(step)}\nRound: ${round}${round === 1 ? '' : '\nThe answers and feedback are written in the step\'s refine block.'}`,
})

/**
 * B285: the word that tells the main chat a step it queued before it was refined is refined now, so it hands it out
 * as its note says (roles/main.md): `For` is the worker the note names.
 */
export const refinedWords = (to, step) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'refined', about: step.id,
  text: `step refined\nStep: ${stepLine(step)}${step.worker === null || step.worker === undefined ? '' : `\nFor: ${step.worker}`}`,
})

/** B233: the Advisor refines a step that is not finished; one ask at a time per step. */
function refineCheck(body, state) {
  const advisor = state.advisor?.name ?? null
  if (advisor === null || body.to !== advisor) return refuse(400, 'A step is refined by the Advisor.')
  if ((body.text ?? '') !== '' || (body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
  const step = (state.backlog ?? []).flatMap(activity => activity.steps ?? []).find(one => typeof one.id === 'string' && one.id === body.step)
  if (step === undefined || step.status === 'done') return refuse(409, 'That step is not on the backlog, or it is finished.')
  if (step.refineAsk?.isOpen === true) return refuse(409, 'The Advisor is refining this step already.')
  // B285: a queued step the person refines before it was refined is said to the main chat once it is, as when the
  // board refines it (refineGate.mjs `notice`).
  const why = step.status === 'queued' && !isRefined(step.refined) ? { why: 'queued' } : {}
  return { ok: true, message: { ...refineWords(body.to, step, (step.refined?.round ?? 0) + 1), ...why } }
}

/**
 * B195: the person's answer to the Advisor's recommendation on the way to the next milestone. Yes goes to the main
 * chat, which puts the step on the backlog when it is not there and hands it out; no goes to the Advisor with the
 * person's reason. What was recommended is read from the board's own state: the page sends the answer and a reason.
 */
function recommendWords(body, state) {
  const rec = state.milestone?.recommendation ?? null
  if (rec === null || body.about !== rec.id) return refuse(409, 'That is no longer the Advisor\'s recommendation.')
  if ((rec.answer ?? null) !== null) return refuse(409, 'This recommendation is answered already.')
  if ((body.text ?? '') !== '' || (body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
  const base = { ask: null, step: null, title: null, version: null, verdict: null, command: 'recommend', about: rec.id, answer: body.answer }
  const step = rec.step === null ? '' : `\nStep: ${rec.step}`
  if (body.answer === 'yes') {
    if (body.to !== (state.restart?.main ?? null)) return refuse(400, 'A yes goes to the main chat.')
    return { ok: true, message: { ...base, to: body.to, text: `advisor recommendation: yes\nRecommended: ${rec.title}${step}${rec.why === '' ? '' : `\nWhy: ${rec.why}`}` } }
  }
  if (body.answer === 'no') {
    if (body.to !== (state.advisor?.name ?? null)) return refuse(400, 'A no goes to the Advisor.')
    const reason = typeof body.reason === 'string' ? body.reason.replace(/\s+/g, ' ').trim() : ''
    if (reason === '' || reason.length > 1000) return refuse(400, 'Say why, in at most 1000 characters.')
    return { ok: true, message: { ...base, to: body.to, text: `advisor recommendation: no\nRecommended: ${rec.title}${step}\nReason: ${reason}` } }
  }
  return refuse(400, 'Yes or no.')
}

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
    if (!['prepare restart', 'resume', 'start', 'spawn', 'remove', 'queue', 'recommend', 'stop', 'move', 'unqueue', 'refine'].includes(body.command)) return refuse(400, 'No such command.')
    // B195: the one answer that may go to the Advisor as well as to the main chat.
    if (body.command === 'recommend') return recommendWords(body, state)
    // B233: the one command that goes to the Advisor only.
    if (body.command === 'refine') return refineCheck(body, state)
    if (body.to !== state.restart?.main) return refuse(400, 'Only the main chat prepares, resumes, starts and is asked for workers.')
    if (text !== '' || (body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
    // B181: a step of the backlog for the queue: one with an id that nobody has (not queued, not in progress, not
    // finished, not the person's), read from the board's own state; the page names the step's id only. One ask at a
    // time per step.
    if (body.command === 'queue') {
      const step = (state.backlog ?? []).flatMap(activity => activity.steps ?? []).find(one => typeof one.id === 'string' && one.id === body.step)
      if (step === undefined || step.status !== 'open') return refuse(409, 'That step is not open for the queue: it is queued, in progress, finished or yours.')
      if (step.queueAsk?.isOpen === true) return refuse(409, 'The main chat was already asked to queue this step.')
      // B285: a step goes into a queue only once refined: the ask waits on the board (`held`) while the Advisor
      // refines it, and goes to the main chat by itself once it is (refineGate.mjs).
      return { ok: true, message: { ...queueWords(body.to, step), ...(isRefined(step.refined) ? {} : { held: true }) } }
    }
    // B83: the person stops a worker's task (after confirming once, `sure`), moves a queued step to another worker,
    // or takes it out of its queue. What the worker does and what the step is are read here, from the board's own
    // state: the page names the worker, the step's id and the other worker only. One ask at a time each.
    if (body.command === 'stop') {
      const lane = (state.chats ?? []).find(chat => chat.name === body.chat && !chat.isLeftover && !chat.isMain)
      if (lane === undefined) return refuse(409, 'That is no worker on the board.')
      if (lane.task === null || lane.task === undefined || lane.state === 'free') return refuse(409, 'This worker has no task to stop.')
      if (state.changeAsks?.stop?.[lane.name]?.isOpen === true) return refuse(409, 'An earlier ask to stop this task is still open.')
      if (body.sure !== true) return refuse(409, 'Confirm first: the worker stops at a safe point.')
      const task = [lane.task.stepId ?? null, lane.task.text ? `"${plainLine(lane.task.text)}"` : null].filter(Boolean).join(' ') || 'its task'
      return { ok: true, message: stopWords(body.to, plainLine(lane.name), task) }
    }
    if (body.command === 'move' || body.command === 'unqueue') {
      const found = typeof body.step === 'string' ? queuedStep(state, body.step) : null
      if (found === null) return refuse(409, 'No worker\'s queue holds that step.')
      if (state.changeAsks?.steps?.[found.step.id]?.isOpen === true) return refuse(409, 'An earlier ask to change this step is still open.')
      if (body.command === 'unqueue') return { ok: true, message: unqueueWords(body.to, found.step, plainLine(found.lane.name)) }
      const target = (state.chats ?? []).find(chat => chat.name === body.target && !chat.isLeftover && !chat.isMain)
      if (target === undefined || target.name === found.lane.name) return refuse(409, 'Move it to another worker on the board.')
      return { ok: true, message: moveWords(body.to, found.step, plainLine(found.lane.name), plainLine(target.name)) }
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
  // B195, B233: of the commands, only the answer to the Advisor's recommendation and a refine go to another chat than
  // the main one.
  if (main === null || message.to === main || ((message.command ?? null) !== null && message.command !== 'recommend' && message.command !== 'refine')) return null
  if ((state.chats ?? []).find(chat => chat.name === main)?.isRunning === false) return null
  // Not again within two minutes; and while an earlier word still waits for the main chat, not for ten.
  const isOnItsWay = sent => (sent.state === 'waiting' || sent.state === 'taken') && now - sent.at < WAKE_PENDING_MS
  if (outbox.some(sent => sent.command === 'start' && sent.about === message.to && (now - sent.at < WAKE_AGAIN_MS || isOnItsWay(sent)))) return null
  const checked = checkSay({ to: main, command: 'start', chat: message.to }, state, maxChars)
  return checked.ok ? checked.message : null
}
