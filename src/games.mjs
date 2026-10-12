// The games the board starts so the person can look at a branch. One game per working folder: the folder that
// holds the branch is served on a port of its own (see run-game.mjs), and the game ends by itself once the tab
// that shows it has been closed for a while. The board never switches a folder to another branch.

import { spawn } from 'node:child_process'
import { join } from 'node:path'

const refuse = (status, why) => ({ ok: false, status, why })

/** The same folder, however its path is written. */
export const pathKey = path => String(path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * What the page asks for: start or stop the game of the branch a request is about. The page names the request;
 * the branch and the folder come from the board's own state, never from the page.
 */
export function checkGame(body, state) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'Not a request.')
  if (body.action !== 'start' && body.action !== 'stop') return refuse(400, 'Start or stop.')
  const need = [...(state.forYou ?? []), ...(state.backlogForYou ?? []), ...(state.backlogClosed ?? [])].find(one => one.id === body.item)
  if (need === undefined || need.game === null || need.game === undefined) return refuse(409, 'That request names no branch to run.')
  if (need.game.path === null) return refuse(409, `No working folder is on the branch ${need.game.branch} now, so there is nothing to start.`)
  return { ok: true, action: body.action, branch: need.game.branch, path: need.game.path }
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
 * The games that run. `launch({ path, port, onExit })` starts one and answers `{ url, stop }`; `onExit` is called
 * when it has ended, by itself or not.
 */
export function createGames({ launch, now = Date.now }) {
  const running = new Map()
  const starting = new Map()

  /** The address of the folder's game, started when it is not running. Two asks at once start one game. */
  function start({ path, port }) {
    const key = pathKey(path)
    if (running.has(key)) return Promise.resolve(running.get(key).url)
    if (starting.has(key)) return starting.get(key)
    const mine = {}
    let hasEnded = false
    const begun = launch({
      path,
      port,
      onExit: () => {
        hasEnded = true
        if (running.get(key)?.mine === mine) running.delete(key)
      },
    }).then(({ url, stop }) => {
      if (hasEnded) throw new Error('The game stopped right after it started.')
      running.set(key, { path, url, startedAt: now(), stop, mine })
      return url
    }).finally(() => {
      starting.delete(key)
    })
    starting.set(key, begun)
    return begun
  }

  /** Ends the folder's game. Answers whether one was running. */
  function stop(path) {
    const game = running.get(pathKey(path))
    if (game === undefined) return false
    running.delete(pathKey(path))
    game.stop()
    return true
  }

  return {
    start,
    stop,
    stopAll: () => {
      for (const game of [...running.values()]) stop(game.path)
    },
    list: () => [...running.values()].map(({ path, url, startedAt }) => ({ path, url, startedAt })),
  }
}

const lastLine = text => text.split('\n').map(line => line.trim()).filter(line => line !== '').pop() ?? ''

/**
 * Starts a folder's game with the runner, as a process of its own, and waits until it serves. The runner ends by
 * itself (see `idleWatch`), so a game never outlives the person's interest in it, also when the board is closed.
 */
export function gameLauncher({ runner, cacheDir, idleSeconds, graceSeconds, readySeconds = 60, node = process.execPath }) {
  return ({ path, port, onExit }) => new Promise((resolve, reject) => {
    const name = pathKey(path).split('/').pop() || 'game'
    const child = spawn(node, [
      runner, '--folder', path, '--port', String(port), '--idle', String(idleSeconds), '--grace', String(graceSeconds), '--cache', join(cacheDir, name),
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

    let out = ''
    let said = ''
    let isReady = false
    const late = setTimeout(() => child.kill(), readySeconds * 1000)
    child.stdout.on('data', chunk => {
      if (isReady) return
      out = (out + chunk).slice(-4000)
      const ready = out.match(/^ready (\d+)\s*$/m)
      if (ready === null) return
      isReady = true
      clearTimeout(late)
      resolve({ url: `http://127.0.0.1:${ready[1]}/`, stop: () => child.kill() })
    })
    // What the game's own tools say when they fail; the last line of it is shown as the reason.
    child.stderr.on('data', chunk => {
      said = (said + chunk).slice(-4000)
    })
    const ended = () => {
      clearTimeout(late)
      onExit()
      if (!isReady) reject(new Error(`The game did not start. ${lastLine(said).slice(0, 200)}`.trim()))
    }
    child.once('error', ended)
    child.once('exit', ended)
  })
}
