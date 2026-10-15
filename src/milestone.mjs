// B195: the way to the next milestone, as the Advisor maps it; the board counts each step's backlog steps as they
// stand now and shows the way as a row of steps. The person, 2026-10-14: "the main tab only shows some visual
// simplistic flow of where we roughly are till the next milestone, looking an the backlog whats already there or
// whats missing." Since B260 the map is the goal map, goals.md (milestoneFromGoals below); the Advisor's JSON file
// is retired.

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

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

/** The plan's part a goal names ("M1"), without a trailing full stop; '' for none. */
const planPart = node => (node.fromPlan ?? '').trim().replace(/[.:;,]+$/, '')

/** Everything inside a goal, itself included: its steps (each once) and its Missing lines. An id twice is walked once. */
function inside(goals, node, seen = new Set()) {
  if (seen.has(node.id)) return { steps: [], missing: [] }
  seen.add(node.id)
  const steps = [...node.steps]
  const missing = [...node.missing]
  for (const child of node.children.map(id => goals.byId.get(id)).filter(one => one !== undefined)) {
    const more = inside(goals, child, seen)
    steps.push(...more.steps)
    missing.push(...more.missing)
  }
  return { steps: [...new Set(steps)], missing }
}

/**
 * B260: the way from the goal map (goals.md, src/goals.mjs) instead of the Advisor's JSON: the first goal in file
 * order that is a milestone of the game plan (a "From the game plan:" line other than "the goal") and not done. Every
 * sub-goal is a box of the row, counted over everything inside it; a sub-goal ticked by hand with nothing listed is
 * done. The milestone itself is the last box (⚑, its Done when line), with its own Steps and Missing lines. Its name is
 * the plan's part ("M1"), its title the goal's title without "M1 · ". `isMapped` is false while it has no sub-goals.
 * Null when no such goal is left.
 */
export function milestoneFromGoals(goals, backlog) {
  const found = goals.nodes.find(node => goals.byId.get(node.id) === node && planPart(node) !== '' && planPart(node).toLowerCase() !== 'the goal' && node.state !== 'done')
  if (found === undefined) return null
  const name = planPart(found)
  const children = found.children.map(id => goals.byId.get(id)).filter(child => child !== undefined)
  const seen = new Set([found.id])
  const parts = children.map(child => ({ child, ...inside(goals, child, seen) }))
  const rec = found.recommendation
  const map = {
    milestone: {
      name: text(name, 20),
      title: text(found.title.startsWith(`${name} · `) ? found.title.slice(name.length + 3) : found.title, 80),
      doneWhen: text(found.doneWhen ?? '', 240),
      check: text(found.doneWhen ?? '', 80),
      backlog: found.steps,
      missing: found.missing,
    },
    steps: parts.map(({ child, steps, missing }) => ({ title: text(child.title, 80), backlog: steps, missing })),
    // A recommendation without a title is none: the page would offer an empty yes.
    recommendation: rec === null || text(rec.title, 120) === '' ? null : { ...rec },
    updated: '',
  }
  const way = milestoneWay(map, backlog)
  const nodes = way.nodes.map((node, index) => (index < parts.length && parts[index].child.state === 'done' && node.items.length + node.missing.length === 0 ? { ...node, state: 'done' } : node))
  return { ...way, nodes, isMapped: children.length > 0 }
}
