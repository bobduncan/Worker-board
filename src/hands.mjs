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
//
// T12 (the person, 2026-10-28: every worker its own routine, named "<project> - Worker N", so the app's Routines page shows
// one card per worker and not one shared routine renamed for every start): a new worker starts from the stored routine of
// its own number first (`workerTaskIds`), the shared start-worker task only as the fallback (`nextSpawn`).
//
// T14 (the person, 2026-10-30: "B", fix A for X1 / X103 with the allow rule the person adds): a chat in Auto mode cannot
// send by code: the app puts its mod's send-message call to the Auto classifier, which denied it ("gave no verdict"), so a
// worker routine (Auto mode) that claimed a start, wake or resume failed it. Since Workers mod SEND_MOD a chat says
// `can: ['send']` where the app allows its code the send-message tool with no question (an allow rule, or a mode that
// allows it); only such a chat gets the jobs sent with it (`canSend`, `maySend`). A chat on an older mod never says it
// and keeps today's share until its restart brings the new mod.

import { PARTNER_MODES, SWITCH_MODES } from './partnerEffort.mjs'
import { isOlder, versionOf } from './oldMods.mjs'
import { EFFORTS, MODEL_ID } from './work/effort.mjs'
import { RESTART_COMMAND } from './work/modRollout.mjs'
import { ownerFirst } from './talkPartner.mjs'

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
 * B880 (X2 a third time: Worker 2's hand held the Product owner's start word for half an hour, its call never answering): a word a
 * hand took (`takenBy`) and has said nothing of this long goes back to waiting, for another hand or its addressee. A hand gives a
 * word back itself after two minutes without the app's answer (the Workers mod's HAND_CALL_MS); this catches a hand whose process
 * ended, or a mod older than that. The slowest hand of the week took 45 s.
 */
export const HAND_HOLD_MS = 3 * 60_000

/**
 * B880: whether a hand took the word last (`takenBy`, and its take's own time `handTakenAt` the word's `takenAt`): a chat's own
 * take sets a newer `takenAt`, and a retry's copy made before B880 kept an old hand's `takenBy`, so the name alone does not say.
 */
export const isHandTaken = message => typeof message?.takenBy === 'string' && Number.isFinite(message.takenAt) && message.handTakenAt === message.takenAt

/** B880: the ids of the words a hand holds (`isHandTaken`) and has held for HAND_HOLD_MS or longer. */
export const heldTooLong = (outbox, now) => outbox
  .filter(message => message.state === 'taken' && isHandTaken(message) && now - message.takenAt >= HAND_HOLD_MS)
  .map(message => message.id)

/**
 * B880: a start word that names its chat (`about`: the Product owner's routine; a worker's spawn names none) whose chat is on
 * the board now (`onBoard`, the names): moot, as nothing more is to start. No hand takes it, and the outbox sweep closes it.
 */
/** B880: why a moot start word is closed (the outbox sweep and a hand's claim say the same). */
export const mootWhy = message => `${message.about} is on the board now`

export const isMootSpawn = (message, onBoard) => message?.command === 'spawn' && typeof message.about === 'string' && message.about !== ''
  && onBoard instanceof Set && onBoard.has(message.about)

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

/**
 * B769 (the person, 2026-10-28: "Yes, B next"): the person's Stop task and Remove worker, by code. A worker whose
 * Workers mod is STOP_MOD or newer is told at its next tool call (the pause's route) from its take; the board settles a
 * stop once the worker's turn ended, and a running chat removes an idle or closed worker (out of the list, its chat
 * archived). Such a word (`byCode`) waits STOP_HANDS_MS for that before the main chat takes it after all.
 */
export const STOP_MOD = '0.26.1'
export const STOP_HANDS_MS = 15 * 60_000

/** B769: a stop or remove word the board carries out by code. */
export const isStopWord = message => (message?.command === 'stop' || message?.command === 'remove') && message.byCode === true && typeof message.about === 'string'

/** B769: the task a stop word names ("Task: B12 \"...\""), or ''. */
export const stopTaskOf = message => /^Task: (.{1,200})$/m.exec(String(message?.text ?? ''))?.[1] ?? ''

/**
 * B769: what becomes of an open stop or remove word about `lane` now: 'settle' (a stop whose worker's turn ended after
 * it, or whose chat does not run: nothing more to do), 'remove' (a remove whose worker is idle after it, or off: a hand
 * takes it out), or 'wait'.
 */
export function stopStep(message, lane) {
  const isOver = lane === undefined || lane.isRunning === false
    || (['idle', 'asking'].includes(lane.report?.state) && Number.isFinite(lane.report?.since) && lane.report.since > message.at)
  if (!isOver) return 'wait'
  return message.command === 'remove' ? (lane === undefined ? 'settle' : 'remove') : 'settle'
}

/** T14: the first Workers mod that says whether its chat may send by code (`can: ['send']`). */
export const SEND_MOD = '0.26.5'

/**
 * T14: whether a chat's claim of the hands (`{ can, mod }`, the server's `codeClaims`) may send by code: its mod says
 * 'send', or it is older than SEND_MOD (none said: older than any that says its version), which never says it and keeps
 * sending as before.
 */
export function maySend(claim) {
  if (Array.isArray(claim?.can) && claim.can.includes('send')) return true
  const mine = versionOf(claim?.mod ?? null)
  return mine === null || isOlder(mine, versionOf(SEND_MOD))
}

/** A resume line goes again to a chat that has not started this long after the last one. */
export const RESUME_AGAIN_MS = 5 * 60_000

/**
 * T13 part 3 (the person, 2026-10-28: "interrupted is interrupted"): the line an asleep chat whose turn was cut gets when it
 * holds no step (the main chat, the partner, the supervisor, a worker on the person's words); one holding a step gets Resume
 * all's line, "resume your step B<id> from your checkpoint".
 */
export const ASLEEP_LINE = 'Your chat stopped in the middle of your turn: go on from where you were.'

/** T13 part 3: the chat and the asleep spell (its `asleepSince`) an asleep resume job's id names, `{ chat, since }`, or null. */
export function asleepOfJob(id) {
  const found = /^asleep:(\d{1,16}):(.{1,200})$/.exec(String(id ?? ''))
  return found === null ? null : { since: Number(found[1]), chat: found[2] }
}

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

/** B766: the board's workers by name, out of its state: the lanes that are no main chat, partner, helper, supervisor or Product owner. */
export function workerNames(state) {
  const others = new Set([state?.advisor?.name, state?.advisorHelper?.name, state?.supervisorChat?.name, state?.productOwner?.name].filter(Boolean))
  return new Set((state?.chats ?? []).filter(lane => !lane.isMain && !lane.isLeftover && !others.has(lane.name)).map(lane => lane.name))
}

/**
 * A word of the outbox that is a hand's to send: a start or a wake, (T14) for a chat that `canSend` (`maySend`; true
 * unless told); (B755) for a chat that `canSet`, a set word code may set (`setOf`); (B766) for one that `canRestart`, a
 * restart for a new mod of one of the `workers`; for one that `canSpawn`, a word for a new worker.
 */
export function isHandWord(message, { canSend = true, canSet = false, canRestart = false, canSpawn = false, workers = null } = {}) {
  if (canSpawn && message?.command === 'spawn') return true
  if (typeof message?.about !== 'string') return false
  if (canSend && HAND_COMMANDS.includes(message.command)) return true
  if (canSet && setOf(message) !== null) return true
  return canRestart && message.command === RESTART_COMMAND && workers instanceof Set && workers.has(message.about)
}

/**
 * B755: whether a chat's own take leaves `message` to the hands still (`HANDS_FIRST_MS`); B766: a restart only of one of
 * the `workers`.
 */
export const isForHandsYet = (message, now, workers = null) =>
  (isHandWord(message, { canSend: true, canSet: true, canRestart: true, canSpawn: true, workers }) && now - message.at < HANDS_FIRST_MS)
  || (isStopWord(message) && now - message.at < STOP_HANDS_MS)

/**
 * T12 (the person, 2026-10-28: every worker its own routine, so the app's Routines page shows one card per worker): the
 * next new worker, `{ title, n }`: the prefix and the lowest "Worker N" no chat of the board has (`names`), and N.
 * B766: the title alone is `nextWorkerTitle`.
 */
export function nextWorker(names, prefix = '') {
  const used = new Set()
  for (const name of names) {
    const plain = String(name ?? '').startsWith(prefix) ? String(name).slice(prefix.length) : String(name ?? '')
    const found = /^Worker (\d{1,3})$/.exec(plain.trim())
    if (found !== null) used.add(Number(found[1]))
  }
  let n = 1
  while (used.has(n)) n += 1
  return { title: `${prefix}Worker ${n}`, n }
}

/** B766: the title of the next new worker: the prefix and the lowest "Worker N" no chat of the board has (`names`). */
export const nextWorkerTitle = (names, prefix = '') => nextWorker(names, prefix).title

/**
 * The project's folder name as the stored tasks' ids use it: lower case, runs of other characters one "-". Given a path,
 * its last folder (the server passes the name; a whole path means the same project).
 */
const taskBase = folder => String(folder ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * B766: the ids of the shared stored task that starts a worker, by the project's folder name (start-worker-task.md): the
 * app keeps the tasks per login, so a second login has its own under "-2". The hand tries them in this order. T12: now
 * only the fallback, for a PC without a routine per worker.
 */
export const startTaskIds = folder => {
  const base = taskBase(folder)
  return base === '' ? [] : [`${base}-start-worker-2`, `${base}-start-worker`]
}

/**
 * T12: the ids of worker N's own stored routine, titled "<prefix>Worker N" (start-worker-task.md), by the project's folder
 * name: the plain id, and "-2" for a second login, as for the shared task.
 */
export const workerTaskIds = (folder, n) => {
  const base = taskBase(folder)
  return base === '' ? [] : [`${base}-worker-${n}`, `${base}-worker-${n}-2`]
}

/**
 * T12: the next new worker as a hand job needs it, `{ title, tasks }`: its title and the task ids the hand tries in order,
 * the worker's own routine first (its title is already its name, so the rename is no change), the shared task only as the
 * fallback, so a PC without the per-worker routines goes on working.
 */
export function nextSpawn(names, prefix, folder) {
  const { title, n } = nextWorker(names, prefix)
  return { title, tasks: [...workerTaskIds(folder, n), ...startTaskIds(folder)] }
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
 * T13 part 3: one resume job, `asleep:<asleepSince>:<chat>`, for each board chat (`lanes`) that is asleep and interrupted
 * (its process ended while its turn ran or it held a task: chatReport.mjs `asleepLane`) and has an app id: its step's line
 * (the task it names first, else the oldest taken or in progress), or ASLEEP_LINE without one. Once per asleep spell: not
 * when `asleepSent` (by chat, `{ since }`) names that spell; none while the person pauses (`isPaused`), and none for a
 * chat Resume all's list wakes already.
 * T14: the jobs sent with the app's send-message tool (a taken start or wake word's line, the resume lines, the asleep
 * resume words) only for a caller that `canSend` (`maySend`; true unless told): for one that may not, a taken start or
 * wake word goes `back` and no resume line is made.
 */
export function handJobs({ caller, taken = [], lanes = [], resumeList = [], since = null, sentAt = new Map(), now, spawn = null, usage = false, asleepSent = new Map(), isPaused = false, canSend = true, first = null }) {
  const jobs = []
  const back = []
  const laneOf = name => lanes.find(lane => lane.name === name)
  let spawning = false
  for (const message of taken) {
    if (message.command === 'spawn') {
      // The Product owner (2026-10-31): a spawn word that names a routine of its own (talkPartner.mjs `ownerStartWords`) runs
      // that routine, the owner's, not the next worker's.
      const own = routineOf(message)
      const made = own ?? spawn
      if (made === null || spawning) back.push(message.id)
      else jobs.push({ id: message.id, chat: made.title, spawn: { title: made.title, tasks: [...made.tasks] } })
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
    else if (set !== null) jobs.push({ ...head, set })
    else if (canSend) jobs.push({ ...head, text: HAND_LINE })
    else back.push(message.id)
  }
  for (const one of canSend ? resumeList : []) {
    if (one.hasStarted === true || one.chat === caller || !isAppId(one.session)) continue
    const key = `${since ?? 0}:${one.chat}`
    if (now - (sentAt.get(key) ?? -Infinity) < RESUME_AGAIN_MS) continue
    jobs.push({ id: `resume:${key}`, to: one.session, chat: one.chat, text: `resume your step ${one.step} from your checkpoint` })
  }
  for (const lane of isPaused || !canSend ? [] : lanes) {
    if (lane.asleep !== true || lane.state !== 'interrupted' || lane.name === caller || !isAppId(lane.appSession) || !Number.isFinite(lane.asleepSince)) continue
    if (asleepSent.get(lane.name)?.since === lane.asleepSince || resumeList.some(one => one.chat === lane.name)) continue
    const held = (lane.storeSteps ?? []).filter(one => one.state === 'taken' || one.state === 'in progress')
    const step = held.find(one => one.id === lane.task?.stepId) ?? held[0] ?? null
    jobs.push({ id: `asleep:${lane.asleepSince}:${lane.name}`, to: lane.appSession, chat: lane.name, text: step === null ? ASLEEP_LINE : `resume your step ${step.id} from your checkpoint` })
  }
  // B768: a lookup of the limits, when the board said one is due.
  if (usage) jobs.push({ id: `usage:${now}`, chat: caller, usage: true })
  // The Product owner (2026-10-31: the person never waits for a talk): its start, wake and resume go before every other job.
  return { jobs: ownerFirst(jobs, first), back }
}

/** A spawn word's own routine (`routine`: `{ title, tasks }`, the Product owner's), read safely; null for a worker's spawn. */
function routineOf(message) {
  const routine = message?.routine
  if (routine === null || typeof routine !== 'object' || typeof routine.title !== 'string' || routine.title === '' || !Array.isArray(routine.tasks)) return null
  const tasks = routine.tasks.filter(one => typeof one === 'string' && /^[a-z0-9-]{1,80}$/.test(one)).slice(0, 3)
  return tasks.length === 0 ? null : { title: routine.title, tasks }
}

/**
 * What a hand reports back, `[{ id, ok, why, text, back }]`, read safely: the words it sent and those it could not, by id, and
 * (B768) the answer of a lookup of the limits (`texts`, by its `usage:` id, 20000 characters at most). B880: `back` the
 * words it gives back unsent (the app gave no answer in time, or its process cannot call tools): they wait again, no try spent.
 */
export function handResults(body) {
  const list = Array.isArray(body?.results) ? body.results : []
  const sent = []
  const failed = []
  const back = []
  const why = {}
  const texts = {}
  for (const one of list) {
    if (one === null || typeof one !== 'object' || typeof one.id !== 'string' || one.id.length > 200) continue
    if (one.ok === true) {
      sent.push(one.id)
      if (one.id.startsWith('usage:') && typeof one.text === 'string') texts[one.id] = one.text.slice(0, 20_000)
    } else if (one.back === true) back.push(one.id)
    else {
      failed.push(one.id)
      why[one.id] = String(one.why ?? 'not sent').slice(0, 300)
    }
  }
  return { sent, failed, back, why, texts }
}
