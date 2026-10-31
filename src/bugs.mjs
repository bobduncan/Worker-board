// The Bugs tab (B856), as far as it is plain data: the person pastes or drops a screenshot, says what is wrong (and what
// they expected), says where (the game or the board), and the board files a step in the person's own words with the
// pictures. Here: the checks of what the page sends, the words of the step, where it is filed, and the list of the
// person's reports with their state. Nothing here reads a chat, a file or the store itself.

import { dirname } from 'node:path'

import { STEP_ID_TOKEN } from './work/api.mjs'

const refuse = (status, why) => ({ ok: false, status, why })

/** What a report may hold: the two lines (characters) and the pictures. */
export const BUG_LIMITS = { wrong: 300, expected: 300, pictures: 5 }
/** The last line of a step the Bugs tab filed: how the list below the form finds the person's reports again. */
export const BUG_MARK = 'From the Bugs tab.'

/** The folder of the Bugs tab in the project's picture folder `pictures`: each report's pictures go in a folder of the step's id. */
export const bugsFolder = pictures => `${pictures}/bugs`
/** Where a picture waits from its upload until its report is filed. */
export const waitingFolder = pictures => `${bugsFolder(pictures)}/_new`
/** A picture as the upload named it: in the waiting folder of the picture folder `pictures`. */
export const isWaitingPicture = (path, pictures) => typeof path === 'string' && typeof pictures === 'string'
  && path.startsWith(`${waitingFolder(pictures)}/`) && /^[a-f0-9]{16}\.(png|jpg|webp)$/.test(path.slice(waitingFolder(pictures).length + 1))

const oneLine = (value, most) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, most)

/** The step's title from what is wrong: "Bug: ...", cut at a word, with nothing the work store would not read back as written. */
export function bugTitle(wrong) {
  const words = oneLine(wrong, 400).replace(/@you\b/gi, 'you').replace(/(?:\s*[([][^)\]]*[)\]])+\s*$/, '').trim()
  const cut = words.length <= 110 ? words : `${words.slice(0, 110).replace(/\s+\S*$/, '')}…`
  return `Bug: ${cut}`
}

/**
 * Checks what the page sends: `{ action: 'report', wrong, expected, where: 'game' | 'board', pictures: [path] }` with the
 * paths the upload answered. `ctx` says whether the board can write (`canSend`, else `whyNot`) and the picture folder
 * (`pictures`). Answers the report as the board files it, or why not.
 */
export function checkBug(body, ctx) {
  if (body === null || typeof body !== 'object' || Array.isArray(body) || body.action !== 'report') return refuse(400, 'Not a report of a bug.')
  if (ctx.canSend !== true) return refuse(409, ctx.whyNot ?? 'This board cannot file the report.')
  const wrong = oneLine(body.wrong, BUG_LIMITS.wrong + 1)
  if (wrong === '') return refuse(400, 'Say what is wrong, in one line.')
  if (wrong.length > BUG_LIMITS.wrong) return refuse(400, `What is wrong is one line of ${BUG_LIMITS.wrong} characters at most.`)
  const expected = oneLine(body.expected, BUG_LIMITS.expected + 1)
  if (expected.length > BUG_LIMITS.expected) return refuse(400, `What you expected is one line of ${BUG_LIMITS.expected} characters at most.`)
  if (body.where !== 'game' && body.where !== 'board') return refuse(400, 'Say where it is wrong: the game or the board.')
  const pictures = body.pictures === undefined ? [] : body.pictures
  if (!Array.isArray(pictures) || !pictures.every(path => typeof path === 'string')) return refuse(400, 'The pictures are a list of the uploaded ones.')
  if (pictures.length > BUG_LIMITS.pictures) return refuse(400, `At most ${BUG_LIMITS.pictures} pictures.`)
  if (new Set(pictures).size !== pictures.length) return refuse(400, 'A picture is named once.')
  if (!pictures.every(path => isWaitingPicture(path, ctx.pictures))) return refuse(400, 'A picture was not added here: add it again.')
  // Where each goes once the step has its id: plain names in order, the file's kind kept.
  const targets = pictures.map((path, place) => `${bugsFolder(ctx.pictures)}/${STEP_ID_TOKEN}/picture-${place + 1}.${path.split('.').pop()}`)
  const where = body.where
  const lines = [
    "The person's bug report, in their own words.",
    `What is wrong: ${wrong}`,
    ...(expected === '' ? [] : [`What was expected: ${expected}`]),
    `Where: ${where === 'board' ? 'the worker board' : `the game${ctx.game ? ` (${ctx.game})` : ''}`}`,
    ...(targets.length === 0 ? ['Pictures: none'] : [`Pictures: ${targets.join(', ')}`]),
    'Reproduce it first, before any change: see it happen as the person did, then fix it.',
    BUG_MARK,
  ]
  return { ok: true, where, title: bugTitle(wrong), lines, picture: targets[0] ?? null, from: pictures, targets, isFix: where === 'board' }
}

/** The activity (and goal) most of the latest `last` steps that pass `keep` went to, else null. */
function usualPlace(items, keep, last = 20) {
  const steps = [...(items?.values?.() ?? [])].filter(item => item.head.get('Kind') === 'step' && keep(item)).slice(-last)
  const tally = key => {
    const counts = new Map()
    for (const item of steps) {
      const value = item.head.get(key)
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }
  return { activity: tally('Activity'), goal: tally('Goal') }
}

/**
 * Where a report is filed: a board bug where the board's fixes go (the activity and goal most of the latest steps marked
 * a fix went to), a game bug in the activity most of the other latest steps went to, with no goal. `activities` are the
 * store's activities (names); the first when nothing says better.
 */
export function bugPlace(where, items, activities) {
  const names = (activities ?? []).map(one => one.name).filter(name => typeof name === 'string' && name !== '')
  const isFix = item => item.head.get('Priority') === 'fix'
  const boards = usualPlace(items, isFix)
  const fallback = names[0] ?? null
  if (where === 'board') return { activity: names.find(name => name === boards.activity) ?? fallback, goal: boards.goal }
  const others = usualPlace(items, item => !isFix(item) && item.head.get('Activity') !== boards.activity)
  return { activity: names.find(name => name === others.activity) ?? fallback, goal: null }
}

/** What a step's State means to the person who reported it. */
const WAITING = ['new', 'refined', 'queued']
const FIXING = ['taken', 'in progress', 'waiting on you', 'review']
export function bugStateOf(state) {
  if (state === 'done') return 'fixed'
  if (state === 'dropped') return 'dropped'
  if (FIXING.includes(state)) return 'fixing'
  return 'waiting'
}

/** The person's reports so far, newest first: the steps the Bugs tab filed (its last Context line), `last` of them. */
export function bugsList(items, last = 30) {
  const idNumber = id => Number(String(id).replace(/\D/g, '')) || 0
  const reports = []
  for (const item of items?.values?.() ?? []) {
    if (item.head.get('Kind') !== 'step') continue
    const context = (item.sections.get('Context') ?? []).map(line => line.trim())
    if (!context.includes(BUG_MARK)) continue
    const find = label => context.find(line => line.startsWith(`${label}: `))?.slice(label.length + 2) ?? ''
    const pictures = find('Pictures').split(',').map(path => path.trim()).filter(path => /\.(png|jpe?g|webp)$/i.test(path))
    const picture = (item.sections.get('Picture') ?? []).map(line => line.trim()).find(line => /\.(png|jpe?g|webp)(\s|$)/i.test(line))?.split(/\s/)[0] ?? pictures[0] ?? null
    reports.push({
      id: item.head.get('Id'), wrong: find('What is wrong'), expected: find('What was expected'),
      where: find('Where').startsWith('the worker board') ? 'board' : 'game',
      state: bugStateOf(item.head.get('State')), picture, pictures: pictures.length === 0 && picture !== null ? [picture] : pictures,
    })
  }
  return reports.sort((a, b) => idNumber(b.id) - idNumber(a.id)).slice(0, last)
}

/** What the page draws from: the limits, whether a report can be filed, the names of the two places, and the list. */
export function bugsState({ items, canSend, whyNot, game, boardName = 'Worker board' }) {
  return {
    canSend: canSend === true,
    why: canSend === true ? null : whyNot ?? null,
    limits: { ...BUG_LIMITS },
    places: [{ id: 'game', name: game || 'The game' }, { id: 'board', name: boardName }],
    reports: bugsList(items),
  }
}

/**
 * Files a report: checks it, makes the step through `make` (the work API as the person), then moves the pictures from
 * where they wait into the folder of the step's id. `ctx` is `checkBug`'s; `read()` the work store; `make(call)` one
 * action of the work API; `abs(path)` a project path as a file; `files` the file calls (stat, mkdir, rename, copyFile, rm).
 * Answers `{ ok: true, result: { step } }`, or why not (the step stands when only its pictures could not be moved).
 */
export async function fileBug(body, { ctx, read, make, abs, files }) {
  const checked = checkBug(body, ctx)
  if (!checked.ok) return checked
  const gone = await Promise.all(checked.from.map(path => files.stat(abs(path)).then(file => !file.isFile(), () => true)))
  if (gone.some(Boolean)) return refuse(409, 'A picture is not there any more: take it away and add it again.')
  const stored = await read()
  const place = bugPlace(checked.where, stored?.items, stored?.activities)
  if (place.activity === null) return refuse(409, 'The work store has no activity to put the step under.')
  const made = await make({
    action: 'new', title: checked.title, activity: place.activity, ...(place.goal === null ? {} : { goal: place.goal }), text: checked.lines,
    ...(checked.picture === null ? {} : { picture: checked.picture }), ...(checked.isFix ? { priority: 'fix' } : {}),
  })
  if (!made.ok) return made
  const id = made.result.id
  try {
    for (const [place, from] of checked.from.entries()) {
      const to = abs(checked.targets[place].replaceAll(STEP_ID_TOKEN, id))
      await files.mkdir(dirname(to), { recursive: true })
      const source = abs(from)
      await files.rename(source, to).catch(async () => { await files.copyFile(source, to); await files.rm(source, { force: true }) })
    }
  } catch {
    return refuse(500, `The step ${id} was filed, but its pictures could not be moved into ${bugsFolder(ctx.pictures)}/${id}: look for them in ${waitingFolder(ctx.pictures)}.`)
  }
  return { ok: true, result: { step: id } }
}
