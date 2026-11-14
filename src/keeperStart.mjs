// F24a (2026-11-14): start-board.mjs counts a board as running when it answers, or when a keeper of this folder runs, or when a
// process of this folder holds the port; it starts nothing then. Before, a board that answered slower than its 1.5 s check (the
// main board at 8-11 s per page on 2026-11-14) counted as down, and every chat's Workers mod, which runs start-board.mjs once a
// minute while the board misses its pings, made a new keeper each time: its child died on "Port 4310 is in use", the keepers
// piled up and the board got slower still (chat 1's diagnosis, F24). The listing parts here are F10's (src/keeperStart.mjs on
// boards-survive-updates), so F10 merges this file.

import { spawn } from 'node:child_process'

/** How long a PowerShell listing may take. */
export const LIST_MS = 10_000

/** Runs a PowerShell script hidden; resolves to its output, rejects when it fails or takes longer than `timeoutMs`. */
export function powershell(script, timeoutMs = LIST_MS) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(error)
      return
    }
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

/** Whether a process's command line runs the board in `dir` (its server.mjs); both slashes count. */
export function runsFolder(commandLine, dir) {
  const wanted = `${dir.replace(/[\\/]+$/, '')}`.replace(/\//g, '\\').toLowerCase()
  return typeof commandLine === 'string' && commandLine.replace(/\//g, '\\').toLowerCase().includes(`${wanted}\\server.mjs`)
}

/**
 * The keepers of the board in `dir` among the PC's node processes (`list`: `{ pid, parent, commandLine }` each): a process whose
 * command line runs that folder's server.mjs and whose parent runs none (the child's parent is the keeper). Both slashes count.
 */
export function keepersOf(list, dir) {
  const ours = (Array.isArray(list) ? list : []).filter(one => runsFolder(one?.commandLine, dir))
  return ours.filter(one => !ours.some(other => other.pid === one.parent)).map(one => ({ pid: one.pid, children: ours.filter(other => other.parent === one.pid).map(other => other.pid) }))
}

/** The PowerShell that lists the PC's node processes with their command lines, as JSON, and the last boot time (ISO, UTC). */
export const LIST_SCRIPT = [
  "$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')",
  "$list = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; commandLine = [string]$_.CommandLine; created = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }) } })",
  '[pscustomobject]@{ boot = $boot; processes = $list } | ConvertTo-Json -Compress -Depth 3',
].join('; ')

/** The listing read: `{ bootAt (ms), processes }`; null for anything that is not one. */
export function parseProcessList(text) {
  try {
    const parsed = JSON.parse(String(text ?? '').replace(/^﻿/, ''))
    const list = Array.isArray(parsed?.processes) ? parsed.processes : parsed?.processes ? [parsed.processes] : []
    const bootAt = Date.parse(parsed?.boot)
    return { bootAt: Number.isFinite(bootAt) ? bootAt : null, processes: list.filter(one => Number.isInteger(one?.pid)).map(one => ({ pid: one.pid, parent: Number.isInteger(one.parent) ? one.parent : -1, commandLine: typeof one.commandLine === 'string' ? one.commandLine : '', createdAt: Number.isFinite(Date.parse(one.created)) ? Date.parse(one.created) : null })) }
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
export function netstat(timeoutMs = LIST_MS) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch (error) {
      reject(error)
      return
    }
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
 * the listing failed or took longer than LIST_MS; chat 1's must: never a start on a guess, the next run looks again); `{ runs: false }`
 * when nothing of this folder runs and the port is free.
 */
export function runsAlready({ dir, answers, processes = null, holder = null, answerSeconds, listingError = null }) {
  if (answers) return { runs: true, why: 'it answers' }
  if (!Array.isArray(processes)) return { runs: false, unknown: `the PC's processes could not be listed${listingError ? ` (${listingError})` : ''}: whether this folder's board runs is unknown; nothing started` }
  const silent = `did not answer within ${answerSeconds} seconds: slow or starting; nothing started`
  const [keeper] = keepersOf(processes, dir)
  if (keeper) return { runs: true, why: `a keeper of this folder runs (process ${keeper.pid}${keeper.children.length ? `, board ${keeper.children.join(', ')}` : ''}) but ${silent}` }
  if (holder !== null) {
    const process = (processes ?? []).find(one => one.pid === holder)
    if (process && runsFolder(process.commandLine, dir)) return { runs: true, why: `process ${holder} of this folder holds the port but ${silent}` }
    return { runs: false, foreign: { pid: holder, commandLine: process?.commandLine ?? '' } }
  }
  return { runs: false }
}
