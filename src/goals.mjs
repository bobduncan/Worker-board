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
/** Focus 1: the focus goal, a head line before the first goal: "Focus: G6"; "Focus:" alone is none. */
export const FOCUS_LINE = /^Focus:\s*(G\d+)?\s*$/

/** B677: whether a goal has its Demo line (`Demo: <picture path> · <a few words>`): the picture the person sees before they answer "Did we reach the goal?". */
export const hasDemo = node => typeof node?.demo === 'string' && node.demo.trim() !== ''

/**
 * Work blocks (the person, 2026-10-31: "a goal has X workblocks. each workblock has X tasks"): a goal's blocks are its
 * `Part:` lines that were not dropped (`Part dropped:`), in their order.
 */
export const blocksOf = node => (node?.parts ?? []).filter(part => !(node.partsDropped ?? []).some(one => one.title === part.title))

/** Work blocks: whether every block of the goal has its done-when line (a goal with no block has none). */
export const hasBlockLines = node => blocksOf(node).length > 0 && blocksOf(node).every(part => typeof part.doneWhen === 'string' && part.doneWhen.trim() !== '')

/**
 * B354; work blocks (2026-10-31): a goal has its Done when with its one line, or when every work block of it has its
 * done-when line: only then may it be the focus, or be ticked.
 */
export const hasDoneWhen = node => (typeof node?.doneWhen === 'string' && node.doneWhen.trim() !== '') || hasBlockLines(node)

/**
 * Work blocks (2026-10-31): whether a goal went past Go once: its how is agreed, or was (a block has tasks, which are made
 * after Go, or the goal was re-checked or evaluated). Such a goal is never held at Go for its blocks' done-when lines.
 */
export const wentPastGo = node => (node?.howAgreed ?? null) !== null || (node?.parts ?? []).some(part => part.steps.length > 0) || (node?.rechecks ?? []).length > 0 || (node?.evaluations ?? []).length > 0

/** Work blocks (2026-10-31): whether Go waits for a block's done-when line: a goal never past Go with a block without one. */
export const goWaitsForLines = node => !wentPastGo(node) && blocksOf(node).some(part => typeof part.doneWhen !== 'string' || part.doneWhen.trim() === '')

/** Work blocks: the goal's Done when as one line for a word: its own line, else its blocks' done-when lines, " · " between. */
export const doneWhenText = node => (typeof node?.doneWhen === 'string' && node.doneWhen.trim() !== '' ? node.doneWhen.trim()
  : blocksOf(node).map(part => part.doneWhen).filter(line => typeof line === 'string' && line.trim() !== '').join(' · '))

const ids = value => value.match(IDS) ?? []
const stepIds = value => value.split(/[,\s]+/).filter(part => /^B\d+$/.test(part))

function node(id, title, state, depth, line) {
  return { id, title: title.trim(), state, depth, parent: null, children: [], line, doneWhen: null, demo: null, demoAsked: null, why: null, enables: [], alsoPartOf: [], steps: [], partsDropped: [], missing: [], notes: [], asks: [], brainstorm: null, fromPlan: null, recommendation: null, vibe: [], vibePicture: null, vibeAgreed: null, parts: [], partnerDecides: [], youDecide: [], howAgreed: null, recheckAsked: null, rechecks: [], overturned: [], evaluationAsked: null, evaluations: [], evaluatedAt: [], fableAsked: null, evaluationPart: null, objective: null, doneBullets: [], notInIt: null, yourWords: [], rounds: [] }
}

/**
 * "Change this goal" (2026-10-31): a bullet of the goal's Done when, `Done when <n>: <text> · steps B1, B2` (the steps
 * that meet it, left out while none), as `{ n, text, steps }`. Its text may hold " · " itself: only a last part that is
 * "steps" and ids is read as the steps.
 */
export const DONE_BULLET = /^Done when (\d+):\s*(.*)$/
export function doneBulletOf(n, value) {
  const found = String(value ?? '').trim().match(/^(.*?)(?:\s*·\s*steps\s+(B\d+(?:\s*,\s*B\d+)*))?\s*$/)
  return { n: Number(n), text: found[1].trim(), steps: found[2] === undefined ? [] : stepIds(found[2]) }
}

/** "Change this goal": the person's words kept under the goal, `Your words: <date time> · <their words>`. */
function yourWordsOf(value) {
  const at = value.indexOf(' · ')
  return at < 0 ? { at: '', text: value.trim() } : { at: value.slice(0, at).trim(), text: value.slice(at + 3).trim() }
}

/** Work blocks: a segment of a Part line that holds the block's tasks ("steps B1, B2"). */
const STEPS_PART = /^steps\b/i
/** Work blocks: the segment that holds the block's done-when line ("done when: <line>"). */
const DONE_PART = /^done when:\s*/i

/**
 * Focus 1: "<title> · <size> · steps B1, B2", the size and the steps each left out at will. Work blocks (2026-10-31): and
 * " · done when: <line>" at its end, the block's done-when line (`doneWhen`, null without it); the line may hold " · "
 * itself, and a "steps B<n>" segment after it is still read as the steps.
 */
export function partOf(value) {
  const [title = '', ...rest] = String(value ?? '').split(' · ').map(part => part.trim())
  const at = rest.findIndex(part => DONE_PART.test(part))
  const before = at < 0 ? rest : rest.slice(0, at)
  const after = at < 0 ? [] : rest.slice(at)
  const steps = [...before, ...after.slice(1)].filter(part => STEPS_PART.test(part) && stepIds(part.replace(STEPS_PART, '')).length > 0)
  const size = before.find(part => !STEPS_PART.test(part) && part !== '') ?? null
  const line = after.length === 0 ? '' : [after[0].replace(DONE_PART, ''), ...after.slice(1).filter(part => !steps.includes(part))].join(' · ').trim()
  return { title, size, steps: steps.flatMap(part => stepIds(part.replace(STEPS_PART, ''))), doneWhen: line === '' ? null : line }
}

/** Work blocks: a round's line under a goal, "Round: <date time> · <why>", as `{ at, why }`; the why may hold " · ". */
function roundLineOf(value) {
  const [at = '', ...why] = value.split(' · ').map(part => part.trim())
  return { at, why: why.join(' · ') }
}

/** B680: "<part title> · <date time> · <why>" of a part the person dropped; the why may hold " · " itself. */
function droppedOf(value) {
  const [title = '', at = '', ...why] = value.split(' · ').map(part => part.trim())
  return { title, at, why: why.join(' · ') }
}

/**
 * B358: a re-check's line, "Rechecked (<date time>, <who>): passed · 3 of 3 points pass · evidence <path>" (or
 * "failed · ... · gap: <points>", "waits for you · ... · for you: <points>"): `{ at, by, verdict, summary, gap, evidence }`.
 */
function recheckOf(text) {
  const [, inside = '', value = ''] = text.match(/^Rechecked\s*\(([^)]*)\):\s*(.*)$/) ?? []
  const [at = '', by = ''] = inside.split(',').map(one => one.trim())
  const parts = value.split(' · ').map(one => one.trim())
  const named = start => parts.find(one => one.startsWith(start))?.slice(start.length).trim() ?? null
  const verdict = ['passed', 'failed', 'waits for you'].includes(parts[0]) ? parts[0] : 'failed'
  return { at, by, verdict, summary: parts.find(one => /\bpoints? pass\b/.test(one)) ?? '', gap: named('gap:') ?? named('for you:'), evidence: named('evidence') }
}

/** One named line under a node, put on it. A line in a form the map does not know goes to `notes`, so nothing is lost. */
function takeLine(target, text) {
  // "Change this goal": a numbered bullet of the Done when, which NAMED does not take (its name holds a number).
  const bullet = text.match(DONE_BULLET)
  if (bullet !== null) return target.doneBullets.push(doneBulletOf(bullet[1], bullet[2]))
  const named = text.match(NAMED)
  if (named === null) return target.notes.push(text)
  const [, name, stamp = '', value] = named
  switch (name) {
    case 'Done when': target.doneWhen = value; return
    // "Change this goal" (2026-10-31): the goal's objective and what is not in it, as a change brainstorm agreed them,
    // and the person's own words about the goal, each a point with its time.
    case 'Objective': target.objective = value; return
    case 'Not in it': target.notInIt = value; return
    case 'Your words': target.yourWords.push(yourWordsOf(value)); return
    case 'Why': target.why = value; return
    case 'Enables': target.enables.push(...ids(value)); return
    case 'Also part of': target.alsoPartOf.push(...ids(value)); return
    case 'Steps': target.steps.push(...stepIds(value)); return
    case 'Missing': target.missing.push(value); return
    case 'From the game plan': target.fromPlan = value; return
    // Focus 1 (spec 2026-10-18, section 5): the goal's vibe and its how, as the person and the partner agree them.
    case 'Vibe': target.vibe.push(value); return
    case 'Vibe picture': target.vibePicture = value; return
    // 2026-10-25: the page a goal makes (a review, a check, a doc): "<path> · <a few words>".
    case 'Page': target.page = value; return
    // B677: the goal demo (`Demo: <picture path> · <a few words>`), and the board's ask for it (`Demo asked: <date time> · <n>`).
    case 'Demo': target.demo = value; return
    case 'Demo asked': target.demoAsked = value; return
    case 'Vibe agreed': target.vibeAgreed = value; return
    case 'Part': target.parts.push(partOf(value)); return
    // B680: a part the person dropped (`Part dropped: <part title> · <date time> · <why>`).
    case 'Part dropped': target.partsDropped.push(droppedOf(value)); return
    case 'Partner decides': target.partnerDecides.push(value); return
    case 'You decide': target.youDecide.push(value); return
    case 'How agreed': target.howAgreed = value; return
    // Work blocks (2026-10-31): an evaluation that starts a new round of the goal's work ("Round: <date time> · <why>").
    case 'Round': target.rounds.push(roundLineOf(value)); return
    // B358: the goal re-check before its tick: asked (the board's), its outcomes (the partner's), and the person's tick
    // after a failed one.
    case 'Recheck asked': target.recheckAsked = value; return
    case 'Rechecked': target.rechecks.push(recheckOf(text)); return
    case 'Overturned': target.overturned.push(value); return
    // B359: the goal guard: the fundamental evaluation asked (the board's), and how each ended ("Evaluated (<date time>): ...").
    case 'Evaluation asked': target.evaluationAsked = value; return
    // 2026-10-24: the board's ask before the evaluation, Fable or Opus ("Fable asked: Q<n>"), until the evaluation ends.
    case 'Fable asked': target.fableAsked = value.trim() || null; return
    // B669: the part whose third failed check tripped the guard, until the evaluation ends: its steps get the higher effort, the others go on.
    case 'Evaluation part': target.evaluationPart = value.trim() || null; return
    case 'Evaluated': target.evaluations.push(value); target.evaluatedAt.push(stamp.trim()); return
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
  // Focus 1: the focus is a head line, read before the first goal only.
  let focus = null
  let isHead = true
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
      isHead = false
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
    const focused = isHead ? line.match(FOCUS_LINE) : null
    if (focused !== null) {
      focus = focused[1] ?? null
      return
    }
    if (!/^\s/.test(line)) return
    // An indented line belongs to the deepest open goal less indented than it, so nothing is lost.
    const indent = line.length - line.trimStart().length
    const owner = stack.findLast(open => open.depth * 2 < indent)
    if (owner === undefined) return problems.push(`line ${index + 1}: a line under no goal`)
    takeLine(owner, line.trim())
  })
  return { nodes, byId, roots, problems, lastGoal, lastAsk, focus }
}

/**
 * Focus 1 (spec 2026-10-18, section 5): where the focus goal stands, from its lines: no goal (none, or one that is
 * gone) → 'pick'; ticked → 'done'; no "Vibe agreed" → 'vibe'; no "How agreed" → 'how'; else 'run'.
 */
export function focusStage(node) {
  if (node === null || node === undefined) return 'pick'
  if (node.state === 'done') return 'done'
  if (node.vibeAgreed === null) return 'vibe'
  if (node.howAgreed === null) return 'how'
  return 'run'
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
