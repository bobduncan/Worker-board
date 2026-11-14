// F10 (2026-11-14): the boards survive a Claude app update. The app's update (AppX Register, "TerminateApplications") ends every
// process in the app's job: a board started from a chat (start-board.mjs in a chat's shell, the start-app launcher, land.ps1) sat
// in that job and died with it (2026-11-11 22:42, both boards). A process made by WMI `Win32_Process.Create` sits in no job (its
// parent is WmiPrvSE), so every keeper is started that way here: hidden (a `Win32_ProcessStartup` with ShowWindow 0: the console
// is never shown), with the board's folder as its working directory and the logon environment (Create takes no env block: the
// keeper gets the person's logon env, which is `startEnv` by nature: no WORKER_BOARD_* words, nothing of a chat's own). The
// command line is `"<node>" "<dir>\server.mjs" --log <words>`: no shell, no redirect; `--log` has the keeper open data/board.log
// itself for its child and its own lines. WMI refused or failing (a return value other than 0, PowerShell missing, a timeout):
// the old detached spawn, with one board.log line that says so. Never a failed start.
// Design note: .claude/plans/2026-11-11-boards-survive-app-updates-design.md (chat 1's guards G4-G8).

import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { constants as osConstants, setPriority } from 'node:os'
import { join } from 'node:path'

import { startEnv } from './keeper.mjs'

/** How long the WMI start may take (a loaded PC: PowerShell's cold start and three CIM calls pass 10 s; chat 1's review). */
export const WMI_START_MS = 30_000

/** How long a PowerShell listing may take (the 20 s cpu.mjs gives its own; chat 1's review of F24a). */
export const LIST_MS = 20_000

/**
 * Gives a child Normal priority from outside, at once: a start-board.mjs run by a chat under CPU Low is at Idle on two crowded cores,
 * and PowerShell or netstat born there would be starved before they answer (cpu.mjs does the same for its helper). Never throws.
 */
export function raiseChild(pid) {
  try {
    setPriority(pid, osConstants.priority.PRIORITY_NORMAL)
  } catch {
    // gone already, or not allowed
  }
}


/** The `--port N` among a keeper's arguments, or null (the folder's own port then). */
export function portOfArgs(args) {
  const at = args.indexOf('--port')
  const given = at >= 0 ? Number(args[at + 1]) : NaN
  return Number.isInteger(given) && given > 0 ? given : null
}

/** The keeper's command line for WMI: node, the folder's server.mjs, `--log`, then the words given (each quoted when it has a space or a quote). */
export function keeperCommandLine({ node, dir, args = [] }) {
  const quote = word => (/[\s"]/.test(word) ? `"${word.replace(/"/g, '\\"')}"` : word)
  return [`"${node}"`, `"${join(dir, 'server.mjs')}"`, '--log', ...args.map(quote)].join(' ')
}

/** A PowerShell literal of `text` (single quotes doubled). */
export const psQuote = text => `'${String(text).replace(/'/g, "''")}'`

/**
 * The PowerShell that makes the process through WMI, hidden, in `dir`, and prints `ret=<ReturnValue> pid=<ProcessId>` (the return
 * value 0 is a start; 2 access denied, 3 insufficient privilege, 8 unknown failure, 9 path not found, 21 invalid parameter).
 */
export function wmiCreateScript(commandLine, dir) {
  return [
    '$class = Get-CimClass -ClassName Win32_ProcessStartup',
    '$startup = New-CimInstance -CimClass $class -ClientOnly -Property @{ ShowWindow = [uint16]0 }',
    `$made = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(commandLine)}; CurrentDirectory = ${psQuote(dir)}; ProcessStartupInformation = $startup }`,
    'Write-Output "ret=$($made.ReturnValue) pid=$($made.ProcessId)"',
  ].join('; ')
}

/** What the script printed, read: `{ ret, pid }`, or null for anything else. */
export function parseCreated(text) {
  const found = /ret=(\d+) pid=(\d*)/.exec(String(text ?? ''))
  if (found === null) return null
  return { ret: Number(found[1]), pid: found[2] === '' ? null : Number(found[2]) }
}

/** Runs a PowerShell script hidden; resolves to its output, rejects when it fails or takes longer than `timeoutMs`. */
export function powershell(script, timeoutMs = WMI_START_MS, { raise = raiseChild } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(error)
      return
    }
    raise(child.pid)
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { err += chunk })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(code === null ? `PowerShell took longer than ${timeoutMs / 1000} s` : `PowerShell ended with ${code}: ${err.trim().split('\n')[0] ?? ''}`))
    })
  })
}

/**
 * A line in the board's log (data/board.log), appended as the server writes its own: `<ISO time> <text>`. Never throws.
 */
export function logLine(dir, text, now = Date.now()) {
  try {
    mkdirSync(join(dir, 'data'), { recursive: true })
    const fd = openSync(join(dir, 'data', 'board.log'), 'a')
    try {
      writeFileSync(fd, `${new Date(now).toISOString()} ${text}\n`)
    } finally {
      closeSync(fd)
    }
  } catch {
    // the log is a convenience
  }
}

/**
 * Starts a keeper of the board in `dir` outside any job: through WMI (`run`: the PowerShell runner; `node`: the program to run
 * server.mjs with), else as a detached child of this process (`spawnChild`), with one board.log line saying so. Answers
 * `{ pid, how: 'wmi' | 'child', why }` (`why` the WMI failure for 'child', null for 'wmi'); `pid` is the keeper's. A timeout or an
 * unreadable answer is no proof that Create failed (the CIM call may have run while PowerShell was killed): the keepers of the
 * folder made since the call (`list`) are looked for first, and the fallback runs only when none was made (chat 1's review). The
 * fallback alone runs when `env.WORKER_BOARD_START_ROUTE` is 'child' (the proof's mutant in test/startBoard.test.mjs).
 */
export async function startKeeper({ dir, args = [], node = process.execPath, run = powershell, spawnChild = spawnDetached, platform = process.platform, env = process.env, log = logLine, list = async () => parseProcessList(await powershell(LIST_SCRIPT, WMI_START_MS), { ownPid: process.pid }), now = Date.now }) {
  const commandLine = keeperCommandLine({ node, dir, args })
  let why = null
  if (env?.WORKER_BOARD_START_ROUTE === 'child') why = 'WORKER_BOARD_START_ROUTE=child'
  else if (platform === 'win32') {
    const since = now() - 5000
    let unsure = false
    try {
      const made = parseCreated(await run(wmiCreateScript(commandLine, dir)))
      if (made === null) { why = 'WMI gave no answer that could be read'; unsure = true }
      else if (made.ret !== 0 || !Number.isInteger(made.pid)) why = `Win32_Process.Create answered ${made.ret}`
      else return { pid: made.pid, how: 'wmi', why: null }
    } catch (error) {
      why = error instanceof Error ? error.message : String(error)
      unsure = !/ENOENT/.test(why)
    }
    if (unsure) {
      // Create may have run all the same: a keeper of this folder made since the call is ours.
      try {
        const listed = await list()
        // This board's keepers only (its port, demo or not: a demo keeper of the folder is not it; chat 1's round-3 check).
        const made = keepersOf((listed?.processes ?? []).filter(one => Number.isFinite(one.createdAt) && one.createdAt >= since), dir, portOfArgs(args), { isDemo: args.includes('--demo') })
        if (made.length > 0) return { pid: made[0].pid, how: 'wmi', why: null, late: why }
      } catch {
        // no listing: the fallback below
      }
    }
  } else why = 'not Windows'
  const child = spawnChild({ dir, args, node, env })
  log(dir, `started as a child of process ${process.pid} (WMI: ${why}): an app update will end it`)
  return { pid: child.pid, how: 'child', why, child }
}

/** The old route: the keeper as a detached child with the log as its output (the keeper opens no log of its own then). */
export function spawnDetached({ dir, args, node = process.execPath, env = process.env }) {
  mkdirSync(join(dir, 'data'), { recursive: true })
  const log = openSync(join(dir, 'data', 'board.log'), 'a')
  const child = spawn(node, [join(dir, 'server.mjs'), ...args], { cwd: dir, env: startEnv(env), detached: true, stdio: ['ignore', log, log], windowsHide: true })
  closeSync(log)
  child.unref()
  return child
}

/** Whether a process's command line runs the board in `dir` (its server.mjs); both slashes count. */
export function runsFolder(commandLine, dir) {
  const wanted = `${dir.replace(/[\\/]+$/, '')}`.replace(/\//g, '\\').toLowerCase()
  return typeof commandLine === 'string' && commandLine.replace(/\//g, '\\').toLowerCase().includes(`${wanted}\\server.mjs`)
}

/**
 * Whether a process's command line is THIS board's (keeper or child): it runs the folder's server.mjs with no `--demo`,
 * `--history-from` or `--launch-entry`, and no `--port` other than `port` (a demo or a second board of the folder on another port is
 * not it; chat 1's review of F24a, item 2).
 */
export function isBoardOf(commandLine, dir, port, { isDemo = false } = {}) {
  if (!runsFolder(commandLine, dir)) return false
  // The demo's own board is a demo (start-board.mjs --demo sees it); the real board's never is.
  if (/\s--demo(?:\s|$)/.test(commandLine) !== isDemo) return false
  if (/\s--(?:history-from|launch-entry)(?:\s|$)/.test(commandLine)) return false
  const given = /\s--port\s+(\d+)/.exec(commandLine)
  return port === null || given === null || Number(given[1]) === Number(port)
}

/**
 * The keepers of the board in `dir` among the PC's node processes (`list`: `{ pid, parent, commandLine }` each): a process whose
 * command line runs that folder's server.mjs and whose parent runs none (the child's parent is the keeper). Both slashes count.
 * Only the processes that are this board's (`isBoardOf`; a null `port` takes any port of the folder).
 */
export function keepersOf(list, dir, port = null, { isDemo = false } = {}) {
  // A null port: any port of the folder, still never a demo's (unless isDemo), a history copy's or a launch-entry run.
  const ours = (Array.isArray(list) ? list : []).filter(one => isBoardOf(one?.commandLine, dir, port, { isDemo }))
  return ours.filter(one => !ours.some(other => other.pid === one.parent)).map(one => ({ pid: one.pid, children: ours.filter(other => other.parent === one.pid).map(other => other.pid) }))
}

/**
 * The PowerShell that lists the PC's node processes with their command lines, as JSON, with the last boot time and the start of
 * the person's logon session (the Win32_LogonSession that holds the user's explorer.exe, by the CIM association, the oldest when
 * there are several; never a stale session of an earlier logon that Win32_LogonSession still lists; Fast Startup leaves
 * LastBootUpTime at the last full boot, so the logon is the cut-off for stop signs; chat 1's review and checks), both ISO, UTC. A failed CIM query ends
 * the script with an error (`$ErrorActionPreference = 'Stop'`), never with an empty list that would read as "no keeper".
 */
export const LIST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')",
  "$logon = $null; foreach ($e in @(Get-CimInstance Win32_Process -Filter \"Name='explorer.exe'\")) { try { $o = Invoke-CimMethod -InputObject $e -MethodName GetOwner; if ($o.User -ne $env:USERNAME) { continue }; foreach ($s in @(Get-CimAssociatedInstance -InputObject $e -ResultClassName Win32_LogonSession)) { if ($s.LogonType -in 2, 10, 11 -and $s.StartTime -and ($null -eq $logon -or $s.StartTime -lt $logon)) { $logon = $s.StartTime } } } catch {} }",
  "$list = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; commandLine = [string]$_.CommandLine; created = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }) } })",
  "[pscustomobject]@{ boot = $boot; logon = $(if ($logon) { $logon.ToUniversalTime().ToString('o') } else { $null }); processes = $list } | ConvertTo-Json -Compress -Depth 3",
].join('; ')

/**
 * The listing read: `{ bootAt (ms), logonAt (ms or null), processes }`; null for anything that is not one, and null for a listing that
 * lacks `ownPid` (the caller's own node process must be in a list of the PC's node processes: one without it is a broken read, never
 * "no keeper"; chat 1's re-check of F10).
 */
export function parseProcessList(text, { ownPid = null } = {}) {
  try {
    const parsed = JSON.parse(String(text ?? '').replace(/^﻿/, ''))
    const list = Array.isArray(parsed?.processes) ? parsed.processes : parsed?.processes ? [parsed.processes] : []
    const bootAt = Date.parse(parsed?.boot)
    const logonAt = Date.parse(parsed?.logon)
    if (Number.isInteger(ownPid) && !list.some(one => one?.pid === ownPid)) return null
    return { bootAt: Number.isFinite(bootAt) ? bootAt : null, logonAt: Number.isFinite(logonAt) ? logonAt : null, processes: list.filter(one => Number.isInteger(one?.pid)).map(one => ({ pid: one.pid, parent: Number.isInteger(one.parent) ? one.parent : -1, commandLine: typeof one.commandLine === 'string' ? one.commandLine : '', createdAt: Number.isFinite(Date.parse(one.created)) ? Date.parse(one.created) : null })) }
  } catch {
    return null
  }
}

/** The pid listening on the TCP port in `netstat -ano` output (any local address), or null when none. */
export function portHolderOf(text, port) {
  const want = new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`, 'im')
  const match = String(text ?? '').match(want)
  return match ? Number(match[1]) : null
}

/** Runs `netstat -ano -p tcp`; resolves to its output, rejects when it fails or takes longer than `timeoutMs`. */
export function netstat(timeoutMs = LIST_MS, { raise = raiseChild } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch (error) {
      reject(error)
      return
    }
    raise(child.pid)
    let out = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); if (code === 0) resolve(out); else reject(new Error(`netstat ended with ${code}`)) })
  })
}

/**
 * Whether the board of `dir` runs, from what was looked at: `answers` (its page came within the long timeout), `processes` (the
 * PC's node processes, or null when they could not be listed) and `holder` (the pid on the port, or null when none or unknown).
 * `{ runs: true, why }` for an answer, a keeper of this folder, or the port held by a process of this folder (slow or starting:
 * nothing is started, the keeper brings the board back); `{ runs: false, foreign: { pid, commandLine } }` when another program
 * holds the port (a start would fail on it); `{ runs: false, unknown }` when the processes could not be listed (`processes` null:
 * the listing failed or took longer than LIST_MS; no start on a guess, the next run looks again), except `{ runs: false, note }` when
 * nothing listens (`isRefused`) and netstat saw no holder (`holderKnown`, `holder` null): the start goes, with the note; `{ runs: false }`
 * when nothing of this folder runs and the port is free.
 */
export function runsAlready({ dir, port = null, isDemo = false, answers, isRefused = false, holderKnown = false, processes = null, holder = null, answerSeconds, listingError = null }) {
  if (answers) return { runs: true, why: 'it answers' }
  if (!Array.isArray(processes)) {
    // The re-check's rule (chat 1, 2026-11-14): nothing listens (the fetch was refused) and netstat saw no holder: a failed listing does not
    // block the start. A duplicate keeper there is harmless (its child ends on EADDRINUSE and it exits); a board left down is not.
    if (isRefused && holderKnown && holder === null) return { runs: false, note: `the PC's processes could not be listed${listingError ? ` (${listingError})` : ''}, but nothing listens on the port: started all the same` }
    return { runs: false, unknown: `the PC's processes could not be listed${listingError ? ` (${listingError})` : ''}: whether this folder's board runs is unknown; nothing started` }
  }
  const silent = `did not answer within ${answerSeconds} seconds: slow or starting; nothing started`
  const [keeper] = keepersOf(processes, dir, port, { isDemo })
  const keeperWords = keeper === undefined ? '' : `a keeper of this folder runs (process ${keeper.pid}${keeper.children.length ? `, board ${keeper.children.join(', ')}` : ''})`
  // The port first: its holder is this board's child (slow), or another program's (a start would die on it). A holder the listing does
  // not know (a child that restarted between the two looks) beside a keeper of this board is that keeper's: never foreign.
  if (holder !== null) {
    const process = processes.find(one => one.pid === holder)
    if (process && isBoardOf(process.commandLine, dir, port, { isDemo })) return { runs: true, why: `process ${holder} of this folder holds the port but ${silent}` }
    if (!process && keeper !== undefined) return { runs: true, why: `${keeperWords}; the port's holder ${holder} changed while looking: ${silent}` }
    return { runs: false, foreign: { pid: holder, commandLine: process?.commandLine ?? '' } }
  }
  // A free port: a keeper of this board (not a demo's or another port's) is starting its child.
  if (keeper !== undefined) return { runs: true, why: `${keeperWords} but ${silent}` }
  return { runs: false }
}

/** Ends a keeper and its children (`{ pid, children }`), each with a plain kill; never throws. */
export function endKeeper(keeper, kill = pid => process.kill(pid)) {
  for (const pid of [keeper.pid, ...keeper.children]) {
    try {
      kill(pid)
    } catch {
      // gone already
    }
  }
}
