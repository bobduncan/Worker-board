// B311: "CPU for the chats". The person, 2026-10-18, while playing: the workers made the PC lag; the board should not
// stop, but leave room to play. Three levels: Off (Normal priority, all cores), Gentle (BelowNormal priority) and Strong
// (Idle priority and at most the higher half of the cores). They apply to the project's chats only: the Claude Code
// CLI processes whose command line names a session of the project's list of chats, and everything below them (node,
// vite, a browser with a profile of its own, python, git, ...). Never the desktop app, never another program.
//
// Windows only: the processes are read with one PowerShell call per refresh, and set with a second one only when a
// process needs it. Windows hands a BelowNormal or Idle priority and the affinity on to new child processes, so most
// of a chat's new processes need nothing. Elsewhere the control says "not available here" and nothing runs.

import { readFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname } from 'node:path'

import { writeAtomic } from './write.mjs'

export const LEVELS = ['off', 'gentle', 'strong']

/** A process's priority class per level, and the base priority Windows reports for it (Win32_Process.Priority). */
export const PRIORITY = { off: 'Normal', gentle: 'BelowNormal', strong: 'Idle' }
export const BASE_PRIORITY = { Normal: 8, BelowNormal: 6, Idle: 4 }

/** A level from a setting or a click ("Gentle", " strong "), or null when it is none. */
export function parseLevel(value) {
  if (typeof value !== 'string') return null
  const level = value.trim().toLowerCase()
  return LEVELS.includes(level) ? level : null
}

/** The level saved in data/cpu.json, else `fallback` (config.json's `cpuLimit`, "off" unless set). */
export async function readLevel(file, fallback = 'off') {
  try {
    const level = parseLevel(JSON.parse(await readFile(file, 'utf8')).level)
    if (level !== null) return level
  } catch {
    // Not there, or broken: the default stands.
  }
  return parseLevel(fallback) ?? 'off'
}

/** Keeps the level in data/cpu.json, so it survives a restart. */
export async function saveLevel(file, level, now) {
  await mkdir(dirname(file), { recursive: true })
  await writeAtomic(file, `${JSON.stringify({ level, at: now })}\n`)
}

/** How many cores Strong leaves the chats: half of them, at least one. */
export function strongCores(cores) {
  return Math.max(1, Math.floor(Math.min(cores, 64) / 2))
}

/**
 * The affinity mask of a level on a PC with `cores` logical cores (at most 64: one processor group), as a decimal
 * string of the signed 64-bit number Windows takes: all cores for Off and Gentle, the higher half for Strong.
 */
export function affinityMask(cores, level) {
  const count = BigInt(Math.max(1, Math.min(64, Math.floor(cores))))
  const all = (1n << count) - 1n
  const mask = level === 'strong' ? all ^ ((1n << (count - BigInt(strongCores(Number(count))))) - 1n) : all
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
 * The processes a level applies to, from one listing (`{ pid, parent, name, commandLine, priority, created }` each):
 * every `claude.exe` whose command line names one of `sessions`, and its whole tree below. A child counts only when it
 * started after its parent, so a process number Windows gave out again leads nowhere. Parents come before their
 * children in the answer. The desktop app's command line names no session, and it is no child of a chat.
 */
export function chosenProcesses(list, sessions) {
  const wanted = new Set(sessions)
  const children = new Map()
  for (const one of list) {
    if (!children.has(one.parent)) children.set(one.parent, [])
    children.get(one.parent).push(one)
  }
  const roots = list.filter(one => String(one.name).toLowerCase() === 'claude.exe' && wanted.has(sessionOf(one.commandLine)))
  const chosen = []
  const seen = new Set()
  const queue = roots.map(one => ({ one, parentKey: null }))
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
 * What to set: the chosen processes that are not at the level yet, each `{ pid, key, priority, affinity }`. `applied`
 * maps a process's key to the level the board last set (or saw inherited). A process counts as done when Windows
 * reports the level's priority and the board set it, or its parent is done at the level (it inherited both the
 * priority and the cores). With `all`, every chosen process is set (Off's one pass that gives everything back).
 */
export function changesFor(chosen, level, applied, cores, { all = false } = {}) {
  const priority = PRIORITY[level]
  const affinity = affinityMask(cores, level)
  const done = new Set()
  const changes = []
  for (const one of chosen) {
    const isAt = one.priority === BASE_PRIORITY[priority]
    const isDone = !all && isAt && (applied.get(one.key) === level || (one.parentKey !== null && done.has(one.parentKey)))
    if (isDone) done.add(one.key)
    else changes.push({ pid: one.pid, key: one.key, priority, affinity })
  }
  return { changes, inherited: [...done] }
}

// The PowerShell calls. Both lower their own priority first: the board's look must not be what makes the game lag.
const LIST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}",
  'Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; name = [string]$_.Name; priority = [int]$_.Priority; created = $(if ($_.CreationDate) { [long]$_.CreationDate.ToFileTimeUtc() } else { $null }); commandLine = $(if ($_.Name -ieq \'claude.exe\') { [string]$_.CommandLine } else { $null }) } } | ConvertTo-Json -Compress -Depth 2',
].join('; ')

const SET_SCRIPT = [
  "try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}",
  '$changes = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$done = @()',
  "foreach ($c in @($changes)) { try { $p = Get-Process -Id ([int]$c.pid) -ErrorAction Stop; $p.PriorityClass = [string]$c.priority; $p.ProcessorAffinity = [IntPtr][long]$c.affinity; $done += [int]$c.pid } catch {} }",
  'ConvertTo-Json -Compress @($done)',
].join('; ')

/** Runs a PowerShell script, with `input` on its standard input; answers its output. */
function powershell(script, input = '', timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true })
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
    const out = await powershell(SET_SCRIPT, JSON.stringify(changes.map(({ pid, priority, affinity }) => ({ pid, priority, affinity }))))
    const done = JSON.parse(out.trim() === '' ? '[]' : out)
    return (Array.isArray(done) ? done : [done]).filter(Number.isInteger)
  },
}

/**
 * The board's keeper of the level. `sessions()` answers the project's chats' session ids; `processes` lists and sets
 * (`windowsProcesses` on Windows). `apply()` runs at start and every refresh: one listing, and a second call only when a
 * process is not at the level. Off does nothing, apart from one pass that gives the chats Normal and all cores back
 * after a limit was switched off. A process that cannot be set (gone, access denied) is passed over quietly; a listing
 * that fails is the one line `fault`.
 */
export function cpuLimiter({ file, fallback = 'off', platform = process.platform, cores, sessions, processes = windowsProcesses, now = Date.now }) {
  const available = platform === 'win32'
  let level = null
  let restore = false
  let applied = new Map()
  let count = 0
  let fault = null
  let running = null

  const load = async () => {
    if (level === null) level = await readLevel(file, fallback)
    return level
  }

  async function once() {
    const current = await load()
    if (!available || (current === 'off' && !restore)) {
      count = 0
      fault = null
      return
    }
    let list
    try {
      list = await processes.list()
    } catch (error) {
      fault = `The board could not read the list of processes (${error instanceof Error ? error.message : 'unknown error'}): the chats' CPU stays as it is.`
      return
    }
    fault = null
    const chosen = chosenProcesses(list, await sessions())
    const { changes, inherited } = changesFor(chosen, current, applied, cores, { all: current === 'off' })
    if (changes.length > 0) {
      try {
        await processes.set(changes)
      } catch {
        // Each process is tried once per level; the next level, or a new process, tries again.
      }
    }
    const living = new Set(chosen.map(one => one.key))
    applied = new Map([...applied].filter(([key]) => living.has(key)))
    for (const key of inherited) applied.set(key, current)
    for (const change of changes) applied.set(change.key, current)
    count = current === 'off' ? 0 : chosen.length
    if (current === 'off') {
      restore = false
      applied = new Map()
    }
  }

  /** One pass at a time; a call while one runs waits for it and then runs anew. */
  async function apply() {
    while (running !== null) await running
    running = once().finally(() => { running = null })
    return running
  }

  const view = () => ({ available, level: level ?? 'off', count, fault, cores, strongCores: strongCores(cores) })

  return {
    available,
    apply,
    view,
    async set(value) {
      const next = parseLevel(value)
      if (next === null) return { ok: false, status: 400, why: 'The level is off, gentle or strong.' }
      if (!available) return { ok: false, status: 409, why: 'Not available here: the board sets the chats\' CPU on Windows only.' }
      const before = await load()
      level = next
      if (next === 'off' && before !== 'off') restore = true
      await saveLevel(file, next, now())
      await apply()
      return { ok: true, result: view() }
    },
    async ready() {
      await load()
    },
  }
}
