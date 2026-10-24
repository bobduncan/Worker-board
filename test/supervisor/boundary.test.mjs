// The supervisor (spec 2026-10-24, "The supervisor: the board checks itself"): one component, `src/supervisor/`, owns all
// of the board's self-diagnosis. Its boundary: the server starts it in one place, and nothing else in the board imports
// its parts. Only server.mjs imports `src/supervisor/index.mjs`; no file outside the folder imports anything deeper.
// Tests may (they test the parts).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The board's own code: every tracked script outside the tests and outside the supervisor's folder. */
const CODE = /\.(?:mjs|js|cjs|ts|tsx)$/
const isOutside = file => !file.startsWith('test/') && !file.startsWith('src/supervisor/') && !/\.test\.tsx?$/.test(file)

/** Every module a file names in an import, a re-export or a dynamic import, as written. */
const importsOf = text => [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)].map(match => match[1])

/** Where a relative module of `file` lies, from the board's folder, with `/`. */
const resolved = (file, spec) => posix.normalize(posix.join(posix.dirname(file), spec))

function supervisorImports() {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(file => CODE.test(file) && isOutside(file))
  const found = []
  for (const file of files) {
    if (!existsSync(join(ROOT, file))) continue
    for (const spec of importsOf(readFileSync(join(ROOT, file), 'utf8'))) {
      if (!spec.startsWith('.')) continue
      const target = resolved(file, spec)
      if (target.startsWith('src/supervisor/') || target === 'src/supervisor') found.push(`${file} → ${target}`)
    }
  }
  return found
}

test('the boundary: only server.mjs imports the supervisor, and only its index.mjs', () => {
  assert.deepEqual(supervisorImports(), ['server.mjs → src/supervisor/index.mjs'])
})

test('the move: the self-check lives in the supervisor; src/work/sync.mjs is gone', () => {
  for (const file of ['src/supervisor/index.mjs', 'src/supervisor/loop.mjs', 'src/supervisor/rules/repair.mjs']) {
    assert.ok(existsSync(join(ROOT, file)), `${file} is there`)
  }
  assert.equal(existsSync(join(ROOT, 'src/work/sync.mjs')), false)
})

test('the boundary test reads imports of every form', () => {
  const text = "import { a } from './x.mjs'\nexport { b } from \"../y.mjs\"\nconst c = await import('./z.mjs')\nimport './side.mjs'"
  assert.deepEqual(importsOf(text), ['./x.mjs', '../y.mjs', './z.mjs', './side.mjs'])
  assert.equal(resolved('src/work/check.mjs', '../supervisor/loop.mjs'), 'src/supervisor/loop.mjs')
})
