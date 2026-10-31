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
  `Add-Type -TypeDefinition @'\n${READER}\n'@`,
  "$folder = ($env:BOARD_HOLDERS_OF -replace '/', '\\').TrimEnd('\\').ToLowerInvariant()",
  '$all = @(Get-CimInstance Win32_Process)',
  '$names = @{}; foreach ($p in $all) { $names[[int]$p.ProcessId] = $p.Name }',
  '$found = @()',
  "foreach ($p in $all) { if ([int]$p.ProcessId -eq $PID) { continue }; $c = [FolderHolders]::Cwd([int]$p.ProcessId); if ($c -eq $null) { continue }; $c = $c.TrimEnd('\\').ToLowerInvariant(); if ($c -eq $folder -or $c.StartsWith($folder + '\\')) { $found += [pscustomobject]@{ pid = [int]$p.ProcessId; name = $p.Name; parent = $names[[int]$p.ParentProcessId]; command = $p.CommandLine } } }",
  'ConvertTo-Json -Compress -InputObject @($found)',
].join("\n")

/** Runs the reader for `folder`; answers its output, or null when PowerShell failed or took longer than `timeoutMs`. */
function runReader(folder, timeoutMs) {
  return new Promise(resolve => {
    // The folder goes in by the environment and the script encoded, so no quoting can change either.
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    let child
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, BOARD_HOLDERS_OF: folder } })
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

/** The reader's JSON as holders `{ pid, name, parent, command }`; null when it is no list. */
export function parseHolders(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text ?? '').trim() === '' ? '[]' : text)
  } catch {
    return null
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.filter(one => one !== null && Number.isInteger(one.pid)).map(one => ({
    pid: one.pid,
    name: typeof one.name === 'string' ? one.name : '',
    parent: typeof one.parent === 'string' ? one.parent : null,
    command: typeof one.command === 'string' ? one.command : null,
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

/** A command on one line, cut at COMMAND_CHARS. */
const shortCommand = command => {
  const line = String(command ?? '').replace(/\s+/g, ' ').trim()
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
