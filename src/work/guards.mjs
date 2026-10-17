// B296: the guards a flow may name in `when`, and the actions it may name in `then` (spec 2026-10-17, section 4).
// A new guard is a new name here, a few lines each. `ctx = { store: { items }, freeChats: Set, now, overlaps }`;
// `overlaps(item)` is the server's: the id of a taken step whose Touches overlap this one's, or null.

import { valueOf } from './item.mjs'

const idsIn = value => (value ?? '').match(/\b[A-Z]\d+\b/g) ?? []
const asksOf = (item, ctx) => [...(ctx.store?.items?.values() ?? [])]
  .filter(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'Of') === valueOf(item, 'Id'))
const isOpen = ask => valueOf(ask, 'State') === 'open'

export const GUARDS = {
  'refined is ready': item => valueOf(item, 'Refined') === 'ready',
  'Touches overlaps no taken step': (item, ctx) => (ctx.overlaps?.(item) ?? null) === null,
  'Blocked by all done and Owner free': (item, ctx) => {
    const done = idsIn(valueOf(item, 'Blocked by')).every(id => {
      const other = ctx.store?.items?.get(id)
      return other !== undefined && ['done', 'dropped'].includes(valueOf(other, 'State'))
    })
    const owner = valueOf(item, 'Owner')
    return done && owner !== null && (ctx.freeChats?.has(owner) ?? false)
  },
  'an ask with Blocking yes is open': (item, ctx) => asksOf(item, ctx).some(ask => isOpen(ask) && valueOf(ask, 'Blocking') === 'yes'),
  'its asks are answered': (item, ctx) => !asksOf(item, ctx).some(isOpen),
  'the check passed and no ask of kind look is open': (item, ctx) => {
    const checks = (item.sections?.get('History') ?? []).filter(line => /\bcheck\b/i.test(line))
    return checks.length > 0 && /\bcheck passed\b/i.test(checks.at(-1)) && !asksOf(item, ctx).some(ask => isOpen(ask) && valueOf(ask, 'Asks') === 'look')
  },
}

/** The actions a move's `then` may name; the server carries them out (increment 2 and later). */
export const ACTIONS = ['wake Owner', 'notify Main', 'check: base equals remote, branch gone, result named']
