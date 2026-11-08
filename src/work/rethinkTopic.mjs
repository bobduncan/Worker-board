// Stop and rethink a topic (docs/stop-and-rethink.md): which steps a topic of a goal holds. PURE. Apart from rethink.mjs, which the
// readers of `Waits for` import, because this one reads resultCheck.mjs (a cycle otherwise).

import { valueOf } from './item.mjs'
import { plainTitle } from './rethink.mjs'
import { fixRootsOf, fixesOf } from './resultCheck.mjs'

/** Whether the item is a step of the work (not a Quality Assurance task: its `Checks` names the step it checks). */
const isWorkStep = item => item?.head !== undefined && valueOf(item, 'Kind') === 'step' && valueOf(item, 'Checks') === null
const CHAIN_MAX = 200

/** `seeds` and every fix under them (`Fix of`, down), only steps of the work, in the order found. */
function withFixes(seeds, items) {
  const found = []
  const seen = new Set()
  for (const seed of seeds) {
    if (!isWorkStep(items.get(seed))) continue
    const queue = [seed]
    for (let at = 0; at < queue.length && seen.size < CHAIN_MAX; at += 1) {
      if (seen.has(queue[at])) continue
      seen.add(queue[at])
      found.push(queue[at])
      for (const fix of fixesOf(queue[at], items)) if (isWorkStep(fix)) queue.push(valueOf(fix, 'Id'))
    }
  }
  return found
}

/** The title of a fix chain: its first step's title, no ids, cut at 60 characters. */
const triesTitle = (root, items) => `the tries of ${plainTitle(valueOf(items.get(root), 'Title') ?? '').slice(0, 60).trim()}`

/**
 * The topic of a goal: `{ ok, title, kind, steps }` or `{ ok: false, why }`. `node` the goal (its `parts`: `{ title, steps }`),
 * `items` the store's items by id, `rows` the recaps' rows (`{ steps }`), and what the person named: `title` (a part's title, or
 * "the tries of ...") and/or `of` (a step of the topic). The topic is the how's part that names `of` or a step up its fix chain
 * (its title as the goal writes it), else the fix chain of `of` ("the tries of <the first step's title>"); its steps are the part's steps and every
 * fix under them, or the chain, plus the steps of a recap row that names one of them.
 */
export function topicOf({ node, items, rows = [], title = null, of = null }) {
  const parts = node?.parts ?? []
  const named = typeof title === 'string' && title.trim() !== '' ? title.trim() : null
  const place = named === null ? -1 : parts.findIndex(part => part.title === named)
  const step = typeof of === 'string' && /^B\d+$/.test(of) && isWorkStep(items.get(of)) ? of : null
  let seeds
  let found
  if (place >= 0) {
    found = { title: parts[place].title, kind: 'part' }
    seeds = parts[place].steps
  } else if (step !== null) {
    const up = [step, ...fixRootsOf(step, items)]
    const inPart = parts.findIndex(part => up.some(id => part.steps.includes(id)))
    if (inPart >= 0) {
      found = { title: parts[inPart].title, kind: 'part' }
      seeds = parts[inPart].steps
    } else {
      found = { title: triesTitle(up.at(-1), items), kind: 'chain' }
      seeds = [up.at(-1)]
    }
  } else {
    return { ok: false, why: named === null ? 'Name the goal and a step of the topic.' : `${named} is no part of this goal's how: name a step of the topic in "of".` }
  }
  const steps = withFixes(seeds, items)
  // The steps of a recap row that names one of them: the row is the same piece of work.
  const given = new Set(steps)
  for (const row of rows ?? []) {
    if (!(row.steps ?? []).some(id => given.has(id))) continue
    for (const id of row.steps) if (isWorkStep(items.get(id)) && !given.has(id)) { given.add(id); steps.push(id) }
  }
  return { ok: true, ...found, steps }
}

/** The states of a step that is finished: not open. */
const ENDED = ['done', 'dropped', 'closed']

/**
 * The topics the Focus page lists to stop and rethink: each part of the goal's how with its open steps, then each open fix chain of
 * the goal that no part holds ("the tries of <the first step's title>"). `{ title, kind, steps: [{ id, title, state, owner }] }`; only a topic with an
 * open step. `steps` the store's steps by id (a Map), `prefix` the chats' prefix, `titleOf` how a step's title reads.
 */
export function rethinkTopicsOf(node, steps, { prefix = '', titleOf = item => valueOf(item, 'Title') ?? '' } = {}) {
  const row = id => {
    const item = steps.get(id)
    return { id, title: String(titleOf(item)).replace(/\s+/g, ' ').trim(), state: valueOf(item, 'State'), owner: String(valueOf(item, 'Owner') ?? '').replace(prefix, '').trim() || null }
  }
  const open = ids => ids.filter(id => !ENDED.includes(valueOf(steps.get(id), 'State'))).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map(row)
  const topics = []
  const covered = new Set()
  for (const part of node?.parts ?? []) {
    const found = topicOf({ node, items: steps, title: part.title })
    if (!found.ok) continue
    for (const id of found.steps) covered.add(id)
    const list = open(found.steps)
    if (list.length > 0) topics.push({ title: found.title, kind: 'part', steps: list })
  }
  const roots = new Map()
  for (const [id, item] of steps) {
    if (!isWorkStep(item) || valueOf(item, 'Goal') !== node?.id || covered.has(id) || ENDED.includes(valueOf(item, 'State'))) continue
    const root = fixRootsOf(id, steps).at(-1) ?? id
    if (!covered.has(root) && !roots.has(root)) roots.set(root, topicOf({ node, items: steps, of: root }))
  }
  for (const found of roots.values()) {
    // A fix chain has a try after its first step; a step alone is no chain.
    const list = found.ok && found.kind === 'chain' && found.steps.length > 1 ? open(found.steps) : []
    if (list.length > 0) topics.push({ title: found.title, kind: 'chain', steps: list })
  }
  return topics
}
