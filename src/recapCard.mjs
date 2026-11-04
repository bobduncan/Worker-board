// The recap card on the Focus page (the person, 2026-11-01: "where do i see this recap... I expected a button where is
// clearly visually i need to give a recap?", and on the mock: "i never want more then 1 row of information. if e.g. 6
// verdicts await then i want it visually to look the same, except the 3 into 6 ofcourse"): what the card shows while the focus
// goal has verdicts that wait for the person. A verdict waits in one of these forms: a part of the goal's recap (a demo row that
// names steps, src/recaps.mjs `recapWaitsOf`: read only), an Accept card of a step, a look or decide ask of a step that stands
// with the person (`standingAsksOf`), or the goal's own "open the recap / play it" ask. PURE, except `readGoalRecap`, which reads
// the goal's recap file through src/pictures.mjs `readDemo`.

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { makingOf, roundsOf } from './demoFeedback.mjs'
import { parseGoals } from './goals.mjs'
import { readDemo, shownFolders, shownRoots } from './pictures.mjs'
import { linksRecap, standsForPerson } from './work/autopilot.mjs'
import { isKeptLook } from './work/keptLook.mjs'
import { sinceMs, valueOf } from './work/item.mjs'
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
/** The asks a kept look can be: a look, or an own-senses do the main chat or the partner handed on (src/work/keptLook.mjs). */
const KEPT_ASKS = ['look', 'do']
/** The advice on a look's tile is cut at this many characters (it is one small line). */
const LOOK_ADVICE_MOST = 60

/** The small line of a look's tile: "a look · advised: yes", or "a look" without advice. */
export function lookLineOf(advice) {
  const words = String(advice ?? '').replace(/\s+/g, ' ').trim()
  if (words === '') return 'a look'
  return `a look · advised: ${words.length <= LOOK_ADVICE_MOST ? words : `${words.slice(0, LOOK_ADVICE_MOST).replace(/\s+\S*$/, '')}…`}`
}

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
 * The focus goal's recap for the card: `{ goal, path, pictures: { <part key>: <picture path> }, rounds, changedAt }`, or null for a goal
 * with no recap file. A part whose row has no picture is left out of `pictures` (its tile shows a calm placeholder). T17.1: `rounds`
 * the person's rounds beside it and `changedAt` when it was last written (ms), by which `recapMakingOf` says the next round is being made.
 */
export async function readGoalRecap(config, goalsText) {
  const path = await focusRecapFile(config, goalsText)
  if (path === null) return null
  const goals = parseGoals(goalsText)
  const read = await readDemo(config.project, shownRoots(config), path).catch(() => null)
  const rows = read === null || read.why !== undefined ? [] : read.base.sections.flatMap(section => section.rows)
  return {
    goal: goals.focus, path, pictures: Object.fromEntries(rows.map(row => [row.key, tilePictureOf(row.pictures)]).filter(([, picture]) => picture !== null)),
    rounds: read === null || read.why !== undefined ? [] : roundsOf(read.feedback), changedAt: read?.changedAt ?? null,
  }
}

const STAMP = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s/

/** When a step was made: its first History stamp, else its Since (ms; NaN when neither says). */
const madeAtMs = item => sinceMs((item.sections?.get('History') ?? [])[0]?.match(STAMP)?.[1] ?? valueOf(item, 'Since'))

/** A History line that moves a step out of a finished state to an open one: "done → in progress". */
const REOPENED = /\b(?:done|closed|dropped) → (?!done\b|closed\b|dropped\b)/

/** Whether a step was reopened at or after `at` (ms): a History line of that time that moves it out of a finished state. */
const isReopenedSince = (item, at) => (item.sections?.get('History') ?? []).some(line => REOPENED.test(line) && sinceMs(line.match(STAMP)?.[1]) >= at)

/**
 * T17.1 (the coordinator's review of 6f197a4): the goal's next tries for a Send at `at` (ms): its steps filed or reopened at or after the
 * Send's minute, leaving out Quality Assurance tasks (they carry `Checks`: they check a try, they are none). Item order.
 */
export const nextTriesOf = (items, goal, at) => [...(items?.values?.() ?? [])]
  .filter(item => valueOf(item, 'Kind') === 'step' && valueOf(item, 'Goal') === goal && valueOf(item, 'Checks') === null && (madeAtMs(item) >= at || isReopenedSince(item, at)))

/**
 * T17.1 (the person, 2026-11-02, after sending round 1 of G60's recap: "the new recap, after round 1 is not finetuned to my feedback"):
 * the focus goal's recap while its next round is being made (src/demoFeedback.mjs `makingOf`: a Send sent rows back and the recap was not
 * written again since): `{ goal, path, round, done, total, doneSteps }`, or null. `recap` is the state's `goalRecap`, `items` the store's
 * by id. The next tries are `nextTriesOf` the Send; `done` counts those done, closed or dropped of all (`total`), `doneSteps` the ids of
 * those that are done (the board tells the partner once for each: server.mjs `recapRoundNow`). It asks no verdict of the person, so it is
 * no card of the recap card and counts nowhere.
 */
export function recapMakingOf({ goal, recap, items }) {
  if (typeof goal !== 'string' || recap === null || typeof recap !== 'object' || recap.goal !== goal) return null
  const making = makingOf(Array.isArray(recap.rounds) ? recap.rounds : [], recap.changedAt)
  if (making === null) return null
  const mine = nextTriesOf(items, goal, making.at)
  return {
    goal, path: typeof recap.path === 'string' ? recap.path : null, round: making.round,
    done: mine.filter(item => FINISHED.includes(valueOf(item, 'State'))).length, total: mine.length,
    doneSteps: mine.filter(item => valueOf(item, 'State') === 'done').map(item => valueOf(item, 'Id')),
  }
}

/**
 * T17.1: the next tries of a round being made (`making`, the state's `recapMaking`) that turned done and the board has not told the
 * partner of yet: once for each step, however often the pass runs, and again after a restart (`outbox`: the board's words, kept).
 */
export const recapRoundDue = (making, outbox) => (making?.doneSteps ?? []).filter(step => !(Array.isArray(outbox) ? outbox : []).some(one => one?.command === 'recap-round' && one.about === making.goal && one.step === step))

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
    // A look the partner handed over that Autopilot keeps for the recap stands for no verdict (2026-11-02): it makes no block wait, it
    // is no reason for the card; the card lists it only beside another reason (`recapCardOf`, `asked`).
    if (isKeptLook(item)) continue
    const route = valueOf(item, 'Route')
    if (!(route === 'recap' ? ctx.autopilot === true : standsForPerson(item, { ...ctx, items }))) continue
    found.push({
      id: valueOf(item, 'Id'), of: valueOf(item, 'Of'), asks: valueOf(item, 'Asks') ?? 'decide', route, via: valueOf(item, 'Via'),
      options: String(valueOf(item, 'Options') ?? '').split(' | ').map(one => one.trim()).filter(Boolean),
      title: String(valueOf(item, 'Title') ?? ''), text: (item.sections?.get('Text') ?? []).join(' '),
      pictures: String(valueOf(item, 'Pictures') ?? '').split(',').map(one => one.trim()).filter(Boolean),
    })
  }
  return found
}

/** Whether an ask is the person's verdict on a result: a look, an Accept card, or a decide whose options approve, accept or keep it against sending it back. */
export function isVerdictAsk(ask) {
  if (ask.asks === 'look' || ask.via === 'accept') return true
  if (ask.asks !== 'decide') return false
  const options = ask.options ?? []
  return options.some(one => /\b(?:approve|accept|keep)\b/i.test(one)) && options.some(one => /\bsen[dt]\b[^|]*\bback\b|\breject\b/i.test(one))
}

/**
 * The asks of steps that stand with the person and are a verdict on a result (`isVerdictAsk`: a look, an Accept card, a decide
 * between approving and sending back), by the step: `Map(step id → asks)`. A worker's own question mid-build is none.
 */
export function askedStepsOf(standing) {
  const by = new Map()
  for (const ask of standing) {
    if (!/^B\d+$/.test(ask.of ?? '') || !isVerdictAsk(ask)) continue
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
    return linksRecap(words, recapPath) || (ask.of === goal && /\bopen the recap\b|\bplay it\b/i.test(ask.title))
  }) ?? null
}

/**
 * The card, or null while nothing waits for the person's verdict. `goal` is the focus goal's id, `recapPath` its recap file (null for
 * none), `waits` where each step a recap part names stands with the person (src/recaps.mjs `recapWaitsOf`), `pictures` the file's
 * tile pictures by part key, `steps` the store's steps by id, `blocks` the goal's work blocks (the state's `parts`: each with its
 * `state` and its steps' `waitsForVerdict`/`verdictAt`), `standing` `standingAsksOf`, `openChecks` `openChecksOf`, `asked` the asks
 * routed to the recap that count (Autopilot on only: `routedAwayOf`'s recap asks). One of them with no step whose words link the
 * recap file is the goal's own ask (2026-11-02, Autopilot moved "Open the recap and try it" into the recap): the first of them
 * makes the "play it" tile like a standing one; every further one is an ask outside the card, listed under it.
 *
 * `{ goal, open, count, isBuilt, tiles, looks, outside }`. Count: the recap parts waiting (rows that name steps; a part with a step still
 * being checked is no verdict yet; a part with a step of an open recap ask counts too; each part once) plus the work blocks whose
 * step waits for the person in another form (an Accept card, a look standing with them) that no counted part covers, plus the
 * goal's own "play it" ask. `tiles`: the first MOST_TILES of them in that order, each `{ title, line, picture, target }`; a target is
 * `{ path, key }` (the recap at its part), `{ step }` or `{ ask }` (that window). `open`: the recap file, else the first tile's.
 * `outside`: the ids of the recap asks whose step no counted part or block covers: the page lists those under the card.
 *
 * A kept look (the person's "A", 2026-11-02, the live Q590: a look the partner handed to the person that Autopilot keeps for the
 * recap; `isKept` on its `asked` entry, src/work/keptLook.mjs): every kept look of a step that no recap PART names is a tile of its
 * own, after the others, whether or not a block covers the step (a block's tile is the step's card, not this look): its title, the
 * line "a look · advised: <advice>" (or "a look"), its first picture, and the target `{ ask }`, the window where the person answers
 * it. It counts, and it is no ask `outside`. `looks` holds all of them (the page's Product owner card names every one; `tiles` only
 * the first MOST_TILES of everything). The coordinator's ruling the same day: a kept look raises no "your recap is ready" mid-goal;
 * it makes no block wait for a verdict (`standingAsksOf` leaves it out) and is no reason of its own: its tile counts and shows only
 * while the card has another reason to show (a part, a block or the goal's own ask waits) or every block of the goal is built (a step
 * in review held only by its kept look counts as built: the goal's last kept look would otherwise never show).
 * Every other look routed to the recap (a checker's, one below its target) stays an ask `outside` when no part covers it.
 *
 * T17.1: while the focus goal's recap has its next round being made (`making`, `recapMakingOf`, or a wait of the recap that says `making`)
 * there is no card at all: the result is null and the page draws the quiet "round N+1 is being made" card in its place, whatever else
 * waits for the person.
 */
export function recapCardOf({ goal, recapPath = null, waits = [], pictures = {}, steps = new Map(), blocks = [], standing = [], openChecks = new Set(), asked = [], making = null }) {
  // T17.1 (the coordinator's ruling): no card of verdicts while the goal's recap has its next round being made, whatever else waits: the
  // page draws the quiet "round N+1 is being made" card in its place (`making`: `recapMakingOf`, or a wait of the recap says so).
  if (making !== null || (Array.isArray(waits) ? waits : []).some(wait => wait.goal === goal && wait.making === true && (recapPath === null || wait.path === recapPath))) return null
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
  // The goal's own ask: the first standing one, else the first routed to the recap (it has no step); only that one is a tile.
  const whole = wholeGoalAskOf([...standing, ...(Array.isArray(asked) ? asked : []).filter(ask => ask.of === null).map(ask => ({ ...ask, asks: ask.asks ?? 'do' }))], goal, recapPath)
  for (const ask of Array.isArray(asked) ? asked : []) {
    if (whole !== null && ask.id === whole.id) continue
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
  if (whole !== null) tiles.push({ title: 'The whole goal: play it', line: `is ${goal} reached?`, picture: whole.pictures[0] ?? null, target: recapPath !== null ? { path: recapPath } : { ask: whole.id } })
  // A kept look no recap part covers is a tile of its own, also when a block covers its step; it is no ask outside.
  // (`isKept` says it: a look, or since the person's "Yes, clear them" of 2026-11-04 an own-senses do that the main chat or the partner
  // handed on, src/work/keptLook.mjs.)
  const keptLooks = (Array.isArray(asked) ? asked : []).filter(ask => ask.isKept === true && KEPT_ASKS.includes(ask.asks) && /^B\d+$/.test(ask.of ?? '') && outside.includes(ask.id))
  for (const ask of keptLooks) outside.splice(outside.indexOf(ask.id), 1)
  for (const ask of Array.isArray(asked) ? asked : []) if (outside.includes(ask.id) && covered.has(ask.of)) outside.splice(outside.indexOf(ask.id), 1)
  // A block is built when its state says so, or when what is left of it is a step in review held only by its kept look (nothing else of it
  // is open: no check, no failed check, no other ask): that step is built, and only the person's answer to the look is missing. Else the
  // goal's last kept look could never show on the card.
  const keptSteps = new Set((Array.isArray(asked) ? asked : []).filter(ask => ask.isKept === true && KEPT_ASKS.includes(ask.asks) && /^B\d+$/.test(ask.of ?? '')).map(ask => ask.of))
  const hasOtherAsk = id => [...(Array.isArray(standing) ? standing : []), ...(Array.isArray(asked) ? asked : [])].some(ask => ask.of === id && ask.isKept !== true)
  const isHeldByKept = step => keptSteps.has(step.id) && steps.get(step.id) !== undefined && valueOf(steps.get(step.id), 'State') === 'review' && !isOpenCheck(step.id) && step.isFailed !== true && !hasOtherAsk(step.id)
  const isBlockBuilt = block => BUILT_STATES.includes(block.state)
    || ((block.steps ?? []).some(isHeldByKept) && (block.steps ?? []).every(step => ['done', 'stop'].includes(step.tone) || isHeldByKept(step)))
  const isAllBuilt = (blocks ?? []).every(isBlockBuilt)
  const looks = tiles.length > 0 || isAllBuilt
    ? keptLooks.map(ask => ({ title: ask.title, line: lookLineOf(ask.advice), picture: ask.pictures?.[0] ?? null, target: { ask: ask.id } }))
    : []
  tiles.push(...looks)
  if (tiles.length === 0) return null
  const isBuilt = isAllBuilt && [...parts.values()].every(one => one.verdict === null)
  const first = tiles[0].target
  return {
    goal,
    open: recapPath !== null ? { path: recapPath } : first.path !== undefined ? { path: first.path } : first,
    count: tiles.length,
    isBuilt,
    tiles: tiles.slice(0, MOST_TILES),
    looks,
    outside,
  }
}
