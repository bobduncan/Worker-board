// B311: "CPU for Claude". The person, 2026-10-18, while playing: the workers made the PC lag. B735 (2026-10-27): two
// choices the person picks, no game detection. Full: everything the project started runs at Normal priority on all
// cores. Low: what the chats and the board's own processes started, the vite servers, codex and a headless browser
// run at Idle priority on the last two cores, in efficiency mode where Windows has it, so a game or any other program
// keeps the rest of the PC. Never the desktop app, never a program the project did not start. The board's own processes (its server
// and its keeper) stay at Normal on all cores in Low too (the person, 2026-10-30, the board blank for minutes at Idle
// while a game ran: "it should not slow the board itself").
// F44 (2026-11-23): a chat's own claude.exe no longer runs at Idle either. There, on two crowded cores, its hooks thread starved (hooks
// took up to 287 s) and the CLI's watchdog, which reads 5 s without an answer as a crash, unloaded the Workers mod until the process
// restarted: "Link gone". Under Low a chat runs at BelowNormal on all cores: above all Idle work, below a game. Windows hands BelowNormal
// to what the chat starts, so a child is born below the game, and the next pass limits it to Idle on the last two cores.
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

/** F44: when the level saved in data/cpu.json was set (ms), or null. */
export async function readLevelAt(file) {
  try {
    const at = JSON.parse(await readFile(file, 'utf8')).at
    return Number.isFinite(at) && at > 0 ? at : null
  } catch {
    return null
  }
}

/** S4: who set the level saved in data/cpu.json (the board page, a chat, a script), or null. */
export async function readLevelWho(file) {
  try {
    const who = JSON.parse(await readFile(file, 'utf8')).who
    return typeof who === 'string' && who !== '' ? who : null
  } catch {
    return null
  }
}

/** Keeps the level in data/cpu.json, so it survives a restart; S4: with who set it, when known. */
export async function saveLevel(file, level, now, who = null) {
  await mkdir(dirname(file), { recursive: true })
  await writeAtomic(file, `${JSON.stringify({ level, at: now, ...(who ? { who } : {}) })}\n`)
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

/**
 * F44: a command line's arguments as Windows splits them (quotes group, `\"` is a quote, backslashes count only before one), the program
 * first: `{ text, quoted }`, `quoted` when the argument opens with a quote, as a prompt does.
 */
export function commandArgs(line) {
  const args = []
  let text = ''
  let isOpen = false
  let quoted = false
  let inQuotes = false
  let slashes = 0
  const open = isQuote => {
    if (isOpen) return
    isOpen = true
    quoted = isQuote
  }
  const flush = () => {
    if (slashes > 0) open(false)
    text += '\\'.repeat(slashes)
    slashes = 0
  }
  for (const char of String(line)) {
    if (char === '\\') {
      slashes += 1
    } else if (char === '"') {
      const isLiteral = slashes % 2 === 1
      slashes = Math.floor(slashes / 2)
      if (slashes > 0) flush()
      if (isLiteral) {
        open(false)
        text += '"'
      } else {
        open(true)
        inQuotes = !inQuotes
      }
    } else if (/\s/.test(char) && !inQuotes) {
      flush()
      if (isOpen) args.push({ text, quoted })
      text = ''
      isOpen = false
      quoted = false
    } else {
      flush()
      open(false)
      text += char
    }
  }
  flush()
  if (isOpen) args.push({ text, quoted })
  return args
}

/**
 * The session a Claude Code CLI's command line resumes or starts (`--resume=<id>`, `--resume <id>`, `--session-id`). F44: only as an
 * argument of its own, never words inside a quoted prompt.
 */
export function sessionOf(commandLine) {
  if (typeof commandLine !== 'string') return null
  const args = commandArgs(commandLine).slice(1)
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].quoted) continue
    const flag = args[i].text.match(/^--(?:resume|session-id)(?:=(.*))?$/)
    if (flag === null) continue
    const id = flag[1] ?? args[i + 1]?.text ?? ''
    return SESSION.test(id) ? id : null
  }
  return null
}

/**
 * F44: a chat's own CLI process: a `claude.exe` whose command line names a session (the desktop app's names none), and no one-off: a
 * `claude -p --resume <id>` a tool started answers once and ends, so it is limited with the tree that started it.
 */
export function isChatProcess(one) {
  if (String(one.name).toLowerCase() !== 'claude.exe' || sessionOf(one.commandLine) === null) return false
  return !commandArgs(one.commandLine).slice(1).some(arg => !arg.quoted && (arg.text === '-p' || arg.text === '--print'))
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

/** F44: a chat's own priority under Low: above all Idle work, below a game; Windows hands it to what the chat starts. */
export const CHAT_PRIORITY = 'BelowNormal'

/** F44: what `applied` holds for a chat's own process the board set to `CHAT_PRIORITY` on all cores under Low. */
const CHAT_KEPT = 'chat'

/**
 * F44: what to set so the chats' own processes run at `CHAT_PRIORITY` on all cores under Low, efficiency mode off. A chat the board set
 * and Windows reports at that priority is done, so no pass rewrites it. The listing holds no cores: one the board has not set yet is set
 * once, and one found at another priority again.
 */
export function chatChanges(chats, applied, cores) {
  const affinity = affinityMask(cores, 'full')
  return chats.filter(one => one.priority !== BASE_PRIORITY[CHAT_PRIORITY] || applied.get(one.key) !== CHAT_KEPT)
    .map(one => ({ pid: one.pid, key: one.key, priority: CHAT_PRIORITY, affinity, eco: false }))
}

/**
 * F44: the programs a chat's tools run that can outlive what started them. Only these are ever limited or given back outside a tree: never
 * a game, never the desktop app, never a browser (a test browser is a project tool, `isProjectTool`, whatever became of its parent).
 */
const STRANDED_NAMES = new Set(['node.exe', 'bash.exe', 'sh.exe', 'git.exe', 'python.exe', 'python3.exe', 'cmd.exe', 'conhost.exe', 'powershell.exe', 'pwsh.exe', 'ffmpeg.exe'])

/** F44: the processes worth asking Windows for their cores: at Idle, of a program above, not among those already chosen. */
export function strandedCandidates(list, chosen) {
  const picked = new Set(chosen.map(one => one.pid))
  return list.filter(one => !picked.has(one.pid) && one.priority === BASE_PRIORITY.Idle && STRANDED_NAMES.has(String(one.name).toLowerCase()))
}

/**
 * F44 (a test run started under Low stayed at Idle on two cores after Full, its parent gone, so no tree led to it): the candidates that
 * carry Low's own mark, Idle on exactly the cores Low leaves (`masks`: pid to the mask as a decimal string), whose parent is gone, and what
 * they started that carries the mark too. A parent number given out again is no parent. On a PC where Low leaves every core there is no
 * mark to go by: none. `roots`: the numbers of processes already being given back, whose marked children count as well.
 */
export function strandedProcesses(list, masks, cores, { chosen = [], roots = [] } = {}) {
  const lowMask = affinityMask(cores, 'low')
  if (lowMask === affinityMask(cores, 'full')) return []
  return withMarkedChildren(list, new Set(strandedCandidates(list, chosen).filter(one => masks.get(one.pid) === lowMask).map(one => one.pid)), roots)
}

/**
 * F44: the `marked` processes whose parent is gone, with what they, or `roots`, started that is marked too. A parent number given out again
 * is no parent. The roots themselves are not in the answer unless marked.
 */
function withMarkedChildren(list, marked, roots = []) {
  const byPid = new Map(list.map(one => [one.pid, one]))
  const parentOf = one => {
    const parent = byPid.get(one.parent)
    if (parent === undefined || parent.pid === one.pid) return null
    return Number.isFinite(parent.created) && Number.isFinite(one.created) && parent.created > one.created ? null : parent
  }
  const found = new Set([...roots, ...list.filter(one => marked.has(one.pid) && parentOf(one) === null).map(one => one.pid)])
  for (let grew = true; grew;) {
    grew = false
    for (const one of list) {
      if (found.has(one.pid) || !marked.has(one.pid) || !found.has(parentOf(one)?.pid)) continue
      found.add(one.pid)
      grew = true
    }
  }
  return list.filter(one => found.has(one.pid) && marked.has(one.pid))
}

/** F44: a time in ms as Windows dates a process (FILETIME: 100 ns since 1601), as the listing's `created`. */
export const fileTimeOf = ms => (ms + 11_644_473_600_000) * 10_000

/**
 * F44: what a chat started under Low whose starter ended before the next pass: in no tree, at the BelowNormal the chat handed it, on all
 * cores for life. Told from anything else by all of: a tool's program (`STRANDED_NAMES`), exactly BelowNormal (a program of the person's
 * starts at Normal), its parent gone, and born since Low was switched on (`since`, FILETIME). With what it started that is marked too.
 */
export function orphansOf(list, found, { since = null, skip = [] } = {}) {
  if (!Number.isFinite(since)) return []
  const picked = new Set([...found.map(one => one.pid), ...skip])
  const isMarked = one => !picked.has(one.pid) && one.priority === BASE_PRIORITY[CHAT_PRIORITY] && STRANDED_NAMES.has(String(one.name).toLowerCase())
    && Number.isFinite(one.created) && one.created >= since
  return withMarkedChildren(list, new Set(list.filter(isMarked).map(one => one.pid)))
}

// The PowerShell calls. Both lower their own priority first: the board's look must not be what makes the game lag.
const COMMAND_LINES = "('claude.exe','node.exe','codex.exe','msedge.exe') -contains $_.Name.ToLower()"
export const LIST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}",
  // Leaked headless browsers (2026-11-13): `threads` too, so a killed Edge that lingers as a 1-thread zombie is told from a live one,
  // and `cpuMs` (kernel and user time, ms), so a browser eating cores is told from a quiet one.
  `Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; name = [string]$_.Name; priority = [int]$_.Priority; threads = [int]$_.ThreadCount; cpuMs = [long](([long]$_.KernelModeTime + [long]$_.UserModeTime) / 10000); created = $(if ($_.CreationDate) { [long]$_.CreationDate.ToFileTimeUtc() } else { $null }); createdText = $(if ($_.CreationDate) { [string]$_.CreationDate.ToFileTimeUtc() } else { $null }); commandLine = $(if (${COMMAND_LINES}) { [string]$_.CommandLine } else { $null }) } } | ConvertTo-Json -Compress -Depth 2`,
].join('; ')

// Efficiency mode (EcoQoS): SetProcessInformation(ProcessPowerThrottling), the execution-speed bit on for Low, forced off for Full.
// F44: through Reflection.Emit, not Add-Type: no C# compiler, so a set that does not end cleanly leaves nothing in Temp (about 31,000 files
// by 2026-11-23, most of Defender's scan time in the person's recording).
const ECO_TYPE = "$a = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName 'CpuEco'), [Reflection.Emit.AssemblyBuilderAccess]::Run); $t = $a.DefineDynamicModule('CpuEco').DefineType('CpuEco', [Reflection.TypeAttributes]'Public,Class'); $m = $t.DefinePInvokeMethod('SetProcessInformation', 'kernel32.dll', [Reflection.MethodAttributes]'Public,Static,PinvokeImpl', [Reflection.CallingConventions]::Standard, [bool], [Type[]]@([IntPtr], [int], [uint32[]], [int]), [Runtime.InteropServices.CallingConvention]::Winapi, [Runtime.InteropServices.CharSet]::Ansi); $m.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig); $eco = $t.CreateType()"
export const SET_SCRIPT = [
  "try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}",
  `try { ${ECO_TYPE} } catch {}`,
  '$changes = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$done = @()',
  "foreach ($c in @($changes)) { try { $p = Get-Process -Id ([int]$c.pid) -ErrorAction Stop; $p.PriorityClass = [string]$c.priority; $p.ProcessorAffinity = [IntPtr][long]$c.affinity; $done += [int]$c.pid; try { [void]$eco::SetProcessInformation($p.Handle, 4, [uint32[]]@(1, 1, [uint32]$(if ($c.eco) { 1 } else { 0 })), 12) } catch {} } catch {} }",
  'ConvertTo-Json -Compress @($done)',
].join('; ')
// F44: reads the cores of the processes named on its input; it sets nothing.
export const MASK_SCRIPT = [
  "try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}",
  '$ids = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$out = @()',
  'foreach ($id in @($ids)) { try { $p = Get-Process -Id ([int]$id) -ErrorAction Stop; $out += [pscustomobject]@{ pid = [int]$p.Id; mask = [string]$p.ProcessorAffinity.ToInt64() } } catch {} }',
  'ConvertTo-Json -Compress @($out)',
].join('; ')

/** Runs a PowerShell script, with `input` on its standard input; answers its output. */
export function powershell(script, input = '', timeoutMs = 20_000) {
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
    threads: Number.isInteger(one.threads) ? one.threads : null,
    cpuMs: Number.isFinite(one.cpuMs) ? one.cpuMs : null,
    created: Number.isFinite(one.created) ? one.created : null,
    // Chat 1's verifier of F8 (2): the FILETIME as an exact string too: through JSON the number loses its last digits (a double steps by
    // 16 at 1.3e17), and a kill must name the process's own time.
    createdText: typeof one.createdText === 'string' && /^\d{1,20}$/.test(one.createdText) ? one.createdText : Number.isFinite(one.created) ? String(Math.round(one.created)) : null,
  }))
}

/** F44: the mask script's JSON as a Map of pid to mask; one process comes back as an object, none as nothing. */
export function parseMasks(text) {
  const parsed = JSON.parse(text.trim() === '' ? '[]' : text)
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return new Map(list.filter(one => Number.isInteger(one?.pid) && typeof one.mask === 'string').map(one => [one.pid, one.mask]))
}

/** The one function that talks to Windows; tests give their own. */
export const windowsProcesses = {
  list: async () => parseListing(await powershell(LIST_SCRIPT)),
  masks: async pids => parseMasks(await powershell(MASK_SCRIPT, JSON.stringify(pids))),
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
export function cpuLimiter({ file, fallback = 'full', platform = process.platform, cores, sessions, processes = windowsProcesses, now = Date.now, spare = [], log = () => {}, onLevel = async () => {} }) {
  const available = platform === 'win32'
  let level = null
  // S4: the level, since when and by whom, to the board (which writes the heavy-run queue's mode file); the caller records its failure.
  const heard = () => onLevel({ level, since, who })
  let restore = 0
  let applied = new Map()
  // F44: since when Low is on (ms), kept through Full's passes, and the processes outside any tree the board limited or gave back
  // (`pid@created`): Low limits them again after a Full.
  let lowSince = null
  // S4: when the level was set and by whom (the panel shows it: F69's open part). `onLevel` hears every level, at start and on a change.
  let since = null
  let who = null
  let loose = new Set()
  let count = 0
  let fault = null
  let running = null
  let isFreed = false
  // F24b: under Low the board's own processes get Normal and all cores back FIRST, before the listing and the sessions, which a
  // starved board (Idle on two crowded cores, inherited from the chat that started it) could not get through (chat 1, 2026-11-14).
  let isRestored = false
  // B440: the last line about the board's own priority; a line is written only when it says something new.
  let lastLine = null
  const tell = line => {
    if (line === lastLine) return
    lastLine = line
    log(line)
  }

  const load = async () => {
    if (level === null) {
      level = await readLevel(file, fallback)
      since = await readLevelAt(file)
      who = await readLevelWho(file)
      if (level === 'low') lowSince = since ?? now()
      await heard()
    }
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
    if (available && current === 'low' && !isRestored) {
      const own = boardChanges(spare, cores)
      const done = own.length === 0 ? [] : await processes.set(own).catch(() => [])
      isRestored = own.every(one => Array.isArray(done) && done.includes(one.pid))
      if (own.length > 0) tell(`CPU for Claude: the board's own processes ${isRestored ? 'are at Normal on all cores' : 'could not be set to Normal yet; tried again next pass'}.`)
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
    const found = chosenProcesses(list, await sessions(), { boardPids: spare }).filter(one => !own.has(one.pid))
    // F44: under Low a chat's own process is kept at BelowNormal on all cores; what it starts is limited. Full's `found` gives it Normal back.
    const chats = current === 'low' ? found.filter(isChatProcess) : []
    // F44: outside any tree: what a chat started whose starter is gone, and what the board limited or gave back before.
    const inTree = new Set(found.map(one => one.pid))
    const orphans = orphansOf(list, found, { since: Number.isFinite(lowSince) ? fileTimeOf(lowSince) : null, skip: [...own] })
    const remembered = list.filter(one => loose.has(keyOf(one)) && !inTree.has(one.pid) && !own.has(one.pid))
    const outside = [...new Map([...remembered, ...orphans].map(one => [one.pid, { ...one, key: keyOf(one), parentKey: null }])).values()]
    const chosen = current === 'low' ? [...found.filter(one => !isChatProcess(one)), ...outside] : found
    const { changes } = changesFor(chosen, current, applied, cores, { all: current === 'full' })
    const slowed = list.filter(one => own.has(one.pid) && one.priority !== BASE_PRIORITY.Normal).map(one => one.pid)
    if (current === 'low' && slowed.length > 0) changes.push(...boardChanges(slowed, cores))
    const kept = chatChanges(chats, applied, cores)
    // F44: back at Full, what Low left behind with its parent gone: what the board knows, and at Idle only with Low's cores read.
    let stranded = []
    if (current === 'full') {
      const given = new Map(outside.map(one => [one.pid, one]))
      const candidates = strandedCandidates(list, found).filter(one => !given.has(one.pid))
      if (candidates.length > 0 && typeof processes.masks === 'function') {
        const masks = await processes.masks(candidates.map(one => one.pid)).catch(() => new Map())
        for (const one of strandedProcesses(list, masks, cores, { chosen: found, roots: [...given.keys()] })) if (!given.has(one.pid)) given.set(one.pid, one)
      }
      stranded = [...given.values()].map(one => ({ pid: one.pid, key: keyOf(one), priority: 'Normal', affinity: affinityMask(cores, 'full'), eco: false }))
    }
    // The chats first: a pass cut short must not leave them starved.
    const sets = [...kept, ...changes, ...stranded]
    let done = []
    if (sets.length > 0) {
      try {
        done = await processes.set(sets)
      } catch {
        // Each process is tried once per level; the next level, or a new process, tries again. A chat's own process is tried each pass.
      }
    }
    if (stranded.length > 0) tell(`CPU for Claude: ${stranded.length} process${stranded.length === 1 ? '' : 'es'} Low left behind ${stranded.length === 1 ? 'is' : 'are'} back at Normal on all cores.`)
    const alive = new Set(list.map(keyOf))
    loose = new Set([...loose, ...(current === 'low' ? outside.map(one => one.key) : stranded.map(one => one.key))].filter(key => alive.has(key)))
    const living = new Set([...chosen, ...chats].map(one => one.key))
    applied = new Map([...applied].filter(([key]) => living.has(key)))
    for (const change of changes) applied.set(change.key, current)
    for (const change of kept) if (Array.isArray(done) && done.includes(change.pid)) applied.set(change.key, CHAT_KEPT)
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

  const view = () => ({ available, level: level ?? 'full', count, fault, cores, lowCores: lowCores(cores), since, who })

  return {
    available,
    apply,
    view,
    async set(value, by = null) {
      const next = parseLevel(value)
      if (next === null) return { ok: false, status: 400, why: 'The level is full or low.' }
      if (!available) return { ok: false, status: 409, why: 'Not available here: the board sets the CPU on Windows only.' }
      const before = await load()
      level = next
      since = now()
      who = typeof by === 'string' && by !== '' ? by : null
      if (next === 'low' && before !== 'low') lowSince = since
      if (next === 'full' && before !== 'full') {
        restore = RESTORE_PASSES
        isFreed = false
      }
      await saveLevel(file, next, since, who)
      await heard()
      await apply()
      return { ok: true, result: view() }
    },
    async ready() {
      await load()
    },
  }
}

/** S4: a chat's name or session as a call may carry it: printable, short. */
const CALLER = /^[\w .:()-]{1,80}$/

/**
 * S4 (F69's open part: who switched the level): the caller of a level change, from the call's headers and body. A chat's
 * name or session when the call carries one (the body's `chat` or `session`, or the X-Board-Chat or X-Board-Session
 * header), else "the board page" for a browser, else "a script" with its User-Agent.
 */
export function levelWho(headers = {}, body = {}) {
  const said = [body?.chat, headers['x-board-chat']].find(value => typeof value === 'string' && CALLER.test(value.trim()))
  if (said) return `chat ${said.trim()}`
  const session = [body?.session, headers['x-board-session']].find(value => typeof value === 'string' && SESSION.test(value.trim()))
  if (session) return `chat session ${session.trim()}`
  const agent = typeof headers['user-agent'] === 'string' ? headers['user-agent'].trim() : ''
  if (/^Mozilla\//.test(agent)) return 'the board page'
  return `a script (${agent === '' ? 'no User-Agent' : agent.slice(0, 40)})`
}
