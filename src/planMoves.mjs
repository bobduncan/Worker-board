// The Vision tab's moves on the product plan (2026-10-19), each a word to the partner, on a way of their own (2026-10-24,
// the user: "we have nothing so it should not rely on a focus"): they shared the Focus page's way, which worked out
// focus facts, running evaluations and the partner's effort for every word, so a project with no focus yet could not
// start its plan. 2026-11-09 (reactive board, brief A): the person's own decisions (Yes, mine and Confirm, the goals' and
// standards' confirms, the feature marks, Prepare now or Wait, Not now, Good enough) are written into the plan by the
// board at once (`planDecide`, src/planWrite.mjs); the word to the partner then says so. Everything else is the partner's
// to write (roles/partner.md, "The plan interview").

import { planWords } from './say.mjs'
import { writeDecisions } from './planWrite.mjs'

export const PLAN_MOVES = ['plan-confirm', 'plan-change', 'plan-ask', 'plan-deeper', 'plan-marks', 'plan-feature-add', 'plan-goals-confirm', 'plan-goals-change', 'plan-goals-agree',
  // Standards (2026-10-20): a vision card settled by the person; the standards proposed, confirmed, changed, measured, their gaps into goals.
  'plan-settled', 'plan-standards', 'plan-standards-confirm', 'plan-standards-change', 'plan-standards-agree', 'plan-measure',
  // The new order (2026-10-21): the partner checks the whole plan for missing goals; it proposes the next focus.
  'plan-check', 'plan-focus',
  // Tradeoffs (2026-10-21): the partner weighs every complex feature later or not sure; the person chooses prepare or wait.
  'plan-tradeoffs', 'plan-tradeoff',
  // The trial's gap 1 (2026-10-24): the empty Vision tab's start, what the person builds, begins the interview.
  'plan-start',
  // 2026-10-24: the strategy the plan is laid in (your pick or your words); a goal or milestone set aside for now.
  'plan-strategy', 'plan-not-now']

const PLAN_IDS = { 'plan-confirm': /^P\d+$/, 'plan-ask': /^P\d+$/, 'plan-deeper': /^P\d+$/, 'plan-settled': /^P\d+$/, 'plan-measure': /^K\d+$/, 'plan-change': /^[PFSK]\d+$/, 'plan-tradeoff': /^F\d+$/, 'plan-not-now': /^[SM]\d+$/ }
// The new order (2026-10-21): a feature is placed in a milestone of the road (M1, M2, M3+), or no, or not sure.
const MARKS_LINE = /^F\d+ (must|later|no|unsure|M\d+\+?)(; F\d+ (must|later|no|unsure|M\d+\+?))*$/
const GOALS_LINE = /^S\d+(, S\d+)*$/
const STANDARDS_LINE = /^K\d+(, K\d+)*$/

/** The person's decisions the board writes itself: the plan file changes the moment they are made. */
export const PLAN_DECISIONS = ['plan-confirm', 'plan-settled', 'plan-marks', 'plan-goals-confirm', 'plan-standards-confirm', 'plan-tradeoff', 'plan-not-now']

/** What a decision writes (src/planWrite.mjs `writeDecisions`), from its checked id and words. */
function decisionOf(command, id, words) {
  if (command === 'plan-confirm') return [{ kind: 'answer', id, what: 'decided' }]
  if (command === 'plan-settled') return [{ kind: 'answer', id, what: 'settled' }]
  if (command === 'plan-marks') return words.split('; ').map(one => ({ kind: 'feature', id: one.split(' ')[0], what: 'mark', mark: one.split(' ')[1] }))
  if (command === 'plan-goals-confirm') return words.split(', ').map(one => ({ kind: 'goal', id: one }))
  if (command === 'plan-standards-confirm') return words.split(', ').map(one => ({ kind: 'standard', id: one }))
  if (command === 'plan-tradeoff') return [{ kind: 'feature', id, what: 'tradeoff', choice: words }]
  if (command === 'plan-not-now') return [{ kind: id.startsWith('M') ? 'milestone' : 'goal', id, what: 'notnow' }]
  return null
}

const refuse = (status, why) => ({ ok: false, status, why })
const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * A move of the Vision tab: Confirm an answer, Change an answer, feature or goal (with the person's words), ask for
 * options or deeper questions, send the feature marks or goal confirms in one word, add a feature, change the whole goal
 * preset, put the goals in the goal map, the standards' and tradeoffs' moves, and the start. `ctx`: `canWrite` (the
 * board that delivers), `partner` (state.advisor), `job` (the partner's rules file), `written` (the caller writes the
 * person's decision before the word goes out: the word says so). `{ ok, result, words, decision }`: the word for the
 * partner and, for a decision of the person's (PLAN_DECISIONS), what to write; or a refusal.
 */
export function planMove(body, ctx) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'Not a request.')
  const command = body.command
  if (!PLAN_MOVES.includes(command)) return refuse(400, 'Not a move of the Vision tab.')
  if (ctx.canWrite !== true) return refuse(403, 'This board only shows: work on the plan on the board that delivers.')
  if ((ctx.partner ?? null) === null) return refuse(409, 'No partner chat is on the board: the setting advisor names none.')
  const id = String(body.id ?? '').trim()
  const pattern = PLAN_IDS[command]
  if (pattern !== undefined && !pattern.test(id)) return refuse(400, command === 'plan-change' ? 'Name what to change by its id (P5, F3, S2 or K1).' : command === 'plan-measure' ? 'Name the standard by its id (K1).' : 'Name the answer by its id (P5).')
  const words = oneLine(body.text, 1000)
  if (['plan-change', 'plan-feature-add', 'plan-goals-change', 'plan-standards-change', 'plan-strategy'].includes(command) && words === '') return refuse(400, 'Say it in your words first.')
  if (command === 'plan-marks' && !MARKS_LINE.test(words)) return refuse(400, 'Give the marks as "F3 M1; F5 no".')
  if (command === 'plan-goals-confirm' && !GOALS_LINE.test(words)) return refuse(400, 'Give the goals as "S1, S2".')
  if (command === 'plan-standards-confirm' && !STANDARDS_LINE.test(words)) return refuse(400, 'Give the standards as "K1, K2".')
  if (command === 'plan-tradeoff' && !['prepare', 'wait'].includes(words)) return refuse(400, 'Choose prepare or wait.')
  return {
    ok: true, result: { id: id === '' ? null : id }, decision: PLAN_DECISIONS.includes(command) ? decisionOf(command, id, words) : null,
    words: planWords(command, { to: ctx.partner.name, id, words, job: ctx.job, written: ctx.written === true && PLAN_DECISIONS.includes(command) }),
  }
}

/**
 * A move of the Vision tab as the route takes it: checked, the person's decision written into the plan file (`ctx.file`,
 * `ctx.now`; nothing is written when any id of it is not in the plan, and the move is refused with why), then the word
 * for the partner, which says the decision is written. A judgment word (Go deeper, Change, ...) writes nothing.
 */
export async function planDecide(body, ctx) {
  const checked = planMove(body, { ...ctx, written: true })
  if (!checked.ok || checked.decision === null) return checked.ok ? planMove(body, { ...ctx, written: false }) : checked
  const written = await writeDecisions(ctx.file ?? null, checked.decision, ctx.now ?? Date.now(), ctx.fs)
  if (!written.ok) return refuse(written.status, written.why)
  return checked
}
