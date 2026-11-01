// Signals change 3: the give-back of a stopped holder's step. The decision (handover.mjs `decide`, holderTimers.mjs) says
// when it is due, `giveBack: { step, chat, askedAt }`; the board (handoverBoard.mjs `handOver`) calls this one function,
// and on its ok closes the worker's still-waiting "go on" line. The second half (the person's yes on the flow.json
// give-back rule, 2026-11-01): it goes through the work API's give-back path, `advance` to refined with `giveBack`
// (api.mjs `giveBackHeld`), by the flow's server move "the board gives it back" (DEFAULT_FLOW, examples/work/flow.json,
// the project's .claude/work/flow.json), whose guard holds only on that path.

import { giveBackWords } from './holderTimers.mjs'

/**
 * The give-back of step `step` from worker `chat`, whose "go on" line was written at `askedAt`: what the work API answered,
 * `{ ok, result | why }`. `apply` the work API as the server; `log` one line to board.log for a refusal, once per step and
 * refusal (per board process).
 */
export async function giveBackStep({ step, chat, askedAt, apply, log = line => console.log(line) }) {
  if (typeof apply !== 'function') return { ok: false, why: 'no work API to give it back through' }
  const done = await Promise.resolve()
    .then(() => apply({ action: 'advance', id: step, to: 'refined', giveBack: { chat, why: giveBackWords(chat, askedAt) } }))
    .catch(error => ({ ok: false, why: error instanceof Error ? error.message : String(error) }))
  if (done?.ok !== true) {
    const key = `${step} ${chat} ${done?.why ?? ''}`
    if (!told.has(key)) {
      told.add(key)
      log(`Signals change 3: ${step} could not go back from ${chat}: ${done?.why ?? 'no answer'}.`)
    }
  }
  return done ?? { ok: false, why: 'no answer' }
}

/** The refusals already named in board.log, so each is said once (per board process). */
const told = new Set()

/** For the tests: forget which refusals were named. */
export const forgetTold = () => told.clear()
