// The games the board starts so the person can look at a branch. One game per working folder: the folder that
// holds the branch is served on a port of its own (see run-game.mjs), and the game ends by itself once the tab
// that shows it has been closed for a while. The board never switches a folder to another branch.

import { spawn } from 'node:child_process'
import { join } from 'node:path'

const refuse = (status, why) => ({ ok: false, status, why })

/** The same folder, however its path is written. */
export const pathKey = path => String(path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * What the page asks for: start or stop the game of the branch a request is about, or of the base branch (`item: "main"`,
 * the button that is always there). The page names the request; the branch and the folder come from the board's
 * own state, never from the page.
 */
export function checkGame(body, state) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'Not a request.')
  if (body.action !== 'start' && body.action !== 'stop') return refuse(400, 'Start or stop.')
  // B149: a link in a worker's answer names a branch: its game starts from the working folder that holds it. The
  // branch comes from a chat's words: it is kept to plain characters, and only a folder git lists is started.
  if (body.item === 'branch') {
    const branch = typeof body.branch === 'string' && /^[\w][\w./-]{0,120}$/.test(body.branch) && !body.branch.includes('..') ? body.branch : null
    if (branch === null) return refuse(400, 'That is no branch.')
    const folder = branch === (state.baseBranch ?? 'main') ? state.mainGame ?? null
      : [...(state.chats ?? []).flatMap(chat => chat.folders ?? []), ...(state.otherFolders ?? [])].find(one => one.branch === branch) ?? null
    if (folder === null || typeof folder.path !== 'string') return refuse(409, `No working folder is on the branch ${branch} now, so there is nothing to start.`)
    return { ok: true, action: body.action, branch, path: folder.path }
  }
  const game = body.item === 'main'
    ? state.mainGame ?? null
    : [...(state.forYou ?? []), ...(state.backlogForYou ?? []), ...(state.backlogClosed ?? [])].find(one => one.id === body.item)?.game ?? null
  if (game === null) return refuse(409, 'That request names no branch to run.')
  if (game.path === null) return refuse(409, `No working folder is on the branch ${game.branch} now, so there is nothing to start.`)
  return { ok: true, action: body.action, branch: game.branch, path: game.path }
}

/**
 * Tells when a game nobody looks at is over. A tab that shows the game keeps a connection open; with none open
 * for `idleMs` the game is over, and so is one nobody opened within `graceMs` of its start.
 */
export function idleWatch({ idleMs, graceMs, now }) {
  let open = 0
  let wasOpened = false
  let emptySince = now
  return {
    opened() {
      open += 1
      wasOpened = true
    },
    closed(at) {
      open = Math.max(0, open - 1)
      if (open === 0) emptySince = at
    },
    isOver: at => open === 0 && at - emptySince >= (wasOpened ? idleMs : graceMs),
  }
}

/**
 * The games that run. `launch({ path, port, onExit })` starts one and answers at once `{ ready, stop }`: `ready`
 * resolves to the game's address once it serves, `stop` ends it, also while it is still starting. `onExit` is
 * called when it has ended, by itself or not.
 */
export function createGames({ launch, now = Date.now }) {
  const running = new Map()
  const starting = new Map()

  /** The address of the folder's game, started when it is not running. Two asks at once start one game. */
  function start({ path, port }) {
    const key = pathKey(path)
    if (running.has(key)) return Promise.resolve(running.get(key).url)
    if (starting.has(key)) return starting.get(key).begun
    const mine = {}
    let hasEnded = false
    const { ready, stop } = launch({
      path,
      port,
      onExit: () => {
        hasEnded = true
        if (running.get(key)?.mine === mine) running.delete(key)
      },
    })
    const begun = ready.then(url => {
      if (hasEnded) throw new Error('The game stopped right after it started.')
      running.set(key, { path, url, startedAt: now(), stop, mine })
      return url
    }).finally(() => {
      if (starting.get(key)?.mine === mine) starting.delete(key)
    })
    starting.set(key, { begun, stop, mine })
    return begun
  }

  /** Ends the folder's game, also one that is still starting. Answers whether there was one. */
  function stop(path) {
    const key = pathKey(path)
    const game = running.get(key) ?? starting.get(key)
    if (game === undefined) return false
    running.delete(key)
    game.stop()
    return true
  }

  return {
    start,
    stop,
    stopAll: () => {
      for (const game of [...running.values(), ...starting.values()]) game.stop()
      running.clear()
    },
    list: () => [...running.values()].map(({ path, url, startedAt }) => ({ path, url, startedAt })),
  }
}

const lastLine = text => text.split('\n').map(line => line.trim()).filter(line => line !== '').pop() ?? ''

/**
 * Starts a folder's game with the runner, as a process of its own. The runner ends by itself (see `idleWatch`),
 * so a game never outlives the person's interest in it, also when the board is closed.
 */
/** B197: the start command's words with `{folder}`, `{port}` and the others filled in; an unknown one stays as it is. */
export const commandFor = (words, values) => words.map(word => word.replace(/\{(\w+)\}/g, (whole, key) => (values[key] === undefined ? whole : String(values[key]))))

export function gameLauncher({ command, board, cacheDir, idleSeconds, graceSeconds, readySeconds = 60, node = process.execPath }) {
  return ({ path, port, onExit }) => {
    const name = pathKey(path).split('/').pop() || 'game'
    const [program, ...args] = commandFor(command, { folder: path, port, idle: idleSeconds, grace: graceSeconds, cache: join(cacheDir, name), node, board })
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

    const ready = new Promise((resolve, reject) => {
      let out = ''
      let said = ''
      let isReady = false
      const late = setTimeout(() => child.kill(), readySeconds * 1000)
      child.stdout.on('data', chunk => {
        if (isReady) return
        out = (out + chunk).slice(-4000)
        const port = out.match(/^ready (\d+)\s*$/m)
        if (port === null) return
        isReady = true
        clearTimeout(late)
        resolve(`http://127.0.0.1:${port[1]}/`)
      })
      // What the game's own tools say when they fail; the last line of it is shown as the reason.
      child.stderr.on('data', chunk => {
        said = (said + chunk).slice(-4000)
      })
      let hasEnded = false
      const ended = () => {
        if (hasEnded) return
        hasEnded = true
        clearTimeout(late)
        onExit()
        if (!isReady) reject(new Error(`The game did not start. ${lastLine(said).slice(0, 200)}`.trim()))
      }
      child.once('error', ended)
      child.once('exit', ended)
    })
    return { ready, stop: () => child.kill() }
  }
}
