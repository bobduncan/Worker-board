// F46: a build of the board's state walked every item for each step's held asks, and every word for each step's refine word. Both
// now come from an index made once per build; what the build answers stays the same. A made-up store.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { newestRefines, refineAsk } from '../../src/work/askOpen.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { withLinks } from '../../src/work/links.mjs'
import { itemOfStep } from '../../src/work/read.mjs'

const step = id => parseItem([`Id: ${id}`, 'Kind: step', `Title: Step ${id}`, 'State: new', '', '## History', '- 2026-11-23 10:00 Board: made'].join('\n'))
const ask = (id, of, { state = 'open', route = 'asker' } = {}) => parseItem([
  `Id: ${id}`, 'Kind: ask', `Title: Ask ${id}`, `State: ${state}`, `Of: ${of}`, `Route: ${route}`, '',
  '## Route', `held from person: your words at 10:0${id.length} may change this (chat 1)`, '', '## History', '- 2026-11-23 10:00 Board: asked',
].join('\n'))

function store() {
  const items = new Map([
    ['Q9', ask('Q9', 'B1')], ['B1', step('B1')], ['Q2', ask('Q2', 'B2')], ['Q5', ask('Q5', 'B1')],
    ['Q6', ask('Q6', 'B1', { state: 'answered' })], ['Q7', ask('Q7', 'B1', { route: 'person' })], ['B2', step('B2')], ['B3', step('B3')], ['Q1', ask('Q1', 'B1')],
  ])
  return { ok: true, items, activities: [{ name: 'Board', steps: ['B1', 'B2', 'B3'] }] }
}

test('a step\'s held asks are the same inside a build (the index) and outside it (the scan), in the store\'s order', () => {
  const work = store()
  for (const id of ['B1', 'B2', 'B3']) {
    const scanned = itemOfStep(work, id)
    const indexed = withLinks(work.items, () => itemOfStep(work, id))
    assert.deepEqual(indexed, scanned, id)
  }
  assert.deepEqual(withLinks(work.items, () => itemOfStep(work, 'B1')).heldAsks.map(one => one.id), ['Q9', 'Q5', 'Q1'])
  assert.deepEqual(withLinks(work.items, () => itemOfStep(work, 'B3')).heldAsks, [])
})

test('an index never outlives a change of the store: an ask added within a build is seen, and the next build starts anew', () => {
  const work = store()
  withLinks(work.items, () => {
    assert.equal(itemOfStep(work, 'B3').heldAsks.length, 0)
    work.items.set('Q8', ask('Q8', 'B3'))
    assert.deepEqual(itemOfStep(work, 'B3').heldAsks.map(one => one.id), ['Q8'], 'the Map changed size: back to the scan')
  })
  assert.deepEqual(withLinks(work.items, () => itemOfStep(work, 'B3')).heldAsks.map(one => one.id), ['Q8'])
})

test('the newest refine word per step answers as sent.findLast does, for every step and state', () => {
  const NOW = Date.parse('2026-11-23T12:00:00Z')
  const word = (about, at, state, extra = {}) => ({ command: 'refine', about, at: NOW - at * 60_000, state, ...extra })
  const sent = [
    word('B1', 90, 'delivered'), { command: 'start', about: 'B1', at: NOW, state: 'waiting' }, word('B2', 5, 'waiting', { round: 2 }), word('B1', 10, 'delivered', { round: 3 }),
    word('B3', 50, 'taken', { takenAt: NOW - 50 * 60_000 }), { command: 'refine', about: null, at: NOW, state: 'waiting' }, { command: 'wake', about: 'B4', at: NOW, state: 'waiting' },
  ]
  const newest = newestRefines(sent)
  for (const id of ['B1', 'B2', 'B3', 'B4', 'B5']) {
    assert.equal(newest.get(id), sent.findLast(one => one.command === 'refine' && one.about === id), id)
    for (const status of ['new', 'done', 'progress']) {
      for (const openMs of [undefined, Infinity]) {
        const one = { id, status, refined: null }
        assert.deepEqual(refineAsk(one, sent, NOW, openMs, newest), refineAsk(one, sent, NOW, openMs), `${id} ${status} ${openMs}`)
      }
    }
  }
  assert.equal(refineAsk({ id: null }, sent, NOW, undefined, newest), null)
  assert.equal(refineAsk({ id: 'B1', status: 'new', refined: null }, sent, NOW).round, 3, 'the callers without an index as before')
})

test('the build makes the index once, for each list, and passes it to every caller', () => {
  const state = readFileSync(new URL('../../src/state.mjs', import.meta.url), 'utf8')
  assert.equal(state.match(/newestRefines\(/g).length, 2)
  assert.doesNotMatch(state, /\.findLast\(one => one\.command === 'refine'/)
  assert.equal(state.match(/refineAsk\(step, sent, now, (?:Infinity|undefined), newestSent\)/g).length, 2)
  assert.equal(state.match(/refineAsk\(step, stepWords, now, undefined, newestWords\)/g).length, 1)
})
