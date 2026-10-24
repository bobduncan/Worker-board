// B465: the loop of the board's own list of the ways work got stuck (the repair rules, rules/repair.mjs). The person,
// 2026-10-21 (I50): "i want a structural fix for preventing this it gets stuck, of the out of sync button verifies this
// as well". The board runs the list every few minutes (index.mjs `start`) and makes the safe fixes itself; "Out of
// sync?" runs it at once. What it cannot fix goes to the main chat as one note, never twice for the same thing.
//
// The supervisor (spec 2026-10-24): moved here from src/work/sync.mjs without changing what it finds or does: the
// runner and its one run at a time (`syncRunner`), the fixes (`applySync`), and one loop per project (`loopOwner`,
// `readLoopLock`, `mayRunLoop`; B482, B487, B489). The runner reads the view, runs the rules over it, and acts only
// through the ports it is given.

import { CHECKS, REPAIR_RULES } from './rules/repair.mjs'

const MIN = 60_000

/** How often the board runs the list by itself. */
export const SYNC_EVERY_MS = 3 * MIN

const pad = n => String(n).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`

/** B482: how long the loop's lock (`mayRunLoop`) holds without a run of its owner. */
export const LOOP_LOCK_MS = 2 * SYNC_EVERY_MS + MIN

/**
 * B482: one loop per project. `lock` is what the project's lock file holds (`{ pid, port, at }`, or null): this board
 * process (`me`) may run the list when there is none, it is its own, or its owner has not run for LOOP_LOCK_MS (gone).
 */
export function mayRunLoop(lock, me, now) {
  if (lock === null || typeof lock !== 'object' || !Number.isFinite(lock.at)) return true
  return lock.pid === me || now - lock.at > LOOP_LOCK_MS
}

/**
 * B487: what the project's lock file holds, read through `read` (a function giving its text). None, or one cut off
 * mid-write (not JSON), is null: taken over like a dead one. Any other failure is thrown, for the loop record.
 */
export async function readLoopLock(read) {
  let text
  try {
    text = await read()
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

/**
 * The findings carried out, in their order. `ports`: `unblock(id, on, why)` and `requeue(id, to, why)` (the work API as
 * the board: `{ ok, why }`), `wake({ chat, id, text, key })` (the line sent once per key: the message, or null when it
 * went before), `clean(leftover)` (worktree clean-up: `{ ok, why }`). `noted` the keys the main chat was told of before.
 * Answers `{ rows, note, keys, fine }`: a row per finding (`{ check, status, text }`, status Fixed, Woke, Sent, For
 * Main, Cleaned or Left), the lines of the one note to the main chat (what it was not told before), their keys, and
 * how many checks found nothing (a check that only lists, Left, counts as one that found nothing).
 */
/** A wake through its port: `{ message, why }`, the message or null (sent before), and why it failed when it threw. */
const wakeBy = (ports, one) => Promise.resolve().then(() => ports.wake(one))
  .then(message => ({ message: message ?? null, why: null }), error => ({ message: null, why: error instanceof Error ? error.message : String(error) }))

export async function applySync(findings, ports, noted = new Set()) {
  const rows = []
  const note = []
  const keys = []
  const tell = (one, line) => {
    if (noted.has(one.key) || keys.includes(one.key)) return
    keys.push(one.key)
    note.push(line)
  }
  const row = (one, status, text) => rows.push({ check: one.check, status, text })
  for (const one of findings) {
    const fix = one.fix
    if (fix.do === 'unblock' || fix.do === 'requeue') {
      const done = await Promise.resolve()
        .then(() => (fix.do === 'unblock' ? ports.unblock(fix.id, fix.on, one.text) : ports.requeue(fix.id, fix.to, one.text)))
        .catch(error => ({ ok: false, why: error instanceof Error ? error.message : String(error) }))
      if (done?.ok === true) row(one, 'Fixed', `${one.text}: ${fix.do === 'unblock' ? 'unblocked' : `queued for ${fix.to}`}`)
      else {
        const text = `${one.text}: not fixed (${done?.why ?? 'no answer'})`
        row(one, 'For Main', text)
        // The review: a file changed while it was written is tried again at the next run; nothing for the main chat.
        if (!/changed in the meantime/.test(done?.why ?? '')) tell(one, text)
      }
    } else if (fix.do === 'wake') {
      // The review: a wake that throws is one finding not carried out, not the end of the run.
      const sent = await wakeBy(ports, { chat: fix.chat, id: fix.id, text: fix.text, key: one.key })
      if (sent.message !== null) row(one, 'Woke', one.text)
      else {
        const text = `${one.text}: ${sent.why === null ? 'woken before, still stuck' : `not woken (${sent.why})`}`
        row(one, 'For Main', text)
        tell(one, text)
      }
    } else if (fix.do === 'woken') {
      row(one, 'Woke', `${one.text} (woken at ${clockOf(fix.at)})`)
    } else if (fix.do === 'send') {
      row(one, 'Sent', `${one.text}: to Main as a note`)
      tell(one, fix.text)
    } else if (fix.do === 'clean') {
      // Worktree clean-up: removed by the board; one that could not be is listed, and no chat is told.
      const done = await Promise.resolve().then(() => ports.clean(fix.leftover))
        .catch(error => ({ ok: false, why: error instanceof Error ? error.message : String(error) }))
      if (done?.ok === true) row(one, 'Cleaned', one.text)
      else row(one, 'Left', `${one.text}: not removed (${done?.why ?? 'no answer'})`)
    } else if (fix.do === 'list') {
      row(one, 'Left', one.text)
    } else if (fix.do === 'hand') {
      const sent = await wakeBy(ports, { chat: fix.chat, id: fix.id, text: fix.text, key: `${one.key} hand` })
      const text = `${one.text}: ${sent.why === null ? `its work went to ${fix.chat}` : `${fix.chat} could not be told (${sent.why})`}`
      row(one, 'For Main', text)
      tell(one, `${text}; start it`)
    } else {
      row(one, 'For Main', one.text)
      tell(one, fix.text ?? one.text)
    }
  }
  return { rows, note, keys, fine: CHECKS.length - new Set(findings.filter(one => one.fix.do !== 'list').map(one => one.check)).size }
}

/** How long the answer of a run that was asked, or that found something, stands on the page. */
export const SYNC_SHOWN_MS = 60 * MIN
/** The keys the main chat was told of, kept at most this many (the newest). */
const NOTED_KEPT = 500

/**
 * The board's runner of the list: one run at a time, in turn (a click while a run goes waits for it, then runs). `ports`:
 * `state()` the board's state (state.mjs), `items()` the store's items, `outbox()` the board's messages, `refused()` the
 * names a chat was refused under lately, `apply(body)` the work API as the board, `wake({ chat, id, text, key })` a
 * line sent once per key (the message, or null), `noted` `{ load(), save(keys) }` the keys the main chat was told of,
 * `now()`; worktree clean-up: `leftovers({ items, now })` what worktrees.mjs `findLeftovers` finds, and `clean(one)`
 * its `cleanLeftover` (both left out: no such check). `run({ asked })` answers `{ at, asked, rows, fine }`; `shown(now)`
 * is what the page shows: the newest run that was asked or found something (more than what it only lists, Left), for an
 * hour, else null. `rules` are the rules it runs over the view, in their order (the repair rules unless given).
 */
export function syncRunner(ports, rules = REPAIR_RULES) {
  let turn = Promise.resolve()
  let shownRun = null
  let noted = null
  // The review: since when each thing that counts only once it lasts has been seen (the rules' `ctx.seen`).
  let seen = new Map()
  async function once(asked) {
    const now = ports.now()
    const state = await ports.state()
    // B482: what was noted and seen is kept with the project (sync.json) and read at every run, so a restart, or a
    // board that takes the loop over from another, neither tells the main chat again nor starts a wait anew
    const kept = await ports.noted.load()
    noted = new Set(Array.isArray(kept) ? kept : kept?.noted ?? [])
    if (!Array.isArray(kept) && kept?.seen !== null && typeof kept?.seen === 'object') {
      seen = new Map(Object.entries(kept.seen).filter(([, at]) => Number.isFinite(at)))
    }
    const observed = []
    const items = await ports.items()
    const view = {
      items, lanes: state.chats ?? [], partner: state.advisor ?? null, helper: state.advisorHelper ?? null,
      prefix: state.chatPrefix ?? '', now, outbox: ports.outbox(), limits: state.limits ?? {}, pause: state.pause ?? null, refused: ports.refused(),
    }
    view.leftovers = await lookLeftovers(ports, items, now)
    const findings = rules.flatMap(rule => rule.check(view, { seen, observed }))
    const seenBefore = JSON.stringify([...seen])
    seen = new Map(observed.map(key => [key, seen.get(key) ?? now]))
    let changed = JSON.stringify([...seen]) !== seenBefore
    const done = await applySync(findings, {
      unblock: (id, on, why) => ports.apply({ action: 'unblock', id, on, why }),
      requeue: (id, to, why) => ports.apply({ action: 'requeue', id, for: to, why }),
      wake: ports.wake,
      clean: ports.clean,
    }, noted)
    if (done.note.length > 0) {
      const sent = await ports.apply({ action: 'note', to: 'main', text: [`The board's sync check at ${clockOf(now)}: what it could not fix itself`, ...done.note.map(line => `- ${line}`)] })
      // Not filed: told at the next run. Filed: never again for these keys.
      if (sent?.ok === true) {
        for (const key of done.keys) noted.add(key)
        noted = new Set([...noted].slice(-NOTED_KEPT))
        changed = true
      }
    }
    if (changed) await ports.noted.save({ noted: [...noted], seen: Object.fromEntries(seen) })
    const answer = { at: now, asked, rows: done.rows, fine: done.fine }
    // The review: a later run that finds nothing clears what the board found by itself; the button's answer stays.
    if (asked || answer.rows.some(row => row.status !== 'Left')) shownRun = answer
    else if (shownRun !== null && !shownRun.asked) shownRun = null
    return answer
  }
  return {
    run: ({ asked = false } = {}) => {
      const run = turn.then(() => once(asked))
      turn = run.catch(error => ports.failed?.(error))
      return run
    },
    shown: now => (shownRun !== null && now - shownRun.at < SYNC_SHOWN_MS ? shownRun : null),
  }
}

/**
 * Worktree clean-up: the leftover worktrees through the runner's port `leftovers`, for the rule `worktrees`: `{ found }`,
 * or `{ error }` when the look failed (one row, Left, not the end of the run); undefined without the port (no such check).
 */
async function lookLeftovers(ports, items, now) {
  if (typeof ports.leftovers !== 'function') return undefined
  try {
    return { found: await ports.leftovers({ items, now }) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * B489: the loop's own check, as the server runs it before every list: `read` and `write` (the lock file's text, in and
 * out), `alive(pid)`. Gives true when this process (`pid`) holds the lock after it, with the lock written then.
 */
export function loopOwner({ read, write, alive, pid, port, now }) {
  return async () => {
    const held = await readLoopLock(read)
    // a lock whose process is gone (a board killed without its exit) is taken over at once
    const lock = held !== null && Number.isInteger(held.pid) && held.pid !== pid && !alive(held.pid) ? null : held
    if (!mayRunLoop(lock, pid, now())) return false
    await write(JSON.stringify({ pid, port, at: now() }))
    return true
  }
}
