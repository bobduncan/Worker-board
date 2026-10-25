// B296: the guards a flow may name in `when`, and the actions it may name in `then` (spec 2026-10-17, section 4).
// A new guard is a new name here, a few lines each. `ctx = { store: { items }, freeChats: Set, now, overlaps }`;
// `overlaps(item)` is the server's: the id of a taken step whose Touches overlap this one's, or null.

import { valueOf } from './item.mjs'
import { REST_GUARD, workingOnOther } from './parked.mjs'
import { fixesThrough, gitCheckPassed, needsResultCheck, resultCheckOf } from './resultCheck.mjs'
import { refineAsksOf } from './stepAsks.mjs'

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

/**
 * Redesign Part 2 (2026-10-25): why a refined step is not ready for a worker, in one line, or null when it is: its refine
 * is not ready, an id it is blocked by or waits for is open, words it waits for are not cleared, an ask under it with
 * Blocking yes is open, or (B309) an ask under it counts as a refine question still (open, or answered and not folded in).
 */
export function readyHold(item, ctx) {
  if (valueOf(item, 'Refined') !== 'ready') return 'its refine is not ready'
  const items = ctx.store?.items ?? new Map()
  const open = blockersOpen(item, ctx)
  if (open.length > 0) return `blocked by ${open.map(id => `${id} (${items.has(id) ? valueOf(items.get(id), 'State') : 'not in the store'})`).join(', ')}`
  if (waitWords(item) !== null) return `waits for: ${waitWords(item)}`
  const blocking = asksOf(item, ctx).filter(ask => isOpen(ask) && valueOf(ask, 'Blocking') === 'yes').map(ask => valueOf(ask, 'Id'))
  if (blocking.length > 0) return `waits for the answer to ${blocking.join(', ')}`
  const asks = refineAsksOf(items, item)
  if (asks.length === 0) return null
  const unanswered = asks.filter(one => one.answer === null).map(one => one.id)
  return unanswered.length > 0 ? `waits for the answer to ${unanswered.join(', ')}` : `waits for the partner to fold in the answer to ${asks.map(one => one.id).join(', ')}`
}

/** Redesign Part 2: a refined step the board may hand out, but for its standard and who is free (`readyHold`). */
export const isReady = (item, ctx) => readyHold(item, ctx) === null

/** Redesign Part 2: the guard of the board's give (flow.mjs DEFAULT_FLOW). */
export const GIVE_GUARD = 'the board hands it out'
/** The states whose Touches a task to give may not overlap: given (queued) or under way. */
const GIVEN_OR_UNDER_WAY = ['queued', 'taken', 'in progress', 'waiting on you']

export const GUARDS = {
  'refined is ready': item => valueOf(item, 'Refined') === 'ready',
  // Redesign Part 2 (2026-10-25): the board gives a ready task (nothing holds it: `readyHold`) whose Touches overlap no
  // step given or under way (principle 5: two refreshes cannot give two overlapping tasks).
  [GIVE_GUARD]: (item, ctx) => isReady(item, ctx) && overlapIn(ctx.store?.items ?? new Map(), item, GIVEN_OR_UNDER_WAY) === null,
  // Redesign Part 2: retired with Main's queue and the board's queue of incident fixes; kept so an older flow.json still
  // reads (its moves never hold).
  'a queue was asked before its refine': () => false,
  'an incident fix is ready': () => false,
  'Touches overlaps no taken step': (item, ctx) => (ctx.overlaps?.(item) ?? null) === null,
  // B305: the worker's own take needs only what it is blocked by resolved; Owner free is the board's delivery.
  // B306: "Blocked by" here means what the step waits for too: the ids `Waits for` names, and words not yet cleared.
  'Blocked by all done': (item, ctx) => isFree(item, ctx),
  'Blocked by all done and Owner free': (item, ctx) => {
    const owner = valueOf(item, 'Owner')
    return isFree(item, ctx) && owner !== null && (ctx.freeChats?.has(owner) ?? false)
  },
  'an ask with Blocking yes is open': (item, ctx) => asksOf(item, ctx).some(ask => isOpen(ask) && valueOf(ask, 'Blocking') === 'yes'),
  // B567: an ask under it is open; how long its worker has rested on it is the reconciler's to see (the lanes).
  [REST_GUARD]: (item, ctx) => asksOf(item, ctx).some(isOpen),
  // B567: and its worker is not on another step now: it stays parked until that one is reported.
  'its asks are answered': (item, ctx) => !asksOf(item, ctx).some(isOpen) && workingOnOther(ctx.store?.items ?? new Map(), item, ctx.prefix ?? '') === null,
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

/** The states in which a step's Touches count against another's: its worker works in them. */
export const UNDER_WAY = ['taken', 'in progress', 'waiting on you']

/**
 * The first taken or in-progress step whose Touches overlap the item's: `{ id, mine, theirs }` (the two paths, as
 * "repo path"), or null. Redesign Part 2: `states` the states that count (the hand-out counts a step given, queued, too).
 */
export function overlapIn(items, item, states = UNDER_WAY) {
  const mine = touchesOf(item)
  if (mine.length === 0) return null
  for (const other of items.values()) {
    if (other === item || valueOf(other, 'Id') === valueOf(item, 'Id') || !states.includes(valueOf(other, 'State'))) continue
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
  // Redesign Part 2: what holds a task back from the board's give, or the two overlapping paths.
  [GIVE_GUARD]: (item, ctx) => {
    const hold = readyHold(item, ctx)
    if (hold !== null) return hold
    const found = overlapIn(ctx.store?.items ?? new Map(), item, GIVEN_OR_UNDER_WAY)
    return found === null ? null : `${found.id} is ${found.state} and works in ${found.theirs}, which overlaps ${found.mine} of this step`
  },
}
