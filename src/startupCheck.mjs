// The start-up check (2026-11-05, chat 3's brief and chat 1's plan): after an outside event (a crash, a pause, a landing, a
// Claude update, an account switch) the board re-reads reality once, instead of one fix per symptom. Three pure parts and the
// writes: `pictureOf` reads the sources into one plain object (no decisions), `judge` decides the fixes and the one line, `apply`
// writes the fixes through the existing writers. The runner and the triggers (server.mjs) come in stage 2.
//
// It reuses the wake blocks (src/wake.mjs `noteRun`, `reopenSpells`, `wakeOf`), the account folders (src/appChats.mjs
// `listedWhere`), the H1 texts (src/ownChat.mjs) and the C rule's bans (src/work/handover.mjs `bansOf`); nothing twice.

import { listedWhere } from './appChats.mjs'
import { wakeOf } from './wake.mjs'
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
export function pictureOf({ now, folders = [], lanes = [], reports = {}, wakes = null, pause = null, ready = [], envelopes = {}, incidents = [] }) {
  const newest = Math.max(0, ...folders.map(folder => folder.at))
  const withReport = lanes.map(lane => {
    const report = reports?.[lane.name] ?? null
    return {
      name: lane.name, appSession: lane.appSession ?? null, cliSession: lane.cliSession ?? null, model: lane.model ?? null,
      isRunning: lane.isRunning ?? null, run: isTime(report?.run) ? report.run : null,
      listedWhere: listedWhere(lane.appSession, folders),
    }
  })
  // The newest run id among the chats that run: the mod's run id is when its process started, so one newer than a wake's
  // verdict says the app was back since (wake.mjs `noteRun`).
  const runs = withReport.filter(lane => lane.isRunning === true && lane.run !== null).map(lane => lane.run)
  return {
    now,
    accounts: folders.map(folder => ({ account: folder.account, org: folder.org ?? null, at: folder.at, ids: [...folder.ids], isSignedIn: folder.at === newest })),
    // The app does not mark the account in use: the folder with the newest activity counts, said as such in the line.
    signedIn: folders.filter(folder => folder.at === newest).map(folder => folder.account),
    lanes: withReport,
    newestRun: runs.length === 0 ? null : Math.max(...runs),
    wakes: Object.fromEntries(lanes.map(lane => [lane.name, wakeOfChat(wakes, lane.name)])),
    pause: { state: pause?.state ?? null },
    ready: [...ready],
    bans: Object.fromEntries(lanes.map(lane => [lane.name, [...bansOf(envelopes?.[lane.name] ?? [], now)].map(([model, envelope]) => ({ model, envelope: envelope.id ?? null, failedAt: envelope.failedAt ?? envelope.settledAt ?? envelope.at ?? null }))])),
    incidents: incidents
      .filter(one => WAKE_RULES.some(rule => typeof one.key === 'string' && one.key.startsWith(rule)) && !ENDED.includes(one.state))
      .map(one => ({ id: one.id, key: one.key, subject: one.subject ?? null, state: one.state, since: isTime(one.since) ? one.since : storeTimeOf(one.since) })),
  }
}
