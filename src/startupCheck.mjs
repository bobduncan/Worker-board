// The start-up check (2026-11-05, chat 3's brief and chat 1's plan): after an outside event (a crash, a pause, a landing, a
// Claude update, an account switch) the board re-reads reality once, instead of one fix per symptom. Three pure parts and the
// writes: `pictureOf` reads the sources into one plain object (no decisions), `judge` decides the fixes and the one line, `apply`
// writes the fixes through the existing writers. The runner and the triggers (server.mjs) come in stage 2.
//
// It reuses the wake blocks (src/wake.mjs `noteRun`, `reopenSpells`, `wakeOf`), the account folders (src/appChats.mjs
// `listedWhere`), the H1 texts (src/ownChat.mjs) and the C rule's bans (src/work/handover.mjs `bansOf`); nothing twice.

import { listedWhere } from './appChats.mjs'
import { OTHER_ACCOUNT_TAIL, RESTART_WHY } from './ownChat.mjs'
import { noteRun, noticeOf, reopenSpells, wakeOf } from './wake.mjs'
import { sameModel } from './work/effort.mjs'
import { bansOf } from './work/handover.mjs'

/** The rules whose incidents name a wake that failed: the check closes them when the chat answers again. */
export const WAKE_RULES = ['wake-failed', 'nobody-answers-wakes', 'launch-failed']
/** The states of an incident that are over. */
const ENDED = ['fixed', 'closed', 'gone']

const isTime = value => Number.isFinite(value)

/** An incident's "2026-11-05 20:28" (local time, as the store writes it) in ms; null for anything else. */
export function storeTimeOf(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(typeof text === 'string' ? text : '')
  return match === null ? null : new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]).getTime()
}

/** The wake of a chat as the check reads it: its newest spell, whether it failed for good, and the app's "not found". */
function wakeOfChat(record, chat) {
  const entry = record?.wakes?.get(chat)?.at(-1) ?? null
  if (entry === null) return { spell: null, state: 'none', final: false, notFound: false, verdictAt: null, reopenedAt: null }
  // Both paths could be taken: `final` is "every path was tried and failed" (the board's own word, wake.mjs `wakeOf`).
  const wake = wakeOf(record, { chat, spell: entry.spell, paths: ['message', 'launch'] }, { senderClaims: true })
  const counted = (entry.attempts ?? []).filter(one => !isTime(entry.reopenedAt) || one.at >= entry.reopenedAt)
  const verdicts = counted.map(one => one.verdictAt).filter(isTime)
  return {
    spell: entry.spell, state: wake.state, final: wake.final === true,
    notFound: counted.some(one => one.unlisted === true),
    verdictAt: verdicts.length === 0 ? null : Math.max(...verdicts),
    reopenedAt: isTime(entry.reopenedAt) ? entry.reopenedAt : null,
  }
}

/**
 * Task 2: the picture, from sources read at the moment of the check (never from the board's memory). No decision in it.
 *
 * - `folders`: every account folder of the app (appChats.mjs `readAccountFolders`);
 * - `lanes`: `[{ name, appSession, cliSession?, isRunning, model }]`, the board's lanes and the chats it wakes;
 * - `reports`: each chat's last report `{ [name]: { state, run, at } }`;
 * - `wakes`: the wake record (wake.mjs); `pause`: pause.json's `{ state }`; `ready`: the ready list's ids;
 * - `envelopes`: `{ [lane]: envelope[] }` (the outbox's, oldest first); `incidents`: the store's incidents
 *   `{ id, key, source, subject, state, since }` (`since` as the store writes it).
 *
 * `{ now, accounts, signedIn, lanes, newestRun, wakes, pause, ready, bans, incidents }`.
 */
export function pictureOf({ now, trigger = 'start', triggerAt = null, tooSlow = false, folders = [], lanes = [], reports = {}, wakes = null, pause = null, ready = [], envelopes = {}, incidents = [] }) {
  const newest = Math.max(0, ...folders.map(folder => folder.at))
  const withReport = lanes.map(lane => {
    const report = reports?.[lane.name] ?? null
    return {
      name: lane.name, appSession: lane.appSession ?? null, cliSession: lane.cliSession ?? null, model: lane.model ?? null,
      isRunning: lane.isRunning ?? null, run: isTime(report?.run) ? report.run : null,
      // Review 1 (3): a read that took too long knows nothing of the listing.
      listedWhere: tooSlow === true ? 'unknown' : listedWhere(lane.appSession, folders),
      // When its file in the folder in use was last active (the app writes it): older than a wake's "not found" means the app has not read it yet.
      fileAt: folders.find(folder => folder.at === newest && folder.chats.has(lane.appSession))?.chats.get(lane.appSession).lastActivityAt ?? null,
    }
  })
  // The newest run id among the chats that run: the mod's run id is when its process started, so one newer than a wake's
  // verdict says the app was back since (wake.mjs `noteRun`).
  // Review 1 (2): a run id later than the picture's own moment is no proof of it.
  const runs = withReport.filter(lane => lane.isRunning === true && lane.run !== null && lane.run <= now).map(lane => lane.run)
  const newestRun = runs.length === 0 ? null : Math.max(...runs)
  // Review 1 (5): a board start or a click of the button counts like a newer run: the check itself is the moment the app is read.
  const proofs = [newestRun, isTime(triggerAt) ? triggerAt : null].filter(isTime)
  return {
    now,
    trigger,
    triggerAt: isTime(triggerAt) ? triggerAt : null,
    tooSlow: tooSlow === true,
    accounts: folders.map(folder => ({ account: folder.account, org: folder.org ?? null, at: folder.at, ids: [...folder.ids], isSignedIn: folder.at === newest })),
    // The app does not mark the account in use: the folder with the newest activity counts, said as such in the line.
    signedIn: folders.filter(folder => folder.at === newest).map(folder => folder.account),
    lanes: withReport,
    newestRun,
    proofAt: proofs.length === 0 ? null : Math.max(...proofs),
    wakes: Object.fromEntries(lanes.map(lane => [lane.name, wakeOfChat(wakes, lane.name)])),
    pause: { state: pause?.state ?? null },
    ready: [...ready],
    bans: Object.fromEntries(lanes.map(lane => [lane.name, [...bansOf(envelopes?.[lane.name] ?? [], now)].map(([model, envelope]) => ({ model, envelope: envelope.id ?? null, failedAt: envelope.failedAt ?? envelope.settledAt ?? envelope.at ?? null }))])),
    incidents: incidents
      .filter(one => WAKE_RULES.some(rule => typeof one.key === 'string' && one.key.startsWith(rule)) && !ENDED.includes(one.state))
      .map(one => ({ id: one.id, key: one.key, subject: one.subject ?? null, state: one.state, since: isTime(one.since) ? one.since : storeTimeOf(one.since) })),
  }
}

// ---- Task 3: the verdict ----

const clockOf = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

/** "A's and B's" / "A's, B's and C's" (possessive = true), else "A and B" / "A, B and C". */
export function namesOf(names, possessive = false) {
  const each = names.map(name => (possessive ? `${name}'s` : name))
  return each.length <= 1 ? each.join('') : `${each.slice(0, -1).join(', ')} and ${each.at(-1)}`
}

/**
 * Task 3: what the check does about a picture, and the one line it tells. PURE and deterministic. For each chat, in order:
 * its file only in another account (`elsewhere`); no file anywhere (`nowhere`); listed here, not running, its wake failed for
 * good and a newer run was heard than the failure (the app was back since): `wake-again`; listed here but the app answered
 * "not found" and the file is older than that answer: `restartNeeded` (the app has not read it yet). A model ban whose lane
 * runs that model is dropped. An open wake incident whose chat runs, was woken again or was woken since, is closed; the
 * board-wide one when any chat runs.
 *
 * `{ at, total, reachable, line, tone, fixed, elsewhere, restartNeeded, nowhere, tooSlow, actions }`; `actions` is what
 * `apply` writes: `{ noteRun, reopen: [{ chat, spell }], banDrops: [{ chat, model, envelope }], closeIncidents: [{ id, why }] }`.
 */
export function judge(picture) {
  const { now } = picture
  const elsewhere = []
  const nowhere = []
  const restartNeeded = []
  const reopen = []
  const fixed = []
  const noticeWas = new Set()
  for (const lane of picture.lanes) {
    // Review 1 (4): a lane that runs is reachable, whatever the folders say.
    if (lane.isRunning !== true && lane.listedWhere === 'elsewhere') { elsewhere.push(lane.name); continue }
    if (lane.isRunning !== true && lane.listedWhere === 'nowhere') { nowhere.push(lane.name); continue }
    const wake = picture.wakes[lane.name]
    if (lane.listedWhere !== 'here' || lane.isRunning !== false || wake === undefined || wake.final !== true) continue
    // The failure is older than the proof that the app is back: a run id newer than the failure's verdict.
    if (isTime(picture.proofAt) && isTime(wake.verdictAt) && picture.proofAt > wake.verdictAt && wake.reopenedAt === null) {
      reopen.push({ chat: lane.name, spell: wake.spell })
      noticeWas.add(lane.name)
      fixed.push({ kind: 'wake-again', chat: lane.name, what: `woken again at ${clockOf(now)}: its chat is listed and the app is back` })
    } else if (wake.notFound && isTime(lane.fileAt) && isTime(wake.verdictAt) && lane.fileAt < wake.verdictAt) {
      restartNeeded.push(lane.name)
    }
  }
  for (const chat of noticeWas) fixed.push({ kind: 'notice-cleared', chat, what: `"could not wake ${chat}" cleared` })
  // Bans: the lane runs the model the ban bars, so the ban is wrong now (C's delivered-lift and 2 h stay as they are).
  const banDrops = []
  for (const lane of picture.lanes) {
    for (const ban of picture.bans[lane.name] ?? []) {
      if (!sameModel(lane.model, ban.model)) continue
      banDrops.push({ chat: lane.name, model: ban.model, envelope: ban.envelope })
      fixed.push({ kind: 'ban-dropped', chat: lane.name, what: `${ban.model} ban dropped: it runs that model` })
    }
  }
  // Incidents about a wake that failed: closed when their chat answers again.
  const runs = picture.lanes.some(lane => lane.isRunning === true)
  const reopened = new Set(reopen.map(one => one.chat))
  const closeIncidents = []
  for (const incident of picture.incidents) {
    const lane = picture.lanes.find(one => one.name === incident.subject)
    const wake = lane === undefined ? undefined : picture.wakes[lane.name]
    const answers = incident.subject === 'board' ? runs
      : lane !== undefined && (lane.isRunning === true || reopened.has(lane.name) || (wake?.state === 'woke' && isTime(incident.since) && wake.verdictAt > incident.since))
    if (!answers) continue
    const why = `gone after the check at ${clockOf(now)}`
    // Review 1 (1): an incident that rests on the re-open closes only once the re-open really happened (`apply`).
    const requires = incident.subject !== 'board' && lane?.isRunning !== true && !(wake?.state === 'woke') && reopened.has(lane?.name) ? lane.name : null
    closeIncidents.push({ id: incident.id, why, requires })
    fixed.push({ kind: 'incident-gone', chat: incident.subject, what: `${incident.id} ${why}` })
  }
  const total = picture.lanes.length
  const reachable = picture.tooSlow === true ? null : picture.lanes.filter(lane => lane.isRunning === true || ['here', 'unknown'].includes(lane.listedWhere)).length
  const parts = []
  if (elsewhere.length > 0) parts.push(`${namesOf(elsewhere, true)} chats are in ${OTHER_ACCOUNT_TAIL}`)
  if (restartNeeded.length > 0) parts.push(`${RESTART_WHY}: ${namesOf(restartNeeded)}`)
  if (nowhere.length > 0) parts.push(`${namesOf(nowhere)} ${nowhere.length === 1 ? 'has' : 'have'} no chat in the app: open ${nowhere.length === 1 ? 'one' : 'them'} from the board`)
  const head = reachable === total ? `All ${total} chats reachable` : `${reachable} of ${total} chats reachable`
  const line = picture.tooSlow === true ? `Checked ${clockOf(now)}, but the app's chat list could not be read in 30 s: checked again at the next start`
    : [`${head} · checked ${clockOf(now)}`, ...parts].join(' · ')
  return {
    at: now, trigger: picture.trigger ?? 'start', total, reachable, line, tone: parts.length > 0 || picture.tooSlow === true ? 'attention' : 'quiet', fixed, elsewhere, restartNeeded, nowhere, tooSlow: picture.tooSlow === true,
    actions: { noteRun: picture.proofAt, reopen, banDrops, closeIncidents },
  }
}

// ---- Task 4: the writes ----

/** The wake notice of a chat as the record reads it now (wake.mjs `noticeOf`), or null: before and after a write they tell whether it went. */
function noticeTextOf(record, chat, now) {
  const spell = record?.wakes?.get(chat)?.at(-1)?.spell
  if (spell === undefined) return null
  return noticeOf(record, [{ chat, spell, paths: ['message', 'launch'], need: true }], now, clockOf, { senderClaims: true })?.text ?? null
}

/**
 * A ban lifted by the check: the failing envelope reads `outcome.set: true` with who and when (`liftedBy`, `liftedAt`), so
 * `bansOf` sees no ban (handover.mjs: a later `set: true` lifts). `envelopes` the lane's, `id` the failing envelope's. True when done.
 */
export function liftBan(envelopes, id, now) {
  const envelope = (envelopes ?? []).find(one => one?.id === id)
  if (envelope === undefined || envelope.outcome === undefined || envelope.outcome === null) return false
  envelope.outcome = { ...envelope.outcome, set: true, liftedBy: 'check', liftedAt: now }
  return true
}

/**
 * Task 4: writes the verdict's fixes through the existing writers, each one once, and returns the check's result (the state's
 * `check`, `data/check.json`). `writers`: `wakes` (the wake record), `liftBan({ chat, model, envelope }, now)` (the outbox),
 * `closeIncidents([{ id, why }])` (the work API's `incident-gone`), `saveWakes()` and `writeCheck(result)`. A writer that is
 * missing does nothing (the fix is then not in `fixed` of the result). Never throws for a writer's failure: it is in `failed`.
 */
export async function apply(verdict, writers, now) {
  const done = new Set()
  const failed = []
  const attempt = async (kind, work) => {
    try {
      return await work()
    } catch (error) {
      failed.push(`${kind}: ${error?.message ?? error}`)
      return null
    }
  }
  const { actions } = verdict
  // G1's own blocks: the run id is the proof the app is back, then the spells that failed for good are re-opened once.
  let reopened = []
  const noticesBefore = new Map()
  if (writers.wakes !== undefined && actions.reopen.length > 0) {
    reopened = await attempt('wake-again', () => {
      for (const one of actions.reopen) noticesBefore.set(one.chat, noticeTextOf(writers.wakes, one.chat, now))
      noteRun(writers.wakes, actions.noteRun)
      return reopenSpells(writers.wakes, actions.reopen.map(one => ({ chat: one.chat, spell: one.spell, listed: true, paths: ['message', 'launch'] })), now)
    }) ?? []
    for (const chat of reopened) done.add(`wake-again ${chat}`)
    for (const chat of reopened) if (noticesBefore.get(chat) != null && noticeTextOf(writers.wakes, chat, now) === null) done.add(`notice-cleared ${chat}`)
    if (reopened.length > 0) await attempt('wake-again', () => writers.saveWakes?.())
  }
  if (typeof writers.liftBan === 'function') {
    for (const drop of actions.banDrops) if (await attempt('ban-dropped', () => writers.liftBan(drop, now)) === true) done.add(`ban-dropped ${drop.chat}`)
  }
  if (typeof writers.closeIncidents === 'function' && actions.closeIncidents.length > 0) {
    const list = actions.closeIncidents.filter(one => one.requires == null || reopened.includes(one.requires))
    const closed = list.length === 0 ? [] : await attempt('incident-gone', () => writers.closeIncidents(list))
    for (const id of Array.isArray(closed) ? closed : []) done.add(`incident-gone ${id}`)
  }
  // Only what was written stays in `fixed`; the id of an incident is in its `what` ("X154 gone after the check at ...").
  const written = verdict.fixed.filter(one => (one.kind === 'incident-gone' ? done.has(`incident-gone ${one.what.split(' ')[0]}`) : done.has(`${one.kind} ${one.chat}`)))
  const result = {
    at: now, trigger: verdict.trigger ?? 'start', running: false, total: verdict.total, reachable: verdict.reachable, line: verdict.line, tone: verdict.tone,
    fixed: written, elsewhere: verdict.elsewhere, restartNeeded: verdict.restartNeeded, nowhere: verdict.nowhere, tooSlow: verdict.tooSlow,
    ...(failed.length > 0 ? { failed } : {}),
  }
  if (typeof writers.writeCheck === 'function') await attempt('check.json', () => writers.writeCheck(result))
  return result
}
