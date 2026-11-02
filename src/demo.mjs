// B699: the goal demo as data the board draws. The partner's helper writes a list (JSON); tools/demo.mjs checks it and writes
// `demo.json` beside the pictures; the board reads that file (`GET /api/demo`) and draws it as a page. Every picture stays its
// own file at its own pixel size, so a click on it opens the picture window with real detail. This file knows nothing of the
// project's work: only the list's shape, the order of a row's pictures and the plain words the page shows.
//
// The list (JSON):
//   { "goal": "G12", "title": "How we build good maps", "intro": "optional line under the title", "step": "B674" (B860: the step the person's feedback is written on),
//     "sections": [ { "kind": "reached" | "not-reached" | "open", "intro": ["a line"], "items": ["one bullet each"],
//                     "rows": [ { "id": "optional: a part's key for feedback, else its title", "steps": ["B689", "B821"] (B878, optional: the steps the part shows, its fixes too), "title": "1. The row", "note": "one line", "pictures": [ { "kind": "target", "caption": "Concept B", "path": "a.png" } ],
//                                 "changed": "T17.1, one line: <the person's words -> what changed>", "pending": "T17.1, one line: why the new try is not in yet", "play": "T17.1: an arena name (letters, digits, dashes, at most 60): a link that opens the game on that map" },
//                               { "title": "6. A grid", "note": "...", "grid": [ { "caption": "A", "path": "b.png" } ] } ] } ],
//     "followUp": { "fixedForGood": ["..."], "fixedOnce": ["..."], "backlog": ["..."], "noStep": ["..."], "escalate": ["..."] } }

import { isAbsolute, posix } from 'node:path'

import { isAfterSend, roundsOf, standOf } from './demoFeedback.mjs'
import { sinceMs } from './work/item.mjs'

/** A section's kind: the band's words and the verdict the page shows. */
export const SECTIONS = {
  reached: { band: 'REACHED', verdict: 'Reached' },
  'not-reached': { band: 'NOT REACHED: WHAT WENT WRONG', verdict: 'Not reached' },
  open: { band: 'STILL OPEN', verdict: 'Still open' },
}
/** The pictures of a row in this order: the target first, the final last; `label` is the plain word above the picture. */
export const PICTURES = {
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
/** T17.1: a row's `play`: the name of an arena (the game's `arena=<name>` setting): letters, digits and dashes, at most 60. */
export const ARENA_NAME = /^[A-Za-z0-9-]{1,60}$/

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

/**
 * The list's words as the page draws them; it throws with the reason on a list it cannot draw. Pure: no file is read. T17.1: with
 * `tries` (`{ feedback, mtimeOf }`, `checkTries`) it also refuses a list that shows a row the person sent back as a new try without
 * the evidence; without it (the board reading a demo.json, a test of the shape) only the shape is checked.
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
      for (const field of ['changed', 'pending']) {
        if (row[field] !== undefined && !(typeof row[field] === 'string' && row[field].trim() !== '' && !/[\r\n]/.test(row[field]))) throw new Error(`${name}: "${field}" is one line of words.`)
      }
      if (row.play !== undefined && !(typeof row.play === 'string' && ARENA_NAME.test(row.play))) throw new Error(`${name}: "play" is an arena name: letters, digits and dashes, at most 60 (not "${String(row.play).slice(0, 40)}").`)
      const hasPictures = Array.isArray(row.pictures) && row.pictures.length > 0
      const hasGrid = Array.isArray(row.grid) && row.grid.length > 0
      if (hasPictures === hasGrid) throw new Error(`${name} has pictures or a grid, one of the two.`)
      for (const one of row.pictures ?? []) {
        if (PICTURES[one?.kind] === undefined) throw new Error(`${name}: a picture's kind is ${Object.keys(PICTURES).join(', ')}.`)
        if (typeof one.path !== 'string' || one.path === '') throw new Error(`${name}: a picture has no path.`)
      }
      for (const one of row.grid ?? []) if (typeof one?.path !== 'string' || one.path === '') throw new Error(`${name}: a grid picture has no path.`)
    }
  }
  for (const [key] of GROUPS) for (const item of list.followUp?.[key] ?? []) bulletOf(item, `The follow-up (${key})`)
  if (tries !== null) checkTries(list, tries)
  return list
}

/**
 * T17.1 (the person: "the same pictures are provided and i see no evidence of what i asked it to fix/change"): every row the person
 * sent back (their last word on it was Send back, in the round that sent it) must show a new try or say it is not in yet: a
 * `"changed"` line and at least one picture written after that Send (`mtimeOf(path)`: ms, or null), else a `"pending"` line saying
 * why. `tries`: `{ feedback, mtimeOf }`, `feedback` the feedback.json as read (null for none: no row is owed anything). A row the
 * person did not send back needs neither. It throws one line per row that breaks this. Pure.
 */
export function checkTries(list, { feedback = null, mtimeOf }) {
  const rounds = roundsOf(feedback)
  const stand = standOf(rounds)
  const keyOf = keyer()
  const problems = []
  for (const section of list.sections) {
    for (const row of section.rows ?? []) {
      const said = stand.get(keyOf(row))
      if (said?.verdict !== 'sent-back') continue
      if (typeof row.pending === 'string' && row.pending.trim() !== '') continue
      const sent = sinceMs(rounds[said.round - 1]?.at)
      if (!Number.isFinite(sent)) continue
      const own = `"${row.title.trim()}" (sent back in round ${said.round}, ${rounds[said.round - 1].at})`
      if (typeof row.changed !== 'string' || row.changed.trim() === '') problems.push(`${own} has no "changed": say in one line "<their words -> what changed>", or give "pending": "<why the new try is not in yet>".`)
      else if (![...(row.pictures ?? []), ...(row.grid ?? [])].some(one => isAfterSend(mtimeOf(one.path), sent))) problems.push(`${own}: no picture was written after that Send, so these are the old try's: put in the new try's picture, or give "pending": "<why the new try is not in yet>".`)
    }
  }
  if (problems.length > 0) throw new Error(`A row the person sent back shows no new try:\n${problems.map(one => `  ${one}`).join('\n')}`)
}

/** The pictures of a row in the demo's order; equal ranks keep the order they were listed in. */
export const orderedPictures = pictures => pictures.map((one, at) => ({ one, at })).sort((a, b) => PICTURES[a.one.kind].rank - PICTURES[b.one.kind].rank || a.at - b.at).map(({ one }) => one)

/** Every picture the list names, in the order the page shows them: `{ path, caption }`. */
export const picturesOf = list => (list.sections ?? []).flatMap(section => (section.rows ?? []).flatMap(row => [...orderedPictures(row.pictures ?? []), ...(row.grid ?? [])]))

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
  const place = one => ({ path: pathFrom(folder, one.path), caption: String(one.caption ?? '') })
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
      changed: typeof row.changed === 'string' ? row.changed.trim() : null,
      pending: typeof row.pending === 'string' ? row.pending.trim() : null,
      play: typeof row.play === 'string' ? row.play : null,
      pictures: Array.isArray(row.grid) && row.grid.length > 0
        ? row.grid.map(one => ({ kind: null, label: null, ...place(one) }))
        : orderedPictures(row.pictures).map(one => ({ kind: one.kind, label: PICTURES[one.kind].label, ...place(one) })),
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
