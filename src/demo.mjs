// B699: the goal demo as data the board draws. The partner's helper writes a list (JSON); tools/demo.mjs checks it and writes
// `demo.json` beside the pictures; the board reads that file (`GET /api/demo`) and draws it as a page. Every picture stays its
// own file at its own pixel size, so a click on it opens the picture window with real detail. This file knows nothing of the
// project's work: only the list's shape, the order of a row's pictures and the plain words the page shows.
//
// The list (JSON):
//   { "goal": "G12", "title": "How we build good maps", "intro": "optional line under the title",
//     "sections": [ { "kind": "reached" | "not-reached" | "open", "intro": ["a line"], "items": ["one bullet each"],
//                     "rows": [ { "title": "1. The row", "note": "one line", "pictures": [ { "kind": "target", "caption": "Concept B", "path": "a.png" } ] },
//                               { "title": "6. A grid", "note": "...", "grid": [ { "caption": "A", "path": "b.png" } ] } ] } ],
//     "followUp": { "fixedForGood": ["..."], "fixedOnce": ["..."], "backlog": ["..."], "noStep": ["..."], "escalate": ["..."] } }

import { isAbsolute, posix } from 'node:path'

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

/** One bullet's words: one item, never several on one line. */
function bulletOf(item, where) {
  const words = String(item ?? '').trim()
  if (words === '') throw new Error(`${where}: an empty bullet.`)
  if (/[\r\n]/.test(words) || words.includes('•')) throw new Error(`${where}: one item per bullet, never several on one line: "${words.slice(0, 60)}".`)
  return words
}

/** The list's words as the page draws them; it throws with the reason on a list it cannot draw. Pure: no file is read. */
export function checkList(list) {
  if (list === null || typeof list !== 'object' || Array.isArray(list)) throw new Error('The demo list is an object.')
  if (typeof list.goal !== 'string' || !/^G\d+$/.test(list.goal)) throw new Error('The list names its goal by id: "goal": "G12".')
  if (!Array.isArray(list.sections) || list.sections.length === 0) throw new Error('The list has no sections.')
  for (const [at, section] of list.sections.entries()) {
    if (SECTIONS[section?.kind] === undefined) throw new Error(`Section ${at + 1}: "kind" is reached, not-reached or open.`)
    for (const item of [...(section.intro ?? []), ...(section.items ?? [])]) bulletOf(item, `Section ${at + 1}`)
    for (const [r, row] of (section.rows ?? []).entries()) {
      const name = `Section ${at + 1}, row ${r + 1}`
      if (typeof row?.title !== 'string' || row.title.trim() === '') throw new Error(`${name} has no title.`)
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
  return list
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
  const sections = demo.sections.map(section => ({
    kind: section.kind,
    band: SECTIONS[section.kind].band,
    verdict: SECTIONS[section.kind].verdict,
    intro: (section.intro ?? []).map(item => bulletOf(item, 'A bullet')),
    items: (section.items ?? []).map(item => bulletOf(item, 'A bullet')),
    rows: (section.rows ?? []).map(row => ({
      title: row.title.trim(),
      note: typeof row.note === 'string' ? row.note.trim() : '',
      pictures: Array.isArray(row.grid) && row.grid.length > 0
        ? row.grid.map(one => ({ kind: null, label: null, ...place(one) }))
        : orderedPictures(row.pictures).map(one => ({ kind: one.kind, label: PICTURES[one.kind].label, ...place(one) })),
    })),
  }))
  const groups = GROUPS.map(([key, title]) => ({ key, title, items: (demo.followUp?.[key] ?? []).map(item => bulletOf(item, 'A bullet')) })).filter(group => group.items.length > 0)
  return {
    goal: demo.goal,
    title: typeof demo.title === 'string' && demo.title.trim() !== '' ? demo.title.trim() : 'the goal demo',
    intro: typeof demo.intro === 'string' && demo.intro.trim() !== '' ? demo.intro.trim() : DEFAULT_INTRO,
    sections,
    followUp: groups.length === 0 ? null : { band: FOLLOW_UP_BAND, groups },
  }
}
