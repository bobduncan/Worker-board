# F10 (2026-11-14): whether a process sits in a Windows job (kernel32 IsProcessInJob, no job handle: any job). The Claude app's
# update ends every process in the app's job; a board's keeper and child must answer False here.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/in-job.ps1 <pid> [<pid> ...]
#
# Prints one line per pid: "<pid> True", "<pid> False", or "<pid> gone" when no such process runs. Exits 0.
param([Parameter(ValueFromRemainingArguments = $true)][int[]]$Pids)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace WorkerBoard -Name Jobs -MemberDefinition '[DllImport("kernel32.dll", SetLastError = true)] public static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);'
foreach ($id in $Pids) {
  try {
    $process = Get-Process -Id $id -ErrorAction Stop
    $inJob = $false
    [void][WorkerBoard.Jobs]::IsProcessInJob($process.Handle, [IntPtr]::Zero, [ref]$inJob)
    Write-Output "$id $inJob"
  } catch {
    Write-Output "$id gone"
  }
}
