// B383: a goal's Missing lines made into steps from the Goals page's right panel. "Add step" makes a new step under
// the goal (the work store's `new`, as the person; the partner refines it as any new step), links it in the goal's
// Steps line and takes the Missing line out; "Add all" does so for each. Nothing of the project's work is named here.

import { parseGoals } from './goals.mjs'
import { removeGoalMissing, setGoalSteps } from './goalsWrite.mjs'

const refuse = (status, why) => ({ ok: false, status, why })

/**
 * A Missing line as a step's title: its words before a dash ("hit-stop timing — needed for ..."), without what the
 * backlog's line would read as more (the review: an id in front, "Verify:" and the like, however many, brackets or an
 * "@you" at the end), its first letter a capital, at most about 120 characters; "Missing outcome of <goal>" when no
 * words are left.
 */
export function stepTitleOf(line, goal = 'the goal') {
  let words = String(line ?? '').replace(/\s+/g, ' ').trim().split(/\s+[—–]\s+/)[0]
  for (let before = ''; before !== words;) {
    before = words
    words = words.replace(/^(?:[A-Z]\d+\b[\s.:,-]*|(?:Verify|Decide|Provide|Do):\s*)/i, '')
      .replace(/(?:\s*\([^()]*\)|\s*@\w+)+\s*$/, '').replace(/[\s.;,:@]+$/, '').trim()
  }
  if (words.length > 120) words = `${words.slice(0, 117).replace(/\s+\S*$/, '')}…`
  return words === '' ? `Missing outcome of ${goal}` : words.charAt(0).toUpperCase() + words.slice(1)
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

const plain = words => String(words ?? '').replace(/\s+/g, ' ').trim()

/**
 * B383: the goal's Missing line (`line`, its words; `index` only names where the page saw it) or every one (`all`)
 * made into a step each. `ports`: `readMap()` (the goal map's text), `makeStep(body)` (the work store's `new` as the
 * person), `changeMap(change)` (one change to the map, `change(text)` to `{ ok, text }`), `activity(goal)`
 * (activityFor). Answers `{ ok, result: { id, made, failed } }` or a refusal; a line made into a step goes, and its step
 * joins the goal's Steps line. One runs at a time (the review: two clicks on one line make one step).
 */
let turn = Promise.resolve()
export function missingToSteps(body, ports) {
  const run = turn.then(() => missingOnce(body, ports))
  turn = run.catch(() => {})
  return run
}

async function missingOnce(body, ports) {
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!/^G\d+$/.test(id)) return refuse(400, 'Name the goal by its id (G12).')
  const node = parseGoals(await ports.readMap()).byId.get(id)
  if (node === undefined) return refuse(404, 'That goal is no longer in the map.')
  // The review: the line by its words, so a map changed meanwhile never makes a step of another line.
  const wanted = typeof body.line === 'string' ? node.missing.find(one => plain(one) === plain(body.line)) : node.missing[body.index]
  const lines = body.all === true ? [...node.missing] : wanted === undefined ? [] : [wanted]
  if (lines.length === 0) return refuse(409, 'That line is not missing any more: the map changed meanwhile.')
  const activity = ports.activity(id)
  if (activity === null) return refuse(409, 'The work store has no activity to put the step under.')
  const made = []
  const failed = []
  for (const line of lines) {
    const step = await ports.makeStep({ action: 'new', title: stepTitleOf(line, id), activity, goal: id, text: `From the goal map: ${id} ${node.title} still misses this: ${line}` })
    // The review: a line the store refuses is named, and Add all goes on with the next.
    if (!step.ok) {
      failed.push({ line, why: step.why })
      continue
    }
    const stepId = step.result.id
    const changed = await ports.changeMap(text => {
      const now = parseGoals(text).byId.get(id)
      if (now === undefined) return { ok: false, why: 'gone' }
      const linked = setGoalSteps(text, id, [...now.steps, stepId])
      return linked.ok ? removeGoalMissing(linked.text, id, line) : linked
    })
    made.push(stepId)
    if (!changed.ok) failed.push({ line, why: `${stepId} is made, but the goal map could not be changed: link it by hand.` })
  }
  if (made.length === 0 && failed.length > 0) return refuse(409, failed[0].why)
  return { ok: true, result: { id, made, failed } }
}
