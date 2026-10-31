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
import { HANDOVER_COMMAND, contractOf, decide, envelopesOf, failedWhy, onSequence } from './handover.mjs'
import { isHolding } from './pause.mjs'
import { readStore } from './store.mjs'
import { isLate } from '../store.mjs'
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

/** The facts of one worker's decision, out of the state, a fresh read of the store and the outbox. */
export function factsOf({ lane, state, items, pause, sent, config, installed = null, now, event }) {
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
  }
}

/** The envelope waiting for `chat` that may be handed out now: its set word (when it has one) is done. */
export function carryable(sent, chat, now, keep) {
  return sent.find(message => message.command === HANDOVER_COMMAND && message.to === chat && message.state === 'waiting' && !isLate(message, now, keep)
    && (typeof message.waitsFor !== 'string' || sent.find(one => one.id === message.waitsFor)?.state === 'delivered')) ?? null
}

/** Hands the carryable envelope of `chat` out (marked taken, as a take marks a word): its contract, or null. */
export async function handOut(outbox, chat, now, keep) {
  const found = carryable(outbox.outbox(), chat, now, keep)
  if (found === null) return null
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
  const isFailed = outcome.cleared === false || outcome.set === false || outcome.restarted === false || (outcome.typed === false && typeof message.line === 'string')
  await outbox.update(id, isFailed
    ? { state: 'failed', failedAt: now, settledAt: now, outcome, why: failedWhy(settled) }
    : { state: 'delivered', deliveredAt: now, settledAt: now, outcome })
  return true
}

/**
 * One worker's decision carried out: `{ decision, envelope }` (the message written, or null). `apply(body)` is the work
 * API as the server. A give the API refuses moves to the next candidate in the same call (at most three).
 */
export async function handOver({ lane, state, dir, outbox, apply, config, installed = null, now, newId, event, fs }) {
  const read = await readStore(dir, fs)
  const sent = outbox.outbox()
  const facts = factsOf({ lane, state, items: read.items, pause: read.pause ?? null, sent, config, installed, now, event })
  let decision = decide(facts)
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
    decision = { ...decide({ ...factsOf({ lane, state, items: again.items, pause: again.pause ?? null, sent: outbox.outbox(), config, installed, now, event }), ready: facts.ready.filter(one => !refused.has(one.id)) }), takeBack: decision.takeBack }
    if (decision.give === null) break
  }
  if (decision.give !== null && refused.has(decision.give)) decision = { ...decision, give: null, envelope: null }
  const envelope = decision.envelope
  if (envelope === null) return { decision, envelope: null }
  const id = newId()
  const message = { id, at: now, to: lane.name, ask: null, step: envelope.step, title: null, version: envelope.version ?? null, verdict: null, command: HANDOVER_COMMAND, about: lane.name, text: textOf(envelope), state: 'waiting', kind: envelope.kind, clear: envelope.clear, restart: envelope.restart, set: envelope.set, line: envelope.line, back: envelope.back ?? null }
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
  return { decision, envelope: message }
}

/**
 * The refresh's part of the sequence (the events R, C, P, M, B and the net): for every worker on it, a set word that
 * failed fails its envelope; a restart envelope its mod carried out gets the hands' restart word once; then its decision.
 * `lanes` the state's chats. `{ decided: [{ chat, state }], wrote: n }`.
 */
export async function handoverPass({ state, dir, outbox, apply, config, installed = null, now, newId, fs }) {
  const lanes = (state.chats ?? []).filter(lane => onSequence(lane, config))
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
      const done = await handOver({ lane, state, dir, outbox, apply, config, installed, now, newId, event: { kind: 'pass' }, fs })
      decided.push({ chat: lane.name, state: done.decision.state })
      if (done.envelope !== null || done.decision.takeBack !== null) wrote += 1
    })
  }
  return { decided, wrote }
}
