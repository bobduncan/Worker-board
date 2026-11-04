// 2026-11-04: the plain logic of the go-live script (tools/land.ps1): whether a gate run passed, the one-landing-at-a-time
// lock, whether a debugger holds a board, and the landings line. The script calls it through `node tools/landing.mjs`.
// Node's own modules only, so the script can copy this file and its caller aside at its start and run them from there
// (the landing moves the checkout the script came from).

import { linkSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

/** A landing lock older than this is a crashed landing's: it is broken. */
export const STALE_LOCK_MS = 15 * 60_000
/** What a landings line's `result` says. */
export const RESULTS = ['landed', 'refused', 'rolled-back', 'rollback-failed']

const pad = number => String(number).padStart(2, '0')

/** The local time of an ISO time as HH:MM, "??:??" for a text that is no time. */
export function hhmm(at) {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '??:??' : `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** JSON on one line with every character above ASCII escaped: Windows PowerShell reads a program's words in the console's code page. */
export const asciiJson = value => JSON.stringify(value).replace(/[\u0080-￿]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)

// The gate.

/**
 * Whether a gate run passed, from the WHOLE output of its command: `{ ok, why }`. Only the run's own summary line counts,
 * at the start of a line: "ℹ fail N" (the board's tests; "# fail N" in the tap reporter) or " N fail" (the mod's). A name
 * of a test that says "fail 0" is no summary; a nested run's summary is indented; a missing summary is a failure (a grep
 * under `set -e` once let a red merge through). Every summary of the run must say 0, and the command must have ended
 * with 0 when `exitCode` is given.
 */
export function gatePassed(output, kind = 'board', exitCode = undefined) {
  const pattern = kind === 'mod' ? /^\s*(\d+) fail\s*$/ : /^(?:ℹ|#) fail (\d+)\s*$/
  const fails = String(output ?? '').split(/\r?\n/).map(line => pattern.exec(line)?.[1]).filter(found => found !== undefined).map(Number)
  if (fails.length === 0) return { ok: false, why: `no summary line in the output (a line "${kind === 'mod' ? 'N fail' : 'fail N'}" is missing)` }
  const bad = fails.find(count => count !== 0)
  if (bad !== undefined) return { ok: false, why: `the summary says fail ${bad}` }
  if (exitCode !== undefined && exitCode !== null && Number(exitCode) !== 0) return { ok: false, why: `the command ended with code ${exitCode}` }
  return { ok: true, why: null }
}

// The lock: one file, made by an exclusive create (a hard link of a finished file: it either exists whole or not at all).

const LOCKED_NOW = ['EEXIST', 'EPERM', 'EBUSY', 'EACCES']
const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Makes `file` with `info` in it unless it exists; true when this call made it. */
function createWhole(file, info) {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(temp, JSON.stringify(info))
  try {
    linkSync(temp, file)
    return true
  } catch (error) {
    if (LOCKED_NOW.includes(error?.code)) return false
    throw error
  } finally {
    try {
      unlinkSync(temp)
    } catch {
      // The temporary name is only ours.
    }
  }
}

/**
 * Who holds the lock and for how long: `{ by, branch, at, pid, ageMs }`, null when there is none. A file nobody can read
 * (torn, empty) is held by "unknown" and as old as the file.
 */
export function lockHolder(file, now = Date.now()) {
  let text
  let modified
  try {
    text = readFileSync(file, 'utf8')
    modified = statSync(file).mtimeMs
  } catch {
    return null
  }
  let read = null
  try {
    read = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    read = null
  }
  const at = typeof read?.at === 'string' && Number.isFinite(Date.parse(read.at)) ? read.at : null
  if (at === null) return { by: 'unknown', branch: 'unknown', at: new Date(modified).toISOString(), pid: null, ageMs: now - modified }
  return { by: typeof read.by === 'string' ? read.by : 'unknown', branch: typeof read.branch === 'string' ? read.branch : 'unknown', at, pid: Number.isInteger(read.pid) ? read.pid : null, ageMs: now - Date.parse(at) }
}

/**
 * Takes the landing lock: `{ ok: true, token, broke }` (`broke` the line about a stale lock that was broken, else null) or
 * `{ ok: false, why }`. Held by another and not older than `staleMs`: refused, naming who, the branch and since when. Older:
 * broken and taken. Two that find a stale lock at once break it one after the other (a guard file), and the second sees the
 * first's fresh lock.
 */
export function takeLock(file, { by, branch, pid, now = Date.now(), staleMs = STALE_LOCK_MS }) {
  const info = { by, branch, at: new Date(now).toISOString(), pid }
  const guard = `${file}.breaking`
  let broke = null
  for (let tries = 0; tries < 40; tries += 1) {
    if (createWhole(file, info)) return { ok: true, token: { pid, at: info.at }, broke }
    const holder = lockHolder(file, now)
    // It went away while we looked: try again.
    if (holder === null) {
      nap(20)
      continue
    }
    if (holder.ageMs <= staleMs) return { ok: false, why: `a landing by ${holder.by} of ${holder.branch} holds the lock since ${hhmm(holder.at)}` }
    // Stale: one breaker at a time; a guard a crashed breaker left is removed once it is a minute old.
    if (!createWhole(guard, { pid, at: new Date().toISOString() })) {
      const left = lockHolder(guard)
      if (left !== null && left.ageMs > 60_000) {
        try {
          unlinkSync(guard)
        } catch {
          // Someone else removed it.
        }
      }
      nap(50)
      continue
    }
    try {
      const again = lockHolder(file, now)
      if (again !== null && again.at === holder.at && again.pid === holder.pid && again.ageMs > staleMs) {
        unlinkSync(file)
        broke = `broke a stale landing lock of ${holder.by} (${holder.branch}, since ${hhmm(holder.at)})`
      }
    } finally {
      try {
        unlinkSync(guard)
      } catch {
        // Gone already.
      }
    }
  }
  return { ok: false, why: 'the landing lock could not be taken: it stays busy' }
}

/** Gives the lock back, only when it is still the one `token` (`{ pid, at }`) took; true when it was removed. */
export function releaseLock(file, token) {
  const holder = lockHolder(file)
  if (holder === null || holder.pid !== token.pid || holder.at !== token.at) return false
  for (let tries = 0; tries < 6; tries += 1) {
    try {
      unlinkSync(file)
      return true
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      if (!LOCKED_NOW.includes(error?.code) || tries === 5) throw error
      nap(25 * (tries + 1))
    }
  }
  return false
}

// The debugger check.

const normal = text => String(text ?? '').replace(/\//g, '\\').toLowerCase()
const isListen = connection => String(connection.state).toLowerCase() === 'listen'
const isLinked = connection => String(connection.state).toLowerCase() === 'established'

/**
 * The processes of each board, from the PC's processes (`{ pid, ppid, name, commandLine }`) and TCP connections
 * (`{ state, localPort, remotePort, pid }`): the node processes that run the folder's `server.mjs`, the one that listens on
 * the board's port (the child) and its parent when that runs a server.mjs too (the keeper, which may have been started as
 * a bare `node server.mjs`). `[{ port, dir, pid, ppid, role, commandLine }]`, each board's keeper first.
 */
export function boardProcesses({ boards, processes = [], connections = [] }) {
  const byPid = new Map(processes.map(one => [one.pid, one]))
  const found = []
  for (const board of boards) {
    const marker = `${normal(board.dir).replace(/\\+$/, '')}\\server.mjs`
    const picked = new Map()
    for (const one of processes) if (normal(one.commandLine).includes(marker)) picked.set(one.pid, one)
    const owners = [...new Set(connections.filter(one => isListen(one) && one.localPort === board.port && Number.isInteger(one.pid) && one.pid > 0).map(one => one.pid))]
    for (const pid of owners) {
      const owner = byPid.get(pid) ?? { pid, ppid: null, commandLine: '' }
      picked.set(pid, owner)
      const parent = byPid.get(owner.ppid)
      if (parent !== undefined && /node/i.test(parent.name ?? '') && /server\.mjs/i.test(parent.commandLine ?? '')) picked.set(parent.pid, parent)
    }
    const these = [...picked.values()].map(one => ({
      port: board.port, dir: board.dir, pid: one.pid, ppid: one.ppid ?? null, commandLine: one.commandLine ?? '',
      role: owners.includes(one.pid) || picked.has(one.ppid) ? 'child' : 'keeper',
    }))
    found.push(...these.sort((one, other) => (one.role === other.role ? one.pid - other.pid : one.role === 'keeper' ? -1 : 1)))
  }
  return found
}

/**
 * Whether a debugger holds a board: `{ verdict, refusal, notes, processes }`. For each process of each board, a port it listens on
 * that is no board's own is an inspector (usually 9229). A client connected to it is a refusal, the first one named
 * ("stop it first"); an inspector nobody is connected to is a note, the warm restart replaces such a process fine.
 * Verdict: "refuse", "note" or "ok".
 */
export function inspectorDecision({ boards, processes = [], connections = [] }) {
  const own = new Set(boards.map(board => board.port))
  const byPid = new Map(processes.map(one => [one.pid, one]))
  const found = boardProcesses({ boards, processes, connections })
  const notes = []
  let refusal = null
  for (const proc of found) {
    const ports = [...new Set(connections.filter(one => isListen(one) && one.pid === proc.pid && !own.has(one.localPort)).map(one => one.localPort))]
    for (const port of ports) {
      const served = connections.find(one => isLinked(one) && one.pid === proc.pid && one.localPort === port)
      if (served === undefined) {
        notes.push(`an inspector listens on ${port} at the ${proc.port} board's ${proc.role} (pid ${proc.pid}); no client is attached, going on`)
        continue
      }
      if (refusal !== null) continue
      const client = connections.find(one => isLinked(one) && one.localPort === served.remotePort && one.remotePort === port && one.pid !== proc.pid)
      const words = client === undefined ? 'client pid unknown' : `client pid ${client.pid}${byPid.get(client.pid)?.commandLine ? ` ${String(byPid.get(client.pid).commandLine).slice(0, 140)}` : ''}`
      refusal = `a debugger is attached to the ${proc.port} board's ${proc.role} (pid ${proc.pid}, inspector port ${port}, ${words}): stop it first`
    }
  }
  return { verdict: refusal !== null ? 'refuse' : notes.length > 0 ? 'note' : 'ok', refusal, notes, processes: found }
}

// The landings log.

/**
 * One line of data/landings.jsonl: the fields in a fixed order, plain ASCII. `after` is null for a refusal. `result` is one of
 * RESULTS. `boards` is `[{ port, commit, since }]` as they answered after the restart.
 */
export function landingLine({ at, by, branch, head, before, after = null, trial = null, result, why = null, boards = [], cold = false, gateLog = null }) {
  if (!RESULTS.includes(result)) throw new Error(`result must be one of ${RESULTS.join(', ')}, not ${result}`)
  return asciiJson({ at, by, branch, head, before, after: result === 'refused' ? null : after, trial, result, why, boards, cold: cold === true, gateLog })
}
