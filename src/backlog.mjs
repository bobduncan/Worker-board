// Source 4: the backlog, `<project>\.claude\backlog.md`. A `## ` heading is an activity ("#focus" marks the
// person's main focus), a `- [ ]` line is a step, `@you` at its end marks a step only the person can do, and an
// indented line under a step belongs to that step. An open step starts with its id, "B14".

/** The worker a step names: "(for Units; ...)" first, else the first chat title found in the text. */
function workerOf(text, forWhom, prefix, names) {
  // The longest name first, so "Levels / Environment" is not cut short by a chat called "Levels".
  const known = [...names].sort((a, b) => b.length - a.length)
  if (forWhom !== null) {
    const plain = forWhom.startsWith(prefix) ? forWhom.slice(prefix.length) : forWhom
    return known.find(name => name.toLowerCase() === plain.toLowerCase()) ?? plain
  }
  let found = null
  let foundAt = Infinity
  for (const name of known) {
    const at = text.indexOf(`${prefix}${name}`)
    if (at >= 0 && at < foundAt) {
      found = name
      foundAt = at
    }
  }
  return found
}

/** "about 40 min", "about 2 h", "about 1 h 30 min", "about 1.5 hours" as minutes. */
export function minutesOf(part) {
  const found = part.match(/^about\s+(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\b)?\s*(?:(\d+)\s*min(?:utes?|s)?\b)?/i)
  if (found === null || (found[1] === undefined && found[2] === undefined)) return null
  return Math.round(Number(found[1] ?? 0) * 60 + Number(found[2] ?? 0))
}

/** The first "about <time>" in a text, as minutes, or null: "About 45 minutes, after B92" is 45. */
export function aboutMinutes(text) {
  for (const found of text.matchAll(/\babout\s/gi)) {
    const minutes = minutesOf(text.slice(found.index))
    if (minutes !== null) return minutes
  }
  return null
}

export function parseStep(isDone, rest, { prefix, names }) {
  const isYou = /(^|\s)@you\s*$/.test(rest)
  // A step starts with its id ("B14"): the person names a step by it, and it never changes.
  const lead = rest.match(/^(B\d+)\s+/)
  const text = rest.slice(lead === null ? 0 : lead[0].length).replace(/(^|\s)@you\s*$/, '').trim()

  // A step in progress names its branch at its very end, after the note of who it is for: "(branch feature/x)".
  const own = text.match(/\s*\(branch\s+([\w./-]+)\)\s*$/)
  const body = own === null ? text : text.slice(0, own.index)
  // The note the main chat writes on a queued step: "(for Units; after <condition>; about 40 min)". The condition
  // may hold brackets of its own, as in "after the archer (branch x) merges".
  const spec = body.match(/\s*\((for (?:[^()]|\([^()]*\))*)\)\s*$/)
  let forWhom = null
  let after = null
  let minutes = null
  if (spec !== null) {
    for (const part of spec[1].split(';').map(piece => piece.trim())) {
      if (/^for\s+/i.test(part)) forWhom = part.replace(/^for\s+/i, '').trim()
      else if (/^after\s+/i.test(part)) after = part.replace(/^after\s+/i, '').trim()
      else minutes ??= minutesOf(part)
    }
  }

  // After its id, a step for the person says what it asks of them: "Verify:", "Decide:", "Provide:" or "Do:".
  const asks = text.match(/^(Verify|Decide|Provide|Do):\s*/i)

  return {
    id: lead === null ? null : lead[1],
    text,
    title: (spec === null ? body : body.slice(0, spec.index)).slice(asks === null ? 0 : asks[0].length).trim(),
    asks: asks === null ? null : asks[1].toLowerCase(),
    isDone,
    isYou,
    notes: [],
    worker: workerOf(text, forWhom, prefix, names),
    // The main chat's note names who it is for.
    isFor: forWhom !== null,
    // The branch the step itself is worked on: it is in progress. `branch` is that, else any branch its words name.
    ownBranch: own === null ? null : own[1],
    branch: own?.[1] ?? text.match(/\bbranch\s+([\w./-]+)/)?.[1] ?? null,
    after,
    minutes,
  }
}

export function parseBacklog(fileText, { prefix = '', names = [] } = {}) {
  const activities = []
  let activity = null
  let step = null
  for (const raw of fileText.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const heading = line.match(/^##\s+(.+)$/)
    if (heading !== null) {
      const isFocus = /(^|\s)#focus(\s|$)/.test(heading[1])
      activity = { name: heading[1].replace(/(^|\s)#focus(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim(), isFocus, steps: [] }
      activities.push(activity)
      step = null
      continue
    }
    const item = line.match(/^- \[( |x|X)\]\s+(.*)$/)
    if (item !== null) {
      step = activity === null ? null : parseStep(item[1] !== ' ', item[2], { prefix, names })
      if (step !== null) activity.steps.push(step)
      continue
    }
    if (step !== null && /^\s+\S/.test(line)) {
      step.notes.push(line.trim())
      // A note may name the worker the step was handed to.
      step.worker ??= workerOf(line, null, prefix, names)
      continue
    }
    if (line.trim() === '') continue
    step = null
  }
  return { activities }
}

const open = activity => activity.steps.filter(step => !step.isDone)

/**
 * The indented lines under a step, in sections, for the details of a step. A line "Requirements: ..." starts the
 * section of that name, a line "- ..." is a point of the section it is in, and any other line is a line of it.
 * What comes before the first name is a section without one.
 */
export function noteSections(notes) {
  const sections = []
  let section = null
  const start = title => {
    section = { title, lines: [], points: [] }
    sections.push(section)
  }
  for (const note of notes) {
    const line = note.trim()
    const named = line.match(/^([A-Z][A-Za-z /]{1,28}):\s*(.*)$/)
    if (named !== null) {
      start(named[1])
      if (named[2] !== '') section.lines.push(named[2])
      continue
    }
    if (section === null) start(null)
    const point = line.match(/^[-*]\s+(.*)$/)
    if (point !== null) section.points.push(point[1])
    else section.lines.push(line)
  }
  return sections
}

// refined:start
/**
 * B233: the lines a refine writes under a step, kept together as one block that starts with "Refined (...):" and holds
 * "Problem:", "Goal:", "Questions:" (points, each with " Answer: ..." once the person answered) and "Feedback:"
 * (points, "Round 1: ..."). The brackets of its first line say the round, who refined it and when, and
 * "accepted <when>" once the person accepted it. Any other named line, or a line in brackets, ends the block.
 */
export const REFINED_HEAD = /^Refined\s*(?:\(([^)]*)\))?\s*:\s*$/
const REFINED_PARTS = { Problem: 'problem', Goal: 'goal', Questions: 'questions', Feedback: 'feedback' }
/**
 * B285: the lines of the Advisor's newer form (what "refined" means, approved 2026-10-17: a summary, a picture, its
 * goal, its size, and what we build once ready) stand in the block too, so the questions under them stay in it; the
 * board does not show them yet.
 */
const REFINED_KEPT = new Set(['Summary', 'Picture', 'Part of', 'Size', 'What we build'])
const NAMED = /^([A-Z][A-Za-z /]{1,28}):\s*(.*)$/

/** Where the refine block stands in a step's notes: `[start, end)` as indexes of `notes`, or null when it has none. */
export function refinedSpan(notes) {
  const start = notes.findIndex(note => REFINED_HEAD.test(note.trim()))
  if (start < 0) return null
  let end = start + 1
  while (end < notes.length) {
    const line = notes[end].trim()
    const named = line.match(NAMED)
    if ((named !== null && REFINED_PARTS[named[1]] === undefined && !REFINED_KEPT.has(named[1])) || line.startsWith('(') || REFINED_HEAD.test(line)) break
    end += 1
  }
  return [start, end]
}

/**
 * B233: a step's refine block, read from its notes, or null when it has none: `{ round, by, at, accepted, problem,
 * goal, questions: [{ text, answer }], feedback: [lines] }`. `answer` is null for a question still open.
 */
export function refinedOf(notes) {
  const span = refinedSpan(notes)
  if (span === null) return null
  const head = notes[span[0]].trim().match(REFINED_HEAD)[1] ?? ''
  const refined = {
    round: Number(head.match(/\bround\s+(\d+)/i)?.[1] ?? 1),
    by: head.match(/\bby\s+([^,;]+)/i)?.[1].trim() ?? null,
    at: head.match(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d/)?.[0] ?? null,
    accepted: head.match(/\baccepted\b\s*([^,;]*)/i)?.[1].trim() ?? null,
    // B285: "Refined (<date time>; ready):": the Advisor folded every answer in; the step is refined.
    ready: /(?:^|;)\s*ready\s*(?:;|$)/i.test(head),
    problem: '',
    goal: '',
    questions: [],
    feedback: [],
  }
  if (refined.accepted !== null && refined.accepted === '') refined.accepted = 'yes'
  let part = null
  for (const note of notes.slice(span[0] + 1, span[1])) {
    const line = note.trim()
    const named = line.match(NAMED)
    if (named !== null && REFINED_KEPT.has(named[1])) {
      part = null
      continue
    }
    if (named !== null && REFINED_PARTS[named[1]] !== undefined) {
      part = REFINED_PARTS[named[1]]
      if (named[2] !== '') addRefined(refined, part, named[2])
      continue
    }
    if (part !== null) addRefined(refined, part, line)
  }
  return refined
}

function addRefined(refined, part, line) {
  const point = line.match(/^[-*]\s+(.*)$/)
  const words = point === null ? line : point[1]
  if (part === 'problem' || part === 'goal') {
    refined[part] = refined[part] === '' ? words : `${refined[part]} ${words}`
    return
  }
  if (part === 'feedback') {
    refined.feedback.push(words)
    return
  }
  // "None: ready to pick up." says no question is left: it is none.
  if (/^None\b/i.test(words)) return
  // A question's answer stands behind " Answer: " on its own line.
  const at = words.search(/\sAnswer:\s/)
  refined.questions.push(at < 0 ? { text: words, answer: null } : { text: words.slice(0, at).trim(), answer: words.slice(at).replace(/^\s*Answer:\s*/, '').trim() })
}

/**
 * B285: whether a step is refined, so it may go into a queue: its block's head says "; ready" (what "refined" means,
 * approved by the person on 2026-10-17: the Advisor folded every answer into one compact description). A block
 * without it, also one in the older form with every question answered, is not refined; nor is a step without one.
 */
export function isRefined(refined) {
  return refined !== null && refined !== undefined && refined.ready === true
}

/**
 * B285, B286: where a step stands in its refine: `none` (no block), `asking` (the Advisor works on it: `refineAsk`
 * is open), `answers` (questions wait for the person's answers), `answered` (none open, or accepted, but not folded
 * in yet: the Advisor's next round makes it ready) or `ready` (its head says "; ready"). `step` holds `refined` and
 * `refineAsk`.
 */
export function refineStateOf(step) {
  if (step.refineAsk?.isOpen === true) return 'asking'
  const refined = step.refined ?? null
  if (refined === null) return 'none'
  if (refined.ready === true) return 'ready'
  return refined.accepted === null && refined.questions.some(question => question.answer === null) ? 'answers' : 'answered'
}

/**
 * B285: a short key of a refine block as it stands (its round, head, parts, questions with their answers, feedback),
 * null for none: an ask remembers the block it was made about, and a block that changed since answers it.
 */
export function refinedKey(refined) {
  if (refined === null || refined === undefined) return null
  let hash = 0x811c9dc5
  for (const char of JSON.stringify(refined)) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  return hash.toString(36)
}

/**
 * B285: when the block's head says it was written (its date and time, on this PC's clock), in ms; null when it does
 * not say.
 */
export function refinedAt(refined) {
  const at = refined?.at ?? null
  if (at === null) return null
  const ms = Date.parse(at.replace(' ', 'T'))
  return Number.isFinite(ms) ? ms : null
}

/** B233: a step's notes without its refine block, which the step's window shows apart. */
export function withoutRefined(notes) {
  const span = refinedSpan(notes)
  return span === null ? notes : [...notes.slice(0, span[0]), ...notes.slice(span[1])]
}
// refined:end

/** All the words of a step: its own line and the lines under it. A folder of pictures may be named in either. */
export function allWords(step) {
  return [step.text, ...step.notes.flatMap(part => [...part.lines, ...part.points])].join('\n')
}

/**
 * B172: a step held back by a mark in brackets: "(later; not handed out)", "(not queued: ...)", "(for Units; later)".
 * Words of the title ("Build B12 later") are no mark.
 */
export const isHeldBack = step => [...step.text.matchAll(/\(([^()]*)\)/g)]
  .flatMap(found => found[1].split(';').map(part => part.trim()))
  .some(part => /^(?:later|not handed out|not queued)\b/i.test(part))

/**
 * Whether an open step waits to be started (see `queue`): it names its worker ("(for Units; ...)"), it is not the
 * person's, it has no branch of its own, and nothing holds it back. Where it stands on the backlog does not matter:
 * under "Next to hand out" stand also steps the main chat has not handed out (B172).
 */
const isQueued = step => step.isFor && !step.isYou && step.ownBranch === null && !isHeldBack(step)

/**
 * The steps waiting to be started, in the backlog's order: anywhere on the backlog, the open ones whose note names a
 * worker ("(for Units; ...)") and that are not the person's. A step that names its own branch is in progress, not
 * queued; neither is one marked "later", "not handed out" or "not queued", nor one a worker is on right now
 * (`underWay`: ids of steps, see `overview`).
 */
export function queue(backlog, { underWay = new Set() } = {}) {
  return backlog.activities
    .flatMap(activity => open(activity).filter(isQueued))
    .filter(step => step.id === null || !underWay.has(step.id))
    .map(({ id, text, title, worker, branch, after, minutes, notes }) => ({ id, text, title, worker, branch, after, minutes, notes: noteSections(notes) }))
}

/**
 * Every open step only the person can do: what it asks of them (`verify`, `decide`, `provide`, `do`, or null when
 * the step does not say), and the worker it names, if any.
 */
export function forYou(backlog) {
  return stepsForYou(backlog, false)
}

/** The steps for the person that are ticked: closed, and shown only when the person asks for them. */
export function closedForYou(backlog) {
  return stepsForYou(backlog, true)
}

function stepsForYou(backlog, isDone) {
  return backlog.activities.flatMap(activity =>
    activity.steps.filter(step => step.isYou && step.isDone === isDone).map(({ id, text, title, asks, worker, branch, notes }) =>
      ({ id, text, title, asks, worker, branch, notes: noteSections(notes), activity: activity.name })))
}

/** The open steps of the person's main focus that a chat can do. */
export function openWork(backlog) {
  return backlog.activities.filter(activity => activity.isFocus).flatMap(activity =>
    open(activity).filter(step => !step.isYou).map(({ text, worker, branch }) => ({ text, activity: activity.name, worker, branch })))
}

/**
 * The whole backlog, for the Coordinate tab: every activity, the person's focus first, with each of its steps and
 * where the step stands (`status`): `done` (ticked), `you` (only the person can do it), `progress` (it names its own
 * branch, or a worker is on it right now), `queued` (it waits to be started, see `queue`), or `open` (none of
 * these). `key` names a step within the backlog: its id, or its place for a step from before the ids. `underWay`
 * holds the ids of the steps the workers say they are on, or were handed: a check or a merge has no branch to name.
 */
export function overview(backlog, { underWay = new Set() } = {}) {
  const listed = backlog.activities.map((activity, place) => {
    return {
      name: activity.name,
      isFocus: activity.isFocus,
      steps: activity.steps.map((step, index) => ({
        key: step.id ?? `${place}:${index}`,
        id: step.id,
        title: step.title,
        text: step.text,
        asks: step.asks,
        worker: step.worker,
        branch: step.ownBranch,
        minutes: step.minutes,
        after: step.after,
        notes: noteSections(withoutRefined(step.notes)),
        refined: refinedOf(step.notes),
        status: step.isDone ? 'done' : step.isYou ? 'you' : step.ownBranch !== null || (step.id !== null && underWay.has(step.id)) ? 'progress' : isQueued(step) ? 'queued' : 'open',
      })),
    }
  })
  return [...listed.filter(activity => activity.isFocus), ...listed.filter(activity => !activity.isFocus)]
}
