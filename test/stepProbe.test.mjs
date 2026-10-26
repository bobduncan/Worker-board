// B695: the step probe compares the Focus page's part card with option B: each measure within 2 px, a missing one counts.

import assert from 'node:assert/strict'
import test from 'node:test'

import { differences } from '../tools/step-probe.mjs'

test('B695: the probe names the measures more than 2 px apart', () => {
  const option = { 'bar to count': 18, 'stopped block height': 12, 'done block height': null }
  assert.deepEqual(differences(option, { 'bar to count': 20, 'stopped block height': 12, 'done block height': null }), [])
  assert.deepEqual(differences(option, { 'bar to count': 28, 'stopped block height': 8, 'done block height': null }), ['bar to count', 'stopped block height'])
  // a box one page has and the other lacks is a difference
  assert.deepEqual(differences(option, { 'bar to count': 18, 'stopped block height': 12, 'done block height': 12 }), ['done block height'])
})

test('B700: the probe judges text sizes, weights and line heights as equal, not within 2 px', () => {
  const option = { 'count line font size': 14, 'step title weight': 400 }
  assert.deepEqual(differences(option, { 'count line font size': 14.2, 'step title weight': 400 }), [])
  assert.deepEqual(differences(option, { 'count line font size': 12.5, 'step title weight': 400 }), ['count line font size'])
  assert.deepEqual(differences(option, { 'count line font size': 14, 'step title weight': 600 }), ['step title weight'])
})
