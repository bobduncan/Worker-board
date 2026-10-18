// The goal map (spec 2026-10-15, section 1): one Markdown file in the backlog's form. A goal is one line
// "- [ ] G<n> <title>"; two spaces per level is "part of"; the lines under a goal, one level deeper, are named
// "Name: value". Read here into nodes and counted against the backlog. Pure: no file is read here.

export const GOAL_LINE = /^( *)- \[( |~|x|X)\] (G\d+) (.*)$/
const STATES = { ' ': 'open', '~': 'now', x: 'done', X: 'done' }
const NAMED = /^([A-Z][A-Za-z ]*?)(?: \(([^)]*)\))?:\s*(.*)$/
const ASK_HEAD = /^Ask \((A\d+), ([^)]+)\):\s*(.*)$/
const ANSWER_HEAD = /^Answer \(([^,]+), ([^)]+)\):\s*(.*)$/
const RECOMMENDATION = /^Recommendation \((R\d+)\):\s*(.*)$/
const IDS = /\bG\d+\b/g
// A line that starts like a goal; one that is not in GOAL_LINE's form is named as a problem.
const GOAL_LIKE = /^ *- \[[^\]]*\]/
const NOT_A_GOAL = 'is not a goal in the form "- [ ] G<n> <title>"'
export const LAST_LINE = /^Last (id|ask):\s*[GA](\d+)\s*$/

const ids = value => value.match(IDS) ?? []
const stepIds = value => value.split(/[,\s]+/).filter(part => /^B\d+$/.test(part))

function node(id, title, state, depth, line) {
  return { id, title: title.trim(), state, depth, parent: null, children: [], line, doneWhen: null, why: null, enables: [], alsoPartOf: [], steps: [], missing: [], notes: [], asks: [], brainstorm: null, fromPlan: null, recommendation: null }
}

/** One named line under a node, put on it. A line in a form the map does not know goes to `notes`, so nothing is lost. */
function takeLine(target, text) {
  const named = text.match(NAMED)
  if (named === null) return target.notes.push(text)
  const [, name, , value] = named
  switch (name) {
    case 'Done when': target.doneWhen = value; return
    case 'Why': target.why = value; return
    case 'Enables': target.enables.push(...ids(value)); return
    case 'Also part of': target.alsoPartOf.push(...ids(value)); return
    case 'Steps': target.steps.push(...stepIds(value)); return
    case 'Missing': target.missing.push(value); return
    case 'From the game plan': target.fromPlan = value; return
    case 'Brainstorm': {
      const found = value.match(/^(\S+)(?:\s+\((running|wrapping up|done|discarded)\))?$/)
      target.brainstorm = found === null ? { path: value, state: 'running' } : { path: found[1], state: found[2] ?? 'running' }
      return
    }
    case 'Recommendation': {
      const rec = text.match(RECOMMENDATION)
      if (rec === null) return target.notes.push(text)
      const [title = '', why = '', cost = '', step = ''] = rec[2].split(' · ').map(part => part.trim())
      target.recommendation = { id: rec[1], title, why, cost, step: /^B\d+$/.test(step) ? step : null }
      return
    }
    case 'Ask': {
      const ask = text.match(ASK_HEAD)
      if (ask === null) return target.notes.push(text)
      target.asks.push({ id: ask[1], at: ask[2].trim(), text: ask[3], answer: null, readAt: null })
      return
    }
    case 'Answer': {
      const answer = text.match(ANSWER_HEAD)
      const last = target.asks.at(-1)
      if (answer === null || last === undefined) return target.notes.push(text)
      last.answer = { at: answer[1].trim(), by: answer[2].trim(), text: answer[3], more: null }
      return
    }
    case 'More': {
      const last = target.asks.at(-1)
      if (last?.answer) last.answer.more = value
      else target.notes.push(text)
      return
    }
    case 'Read': {
      const last = target.asks.at(-1)
      if (last === undefined) return target.notes.push(text)
      last.readAt = value
      return
    }
    default: target.notes.push(text)
  }
}

/**
 * goals.md as nodes in file order, with `byId`, the top goals (`roots`) and the problems the file has, each named
 * once with its line ("line 4: the id G3 is used twice"). A broken file is still a map: a node with a duplicate id
 * stays in `nodes` (the first keeps the id in `byId`, the tree and the counts), an odd indentation is read as the
 * nearest level, a tab as two spaces. A named line belongs to the goal one level less indented than it, also after
 * that goal's children. A line at the margin that is not a goal is the file's own words (its rules on top).
 */
export function parseGoals(text) {
  const nodes = []
  const byId = new Map()
  const roots = []
  const problems = []
  const stack = []  // the open nodes, one per depth
  // The head lines that keep an id from ever coming back: "Last id: G<n>", "Last ask: A<n>".
  let lastGoal = 0
  let lastAsk = 0
  ;(text ?? '').replace(/^﻿/, '').split('\n').forEach((raw, index) => {
    let line = raw.replace(/\r$/, '')
    if (line.trim() === '' || line.startsWith('#')) return
    if (/^ *\t/.test(line)) {
      problems.push(`line ${index + 1}: indented with a tab, not two spaces per level`)
      line = line.replace(/^[ \t]+/, lead => lead.replace(/\t/g, '  '))
    }
    const goal = line.match(GOAL_LINE)
    if (goal !== null) {
      const spaces = goal[1].length
      if (spaces % 2 !== 0) problems.push(`line ${index + 1}: indentation is not a multiple of two spaces`)
      const depth = Math.min(Math.floor(spaces / 2), stack.length)
      const made = node(goal[3], goal[4], STATES[goal[2]], depth, index + 1)
      const isTwice = byId.has(made.id)
      if (isTwice) problems.push(`line ${index + 1}: the id ${made.id} is used twice`)
      stack.length = depth
      const parent = stack.at(-1) ?? null
      made.parent = parent === null ? null : parent.id
      // The second of an id stays out of the tree: the first is the one the counts and the outline walk.
      if (!isTwice && parent === null) roots.push(made.id)
      else if (!isTwice) parent.children.push(made.id)
      stack.push(made)
      nodes.push(made)
      if (!isTwice) byId.set(made.id, made)
      return
    }
    if (GOAL_LIKE.test(line)) return problems.push(`line ${index + 1}: ${NOT_A_GOAL}`)
    const head = line.match(LAST_LINE)
    if (head !== null) {
      if (head[1] === 'id') lastGoal = Math.max(lastGoal, Number(head[2]))
      else lastAsk = Math.max(lastAsk, Number(head[2]))
      return
    }
    if (!/^\s/.test(line)) return
    // An indented line belongs to the deepest open goal less indented than it, so nothing is lost.
    const indent = line.length - line.trimStart().length
    const owner = stack.findLast(open => open.depth * 2 < indent)
    if (owner === undefined) return problems.push(`line ${index + 1}: a line under no goal`)
    takeLine(owner, line.trim())
  })
  return { nodes, byId, roots, problems, lastGoal, lastAsk }
}

const highest = (values, prefix) => values.reduce((most, value) => Math.max(most, Number(value.slice(prefix.length))), 0)

/**
 * The id a new goal or ask takes: one more than the highest in the file and than its head line ("Last id: G<n>",
 * "Last ask: A<n>"), which every new one raises, so an id is never used again, also after its goal is deleted.
 */
export const nextGoalId = goals => `G${Math.max(highest(goals.nodes.map(one => one.id), 'G'), goals.lastGoal ?? 0) + 1}`
export const nextAskId = goals => `A${Math.max(highest(goals.nodes.flatMap(one => one.asks.map(ask => ask.id)), 'A'), goals.lastAsk ?? 0) + 1}`

/** B258: every ask in the map under its goal, in file order: `{ goal, goalTitle, ask }`. An id used twice is read once. */
export const goalAskList = goals => [...goals.byId.values()].flatMap(node => node.asks.map(ask => ({ goal: node.id, goalTitle: node.title, ask })))

/**
 * B258: what waits for the person under "Needs your attention": an ask the Advisor answered that the person has not
 * read yet (no "Read:" line), one need each; "Done" on the board marks it read.
 */
export const goalAskNeeds = goals => goalAskList(goals)
  .filter(one => one.ask.answer !== null && one.ask.readAt === null)
  .map(one => ({ kind: 'goal-ask', id: one.ask.id, goal: one.goal, goalTitle: one.goalTitle, title: `The Advisor answered your ask on ${one.goal} ${one.goalTitle}`, question: one.ask.text, at: one.ask.answer.at, approval: 'read' }))

/** Done or open per backlog id; an id the backlog does not hold is absent. */
function stepStates(backlog) {
  const states = new Map()
  for (const activity of backlog?.activities ?? []) for (const step of activity.steps) if (step.id !== null) states.set(step.id, step.isDone ? 'done' : 'open')
  return states
}

/**
 * B289: the open steps of the backlog that no goal's "Steps:" line names, in the backlog's order, `{ id, title }`:
 * what the Advisor still has to link to a goal. A step without an id cannot be named in a goal, and the Advisor's own
 * suggestions (its group, the setting `advisorSuggestions`) are not work yet.
 */
export function unlinkedSteps(goals, backlog, suggestions = 'Advisor suggestions') {
  const named = new Set(goals.nodes.flatMap(node => node.steps))
  const seen = new Set()
  return (backlog?.activities ?? []).filter(activity => (activity.name ?? '').trim().toLowerCase() !== suggestions.toLowerCase())
    .flatMap(activity => activity.steps)
    .filter(step => {
      if (step.isDone || step.id === null || named.has(step.id) || seen.has(step.id)) return false
      seen.add(step.id)
      return true
    })
    .map(step => ({ id: step.id, title: step.title }))
}

/**
 * Each node's counters over its subtree by home position (`children`; an "Also part of" counts under its home only):
 * the nodes inside, the steps (each backlog id once per node, even when two children name it) done, open or unknown
 * (not on the backlog), and the Missing lines. An id used twice is walked once, so a file with that mistake cannot
 * send the count round in circles.
 */
export function goalCounts(goals, backlog) {
  const states = stepStates(backlog)
  const counts = new Map()
  const seen = new Set()
  const gather = id => {
    const one = goals.byId.get(id)
    if (one === undefined || seen.has(id)) return null
    seen.add(id)
    const steps = new Set(one.steps)
    let nodes = 0
    let missing = one.missing.length
    for (const child of one.children) {
      const inner = gather(child)
      if (inner === null) continue
      nodes += 1 + inner.nodes
      missing += inner.missing
      for (const step of inner.steps) steps.add(step)
    }
    let done = 0
    let open = 0
    let unknown = 0
    for (const step of steps) {
      const state = states.get(step)
      if (state === 'done') done += 1
      else if (state === 'open') open += 1
      else unknown += 1
    }
    counts.set(id, { nodes, steps: steps.size, done, open, unknown, missing })
    return { nodes, missing, steps }
  }
  for (const root of goals.roots) gather(root)
  return counts
}
