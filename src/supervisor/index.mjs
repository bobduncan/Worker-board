// The supervisor: the board checks itself (spec 2026-10-24, "The supervisor: the board checks itself, with code first and
// AI for the gaps"). One component owns all of the board's self-diagnosis; this is its one door. The server starts it in
// one place (`createSupervisor(ports).start()`) and the page asks it what to draw (`view(now)`); nothing else in the board
// imports its parts (test/supervisor/boundary.test.mjs). Task 1: the board's self-check ("Out of sync?", B465) moved in
// unchanged: its checks are the repair rules (rules/repair.mjs), its loop, lock and fixes are loop.mjs. It observes, and
// repairs only through the repairs the self-check had: unblock, hand a step on, wake a chat, a word to the main chat,
// clean a worktree.

import { healthSummary } from './health.mjs'
import { SYNC_EVERY_MS, memoryOf, syncRunner } from './loop.mjs'
import { buildView } from './view.mjs'
import { REFUSED_MS, REPAIR_RULES } from './rules/repair.mjs'
import { WATCH_RULES } from './rules/watch.mjs'
import { incidentsOf, linesOwed, recordFindings } from './incidents.mjs'

/** How long the server keeps a name a chat's mod was refused under: as long as the rule `old-name` looks back. */
export { REFUSED_MS }
/**
 * B482, B488: the project's one lock for the board's loops (loop.mjs). The server builds its gate from these and gives it
 * to the supervisor as `owns`, so the list runs only where every other loop of the board runs.
 */
export { loopGate, loopOwner } from './loop.mjs'

/** Every rule of the supervisor, as the page names them: `{ id, kind, says }` (the demo's section draws them too). */
export const SUPERVISOR_RULES = [...REPAIR_RULES, ...WATCH_RULES].map(({ id, kind, says }) => ({ id, kind, says }))

/** Task 4: the person's line about an incident that opened or came back: one note of the board's, read on the board. */
const personWords = (incident, isBack) => `Supervisor: ${isBack ? `${incident.id} came back: ` : ''}${incident.title ?? incident.id}`

/**
 * The board's supervisor. `ports`: the runner's (loop.mjs `syncRunner`: `state()`, `items()`, `outbox()`, `refused()`,
 * `apply(body)`, `wake(one)`, `leftovers(...)`, `clean(one)`, `noted`, `now()`), plus `owns()` (true while this board
 * process holds the project's loops: the server's gate, B482, B488; always true unless given), `loops` (the board's loop record:
 * `run(name, fn)`, `failed(name, error)`), `closing()` (true while the board ends), `settings` (config.json: its
 * `supervisor` thresholds), `timers` (`setInterval`, `clearInterval`; the global ones unless given), and for the watch
 * rules `memory` (`load()`, `save(value)`: the supervisor's own file) and `mods()` (the Workers mod installed and per
 * chat).
 * Answers `{ start(), run({ asked, subject }), health(), view(now), stop() }`: `start` runs the list every SYNC_EVERY_MS while this
 * process holds the project's loop; `run` runs it at once (the person's "Out of sync?") and answers today's `{ at, asked,
 * rows, fine }`, or null when another board process holds the loop or the run failed (recorded as the loop "sync");
 * `view(now)` is `{ run, checkedAt, rules, incidents, lastSweep }`: the run the page shows (the newest asked, or one
 * that found something, for an hour; else null), when the list last ran, every rule (repair and watch) with how it
 * stood then and how often it tripped in the last day, and the parts later tasks fill (empty until then).
 * Task 2: the watch rules (rules/watch.mjs) run after the repairs and report only: their findings are the run's
 * `findings`. Task 3: each run's findings are filed as incidents in the work store (incidents.mjs, through `apply`, the
 * work API as the board), and `incidents` is what the store holds of them (incidents.mjs `incidentsOf`).
 */
export function createSupervisor(ports) {
  const { owns = async () => true, loops, closing = () => false, settings = {}, timers = globalThis, ...runnerPorts } = ports
  const runner = syncRunner({ ...runnerPorts, settings: settings.supervisor ?? {} }, REPAIR_RULES, WATCH_RULES)
  let timer = null
  // Task 3: the incidents as the store holds them, read after each run (and once at the start).
  let incidents = []
  const readIncidents = async () => {
    const items = await runnerPorts.items()
    incidents = incidentsOf(items, runnerPorts.now())
    return items
  }
  /**
   * Task 3: what a run found, filed as incidents (one per key: a lasting problem only counts), then the incidents read
   * anew. A finding that could not be filed is tried at the next run; the loop "incidents" says so on the page. Task 4:
   * each incident that opened or came back gives the person one line (a note of the board's, Via supervisor), never one
   * that only counted (Review Focus 2). Which is owed is read from the store (incidents.mjs `linesOwed`: open or came
   * back, and no line about it since), so a line that could not be filed goes at the next run, also after a restart.
   */
  const afterRun = async answer => {
    if (answer === null || answer === undefined) return answer
    await loops.run('incidents', async () => {
      const done = await recordFindings(answer.findings ?? [], { work: runnerPorts.apply, now: answer.at })
      const items = await readIncidents()
      const told = []
      for (const incident of linesOwed(items, incidents)) {
        const sent = await runnerPorts.apply({ action: 'note', to: 'you', text: [personWords(incident, incident.state === 'came back')], of: incident.id, via: 'supervisor' })
        if (sent?.ok !== true) told.push(`${incident.id}: ${sent?.why ?? 'no answer'}`)
      }
      const failed = [...done.failed.map(one => `${one.key}: ${one.why}`), ...told.map(one => `the line to you of ${one}`)]
      if (failed.length > 0) throw new Error(`${failed.length} not filed (${failed[0]})`)
    })
    return answer
  }
  return {
    start() {
      if (timer !== null) return
      void loops.run('incidents', readIncidents)
      timer = timers.setInterval(() => (closing() ? null : loops.run('sync', async () => (await owns() ? afterRun(await runner.run()) : null))), SYNC_EVERY_MS)
    },
    async run({ asked = false, subject = null } = {}) {
      const mine = await owns().catch(error => { loops.failed('sync', error); return false })
      if (!mine) return null
      return afterRun(await runner.run({ asked, subject }).catch(error => { loops.failed('sync', error); return null }))
    },
    /**
     * The supervisor's Task 5: the board's health summary (health.mjs) for the supervisor chat's sweep (`work health`),
     * from a view built now: the board's state, the store, the outbox and the repairs of the day in its memory.
     */
    async health() {
      const now = runnerPorts.now()
      const kept = typeof runnerPorts.memory?.load === 'function' ? await runnerPorts.memory.load() : null
      const view = buildView({
        state: await runnerPorts.state(), items: await runnerPorts.items(), outbox: runnerPorts.outbox(), repairs: memoryOf(kept).repairs,
        settings: settings.supervisor ?? {}, now,
      })
      return healthSummary(view, now)
    },
    view: now => {
      const { at, rules } = runner.status()
      return { run: runner.shown(now), checkedAt: at, rules, incidents, lastSweep: null }
    },
    stop() {
      if (timer !== null) timers.clearInterval(timer)
      timer = null
    },
  }
}
