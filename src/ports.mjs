// Which port a board listens on. The board in the repository's main folder keeps the port of config.json (4310).
// A copy in another working folder of the same repository takes a port of its own without being told: the lowest
// one from OWN_PORTS_FROM that no other folder has written down. It writes it to `<folder>/data/port.json`, so it
// is the same every time that folder starts, also when other folders come and go. A port given on the command
// line (`--port 4311`) wins and is not written down.
//
// A folder's launch entry (`node server.mjs --launch-entry`) names that same port, so the preview opens the right
// address.

//
// B319: two projects, each with its own copy of the board, run side by side on one PC. A list of the PC's boards
// (`boards.json` in the person's home folder) holds each project's port and the first port of its games: a board
// that runs on a port keeps it for its project from then on. A board whose configured port another project holds
// takes the next free one from there, and games' ports in a range of their own (GAME_SPAN wide).

import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

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
 *
 * B319: with `boards`, the PC's list (`boardsFile`), and the board's `project`: the main folder takes its project's
 * port and games' port (see `chooseHome`, with `holder`, the project whose board holds the configured port), a copy
 * never takes a port another project's board holds and starts its games in its project's range. Nothing is written
 * into the list here: the board does that once it listens (`registerHome`). Without `boards` all is as before.
 */
export async function resolvePort({ here, given, configured, run, project = null, gamePort = null, boards = null, isBusy = portIsBusy, identify = boardProject }) {
  const folders = await boardFolders(here, run)
  const main = folders[0] ?? here
  const isMain = pathKey(main) === pathKey(here)
  const listed = boards === null || project === null ? null : await readBoards(boards)
  const own = listed?.find(one => pathKey(one.project) === pathKey(project)) ?? null
  const elsewhere = listed?.filter(one => one !== own) ?? []
  const games = listed === null ? {} : { gamePort: own?.gamePort ?? gamePort }
  if (isMain && portArg(given) === null && listed !== null) {
    // A port the list does not give this project yet is looked at before it is taken: something may listen there,
    // such as a board of before the list. Only this project's own board may; anything else, the port is passed over.
    const busy = []
    let holder = null
    for (;;) {
      const home = chooseHome({ project, configured, gamePort, boards: listed, busy })
      const isOwnPort = own !== null && own.port === home.port
      if (isOwnPort || busy.length >= 50 || !(await isBusy(home.port))) return { ...home, holder: home.holder ?? holder, main, isMain }
      const whose = await identify(home.port)
      if (whose !== null && pathKey(whose) === pathKey(project)) return { ...home, holder: home.holder ?? holder, main, isMain }
      if (home.port === configured) holder = whose
      busy.push(home.port)
    }
  }
  const others = folders.filter(folder => pathKey(folder) !== pathKey(here) && pathKey(folder) !== pathKey(main))
  const taken = [...(await Promise.all(others.map(readOwnPort))).filter(port => port !== null), ...elsewhere.map(one => one.port)]
  let chosen = choosePort({ given: portArg(given), configured, isMain, own: isMain ? null : await readOwnPort(here), taken })
  // B319: with the list, a copy's new port is one nothing listens on (another repository's copies count from 4320 too).
  while (listed !== null && chosen.why === 'new' && taken.length < 200 && await isBusy(chosen.port)) {
    taken.push(chosen.port)
    chosen = choosePort({ configured, isMain, taken })
  }
  if (chosen.why === 'new') await writeOwnPort(here, chosen.port)
  return { port: chosen.port, ...games, why: chosen.why, main, isMain }
}

// boards:start
/** How many ports a project's games have from their first one: no two projects' ranges meet. */
export const GAME_SPAN = 100

/** Ports given by hand (`--port`: the demo, a board that shows another's history), which a board that moves passes over. */
export const HAND_PORTS = [4311, 4312]
/** A board that moves also passes over the copies' ports. */
const KEPT_BY_HAND = [...HAND_PORTS, ...Array.from({ length: 100 }, (_none, at) => OWN_PORTS_FROM + at)]

/**
 * The project of the worker board that listens on the port, as its `/api/board` says; null for a board of before
 * B319, anything else, or nothing.
 */
export async function boardProject(port, host = '127.0.0.1') {
  try {
    const answer = await fetch(`http://${host}:${port}/api/board`, { signal: AbortSignal.timeout(1500) })
    const said = answer.ok ? await answer.json() : null
    return said?.board === 'worker-board' && typeof said.project === 'string' && said.project !== '' ? said.project : null
  } catch {
    return null
  }
}

/** The PC's list of boards: in the person's home folder, shared by every copy of the board; WORKER_BOARD_HOME moves it. */
export function boardsFile(env = process.env) {
  return join(env.WORKER_BOARD_HOME || join(homedir(), '.worker-board'), 'boards.json')
}

/** The boards the list's text holds: `{ project, folder, port, gamePort, asked }` each; anything else is left out. */
export function parseBoards(text) {
  let raw = null
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw?.boards)) return []
  return raw.boards.filter(one => typeof one?.project === 'string' && one.project !== '' && isPort(one.port) && isPort(one.gamePort)).map(one => ({
    project: one.project,
    folder: typeof one.folder === 'string' ? one.folder : '',
    port: one.port,
    gamePort: one.gamePort,
    // What the board's config.json asked for when it was given these: a new wish there is chosen anew.
    asked: isPort(one.asked?.port) && isPort(one.asked?.gamePort) ? { port: one.asked.port, gamePort: one.asked.gamePort } : { port: one.port, gamePort: one.gamePort },
  }))
}

/**
 * The ports of a project's board, from what it asks for (`configured`, `gamePort`, its config.json) and the PC's
 * `boards`: the ports it had before, while it still asks for the same and they are no other project's (`kept`, or
 * `main` when they are the ones asked for); else the ones asked for, when no other project holds them (`main`); else
 * the next free port from there, passing over the ones in `busy` (`moved`, with `holder`: the project whose board
 * holds the one asked for). Its games' range never meets another project's.
 */
export function chooseHome({ project, configured, gamePort, boards, busy = [], platform = process.platform }) {
  const key = path => pathKey(path, platform)
  const own = boards.find(one => key(one.project) === key(project)) ?? null
  const others = boards.filter(one => key(one.project) !== key(project))
  const held = new Set(others.map(one => one.port))
  const meets = first => others.some(one => first < one.gamePort + GAME_SPAN && one.gamePort < first + GAME_SPAN)
  const isSameWish = own !== null && own.asked.port === configured && own.asked.gamePort === gamePort

  let port = configured
  let why = 'main'
  if (isSameWish && !held.has(own.port)) {
    port = own.port
    why = own.port === configured ? 'main' : 'kept'
  } else if (held.has(configured) || busy.includes(configured)) {
    port = freePort([...held, ...busy, ...KEPT_BY_HAND], configured)
    why = 'moved'
  }
  let games = isSameWish && !meets(own.gamePort) ? own.gamePort : gamePort
  while (meets(games)) games += GAME_SPAN
  const holder = why === 'moved' ? others.find(one => one.port === configured)?.project ?? null : null
  return { port, gamePort: games, why, holder }
}

const isThere = path => stat(path).then(() => true, () => false)

/**
 * `work` tried up to five times while Windows says the file is in use (another board, or a virus scanner, holds it
 * that moment); a file that is not there is no reason to try again.
 */
async function again(work) {
  for (let tries = 1; ; tries += 1) {
    try {
      return await work()
    } catch (error) {
      if (tries >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error
      await new Promise(done => setTimeout(done, 40 * tries))
    }
  }
}

/** The boards of the PC's list whose project folder is still there: a project that is gone holds no port. */
export async function readBoards(file) {
  const boards = parseBoards(await again(() => readFile(file, 'utf8')).catch(() => ''))
  const there = await Promise.all(boards.map(one => isThere(one.project)))
  return boards.filter((_one, at) => there[at])
}

const LOCK_WAIT_MS = 5000
const LOCK_OLD_MS = 15_000

/** Runs `work` while this process alone holds the list's lock, so two boards starting at once both stay in it. */
async function withLock(file, work) {
  const lock = `${file}.lock`
  await mkdir(dirname(file), { recursive: true })
  const until = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      const handle = await open(lock, 'wx')
      await handle.close()
      break
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      // A lock left by a board that ended in the middle is taken away once it is old.
      const age = await stat(lock).then(found => Date.now() - found.mtimeMs, () => 0)
      if (age > LOCK_OLD_MS) await rm(lock, { force: true })
      else if (Date.now() > until) throw new Error(`The list of boards ${file} stays locked (${lock}).`)
      else await new Promise(done => setTimeout(done, 25 + Math.random() * 50))
    }
  }
  try {
    return await work()
  } finally {
    await rm(lock, { force: true })
  }
}

/**
 * Writes a board into the PC's list (`{ project, folder, port, gamePort, asked }`), in the place of its project's
 * entry. Projects that are gone leave the list. The file is written whole and then moved into place.
 */
export async function registerHome(file, board) {
  return withLock(file, async () => {
    const listed = await readBoards(file)
    const mine = { project: board.project, folder: board.folder, port: board.port, gamePort: board.gamePort, asked: board.asked }
    const at = listed.findIndex(one => pathKey(one.project) === pathKey(board.project))
    const boards = at < 0 ? [...listed, mine] : listed.map((one, index) => (index === at ? mine : one))
    const draft = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
    await writeFile(draft, `${JSON.stringify({ boards }, null, 2)}\n`)
    try {
      await again(() => rename(draft, file))
    } finally {
      await rm(draft, { force: true })
    }
    return boards
  })
}

/** True when something listens on the port on this machine already. */
export function portIsBusy(port, host = '127.0.0.1') {
  return new Promise(done => {
    const probe = createServer()
    probe.once('error', error => done(error?.code === 'EADDRINUSE' || error?.code === 'EACCES'))
    probe.listen(port, host, () => probe.close(() => done(false)))
  })
}
// boards:end

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
