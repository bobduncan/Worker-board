// Signals change 3, the seam (the build brief of 2026-11-01, "What is NOT built now"): the give-back of a stopped
// holder's step. The decision (handover.mjs `decide`, holderTimers.mjs) says when it is due, `giveBack: { step, chat,
// askedAt }`; the board (handoverBoard.mjs `handOver`) calls this one function. The store has no move for it yet: the
// person's flow.json (.claude/work/flow.json, DEFAULT_FLOW in flow.mjs, examples/work/flow.json) has no move from taken or
// in progress back to refined, and that file is the person's: the move waits for their yes. Until then this answers
// not-yet, says so once per step in board.log, and nothing changes: the worker keeps its step, its "go on" line stays
// where it is, and the page shows nothing of a give-back (every reader of the give-back reads its History line, which
// only the move writes).
//
// The second half (one file and the flow): this function becomes `apply({ action: 'advance', id: step, to: 'refined',
// giveBack: { chat, why: giveBackWords(chat, askedAt) } })` and answers what the API answered; the API path, the flow's
// named server move (a guard reconcile never applies) and the History line are listed in DESIGN.md ("A held task is never
// stuck", "The second half").

/** The answer until the store's move exists. */
export const NOT_YET = Object.freeze({ ok: false, why: 'the store has no give-back move yet' })

/** The steps already named in board.log, so each is said once (per board process). */
const told = new Set()

/**
 * The give-back of step `step` from worker `chat`, whose "go on" line was written at `askedAt`: `{ ok, why }`. `apply`
 * the work API as the server (unused until the move exists), `log` one line to board.log.
 */
export async function giveBackStep({ step, chat, askedAt, apply = null, log = line => console.log(line) }) {
  void apply
  void askedAt
  const key = `${step} ${chat}`
  if (!told.has(key)) {
    told.add(key)
    log(`Signals change 3: ${step} is due to go back from ${chat} (it did not go on), but ${NOT_YET.why}: it stays with ${chat}.`)
  }
  return NOT_YET
}

/** For the tests: forget which steps were named. */
export const forgetTold = () => told.clear()
