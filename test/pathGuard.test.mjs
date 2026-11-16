// T5.2 P2 (2026-11-16): the paths of the project's things go through src/projectPaths.mjs (the chats' home, the data home, the
// stored-path table). Outside it, every `join`, `resolve` or `inProject` on `project` or `config.project`, and every `.claude`
// literal, is a tie to today's layout. The ties known now are listed here per file with their count: a new one fails, and a
// removed one fails until its count is lowered (as anyProject.test.mjs does). P3 (the data home and the resolver) empties the list.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The two kinds of tie: a path made from the project folder, and a `.claude` folder named by hand. */
export const TIES = {
  project: /\b(?:join|resolve|inProject)\(\s*(?:HERE,\s*)?(?:[\w.]+\.)?project\b/g,
  claude: /['"`]\.claude(?=['"`/\\])/g,
}

/** The board's code: what runs (never tests, samples, the page's own scripts or the Workers mod). */
const IN_SCOPE = /^(?:server\.mjs|setup\.mjs|start-board\.mjs|src\/|tools\/.*\.mjs$)/
const TABLE = 'src/projectPaths.mjs'

/** The ties known after P3's first slice (2026-11-16), per file: `[project joins, .claude literals]`. Only shrinks. */
export const KNOWN = {
  'server.mjs': [18, 2],
  'src/assets.mjs': [0, 4],
  'src/bridge.mjs': [0, 1],
  'src/carry/guards.mjs': [0, 1],
  'src/carry/pictures.mjs': [6, 0],
  'src/carry/set.mjs': [4, 9],
  'src/chatLogs.mjs': [1, 1],
  'src/codeJobs.mjs': [3, 8],
  'src/config.mjs': [0, 9],
  'src/cpu.mjs': [0, 1],
  'src/gameFile.mjs': [0, 2],
  'src/ideas.mjs': [1, 0],
  'src/landingSetup.mjs': [1, 3],
  'src/newProject.mjs': [5, 11],
  'src/pictures.mjs': [1, 0],
  'src/planLines.mjs': [0, 2],
  'src/ports.mjs': [1, 3],
  'src/providers/sound-library.mjs': [2, 0],
  'src/setup.mjs': [0, 3],
  'src/sources.mjs': [2, 1],
  'src/talkPicture.mjs': [1, 0],
  'src/work/api.mjs': [1, 0],
  'src/work/check.mjs': [1, 0],
  'src/work/recapWords.mjs': [0, 1],
  'src/work/rename.mjs': [0, 1],
  'src/work/rowWords.mjs': [0, 1],
  'src/work/worktrees.mjs': [2, 0],
  'start-board.mjs': [1, 0],
  'tools/carry.mjs': [2, 3],
  'tools/spending-count.mjs': [1, 1],
}

export function tiesNow() {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(file => IN_SCOPE.test(file) && file !== TABLE)
  const found = {}
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    const counts = Object.values(TIES).map(pattern => (text.match(pattern) ?? []).length)
    if (counts.some(count => count > 0)) found[file] = counts
  }
  return found
}

test('every path of the project\'s things outside src/projectPaths.mjs is a known tie, and the list only shrinks', () => {
  const now = tiesNow()
  const problems = []
  for (const [file, counts] of Object.entries(now)) {
    const known = KNOWN[file] ?? [0, 0]
    counts.forEach((count, at) => {
      const kind = Object.keys(TIES)[at]
      if (count > known[at]) problems.push(`${file}: ${count} ${kind} tie(s), ${known[at]} known: route the new one through src/projectPaths.mjs (chatHomeOf, chatFile, resolveStored, picturesOf, assetsOf)`)
      if (count < known[at]) problems.push(`${file}: ${count} ${kind} tie(s), ${known[at]} known: lower the count in KNOWN (the list only shrinks)`)
    })
  }
  for (const [file, known] of Object.entries(KNOWN)) if (now[file] === undefined && known.some(count => count > 0)) problems.push(`${file}: no tie left (or the file is gone): take it out of KNOWN`)
  assert.deepEqual(problems, [])
})

test('the tie patterns catch each form and nothing in the table\'s own file', () => {
  const sample = "join(project, 'x'); join(config.project, ...a); inProject(config.project, p); resolve(HERE, config.project); join(this.config.project, 'y'); '.claude/work'; \".claude\"; `.claude/${x}`; join(home, '.claude', 'y')"
  assert.equal((sample.match(TIES.project) ?? []).length, 5)
  assert.equal((sample.match(TIES.claude) ?? []).length, 4)
  assert.equal(("const claudeDir = 'x.claude'; ['.claudeignore']".match(TIES.claude) ?? []).length, 0)
  assert.equal(readFileSync(join(ROOT, TABLE), 'utf8').includes('export function resolveStored'), true)
})
