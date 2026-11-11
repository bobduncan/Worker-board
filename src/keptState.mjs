// board-fast-answer (B1030 way A, 2026-11-11): whether a work call may be answered from the KEPT state (the board's last whole read,
// server.mjs `readState.last()`) or must wait for a fresh one. The call's own truth is the store (the work API reads and writes it
// itself); from the state it takes the chats' names and roles, the prefix, the sessions, the step a chat's card names, and for some
// actions store-derived facts too (the goal map's nodes, the focus, the recap rows, the ready list's held steps, the free chats, the
// lanes for the resume list). Those last ones a kept state may show stale right after a write (the core review of 2026-11-11, finding
// 2: a goal just added refused as "not in the goal map", an ask the recap just answered sent to the person). So: a kept state serves
// a call when it is there, not older than `maxMs`, knows the calling chat, and either nothing was written since it was read (`dirty`
// false) or the action reads none of those facts (`KEPT_SAFE_ACTIONS`). PURE.

/**
 * The actions whose answer reads nothing of the state that a write changes: the frequent ones. `step` (a checkpoint), `report`,
 * `block`/`unblock` (the store), `turn-ended` without a For you block (its hand-over decision reads the state anew itself; with a
 * block it files asks, which read the goal map, the recaps and the card's step: `readsStoreFacts`), `pull` (its line is written after
 * the answer), `health` (B736's own path), `asset`, `incident`, `incident-fix`, `save-log`, `whoami`, `list` (a read whose wait
 * words lag as the page's do), and `note` unless it is of a goal. Not `take` nor `next` (the verifier of 2026-11-11): their answer
 * carries the recap rows' words of the step (`rowWordsBlock`), which a verdict just written must reach; the take path reads the
 * state anew itself anyway. Everything else (ask, new, refine, refined, answer, withdraw, words, pause-state, pause, resumed, drop,
 * close, checked, ...) reads the goal map, the recaps, the ready list or the lanes and waits for a fresh state when a write came
 * since the last read.
 */
export const KEPT_SAFE_ACTIONS = Object.freeze(new Set(['step', 'report', 'block', 'unblock', 'turn-ended', 'pull', 'health', 'asset', 'incident', 'incident-fix', 'save-log', 'whoami', 'list']))

/** A kept state older than this is read anew before a work call is answered from it (no page open, no loop ran). */
export const KEPT_STATE_MS = 60_000

/**
 * Why the kept state serves, or does not: 'kept' (answer from it), else the reason to read anew: 'none' (no kept state yet, the
 * first seconds after a start), 'old' (older than `maxMs`), 'unknown' (the calling chat has no role in it: just added, or cleared
 * into a new session), 'dirty' (a write since the last read, and the action reads store-derived facts). `last` the kept state (its
 * `readAt`), `roleOf(last, chat)` the chat's role in it or null, `chat` null for the person's and the server's own calls; `of` the
 * call's `of` field: a note of a goal (G<n>) reads the goal map, a note to the main chat does not; `forYou` whether a turn-ended
 * carries a For you block (its items are filed as asks, which read the goal map, the recaps and the card's step).
 */
export function keptStateWhy({ last, now, chat = null, action = null, of = null, forYou = false, dirty = false, roleOf = () => null, maxMs = KEPT_STATE_MS }) {
  if (last === null || last === undefined || typeof last !== 'object') return 'none'
  if (!Number.isFinite(last.readAt) || !Number.isFinite(now) || now - last.readAt > maxMs) return 'old'
  if (chat !== null && chat !== undefined && roleOf(last, chat) === null) return 'unknown'
  if (dirty === true && readsStoreFacts(action, of, forYou)) return 'dirty'
  return 'kept'
}

/**
 * Whether the action's answer reads a store-derived fact of the state: not a safe action; a note only when it is of a goal (G<n>);
 * a turn-ended only with a For you block (`forYou`).
 */
export function readsStoreFacts(action, of = null, forYou = false) {
  if (action === 'note') return /^G\d+$/i.test(String(of ?? '').trim())
  if (action === 'turn-ended') return forYou === true
  return !KEPT_SAFE_ACTIONS.has(String(action ?? ''))
}
