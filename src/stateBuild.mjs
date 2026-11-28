// B1579 (X93, the rest after B1535): one state build from what the loop hands in, the same in the state thread (src/stateWorker.mjs)
// and in the loop (the fallback, src/stateThread.mjs): ONE reading of the sources for both ways, never a copy of it.
//
// What the loop hands in (`input`):
// - `{ facts }` on a real board: the sources are read here (src/sources.mjs `readSources`), the working folders and branches too (git,
//   `gitFacts`, kept a minute as the loop kept them), from config and the small results the
//   loop keeps itself: the app's account (the loop follows the app's
//   folder and account and files their asks), the asset requests and the provider's time limit, and the plan-writes log's path. The
//   work store and the chats' files are read where the build runs, never copied in (B1535 copied 0.2-0.8 s of them per rebuild).
//   `facts.gen` counts the loop's resets of its store read: a new one makes this reading of the store read anew (a write shows in the
//   next state, as before).
// - `{ facts }` with `facts.sources` on the demo: its made-up sources as they are.
// - A raw itself (an older caller, the tests'): built as it is.
// The state comes back with its light backlog made here too (src/state.mjs `lightBacklogOf`), so /api/state makes no light row on the
// loop.

import { cached, gitRunner, readBranches, readFolders } from './folders.mjs'
import { partnerPageAt } from './planWrite.mjs'
import { productPlanFile, readSources } from './sources.mjs'
import { buildState, lightBacklogOf } from './state.mjs'
import { withStepSizes } from './taskTimes.mjs'
import { withAway } from './work/pause.mjs'

/**
 * The raw as `buildState` takes it, read from `facts` (see above); `readWork()` the work store as the place the build runs keeps it.
 * The account of the work read is the loop's (`facts.account`), so the pause while away is the same in both ways.
 */
/** The git reads where the build runs, one `cached` per repository and kind (their own `ms`, the board's FOLDERS_MS). */
const gitReads = new Map()
const gitRead = (key, ms, read) => {
  if (!gitReads.has(key)) gitReads.set(key, cached(read, ms))
  return gitReads.get(key)()
}

/**
 * B1579: the working folders and the branches, from `facts.git` (`{ gameRepo, base, repos, ms }`: read here, by git, kept `ms` as the
 * loop kept them), else as the loop handed them (`facts.folders`, `facts.branches`: the tests', an older loop's). Null for a read that failed.
 */
export async function gitFacts(facts, run = gitRunner()) {
  const git = facts?.git
  if (git === null || typeof git !== 'object') return { folders: facts?.folders ?? null, branches: facts?.branches ?? null }
  const ms = Number.isFinite(git.ms) ? git.ms : 60_000
  const [folders, branches] = await Promise.all([
    typeof git.gameRepo === 'string' && git.gameRepo !== '' ? gitRead(`folders|${git.gameRepo}|${git.base}`, ms, () => readFolders(git.gameRepo, run, git.base)).catch(() => null) : null,
    Array.isArray(git.repos) ? gitRead(`branches|${git.repos.join('|')}`, ms, () => readBranches(git.repos, run)).catch(() => null) : null,
  ])
  return { folders, branches }
}

export async function rawOf(facts, readWork) {
  const { config } = facts
  // The demo's made-up sources (`facts.sources`) as they are; else the files, read here.
  const git = facts.sources === undefined ? await gitFacts(facts) : null
  const fresh = facts.sources ?? await readSources(config, async () => git.folders, facts.now ?? undefined, async () => git.branches,
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
