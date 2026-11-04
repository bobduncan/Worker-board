// One count for the recap, everywhere (T17.1 / T20.1, the person, 2026-11-04, looking at G60's Focus page and its recap: "I'm confused.
// what do you mean 5 verdicts wait while of the 5 open now, only 1 is done? And when we open the demo i see only 3 items... These
// numbers are all over the place and non consistent."). What the recap's popup lets the person judge, what the recap card counts, what
// the Product owner's card in Needs your attention counts and what the work blocks' chips say are ONE reading of the same facts, made
// here: the recap's rows with the person's rounds (src/demoFeedback.mjs `roundPage`, the very function the popup is drawn from), the
// store's steps (a row whose steps, or any fix in their chains, are under way is being reworked and asks nothing) and the kept looks
// of the focus goal (rows of the recap in a section of their own). PURE.

import { roundPage } from './demoFeedback.mjs'
import { fixesOf, reviewWaitOf, reportCheckFailedOf, boardCheckPending } from './work/resultCheck.mjs'
import { valueOf } from './work/item.mjs'

/** The states in which a step is under way: made, given, taken, being worked on, or waiting for an answer mid-build. */
export const UNDER_WAY_STATES = ['new', 'refined', 'queued', 'taken', 'in progress', 'waiting on you']
/** What a worker reads when nobody's card shows the step yet. */
export const WAITING_FOR_A_WORKER = 'waiting for a worker'
/** The key a kept look has among the rows of the popup's round (the answers of one Send are keyed by it). */
export const LOOK_PREFIX = 'look:'
export const lookKey = ask => `${LOOK_PREFIX}${ask}`
/** The asks a kept look can be: a look, or an own-senses do the main chat or the partner handed on (src/work/keptLook.mjs); the do is judged "Done". */
export const KEPT_ASKS = ['look', 'do']

const numberOf = id => Number(String(id).slice(1))

/**
 * Whether a step is under way: it is new, refined, queued, taken, in progress or waiting on the person, or it is in review with its
 * check still to run: a Quality Assurance task of it is open (`openChecks`, src/recapCard.mjs `openChecksOf`), the board's own check
 * of its report is running or sent it back to its worker, or its result check was never filed ("waits for its first check", "for its check again").
 */
export function isUnderWay(item, items, { openChecks = new Set(), now = null } = {}) {
  const state = valueOf(item, 'State')
  if (UNDER_WAY_STATES.includes(state)) return true
  if (state !== 'review') return false
  if (openChecks.has(valueOf(item, 'Id')) || boardCheckPending(item) || reportCheckFailedOf(item) !== null) return true
  return reviewWaitOf(item, items, null, now)?.kind === 'check'
}

/**
 * What a step under way is doing, in the words after its id on "Being reworked: B981 · <this>" (the review of 2026-11-04): a step in review
 * with its check still to run is "being checked", one new, refined or queued is "waiting for a worker", one taken or in progress is
 * "<worker> is on it" (a worker the board does not know: "a worker is on it"), one waiting on the person "waits on you".
 */
export function reworkPhraseOf(state, worker = null) {
  if (state === 'review') return 'being checked'
  if (state === 'taken' || state === 'in progress') return `${worker ?? 'a worker'} is on it`
  if (state === 'waiting on you') return 'waits on you'
  return WAITING_FOR_A_WORKER
}

/**
 * The step under way among `stepIds` and every fix in their chains (all links, a fix of a fix too) that a row or block is being reworked on,
 * `{ step, state, worker, words }`, or null when none is: the steps are built and checked, or only waiting for the person. The review of
 * 2026-11-04: the step a worker holds first (its card shows it, or it is taken or in progress: `worker` is `workerOf(step)`, else its owner),
 * the newest of them; else the newest step under way. `words` is `reworkPhraseOf` after the id ("B981 · waiting for a worker").
 */
export function reworkOf(stepIds, items, { openChecks = new Set(), workerOf = () => null, now = null } = {}) {
  const seen = new Set()
  const queue = [...(Array.isArray(stepIds) ? stepIds : [])]
  const under = []
  while (queue.length > 0 && seen.size < 80) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    const item = items?.get(id)
    if (item === undefined || valueOf(item, 'Kind') !== 'step') continue
    if (isUnderWay(item, items, { openChecks, now })) under.push(item)
    for (const fix of fixesOf(id, items)) queue.push(valueOf(fix, 'Id'))
  }
  if (under.length === 0) return null
  const whoOf = item => {
    const named = workerOf(valueOf(item, 'Id'))
    if (typeof named === 'string' && named !== '') return named
    return ['taken', 'in progress'].includes(valueOf(item, 'State')) && typeof valueOf(item, 'Owner') === 'string' ? valueOf(item, 'Owner') : null
  }
  const newest = list => list.sort((a, b) => numberOf(valueOf(a, 'Id')) - numberOf(valueOf(b, 'Id'))).at(-1)
  const held = under.filter(item => whoOf(item) !== null)
  const item = newest(held.length > 0 ? held : under)
  const step = valueOf(item, 'Id')
  const state = valueOf(item, 'State')
  const worker = whoOf(item)
  // `words`: what follows "Being reworked:" in the popup and on the chips.
  return { step, state, worker, words: `${step} · ${reworkPhraseOf(state, worker)}` }
}

/**
 * The rows of a recap as the popup shows its round: `{ round, making, done, rows: [{ key, title, steps, ready, rework }] }`, the rows the
 * person has not approved. `ready`: the person can judge it now (nothing more is done on it); not ready: it is being reworked (sent back
 * and its new try not in, or `rework`: a step of it is under way) and asks nothing. It is `roundPage` itself that decides, over the same
 * rows, so the popup and every count agree by construction. `rows`: `[{ key, title, steps, changed, pending }]` (booleans or words);
 * `rework`: `Map(key → { step, worker })`; `changedAt` when the recap was last written (ms, null for never).
 */
export function roundRowsOf({ rows, rounds, changedAt = null, rework = new Map() }) {
  const page = {
    sections: [{ kind: 'open', rows: (rows ?? []).map(row => ({
      key: row.key, title: row.title, steps: row.steps ?? [], note: '', pictures: [], play: null,
      changed: row.changed ? 'changed' : null, pending: row.pending ? 'pending' : null,
    })) }],
  }
  const shown = roundPage(page, { rounds: rounds ?? [] }, { changedAt, rework })
  return {
    round: shown.feedback.round, making: shown.feedback.making, done: shown.feedback.done,
    rows: shown.sections.flatMap(section => section.rows).map(row => ({ key: row.key, title: row.title, steps: row.steps ?? [], ready: row.reworking !== true, rework: row.rework ?? null })),
  }
}

/** A play link in an ask's words ("#play=main&arena=ring"): the part after "#play=", or null. */
export function playOf(words) {
  return String(words ?? '').match(/#play=([A-Za-z0-9_&=.%-]{1,200})/)?.[1] ?? null
}

/**
 * The kept looks of the focus goal (the asks the board routed to the recap, `routedAway` of src/work/lists.mjs; only while Autopilot is
 * on) as rows of its recap: `[{ ask, asks, key, title, text, advice, step, pictures, play }]`, oldest first. A kept look is a look the
 * partner handed over or a worker filed with pictures, or an own-senses do the main chat or the partner handed on (`asks` 'do'), that
 * Autopilot keeps for the goal's recap (src/work/keptLook.mjs): the person judges it there, in the section "Looks kept for your recap",
 * as any row (a do with "Done" in place of "Approve").
 */
export function keptLooksOf(routed, goal) {
  return (Array.isArray(routed) ? routed : [])
    .filter(one => one.route === 'recap' && one.isKept === true && KEPT_ASKS.includes(one.asks) && /^B\d+$/.test(one.of ?? '') && one.goal === goal)
    .map(one => ({
      ask: one.id, asks: one.asks, key: lookKey(one.id), title: String(one.title ?? ''), text: String(one.text ?? ''), advice: one.advice ?? null, step: one.of,
      pictures: Array.isArray(one.pictures) ? one.pictures : [],
      // The look's own `## Play` (the work tool's `play`), else, for a do that links another ask, that ask's (`routedAwayOf`), else a #play= in its words.
      play: typeof one.play === 'string' && one.play.trim() !== '' ? one.play.trim() : playOf(`${one.title ?? ''} ${one.text ?? ''}`),
    }))
}

/**
 * The focus goal's recap round as one reading, for every place that counts or draws it: `{ goal, path, round, making, done, rows, ready,
 * reworking, rework, looks, toJudge }` or null without a focus. `rows` are the rows of the recap (the file's rows, else the parts of its
 * recap in `recaps`), `rounds` and `changedAt` the person's rounds and when it was written; `items` the store's by id, `openChecks`,
 * `workerOf`, `now` as `reworkOf` has them; `routed` the asks routed to the recap or the main chat. `toJudge` = ready rows + kept
 * looks, the one number the cards, the popup's head and the Needs count carry. While the next round is being made nothing can be
 * judged: `toJudge` is 0 and the looks are left for the round after. `rework` maps a row's key to its `{ step, worker }`.
 */
export function recapRoundOf({ goal, goalRecap = null, recaps = [], items = new Map(), openChecks = new Set(), workerOf = () => null, now = null, routed = [] }) {
  if (typeof goal !== 'string') return null
  const own = goalRecap?.goal === goal ? goalRecap : null
  const recap = (Array.isArray(recaps) ? recaps : []).find(one => one.goal === goal && (own === null || own.path == null || one.path === own.path)) ?? null
  const rows = own !== null && Array.isArray(own.rows) ? own.rows : recap?.parts ?? []
  const rounds = recap?.rounds ?? own?.rounds ?? []
  const changedAt = recap?.changedAt ?? own?.changedAt ?? null
  const rework = new Map()
  for (const row of rows) {
    const found = (row.steps ?? []).length === 0 ? null : reworkOf(row.steps, items, { openChecks, workerOf, now })
    if (found !== null) rework.set(row.key, found)
  }
  const round = roundRowsOf({ rows, rounds, changedAt, rework })
  const ready = round.rows.filter(row => row.ready)
  const looks = round.making === null ? keptLooksOf(routed, goal) : []
  return {
    goal, path: own?.path ?? recap?.path ?? null, round: round.round, making: round.making, done: round.done,
    rows: round.rows, ready, reworking: round.rows.filter(row => !row.ready),
    rework: Object.fromEntries([...rework].filter(([key]) => round.rows.some(row => row.key === key && !row.ready))),
    looks, toJudge: ready.length + looks.length,
  }
}
