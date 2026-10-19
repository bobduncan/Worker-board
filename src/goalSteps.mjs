// B383: a goal's Missing lines made into steps from the Goals page's right panel. "Add step" makes a new step under
// the goal (the work store's `new`, as the person; the partner refines it as any new step), links it in the goal's
// Steps line and takes the Missing line out; "Add all" does so for each. Nothing of the project's work is named here.

import { parseGoals } from './goals.mjs'
import { removeGoalMissing, setGoalSteps } from './goalsWrite.mjs'

const refuse = (status, why) => ({ ok: false, status, why })

/**
 * A Missing line as a step's title: its words before a dash ("hit-stop timing — needed for ..."), no "Verify:" and the
 * like in front, no brackets at its end (the backlog's line would read them as more), its first letter a capital, at
 * most about 120 characters.
 */
export function stepTitleOf(line) {
  let words = String(line ?? '').replace(/\s+/g, ' ').trim().split(/\s+[—–]\s+/)[0]
  words = words.replace(/^(?:Verify|Decide|Provide|Do):\s*/i, '').replace(/(?:\s*\([^()]*\))+\s*$/, '').replace(/[\s.;,:@]+$/, '').trim()
  if (words.length > 120) words = `${words.slice(0, 117).replace(/\s+\S*$/, '')}…`
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The activity of a new step under a goal: the one most of the goal's steps are in (`items`, the store's), else the first. */
export function activityFor(goal, items, activities) {
  const counts = new Map()
  for (const item of items?.values() ?? []) {
    if (item.head.get('Kind') !== 'step' || item.head.get('Goal') !== goal) continue
    const activity = item.head.get('Activity')
    if (activity) counts.set(activity, (counts.get(activity) ?? 0) + 1)
  }
  const most = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  return most ?? activities?.[0]?.name ?? null
}

/**
 * B383: the goal's Missing line `index` (or every one, `all`) made into a step each. `ports`: `readMap()` (the goal
 * map's text), `makeStep(body)` (the work store's `new` as the person), `changeMap(change)` (one change to the map,
 * `change(text)` to `{ ok, text }`), `activity(goal)` (activityFor). Answers `{ ok, result: { id, made } }` or a
 * refusal; a line made into a step goes, and its step joins the goal's Steps line.
 */
export async function missingToSteps(body, ports) {
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!/^G\d+$/.test(id)) return refuse(400, 'Name the goal by its id (G12).')
  const node = parseGoals(await ports.readMap()).byId.get(id)
  if (node === undefined) return refuse(404, 'That goal is no longer in the map.')
  const lines = body.all === true ? [...node.missing] : Number.isInteger(body.index) && node.missing[body.index] !== undefined ? [node.missing[body.index]] : []
  if (lines.length === 0) return refuse(409, 'That line is not missing any more: the map changed meanwhile.')
  const activity = ports.activity(id)
  if (activity === null) return refuse(409, 'The work store has no activity to put the step under.')
  const made = []
  for (const line of lines) {
    const step = await ports.makeStep({ action: 'new', title: stepTitleOf(line), activity, goal: id, text: `From the goal map: ${id} ${node.title} still misses this: ${line}` })
    if (!step.ok) return made.length === 0 ? step : { ok: true, result: { id, made, why: step.why } }
    const stepId = step.result.id
    const changed = await ports.changeMap(text => {
      const now = parseGoals(text).byId.get(id)
      if (now === undefined) return { ok: false, why: 'gone' }
      const linked = setGoalSteps(text, id, [...now.steps, stepId])
      return linked.ok ? removeGoalMissing(linked.text, id, line) : linked
    })
    made.push(stepId)
    if (!changed.ok) return { ok: true, result: { id, made, why: 'The step is made, but the goal map could not be changed: link it by hand.' } }
  }
  return { ok: true, result: { id, made } }
}
