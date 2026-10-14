// B142: the board starts itself anew. Whatever starts `node server.mjs` (the Run pane, a chat's Workers mod, a
// command) starts this keeper, which runs the board as its child. The process that was started stays the same, so
// stopping it, or the end of the app, ends the board as before; and the board can end itself to be started anew
// with the code its folder holds now.

/** The code a board ends with to be started anew by its keeper. */
export const START_ANEW = 75

/**
 * Keeps one board running. `start(key)` starts a board and gives back its process (it emits `message` and `exit`);
 * `key` is the key the board before it gave the chats' mod (a message `{ key }`), null at first, so the chats keep
 * reaching it. A board that ends with START_ANEW is started again; one that ends otherwise ends the keeper with its
 * code (`done`). More than `most` new starts within `withinMs` is a board that does not get going: the keeper gives
 * up rather than start it over and over.
 */
export function keep({ start, done, now = Date.now, most = 5, withinMs = 60_000 }) {
  let key = null
  let child = null
  const again = []
  const run = () => {
    child = start(key)
    child.on('message', message => {
      if (typeof message?.key === 'string') key = message.key
    })
    child.on('exit', code => {
      if (code !== START_ANEW) return done(code ?? 1)
      const at = now()
      again.push(at)
      while (again.length > 0 && at - again[0] > withinMs) again.shift()
      if (again.length > most) return done(1)
      run()
    })
  }
  run()
  return { stop: () => child?.kill() }
}
