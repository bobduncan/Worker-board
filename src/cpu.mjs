// B311: "CPU for Claude". The person, 2026-10-18, while playing: the workers made the PC lag. B735 (2026-10-27): two
// choices the person picks, no game detection. Full: everything the project started runs at Normal priority on all
// cores. Low: the chats' trees, what the board's own processes started, the vite servers, codex and a headless browser
// run at Idle priority on the last two cores, in efficiency mode where Windows has it, so a game or any other program
// never slows. Never the desktop app, never a program the project did not start. The board's own processes (its server
// and its keeper) stay at Normal on all cores in Low too (the person, 2026-10-30, the board blank for minutes at Idle
// while a game ran: "it should not slow the board itself").
//
// Windows only: the processes are read with one PowerShell call per refresh, and set with a second one only when a
// process needs it. Elsewhere the control says "not available here" and nothing runs.

import { readFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { constants as osConstants, cpus, setPriority } from 'node:os'
import { dirname } from 'node:path'

import { writeAtomic } from './write.mjs'

export const LEVELS = ['full', 'low']

/** A process's priority class per level, and the base priority Windows reports for it (Win32_Process.Priority). */
export const PRIORITY = { full: 'Normal', low: 'Idle' }
export const BASE_PRIORITY = { Normal: 8, BelowNormal: 6, Idle: 4 }

/** The cores Low leaves the project: the last two. */
export const LOW_CORES = 2

/** The passes that give everything back after Low: a process born while Low was on inherits it, and a slow first pass misses some (2026-10-27). */
export const RESTORE_PASSES = 3

/** A level from a setting or a click ("Full", " low "), or null when it is none. Levels from before B735 read on: "strong" is Low, "off" and "gentle" are Full. */
export function parseLevel(value) {
  if (typeof value !== 'string') return null
  const level = value.trim().toLowerCase()
  if (level === 'strong') return 'low'
  if (level === 'off' || level === 'gentle') return 'full'
  return LEVELS.includes(level) ? level : null
}

/** The level saved in data/cpu.json, else `fallback` (config.json's `cpuLimit`, "off" unless set). */
export async function readLevel(file, fallback = 'full') {
  try {
    const level = parseLevel(JSON.parse(await readFile(file, 'utf8')).level)
    if (level !== null) return level
  } catch {
    // Not there, or broken: the default stands.
  }
  return parseLevel(fallback) ?? 'full'
}

/** Keeps the level in data/cpu.json, so it survives a restart. */
export async function saveLevel(file, level, now) {
  await mkdir(dirname(file), { recursive: true })
  await writeAtomic(file, `${JSON.stringify({ level, at: now })}\n`)
}

/**
 * The PC's logical cores, all of them (2026-10-19): never the ones this process may use (`availableParallelism`), which
 * a level set on the chat that started the board narrows; counted that way, the cores shrank at every restart of the
 * board.
 */
export function logicalCores() {
  return Math.max(1, cpus().length)
}

/**
 * The changes that give the board's own processes (`pids`: its own and its keeper's) Normal priority and all `cores`
 * back: a chat may have started the board, and Windows hands the chat's Idle priority and cores on to it (2026-10-19).
 */
export function boardChanges(pids, cores) {
  const affinity = affinityMask(cores, 'full')
  return pids.filter(pid => Number.isInteger(pid) && pid > 0).map(pid => ({ pid, key: `board ${pid}`, priority: 'Normal', affinity }))
}

/** How many cores Low leaves the project: the last two, or all of them on a PC with fewer. */
export function lowCores(cores) {
  return Math.max(1, Math.min(LOW_CORES, Math.floor(Math.min(cores, 64))))
}

/**
 * The affinity mask of a level on a PC with `cores` logical cores (at most 64: one processor group), as a decimal
 * string of the signed 64-bit number Windows takes: all cores for Full, the last two for Low.
 */
export function affinityMask(cores, level) {
  const count = BigInt(Math.max(1, Math.min(64, Math.floor(cores))))
  const all = (1n << count) - 1n
  const mask = level === 'low' ? all ^ ((1n << (count - BigInt(lowCores(Number(count))))) - 1n) : all
  return BigInt.asIntN(64, mask).toString()
}

/** A session id as a chat's card file names it: letters, digits and "-". */
const SESSION = /^[\w-]{8,80}$/

/** The session ids the card files name (`<session>.json` in `.claude/chats`), from the folder's file names. */
export function sessionsOfCards(names) {
  return names.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).filter(name => SESSION.test(name) && name !== 'list')
}

/** The session a Claude Code CLI's command line resumes or starts (`--resume=<id>`, `--resume <id>`, `--session-id`). */
export function sessionOf(commandLine) {
  if (typeof commandLine !== 'string') return null
  return commandLine.match(/(?:^|\s)--(?:resume|session-id)(?:=|\s+)"?([\w-]{8,80})"?(?=\s|$)/)?.[1] ?? null
}

/**
 * A process the project's tools start on their own, outside any chat: codex, a vite server, a headless or remote-driven
 * browser (the person's own Edge has neither flag).
 */
export function isProjectTool(one) {
  const name = String(one.name).toLowerCase()
  const line = typeof one.commandLine === 'string' ? one.commandLine : ''
  if (name === 'codex.exe') return true
  if (name === 'node.exe') return /\bvite\b/i.test(line)
  if (name === 'msedge.exe') return /--headless|--remote-debugging-port|edge-cdp/i.test(line) && !/--type=/.test(line)
  return false
}

/**
 * The processes the project started, from one listing (`{ pid, parent, name, commandLine, priority, created }` each):
 * every `claude.exe` whose command line names one of `sessions`, the board's own processes (`boardPids`: its own and
 * its keeper's numbers), the project's tools (`isProjectTool`), and the whole tree below each. A child counts only when
 * it started after its parent, so a process number Windows gave out again leads nowhere. Parents come before their
 * children in the answer. The desktop app's command line names no session, and it is no child of a chat.
 */
export function chosenProcesses(list, sessions, { boardPids = [] } = {}) {
  const board = new Set(boardPids.filter(Number.isInteger))
  const wanted = new Set(sessions)
  const children = new Map()
  for (const one of list) {
    if (!children.has(one.parent)) children.set(one.parent, [])
    children.get(one.parent).push(one)
  }
  const isRoot = one => (String(one.name).toLowerCase() === 'claude.exe' && wanted.has(sessionOf(one.commandLine))) || board.has(one.pid) || isProjectTool(one)
  const chosen = []
  const seen = new Set()
  const queue = list.filter(isRoot).map(one => ({ one, parentKey: null }))
  while (queue.length > 0) {
    const { one, parentKey } = queue.shift()
    if (seen.has(one.pid)) continue
    seen.add(one.pid)
    const key = keyOf(one)
    chosen.push({ ...one, key, parentKey })
    for (const child of children.get(one.pid) ?? []) {
      if (child.pid === one.pid) continue
      if (Number.isFinite(child.created) && Number.isFinite(one.created) && child.created < one.created) continue
      queue.push({ one: child, parentKey: key })
    }
  }
  return chosen
}

/** A process by its number and start: the same number later is another process. */
export const keyOf = one => `${one.pid}@${one.created ?? ''}`

/**
 * What to set: the chosen processes that are not at the level yet, each `{ pid, key, priority, affinity, eco }`.
 * `applied` maps a process's key to the level the board last set. A process counts as done when Windows reports the
 * level's priority and the board set it; a child that inherited the priority is still set once, for its cores and its
 * efficiency mode. With `all`, every chosen process is set (the one pass that gives everything back).
 */
export function changesFor(chosen, level, applied, cores, { all = false } = {}) {
  const priority = PRIORITY[level]
  const affinity = affinityMask(cores, level)
  const changes = []
  for (const one of chosen) {
    const isDone = !all && one.priority === BASE_PRIORITY[priority] && applied.get(one.key) === level
    if (!isDone) changes.push({ pid: one.pid, key: one.key, priority, affinity, eco: level === 'low' })
  }
  return { changes }
}

// The PowerShell calls. Both lower their own priority first: the board's look must not be what makes the game lag.
const COMMAND_LINES = "('claude.exe','node.exe','codex.exe','msedge.exe') -contains $_.Name.ToLower()"
export const LIST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}",
  `Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; name = [string]$_.Name; priority = [int]$_.Priority; created = $(if ($_.CreationDate) { [long]$_.CreationDate.ToFileTimeUtc() } else { $null }); commandLine = $(if (${COMMAND_LINES}) { [string]$_.CommandLine } else { $null }) } } | ConvertTo-Json -Compress -Depth 2`,
].join('; ')

// Efficiency mode (EcoQoS): SetProcessInformation(ProcessPowerThrottling), the execution-speed bit on for Low, forced off for Full.
const ECO_TYPE = "Add-Type -Namespace Cpu -Name Eco -MemberDefinition '[StructLayout(LayoutKind.Sequential)] public struct S { public uint V; public uint C; public uint M; } [DllImport(\"kernel32.dll\")] public static extern bool SetProcessInformation(IntPtr h, int cls, ref S s, int size);'"
const SET_SCRIPT = [
  "try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}",
  `try { ${ECO_TYPE} } catch {}`,
  '$changes = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$done = @()',
  "foreach ($c in @($changes)) { try { $p = Get-Process -Id ([int]$c.pid) -ErrorAction Stop; $p.PriorityClass = [string]$c.priority; $p.ProcessorAffinity = [IntPtr][long]$c.affinity; $done += [int]$c.pid; try { $s = New-Object Cpu.Eco+S; $s.V = 1; $s.C = 1; $s.M = [uint32]$(if ($c.eco) { 1 } else { 0 }); [void][Cpu.Eco]::SetProcessInformation($p.Handle, 4, [ref]$s, 12) } catch {} } catch {} }",
  'ConvertTo-Json -Compress @($done)',
].join('; ')

/** Runs a PowerShell script, with `input` on its standard input; answers its output. */
function powershell(script, input = '', timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true })
    // A board at Low runs at Idle and its child starts at Idle too, starved on a busy PC before the script lowers itself:
    // the board gives the child BelowNormal at once, from outside (2026-10-27: a switch back to Full took minutes).
    try {
      setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      // Already gone, or not allowed: the script lowers itself as before.
    }
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { err += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err.trim().split('\n')[0] || `PowerShell ended with ${code}`))
    })
    child.stdin.end(input)
  })
}

/** A listing's JSON as processes; one process comes back as an object, not a list. */
export function parseListing(text) {
  const parsed = JSON.parse(text.trim() === '' ? '[]' : text)
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.filter(one => one !== null && Number.isInteger(one.pid)).map(one => ({
    pid: one.pid,
    parent: Number.isInteger(one.parent) ? one.parent : -1,
    name: typeof one.name === 'string' ? one.name : '',
    commandLine: typeof one.commandLine === 'string' ? one.commandLine : null,
    priority: Number.isFinite(one.priority) ? one.priority : null,
    created: Number.isFinite(one.created) ? one.created : null,
  }))
}

/** The one function that talks to Windows; tests give their own. */
export const windowsProcesses = {
  list: async () => parseListing(await powershell(LIST_SCRIPT)),
  set: async changes => {
    const out = await powershell(SET_SCRIPT, JSON.stringify(changes.map(({ pid, priority, affinity, eco }) => ({ pid, priority, affinity, eco: eco === true }))))
    const done = JSON.parse(out.trim() === '' ? '[]' : out)
    return (Array.isArray(done) ? done : [done]).filter(Number.isInteger)
  },
}

/**
 * The board's keeper of the level. `sessions()` answers the project's chats' session ids; `processes` lists and sets
 * (`windowsProcesses` on Windows). `apply()` runs at start and every refresh: one listing, and a second call only when a
 * process is not at the level. Full does nothing, apart from a few passes (`RESTORE_PASSES`) that give everything back after Low. A process
 * that cannot be set (gone, access denied) is passed over quietly; a listing that fails is the one line `fault`.
 * `spare`: the board's own processes (its own and its keeper's numbers). Under Low what they start is limited, never
 * they themselves (2026-10-30: "it should not slow the board itself"): a pass that finds one of them below Normal (a
 * chat that started the board handed its Idle priority on) gives it Normal and all cores; under Full the first pass
 * does the same (2026-10-19).
 */
export function cpuLimiter({ file, fallback = 'full', platform = process.platform, cores, sessions, processes = windowsProcesses, now = Date.now, spare = [], log = () => {} }) {
  const available = platform === 'win32'
  let level = null
  let restore = 0
  let applied = new Map()
  let count = 0
  let fault = null
  let running = null
  let isFreed = false
  // B440: the last line about the board's own priority; a line is written only when it says something new.
  let lastLine = null
  const tell = line => {
    if (line === lastLine) return
    lastLine = line
    log(line)
  }

  const load = async () => {
    if (level === null) level = await readLevel(file, fallback)
    return level
  }

  async function once() {
    const current = await load()
    if (available && current === 'full' && !isFreed) {
      // B440: done only when Windows took every one of them; a slow or failed call is tried again on the next pass.
      const own = boardChanges(spare, cores)
      const done = own.length === 0 ? [] : await processes.set(own).catch(() => [])
      isFreed = own.every(one => Array.isArray(done) && done.includes(one.pid))
      if (own.length > 0) tell(`CPU for Claude: the board's own processes ${isFreed ? 'are at Normal on all cores' : 'could not be set to Normal yet; tried again next pass'}.`)
    }
    if (!available || (current === 'full' && restore === 0)) {
      count = 0
      fault = null
      return
    }
    let list
    try {
      list = await processes.list()
    } catch (error) {
      fault = `The board could not read the list of processes (${error instanceof Error ? error.message : 'unknown error'}): the CPU stays as it is.`
      return
    }
    fault = null
    // The board's own processes are roots of what is chosen (their children are limited), never limited themselves.
    const own = new Set(spare.filter(Number.isInteger))
    const chosen = chosenProcesses(list, await sessions(), { boardPids: spare }).filter(one => !own.has(one.pid))
    const { changes } = changesFor(chosen, current, applied, cores, { all: current === 'full' })
    const slowed = list.filter(one => own.has(one.pid) && one.priority !== BASE_PRIORITY.Normal).map(one => one.pid)
    if (current === 'low' && slowed.length > 0) changes.push(...boardChanges(slowed, cores))
    if (changes.length > 0) {
      try {
        await processes.set(changes)
      } catch {
        // Each process is tried once per level; the next level, or a new process, tries again.
      }
    }
    const living = new Set(chosen.map(one => one.key))
    applied = new Map([...applied].filter(([key]) => living.has(key)))
    for (const change of changes) applied.set(change.key, current)
    count = current === 'full' ? 0 : chosen.length
    if (current === 'full') {
      restore -= 1
      applied = new Map()
    }
  }

  /** One pass at a time; a call while one runs waits for it and then runs anew. */
  async function apply() {
    while (running !== null) await running
    running = once().finally(() => { running = null })
    return running
  }

  const view = () => ({ available, level: level ?? 'full', count, fault, cores, lowCores: lowCores(cores) })

  return {
    available,
    apply,
    view,
    async set(value) {
      const next = parseLevel(value)
      if (next === null) return { ok: false, status: 400, why: 'The level is full or low.' }
      if (!available) return { ok: false, status: 409, why: 'Not available here: the board sets the CPU on Windows only.' }
      const before = await load()
      level = next
      if (next === 'full' && before !== 'full') {
        restore = RESTORE_PASSES
        isFreed = false
      }
      await saveLevel(file, next, now())
      await apply()
      return { ok: true, result: view() }
    },
    async ready() {
      await load()
    },
  }
}
