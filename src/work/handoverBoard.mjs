// T8.5, step 2 (spec .claude/specs/2026-10-31-handover-design.md, parts 2 and 4): the board side of the hand-over as one
// sequence. For a worker on the sequence (handover.mjs `onSequence`) the board decides at its turn end (`turn-ended`) and
// at every other event (its envelope's outcome through `typed`, the refresh that finds a ready task, a pause or a resume,
// a limit, its first call on a new mod, its report turning idle with nothing in the background, the report check
// ending), and carries out what the one decision answers: the task in flight back on the list, the task given in the
// same call, the one envelope into the outbox, the net marked once. One decision at a time per store (`inTurn`),
// whoever asks: two events at once never trip over each other (principle 5).
//
// The envelope is one outbox message (command `handover`) to the worker, carried by the turn-ended answer (the fast path)
// or by its next take (the mod is asleep, or the answer was late). Its `set` is the hands' job (the app refuses a chat
// setting its own model or effort, src/hands.mjs): the board writes the set word beside it, and the envelope waits for
// that word's done before it is handed out (one more event, no clock); a set word that failed is the envelope's failed
// outcome.

import { RESTART_COMMAND, restartWords } from './modRollout.mjs'
import { EFFORTS, chatEffort, effortOf, effortWords, modelOf, runSettings, sameModel } from './effort.mjs'
import { HANDOVER_COMMAND, contractOf, decide, envelopesOf, failedWhy, isClearOwedOnly, mergeStages, onSequence } from './handover.mjs'
import { giveBackStep } from './giveBack.mjs'
import { GIVE_BACK_MINUTES, RESUME_MINUTES, continuationOf, standOf } from './holderTimers.mjs'
import { isHolding } from './pause.mjs'
import { readStore } from './store.mjs'
import { isLate } from '../store.mjs'
import { wakeFact } from '../wake.mjs'
import { resolve } from 'node:path'

/** One decision at a time per store folder, in this process (the board is the store's only writer). */
const turns = new Map()
export function inTurn(dir, run) {
  const key = resolve(dir)
  const turn = (turns.get(key) ?? Promise.resolve()).then(run, run)
  turns.set(key, turn.catch(() => {}))
  return turn
}

/** The words that stand in the outbox (and on the page) for an envelope; the mod reads its fields, not this. */
const textOf = envelope => [
  'hand-over',
  ...(envelope.restart ? [`Restart for the Workers mod ${envelope.version}`] : []),
  ...(envelope.clear === null ? [] : [`Clear after ${envelope.clear.step}`]),
  ...(envelope.set === null ? [] : [`Set: ${envelope.set.model ?? 'its model'} · ${envelope.set.effort}`]),
  ...(envelope.line === null ? [] : [`Line: ${envelope.line}`]),
].join('\n')

const MIN = 60_000

/** The off time of the board since `from`, out of the state's gaps (history.mjs `gapsOf`). */
const offMsOf = (gaps, now) => from => (Number.isFinite(from) ? (gaps ?? []).reduce((sum, gap) => sum + Math.max(0, Math.min(gap.to, now) - Math.max(gap.from, from)), 0) : 0)

/**
 * What the worker's chat must be set to for step `id` (`{ model, effort }`), or null when it runs it already: the step's
 * model (the settings' id of its family; none named: the effort alone) and effort, as effort.mjs reads them. A chat whose
 * effort the app's file does not say is not asked for the effort alone (the board could not see it set).
 */
export function setterFor(lane, items, config) {
  const { models } = runSettings(config)
  return id => {
    const item = items.get(id)
    if (item === undefined) return null
    const effort = effortOf(item).level
    const model = models[modelOf(item).family] ?? null
    const current = chatEffort(lane)
    const runsModel = model === null || (typeof lane.model === 'string' && sameModel(lane.model, model))
    if (runsModel && (current === null || current === effort)) return null
    return { model: runsModel ? null : model, effort: EFFORTS.includes(effort) ? effort : 'medium' }
  }
}

/** Signals change 3: the person's stop and remove words about a worker (B769, carried out by code), from the outbox. */
const stopsOf = (sent, name) => (sent ?? []).filter(one => (one?.command === 'stop' || one?.command === 'remove') && one.byCode === true && one.about === name)

/**
 * The facts of one worker's decision, out of the state, a fresh read of the store and the outbox. Signals change 4: `wakes`
 * the server's wake facts (`{ record, senderClaims, canLaunch }`, src/wake.mjs), or null where none is kept.
 */
export function factsOf({ lane, state, items, pause, sent, config, installed = null, now, event, localOnly = new Set(), wakes = null }) {
  const prefix = state.chatPrefix ?? ''
  return {
    worker: lane, items, prefix,
    ready: state.readyList?.ready ?? [],
    paused: isHolding(pause),
    limitFull: ['fiveHour', 'week'].some(kind => state.limits?.[kind]?.level === 'full'),
    installed,
    owed: lane.clearOwed ?? null,
    envelopes: envelopesOf(sent, lane.name, prefix),
    setFor: setterFor(lane, items, config),
    now,
    runningMs: from => now - from - offMsOf(state.gaps, now)(from),
    event,
    // Signals change 3: the holder's two timers.
    pause: pause ?? null,
    stops: stopsOf(sent, lane.name),
    timers: { resumeMs: (config?.resumeAfterMinutes ?? RESUME_MINUTES) * MIN, giveBackMs: (config?.giveBackAfterMinutes ?? GIVE_BACK_MINUTES) * MIN },
    localOnly,
    // Signals change 4 (D.1): the wake of its chat. D.5 (decision 13) is the pass's order alone (running lanes first, and
    // `match`'s): the review of 2026-11-02 found a sleeper held back for a running worker that would not take the task.
    wake: wakeFact(wakes, lane, event),
    // 2026-11-02: when this board started, so a clear the board's own restart cut counts as no time-out (handover.mjs).
    boardStartedAt: Number.isFinite(state.board?.startedAt) ? state.board.startedAt : null,
  }
}

/**
 * Signals change 3: the given-back steps of the ready list whose checkpoint commit is on no remote branch (the
 * continuation line names it "local only"). `isPushed({ branch, commit })` answers true, false or null (not known: not
 * named); without it none is named.
 */
async function localOnlyOf(ready, items, isPushed) {
  const found = new Set()
  if (typeof isPushed !== 'function') return found
  for (const one of ready ?? []) {
    const item = items.get(one.id)
    if (item === undefined || continuationOf(item) === null) continue
    const { branch, commit } = standOf(item)
    if (commit === 'none') continue
    if (await isPushed({ branch, commit }).catch(() => null) === false) found.add(one.id)
  }
  return found
}

/**
 * The envelope waiting for `chat` that may be handed out now: its set word (when it has one) is done. Signals change 4, D.4
 * (decision 12): `holdClear` while the chat's first turn after a wake runs (src/wake.mjs `inFirstTurn`): an envelope with a
 * clear waits for that turn's end (its clear would fail "a turn is running"); the chat's next take gets it.
 */
export function carryable(sent, chat, now, keep, { holdClear = false } = {}) {
  return sent.find(message => message.command === HANDOVER_COMMAND && message.to === chat && message.state === 'waiting' && !isLate(message, now, keep)
    && !(holdClear && message.clear !== null && message.clear !== undefined)
    && (typeof message.waitsFor !== 'string' || sent.find(one => one.id === message.waitsFor)?.state === 'delivered')) ?? null
}

/** Hands the carryable envelope of `chat` out (marked taken, as a take marks a word): its contract, or null. */
export async function handOut(outbox, chat, now, keep, { holdClear = false, waiveLine = () => false } = {}) {
  const found = carryable(outbox.outbox(), chat, now, keep, { holdClear })
  if (found === null) return null
  // X107 and X3 again (2026-11-02, Workers 5 and 2): the chat was woken by a message that carried this step's take line, so
  // the envelope's own line is waived: typed too, it waited behind the wake turn and started a stale turn after the report,
  // in which the owed clear failed. The clear and the set of the envelope still go; the mod types nothing (`line` null).
  if (typeof found.line === 'string' && typeof found.step === 'string' && waiveLine(found.step) === true) {
    await outbox.update(found.id, { line: null, lineWaived: 'the wake message carried its take line' })
  }
  const taken = await outbox.take(chat, now, keep, message => message.id === found.id)
  return taken.length === 0 ? null : contractOf(taken[0])
}

/**
 * The outcome of an envelope, from its mod (`typed` with `handover` and `outcome`): settled once, delivered when nothing
 * failed, else failed with why. True when it was settled now; an envelope of another chat, one settled before, or none: false.
 */
export async function settle(outbox, chat, id, outcome, now) {
  const message = outbox.outbox().find(one => one.id === id && one.command === HANDOVER_COMMAND && one.to === chat)
  if (message === undefined || (message.outcome ?? null) !== null || !['waiting', 'taken'].includes(message.state)) return false
  const settled = { ...message, outcome }
  // The lazy clear (D4): a clear owed while its line went in is delivered, as failedOf reads it (one predicate for both).
  const isFailed = !isClearOwedOnly(message, outcome)
    && (outcome.cleared === false || outcome.set === false || outcome.restarted === false || (outcome.typed === false && typeof message.line === 'string'))
  await outbox.update(id, isFailed
    ? { state: 'failed', failedAt: now, settledAt: now, outcome, why: failedWhy(settled) }
    : { state: 'delivered', deliveredAt: now, settledAt: now, outcome })
  return true
}

/**
 * The lazy clear (D1): the clear stages the Workers mod posts as they happen (`typed` with `handover` and `stages`), written
 * on the envelope's top-level `stages`, one entry per stage name (a repeat is ignored), in any state and also after its
 * outcome (a late `cleared` may follow a `clear-refused`); the settle stays once. The caller runs it in the store's one
 * turn (`inTurn`), so two quick posts never lose each other. True when the envelope is this chat's (the stages are on it
 * now), false for none.
 */
export async function addStages(outbox, chat, id, stages) {
  const message = outbox.outbox().find(one => one.id === id && one.command === HANDOVER_COMMAND && one.to === chat)
  if (message === undefined) return false
  const merged = mergeStages(message.stages, stages)
  if (merged !== null) await outbox.update(id, { stages: merged })
  return true
}

/** The lazy clear (D8): the reason a clear-only envelope still waiting is closed at the board's start. */
export const CLEAR_ONLY_CLOSED_WHY = 'no clear goes alone since Workers mod 0.31.0: the clear it owes rides its next task'

/**
 * The lazy clear (D8): the landing's sweep, at every start of the board: every clear-only envelope (a clear, no task, no
 * line, no restart) still waiting in the outbox is closed with its reason; one already taken is the mod's and settles as
 * its outcome says. The number closed.
 */
export async function closeClearOnly(outbox, now) {
  const waiting = outbox.outbox().filter(one => one.command === HANDOVER_COMMAND && one.state === 'waiting' && one.restart !== true
    && (one.clear ?? null) !== null && typeof one.step !== 'string' && typeof one.line !== 'string')
  let closed = 0
  for (const one of waiting) if (await outbox.close(one.id, 'dropped', CLEAR_ONLY_CLOSED_WHY, now)) closed += 1
  return closed
}

/**
 * One worker's decision carried out: `{ decision, envelope }` (the message written, or null). `apply(body)` is the work
 * API as the server. A give the API refuses moves to the next candidate in the same call (at most three).
 */
export async function handOver({ lane, state, dir, outbox, apply, config, installed = null, now, newId, event, fs, isPushed = null, log, wakes = null }) {
  const read = await readStore(dir, fs)
  const sent = outbox.outbox()
  const localOnly = await localOnlyOf(state.readyList?.ready, read.items, isPushed)
  const facts = factsOf({ lane, state, items: read.items, pause: read.pause ?? null, sent, config, installed, now, event, localOnly, wakes })
  let decision = decide(facts)
  // Signals change 3: the give-back of a holder that did not go on (giveBack.mjs, the work API's give-back path). Its
  // waiting "go on" line is closed only once the step went back: a refused give-back changes nothing.
  if (decision.giveBack !== null) {
    const back = await giveBackStep({ ...decision.giveBack, apply, ...(typeof log === 'function' ? { log } : {}) })
    if (back?.ok === true && decision.close !== null) await outbox.close(decision.close, 'dropped', `${decision.giveBack.step} was given back by the board`, now)
    return { decision: { ...decision, givenBack: back?.ok === true }, envelope: null }
  }
  if (decision.close !== null) await outbox.close(decision.close, 'dropped', decision.takeBack?.why ?? decision.why ?? 'its hand-over ended', now)
  if (decision.net !== null) await outbox.update(decision.net, { netAt: now })
  if (decision.takeBack !== null) {
    await apply({ action: 'advance', id: decision.takeBack.id, to: 'refined', takeBack: { chat: lane.name, stuck: false, why: decision.takeBack.why } }).catch(() => null)
  }
  const refused = new Set()
  for (let tries = 0; decision.give !== null && tries < 3; tries += 1) {
    const given = await apply({ action: 'advance', id: decision.give, to: 'queued', for: lane.name }).catch(error => ({ ok: false, why: String(error?.message ?? error) }))
    if (given?.ok === true) break
    refused.add(decision.give)
    // Decided again without it: the take-back above is done, so it is not taken back twice.
    const again = await readStore(dir, fs)
    decision = { ...decide({ ...factsOf({ lane, state, items: again.items, pause: again.pause ?? null, sent: outbox.outbox(), config, installed, now, event, localOnly, wakes }), ready: facts.ready.filter(one => !refused.has(one.id)) }), takeBack: decision.takeBack }
    if (decision.give === null) break
  }
  if (decision.give !== null && refused.has(decision.give)) decision = { ...decision, give: null, envelope: null }
  const envelope = decision.envelope
  if (envelope === null) return { decision, envelope: null }
  const id = newId()
  const message = { id, at: now, to: lane.name, ask: null, step: envelope.step, title: null, version: envelope.version ?? null, verdict: null, command: HANDOVER_COMMAND, about: lane.name, text: textOf(envelope), state: 'waiting', kind: envelope.kind, clear: envelope.clear, restart: envelope.restart, set: envelope.set, line: envelope.line, back: envelope.back ?? null, ...(typeof envelope.resume === 'string' ? { resume: envelope.resume } : {}) }
  const main = state.restart?.main ?? null
  if (envelope.set !== null && main === null) {
    // No chat whose hands could set it: the set failed at once (the task back, held, and no step of that model for it).
    await outbox.say({ ...message, state: 'failed', failedAt: now, settledAt: now, outcome: { cleared: null, set: false, typed: false, restarted: null, background: false, why: 'no main chat whose hands could set it' } })
    return { decision, envelope: null }
  }
  if (envelope.set !== null) {
    const { usual } = runSettings(config)
    const models = runSettings(config).models
    const word = { id: newId(), at: now, ...effortWords({ to: main, chat: lane.name, session: lane.appSession ?? null, level: envelope.set.effort, model: envelope.set.model, usual: usual.effort, usualModel: models[usual.model] ?? null, step: envelope.step, why: `${envelope.step} is ${lane.name}'s next step (its hand-over)` }), state: 'waiting', envelope: id }
    await outbox.say(word)
    message.waitsFor = word.id
  }
  await outbox.say(message)
  // Signals change 3: the "go on" line stands in the step's History too ("the board asked Worker N to go on (stopped since HH:MM)").
  if (decision.goOn !== null) await apply({ action: 'advance', id: decision.goOn.step, goOn: { chat: decision.goOn.chat, since: decision.goOn.since } }).catch(() => null)
  return { decision, envelope: message }
}

/**
 * The refresh's part of the sequence (the events R, C, P, M, B and the net): for every worker on it, a set word that
 * failed fails its envelope; a restart envelope its mod carried out gets the hands' restart word once; then its decision.
 * `lanes` the state's chats. `{ decided: [{ chat, state }], wrote: n }`.
 */
export async function handoverPass({ state, dir, outbox, apply, config, installed = null, now, newId, fs, isPushed = null, log, wakes = null }) {
  // Signals change 4, D.5: the running workers first, so a ready task goes to a running free one before a sleeper.
  const lanes = (state.chats ?? []).filter(lane => onSequence(lane, config)).sort((a, b) => (a.isRunning === true ? 0 : 1) - (b.isRunning === true ? 0 : 1))
  const decided = []
  let wrote = 0
  for (const lane of lanes) {
    await inTurn(dir, async () => {
      const sent = outbox.outbox()
      for (const message of sent.filter(one => one.command === HANDOVER_COMMAND && one.to === lane.name && one.state === 'waiting' && typeof one.waitsFor === 'string')) {
        const word = sent.find(one => one.id === message.waitsFor)
        if (word === undefined || ['failed', 'dropped', 'expired', 'stopped'].includes(word.state)) {
          await outbox.update(message.id, { state: 'failed', failedAt: now, settledAt: now, outcome: { cleared: null, set: false, typed: false, restarted: null, background: false, why: word?.why ?? 'the set word did not arrive' } })
        }
      }
      const restart = outbox.outbox().findLast(one => one.command === HANDOVER_COMMAND && one.to === lane.name && one.restart === true)
      const main = state.restart?.main ?? null
      if (restart !== undefined && restart.state === 'delivered' && main !== null && !outbox.outbox().some(one => one.command === RESTART_COMMAND && one.about === lane.name && one.at >= restart.at)) {
        await outbox.say({ id: newId(), at: now, ...restartWords({ to: main, chat: lane.name, session: lane.appSession ?? null, runs: lane.mod ?? 'unknown', installed: restart.version, why: 'its hand-over: the log is kept and its turn ended' }), state: 'waiting' })
        wrote += 1
      }
      const done = await handOver({ lane, state, dir, outbox, apply, config, installed, now, newId, event: { kind: 'pass' }, fs, isPushed, log, wakes })
      decided.push({ chat: lane.name, state: done.decision.state })
      if (done.envelope !== null || done.decision.takeBack !== null) wrote += 1
    })
  }
  return { decided, wrote }
}
