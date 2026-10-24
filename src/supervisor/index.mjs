// The supervisor: the board checks itself (spec 2026-10-24, "The supervisor: the board checks itself, with code first and
// AI for the gaps"). One component owns all of the board's self-diagnosis; this is its one door. The server starts it in
// one place (`createSupervisor(ports).start()`) and the page asks it what to draw (`view(now)`); nothing else in the board
// imports its parts (test/supervisor/boundary.test.mjs). Task 1: the board's self-check ("Out of sync?", B465) moved in
// unchanged: its checks are the repair rules (rules/repair.mjs), its loop, lock and fixes are loop.mjs. It observes, and
// repairs only through the repairs the self-check had: unblock, hand a step on, wake a chat, a word to the main chat,
// clean a worktree. Part 2: the sweep (sweep.mjs), the AI for the gaps: the chat of role supervisor reads the health
// summary (health.mjs) every few minutes while work runs, and on "Check now", and files what looks wrong.

import { healthSummary } from './health.mjs'
import { SYNC_EVERY_MS, memoryOf, syncRunner } from './loop.mjs'
import { buildView } from './view.mjs'
import { REFUSED_MS, REPAIR_RULES } from './rules/repair.mjs'
import { WATCH_RULES } from './rules/watch.mjs'
import { incidentsOf, linesOwed, recordFindings } from './incidents.mjs'
import { SWEEP_MOD, sweepRunner, tokensOfTurn } from './sweep.mjs'
import { sweepWords } from '../say.mjs'
import { isHolding } from '../work/pause.mjs'

/** How long the server keeps a name a chat's mod was refused under: as long as the rule `old-name` looks back. */
export { REFUSED_MS }
/**
 * B482, B488: the project's one lock for the board's loops (loop.mjs). The server builds its gate from these and gives it
 * to the supervisor as `owns`, so the list runs only where every other loop of the board runs.
 */
export { loopGate, loopOwner } from './loop.mjs'

/** Part 2: the Workers mod the supervisor's chat needs for a sweep; what a sweep's turn cost, from its transcript. */
export { SWEEP_MOD, tokensOfTurn }

/** How often the board looks whether a sweep is due, and whether the last one ended. */
const SWEEP_TICK_MS = 60_000
const MIN = 60_000
/** The states of a step that is under way: work runs while one is. */
const UNDER_WAY = ['taken', 'in progress']

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
 * chat); Part 2: `sweep` (see `sweepOver`; none: no sweep) and `settings.supervisorSweepMinutes`.
 * Answers `{ start(), run({ asked, subject }), checkNow({ subject }), heard(call), health(), view(now), stop() }`: `start`
 * runs the list every SYNC_EVERY_MS while this process holds the project's loop, and looks every minute whether a sweep
 * is due; `run` runs the list at once and answers today's `{ at, asked, rows, fine }`, or null when another board process
 * holds the loop or the run failed (recorded as the loop "sync"); `checkNow` is the person's "Check now": the list and a
 * sweep at once; `heard` takes the supervisor chat's work calls; `health` is the summary its sweep reads;
 * `view(now)` is `{ run, checkedAt, rules, incidents, lastSweep, sweepNote, sweepEvery, sweepsToday }`: the run the page
 * shows (the newest asked, or one that found something, for an hour; else null), when the list last ran, every rule
 * (repair and watch) with how it stood then and how often it tripped in the last day, and the sweep (`sweepView`).
 * Task 2: the watch rules (rules/watch.mjs) run after the repairs and report only: their findings are the run's
 * `findings`. Task 3: each run's findings are filed as incidents in the work store (incidents.mjs, through `apply`, the
 * work API as the board), and `incidents` is what the store holds of them (incidents.mjs `incidentsOf`).
 */
export function createSupervisor(ports) {
  const { owns = async () => true, loops, closing = () => false, settings = {}, timers = globalThis, sweep: sweepPorts = null, ...runnerPorts } = ports
  const runner = syncRunner({ ...runnerPorts, settings: settings.supervisor ?? {} }, REPAIR_RULES, WATCH_RULES)
  let timer = null
  let sweepTimer = null
  const sweeper = sweepPorts === null ? null : sweepOver(sweepPorts, { ports: runnerPorts, every: sweepEvery(settings) })
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
      // Part 2: whether a sweep is due, every minute, where the board's loops run.
      if (sweeper !== null) sweepTimer = timers.setInterval(() => (closing() ? null : loops.run('sweep', async () => (await owns() ? sweeper.tick(runnerPorts.now()) : null))), SWEEP_TICK_MS)
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
    /**
     * Part 2, "Check now" (Review Focus 4): the rules at once (`run`, asked), and a sweep at once, or the plain reason none
     * runs: `{ run, sweep: { started, why, note } }`. Another board process of the project runs neither here.
     */
    async checkNow({ subject = null } = {}) {
      const mine = await owns().catch(error => { loops.failed('sync', error); return false })
      if (!mine) return { run: null, sweep: { started: false, why: 'another board process of this project runs its checks: use its page', note: null } }
      const run = await afterRun(await runner.run({ asked: true, subject }).catch(error => { loops.failed('sync', error); return null }))
      if (sweeper === null) return { run, sweep: { started: false, why: 'this board runs no sweeps', note: null } }
      const sweep = await loops.run('sweep', () => sweeper.now({ subject, at: runnerPorts.now() }))
      return { run, sweep: sweep ?? { started: false, why: 'the sweep could not be started: the board\'s loop "sweep" says why', note: null } }
    },
    /**
     * Part 2: a work call of the supervisor's chat (`{ action, ok, session, since }`): a health read, an incident filed, or
     * its turn's end, for the sweep that runs. Its tokens are read a moment after its turn ended (the next tick).
     */
    async heard(call) {
      if (sweeper === null) return
      await loops.run('sweep', () => sweeper.heard({ ...call, at: runnerPorts.now() }))
    },
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
      return { run: runner.shown(now), checkedAt: at, rules, incidents, ...sweepView(sweeper, now, sweepEvery(settings)) }
    },
    stop() {
      if (timer !== null) timers.clearInterval(timer)
      if (sweepTimer !== null) timers.clearInterval(sweepTimer)
      timer = null
      sweepTimer = null
    },
  }
}

/** Part 2: how often a sweep runs, in milliseconds (config.json's `supervisorSweepMinutes`, 10 unless set; 0: none). */
const sweepEvery = settings => (Number.isFinite(settings.supervisorSweepMinutes) && settings.supervisorSweepMinutes >= 0 ? settings.supervisorSweepMinutes : 10) * MIN

/**
 * Part 2: the sweep's runner (sweep.mjs) over the board. `sweep` ports: `chat()` how the board sees the supervisor's chat
 * (`{ named, title, card, withoutMod, mod }`, sweep.mjs `whyNoSweep`), `tell(message)` a board word into the outbox, as
 * every board word goes (`{ ok, started, copied }`: `started` when the main chat was asked to start the chat), `job` the
 * supervisor's job text (roles/supervisor.md), `tokens({ session, from })` what the turn cost, `memory` its file. Work
 * runs while a chat of the board works or a step is taken or in progress (Review Focus 3).
 */
function sweepOver(sweep, { ports, every }) {
  const chats = state => [...(state.chats ?? []).filter(one => !one.isLeftover), ...(state.advisor ? [state.advisor] : []), ...(state.advisorHelper ? [state.advisorHelper] : [])]
  return sweepRunner({
    every,
    workRuns: async () => {
      const state = await ports.state()
      if (chats(state).some(one => one.state === 'working')) return true
      return [...((await ports.items())?.values() ?? [])].some(item => (item.head.get('Kind') ?? 'step') === 'step' && UNDER_WAY.includes(item.head.get('State')))
    },
    paused: async () => {
      const pause = (await ports.state()).pause ?? null
      return isHolding(pause) || pause?.state === 'resuming'
    },
    atLimit: async () => {
      const limits = (await ports.state()).limits ?? {}
      return ['fiveHour', 'week'].some(key => limits[key]?.level === 'full')
    },
    chat: () => sweep.chat(),
    // Its word on its way (not taken, or taken and not typed yet), or a turn of its chat running.
    sweeping: async () => {
      const card = (await sweep.chat())?.card ?? null
      if (card === null) return false
      if (card.state === 'working' || card.state === 'waiting') return true
      return ports.outbox().some(message => message.to === card.name && message.command === 'sweep' && ['waiting', 'taken', 'held'].includes(message.state))
    },
    wake: async ({ subject }) => {
      const card = (await sweep.chat())?.card ?? null
      if (card === null) return { ok: false, why: 'its chat is not on the board' }
      const told = await sweep.tell(sweepWords(card.name, { subject, job: sweep.job }))
      if (told?.ok !== true) return { ok: false, why: told?.why ?? 'no answer' }
      const note = told.started === true ? 'its chat does not run: the main chat was asked to start it'
        : told.copied === true ? 'no Workers mod takes the board\'s words: the word waits to be pasted' : null
      return { ok: true, session: card.session ?? null, note }
    },
    tokens: one => sweep.tokens(one),
    memory: sweep.memory ?? null,
  })
}

/**
 * Part 2: the sweep as the section shows it: `lastSweep` (`{ at, asked, subject, ended, found, tokens, tokenParts, read,
 * note }`, or null), `sweepNote` (why the newest sweep did not run, `{ at, why, asked }`, when newer than the last one),
 * `sweepEvery` (minutes; 0 for none) and `sweepsToday` (`{ count, tokens }`: the sweeps that ended in the last day and
 * what they cost, as far as read).
 */
function sweepView(sweeper, now, every) {
  if (sweeper === null) return { lastSweep: null, sweepNote: null, sweepEvery: 0, sweepsToday: null }
  const { last, note, recent } = sweeper.view()
  const shown = last === null ? null : (({ session: _s, from: _f, tokensRead: _t, how: _h, ...one }) => one)(last)
  const today = recent.filter(one => now - one.at < 24 * 60 * MIN)
  return {
    lastSweep: shown,
    sweepNote: note,
    sweepEvery: every / MIN,
    sweepsToday: { count: today.length, tokens: today.reduce((sum, one) => sum + (Number.isFinite(one.tokens) ? one.tokens : 0), 0) },
  }
}
