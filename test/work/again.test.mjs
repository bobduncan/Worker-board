// Redesign Part 2: the reconciler runs at every refresh and when a chat reports idle; calls while it runs make one more
// run after it, never two side by side and never a lost one (principle 5).

import assert from 'node:assert/strict'
import test from 'node:test'

import { coalesce } from '../../src/work/again.mjs'

test('three calls during one run make two runs in all, one after the other', async () => {
  let runs = 0
  let inside = 0
  let most = 0
  let release
  const gate = new Promise(done => { release = done })
  const run = coalesce(async () => {
    runs += 1
    inside += 1
    most = Math.max(most, inside)
    if (runs === 1) await gate
    inside -= 1
  })
  const first = run()
  const later = [run(), run(), run()]
  release()
  await Promise.all([first, ...later])
  assert.equal(runs, 2)
  assert.equal(most, 1)
  // A call once all is done runs anew.
  await run()
  assert.equal(runs, 3)
})

test('a run that throws does not stop the next', async () => {
  let runs = 0
  const run = coalesce(async () => {
    runs += 1
    if (runs === 1) throw new Error('boom')
  })
  await run()
  await run()
  assert.equal(runs, 2)
})
