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

import { spawn as nodeSpawn } from 'node:child_process'

import { shownChats } from './bridge.mjs'
import { isAppId } from './hands.mjs'
import { RESTART_COMMAND } from './work/modRollout.mjs'

/** No hand checked in for this long: no chat with the Workers mod runs (a running one claims every 20 s). */
export const HANDS_GONE_MS = 60_000
/** At most one open in this time. */
export const OPEN_EVERY_MS = 3 * 60_000
/** An open after which no hand checked in within this long brought no chat back: a failure. */
export const OPEN_WAIT_MS = 2 * 60_000
/** After this many failures in a row the board opens nothing more and says so, until a hand checks in. */
export const OPEN_TRIES = 2
/** The check runs once a minute, and once this long after the board starts. */
export const OPEN_CHECK_MS = 60_000
export const OPEN_FIRST_MS = 10_000
/** The page's quiet line about an open stays this long. */
export const OPEN_SHOWN_MS = 15 * 60_000
/** OPEN_TRIES in words. */
const TIMES = OPEN_TRIES === 2 ? 'twice' : `${OPEN_TRIES} times`

/** The words in the outbox only a running chat's hands (or the main chat) carry: start, wake, resume, a new worker, a set, a restart, a remove. */
export const HAND_WAITS = ['start', 'wake', 'resume', 'spawn', 'worker-effort', 'partner-effort', RESTART_COMMAND, 'remove']

/** A chat's CLI session id as the app's list holds it: a UUID, and nothing else ever reaches the launch. */
export const isSessionId = session => typeof session === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session)

/**
 * The Claude app's program as the board found it (setup.mjs `findClaude`): an absolute Windows path to `claude.exe`
 * whose folders hold letters, digits, spaces and `_ . ( ) + ~ -` only, so no quote or other character PowerShell reads
 * passes into the launch.
 */
export const isProgram = exe => typeof exe === 'string' && exe.length <= 400 && /^[A-Za-z]:\\(?:[\p{L}\p{N}_ .()+~-]+\\)*claude\.exe$/iu.test(exe)

/** Whether `cwd` is a folder the launch may name: an absolute Windows path of the same plain characters as the program's. */
export const isFolder = cwd => typeof cwd === 'string' && cwd.length <= 400 && /^[A-Za-z]:\\(?:[\p{L}\p{N}_ .()+~-]+\\?)*$/u.test(cwd)

/**
 * Whether the hands are gone: no chat claimed them (`claims`, the server's `codeClaims`, `{ at }` by name) within
 * HANDS_GONE_MS. A board younger than that has heard no claim yet from chats that run: then a call of any chat since
 * its start (`calls`, the bridge's `seen.shown`, time by name) says one runs, and the minute's check decides.
 */
export function handsGone({ claims = new Map(), now, startedAt = -Infinity, calls = {} }) {
  const newest = [...claims.values()].reduce((best, claim) => (Number.isFinite(claim?.at) && claim.at > best ? claim.at : best), -Infinity)
  if (now - newest < HANDS_GONE_MS) return false
  if (now - startedAt >= HANDS_GONE_MS) return true
  return !Object.values(calls ?? {}).some(at => Number.isFinite(at) && at >= startedAt)
}

/**
 * Whether something waits that only a hand carries: a waiting word of HAND_WAITS in `outbox` (the server leaves out the
 * late ones), a resume (pause state resuming) with a chat that has not started, or (part 3) an asleep chat whose turn
 * was cut and whose resume word no hand was given for this spell (`asleepSent`, the server's, `{ since }` by chat).
 */
export function handWorkWaits(state, outbox = [], { asleepSent = new Map() } = {}) {
  if ((outbox ?? []).some(message => message?.state === 'waiting' && HAND_WAITS.includes(message.command))) return true
  if (state?.pause?.state === 'resuming' && (state.pause.waiting ?? []).length > 0) return true
  return shownChats(state ?? {}).some(lane => lane.asleep === true && lane.state === 'interrupted' && isAppId(lane.appSession)
    && Number.isFinite(lane.asleepSince) && asleepSent.get(lane.name)?.since !== lane.asleepSince)
}

/**
 * The chat to open, `{ chat, session }`: the main chat while the list has one on the board, else the partner, else the
 * supervisor's chat, else a worker; never a chat left behind or removed. The first of them whose CLI session id (the
 * board's own state, `session`) is a UUID; null when none is.
 */
export function chatToOpen(state) {
  const lanes = (state?.chats ?? []).filter(lane => lane?.isLeftover !== true && (lane?.removedAt ?? null) === null)
  const order = [lanes.find(lane => lane.isMain === true), state?.advisor, state?.supervisorChat, ...lanes.filter(lane => lane.isMain !== true)]
  const found = order.find(lane => typeof lane?.name === 'string' && isSessionId(lane.session))
  return found === undefined ? null : { chat: found.name, session: found.session }
}

/**
 * How many opens in a row brought no hand back: the opens (`{ at, ok }`) since the newest claim, each once OPEN_WAIT_MS
 * passed without one (a launch that did not start at once). A hand checking in resets it.
 */
export function failuresOf({ opens = [], claims = new Map(), now }) {
  const back = [...claims.values()].reduce((best, claim) => (Number.isFinite(claim?.at) && claim.at > best ? claim.at : best), -Infinity)
  return opens.filter(one => one.at > back && (one.ok !== true || now - one.at >= OPEN_WAIT_MS)).length
}

/**
 * Whether the board opens a chat now, `{ open, why }`: only while the hands are gone, hand work waits, the person does
 * not pause, the last open (`last`) is OPEN_EVERY_MS ago and fewer than OPEN_TRIES opens in a row brought no hand back.
 */
export function openPlan({ now, handsGone: gone, waits, paused, last = -Infinity, failures = 0 }) {
  if (!gone) return { open: false, why: 'a chat with the Workers mod runs' }
  if (!waits) return { open: false, why: 'nothing waits for a running chat' }
  if (paused) return { open: false, why: 'the person pauses the chats' }
  if (failures >= OPEN_TRIES) return { open: false, why: `${failures} opens in a row brought no chat back` }
  if (now - last < OPEN_EVERY_MS) return { open: false, why: 'a chat was opened less than 3 minutes ago' }
  return { open: true, why: 'no chat runs and work waits for one' }
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

/**
 * The page's line about the opens, `{ tone, text }` or null: attention once OPEN_TRIES opens in a row brought no chat
 * back; else, for OPEN_SHOWN_MS after the newest open, a quiet line. `timeOf` writes HH:MM.
 */
export function openerNote({ opens = [], failures = 0, now, timeOf }) {
  const newest = opens.at(-1)
  if (newest === undefined) return null
  if (failures >= OPEN_TRIES) return { tone: 'attention', text: `Opened ${newest.chat} ${TIMES}, but no chat came back: open any chat of the project yourself.` }
  if (now - newest.at < OPEN_SHOWN_MS) return { tone: 'quiet', text: `Opened ${newest.chat} at ${timeOf(newest.at)} to wake the chats.` }
  return null
}

/**
 * The ⚙ panel's row of it among what the board does by itself (B767): by itself, or why not: the board cannot open a
 * chat here (`blocked`), or the last tries brought no chat back (`failed`, the chat of the newest open).
 */
export function openerRow({ blocked = null, failed = null }) {
  const row = { key: 'open', title: 'Wake the chats when none runs' }
  if (blocked !== null) return { ...row, byCode: false, why: blocked }
  if (failed !== null) return { ...row, byCode: false, why: `the last try failed: no chat came back after the board opened ${failed} ${TIMES}` }
  return { ...row, byCode: true, why: null }
}
