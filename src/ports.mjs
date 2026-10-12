// Which port a board listens on. The board in the repository's main folder keeps the port of config.json (4310).
// A copy in another working folder of the same repository takes a port of its own without being told: the lowest
// one from OWN_PORTS_FROM that no other folder has written down. It writes it to `<folder>/data/port.json`, so it
// is the same every time that folder starts, also when other folders come and go. A port given on the command
// line (`--port 4311`) wins and is not written down.
//
// A folder's launch entry (`node server.mjs --launch-entry`) names that same port, so the preview opens the right
// address.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { parseWorktrees } from './folders.mjs'
import { pathKey } from './games.mjs'

/** A copy's own port is taken from here up: above the ports that were given by hand (4311, 4312). */
export const OWN_PORTS_FROM = 4320

const isPort = value => Number.isInteger(value) && value >= 1024 && value <= 65535

/** `--port`'s value as a port, or null when it is none. */
export function portArg(value) {
  const port = Number(value)
  return value !== undefined && value !== null && String(value).trim() !== '' && isPort(port) ? port : null
}

/** The lowest port from `from` up that is not in `taken`. */
export function freePort(taken, from = OWN_PORTS_FROM) {
  const used = new Set(taken)
  let port = from
  while (used.has(port)) port += 1
  return port
}

/**
 * The port of a board and why: `given` (the command line), `main` (the main folder keeps the configured one), `own`
 * (the folder wrote it down before) or `new` (chosen now, to be written down). `own` is what the folder's file
 * says, `taken` what the other folders' files say.
 */
export function choosePort({ given = null, configured, isMain, own = null, taken = [] }) {
  if (isPort(given)) return { port: given, why: 'given' }
  if (isMain) return { port: configured, why: 'main' }
  if (isPort(own) && own !== configured) return { port: own, why: 'own' }
  return { port: freePort([...taken, configured]), why: 'new' }
}

const portFile = folder => join(folder, 'data', 'port.json')

/** The port a folder wrote down, or null. */
export async function readOwnPort(folder) {
  try {
    const port = JSON.parse(await readFile(portFile(folder), 'utf8')).port
    return isPort(port) ? port : null
  } catch {
    return null
  }
}

export async function writeOwnPort(folder, port) {
  await mkdir(join(folder, 'data'), { recursive: true })
  await writeFile(portFile(folder), `${JSON.stringify({ port })}\n`)
}

/**
 * The working folders of the repository `here` belongs to, the main one first, as git lists them; an empty list
 * when git does not answer (a plain copy without git is then its own main folder).
 */
export async function boardFolders(here, run) {
  try {
    return parseWorktrees((await run(['-C', here, 'worktree', 'list', '--porcelain'])) ?? '').map(folder => folder.path)
  } catch {
    return []
  }
}

/**
 * The port this board listens on (see `choosePort`), with the main folder of its repository. A port chosen now is
 * written down before the answer is given, so two copies started together do not both take it.
 */
export async function resolvePort({ here, given, configured, run }) {
  const folders = await boardFolders(here, run)
  const main = folders[0] ?? here
  const isMain = pathKey(main) === pathKey(here)
  const others = folders.filter(folder => pathKey(folder) !== pathKey(here) && pathKey(folder) !== pathKey(main))
  const taken = (await Promise.all(others.map(readOwnPort))).filter(port => port !== null)
  const chosen = choosePort({ given: portArg(given), configured, isMain, own: isMain ? null : await readOwnPort(here), taken })
  if (chosen.why === 'new') await writeOwnPort(here, chosen.port)
  return { ...chosen, main, isMain }
}

const slashes = path => String(path).replace(/\\/g, '/')

/**
 * The launch entry of a board folder for `.claude/launch.json`: started from its folder with its own port, which the
 * preview opens. A copy shows the history of the board in the main folder and records none of its own.
 */
export function launchEntry({ folder, port, node, main = null }) {
  const isCopy = main !== null && pathKey(main) !== pathKey(folder)
  return {
    name: basename(slashes(folder)),
    runtimeExecutable: slashes(node),
    runtimeArgs: [`${slashes(folder)}/server.mjs`, ...(isCopy ? ['--history-from', `${slashes(main)}/data`] : [])],
    port,
    url: `http://127.0.0.1:${port}`,
  }
}

/**
 * The text of a launch.json with this entry in it: in the place of the one of the same name, else at the end. The
 * other entries stay as they are. A file that is missing or not a launch file starts anew.
 */
export function withEntry(text, entry) {
  let file = null
  try {
    file = JSON.parse(text)
  } catch {
    file = null
  }
  if (file === null || typeof file !== 'object' || !Array.isArray(file.configurations)) file = { version: '0.0.1', configurations: [] }
  const at = file.configurations.findIndex(one => one?.name === entry.name)
  const configurations = at < 0 ? [...file.configurations, entry] : file.configurations.map((one, index) => (index === at ? entry : one))
  return `${JSON.stringify({ ...file, configurations }, null, 2)}\n`
}
