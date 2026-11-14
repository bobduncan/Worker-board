// The bridge note (.claude/board.json) tells the chats' mod where this board is. On 2026-11-13 20:59, right after the PC woke,
// a Windows rename got EPERM once (an indexer or a virus scanner holding the file) and the board never wrote the note again:
// its head line said "telling the chats where the board is" failing for over an hour while the note was in fact fine. The
// claim now tries until it is written, with a backoff that grows to a minute, and reports its success, so the line says
// "answers will not reach the chats" only while the note really is missing or stale. PURE but for what is given.

/** The backoff between tries: 2 s, 4 s, ... up to a minute. */
export const CLAIM_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000, 60_000]

/**
 * Writes the bridge note until it stands: `write()` writes it (throws when it cannot), `isTaken()` says whether another board
 * already delivers (then nothing is written: `{ written: false, taken: true }`), `onFailed(error, tries)` and `onSucceeded()`
 * report each outcome (the loop record), `wait(ms)` sleeps, `isClosing()` stops the tries when the board ends. Answers
 * `{ first, done }`: `first` resolves after the FIRST try (`{ written, taken }`: what the start may wait for, one write at most,
 * about 2 s when Windows holds the file), `done` once the note stands or the board closes (`{ written, taken, tries }`); the
 * tries between run on their own (chat 1: a lasting refusal of board.json must hold neither the start nor the loops' gain).
 */
export function claimUntilWritten({ write, isTaken = async () => false, onFailed = () => {}, onSucceeded = () => {}, wait = ms => new Promise(done => setTimeout(done, ms)), isClosing = () => false }) {
  let tellFirst = () => {}
  const first = new Promise(done => { tellFirst = done })
  const done = (async () => {
    if (await isTaken()) {
      tellFirst({ written: false, taken: true })
      return { written: false, taken: true, tries: 0 }
    }
    for (let tries = 1; ; tries += 1) {
      try {
        await write()
        onSucceeded()
        tellFirst({ written: true, taken: false })
        return { written: true, taken: false, tries }
      } catch (error) {
        onFailed(error, tries)
        tellFirst({ written: false, taken: false })
      }
      if (isClosing()) return { written: false, taken: false, tries }
      await wait(CLAIM_BACKOFF_MS[Math.min(tries, CLAIM_BACKOFF_MS.length) - 1])
      if (isClosing()) return { written: false, taken: false, tries }
    }
  })()
  done.catch(() => undefined)
  return { first, done }
}
