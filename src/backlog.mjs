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

/**
 * B292: the notes in brackets at the end of a step's words, peeled off from the last: the main chat's "(for <chat>;
 * after B12; about 1 h)", "(later; not handed out)", "(not handed out; after today; ...)", a chat's name, where its
 * pictures are. A note may hold brackets of its own, one level deep
 * ("after the archer (branch x) merges"). `rest` is what stands before them; words that are nothing but brackets keep
 * them, as there is no other title.
 */
/** B292: a title without the notes in brackets at its end, as `parseStep` reads a step's (a title the store migrated). */
export function withoutNotes(title) {
  return closingNotes(String(title ?? '')).rest.trim()
}

function closingNotes(body) {
  const notes = []
  let rest = body
  for (;;) {
    const found = rest.match(/\s*\(((?:[^()]|\([^()]*\))*)\)\s*$/)
    if (found === null || rest.slice(0, found.index).trim() === '') break
    notes.unshift(found[1])
    rest = rest.slice(0, found.index)
  }
  return { rest, notes }
}

export function parseStep(isDone, rest, { prefix, names }) {
  const isYou = /(^|\s)@you\s*$/.test(rest)
  // A step starts with its id ("B14"): the person names a step by it, and it never changes.
  const lead = rest.match(/^(B\d+)\s+/)
  const text = rest.slice(lead === null ? 0 : lead[0].length).replace(/(^|\s)@you\s*$/, '').trim()

  // A step in progress names its branch at its very end, after the note of who it is for: "(branch feature/x)".
  const own = text.match(/\s*\(branch\s+([\w./-]+)\)\s*$/)
  const body = own === null ? text : text.slice(0, own.index)
  // The notes at its end (closingNotes): the main chat's on a queued step says who it is for, after what and how long
  // ("(for Units; after <condition>; about 40 min)"); B292: whatever a note starts with, it is no part of the title,
  // and its parts are read from every note, the first of each kind counting.
  const { rest: titled, notes } = closingNotes(body)
  let forWhom = null
  let after = null
  let minutes = null
  // Only the last note names who a step is for: the main chat's queue note, which the store writes last too. Its
  // parts come first; an earlier note (one a migrated title kept) only adds what the last one does not say.
  const last = notes.length === 0 ? [] : [notes[notes.length - 1]]
  const read = (note, mayName) => {
    for (const part of note.split(';').map(piece => piece.trim())) {
      if (/^for\s+/i.test(part)) {
        if (mayName) forWhom ??= part.replace(/^for\s+/i, '').trim()
      } else if (/^after\s+/i.test(part)) after ??= part.replace(/^after\s+/i, '').trim()
      else minutes ??= minutesOf(part)
    }
  }
  for (const note of last) read(note, true)
  for (const note of notes.slice(0, -1)) read(note, false)

  // After its id, a step for the person says what it asks of them: "Verify:", "Decide:", "Provide:" or "Do:".
  const asks = text.match(/^(Verify|Decide|Provide|Do):\s*/i)

  return {
    id: lead === null ? null : lead[1],
    text,
    title: titled.slice(asks === null ? 0 : asks[0].length).trim(),
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
 *
 * B293, what "refined" means (the person's yes of 2026-10-17): "Summary:", "Picture:" (a path and in brackets what
 * it shows, or "none (why)"), "Part of:" (its goal), "Size:", and questions of one line with " Advised: yes|no, why"
 * behind them. Once every answer is folded in, the head reads "Refined (<date time>; ready):" and the block holds
 * "What we build:" (points, "Not in it: ..." among them) in place of the questions. Problem and Goal still read.
 */
export const REFINED_HEAD = /^Refined\s*(?:\(([^)]*)\))?\s*:\s*$/
const REFINED_PARTS = {
  Problem: 'problem', Goal: 'goal', Questions: 'questions', Feedback: 'feedback',
  Summary: 'summary', Picture: 'picture', 'Part of': 'partOf', Size: 'size', 'What we build': 'build', 'Not in it': 'not',
}
const NAMED = /^([A-Z][A-Za-z /]{1,28}):\s*(.*)$/
/**
 * B293: the lines the board itself writes under a step (asks made and answered, a report, a drop, the person's
 * close or approval). Written after a refine block, as the work store did before B293, they end it.
 */
const BOARD_LINE = /^(?:Asked Q\d+ \(|Q\d+ (?:answered|withdrawn)\b|(?:Reported|Dropped|Closed|Approved|Done|Answered) by\b)/

/** Where the refine block stands in a step's notes: `[start, end)` as indexes of `notes`, or null when it has none. */
export function refinedSpan(notes) {
  const start = notes.findIndex(note => REFINED_HEAD.test(note.trim()))
  if (start < 0) return null
  let end = start + 1
  // B293: what the picture shows may stand in brackets on the line after its path, followed by more of the block:
  // that line is no closing note.
  let part = null
  let hasCaption = false
  while (end < notes.length) {
    const line = notes[end].trim()
    const named = line.match(NAMED)
    const after = notes[end + 1]?.trim().match(NAMED) ?? null
    const isCaption = part === 'picture' && !hasCaption && line.startsWith('(') && after !== null && REFINED_PARTS[after[1]] !== undefined
    if (!isCaption && ((named !== null && REFINED_PARTS[named[1]] === undefined) || line.startsWith('(') || REFINED_HEAD.test(line) || BOARD_LINE.test(line))) break
    if (named !== null && REFINED_PARTS[named[1]] !== undefined) {
      part = REFINED_PARTS[named[1]]
      hasCaption = named[2].includes('(')
    } else if (part === 'picture') hasCaption = hasCaption || line.includes('(')
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
    // B293: written once every answer is folded in.
    ready: head.split(/[;,]/).some(part => part.trim().toLowerCase() === 'ready'),
    summary: '',
    picture: null,
    pictureNote: '',
    partOf: '',
    size: '',
    problem: '',
    goal: '',
    build: [],
    questions: [],
    feedback: [],
  }
  if (refined.accepted !== null && refined.accepted === '') refined.accepted = 'yes'
  // The picture's line is read whole once the block is read: it may go on over a second line.
  let picture = ''
  let part = null
  for (const note of notes.slice(span[0] + 1, span[1])) {
    const line = note.trim()
    const named = line.match(NAMED)
    if (named !== null && REFINED_PARTS[named[1]] !== undefined) {
      part = REFINED_PARTS[named[1]]
      // "Not in it: ..." written as a line of its own is one more point of what we build; alone, the points under it are.
      if (part === 'not') {
        if (named[2] !== '') refined.build.push(line)
        part = named[2] === '' ? 'not' : 'build'
      } else if (part === 'picture') picture = joined(picture, named[2])
      else if (named[2] !== '') addRefined(refined, part, named[2], false)
      continue
    }
    if (part === 'picture') picture = joined(picture, line)
    else if (part !== null) addRefined(refined, part, line, true)
  }
  if (picture !== '') Object.assign(refined, pictureOf(picture))
  return refined
}

const joined = (before, words) => (before === '' ? words : words === '' ? before : `${before} ${words}`)

/**
 * B293: a refine block's picture line: `{ picture: { path, caption } }` for a picture file with what it shows in
 * brackets, or `{ picture: null, pictureNote }` with why there is none ("none (a rule only; nothing to see)").
 */
function pictureOf(written) {
  // A path written as code (`pictures/a.png`) is the same path.
  const words = written.replace(/`([^`]*)`/g, '$1')
  const file = words.match(/^(\S+\.(?:png|jpe?g|gif|webp))(?=\s|$)\s*(.*)$/i)
  const inBrackets = text => text.replace(/^\((.*)\)\.?$/, '$1').trim()
  if (file !== null) return { picture: { path: file[1], caption: inBrackets(file[2].trim()) }, pictureNote: '' }
  return { picture: null, pictureNote: inBrackets(words.replace(/^none\b[\s:,;.-]*/i, '').trim()) }
}

/** `isMore`: a line under the part's name, which goes on with the part's last words when it is no point of its own. */
function addRefined(refined, part, line, isMore) {
  const point = line.match(/^[-*]\s+(.*)$/)
  const words = point === null ? line : point[1]
  if (part === 'problem' || part === 'goal' || part === 'summary' || part === 'partOf' || part === 'size') {
    refined[part] = joined(refined[part], words)
    return
  }
  if (part === 'build') {
    if (point === null && isMore && refined.build.length > 0) refined.build[refined.build.length - 1] = joined(refined.build.at(-1), words)
    else refined.build.push(words)
    return
  }
  if (part === 'not') {
    if (point === null && isMore && /^Not in it\b/i.test(refined.build.at(-1) ?? '')) refined.build[refined.build.length - 1] = joined(refined.build.at(-1), words)
    else refined.build.push(`Not in it: ${words}`)
    return
  }
  if (part === 'feedback') {
    refined.feedback.push(words)
    return
  }
  // "None: ready to pick up." says no question is left: it is none.
  if (/^None\b/i.test(words)) return
  // A question's answer stands behind " Answer: " on its own line; B293: the advice, " Advised: yes|no, why", before it.
  const at = words.search(/\sAnswer:\s/)
  const asked = at < 0 ? words : words.slice(0, at).trim()
  const answer = at < 0 ? null : words.slice(at).replace(/^\s*Answer:\s*/, '').trim()
  const advised = asked.match(/^(.*?)\s+Advised:\s*(yes|no)\b[\s,;:.\-–—]*(.*)$/i)
  refined.questions.push(advised === null
    ? { text: asked, answer, advice: null, why: '' }
    : { text: advised[1].trim(), answer, advice: advised[2].toLowerCase(), why: advised[3].trim() })
}

/**
 * B285: whether a step is refined, so it may go into a queue: its block's head says "; ready" (what "refined" means,
 * approved by the person on 2026-10-17: the Advisor folded every answer into one compact description). A block
 * without it, also one in the older form with every question answered, is not refined; nor is a step without one.
 */
export function isRefined(refined) {
  // B309: an ask under the step that is open, or answered since the block was written, holds it back too.
  return refined !== null && refined !== undefined && refined.ready === true && (refined.asks ?? []).length === 0
}

/**
 * B309: a refine block with the asks under its step that count as its questions now (`stepAsks`, work/stepAsks.mjs)
 * as `asks: [{ id, title, answer }]`; the block as it is when there are none, so its key stays.
 */
export function withAsks(refined, stepAsks) {
  return refined === null || !Array.isArray(stepAsks) || stepAsks.length === 0 ? refined : { ...refined, asks: stepAsks }
}

/**
 * B285, B286: where a step stands in its refine: `none` (no block), `asking` (the Advisor works on it: `refineAsk`
 * is open), `answers` (questions wait for the person's answers), `answered` (none open, or accepted, but not folded
 * in yet: the Advisor's next round makes it ready) or `ready` (its head says "; ready"). `step` holds `refined` and
 * `refineAsk`. B309: the asks under the step count as questions (`refined.asks`, `withAsks`): one open waits for
 * the person, also on a ready block (accepting the refine does not answer it); one answered since the block was
 * written waits for the next round.
 */
export function refineStateOf(step) {
  if (step.refineAsk?.isOpen === true) return 'asking'
  const refined = step.refined ?? null
  if (refined === null) return 'none'
  const asks = refined.asks ?? []
  if (asks.some(ask => ask.answer === null)) return 'answers'
  if (refined.ready === true) return asks.length === 0 ? 'ready' : 'answered'
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
    // Fix first: a board fix stands before the other steps of its worker's queue (the work store marks it).
    .sort((a, b) => Number(b.isFix === true) - Number(a.isFix === true))
    // B293: its refine block apart, as on the Backlog tab, so its window draws it the same way.
    .map(({ id, text, title, worker, branch, after, minutes, notes, stepAsks, isFix }) => ({ id, text, title, worker, branch, after, minutes, notes: noteSections(withoutRefined(notes)), refined: withAsks(refinedOf(notes), stepAsks), ...(isFix === true ? { isFix: true } : {}) }))
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
        // B309: with the asks under it that count as its questions.
        refined: withAsks(refinedOf(step.notes), step.stepAsks),
        // Fix first: a board fix, shown with its chip and first in its group.
        ...(step.isFix === true ? { isFix: true } : {}),
        status: step.isDone ? 'done' : step.isYou ? 'you' : step.ownBranch !== null || (step.id !== null && underWay.has(step.id)) ? 'progress' : isQueued(step) ? 'queued' : 'open',
      })),
    }
  })
  return [...listed.filter(activity => activity.isFocus), ...listed.filter(activity => !activity.isFocus)]
}
