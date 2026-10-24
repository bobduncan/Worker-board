// The supervisor: the board checks itself (spec 2026-10-24, "The supervisor: the board checks itself, with code first and
// AI for the gaps"). One component owns all of the board's self-diagnosis; this is its one door. The server starts it in
// one place (`createSupervisor(ports).start()`) and the page asks it what to draw (`view(now)`); nothing else in the board
// imports its parts (test/supervisor/boundary.test.mjs). Task 1: the board's self-check ("Out of sync?", B465) moved in
// unchanged: its checks are the repair rules (rules/repair.mjs), its loop, lock and fixes are loop.mjs. It observes, and
// repairs only through the repairs the self-check had: unblock, hand a step on, wake a chat, a word to the main chat,
// clean a worktree.

import { SYNC_EVERY_MS, loopOwner, syncRunner } from './loop.mjs'
import { REFUSED_MS, REPAIR_RULES } from './rules/repair.mjs'

/** How long the server keeps a name a chat's mod was refused under: as long as the rule `old-name` looks back. */
export { REFUSED_MS }

/**
 * The board's supervisor. `ports`: the runner's (loop.mjs `syncRunner`: `state()`, `items()`, `outbox()`, `refused()`,
 * `apply(body)`, `wake(one)`, `leftovers(...)`, `clean(one)`, `noted`, `now()`), plus `loopLock` (`read()`, `write(text)`,
 * `alive(pid)`, `pid`, `port`: the project's lock file, one loop per project, B482), `loops` (the board's loop record:
 * `run(name, fn)`, `failed(name, error)`), `closing()` (true while the board ends), `settings` (config.json), and
 * `timers` (`setInterval`, `clearInterval`; the global ones unless given).
 * Answers `{ start(), run({ asked, subject }), view(now), stop() }`: `start` runs the list every SYNC_EVERY_MS while this
 * process holds the project's loop; `run` runs it at once (the person's "Out of sync?") and answers today's `{ at, asked,
 * rows, fine }`, or null when another board process holds the loop or the run failed (recorded as the loop "sync");
 * `view(now)` is `{ run, rules, incidents, lastSweep }`: the run the page shows (the newest asked, or one that found
 * something, for an hour; else null), and the parts later tasks fill (empty until then).
 */
export function createSupervisor(ports) {
  const { loopLock, loops, closing = () => false, settings: _settings, timers = globalThis, ...runnerPorts } = ports
  const runner = syncRunner(runnerPorts, REPAIR_RULES)
  const owns = loopOwner({ ...loopLock, now: ports.now })
  let timer = null
  return {
    start() {
      if (timer !== null) return
      timer = timers.setInterval(() => (closing() ? null : loops.run('sync', async () => (await owns() ? runner.run() : null))), SYNC_EVERY_MS)
    },
    async run({ asked = false } = {}) {
      const mine = await owns().catch(error => { loops.failed('sync', error); return false })
      if (!mine) return null
      return runner.run({ asked }).catch(error => { loops.failed('sync', error); return null })
    },
    view: now => ({ run: runner.shown(now), rules: [], incidents: [], lastSweep: null }),
    stop() {
      if (timer !== null) timers.clearInterval(timer)
      timer = null
    },
  }
}
