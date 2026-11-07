# land.ps1 <branch> [-Cold] [-NoTrial] [-By "<chat>"]   (2026-11-04: the one safe, logged way a change of the worker board goes live)
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File "<the main checkout>/tools/land.ps1" <branch> [-Cold] [-By "<chat>"]
#
# RUN IT IN THE BACKGROUND (the Bash or PowerShell tool's run_in_background) and wait for its notice: the gate takes about ten
# minutes, and a foreground call of a chat dies after two to ten. A call that dies in the middle runs no `finally`: the next run of
# this script sweeps what it left (a gate worktree with a live junction), and a lock left behind is broken after 15 minutes.
#
# What it does, in order (DESIGN.md, "Going live: tools/land.ps1"):
#  0. Sweeps the gate worktrees (land-gate-*) a cut landing left: the junction first with `cmd /c rmdir` (never a recursive
#     delete), then `git worktree remove` without force, then prune. One that belongs to a landing still running is left.
#  1. Refuses, with one line "refused: <why>" and a line in data/landings.jsonl, before anything changes: the main checkout is
#     not clean, the branch does not contain main, there is nothing to land, the trial copy cannot fast-forward, a board was
#     started without its keeper (warm mode needs -Cold), the gate fails on the branch's exact head, a debugger is attached to a
#     board, the PC's list of boards cannot be read or names no trial copy (-NoTrial lands the main board alone).
#  2. The gate: `npm test` (and, when the branch touches mods/workers/, the app's `claude.exe plugin test .`) on the exact head in
#     a temporary worktree with a junction to the main checkout's node_modules, with NO_COLOR=1; the run's own summary line must
#     say fail 0. The output goes to data/landings/<time>-<branch>.log; a refusal names the failing test files. A full run that
#     fails gets each failing test file run again alone, one at a time, once (the live-board tests flake under load); the first that
#     fails again refuses, all passing counts as passed and the log says so. Never a second full run. The gate runs
#     BEFORE the lock.
#  3. One landing at a time: data/landing.lock, refreshed at every phase (a heartbeat), so a live landing never looks stale; a
#     lock older than 15 minutes is a crashed landing's and is broken.
#  4. Under the lock, once more: the branch still contains main and its head is the gated one, the checkout is clean, no
#     debugger, no board without its keeper. Then main is fast-forwarded to the gated head and pushed (never forced); a push that
#     fails or times out is checked against the remote (git ls-remote) before main is put back. The trial copy is then
#     fast-forwarded from its `local` remote.
#  5. The boards restart, the trial board FIRST (a canary): warm (the default: POST /api/restart, the keeper starts the new code
#     with the same page token) or -Cold (a new keeper first, then each old keeper before its child). A board that does not
#     answer is started with `node start-board.mjs`. Success = every board answers /api/state with version.commit equal to its
#     folder's head within 90 s. A canary that does not come back rolls the landing back before the live board is touched.
#  6. Otherwise it rolls back: ONE revert commit on main whose tree is the old head's (never a reset: the remote keeps its
#     history), the trial copy and both boards restarted on the LOCAL revert first, whatever the remote says, and the revert pushed
#     last. Exit 2 "rolled back: <why>"; exit 3 when something failed, with the state of main, the remote and each board.
#  An unexpected error or a cut after main moved is a rollback too, or exit 3 with the state; it is never silent.
#  Exit 0 only for `landed`. Exit 1 refused, 2 rolled back, 3 rollback failed. Every run adds one line to data/landings.jsonl.
#
# -Config <json file> is for tests only: { main, boards: [{ dir, port }], remote, trialRemote, gateBoard, gateMod, gateFile ({file}
# in it is the test file run again alone), claudeExe, dataDir, tempRoot, nodeModules, nodeModulesMarker, comeBackSeconds, pollMs, gateMinutes, pushTimeoutSeconds, lockStaleMinutes,
# processesFile, connectionsFile, claudeProcesses, printBoards, printClaude, failAfter }. Without it the defaults are the PC's real boards: the
# main checkout (the repository's first working tree) with the port the PC's list of boards gives it, and each trial copy (a board
# of that list that is a clone of the main checkout: its remote `local`). The boards chosen are said on every run.
#
# This file is plain ASCII: Windows PowerShell 5.1 reads a script without a byte-order mark in the console's code page.
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Branch,
  [switch]$Cold,
  [switch]$NoTrial,
  [string]$By = 'unknown',
  [string]$Config = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# ---- running programs (a .NET process: stdout, stderr and the exit code each on their own, whatever PowerShell 5.1 does) ----
function ConvertTo-Arg([string]$Arg) {
  if ($Arg -eq '') { return '""' }
  if ($Arg -notmatch '[\s"]') { return $Arg }
  $quoted = $Arg -replace '(\\*)"', '$1$1\"'
  $quoted = $quoted -replace '(\\+)$', '$1$1'
  return '"' + $quoted + '"'
}

# Ends a process and what it started. Under `$ErrorActionPreference = 'Stop'` a native command's complaint must never end the
# script, so a push that timed out still gets its rollback.
function Stop-Tree([int]$ProcId) {
  try { & taskkill /PID $ProcId /T /F 2>$null | Out-Null } catch { $null = $_ }
  Stop-Process -Id $ProcId -Force -ErrorAction SilentlyContinue
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
    Stop-Tree $process.Id
    return @{ code = -1; out = ''; err = "timed out after $TimeoutSec s" }
  }
  $process.WaitForExit()
  return @{ code = $process.ExitCode; out = ([string]$out.Result).TrimEnd(); err = ([string]$err.Result).TrimEnd() }
}

function Invoke-Git([string]$Dir, [string[]]$GitArgs, [int]$TimeoutSec = 300) { return (Invoke-Native 'git' (@('-C', $Dir) + $GitArgs) '' $TimeoutSec) }
function Git-Line($Result) { if ($Result.err -ne '') { return (($Result.err -split "`n")[0]).Trim() } else { return (($Result.out -split "`n")[0]).Trim() } }

# ---- state of this run (everything starts empty, so no name is read before it is set) ---------------------------------------
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
$script:lockToken = $null
$script:work = $null
$script:snapshot = @()
$script:landed = $false
$script:pushed = $false
$script:printOnly = $false
$cfg = $null
$node = $null
$remote = 'origin'
$trialRemote = 'local'
$mainDir = $null
$boards = @()
$gateBoardCommand = 'npm test'
$gateModCommand = ''
$gateFileCommand = 'node --test {file}'
$claudeExeSetting = ''
$dataDir = $null
$tempRoot = $null
$nodeModules = $null
$nodeModulesMarker = 'happy-dom'
$script:teardownWhy = $null
$comeBackSeconds = 90
$pollMs = 2000
$gateMinutes = 60
$pushTimeoutSeconds = 300
$lockStaleMinutes = 15
$processesFile = ''
$connectionsFile = ''
$failAfter = ''
$lockFile = $null
$landingsLog = $null
$landingsDir = $null

function Say([string]$Text) { [Console]::Out.WriteLine($Text) }
function Short([string]$Sha) { if ($null -eq $Sha -or $Sha.Length -le 7) { return $Sha } else { return $Sha.Substring(0, 7) } }
function Refuse([string]$Why) {
  $script:refused = $true
  $script:why = $Why
  throw 'land-refused'
}

# What a board's own keeper hands its child must not reach a board this script starts (src/keeper.mjs startEnv).
Remove-Item Env:\WORKER_BOARD_CHILD -ErrorAction SilentlyContinue
Remove-Item Env:\WORKER_BOARD_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\WORKER_BOARD_TOKEN -ErrorAction SilentlyContinue

# ---- settings ---------------------------------------------------------------------------------------------------------
function Get-Setting([string]$Name, $Default) {
  if ($null -ne $cfg) {
    $found = $cfg.PSObject.Properties[$Name]
    if ($null -ne $found -and $null -ne $found.Value -and "$($found.Value)" -ne '') { return $found.Value }
  }
  return $Default
}
function Get-Full([string]$Path) { return [System.IO.Path]::GetFullPath($Path).TrimEnd('\') }

# The repository names no folder of the PC it was built on (the tests of B323 and B191 keep it so): the main checkout is the
# repository's first working tree, which git lists first, wherever this script runs from (a worktree of a branch too).
function Get-MainCheckout {
  $listed = Invoke-Native 'git' @('-C', $PSScriptRoot, 'worktree', 'list', '--porcelain') '' 60
  $first = @($listed.out -split "`n" | Where-Object { $_ -like 'worktree *' }) | Select-Object -First 1
  if ($listed.code -ne 0 -or $null -eq $first) { return (Get-Full (Join-Path $PSScriptRoot '..')) }
  return (Get-Full ($first.Substring(9).Trim().Replace('/', '\')))
}

# The boards of this PC, without a -Config: the main checkout's board, then each trial copy. The ports are the ones the PC's own
# list of boards holds (boards.json in ~\.worker-board, or in WORKER_BOARD_HOME; src/ports.mjs), else the main board's config.json
# or 4310. A trial copy is a board of that list, in another folder, that is a clone of the main checkout: its remote `local`
# is the main checkout (a board of another project has none). A list that exists and cannot be read, or that names no trial copy
# (unless -NoTrial), is a refusal: a landing that quietly skips the trial copy is the one thing it must not do.
function Get-DefaultBoards([string]$Main, [string]$TrialRemote) {
  $listHome = $env:WORKER_BOARD_HOME
  if (-not $listHome) { $listHome = Join-Path $env:USERPROFILE '.worker-board' }
  $entries = @()
  $listFile = Join-Path $listHome 'boards.json'
  if (Test-Path -LiteralPath $listFile) {
    try {
      $parsed = Get-Content -Raw -LiteralPath $listFile | ConvertFrom-Json
      $entries = @($parsed.boards)
    } catch { Refuse "the PC's list of boards $listFile cannot be read ($($_.Exception.Message)): fix it, or say the boards with -Config" }
  }
  $port = 4310
  $configFile = Join-Path $Main 'config.json'
  if (Test-Path -LiteralPath $configFile) {
    try {
      $read = Get-Content -Raw -LiteralPath $configFile | ConvertFrom-Json
      if ($null -ne $read.PSObject.Properties['port']) { $port = [int]$read.PSObject.Properties['port'].Value }
    } catch { $port = 4310 }
  }
  $found = @()
  foreach ($entry in $entries) {
    if ($null -eq $entry.PSObject.Properties['folder'] -or $null -eq $entry.PSObject.Properties['port']) { continue }
    if ((Get-Full ([string]$entry.folder)) -eq $Main) { $port = [int]$entry.port }
  }
  $found += @{ dir = $Main; port = $port }
  foreach ($entry in $entries) {
    if ($null -eq $entry.PSObject.Properties['folder'] -or $null -eq $entry.PSObject.Properties['port']) { continue }
    $dir = Get-Full ([string]$entry.folder)
    if ($dir -eq $Main -or -not (Test-Path -LiteralPath $dir)) { continue }
    $url = Invoke-Git $dir @('remote', 'get-url', $TrialRemote)
    if ($url.code -eq 0 -and $url.out -ne '' -and (Get-Full $url.out.Replace('/', '\')) -eq $Main) { $found += @{ dir = $dir; port = [int]$entry.port } }
  }
  if ($found.Count -lt 2 -and -not $NoTrial) {
    Refuse "no trial copy of the main checkout was found in the PC's list of boards ($listFile): a board of that list whose remote '$TrialRemote' is the main checkout. Say the boards with -Config, or pass -NoTrial to land the main board alone"
  }
  return $found
}

# Reads the settings. Inside the run's try, so a refusal here (a list of boards nobody can read) writes its line too.
function Initialize-Settings {
  if ($Config -ne '') { $script:cfg = (Get-Content -Raw -LiteralPath $Config) | ConvertFrom-Json }
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $nodeCommand) { $script:node = $nodeCommand.Source }
  if ($null -eq $script:node) { Refuse 'node is not on the PATH' }
  $script:tempRoot = Get-Full (Get-Setting 'tempRoot' $env:TEMP)
  # The helpers are copied aside: this run fast-forwards the checkout they came from.
  $script:work = Join-Path $script:tempRoot ('land-run-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path (Join-Path $script:work 'tools'), (Join-Path $script:work 'src') | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'landing.mjs') -Destination (Join-Path $script:work 'tools\landing.mjs')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\src\landing.mjs') -Destination (Join-Path $script:work 'src\landing.mjs')
  $script:remote = [string](Get-Setting 'remote' 'origin')
  $script:trialRemote = [string](Get-Setting 'trialRemote' 'local')
  $configuredMain = [string](Get-Setting 'main' '')
  if ($configuredMain -ne '') { $script:mainDir = Get-Full $configuredMain } else { $script:mainDir = Get-MainCheckout }
  $script:dataDir = Get-Full (Get-Setting 'dataDir' (Join-Path $script:mainDir 'data'))
  $script:lockFile = Join-Path $script:dataDir 'landing.lock'
  $script:landingsLog = Join-Path $script:dataDir 'landings.jsonl'
  $script:landingsDir = Join-Path $script:dataDir 'landings'
  $script:boards = @()
  if ($null -ne $cfg -and $null -ne $cfg.PSObject.Properties['boards']) {
    foreach ($one in @($cfg.boards)) { $script:boards += @{ dir = (Get-Full $one.dir); port = [int]$one.port } }
  } else {
    $script:boards = @(Get-DefaultBoards $script:mainDir $script:trialRemote)
  }
  $script:gateBoardCommand = [string](Get-Setting 'gateBoard' 'npm test')
  $script:gateModCommand = [string](Get-Setting 'gateMod' '')
  $script:gateFileCommand = [string](Get-Setting 'gateFile' 'node --test {file}')
  $script:claudeExeSetting = [string](Get-Setting 'claudeExe' '')
  $script:nodeModules = Get-Full (Get-Setting 'nodeModules' (Join-Path $script:mainDir 'node_modules'))
  $script:nodeModulesMarker = [string](Get-Setting 'nodeModulesMarker' 'happy-dom')
  $script:comeBackSeconds = [int](Get-Setting 'comeBackSeconds' 90)
  $script:pollMs = [int](Get-Setting 'pollMs' 2000)
  $script:gateMinutes = [int](Get-Setting 'gateMinutes' 60)
  $script:pushTimeoutSeconds = [int](Get-Setting 'pushTimeoutSeconds' 300)
  $script:lockStaleMinutes = [int](Get-Setting 'lockStaleMinutes' 15)
  $script:processesFile = [string](Get-Setting 'processesFile' '')
  $script:connectionsFile = [string](Get-Setting 'connectionsFile' '')
  # For the tests: where a fault is made on purpose ('ff', 'push', 'rollback', comma-separated), and what is only printed.
  $script:failAfter = [string](Get-Setting 'failAfter' '')
  if ([bool](Get-Setting 'printBoards' $false)) {
    Say ('boards: ' + (ConvertTo-Json -InputObject @($script:boards | ForEach-Object { [pscustomobject]@{ dir = $_.dir; port = $_.port } }) -Compress))
    $script:printOnly = $true
  }
}

# ---- the helpers (src/landing.mjs through tools/landing.mjs) -----------------------------------------------------------
function Write-Utf8([string]$Path, [string]$Text) { [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false)) }

function Invoke-Landing([string[]]$LandingArgs) {
  $run = Invoke-Native $node (@((Join-Path $script:work 'tools\landing.mjs')) + $LandingArgs) '' 120
  $json = $null
  if ($run.out -ne '') { try { $json = $run.out | ConvertFrom-Json } catch { $json = $null } }
  return @{ code = $run.code; json = $json; err = $run.err; out = $run.out }
}

function Write-BoardsLine {
  $parts = @($boards | ForEach-Object { if ($_.dir -eq $mainDir) { "the main board on $($_.port) ($($_.dir))" } else { "the trial board on $($_.port) ($($_.dir))" } })
  Say "boards: $($parts -join ', ')"
}

# ---- boards -----------------------------------------------------------------------------------------------------------
function Get-BoardVersion([int]$Port) {
  try {
    $page = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/" -TimeoutSec 5).Content
    $token = [regex]::Match($page, 'name="board-token" content="([^"]+)"').Groups[1].Value
    $state = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/state" -Headers @{ 'X-Board-Token' = $token } -TimeoutSec 10
    $canRestart = $null
    $said = $state.version.PSObject.Properties['canRestart']
    if ($null -ne $said) { $canRestart = $said.Value }
    return @{ token = $token; commit = [string]$state.version.commit; since = $state.version.since; canRestart = $canRestart }
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

# The main checkout's node_modules must hold its marker package (happy-dom: the page tests need it) at the start of every landing,
# after the sweep of a cut landing and again after the gate's junction is removed. On 2026-11-07 10:04 it was emptied right at the end
# of a landing and nothing said so: the next gates would have failed with 48 "Cannot find package 'happy-dom'" and no reason.
# Gives back $null when it is whole, else the refusal in one line.
function Get-NodeModulesWhy([string]$When) {
  if (Test-Path -LiteralPath (Join-Path $nodeModules $nodeModulesMarker)) { return $null }
  return "$nodeModules has no $nodeModulesMarker $When (it was emptied): run npm ci in $mainDir, then land again"
}

# The trial copies first (a canary: a restart that does not take shows there before the live board is touched), then the main board.
function Get-RestartOrder { return @(@($boards | Where-Object { $_.dir -ne $mainDir }) + @($boards | Where-Object { $_.dir -eq $mainDir })) }

# Warm: the board is asked to restart itself (its keeper starts the new code with the same page token). Gives back $null when
# the board answers with its folder's head within the time, else why not.
function Restart-BoardWarm($Board, [string]$Want) {
  $was = Get-BoardVersion $Board.port
  if ($null -eq $was) {
    # Right after the fast-forward a board may be between the stop and the start of its own self-update (2026-11-05 22:03: 4310
    # was found "not answering" and started while it was coming back by itself). It gets the come-back time to answer first.
    Say "note: the board on $($Board.port) does not answer: waiting up to $comeBackSeconds s for it to come back by itself"
    $deadline = (Get-Date).AddSeconds($comeBackSeconds)
    while ($null -eq $was -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds $pollMs
      $was = Get-BoardVersion $Board.port
    }
  }
  if ($null -eq $was) {
    # The lead's rule: a board is started with start-board.mjs, never with a bare `node server.mjs`.
    Say "note: the board on $($Board.port) still does not answer: starting it with node start-board.mjs"
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

# Cold: the new keeper first (the landed holdPort retries the bind), then the old keeper BEFORE its child (a keeper starts a crashed
# child again). start-board.mjs would only say "runs already" while the old board answers, so the keeper is started the way
# start-board.mjs does it (the env without the keeper's own words, src/keeper.mjs startEnv; they were removed from this process at
# its start): `node server.mjs`, its words appended to data\board.log.
function Restart-BoardCold($Board, [object[]]$Old) {
  $logDir = Join-Path $Board.dir 'data'
  if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'node server.mjs >> data\board.log 2>&1' -WorkingDirectory $Board.dir -WindowStyle Hidden
  Start-Sleep -Milliseconds 1500
  $mine = @($Old | Where-Object { $_.port -eq $Board.port })
  foreach ($one in @($mine | Where-Object { $_.role -eq 'keeper' })) { Stop-Process -Id $one.pid -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  foreach ($one in @($mine | Where-Object { $_.role -eq 'child' })) { Stop-Process -Id $one.pid -Force -ErrorAction SilentlyContinue }
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

# Warm mode asks each board to restart itself, which only a board its keeper runs can do (version.canRestart). A board that says it
# cannot is a refusal before anything changes: "needs -Cold". A board that does not answer is started by start-board.mjs; one that
# does not say is left to the restart route's own answer.
function Test-CanRestart {
  if ($Cold) { return }
  foreach ($board in $boards) {
    $version = Get-BoardVersion $board.port
    if ($null -eq $version) { continue }
    if ($null -ne $version.canRestart -and $version.canRestart -eq $false) {
      Refuse "the board on $($board.port) was started without its keeper and cannot restart itself: it needs -Cold"
    }
  }
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

# The lock's heartbeat: a new time at each phase, so a landing that is alive never looks stale. `$MustHold`: before main moves, a lock
# that another landing took over is a refusal; after, it is only said.
function Update-LockBeat([bool]$MustHold = $false) {
  if ($null -eq $script:lockToken) { return }
  $beat = Invoke-Landing @('lock-refresh', '--file', $lockFile, '--pid', "$($script:lockToken.pid)", '--at', "$($script:lockToken.at)")
  if ($null -ne $beat.json -and $beat.json.ok) {
    $script:lockToken = @{ pid = $script:lockToken.pid; at = $beat.json.at }
    return
  }
  $why = 'the heartbeat of the landing lock could not be written'
  if ($null -ne $beat.json -and $null -ne $beat.json.PSObject.Properties['why']) { $why = $beat.json.why }
  if ($MustHold) { Refuse "the landing lock is not ours any more: $why" }
  Say "note: $why"
}

# ---- what a cut landing left -------------------------------------------------------------------------------------------
# A foreground call of a chat dies after two to ten minutes and the gate takes about ten: nothing runs after that, so a gate
# worktree stays with its junction to node_modules. The junction goes first, with rmdir (never a recursive delete through it),
# then git removes the worktree without force, then prune. A gate worktree whose owner (the file beside it, with the process id of
# its landing) still runs belongs to a landing in progress and is left.
function Remove-LeftoverGates {
  $found = @{}
  $listed = Invoke-Git $mainDir @('worktree', 'list', '--porcelain')
  if ($listed.code -eq 0) {
    foreach ($line in ($listed.out -split "`n")) {
      if ($line -notlike 'worktree *') { continue }
      $path = Get-Full ($line.Substring(9).Trim().Replace('/', '\'))
      if ((Split-Path -Leaf $path) -like 'land-gate-*' -and (Split-Path -Parent $path) -eq $tempRoot) { $found[$path] = $true }
    }
  }
  foreach ($folder in @(Get-ChildItem -LiteralPath $tempRoot -Directory -Filter 'land-gate-*' -ErrorAction SilentlyContinue)) {
    if (-not $found.ContainsKey($folder.FullName)) { $found[$folder.FullName] = $false }
  }
  foreach ($dir in @($found.Keys)) {
    $ownerFile = "$dir.owner"
    if (Test-Path -LiteralPath $ownerFile) {
      $owner = 0
      try { $owner = [int](Get-Content -Raw -LiteralPath $ownerFile) } catch { $owner = 0 }
      $alive = $null
      if ($owner -gt 0) { $alive = Get-Process -Id $owner -ErrorAction SilentlyContinue }
      if ($null -ne $alive -and $alive.ProcessName -match 'powershell|pwsh') {
        Say "note: the gate worktree $dir belongs to a landing that is still running (process $owner): left"
        continue
      }
    }
    $junction = Join-Path $dir 'node_modules'
    $item = Get-Item -LiteralPath $junction -Force -ErrorAction SilentlyContinue
    if ($null -ne $item -and ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      $gone = Invoke-Native 'cmd.exe' @() '' 60 "/c rmdir `"$junction`""
      if (Test-Path -LiteralPath $junction) { Say "note: the junction $junction of a cut landing could not be removed ($($gone.err)): remove it with cmd /c rmdir, never a recursive delete"; continue }
      $missing = Get-NodeModulesWhy 'after the sweep of a cut landing'
      if ($null -ne $missing) { Refuse "$missing (the gate worktree $dir was left for a look)" }
    }
    if ($found[$dir]) {
      $removed = Invoke-Git $mainDir @('worktree', 'remove', $dir)
      if ($removed.code -ne 0) { Say "note: the gate worktree $dir of a cut landing was left ($(Git-Line $removed)): remove it by hand once you looked, never with the force flag"; continue }
    } elseif (@(Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue).Count -eq 0) {
      Remove-Item -LiteralPath $dir -ErrorAction SilentlyContinue
    } else {
      Say "note: the folder $dir of a cut landing is no worktree and holds files: left"
      continue
    }
    Remove-Item -LiteralPath $ownerFile -ErrorAction SilentlyContinue
    Say "note: removed the gate worktree $dir that a cut landing left"
  }
  Invoke-Git $mainDir @('worktree', 'prune') | Out-Null
}

# ---- the gate ---------------------------------------------------------------------------------------------------------
# A path is the app's command-line program only under its own data folder (Claude-Data\<id>\claude-code\<version>\<hash>), never the
# desktop app's claude.exe (under WindowsApps or anywhere else), which would open a window instead of testing.
function Test-ClaudeCli([string]$Path) {
  return ($Path -match '\\claude-code\\' -and $Path -notmatch 'WindowsApps' -and (Test-Path -LiteralPath $Path))
}

function Find-ClaudeExe {
  if ($claudeExeSetting -ne '') { return $claudeExeSetting }
  # One folder per version: a running chat's is the one in use, else the newest one there.
  if ($null -ne $cfg -and $null -ne $cfg.PSObject.Properties['claudeProcesses']) { $paths = @($cfg.claudeProcesses) }
  else { $paths = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'claude*' -and $_.ExecutablePath } | ForEach-Object { $_.ExecutablePath }) }
  foreach ($path in $paths) { if (Test-ClaudeCli ([string]$path)) { return [string]$path } }
  $kept = @(Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Claude-Data\*\claude-code\*\*\claude.exe') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  foreach ($one in $kept) { if (Test-ClaudeCli $one.FullName) { return $one.FullName } }
  return $null
}

# Runs a gate command through cmd with its words appended to a file as they are (a UTF-8 summary line must not pass through the
# console's code page), within the time, without colour (a coloured summary line starts with a code); gives back the exit code.
function Invoke-GateCommand([string]$Command, [string]$WorkDir, [string]$Output) {
  $line = "/s /c `"$Command >> `"$Output`" 2>&1`""
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = $line
  $psi.WorkingDirectory = $WorkDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.EnvironmentVariables['NO_COLOR'] = '1'
  if ($psi.EnvironmentVariables.ContainsKey('FORCE_COLOR')) { $psi.EnvironmentVariables.Remove('FORCE_COLOR') }
  $process = [System.Diagnostics.Process]::Start($psi)
  $process.StandardInput.Close()
  if (-not $process.WaitForExit($gateMinutes * 60 * 1000)) {
    Stop-Tree $process.Id
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

# The words of a refused gate: why, and the test files that failed (a known flake is rerun alone by the chat, never by this script).
function Get-GateWhy($Checked) {
  $why = [string]$Checked.json.why
  if ($null -ne $Checked.json.PSObject.Properties['files']) { $why = "$why; failing test files: $((@($Checked.json.files) | Select-Object -First 8) -join ', ')" }
  return $why
}

function Invoke-Gate {
  New-Item -ItemType Directory -Force -Path $landingsDir | Out-Null
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $safe = $Branch -replace '[^A-Za-z0-9._-]', '-'
  $script:gateLog = Join-Path $landingsDir "$stamp-$safe.log"
  $temp = Join-Path $tempRoot ('land-gate-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  Write-Utf8 $script:gateLog "landing of $Branch ($($script:headFull)) by $By at $((Get-Date).ToString('s'))`r`ngate worktree: $temp`r`n"
  $ownerFile = "$temp.owner"
  $added = $false
  $linked = $false
  try {
    if (-not (Test-Path -LiteralPath $nodeModules)) { Refuse "the gate cannot start: $nodeModules is not there to link (see $($script:gateLog))" }
    # Who this worktree belongs to: a later run sweeps it only when this process is gone.
    Write-Utf8 $ownerFile "$PID"
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
    if (-not $checked.json.ok) {
      # The live-board tests flake under load (two gates at once: EBUSY on a board folder, a board that is slow to stop). A run that
      # names its failing files gets each of them run again ALONE, one at a time, once; the first that fails again refuses the landing.
      # Never a second full run (chat 1's rule, 2026-11-07).
      $why = Get-GateWhy $checked
      $files = @()
      if ($null -ne $checked.json.PSObject.Properties['files']) { $files = @($checked.json.files) }
      if ($files.Count -eq 0) { Refuse "the gate failed on $(Short $script:headFull): $why (see $($script:gateLog))" }
      Say "note: the gate failed with $($files.Count) failing test file(s): each is run again alone, once"
      foreach ($file in $files) {
        $aloneLog = "$($script:gateLog).alone"
        [System.IO.File]::AppendAllText($script:gateLog, "`r`n===== rerun alone: $file =====`r`n")
        $aloneCode = Invoke-GateCommand ($gateFileCommand.Replace('{file}', $file)) $temp $aloneLog
        if (Test-Path -LiteralPath $aloneLog) { Add-FileBytes $script:gateLog $aloneLog }
        $alone = Invoke-Landing @('gate-check', '--kind', 'board', '--file', $aloneLog, '--exit', "$aloneCode")
        Remove-Item -LiteralPath $aloneLog -ErrorAction SilentlyContinue
        if ($null -eq $alone.json) { Refuse "the gate failed on $(Short $script:headFull): $why; the rerun alone of $file could not be read: $($alone.err) (see $($script:gateLog))" }
        if (-not $alone.json.ok) { Refuse "the gate failed on $(Short $script:headFull): $why; rerun alone: $file failed again ($($alone.json.why)) (see $($script:gateLog))" }
      }
      $passedAlone = "$($files.Count) test file(s) failed under load, all passed alone: the gate counts as passed"
      [System.IO.File]::AppendAllText($script:gateLog, "`r`nrerun: $passedAlone`r`n")
      Say "note: $passedAlone"
    }
    # The mod's, only when the branch changes it.
    $changed = Invoke-Git $mainDir @('diff', '--name-only', $script:beforeFull, $script:headFull)
    if (@($changed.out -split "`n" | Where-Object { $_ -match '^mods/workers/' }).Count -gt 0) {
      $command = $gateModCommand
      if ($command -eq '') {
        $claude = Find-ClaudeExe
        if ($null -eq $claude) { Refuse "the mod gate cannot run: claude CLI not found (the app's own claude.exe is never used) (see $($script:gateLog))" }
        $command = "`"$claude`" plugin test ."
      }
      $modLog = "$($script:gateLog).mod"
      [System.IO.File]::AppendAllText($script:gateLog, "`r`n===== mod gate: $command =====`r`n")
      $modCode = Invoke-GateCommand $command (Join-Path $temp 'mods\workers') $modLog
      if (Test-Path -LiteralPath $modLog) { Add-FileBytes $script:gateLog $modLog }
      $modChecked = Invoke-Landing @('gate-check', '--kind', 'mod', '--file', $modLog, '--exit', "$modCode")
      Remove-Item -LiteralPath $modLog -ErrorAction SilentlyContinue
      if ($null -eq $modChecked.json) { Refuse "the mod gate's result could not be read: $($modChecked.err) (see $($script:gateLog))" }
      if (-not $modChecked.json.ok) { Refuse "the mod gate failed on $(Short $script:headFull): $(Get-GateWhy $modChecked) (see $($script:gateLog))" }
    }
  } finally {
    # The junction FIRST, with rmdir: never a recursive delete through it (it points at the main checkout's node_modules). Then,
    # BEFORE git removes the worktree, two checks: the junction is gone, and its target still holds its marker. Either one failing
    # stops the landing: the worktree is left for a look, the gate log and the landing line say why (2026-11-07: node_modules was
    # emptied at the end of a landing and nothing said so).
    $teardown = $null
    if ($linked) {
      $gone = Invoke-Native 'cmd.exe' @() '' 60 "/c rmdir `"$temp\node_modules`""
      if (Test-Path -LiteralPath "$temp\node_modules") { $teardown = "the gate's junction $temp\node_modules could not be removed ($(Git-Line $gone)); the gate worktree was left: remove the junction with cmd /c rmdir (never a recursive delete), then the worktree, and land again" }
    }
    if ($null -eq $teardown -and $added) {
      $missing = Get-NodeModulesWhy 'after the gate'
      if ($null -ne $missing) { $teardown = "$missing (the gate worktree $temp was left for a look)" }
    }
    if ($null -ne $teardown) {
      [System.IO.File]::AppendAllText($script:gateLog, "`r`nteardown: $teardown`r`n")
      Say "note: $teardown"
      if ($script:refused) { $script:why = "$($script:why); and $teardown" } else { $script:teardownWhy = $teardown }
    } elseif ($added) {
      [System.IO.File]::AppendAllText($script:gateLog, "`r`nteardown: the junction is gone and $nodeModules holds $nodeModulesMarker; the gate worktree is removed`r`n")
      $removed = Invoke-Git $mainDir @('worktree', 'remove', $temp)
      if ($removed.code -ne 0) { Say "note: the gate worktree $temp was left ($(Git-Line $removed)): remove it by hand once you looked, never with the force flag" }
      Invoke-Git $mainDir @('worktree', 'prune') | Out-Null
    }
    if (-not (Test-Path -LiteralPath $temp)) { Remove-Item -LiteralPath $ownerFile -ErrorAction SilentlyContinue }
  }
  if ($null -ne $script:teardownWhy) { Refuse $script:teardownWhy }
}

# ---- landing, restarting, rolling back --------------------------------------------------------------------------------
function Update-Trial($Trial) {
  $fetch = Invoke-Git $Trial.dir @('fetch', '-q', $trialRemote, 'main')
  if ($fetch.code -ne 0) { return "fetch from '$trialRemote' failed in $($Trial.dir): $(Git-Line $fetch)" }
  $merge = Invoke-Git $Trial.dir @('merge', '--ff-only', 'FETCH_HEAD')
  if ($merge.code -ne 0) { return "fast-forward refused in $($Trial.dir): $(Git-Line $merge)" }
  return $null
}

# Restarts every board, the trial copy first, and checks each answers with its own folder's head; $null when all do, else the first
# why. The lock is refreshed after each board.
function Restart-AllBoards([object[]]$Old) {
  foreach ($board in (Get-RestartOrder)) {
    $want = Get-FolderHead $board
    if ($null -eq $want) { return "$($board.port): the folder $($board.dir) has no head" }
    if ($board.dir -ne $mainDir) { Say "note: restarting the trial board on $($board.port) first, as the canary" }
    if ($Cold) {
      Restart-BoardCold $board $Old
      if ($null -eq (Wait-BoardCommit $board $want)) { return "$($board.port) did not come back with $(Short $want) within $comeBackSeconds s" }
    } else {
      $failed = Restart-BoardWarm $board $want
      if ($null -ne $failed) { return $failed }
    }
    Update-LockBeat
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

# Pushes main. A push that fails or times out may still have landed (a timeout does not say), so the remote is asked
# (git ls-remote) before main is taken back. `ok`: the remote has the head; `failed`: it does not; `unknown`: the push timed out
# and the remote cannot be read either.
function Publish-Main {
  $pushed = Invoke-Git $mainDir @('push', $remote, 'main') $pushTimeoutSeconds
  if ($pushed.code -eq 0) { return @{ state = 'ok'; why = $null } }
  $ls = Invoke-Git $mainDir @('ls-remote', $remote, 'refs/heads/main') 60
  if ($ls.code -eq 0 -and $ls.out -ne '') {
    if ((($ls.out -split '\s+')[0]) -eq $script:headFull) {
      Say "note: the push to $remote said it failed ($(Git-Line $pushed)), but $remote/main has $(Short $script:headFull): going on"
      return @{ state = 'ok'; why = $null }
    }
    return @{ state = 'failed'; why = "the push to $remote failed ($(Git-Line $pushed)); $remote/main does not have the landing" }
  }
  if ($pushed.code -eq -1) { return @{ state = 'unknown'; why = "the push to $remote timed out and $remote/main could not be read: it may have landed" } }
  return @{ state = 'failed'; why = "the push to $remote failed ($(Git-Line $pushed))" }
}

# One revert commit on main whose tree is the old head's: the remote keeps its history (no force, no reset). The trial copy and the
# boards restart on the LOCAL revert first, whatever the remote says, and the revert is pushed last: a push that fails leaves the
# boards up. Gives back $null when all of it worked, else what failed, in one line.
function Invoke-Rollback([string]$Why) {
  Say "rolling back: $Why"
  if ($failAfter -match 'rollback') { throw 'a fault made on purpose at the rollback' }
  $problems = @()
  $label = 'revert commit'
  try {
    $message = "Revert the landing of $Branch ($(Short $script:beforeFull)..$(Short $script:afterFull)): $Why"
    $made = Invoke-Git $mainDir @('commit-tree', "$($script:beforeFull)^{tree}", '-p', $script:afterFull, '-m', $message)
    if ($made.code -ne 0) { return "the revert commit could not be made: $(Git-Line $made)" }
    $revert = $made.out
    $label = 'fast-forward of main to the revert'
    $moved = Invoke-Git $mainDir @('merge', '--ff-only', $revert)
    if ($moved.code -ne 0) { return "main could not move to the revert $(Short $revert): $(Git-Line $moved)" }
    Update-LockBeat
    $label = 'trial copy'
    foreach ($trial in Get-TrialBoards) {
      $failed = Update-Trial $trial
      if ($null -ne $failed) { $problems += "the trial copy could not take the revert: $failed" }
    }
    $label = 'restart on the revert'
    # A cold restart stops the processes that run now, not the ones from before the landing.
    if ($Cold) { $script:snapshot = @((Get-Inspection).processes) }
    $failed = Restart-AllBoards @($script:snapshot)
    if ($null -ne $failed) { $problems += "the boards did not come back on the revert $(Short $revert): $failed" }
    $label = 'push of the revert'
    $pushed = Invoke-Git $mainDir @('push', $remote, 'main') $pushTimeoutSeconds
    if ($pushed.code -ne 0) {
      $up = 'the boards run it'
      if ($null -ne $failed) { $up = 'the boards were restarted on it' }
      $problems += "the revert $(Short $revert) is on main here and $up, but the push to $remote failed ($(Git-Line $pushed)): $remote/main still has $(Short $script:afterFull), the landing; push the revert by hand once the remote takes it"
    }
    if ($problems.Count -eq 0) { return $null }
    return ($problems -join '; ')
  } catch {
    return "the rollback stopped at the $label`: $($_.Exception.Message)"
  }
}

function Get-State-Lines {
  $lines = @()
  $head = Invoke-Git $mainDir @('rev-parse', 'HEAD')
  $lines += "state: main (local) is at $(Short $head.out); it held $(Short $script:beforeFull) before and $(Short $script:afterFull) after the landing"
  $ls = Invoke-Git $mainDir @('ls-remote', $remote, 'refs/heads/main') 60
  if ($ls.code -eq 0 -and $ls.out -ne '') { $lines += "state: $remote/main is at $(Short (($ls.out -split '\s+')[0]))" } else { $lines += "state: $remote/main could not be read" }
  foreach ($trial in Get-TrialBoards) { $t = Invoke-Git $trial.dir @('rev-parse', 'HEAD'); $lines += "state: the trial copy $($trial.dir) is at $(Short $t.out)" }
  foreach ($one in (Read-Boards)) { if ($null -eq $one.commit) { $lines += "state: the board on $($one.port) does not answer" } else { $lines += "state: the board on $($one.port) runs $($one.commit)" } }
  return $lines
}

function Write-State { try { foreach ($line in (Get-State-Lines)) { Say $line } } catch { Say 'state: could not be read' } }

# The rollback and what it makes of the result: rolled-back (exit 2), or rollback-failed (exit 3) with the state. A rollback that
# throws leaves the result for the net in the final block.
function Complete-Rollback([string]$Why) {
  $script:why = $Why
  $failed = Invoke-Rollback $Why
  $script:boardsAfter = @(Read-Boards)
  $script:trialFull = $null
  foreach ($trial in Get-TrialBoards) { if ($null -eq $script:trialFull) { $script:trialFull = Get-FolderHead $trial } }
  if ($null -eq $failed) {
    $script:result = 'rolled-back'
    $script:exitCode = 2
    Say "rolled back: $Why"
  } else {
    $script:result = 'rollback-failed'
    $script:exitCode = 3
    $script:why = "$Why; the rollback failed: $failed"
    Say "ROLLBACK FAILED: $($script:why)"
    Write-State
  }
}

# Main moved here and nothing was pushed: put it back. `--keep` refuses to touch anything but what the landing changed (the checkout
# was clean). Gives back $null, or why it could not.
function Undo-LocalLanding {
  $undone = Invoke-Git $mainDir @('reset', '--keep', $script:beforeFull)
  if ($undone.code -ne 0) { return Git-Line $undone }
  $script:landed = $false
  $script:afterFull = $null
  return $null
}

function Write-LandingLine {
  if ($script:printOnly -or $null -eq $script:work -or $null -eq $landingsLog) { return }
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
  Initialize-Settings
  if ($script:printOnly) { return }
  Write-BoardsLine
  if ([bool](Get-Setting 'printClaude' $false)) {
    $found = Find-ClaudeExe
    if ($null -eq $found) { Say 'claude: none' } else { Say "claude: $found" }
    $script:printOnly = $true
    return
  }
  # 0. The main checkout's node_modules is whole: every gate links to it, and one emptied by mistake must be seen here, not as 48
  # failing page tests ten minutes later.
  $missing = Get-NodeModulesWhy 'at the start of the landing'
  if ($null -ne $missing) { Refuse $missing }
  Remove-LeftoverGates

  # 1. Refusals before anything changes.
  Test-Ready $false
  Test-Debugger
  Test-CanRestart
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
  Test-CanRestart
  Update-LockBeat $true

  # 4. Land: fast-forward main to the gated head, push (never forced), bring the trial copy up.
  $moved = Invoke-Git $mainDir @('merge', '--ff-only', $script:headFull)
  if ($moved.code -ne 0) { Refuse "fast-forward refused: $(Git-Line $moved)" }
  $script:afterFull = $script:headFull
  $script:landed = $true
  Update-LockBeat
  if ($failAfter -match 'ff') { throw 'a fault made on purpose after the fast-forward' }
  $published = Publish-Main
  if ($published.state -eq 'unknown') {
    $script:why = "$($published.why); main (local) is at $(Short $script:afterFull), boards not restarted: look with git ls-remote, then land again or revert by hand"
    $script:result = 'rollback-failed'
    $script:exitCode = 3
    Say "ROLLBACK FAILED: $($script:why)"
    Write-State
    return
  }
  if ($published.state -eq 'failed') {
    $undone = Undo-LocalLanding
    if ($null -ne $undone) {
      $script:result = 'rollback-failed'
      $script:why = "$($published.why) and main could not be moved back: $undone"
      $script:exitCode = 3
      Say "ROLLBACK FAILED: $($script:why)"
      Write-State
      return
    }
    Refuse "$($published.why); main is back at $(Short $script:beforeFull)"
  }
  $script:pushed = $true
  Update-LockBeat
  if ($failAfter -match 'push') { throw 'a fault made on purpose after the push' }
  $trialFailed = $null
  foreach ($trial in Get-TrialBoards) {
    if ($null -eq $trialFailed) { $trialFailed = Update-Trial $trial }
    if ($null -eq $script:trialFull) { $script:trialFull = Get-FolderHead $trial }
  }
  Update-LockBeat

  # 5. Restart and verify, the trial board first.
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
    Complete-Rollback $failure
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
    if ($script:landed -and $script:pushed) {
      # Past the push: the rollback, not only an exit code. One that throws too is caught by the net below.
      try { Complete-Rollback "an unexpected error after the push: $problem" } catch { $script:why = "an unexpected error after the push ($problem), and the rollback stopped: $($_.Exception.Message)" }
    } elseif ($script:landed) {
      # Main moved here and the push is not known to have happened: take it back, and say if that did not work.
      $script:why = "an unexpected error after main moved ($problem)"
      try {
        $undone = Undo-LocalLanding
        if ($null -eq $undone) {
          $script:result = 'refused'
          $script:exitCode = 1
          Say "refused: $($script:why); main is back at $(Short $script:beforeFull)"
        } else {
          $script:why = "$($script:why) and main could not be moved back: $undone"
        }
      } catch { $script:why = "$($script:why) and main could not be moved back: $($_.Exception.Message)" }
    } else {
      $script:result = 'refused'
      $script:exitCode = 1
      $script:why = "an unexpected error before anything changed: $problem"
      Say "refused: $($script:why)"
    }
  }
} finally {
  # The net: a landing that got past the fast-forward and was cut (Ctrl-C, a tool call that died, an error nobody handled) is never
  # logged as a refusal and never silent.
  if ($script:landed -and $script:result -eq 'refused') {
    $script:result = 'rollback-failed'
    $script:exitCode = 3
    if ($null -eq $script:why) { $script:why = 'the run was cut' }
    $script:why = "the run ended after main moved, before it finished: $($script:why)"
    Say "ROLLBACK FAILED: $($script:why)"
    Write-State
  }
  if ($null -ne $script:lockToken -and $null -ne $script:work) {
    $released = Invoke-Landing @('lock-release', '--file', $lockFile, '--pid', "$($script:lockToken.pid)", '--at', "$($script:lockToken.at)")
    if ($null -eq $released.json -or -not $released.json.released) { Say 'note: the landing lock was not ours any more when it was given back' }
  }
  Write-LandingLine
  if ($null -ne $script:work -and (Split-Path -Leaf $script:work) -like 'land-run-*' -and (Test-Path -LiteralPath $script:work)) { Remove-Item -LiteralPath $script:work -Recurse -Force -ErrorAction SilentlyContinue }
}
if ($script:printOnly) { $script:exitCode = 0 }
exit $script:exitCode
