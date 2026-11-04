// B699: the goal demo as data the board draws. The partner's helper writes a list (JSON); tools/demo.mjs checks it and writes
// `demo.json` beside the pictures; the board reads that file (`GET /api/demo`) and draws it as a page. Every picture stays its
// own file at its own pixel size, so a click on it opens the picture window with real detail. This file knows nothing of the
// project's work: only the list's shape, the order of a row's pictures and the plain words the page shows.
//
// The list (JSON):
//   { "goal": "G12", "title": "How we build good maps", "intro": "optional line under the title", "step": "B674" (B860: the step the person's feedback is written on),
//     "sections": [ { "kind": "reached" | "not-reached" | "open", "intro": ["a line"], "items": ["one bullet each"],
//                     "rows": [ { "id": "optional: a part's key for feedback, else its title", "steps": ["B689", "B821"] (B878, optional: the steps the part shows, its fixes too), "title": "1. The row", "note": "one line", "pictures": [ { "kind": "target", "caption": "Concept B", "path": "a.png" } ],
//                                 "changed": "T17.1, one line: <the person's words -> what changed>", "pending": "T17.1, one line: why the new try is not in yet", "play": "T17.1: an arena name (letters, digits, dashes, underscores, at most 60): a link that opens the game on that map",
//                                 "shows": { "verdict": "yes" | "no", "by": "T17.2: who checked (never the chat or helper that made the picture)", "at": "YYYY-MM-DD HH:MM", "why": "one line: does the close-up show their words?" } },
//                               { "title": "6. A grid", "note": "...", "grid": [ { "caption": "A", "path": "b.png" } ] } ] } ],
//   T17.2 (the person, 2026-11-04: "i expect that when i promide feedback i get new tailored demo on the aspects i asked for"): two more picture kinds,
//   the spot their words name, up close, and where something moves, a clip:
//     { "kind": "closeup", "caption": "...", "path": "<the after picture>", "before": "<the before picture>", "box": [x, y, w, h],
//       "beforeBox": [x, y, w, h] (optional, else box), "beforeCaption": "Before your words", "afterCaption": "Now" }
//     { "kind": "clip", "caption": "...", "frames": ["a.png", "b.png"] (2 to 12), "box": [x, y, w, h] (optional), "ms": 900 (300 to 3000, optional), "path": (optional, else the last frame) }
//   A box is in the picture's own pixels: whole numbers, x and y from 0, w and h at least 16.
//     "followUp": { "fixedForGood": ["..."], "fixedOnce": ["..."], "backlog": ["..."], "noStep": ["..."], "escalate": ["..."] } }

import { isAbsolute, posix } from 'node:path'

import { isAfterSend, roundsOf, showsCheck, standOf } from './demoFeedback.mjs'
import { sinceMs } from './work/item.mjs'

/** A section's kind: the band's words and the verdict the page shows. */
export const SECTIONS = {
  reached: { band: 'REACHED', verdict: 'Reached' },
  'not-reached': { band: 'NOT REACHED: WHAT WENT WRONG', verdict: 'Not reached' },
  open: { band: 'STILL OPEN', verdict: 'Still open' },
}
/** The pictures of a row in this order: the target first, the final last; `label` is the plain word above the picture. */
export const PICTURES = {
  // T17.2: what the person's words asked, up close and moving, before every other picture.
  closeup: { rank: -2, label: 'YOUR WORDS, UP CLOSE' },
  clip: { rank: -1, label: 'YOUR WORDS, MOVING' },
  target: { rank: 0, label: 'TARGET' },
  before: { rank: 1, label: 'BEFORE THIS GOAL' },
  between: { rank: 2, label: 'IN BETWEEN' },
  final: { rank: 3, label: 'FINAL, IN THE GAME' },
  'final-not': { rank: 3, label: 'LAST TRY, IN THE GAME' },
  'final-art': { rank: 3, label: 'FINAL, NOT IN THE GAME YET' },
}
/** The follow-up's five groups, in this order. */
export const GROUPS = [
  ['fixedForGood', 'Fixed for good: a rule or the board now prevents it'],
  ['fixedOnce', 'Fixed this time only: needs a lasting fix'],
  ['backlog', 'Not fixed yet: on the backlog'],
  ['noStep', 'Not fixed yet: no step'],
  ['escalate', 'Escalate: no clear fix here'],
]
export const FOLLOW_UP_BAND = 'FOLLOW-UP: WHAT WENT WRONG, AND WHAT IS DONE ABOUT IT'
const DEFAULT_INTRO = 'In every row: target first, then before this goal, then results in between, and the final result last.'
/** The most a demo.json may weigh. */
export const DEMO_BYTES = 1024 * 1024
/** T17.1: a row's `play`: the name of an arena (the game's `arena=<name>` setting): letters, digits, dashes and underscores, at most 60. */
export const ARENA_NAME = /^[A-Za-z0-9_-]{1,60}$/
/** T17.2: a close-up's or clip's box is at least this many pixels wide and high (a smaller spot is no close-up of anything). */
export const BOX_MIN = 16
/** T17.2: a clip has this many frames at most and at least, and shows each for `ms` of this range (default CLIP_MS). */
export const CLIP_FRAMES = { min: 2, max: 12 }
export const CLIP_MS = { min: 300, max: 3000, default: 900 }
/** T17.2: the words under a close-up's two sides when the list gives none. */
export const CLOSEUP_CAPTIONS = { before: 'Before your words', after: 'Now' }
/** T17.2: a checker's verdict on a row, and the moment it was written ("YYYY-MM-DD HH:MM"). */
export const SHOWS_VERDICTS = ['yes', 'no']
const SHOWS_AT = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]) (?:[01]\d|2[0-3]):[0-5]\d$/

/** One bullet's words: one item, never several on one line. */
function bulletOf(item, where) {
  const words = String(item ?? '').trim()
  if (words === '') throw new Error(`${where}: an empty bullet.`)
  if (/[\r\n]/.test(words) || words.includes('•')) throw new Error(`${where}: one item per bullet, never several on one line: "${words.slice(0, 60)}".`)
  return words
}

/** B860: a row's key (feedback names a part by it): its id, else its title; a second row of the same key gets " (2)". Rows are keyed in the page's order. */
function keyer() {
  const taken = new Set()
  return row => {
    const base = String(row.id ?? row.title).trim()
    let key = base
    for (let n = 2; taken.has(key); n += 1) key = `${base} (${n})`
    taken.add(key)
    return key
  }
}

/** T17.2: why a box is none (the words after "box"), or null for a good one: `[x, y, w, h]`, whole numbers, x and y from 0, w and h at least BOX_MIN. */
function boxProblem(box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(value => Number.isInteger(value))) return 'is [x, y, w, h]: four whole numbers'
  if (box[0] < 0 || box[1] < 0) return 'starts at x and y of 0 or more'
  if (box[2] < BOX_MIN || box[3] < BOX_MIN) return `is at least ${BOX_MIN} wide and ${BOX_MIN} high (w and h)`
  return null
}

/** T17.2: one picture's own fields: a close-up has its after and before pictures and a box, a clip its frames; the other kinds a path. It throws one line. */
function checkPicture(one, name) {
  const isFile = value => typeof value === 'string' && value !== ''
  if (one.kind === 'closeup') {
    if (!isFile(one.path)) throw new Error(`${name}: a close-up has no path (the after picture).`)
    if (!isFile(one.before)) throw new Error(`${name}: a close-up has no "before" (the before picture).`)
    for (const field of ['box', 'beforeBox']) {
      if (field === 'beforeBox' && one.beforeBox === undefined) continue
      const bad = boxProblem(one[field])
      if (bad !== null) throw new Error(`${name}: a close-up's "${field}" ${bad}.`)
    }
    return
  }
  if (one.kind === 'clip') {
    const frames = one.frames
    if (!Array.isArray(frames) || frames.length < CLIP_FRAMES.min || frames.length > CLIP_FRAMES.max || !frames.every(isFile)) throw new Error(`${name}: a clip has ${CLIP_FRAMES.min} to ${CLIP_FRAMES.max} frames, each a picture's path.`)
    if (one.path !== undefined && !isFile(one.path)) throw new Error(`${name}: a clip's "path" is a picture's path (or none: the last frame).`)
    if (one.box !== undefined) {
      const bad = boxProblem(one.box)
      if (bad !== null) throw new Error(`${name}: a clip's "box" ${bad}.`)
    }
    if (one.ms !== undefined && !(Number.isInteger(one.ms) && one.ms >= CLIP_MS.min && one.ms <= CLIP_MS.max)) throw new Error(`${name}: a clip's "ms" is ${CLIP_MS.min} to ${CLIP_MS.max} (milliseconds for each frame).`)
    return
  }
  if (!isFile(one.path)) throw new Error(`${name}: a picture has no path.`)
}

/** T17.2: why a row's `shows` is none (the words after "shows"), or null for a good one: the checker's verdict, who, when and why, in one line each. */
function showsProblem(shows) {
  if (shows === null || typeof shows !== 'object' || Array.isArray(shows)) return 'is { "verdict": "yes" or "no", "by": "<who checked>", "at": "YYYY-MM-DD HH:MM", "why": "<one line>" }'
  if (!SHOWS_VERDICTS.includes(shows.verdict)) return `has a "verdict" of ${SHOWS_VERDICTS.join(' or ')}, not "${String(shows.verdict).slice(0, 20)}"`
  for (const field of ['by', 'why']) {
    if (!(typeof shows[field] === 'string' && shows[field].trim() !== '' && !/[\r\n]/.test(shows[field]))) return `has a "${field}" of one line of words`
  }
  if (!(typeof shows.at === 'string' && SHOWS_AT.test(shows.at) && Number.isFinite(sinceMs(shows.at)))) return 'has an "at" of the form "YYYY-MM-DD HH:MM"'
  return null
}

/** T17.2: a row's `shows` as the page keeps it (its words squeezed to one line), or null for none. */
const cleanShows = shows => (showsProblem(shows) === null ? { verdict: shows.verdict, by: lineOf(shows.by), at: shows.at, why: lineOf(shows.why) } : null)

/**
 * The list's words as the page draws them; it throws with the reason on a list it cannot draw. Pure: no file is read. T17.1: with
 * `tries` (what tools/demo.mjs gives: `{ feedback, mtimeOf, previous, hasArena }`) it is the partner's check, and also refuses a bad
 * `changed`, `pending` or `play` (`checkWords`) and a list that shows a row the person sent back as a new try without the evidence
 * (`checkTries`). Without it (the board reading a demo.json, a test of the shape) only the shape is checked: a bad `changed`,
 * `pending` or `play` never refuses a whole recap, `demoPage` leaves that one out.
 */
export function checkList(list, tries = null) {
  if (list === null || typeof list !== 'object' || Array.isArray(list)) throw new Error('The demo list is an object.')
  if (typeof list.goal !== 'string' || !/^G\d+$/.test(list.goal)) throw new Error('The list names its goal by id: "goal": "G12".')
  if (list.step !== undefined && !/^B\d+$/.test(String(list.step))) throw new Error('The list names its step by id: "step": "B674".')
  if (!Array.isArray(list.sections) || list.sections.length === 0) throw new Error('The list has no sections.')
  for (const [at, section] of list.sections.entries()) {
    if (SECTIONS[section?.kind] === undefined) throw new Error(`Section ${at + 1}: "kind" is reached, not-reached or open.`)
    for (const item of [...(section.intro ?? []), ...(section.items ?? [])]) bulletOf(item, `Section ${at + 1}`)
    for (const [r, row] of (section.rows ?? []).entries()) {
      const name = `Section ${at + 1}, row ${r + 1}`
      if (typeof row?.title !== 'string' || row.title.trim() === '') throw new Error(`${name} has no title.`)
      if (row.steps !== undefined && !(Array.isArray(row.steps) && row.steps.every(one => /^B\d+$/.test(String(one))))) throw new Error(`${name}: "steps" lists step ids: ["B689", "B821"].`)
      const hasPictures = Array.isArray(row.pictures) && row.pictures.length > 0
      const hasGrid = Array.isArray(row.grid) && row.grid.length > 0
      if (hasPictures === hasGrid) throw new Error(`${name} has pictures or a grid, one of the two.`)
      for (const one of row.pictures ?? []) {
        if (PICTURES[one?.kind] === undefined) throw new Error(`${name}: a picture's kind is ${Object.keys(PICTURES).join(', ')}.`)
        checkPicture(one, name)
      }
      for (const one of row.grid ?? []) if (typeof one?.path !== 'string' || one.path === '') throw new Error(`${name}: a grid picture has no path.`)
      // T17.2: the checker's word on the row, wherever the row stands.
      if (row.shows !== undefined) {
        const bad = showsProblem(row.shows)
        if (bad !== null) throw new Error(`${name}: "shows" ${bad}.`)
      }
    }
  }
  for (const [key] of GROUPS) for (const item of list.followUp?.[key] ?? []) bulletOf(item, `The follow-up (${key})`)
  if (tries !== null) {
    checkWords(list, tries.hasArena)
    checkTries(list, tries)
  }
  return list
}

/** One line of a row's words: its spaces squeezed, or '' when it is none. */
const lineOf = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/**
 * T17.1: the partner's check of a row's `changed` and `pending` (one line of words each) and `play` (an arena name: ARENA_NAME, and,
 * when `hasArena(name)` is given, one the game has). It throws one line per row that breaks this. Pure.
 */
export function checkWords(list, hasArena = undefined) {
  const problems = []
  for (const [at, section] of list.sections.entries()) {
    for (const [r, row] of (section.rows ?? []).entries()) {
      const name = `Section ${at + 1}, row ${r + 1}`
      for (const field of ['changed', 'pending']) {
        if (row[field] !== undefined && !(typeof row[field] === 'string' && row[field].trim() !== '' && !/[\r\n]/.test(row[field]))) problems.push(`${name}: "${field}" is one line of words.`)
      }
      if (row.play === undefined) continue
      if (!(typeof row.play === 'string' && ARENA_NAME.test(row.play))) problems.push(`${name}: "play" is an arena name: letters, digits, dashes and underscores, at most 60 (not "${String(row.play).slice(0, 40)}").`)
      else if (typeof hasArena === 'function' && !hasArena(row.play)) problems.push(`${name}: "play": the game has no arena "${row.play}" (its arenas folder and the dev folder in it): the link would open nothing.`)
    }
  }
  if (problems.length > 0) throw new Error(`A row's words are wrong:\n${problems.map(one => `  ${one}`).join('\n')}`)
}

/** The notes and `changed` lines of a list's rows by key: `Map(key -> { note, changed })`. */
function wordsByKey(list) {
  const keyOf = keyer()
  return new Map((list?.sections ?? []).flatMap(section => (section?.rows ?? []).map(row => [keyOf(row), { note: lineOf(row.note), changed: lineOf(row.changed) }])))
}

/**
 * T17.1 (the person: "the same pictures are provided and i see no evidence of what i asked it to fix/change"): every row the person
 * sent back (their last word on it was Send back, in the round that sent it) must show a new try or say it is not in yet: a
 * `"changed"` line and evidence of the new try, else a `"pending"` line saying why. The evidence is at least one picture written after
 * that Send (`mtimeOf(path)`: ms, or null), or, for an answer in words, a note that differs from the one the demo about to be replaced
 * had for the row (`previous`: `{ list, writtenAt }`, that demo.json as it was read, or null); a list the tool took already (the
 * demo it replaces was written after the Send and holds the same `changed` line) passes again. `feedback` is the feedback.json as
 * read (null for none: no row is owed anything). A row the person did not send back needs neither. Also every row they sent back
 * must still be in the list: a renamed row would lose their words and their Approve (keep the row's title, or give it an `id`).
 * It throws one line per row that breaks this. Pure.
 */
export function checkTries(list, { feedback = null, mtimeOf, previous = null }) {
  const rounds = roundsOf(feedback)
  const stand = standOf(rounds)
  const keyOf = keyer()
  const before = previous === null ? null : wordsByKey(previous.list)
  const problems = []
  const present = new Set()
  for (const section of list.sections) {
    for (const row of section.rows ?? []) {
      const key = keyOf(row)
      present.add(key)
      const said = stand.get(key)
      if (said?.verdict !== 'sent-back') continue
      if (typeof row.pending === 'string' && row.pending.trim() !== '') continue
      const sent = sinceMs(rounds[said.round - 1]?.at)
      if (!Number.isFinite(sent)) continue
      const own = `"${row.title.trim()}" (sent back in round ${said.round}, ${rounds[said.round - 1].at})`
      if (lineOf(row.changed) === '') {
        problems.push(`${own} has no "changed": say in one line "<their words -> what changed>", or give "pending": "<why the new try is not in yet>".`)
        continue
      }
      const note = lineOf(row.note)
      const old = before?.get(key)
      const hasPicture = [...(row.pictures ?? []), ...(row.grid ?? [])].some(one => filesOfPicture(one).some(file => isAfterSend(mtimeOf(file.path), sent)))
      const hasWords = old !== undefined && note !== '' && note !== old.note
      const isRerun = old !== undefined && isAfterSend(previous.writtenAt, sent) && old.changed === lineOf(row.changed)
      if (!hasPicture && !hasWords && !isRerun) {
        problems.push(`${own}: no picture was written after that Send and its note is the old one, so this is the old try: put in the new try's picture (or, for an answer in words, its new note), or give "pending": "<why the new try is not in yet>".`)
        continue
      }
      // T17.2: the new try shows the spot their words name, up close, and a checker who did not make it says so. An answer in words (it passed
      // on a new note or the list taken again alone, with no picture written after the Send) is no spot of a picture: it needs no close-up, but
      // the same check. Nor does a grid row (a row has pictures or a grid, never both: a grid cannot carry a close-up). A row with new pictures
      // needs its close-up even when its note changed too (the review: a rewritten note let row 7's whole-screen shots pass without one).
      const isWords = !hasPicture || (row.pictures ?? []).length === 0
      const closeups = (row.pictures ?? []).filter(one => one?.kind === 'closeup')
      const hasCloseup = closeups.some(one => isAfterSend(mtimeOf(one.path), sent))
      const checked = showsCheck(row.shows, sent)
      const needs = []
      if (!isWords && !hasCloseup) needs.push(closeups.length === 0 ? 'no close-up' : "its close-up's after picture was written before that Send, so it is the old try")
      if (checked.state === 'no') needs.push(`its check says it does not show their words yet: "${checked.why}"`)
      else if (checked.state === 'waits') needs.push(row.shows === undefined ? 'no "shows" (the check)' : 'its "shows" is dated before that Send, so it checked an older try')
      if (needs.length > 0) problems.push(`${own}: ${needs.join('; ')}. Make the close-up: the before and after pictures and the box of the spot their words name, a clip when it moves; then have a checker who did not make it write "shows": { "verdict": "yes", "by": "<the checker>", "at": "YYYY-MM-DD HH:MM", "why": "<one line>" }; or give "pending": "<why the new try is not in yet>".`)
    }
  }
  for (const [key, said] of stand) {
    if (said.verdict === 'sent-back' && !present.has(key)) problems.push(`"${key}" (sent back in round ${said.round}, ${rounds[said.round - 1]?.at ?? ''}) is in no row of the list: keep the row's title, or give the row "id": "${key}".`)
  }
  if (problems.length > 0) throw new Error(`The list does not answer every row the person sent back:\n${problems.map(one => `  ${one}`).join('\n')}`)
}

/** The pictures of a row in the demo's order; equal ranks keep the order they were listed in. */
export const orderedPictures = pictures => pictures.map((one, at) => ({ one, at })).sort((a, b) => PICTURES[a.one.kind].rank - PICTURES[b.one.kind].rank || a.at - b.at).map(({ one }) => one)

/**
 * T17.2: every file one picture of the list names: its `path` (a clip without one: its last frame), a close-up's `before` and a clip's frames.
 * `{ path, caption }` each; a clip's frames and a close-up's before picture follow the picture that names them.
 */
export function filesOfPicture(one) {
  const caption = String(one.caption ?? '')
  const files = []
  const add = (path, words = caption) => { if (typeof path === 'string' && path !== '') files.push({ path, caption: words }) }
  add(one.path ?? (Array.isArray(one.frames) ? one.frames.at(-1) : undefined))
  add(one.before, String(one.beforeCaption ?? ''))
  for (const frame of Array.isArray(one.frames) ? one.frames : []) add(frame)
  return files
}

/** Every picture the list names, in the order the page shows them: `{ path, caption }`; T17.2: with the before picture of a close-up and the frames of a clip. */
export const picturesOf = list => (list.sections ?? []).flatMap(section => (section.rows ?? []).flatMap(row => [...orderedPictures(row.pictures ?? []).flatMap(filesOfPicture), ...(row.grid ?? [])]))

/** A picture's path from the folder of the file that names it, in the form the board asks for ("a/b/c.png"); an absolute path stays as it is. */
export function pathFrom(folder, path) {
  const value = String(path).replace(/\\/g, '/')
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value)) return value
  return posix.normalize(posix.join(folder === '' ? '.' : folder, value))
}

/**
 * The page the board draws, from a checked list and the folder its file lies in (a path of the shown folders). Pure. Every
 * word and every order is decided here: the page only draws it.
 */
export function demoPage(input, folder = '') {
  const demo = checkList(input)
  const place = one => ({ path: pathFrom(folder, one.path ?? one.frames.at(-1)), caption: String(one.caption ?? '') })
  // T17.2: a close-up's before picture and boxes, a clip's frames, box and pace: every path resolved as `path` is.
  const detail = one => {
    if (one.kind === 'closeup') {
      return {
        before: pathFrom(folder, one.before), box: [...one.box], beforeBox: [...(one.beforeBox ?? one.box)],
        beforeCaption: lineOf(one.beforeCaption) || CLOSEUP_CAPTIONS.before, afterCaption: lineOf(one.afterCaption) || CLOSEUP_CAPTIONS.after,
      }
    }
    if (one.kind === 'clip') return { frames: one.frames.map(frame => pathFrom(folder, frame)), box: one.box === undefined ? null : [...one.box], ms: one.ms ?? CLIP_MS.default }
    return {}
  }
  const keyOf = keyer()
  const sections = demo.sections.map(section => ({
    kind: section.kind,
    band: SECTIONS[section.kind].band,
    verdict: SECTIONS[section.kind].verdict,
    intro: (section.intro ?? []).map(item => bulletOf(item, 'A bullet')),
    items: (section.items ?? []).map(item => bulletOf(item, 'A bullet')),
    rows: (section.rows ?? []).map(row => ({
      key: keyOf(row),
      // B878: the steps the part shows: the person's Approve closes those in review, a Send back names them to the partner.
      steps: [...new Set(row.steps ?? [])],
      title: row.title.trim(),
      note: typeof row.note === 'string' ? row.note.trim() : '',
      // T17.1: what the partner changed for the person's words, why the new try is not in yet, and the arena to play: null for none.
      changed: lineOf(row.changed) || null,
      pending: lineOf(row.pending) || null,
      // The board reads whatever the partner wrote: a name that is none is left out, never the whole recap.
      play: typeof row.play === 'string' && ARENA_NAME.test(row.play) ? row.play : null,
      // T17.2: the checker's word on the row (who, when, why), null for none.
      shows: cleanShows(row.shows),
      pictures: Array.isArray(row.grid) && row.grid.length > 0
        ? row.grid.map(one => ({ kind: null, label: null, ...place(one) }))
        : orderedPictures(row.pictures).map(one => ({ kind: one.kind, label: PICTURES[one.kind].label, ...place(one), ...detail(one) })),
    })),
  }))
  const groups = GROUPS.map(([key, title]) => ({ key, title, items: (demo.followUp?.[key] ?? []).map(item => bulletOf(item, 'A bullet')) })).filter(group => group.items.length > 0)
  return {
    goal: demo.goal,
    step: typeof demo.step === 'string' ? demo.step : null,
    title: typeof demo.title === 'string' && demo.title.trim() !== '' ? demo.title.trim() : 'the goal demo',
    intro: typeof demo.intro === 'string' && demo.intro.trim() !== '' ? demo.intro.trim() : DEFAULT_INTRO,
    sections,
    followUp: groups.length === 0 ? null : { band: FOLLOW_UP_BAND, groups },
  }
}
