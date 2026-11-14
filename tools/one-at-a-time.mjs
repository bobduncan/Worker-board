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
//   moment its work began (land.ps1 starts the gate's clock there, not while the run queues).
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, openSync, closeSync, readFileSync, readdirSync, unlinkSync, writeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export const LOCK_NAME = 'one-heavy-run.lock'
export const MAX_AGE_MS = 45 * 60 * 1000
const POLL_MS = 5000
const SAY_MS = 60 * 1000
// A lock that cannot be read may only be the moment between its creation and its content: look once more before
// calling it stale.
const UNREADABLE_LOOK_MS = 250
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']
// After a signal the command gets this long to end before we give the lock back anyway.
const STOP_WAIT_MS = 5000

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
export function whyStale(info, now = Date.now(), runs = pidRuns) {
  if (!info) return 'it cannot be read'
  if (!runs(info.pid)) return 'its process is gone'
  if (now - Date.parse(info.startedAt) > MAX_AGE_MS) return 'it is older than 45 minutes'
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
async function holderOf(file, nap) {
  let seen = readLock(file)
  if (seen && !seen.info) {
    await nap(UNREADABLE_LOOK_MS)
    seen = readLock(file)
  }
  if (!seen) return null
  if (whyStale(seen.info)) {
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

/** The live tickets of the queue folder, oldest first (`{ name, first }` each); a ticket whose process is gone is removed. */
function queueOf(folder) {
  let names = []
  try {
    names = readdirSync(folder).filter((name) => name.endsWith('.json')).sort()
  } catch {
    return []
  }
  const live = []
  for (const name of names) {
    const ticket = readLock(path.join(folder, name))
    if (ticket?.info && pidRuns(ticket.info.pid)) live.push({ name, first: ticket.info.first === true })
    else if (ticket) removeFile(path.join(folder, name))
  }
  return live
}

/** How many tickets go before `ticketName`: for a first-class run the first-class ones that came earlier; for an ordinary run every earlier one and every first-class one. */
export function aheadOf(order, ticketName, first) {
  return order.filter((one) => one.name !== ticketName && (first ? one.first && one.name < ticketName : one.name < ticketName || one.first)).length
}

/**
 * Waits for a slot and takes it, first come first served. Resolves to the function that gives it back, or to null when
 * `stop` aborted the wait. The poll and say intervals are in `timing`; `slots` how many may run at once.
 */
async function takeTurn({ file, label, cwd, timing, say, stop, slots = 1, first = false }) {
  mkdirSync(path.dirname(file), { recursive: true })
  const queue = `${file}.queue`
  mkdirSync(queue, { recursive: true })
  const came = Date.now()
  const ticketName = `${String(came).padStart(15, '0')}-${String(process.pid).padStart(8, '0')}.json`
  const ticket = path.join(queue, ticketName)
  const ticketText = JSON.stringify({ pid: process.pid, label, cwd, startedAt: new Date(came).toISOString(), ...(first ? { first: true } : {}) })
  createLock(ticket, ticketText)
  const leave = () => giveBack(ticket, ticketText)
  process.on('exit', leave)
  let saidAt = 0
  const nap = async (ms) => {
    try {
      await sleep(ms, undefined, { signal: stop.signal })
    } catch {
      // stopped
    }
  }
  try {
    while (!stop.signal.aborted) {
      const holders = []
      const free = []
      for (let n = 1, count = slotCountOf(file, slots); n <= count; n++) {
        const slot = slotPath(file, n)
        const seen = await holderOf(slot, nap)
        if (seen) holders.push(seen.info)
        else if (n <= slots) free.push(slot)
      }
      const order = queueOf(queue)
      // F14: a first-class run (a landing's gate) counts only the first-class tickets before it; an ordinary run counts every ticket
      // before it and every first-class one.
      const ahead = aheadOf(order, ticketName, first)
      // Our turn when fewer runs came before us than there is room (a ticket we cannot read: go by the room). Room is our
      // slots less every run that holds one, ours or beyond (2026-11-11).
      const room = Math.min(free.length, slots - holders.length)
      if (room > 0 && ahead < room) {
        for (const slot of free) {
          const text = JSON.stringify({ pid: process.pid, label, cwd, startedAt: new Date().toISOString() })
          if (createLock(slot, text)) {
            // F14: the moment the work begins, for a log of the run (land.ps1 starts the gate's clock here).
            say(`one-at-a-time: ${label} runs now (waited ${Math.round((Date.now() - came) / 1000)} s)`)
            return () => giveBack(slot, text)
          }
        }
        await nap(50)
        continue
      }
      if (Date.now() - saidAt >= timing.say) {
        const running = holders.map((one) => `${one.label} in ${one.cwd} (since ${clock(one.startedAt)})`).join('; ')
        const before = ahead > 0 ? `, ${ahead} ahead of this run` : ''
        say(`waiting for ${running || 'a free slot'}${before}`)
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
}) {
  const stop = new AbortController()
  let child = null
  let signalled = null
  let forceExit = () => {}
  let giveLockBack = null

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
      const timing = { poll: positive(env.HEAVY_RUN_POLL_MS, POLL_MS), say: positive(env.HEAVY_RUN_SAY_MS, SAY_MS) }
      giveLockBack = await takeTurn({ file: lockPath(env), label, cwd, timing, say, stop, slots: slotsOf(env), first: env.HEAVY_RUN_FIRST === '1' })
      if (!giveLockBack || signalled) return signalExit(signalled)
    }
    const exited = new Promise((resolve) => {
      forceExit = () => resolve(signalExit(signalled))
      child = spawn(commandLine(command), { shell: true, stdio: 'inherit', windowsHide: true, cwd, env: { ...env, HEAVY_RUN_HELD: '1' } })
      child.on('error', (error) => {
        say(`one-at-a-time: could not start the command: ${error.message}`)
        resolve(127)
      })
      child.on('exit', (code, signal) => resolve(signalled ? signalExit(signalled) : (code ?? signalExit(signal))))
    })
    return await exited
  } finally {
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
