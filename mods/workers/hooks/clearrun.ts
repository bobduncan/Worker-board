// B944 (X108, X109, X134, X135): which of the mod's own /clear commands runs the clear on its way.
//
// Until 0.29.0 each /clear the mod queued took the oldest ticket of its queue, and ran only when that ticket was the
// clear's on its way. The queue lives in the hooks module, the /clear in the engine's queue: once the two were out of
// step (a /clear that ran without the module seeing it, or a hooks worker the engine replaced mid-session, whose state
// starts over), every later /clear took another clear's ticket and was refused as "let go", while the clear stayed on
// its way until the two-minute let-go: Worker 3 at 21:25:26 and 21:25:38, Worker 4 at 21:31:03 on 2026-11-02, each
// /clear run and refused within 8 ms of its queuing, and every clear after it in that process the same.
// Since 0.29.1 the /clear runs the clear on its way, whatever the order of the queue, while every guard of that clear
// holds: the same session it was decided on, no turn running, and no prompt or turn since it was decided.

/** A clear this process decided: the session it was decided on, its ticket, and what the chat had seen then. */
export type Decided = { from: string; ticket: number; prompts: number; turn: number }

/** The chat as it stands when a /clear of the mod's runs. */
export type Now = { session: string; isInTurn: boolean; prompts: number; turn: number }

/**
 * What a /clear of the mod's does: `run` the clear on its way; `late` a prompt or turn came in since it was decided (it
 * is dropped, as before); `moved` its session is no longer this one (a clear already ended it: never a second clear of
 * the fresh conversation); `none` no clear is on its way (a let-go clear's /clear, refused as before). `left` is the queue
 * after it: the tickets of the clear that runs and of every clear before it are used up, so a /clear of theirs that still
 * comes finds no clear on its way.
 */
export type ClearRun = { verdict: 'run' | 'late' | 'moved' | 'none'; left: number[] }

export function clearRun(queue: readonly number[], decided: Decided | null, now: Now): ClearRun {
  // No clear on its way: the oldest ticket goes with this /clear, as before.
  if (decided === null) return { verdict: 'none', left: queue.slice(1) }
  const left = queue.filter(ticket => ticket > decided.ticket)
  if (decided.from !== now.session) return { verdict: 'moved', left }
  if (now.isInTurn || now.prompts !== decided.prompts || now.turn !== decided.turn) return { verdict: 'late', left }
  return { verdict: 'run', left }
}
