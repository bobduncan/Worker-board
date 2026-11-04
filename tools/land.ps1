# land.ps1 <branch> [-Cold] [-By "<chat>"]   (2026-11-04: the one safe, logged way a change of the worker board goes live)
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Web/lava-tactics-project/worker-board/tools/land.ps1" <branch> [-Cold] [-By "<chat>"]
#
# What it does, in order (DESIGN.md, "Going live: tools/land.ps1"):
#  1. Refuses, with one line "refused: <why>" and a line in data/landings.jsonl, before anything changes: the main checkout is
#     not clean, the branch does not contain main, there is nothing to land, the trial copy cannot fast-forward, the gate fails
#     on the branch's exact head, a debugger is attached to a board.
#  2. The gate: `npm test` (and, when the branch touches mods/workers/, `claude.exe plugin test .`) on the exact head in a
#     temporary worktree with a junction to the main checkout's node_modules; the run's own summary line must say fail 0.
#     The output goes to data/landings/<time>-<branch>.log. The gate runs BEFORE the lock (it takes about ten minutes).
#  3. One landing at a time: data/landing.lock; a lock older than 15 minutes is a crashed landing's and is broken.
#  4. Under the lock, once more: the branch still contains main and its head is the gated one, the checkout is clean, no
#     debugger is attached. Then main is fast-forwarded to the gated head, pushed (never forced) and the trial copy is
#     fast-forwarded from its `local` remote.
#  5. Both boards restart: warm (the default: POST /api/restart, the keeper starts the new code with the same page token) or
#     -Cold (new keepers first, then each old keeper before its child). A board that does not answer is started with
#     `node start-board.mjs`. Success = every board answers /api/state with version.commit equal to its folder's head within
#     90 s.
#  6. Otherwise it rolls back: ONE revert commit on main whose tree is the old head's (never a reset: the remote keeps its
#     history), pushed, the trial copy and both boards on it. Exit 2 "rolled back: <why>"; exit 3 when even that failed, with
#     the state of main, the remote and each board.
#  Exit 0 only for `landed`. Exit 1 refused, 2 rolled back, 3 rollback failed. Every run adds one line to data/landings.jsonl.
#
# -Config <json file> is for tests only: { main, boards: [{ dir, port }], remote, trialRemote, gateBoard, gateMod, claudeExe,
# dataDir, tempRoot, nodeModules, comeBackSeconds, pollMs, gateMinutes, lockStaleMinutes, processesFile, connectionsFile }.
# Without it the defaults are the PC's real boards (the main checkout on 4310, the trial copy on 4314).
#
# This file is plain ASCII: Windows PowerShell 5.1 reads a script without a byte-order mark in the console's code page.
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Branch,
  [switch]$Cold,
  [string]$By = 'unknown',
  [string]$Config = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# ---- settings ---------------------------------------------------------------------------------------------------------
$cfg = $null
if ($Config -ne '') { $cfg = (Get-Content -Raw -LiteralPath $Config) | ConvertFrom-Json }
function Get-Setting([string]$Name, $Default) {
  if ($null -ne $cfg) {
    $found = $cfg.PSObject.Properties[$Name]
    if ($null -ne $found -and $null -ne $found.Value -and "$($found.Value)" -ne '') { return $found.Value }
  }
  return $Default
}
function Get-Full([string]$Path) { return [System.IO.Path]::GetFullPath($Path).TrimEnd('\') }

$mainDir = Get-Full (Get-Setting 'main' 'C:\Web\lava-tactics-project\worker-board')
$boards = @()
if ($null -ne $cfg -and $null -ne $cfg.PSObject.Properties['boards']) {
  foreach ($one in @($cfg.boards)) { $boards += @{ dir = (Get-Full $one.dir); port = [int]$one.port } }
} else {
  $boards = @(@{ dir = $mainDir; port = 4310 }, @{ dir = (Get-Full 'C:\Web\board-trial\worker-board'); port = 4314 })
}
$remote = [string](Get-Setting 'remote' 'origin')
$trialRemote = [string](Get-Setting 'trialRemote' 'local')
$gateBoardCommand = [string](Get-Setting 'gateBoard' 'npm test')
$gateModCommand = [string](Get-Setting 'gateMod' '')
$claudeExeSetting = [string](Get-Setting 'claudeExe' '')
$dataDir = Get-Full (Get-Setting 'dataDir' (Join-Path $mainDir 'data'))
$tempRoot = Get-Full (Get-Setting 'tempRoot' $env:TEMP)
$nodeModules = Get-Full (Get-Setting 'nodeModules' (Join-Path $mainDir 'node_modules'))
$comeBackSeconds = [int](Get-Setting 'comeBackSeconds' 90)
$pollMs = [int](Get-Setting 'pollMs' 2000)
$gateMinutes = [int](Get-Setting 'gateMinutes' 60)
$lockStaleMinutes = [int](Get-Setting 'lockStaleMinutes' 15)
$processesFile = [string](Get-Setting 'processesFile' '')
$connectionsFile = [string](Get-Setting 'connectionsFile' '')
$lockFile = Join-Path $dataDir 'landing.lock'
$landingsLog = Join-Path $dataDir 'landings.jsonl'
$landingsDir = Join-Path $dataDir 'landings'
$KNOWN_CLAUDE = 'C:\Users\bobdu\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\claude-code\2.1.309\9078b9c1d466\claude.exe'

# State of this run, read by the log line at the end.
$script:refused = $false
$script:result = 'refused'
$script:why = $null
$script:exitCode = 1
$script:headFull = $null
$script:beforeFull = $null
$script:afterFull = $null
$script:trialFull = $null
$script:boardsAfter = @()
$script:gateLog = $null
$script:notes = @()
$script:lockToken = $null
$script:work = $null
$script:snapshot = $null
$script:landed = $false

function Say([string]$Text) { [Console]::Out.WriteLine($Text) }
function Short([string]$Sha) { if ($null -eq $Sha -or $Sha.Length -le 7) { return $Sha } else { return $Sha.Substring(0, 7) } }
function Refuse([string]$Why) {
  $script:refused = $true
  $script:why = $Why
  throw 'land-refused'
}

# A script that came from the checkout this run moves must not change under it: the two helpers are copied aside first.
Remove-Item Env:\WORKER_BOARD_CHILD -ErrorAction SilentlyContinue
Remove-Item Env:\WORKER_BOARD_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\WORKER_BOARD_TOKEN -ErrorAction SilentlyContinue

# ---- running programs (a .NET process: stdout, stderr and the exit code each on their own, whatever PowerShell 5.1 does) ----
function ConvertTo-Arg([string]$Arg) {
  if ($Arg -eq '') { return '""' }
  if ($Arg -notmatch '[\s"]') { return $Arg }
  $quoted = $Arg -replace '(\\*)"', '$1$1\"'
  $quoted = $quoted -replace '(\\+)$', '$1$1'
  return '"' + $quoted + '"'
}

function Invoke-Native([string]$File, [string[]]$ArgList, [string]$WorkDir = '', [int]$TimeoutSec = 600, [string]$RawArgs = '') {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $File
  if ($RawArgs -ne '') { $psi.Arguments = $RawArgs } else { $psi.Arguments = (@($ArgList | ForEach-Object { ConvertTo-Arg $_ })) -join ' ' }
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  if ($WorkDir -ne '') { $psi.WorkingDirectory = $WorkDir }
  $process = [System.Diagnostics.Process]::Start($psi)
  $process.StandardInput.Close()
  $out = $process.StandardOutput.ReadToEndAsync()
  $err = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($TimeoutSec * 1000)) {
    & taskkill /PID $process.Id /T /F | Out-Null
    return @{ code = -1; out = ''; err = "timed out after $TimeoutSec s" }
  }
  $process.WaitForExit()
  return @{ code = $process.ExitCode; out = ([string]$out.Result).TrimEnd(); err = ([string]$err.Result).TrimEnd() }
}

function Invoke-Git([string]$Dir, [string[]]$GitArgs) { return (Invoke-Native 'git' (@('-C', $Dir) + $GitArgs) '' 300) }
function Git-Line($Result) { if ($Result.err -ne '') { return (($Result.err -split "`n")[0]).Trim() } else { return (($Result.out -split "`n")[0]).Trim() } }

# ---- the helpers (src/landing.mjs through tools/landing.mjs) -----------------------------------------------------------
$node = $null
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -ne $nodeCommand) { $node = $nodeCommand.Source }

function Write-Utf8([string]$Path, [string]$Text) { [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false)) }

function Invoke-Landing([string[]]$LandingArgs) {
  $run = Invoke-Native $node (@((Join-Path $script:work 'tools\landing.mjs')) + $LandingArgs) '' 120
  $json = $null
  if ($run.out -ne '') { try { $json = $run.out | ConvertFrom-Json } catch { $json = $null } }
  return @{ code = $run.code; json = $json; err = $run.err; out = $run.out }
}

# ---- boards -----------------------------------------------------------------------------------------------------------
function Get-BoardVersion([int]$Port) {
  try {
    $page = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/" -TimeoutSec 5).Content
    $token = [regex]::Match($page, 'name="board-token" content="([^"]+)"').Groups[1].Value
    $state = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/state" -Headers @{ 'X-Board-Token' = $token } -TimeoutSec 10
    return @{ token = $token; commit = [string]$state.version.commit; since = $state.version.since }
  } catch { return $null }
}

# Short or full, compared by prefix; a commit of fewer than 7 characters is no answer.
function Test-Commit([string]$Reported, [string]$Full) {
  if ([string]::IsNullOrEmpty($Reported) -or [string]::IsNullOrEmpty($Full) -or $Reported.Length -lt 7) { return $false }
  return ($Full.StartsWith($Reported) -or $Reported.StartsWith($Full))
}

function Wait-BoardCommit($Board, [string]$Want) {
  $deadline = (Get-Date).AddSeconds($comeBackSeconds)
  while ($true) {
    $version = Get-BoardVersion $Board.port
    if ($null -ne $version -and (Test-Commit $version.commit $Want)) { return $version }
    if ((Get-Date) -ge $deadline) { return $null }
    Start-Sleep -Milliseconds $pollMs
  }
}

# The commit a board's own folder is on: what its restart must show.
function Get-FolderHead($Board) {
  $run = Invoke-Git $Board.dir @('rev-parse', 'HEAD')
  if ($run.code -ne 0) { return $null }
  return $run.out
}

# Warm: the board is asked to restart itself (its keeper starts the new code with the same page token). Gives back $null when
# the board answers with its folder's head within the time, else why not.
function Restart-BoardWarm($Board, [string]$Want) {
  $was = Get-BoardVersion $Board.port
  if ($null -eq $was) {
    # The lead's rule: a board is started with start-board.mjs, never with a bare `node server.mjs`.
    Say "note: the board on $($Board.port) does not answer: starting it with node start-board.mjs"
    $started = Invoke-Native $node @('start-board.mjs', '--quiet') $Board.dir 90
    if ($started.code -ne 0) { return "$($Board.port) did not start: $(Git-Line $started)" }
  } elseif (Test-Commit $was.commit $Want) {
    Say "note: the board on $($Board.port) runs $(Short $Want) already (it restarted itself)"
  } else {
    try {
      Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($Board.port)/api/restart" -Headers @{ 'X-Board-Token' = $was.token; 'Origin' = "http://127.0.0.1:$($Board.port)" } -ContentType 'application/json' -Body '{}' -TimeoutSec 15 | Out-Null
    } catch {
      $said = $_.Exception.Message
      if ($null -ne $_.ErrorDetails -and $_.ErrorDetails.Message) { $said = $_.ErrorDetails.Message }
      # A board that was started without its keeper cannot restart itself, and will not tomorrow either.
      if ($said -match 'without its keeper') { return "$($Board.port) did not come back with $(Short $Want): restart refused ($said); a board without its keeper needs -Cold" }
      Say "note: the restart of the board on $($Board.port) was refused ($said): waiting for it to come back anyway"
    }
  }
  if ($null -eq (Wait-BoardCommit $Board $Want)) { return "$($Board.port) did not come back with $(Short $Want) within $comeBackSeconds s" }
  return $null
}

# Cold: the new keepers first (the landed holdPort retries the bind), then each old keeper BEFORE its child (a keeper starts a
# crashed child again). start-board.mjs would only say "runs already" while the old board answers, so the keeper is started the
# way start-board.mjs does it (the env without the keeper's own words, src/keeper.mjs startEnv; they were removed from this
# process at its start): `node server.mjs`, its words appended to data\board.log.
function Restart-BoardsCold([object[]]$Old) {
  foreach ($board in $boards) {
    $logDir = Join-Path $board.dir 'data'
    if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'node server.mjs >> data\board.log 2>&1' -WorkingDirectory $board.dir -WindowStyle Hidden
  }
  Start-Sleep -Milliseconds 1500
  foreach ($one in @($Old | Where-Object { $_.role -eq 'keeper' })) { Stop-Process -Id $one.pid -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  foreach ($one in @($Old | Where-Object { $_.role -eq 'child' })) { Stop-Process -Id $one.pid -Force -ErrorAction SilentlyContinue }
}

# ---- git, the debugger check, the trial copy --------------------------------------------------------------------------
function Test-Clean([string]$Dir, [string]$What) {
  $status = Invoke-Git $Dir @('status', '--short')
  if ($status.code -ne 0) { Refuse "$What is not a git checkout: $(Git-Line $status)" }
  $dirty = @($status.out -split "`n" | Where-Object { $_.Trim() -ne '' -and $_ -notmatch '^\?\? \.claude/' })
  if ($dirty.Count -gt 0) { Refuse "$What is not clean: $((($dirty | Select-Object -First 3) -join '; ').Trim())" }
}

function Get-TrialBoards { return @($boards | Where-Object { $_.dir -ne $mainDir }) }

# The trial copies must be able to fast-forward, checked before anything changes (the push cannot be taken back).
function Test-Trials([string]$Head) {
  foreach ($trial in Get-TrialBoards) {
    $dir = $trial.dir
    $branch = Invoke-Git $dir @('branch', '--show-current')
    if ($branch.code -ne 0) { Refuse "the trial copy $dir is not a git checkout: $(Git-Line $branch)" }
    if ($branch.out -ne 'main') { Refuse "the trial copy $dir is on '$($branch.out)', not main" }
    Test-Clean $dir "the trial copy $dir"
    $url = Invoke-Git $dir @('remote', 'get-url', $trialRemote)
    if ($url.code -ne 0) { Refuse "the trial copy $dir has no remote '$trialRemote'" }
    $there = Invoke-Git $dir @('rev-parse', 'HEAD')
    $known = Invoke-Git $mainDir @('merge-base', '--is-ancestor', $there.out, $Head)
    if ($known.code -ne 0) { Refuse "the trial copy $dir is at $(Short $there.out), which main with this branch does not contain: it cannot fast-forward" }
  }
}

function Save-Snapshot {
  $boardsFile = Join-Path $script:work 'boards.json'
  $list = @($boards | ForEach-Object { [pscustomobject]@{ dir = $_.dir; port = $_.port } })
  Write-Utf8 $boardsFile (ConvertTo-Json -InputObject $list -Compress)
  $processes = $processesFile
  $connections = $connectionsFile
  if ($processes -eq '') {
    $processes = Join-Path $script:work 'processes.json'
    $rows = @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name; commandLine = [string]$_.CommandLine } })
    Write-Utf8 $processes (ConvertTo-Json -InputObject $rows -Compress -Depth 3)
  }
  if ($connections -eq '') {
    $connections = Join-Path $script:work 'connections.json'
    $rows = @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { "$($_.State)" -eq 'Listen' -or "$($_.State)" -eq 'Established' } | ForEach-Object {
      [pscustomobject]@{ state = "$($_.State)"; localAddress = [string]$_.LocalAddress; localPort = [int]$_.LocalPort; remoteAddress = [string]$_.RemoteAddress; remotePort = [int]$_.RemotePort; pid = [int]$_.OwningProcess }
    })
    Write-Utf8 $connections (ConvertTo-Json -InputObject $rows -Compress -Depth 3)
  }
  return @('--boards', $boardsFile, '--processes', $processes, '--connections', $connections)
}

# What src/landing.mjs makes of the PC's processes and connections: the boards' processes, a debugger's verdict.
function Get-Inspection {
  try {
    $arguments = @('inspect') + (Save-Snapshot)
  } catch { Refuse "the check for a debugger could not run: $($_.Exception.Message)" }
  $run = Invoke-Landing $arguments
  if ($null -eq $run.json) { Refuse "the check for a debugger gave no answer: $($run.err) $($run.out)" }
  return $run.json
}

# Refuses while a debugger is attached to a board's keeper or child (a held process makes the restart hang), notes a listening
# inspector nobody is connected to. Keeps the board processes it found (the cold restart stops them).
function Test-Debugger {
  $inspection = Get-Inspection
  foreach ($note in @($inspection.notes)) { Say "note: $note" }
  if ($inspection.verdict -eq 'refuse') { Refuse $inspection.refusal }
  $script:snapshot = @($inspection.processes)
}

# The preconditions that hold before the gate and again under the lock (`$AfterGate`: the words for what moved meanwhile).
function Test-Ready([bool]$AfterGate) {
  $current = Invoke-Git $mainDir @('branch', '--show-current')
  if ($current.code -ne 0) { Refuse "the main checkout $mainDir is not a git checkout: $(Git-Line $current)" }
  if ($current.out -ne 'main') { Refuse "the main checkout is on '$($current.out)', not main" }
  Test-Clean $mainDir 'the main checkout'
  $head = Invoke-Git $mainDir @('rev-parse', '--verify', '--quiet', "refs/heads/$Branch^{commit}")
  if ($head.code -ne 0) { Refuse "there is no branch $Branch in the main checkout" }
  if ($AfterGate -and $head.out -ne $script:headFull) { Refuse "$Branch moved during the gate (from $(Short $script:headFull) to $(Short $head.out)): land again" }
  $script:headFull = $head.out
  $before = Invoke-Git $mainDir @('rev-parse', '--verify', 'refs/heads/main')
  $script:beforeFull = $before.out
  $contains = Invoke-Git $mainDir @('merge-base', '--is-ancestor', 'refs/heads/main', $script:headFull)
  if ($contains.code -eq 1) {
    if ($AfterGate) { Refuse 'main moved during the gate: merge and land again' }
    Refuse "merge main into $Branch first"
  }
  if ($contains.code -ne 0) { Refuse "main could not be compared with ${Branch}: $(Git-Line $contains)" }
  if ($script:headFull -eq $script:beforeFull) { Refuse "nothing to land: $Branch is at main's head ($(Short $script:headFull)) already" }
  Test-Trials $script:headFull
}

# ---- the gate ---------------------------------------------------------------------------------------------------------
function Find-ClaudeExe {
  if ($claudeExeSetting -ne '') { return $claudeExeSetting }
  if (Test-Path -LiteralPath $KNOWN_CLAUDE) { return $KNOWN_CLAUDE }
  $paths = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'claude*' -and $_.ExecutablePath } | ForEach-Object { $_.ExecutablePath })
  foreach ($path in @($paths | Where-Object { $_ -match 'claude-code' }) + $paths) { if (Test-Path -LiteralPath $path) { return $path } }
  return $null
}

# Runs a gate command through cmd with its words appended to a file as they are (a UTF-8 summary line must not pass through the
# console's code page), within the time; gives back the exit code.
function Invoke-GateCommand([string]$Command, [string]$WorkDir, [string]$Output) {
  $line = "/s /c `"$Command >> `"$Output`" 2>&1`""
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = $line
  $psi.WorkingDirectory = $WorkDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $process = [System.Diagnostics.Process]::Start($psi)
  $process.StandardInput.Close()
  if (-not $process.WaitForExit($gateMinutes * 60 * 1000)) {
    & taskkill /PID $process.Id /T /F | Out-Null
    [System.IO.File]::AppendAllText($Output, "`r`nthe gate command ran longer than $gateMinutes minutes and was stopped`r`n")
    return -1
  }
  $process.WaitForExit()
  return $process.ExitCode
}

function Add-FileBytes([string]$To, [string]$From) {
  $bytes = [System.IO.File]::ReadAllBytes($From)
  $stream = [System.IO.File]::Open($To, [System.IO.FileMode]::Append)
  try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
}

function Invoke-Gate {
  New-Item -ItemType Directory -Force -Path $landingsDir | Out-Null
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $safe = $Branch -replace '[^A-Za-z0-9._-]', '-'
  $script:gateLog = Join-Path $landingsDir "$stamp-$safe.log"
  $temp = Join-Path $tempRoot ('land-gate-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  Write-Utf8 $script:gateLog "landing of $Branch ($($script:headFull)) by $By at $((Get-Date).ToString('s'))`r`ngate worktree: $temp`r`n"
  $added = $false
  $linked = $false
  try {
    if (-not (Test-Path -LiteralPath $nodeModules)) { Refuse "the gate cannot start: $nodeModules is not there to link (see $($script:gateLog))" }
    $add = Invoke-Git $mainDir @('worktree', 'add', '--detach', $temp, $script:headFull)
    if ($add.code -ne 0) {
      [System.IO.File]::AppendAllText($script:gateLog, "git worktree add failed: $($add.err)`r`n")
      Refuse "the gate cannot start: git worktree add failed: $(Git-Line $add) (see $($script:gateLog))"
    }
    $added = $true
    $link = Invoke-Native 'cmd.exe' @() '' 60 "/c mklink /J `"$temp\node_modules`" `"$nodeModules`""
    if ($link.code -ne 0) {
      [System.IO.File]::AppendAllText($script:gateLog, "mklink failed: $($link.out) $($link.err)`r`n")
      Refuse "the gate cannot start: the node_modules junction failed: $(Git-Line $link) (see $($script:gateLog))"
    }
    $linked = $true
    # The board's own tests.
    [System.IO.File]::AppendAllText($script:gateLog, "gate: $gateBoardCommand`r`n")
    $code = Invoke-GateCommand $gateBoardCommand $temp $script:gateLog
    $checked = Invoke-Landing @('gate-check', '--kind', 'board', '--file', $script:gateLog, '--exit', "$code")
    if ($null -eq $checked.json) { Refuse "the gate's result could not be read: $($checked.err) (see $($script:gateLog))" }
    if (-not $checked.json.ok) { Refuse "the gate failed on $(Short $script:headFull): $($checked.json.why) (see $($script:gateLog))" }
    # The mod's, only when the branch changes it.
    $changed = Invoke-Git $mainDir @('diff', '--name-only', $script:beforeFull, $script:headFull)
    if (@($changed.out -split "`n" | Where-Object { $_ -match '^mods/workers/' }).Count -gt 0) {
      $claude = Find-ClaudeExe
      $command = $gateModCommand
      if ($command -eq '') {
        if ($null -eq $claude) { Refuse "the mod gate cannot run: no claude.exe was found (see $($script:gateLog))" }
        $command = "`"$claude`" plugin test ."
      }
      $modLog = "$($script:gateLog).mod"
      [System.IO.File]::AppendAllText($script:gateLog, "`r`n===== mod gate: $command =====`r`n")
      $modCode = Invoke-GateCommand $command (Join-Path $temp 'mods\workers') $modLog
      if (Test-Path -LiteralPath $modLog) { Add-FileBytes $script:gateLog $modLog }
      $modChecked = Invoke-Landing @('gate-check', '--kind', 'mod', '--file', $modLog, '--exit', "$modCode")
      Remove-Item -LiteralPath $modLog -ErrorAction SilentlyContinue
      if ($null -eq $modChecked.json) { Refuse "the mod gate's result could not be read: $($modChecked.err) (see $($script:gateLog))" }
      if (-not $modChecked.json.ok) { Refuse "the mod gate failed on $(Short $script:headFull): $($modChecked.json.why) (see $($script:gateLog))" }
    }
  } finally {
    # The junction FIRST, with rmdir: never a recursive delete through it (it points at the main checkout's node_modules).
    if ($linked) {
      $gone = Invoke-Native 'cmd.exe' @() '' 60 "/c rmdir `"$temp\node_modules`""
      if (Test-Path -LiteralPath "$temp\node_modules") { Say "note: the junction $temp\node_modules could not be removed ($($gone.err)): remove it with cmd /c rmdir, never a recursive delete" }
    }
    if ($added -and -not (Test-Path -LiteralPath "$temp\node_modules")) {
      $removed = Invoke-Git $mainDir @('worktree', 'remove', $temp)
      if ($removed.code -ne 0) { Say "note: the gate worktree $temp was left ($(Git-Line $removed)): remove it by hand once you looked, never with the force flag" }
      Invoke-Git $mainDir @('worktree', 'prune') | Out-Null
    }
  }
}

# ---- landing, restarting, rolling back --------------------------------------------------------------------------------
function Update-Trial($Trial) {
  $fetch = Invoke-Git $Trial.dir @('fetch', '-q', $trialRemote, 'main')
  if ($fetch.code -ne 0) { return "fetch from '$trialRemote' failed in $($Trial.dir): $(Git-Line $fetch)" }
  $merge = Invoke-Git $Trial.dir @('merge', '--ff-only', 'FETCH_HEAD')
  if ($merge.code -ne 0) { return "fast-forward refused in $($Trial.dir): $(Git-Line $merge)" }
  return $null
}

# Restarts every board and checks each answers with its own folder's head; $null when all do, else the first why.
function Restart-AllBoards([object[]]$Old) {
  if ($Cold) { Restart-BoardsCold $Old }
  foreach ($board in $boards) {
    $want = Get-FolderHead $board
    if ($null -eq $want) { return "$($board.port): the folder $($board.dir) has no head" }
    if ($Cold) {
      if ($null -eq (Wait-BoardCommit $board $want)) { return "$($board.port) did not come back with $(Short $want) within $comeBackSeconds s" }
    } else {
      $failed = Restart-BoardWarm $board $want
      if ($null -ne $failed) { return $failed }
    }
  }
  return $null
}

function Read-Boards {
  $found = @()
  foreach ($board in $boards) {
    $version = Get-BoardVersion $board.port
    if ($null -eq $version) { $found += @{ port = $board.port; commit = $null; since = $null } } else { $found += @{ port = $board.port; commit = $version.commit; since = $version.since } }
  }
  return $found
}

# One revert commit on main whose tree is the old head's: the remote keeps its history (no force, no reset), and the boards
# restart on it. Gives back $null when all of it worked, else what failed.
function Invoke-Rollback([string]$Why) {
  Say "rolling back: $Why"
  $label = 'revert commit'
  $revert = $null
  try {
    $message = "Revert the landing of $Branch ($(Short $script:beforeFull)..$(Short $script:afterFull)): $Why"
    $made = Invoke-Git $mainDir @('commit-tree', "$($script:beforeFull)^{tree}", '-p', $script:afterFull, '-m', $message)
    if ($made.code -ne 0) { return "the revert commit could not be made: $(Git-Line $made)" }
    $revert = $made.out
    $label = 'fast-forward of main to the revert'
    $moved = Invoke-Git $mainDir @('merge', '--ff-only', $revert)
    if ($moved.code -ne 0) { return "main could not move to the revert $(Short $revert): $(Git-Line $moved)" }
    $label = 'push of the revert'
    $pushed = Invoke-Git $mainDir @('push', $remote, 'main')
    if ($pushed.code -ne 0) { return "the revert $(Short $revert) is on main here but the push to $remote failed: $(Git-Line $pushed)" }
    foreach ($trial in Get-TrialBoards) {
      $failed = Update-Trial $trial
      if ($null -ne $failed) { return "the trial copy could not take the revert: $failed" }
    }
    $label = 'restart on the revert'
    # A cold restart stops the processes that run now, not the ones from before the landing.
    if ($Cold) { $script:snapshot = @((Get-Inspection).processes) }
    $failed = Restart-AllBoards @($script:snapshot)
    if ($null -ne $failed) { return "the boards did not come back on the revert $(Short $revert): $failed" }
    return $null
  } catch {
    return "the rollback stopped at the $label`: $($_.Exception.Message)"
  }
}

function Get-State-Lines {
  $lines = @()
  $head = Invoke-Git $mainDir @('rev-parse', 'HEAD')
  $lines += "state: main (local) is at $(Short $head.out); it held $(Short $script:beforeFull) before and $(Short $script:afterFull) after the landing"
  $ls = Invoke-Git $mainDir @('ls-remote', $remote, 'refs/heads/main')
  if ($ls.code -eq 0 -and $ls.out -ne '') { $lines += "state: $remote/main is at $(Short (($ls.out -split '\s+')[0]))" } else { $lines += "state: $remote/main could not be read" }
  foreach ($trial in Get-TrialBoards) { $t = Invoke-Git $trial.dir @('rev-parse', 'HEAD'); $lines += "state: the trial copy $($trial.dir) is at $(Short $t.out)" }
  foreach ($one in (Read-Boards)) { if ($null -eq $one.commit) { $lines += "state: the board on $($one.port) does not answer" } else { $lines += "state: the board on $($one.port) runs $($one.commit)" } }
  return $lines
}

function Write-LandingLine {
  try {
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    $fields = [ordered]@{
      at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); by = $By; branch = $Branch; head = $script:headFull; before = $script:beforeFull
      after = $script:afterFull; trial = $script:trialFull; result = $script:result; why = $script:why; boards = @($script:boardsAfter); cold = [bool]$Cold; gateLog = $script:gateLog
    }
    $file = Join-Path $script:work 'fields.json'
    Write-Utf8 $file (ConvertTo-Json -InputObject $fields -Compress -Depth 5)
    $wrote = Invoke-Landing @('log-line', '--file', $landingsLog, '--fields', $file)
    if ($wrote.code -ne 0) { Say "note: the landings line could not be written: $($wrote.err)" }
  } catch { Say "note: the landings line could not be written: $($_.Exception.Message)" }
}

# ---- the run ----------------------------------------------------------------------------------------------------------
function Invoke-Run {
  if ($null -eq $node) { Refuse 'node is not on the PATH' }
  # The helpers are copied aside: this run fast-forwards the checkout they came from.
  $script:work = Join-Path $tempRoot ('land-run-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path (Join-Path $script:work 'tools'), (Join-Path $script:work 'src') | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'landing.mjs') -Destination (Join-Path $script:work 'tools\landing.mjs')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\src\landing.mjs') -Destination (Join-Path $script:work 'src\landing.mjs')

  # 1. Refusals before anything changes.
  Test-Ready $false
  Test-Debugger
  # 2. The gate on the exact head, before the lock.
  Invoke-Gate
  # 3. One landing at a time.
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $took = Invoke-Landing @('lock-take', '--file', $lockFile, '--by', $By, '--branch', $Branch, '--pid', "$PID", '--stale-minutes', "$lockStaleMinutes")
  if ($null -eq $took.json) { Refuse "the landing lock could not be taken: $($took.err) $($took.out)" }
  if (-not $took.json.ok) { Refuse $took.json.why }
  $script:lockToken = @{ pid = $PID; at = $took.json.at }
  if ($took.json.broke) { Say $took.json.broke }
  # Under the lock, once more: main may have moved during the gate (about ten minutes), and a debugger may have come.
  Test-Ready $true
  Test-Debugger

  # 4. Land: fast-forward main to the gated head, push (never forced), bring the trial copy up.
  $moved = Invoke-Git $mainDir @('merge', '--ff-only', $script:headFull)
  if ($moved.code -ne 0) { Refuse "fast-forward refused: $(Git-Line $moved)" }
  $script:afterFull = $script:headFull
  $script:landed = $true
  $pushed = Invoke-Git $mainDir @('push', $remote, 'main')
  if ($pushed.code -ne 0) {
    # Nothing but this checkout moved, and it was clean: --keep moves main back and refuses to touch anything else.
    $undone = Invoke-Git $mainDir @('reset', '--keep', $script:beforeFull)
    if ($undone.code -ne 0) {
      $script:result = 'rollback-failed'
      $script:why = "push to $remote failed ($(Git-Line $pushed)) and main could not be moved back: $(Git-Line $undone)"
      $script:exitCode = 3
      Say "ROLLBACK FAILED: $($script:why)"
      foreach ($line in (Get-State-Lines)) { Say $line }
      return
    }
    $script:landed = $false
    $script:afterFull = $null
    Refuse "the push to $remote failed ($(Git-Line $pushed)); main is back at $(Short $script:beforeFull)"
  }
  $trialFailed = $null
  foreach ($trial in Get-TrialBoards) {
    if ($null -eq $trialFailed) { $trialFailed = Update-Trial $trial }
    if ($null -eq $script:trialFull) { $script:trialFull = Get-FolderHead $trial }
  }

  # 5. Restart and verify.
  if ($null -eq $trialFailed) { $failure = Restart-AllBoards @($script:snapshot) } else { $failure = "the trial copy: $trialFailed" }
  if ($null -eq $failure) {
    $script:result = 'landed'
    $script:exitCode = 0
    $script:boardsAfter = @(Read-Boards)
    Say "before $(Short $script:beforeFull) -> after $(Short $script:afterFull) (trial $(Short $script:trialFull))"
    foreach ($one in $script:boardsAfter) {
      if ($null -eq $one.commit) { Say "$($one.port): not up" } else { Say "$($one.port): commit $($one.commit) since $([DateTimeOffset]::FromUnixTimeMilliseconds([long]$one.since).ToLocalTime().ToString('HH:mm:ss'))" }
    }
    $logFile = Join-Path $dataDir 'board.log'
    if (Test-Path -LiteralPath $logFile) { Get-Content -LiteralPath $logFile -Tail 3 | ForEach-Object { Say $_.Substring(0, [Math]::Min(140, $_.Length)) } }
    Say "landed: $Branch by $By"
  } else {
    # 6. Roll back with a revert commit.
    $script:why = $failure
    $failed = Invoke-Rollback $failure
    $script:boardsAfter = @(Read-Boards)
    $script:trialFull = $null
    foreach ($trial in Get-TrialBoards) { if ($null -eq $script:trialFull) { $script:trialFull = Get-FolderHead $trial } }
    if ($null -eq $failed) {
      $script:result = 'rolled-back'
      $script:exitCode = 2
      Say "rolled back: $failure"
    } else {
      $script:result = 'rollback-failed'
      $script:exitCode = 3
      $script:why = "$failure; the rollback failed: $failed"
      Say "ROLLBACK FAILED: $($script:why)"
      foreach ($line in (Get-State-Lines)) { Say $line }
    }
  }
}

try {
  Invoke-Run
} catch {
  if ($script:refused) {
    $script:result = 'refused'
    $script:exitCode = 1
    Say "refused: $($script:why)"
  } else {
    $problem = $_.Exception.Message
    if ($script:landed) {
      $script:result = 'rollback-failed'
      $script:exitCode = 3
      $script:why = "an unexpected error after main moved: $problem"
      Say "ROLLBACK FAILED: $($script:why)"
      try { foreach ($line in (Get-State-Lines)) { Say $line } } catch { Say 'state: could not be read' }
    } else {
      $script:result = 'refused'
      $script:exitCode = 1
      $script:why = "an unexpected error before anything changed: $problem"
      Say "refused: $($script:why)"
    }
  }
} finally {
  if ($null -ne $script:lockToken -and $null -ne $script:work) {
    $released = Invoke-Landing @('lock-release', '--file', $lockFile, '--pid', "$($script:lockToken.pid)", '--at', "$($script:lockToken.at)")
    if ($null -eq $released.json -or -not $released.json.released) { Say 'note: the landing lock was not ours any more when it was given back' }
  }
  if ($null -ne $script:work -and $null -ne $node) { Write-LandingLine }
  if ($null -ne $script:work -and (Split-Path -Leaf $script:work) -like 'land-run-*' -and (Test-Path -LiteralPath $script:work)) { Remove-Item -LiteralPath $script:work -Recurse -Force -ErrorAction SilentlyContinue }
}
exit $script:exitCode
