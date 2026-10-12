// Source 4: the backlog, `<project>\.claude\backlog.md`. A `## ` heading is an activity ("#focus" marks the
// person's main focus), a `- [ ]` line is a step, `@you` at its end marks a step only the person can do, and an
// indented line under a step belongs to that step.

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

function minutesOf(part) {
  const found = part.match(/^about\s+(\d+(?:\.\d+)?)\s*(min|minutes?|h|hours?)\b/i)
  if (found === null) return null
  return Math.round(Number(found[1]) * (found[2].toLowerCase().startsWith('h') ? 60 : 1))
}

function parseStep(isDone, rest, { prefix, names }) {
  const isYou = /(^|\s)@you\s*$/.test(rest)
  const text = rest.replace(/(^|\s)@you\s*$/, '').trim()

  // The note the main chat writes on a queued step: "(for Units; after <condition>; about 40 min)".
  const spec = text.match(/\s*\((for [^()]*)\)\s*$/)
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

  return {
    text,
    title: spec === null ? text : text.slice(0, spec.index).trim(),
    isDone,
    isYou,
    notes: [],
    worker: workerOf(text, forWhom, prefix, names),
    branch: text.match(/\bbranch\s+([\w./-]+)/)?.[1] ?? null,
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

/** The steps waiting to be handed out: the open ones under "Next to hand out". */
export function queue(backlog) {
  return backlog.activities
    .filter(activity => activity.name.toLowerCase().startsWith(QUEUE_HEADING))
    .flatMap(open)
    .map(({ text, title, worker, branch, after, minutes }) => ({ text, title, worker, branch, after, minutes }))
}

/** Every open step only the person can do. */
export function forYou(backlog) {
  return backlog.activities.flatMap(activity =>
    open(activity).filter(step => step.isYou).map(step => ({ text: step.text, activity: activity.name })))
}

/** The open steps of the person's main focus that a chat can do. */
export function openWork(backlog) {
  return backlog.activities.filter(activity => activity.isFocus).flatMap(activity =>
    open(activity).filter(step => !step.isYou).map(({ text, worker, branch }) => ({ text, activity: activity.name, worker, branch })))
}
