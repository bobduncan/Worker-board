// Shut down (the person, 2026-11-21: "if i want to close claude & the worker board easily, the board is difficult to close for me").
// Two things brought a closed board back: every open chat's Workers mod looks at the board every 15 s and starts it through
// start-board.mjs when it does not answer (keepBoards), and start-board.mjs never read the stop sign that `--stop` (and /stop-app)
// write; only the watcher did. And a board left running when the person quits the app opens a chat by itself when work waits.
// Now:
//
// - A stop sign the person meant (`why: 'stopped'`, `by: 'command'`: start-board.mjs --stop, /stop-app, or the page's Shut down)
//   HOLDS: start-board.mjs refuses every start that is not the person's own (`startAllowed`): the chats' mod, the chat-open hook,
//   land.ps1's --quiet. The person's starts lift it: `--resume` (npm run resume), `--open` (the board's desktop icon) and `--anew`.
//   The watcher held for such a sign already (src/boardWatcher.mjs `isSignCurrent`). The board's own start takes the sign away
//   (src/boardSelf.mjs `takeStop`), so after a start nothing holds.
// - Shut down on the page (`shutdown` in the page's work API): Pause all first (each chat writes its checkpoint and ends its turn;
//   no hand-out, wake or reopen while pausing), then, once the pause is safe (src/work/pause.mjs `pauseFacts`' `isSafe`) or after
//   SHUTDOWN_WAIT_MS at the latest, or at once with "Shut down now", the board writes that sign and ends with 0 (its keeper ends
//   with it: src/keeper.mjs). A resume later finds the chats still paused: nothing respawns until the person's Resume all.
//
// PURE: the facts are passed in.

/** How long a shutdown waits for the chats to end their turns before it stops the board anyway. */
export const SHUTDOWN_WAIT_MS = 5 * 60_000

/** The flags of start-board.mjs that are the person's own start: they start a board although a held stop sign is there. */
export const PERSON_STARTS = ['--resume', '--open', '--anew']

/** Whether a stop sign (data/stop.json read, or null) holds the board down: one the person meant (`by: 'command'`, why stopped). */
export function isHeldSign(stop) {
  return stop !== null && typeof stop === 'object' && stop.why === 'stopped' && stop.by === 'command' && Number.isFinite(stop.at)
}

/**
 * Whether start-board.mjs may start the board with these words (`args`, its argv) and this stop sign (`stop`, or null):
 * `{ ok: true }`, or `{ ok: false, line }` with the one line that says why not and how to start it.
 */
export function startAllowed({ stop, args = [] }) {
  if (!isHeldSign(stop) || args.some(arg => PERSON_STARTS.includes(arg))) return { ok: true }
  const how = stop.how === 'shutdown' ? 'shut down' : 'stopped'
  return { ok: false, line: `The worker board was ${how} on purpose at ${clockOf(stop.at)}: it stays down. Start it again with the board's icon, or npm run resume (node start-board.mjs --resume).` }
}

/**
 * The shutdown on its way, as the page sees it: null for none, else `{ at, until, isNow }` (`until` the latest moment it stops).
 * `shutdown` is the server's record `{ at, isNow }`.
 */
export function shutdownView(shutdown) {
  if (shutdown === null || shutdown === undefined || !Number.isFinite(shutdown.at)) return null
  return { at: shutdown.at, until: shutdown.at + SHUTDOWN_WAIT_MS, isNow: shutdown.isNow === true }
}

/**
 * Whether the board ends now for the shutdown `shutdown` (`{ at, isNow }`, or null): "now" was asked, the pause is safe (`pause`,
 * the state's pause facts: `{ state: 'pausing', isSafe }`), or SHUTDOWN_WAIT_MS has passed since it was asked.
 */
export function isShutdownDue({ shutdown, pause, now }) {
  if (shutdown === null || shutdown === undefined || !Number.isFinite(shutdown.at)) return false
  if (shutdown.isNow === true) return true
  if (pause?.state === 'pausing' && pause.isSafe === true) return true
  return now - shutdown.at >= SHUTDOWN_WAIT_MS
}

/** The stop sign a shutdown writes: the person's (`by: 'command'`, so it holds), named a shutdown, with the start it belongs to. */
export function shutdownSign({ at, started = null }) {
  return { at, why: 'stopped', by: 'command', how: 'shutdown', ...(Number.isFinite(started) ? { started } : {}) }
}

const pad = n => String(n).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
