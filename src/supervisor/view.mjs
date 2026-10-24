// The supervisor's one read-only view of the board (spec 2026-10-24, "The component"): what every rule reads, built once
// per run from the board's state (state.mjs), the work store, the outbox and the supervisor's own memory. The rules
// read it and never change it: it is frozen, and nothing in it is the board's own object to write.

import { SUPERVISOR_DEFAULTS } from '../config.mjs'

/**
 * The view: `items` (the store's items, a Map), `lanes` (the board's chats, state.mjs; the main chat first), `partner`
 * and `helper` (their cards, or null), `prefix` (the chats' titles' start), `now`, `outbox` (the board's messages as the
 * board sees them now), `limits`, `pause` (the store's), `refused` (the names a chat's mod was refused under lately),
 * `leftovers` (the loop's look at leftover worktrees: `{ found }` or `{ error }`; undefined without one), `timeline`
 * (state.mjs `today`: per chat its spans of state), `since` (a Map: since when each chat has been in the state it is in
 * now, by the timeline; a chat it does not know is not in it), `repairs` (the repairs of the last day, `[{ at, rule,
 * subject, key }]`), `mods` (`{ installed, chats }`: the Workers mod installed, and the version each chat runs where
 * known) and `settings` (the thresholds, config.mjs SUPERVISOR_DEFAULTS).
 */
export function buildView({ state = {}, items = new Map(), outbox = [], limits, pause, refused = [], leftovers, repairs = [], mods = null, settings = {}, now }) {
  const lanes = state.chats ?? []
  const timeline = Array.isArray(state.today) ? state.today : []
  return Object.freeze({
    items,
    lanes,
    partner: state.advisor ?? null,
    helper: state.advisorHelper ?? null,
    prefix: state.chatPrefix ?? '',
    now,
    outbox,
    limits: limits ?? state.limits ?? {},
    pause: pause ?? state.pause ?? null,
    refused,
    leftovers,
    timeline,
    since: statesSince(timeline, lanes),
    repairs: Object.freeze([...repairs]),
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
