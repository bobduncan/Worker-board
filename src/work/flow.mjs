// B296: the flow as data, `<work>/flow.json` (spec 2026-10-17, section 4): per kind of item its states and its moves,
// who makes each move (`by`: a role from the list of chats, `person` or `server`) and what must hold first (`when`, a
// guard of guards.mjs). Changing the file changes the order; no code.

import { ACTIONS, GUARD_WHY, GUARDS } from './guards.mjs'
import { valueOf } from './item.mjs'

/** Today's agreement, the default when the store has no flow.json; examples/work/flow.json is its text. */
export const DEFAULT_FLOW = {
  step: {
    states: ['new', 'refined', 'queued', 'taken', 'in progress', 'waiting on you', 'review', 'done', 'dropped'],
    moves: [
      { from: 'new', to: 'refined', by: 'advisor', when: 'refined is ready' },
      { from: 'refined', to: 'queued', by: 'main', sets: ['Owner', 'Blocked by', 'Estimate'], when: 'Touches overlaps no taken step' },
      { from: 'refined', to: 'queued', by: 'server', when: 'a queue was asked before its refine' },
      { from: 'refined', to: 'queued', by: 'server', when: 'an incident fix is ready' },
      { from: 'queued', to: 'taken', by: 'server', when: 'Blocked by all done and Owner free', then: 'wake Owner' },
      { from: 'queued', to: 'taken', by: ['worker', 'advisor', 'main'], when: 'Blocked by all done' },
      { from: 'queued', to: 'refined', by: ['main', 'person'] },
      { from: 'queued', to: 'new', by: ['main', 'person'] },
      { from: 'taken', to: 'in progress', by: ['worker', 'advisor', 'main'] },
      { from: 'in progress', to: 'waiting on you', by: ['worker', 'advisor', 'main'], when: 'an ask with Blocking yes is open' },
      { from: 'in progress', to: 'waiting on you', by: 'server', when: 'its worker rests on an open ask' },
      { from: 'waiting on you', to: 'in progress', by: 'server', when: 'its asks are answered', then: 'wake Owner' },
      { from: 'in progress', to: 'review', by: ['worker', 'advisor', 'main'], then: 'check: base equals remote, branch gone, result named' },
      { from: 'review', to: 'review', by: ['worker', 'advisor', 'main'], then: 'check: base equals remote, branch gone, result named' },
      { from: '*', to: 'done', by: 'person' },
      { from: 'review', to: 'done', by: 'server', when: 'the check passed and no ask of kind look is open' },
      { from: '*', to: 'dropped', by: ['person', 'main'] },
    ],
  },
}

/** The states of the kinds the flow does not hold: an ask, an instruction, a note (spec section 3), an incident. */
const FIXED_STATES = {
  ask: ['open', 'answered', 'withdrawn'], instruction: ['open', 'closed'], note: ['unread', 'read'],
  // The supervisor (spec 2026-10-24): an incident's states ("fix" while its Fix step is under way, shown "fix B<n>").
  incident: ['open', 'with the advisor', 'fix', 'fixed', 'came back'],
}

const byList = by => (Array.isArray(by) ? by : [by])

/** A flow.json's text → `{ flow, problem }`: the flow, or the default with one line saying what is wrong. */
export function parseFlow(text) {
  let raw
  try {
    raw = JSON.parse(String(text).replace(/^﻿/, ''))
  } catch (error) {
    return { flow: DEFAULT_FLOW, problem: `flow.json is no JSON: ${error.message}` }
  }
  const problem = flowProblem(raw)
  return problem === null ? { flow: raw, problem: null } : { flow: DEFAULT_FLOW, problem }
}

function flowProblem(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return 'flow.json must hold one object, { "step": { ... } }'
  for (const [kind, part] of Object.entries(raw)) {
    if (part === null || typeof part !== 'object' || !Array.isArray(part.states) || !Array.isArray(part.moves)) return `flow.json: "${kind}" needs "states" and "moves"`
    for (const move of part.moves) {
      if (move === null || typeof move !== 'object') return `flow.json: a move of "${kind}" is no object`
      for (const state of [move.from, move.to]) {
        if (state !== '*' && !part.states.includes(state)) return `flow.json: the ${kind} state "${state}" is not in its states`
      }
      if (byList(move.by).length === 0 || !byList(move.by).every(one => typeof one === 'string' && one !== '')) return `flow.json: a move of "${kind}" to "${move.to}" names nobody in "by"`
      if (move.when !== undefined && GUARDS[move.when] === undefined) return `flow.json: no guard is called "${move.when}"`
      if (move.then !== undefined && !ACTIONS.includes(move.then)) return `flow.json: no action is called "${move.then}"`
    }
  }
  return null
}

/** The states an item of `kind` passes, in order. */
export function statesOf(flow, kind) {
  return flow[kind]?.states ?? FIXED_STATES[kind] ?? []
}

const VERBS = { refined: 'refines', queued: 'queues', taken: 'takes', 'in progress': 'starts', 'waiting on you': 'asks on', review: 'reports', done: 'closes', dropped: 'drops' }

/**
 * Whether `by` may move `item` to `to` now: `{ ok, why }`. `why` is one line naming the item and what is missing:
 * no such move, who may make it, or the guard that does not hold.
 */
export function mayMove(flow, item, to, by, ctx = {}) {
  const id = valueOf(item, 'Id') ?? '?'
  const kind = valueOf(item, 'Kind') ?? 'step'
  const from = valueOf(item, 'State')
  // B304: a move to the state it is in is made only when the flow names it so (review → review: reported again).
  const moves = (flow[kind]?.moves ?? []).filter(move => move.to === to && (to === from ? move.from === from : move.from === from || move.from === '*'))
  if (moves.length === 0) return { ok: false, why: `${id}: no move from ${from} to ${to} (flow.json)` }
  const mine = moves.filter(move => byList(move.by).includes(by))
  if (mine.length === 0) {
    // B303: the board's own moves are named only when nobody else may make that move.
    const all = [...new Set(moves.flatMap(move => byList(move.by)))]
    const who = (all.some(one => one !== 'server') ? all.filter(one => one !== 'server') : all).join(' or ')
    return { ok: false, why: `${id}: only ${who} ${VERBS[to] ?? `moves to ${to}`} a ${kind} (flow.json)` }
  }
  const held = mine.find(move => move.when === undefined || GUARDS[move.when]?.(item, ctx) === true)
  if (held !== undefined) return { ok: true, why: null }
  // B378: a guard that can say more names it (the two overlapping paths).
  const more = GUARD_WHY[mine[0].when]?.(item, ctx) ?? null
  return { ok: false, why: `${id}: "${mine[0].when}" does not hold (flow.json)${more === null ? '' : `: ${more}`}` }
}

/** The moves out of the item's state: where to, who makes it, and what must hold. */
export function nextMoves(flow, item) {
  const kind = valueOf(item, 'Kind') ?? 'step'
  const from = valueOf(item, 'State')
  return (flow[kind]?.moves ?? [])
    .filter(move => (move.from === from || move.from === '*') && move.to !== from)
    .map(move => ({ to: move.to, by: byList(move.by), when: move.when ?? null }))
}
