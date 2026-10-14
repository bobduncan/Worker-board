// B136: package.json says which Node the board needs and how to start, demo and test it; the README uses those
// scripts. The board has no dependencies, so nothing has to be installed.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')

test('package.json names Node 24 or newer, the three scripts, and no dependencies', () => {
  assert.equal(pkg.engines.node, '>=24')
  assert.deepEqual(pkg.scripts, { start: 'node server.mjs', demo: 'node server.mjs --demo', test: 'node --test' })
  assert.equal(pkg.private, true)
  assert.deepEqual([pkg.dependencies, pkg.devDependencies], [undefined, undefined])
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'the Node running these tests is the one package.json asks for')
})

test('the README starts, shows and tests the board with those scripts', () => {
  for (const line of ['npm test', 'npm run demo -- --port 4311', '`npm start` prints']) assert.ok(readme.includes(line), line)
})
