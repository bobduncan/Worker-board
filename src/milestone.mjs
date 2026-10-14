// B195: the way to the next milestone, as the Advisor maps it. The Advisor writes the map in the game's repository
// (`milestoneMap` in the settings, JSON, see roles/advisor.md); the board counts each step's backlog steps as they
// stand now and shows the way as a row of steps. The person, 2026-10-14: "the main tab only shows some visual
// simplistic flow of where we roughly are till the next milestone, looking an the backlog whats already there or
// whats missing."

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const ids = value => (Array.isArray(value) ? value : []).filter(id => typeof id === 'string' && /^B\d+$/.test(id.trim())).map(id => id.trim()).slice(0, 60)
const lines = value => (Array.isArray(value) ? value : []).map(one => text(one, 200)).filter(Boolean).slice(0, 20)

/** At most this many steps on the way: the person wants a simple flow. */
const MOST_STEPS = 8

/** The map as written, kept to its parts and lengths; null when the text is no map. */
export function parseMilestoneMap(raw) {
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  const milestone = data.milestone !== null && typeof data.milestone === 'object' ? data.milestone : {}
  const steps = (Array.isArray(data.steps) ? data.steps : []).slice(0, MOST_STEPS)
    .map(step => ({ title: text(step?.title, 80), backlog: ids(step?.backlog), missing: lines(step?.missing) }))
    .filter(step => step.title !== '')
  const title = text(milestone.title, 80)
  if (title === '' || steps.length === 0) return null
  const rec = data.recommendation !== null && typeof data.recommendation === 'object' ? data.recommendation : null
  const recTitle = text(rec?.title, 120)
  return {
    milestone: {
      name: text(milestone.name, 20), title, doneWhen: text(milestone.doneWhen, 240), check: text(milestone.check, 80),
      backlog: ids(milestone.backlog), missing: lines(milestone.missing),
    },
    steps,
    // An answer belongs to one recommendation: a new one needs a new id (its title when it has none).
    recommendation: recTitle === '' ? null : { id: text(rec.id, 60) || recTitle, title: recTitle, why: text(rec.why, 300), step: ids([rec.step])[0] ?? null, cost: text(rec.cost, 60) },
    updated: text(data.updated, 30),
  }
}

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
