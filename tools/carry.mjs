// T5 B1 (2026-11-16): the carry commands: the board's data to and from another PC, as `npm run save` and `npm run load`.
//
//   node tools/carry.mjs save [--dry-run] [--practice] [--data <folder>] [--remote <url>] [--pictures <folder>] [--keep-set <file>]
//                             [--journal <file>] [--no-branches] [--anyway B<id>]...
//   node tools/carry.mjs load [--dry-run] [--practice] [--data <folder>] [--remote <url>] [--pictures <folder>] [--journal <file>]
//                             [--park] [--undo <stamp>] [--user-settings] [--pictures-only] [--project <folder>] [--game <folder>]
//
// save copies the project's board data into the data folder (default `<gameRepo>/.workerboard`, a nested clone of the game repo's
// origin, branch `workerboard-data`, or `workerboard-practice` with --practice), commits and pushes it, pushes the open steps'
// branches (final saves only), and copies the pictures into the Drive folder. load puts it all back on the other PC (`load --pictures
// <folder>` is a full load that also copies the pictures; `--pictures-only` runs the pictures step again after a load). Every root comes
// from the board folder this file lives in (its config.json, read only), never from boards.json or another checkout. The live board
// keeps reading its data where it is: nothing it runs changes. The PC-local record is data/carry.json (or `<data folder>.carry.json`
// beside an explicit --data). The parts: src/carry/* (B1: this command line, the guards, git, times, the record; B2: set.mjs, what
// travels; B3: pictures.mjs, the Drive folder).

import { appendFile, mkdir, readFile, writeFile, rm, stat, readdir, utimes, copyFile, statfs, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expandEnv, loadConfig, settingsFileOf, transcriptsOf, workFolder } from '../src/config.mjs'
import { chatFile, chatHomeOf, dataOf } from '../src/projectPaths.mjs'
import { boardsFile, readBoards, readOwnPort, whoseBoard } from '../src/ports.mjs'
import { LIST_SCRIPT, keepersOf, parseProcessList, powershell } from '../src/keeperStart.mjs'
import { lockHolder } from '../src/landing.mjs'
import { userCodexHome } from '../src/codex.mjs'
import { readKey } from '../src/providers/elevenlabs-key.mjs'
import { gitRunner, line } from '../src/carry/git.mjs'
import { recordFileFor, readRecord } from '../src/carry/record.mjs'
import { secretValuesOf } from '../src/carry/guards.mjs'
import { save } from '../src/carry/save.mjs'
import { load } from '../src/carry/load.mjs'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const fs = { readFile, writeFile, mkdir, rm, stat, readdir, utimes, copyFile, access }

/** The flags read: `{ command, flags: { name: value | true }, anyway: [] }`. */
export function parseArgs(argv) {
  const [command, ...rest] = argv
  const flags = {}
  const anyway = []
  const withValue = ['--data', '--remote', '--pictures', '--keep-set', '--journal', '--undo', '--project', '--game']
  for (let at = 0; at < rest.length; at++) {
    const word = rest[at]
    if (word === '--anyway') { anyway.push(rest[++at]); continue }
    if (withValue.includes(word)) { flags[word.slice(2)] = rest[++at]; continue }
    if (word.startsWith('--')) { flags[word.slice(2)] = true; continue }
    throw new Error(`unknown word: ${word}`)
  }
  return { command, flags, anyway }
}

/**
 * The roots of this board folder: its config (or the first load's --project and --game), store, data, memory, settings. T5.2 A8: and the
 * two homes the table knows, `chatHome` (the chats' folder: the home files, the memory, the bridge key) and `dataHome` (config `data`,
 * null today: the store and the goal map), so what travels and where it goes back follow the settings.
 */
export async function rootsOf({ boardDir = HERE, flags = {}, env = process.env, git }) {
  const configFile = join(boardDir, 'config.json')
  const hasConfig = await access(configFile).then(() => true, () => false)
  let config = null
  if (hasConfig) config = await loadConfig(configFile, env)
  else if (flags.project && flags.game) config = { project: resolve(flags.project), gameRepo: resolve(flags.game), work: '.claude/work', pictureRoots: ['pictures'], gamePlan: 'docs/game-plan.md', productPlan: 'docs/product-plan.md' }
  else throw new Error(`${configFile} is missing: on a first load say --project <folder> and --game <folder>`)
  // Round 3, review 1: an empty project would resolve to the board folder (a save of the board's own files): refused before any git call.
  if (typeof config.project !== 'string' || config.project.trim() === '') throw new Error(`${configFile} names no project: say "project" in it (the folder of the game's chats and store) before a save or load`)
  // The settings file's place comes from config.json's OWN `data` (review 2: loadConfig names it only once the file exists).
  const rawConfig = hasConfig ? JSON.parse((await readFile(configFile, 'utf8')).replace(/^\uFEFF/, '')) ?? {} : null
  // Round 3, review 8: `data` and `chatHome` are trimmed and %VAR%-filled as settingsFileOf does; one whose %VAR% this PC does not set
  // is refused (it would name a folder called %VAR%).
  const homeSetting = key => {
    const raw = rawConfig?.[key]
    if (typeof raw !== 'string' || raw.trim() === '') return null
    const value = expandEnv(raw.trim(), env)
    const unset = /%[^%\\/]+%/.exec(value)
    if (unset !== null) throw new Error(`${configFile} ${key} names ${unset[0]}, which is not set on this PC`)
    return value
  }
  const chatHomeSet = homeSetting('chatHome')
  const dataSet = homeSetting('data')
  // Review 5 and a: the homes are made absolute ONCE, from the board folder (config.json's), never from the working folder, and every
  // root follows the placed config: the store, the bridge key, the pictures and assets (the table reads config), the memory (the transcripts
  // of the chat home). A first load (no config.json) has the two flags' folders, absolute already.
  const chatHome = resolve(boardDir, chatHomeSet ?? config.project.trim())
  const dataHome = dataSet === null ? null : resolve(boardDir, dataSet)
  const rawHasTranscripts = typeof rawConfig?.transcripts === 'string' && rawConfig.transcripts.trim() !== ''
  // Review 8: an explicit relative transcripts or picturesHome is the board folder's too.
  const placed = {
    ...config, project: resolve(boardDir, config.project.trim()), gameRepo: resolve(boardDir, (config.gameRepo || config.project).trim()), chatHome, data: dataHome ?? '',
    transcripts: rawHasTranscripts ? resolve(boardDir, config.transcripts.trim()) : transcriptsOf(chatHome, env),
    picturesHome: typeof config.picturesHome === 'string' && config.picturesHome.trim() !== '' ? resolve(boardDir, config.picturesHome.trim()) : '',
  }
  const project = placed.project
  const gameRepo = placed.gameRepo
  const dataDir = flags.data ? resolve(flags.data) : join(gameRepo, '.workerboard')
  const isExplicitData = Boolean(flags.data)
  const remote = flags.remote ?? line(await git(gameRepo, ['remote', 'get-url', 'origin']))
  if (!remote) throw new Error(`no data remote: ${gameRepo} has no origin; say --remote <url>`)
  const recordFile = recordFileFor({ boardDir, dataDir, isExplicit: isExplicitData })
  const record = await readRecord(recordFile, fs)
  // T5.2 A7: the pictures home config.json names for this PC (setup's pictures question), else the record's.
  const picturesFolder = flags.pictures ? resolve(flags.pictures) : placed.picturesHome !== '' ? placed.picturesHome : record.picturesHome
  const keepSetFile = flags['keep-set'] ? resolve(flags['keep-set']) : record.keepSet
  const projectSettingsFile = rawConfig === null ? null : settingsFileOf(rawConfig, boardDir, env)
  const memoryDir = join(placed.transcripts, 'memory')
  const bridgeFile = chatFile(placed, 'board.json')
  const userSettingsFile = join(homedir(), '.claude', 'settings.json')
  return { boardDir, project, chatHome, dataHome, bridgeFile, projectSettingsFile, config: hasConfig ? placed : null, configGiven: placed, gameRepo, workDir: workFolder(placed), dataDir, isExplicitData, remote, picturesFolder, keepSetFile, memoryDir, userSettingsFile, recordFile }
}

/**
 * The boards of `project` that answer: the PC's list (boards.json) and this folder's own data/port.json, each asked whose it is. Round 3,
 * review 3: the board registers in the list, answers /api/board and writes its board.json by its CHAT home, so the carry commands ask
 * with roots.chatHome (the project folder today).
 */
export async function boardsAnswering({ project, boardDir, env = process.env }) {
  const ports = new Set()
  for (const board of await readBoards(boardsFile(env))) if (board.project.toLowerCase() === project.toLowerCase()) ports.add(board.port)
  const own = await readOwnPort(boardDir)
  if (own !== null) ports.add(own)
  const found = []
  for (const port of ports) {
    const whose = await whoseBoard(port, project)
    if (whose !== null && whose.toLowerCase() === project.toLowerCase()) found.push({ port, project: whose })
  }
  return found
}

/** The keepers of this board folder among the PC's node processes (Windows; elsewhere none). */
export async function keepersHere(boardDir) {
  if (process.platform !== 'win32') return []
  const listed = parseProcessList(await powershell(LIST_SCRIPT, 30_000), { ownPid: process.pid })
  if (listed === null) throw new Error('the PC\'s processes could not be listed: whether a keeper runs is unknown')
  return keepersOf(listed.processes, boardDir)
}

/** The secret values that must never travel: the bridge key (its file in the chat home, `bridgeFile`), the Codex token, the ElevenLabs key. `[{ kind, value }]`. */
export async function secretsOf({ bridgeFile, env = process.env }) {
  const out = []
  const bridge = typeof bridgeFile !== 'string' || bridgeFile === '' ? null : await readFile(bridgeFile, 'utf8').catch(() => null)
  if (bridge !== null) for (const value of secretValuesOf({ texts: [bridge] })) out.push({ kind: 'bridge key', value })
  const codex = await readFile(join(userCodexHome(env), 'auth.json'), 'utf8').catch(() => null)
  if (codex !== null) for (const value of secretValuesOf({ texts: [codex] })) out.push({ kind: 'Codex token', value })
  const eleven = await readKey().catch(() => '')
  if (eleven !== '') out.push({ kind: 'ElevenLabs key', value: eleven })
  return out
}

/** The free bytes of the drive `folder` sits on, or null when unknown. */
export async function freeBytes(folder) {
  try {
    const got = await statfs(folder)
    return Number(got.bavail) * Number(got.bsize)
  } catch {
    return null
  }
}

/** What this PC lacks for the board's work, in words. */
export async function lacksOf({ gameRepo, git }) {
  const out = []
  const py = await git(gameRepo, ['--version']).then(() => null)
  void py
  const where = await runNode(gameRepo, [join(gameRepo, 'tools', 'py.mjs'), '--where'])
  if (where.code !== 0) out.push('the Python environment of the game (node tools/py.mjs --where fails)')
  const codex = await access(join(userCodexHome(), 'auth.json')).then(() => true, () => false)
  if (!codex) out.push('Codex (no login in its home)')
  return out
}

async function runNode(cwd, args) {
  const { spawn } = await import('node:child_process')
  return new Promise(resolve => {
    try {
      const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk })
      child.on('error', () => resolve({ code: 1, out }))
      child.on('exit', code => resolve({ code: code ?? 1, out }))
      setTimeout(() => child.kill(), 20_000).unref()
    } catch {
      resolve({ code: 1, out: '' })
    }
  })
}

/** The journal: every path written, moved or deleted, one per line, when --journal names a file. */
export function journalTo(file) {
  if (!file) return () => {}
  const target = resolve(file)
  return path => { appendFile(target, `${path}\n`).catch(() => {}) }
}

/** The commands' options from the flags read: `load --pictures <folder>` is a FULL load; the pictures step alone is `--pictures-only`. */
export function optionsOf({ command, flags, anyway }) {
  const shared = { practice: flags.practice === true, dryRun: flags['dry-run'] === true }
  if (command === 'save') return { ...shared, noBranches: flags['no-branches'] === true, anyway }
  return { ...shared, park: flags.park === true, undo: flags.undo ?? null, userSettings: flags['user-settings'] === true, picturesOnly: flags['pictures-only'] === true }
}

export async function main(argv) {
  const read = parseArgs(argv)
  const { command, flags } = read
  if (!['save', 'load'].includes(command)) { console.error('Usage: node tools/carry.mjs save|load [flags] (see the header of this file)'); return 2 }
  const git = gitRunner()
  const roots = await rootsOf({ flags, git })
  // B2 and B3, loaded by name: the command says what is missing instead of failing in the middle.
  const [set, pictures] = await Promise.all([import('../src/carry/set.mjs'), import('../src/carry/pictures.mjs')])
  const log = text => console.log(text)
  const journal = journalTo(flags.journal)
  const deps = {
    git, set, pictures, fs, recordFile: roots.recordFile,
    boardAnswers: () => boardsAnswering({ project: roots.chatHome, boardDir: roots.boardDir }),
    keepers: () => keepersHere(roots.boardDir),
    lockAgeMs: async () => lockHolder(join(roots.boardDir, 'data', 'landing.lock'))?.ageMs ?? null,
    secrets: () => secretsOf({ bridgeFile: roots.bridgeFile }),
    driveFree: freeBytes,
    lacks: () => lacksOf({ gameRepo: roots.gameRepo, git }),
  }
  const options = { ...optionsOf(read), log, journal, now: Date.now() }
  if (command === 'save') {
    const done = await save({ ...roots, config: roots.configGiven }, options, deps)
    return done.ok ? 0 : 1
  }
  const done = await load({ ...roots }, options, deps)
  return done.ok ? 0 : 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => { console.error(`carry: ${error?.message ?? error}`); process.exitCode = 1 })
}

export { isAbsolute }
