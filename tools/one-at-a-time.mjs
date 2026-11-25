// One heavy run at a time on this PC (the person's yes, 2026-10-25). The PC hard-crashed five times in two days while
// several chats each ran a full test suite, a build or a screen check at the same moment. A heavy command (the gate,
// the build, the board's tests) runs through this helper, which lets one of them run across every worktree of both
// repositories; the others wait their turn instead of failing.
//
//   node tools/one-at-a-time.mjs <label> -- <command and its arguments>
//
// The same file lives in each repository of the project that runs heavy commands (its tools folder); keep them alike.
//
// - The lock is one file for the whole PC, in the temporary folder (HEAVY_RUN_LOCK names another one, for the tests),
//   made by an exclusive create and holding { pid, label, cwd, startedAt }.
// - Held by another run: wait, look every 5 s (HEAVY_RUN_POLL_MS), say once a minute (HEAVY_RUN_SAY_MS) who holds it.
// - A lock is stale, and removed, when its process no longer runs, when it is older than 45 minutes, or when it cannot
//   be read (a crash zero-fills what was being written).
// - The command runs through the shell with this process's stdio and its exit code is ours. The lock is given back on
//   every way out; a lock that another run has taken over since is never removed.
// - HEAVY_RUN_HELD=1 is set for the command: a heavy command that starts another one (the gate runs the screen checks)
//   runs it at once, without the lock.
// - One argument after the dashes is taken as a whole command line for the shell ("tsc && vite build"); more than one
//   are quoted one by one (an argument with a double quote in it only works that way on Linux and the Mac; on Windows
//   give the whole command line as one argument).
// - Two at a time, first come first served (the person, 2026-10-31: "my pc hasnt crashed so far since the BIOS upgrade.
//   so maybe we allow more?" and "yes do 2 at a time"; a test run waited 40 minutes because whoever looked first went
//   next). HEAVY_RUN_SLOTS (default 2) runs may go at once: slot 1 is the lock file, slot n its `.n.lock` beside it.
//   A waiting run leaves a ticket in the queue folder beside the lock (`<lock>.queue`, named by when it came); it takes
//   a free slot only when fewer runs came before it than there are free slots, so the one that waited longest goes
//   first. A ticket whose process is gone is removed.
// - One at a time again (the person, 2026-11-11: "too often claude slows down my pc very often ... the test suite", then
//   "lets do A": one run at a time across all chats, at low priority, see tools/test.mjs). HEAVY_RUN_SLOTS now defaults to
//   1, and every slot file a run holds counts, also one beyond this run's own slots: a copy of this helper that still
//   allows two (the game's) never makes this one start beside it. A landing's gate is `npm test` too, so it waits in the
//   same queue.
// - F14 (2026-11-14): a run with HEAVY_RUN_FIRST=1 (a landing's gate, tools/land.ps1) goes ahead of the ordinary runs in the
//   queue: its ticket carries `first`, and an ordinary run counts every first-class ticket as ahead of it, also one that came
//   later. When a run takes its slot it says "one-at-a-time: <label> runs now (waited N s)", so a log of the run shows the
//   moment its work began (land.ps1 starts the gate's clock there, not while the run queues). The word stays with this
//   helper: the command runs without HEAVY_RUN_FIRST, so the runs the command starts in turn (a test of this helper under
//   the gate) are ordinary ones (chat 1's check, 2026-11-14: with the word passed on, every gate after F14 refused itself).
// - B1302 (X211): the board reads the lock, the slot files and the queue folder, read only (src/testQueue.mjs `readTestQueue`, with
//   this file's lockPath, slotPath, slotCountOf, whyStale and aheadOf), so the watch rule stale-checkpoint knows a worker whose run
//   waits its turn here is not stuck. A change to the files' shape ({ pid, label, cwd, startedAt }) or names changes that reader too.
// - F39 (2026-11-21, the person's yes): a run at work keeps its slot. The holder beats: it writes a new `beat` time into its slot
//   file every minute (HEAVY_RUN_BEAT_MS) while its command runs. A lock is stale when its process is gone, it cannot be read, or
//   its beat is older than 5 minutes (a reused process id). A lock without a beat (an older copy's) keeps the age rule, now 75
//   minutes, longer than land.ps1's 60-minute gate clock (on 2026-11-21 the 45-minute rule removed a live gate's lock at 12:05
//   and a second gate started beside it).
// - F39: fair order (queueOrder, one pure function, so two runs never both think it is their turn): a first-class ticket counts as
//   if it came 30 minutes earlier than it did. A landing jumps at most 30 minutes ahead; a worker that has waited 30 minutes or
//   more goes before a landing that came after that (on 2026-11-21 workers sat 50-100 minutes behind four landings). An old
//   copy's ordinary ticket is the one exception: it goes after every other ticket (see the next point).
// - F39, chat 1's review: copies of before F39 run beside this one (open worktrees, the game) until they merge main. A ticket of this
//   copy says `order: 2`; an unmarked ordinary ticket (an old copy's) is ranked by the old rule, after every first-class ticket,
//   as the old copy ranks itself, so the two never both wait for each other. Each beat also moves `startedAt` (old copies judge a
//   lock by it alone) and `since` keeps when the slot was taken. A live holder whose beat is old (the PC slept) is freed only after
//   its lock has stayed the same for two beats of the waiter's own clock. A holder is stopped after 120 minutes (HEAVY_RUN_MAX_MS:
//   its command ends with code 124), and its lock is stale past that with a margin. Waiters beat their ticket at every look; a ticket
//   with an old beat, or an old copy's ticket older than 3 hours, is dropped.
// - S3 (chat 1, 2026-11-25, the PC plan's queue hygiene): work on no step's critical path waits for an idle PC (isIdleRun: the slow
//   tier, a step's measure, draw and trial jobs, `perf-` runs, the `idle:` prefix, HEAVY_RUN_IDLE=1). Such a run waits in the idle
//   room beside the lock (`<lock>.idle`, beating tickets as in the queue), oldest first, and goes only when no ticket waits in the
//   queue and a slot is free: it puts a ticket in the queue for one look, takes the slot, or goes back to the room. The queue's order
//   and the old copies' rules do not change, and an old copy never sees an idle run waiting ahead of it (no two runs wait for each
//   other). An idle run that took the slot keeps it: a gate that comes right after waits for it to end (at most the cap). The hold
//   cap is also checked against the wall clock at every beat, so a run that hung across a PC sleep is stopped at the next beat after.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export const LOCK_NAME = 'one-heavy-run.lock'
/** F39: the age rule for a lock without a beat (an older copy's): above land.ps1's gate clock (gateMinutes, 60). */
export const MAX_AGE_MS = 75 * 60 * 1000
/** F39: how often the holder beats, and how old its beat may be before the lock is stale. */
export const BEAT_MS = 60 * 1000
export const BEAT_STALE_MS = 5 * 60 * 1000
/** F39: how much earlier a first-class ticket counts (a landing jumps at most this far ahead). */
export const FIRST_LEAD_MS = 30 * 60 * 1000
/** F39, review: how long one run may hold the slot (its command is stopped then), and how long past that its lock is stale. */
export const HOLD_MAX_MS = 120 * 60 * 1000
const HOLD_MARGIN_MS = 10 * 60 * 1000
/** F39, review: an old copy's ticket (no beat) older than this is dropped. */
export const TICKET_MAX_AGE_MS = 3 * 60 * 60 * 1000
/** F39, review: the mark of a ticket and a lock of this copy (fair order, beats). */
export const ORDER_MARK = 2
const POLL_MS = 5000
const SAY_MS = 60 * 1000
// A lock that cannot be read may only be the moment between its creation and its content: look once more before
// calling it stale.
const UNREADABLE_LOOK_MS = 250
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']
// After a signal the command gets this long to end before we give the lock back anyway.
const STOP_WAIT_MS = 5000

/**
 * The run log (the person, 2026-11-23: "log every wait"): one JSON line per heavy run that queued here, PC-wide, beside the
 * lock (`<lock>.runs.jsonl`), so the waits and the run times of every chat in both repositories can be counted
 * (`node tools/run-stats.mjs` in the game). A run started under another one (HEAVY_RUN_HELD) is part of it and not logged.
 * A log that cannot be written never stops a run. The same lines in both repositories' copies of this helper.
 */
export function runLogPath(env = process.env) {
  return `${lockPath(env)}.runs.jsonl`
}
export function logRun(env, record) {
  try {
    appendFileSync(runLogPath(env), `${JSON.stringify(record)}\n`)
  } catch {
    // no log today
  }
}

/** The lock file of this PC. */
export function lockPath(env = process.env) {
  return env.HEAVY_RUN_LOCK || path.join(os.tmpdir(), LOCK_NAME)
}

/** How many heavy runs may go at once (HEAVY_RUN_SLOTS, default 1). */
export const DEFAULT_SLOTS = 1
export function slotsOf(env = process.env) {
  const number = Math.floor(Number(env.HEAVY_RUN_SLOTS))
  return Number.isFinite(number) && number >= 1 ? number : DEFAULT_SLOTS
}

/**
 * S3 (chat 1, 2026-11-25): the labels of work on no step's critical path, which waits for an idle PC: the slow tier, a step's
 * measure, draw and trial jobs (`b1517-measure2`: at most a number after the word), `perf-` runs and any label with the `idle:` prefix. A builder's own proof
 * (related tests, mutants, carry runs) is no such work.
 */
export const IDLE_LABEL = /^(?:slow-tier$|idle:|perf-|b\d+-(?:measure|draw|trial)\d*$)/i
/** S3: whether a run waits for an idle PC: HEAVY_RUN_IDLE=1, or a label of IDLE_LABEL. */
export function isIdleRun(label, env = process.env) {
  return env.HEAVY_RUN_IDLE === '1' || IDLE_LABEL.test(String(label ?? ''))
}
/** S3: the idle room beside the lock, where idle runs wait (`<lock>.idle`, tickets as in the queue). */
export function idleRoomOf(file) {
  return `${file}.idle`
}

/** The file of slot `n` (from 1): slot 1 is the lock file itself, slot n is `<name>.n.lock` beside it. */
export function slotPath(file, n) {
  if (n === 1) return file
  return /\.lock$/i.test(file) ? file.replace(/\.lock$/i, `.${n}.lock`) : `${file}.${n}`
}

const positive = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

/** Does a process with this id run? (EPERM: it runs, but is not ours.) */
export function pidRuns(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

/** Why a lock is stale (a sentence), or null when its holder is at work. `info` is null for a lock that cannot be read. */
export function whyStale(info, now = Date.now(), runs = pidRuns, holdMaxMs = HOLD_MAX_MS) {
  if (!info) return 'it cannot be read'
  if (!runs(info.pid)) return 'its process is gone'
  // F39, review: no holder keeps the slot for good (its own copy stops its command at the cap; this is the margin past it).
  const since = Date.parse(info.since ?? info.startedAt)
  if (Number.isFinite(since) && now - since > holdMaxMs + HOLD_MARGIN_MS) return `it has held the slot for over ${Math.round((holdMaxMs + HOLD_MARGIN_MS) / 60000)} minutes`
  // F39: a holder that beats keeps its slot however long it runs; one whose beat stopped (a reused process id) does not.
  const beat = Date.parse(info.beat)
  if (Number.isFinite(beat)) return now - beat > BEAT_STALE_MS ? 'its beat is older than 5 minutes' : null
  if (now - Date.parse(info.startedAt) > MAX_AGE_MS) return 'it is older than 75 minutes and does not beat'
  return null
}

/** null: no lock. Otherwise the file's text and what it says (`info` null when that is not a lock). */
function readLock(file) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    return error.code === 'ENOENT' ? null : { raw: null, info: null }
  }
  try {
    const info = JSON.parse(raw)
    if (Number.isInteger(info?.pid) && info.pid > 0 && Number.isFinite(Date.parse(info.startedAt))) return { raw, info }
  } catch {
    // not JSON: stale
  }
  return { raw, info: null }
}

/** Makes the lock file with `text`; false when it is there already. */
function createLock(file, text) {
  let fd
  try {
    fd = openSync(file, 'wx')
  } catch (error) {
    // EEXIST: held. EPERM / EBUSY / EACCES: on Windows, a file that is being deleted.
    if (['EEXIST', 'EPERM', 'EBUSY', 'EACCES'].includes(error.code)) return false
    throw error
  }
  try {
    writeSync(fd, text)
  } finally {
    closeSync(fd)
  }
  return true
}

function removeFile(file) {
  try {
    unlinkSync(file)
    return true
  } catch (error) {
    return error.code === 'ENOENT'
  }
}

/** F39: writes `next` into the lock while it still holds `text` (ours): beside it, then over it. True when written. */
function rewriteLock(file, text, next) {
  try {
    if (readFileSync(file, 'utf8') !== text) return false
    const beside = `${file}.${process.pid}.beat`
    writeFileSync(beside, next)
    renameSync(beside, file)
    return true
  } catch {
    return false
  }
}

/** Removes the lock only while it is still the one we made. */
function giveBack(file, text) {
  try {
    if (readFileSync(file, 'utf8') === text) unlinkSync(file)
  } catch {
    // gone already, or not ours to read
  }
}

const clock = (iso) => {
  const at = new Date(iso)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/**
 * The holder of a slot as it stands now: `{ info }` for a run at work, null for a free slot. A stale lock (its process
 * gone, too old, unreadable) is removed on the way, so its slot counts as free.
 */
async function holderOf(file, nap, watched = new Map(), beatMs = BEAT_MS, holdMaxMs = HOLD_MAX_MS) {
  let seen = readLock(file)
  if (seen && !seen.info) {
    await nap(UNREADABLE_LOOK_MS)
    seen = readLock(file)
  }
  if (!seen) return null
  const why = whyStale(seen.info, Date.now(), pidRuns, holdMaxMs)
  // F39, review: a live holder whose beat is only old (the PC slept, the clock jumped) gets two beats of this waiter's own clock to
  // beat again; its lock is freed only when it stayed the same all that time.
  if (why === 'its beat is older than 5 minutes') {
    const first = watched.get(file)
    if (first === undefined || first.raw !== seen.raw) {
      watched.set(file, { raw: seen.raw, at: performance.now() })
      return seen
    }
    if (performance.now() - first.at < 2 * beatMs) return seen
  }
  // S3, review: a live holder past the hold cap by the wall clock (the PC slept past it) stops itself at its first beat after the
  // wake (runOneAtATime's watch); two beats of this waiter's own clock let it give the slot back first (an old copy without the
  // watch is freed after them all the same, and its command may still run on).
  // Keyed on its process and `since`, as its beats rewrite the rest.
  if (why?.startsWith('it has held the slot for over')) {
    const key = `${file}#since`
    const mark = `${seen.info.pid} ${seen.info.since ?? seen.info.startedAt}`
    const first = watched.get(key)
    if (first === undefined || first.mark !== mark) {
      watched.set(key, { mark, at: performance.now() })
      return seen
    }
    if (performance.now() - first.at < 2 * beatMs) return seen
  }
  watched.delete(file)
  watched.delete(`${file}#since`)
  if (why) {
    // Take it away only if it is still the lock we judged: another run may have taken it over a moment ago.
    if (readLock(file)?.raw === seen.raw) removeFile(file)
    return null
  }
  return seen
}

/** How many slot files lie beside the lock (slot n is `<name>.n.lock`), at least `slots`: a run with more slots counts too. */
export function slotCountOf(file, slots) {
  const base = path.basename(file)
  const stem = /\.lock$/i.test(base) ? base.replace(/\.lock$/i, '') : null
  let highest = slots
  try {
    for (const name of readdirSync(path.dirname(file))) {
      const n = stem === null
        ? (name.startsWith(`${base}.`) ? Number(name.slice(base.length + 1)) : NaN)
        : (name.toLowerCase().startsWith(`${stem.toLowerCase()}.`) && /\.lock$/i.test(name) ? Number(name.slice(stem.length + 1, -5)) : NaN)
      if (Number.isInteger(n) && n > highest) highest = n
    }
  } catch {
    // no folder yet: only our own slots
  }
  return highest
}

/**
 * The live tickets of the queue folder, oldest first (`{ name, first, fair }` each, `fair` for a ticket of this copy); a ticket whose
 * process is gone is removed, and (F39, review) one whose beat is older than 5 minutes, and an old copy's older than 3 hours.
 */
function queueOf(folder, now = Date.now()) {
  let names = []
  try {
    names = readdirSync(folder).filter((name) => name.endsWith('.json')).sort()
  } catch {
    return []
  }
  const live = []
  for (const name of names) {
    const ticket = readLock(path.join(folder, name))
    const beat = Date.parse(ticket?.info?.beat)
    const old = !ticket?.info ? false : Number.isFinite(beat) ? now - beat > BEAT_STALE_MS : now - Date.parse(ticket.info.startedAt) > TICKET_MAX_AGE_MS
    if (ticket?.info && pidRuns(ticket.info.pid) && !old) live.push({ name, first: ticket.info.first === true, fair: ticket.info.order === ORDER_MARK })
    else if (ticket) removeFile(path.join(folder, name))
  }
  return live
}

/**
 * S3, review: the tickets of a folder as an idle run reads them, oldest first (`{ name, pid }` each). Unlike queueOf, a ticket whose
 * process runs but whose beat is old (the PC slept: its owner beats again within a look of the wake), or that cannot be read yet,
 * still counts until it has stayed the same for two beats of this run's own clock (`watched`); only then is it removed, as queueOf
 * would. A ticket whose process is gone is removed at once. So after a sleep no idle run takes the slot before a gate or check that
 * waited, nor before an older idle run.
 */
function ticketsSeen(folder, watched, beatMs, now = Date.now()) {
  let names = []
  try {
    names = readdirSync(folder).filter((name) => name.endsWith('.json')).sort()
  } catch {
    return []
  }
  const seen = []
  for (const name of names) {
    const file = path.join(folder, name)
    const ticket = readLock(file)
    if (!ticket) continue
    const info = ticket.info
    if (info && !pidRuns(info.pid)) {
      removeFile(file)
      continue
    }
    const beat = Date.parse(info?.beat)
    const fresh = info && (Number.isFinite(beat) ? now - beat <= BEAT_STALE_MS : now - Date.parse(info.startedAt) <= TICKET_MAX_AGE_MS)
    if (!fresh) {
      const first = watched.get(file)
      if (first === undefined || first.raw !== ticket.raw) watched.set(file, { raw: ticket.raw, at: performance.now() })
      else if (performance.now() - first.at >= 2 * beatMs) {
        watched.delete(file)
        if (readLock(file)?.raw === ticket.raw) removeFile(file)
        continue
      }
    } else watched.delete(file)
    seen.push({ name, pid: info?.pid ?? null })
  }
  return seen
}

/** When a ticket came, from its name (`<ms, 15 digits>-<pid>.json`). */
const cameOf = (name) => Number(String(name).slice(0, 15))

/**
 * F39: the queue's order, one pure function for every run: oldest first, a first-class ticket counted as if it came
 * FIRST_LEAD_MS (30 minutes) earlier; the same moment goes by the name. Gives back the tickets in that order.
 */
export function queueOrder(tickets) {
  // F39, review: an old copy's ordinary ticket (`fair` false) goes after every other ticket, as that copy ranks itself.
  const late = (one) => (one.fair === false && !one.first ? 1 : 0)
  const rank = (one) => cameOf(one.name) - (one.first ? FIRST_LEAD_MS : 0)
  return [...tickets].sort((a, b) => late(a) - late(b) || rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** How many tickets go before `ticketName` in the queue's order (`first` is kept for the callers of before F39: the ticket says it). */
export function aheadOf(order, ticketName, first) {
  const mine = order.find((one) => one.name === ticketName) ?? { name: ticketName, first: first === true, fair: true }
  const all = order.some((one) => one.name === ticketName) ? order : [...order, mine]
  return queueOrder(all).findIndex((one) => one.name === ticketName)
}

/**
 * A ticket of this run in `folder` (the queue, or S3's idle room), named by `at`: `{ name, beat, leave }`. `beat` writes a new beat
 * time into it (F39, review: at every look; one dropped meanwhile, an old beat after a PC sleep, is made again), `leave` removes it
 * while it is still ours.
 */
function ticketIn(folder, at, { label, cwd, first = false, idle = false }) {
  mkdirSync(folder, { recursive: true })
  const name = `${String(at).padStart(15, '0')}-${String(process.pid).padStart(8, '0')}.json`
  const file = path.join(folder, name)
  const textOf = (beat) => JSON.stringify({ pid: process.pid, label, cwd, startedAt: new Date(at).toISOString(), ...(first ? { first: true } : {}), ...(idle ? { idle: true } : {}), order: ORDER_MARK, beat })
  let text = textOf(new Date(at).toISOString())
  createLock(file, text)
  return {
    name,
    beat() {
      const next = textOf(new Date().toISOString())
      if (rewriteLock(file, text, next)) {
        text = next
        return
      }
      // F39, the re-check: the folder itself may be gone (a clean-up of the temporary folder): made again.
      try {
        if (createLock(file, next)) text = next
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        mkdirSync(folder, { recursive: true })
        if (createLock(file, next)) text = next
      }
    },
    // True when the ticket is gone (or no longer ours); false when Windows would not remove it yet (S3, review).
    leave() {
      try {
        if (readFileSync(file, 'utf8') === text) unlinkSync(file)
        return true
      } catch (error) {
        return error?.code === 'ENOENT'
      }
    },
  }
}

/**
 * Waits for a slot and takes it, first come first served. Resolves to the function that gives it back, or to null when
 * `stop` aborted the wait. The poll and say intervals are in `timing`; `slots` how many may run at once. S3: an `idle` run waits
 * in the idle room until the queue holds no ticket, then takes a free slot at once or goes back to the room.
 */
async function takeTurn({ file, label, cwd, timing, say, stop, slots = 1, first = false, idle = false, holdMaxMs = HOLD_MAX_MS }) {
  mkdirSync(path.dirname(file), { recursive: true })
  const queue = `${file}.queue`
  mkdirSync(queue, { recursive: true })
  const came = Date.now()
  // S3: an idle run's ticket stays in the room; it is in the queue only for the one look at which it takes its slot.
  const ticket = ticketIn(idle ? idleRoomOf(file) : queue, came, { label, cwd, first, idle })
  let placed = null
  const watched = new Map()
  const watchedTickets = new Map()
  const leave = () => {
    ticket.leave()
    placed?.leave()
  }
  process.on('exit', leave)
  let saidAt = 0
  const nap = async (ms) => {
    try {
      await sleep(ms, undefined, { signal: stop.signal })
    } catch {
      // stopped
    }
  }
  /** Takes the first free slot we can make: the function that gives it back, or null when another run was quicker. */
  const takeFree = (free) => {
    for (const slot of free) {
      const taken = new Date().toISOString()
      const held = { pid: process.pid, label, cwd, since: taken, order: ORDER_MARK }
      // F39, review: `startedAt` moves with every beat (old copies judge a lock by it alone); `since` stays.
      let text = JSON.stringify({ ...held, startedAt: taken, beat: taken })
      if (createLock(slot, text)) {
        // F14: the moment the work begins, for a log of the run (land.ps1 starts the gate's clock here).
        say(`one-at-a-time: ${label} runs now (waited ${Math.round((Date.now() - came) / 1000)} s)`)
        // F39: the beat, while the command runs: only into the lock that is still ours.
        const beat = setInterval(() => {
          const now = new Date().toISOString()
          const next = JSON.stringify({ ...held, startedAt: now, beat: now })
          if (rewriteLock(slot, text, next)) text = next
        }, timing.beat)
        beat.unref()
        return () => {
          clearInterval(beat)
          giveBack(slot, text)
        }
      }
    }
    return null
  }
  try {
    while (!stop.signal.aborted) {
      const holders = []
      const free = []
      for (let n = 1, count = slotCountOf(file, slots); n <= count; n++) {
        const slot = slotPath(file, n)
        const seen = await holderOf(slot, nap, watched, timing.beat, holdMaxMs)
        if (seen) holders.push(seen.info)
        else if (n <= slots) free.push(slot)
      }
      ticket.beat()
      // Room is our slots less every run that holds one, ours or beyond (2026-11-11).
      const room = Math.min(free.length, slots - holders.length)
      const running = () => holders.map((one) => `${one.label} in ${one.cwd} (since ${clock(one.since ?? one.startedAt)})`).join('; ')
      if (idle) {
        // S3, review: a ticket of ours that could not be removed after a look (Windows holds a file just made) goes at the next one.
        if (placed !== null && placed.leave()) placed = null
        // S3: only when no ticket waits in the queue (a gate, a check, an old copy's run) and this run is the oldest in the room; read
        // with the grace of ticketsSeen, so a ticket that only slept still counts. Our own leftover in the queue does not.
        const others = ticketsSeen(queue, watchedTickets, timing.beat).filter((one) => one.pid !== process.pid)
        const oldest = ticketsSeen(idleRoomOf(file), watchedTickets, timing.beat)[0]
        if (placed === null && room > 0 && others.length === 0 && (oldest === undefined || oldest.name === ticket.name)) {
          placed = ticketIn(queue, Date.now(), { label, cwd })
          // One look in the queue's own order: a run that came a moment before goes first, and this one goes back to the room.
          const giveBackSlot = aheadOf(queueOf(queue), placed.name, false) < room ? takeFree(free) : null
          if (placed.leave()) placed = null
          if (giveBackSlot && placed === null) return giveBackSlot
          if (giveBackSlot) {
            // Our ticket would not go yet: tried again every second while we run, so it holds up nobody after us.
            const leftover = placed
            placed = null
            const retry = setInterval(() => {
              if (leftover.leave()) clearInterval(retry)
            }, 1000)
            retry.unref()
            return () => {
              clearInterval(retry)
              leftover.leave()
              giveBackSlot()
            }
          }
        }
        if (Date.now() - saidAt >= timing.say) {
          const queued = others.length > 0 ? `, ${others.length} in the queue` : ''
          say(`waiting for an idle PC (${running() || 'no run'}${queued})`)
          saidAt = Date.now()
        }
        await nap(timing.poll)
        continue
      }
      const order = queueOf(queue)
      // F14: a first-class run (a landing's gate) counts only the first-class tickets before it; an ordinary run counts every ticket
      // before it and every first-class one.
      const ahead = aheadOf(order, ticket.name, first)
      // Our turn when fewer runs came before us than there is room (a ticket we cannot read: go by the room).
      if (room > 0 && ahead < room) {
        const giveBackSlot = takeFree(free)
        if (giveBackSlot) return giveBackSlot
        await nap(50)
        continue
      }
      if (Date.now() - saidAt >= timing.say) {
        const before = ahead > 0 ? `, ${ahead} ahead of this run` : ''
        say(`waiting for ${running() || 'a free slot'}${before}`)
        saidAt = Date.now()
      }
      await nap(timing.poll)
    }
    return null
  } finally {
    leave()
    process.off('exit', leave)
  }
}

function quote(arg) {
  if (/^[\w@+=:,./-]+$/.test(arg)) return arg
  if (process.platform === 'win32') return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/** The text the shell gets: one argument is a command line already, more are quoted one by one. */
export function commandLine(command) {
  return command.length === 1 ? command[0] : command.map(quote).join(' ')
}

function stopTree(child, name) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else child.kill(name)
  } catch {
    // already gone
  }
}

const signalExit = (name) => 128 + (os.constants.signals[name] ?? 0)

/**
 * Runs `command` (an array: one command line, or a program and its arguments) when it is this run's turn, and resolves
 * to its exit code. `signals` is where SIGINT / SIGTERM / SIGHUP come from (the process; the tests give their own).
 */
export async function runOneAtATime({
  label,
  command,
  env = process.env,
  cwd = process.cwd(),
  signals = process,
  say = (line) => process.stderr.write(`${line}\n`),
  // S3: the wall clock the hold cap is checked against at every beat (the tests' seam for a PC sleep).
  now = Date.now,
}) {
  // S3, review: a first-class run (a landing's gate) never waits for an idle PC, whatever its label.
  const idle = env.HEAVY_RUN_FIRST !== '1' && isIdleRun(label, env)
  const stop = new AbortController()
  let child = null
  let signalled = null
  let forceExit = () => {}
  let giveLockBack = null
  let capped = false
  // S3, review: the cap's timer and watch, stopped on every way out (a run ended by a signal whose command never exited too).
  let quiet = () => {}
  const came = Date.now()
  let began = null
  let code = null

  const onSignal = (name) => {
    const again = signalled !== null
    signalled = name
    stop.abort()
    if (!child) return
    stopTree(child, name)
    if (again) forceExit()
    else setTimeout(() => forceExit(), STOP_WAIT_MS).unref()
  }
  const onExit = () => giveLockBack?.()
  const listeners = SIGNALS.map((name) => [name, () => onSignal(name)])
  for (const [name, listener] of listeners) signals.on(name, listener)
  process.on('exit', onExit)

  try {
    if (env.HEAVY_RUN_HELD !== '1') {
      const timing = { poll: positive(env.HEAVY_RUN_POLL_MS, POLL_MS), say: positive(env.HEAVY_RUN_SAY_MS, SAY_MS), beat: positive(env.HEAVY_RUN_BEAT_MS, BEAT_MS) }
      giveLockBack = await takeTurn({ file: lockPath(env), label, cwd, timing, say, stop, slots: slotsOf(env), first: env.HEAVY_RUN_FIRST === '1', idle, holdMaxMs: positive(env.HEAVY_RUN_MAX_MS, HOLD_MAX_MS) })
      if (!giveLockBack || signalled) {
        code = signalExit(signalled)
        return code
      }
      began = Date.now()
    }
    // The run that holds the slot, for a log under it (tools/vitest-run-log.mjs leaves its own slot out of the PC's other runs).
    const ownerPid = env.HEAVY_RUN_HELD === '1' && env.HEAVY_RUN_PID ? env.HEAVY_RUN_PID : String(process.pid)
    const exited = new Promise((resolve) => {
      forceExit = () => resolve(signalExit(signalled))
      const { HEAVY_RUN_FIRST: _first, HEAVY_RUN_IDLE: _idle, ...plain } = env
      child = spawn(commandLine(command), { shell: true, stdio: 'inherit', windowsHide: true, cwd, env: { ...plain, HEAVY_RUN_HELD: '1', HEAVY_RUN_PID: ownerPid } })
      child.on('error', (error) => {
        say(`one-at-a-time: could not start the command: ${error.message}`)
        resolve(127)
      })
      child.on('exit', (code, signal) => resolve(capped ? 124 : signalled ? signalExit(signalled) : (code ?? signalExit(signal))))
      // F39, review: no run holds the PC's slot for good (a hung check or build): stopped at the cap, code 124.
      if (env.HEAVY_RUN_HELD !== '1') {
        const maxMs = positive(env.HEAVY_RUN_MAX_MS, HOLD_MAX_MS)
        const beganAt = now()
        const stopAtCap = () => {
          if (capped) return
          capped = true
          say(`one-at-a-time: ${label} ran longer than ${Math.round(maxMs / 60000)} minutes and was stopped`)
          stopTree(child, 'SIGTERM')
          setTimeout(() => resolve(124), STOP_WAIT_MS).unref()
        }
        const cap = setTimeout(stopAtCap, maxMs)
        cap.unref()
        // S3: a timer's clock stands still while the PC sleeps (holds of 535 and 462 minutes on 11-24 and 11-25); the wall clock does not, and
        // it is read at every beat.
        const watch = setInterval(() => {
          if (now() - beganAt > maxMs) stopAtCap()
        }, positive(env.HEAVY_RUN_BEAT_MS, BEAT_MS))
        watch.unref()
        quiet = () => {
          clearTimeout(cap)
          clearInterval(watch)
        }
        child.on('exit', quiet)
        child.on('error', quiet)
      }
    })
    code = await exited
    return code
  } finally {
    if (env.HEAVY_RUN_HELD !== '1') {
      const now = Date.now()
      const waited = (began ?? now) - came
      logRun(env, {
        at: new Date(came).toISOString(), label, cwd, first: env.HEAVY_RUN_FIRST === '1', ...(idle ? { idle: true } : {}), slots: slotsOf(env),
        waitedS: Math.round(waited / 1000), ranS: began === null ? 0 : Math.round((now - began) / 1000),
        exit: code, stopped: began === null ? `before its turn${signalled ? ` (${signalled})` : ''}` : signalled,
      })
    }
    quiet()
    giveLockBack?.()
    process.off('exit', onExit)
    for (const [name, listener] of listeners) signals.off(name, listener)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [label, dashes, ...command] = process.argv.slice(2)
  if (!label || dashes !== '--' || command.length === 0) {
    process.stderr.write('Usage: node tools/one-at-a-time.mjs <label> -- <command and its arguments>\n')
    process.exit(2)
  }
  runOneAtATime({ label, command }).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`one-at-a-time: ${error.stack ?? error}\n`)
      process.exit(1)
    },
  )
}
