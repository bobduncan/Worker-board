// The recap card on the Focus page (the person, 2026-11-01: "where do i see this recap... I expected a button where is
// clearly visually i need to give a recap?", and on the mock: "i never want more then 1 row of information. if e.g. 6
// verdicts await then i want it visually to look the same, except the 3 into 6 ofcourse"): what the card shows while the focus
// goal has verdicts that wait for the person. A verdict waits in one of these forms: a part of the goal's recap (a demo row that
// names steps, src/recaps.mjs `recapWaitsOf`: read only), an Accept card of a step, a look or decide ask of a step that stands
// with the person (`standingAsksOf`), or the goal's own "open the recap / play it" ask. PURE, except `readGoalRecap`, which reads
// the goal's recap file through src/pictures.mjs `readDemo`.

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { parseGoals } from './goals.mjs'
import { readDemo, shownFolders, shownRoots } from './pictures.mjs'
import { standsForPerson } from './work/autopilot.mjs'
import { valueOf } from './work/item.mjs'
import { checkedOf } from './work/resultCheck.mjs'
import { standardOf } from './work/standard.mjs'

/** The card shows this many tiles at most, in one row, whatever waits (the person: "never more then 1 row"). */
export const MOST_TILES = 3
/** The small line of a tile: what the person does with it. */
export const TILE_LINE = 'approve or send back'
/** The block states in which nothing is left to build: a block is done, out of the goal, or only waits for the person. */
const BUILT_STATES = ['done', 'dropped', 'stopped', 'verdict']
const FINISHED = ['done', 'closed', 'dropped']
const IMAGE = /\.(?:png|jpe?g|gif|webp)$/i

/** The picture a recap row shows on its tile: its last final picture (the result), else its last picture; null for none. */
export function tilePictureOf(pictures) {
  const list = Array.isArray(pictures) ? pictures.filter(one => typeof one?.path === 'string' && one.path !== '') : []
  return (list.findLast(one => typeof one.kind === 'string' && one.kind.startsWith('final')) ?? list.at(-1) ?? null)?.path ?? null
}

/**
 * The goal's recap file, as a path of the shown folders, or null: its `Demo:` line when that names a .json the board can read,
 * else the newest `demo.json` of the goal's picture folders (`<folder>/<goal id>/demo.json`, `<folder>/<goal id>/<any>/demo.json`)
 * by the time it was written. ONE file, never two (the person: a goal with an older recap beside the new one counts the new).
 */
export async function focusRecapFile(config, goalsText) {
  if (typeof goalsText !== 'string' || typeof config?.project !== 'string') return null
  const goals = parseGoals(goalsText)
  const node = goals.focus ? goals.byId.get(goals.focus) ?? null : null
  if (node === null) return null
  const named = String(node.demo ?? '').split(' · ')[0].trim().replace(/\\/g, '/')
  if (/\.json$/i.test(named)) {
    const read = await readDemo(config.project, shownRoots(config), named).catch(() => null)
    if (read !== null && read.why === undefined) return named
  }
  const names = async folder => (await readdir(join(config.project, ...folder.split('/')), { withFileTypes: true }).catch(() => [])).filter(one => one.isDirectory()).map(one => one.name)
  const found = []
  for (const folder of shownFolders(config)) {
    for (const goal of (await names(folder)).filter(name => name.toLowerCase() === node.id.toLowerCase())) {
      const inside = join(config.project, ...folder.split('/'), goal)
      const own = (await readdir(inside).catch(() => [])).includes('demo.json') ? [`${folder}/${goal}/demo.json`] : []
      const deeper = []
      for (const sub of await names(`${folder}/${goal}`)) if ((await readdir(join(inside, sub)).catch(() => [])).includes('demo.json')) deeper.push(`${folder}/${goal}/${sub}/demo.json`)
      for (const path of [...own, ...deeper]) {
        const at = await stat(join(config.project, ...path.split('/'))).then(info => info.mtimeMs, () => null)
        if (at !== null) found.push({ path, at })
      }
    }
  }
  found.sort((a, b) => b.at - a.at || a.path.localeCompare(b.path))
  return found[0]?.path ?? null
}

/**
 * The focus goal's recap for the card: `{ goal, path, pictures: { <part key>: <picture path> } }`, or null for a goal with no recap
 * file. A part whose row has no picture is left out of `pictures` (its tile shows a calm placeholder).
 */
export async function readGoalRecap(config, goalsText) {
  const path = await focusRecapFile(config, goalsText)
  if (path === null) return null
  const goals = parseGoals(goalsText)
  const read = await readDemo(config.project, shownRoots(config), path).catch(() => null)
  const rows = read === null || read.why !== undefined ? [] : read.base.sections.flatMap(section => section.rows)
  return { goal: goals.focus, path, pictures: Object.fromEntries(rows.map(row => [row.key, tilePictureOf(row.pictures)]).filter(([, picture]) => picture !== null)) }
}

/** The score a step's result check gave, beside its target: "64 of 75", or null (a step without a "N of M" score). */
export function scoreOf(step) {
  const found = String(checkedOf(step)?.score ?? '').match(/(\d+)\s+of\s+(\d+)/)
  if (found === null) return null
  return `${found[1]} of ${standardOf(step)?.match(/\btarget\s+(\d+)\b/i)?.[1] ?? found[2]}`
}

/**
 * The open asks that stand with the person, from the store's items by id (`ctx`: `autopilot`, `now`): each `{ id, of, asks, title,
 * text, pictures }`. An ask routed to the recap counts only while Autopilot is on (off, it stands in Needs your attention, not in
 * the card); one routed to the partner, the main chat or the board's advice never; a refine question and one of the app's own form
 * never. `of` is the step or goal it is of, or null.
 */
export function standingAsksOf(items, ctx = {}) {
  const found = []
  for (const item of items?.values?.() ?? []) {
    if (valueOf(item, 'Kind') !== 'ask' || valueOf(item, 'State') !== 'open') continue
    if (['refine', 'form'].includes(valueOf(item, 'Via'))) continue
    const route = valueOf(item, 'Route')
    if (!(route === 'recap' ? ctx.autopilot === true : standsForPerson(item, { ...ctx, items }))) continue
    found.push({
      id: valueOf(item, 'Id'), of: valueOf(item, 'Of'), asks: valueOf(item, 'Asks') ?? 'decide', route, via: valueOf(item, 'Via'),
      title: String(valueOf(item, 'Title') ?? ''), text: (item.sections?.get('Text') ?? []).join(' '),
      pictures: String(valueOf(item, 'Pictures') ?? '').split(',').map(one => one.trim()).filter(Boolean),
    })
  }
  return found
}

/** The look and decide asks of steps that stand with the person, by the step: `Map(step id → asks)`. */
export function askedStepsOf(standing) {
  const by = new Map()
  for (const ask of standing) {
    if (!/^B\d+$/.test(ask.of ?? '') || !['look', 'decide'].includes(ask.asks)) continue
    by.set(ask.of, [...(by.get(ask.of) ?? []), ask])
  }
  return by
}

/** The ids of the steps a Quality Assurance task (its head `Checks`) is still checking: not done, closed or dropped. */
export function openChecksOf(items) {
  const open = new Set()
  for (const item of items?.values?.() ?? []) {
    const checks = valueOf(item, 'Checks')
    if (checks !== null && !FINISHED.includes(valueOf(item, 'State'))) open.add(checks)
  }
  return open
}

/**
 * The goal's own ask to open its recap or play it ("Open the recap and try it: ..."): an ask of no step that names the goal's
 * recap file (`recapPath`), or an ask of the goal itself that says so; the first one, or null. It is one item of the card.
 */
export function wholeGoalAskOf(standing, goal, recapPath) {
  return standing.find(ask => {
    if (ask.of !== null && ask.of !== goal) return false
    if (!['do', 'look', 'decide'].includes(ask.asks)) return false
    const words = `${ask.title} ${ask.text}`
    return (recapPath !== null && words.includes(`demo=${recapPath}`)) || (ask.of === goal && /\bopen the recap\b|\bplay it\b/i.test(ask.title))
  }) ?? null
}

/**
 * The card, or null while nothing waits for the person's verdict. `goal` is the focus goal's id, `recapPath` its recap file (null for
 * none), `waits` where each step a recap part names stands with the person (src/recaps.mjs `recapWaitsOf`), `pictures` the file's
 * tile pictures by part key, `steps` the store's steps by id, `blocks` the goal's work blocks (the state's `parts`: each with its
 * `state` and its steps' `waitsForVerdict`/`verdictAt`), `standing` `standingAsksOf`, `openChecks` `openChecksOf`, `asked` the asks
 * routed to the recap that count (Autopilot on only: `routedAwayOf`'s recap asks).
 *
 * `{ goal, open, count, isBuilt, tiles, outside }`. Count: the recap parts waiting (rows that name steps; a part with a step still
 * being checked is no verdict yet; a part with a step of an open recap ask counts too; each part once) plus the work blocks whose
 * step waits for the person in another form (an Accept card, a look standing with them) that no counted part covers, plus the
 * goal's own "play it" ask. `tiles`: the first MOST_TILES of them in that order, each `{ title, line, picture, target }`; a target is
 * `{ path, key }` (the recap at its part), `{ step }` or `{ ask }` (that window). `open`: the recap file, else the first tile's.
 * `outside`: the ids of the recap asks whose step no counted part or block covers: the page lists those under the card.
 */
export function recapCardOf({ goal, recapPath = null, waits = [], pictures = {}, steps = new Map(), blocks = [], standing = [], openChecks = new Set(), asked = [] }) {
  const isOpenCheck = id => openChecks.has(id)
  const parts = new Map()
  for (const wait of (Array.isArray(waits) ? waits : []).filter(one => one.goal === goal && (recapPath === null || one.path === recapPath))) {
    const at = `${wait.path}\n${wait.key}`
    const part = parts.get(at) ?? { path: wait.path, key: wait.key, title: wait.title, steps: [], verdict: wait.verdict, isAsked: false }
    part.steps.push(wait.step)
    parts.set(at, part)
  }
  const covered = new Set()
  const outside = []
  for (const ask of Array.isArray(asked) ? asked : []) {
    const part = [...parts.values()].find(one => one.steps.includes(ask.of))
    if (part === undefined) outside.push(ask.id)
    else part.isAsked = true
  }
  const waitingParts = [...parts.values()].filter(part => (part.verdict === null || part.isAsked) && !part.steps.some(isOpenCheck))
  for (const part of waitingParts) for (const id of part.steps) covered.add(id)
  const scoreLine = ids => [...ids].map(id => steps.get(id)).filter(one => one !== undefined).sort((a, b) => Number(valueOf(b, 'Id').slice(1)) - Number(valueOf(a, 'Id').slice(1))).map(scoreOf).find(one => one !== null) ?? null
  const lineOf = ids => { const score = scoreLine(ids); return score === null ? TILE_LINE : `${score} · ${TILE_LINE}` }
  const tiles = waitingParts.map(part => ({ title: part.title, line: lineOf(part.steps), picture: pictures[part.key] ?? null, target: { path: part.path, key: part.key } }))
  // The blocks whose step waits for the person in a form no recap part covers.
  const askedBy = askedStepsOf(standing)
  for (const block of blocks) {
    const waiting = (block.steps ?? []).filter(one => one.waitsForVerdict === true && typeof one.verdictAt?.step === 'string' && !covered.has(one.verdictAt.step))
    if (waiting.length === 0) continue
    const ids = [...new Set(waiting.map(one => one.verdictAt.step))]
    for (const id of ids) covered.add(id)
    // The picture of the step's ask: its Accept card first, then the newest.
    const ask = ids.flatMap(id => askedBy.get(id) ?? []).sort((a, b) => Number(b.via === 'accept') - Number(a.via === 'accept') || Number(b.id.slice(1)) - Number(a.id.slice(1))).find(one => one.pictures.length > 0) ?? null
    const evidence = ids.map(id => checkedOf(steps.get(id))?.evidence).find(path => typeof path === 'string' && IMAGE.test(path)) ?? null
    tiles.push({ title: block.title, line: lineOf(ids), picture: ask?.pictures[0] ?? evidence, target: { step: ids[0] } })
  }
  // The goal's own ask: open the recap and play it.
  const whole = wholeGoalAskOf(standing, goal, recapPath)
  if (whole !== null) tiles.push({ title: 'The whole goal: play it', line: `is ${goal} reached?`, picture: whole.pictures[0] ?? null, target: recapPath !== null ? { path: recapPath } : { ask: whole.id } })
  if (tiles.length === 0) return null
  for (const ask of Array.isArray(asked) ? asked : []) if (outside.includes(ask.id) && covered.has(ask.of)) outside.splice(outside.indexOf(ask.id), 1)
  const isBuilt = (blocks ?? []).every(block => BUILT_STATES.includes(block.state)) && [...parts.values()].every(one => one.verdict === null)
  const first = tiles[0].target
  return {
    goal,
    open: recapPath !== null ? { path: recapPath } : first.path !== undefined ? { path: first.path } : first,
    count: tiles.length,
    isBuilt,
    tiles: tiles.slice(0, MOST_TILES),
    outside,
  }
}
