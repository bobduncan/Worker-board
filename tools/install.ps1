# B321: installs the worker board on a Windows PC with one command, pasted into PowerShell (the README has it):
#
#   irm <the raw address of this file on GitHub> | iex
#
# It checks Windows, the Claude desktop app, Node 24 or newer and git, one line each. Node and git it offers to install
# with winget; without the Claude app it says where to get it and stops. Then it gets the board from GitHub into a
# folder you choose, installs the Workers mod as `npm run setup` does (never over a newer one), and ends with the
# new-project flow (`npm run new`), which makes your first project and its icon. Run again, it checks what is there
# and redoes nothing. Settings, all optional:
#
#   $env:WORKER_BOARD_FOLDER  where the board goes (asked; the folder worker-board in your home folder unless set)
#   $env:WORKER_BOARD_REPO    the repository it is cloned from (the board's own on GitHub unless set)
#   $env:WORKER_BOARD_CHECK   1: only check, change nothing
#
# It runs in a scope of its own, so nothing it sets stays in your PowerShell, and it never closes the window.

& {
  $ErrorActionPreference = 'Stop'
  $NODE_MAJOR = 24
  $REPO = 'https://github.com/bobduncan/Worker-board.git'
  $CLAUDE_DOWNLOAD = 'https://claude.ai/download'
  $NODE_DOWNLOAD = 'https://nodejs.org'
  $GIT_DOWNLOAD = 'https://git-scm.com/download/win'

  function Write-Line([string]$mark, [string]$text) {
    $colour = @{ 'ok' = 'Green'; '--' = 'Yellow'; '!!' = 'Red'; '..' = 'Gray' }[$mark]
    Write-Host ("[{0}] {1}" -f $mark, $text) -ForegroundColor $colour
  }

  function Test-IsWindows { [Environment]::OSVersion.Platform -eq 'Win32NT' }

  # The major version in what `node --version` prints ("v24.1.0" is 24); nothing when it is no version.
  function Get-NodeMajor([string]$version) {
    if ($version -match '^v?(\d+)\.') { return [int]$Matches[1] }
  }

  function Test-Command([string]$name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

  # Where the Claude desktop app is installed: the Store's package, or the folders it makes; nothing when it is not.
  function Find-ClaudeApp {
    if (-not $env:WORKER_BOARD_NO_PACKAGES -and (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue)) {
      $package = Get-AppxPackage -Name 'Claude' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($package) { return $package.InstallLocation }
    }
    if ($env:LOCALAPPDATA) {
      $packages = Join-Path $env:LOCALAPPDATA 'Packages'
      if (Test-Path -LiteralPath $packages) {
        $found = Get-ChildItem -LiteralPath $packages -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return $found.FullName }
      }
      $classic = Join-Path $env:LOCALAPPDATA 'AnthropicClaude'
      if (Test-Path -LiteralPath $classic) { return $classic }
    }
    if ($env:APPDATA) {
      $roaming = Join-Path $env:APPDATA 'Claude'
      if (Test-Path -LiteralPath $roaming) { return $roaming }
    }
  }

  # The folder the board goes into unless you name another.
  function Get-DefaultFolder {
    if ($env:WORKER_BOARD_FOLDER) { return $env:WORKER_BOARD_FOLDER }
    return (Join-Path $HOME 'worker-board')
  }

  # 'board' when the folder holds the board already, 'empty' when it is new or empty, else 'other'.
  function Get-BoardFolderState([string]$folder) {
    if (-not (Test-Path -LiteralPath $folder)) { return 'empty' }
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) { return 'other' }
    $package = Join-Path $folder 'package.json'
    if ((Test-Path -LiteralPath (Join-Path $folder 'server.mjs')) -and (Test-Path -LiteralPath $package)) {
      try { if ((Get-Content -Raw -LiteralPath $package | ConvertFrom-Json).name -eq 'worker-board') { return 'board' } } catch { }
    }
    if (@(Get-ChildItem -LiteralPath $folder -Force).Count -eq 0) { return 'empty' }
    return 'other'
  }

  # The projects of the PC's list of boards (B319) whose folder is still there.
  function Get-Projects([string]$file) {
    if (-not (Test-Path -LiteralPath $file)) { return @() }
    try { $list = Get-Content -Raw -LiteralPath $file | ConvertFrom-Json } catch { return @() }
    return @($list.boards | Where-Object { $_.project -and (Test-Path -LiteralPath $_.project) } | ForEach-Object { $_.project })
  }

  # The PATH as Windows has it now, so a program winget just installed is found in this window.
  function Update-SessionPath {
    $env:Path = (@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) | Where-Object { $_ }) -join ';'
  }

  function Read-YesNo([string]$question, [bool]$yes = $true) {
    $answer = Read-Host ("{0} [{1}]" -f $question, $(if ($yes) { 'Y/n' } else { 'y/N' }))
    if ([string]::IsNullOrWhiteSpace($answer)) { return $yes }
    return $answer.Trim().ToLower().StartsWith('y')
  }

  # Offers to install (or bring up to date) a program with winget; true when it is done.
  function Install-WithWinget([string]$what, [string]$id, [string]$download, [string]$verb = 'install') {
    if (-not (Test-Command 'winget')) {
      Write-Line '!!' "$what is needed, and winget is not here to install it: get it from $download, then run this again."
      return $false
    }
    if (-not (Read-YesNo "Install $what with winget now?")) {
      Write-Line '!!' "$what is needed: get it from $download, then run this again."
      return $false
    }
    & winget $verb --id $id --exact
    Update-SessionPath
    return $true
  }

  function Test-Node {
    if (-not (Test-Command 'node')) { return $null }
    return Get-NodeMajor (& node --version)
  }

  function Install-WorkerBoard {
    $isCheck = [bool]$env:WORKER_BOARD_CHECK
    Write-Host 'The worker board: checking this PC.'

    if (-not (Test-IsWindows)) { Write-Line '!!' 'This needs Windows.'; return }
    Write-Line 'ok' 'Windows'

    $app = Find-ClaudeApp
    if (-not $app) {
      Write-Line '!!' "The Claude desktop app is not installed: get it from $CLAUDE_DOWNLOAD, open it once, then run this again."
      return
    }
    Write-Line 'ok' 'The Claude desktop app'

    $node = Test-Node
    if ($node -ge $NODE_MAJOR) { Write-Line 'ok' "Node $node" }
    elseif ($isCheck) { Write-Line '--' $(if ($node) { "Node $node is older than $NODE_MAJOR" } else { 'Node is not installed' }) }
    else {
      Write-Line '--' $(if ($node) { "Node $node is older than $NODE_MAJOR." } else { 'Node is not installed.' })
      if (-not (Install-WithWinget "Node $NODE_MAJOR" 'OpenJS.NodeJS.LTS' $NODE_DOWNLOAD $(if ($node) { 'upgrade' } else { 'install' }))) { return }
      $node = Test-Node
      if (-not ($node -ge $NODE_MAJOR)) { Write-Line '!!' "Node $NODE_MAJOR is still not found: close this window, open a new PowerShell and run this again."; return }
      Write-Line 'ok' "Node $node"
    }

    if (Test-Command 'git') { Write-Line 'ok' 'git' }
    elseif ($isCheck) { Write-Line '--' 'git is not installed' }
    else {
      Write-Line '--' 'git is not installed.'
      if (-not (Install-WithWinget 'git' 'Git.Git' $GIT_DOWNLOAD)) { return }
      if (-not (Test-Command 'git')) { Write-Line '!!' 'git is still not found: close this window, open a new PowerShell and run this again.'; return }
      Write-Line 'ok' 'git'
    }

    if ($isCheck) { Write-Host 'Check only: nothing was changed.'; return }

    # The board: kept as it is when it is there, else cloned into a folder of your choice.
    $default = Get-DefaultFolder
    $folder = if ($env:WORKER_BOARD_FOLDER) { $default } else { Read-Host "Where should the board go? [$default]" }
    if ([string]::IsNullOrWhiteSpace($folder)) { $folder = $default }
    $folder = [IO.Path]::GetFullPath($folder.Trim())
    switch (Get-BoardFolderState $folder) {
      'board' { Write-Line 'ok' "The board is there already: $folder (to bring it up to date: git -C `"$folder`" pull)" }
      'empty' {
        $repo = if ($env:WORKER_BOARD_REPO) { $env:WORKER_BOARD_REPO } else { $REPO }
        Write-Line '..' "Getting the board from $repo"
        & git clone --quiet $repo $folder
        if ($LASTEXITCODE -ne 0) { Write-Line '!!' "git could not get the board from $repo."; return }
        Write-Line 'ok' "The board: $folder"
      }
      default { Write-Line '!!' "$folder holds something else: name an empty folder, or one that holds the board."; return }
    }

    # The Workers mod, one per PC: setup recognises a copy that is there and never installs over a newer one.
    Write-Line '..' 'The Workers mod'
    & node (Join-Path $folder 'setup.mjs')
    if ($LASTEXITCODE -ne 0) { Write-Line '--' 'The Workers mod is not installed (see above): the board works without it, and npm run setup in its folder tries again.' }

    # The first project; run again, it only offers another.
    $projects = Get-Projects (Join-Path (Join-Path $HOME '.worker-board') 'boards.json')
    if ($projects.Count -gt 0) {
      Write-Line 'ok' ("Projects on this PC: {0}" -f ($projects -join ', '))
      if (-not (Read-YesNo 'Make another project now?' $false)) { Write-Host 'Done: each project has its icon "<name> board" on the desktop.'; return }
    } else {
      Write-Host 'Now your first project: its name, its folder and how its chats are titled.'
    }
    & node (Join-Path $folder 'tools\new-project.mjs')
  }

  if ($env:WORKER_BOARD_TEST) { Invoke-Expression $env:WORKER_BOARD_TEST; return }
  Install-WorkerBoard
}
