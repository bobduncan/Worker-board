// B321: one command, pasted from the README into PowerShell, takes a Windows PC from nothing to a first running
// project: it checks Windows, the Claude desktop app, Node 24 or newer and git (one line each; Node and git it offers
// to install with winget), gets the board from GitHub, installs the Workers mod as `npm run setup` does, and ends with
// the new-project flow (B320). Run again, it checks what is there and redoes nothing. The person, 2026-10-18 15:26:
// "windows only and claude only. Preferably its own installer who checks if you have claude, windows, node installed
// in order to run the worker board. with an icon to run it." Q4: one command now, a real installer later.
// The script's parts run here through Windows PowerShell, as `irm ... | iex` runs it; nothing is installed.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'tools', 'install.ps1')
const isWindows = process.platform === 'win32'

/** Runs the script as the README's command does (its text through Invoke-Expression), with `env`; `{ status, out }`. */
function run(env = {}) {
  const ran = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Content -Raw -LiteralPath $env:WB_SCRIPT | Invoke-Expression`], {
    encoding: 'utf8', env: { ...process.env, WB_SCRIPT: SCRIPT, ...env }, timeout: 60_000, windowsHide: true,
  })
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}`.replace(/\r/g, '').trim() }
}
/** One of the script's own parts, called inside it (WORKER_BOARD_TEST). */
const part = (call, env = {}) => run({ ...env, WORKER_BOARD_TEST: call }).out

async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'board-install-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('the script is plain ASCII, so Windows PowerShell 5.1 reads it the same from a file and from GitHub', async () => {
  const text = await readFile(SCRIPT, 'utf8')
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text), 'a character above ASCII')
  // It runs in a scope of its own and never ends the person's PowerShell window.
  assert.match(text, /^& \{/m)
  assert.ok(!/^\s*exit\b/im.test(text), 'exit would close the window the command was pasted into')
})

test('the script has no syntax error', { skip: !isWindows }, () => {
  const ran = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:WB_SCRIPT, [ref]$null, [ref]$errors); $errors.Count'],
  { encoding: 'utf8', env: { ...process.env, WB_SCRIPT: SCRIPT }, windowsHide: true })
  assert.equal(ran.stdout.trim(), '0', ran.stdout + ran.stderr)
})

test('Node: the major version from what node --version prints; 24 or newer is enough', { skip: !isWindows }, () => {
  assert.equal(part("Get-NodeMajor 'v24.1.0'"), '24')
  assert.equal(part("Get-NodeMajor 'v22.11.0'"), '22')
  assert.equal(part("[string](Get-NodeMajor 'not a version')"), '')
  assert.equal(part('$NODE_MAJOR'), '24')
})

test('the board\'s folder: one that holds a board is kept as it is; a new or empty one gets it; anything else is refused', { skip: !isWindows }, async t => {
  const dir = await folder(t)
  const ask = path => part(`Get-BoardFolderState '${path.replaceAll("'", "''")}'`)
  assert.equal(ask(join(dir, 'new')), 'empty')
  await mkdir(join(dir, 'empty'))
  assert.equal(ask(join(dir, 'empty')), 'empty')
  await mkdir(join(dir, 'other'))
  await writeFile(join(dir, 'other', 'notes.txt'), 'x')
  assert.equal(ask(join(dir, 'other')), 'other')
  await mkdir(join(dir, 'board'))
  await writeFile(join(dir, 'board', 'server.mjs'), '')
  await writeFile(join(dir, 'board', 'package.json'), JSON.stringify({ name: 'worker-board' }))
  assert.equal(ask(join(dir, 'board')), 'board')
  // The folder the board goes into unless the person names another; WORKER_BOARD_FOLDER sets it.
  const home = { WORKER_BOARD_HOME: join(dir, 'pc') }
  assert.match(part('Get-DefaultFolder', home), /\\worker-board$/)
  assert.equal(part('Get-DefaultFolder', { ...home, WORKER_BOARD_FOLDER: 'E:\\boards\\wb' }), 'E:\\boards\\wb')
  // Review: the folder of a board installed before is the one offered again, so a second run never clones a second.
  assert.equal(part(`Save-BoardFolder '${join(dir, 'board')}'; Get-DefaultFolder`, home), join(dir, 'board'))
  await rm(join(dir, 'board'), { recursive: true })
  assert.match(part('Get-DefaultFolder', home), /\\worker-board$/)
})

test('a typed folder: quotes, ~, a folder relative to the one PowerShell is in, and a last \\ are taken as meant', { skip: !isWindows }, async t => {
  const dir = await folder(t)
  const typed = (text, base = dir) => part(`Resolve-TypedFolder '${text.replaceAll("'", "''")}' '${base}'`)
  assert.equal(typed('"D:\\My Boards\\"'), 'D:\\My Boards')
  assert.equal(typed("'D:\\My Boards'"), 'D:\\My Boards')
  assert.equal(typed('  D:\\x\\  '), 'D:\\x')
  assert.equal(typed('D:\\'), 'D:\\')
  assert.equal(typed('board'), join(dir, 'board'))
  assert.equal(typed('..\\board'), join(dirname(dir), 'board'))
  assert.match(typed('~\\boards'), /\\boards$/)
  assert.ok(!typed('~\\boards').includes('~'))
})

test('the projects on this PC: from the list of boards (B319), those whose folder is still there', { skip: !isWindows }, async t => {
  const dir = await folder(t)
  const home = { WORKER_BOARD_HOME: dir }
  assert.equal(part('@(Get-Projects).Count', home), '0')
  await mkdir(join(dir, 'garden'))
  await writeFile(join(dir, 'boards.json'), JSON.stringify({ boards: [{ project: join(dir, 'garden'), port: 4313, gamePort: 5400 }, { project: join(dir, 'gone'), port: 4314, gamePort: 5500 }] }))
  assert.equal(part('(Get-Projects) -join \';\'', home), join(dir, 'garden'))
})

test('winget is asked with its terms named in the question, shows its own words, and a failure is said', async () => {
  const text = await readFile(SCRIPT, 'utf8')
  assert.match(text, /& winget \$verb --id \$id --exact --source winget --accept-source-agreements --accept-package-agreements \| Out-Host/)
  assert.match(text, /accepts the terms/)
  assert.match(text, /if \(\$LASTEXITCODE -ne 0\)/)
  // The hint when the mod is not installed is a command that runs whatever PowerShell lets scripts do.
  assert.ok(!text.includes('npm run setup in its folder'))
  assert.match(text, /node setup\.mjs/)
})

test('the Claude desktop app is found where it installs, else the script says where to get it', { skip: !isWindows }, async t => {
  const dir = await folder(t)
  // A PC with no trace of the app: no package, no folders.
  const none = { APPDATA: join(dir, 'roaming'), LOCALAPPDATA: join(dir, 'local'), WORKER_BOARD_NO_PACKAGES: '1' }
  assert.equal(part('[string](Find-ClaudeApp)', none), '')
  await mkdir(join(dir, 'local', 'Packages', 'Claude_abc123'), { recursive: true })
  assert.equal(part('[string](Find-ClaudeApp)', none), join(dir, 'local', 'Packages', 'Claude_abc123'))
  assert.match(part('$CLAUDE_DOWNLOAD'), /^https:\/\/claude\.ai\/download$/)
})

test('a check only: one line for each of Windows, the Claude app, Node and git, and nothing is changed', { skip: !isWindows }, () => {
  const checked = run({ WORKER_BOARD_CHECK: '1' })
  assert.equal(checked.status, 0, checked.out)
  assert.match(checked.out, /\[ok\] Windows/)
  // Review: whatever this PC has; without the app the check stops there and says where to get it.
  if (part('[string](Find-ClaudeApp)') === '') return assert.match(checked.out, /\[!!\] The Claude desktop app is not installed: get it from https:\/\/claude\.ai\/download/)
  for (const line of [/\[ok\] The Claude desktop app/, /\[(ok|--)\] Node/, /\[(ok|--)\] git/, /Check only: nothing was changed\./]) assert.match(checked.out, line)
  // A check is a check: 0 or no is no check.
  assert.equal(part('[string](Test-IsCheck)', { WORKER_BOARD_CHECK: '0' }), 'False')
  assert.equal(part('[string](Test-IsCheck)', { WORKER_BOARD_CHECK: '1' }), 'True')
})

test('the README holds the one command', async () => {
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8')
  assert.match(readme, /irm https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\/main\/tools\/install\.ps1 \| iex/)
})
