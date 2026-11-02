// B917 (X93: on 2026-11-02 the live board spent 67% of a core, work calls answered after up to 48 s): every rebuild of
// the board's state asked each step for its fixes (`Fix of`) and its asks (`Of`), and each asking scanned all 3000 items,
// about 110 s of every 600. Within one rebuild the store does not change, so the links are indexed once per rebuild:
// `withLinks(items, work)` runs `work` (synchronous) with an index of that Map, made on first use and dropped when
// `work` returns, never kept across reads. Outside it, or for another Map, or once the Map's size changed, the callers
// scan as before. PURE but for the one scope.

import { valueOf } from './item.mjs'

let scope = null

/** `work()` with the links of `items` indexed while it runs; a call inside another keeps the outer scope. */
export function withLinks(items, work) {
  if (scope !== null || !(items instanceof Map)) return work()
  scope = { items, size: items.size, index: null }
  try {
    return work()
  } finally {
    scope = null
  }
}

/** One walk of the store: the steps by their `Fix of`, the asks by their `Of`. */
function indexOf(items) {
  const index = { fixes: new Map(), asks: new Map() }
  const add = (by, to, item) => {
    if (to === null) return
    if (!by.has(to)) by.set(to, [])
    by.get(to).push(item)
  }
  for (const item of items.values()) {
    const kind = valueOf(item, 'Kind')
    if (kind === 'step') add(index.fixes, valueOf(item, 'Fix of'), item)
    else if (kind === 'ask') add(index.asks, valueOf(item, 'Of'), item)
  }
  return index
}

/**
 * The index of `items` in the running scope, `{ fixes, asks }` (each `id → items`, in the Map's order), or null: no
 * scope, another Map, or the Map grew or shrank since the scope began.
 */
export function linksOf(items) {
  if (scope === null || scope.items !== items || items.size !== scope.size) return null
  scope.index ??= indexOf(items)
  return scope.index
}
