// B1579 (X93, the rest after B1535): one state build from what the loop hands in, the same in the state thread (src/stateWorker.mjs)
// and in the loop (the fallback, src/stateThread.mjs): ONE reading of the sources for both ways, never a copy of it.
//
// What the loop hands in (`input`):
// - `{ facts }` on a real board: the sources are read here (src/sources.mjs `readSources`), from config and the small results the
//   loop keeps itself: the working folders and the branches (git, cached in the loop), the app's account (the loop follows the app's
//   folder and account and files their asks), the asset requests and the provider's time limit, and the plan-writes log's path. The
//   work store and the chats' files are read where the build runs, never copied in (B1535 copied 0.2-0.8 s of them per rebuild).
//   `facts.gen` counts the loop's resets of its store read: a new one makes this reading of the store read anew (a write shows in the
//   next state, as before).
// - `{ facts }` with `facts.sources` on the demo: its made-up sources as they are.
// - A raw itself (an older caller, the tests'): built as it is.
// The state comes back with its light backlog made here too (src/state.mjs `lightBacklogOf`), so /api/state makes no light row on the
// loop.

import { partnerPageAt } from './planWrite.mjs'
import { productPlanFile, readSources } from './sources.mjs'
import { buildState, lightBacklogOf } from './state.mjs'
import { withStepSizes } from './taskTimes.mjs'
import { withAway } from './work/pause.mjs'

/**
 * The raw as `buildState` takes it, read from `facts` (see above); `readWork()` the work store as the place the build runs keeps it.
 * The account of the work read is the loop's (`facts.account`), so the pause while away is the same in both ways.
 */
export async function rawOf(facts, readWork) {
  const { config } = facts
  // The demo's made-up sources (`facts.sources`) as they are; else the files, read here.
  const fresh = facts.sources ?? await readSources(config, async () => facts.folders ?? null, facts.now ?? undefined, async () => facts.branches ?? null,
    async () => withAway(await readWork(), facts.account ?? null), async () => facts.account ?? null)
  return {
    ...fresh,
    assets: Array.isArray(facts.assets) ? facts.assets : [],
    assetSeconds: facts.assetSeconds ?? null,
    // 2026-11-09: the plan's time as the partner's answer: the board's own write of a decision is not one (src/planWrite.mjs `partnerPageAt`).
    productPlanAt: await partnerPageAt(fresh.productPlanAt ?? null, facts.planWrites ?? null, productPlanFile(config)),
  }
}

/**
 * One build: the raw (`input.raw`, or read from `input.facts`), then `buildState` with the options the loop gave and the kept tasks'
 * sizes from this read of the store, and the light backlog beside the state. `hold` is the tests' long build.
 */
export async function buildFrom(input, options, { readWork = async () => undefined, build = buildState, hold = () => {} } = {}) {
  const raw = input?.facts !== undefined && input?.facts !== null ? await rawOf(input.facts, readWork) : input
  hold()
  const state = build(raw, { ...options, taskTimes: withStepSizes(options?.taskTimes ?? [], raw.work?.items) })
  return withLight(state)
}

/** The state with its light backlog (`lightBacklog`: `{ sign, backlog }`, src/state.mjs `lightBacklogOf`), for /api/state. */
export function withLight(state) {
  if (state === null || typeof state !== 'object') return state
  const light = lightBacklogOf(state)
  return light === null ? state : { ...state, lightBacklog: light }
}
