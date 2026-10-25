// B351: npm test runs the tests on at most half the PC's cores, so the PC stays usable while a chat tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { halfTheCores } from '../tools/test.mjs'

test('B351: npm test runs the tests through tools/test.mjs, on half the cores, at least one', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  // 2026-10-25: through the helper that lets one heavy run happen at a time on the PC (test/oneAtATime.test.mjs).
  assert.equal(pkg.scripts.test, 'node tools/one-at-a-time.mjs test -- node tools/test.mjs')
  assert.equal(halfTheCores(24), 12)
  assert.equal(halfTheCores(5), 2)
  assert.equal(halfTheCores(1), 1)
})
