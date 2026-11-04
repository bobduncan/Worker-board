// T13 part 4 (the person, 2026-10-28: after a restart work must come back by itself, without a timer that costs tokens;
// "every minute is better, but i dont want to spend a lot of tokens"): the board opens one chat when none runs. The hands
// (the Workers mod of any running chat, src/hands.mjs) carry every start, wake and resume; when no chat runs (after an
// app or PC restart, or when every chat went idle and its process closed) nothing carries them. The board runs outside
// the app and cannot message a chat, but it can open one: the Claude app's own program, `claude.exe --desktop --resume
// <the chat's CLI session id>`, opens that chat in the app; its process starts, its Workers mod loads and checks in as a
// hand, with no model turn (tried on this PC, 2026-10-28 19:40). The CLI refuses `--desktop` when its output is
// redirected, so it is started with a console of its own.
//
// The goal chat's points (2026-10-28) hold: any board chat with the mod is opened, the main chat while it exists, never
// by the name "Main" alone; a fixed launch, the program's path and a session id from the board's own list, no text of a
// request in its arguments; and a cooldown: when no hand checks in after a launch, the board stops and says so instead
// of looping (a login whose guard keeps the mod from loading). Pure but for `openChat`, which starts the program (its
// `spawn` is given in the tests).
//
// Signals change 4, B908 (2026-11-02, 10:32-11:08: nine launches of five sleeping workers, PowerShell ok each time, the
// board logged "started", nothing started; a message from the running Advisor woke Worker 5 in six seconds): the launch
// is the second path of the one wake procedure (src/wake.mjs), never the first while a running chat's mod can send, and
// never a verdict. Its counters (OPEN_TRIES, the 3-minute spacing, the failures in a row, the asleep look's own opens and
// its minute's wait) went into the wake record: one launch per chat and spell, a verdict from the chat's own report.
// What stays here: whether the hands are gone, the chat the board-wide spell launches, and the launch itself.

import { spawn as nodeSpawn } from 'node:child_process'

import { maySend } from './hands.mjs'
import { wakeIdsOf } from './ownChat.mjs'
import { isSessionId, nobodyRunsSpell, wakeNeeds } from './wake.mjs'

export { isSessionId }

/** No hand checked in for this long: no chat with the Workers mod runs (a running one claims every 20 s). */
export const HANDS_GONE_MS = 60_000
/** The check runs once a minute, and once this long after the board starts. */
export const OPEN_CHECK_MS = 60_000
export const OPEN_FIRST_MS = 10_000

/**
 * The Claude app's program as the board found it (setup.mjs `findClaude`): an absolute Windows path to `claude.exe`
 * whose folders hold letters, digits, spaces and `_ . ( ) + ~ -` only, so no quote or other character PowerShell reads
 * passes into the launch.
 */
export const isProgram = exe => typeof exe === 'string' && exe.length <= 400 && /^[A-Za-z]:\\(?:[\p{L}\p{N}_ .()+~-]+\\)*claude\.exe$/iu.test(exe)

/** Whether `cwd` is a folder the launch may name: an absolute Windows path of the same plain characters as the program's. */
export const isFolder = cwd => typeof cwd === 'string' && cwd.length <= 400 && /^[A-Za-z]:\\(?:[\p{L}\p{N}_ .()+~-]+\\?)*$/u.test(cwd)

/**
 * T14: the newest time a hand that may send claimed (`maySend`: its mod says 'send', or is older than the first that
 * says it), out of `claims`; a chat in Auto mode without the allow rule is no such hand: its sends are denied.
 */
export const newestSender = claims => [...claims.values()].reduce((best, claim) => (Number.isFinite(claim?.at) && claim.at > best && maySend(claim) ? claim.at : best), -Infinity)

/**
 * Whether the hands are gone: no chat that may send (T14) claimed them (`claims`, the server's `codeClaims`, `{ at, can,
 * mod }` by name) within HANDS_GONE_MS. A board younger than that has heard no claim yet from chats that run: then a call
 * of any chat since its start (`calls`, the bridge's `seen.shown`, time by name) says one runs, and the minute's check
 * decides. Signals change 4: "no sender claims", the wake procedure's fact for its order (decision 8).
 */
export function handsGone({ claims = new Map(), now, startedAt = -Infinity, calls = {} }) {
  const newest = newestSender(claims)
  if (now - newest < HANDS_GONE_MS) return false
  if (now - startedAt >= HANDS_GONE_MS) return true
  return !Object.values(calls ?? {}).some(at => Number.isFinite(at) && at >= startedAt)
}

/**
 * Whether something waits that a wake must bring a chat for: a chat that needs waking (src/wake.mjs `wakeNeeds`) or the
 * board-wide "nobody runs" spell (`nobodyRunsSpell`). Signals change 4: the one rule the banner, the hands and the
 * launch read.
 */
export function handWorkWaits(state, outbox = [], { resumeList = [] } = {}) {
  return wakeNeeds(state ?? {}, outbox ?? [], { resumeList }).length > 0 || nobodyRunsSpell(state ?? {}, outbox ?? []) !== null
}

/**
 * The chat the board-wide spell launches, `{ chat, session }`: the main chat while the list has one on the board, else the
 * partner, else the supervisor's chat, else a worker; never a chat left behind or removed. The first of them whose CLI
 * session id (the board's own state, `session`) is a UUID; null when none is.
 */
export function chatToOpen(state, outbox = []) {
  const lanes = (state?.chats ?? []).filter(lane => lane?.isLeftover !== true && (lane?.removedAt ?? null) === null)
  // The Product owner (2026-10-31): a talk word that waits for it opens its own chat first, so the person never waits for
  // another chat to come up and wake it; it has the Workers mod too, so it carries the other words as any hand.
  const owner = state?.productOwner ?? null
  const ownerWaits = typeof owner?.name === 'string' && (outbox ?? []).some(message => message?.state === 'waiting' && message.to === owner.name)
  const order = [ownerWaits ? owner : undefined, lanes.find(lane => lane.isMain === true), state?.advisor, state?.supervisorChat, ...lanes.filter(lane => lane.isMain !== true)]
  // B986: by each lane's own chat (ownChat.mjs), never the title's; one that cannot be woken (not in the app's list, not the shown chat) is not launched.
  const found = order.find(lane => typeof lane?.name === 'string' && wakeIdsOf(lane).why === null && isSessionId(wakeIdsOf(lane).session))
  return found === undefined ? null : { chat: found.name, session: wakeIdsOf(found).session }
}

/**
 * The launch, `{ file, args }`: PowerShell's Start-Process with the program and `--desktop --resume <session>`, so the
 * program gets a console of its own (hidden) and no redirected output. Built from a checked program path and session id
 * only; null for anything else.
 */
export function launchCommand({ exe, session, cwd }) {
  if (!isProgram(exe) || !isSessionId(session) || !isFolder(cwd)) return null
  // The project's folder as the program's own: `--resume` finds a session under the folder it runs in (2026-10-28 live:
  // the same launch without it left an asleep routine chat asleep; with it the chat started).
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${exe}' -ArgumentList '--desktop','--resume','${session}' -WorkingDirectory '${cwd}' -WindowStyle Hidden`],
  }
}

/**
 * Opens the chat: starts the launch detached, its own console, nothing redirected (`stdio` ignored), in `cwd`. Answers
 * `{ launched, ok, why }` once PowerShell ended (ok: the program started) or after `waitMs`; `launched` false when no
 * launch was made (the program or the session id is none the board may start).
 */
export function openChat({ exe, session, cwd, spawn = nodeSpawn, waitMs = 30_000 }) {
  const command = launchCommand({ exe, session, cwd })
  if (command === null) {
    const why = typeof exe !== 'string' ? 'the Claude app\'s program was not found'
      : !isProgram(exe) ? 'the Claude app\'s program lies in a folder whose name the board does not pass on'
        : !isFolder(cwd) ? 'the project\'s folder has a name the board does not pass on' : 'the chat\'s session id is no UUID'
    return Promise.resolve({ launched: false, ok: false, why })
  }
  return new Promise(done => {
    let child
    try {
      // Not detached (2026-10-28 live: a detached PowerShell's Start-Process left the chat asleep; this one woke it);
      // PowerShell ends at once anyway, and the program it starts is not the board's child.
      child = spawn(command.file, command.args, { windowsHide: true, detached: false, stdio: 'ignore', ...(typeof cwd === 'string' ? { cwd } : {}) })
    } catch (error) {
      done({ launched: true, ok: false, why: `PowerShell could not start: ${error?.message ?? error}` })
      return
    }
    const timer = setTimeout(() => {
      child.unref?.()
      done({ launched: true, ok: false, why: `PowerShell did not end within ${Math.round(waitMs / 1000)} s` })
    }, waitMs)
    child.once('error', error => {
      clearTimeout(timer)
      done({ launched: true, ok: false, why: `PowerShell could not start: ${error?.message ?? error}` })
    })
    child.once('exit', code => {
      clearTimeout(timer)
      done(code === 0 ? { launched: true, ok: true, why: null } : { launched: true, ok: false, why: `PowerShell ended with ${code}` })
    })
  })
}
