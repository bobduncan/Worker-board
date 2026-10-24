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
import { buildView } from './view.mjs'

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
/** The supervisor's own memory keeps its repairs and the times each rule tripped this long. */
const DAY = 24 * 60 * MIN
/** The times a rule tripped, kept at most this many (the newest). */
const TRIPS_KEPT = 500
/** A repair rule's row that says the board did something: a fix, a wake, a note to the main chat, a clean-up. */
const REPAIRED = ['Fixed', 'Woke', 'Sent', 'Cleaned']

/**
 * The supervisor (Review Focus 1): the rules run one by one over the view; a rule that throws (bad data, a missing file)
 * is one finding of its own, `rule <id> failed: <why>`, and the others still run. Answers `{ findings, failed, states }`:
 * what the rules found, the failures, and per rule what it found (`{ rule, found, failed }`).
 */
export function runRules(rules, view, ctx) {
  const findings = []
  const failed = []
  const states = []
  for (const rule of rules) {
    try {
      const found = rule.check(view, ctx)
      findings.push(...found)
      states.push({ rule, found, failed: null })
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      const one = {
        rule: rule.id, key: `rule-failed ${rule.id}`, subject: rule.id, text: `rule ${rule.id} failed: ${why}`,
        evidence: String(error?.stack ?? why).split('\n').slice(0, 2).map(line => line.trim()).join(' '), failed: true,
      }
      failed.push(one)
      states.push({ rule, found: [], failed: one })
    }
  }
  return { findings, failed, states }
}

/** The supervisor's own memory as its file keeps it: `{ seen, repairs, trips }`, anything else left out. */
function memoryOf(value) {
  const seen = value?.seen !== null && typeof value?.seen === 'object' ? Object.entries(value.seen).filter(([, at]) => Number.isFinite(at)) : []
  const repairs = Array.isArray(value?.repairs) ? value.repairs.filter(one => Number.isFinite(one?.at) && typeof one?.rule === 'string') : []
  const trips = value?.trips !== null && typeof value?.trips === 'object'
    ? Object.entries(value.trips).filter(([, times]) => Array.isArray(times)).map(([id, times]) => [id, times.filter(Number.isFinite)]) : []
  return { seen: new Map(seen), repairs, trips: new Map(trips) }
}
const memoryText = memory => JSON.stringify({ seen: Object.fromEntries(memory.seen), repairs: memory.repairs, trips: Object.fromEntries(memory.trips) })

/**
 * The board's runner of the list: one run at a time, in turn (a click while a run goes waits for it, then runs). `ports`:
 * `state()` the board's state (state.mjs), `items()` the store's items, `outbox()` the board's messages, `refused()` the
 * names a chat was refused under lately, `apply(body)` the work API as the board, `wake({ chat, id, text, key })` a
 * line sent once per key (the message, or null), `noted` `{ load(), save(keys) }` the keys the main chat was told of,
 * `now()`; worktree clean-up: `leftovers({ items, now })` what worktrees.mjs `findLeftovers` finds, and `clean(one)`
 * its `cleanLeftover` (both left out: no such check). `run({ asked, subject })` answers `{ at, asked, subject, rows, fine,
 * findings }` (`subject` the chat "Check now" in its menu named, or null);
 * `shown(now)` is what the page shows: the newest run that was asked or found something (more than what it only lists,
 * Left), for an hour, else null. `rules` are the repair rules it runs over the view and carries out, in their order.
 *
 * The supervisor: `watch` are the watch rules, run after the repairs over the same view (with the day's repairs, this
 * run's among them); what they find, and every rule that failed, is the run's `findings` (report only). Their own watch,
 * the day's repairs and the times each rule tripped are the supervisor's memory: `memory` `{ load(), save(value) }`
 * (kept in memory alone without it), read at every run as sync.json is. `mods()` the Workers mod installed and per chat
 * (`{ installed, chats }`), `settings` the thresholds (config.json's `supervisor`). `status()` is `{ at, rules }`: when
 * it last ran, and each rule with how it stood then (`fine`, `tripped`, `failed`; null before the first run) and how
 * often it tripped in the last day.
 */
export function syncRunner(ports, rules = REPAIR_RULES, watch = []) {
  let turn = Promise.resolve()
  let shownRun = null
  let noted = null
  // The review: since when each thing that counts only once it lasts has been seen (the rules' `ctx.seen`).
  let seen = new Map()
  let memory = memoryOf(null)
  let status = { at: null, rules: [...rules, ...watch].map(rule => ({ id: rule.id, kind: rule.kind, says: rule.says, state: null, why: null, trips: 0 })) }
  async function once(asked, subject) {
    const now = ports.now()
    const state = await ports.state()
    // B482: what was noted and seen is kept with the project (sync.json) and read at every run, so a restart, or a
    // board that takes the loop over from another, neither tells the main chat again nor starts a wait anew
    const kept = await ports.noted.load()
    noted = new Set(Array.isArray(kept) ? kept : kept?.noted ?? [])
    if (!Array.isArray(kept) && kept?.seen !== null && typeof kept?.seen === 'object') {
      seen = new Map(Object.entries(kept.seen).filter(([, at]) => Number.isFinite(at)))
    }
    // The supervisor's own memory, read at every run as sync.json is.
    if (typeof ports.memory?.load === 'function') memory = memoryOf(await ports.memory.load())
    const memoryBefore = memoryText(memory)
    const observed = []
    const items = await ports.items()
    const view = buildView({
      state, items, outbox: ports.outbox(), refused: ports.refused(), leftovers: await lookLeftovers(ports, items, now),
      repairs: memory.repairs, mods: typeof ports.mods === 'function' ? await ports.mods() : null, settings: ports.settings ?? {}, now,
    })
    const repairs = runRules(rules, view, { seen, observed })
    const findings = repairs.findings
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
    // The supervisor: what the repairs did (one row per finding, in their order), for the watch rule repair-repeats.
    const repaired = findings.flatMap((one, index) => (REPAIRED.includes(done.rows[index]?.status) && one.fix?.do !== 'woken'
      ? [{ at: now, rule: one.rule ?? one.check, subject: one.subject ?? null, key: one.key }] : []))
    memory.repairs = [...memory.repairs, ...repaired].filter(one => now - one.at < DAY)
    let watched = { findings: [], failed: [], states: [] }
    if (watch.length > 0) {
      const looked = []
      watched = runRules(watch, Object.freeze({ ...view, repairs: Object.freeze([...memory.repairs]) }), { seen: memory.seen, observed: looked })
      memory.seen = new Map(looked.map(key => [key, memory.seen.get(key) ?? now]))
    }
    // Each rule as it stood in this run, and how often it tripped in the last day.
    const isTripped = ({ rule, found }) => (rule.kind === 'repair' ? found.some(one => one.fix?.do !== 'list') : found.length > 0)
    const states = [...repairs.states, ...watched.states]
    for (const one of states) {
      const times = (memory.trips.get(one.rule.id) ?? []).filter(at => now - at < DAY)
      if (one.failed === null && isTripped(one)) times.push(now)
      if (times.length > 0) memory.trips.set(one.rule.id, times.slice(-TRIPS_KEPT))
      else memory.trips.delete(one.rule.id)
    }
    status = {
      at: now,
      rules: states.map(one => ({
        id: one.rule.id, kind: one.rule.kind, says: one.rule.says,
        state: one.failed !== null ? 'failed' : isTripped(one) ? 'tripped' : 'fine',
        why: one.failed?.text ?? null, trips: (memory.trips.get(one.rule.id) ?? []).length,
      })),
    }
    if (typeof ports.memory?.save === 'function' && memoryText(memory) !== memoryBefore) await ports.memory.save(JSON.parse(memoryText(memory)))
    const answer = { at: now, asked, subject, rows: done.rows, fine: done.fine, findings: [...repairs.failed, ...watched.failed, ...watched.findings] }
    // The review: a later run that finds nothing clears what the board found by itself; the button's answer stays.
    if (asked || answer.rows.some(row => row.status !== 'Left')) shownRun = answer
    else if (shownRun !== null && !shownRun.asked) shownRun = null
    return answer
  }
  return {
    run: ({ asked = false, subject = null } = {}) => {
      const run = turn.then(() => once(asked, subject))
      turn = run.catch(error => ports.failed?.(error))
      return run
    },
    shown: now => (shownRun !== null && now - shownRun.at < SYNC_SHOWN_MS ? shownRun : null),
    status: () => status,
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
