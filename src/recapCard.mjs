// The recap card on the Focus page (the person, 2026-11-01: "where do i see this recap... I expected a button where is
// clearly visually i need to give a recap?", and on the mock: "i never want more then 1 row of information. if e.g. 6
// verdicts await then i want it visually to look the same, except the 3 into 6 ofcourse"): what the card shows while the
// focus goal's recap has parts that wait for the person's verdict. It reads the recaps the board already keeps
// (src/recaps.mjs `readRecaps`, `recapWaitsOf`: read only) and the asks Autopilot routed to the recap. PURE, except
// `readRecapPictures`, which reads the demo files through src/pictures.mjs `readDemo`.

import { readDemo, shownRoots } from './pictures.mjs'
import { valueOf } from './work/item.mjs'
import { checkedOf } from './work/resultCheck.mjs'
import { standardOf } from './work/standard.mjs'

/** The card shows this many tiles at most, in one row, whatever waits (the person: "never more then 1 row"). */
export const MOST_TILES = 3
/** The small line of a tile: what the person does with the part. */
export const TILE_LINE = 'approve or send back'
/** The block states in which nothing is left to build: a block is done, out of the goal, or only waits for the person. */
const BUILT_STATES = ['done', 'dropped', 'stopped', 'verdict']

/** The picture a recap row shows on its tile: its last final picture (the result), else its last picture; null for none. */
export function tilePictureOf(pictures) {
  const list = Array.isArray(pictures) ? pictures.filter(one => typeof one?.path === 'string' && one.path !== '') : []
  return (list.findLast(one => typeof one.kind === 'string' && one.kind.startsWith('final')) ?? list.at(-1) ?? null)?.path ?? null
}

/**
 * The tile pictures of the recaps `recaps` (src/recaps.mjs `readRecaps`): `[{ path, pictures: { <part key>: <picture path> } }]`,
 * one per recap whose demo the board can read again; a part whose row has no picture is left out. A recap the board cannot
 * read is left out (its tiles show a calm placeholder).
 */
export async function readRecapPictures(config, recaps) {
  const found = []
  for (const recap of Array.isArray(recaps) ? recaps : []) {
    const read = await readDemo(config.project, shownRoots(config), recap.path).catch(() => null)
    if (read === null || read.why !== undefined) continue
    const rows = read.base.sections.flatMap(section => section.rows)
    found.push({ path: recap.path, pictures: Object.fromEntries(rows.map(row => [row.key, tilePictureOf(row.pictures)]).filter(([, path]) => path !== null)) })
  }
  return found
}

/** The score a step's result check gave, beside its target: "64 of 75", or null (a step without a "N of M" score). */
export function scoreOf(step) {
  const found = String(checkedOf(step)?.score ?? '').match(/(\d+)\s+of\s+(\d+)/)
  if (found === null) return null
  return `${found[1]} of ${standardOf(step)?.match(/\btarget\s+(\d+)\b/i)?.[1] ?? found[2]}`
}

/**
 * The card, or null while nothing waits for the person's verdict. `goal` is the focus goal's id, `waits` where each step a
 * recap part names stands with the person (src/recaps.mjs `recapWaitsOf`), `pictures` `readRecapPictures`' answer, `steps` the
 * store's steps by id, `asks` the asks Autopilot routed away (`routedAwayOf`; only those routed to the recap, of this goal's
 * steps count) and `blocks` the focus goal's work blocks (the state's `parts`, each with its `state`).
 *
 * `{ goal, path, count, isBuilt, tiles, outside }`: `count` the parts waiting (a part with a step of an open recap ask counts
 * too; each part once), `path` the recap the button opens, `tiles` the first parts waiting in the recap's order, never more than
 * MOST_TILES (`{ key, title, path, picture, line }`), `isBuilt` whether everything is built (every block done, out of the goal or
 * waiting for the verdict, and no part out with the partner after a Send back) and `outside` the ids of the recap asks whose step
 * no recap part names yet: the page lists those as before, under the card.
 */
export function recapCardOf({ goal, waits = [], pictures = [], steps = new Map(), asks = [], blocks = [] }) {
  const parts = new Map()
  for (const wait of (Array.isArray(waits) ? waits : []).filter(one => one.goal === goal)) {
    const at = `${wait.path}\n${wait.key}`
    const part = parts.get(at) ?? { path: wait.path, key: wait.key, title: wait.title, steps: [], verdict: wait.verdict, isAsked: false }
    part.steps.push(wait.step)
    parts.set(at, part)
  }
  const outside = []
  for (const ask of (Array.isArray(asks) ? asks : []).filter(one => one.route === 'recap' && one.goal === goal)) {
    const part = [...parts.values()].find(one => one.steps.includes(ask.of))
    if (part === undefined) outside.push(ask.id)
    else part.isAsked = true
  }
  const waiting = [...parts.values()].filter(one => one.verdict === null || one.isAsked)
  if (waiting.length === 0) return null
  const pictureOf = part => (pictures ?? []).find(one => one.path === part.path)?.pictures?.[part.key] ?? null
  const lineOf = part => {
    const score = part.steps.map(id => steps.get(id)).filter(one => one !== undefined).sort((a, b) => Number(valueOf(b, 'Id').slice(1)) - Number(valueOf(a, 'Id').slice(1))).map(scoreOf).find(one => one !== null) ?? null
    return score === null ? TILE_LINE : `${score} · ${TILE_LINE}`
  }
  const isBuilt = (blocks ?? []).every(block => BUILT_STATES.includes(block.state)) && [...parts.values()].every(one => one.verdict === null)
  return {
    goal,
    path: waiting[0].path,
    count: waiting.length,
    isBuilt,
    tiles: waiting.slice(0, MOST_TILES).map(part => ({ key: part.key, title: part.title, path: part.path, picture: pictureOf(part), line: lineOf(part) })),
    outside,
  }
}
