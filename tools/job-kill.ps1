# F10 (2026-11-14), the proof's helper (test/startBoard.test.mjs): runs a program inside a Windows job with KILL_ON_JOB_CLOSE, as the
# Claude app runs its chats' shells, waits for the program's line that names the board's keeper ("process N"), then ends the WHOLE
# job (TerminateJobObject), as the app's self-update does. A keeper made by WMI is in no job and lives on; one spawned as a child
# of the program (the old route) is in the job and dies. Prints the program's line, then "terminated exited=<True|False>".
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/job-kill.ps1 -FileName <program> -Arguments "<its arguments>" [-TimeoutSeconds 60]
param(
  [Parameter(Mandatory = $true)][string]$FileName,
  [string]$Arguments = '',
  [int]$TimeoutSeconds = 60
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JobKill {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
  [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] public struct IO_COUNTERS {
    public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount;
    public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
  }
}
"@

$job = [JobKill]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) { throw 'CreateJobObject failed' }
$info = New-Object JobKill+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
$info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
$size = [System.Runtime.InteropServices.Marshal]::SizeOf([type][JobKill+JOBOBJECT_EXTENDED_LIMIT_INFORMATION])
if (-not [JobKill]::SetInformationJobObject($job, 9, [ref]$info, $size)) { throw 'SetInformationJobObject failed' }  # 9: JobObjectExtendedLimitInformation

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $FileName
$psi.Arguments = $Arguments
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::Start($psi)
# Into the job at once: node needs tens of milliseconds before it runs a line, so its children (start-board.mjs) inherit the job.
if (-not [JobKill]::AssignProcessToJobObject($job, $process.Handle)) { throw "AssignProcessToJobObject failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$process.StandardError.ReadToEndAsync() | Out-Null

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$line = $null
while ((Get-Date) -lt $deadline) {
  if ($process.StandardOutput.EndOfStream) { break }
  $read = $process.StandardOutput.ReadLine()
  if ($null -eq $read) { break }
  Write-Output $read
  if ($read -match 'process \d+' -or $read -match 'did not') { $line = $read; break }
}
if ($null -eq $line) { Write-Output 'no line'; }
# The whole job ends, as the app's update ends the app's job.
[void][JobKill]::TerminateJobObject($job, 1)
Start-Sleep -Milliseconds 1500
$exited = $process.HasExited
[void][JobKill]::CloseHandle($job)
Write-Output "terminated exited=$exited"
