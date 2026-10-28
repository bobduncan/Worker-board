// The Design tab, as far as it is plain data: an idea the person typed becomes a picture (made by Codex, see
// codex.mjs), the person looks, asks for changes, agrees, and then asks the main chat for a step on the backlog or
// in a worker's queue. Here: the settings, the checks of what the page sends, the words Codex is given, the words
// the main chat is given, and the state the page draws from. Nothing here reads a chat or a transcript.

const refuse = (status, why) => ({ ok: false, status, why })

/** The folder under the project where an idea's pictures go, so a step can name it and the board can show them. */
/** B198: the Design tab's folder in the project's picture folder `pictures` (the first of the settings' pictureRoots). */
export const ideasFolder = pictures => `${pictures}/ideas`
/** Where a reference picture the person added waits until its idea is made. */
export const referencesFolder = pictures => `${ideasFolder(pictures)}/_references`
/** A reference picture as the upload named it: in the references folder of the picture folder `pictures`. */
export const isUploadedReference = (path, pictures) => typeof path === 'string' && typeof pictures === 'string'
  && path.startsWith(`${referencesFolder(pictures)}/`) && /^[a-f0-9]{16}\.(png|jpg|webp)$/.test(path.slice(referencesFolder(pictures).length + 1))

export const LIMITS = { idea: 1500, change: 600, title: 160, description: 1200, requirement: 200, requirements: 12, references: 3 }
/** A reference picture the person adds to an idea is at most this large. */
export const REFERENCE_BYTES = 8 * 1024 * 1024
const PICTURE = /\.(png|jpe?g|webp)$/i

const oneLine = (value, most) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, most)
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** A path inside the project, as the settings may name a reference picture: relative, no way out, a picture. */
function projectPath(value) {
  if (typeof value !== 'string') return null
  const path = value.replace(/\\/g, '/').trim()
  if (!PICTURE.test(path) || /[\0:*?"<>|]/.test(path) || path.startsWith('/')) return null
  return path.split('/').some(part => part === '' || part === '.' || part === '..') ? null : path
}

/**
 * The settings of the Design tab, from design.json next to the server: how long Codex may take, where it is when it
 * is not found by itself, and the kinds of idea. A kind decides how the words for Codex open and which reference
 * pictures go with them, so a picture matches the game's or the board's look. A broken file gives no kinds.
 */
export function parseDesignSettings(text) {
  let raw = {}
  try {
    const parsed = JSON.parse(text)
    if (isRecord(parsed)) raw = parsed
  } catch {
    // Not JSON: no kinds, and the tab says so.
  }
  const kinds = (Array.isArray(raw.kinds) ? raw.kinds : [])
    .filter(kind => isRecord(kind) && /^[a-z][a-z0-9-]{0,30}$/.test(kind.id) && oneLine(kind.name, 40) !== '' && oneLine(kind.opening, 2000) !== '')
    .slice(0, 8)
    .map(kind => ({
      id: kind.id,
      name: oneLine(kind.name, 40),
      opening: oneLine(kind.opening, 2000),
      references: (Array.isArray(kind.references) ? kind.references : []).map(projectPath).filter(path => path !== null).slice(0, 4),
    }))
  return {
    seconds: Number.isFinite(raw.seconds) && raw.seconds >= 30 && raw.seconds <= 900 ? Math.round(raw.seconds) : 240,
    codex: typeof raw.codex === 'string' ? raw.codex.trim() : '',
    kinds: kinds.filter((kind, index) => kinds.findIndex(other => other.id === kind.id) === index),
  }
}

/** A short name for an idea's folder, from its first words; `taken` are the names in use. */
export function shortName(text, taken = []) {
  const words = String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(word => word !== '')
  const base = words.slice(0, 4).join('-').slice(0, 32).replace(/-+$/, '') || 'idea'
  let name = base
  for (let n = 2; taken.includes(name); n += 1) name = `${base}-${n}`
  return name
}

/**
 * The words Codex is given for one version of an idea. The opening is the board's own, the kind's opening is from
 * the settings, the rest is what the person typed for this idea. For a change the last picture is attached first.
 */
export function promptFor({ opening, text, changes = [], change = null, isEdit = false, references = 0 }) {
  const lines = [
    'Use your built-in image generation tool to create the image described below, then save the generated PNG in the current working directory as picture.png. Do not write any code, and do not read, change or run anything else. If you do not have an image generation tool in this session, reply with exactly NO_IMAGE_TOOL.',
    '',
    opening,
    '',
    `The idea: ${text.trim()}`,
  ]
  if (changes.length > 0) lines.push('', 'Asked for in earlier versions, and still wanted:', ...changes.map(one => `- ${one.trim()}`))
  if (isEdit && change !== null) {
    lines.push('', `The first attached picture is the last version. Keep everything about it that is not named here, and change this: ${change.trim()}`)
  }
  if (references > 0) lines.push('', `The ${isEdit ? 'other ' : ''}attached picture${references === 1 ? ' is a reference' : 's are references'} for the look only: do not copy what ${references === 1 ? 'it shows' : 'they show'}.`)
  return `${lines.join('\n')}\n`
}

/** About how long, as the step's note says it: "45 min", "1 h", "1 h 30 min". */
function about(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours === 0 ? `${minutes} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/**
 * The words the main chat is given when the person puts an idea on the backlog or on the list for a worker. The first
 * line and the labels are the board's; every field is the person's own words, kept to one line each. The main chat
 * writes the step; the board writes nothing into the backlog. Redesign Part 2 (2026-10-25, Question 3): "Put on the
 * list" (`where: 'queue'`) is a step for the board's ready list: no worker is named (the board gives it to the first
 * free one once it is refined; the person pins it to one on the board).
 */
export function stepWord({ where, title, kind, description, requirements, folder, picture, minutes }) {
  const file = picture === null ? '' : ` (agreed: ${picture.split('/').pop()})`
  return [
    `${where === 'queue' ? 'list' : 'backlog'} step from the Design tab`,
    `Title: ${title}`,
    // What the idea is about, as the person chose it: the main chat files the step by it.
    kind === null ? null : `About: ${kind}`,
    description === '' ? null : `Description: ${description}`,
    requirements.length === 0 ? null : 'Requirements:',
    ...requirements.map(line => `- ${line}`),
    folder === null ? null : `Pictures: ${folder}${file}`,
    minutes === null ? null : `Time: about ${about(minutes)}`,
  ].filter(line => line !== null).join('\n')
}

/**
 * B754 (the person, 2026-10-28: phase out the main chat; "verify that a) it becomes more reliable or equal"): the board
 * writes the step itself, with the lines Main wrote from the word above: what it is about, the description, the
 * requirements, the pictures and the time, each the person's own words, and where it came from.
 */
export function stepLines(send) {
  return stepWord(send).split('\n').slice(1).filter(line => !line.startsWith('Title: ')).concat('From the Design tab.')
}

/**
 * B754: the activity of a step from the Design tab: the one whose name begins with the idea's kind ("screen" for
 * "Screens and content"), else `usual` (the activity most of the latest steps with pictures went to, `picturesActivity`),
 * else the first; null with none.
 */
export function designActivity(kind, activities, usual = null) {
  const names = (activities ?? []).map(one => one.name).filter(name => typeof name === 'string' && name !== '')
  const word = String(kind ?? '').trim().toLowerCase()
  const first = name => name.toLowerCase().split(/[^a-z0-9]+/).find(part => part !== '') ?? ''
  const byKind = word === '' ? undefined : names.find(name => first(name) === word || first(name) === `${word}s`)
  const byUsual = typeof usual === 'string' ? names.find(name => name.toLowerCase() === usual.trim().toLowerCase()) : undefined
  return byKind ?? byUsual ?? names[0] ?? null
}

/** B754: the activity most of the latest `last` steps that name pictures ("Pictures: ...") went to, else null. */
export function picturesActivity(items, last = 20) {
  const steps = [...(items?.values?.() ?? [])].filter(item => item.head.get('Kind') === 'step'
    && [...item.sections.values()].some(lines => (lines ?? []).some(line => /^\s*(?:-\s*)?Pictures: /.test(line))))
  const counts = new Map()
  for (const item of steps.slice(-last)) {
    const activity = item.head.get('Activity')
    if (activity) counts.set(activity, (counts.get(activity) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

const lastDone = idea => idea.versions.findLast(version => version.state === 'done') ?? null
const isMaking = idea => idea.versions.at(-1)?.state === 'making'
/** Handed to the main chat, and the word is on its way or has arrived. One that did not arrive leaves the idea free. */
const isHanded = idea => idea.sent !== null && idea.sent.state !== 'expired' && idea.sent.state !== 'failed'

/**
 * Works calls off one after the other: the next one starts when the one before has ended, well or not. So what a
 * call checks ("no picture is being made") still holds when it acts on it.
 */
export function inTurn() {
  let last = Promise.resolve()
  return work => {
    const run = last.then(work, work)
    last = run.catch(() => {})
    return run
  }
}

/**
 * Checks what the page sends for the Design tab. `design` holds the ideas, the kinds, whether a picture can be
 * made now (`canMake`, `why`, `busy`) and whether this board can ask the main chat (`canSend`, `main`, `workers`).
 * Answers `{ ok: true, action, ... }` with the parts to act on, or `{ ok: false, status, why }`.
 */
export function checkDesign(body, design) {
  if (!isRecord(body)) return refuse(400, 'Not a request.')
  const { ideas = [], kinds = [] } = design
  const idea = ideas.find(one => one.id === body.idea && one.droppedAt === null) ?? null
  const mayMake = () => (design.canMake !== true ? refuse(409, design.why ?? 'No picture can be made here.')
    : (design.busy ?? null) !== null ? refuse(409, 'A picture is being made: one at a time.') : null)

  if (body.action === 'make') {
    const kind = kinds.find(one => one.id === body.kind)
    if (kind === undefined) return refuse(400, 'Say what the idea is about.')
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (text === '') return refuse(400, 'Type the idea.')
    if (text.length > LIMITS.idea) return refuse(413, `At most ${LIMITS.idea} characters.`)
    const references = body.references === undefined ? [] : body.references
    if (!Array.isArray(references) || references.length > LIMITS.references || !references.every(path => isUploadedReference(path, design.pictures))) {
      return refuse(400, `At most ${LIMITS.references} reference pictures, added on this page.`)
    }
    // The same picture twice is one reference.
    return mayMake() ?? { ok: true, action: 'make', kind: kind.id, text, references: [...new Set(references)] }
  }
  // B368: a step may be asked without an idea, and so without a picture.
  const isBare = body.action === 'send' && (body.idea === undefined || body.idea === null)
  if (idea === null && !isBare) return refuse(409, 'That idea is not there any more.')

  if (body.action === 'again') {
    if (isHanded(idea)) return refuse(409, 'This idea was handed to the main chat: start a new idea to change it.')
    const done = idea.versions.filter(version => version.state === 'done')
    const from = body.from === undefined || body.from === null ? done.at(-1) ?? null : done.find(version => version.n === body.from) ?? undefined
    if (from === undefined) return refuse(400, 'That version has no picture to change.')
    const change = typeof body.change === 'string' ? body.change.trim() : ''
    // With no picture yet there is nothing to change: the idea is simply tried again.
    if (from !== null && change === '') return refuse(400, 'Say what should change.')
    if (change.length > LIMITS.change) return refuse(413, `At most ${LIMITS.change} characters.`)
    return mayMake() ?? { ok: true, action: 'again', idea: idea.id, from: from?.n ?? null, change: from === null ? null : change }
  }
  if (body.action === 'agree') {
    if (isHanded(idea)) return refuse(409, 'This idea was handed to the main chat already.')
    if (body.version === null) return { ok: true, action: 'agree', idea: idea.id, version: null }
    const version = idea.versions.find(one => one.n === body.version && one.state === 'done')
    return version === undefined ? refuse(400, 'That version has no picture.') : { ok: true, action: 'agree', idea: idea.id, version: version.n }
  }
  if (body.action === 'drop') {
    return isMaking(idea) ? refuse(409, 'Its picture is being made: wait for it.') : { ok: true, action: 'drop', idea: idea.id }
  }
  if (body.action === 'send') {
    // B754: the board writes the step itself: no main chat is needed.
    if (design.canSend !== true) return refuse(409, design.whyNot ?? 'This board cannot write a step.')
    // B379: an idea is as it was: its step names its agreed picture, which links the idea to the step it became.
    if (idea !== null && idea.agreed === null) return refuse(409, 'Agree to a picture first, or choose New idea for a step without one.')
    if (idea !== null && isHanded(idea)) return refuse(409, 'This idea is a step already.')
    if (body.where !== 'backlog' && body.where !== 'queue') return refuse(400, 'On the backlog, or on the list.')
    const title = oneLine(body.title, LIMITS.title + 1)
    if (title === '') return refuse(400, 'Give it a title.')
    if (title.length > LIMITS.title) return refuse(413, `A title of at most ${LIMITS.title} characters.`)
    const description = oneLine(body.description, LIMITS.description + 1)
    if (description.length > LIMITS.description) return refuse(413, `A description of at most ${LIMITS.description} characters.`)
    const lines = body.requirements === undefined ? [] : body.requirements
    if (!Array.isArray(lines) || lines.length > LIMITS.requirements || !lines.every(line => typeof line === 'string')) return refuse(400, `At most ${LIMITS.requirements} requirements.`)
    const requirements = lines.map(line => oneLine(line, LIMITS.requirement + 1)).filter(line => line !== '')
    if (requirements.some(line => line.length > LIMITS.requirement)) return refuse(413, `A requirement of at most ${LIMITS.requirement} characters.`)
    const minutes = body.minutes === undefined || body.minutes === null || body.minutes === '' ? null : Number(body.minutes)
    if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440)) return refuse(400, 'The time in whole minutes.')
    // B368: only an agreed picture is named; without one the step carries no pictures line.
    const agreed = idea === null || idea.agreed === null ? null : idea.versions.find(version => version.n === idea.agreed) ?? null
    const send = { where: body.where, title, description, requirements, minutes }
    const kind = idea === null ? null : (kinds.find(one => one.id === idea.kind)?.name ?? idea.kind).toLowerCase()
    const text = stepWord({ ...send, kind, folder: agreed === null ? null : idea.folder, picture: agreed?.picture ?? null })
    // It is typed into a chat, and a chat is typed at most so much at once: nothing is cut off silently.
    const most = design.maxChars ?? 2500
    if (text.length > most) return refuse(413, `Together that is ${text.length} characters; a step is asked in at most ${most}. Shorten the description or the requirements.`)
    return { ok: true, action: 'send', idea: idea?.id ?? null, ...send, kind, text, lines: stepLines({ ...send, kind, folder: agreed === null ? null : idea.folder, picture: agreed?.picture ?? null }) }
  }
  return refuse(400, 'No such action.')
}

/** The step on the backlog that names an idea's folder, as the main chat wrote it; null while there is none. */
function stepFor(backlog, folder) {
  for (const activity of Array.isArray(backlog) ? backlog : []) {
    for (const step of activity.steps ?? []) {
      const notes = (step.notes ?? []).flatMap(section => [...(section.lines ?? []), ...(section.points ?? [])])
      // The folder's own name, not one that only begins with it ("shop" in "shop-screen").
      const names = words => new RegExp(`${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(String(words ?? ''))
      if (names(step.text) || notes.some(names)) return { id: step.id ?? null, worker: step.worker ?? null, isDone: step.status === 'done' }
    }
  }
  return null
}

/**
 * What the page draws the Design tab from. `outbox` is everything that was sent (the word to the main chat is
 * found in it by its id), `backlog` the board's overview of the backlog, `missing` the reference pictures of the
 * settings that are not there.
 */
export function designState({ ideas, settings, canMake, why, busy, canSend = false, whyNot = null, outbox = [], backlog = [], missing = [], typical = 60 }) {
  return {
    canMake,
    why: canMake ? null : why,
    // Whether this board can ask the main chat for the step: a copy and the demo cannot, and the page says so.
    canSend,
    whyNot: canSend ? null : whyNot,
    busy,
    seconds: typical,
    // Every limit the checks hold, for the page to show. `text` is the idea's, under the name the page asks for.
    limits: { ...LIMITS, text: LIMITS.idea, referenceBytes: REFERENCE_BYTES },
    kinds: settings.kinds.map(({ id, name, references }) => ({ id, name, missing: references.filter(path => missing.includes(path)) })),
    ideas: ideas.filter(idea => idea.droppedAt === null).sort((a, b) => b.createdAt - a.createdAt).map(idea => {
      const word = idea.sent === null ? null : outbox.find(message => message.id === idea.sent.message) ?? null
      const step = idea.sent === null ? null : stepFor(backlog, idea.folder)
      const sent = idea.sent === null ? null : {
        at: idea.sent.at, where: idea.sent.where, worker: idea.sent.worker ?? null, title: idea.sent.title,
        // Not in the outbox any more: it was typed long ago.
        state: word?.state ?? 'delivered',
        step,
      }
      const last = idea.versions.at(-1)
      const status = last?.state === 'making' ? 'making'
        : sent !== null && step !== null ? (step.worker !== null ? 'queued' : 'backlog')
          : sent !== null && sent.state !== 'expired' && sent.state !== 'failed' ? 'asked'
            : idea.agreed !== null ? 'agreed'
              : last?.state === 'failed' ? 'failed' : 'look'
      const { id, name, kind, text, createdAt, folder, references, versions, agreed } = idea
      return { id, name, kind, text, createdAt, folder, references, versions, agreed, sent, status }
    }),
  }
}

export { lastDone }
