// Signals change 6 (B915, 2026-11-02, the lead's Addendum 2 and 3): an alarm closes itself when its condition has gone. A watch
// rule cannot re-check one incident; every run evaluates every rule over the whole view, so "present" is the key among a run's
// findings, and "gone" is the key absent from every run of its rule for GONE_MS of the board's running time. Only runs in which
// the rule looked count: one that failed (`failed`) or did not look for a pause or a full limit (`skipped`, loop.mjs `runRules`)
// has not seen the case go; the board's off time (a PC sleep, a board stop: the history's gap lines) is no running time either.
// Why: an incident counted as fixed once its fix step was done, and stood open for ever when nobody judged it (X104 unjudged,
// seen 19:29-19:35); a quarter of the fixes changed the detector, not the board. Exempt: an incident of the sweep (no rule can
// look for it). The event rules with a look window (board-slow 10 min, undelivered 2 h, repair-repeats a day, handover-
// unanswered a day, skip-repeats, obsolete-wrong) need no case of their own: their finding leaves the list once its window ends,
// so they go gone at the window's end + GONE_MS, when the fault is not observable any more (the lead's decision 2). PURE.

const MIN = 60_000
/** How long an incident's key must stay unseen in running time before it is gone (config `incidentGoneMinutes`). */
export const GONE_MINUTES = 60
export const GONE_MS = GONE_MINUTES * MIN

/** The states of an incident a gone clock may close: not judged yet, or judged and waiting (never `fix`: its step answers). */
export const GONE_FROM = ['open', 'came back', 'with the supervisor', 'with the advisor']

/** How much of [from, to] the board did not run, by its gaps (`{ from, to }`). */
function offMs(gaps, from, to) {
  return (gaps ?? []).reduce((sum, gap) => sum + Math.max(0, Math.min(gap.to, to) - Math.max(gap.from, from)), 0)
}

/**
 * How long an incident's key has been unseen in its rule's running time, and whether that makes it gone:
 * `{ gone, counted, notSeenSince }`, or null when the gone clock cannot tell (no time it was last seen).
 * `incident` `{ lastSeen }` (ms: the store's Last seen, written at every run that found it); `runs` its rule's spans as
 * the loop keeps them (`{ from, to, status }`, oldest first, loop.mjs `withRun`); `gaps` the board's off time. Counted: each
 * stretch between two runs that ends in a run that looked (`complete`), from the last time the key was seen on; the first
 * span the supervisor kept counts from its own start (what it did not watch is not counted: principle 3), and the board's
 * off time is subtracted. A run that failed or skipped adds nothing: the stretch that ends in it is not counted.
 */
export function goneOf({ incident, runs, now, gaps = [], goneMs = GONE_MS }) {
  const lastSeen = incident?.lastSeen
  if (!Number.isFinite(lastSeen)) return null
  let counted = 0
  let before = null
  for (const span of runs ?? []) {
    if (span.status === 'complete') {
      const from = Math.max(before ?? span.from, lastSeen)
      const to = Math.min(span.to, now)
      if (to > from) counted += to - from - offMs(gaps, from, to)
    }
    before = span.to
  }
  return { gone: counted >= goneMs, counted, notSeenSince: lastSeen }
}

/**
 * What the loop does about the standing incidents after a run, `{ gone: [{ id, notSeenSince }], fixed: [{ id, fix,
 * notSeenSince }] }`: an incident of a rule (`rules`, the ids the loop runs; a sweep's has none) not seen for `goneMs` of its
 * rule's running time is gone, unless it is in `fix`: then it waits for its step (B915 4b.2: never gone while its fix step
 * stands, X119-X121) and is fixed once that step is done AND it is not seen for `goneMs` (the lead's Addendum 3; X117: B883
 * done 14:00, last seen 13:47: fixed at 14:47, not at 14:00). `incidents` as incidents.mjs `incidentsOf` gives them, `steps`
 * the store's items (a fix step's State), `runs` `{ <rule>: spans }`.
 */
export function gonePlan({ incidents = [], steps = new Map(), runs = {}, rules, now, gaps = [], goneMs = GONE_MS }) {
  const gone = []
  const fixed = []
  for (const incident of incidents) {
    if (typeof incident?.id !== 'string' || !rules.has(incident.source)) continue
    const isFix = incident.state === 'fix'
    if (!isFix && !GONE_FROM.includes(incident.state)) continue
    if (isFix && steps.get(incident.fix ?? '')?.head?.get('State') !== 'done') continue
    const clock = goneOf({ incident, runs: runs[incident.source] ?? [], now, gaps, goneMs })
    if (clock === null || !clock.gone) continue
    if (isFix) fixed.push({ id: incident.id, fix: incident.fix, notSeenSince: clock.notSeenSince })
    else gone.push({ id: incident.id, notSeenSince: clock.notSeenSince })
  }
  return { gone, fixed }
}
