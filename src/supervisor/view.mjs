// The supervisor's one read-only view of the board (spec 2026-10-24, "The component"): what every rule reads, built once
// per run from the board's state (state.mjs), the work store, the outbox and the supervisor's own memory. The rules
// read it and never change it: it is frozen, and nothing in it is the board's own object to write.

import { SUPERVISOR_DEFAULTS } from '../config.mjs'

/** The outbox's keep when the board names none (config.mjs messageKeepMinutes and answerKeepHours). */
const DEFAULT_KEEP = Object.freeze({ messageMs: 10 * 60_000, answerMs: 48 * 60 * 60_000 })

/**
 * The view: `items` (the store's items, a Map), `lanes` (the board's chats, state.mjs; the main chat first), `partner`
 * and `helper` (their cards, or null), `supervisor` (the supervisor's chat's card, or null), `prefix` (the chats' titles' start), `appStartedAt` (the app's last start, or null), `now`, `outbox` (the board's messages as the
 * board sees them now), `limits`, `pause` (the store's), `refused` (the names a chat's mod was refused under lately),
 * `leftovers` (the loop's look at leftover worktrees: `{ found }` or `{ error }`; undefined without one), `bases` (B598:
 * `[{ name, base, equal }]`, each repository's base branch against its remote's), `timeline`
 * (state.mjs `today`: per chat its spans of state), `since` (a Map: since when each chat has been in the state it is in
 * now, by the timeline; a chat it does not know is not in it), `repairs` (the repairs of the last day, `[{ at, rule,
 * subject, key }]`), `mods` (`{ installed, chats }`: the Workers mod installed, and the version each chat runs where
 * known), `settings` (the thresholds, config.mjs SUPERVISOR_DEFAULTS), `keep` (how long the outbox keeps a word) and
 * `goals` (the goal map's nodes) and `focus` (the focus goal's id, or null), `ready` (redesign Part 2: the board's ready
 * list, state.mjs `readyList.ready`: `{ id, rank, keptFor, keptUntil, pinned }` in its order) and `held` (its `held`, or
 * null without a list). X65 (the rule unknown-lane): `wakeFailed` (state.mjs: `[{ chat, tries, since }]`, the chats the
 * board asked to start in vain) and `nobodyRuns` (`{ since, chats }` or null: words wait for chats that are off and no chat
 * runs to carry the start word), the two ways the board's own wake-up of a chat fails.
 */
export function buildView({ state = {}, items = new Map(), outbox = [], keep = null, limits, pause, refused = [], leftovers, bases = [], repairs = [], mods = null, settings = {}, seen = null, now }) {
  const lanes = state.chats ?? []
  const timeline = Array.isArray(state.today) ? state.today : []
  return Object.freeze({
    items,
    lanes,
    partner: state.advisor ?? null,
    helper: state.advisorHelper ?? null,
    // B541: the supervisor's own chat, which runs a Workers mod too (the rule old-mod).
    supervisor: state.supervisorChat ?? null,
    prefix: state.chatPrefix ?? '',
    // B546: when the Claude app last started (state.mjs), or null: a helper quiet since before it stopped for the restart.
    appStartedAt: Number.isFinite(state.appStartedAt) ? state.appStartedAt : null,
    now,
    outbox,
    // B532: how long a word waits for its chat (the outbox's own keep, store.mjs isLate), and the goal map's nodes, so
    // rule 8 judges a waiting word as the outbox sweep does.
    keep: keep ?? DEFAULT_KEEP,
    goals: state.goals?.nodes ?? [],
    // B812: the workers a failed check handed their step back to (they hold it, so their stop word still matters).
    handedBack: Object.freeze([...(state.reconciled?.handedBack ?? [])]),
    // B564: the focus goal's id (state.mjs focusState), or null.
    focus: typeof state.focus?.id === 'string' ? state.focus.id : null,
    // Redesign Part 2: the board's ready list (the rule ready-while-free).
    ready: Object.freeze([...(state.readyList?.ready ?? [])].map(one => Object.freeze({ ...one }))),
    // Gap 3: what the list holds back, `{ id, why }` (outside the focus goal, a blocker, an ask, a standard), or null
    // without a list: the health summary tells them apart, so a sweep does not take them for work a free worker misses.
    held: Array.isArray(state.readyList?.held) ? Object.freeze(state.readyList.held.map(one => Object.freeze({ ...one }))) : null,
    // B878 (X116): the steps the goals' recaps show, with where each part stands with the person (src/recaps.mjs `recapWaitsOf`).
    recaps: Object.freeze((Array.isArray(state.recapWaits) ? state.recapWaits : []).map(one => Object.freeze({ ...one }))),
    // B868 (X115): the refine asks that hold the board's refine gate now (state.mjs refineAsk, per backlog step), `{ id, round, state, at }`,
    // so a rule that finds a refine word unanswered can name the ask that keeps the next one from going out.
    refineHeld: Object.freeze((state.backlog ?? []).flatMap(activity => activity.steps ?? []).filter(step => step.refineAsk?.isOpen === true)
      .map(step => Object.freeze({ id: step.id, round: step.refineAsk.round ?? 1, state: step.refineAsk.state, at: step.refineAsk.at }))),
    // X65: the board wakes a chat that words wait for by itself; these two say it could not (state.mjs wakeFailed, nobodyRuns).
    wakeFailed: Object.freeze((Array.isArray(state.wakeFailed) ? state.wakeFailed : []).map(one => Object.freeze({ ...one }))),
    nobodyRuns: state.nobodyRuns !== null && typeof state.nobodyRuns === 'object'
      ? Object.freeze({ since: Number.isFinite(state.nobodyRuns.since) ? state.nobodyRuns.since : null, chats: Object.freeze([...(state.nobodyRuns.chats ?? [])]) }) : null,
    limits: limits ?? state.limits ?? {},
    pause: pause ?? state.pause ?? null,
    refused,
    leftovers,
    // B598: each repository's base branch against its remote's (check.mjs `basesNow`), for the rule base-equal.
    bases: Object.freeze([...(Array.isArray(bases) ? bases : [])].map(one => Object.freeze({ ...one }))),
    timeline,
    // B710: the stretches the board did not run (state.mjs `gaps`, the history's gap lines).
    gaps: Object.freeze(spansOf(state.gaps)),
    // B736: the stretches the board heard no chat though chats ran (state.mjs `deaf`), the one that lasts now (`deafNow`, or
    // null), and the work calls it answered after the chat's Workers mod gave up (`lateCalls`, `[{ at, ms }]`).
    deaf: Object.freeze(spansOf(state.deaf)),
    deafNow: Number.isFinite(state.deafNow?.from) ? Object.freeze({ from: state.deafNow.from, to: now }) : null,
    lateCalls: Object.freeze((Array.isArray(state.lateCalls) ? state.lateCalls : []).filter(one => Number.isFinite(one?.at) && Number.isFinite(one?.ms)).map(one => Object.freeze({ at: one.at, ms: one.ms }))),
    since: statesSince(timeline, lanes),
    repairs: Object.freeze([...repairs]),
    // B664: since when the watch rules first saw each key (the supervisor's memory), so the health summary times a
    // review wait as they do; empty when not given.
    seen: new Map(seen instanceof Map ? seen : []),
    mods: Object.freeze({ installed: typeof mods?.installed === 'string' ? mods.installed : null, chats: Object.freeze({ ...(mods?.chats ?? {}) }) }),
    settings: Object.freeze({ ...SUPERVISOR_DEFAULTS, ...settings }),
  })
}

/** Stretches of time `[{ from, to }]`, each with both ends. */
const spansOf = spans => (Array.isArray(spans) ? spans : []).filter(one => Number.isFinite(one?.from) && Number.isFinite(one?.to)).map(one => Object.freeze({ from: one.from, to: one.to }))

/**
 * Since when each chat has been in its state now, by the timeline: the start of the run of spans at its end that show
 * that state without a break (a gap, the board off, breaks it). A chat whose timeline ends in another state is left out.
 */
function statesSince(timeline, lanes) {
  const since = new Map()
  for (const lane of lanes) {
    const spans = timeline.find(one => one.chat === lane.name)?.spans ?? []
    let from = null
    for (let i = spans.length - 1; i >= 0; i -= 1) {
      const span = spans[i]
      if (span.state !== lane.state) break
      if (from !== null && span.to !== from) break
      from = span.from
    }
    if (from !== null) since.set(lane.name, from)
  }
  return since
}
