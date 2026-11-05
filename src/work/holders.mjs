// B844 (X114, 2026-10-31): the empty folder of B821's worktree stayed busy (EBUSY) from 10:04 past 10:21, through three
// reports and a restart of its chat, and the check said only "a program still uses it". What held it: the chat's own
// background commands. A Monitor ("sleep 1500; tail ...", "until grep ...; do sleep 20; done") or a background gate run
// starts in the chat's working folder, which was the worktree, and Windows keeps a program's working folder from being
// removed for as long as the program runs: past the step's end, and past a restart of the chat (it is not stopped with
// it). Reproduced on 2026-10-31 with a probe worktree: the folder went the moment that command was stopped.
//
// So the report check names the programs that stand in a folder it cannot remove: each one's name, process id, what
// started it and its command, so the worker (or the person) knows what to stop. A program's working folder is read from
// its process block (Windows keeps it there; no other tool lists it), only for the folder the check could not remove.
// Elsewhere than Windows, and when PowerShell does not answer, nothing is named (null): the line stays as it was.

import { spawn } from 'node:child_process'

/** Most programs named in one line; the rest are counted. */
export const NAMED_MAX = 3
/** Characters of a program's command kept in the line. */
export const COMMAND_CHARS = 80

/** What the reader's answer starts with: output without it (a reader that failed half-way) is not known. */
const MARK = 'HOLDERS '

// Reads each process's working folder (its PEB's ProcessParameters.CurrentDirectory, 64-bit offsets) and answers, as
// JSON, the processes whose working folder is the folder on standard input or inside it, with their parent's name.
const READER = `using System; using System.Runtime.InteropServices; using System.Text;
public static class FolderHolders {
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int c, byte[] info, int len, out int ret);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int a, bool i, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, int n, out IntPtr r);
  public static string Cwd(int pid) {
    IntPtr h = OpenProcess(0x0410, false, pid); if (h == IntPtr.Zero) return null;
    try {
      byte[] pbi = new byte[48]; int ret; IntPtr r;
      if (NtQueryInformationProcess(h, 0, pbi, 48, out ret) != 0) return null;
      byte[] b8 = new byte[8];
      if (!ReadProcessMemory(h, new IntPtr(BitConverter.ToInt64(pbi, 8) + 0x20), b8, 8, out r)) return null;
      byte[] us = new byte[16];
      if (!ReadProcessMemory(h, new IntPtr(BitConverter.ToInt64(b8, 0) + 0x38), us, 16, out r)) return null;
      byte[] s = new byte[BitConverter.ToUInt16(us, 0)];
      if (!ReadProcessMemory(h, new IntPtr(BitConverter.ToInt64(us, 8)), s, s.Length, out r)) return null;
      return Encoding.Unicode.GetString(s);
    } finally { CloseHandle(h); }
  }
}`
const SCRIPT = [
  "try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}",
  // A reader that fails says so (it ends with an error, and prints no MARK): never an empty list that reads as "none".
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  `Add-Type -TypeDefinition @'\n${READER}\n'@`,
  "$folder = ($env:BOARD_HOLDERS_OF -replace '/', '\\').TrimEnd('\\').ToLowerInvariant()",
  '$all = @(Get-CimInstance Win32_Process)',
  '$names = @{}; foreach ($p in $all) { $names[[int]$p.ProcessId] = $p.Name }',
  '$found = @()',
  "foreach ($p in $all) { if ([int]$p.ProcessId -eq $PID) { continue }; $c = [FolderHolders]::Cwd([int]$p.ProcessId); if ($c -eq $null) { continue }; $c = $c.TrimEnd('\\').ToLowerInvariant(); if ($c -eq $folder -or $c.StartsWith($folder + '\\')) { $found += [pscustomobject]@{ pid = [int]$p.ProcessId; name = $p.Name; parent = $names[[int]$p.ParentProcessId]; command = $p.CommandLine } } }",
  `'${MARK}' + (ConvertTo-Json -Compress -InputObject @($found))`,
].join("\n")

/** Runs `script` (PowerShell) with `env` added; answers its output, or null when PowerShell failed or took longer than `timeoutMs`. */
function runScript(script, env, timeoutMs) {
  return new Promise(resolve => {
    // What the script reads goes in by the environment and the script encoded, so no quoting can change either.
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    let child
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...env } })
    } catch {
      resolve(null)
      return
    }
    let out = ''
    const timer = setTimeout(() => { child.kill(); resolve(null) }, timeoutMs)
    child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk })
    child.on('error', () => { clearTimeout(timer); resolve(null) })
    child.on('close', code => { clearTimeout(timer); resolve(code === 0 ? out : null) })
  })
}

/** Runs the folder reader for `folder`. */
const runReader = (folder, timeoutMs) => runScript(SCRIPT, { BOARD_HOLDERS_OF: folder }, timeoutMs)

/** The reader's answer (MARK, then its JSON) as holders `{ pid, name, parent, command }`; null when it is none. */
export function parseHolders(text) {
  const line = String(text ?? '').split('\n').map(one => one.trim()).find(one => one.startsWith(MARK))
  if (line === undefined) return null
  let parsed
  try {
    parsed = JSON.parse(line.slice(MARK.length))
  } catch {
    return null
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.filter(one => one !== null && Number.isInteger(one.pid)).map(one => ({
    pid: one.pid,
    name: typeof one.name === 'string' ? one.name : '',
    parent: typeof one.parent === 'string' ? one.parent : null,
    command: typeof one.command === 'string' ? one.command : null,
    // B1049: when the program started (ms), from Restart Manager's lookup of a file; the folder reader gives none.
    ...(Number.isFinite(one.since) ? { since: one.since } : {}),
  }))
}

/**
 * The programs whose working folder is `folder` or inside it: `[{ pid, name, parent, command }]`, an empty list when
 * none is, or null when that is not known (not Windows, or PowerShell did not answer).
 */
export async function folderHolders(folder, { platform = process.platform, timeoutMs = 20_000, run = runReader } = {}) {
  if (platform !== 'win32') return null
  const out = await run(String(folder), timeoutMs)
  return out === null ? null : parseHolders(out)
}

/**
 * A command on one line, cut at COMMAND_CHARS. A chat's own shell command is wrapped by Claude Code ("bash -c \"source
 * <snapshot> ... eval '<the command>' && pwd -P ...\""): its own command is what is shown.
 */
const shortCommand = command => {
  const wrapped = /\beval '([\s\S]*?)' && pwd -P/.exec(String(command ?? ''))
  const line = String(wrapped === null ? command ?? '' : wrapped[1]).replace(/\s+/g, ' ').trim()
  return line.length > COMMAND_CHARS ? `${line.slice(0, COMMAND_CHARS - 1)}…` : line
}

/**
 * What the report check's line says of the programs that hold a folder, after "a program still uses it": the programs
 * that stand in it (name, process id, what started it, its command) and to stop them; that none stands in it; or '' when
 * that is not known (`list` null).
 */
export function holderWords(list) {
  if (!Array.isArray(list)) return ''
  if (list.length === 0) return ' (no program stands in it as its working folder: one may hold a file of it open)'
  const named = list.slice(0, NAMED_MAX).map(one => `${one.name} ${one.pid}${one.parent ? ` from ${one.parent}` : ''}${one.command ? `: ${shortCommand(one.command)}` : ''}`)
  const more = list.length > NAMED_MAX ? `; and ${list.length - NAMED_MAX} more` : ''
  return ` (${named.join('; ')}${more}): stop ${list.length === 1 ? 'it' : 'them'} (a chat's background command or monitor: TaskStop)`
}

// B1049 (2026-11-04 22:26: the measure loop failed every few minutes with EPERM renaming onto data/spending.json, held by
// an orphaned grep.exe): the programs that hold a FILE open, from Windows' Restart Manager (RmStartSession,
// RmRegisterResources, RmGetList, RmEndSession). Read-only: it ends nothing and asks nothing of the program.
const FILE_READER = `using System; using System.Runtime.InteropServices; using System.Text;
public static class FileHolders {
  [StructLayout(LayoutKind.Sequential)] struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
    public int ApplicationType; public uint AppStatus; public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint h, int flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint nFiles, string[] files, uint nApps, RM_UNIQUE_PROCESS[] apps, uint nSvc, string[] svc);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint needed, ref uint count, [In, Out] RM_PROCESS_INFO[] info, out uint reasons);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
  // One line per holder: pid, start time (ms since 1970, UTC), the program's own name.
  public static string[] Of(string[] files) {
    uint h; StringBuilder key = new StringBuilder(33);
    if (RmStartSession(out h, 0, key) != 0) throw new Exception("RmStartSession failed");
    try {
      if (RmRegisterResources(h, (uint)files.Length, files, 0, null, 0, null) != 0) throw new Exception("RmRegisterResources failed");
      uint needed = 0, count = 0, reasons; RM_PROCESS_INFO[] info = new RM_PROCESS_INFO[0];
      int r = RmGetList(h, out needed, ref count, info, out reasons);
      if (r == 234) { info = new RM_PROCESS_INFO[needed + 4]; count = (uint)info.Length; r = RmGetList(h, out needed, ref count, info, out reasons); }
      if (r != 0) throw new Exception("RmGetList failed " + r);
      string[] lines = new string[count];
      for (int i = 0; i < count; i++) {
        long ft = ((long)info[i].Process.ProcessStartTime.dwHighDateTime << 32) | (uint)info[i].Process.ProcessStartTime.dwLowDateTime;
        long ms = ft == 0 ? 0 : (long)((DateTime.FromFileTimeUtc(ft) - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds);
        lines[i] = info[i].Process.dwProcessId + "|" + ms + "|" + info[i].strAppName;
      }
      return lines;
    } finally { RmEndSession(h); }
  }
}`
const FILE_SCRIPT = [
  "try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}",
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  `Add-Type -TypeDefinition @'\n${FILE_READER}\n'@`,
  // The files come in by the environment, one per line (a path holds no line break).
  "$files = [string[]]@(($env:BOARD_HOLDERS_OF_FILES -split \"`n\") | Where-Object { $_ -ne '' })",
  '$found = @()',
  "foreach ($line in [FileHolders]::Of($files)) { $part = $line.Split('|', 3); $id = [int]$part[0]; $p = Get-Process -Id $id -ErrorAction SilentlyContinue; $name = if ($p) { $p.ProcessName + '.exe' } else { $part[2] }; $since = [double]$part[1]; $found += [pscustomobject]@{ pid = $id; name = $name; since = $(if ($since -gt 0) { $since } else { $null }) } }",
  `'${MARK}' + (ConvertTo-Json -Compress -InputObject @($found))`,
].join('\n')

/**
 * The programs that hold any of the `files` open: `[{ pid, name, since? }]`, an empty list when none does, or null when
 * that is not known (not Windows, nothing to look for, or PowerShell did not answer). Read-only.
 */
export async function fileHolders(files, { platform = process.platform, timeoutMs = 20_000, run = (list, ms) => runScript(FILE_SCRIPT, { BOARD_HOLDERS_OF_FILES: list.join('\n') }, ms) } = {}) {
  const list = (Array.isArray(files) ? files : []).map(String).filter(file => file !== '' && !/[\r\n]/.test(file))
  if (platform !== 'win32' || list.length === 0) return null
  const out = await run(list, timeoutMs)
  return out === null ? null : parseHolders(out)
}

/**
 * B1049: the failing-loop line's words for the programs that hold a file, "held by grep.exe, pid 57736, since 19:52": at
 * most NAMED_MAX named, the rest counted; '' when none is known. `clockOf` writes a time.
 */
export function holderLine(list, clockOf) {
  if (!Array.isArray(list) || list.length === 0) return ''
  const named = list.slice(0, NAMED_MAX).map(one => `${one.name || 'a program'}, pid ${one.pid}${Number.isFinite(one.since) ? `, since ${clockOf(one.since)}` : ''}`)
  return `held by ${named.join('; ')}${list.length > NAMED_MAX ? `; and ${list.length - NAMED_MAX} more` : ''}`
}
