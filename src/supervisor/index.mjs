// The supervisor: the board checks itself (spec 2026-10-24, "The supervisor: the board checks itself, with code first and
// AI for the gaps"). One component owns all of the board's self-diagnosis; this is its one door. The server starts it in
// one place (`createSupervisor(ports).start()`) and the page asks it what to draw (`view(now)`); nothing else in the board
// imports its parts (test/supervisor/boundary.test.mjs). Task 1: the board's self-check ("Out of sync?", B465) moved in
// unchanged: its checks are the repair rules (rules/repair.mjs), its loop, lock and fixes are loop.mjs. It observes, and
// repairs only through the repairs the self-check had: unblock, hand a step on, wake a chat, a word to the main chat,
// clean a worktree. Part 2: the sweep (sweep.mjs), the AI for the gaps: the chat of role supervisor reads the health
// summary (health.mjs) every few minutes while work runs, and on "Check now", and files what looks wrong.

import { incidentCards } from './cards.mjs'
import { healthSummary } from './health.mjs'
import { SYNC_EVERY_MS, memoryOf, syncRunner } from './loop.mjs'
import { buildView } from './view.mjs'
import { REFUSED_MS, REPAIR_RULES } from './rules/repair.mjs'
import { WATCH_RULES } from './rules/watch.mjs'
import { incidentsOf, linesOwed, recordFindings } from './incidents.mjs'
import { SWEEP_MOD, sweepRunner, tokensOfTurn } from './sweep.mjs'
import { createHash } from 'node:crypto'

import { incidentWords, sweepWords } from '../say.mjs'
import { isLate } from '../store.mjs'
import { flowQueuesFixes } from '../work/incidentFix.mjs'
import { isHolding } from '../work/pause.mjs'

/** How long the server keeps a name a chat's mod was refused under: as long as the rule `old-name` looks back. */
export { REFUSED_MS }
/** The incident cards (cards.mjs), also for the demo, which makes its own incidents and steps. */
export { incidentCards }
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

/** The review: how long the board keeps a word as it keeps its outbox's, unless the server gives its own (`keep`). */
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
/** The review: a word the mod took and never said it typed counts as on its way this long (store.mjs TAKEN_SHOWN_MS). */
const TAKEN_MS = 10 * MIN

/**
 * The review: how a board word in the raw outbox stands now. `on its way`: waiting and not late, held by a pause, or
 * taken lately; `arrived`: typed (delivered), copied for the person to paste, or taken long ago (the mod took it, its
 * report did not come); `lost`: expired, failed, or waiting past its time (the raw outbox never marks that one).
 */
export function wordState(message, now, keep = KEEP) {
  if (message.state === 'delivered' || message.state === 'copied') return 'arrived'
  if (message.state === 'taken') return now - (message.takenAt ?? message.at) < TAKEN_MS ? 'on its way' : 'arrived'
  if (message.state === 'held') return 'on its way'
  if (message.state === 'waiting') return isLate(message, now, keep) ? 'lost' : 'on its way'
  return 'lost'
}

/**
 * How the board's words to the partner about an incident stand, as `wordState` gives them, one entry per word it made
 * since the incident got its state (the outbox as `store.outbox()` holds it). Empty for none.
 */
export function incidentWordStates(outbox, incident, partner, now, keep = KEEP) {
  return outbox.filter(message => message.command === 'incident' && message.about === incident.id && message.to === partner
    && message.at >= (Number.isFinite(incident.since) ? incident.since : -Infinity)).map(message => wordState(message, now, keep))
}

/**
 * The cards' view of those words: per incident, `arrived` when one arrived, else `on its way` while one is, else `lost`
 * when there were only lost ones; an incident with no word at all has no entry.
 */
export function wordsOf(outbox, incidents, partner, now, keep = KEEP) {
  const words = new Map()
  for (const incident of incidents) {
    const states = incidentWordStates(outbox, incident, partner, now, keep)
    if (states.length > 0) words.set(incident.id, states.includes('arrived') ? 'arrived' : states.includes('on its way') ? 'on its way' : 'lost')
  }
  return words
}

/**
 * The review: what the board looks like, for skipping a sweep while nothing changed: the health summary's sha1 with its
 * times and counts masked (clock times, spans such as "1 h 5 min", how often seen, the limits' percent); its odd marks ("!") stay.
 */
export const factsOf = summary => createHash('sha1')
  .update(String(summary).replace(/\b\d{1,2}:\d{2}\b|\b\d+ (?:min|h|d)\b(?: \d+ min\b)?|seen \d+ times|\d+% used/g, '#'))
  .digest('hex')

/** What the loop "incidents" could not do, as its error: the first of them and how many. */
function throwFailed(failed) {
  if (failed.length > 0) throw new Error(`${failed.length} not filed (${failed[0]})`)
}

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
 * chat); Part 2: `tell(message)` (a board word into the outbox, as every board word goes: `{ ok, started, copied }`,
 * `started` when the main chat was asked to start the chat), `partnerJob` (roles/partner.md, for the incident's word to
 * the partner), `sweep` (see `sweepOver`; none, or no `tell`: no sweep) and `settings.supervisorSweepMinutes`.
 * Answers `{ start(), run({ asked, subject }), checkNow({ subject }), heard(call), health(), view(now), stop() }`: `start`
 * runs the list every SYNC_EVERY_MS while this process holds the project's loop, and looks every minute whether a sweep
 * is due; `run` runs the list at once and answers today's `{ at, asked, rows, fine }`, or null when another board process
 * holds the loop or the run failed (recorded as the loop "sync"); `checkNow` is the person's "Check now": the list and a
 * sweep at once; `heard` takes the supervisor chat's work calls; `health` is the summary its sweep reads;
 * `view(now, live)` is `{ run, checkedAt, rules, incidents, cards, lastSweep, sweepNote, sweepEvery, sweepsToday }`: the
 * run the page shows (the newest asked, or one that found something, for an hour; else null), when the list last ran, every
 * rule (repair and watch) with how it stood then and how often it tripped in the last day, the incidents and their cards
 * (one per fix step, from `live`), and the sweep (`sweepView`).
 * Task 2: the watch rules (rules/watch.mjs) run after the repairs and report only: their findings are the run's
 * `findings`. Task 3: each run's findings are filed as incidents in the work store (incidents.mjs, through `apply`, the
 * work API as the board), and `incidents` is what the store holds of them (incidents.mjs `incidentsOf`).
 */
export function createSupervisor(ports) {
  const { owns = async () => true, loops, closing = () => false, settings = {}, timers = globalThis, sweep: sweepPorts = null, tell = null, partnerJob = 'roles/partner.md', keep = KEEP, ...runnerPorts } = ports
  const runner = syncRunner({ ...runnerPorts, settings: settings.supervisor ?? {} }, REPAIR_RULES, WATCH_RULES)
  let timer = null
  let sweepTimer = null
  /** Task 5: the board's health summary (health.mjs), from a view built now: the board, the store, the outbox, the day's repairs. */
  const healthNow = async () => {
    const now = runnerPorts.now()
    const kept = typeof runnerPorts.memory?.load === 'function' ? await runnerPorts.memory.load() : null
    const view = buildView({
      state: await runnerPorts.state(), items: await runnerPorts.items(), outbox: runnerPorts.outbox(), repairs: memoryOf(kept).repairs,
      settings: settings.supervisor ?? {}, now,
    })
    return healthSummary(view, now)
  }
  const sweeper = sweepPorts === null || tell === null ? null
    : sweepOver(sweepPorts, { ports: runnerPorts, every: sweepEvery(settings), tell, keep, facts: async () => factsOf(await healthNow()) })
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
      throwFailed([...done.failed.map(one => `${one.key}: ${one.why}`), ...await tellOwedNow()])
    })
    return answer
  }
  /**
   * The review: one `tellOwed` at a time (a run of the rules and a sweep's turn's end may come together), each reading
   * the store anew once the one before is done, so no incident gets two lines or two words.
   */
  let telling = Promise.resolve()
  const tellOwedNow = () => {
    const run = telling.then(async () => tellOwed(await readIncidents()))
    telling = run.catch(() => {})
    return run
  }
  /**
   * Tasks 4 and 7: what each incident that opened or came back is owed, from the store (also one the sweep filed, and
   * after a restart): the person's line first (a note of the board's, Via supervisor), then, once that line is filed,
   * the partner's word through the outbox (`tell`, say.mjs `incidentWords`; Review Focus 2: once per new or returning
   * incident, never for one that only counted). The review: the incident is "with the advisor" (`incident-told`) only
   * once that word arrived (typed into the partner's chat, copied for the person, or taken by its mod long ago); while it
   * is on its way nothing more happens, and one that was lost (expired, failed, waiting past its time: a partner that did
   * not run) is sent again. Without a partner on the board the incident stays open, its line told. Answers what could not
   * be done, one line each.
   */
  const tellOwed = async items => {
    const failed = []
    const owed = linesOwed(items, incidents)
    const lined = new Set()
    for (const incident of owed) {
      const sent = await runnerPorts.apply({ action: 'note', to: 'you', text: [personWords(incident, incident.state === 'came back')], of: incident.id, via: 'supervisor' })
      if (sent?.ok === true) lined.add(incident.id)
      else failed.push(`the line to you of ${incident.id}: ${sent?.why ?? 'no answer'}`)
    }
    const partner = tell === null ? null : (await runnerPorts.state()).advisor?.name ?? null
    if (partner === null) return failed
    const lineOwed = new Set(owed.map(one => one.id))
    const ready = incidents.filter(one => (one.state === 'open' || one.state === 'came back') && (!lineOwed.has(one.id) || lined.has(one.id)))
    let moved = false
    const now = runnerPorts.now()
    for (const incident of ready) {
      // Its words to the partner since it got its state, as they stand now: one arrived hands it on, one on its way waits.
      const words = incidentWordStates(runnerPorts.outbox(), incident, partner, now, keep)
      if (!words.includes('arrived')) {
        if (words.includes('on its way')) continue
        const done = await tell(incidentWords(partner, incident, partnerJob)).catch(error => ({ ok: false, why: error instanceof Error ? error.message : String(error) }))
        if (done?.ok !== true) failed.push(`the word to ${partner} of ${incident.id}: ${done?.why ?? 'no answer'}`)
        else if (done.copied === true) words.push('arrived')
        if (!words.includes('arrived')) continue
      }
      const handed = await runnerPorts.apply({ action: 'incident-told', id: incident.id, to: partner })
      if (handed?.ok === true) moved = true
      else failed.push(`${incident.id} with the advisor: ${handed?.why ?? 'no answer'}`)
    }
    if (moved) await readIncidents()
    return failed
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
      if (sweeper !== null) await loops.run('sweep', () => sweeper.heard({ ...call, at: runnerPorts.now() }))
      // Task 7: what the sweep filed reaches the person and the partner now, not at the next run of the rules.
      if (call.action === 'turn-ended') await loops.run('incidents', async () => throwFailed(await tellOwedNow()))
    },
    /**
     * The supervisor's Task 5: the board's health summary (health.mjs) for the supervisor chat's sweep (`work health`),
     * from a view built now: the board's state, the store, the outbox and the repairs of the day in its memory.
     */
    health: () => healthNow(),
    /**
     * The cards (cards.mjs): one per fix step, so the page shows what is being done about the incidents as it happens. They
     * are made from `live`, what the board knows at this look (the server passes it at every refresh): `items` the store as
     * its keeper holds it (null when it could not be read), `lanes` the board's chats (also the Advisor's), `partner` the
     * Advisor's name (null for none), `flow` the store's flow (whether the board queues incident fixes itself). The incidents are read from those items too, so an incident the partner just linked to
     * a fix step shows at once, not at the next run of the rules. Without `live`, `cards` is empty.
     */
    view: (now, live = null) => {
      const { at, rules } = runner.status()
      const shown = live?.items instanceof Map ? incidentsOf(live.items, now) : incidents
      const partner = live?.partner ?? null
      const cards = live === null ? [] : incidentCards({
        incidents: shown, items: live.items ?? null, lanes: live.lanes ?? [], hasPartner: partner !== null, boardQueues: flowQueuesFixes(live.flow),
        words: wordsOf(runnerPorts.outbox(), shown, partner, now, keep),
      })
      return { run: runner.shown(now), checkedAt: at, rules, incidents: shown, cards, ...sweepView(sweeper, now, sweepEvery(settings)) }
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
 * (`{ named, title, card, withoutMod, mod }`, sweep.mjs `whyNoSweep`), `job` the supervisor's job text
 * (roles/supervisor.md), `tokens({ session, from })` what the turn cost, `memory` its file; `tell` the supervisor's port
 * for a board word. Work runs while a chat of the board works or a step is taken or in progress (Review Focus 3).
 */
function sweepOver(sweep, { ports, every, tell, keep, facts }) {
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
    // Its word on its way, or a turn of its chat running. The review: only a word waiting within its time, or taken in the
    // last 10 minutes: an expired word stays "waiting" in the raw outbox, and one whose typing was never reported "taken".
    sweeping: async () => {
      const card = (await sweep.chat())?.card ?? null
      if (card === null) return false
      if (card.state === 'working' || card.state === 'waiting') return true
      const now = ports.now()
      return ports.outbox().some(message => message.to === card.name && message.command === 'sweep'
        && ((message.state === 'waiting' && !isLate(message, now, keep)) || (message.state === 'taken' && now - (message.takenAt ?? message.at) < TAKEN_MS)))
    },
    wake: async ({ subject }) => {
      const card = (await sweep.chat())?.card ?? null
      if (card === null) return { ok: false, why: 'its chat is not on the board' }
      const told = await tell(sweepWords(card.name, { subject, job: sweep.job }))
      if (told?.ok !== true) return { ok: false, why: told?.why ?? 'no answer' }
      const note = told.started === true ? 'its chat does not run: the main chat was asked to start it'
        : told.copied === true ? 'no Workers mod takes the board\'s words: the word waits to be pasted' : null
      return { ok: true, session: card.session ?? null, note }
    },
    tokens: one => sweep.tokens(one),
    memory: sweep.memory ?? null,
    // The review: what the board looks like, so a sweep by the clock is skipped while nothing changed.
    facts: sweep.facts ?? facts,
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
  const shown = last === null ? null : (({ session: _s, from: _f, tokensRead: _t, how: _h, facts: _x, ...one }) => one)(last)
  const today = recent.filter(one => now - one.at < 24 * 60 * MIN)
  return {
    lastSweep: shown,
    sweepNote: note,
    sweepEvery: every / MIN,
    sweepsToday: { count: today.length, tokens: today.reduce((sum, one) => sum + (Number.isFinite(one.tokens) ? one.tokens : 0), 0) },
  }
}
