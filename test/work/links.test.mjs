// B917 (X93): the fixes and asks of every step from one index per rebuild (src/work/links.mjs), never kept across reads.
import test from 'node:test'
import assert from 'node:assert/strict'

import { linksOf, withLinks } from '../../src/work/links.mjs'
import { fixesOf } from '../../src/work/resultCheck.mjs'
import { asksOfStep } from '../../src/work/stepAsks.mjs'

const item = head => ({ head: new Map(Object.entries(head)), sections: new Map() })
const ids = list => list.map(one => one.head.get('Id'))

/** A Map that counts how often its items are walked: the old path walks them once per asking. */
class Walked extends Map {
  walks = 0
  values() {
    this.walks += 1
    return super.values()
  }
}

function store(steps = 300) {
  const items = new Walked()
  for (let n = 1; n <= steps; n++) items.set(`B${n}`, item({ Id: `B${n}`, Kind: 'step', State: 'review' }))
  // Fixes of B1 (B1001, B1003) and B2 (B1002); a dropped one counts too, as before; an ask with a Fix of is no fix.
  items.set('B1001', item({ Id: 'B1001', Kind: 'step', 'Fix of': 'B1', State: 'done' }))
  items.set('B1002', item({ Id: 'B1002', Kind: 'step', 'Fix of': 'B2' }))
  items.set('B1003', item({ Id: 'B1003', Kind: 'step', 'Fix of': 'B1', State: 'dropped' }))
  items.set('Q9', item({ Id: 'Q9', Kind: 'ask', 'Fix of': 'B1', Of: 'B1' }))
  items.set('Q3', item({ Id: 'Q3', Kind: 'ask', Of: 'B1', State: 'open' }))
  items.set('Q12', item({ Id: 'Q12', Kind: 'ask', Of: 'B2', State: 'answered' }))
  return items
}

test('inside a rebuild the fixes and asks are the same as a whole scan gives', () => {
  const items = store()
  const outside = ['B1', 'B2', 'B3'].map(id => [ids(fixesOf(id, items)), ids(asksOfStep(items, id))])
  const inside = withLinks(items, () => ['B1', 'B2', 'B3'].map(id => [ids(fixesOf(id, items)), ids(asksOfStep(items, id))]))
  assert.deepEqual(inside, outside)
  assert.deepEqual(outside[0], [['B1001', 'B1003'], ['Q3', 'Q9']])
  assert.deepEqual(outside[1], [['B1002'], ['Q12']])
  assert.deepEqual(outside[2], [[], []])
})

test('a rebuild walks the store once, not once per step (the old path walked it 600 times here)', () => {
  const items = store()
  withLinks(items, () => {
    for (const id of items.keys()) {
      fixesOf(id, items)
      asksOfStep(items, id)
    }
  })
  assert.equal(items.walks, 1)
})

test('an answer is a list of its own: sorting or emptying it changes no later answer', () => {
  const items = store()
  withLinks(items, () => {
    fixesOf('B1', items).length = 0
    asksOfStep(items, 'B1').reverse()
    assert.deepEqual(ids(fixesOf('B1', items)), ['B1001', 'B1003'])
    assert.deepEqual(ids(asksOfStep(items, 'B1')), ['Q3', 'Q9'])
  })
})

test('the index is never kept: a change after the rebuild, or a Map that grew within it, is read anew', () => {
  const items = store()
  withLinks(items, () => fixesOf('B1', items))
  items.set('B1001', item({ Id: 'B1001', Kind: 'step', 'Fix of': 'B2' }))
  assert.deepEqual(ids(fixesOf('B1', items)), ['B1003'])
  assert.equal(linksOf(items), null)
  withLinks(items, () => {
    assert.deepEqual(ids(fixesOf('B2', items)), ['B1001', 'B1002'])
    items.set('B1004', item({ Id: 'B1004', Kind: 'step', 'Fix of': 'B2' }))
    assert.deepEqual(ids(fixesOf('B2', items)), ['B1001', 'B1002', 'B1004'])
    assert.equal(linksOf(items), null)
  })
})

test('another Map, no id, or a throw inside leaves the scans as they were', () => {
  const items = store()
  const other = new Map([['B7', item({ Id: 'B7', Kind: 'step', 'Fix of': 'B1' })]])
  withLinks(items, () => {
    assert.deepEqual(ids(fixesOf('B1', other)), ['B7'])
    // No id: as before, the steps without a Fix of (a scan, not the index).
    assert.equal(fixesOf(null, items).length, 300)
  })
  assert.throws(() => withLinks(items, () => { throw new Error('mid-rebuild') }), /mid-rebuild/)
  assert.equal(linksOf(items), null)
})
