// B296: the guards a flow may name in `when`, and the actions it may name in `then` (spec 2026-10-17, section 4).
// A new guard is a new name here, a few lines each. `ctx = { store: { items }, freeChats: Set, now, overlaps }`;
// `overlaps(item)` is the server's: the id of a taken step whose Touches overlap this one's, or null.

import { AUTO_QUEUE_GUARD, isIncidentFix } from './incidentFix.mjs'
import { valueOf } from './item.mjs'
import { fixesThrough, gitCheckPassed, needsResultCheck, resultCheckOf } from './resultCheck.mjs'
import { openAsksOf, refineAsksOf } from './stepAsks.mjs'

const idsIn = value => (value ?? '').match(/\b[A-Z]\d+\b/g) ?? []
const asksOf = (item, ctx) => [...(ctx.store?.items?.values() ?? [])]
  .filter(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'Of') === valueOf(item, 'Id'))
const isOpen = ask => valueOf(ask, 'State') === 'open'
/** B305: what a step's `Blocked by` names no longer holds it: a step done or dropped, an ask answered or withdrawn. */
export const CLEARED = ['done', 'dropped', 'answered', 'withdrawn']
/** B306: the steps and asks a step's `Waits for` names (B<n>, Q<n>); its other words are only what they wait for. */
export const waitIds = item => (valueOf(item, 'Waits for') ?? '').match(/\b[BQ]\d+\b/g) ?? []
/** B306: the words of a `Waits for` that names no id: they hold the step until the main chat or the person clears them. */
export const waitWords = item => (waitIds(item).length === 0 ? valueOf(item, 'Waits for') : null)
/**
 * The ids the step's `Blocked by` and (B306) `Waits for` name that still hold it (one the store does not hold counts
 * as open).
 */
export const blockersOpen = (item, ctx) => [...new Set([...idsIn(valueOf(item, 'Blocked by')), ...waitIds(item)])].filter(id => {
  const other = ctx.store?.items?.get(id)
  return other === undefined || !CLEARED.includes(valueOf(other, 'State'))
})
/** B306: nothing holds the step: no id it is blocked by or waits for is open, and no words wait to be cleared. */
const isFree = (item, ctx) => blockersOpen(item, ctx).length === 0 && waitWords(item) === null

export const GUARDS = {
  'refined is ready': item => valueOf(item, 'Refined') === 'ready',
  // B303: the main chat (or the person) asked to queue it before its refine: the board queues it once it is refined.
  // B309: and once no ask under it is open, nor answered and not yet folded in by the Advisor.
  'a queue was asked before its refine': (item, ctx) => valueOf(item, 'Queue when refined') !== null
    && openAsksOf(ctx.store?.items, valueOf(item, 'Id'), item).length === 0 && refineAsksOf(ctx.store?.items, item).length === 0,
  // Incident fixes (2026-10-24, the person's choice B): a refined board fix an incident waits on, never queued before,
  // nothing holding it, no ask under it open or not folded in: the board queues it itself (incidentFix.mjs). The
  // review: and, as for the main chat's queue, its Touches overlap no taken step's.
  [AUTO_QUEUE_GUARD]: (item, ctx) => isIncidentFix(item, ctx.store?.items ?? new Map()) && isFree(item, ctx)
    && openAsksOf(ctx.store?.items, valueOf(item, 'Id'), item).length === 0 && refineAsksOf(ctx.store?.items, item).length === 0
    && (ctx.overlaps?.(item) ?? null) === null,
  'Touches overlaps no taken step': (item, ctx) => (ctx.overlaps?.(item) ?? null) === null,
  // B305: the worker's own take needs only what it is blocked by resolved; Owner free is the board's delivery.
  // B306: "Blocked by" here means what the step waits for too: the ids `Waits for` names, and words not yet cleared.
  'Blocked by all done': (item, ctx) => isFree(item, ctx),
  'Blocked by all done and Owner free': (item, ctx) => {
    const owner = valueOf(item, 'Owner')
    return isFree(item, ctx) && owner !== null && (ctx.freeChats?.has(owner) ?? false)
  },
  'an ask with Blocking yes is open': (item, ctx) => asksOf(item, ctx).some(ask => isOpen(ask) && valueOf(ask, 'Blocking') === 'yes'),
  'its asks are answered': (item, ctx) => !asksOf(item, ctx).some(isOpen),
  // B356: "the check" is the board's own, and for a step with agreed points or a Standard line also the result check
  // by a helper that did not build it (resultCheck.mjs), on a board with a partner to make it.
  'the check passed and no ask of kind look is open': (item, ctx) => gitCheckPassed(item)
    && (!needsResultCheck(item) || ctx.hasPartner === false || resultCheckOf(item) === 'passed' || fixesThrough(item, ctx.store?.items))
    && !asksOf(item, ctx).some(ask => isOpen(ask) && valueOf(ask, 'Asks') === 'look'),
}

/** The actions a move's `then` may name; the server carries them out (increment 2 and later). */
export const ACTIONS = ['wake Owner', 'notify Main', 'check: base equals remote, branch gone, result named']

/** B378: a bare test folder never overlaps on its own: every step has tests. */
const TEST_FOLDERS = new Set(['test', 'tests'])
/** B378: a word that names a repository before its paths ("worker-board src"): a folder name with a hyphen, no dot. */
const isRepoWord = word => /^[a-z0-9][\w]*(?:-[\w]+)+$/i.test(word)
/** B378: a word that is a path: one with a slash, or a file with its extension; a lone word only when it is all there is. */
const isPathWord = (word, isAlone) => word.includes('/') || /\.[a-z0-9]{1,8}$/i.test(word) || (isAlone && /^[\w.-]+$/.test(word))
/** B378: a path as one writes it, made comparable: forward slashes, no "./", no line number, no closing stop or slash. */
const pathOf = word => word.replace(/\\/g, '/').replace(/^\.\//, '').replace(/[.,:;]+$/, '').replace(/:\d+(?::\d+)?$/, '').replace(/\/+$/, '')

/**
 * B378: the paths a step's "Touches:" lines name (under Context or a Touches section), read as paths: `{ repo, path }`.
 * The words around a path are not one ("src/run (the end screens)", "public art for the two screens"): a part's first
 * path is its path. A part's first word names a repository when a path follows it ("my-game src/menu/mainMenu.ts"),
 * for that part and the rest of the line until another is named; a line without one has repo null, which matches any.
 * A bare test folder is left out.
 */
export function touchesOf(item) {
  const lines = [...(item.sections.get('Context') ?? []), ...(item.sections.get('Touches') ?? []).map(one => `Touches: ${one}`)]
  return lines.flatMap(one => {
    const said = one.trim().match(/^Touches:\s*(.*)$/)?.[1]
    if (said === undefined) return []
    let repo = null
    // Parentheses hold words, nested ones too.
    let plain = said
    while (/\([^()]*\)/.test(plain)) plain = plain.replace(/\([^()]*\)/g, ' ')
    return plain.split(/[,;]\s*|\s+and\s+/).flatMap(part => {
      const words = part.replace(/^\s*(?:[-*]\s+|and\s+)/, '').replace(/`/g, '').trim().split(/\s+/).filter(Boolean)
      if (words.length >= 2 && isRepoWord(words[0].replace(/:$/, ''))) repo = words.shift().replace(/:$/, '')
      const path = words.map(pathOf).find(word => word !== '' && isPathWord(word, words.length === 1))
      if (path === undefined || TEST_FOLDERS.has(path)) return []
      return [{ repo, path }]
    })
  })
}

/** B378: two paths overlap when they are one, or one is a folder that holds the other, in the same repository. */
const covers = (a, b) => (a.repo === null || b.repo === null || a.repo === b.repo)
  && (a.path === b.path || b.path.startsWith(`${a.path}/`) || a.path.startsWith(`${b.path}/`))
const named = touch => (touch.repo === null ? touch.path : `${touch.repo} ${touch.path}`)

/**
 * The first taken or in-progress step whose Touches overlap the item's: `{ id, mine, theirs }` (the two paths, as
 * "repo path"), or null.
 */
export function overlapIn(items, item) {
  const mine = touchesOf(item)
  if (mine.length === 0) return null
  for (const other of items.values()) {
    if (other === item || valueOf(other, 'Id') === valueOf(item, 'Id') || !['taken', 'in progress', 'waiting on you'].includes(valueOf(other, 'State'))) continue
    for (const theirs of touchesOf(other)) {
      const own = mine.find(one => covers(one, theirs))
      if (own !== undefined) return { id: valueOf(other, 'Id'), state: valueOf(other, 'State'), mine: named(own), theirs: named(theirs) }
    }
  }
  return null
}

/**
 * The flow's `overlaps` for the server: the id of a taken or in-progress step whose Touches name a path the item's
 * Touches name too (a folder covers what is in it), or null. B378: `.why(item)` says which two paths.
 */
export function overlapsIn(items) {
  const overlaps = item => overlapIn(items, item)?.id ?? null
  overlaps.why = item => {
    const found = overlapIn(items, item)
    return found === null ? null : `${found.id} is ${found.state} and works in ${found.theirs}, which overlaps ${found.mine} of this step`
  }
  return overlaps
}

/** B378: what a guard that does not hold adds to the refusal, when it can say more than its name. */
export const GUARD_WHY = {
  'Touches overlaps no taken step': (item, ctx) => ctx.overlaps?.why?.(item) ?? null,
}
