// Source 4: the backlog, `<project>\.claude\backlog.md`. A `## ` heading is an activity ("#focus" marks the
// person's main focus), a `- [ ]` line is a step, `@you` at its end marks a step only the person can do, and an
// indented line under a step belongs to that step. An open step starts with its id, "B14".

const QUEUE_HEADING = 'next to hand out'

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
function minutesOf(part) {
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

function parseStep(isDone, rest, { prefix, names }) {
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

/** All the words of a step: its own line and the lines under it. A folder of pictures may be named in either. */
export function allWords(step) {
  return [step.text, ...step.notes.flatMap(part => [...part.lines, ...part.points])].join('\n')
}

/** Whether an open step of this activity waits to be started (see `queue`). */
function isQueuedIn(activity) {
  const isQueue = activity.name.toLowerCase().startsWith(QUEUE_HEADING)
  return step => step.ownBranch === null && !/\(not queued/i.test(step.text) && (isQueue || (step.isFor && !step.isYou))
}

/**
 * The steps waiting to be started, in the backlog's order: the open ones under "Next to hand out", and anywhere
 * on the backlog the open ones whose note names a worker ("(for Units; ...)") and that are not the person's. A
 * step that names its own branch is in progress, not queued; neither is one the main chat marked "(not queued: ...)",
 * nor one a worker is on right now (`underWay`: ids of steps, see `overview`).
 */
export function queue(backlog, { underWay = new Set() } = {}) {
  return backlog.activities
    .flatMap(activity => open(activity).filter(isQueuedIn(activity)))
    .filter(step => step.id === null || !underWay.has(step.id))
    .map(({ id, text, title, worker, branch, after, minutes, notes }) => ({ id, text, title, worker, branch, after, minutes, notes: noteSections(notes) }))
}

/** The steps being worked on: the open ones that name their own branch, with the worker and the time their note gives. */
export function inProgress(backlog) {
  return backlog.activities.flatMap(activity =>
    open(activity).filter(step => step.ownBranch !== null && !step.isYou)
      .map(({ id, text, title, worker, ownBranch, minutes }) => ({ id, text, title, worker, branch: ownBranch, minutes, activity: activity.name })))
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
    const isQueued = isQueuedIn(activity)
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
        notes: noteSections(step.notes),
        status: step.isDone ? 'done' : step.isYou ? 'you' : step.ownBranch !== null || (step.id !== null && underWay.has(step.id)) ? 'progress' : isQueued(step) ? 'queued' : 'open',
      })),
    }
  })
  return [...listed.filter(activity => activity.isFocus), ...listed.filter(activity => !activity.isFocus)]
}
