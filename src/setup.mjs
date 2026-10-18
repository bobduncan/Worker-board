// B251: installing the Workers mod from the board's own folder. The board carries the mod's source in `mods/`, a
// marketplace of one plugin, and `npm run setup` (setup.mjs) installs it for the person with the Claude app's own
// command-line program, which the app keeps in its own folder and does not put on the PATH. A project cannot bring
// the mod by itself: the app loads a project's plugin only after the trust question for that exact folder, and the
// desktop app never asks it (tried 2026-10-15, see MODS.md). A copy installed already, from any source, is
// recognised, and no second copy goes in: two copies of one mod clash.

import { spawn } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, posix, win32 } from 'node:path'

import { appFolder } from './config.mjs'

/** The Workers mod's name, and the name of the board's marketplace that holds it (`mods/.claude-plugin`). */
export const MOD = 'folder-branches'
export const MARKETPLACE = 'worker-board'

const RESTART = 'Now quit the Claude app fully (also from the system tray) and open it again: a chat gets the mod only '
  + 'when its process starts. A new chat in the project then has the command /workers.'

const isFile = path => stat(path).then(found => found.isFile(), () => false)

/** B319: above 0 when version `a` is newer than `b`, below when older, 0 when the same: "2.1.10" is newer than "2.1.9". */
export function compareVersions(a, b) {
  const [left, right] = [a, b].map(name => String(name).split('.').map(part => Number(part) || 0))
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const by = (left[index] ?? 0) - (right[index] ?? 0)
    if (by !== 0) return by
  }
  return 0
}

/** Version folders newest first: "2.1.10" before "2.1.9". */
const newerFirst = (a, b) => compareVersions(b, a)

/**
 * Where the Claude app's own command-line program is: the newest under the app's folder
 * (`<app folder>/claude-code/<version>/<build>/claude.exe`, the Store app's folder when the shell is not the app's),
 * else a `claude` installed apart, on the PATH. Null when there is none.
 */
export async function findClaude({ env = process.env, platform = process.platform } = {}) {
  const name = platform === 'win32' ? 'claude.exe' : 'claude'
  const app = await appFolder(env, platform)
  if (app !== null) {
    const base = join(app, 'claude-code')
    for (const version of (await readdir(base).catch(() => [])).sort(newerFirst)) {
      for (const build of await readdir(join(base, version)).catch(() => [])) {
        if (await isFile(join(base, version, build, name))) return join(base, version, build, name)
      }
    }
  }
  const byUpper = new Map(Object.entries(env).map(([key, value]) => [key.toUpperCase(), value]))
  const folders = String(byUpper.get('PATH') ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean)
  for (const folder of folders) {
    for (const one of platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']) if (await isFile(join(folder, one))) return join(folder, one)
  }
  return null
}

function parsed(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Every installed copy of the Workers mod in what `claude plugin list --json` printed, from any marketplace; null
 * when the words are no such list (then nobody can tell what is installed).
 */
export function installedCopies(text) {
  const list = parsed(text)
  if (!Array.isArray(list)) return null
  return list.filter(one => typeof one?.id === 'string' && one.id.startsWith(`${MOD}@`)).map(one => ({
    id: one.id,
    marketplace: one.id.slice(MOD.length + 1),
    version: typeof one.version === 'string' ? one.version : '',
    scope: typeof one.scope === 'string' ? one.scope : '',
    isOn: one.enabled === true,
  }))
}

/** The marketplace of this name in what `claude plugin marketplace list --json` printed, with where it is; else null. */
export function knownMarketplace(text, name) {
  const list = parsed(text)
  const found = Array.isArray(list) ? list.find(one => one?.name === name) : undefined
  if (found === undefined) return null
  const path = [found.path, found.url, found.installLocation].find(one => typeof one === 'string' && one !== '') ?? ''
  return { name, path }
}

function samePlace(a, b, platform) {
  const paths = platform === 'win32' ? win32 : posix
  const [left, right] = [a, b].map(path => paths.resolve(path))
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/**
 * What setup does, from what is installed: the `claude` calls, what it says, a problem that stops it, and whether
 * the app has to be started anew. `copies` from `installedCopies`, `known` the board's marketplace as the program
 * knows it (or null), `modsDir` this board's `mods` folder, `version` the version of the mod in it.
 */
export function setupPlan({ copies, known, modsDir, version, platform = process.platform }) {
  const boardId = `${MOD}@${MARKETPLACE}`
  const plan = (calls, lines) => ({ calls, lines, problem: null, isRestart: calls.length > 0 })
  const stop = problem => ({ calls: [], lines: [], problem, isRestart: false })
  const on = copies.filter(copy => copy.isOn)
  if (on.length > 1) {
    return stop(`Two copies of the Workers mod are on: ${on.map(copy => `${copy.id} (version ${copy.version})`).join(' and ')}. `
      + 'They clash; keep one, and remove the other with: claude plugin uninstall <its name>')
  }
  if (on.length === 1) {
    const [copy] = on
    if (copy.marketplace !== MARKETPLACE) {
      return plan([], [`The Workers mod is installed already: ${copy.id}, version ${copy.version} (this board carries version ${version}). `
        + 'Setup leaves it as it is: a second copy would clash. Nothing to do.'])
    }
    if (copy.version === version) return plan([], [`The Workers mod is installed: ${copy.id}, version ${version}, the one this board carries. Nothing to do.`])
    // B319: the mod is one per PC, shared by every project's board: setup never installs over a newer copy, and one
    // that came from another board's folder is updated from that folder.
    if (compareVersions(copy.version, version) > 0) {
      return plan([], [`The Workers mod on this PC is version ${copy.version}, newer than the ${version} this board carries. Setup leaves it as it is; `
        + 'bring this board\'s folder up to date (git pull) to match.'])
    }
    if (known !== null && !samePlace(known.path, modsDir, platform)) {
      return plan([], [`The Workers mod on this PC, version ${copy.version}, comes from another board's folder, ${known.path}; this board carries version ${version}. `
        + 'Setup leaves it as it is: bring that board\'s folder up to date and run setup there.'])
    }
    return plan([['plugin', 'marketplace', 'update', MARKETPLACE], ['plugin', 'update', boardId]],
      [`The Workers mod is updated from version ${copy.version} to version ${version}, the one this board carries.`])
  }
  // A copy that is off is turned on, rather than a second one installed beside it.
  const [off] = copies
  if (off !== undefined) return plan([['plugin', 'enable', off.id]], [`The Workers mod was installed but off (${off.id}); it is on now.`])
  if (known !== null && !samePlace(known.path, modsDir, platform)) {
    return stop(`A marketplace named "${MARKETPLACE}" is known already, from ${known.path}, not from this board's folder ${modsDir}. `
      + `Run setup in that board's folder, or remove it first with: claude plugin marketplace remove ${MARKETPLACE}`)
  }
  return plan([...(known === null ? [['plugin', 'marketplace', 'add', modsDir]] : []), ['plugin', 'install', boardId, '--scope', 'user']],
    [`The Workers mod is installed for you from this board's folder: ${boardId}, version ${version}.`])
}

/** Runs the program once; never throws. */
function call(command, args, seconds) {
  return new Promise(done => {
    // A `claude.cmd` (an npm install) runs through the shell, with every word quoted.
    const isShell = /\.cmd$/i.test(command[0])
    const words = [...command.slice(1), ...args]
    const child = spawn(isShell ? `"${command[0]}"` : command[0], isShell ? words.map(word => `"${word}"`) : words,
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: isShell })
    let out = ''
    let err = ''
    const late = setTimeout(() => child.kill(), seconds * 1000)
    child.stdout.on('data', chunk => {
      out += chunk
    })
    child.stderr.on('data', chunk => {
      err = (err + chunk).slice(-4000)
    })
    child.once('error', error => {
      clearTimeout(late)
      done({ code: -1, out, err: String(error.message) })
    })
    child.once('close', code => {
      clearTimeout(late)
      done({ code: code ?? -1, out, err })
    })
  })
}

/** The program's last words, for a line that says why setup stopped. */
const lastWords = result => `${result.err}\n${result.out}`.split('\n').map(line => line.trim()).filter(line => line !== '').slice(-3).join(' ').slice(0, 400) || `exit code ${result.code}`

async function boardVersion(modsDir) {
  const manifest = parsed(await readFile(join(modsDir, MOD, '.claude-plugin', 'plugin.json'), 'utf8').catch(() => ''))
  return typeof manifest?.version === 'string' ? manifest.version : ''
}

/** B319: the app's list of installed plugins: in the person's `.claude` folder, or where CLAUDE_CONFIG_DIR says. */
export function pluginsFile(env = process.env) {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'plugins', 'installed_plugins.json')
}

/**
 * B319: the Workers mod in the text of that list, from any marketplace: `{ id, version }`; null when the list holds
 * none (it is not installed); undefined when the text is no such list (nobody can tell).
 */
export function installedVersion(text) {
  const list = parsed(text)
  if (list === null || typeof list !== 'object' || Array.isArray(list) || list.plugins === null || typeof list.plugins !== 'object' || Array.isArray(list.plugins)) return undefined
  for (const [id, copies] of Object.entries(list.plugins)) {
    if (!id.startsWith(`${MOD}@`) || !Array.isArray(copies)) continue
    const found = copies.find(one => typeof one?.version === 'string' && one.version !== '')
    if (found !== undefined) return { id, version: found.version }
  }
  return null
}

/**
 * B319: the mod this board's folder carries (`carried`, null when it carries none) and the one the PC runs
 * (`installed`: its version, null when none is installed, undefined when the list cannot be read).
 */
export async function modVersions({ modsDir, file }) {
  const carried = (await boardVersion(modsDir)) || null
  const found = installedVersion(await readFile(file, 'utf8').catch(() => ''))
  return { carried, installed: found === undefined || found === null ? found : found.version }
}

/**
 * Setup itself: asks the program what is installed, makes the plan, runs it (with `isCheck` only says what it would
 * run), and checks the result. `command` starts the program (its path; for the tests a stand-in). Answers
 * `{ ok, lines }`, the lines to print; it never throws.
 */
export async function runSetup({ command, modsDir, isCheck = false, seconds = 120 }) {
  const ask = args => call(command, args, seconds)
  const listed = await ask(['plugin', 'list', '--json'])
  const copies = listed.code === 0 ? installedCopies(listed.out) : null
  if (copies === null) return { ok: false, lines: [`Setup could not tell which mods are installed. The Claude app's program answered: ${lastWords(listed)}`] }
  const markets = await ask(['plugin', 'marketplace', 'list', '--json'])
  const known = markets.code === 0 ? knownMarketplace(markets.out, MARKETPLACE) : null
  const version = await boardVersion(modsDir)
  const plan = setupPlan({ copies, known, modsDir, version })
  if (plan.problem !== null) return { ok: false, lines: [plan.problem] }
  if (isCheck) return { ok: true, lines: plan.calls.length === 0 ? plan.lines : plan.calls.map(args => `Would run: claude ${args.join(' ')}`) }
  for (const args of plan.calls) {
    const result = await ask(args)
    if (result.code !== 0) return { ok: false, lines: [`Setup stopped: claude ${args.join(' ')} did not work. The program answered: ${lastWords(result)}`] }
  }
  const lines = [...plan.lines]
  if (plan.calls.length > 0) {
    const after = (await ask(['plugin', 'list', '--json'])).out
    const now = (installedCopies(after) ?? []).find(copy => copy.isOn)
    if (now === undefined) return { ok: false, lines: [...lines, 'But the Claude app\'s program does not list the Workers mod as on afterwards: run setup again, or see the README.'] }
    lines.push(`The Claude app's program lists it: ${now.id}, version ${now.version}, on.`)
  }
  if (plan.isRestart) lines.push(RESTART)
  return { ok: true, lines }
}
