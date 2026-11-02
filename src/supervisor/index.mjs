// The supervisor: the board checks itself (spec 2026-10-24, "The supervisor: the board checks itself, with code first and
// AI for the gaps"). One component owns all of the board's self-diagnosis; this is its one door. The server starts it in
// one place (`createSupervisor(ports).start()`) and the page asks it what to draw (`view(now)`); nothing else in the board
// imports its parts (test/supervisor/boundary.test.mjs). Task 1: the board's self-check ("Out of sync?", B465) moved in
// unchanged: its checks are the repair rules (rules/repair.mjs), its loop, lock and fixes are loop.mjs. It observes, and
// repairs only through the repairs the self-check had: unblock, hand a step on, wake a chat, a word to the main chat,
// clean a worktree. Part 2: the sweep (sweep.mjs), the AI for the gaps: the chat of role supervisor reads the health
// summary (health.mjs) every few minutes while work runs, and on "Check now", and files what looks wrong.

import { incidentCards } from './cards.mjs'
import { HEALTH_OWNERS, healthSummary, oddLines } from './health.mjs'
import { SYNC_EVERY_MS, memoryOf, syncRunner } from './loop.mjs'
import { buildView } from './view.mjs'
import { REFUSED_MS, REPAIR_RULES } from './rules/repair.mjs'
import { WATCH_RULES, isNearStop } from './rules/watch.mjs'
import { incidentsOf, linesOwed, recordFindings } from './incidents.mjs'
import { rekeyPlan } from './rekey.mjs'
import { GONE_MINUTES, gonePlan } from './gone.mjs'
import { SWEEP_AT_LEAST_HOURS, SWEEP_MOD, sweepRunner, tokensOfTurn } from './sweep.mjs'

import { judgeWords, sweepWords } from '../say.mjs'
import { readingAgeMinutes } from '../limits.mjs'
import { isLate } from '../store.mjs'
import { isHolding } from '../work/pause.mjs'
import { JUDGE, arrivedAt, awaitingJudgment, judgeInFlight, judgeWordOf } from '../work/judgeWord.mjs'

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
 * How the board's words to the Supervisor about an incident stand, as `wordState` gives them, one entry per judge word that
 * lists it, made since the incident got its state (the outbox as `store.outbox()` holds it). Empty for none. Signals change 6
 * (B915): the judge word (work/judgeWord.mjs) to the Supervisor's chat, in place of the incident word to the partner.
 */
export function incidentWordStates(outbox, incident, supervisor, now, keep = KEEP) {
  return outbox.filter(message => message.command === JUDGE && Array.isArray(message.incidents) && message.incidents.includes(incident.id) && message.to === supervisor
    && message.at >= (Number.isFinite(incident.since) ? incident.since : -Infinity)).map(message => wordState(message, now, keep))
}

/**
 * The cards' view of those words: per incident, `arrived` when one arrived, else `on its way` while one is, else `lost`
 * when there were only lost ones; an incident with no word at all has no entry.
 */
export function wordsOf(outbox, incidents, supervisor, now, keep = KEEP) {
  const words = new Map()
  for (const incident of incidents) {
    const states = incidentWordStates(outbox, incident, supervisor, now, keep)
    if (states.length > 0) words.set(incident.id, states.includes('arrived') ? 'arrived' : states.includes('on its way') ? 'on its way' : 'lost')
  }
  return words
}

/** What the loop "incidents" could not do, as its error: the first of them and how many. */
function throwFailed(failed) {
  if (failed.length > 0) throw new Error(`${failed.length} not filed (${failed[0]})`)
}

/** Every rule of the supervisor, as the page names them: `{ id, kind, says }` (the demo's section draws them too). */
export const SUPERVISOR_RULES = [...REPAIR_RULES, ...WATCH_RULES].map(({ id, kind, says }) => ({ id, kind, says }))
/**
 * Signals change 6 (B915 4b.4): the first words of the keys the code rules file (every rule's id, the repair fix-dropped's
 * retired key and a failed rule's): a sweep's finding under one of them is refused (the work API's `incident`).
 */
export const SUPERVISOR_RULE_KEYS = Object.freeze([...new Set([...REPAIR_RULES, ...WATCH_RULES].map(rule => rule.id).concat(['fix-dropped', 'rule-failed']))])
/** Signals change 6: the ids of the rules the loop runs; an incident whose Source is one of them has a gone clock. */
const RULE_IDS = new Set([...REPAIR_RULES, ...WATCH_RULES].map(rule => rule.id))
/** Signals change 6: the minutes an incident's key must stay unseen before it is gone (config `incidentGoneMinutes`, 60). */
const goneMinutes = settings => (Number.isFinite(settings?.incidentGoneMinutes) && settings.incidentGoneMinutes > 0 ? settings.incidentGoneMinutes : GONE_MINUTES)

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
 * `started` when the main chat was asked to start the chat), `markWord(id, fields)` (signals change 6: a field written on a
 * board word's record, the judge word's `endedAt`), `sweep` (see `sweepOver`; none, or no `tell`: no sweep; its `job`
 * is the Supervisor's job, also for the judge word) and `settings.supervisorSweepMinutes`.
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
  const { owns = async () => true, loops, closing = () => false, settings = {}, timers = globalThis, sweep: sweepPorts = null, tell = null, keep = KEEP, markWord = null, ...runnerPorts } = ports
  // Signals change 6 (B915): the job the judge word names is the Supervisor's (roles/supervisor.md), as its sweep word's.
  const supervisorJob = sweepPorts?.job ?? 'roles/supervisor.md'
  const runner = syncRunner({ ...runnerPorts, settings: settings.supervisor ?? {} }, REPAIR_RULES, WATCH_RULES)
  let timer = null
  let sweepTimer = null
  /** Task 5: the board's view for the health summary (health.mjs), built now: the board, the store, the outbox, the day's repairs. */
  const healthView = async () => {
    const now = runnerPorts.now()
    const kept = typeof runnerPorts.memory?.load === 'function' ? await runnerPorts.memory.load() : null
    // B736 (X89): the state and the store the board has when it has them, so a busy board still answers within seconds.
    const state = runnerPorts.keptState?.() ?? await runnerPorts.state()
    const items = runnerPorts.keptItems?.() ?? await runnerPorts.items()
    const view = buildView({
      state, items, outbox: runnerPorts.outbox(), repairs: memoryOf(kept).repairs, seen: memoryOf(kept).seen,
      settings: settings.supervisor ?? {}, now,
    })
    return { view, now }
  }
  const healthNow = async () => {
    const { view, now } = await healthView()
    return healthSummary(view, now)
  }
  /**
   * Signals change 6 (B915, Addendum 5): what is odd on the board that no rule owns, the sweep's one trigger of the board's
   * own (sweep.mjs `sweepRunner`): the health summary's odd lines, uncut, without times and counts, whose owner is no rule
   * and not 'info' (health.mjs `oddLines`). A rule that tripped is no trigger: it owns what it found.
   */
  const oddNow = async () => {
    const { view, now } = await healthView()
    return { odd: oddLines(view, now).filter(line => line.owner === null).map(line => line.text) }
  }
  /**
   * Signals change 6: the Supervisor chat's name, from the state the board has when it has one (B736: a work call of the chat,
   * work health among them, never waits for a whole read), else read now; null for none.
   */
  const supervisorName = async () => (runnerPorts.keptState?.() ?? await runnerPorts.state())?.supervisorChat?.name ?? null
  /** Signals change 6: whether the Supervisor's chat judges now or is about to (a judge word in flight, an incident waiting). */
  const judgingNow = async () => {
    const name = await supervisorName()
    if (name === null || tell === null) return false
    const outbox = runnerPorts.outbox()
    return judgeInFlight(outbox, name, runnerPorts.now(), keep) || awaitingJudgment(runnerPorts.keptItems?.() ?? await runnerPorts.items(), outbox, name).length > 0
  }
  const sweeper = sweepPorts === null || tell === null ? null
    : sweepOver(sweepPorts, { ports: runnerPorts, every: sweepEvery(settings), tell, keep, settings, facts: oddNow, judging: judgingNow })
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
      // Change 4's follow-up (2026-11-02): a rule whose key form changed re-keys or supersedes its standing incidents
      // first (rekey.mjs), so the new form never files the same case twice (X119-X122 → X124-X127).
      const items = runnerPorts.keptItems?.() ?? await runnerPorts.items()
      const plan = rekeyPlan({ items, outbox: runnerPorts.outbox(), wakes: (runnerPorts.keptState?.() ?? null)?.wakes ?? null })
      if (plan.moves.length + plan.closes.length > 0) await runnerPorts.apply({ action: 'incidents-rekey', ...plan })
      // Signals change 6's migration (B915, Addendum 9): an incident still "with the advisor" moves to "with the supervisor",
      // one History line each; no judge word ever listed it, so the next one lists them all, once (work/judgeWord.mjs).
      // Idempotent: a second run finds none.
      for (const id of advisorIncidents(items)) await runnerPorts.apply({ action: 'incident-told', id, migrate: true })
      const done = await recordFindings(answer.findings ?? [], { work: runnerPorts.apply, now: answer.at })
      throwFailed([...done.failed.map(one => `${one.key}: ${one.why}`), ...await goneNow(answer), ...await tellOwedNow()])
    })
    return answer
  }
  /**
   * Signals change 6 (B915, Addendum 2 and 3): after a run's findings are filed, what went by itself closes itself: an
   * incident of a rule its rule did not find for `incidentGoneMinutes` of running time (gone.mjs `gonePlan`) is gone, one in
   * fix whose step is done and that is not seen as long is fixed, through the board's own action `incident-gone`. Answers
   * what could not be done, one line.
   */
  const goneNow = async answer => {
    const items = await runnerPorts.items()
    const minutes = goneMinutes(settings)
    const plan = gonePlan({ incidents: incidentsOf(items, answer.at), steps: items, runs: answer.runs ?? {}, rules: RULE_IDS, now: answer.at, gaps: answer.gaps ?? [], goneMs: minutes * MIN })
    if (plan.gone.length + plan.fixed.length === 0) return []
    const done = await runnerPorts.apply({ action: 'incident-gone', gone: plan.gone, fixed: plan.fixed, minutes })
    return done?.ok === true ? [] : [`gone ${[...plan.gone, ...plan.fixed].map(one => one.id).join(', ')}: ${done?.why ?? 'no answer'}`]
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
   * after a restart): the person's line first (a note of the board's, Via supervisor; Review Focus 2: once per new or
   * returning incident, never for one that only counted, never for one gone by itself), then the Supervisor's judgment.
   * Signals change 6 (B915, Addendum 7, 4b.1): one judge word at a time through the outbox (`tell`, say.mjs `judgeWords`),
   * listing EVERY incident that waits (work/judgeWord.mjs `awaitingJudgment`; one whose person's line is not filed yet waits
   * for it); the next goes only once the Supervisor's turn after it ended (`judgeInFlight`). An incident is "with the
   * supervisor" (`incident-told`) only once the word that lists it arrived (typed, copied for the person, or taken by its mod
   * long ago); a lost word is sent again with what waits then. No judge word while a sweep runs (one thing at a time with the
   * chat), and none before the chat runs at its judging effort (config `supervisorJudgeEffort`, held by the board, state.mjs),
   * at most JUDGE_SET_WAIT_MS: then the word says the effort was not set. Without a Supervisor on the board the incident
   * stays open, its line told. Answers what could not be done, one line each.
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
    const card = tell === null ? null : (await runnerPorts.state()).supervisorChat ?? null
    const supervisor = card?.name ?? null
    if (supervisor === null) return failed
    const now = runnerPorts.now()
    const outbox = runnerPorts.outbox()
    // The judge word that arrived hands on what it lists that still waits (not one that came back after it went).
    let moved = false
    const word = judgeWordOf(outbox, supervisor)
    if (word !== null && arrivedAt(word, now, keep) !== null) {
      for (const incident of incidents.filter(one => word.incidents?.includes(one.id) && (one.state === 'open' || one.state === 'came back') && !(one.since > word.at))) {
        const handed = await runnerPorts.apply({ action: 'incident-told', id: incident.id, to: supervisor })
        if (handed?.ok === true) moved = true
        else failed.push(`${incident.id} with the supervisor: ${handed?.why ?? 'no answer'}`)
      }
    }
    if (moved) await readIncidents()
    if (judgeInFlight(outbox, supervisor, now, keep) || (sweeper !== null && sweeper.view().last?.ended === null)) return failed
    const lineOwed = new Set(owed.map(one => one.id))
    const waiting = new Set(awaitingJudgment(items, outbox, supervisor))
    const ready = incidents.filter(one => waiting.has(one.id) && (!lineOwed.has(one.id) || lined.has(one.id)))
      .sort((x, y) => String(x.id).localeCompare(String(y.id), 'en', { numeric: true }))
    if (ready.length === 0) return failed
    const effort = judgeEffort(settings)
    const isSet = card.setting === undefined || card.setting === null || card.setting.effort !== effort || card.setting.isSet === true
    const oldest = Math.min(...ready.map(one => (Number.isFinite(one.since) ? one.since : now)))
    if (!isSet && now - oldest < JUDGE_SET_WAIT_MS) return failed
    const done = await tell(judgeWords(supervisor, ready, { job: supervisorJob, effort, isSet })).catch(error => ({ ok: false, why: error instanceof Error ? error.message : String(error) }))
    if (done?.ok !== true) {
      failed.push(`the judge word to ${supervisor} of ${ready.map(one => one.id).join(', ')}: ${done?.why ?? 'no answer'}`)
      return failed
    }
    if (done.copied === true) {
      for (const incident of ready.filter(one => one.state === 'open' || one.state === 'came back')) {
        const handed = await runnerPorts.apply({ action: 'incident-told', id: incident.id, to: supervisor })
        if (handed?.ok !== true) failed.push(`${incident.id} with the supervisor: ${handed?.why ?? 'no answer'}`)
      }
      await readIncidents()
    }
    return failed
  }
  /**
   * Signals change 6 (4b.1): a turn of the Supervisor's chat ended: when the judge word that arrived has no end yet, this is
   * its turn: its record says so (`endedAt`, through `markWord`), and the next judge word may go. Answers true when it was.
   */
  const judgeTurnEnded = async (call = {}) => {
    const name = tell === null ? null : await supervisorName()
    if (name === null) return false
    const word = judgeWordOf(runnerPorts.outbox(), name)
    const now = runnerPorts.now()
    if (word === null || Number.isFinite(word.endedAt) || arrivedAt(word, now, keep) === null) return false
    // The turn's session and start too, so its tokens are read from its transcript a moment later (`judgeTokens`).
    const turn = Number(call.since)
    const fields = { endedAt: now, ...(typeof call.session === 'string' && call.session !== '' ? { session: call.session } : {}), ...(Number.isFinite(turn) ? { from: turn } : {}) }
    if (typeof markWord === 'function') await markWord(word.id, fields)
    else Object.assign(word, fields)
    return true
  }
  /**
   * Signals change 6 (the lead's decision 10: the morning-after count of sweeps and judgments, and their tokens): what each
   * judgment turn cost, read TOKENS_AFTER_MS after it ended from the Supervisor chat's transcript (the sweep's `tokens` port,
   * sweep.mjs `tokensOfTurn`), written on the judge word's record (`tokens`, `tokensRead`). At the sweep's minute look.
   */
  const judgeTokens = async now => {
    if (typeof sweepPorts?.tokens !== 'function') return
    for (const word of runnerPorts.outbox().filter(one => one?.command === JUDGE && Number.isFinite(one.endedAt) && one.tokensRead !== true && now - one.endedAt >= JUDGE_TOKENS_AFTER_MS)) {
      const read = typeof word.session === 'string' ? await sweepPorts.tokens({ session: word.session, from: Number.isFinite(word.from) ? word.from : word.endedAt }) : null
      const fields = { tokens: read?.total ?? null, tokensRead: true }
      if (typeof markWord === 'function') await markWord(word.id, fields)
      else Object.assign(word, fields)
    }
  }
  /** Signals change 6: whether a judge word arrived in the Supervisor's chat and its turn has not ended yet. */
  const judgeTurnOpen = async () => {
    const name = tell === null ? null : await supervisorName()
    const word = name === null ? null : judgeWordOf(runnerPorts.outbox(), name)
    return word !== null && !Number.isFinite(word.endedAt) && arrivedAt(word, runnerPorts.now(), keep) !== null && judgeInFlight(runnerPorts.outbox(), name, runnerPorts.now(), keep)
  }
  return {
    start() {
      if (timer !== null) return
      void loops.run('incidents', readIncidents)
      timer = timers.setInterval(() => (closing() ? null : loops.run('sync', async () => (await owns() ? afterRun(await runner.run()) : null))), SYNC_EVERY_MS)
      // Part 2: whether a sweep is due, every minute, where the board's loops run.
      if (sweeper !== null) {
        sweepTimer = timers.setInterval(() => (closing() ? null : loops.run('sweep', async () => {
          if (!(await owns())) return null
          await judgeTokens(runnerPorts.now())
          return sweeper.tick(runnerPorts.now())
        })), SWEEP_TICK_MS)
      }
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
      // Signals change 6 (4b.1): the end of a judgment turn ends that judgment, never a sweep (the judge word is its own kind):
      // while a judge word that arrived has no end, the chat's calls are the judgment's, not a sweep's.
      const isJudgeTurn = call.action === 'turn-ended' ? await loops.run('incidents', () => judgeTurnEnded(call)) === true : await judgeTurnOpen()
      if (sweeper !== null && !isJudgeTurn) await loops.run('sweep', () => sweeper.heard({ ...call, at: runnerPorts.now() }))
      // Task 7: what the sweep filed reaches the person and the Supervisor now, not at the next run of the rules.
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
     * its keeper holds it (null when it could not be read), `lanes` the board's chats, `supervisor` the Supervisor chat's name
     * (null for none; signals change 6: it judges the incidents), `flow` the store's flow. The incidents are read from those
     * items too, so an incident the Supervisor just linked to a fix step shows at once, not at the next run of the rules.
     * Without `live`, `cards` is empty. Signals change 6: each rule says which health lines it owns (`ownsHealth`).
     */
    view: (now, live = null) => {
      const { at, rules } = runner.status()
      const shown = live?.items instanceof Map ? incidentsOf(live.items, now) : incidents
      const supervisor = live?.supervisor ?? null
      const cards = live === null ? [] : incidentCards({
        incidents: shown, items: live.items ?? null, lanes: live.lanes ?? [], hasSupervisor: supervisor !== null,
        words: wordsOf(runnerPorts.outbox(), shown, supervisor, now, keep),
      })
      const owned = rules.map(rule => ({ ...rule, ownsHealth: HEALTH_OWNERS.includes(rule.id) }))
      // The page counts a rolling 24 hours of these incidents (and the 24 hours before) by itself: no start time is set.
      return { run: runner.shown(now), checkedAt: at, rules: owned, incidents: shown, cards, ...sweepView(sweeper, now, sweepEvery(settings)), judgmentsToday: judgmentsOf(runnerPorts.outbox(), now) }
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
 * Cheaper sweeps: the most hours of work without a sweep, in milliseconds (config.json's `supervisorSweepAtLeastHours`).
 * Signals change 6 (Addendum 5): 0 unless set, no net.
 */
const sweepAtLeast = settings => (Number.isFinite(settings.supervisorSweepAtLeastHours) && settings.supervisorSweepAtLeastHours >= 0 ? settings.supervisorSweepAtLeastHours : SWEEP_AT_LEAST_HOURS) * 60 * MIN

/** Signals change 6 (Addendum 7): the effort the Supervisor's chat judges at (config `supervisorJudgeEffort`, medium). */
const judgeEffort = settings => (typeof settings?.supervisorJudgeEffort === 'string' && settings.supervisorJudgeEffort !== '' ? settings.supervisorJudgeEffort : 'medium')
/** Signals change 6: a judgment turn's tokens are read this long after it ended (as a sweep's, sweep.mjs TOKENS_AFTER_MS). */
const JUDGE_TOKENS_AFTER_MS = 20_000
/**
 * Signals change 6 (the lead's decision 10): the judgment turns that ended in the last day and what they cost, as far as read:
 * `{ count, tokens }`, from the judge words' records in the outbox (the morning-after count beside `sweepsToday`).
 */
const judgmentsOf = (outbox, now) => {
  const ended = (outbox ?? []).filter(one => one?.command === JUDGE && Number.isFinite(one.endedAt) && now - one.endedAt < 24 * 60 * MIN)
  return { count: ended.length, tokens: ended.reduce((sum, one) => sum + (Number.isFinite(one.tokens) ? one.tokens : 0), 0) }
}
/** Signals change 6: how long the judge word waits for the chat to run at its judging effort before it goes anyway. */
const JUDGE_SET_WAIT_MS = 5 * MIN

/** Signals change 6's migration (Addendum 9): the incidents still "with the advisor", by id. */
const advisorIncidents = items => [...(items?.values() ?? [])]
  .filter(item => item.head?.get('Kind') === 'incident' && item.head.get('State') === 'with the advisor').map(item => item.head.get('Id')).filter(id => typeof id === 'string')

/**
 * Part 2: the sweep's runner (sweep.mjs) over the board. `sweep` ports: `chat()` how the board sees the supervisor's chat
 * (`{ named, title, card, withoutMod, mod }`, sweep.mjs `whyNoSweep`), `job` the supervisor's job text
 * (roles/supervisor.md), `tokens({ session, from })` what the turn cost, `memory` its file; `tell` the supervisor's port
 * for a board word. Work runs while a chat of the board works or a step is taken or in progress (Review Focus 3).
 */
function sweepOver(sweep, { ports, every, tell, keep, facts, settings, judging }) {
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
    // B640: a limit whose newest reading is over `oldReadingMinutes` old (B645: `settings.supervisor`'s, as the rules read it), while a chat works: the sweep's
    // chat looks the limits up (roles/supervisor.md), and the board keeps that reading (state.limitReadings). X47, X55, X56: only
    // a reading near a stop (watch.mjs `isNearStop`, as the rule old-limit-reading) is worth a turn of the chat; an old low one changes no decision.
    limitsOld: async () => {
      const state = await ports.state()
      const old = Number.isFinite(settings.supervisor?.oldReadingMinutes) ? settings.supervisor.oldReadingMinutes : 30
      return ['fiveHour', 'week'].some(key => (readingAgeMinutes(state.limits?.[key], ports.now()) ?? 0) > old && isNearStop(state.limits?.[key], key, settings.supervisor))
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
    wake: async ({ subject, trigger = null, lines = [] }) => {
      const card = (await sweep.chat())?.card ?? null
      if (card === null) return { ok: false, why: 'its chat is not on the board' }
      const told = await tell(sweepWords(card.name, { subject, job: sweep.job, trigger, lines }))
      if (told?.ok !== true) return { ok: false, why: told?.why ?? 'no answer' }
      const note = told.started === true ? 'its chat does not run: the main chat was asked to start it'
        : told.copied === true ? 'no Workers mod takes the board\'s words: the word waits to be pasted' : null
      return { ok: true, session: card.session ?? null, note }
    },
    tokens: one => sweep.tokens(one),
    memory: sweep.memory ?? null,
    // Signals change 6: the odd lines no rule owns (the trigger), the safety net only when set, and no sweep while the chat judges.
    facts: sweep.facts ?? facts,
    atLeast: sweepAtLeast(settings),
    judging: sweep.judging ?? judging,
  })
}

/**
 * Part 2: the sweep as the section shows it: `lastSweep` (`{ at, asked, subject, ended, how, found, tokens, tokenParts, read,
 * note }`, or null; `how` is "told" when its chat's turn ended it, "quiet" when the board ended it because nothing took
 * its word or ran a turn, null while it runs: the page tells from `read` and `how` whether the chat of an asked sweep
 * started), `sweepNote` (why the newest sweep did not run, `{ at, why, asked }`, when newer than the last one),
 * `sweepEvery` (minutes; 0 for none) and `sweepsToday` (`{ count, tokens }`: the sweeps that ended in the last day and
 * what they cost, as far as read).
 */
function sweepView(sweeper, now, every) {
  if (sweeper === null) return { lastSweep: null, sweepNote: null, sweepEvery: 0, sweepsToday: null }
  const { last, note, recent } = sweeper.view()
  const shown = last === null ? null : (({ session: _s, from: _f, tokensRead: _t, facts: _x, ...one }) => one)(last)
  const today = recent.filter(one => now - one.at < 24 * 60 * MIN)
  return {
    lastSweep: shown,
    sweepNote: note,
    sweepEvery: every / MIN,
    sweepsToday: { count: today.length, tokens: today.reduce((sum, one) => sum + (Number.isFinite(one.tokens) ? one.tokens : 0), 0) },
  }
}
