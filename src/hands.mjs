// B753 (the person, 2026-10-28: "i want to slowly phase out the main, because it did too much and i want to replace more
// with code. so how can we e.g. best tacle the waking, resuming, pausing of chats?"): the board's hands in code. Only a
// running chat can start another (the app's session tools; the board cannot), so the board keeps each start, wake and
// resume as a job and the Workers mod of any running board chat claims it and sends it with the app's own send-message
// tool, by code, with no model turn (proven on the work login, 2026-10-28, where the main chat's words no longer arrive:
// the app's guard skips the mod's prompt and turn hooks, not its timers and tool calls). A job no chat claims stays a
// word for the main chat, as before. Pure: it reads what it is given.
//
// B755 (the person, 2026-10-28: "Add the permission so code may set model and effort, and build B755"): a worker's model
// and effort (src/work/effort.mjs) and the partner's mode (src/partnerEffort.mjs) are set the same way, with the app's
// set_session_model and set_session_effort, by a chat whose app lets it (the allow rule in the project's local
// settings; the mod checks it and only then says `can: ['set']`). Values come from the board's own words, checked here
// once more: an effort the app names, a model id of the app's, never Fable (that needs the person's yes: the main chat's).
//
// B766 (the person, 2026-10-28: "Yes, build it"): a worker's restart for a new Workers mod (src/work/modRollout.mjs) and a
// new worker (`spawn workers`) too, by a chat whose app lets its code close and reopen a chat (archive_session,
// unarchive_session) and rename and run the stored start-worker task (update_scheduled_task, run_scheduled_task). Only
// workers are restarted: on the work login a restarted chat starts an empty conversation, which a worker (cleared after
// every step) does not miss, but the main chat, the partner and the supervisor would; theirs stay the main chat's.

import { PARTNER_MODES, SWITCH_MODES } from './partnerEffort.mjs'
import { EFFORTS, MODEL_ID } from './work/effort.mjs'
import { RESTART_COMMAND } from './work/modRollout.mjs'

/** The words of the board's that are a chat's hands: start a chat that does not run, wake one whose turn was stopped. */
export const HAND_COMMANDS = ['start', 'wake']
/** The line a started or woken chat gets: the words the board holds for it come in with its next take. */
export const HAND_LINE = 'The worker board holds words for you; they come in now.'
/**
 * B755: a hand's word waits this long for a hand before the chat it is addressed to (the main chat) may take it: its take
 * runs every 5 s, a hand's claim every 20 s, so without it the main chat took them first, also where its typed words do
 * not arrive (the work login). Three claims of a hand.
 */
export const HANDS_FIRST_MS = 60_000
/**
 * B768 (the person, 2026-10-28: "A: limits timer"): the plan's limits are looked up by code when the board's newest
 * reading is this old: the week and 5-hour stops (B742, B758) and the old-reading rule need fresh ones.
 */
export const USAGE_EVERY_MS = 10 * 60_000
/** B768: a lookup job goes again after this long when the last one brought no reading. */
export const USAGE_AGAIN_MS = 2 * 60_000

/**
 * B768: whether a lookup of the limits is due: the newest of the board's `readings` (`{ at }`) is older than
 * USAGE_EVERY_MS (or there is none) and no lookup was given in the last USAGE_AGAIN_MS (`givenAt`).
 */
export function usageDue({ readings = [], givenAt = -Infinity, now }) {
  const newest = readings.reduce((best, one) => (Number.isFinite(one?.at) && one.at > best ? one.at : best), -Infinity)
  return now - newest >= USAGE_EVERY_MS && now - givenAt >= USAGE_AGAIN_MS
}

/** A resume line goes again to a chat that has not started this long after the last one. */
export const RESUME_AGAIN_MS = 5 * 60_000

/** The app's id of a chat (local_...): the only one its send-message tool reaches. */
export const isAppId = session => typeof session === 'string' && /^local_[\w-]{1,80}$/.test(session)

/**
 * B755: what a set word asks, `{ model, effort }` (`model` null: the effort alone), or null when it is no set word or asks
 * what code may not set: an effort the app does not name, a model that is no id of the app's, Fable in any form.
 */
export function setOf(message) {
  if (message?.command === 'partner-effort') {
    if (!SWITCH_MODES.includes(message.mode)) return null
    const { model, effort } = PARTNER_MODES[message.mode]
    return { model, effort }
  }
  if (message?.command !== 'worker-effort' || !EFFORTS.includes(message.effort)) return null
  const model = message.model ?? null
  if (model !== null && (typeof model !== 'string' || !MODEL_ID.test(model) || /fable/i.test(model))) return null
  return { model, effort: message.effort }
}

/** B766: the board's workers by name, out of its state: the lanes that are no main chat, partner, helper or supervisor. */
export function workerNames(state) {
  const others = new Set([state?.advisor?.name, state?.advisorHelper?.name, state?.supervisorChat?.name].filter(Boolean))
  return new Set((state?.chats ?? []).filter(lane => !lane.isMain && !lane.isLeftover && !others.has(lane.name)).map(lane => lane.name))
}

/**
 * A word of the outbox that is a hand's to send: a start or a wake; (B755) for a chat that `canSet`, a set word code may
 * set (`setOf`); (B766) for one that `canRestart`, a restart for a new mod of one of the `workers`; for one that
 * `canSpawn`, a word for a new worker.
 */
export function isHandWord(message, { canSet = false, canRestart = false, canSpawn = false, workers = null } = {}) {
  if (canSpawn && message?.command === 'spawn') return true
  if (typeof message?.about !== 'string') return false
  if (HAND_COMMANDS.includes(message.command)) return true
  if (canSet && setOf(message) !== null) return true
  return canRestart && message.command === RESTART_COMMAND && workers instanceof Set && workers.has(message.about)
}

/**
 * B755: whether a chat's own take leaves `message` to the hands still (`HANDS_FIRST_MS`); B766: a restart only of one of
 * the `workers`.
 */
export const isForHandsYet = (message, now, workers = null) =>
  isHandWord(message, { canSet: true, canRestart: true, canSpawn: true, workers }) && now - message.at < HANDS_FIRST_MS

/** B766: the title of the next new worker: the prefix and the lowest "Worker N" no chat of the board has (`names`). */
export function nextWorkerTitle(names, prefix = '') {
  const used = new Set()
  for (const name of names) {
    const plain = String(name ?? '').startsWith(prefix) ? String(name).slice(prefix.length) : String(name ?? '')
    const found = /^Worker (\d{1,3})$/.exec(plain.trim())
    if (found !== null) used.add(Number(found[1]))
  }
  let n = 1
  while (used.has(n)) n += 1
  return `${prefix}Worker ${n}`
}

/**
 * B766: the ids of the stored task that starts a worker, by the project's folder name (start-worker-task.md): the
 * app keeps the tasks per login, so a second login has its own under "-2". The hand tries them in this order.
 */
export const startTaskIds = folder => {
  const base = String(folder ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return base === '' ? [] : [`${base}-start-worker-2`, `${base}-start-worker`]
}

/**
 * The jobs for the chat `caller` (its name) out of the hand words it took (`taken`, the outbox's) and the resume list
 * (`resumeList`, pause.mjs `pauseAnswer`'s while resuming: `{ chat, session, step, hasStarted }`): `{ jobs, back }`.
 * A job is `{ id, to (the app id), chat, text }`, or for a set word (B755) `{ id, to, chat, set: { model, effort } }`;
 * for a restart (B766) `{ id, to, chat, restart: { keep } }` (`keep`: the app ids of the board's chats, which the hand
 * reopens when closing the worker closed them too), for a new worker `{ id, chat, spawn: { title, tasks } }` (`spawn`
 * the title and the task ids; one per claim, as the app runs the task once at a time). `back` the ids of taken words
 * that go back to waiting for the main chat: a chat with no app id the board knows, or the caller itself (the app
 * refuses a chat's own model and effort too), a second new worker, or one with no `spawn` to give. A resume line goes to
 * each chat that has not started and has an app id, unless one went to it within RESUME_AGAIN_MS (`sentAt`, by
 * `<since>:<chat>`). With `usage` (B768) one more job, `{ id: 'usage:<now>', chat, usage: true }`: look the limits up.
 */
export function handJobs({ caller, taken = [], lanes = [], resumeList = [], since = null, sentAt = new Map(), now, spawn = null, usage = false }) {
  const jobs = []
  const back = []
  const laneOf = name => lanes.find(lane => lane.name === name)
  let spawning = false
  for (const message of taken) {
    if (message.command === 'spawn') {
      if (spawn === null || spawning) back.push(message.id)
      else jobs.push({ id: message.id, chat: spawn.title, spawn: { title: spawn.title, tasks: [...spawn.tasks] } })
      spawning = true
      continue
    }
    const lane = laneOf(message.about)
    if (lane === undefined || lane.name === caller || !isAppId(lane.appSession)) {
      back.push(message.id)
      continue
    }
    const set = setOf(message)
    const head = { id: message.id, to: lane.appSession, chat: lane.name }
    if (message.command === RESTART_COMMAND) jobs.push({ ...head, restart: { keep: lanes.map(one => one.appSession).filter(isAppId) } })
    else jobs.push(set === null ? { ...head, text: HAND_LINE } : { ...head, set })
  }
  for (const one of resumeList) {
    if (one.hasStarted === true || one.chat === caller || !isAppId(one.session)) continue
    const key = `${since ?? 0}:${one.chat}`
    if (now - (sentAt.get(key) ?? -Infinity) < RESUME_AGAIN_MS) continue
    jobs.push({ id: `resume:${key}`, to: one.session, chat: one.chat, text: `resume your step ${one.step} from your checkpoint` })
  }
  // B768: a lookup of the limits, when the board said one is due.
  if (usage) jobs.push({ id: `usage:${now}`, chat: caller, usage: true })
  return { jobs, back }
}

/**
 * What a hand reports back, `[{ id, ok, why, text }]`, read safely: the words it sent and those it could not, by id, and
 * (B768) the answer of a lookup of the limits (`texts`, by its `usage:` id, 20000 characters at most).
 */
export function handResults(body) {
  const list = Array.isArray(body?.results) ? body.results : []
  const sent = []
  const failed = []
  const why = {}
  const texts = {}
  for (const one of list) {
    if (one === null || typeof one !== 'object' || typeof one.id !== 'string' || one.id.length > 200) continue
    if (one.ok === true) {
      sent.push(one.id)
      if (one.id.startsWith('usage:') && typeof one.text === 'string') texts[one.id] = one.text.slice(0, 20_000)
    } else {
      failed.push(one.id)
      why[one.id] = String(one.why ?? 'not sent').slice(0, 300)
    }
  }
  return { sent, failed, why, texts }
}
