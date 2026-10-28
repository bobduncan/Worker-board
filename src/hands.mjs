// B753 (the person, 2026-10-28: "i want to slowly phase out the main, because it did too much and i want to replace more
// with code. so how can we e.g. best tacle the waking, resuming, pausing of chats?"): the board's hands in code. Only a
// running chat can start another (the app's session tools; the board cannot), so the board keeps each start, wake and
// resume as a job and the Workers mod of any running board chat claims it and sends it with the app's own send-message
// tool, by code, with no model turn (proven on the work login, 2026-10-28, where the main chat's words no longer arrive:
// the app's guard skips the mod's prompt and turn hooks, not its timers and tool calls). A job no chat claims stays a
// word for the main chat, as before. Pure: it reads what it is given.

/** The words of the board's that are a chat's hands: start a chat that does not run, wake one whose turn was stopped. */
export const HAND_COMMANDS = ['start', 'wake']
/** The line a started or woken chat gets: the words the board holds for it come in with its next take. */
export const HAND_LINE = 'The worker board holds words for you; they come in now.'
/** A resume line goes again to a chat that has not started this long after the last one. */
export const RESUME_AGAIN_MS = 5 * 60_000

/** The app's id of a chat (local_...): the only one its send-message tool reaches. */
export const isAppId = session => typeof session === 'string' && /^local_[\w-]{1,80}$/.test(session)

/** A word of the outbox that is a hand's to send: a start or a wake that waits. */
export const isHandWord = message => HAND_COMMANDS.includes(message?.command) && typeof message?.about === 'string'

/**
 * The jobs for the chat `caller` (its name) out of the hand words it took (`taken`, the outbox's) and the resume list
 * (`resumeList`, pause.mjs `pauseAnswer`'s while resuming: `{ chat, session, step, hasStarted }`): `{ jobs, back }`.
 * A job is `{ id, to (the app id), chat, text }`; `back` the ids of taken words that go back to waiting for the main
 * chat: a chat with no app id the board knows, or the caller itself. A resume line goes to each chat that has not
 * started and has an app id, unless one went to it within RESUME_AGAIN_MS (`sentAt`, by `<since>:<chat>`).
 */
export function handJobs({ caller, taken = [], lanes = [], resumeList = [], since = null, sentAt = new Map(), now }) {
  const jobs = []
  const back = []
  const laneOf = name => lanes.find(lane => lane.name === name)
  for (const message of taken) {
    const lane = laneOf(message.about)
    if (lane === undefined || lane.name === caller || !isAppId(lane.appSession)) {
      back.push(message.id)
      continue
    }
    jobs.push({ id: message.id, to: lane.appSession, chat: lane.name, text: HAND_LINE })
  }
  for (const one of resumeList) {
    if (one.hasStarted === true || one.chat === caller || !isAppId(one.session)) continue
    const key = `${since ?? 0}:${one.chat}`
    if (now - (sentAt.get(key) ?? -Infinity) < RESUME_AGAIN_MS) continue
    jobs.push({ id: `resume:${key}`, to: one.session, chat: one.chat, text: `resume your step ${one.step} from your checkpoint` })
  }
  return { jobs, back }
}

/** What a hand reports back, `[{ id, ok, why }]`, read safely: the words it sent and those it could not, by id. */
export function handResults(body) {
  const list = Array.isArray(body?.results) ? body.results : []
  const sent = []
  const failed = []
  const why = {}
  for (const one of list) {
    if (one === null || typeof one !== 'object' || typeof one.id !== 'string' || one.id.length > 200) continue
    if (one.ok === true) sent.push(one.id)
    else {
      failed.push(one.id)
      why[one.id] = String(one.why ?? 'not sent').slice(0, 300)
    }
  }
  return { sent, failed, why }
}
