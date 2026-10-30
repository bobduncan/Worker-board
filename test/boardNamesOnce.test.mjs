// B540: public/board.js is one script, so a later top-level function, const, let or class with the name of an earlier
// one silently replaces it (a duplicate function wins without a word; it happened before and the region tests did not
// see it). This test lists the script's top-level names and fails, naming the name and both lines, when one repeats.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const board = await readFile(join(PUBLIC, 'board.js'), 'utf8')

const DECLARATION = /^(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/

/** The script's top-level declarations: every function, const, let, var or class at column 0, with its line. */
export function topLevelNames(source) {
  const names = []
  source.split(/\r?\n/).forEach((text, i) => {
    const found = DECLARATION.exec(text)
    if (found) names.push({ name: found[1], line: i + 1 })
  })
  return names
}

/** One line per name declared more than once: the name and every line it stands on. */
export function repeatedNames(source) {
  const lines = new Map()
  for (const { name, line } of topLevelNames(source)) lines.set(name, [...(lines.get(name) ?? []), line])
  return [...lines].filter(([, at]) => at.length > 1).map(([name, at]) => `${name} on lines ${at.join(', ')}`)
}

test('board.js declares every top-level name once', () => {
  assert.ok(topLevelNames(board).length > 500, 'the scan finds the script\'s declarations')
  assert.deepEqual(repeatedNames(board), [])
})

test('a second "function send" at the end is named with both lines', () => {
  const first = topLevelNames(board).find(d => d.name === 'send')
  assert.ok(first, 'board.js has a top-level send')
  const mutant = `${board}\nfunction send () {}\n`
  const last = mutant.split(/\r?\n/).length - 1
  assert.deepEqual(repeatedNames(mutant), [`send on lines ${first.line}, ${last}`])
})

test('every kind of top-level declaration counts; indented ones and look-alikes do not', () => {
  const source = [
    'async function a () {}', 'function* b () {}', 'const c = 1', 'let d', 'var e', 'class F {}',
    'function a () {}', 'const b = 2', 'let c', 'class d {}', 'var e', 'const F = 3',
    '  function a () {}', 'const constant = 1', 'functional()', '// function g () {}',
  ].join('\r\n')
  assert.deepEqual(repeatedNames(source), ['a on lines 1, 7', 'b on lines 2, 8', 'c on lines 3, 9', 'd on lines 4, 10',
    'e on lines 5, 11', 'F on lines 6, 12'])
})
