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
#   $env:WORKER_BOARD_HOME    where the PC's list of boards is (the folder .worker-board in your home folder unless set)
#   $env:WORKER_BOARD_PROJECT, $env:WORKER_BOARD_PROJECT_FOLDER, $env:WORKER_BOARD_PREFIX
#                             the new project's name, folder and chats' prefix, given up front: no question is asked
#
# It runs in a scope of its own and never closes the window. The one thing it leaves in your PowerShell: a program
# winget installs is added to this window's PATH, so it is found at once.

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
    # Review: %APPDATA%\Claude is not asked: an uninstalled app leaves it behind.
  }

  # Where the PC's list of boards (B319) and what this script remembers are.
  function Get-BoardsHome {
    if ($env:WORKER_BOARD_HOME) { return $env:WORKER_BOARD_HOME }
    return (Join-Path $HOME '.worker-board')
  }

  # The folder the board goes into unless you name another: the one it was installed in before, while it holds it.
  function Get-DefaultFolder {
    if ($env:WORKER_BOARD_FOLDER) { return $env:WORKER_BOARD_FOLDER }
    $remembered = Join-Path (Get-BoardsHome) 'installed.json'
    if (Test-Path -LiteralPath $remembered) {
      try {
        $folder = (Get-Content -Raw -LiteralPath $remembered | ConvertFrom-Json).board
        if ($folder -and (Get-BoardFolderState $folder) -eq 'board') { return $folder }
      } catch { }
    }
    return (Join-Path $HOME 'worker-board')
  }

  # Remembers the board's folder, so a run again offers it.
  function Save-BoardFolder([string]$folder) {
    $place = Get-BoardsHome
    New-Item -ItemType Directory -Force -Path $place | Out-Null
    @{ board = $folder } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $place 'installed.json') -Encoding UTF8
  }

  # A folder as typed: without quotes around it (Explorer's Copy as path), ~ for the home folder, relative to the folder
  # PowerShell is in, without a last \ (git takes `D:\My Boards\"` for a quote).
  function Resolve-TypedFolder([string]$typed, [string]$base) {
    $text = $typed.Trim()
    if ($text.Length -ge 2 -and (($text[0] -eq '"' -and $text[-1] -eq '"') -or ($text[0] -eq "'" -and $text[-1] -eq "'"))) { $text = $text.Substring(1, $text.Length - 2).Trim() }
    if ($text -eq '~') { $text = $HOME } elseif ($text -match '^~[\\/]') { $text = Join-Path $HOME $text.Substring(2) }
    if (-not [IO.Path]::IsPathRooted($text)) { $text = Join-Path $base $text }
    $full = [IO.Path]::GetFullPath($text)
    if ($full.Length -gt 3) { $full = $full.TrimEnd('\') }
    return $full
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
  function Get-Projects {
    $file = Join-Path (Get-BoardsHome) 'boards.json'
    if (-not (Test-Path -LiteralPath $file)) { return @() }
    try { $list = Get-Content -Raw -LiteralPath $file | ConvertFrom-Json } catch { return @() }
    return @($list.boards | Where-Object { $_.project -and (Test-Path -LiteralPath $_.project) } | ForEach-Object { $_.project })
  }

  # The PATH as Windows has it now added to this window's, so a program winget just installed is found here; what the
  # window had stays.
  function Update-SessionPath {
    $have = @($env:Path -split ';' | Where-Object { $_ })
    $new = @(@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) -join ';' -split ';' | Where-Object { $_ -and ($have -notcontains $_) })
    if ($new.Count -gt 0) { $env:Path = (@($have) + $new) -join ';' }
  }

  # Only `1`, `true` or `yes` asks for a check only.
  function Test-IsCheck { @('1', 'true', 'yes') -contains "$env:WORKER_BOARD_CHECK".Trim().ToLower() }

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
    if (-not (Read-YesNo "$(if ($verb -eq 'upgrade') { 'Bring' } else { 'Install' }) $what with winget now? (This accepts the terms of winget's source and of the package.)")) {
      Write-Line '!!' "$what is needed: get it from $download, then run this again."
      return $false
    }
    # winget's own words show (review): its questions and its progress go to the screen, never into this function's answer.
    & winget $verb --id $id --exact --source winget --accept-source-agreements --accept-package-agreements | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Line '!!' "winget could not $verb $what (code $LASTEXITCODE): get it from $download, then run this again."
      return $false
    }
    Update-SessionPath
    return $true
  }

  # B324: the new project's name, folder and chats' prefix when given as settings, as new-project.mjs takes them.
  function Get-NewProjectArgs {
    $words = @()
    if ($env:WORKER_BOARD_PROJECT) { $words += @('--name', $env:WORKER_BOARD_PROJECT) } else { return @() }
    if ($env:WORKER_BOARD_PROJECT_FOLDER) { $words += @('--folder', $env:WORKER_BOARD_PROJECT_FOLDER) }
    if ($env:WORKER_BOARD_PREFIX) { $words += @('--prefix', $env:WORKER_BOARD_PREFIX) }
    return $words
  }

  function Test-Node {
    if (-not (Test-Command 'node')) { return $null }
    return Get-NodeMajor (& node --version)
  }

  function Install-WorkerBoard {
    $isCheck = Test-IsCheck
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
      # Review: another Node found first (from nodejs.org, nvm and the like) is not one winget brings up to date.
      if (-not ($node -ge $NODE_MAJOR)) { Write-Line '!!' "Node $NODE_MAJOR is still not the one found here$(if ($node) { " (Node $node is)" }): install Node $NODE_MAJOR from $NODE_DOWNLOAD (or remove the older Node), open a new PowerShell and run this again."; return }
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
    $typed = if ($env:WORKER_BOARD_FOLDER) { $default } else { Read-Host "Where should the board go? [$default]" }
    if ([string]::IsNullOrWhiteSpace($typed)) { $typed = $default }
    $folder = Resolve-TypedFolder $typed $PWD.Path
    switch (Get-BoardFolderState $folder) {
      'board' { Write-Line 'ok' "The board is there already: $folder (to bring it up to date: git -C `"$folder`" pull)" }
      'empty' {
        $repo = if ($env:WORKER_BOARD_REPO) { $env:WORKER_BOARD_REPO } else { $REPO }
        Write-Line '..' "Getting the board from $repo"
        & git clone --quiet $repo $folder
        if ($LASTEXITCODE -ne 0) { Write-Line '!!' "git could not get the board from $repo."; return }
        Write-Line 'ok' "The board: $folder"
      }
      default { Write-Line '!!' "$folder holds something else: name an empty folder, or one that holds the board. (A run cut off while getting the board leaves part of it: delete that folder and run this again.)"; return }
    }

    Save-BoardFolder $folder

    # The Workers mod, one per PC: setup recognises a copy that is there and never installs over a newer one.
    Write-Line '..' 'The Workers mod'
    & node (Join-Path $folder 'setup.mjs')
    if ($LASTEXITCODE -ne 0) { Write-Line '--' "The Workers mod is not installed (see above): the board works without it, and node setup.mjs in $folder tries again." }

    # The first project; run again, it only offers another. B324: given by name (WORKER_BOARD_PROJECT), it is made
    # without a question, for a window where nobody types.
    $given = @(Get-NewProjectArgs)
    $projects = @(Get-Projects)
    if ($given.Count -eq 0 -and $projects.Count -gt 0) {
      Write-Line 'ok' ("Projects on this PC: {0}" -f ($projects -join ', '))
      if (-not (Read-YesNo 'Make another project now?' $false)) { Write-Host 'Done: each project has its icon "<name> board" on the desktop.'; return }
    } elseif ($given.Count -eq 0) {
      Write-Host 'Now your first project: its name, its folder and how its chats are titled.'
    }
    & node (Join-Path $folder 'tools\new-project.mjs') @given
  }

  if ($env:WORKER_BOARD_TEST) { Invoke-Expression $env:WORKER_BOARD_TEST; return }
  Install-WorkerBoard
}
