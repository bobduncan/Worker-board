// B195: the way to the next milestone, as the Advisor maps it; the board counts each step's backlog steps as they
// stand now and shows the way as a row of steps. The person, 2026-10-14: "the main tab only shows some visual
// simplistic flow of where we roughly are till the next milestone, looking an the backlog whats already there or
// whats missing." Since B260 the map is the goal map, goals.md (milestoneFromGoals below); the Advisor's JSON file
// is retired.

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** At most this many steps on the way: the person wants a simple flow. */
const MOST_STEPS = 8

/**
 * The way as the page draws it: each step with its backlog steps as they stand now (an id that is not on the backlog
 * counts as missing), what is missing, how many are left, and whether it is done, part done or not started; the
 * milestone's own check last (`isGoal`). `backlog` is the board's parsed backlog.
 */
export function milestoneWay(map, backlog) {
  const known = new Map(backlog.activities.flatMap(activity => activity.steps).filter(step => step.id !== null).map(step => [step.id, step]))
  // An id counts once: in the first step that names it.
  const counted = new Set()
  const node = (title, part, isGoal) => {
    const own = [...new Set(part.backlog)].filter(id => !counted.has(id))
    for (const id of own) counted.add(id)
    const items = own.filter(id => known.has(id)).map(id => ({ id, title: known.get(id).title, isDone: known.get(id).isDone }))
    const missing = [...new Set([...part.missing, ...own.filter(id => !known.has(id)).map(id => `${id}, not on the backlog`)])]
    const done = items.filter(item => item.isDone).length
    const open = items.length - done
    const left = open + missing.length
    // A step with nothing listed is not started, not done.
    const state = items.length + missing.length === 0 ? 'none' : left === 0 ? 'done' : done > 0 ? 'part' : 'none'
    return { title, isGoal, items, missing, done, open, left, state }
  }
  const nodes = [...map.steps.map(step => node(step.title, step, false)), node(map.milestone.check || map.milestone.title, map.milestone, true)]
  const sum = pick => nodes.reduce((total, one) => total + pick(one), 0)
  return {
    milestone: { name: map.milestone.name, title: map.milestone.title, doneWhen: map.milestone.doneWhen },
    nodes,
    totals: { done: sum(one => one.done), open: sum(one => one.open), missing: sum(one => one.missing.length), left: sum(one => one.left) },
    recommendation: map.recommendation,
    updated: map.updated,
  }
}

/**
 * B260: the way from the goal map (goals.md, src/goals.mjs) instead of the Advisor's JSON: the first goal in file
 * order that is a milestone of the game plan (a "From the game plan:" line other than "the goal") and not done. Its
 * children are the row; the last child is the milestone's own check, drawn last as its box, as the Advisor writes the
 * map (roles/advisor.md); the milestone's own Steps and Missing lines count in that box too. Its name is the plan's
 * part ("M1"), its title the goal's title after "M1 · ". Null when no such goal is left.
 */
export function milestoneFromGoals(goals, backlog) {
  const found = goals.nodes.find(node => goals.byId.get(node.id) === node && node.fromPlan !== null && node.fromPlan.trim().toLowerCase() !== 'the goal' && node.state !== 'done')
  if (found === undefined) return null
  const children = found.children.map(id => goals.byId.get(id)).filter(child => child !== undefined)
  const check = children.at(-1) ?? null
  const steps = children.slice(0, -1).slice(0, MOST_STEPS)
  const map = {
    milestone: {
      name: text(found.fromPlan, 20),
      title: text(found.title.replace(/^[^·]*·\s*/, ''), 80) || text(found.title, 80),
      doneWhen: text(found.doneWhen ?? '', 240),
      check: text(check?.title ?? found.doneWhen ?? '', 80),
      backlog: [...found.steps, ...(check?.steps ?? [])],
      missing: [...found.missing, ...(check?.missing ?? [])],
    },
    steps: steps.map(child => ({ title: text(child.title, 80), backlog: child.steps, missing: child.missing })),
    recommendation: found.recommendation === null ? null : { ...found.recommendation },
    updated: '',
  }
  return milestoneWay(map, backlog)
}
