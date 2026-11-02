// B142: the board starts itself anew. Whatever starts `node server.mjs` (the Run pane, a chat's Workers mod, a
// command) starts this keeper, which runs the board as its child. The process that was started stays the same, so
// stopping it, or the end of the app, ends the board as before; and the board can end itself to be started anew
// with the code its folder holds now.
// Signals change 5 (2026-11-02, B913): a board restart never costs the person anything. On 2026-11-01 the board restarted
// eight times for landings, and each time the page reloaded on the new token and the recap popup's text was lost. So the
// keeper keeps the page's token as it keeps the chats' key, across every board it starts (a crash restart too): a new
// token only with a new keeper. And it is the one starter of a board that crashed: a board that was up (`{ up: true }`)
// and ends with any code but START_ANEW or 0 is started again, at most `crashes` times within `crashWithinMs`; a board
// that ends before it was up (a broken config, a syntax error, the port in use) would only end the same way again.

/** The code a board ends with to be started anew by its keeper. */
export const START_ANEW = 75
/** How many crash restarts the keeper makes within CRASH_WITHIN_MS before it stops. */
export const CRASHES = 3
export const CRASH_WITHIN_MS = 10 * 60_000

/**
 * Signals change 5 (2026-11-02, D3): the env a cold start hands on: `env` without what a keeper hands its own board
 * (WORKER_BOARD_CHILD, WORKER_BOARD_KEY, WORKER_BOARD_TOKEN). A command run from inside a board's process would otherwise
 * start a board with no keeper (nothing starts it again), or a keeper whose first board goes on with that board's token.
 */
export function startEnv(env) {
  const clean = { ...env }
  for (const name of ['WORKER_BOARD_CHILD', 'WORKER_BOARD_KEY', 'WORKER_BOARD_TOKEN']) delete clean[name]
  return clean
}

/** Keeps the times of the last starts within `withinMs` of `at`; true when there are more than `most` of them. */
const tooMany = (times, at, most, withinMs) => {
  times.push(at)
  while (times.length > 0 && at - times[0] > withinMs) times.shift()
  return times.length > most
}

/**
 * Keeps one board running. `start({ key, token })` starts a board and gives back its process (it emits `message` and
 * `exit`); `key` is the key the board before it gave the chats' mod (a message `{ key }`), `token` the page's token it
 * used (a message `{ token }`), both null at first, so the chats and the open page keep reaching it. A board says
 * `{ up: true }` once it serves. A board that ends with START_ANEW is started again (more than `most` within `withinMs` is
 * a board that does not get going: the keeper gives up); one that ends with 0 was stopped and ends the keeper; one that
 * was up and ends with any other code crashed and is started again, more than `crashes` within `crashWithinMs` and the
 * keeper stops; one that ends before it was up ends the keeper with its code. `done(code)` ends the keeper; `say(line)`
 * is its one line of why.
 */
export function keep({ start, done, now = Date.now, most = 5, withinMs = 60_000, crashes = CRASHES, crashWithinMs = CRASH_WITHIN_MS, say = () => {} }) {
  let key = null
  let token = null
  let child = null
  let isStopped = false
  const again = []
  const crashed = []
  const end = (code, line = null) => {
    if (line !== null) say(line)
    done(code)
  }
  const run = () => {
    let isUp = false
    child = start({ key, token })
    child.on('message', message => {
      if (typeof message?.key === 'string') key = message.key
      if (typeof message?.token === 'string') token = message.token
      if (message?.up === true) isUp = true
    })
    child.on('exit', (exitCode, signal) => {
      if (isStopped) return
      const code = exitCode ?? 1
      if (exitCode === START_ANEW) {
        if (tooMany(again, now(), most, withinMs)) return end(1, `The board asked to start anew more than ${most} times within ${withinMs / 1000} s: the keeper stops.`)
        return run()
      }
      if (exitCode === 0) return end(0)
      const how = signal ? `the signal ${signal}` : `code ${code}`
      if (!isUp) return end(code, `The board ended with ${how} before it was up: the keeper does not start it again.`)
      if (tooMany(crashed, now(), crashes, crashWithinMs)) return end(code, `The board crashed (${how}) more than ${crashes} times within ${crashWithinMs / 60_000} minutes: the keeper stops.`)
      say(`The board crashed (${how}): the keeper starts it again.`)
      run()
    })
  }
  run()
  return {
    stop: () => {
      isStopped = true
      child?.kill()
    },
  }
}
