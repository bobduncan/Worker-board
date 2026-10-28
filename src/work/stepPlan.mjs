// T13, part 2 (the person, 2026-10-28: "still no ETA per task"): a worker's plan, its parts, the part it is on and the time
// it expects, is saved with the step it works on, in the step's `Plan:` line, so a chat that takes the step over after a
// restart or a change of chat shows it at once instead of "no steps given" and "No time". The plan reaches the board with
// the work tool's `step` call (the Workers mod forwards `names`, `steps`, `step`, `minutes` and `stepMinutes`); the board
// writes the line from it, the way the mod writes the chat's card, and `src/state.mjs` reads it back when the card holds
// no plan of its own for the step. The times are absolute (a time of day to the second, as a checkpoint's), so the time
// left is worked out whenever it is read, never negative here: past its time it reads as an overrun.
//   Plan: step 2/3 | parts Sheet; Clips; Merge | until 2026-10-28 21:30:00 | step until 2026-10-28 20:45:00 | at 2026-10-28 20:10:00
// `until` is when the task's time runs out, `step until` the step's, `at` when the line was written.

import { sinceMs, valueOf } from './item.mjs'
import { stampSecond } from './pause.mjs'

const MINUTE_MS = 60_000
/** What the mod's chat tool takes for a time: from 1 minute to a day. */
const MAX_MINUTES = 1440
const SEP = ' | '
const STAMP = '\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d'

/** A plan with nothing in it. */
const EMPTY = { names: [], on: null, steps: null, until: null, stepUntil: null, writtenAt: null }

/** A time as minutes, when it is one the mod would take, else null. */
export const planMinutes = value => {
  const minutes = value === undefined || value === null || value === '' ? Number.NaN : Number(value)
  return Number.isFinite(minutes) && minutes > 0 && minutes <= MAX_MINUTES ? minutes : null
}

/** A part's name as the line keeps it: its separators taken out. */
export const partName = name => String(name).replace(/[;|]/g, ',')

/** A step's saved plan: `{ names, on, steps, until, stepUntil, writtenAt }` (times in ms, null for none), or null for none. */
export function planOf(item) {
  const value = valueOf(item, 'Plan')
  if (value === null) return null
  const plan = { ...EMPTY, names: [] }
  /** The time a part names after its label, or null (a part that is no time of that label, or a time that is none). */
  const timeOf = (part, label) => {
    const at = sinceMs(part.match(new RegExp(`^${label} (${STAMP})$`))?.[1])
    return Number.isFinite(at) ? at : null
  }
  for (const part of value.split(SEP).map(one => one.trim())) {
    if (part.startsWith('parts ')) plan.names = part.slice(6).split(';').map(one => one.trim()).filter(Boolean)
    else if (part.startsWith('step until ')) plan.stepUntil = timeOf(part, 'step until')
    else if (part.startsWith('until ')) plan.until = timeOf(part, 'until')
    else if (part.startsWith('at ')) plan.writtenAt = timeOf(part, 'at')
    else {
      const on = part.match(/^step (\d+)(?:\/(\d+))?$/)
      if (on !== null) {
        plan.on = Number(on[1])
        plan.steps = on[2] === undefined ? null : Number(on[2])
      }
    }
  }
  return plan.on === null && plan.names.length === 0 && plan.until === null && plan.stepUntil === null ? null : plan
}

/** The plan as its line: the parts it has, the time it was written last. */
export function planText(plan) {
  return [
    plan.on === null ? null : `step ${plan.on}${plan.steps === null ? '' : `/${plan.steps}`}`,
    plan.names.length === 0 ? null : `parts ${plan.names.join('; ')}`,
    plan.until === null ? null : `until ${stampSecond(plan.until)}`,
    plan.stepUntil === null ? null : `step until ${stampSecond(plan.stepUntil)}`,
    `at ${stampSecond(plan.writtenAt)}`,
  ].filter(Boolean).join(SEP)
}

/**
 * The plan after a `work step` call, as the mod's card changes with it (`withPlan`, `withStep`): `names` (or `steps`, a
 * count alone) gives the parts and the step it is on (`step`, else the one it was on, else the first); without them the
 * call moves on to `step`, else to the next. `minutes` is the time still expected for the task, `stepMinutes` for the
 * step it is on, each counted from `now`; a time not given stays, the step's only while the step stays. The plan the
 * step had is `before` (null for none). Null when the call and the plan before it say nothing worth keeping.
 */
export function nextPlan(before, { names = [], steps = null, step = null, minutes = null, stepMinutes = null }, now) {
  const base = before ?? EMPTY
  const isPlan = names.length > 0 || steps !== null
  const kept = names.length > 0 ? names.map(partName) : isPlan && steps !== base.steps ? [] : base.names
  const total = names.length > 0 ? names.length : isPlan ? steps : base.steps
  let on = isPlan ? step ?? base.on ?? 1 : step ?? (base.on === null ? null : base.on + 1)
  if (on !== null && total !== null) on = Math.min(Math.max(on, 1), total)
  const until = minutes === null ? base.until : now + minutes * MINUTE_MS
  const stepUntil = stepMinutes !== null ? now + stepMinutes * MINUTE_MS : on === base.on ? base.stepUntil : null
  const plan = { names: kept, on, steps: total, until, stepUntil, writtenAt: now }
  return on === null && kept.length === 0 && until === null && stepUntil === null ? null : plan
}
