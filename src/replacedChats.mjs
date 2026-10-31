// B847 (the person, 2026-10-31: "why do we still have worker 1 leftovers?", then yes to the root fix): a routine opens a NEW
// chat with the worker's title on each run, so the chat of the run before stays in the app's list as a leftover lane. Once the
// newer chat of that title has checked in and holds the lane, the older ones are archived by the board (the app's
// archive_session, by a running chat's Workers mod, like the restart of B766). PURE: it reads what it is given.

import { folderKey } from './appChats.mjs'

/** The Workers mod that can archive a chat with no reopening (a job `{ archive: true }`); older ones drop the job unread. */
export const ARCHIVE_MOD = '0.26.10'
/** An older chat counts as idle only after it has been quiet this long (the app refuses a working one too). */
export const QUIET_MS = 5 * 60_000
/** The same chat is archived again only after this long when the last try failed. */
export const ARCHIVE_AGAIN_MS = 5 * 60_000

/** The id of the job that archives the app chat `session`. */
export const archiveJobId = session => `archive:${session}`
/** The app chat a job id names, or null. */
export const archivedBy = id => /^archive:(local_[\w-]{1,80})$/.exec(String(id ?? ''))?.[1] ?? null

const isAppId = session => typeof session === 'string' && /^local_[\w-]{1,80}$/.test(session)
const sameFolder = (a, b) => typeof a !== 'string' || typeof b !== 'string' || folderKey(a) === folderKey(b)

const HELD = ['taken', 'in progress', 'waiting on you']
/**
 * Whether the worker's name holds an open step that its live chat does not show as its task: the step may sit with an
 * older chat of the name (a step is owned by the name, not by one chat), so no older chat is closed until it moves.
 */
const holdsStepOfOthers = lane => (lane.storeSteps ?? []).some(step => HELD.includes(step?.state) && step.id !== lane.task?.stepId)

/**
 * The older chats of a worker that a newer chat replaced: `[{ session, chat, cwd, why }]`. `lanes` are the board's lanes
 * (leftovers too), `now` the clock, `given` the app ids archived lately (id → time of the last try, ARCHIVE_AGAIN_MS).
 *
 * A leftover lane (`isLeftover`) is named when ALL hold: a live lane of its name exists, is no leftover, runs and has
 * reported (`report`: it checked in), and was made after the leftover's last activity (the older chat had stopped before the
 * newer began, so it cannot work) and no open step of the name is missing from the live lane's task (`holdsStepOfOthers`);
 * it works in the same folder; it has been quiet for QUIET_MS, and
 * the app does not say it needs the person (`needsAction`); it has an app id; and no word to archive it went lately.
 * The live lane itself is never named. The caller still checks that the folder has no uncommitted changes.
 */
export function replacedChats({ lanes = [], now, given = new Map() }) {
  const live = new Map()
  for (const lane of lanes) if (lane?.isLeftover !== true && typeof lane?.name === 'string' && !live.has(lane.name)) live.set(lane.name, lane)
  const found = []
  for (const old of lanes) {
    if (old?.isLeftover !== true || !isAppId(old.appSession)) continue
    const lane = live.get(old.name)
    if (lane === undefined || lane.appSession === old.appSession) continue
    if (lane.isRunning !== true || lane.report == null || !Number.isFinite(lane.createdAt) || !Number.isFinite(old.lastActivityAt)) continue
    if (lane.createdAt <= old.lastActivityAt || !sameFolder(lane.cwd, old.cwd)) continue
    if (holdsStepOfOthers(lane)) continue
    if (now - old.lastActivityAt < QUIET_MS) continue
    if (typeof old.needsAction === 'string' && old.needsAction.trim() !== '') continue
    if (now - (given.get(old.appSession) ?? -Infinity) < ARCHIVE_AGAIN_MS) continue
    found.push({ session: old.appSession, chat: old.name, cwd: old.cwd ?? null, why: `${old.name}: a newer chat of the same name (${lane.appSession}) has checked in; this one has been idle since ${new Date(old.lastActivityAt).toISOString()}` })
  }
  return found
}

/**
 * Whether the working folder `cwd` of a chat has nothing uncommitted. `run(args)` answers git's output or null (src/folders.mjs
 * gitRunner). A folder that is no git work tree (or is gone) holds nothing git could lose; a work tree whose status git cannot
 * read, or that shows any change, is not clean.
 */
export async function hasNothingUncommitted(cwd, run) {
  if (typeof cwd !== 'string' || cwd === '') return false
  const inside = await run(['-C', cwd, 'rev-parse', '--is-inside-work-tree'])
  if (inside === null || inside.trim() !== 'true') return true
  const status = await run(['-C', cwd, 'status', '--porcelain'])
  return status !== null && status.trim() === ''
}
