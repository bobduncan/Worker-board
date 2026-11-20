// T5.2 P2 (2026-11-16): the paths of the project's things go through src/projectPaths.mjs (the chats' home, the data home, the
// stored-path table). Outside it, every `join`, `resolve` or `inProject` on `project` or `config.project`, and every `.claude`
// literal, is a tie to today's layout. The ties known now are listed in test/fixtures/pathGuard-known.json, per file, as the
// LINES that hold them (chat 1's review of 2026-11-20: a count per file hid a new tie beside a removed one): a new line fails,
// naming it; a line that is gone fails until it is taken out of the list, so the list only shrinks. P3 and the switch-on round
// empty it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The two kinds of tie: a path made from the project folder, and a `.claude` folder named by hand. */
export const TIES = {
  project: /\b(?:join|resolve|inProject)\(\s*(?:HERE,\s*)?(?:[\w.]+\.)?project\b/,
  claude: /['"`]\.claude(?=['"`/\\])/,
}

/** The board's code: what runs (never tests, samples, the page's own scripts or the Workers mod). */
const IN_SCOPE = /^(?:server\.mjs|setup\.mjs|start-board\.mjs|src\/|tools\/.*\.mjs$)/
const TABLE = 'src/projectPaths.mjs'
const KNOWN_FILE = join(ROOT, 'test', 'fixtures', 'pathGuard-known.json')

/** The ties known, per file: `[ "<kind>: <the line, trimmed>", ... ]`, sorted. Only shrinks. */
export const KNOWN = JSON.parse(readFileSync(KNOWN_FILE, 'utf8'))

/** Every tie line of a text, as the list keeps them. */
export function tieLinesOf(text) {
  const found = []
  for (const line of text.split('\n')) for (const [kind, pattern] of Object.entries(TIES)) if (pattern.test(line)) found.push(`${kind}: ${line.trim().slice(0, 160)}`)
  return found.sort()
}

export function tiesNow() {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(file => IN_SCOPE.test(file) && file !== TABLE)
  const found = {}
  for (const file of files) {
    const lines = tieLinesOf(readFileSync(join(ROOT, file), 'utf8'))
    if (lines.length > 0) found[file] = lines
  }
  return found
}

/** The lines of `a` not in `b` (with repeats). */
const without = (a, b) => {
  const left = [...b]
  return a.filter(line => {
    const at = left.indexOf(line)
    if (at < 0) return true
    left.splice(at, 1)
    return false
  })
}

test('every path of the project\'s things outside src/projectPaths.mjs is a known tie line, and the list only shrinks', () => {
  const now = tiesNow()
  const problems = []
  for (const file of new Set([...Object.keys(now), ...Object.keys(KNOWN)])) {
    for (const line of without(now[file] ?? [], KNOWN[file] ?? [])) problems.push(`${file}: new tie, route it through src/projectPaths.mjs (chatHomeOf, chatFile, resolveStored, picturesOf, assetsOf): ${line}`)
    for (const line of without(KNOWN[file] ?? [], now[file] ?? [])) problems.push(`${file}: tie gone, take it out of test/fixtures/pathGuard-known.json (the list only shrinks): ${line}`)
  }
  assert.deepEqual(problems, [])
})

test('the tie patterns catch each form, a changed tie counts as new, and nothing in the table\'s own file is listed', () => {
  const sample = "join(project, 'x'); join(config.project, ...a); inProject(config.project, p); resolve(HERE, config.project); join(this.config.project, 'y'); '.claude/work'; \".claude\"; `.claude/${x}`; join(home, '.claude', 'y')"
  assert.equal(sample.split(';').filter(line => TIES.project.test(line)).length, 5)
  assert.equal(sample.split(';').filter(line => TIES.claude.test(line)).length, 4)
  assert.equal(TIES.claude.test("const claudeDir = 'x.claude'; ['.claudeignore']"), false)
  assert.deepEqual(tieLinesOf("const a = join(project, 'x')\nconst b = 1\n"), ["project: const a = join(project, 'x')"])
  // Chat 1's review: a tie swapped for another on the same file is a new line, not a kept count.
  assert.deepEqual(without(tieLinesOf("join(project, 'y')"), tieLinesOf("join(project, 'x')")), ["project: join(project, 'y')"])
  assert.equal(Object.keys(KNOWN).includes(TABLE), false)
  assert.ok(readFileSync(join(ROOT, TABLE), 'utf8').includes('export function resolveStored'))
})
