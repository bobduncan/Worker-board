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
 * null without a list).
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
    // B564: the focus goal's id (state.mjs focusState), or null.
    focus: typeof state.focus?.id === 'string' ? state.focus.id : null,
    // Redesign Part 2: the board's ready list (the rule ready-while-free).
    ready: Object.freeze([...(state.readyList?.ready ?? [])].map(one => Object.freeze({ ...one }))),
    // Gap 3: what the list holds back, `{ id, why }` (outside the focus goal, a blocker, an ask, a standard), or null
    // without a list: the health summary tells them apart, so a sweep does not take them for work a free worker misses.
    held: Array.isArray(state.readyList?.held) ? Object.freeze(state.readyList.held.map(one => Object.freeze({ ...one }))) : null,
    limits: limits ?? state.limits ?? {},
    pause: pause ?? state.pause ?? null,
    refused,
    leftovers,
    // B598: each repository's base branch against its remote's (check.mjs `basesNow`), for the rule base-equal.
    bases: Object.freeze([...(Array.isArray(bases) ? bases : [])].map(one => Object.freeze({ ...one }))),
    timeline,
    since: statesSince(timeline, lanes),
    repairs: Object.freeze([...repairs]),
    // B664: since when the watch rules first saw each key (the supervisor's memory), so the health summary times a
    // review wait as they do; empty when not given.
    seen: new Map(seen instanceof Map ? seen : []),
    mods: Object.freeze({ installed: typeof mods?.installed === 'string' ? mods.installed : null, chats: Object.freeze({ ...(mods?.chats ?? {}) }) }),
    settings: Object.freeze({ ...SUPERVISOR_DEFAULTS, ...settings }),
  })
}

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
