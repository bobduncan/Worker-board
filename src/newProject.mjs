// B320: a new project in one click. One flow, from `npm run new` (tools/new-project.mjs) or the board's New project
// button (POST /api/new-project): a name, a folder and the chats' prefix, asked once. A folder that is not empty is
// refused, so nothing is ever overwritten. Then: the folder with git, a README, the project's own copy of the board at
// the version of the board that makes it, its settings, the list of chats, an empty work store with the default flow,
// the launch entry on a port of its own (B319), the project's CLAUDE.md and briefings, an icon "<name> board" on the
// desktop and in the Start menu that starts the board and opens its page, and the board started. Windows only; a new
// project has no game until one is added by hand.

import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { gitRunner } from './folders.mjs'
import { boardsFile, launchEntry, registerHome, resolvePort, withEntry } from './ports.mjs'

/** The folder of the board's own copy inside a new project: its launch entry is named after it. */
export const BOARD_FOLDER = 'worker-board'
/** What a copy of the board needs when it cannot be cloned with git (a plain copy of the board's folder). */
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'setup.mjs', 'package.json', 'README.md', 'src', 'public', 'roles', 'examples', 'fixtures', 'mods', 'tools']

const refuse = (status, why) => ({ ok: false, status, why })

/**
 * What the person gave, checked: `{ ok, name, folder, prefix }`, the prefix "<name> - " unless given, or `{ ok: false,
 * why }`. The name becomes the icon's file name, so it holds none of the characters a file name cannot.
 */
export function checkNewProject({ name, folder, prefix } = {}) {
  const named = typeof name === 'string' ? name.trim() : ''
  if (named === '' || named.length > 60 || /[\\/:*?"<>|]/.test(named)) {
    return { ok: false, why: 'Give the project a name of up to 60 characters, without \\ / : * ? " < > |.' }
  }
  const at = typeof folder === 'string' ? folder.trim() : ''
  if (at === '') return { ok: false, why: 'Give the project\'s folder.' }
  if (!isAbsolute(at) || !/^([A-Za-z]:[\\/]|\\\\|\/)/.test(at)) return { ok: false, why: `Give the folder as a whole path, such as D:\\Work\\${named}.` }
  const given = typeof prefix === 'string' ? prefix.replace(/^\s+/, '') : ''
  if (given.length > 40) return { ok: false, why: 'Keep the chats\' prefix to 40 characters.' }
  return { ok: true, name: named, folder: at, prefix: given.trim() === '' ? `${named} - ` : given }
}

/** True when the folder is not there yet, or is an empty folder: only then is a project made in it. */
export async function folderIsFree(folder) {
  const found = await stat(folder).catch(() => null)
  if (found === null) return true
  if (!found.isDirectory()) return false
  return (await readdir(folder)).length === 0
}

const fill = (text, words) => Object.entries(words).reduce((done, [key, value]) => done.replaceAll(`<${key}>`, value), text)

/**
 * The project's files, as text by their path in the project (`files`), and the board copy's `config` (config.json),
 * from the board's examples (`examples`: `config`, `flow`, `claude`, `mainBriefing`, `workerBriefing`). `port` is the
 * board's, once it is known.
 */
export function projectFiles({ name, prefix, project, board, port = null, examples }) {
  const config = { ...JSON.parse(examples.config), name, project, gameRepo: '' }
  const words = { name, prefix, project, board, ...(port === null ? {} : { port: String(port) }) }
  // A briefing made from the board's example: its first words say it is filled in, not to be copied.
  const briefing = text => fill(text.replace(/^Copy this file to `<project>\\\.claude\\[\w-]+\.md` and fill it in\. /m, 'Made by the worker board for this project: fill in what still stands in angle brackets. '), words)
  const files = {
    'README.md': [
      `# ${name}`,
      '',
      'A project worked on by Claude chats with the worker board (one page on this PC for the chats, their steps and',
      'what is yours to answer).',
      '',
      `- The board: \`${BOARD_FOLDER}\`, its own copy. The icon "${name} board" on the desktop and in the Start menu starts it`,
      `  and opens its page${port === null ? '' : `, http://127.0.0.1:${port}/`}.`,
      `- The chats: titled "${prefix}Main" for the main chat and "${prefix}Worker 1" and on for the workers.`,
      '- How every chat answers you: `CLAUDE.md`. The project\'s own facts for the chats: `.claude/main-briefing.md` and',
      '  `.claude/worker-briefing.md`.',
      '- The work: `.claude/work`, kept by the board (the chats change it with their work tool).',
      '',
    ].join('\n'),
    // The board's copy is a repository of its own; what the chats write stays out of the project's.
    '.gitignore': `${BOARD_FOLDER}/\n.claude/\n`,
    'CLAUDE.md': fill(examples.claude, words),
    '.claude/chats/list.json': `${JSON.stringify({ prefix, main: 'Main' }, null, 2)}\n`,
    '.claude/work/flow.json': examples.flow,
    '.claude/work/last-ids.json': '{}\n',
    '.claude/work/activities.json': `${JSON.stringify({ preamble: ['# Backlog'], activities: [{ name, isFocus: true, steps: [], notes: [], loose: [] }] }, null, 1)}\n`,
    '.claude/main-briefing.md': briefing(examples.mainBriefing),
    '.claude/worker-briefing.md': briefing(examples.workerBriefing),
  }
  return { files, config: `${JSON.stringify(config, null, 2)}\n` }
}

const quoted = text => `'${String(text).replaceAll("'", "''")}'`

/**
 * The PowerShell that puts the icon "<name>.lnk" on the person's desktop and in the Start menu's programs: it runs
 * `target` with `args` in `cwd`, minimised (the start script ends once the board runs), with the board's icon.
 */
export function shortcutScript({ name, target, args, cwd, icon }) {
  return [
    '$ErrorActionPreference = \'Stop\'',
    '$shell = New-Object -ComObject WScript.Shell',
    "foreach ($place in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {",
    `  $link = $shell.CreateShortcut((Join-Path $place ${quoted(`${name}.lnk`)}))`,
    `  $link.TargetPath = ${quoted(target)}`,
    `  $link.Arguments = ${quoted(args)}`,
    `  $link.WorkingDirectory = ${quoted(cwd)}`,
    `  $link.IconLocation = ${quoted(`${icon},0`)}`,
    `  $link.Description = ${quoted(`Starts the worker board of ${name.replace(/ board$/, '')} and opens its page`)}`,
    '  $link.WindowStyle = 7',
    '  $link.Save()',
    '}',
  ].join('\n')
}

/** Runs a program to its end: `{ code, out }`; never throws. */
function runOnce(program, args, options = {}) {
  return new Promise(done => {
    const child = spawn(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { out += chunk })
    child.once('error', error => done({ code: -1, out: error.message }))
    child.once('exit', code => done({ code: code ?? 1, out }))
  })
}

/** Makes the icons with Windows' own PowerShell. */
export async function makeShortcuts(shortcut) {
  const answer = await runOnce('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', shortcutScript(shortcut)])
  if (answer.code !== 0) throw new Error(answer.out.trim().split('\n').at(-1) || 'PowerShell could not make the icons.')
}

/** Starts the new project's board in the background and opens its page (start-board.mjs --open). */
export async function startBoard(board) {
  const answer = await runOnce(process.execPath, [join(board, 'start-board.mjs'), '--open'], { cwd: board })
  return { ok: answer.code === 0, line: answer.out.trim().split('\n').at(-1) ?? '' }
}

/**
 * The board's own copy in `to`, at the version of the board in `from`: a clone of its repository at the same commit
 * (the copy's origin is the one `from` has, so it is brought up to date from there), or, for a board that is no
 * repository, a plain copy of its files.
 */
async function copyBoard(from, to, run) {
  const head = (await run(['-C', from, 'rev-parse', 'HEAD']))?.trim()
  if (head) {
    const cloned = await runOnce('git', ['clone', '--quiet', '--no-hardlinks', from, to])
    if (cloned.code !== 0) throw new Error(`git could not copy the board: ${cloned.out.trim().split('\n').at(-1)}`)
    await run(['-C', to, 'reset', '--quiet', '--hard', head])
    const origin = (await run(['-C', from, 'remote', 'get-url', 'origin']))?.trim()
    if (origin) await run(['-C', to, 'remote', 'set-url', 'origin', origin])
    return
  }
  for (const part of COPIED) {
    if (await stat(join(from, part)).then(() => true, () => false)) await cp(join(from, part), join(to, part), { recursive: true })
  }
}

/**
 * The whole flow (see the top of this file): `here` is the board that makes the project, `boards` the PC's list of
 * boards (B319), `shortcuts` makes the icons, `start` starts the new board (both stand-ins in the tests). Answers
 * `{ ok, project, board, port, url, lines }`, or `{ ok: false, status, why }` with nothing made.
 */
export async function makeProject({ name, folder, prefix, here, boards = boardsFile(), run = gitRunner(), shortcuts = makeShortcuts, start = startBoard, node = process.execPath }) {
  const checked = checkNewProject({ name, folder, prefix })
  if (!checked.ok) return refuse(400, checked.why)
  const project = resolve(checked.folder)
  if (!(await folderIsFree(project))) return refuse(409, `${project} is not empty: a new project is made only in an empty folder or a new one, so nothing is overwritten.`)

  const lines = []
  const board = join(project, BOARD_FOLDER)
  try {
    await mkdir(project, { recursive: true })
    const initialised = await runOnce('git', ['init', '--quiet', project])
    lines.push(initialised.code === 0 ? `Made ${project}, a git repository.` : `Made ${project} (git is not there: no repository).`)

    await copyBoard(here, board, run)
    const read = path => readFile(join(here, path), 'utf8')
    const examples = {
      config: await read('examples/config.json'), flow: await read('examples/work/flow.json'), claude: await read('examples/CLAUDE.md'),
      mainBriefing: await read('examples/main-briefing.md'), workerBriefing: await read('examples/worker-briefing.md'),
    }
    const first = projectFiles({ name: checked.name, prefix: checked.prefix, project, board, examples })
    await writeFile(join(board, 'config.json'), first.config)
    lines.push(`Its own copy of the board: ${board}.`)

    // The port of its own (B319): kept for it in the PC's list from now on, and named in its launch entry.
    const config = JSON.parse(first.config)
    const chosen = await resolvePort({ here: board, configured: config.port, gamePort: config.gamePort, project, boards, run })
    await registerHome(boards, { project, folder: board, port: chosen.port, gamePort: chosen.gamePort, asked: { port: config.port, gamePort: config.gamePort } })
    const made = projectFiles({ name: checked.name, prefix: checked.prefix, project, board, port: chosen.port, examples })
    for (const [path, text] of Object.entries(made.files)) {
      await mkdir(dirname(join(project, path)), { recursive: true })
      await writeFile(join(project, path), text)
    }
    const entry = launchEntry({ folder: board, port: chosen.port, node })
    await writeFile(join(project, '.claude', 'launch.json'), withEntry('', entry))
    lines.push(`Its board's port: ${chosen.port}${chosen.why === 'moved' ? ` (${config.port} is another project's board's)` : ''}; the chats' prefix: "${checked.prefix}".`)

    const icon = { name: `${checked.name} board`, target: node, args: `"${join(board, 'start-board.mjs')}" --open`, cwd: board, icon: join(board, 'public', 'board.ico') }
    try {
      await shortcuts(icon)
      lines.push(`The icon "${icon.name}" is on your desktop and in the Start menu.`)
    } catch (error) {
      lines.push(`The icon "${icon.name}" could not be made (${error.message}): start the board with: node "${join(board, 'start-board.mjs')}" --open`)
    }
    const started = await start(board)
    lines.push(started.ok ? `The board runs: http://127.0.0.1:${chosen.port}/` : `The board did not start: ${started.line ?? ''} Start it with its icon.`)
    return { ok: true, project, board, port: chosen.port, url: `http://127.0.0.1:${chosen.port}/`, lines }
  } catch (error) {
    return { ok: false, status: 500, why: `The project was not finished: ${error instanceof Error ? error.message : String(error)}. What was made is in ${project}.` }
  }
}
